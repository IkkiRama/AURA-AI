import type { ActivityType } from '../ai/answer.schema';
import type { TurnLite } from '../memory/contextAssembler';
import { extractKeywords, jaccard } from '../memory/keywords';
import type { SessionStage } from '../session/lifecycle';

export type ProfessionalDomain = 'web-development' | 'data-analysis' | 'data-science' | 'risk' | 'product'
  | 'business-analysis' | 'finance' | 'governance' | 'strategy' | 'operations' | 'project-management'
  | 'digital-transformation' | 'general';

export type QuestionIntent = 'concept' | 'implementation' | 'debugging' | 'code-review' | 'architecture'
  | 'optimization' | 'algorithm' | 'sql' | 'statistical-reasoning' | 'data-case-study' | 'technical-follow-up'
  | 'behavioral' | 'motivation' | 'opinion' | 'case-study' | 'general';

export type QuestionRelationship = 'MAIN_QUESTION' | 'FOLLOW_UP' | 'CLARIFICATION' | 'INSTRUCTION' | 'INCOMPLETE' | 'UNKNOWN';
export type AnswerFramework = 'star-l' | 'present-evidence-fit' | 'prep' | 'risk-impact-control-mitigation'
  | 'problem-user-priority-solution-metrics' | 'problem-data-insight-recommendation' | 'situation-options-tradeoff-recommendation'
  | 'concept-implementation-tradeoff' | 'problem-analysis-solution' | 'acknowledge-position-reason-solution' | 'direct-evidence-link';
export type QuestionLanguage = 'id' | 'en' | 'mixed' | 'unknown';
export type Competency = 'leadership' | 'analytical-thinking' | 'integrity' | 'problem-solving' | 'risk-awareness'
  | 'decision-making' | 'technical-competence' | 'strategic-thinking' | 'stakeholder-management' | 'communication';

export interface QuestionInputs {
  text: string;
  hasImage?: boolean;
  activity?: ActivityType;
  stage?: SessionStage;
  job?: { role: string; description: string } | null;
  recentTurns?: TurnLite[];
  relevantHistory?: TurnLite[];
  knowledge?: string[];
}

export interface QuestionAnalysis {
  domain: ProfessionalDomain;
  intent: QuestionIntent;
  relationship: QuestionRelationship;
  framework: AnswerFramework;
  language: QuestionLanguage;
  competency: Competency | null;
  parentQuestionId: number | null;
  parentQuestionSeq: number | null;
  previousAnswerId: number | null;
}

interface DomainPack {
  domain: Exclude<ProfessionalDomain, 'general'>;
  signals: readonly RegExp[];
  guide: string;
}

const domainPacks: readonly DomainPack[] = [
  { domain: 'web-development', signals: [/\b(javascript|typescript|react|laravel|php|frontend|backend|node\.js)\b/, /\b(rest|api|endpoint|middleware|oauth|jwt|http|webhook)\b/, /\b(authenticat\w*|autentikasi|otorisasi|authorization|xss|csrf|web application|aplikasi web|system design|distributed cache|microservice\w*)\b/], guide: 'Tegaskan kontrak, validasi input, otorisasi dan kondisi gagal yang relevan.' },
  { domain: 'data-analysis', signals: [/\b(sql|join|group by|window function|query)\b/, /\b(excel|spreadsheet|pandas|dashboard|visualisasi|visualization|data cleaning|pembersihan data)\b/, /\b(data analyst|analis data|kpi|segmentasi|aggregat\w*|agregasi|python)\b/], guide: 'Nyatakan definisi metrik, grain, kualitas data dan makna hasil.' },
  { domain: 'data-science', signals: [/\b(machine learning|data scien\w*|model prediktif|predictive model|feature engineering)\b/, /\b(regresi|regression|klasifikasi|classification|cross[ -]validation|hyperparamet\w*|data leakage|overfit\w*|random forest|xgboost)\b/, /\b(statisti\w*|probability|probabilitas|p[ -]value|auc|precision recall|confusion matrix|hypothesis test|interval kepercayaan|confidence interval)\b/], guide: 'Periksa asumsi dan ketidakpastian. Untuk model prediktif, pisahkan pelatihan dan evaluasi serta cek leakage.' },
  { domain: 'risk', signals: [/\b(risk management|manajemen risiko|credit risk|risiko kredit|market risk|risiko pasar|operational risk|risiko operasional|fraud risk|risiko fraud)\b/, /\b(rcsa|kri|risk appetite|stress test\w*|early warning|mitigasi risiko|risk mitigation)\b/, /\b(fraud|default probability|risiko debitur|gagal bayar|kredit bermasalah)\b/], guide: 'Hubungkan risiko, dampak, kontrol, pemilik tindakan dan indikator pemantauan.' },
  { domain: 'product', signals: [/\b(product management|product manager|manajemen produk|product discovery|product priorit\w*|prioritas fitur|memprioritaskan fitur)\b/, /\b(rice|roadmap|okr|churn|retensi pelanggan|customer retention|activation funnel|a\/b test\w*|product metrics)\b/, /\b(user adoption|user research|north star metric)\b/], guide: 'Jelaskan kebutuhan pengguna, prioritas, hipotesis dan metrik keberhasilan.' },
  { domain: 'business-analysis', signals: [/\b(business analys\w*|analisis bisnis|business requirements|kebutuhan bisnis)\b/, /\b(requirements elicitation|root cause|akar masalah|process mapping|analisis kebutuhan)\b/], guide: 'Validasi masalah, tetapkan indikator dan hubungkan insight dengan tindakan yang dapat diuji.' },
  { domain: 'finance', signals: [/\b(credit analys\w*|analisis kredit|financial analys\w*|analisis keuangan)\b/, /\b(arus kas|cash flow|financial statement|laporan keuangan|npv|irr|valuation|valuasi|kemampuan bayar)\b/], guide: 'Jelaskan asumsi, arus kas, sensitivitas dan ukuran kelayakan yang relevan.' },
  { domain: 'governance', signals: [/\b(compliance|kepatuhan|governance|tata kelola|internal control|pengendalian internal)\b/, /\b(segregation of duties|audit trail|temuan audit|pelindungan konsumen|perlindungan konsumen)\b/], guide: 'Pisahkan kewajiban yang diketahui dari asumsi, lalu jelaskan kontrol, tanggung jawab dan bukti pelaksanaan.' },
  { domain: 'strategy', signals: [/\b(strategy analys\w*|business strategy|strategi bisnis|analisis strategi|competitive strategy)\b/, /\b(ekspansi pasar|market entry|competitive advantage|keunggulan bersaing|scenario planning)\b/], guide: 'Bandingkan opsi dengan kriteria keputusan, trade-off dan asumsi yang jelas.' },
  { domain: 'operations', signals: [/\b(operations management|manajemen operasional|operational efficiency|efisiensi operasional)\b/, /\b(kapasitas|throughput|bottleneck|lead time|supply chain|rantai pasok|inventori|inventory)\b/], guide: 'Ukur hambatan proses, tetapkan perbaikan dan pantau dampaknya pada mutu atau waktu.' },
  { domain: 'project-management', signals: [/\b(project manag\w*|manajemen proyek|project delivery|jadwal proyek)\b/, /\b(critical path|jalur kritis|project scope|ruang lingkup proyek|milestone|sprint planning)\b/], guide: 'Jelaskan cakupan, dependensi, pemilik pekerjaan dan cara menangani perubahan.' },
  { domain: 'digital-transformation', signals: [/\b(digital transformation|transformasi digital|change management|manajemen perubahan)\b/, /\b(digital adoption|adopsi digital|modernisasi sistem|legacy migration)\b/], guide: 'Rencanakan perubahan bertahap, adopsi pengguna, integrasi dan ukuran hasil.' },
];

const clarification = /^(maksud saya|yang saya maksud|maksud(nya)? apa|apa maksud|boleh (jelaskan|ulang)|can you clarify|could you clarify|i mean|what do you mean)\b/;
const followUp = /\b(tindak lanjut|follow[ -]up|tadi|yang barusan|yang (anda|kamu) sebut|you (just )?(mentioned|said)|you (previously|earlier)|that approach|this approach|pendekatan itu|solusi itu|kode itu|risiko tersebut|pilihan tadi)\b/;
const dependentQuestion = /^(lalu|terus|kemudian|dan (bagaimana|apa|kenapa|mengapa)|kenapa begitu|mengapa begitu|why (so|that)|and (how|what|why)|how about|kalau (data|kasus|solusi|hasil)nya)\b/;
const topicChange = /^(ganti topik|pertanyaan (lain|berikutnya)|topik baru|next question|different topic|new question|switching topics)\b/;
const interrogative = /^(apa(kah)?|kenapa|mengapa|bagaimana|berapa|siapa|kapan|di mana|mana|what|why|how|when|who|where|which|would you|can you|could you|do you|is there|does)\b/;
const directive = /^(?:(?:tolong|please|silakan)\s+)?(jelaskan|ceritakan|bandingkan|analisis|uraikan|implementasikan|debug|tinjau|buat(?:kan)?|tulis(?:kan)?|describe|explain|tell me|compare|write|implement|review|design|analyze|show me|calculate|hitung)\b/;
const sourceUpdate = /^(?:mulai (sekarang|sesi)|gunakan (bahasa|format)|ubah (gaya|batas|format)|(?:always|please) (answer|respond) in|from now on)\b/;
const businessCase = /\b(studi kasus|case study|business case|skenario|scenario|anda ditugaskan|you are tasked|misalkan|suppose|bayangkan|imagine)\b/;
const technicalCue = /\b(kode|code|sql|query|javascript|typescript|react|laravel|excel|python|pandas|api|algorit\w*|program|implementation|statisti\w*|cross.validation|machine learning|backend|frontend|database|deployment|system design)\b/;
const languageMarkers = {
  id: /\b(apa|bagaimana|kenapa|mengapa|berapa|jelaskan|ceritakan|menurut|kalau|jika|dan|atau|yang|dengan|untuk|dari|adalah|anda|saya|kamu|ini|itu|tersebut|mana|dapat|lebih|cara|antara|ketika|misalnya|buat|peran)\b/g,
  en: /\b(what|why|how|when|where|explain|describe|would|could|should|who|which|you|your|we|this|that|these|and|the|with|does|do|is|was|are|of|for|using|from|instead|than|tell|write|give|implement)\b/g,
};

const frameworkGuides: Record<AnswerFramework, string> = {
  'star-l': 'Gunakan situasi, tugas, tindakan, hasil dan pembelajaran dari pengalaman yang didukung konteks.',
  'present-evidence-fit': 'Mulai dari minat atau kemampuan saat ini, hubungkan bukti relevan dengan kebutuhan peran.',
  prep: 'Nyatakan pendapat, alasan, contoh relevan dan penegasan singkat.',
  'risk-impact-control-mitigation': 'Urutkan risiko, dampak, kontrol saat ini dan mitigasi berikutnya.',
  'problem-user-priority-solution-metrics': 'Urutkan masalah, pengguna, prioritas, solusi dan metrik.',
  'problem-data-insight-recommendation': 'Urutkan masalah, data, insight dan rekomendasi.',
  'situation-options-tradeoff-recommendation': 'Bandingkan opsi dan trade-off sebelum merekomendasikan tindakan.',
  'concept-implementation-tradeoff': 'Jelaskan konsep inti, penerapan yang relevan dan trade-off.',
  'problem-analysis-solution': 'Rumuskan masalah, analisis penyebab atau kebutuhan, lalu beri solusi.',
  'acknowledge-position-reason-solution': 'Tanggapi posisi peserta yang tercatat, jelaskan posisi pengguna dan usulkan tindakan yang dapat disepakati.',
  'direct-evidence-link': 'Jawab inti pertanyaan, berikan bukti yang tersedia dan kaitkan dengan konteks secukupnya.',
};

const intentGuides: Partial<Record<QuestionIntent, string>> = {
  concept: 'Utamakan penjelasan, lalu sertakan artefak teknis hanya jika pertanyaan memerlukannya.',
  implementation: 'Pisahkan hasil teknis yang diminta dari penjelasan lisan. Gunakan nama berkas aktual jika tersedia.',
  debugging: 'Usulkan cara mereproduksi, mempersempit penyebab dan memverifikasi perbaikan dengan aman.',
  'code-review': 'Prioritaskan temuan konkret dan dampaknya dari potongan kode yang tersedia.',
  architecture: 'Sebutkan kebutuhan, batasan dan trade-off komponen utama.',
  optimization: 'Ukur masalah terlebih dahulu, lalu jelaskan perbaikan dan cara menguji dampaknya.',
  algorithm: 'Jelaskan pendekatan, kompleksitas dan kasus batas yang relevan.',
  sql: 'Tentukan grain, kunci join, penanganan NULL dan semantik agregasi yang relevan.',
  'statistical-reasoning': 'Jelaskan asumsi, pemilihan metode dan interpretasi hasil atau ketidakpastian.',
  'data-case-study': 'Tetapkan keputusan bisnis, definisi metrik, segmentasi dan langkah validasi.',
};

function clean(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim();
}

function languageOf(text: string): QuestionLanguage {
  const id = (text.match(languageMarkers.id) ?? []).length;
  const en = (text.match(languageMarkers.en) ?? []).length;
  if (!id && !en) return 'unknown';
  if (Math.min(id, en) >= 2 && Math.min(id, en) / Math.max(id, en) >= 0.4) return 'mixed';
  return id >= en ? 'id' : 'en';
}

function classifyRelationship(text: string): QuestionRelationship {
  if (!text) return 'UNKNOWN';
  if (sourceUpdate.test(text)) return 'INSTRUCTION';
  if (/\b(um|uh|eh|anu)\b/.test(text) && text.split(/\s+/).length <= 3) return 'INCOMPLETE';
  if (/(?:\.{3}|…|\s[-–—])\s*$/.test(text) || /^(apa|bagaimana|kenapa|mengapa|what|why|how|jelaskan|explain|trus|lalu)\s*\??$/.test(text)) return 'INCOMPLETE';
  if (topicChange.test(text)) return 'MAIN_QUESTION';
  if (clarification.test(text)) return 'CLARIFICATION';
  if (followUp.test(text) || dependentQuestion.test(text)) return 'FOLLOW_UP';
  return text.endsWith('?') || interrogative.test(text) || directive.test(text) || businessCase.test(text)
    ? 'MAIN_QUESTION' : 'UNKNOWN';
}

function previousQuestion(text: string, relationship: QuestionRelationship, turns: TurnLite[]) {
  if (relationship !== 'FOLLOW_UP' && relationship !== 'CLARIFICATION') return undefined;
  const keywords = extractKeywords(text, 14).filter((term) => !['tadi', 'sebelumnya', 'mentioned', 'earlier', 'previous', 'sebut', 'pendekatan', 'explain', 'jelaskan'].includes(term));
  const questions = turns.filter((turn) => {
    if (turn.speaker === 'aura' || turn.speaker === 'self') return false;
    const kind = classifyRelationship(clean(turn.text.slice(0, 900)));
    return kind === 'MAIN_QUESTION' || kind === 'FOLLOW_UP' || kind === 'CLARIFICATION';
  });
  const scores = questions.map((turn) => ({ turn, ...jaccard(keywords, extractKeywords(turn.text, 16)) }));
  const nearest = questions[0];
  const contextual = scores.filter((candidate) => candidate.shared >= 2 || (candidate.shared === 1 && candidate.score >= 0.17))
    .sort((a, b) => b.score - a.score || b.turn.seq - a.turn.seq)[0]?.turn;
  if (contextual) return contextual;
  if (!nearest || (turns[0]?.seq ?? nearest.seq) - nearest.seq > 3) return undefined;
  const referencesSpecificTopic = keywords.length >= 3 && /\b(tadi|sebelumnya|earlier|previously|mentioned)\b/.test(text);
  return referencesSpecificTopic ? undefined : nearest;
}

function countSignals(text: string, signals: readonly RegExp[]): number {
  return signals.reduce((count, pattern) => count + Number(pattern.test(text)), 0);
}

function detectDomain(text: string, context: string, parent: TurnLite | undefined): ProfessionalDomain {
  if (!text) return 'general';
  const parentText = clean(parent?.text.slice(0, 900) ?? '');
  const ranked = domainPacks.map((pack) => ({
    domain: pack.domain,
    score: 16 * countSignals(text, pack.signals) + 3 * countSignals(parentText, pack.signals) + countSignals(context, pack.signals),
  })).sort((a, b) => b.score - a.score);
  return ranked[0].score > 0 ? ranked[0].domain : 'general';
}

function intentOf(text: string, relationship: QuestionRelationship, domain: ProfessionalDomain, parent: TurnLite | undefined): QuestionIntent {
  const technical = technicalCue.test(text) || ['web-development', 'data-analysis', 'data-science', 'digital-transformation'].includes(domain);
  const explicitExperience = /\b(ceritakan (tentang )?(saat|pengalaman|contoh)|pernahkah|apa pengalaman|tell me about a (time|situation)|have you ever|your (past |previous )?experience|contoh pengalaman)\b/;
  if (explicitExperience.test(text)) return 'behavioral';
  if (/\b(mengapa melamar|kenapa (melamar|tertarik)|mengapa (tertarik|kami harus memilih)|motivasi (anda|kamu|melamar)|why (this (role|job|company)|do you want|should we hire)|why are you interested)\b/.test(text)) return 'motivation';
  if (technical) {
    if (/\b(code review|tinjau kode|review (the |this )?code|review kode|temukan (bug|masalah) dalam kode)\b/.test(text)) return 'code-review';
    if (/\b(debug\w*|error|exception|gagal|crash|bug|doesn.t work|not working)\b/.test(text)) return 'debugging';
    if (/\b(optim\w*|lambat|slow|performa|performance|latency|latensi)\b/.test(text)) return 'optimization';
    if (/\b(arsitektur|architecture|system design|rancang (sistem|arsitektur)|design a (system|service|distributed))\b/.test(text)) return 'architecture';
    if (/\b(kompleksitas|complexity|algorit\w*|big o)\b/.test(text)) return 'algorithm';
    if (/\b(sql|join|query)\b/.test(text) && !/^(apa( itu|kah)?|what (is|are))\b/.test(text)) return 'sql';
    if (/\b(p.value|hypothesis|hipotesis|interval kepercayaan|confidence interval|probabil\w*|significant|statistically|uji statist\w*)\b/.test(text)) return 'statistical-reasoning';
    if (/\b(implement\w*|tulis|write|buat(?:kan)? kode|integrasikan|tambahkan)\b/.test(text)) return 'implementation';
    if (businessCase.test(text)) return domain === 'data-analysis' || domain === 'data-science' ? 'data-case-study' : 'case-study';
    if (parent && (relationship === 'FOLLOW_UP' || relationship === 'CLARIFICATION')) return 'technical-follow-up';
    return 'concept';
  }
  if (businessCase.test(text)) return 'case-study';
  if (/\b(pendapat (anda|kamu)|menurut (anda|kamu)|what do you think|what is your opinion|do you agree|setujukah)\b/.test(text)) return 'opinion';
  return 'general';
}

function chooseFramework(analysis: Pick<QuestionAnalysis, 'relationship' | 'domain' | 'intent'>, activity?: ActivityType, stage?: SessionStage): AnswerFramework {
  if (activity === 'rgd' && (stage === 'discussion' || stage === undefined)) return 'acknowledge-position-reason-solution';
  if (analysis.relationship === 'FOLLOW_UP' || analysis.relationship === 'CLARIFICATION') return 'direct-evidence-link';
  switch (analysis.intent) {
    case 'behavioral': return 'star-l';
    case 'motivation': return 'present-evidence-fit';
    case 'opinion': return 'prep';
  }
  switch (analysis.domain) {
    case 'risk': return 'risk-impact-control-mitigation';
    case 'product': return 'problem-user-priority-solution-metrics';
    case 'data-analysis':
      return analysis.intent === 'sql' || analysis.intent === 'concept' ? 'concept-implementation-tradeoff' : 'problem-data-insight-recommendation';
    case 'business-analysis': return 'problem-data-insight-recommendation';
    case 'strategy': return 'situation-options-tradeoff-recommendation';
    case 'data-science':
    case 'web-development':
    case 'digital-transformation':
      return analysis.intent === 'case-study' ? 'problem-analysis-solution' : 'concept-implementation-tradeoff';
  }
  return analysis.intent === 'case-study' ? 'problem-analysis-solution' : 'direct-evidence-link';
}

const competencyRules: readonly [Competency, RegExp][] = [
  ['integrity', /\b(integritas|integrity|etik\w*|ethic\w*|konflik kepentingan|conflict of interest)\b/],
  ['leadership', /\b(memimpin|kepemimpinan|leadership|led a team|lead a team|memotivasi tim)\b/],
  ['stakeholder-management', /\b(stakeholder\w*|pemangku kepentingan|konflik antar|cross.functional|negosiasi)\b/],
  ['decision-making', /\b(pengambilan keputusan|decision.making|memutuskan|how would you decide)\b/],
  ['communication', /\b(komunikasi|communication|menjelaskan kepada|explain to a non.technical)\b/],
];

function competencyOf(text: string, intent: QuestionIntent, domain: ProfessionalDomain): Competency | null {
  const explicit = competencyRules.find(([, pattern]) => pattern.test(text));
  if (explicit) return explicit[0];
  if (domain === 'risk' || domain === 'governance') return 'risk-awareness';
  if (domain === 'strategy' || domain === 'product') return 'strategic-thinking';
  if (intent === 'statistical-reasoning' || intent === 'data-case-study' || domain === 'business-analysis') return 'analytical-thinking';
  if (intent === 'debugging' || intent === 'case-study') return 'problem-solving';
  return technicalCue.test(text) || ['web-development', 'data-analysis', 'data-science', 'digital-transformation'].includes(domain)
    ? 'technical-competence' : null;
}

export function classifyQuestion(input: QuestionInputs): QuestionAnalysis {
  const text = clean(input.text.slice(0, 3_000));
  const relationship = classifyRelationship(text);
  const turns = [...new Map([...(input.relevantHistory?.slice(0, 8) ?? []), ...(input.recentTurns?.slice(-8) ?? [])]
    .map((turn) => [turn.id, turn])).values()].sort((a, b) => b.seq - a.seq);
  const parent = previousQuestion(text, relationship, turns);
  const inheritedLanguage = parent ? languageOf(clean(parent.text.slice(0, 500))) : 'unknown';
  const language = languageOf(text);
  const context = [input.job?.role.slice(0, 200), input.job?.description.slice(0, 750),
    ...(input.knowledge?.slice(0, 3).map((snippet) => snippet.slice(0, 350)) ?? [])].filter(Boolean).join(' ');
  const domain = relationship === 'UNKNOWN' && input.hasImage ? 'general' : detectDomain(text, clean(context), parent);
  const intent = intentOf(text, relationship, domain, parent);
  const previousAnswer = parent && turns.find((turn) => turn.speaker === 'aura' && (turn.seq === parent.seq + 1
    || (turn.seq === parent.seq + 2 && turns.some((candidate) => candidate.seq === parent.seq + 1 && candidate.speaker === 'aura'))));
  return {
    domain, intent, relationship, framework: chooseFramework({ domain, intent, relationship }, input.activity, input.stage),
    language: language === 'unknown' ? inheritedLanguage : language, competency: competencyOf(text, intent, domain),
    parentQuestionId: parent?.id ?? null, parentQuestionSeq: parent?.seq ?? null, previousAnswerId: previousAnswer?.id ?? null,
  };
}

/** Only locally selected rules and sequence numbers are inserted into the system prompt. */
export function questionGuidance(question: QuestionAnalysis): string {
  if (question.relationship === 'UNKNOWN') return '';
  if (question.relationship === 'INCOMPLETE') return 'Jika pertanyaan belum lengkap, minta potongan yang belum jelas. Jangan menebak isinya.';
  if (question.relationship === 'INSTRUCTION') return 'Ikuti instruksi pengguna yang konsisten dengan batas sesi dan preferensi aktif.';
  const { domain, framework, intent, competency, parentQuestionSeq, relationship, language } = question;
  const link = parentQuestionSeq === null
    ? (relationship === 'FOLLOW_UP' || relationship === 'CLARIFICATION' ? 'Minta referensi jika pertanyaan lanjutan belum jelas.' : '')
    : `Pertanyaan ini merujuk giliran #${parentQuestionSeq}. Fokus pada tambahan yang diminta tanpa mengulang jawaban lama.`;
  const languageGuide = language === 'en' ? 'Bila pengguna belum menentukan bahasa, jawab dalam bahasa Inggris.'
    : language === 'mixed' ? 'Pertahankan istilah teknis asli dan gunakan bahasa utama pertanyaan secara natural.'
    : language === 'id' ? 'Bila pengguna belum menentukan bahasa, jawab dalam bahasa Indonesia.' : '';
  return [
    'Panduan struktur sementara. Dahulukan preferensi pengguna dan konteks sesi. Jangan sebutkan nama kerangka dalam jawaban.',
    frameworkGuides[framework], intentGuides[intent], domainPacks.find((pack) => pack.domain === domain)?.guide,
    link, languageGuide, competency ? `Kompetensi yang mungkin dinilai: ${competency.replaceAll('-', ' ')}.` : '',
  ].filter(Boolean).join(' ');
}
