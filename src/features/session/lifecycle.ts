/**
 * Session lifecycle (SESSION_LIFECYCLE.md). `session_stage` is independent of
 * `activity_type`. Automatic detection may only SUGGEST a stage; transitions
 * are always an explicit user action.
 */
export type SessionStage = 'standby' | 'briefing' | 'case_analysis' | 'discussion' | 'end';

export const STAGES: SessionStage[] = ['standby', 'briefing', 'case_analysis', 'discussion', 'end'];

export const STAGE_LABEL: Record<SessionStage, string> = {
  standby: 'Standby',
  briefing: 'Briefing',
  case_analysis: 'Case Analysis',
  discussion: 'Discussion',
  end: 'End',
};

export const STAGE_INFO: Record<SessionStage, string> = {
  standby: 'API OFF, mic OFF, capture OFF. Pilih profil, model, dan siapkan prompt tanpa biaya.',
  briefing: 'Moderator menjelaskan aturan. AURA hanya memproses input yang kamu kirim secara manual.',
  case_analysis: 'Soal tersedia. Tempel screenshot (Ctrl+V) bila aturan sesi mengizinkan.',
  discussion: 'Diskusi berlangsung. Tambahkan giliran/transkrip secara manual; memori diperbarui.',
  end: 'Sesi selesai. Semua permintaan dibatalkan; tidak ada pemrosesan lanjutan.',
};

export function canTransition(from: SessionStage, to: SessionStage): boolean {
  if (from === to) return false;
  if (from === 'end') return false; // start a new session instead
  return true; // manual corrections (e.g. back to briefing) are allowed
}

export function apiAllowed(stage: SessionStage, paused: boolean): { allowed: boolean; reason?: string } {
  if (stage === 'standby') {
    return {
      allowed: false,
      reason: 'Sesi masih Standby — API OFF. Pindah ke Briefing, Case Analysis, atau Discussion untuk mengizinkan pemanggilan API.',
    };
  }
  if (stage === 'end') return { allowed: false, reason: 'Sesi sudah berakhir. Mulai sesi baru.' };
  if (paused) return { allowed: false, reason: 'Sesi sedang di-pause. Lanjutkan sesi untuk mengirim.' };
  return { allowed: true };
}

/** Removes quoted examples and "kalau saya bilang ..." clauses before matching. */
export function stripQuotedExamples(text: string): string {
  return text
    .replace(/"[^"]*"/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/«[^»]*»/g, ' ')
    .replace(/\b(kalau|jika|apabila|ketika|nanti|begitu)\s+(saya|moderator|kami)\s+(bilang|mengatakan|menyebut|mengucapkan|menyampaikan)\b[^.!?\n]*/gi, ' ')
    .replace(/\b(contoh(nya)?|misal(nya)?|seperti kalimat)\b[^.!?\n]*/gi, ' ');
}

const PATTERNS: [SessionStage, RegExp, string][] = [
  ['end', /\b(waktu (sudah )?(habis|selesai)|diskusi (selesai|berakhir|ditutup|kita tutup)|sesi (ini )?(selesai|berakhir|ditutup)|terima kasih atas partisipasi)/i, 'Penutupan sesi'],
  ['discussion', /\b(diskusi (resmi )?(dimulai|kita mulai|silakan dimulai|bisa dimulai)|silakan (mulai )?(berdiskusi|diskusi)|waktu diskusi (dimulai|mulai)|mari (kita )?mulai (diskusi|berdiskusi)|dipersilakan (untuk )?berdiskusi)/i, 'Moderator membuka diskusi'],
  ['case_analysis', /\b(silakan (baca|pelajari|analisis|cermati) (kasus|soal|studi kasus)|waktu (membaca|analisis|untuk membaca)|studi kasus (berikut|ini|sudah)|soal (berikut|sudah) (ditampilkan|dibagikan))/i, 'Soal/kasus dibagikan'],
  ['briefing', /\b(sebelum (kita )?mulai|(saya|kami) (akan )?(jelaskan|bacakan|sampaikan) (aturan|tata tertib|mekanisme)|aturan(nya)? (diskusi|main|sesi)|tata tertib|mekanisme (diskusi|sesi))/i, 'Moderator menjelaskan aturan'],
];

export function suggestStage(text: string, current: SessionStage): { stage: SessionStage; reason: string } | null {
  if (!text.trim() || current === 'end') return null;
  const clean = stripQuotedExamples(text);
  for (const [stage, re, reason] of PATTERNS) {
    if (re.test(clean)) return stage === current ? null : { stage, reason };
  }
  return null;
}
