import { create } from 'zustand';
import { ANSWER_SCHEMA, type AuraAnswer } from '@/features/ai/answer.schema';
import { AuraError, isAuraError } from '@/features/ai/errors';
import { estimateImageTokens, resolveModel } from '@/features/ai/models';
import { normalizeAnswer, parseJsonLoose } from '@/features/ai/normalize';
import { callProvider, testConnection } from '@/features/ai/provider';
import { readProviderUsage } from '@/features/ai/usage';
import type { AIRequest, ImageInput, Provider, ProviderTransport, ProviderUsage } from '@/features/ai/types';
import { DEFAULT_CALIBRATION, enforceWordLimit, estimateSeconds } from '@/features/answer/wordBudget';
import { costFromUsage, DEFAULT_BUDGET, estimateRequestCost, formatIdr, preflight, type BudgetPolicy } from '@/features/budgets/cost';
import { isSupportedTextFile } from '@/features/knowledge/chunk';
import { assembleContext, buildCheckpointSummary, STRATEGY_BUDGETS, type ContextPacket, type TurnLite } from '@/features/memory/contextAssembler';
import { buildFtsQuery, extractKeywords, tokenizeWords } from '@/features/memory/keywords';
import { detectStance, findSuperseded, firstSentences, type ClaimLite } from '@/features/memory/positions';
import { estimateTokens } from '@/features/memory/tokens';
import { buildSystemPrompt, DEFAULT_BASE_PROMPT, KETIK_45, type AnswerPrefs } from '@/features/prompts/defaults';
import { applyOverride, isPreferenceOnlyMessage, parsePromptOverride } from '@/features/prompts/overrides';
import { classifyText, INITIAL_ACTIVITY, updateActivity, type ActivityState } from '@/features/session/activity';
import { apiAllowed, canTransition, type SessionStage } from '@/features/session/lifecycle';
import { desktop, errorMessage, isDesktop, transport } from './platform';

export interface Doc { id: string; name: string; content: string; updatedAt: string }
export interface Job { id: string; company: string; role: string; description: string }
export interface Turn extends TurnLite { occurredAt: string }
export interface PinnedFact { id: string; text: string; sourceTurnId: number | null; createdAt: string }
export interface UsageRow {
  id: string; provider: Provider; model: string; kind: 'answer' | 'retry' | 'summary' | 'connection'; at: string;
  inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null;
  reasoningTokens: number | null; imageUsd: number; usd: number; estimatedUsd: number; requestCount: number;
}
export interface HistoryEntry {
  id: string; at: string; stage: SessionStage; activity: ActivityState; turns: Turn[];
  answer: AuraAnswer | null; usage: UsageRow[];
}
export interface Appearance {
  promptOpacity: number; answerOpacity: number; promptOnTop: boolean; answerOnTop: boolean;
  promptCompact: boolean; answerCompact: boolean; blur: number; fontScale: number; highContrast: boolean;
}
export interface WorkspaceData {
  provider: Provider; models: Record<Provider, string>; prefs: AnswerPrefs; basePrompt: string;
  calibration: typeof DEFAULT_CALIBRATION; budget: BudgetPolicy; appearance: Appearance;
  documents: Doc[]; jobs: Job[]; activeJobId: string | null; profileFacts: string;
  history: HistoryEntry[]; saveHistory: boolean; trayEnabled: boolean;
}
export interface SessionState {
  id: string; stage: SessionStage; paused: boolean; cloudConsent: boolean; activity: ActivityState;
  turns: Turn[]; pinned: PinnedFact[]; claims: ClaimLite[]; summaries: string[]; usage: UsageRow[];
  answer: AuraAnswer | null; lastContext: ContextPacket | null; error: string | null;
  busy: boolean; budgetWarning: string | null;
}
interface VaultStatus { unlocked: boolean; gemini: boolean; openai: boolean; initialized?: boolean }
export interface DocumentHit { id: string; text: string; title: string }
export interface AuraView {
  data: WorkspaceData; session: SessionState; text: string; image: ImageInput | null;
  vault: VaultStatus; notice: string | null; initialized: boolean;
}
interface AuraState extends AuraView {
  initialize: () => Promise<void>;
  setText: (text: string) => void;
  setImage: (image: ImageInput | null) => void;
  run: () => Promise<void>;
  cancel: () => void;
  regenerate: () => Promise<void>;
  shorten: () => Promise<void>;
  changeStage: (stage: SessionStage) => void;
  setConsent: (enabled: boolean) => Promise<void>;
  pause: () => void;
  newSession: () => void;
  addTurn: (text: string, speaker?: string) => void;
  addPin: (text: string) => void;
  removePin: (id: string) => void;
  setData: (patch: Partial<WorkspaceData>) => void;
  setAppearance: (patch: Partial<Appearance>) => void;
  importDocument: (file: File) => Promise<void>;
  updateDocument: (id: string, content: string) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  searchDocuments: (query: string) => Promise<DocumentHit[]>;
  saveJob: (job: Job) => void;
  deleteJob: (id: string) => void;
  deleteHistory: (id: string) => void;
  clearData: () => Promise<void>;
  unlockVault: (password: string) => Promise<void>;
  lockVault: () => Promise<void>;
  setKey: (provider: Provider, key: string) => Promise<void>;
  testProvider: () => Promise<void>;
  simulate: () => void;
  simulateParticipant: () => Promise<void>;
  setNotice: (notice: string | null) => void;
}

const blankVault = { unlocked: false, gemini: false, openai: false };
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const defaults: WorkspaceData = {
  provider: 'gemini', models: { gemini: 'gemini-2.5-flash', openai: 'gpt-5.4-mini' },
  prefs: KETIK_45, basePrompt: DEFAULT_BASE_PROMPT, calibration: DEFAULT_CALIBRATION, budget: DEFAULT_BUDGET,
  appearance: { promptOpacity: 45, answerOpacity: 45, promptOnTop: false, answerOnTop: false,
    promptCompact: false, answerCompact: false, blur: 0, fontScale: 100, highContrast: false },
  documents: [], jobs: [], activeJobId: null, profileFacts: '', history: [], saveHistory: false, trayEnabled: false,
};
const freshSession = (): SessionState => ({
  id: id(), stage: 'standby', paused: false, cloudConsent: false, activity: INITIAL_ACTIVITY, turns: [],
  pinned: [], claims: [], summaries: [], usage: [], answer: null, lastContext: null, error: null,
  busy: false, budgetWarning: null,
});
const browserKey = 'aura-local-workspace-v1';
let activeCall: AbortController | null = null;
let lastPrompt = '';
let lastHadImage = false;
let pendingIndex = Promise.resolve();
let pendingSave = Promise.resolve();
let pendingCloud = Promise.resolve();

function syncCloud() {
  if (!isDesktop) return Promise.resolve();
  pendingCloud = pendingCloud.catch(() => undefined).then(() => {
    const s = useAura.getState().session;
    return desktop<void>('session_set_cloud', { enabled: s.cloudConsent && apiAllowed(s.stage, s.paused).allowed });
  });
  return pendingCloud;
}

function turnMatches(turns: Turn[], query: string, limit: number) {
  const words = extractKeywords(query);
  return turns.map((turn) => {
    const tokens = tokenizeWords(turn.text);
    return { turn, matches: words.filter((word) => tokens.some((token) => token.startsWith(word))).length };
  }).filter((item) => item.matches).sort((a, b) => b.matches - a.matches || b.turn.seq - a.turn.seq)
    .slice(0, limit).map((item) => item.turn);
}

export const useAura = create<AuraState>((set, get) => {
  function patchSession(patch: Partial<SessionState>) {
    set((state) => ({ session: { ...state.session, ...patch } }));
  }

  function notifyFailure(error: unknown) { get().setNotice(errorMessage(error)); }

  function appendTurn(text: string, speaker: string) {
    const safeText = text.trim().slice(0, 12_000);
    if (!safeText) return;
    const s = get().session;
    const seq = (s.turns.at(-1)?.seq ?? 0) + 1;
    const turn: Turn = { id: seq, seq, speaker: speaker.trim().slice(0, 80) || 'unknown', text: safeText, occurredAt: now() };
    const turns = [...s.turns, turn];
    const claims = [...s.claims];
    if (turn.speaker !== 'aura' && detectStance(safeText) !== 'netral') {
      const replaced = new Set(findSuperseded(turn.speaker, safeText, claims));
      for (const [index, claim] of claims.entries()) {
        if (replaced.has(claim.id)) claims[index] = { ...claim, supersededBy: turn.id };
      }
      claims.push({ id: turn.id, speakerId: turn.speaker, claim: firstSentences(safeText), supersededBy: null });
    }
    const superseded = new Set(claims.filter((claim) => claim.supersededBy !== null).map((claim) => claim.id));
    const summaries: string[] = [];
    for (let offset = 0; offset + 6 <= turns.length; offset += 6) {
      const checkpoint = buildCheckpointSummary(turns.slice(offset, offset + 6).filter((item) => !superseded.has(item.id)),
        (value) => firstSentences(value, 18));
      if (checkpoint) summaries.push(checkpoint);
    }
    patchSession({ turns, claims, summaries,
      activity: turn.speaker === 'aura' ? s.activity : updateActivity(s.activity, classifyText(safeText)) });
    if (isDesktop) {
      pendingIndex = pendingIndex.catch(() => undefined).then(() =>
        desktop<void>('db_index_turn', { sessionId: s.id, turn }));
      void pendingIndex.catch(notifyFailure);
    }
  }

  function dropIndex(sessionId: string) {
    if (!isDesktop) return;
    pendingIndex = pendingIndex.catch(() => undefined).then(() => desktop<void>('db_clear_turns', { sessionId }));
    void pendingIndex.catch(notifyFailure);
  }

  function archive(s: SessionState) {
    if (!get().data.saveHistory || (!s.turns.length && !s.answer && !s.usage.length)) return;
    get().setData({ history: [{
      id: s.id, at: now(), stage: s.stage, activity: s.activity, turns: s.turns, answer: s.answer, usage: s.usage,
    }, ...get().data.history.filter((item) => item.id !== s.id)] });
  }

  async function generate(text: string, image: ImageInput | null, recordInput: boolean, resultSpeaker = 'aura') {
    const { data, session, vault } = get();
    if (session.busy || activeCall) return;
    const permit = apiAllowed(session.stage, session.paused);
    const unavailable = !permit.allowed ? permit.reason : !isDesktop ? 'Jalankan aplikasi desktop AURA untuk memakai layanan AI.'
      : !session.cloudConsent ? 'Aktifkan izin pengiriman ke provider pada sesi ini.'
      : !vault.unlocked || !vault[data.provider] ? 'Buka vault dan simpan API key provider aktif di Settings.' : null;
    if (unavailable) { patchSession({ error: unavailable }); return; }
    if (!text.trim() && !image) { patchSession({ error: 'Tambahkan teks atau screenshot terlebih dahulu.' }); return; }

    const controller = new AbortController();
    activeCall = controller;
    patchSession({ busy: true, error: null, budgetWarning: null });
    let attempted = false;
    try {
      await syncCloud();
      const searchText = text || session.turns.at(-1)?.text || '';
      const query = buildFtsQuery(extractKeywords(searchText));
      const bounds = STRATEGY_BUDGETS[data.budget.strategy];
      let matches: Turn[] = [];
      if (query) {
        try {
          await pendingIndex;
          matches = await desktop<Turn[]>('db_search_turns', { sessionId: session.id, query, limit: bounds.historyCount + bounds.recentCount });
        } catch {
          matches = turnMatches(session.turns, searchText, bounds.historyCount + bounds.recentCount);
        }
      }
      const hits = await get().searchDocuments(searchText);
      const hiddenClaims = new Set(session.claims.filter((claim) => claim.supersededBy !== null).map((claim) => claim.id));
      const context = assembleContext({
        strategy: data.budget.strategy, latestInput: text, hasImage: Boolean(image),
        stage: session.stage, activity: session.activity,
        job: data.jobs.find((job) => job.id === data.activeJobId),
        profileFacts: [...data.profileFacts.split('\n').filter(Boolean), ...hits.map((hit) => `[${hit.title}] ${hit.text}`)],
        pinnedFacts: session.pinned.map((fact) => fact.text),
        activePositions: session.claims.filter((claim) => claim.supersededBy === null).slice(-8).reverse()
          .map((claim) => ({ speaker: claim.speakerId, claim: claim.claim })),
        summaries: session.summaries,
        recentTurns: session.turns.filter((turn) => !hiddenClaims.has(turn.id)).slice(-bounds.recentCount),
        relevantHistory: matches.filter((turn) => !hiddenClaims.has(turn.id)),
      });
      if (controller.signal.aborted) return;
      patchSession({ lastContext: context });

      const model = resolveModel(data.provider, data.models[data.provider]);
      const systemPrompt = buildSystemPrompt(data.basePrompt, data.prefs);
      const textTokens = context.totalTokens + estimateTokens(systemPrompt) + estimateTokens(JSON.stringify(ANSWER_SCHEMA));
      if (textTokens > 4000) {
        throw new AuraError('INVALID_INPUT', 'Konteks teks melampaui batas sekitar 4.000 token. Pilih strategi Economy atau pendekkan input dan prompt dasar.');
      }
      const req: AIRequest = {
        provider: model.provider, model: model.id, systemPrompt, userPrompt: context.text, image: image ?? undefined,
        maxOutputTokens: model.maxOutputTokens, allowWebSearch: false, schema: ANSWER_SCHEMA,
      };
      const estimate = estimateRequestCost(model, textTokens,
        image ? estimateImageTokens(model.provider, image.width, image.height) : 0, data.budget.fxUsdIdr,
        Math.max(250, model.maxOutputTokens - model.reasoningReserve));
      let attempt = 0;
      const monitored: ProviderTransport = {
        cancel: transport.cancel,
        async send(request) {
          const policy = get().data.budget;
          const spent = get().session.usage.reduce((sum, row) => sum + row.usd, 0) * policy.fxUsdIdr;
          const gate = preflight(policy, spent, estimate.usd * policy.fxUsdIdr);
          if (!gate.allowed) throw new AuraError('BUDGET', gate.reason ?? 'Anggaran sesi terlampaui.');
          if (gate.warning) patchSession({ budgetWarning: `Mendekati batas sesi ${formatIdr(policy.limitIdr)}.` });
          attempt += 1;
          attempted = true;
          const res = await transport.send(request);
          let usage: ProviderUsage | null = null;
          if (res.status >= 200 && res.status < 300 && res.body) {
            try { usage = readProviderUsage(model.provider, JSON.parse(res.body)); } catch { /* Unreported usage. */ }
          }
          const charge = res.status >= 400 && res.status < 500 ? 0 : estimate.usd;
          const row: UsageRow = {
            id: id(), provider: model.provider, model: model.id, kind: attempt > 1 ? 'retry' : 'answer', at: now(),
            inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
            cachedTokens: usage?.cachedTokens ?? null, reasoningTokens: usage?.reasoningTokens ?? null,
            imageUsd: charge > 0 ? estimate.imageUsd : 0,
            usd: usage ? costFromUsage(model, usage) : charge, estimatedUsd: estimate.usd, requestCount: 1,
          };
          if (get().session.id === session.id) {
            const current = get().session;
            patchSession({ usage: [...current.usage, row] });
            if (current.stage === 'end') archive(get().session);
          } else if (get().data.history.some((entry) => entry.id === session.id)) {
            get().setData({ history: get().data.history.map((entry) =>
              entry.id === session.id ? { ...entry, usage: [...entry.usage, row] } : entry) });
          }
          return res;
        },
      };
      const result = await callProvider(monitored, req, model, { requestId: id(), signal: controller.signal });
      const answer = normalizeAnswer(parseJsonLoose(result.text), result.sources);
      const words = enforceWordLimit(answer.jawaban_final, data.prefs.minWords, data.prefs.maxWords);
      answer.jawaban_final = words.text;
      answer.mode = data.prefs.mode === 'KETIK' ? 'ketik' : 'lisan';
      answer.estimasi_durasi_detik = estimateSeconds(words.words, data.prefs.mode, data.calibration);
      if (recordInput && text.trim()) appendTurn(text, 'unknown');
      if (image && answer.isi_terbaca.trim()) appendTurn(answer.isi_terbaca, 'aura');
      const activity = updateActivity(get().session.activity, {
        type: answer.activity_type, certainty: answer.activity_certainty, evidence: answer.activity_evidence, source: 'ai',
      });
      patchSession({ answer, activity });
      appendTurn(answer.jawaban_final, resultSpeaker);
      lastPrompt = text;
      lastHadImage = Boolean(image);
      if (recordInput) set((current) => ({ text: current.text === text ? '' : current.text }));
    } catch (error) {
      if (get().session.id === session.id && (!controller.signal.aborted || (isAuraError(error) && error.code === 'CANCELLED' && apiAllowed(get().session.stage, get().session.paused).allowed))) {
        patchSession({ error: errorMessage(error) });
      }
    } finally {
      if (activeCall === controller) activeCall = null;
      if (get().session.id === session.id) patchSession({ busy: false });
      if (attempted && get().image === image) set({ image: null });
    }
  }

  return {
    data: defaults, session: freshSession(), text: '', image: null, vault: blankVault, notice: null, initialized: false,
    async initialize() {
      try {
        const stored = isDesktop ? await desktop<Partial<WorkspaceData> | null>('db_load') :
          JSON.parse(localStorage.getItem(browserKey) ?? 'null') as Partial<WorkspaceData> | null;
        if (stored) set({ data: {
          ...defaults, ...stored, models: { ...defaults.models, ...stored.models },
          budget: { ...defaults.budget, ...stored.budget }, prefs: { ...defaults.prefs, ...stored.prefs },
          appearance: { ...defaults.appearance, ...stored.appearance },
        } });
        if (isDesktop) {
          set({ vault: await desktop<VaultStatus>('vault_status') });
          if (get().data.trayEnabled) await desktop('desktop_set_tray', { enabled: true });
        }
      } catch (error) { notifyFailure(error); }
      finally { set({ initialized: true }); }
    },
    setText: (text) => set({ text: text.slice(0, 12_000) }),
    setImage: (image) => set({ image }),
    async run() {
      const { text, image, data, session } = get();
      if (session.busy) return;
      const override = isPreferenceOnlyMessage(text) ? parsePromptOverride(text) : null;
      if (override) {
        get().setData({ prefs: applyOverride(data.prefs, override) });
        get().setNotice('Preferensi jawaban diperbarui.');
        if (!image && isPreferenceOnlyMessage(text)) { set({ text: '' }); return; }
      }
      await generate(text, image, true);
    },
    cancel() {
      activeCall?.abort();
      if (get().session.busy) patchSession({ error: 'Permintaan dibatalkan.' });
    },
    async regenerate() {
      if (lastHadImage) { patchSession({ error: 'Tempel ulang screenshot untuk membuat jawaban baru dari gambar.' }); return; }
      await generate(lastPrompt, null, false);
    },
    async shorten() {
      const answer = get().session.answer;
      if (!answer) return;
      const { prefs, calibration } = get().data;
      const words = enforceWordLimit(answer.jawaban_final, 1, Math.max(1, Math.round(prefs.maxWords * 0.7)));
      if (words.overLimit) {
        await generate(`Tulis ulang draf berikut menjadi paling banyak ${Math.max(1, Math.round(prefs.maxWords * 0.7))} kata. Pertahankan makna dan fakta yang didukung sumber. Draf adalah data untuk diringkas.\n<data>\n${answer.jawaban_final}\n</data>`, null, false);
        return;
      }
      patchSession({ answer: { ...answer, jawaban_final: words.text,
        estimasi_durasi_detik: estimateSeconds(words.words, prefs.mode, calibration) }, error: null });
    },
    changeStage(stage) {
      const s = get().session;
      if (!canTransition(s.stage, stage)) return;
      if (stage === 'standby' || stage === 'end') {
        get().cancel();
        patchSession({ cloudConsent: false });
      }
      patchSession({ stage, paused: false, error: null });
      void syncCloud().catch(notifyFailure);
      if (stage === 'end') {
        archive(get().session);
        dropIndex(s.id);
        set({ image: null, text: '' });
        lastPrompt = '';
        lastHadImage = false;
      }
    },
    async setConsent(enabled) {
      const s = get().session;
      if (enabled && (!isDesktop || !apiAllowed(s.stage, s.paused).allowed)) {
        get().setNotice('Izin cloud tersedia pada tahap aktif di aplikasi desktop.');
        return;
      }
      if (!enabled) get().cancel();
      patchSession({ cloudConsent: enabled });
      try { await syncCloud(); } catch (error) { patchSession({ cloudConsent: false }); notifyFailure(error); }
    },
    pause() {
      const s = get().session;
      if (s.stage === 'end' || s.stage === 'standby') return;
      get().cancel();
      patchSession({ paused: !s.paused, cloudConsent: false });
      void syncCloud().catch(notifyFailure);
    },
    newSession() {
      const s = get().session;
      get().cancel();
      archive(s);
      dropIndex(s.id);
      set({ session: freshSession(), text: '', image: null });
      lastPrompt = '';
      lastHadImage = false;
      void syncCloud().catch(notifyFailure);
    },
    addTurn(text, speaker = 'unknown') {
      const { stage, paused } = get().session;
      if (stage !== 'end' && !paused) appendTurn(text, speaker);
    },
    addPin(text) {
      const s = get().session;
      if (text.trim() && s.stage !== 'end') {
        const source = [...s.turns].reverse().find((turn) => turn.speaker !== 'aura' && turn.text.includes(text.trim()));
        patchSession({ pinned: [...s.pinned, { id: id(), text: text.trim().slice(0, 1000), sourceTurnId: source?.id ?? null, createdAt: now() }] });
      }
    },
    removePin(pinId) { patchSession({ pinned: get().session.pinned.filter((pin) => pin.id !== pinId) }); },
    setData(patch) {
      set((state) => ({ data: { ...state.data, ...patch } }));
      if (isDesktop && patch.trayEnabled !== undefined) {
        void desktop('desktop_set_tray', { enabled: patch.trayEnabled }).catch(notifyFailure);
      }
    },
    setAppearance(patch) { get().setData({ appearance: { ...get().data.appearance, ...patch } }); },
    async importDocument(file) {
      const issue = isSupportedTextFile(file.name, file.size);
      if (issue) throw new Error(issue);
      const content = (await file.text()).trim();
      if (!content || content.includes('\0')) throw new Error('Berkas kosong atau format teks tidak valid.');
      const previous = get().data.documents.find((doc) => doc.name === file.name && doc.content === content);
      if (previous) { get().setNotice('Berkas sudah ada di Knowledge Base.'); return; }
      const document: Doc = { id: id(), name: file.name, content, updatedAt: now() };
      if (isDesktop) await desktop('db_upsert_document', { document });
      get().setData({ documents: [document, ...get().data.documents] });
      get().setNotice(`${file.name} diimpor ke Knowledge Base.`);
    },
    async updateDocument(docId, content) {
      const existing = get().data.documents.find((doc) => doc.id === docId);
      if (!existing) return;
      if (!content.trim() || new TextEncoder().encode(content).length > 2 * 1024 * 1024) throw new Error('Isi dokumen harus berupa teks hingga 2 MB.');
      const document = { ...existing, content, updatedAt: now() };
      if (isDesktop) await desktop('db_upsert_document', { document });
      get().setData({ documents: get().data.documents.map((doc) => doc.id === docId ? document : doc) });
    },
    async removeDocument(docId) {
      if (isDesktop) await desktop('db_delete_document', { id: docId });
      get().setData({ documents: get().data.documents.filter((doc) => doc.id !== docId) });
    },
    async searchDocuments(text) {
      const terms = extractKeywords(text);
      const query = buildFtsQuery(terms);
      if (!query) return [];
      if (isDesktop) return desktop<DocumentHit[]>('db_search_documents', { query, limit: 5 });
      return get().data.documents.flatMap((doc) => {
        const match = doc.content.split(/\n+/).find((line) => terms.some((term) => line.toLowerCase().includes(term)));
        return match ? [{ id: doc.id, title: doc.name, text: match.slice(0, 600) }] : [];
      }).slice(0, 5);
    },
    saveJob(job) {
      const jobs = get().data.jobs;
      get().setData({ jobs: jobs.some((item) => item.id === job.id) ? jobs.map((item) => item.id === job.id ? job : item) : [job, ...jobs] });
    },
    deleteJob(jobId) {
      const { jobs, activeJobId } = get().data;
      get().setData({ jobs: jobs.filter((job) => job.id !== jobId), activeJobId: activeJobId === jobId ? null : activeJobId });
    },
    deleteHistory(historyId) { get().setData({ history: get().data.history.filter((entry) => entry.id !== historyId) }); },
    async clearData() {
      get().cancel();
      const sessionId = get().session.id;
      set({ session: freshSession(), text: '', image: null });
      lastPrompt = '';
      lastHadImage = false;
      if (isDesktop) {
        await syncCloud();
        await Promise.allSettled([pendingSave, pendingIndex]);
        await desktop('db_clear');
        await desktop('desktop_set_tray', { enabled: false });
        dropIndex(sessionId);
      } else localStorage.removeItem(browserKey);
      set({ data: defaults, notice: 'Ruang kerja lokal direset.' });
    },
    async unlockVault(password) {
      if (!isDesktop) throw new Error('Vault tersedia di aplikasi desktop.');
      await desktop('vault_unlock', { password });
      set({ vault: await desktop<VaultStatus>('vault_status') });
    },
    async lockVault() {
      if (!isDesktop) return;
      get().cancel();
      await desktop('vault_lock');
      set({ vault: blankVault });
    },
    async setKey(provider, key) {
      if (!isDesktop) throw new Error('Vault tersedia di aplikasi desktop.');
      await desktop('vault_set', { provider, key: key.trim() });
      set({ vault: await desktop<VaultStatus>('vault_status') });
    },
    async testProvider() {
      const { data, session } = get();
      if (!isDesktop || !session.cloudConsent || !apiAllowed(session.stage, session.paused).allowed) {
        throw new Error('Aktifkan izin cloud pada tahap sesi aktif untuk menguji koneksi.');
      }
      await syncCloud();
      const result = await testConnection(transport, data.provider, data.models[data.provider], id());
      const row: UsageRow = {
        id: id(), provider: data.provider, model: data.models[data.provider], kind: 'connection', at: now(),
        inputTokens: null, outputTokens: null, cachedTokens: null, reasoningTokens: null,
        imageUsd: 0, usd: 0, estimatedUsd: 0, requestCount: 1,
      };
      if (get().session.id === session.id) patchSession({ usage: [...get().session.usage, row] });
      if (!result.ok) throw result.error;
      get().setNotice(`Koneksi ${data.provider === 'openai' ? 'OpenAI' : 'Gemini'} berhasil.`);
    },
    simulate() {
      const s = get().session;
      if (s.stage === 'end' || s.paused) { get().setNotice('Mulai atau lanjutkan sesi untuk latihan RGD.'); return; }
      appendTurn('Studi kasus RGD (simulasi): anggaran terbatas untuk memperbaiki antrean layanan. Tentukan prioritas dan keputusan bersama.', 'Moderator (simulasi)');
      appendTurn('Saya usul membuat reservasi sederhana. Ukur waktu tunggu dan jumlah pengunjung yang batal.', 'Nara (simulasi)');
      appendTurn('Saya kurang setuju jika reservasi langsung diwajibkan. Pertahankan jalur untuk pengunjung tanpa internet.', 'Raka (simulasi)');
      get().setNotice('Skenario latihan lokal ditambahkan. Gunakan Copilot untuk melatih tanggapan.');
    },
    async simulateParticipant() {
      const s = get().session;
      const previous = s.turns.filter((turn) => turn.speaker.startsWith('Peserta AI')).length;
      const speaker = `Peserta AI ${previous % 2 === 0 ? 'A' : 'B'} (simulasi)`;
      await generate(`LATIHAN RGD BERIZIN. Kamu memerankan ${speaker}, peserta fiktif pada simulasi. Berikan satu tanggapan pada kasus dan argumen di konteks lokal. Gunakan jawaban_final untuk perkataan peserta fiktif ini. Nyatakan jenis sesi rgd. Jangan mengatribusikan pendapat simulasi kepada orang nyata. Jika belum ada studi kasus, minta pengguna menambahkan kasus sebelum berargumen.`,
        null, false, speaker);
    },
    setNotice: (notice) => set({ notice }),
  };
});

export function enableWorkspacePersistence() {
  return useAura.subscribe((state, previous) => {
    if (!state.initialized || state.data === previous.data) return;
    const data = state.data;
    pendingSave = pendingSave.catch(() => undefined).then(async () => {
      if (isDesktop) await desktop('db_save', { data });
      else localStorage.setItem(browserKey, JSON.stringify(data));
    });
    void pendingSave.catch((error: unknown) => useAura.getState().setNotice(errorMessage(error)));
  });
}
