const STOPWORDS = new Set(
  `yang dan di ke dari ini itu untuk dengan pada adalah atau juga dalam akan tidak bisa ada karena oleh sebagai
  saya kamu anda kami kita mereka dia ia aku nya lah kah pun para sebuah seorang suatu lebih sangat sudah belum telah
  agar supaya sehingga namun tetapi tapi jika kalau bila maka serta bahwa apa siapa mengapa kenapa bagaimana kapan
  dimana mana sini sana situ hal cara jadi sedang masih hanya saja semua setiap banyak sedikit beberapa tersebut
  menurut terhadap antara tentang seperti hingga sampai sejak selama setelah sebelum ketika saat kami harus perlu
  mau ingin boleh dapat bagi buat buatkan tolong mohon silakan jawab jawaban pertanyaan tanggapi tanggapan berikan
  buat the a an of to in on for and or is are be with as by this that it at from you your we our they please answer`
    .split(/\s+/)
    .filter(Boolean),
);

export function tokenizeWords(text: string): string[] {
  return (text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w),
  );
}

/** Top keywords by frequency (ties keep first-seen order). */
export function extractKeywords(text: string, max = 8): string[] {
  const freq = new Map<string, number>();
  for (const w of tokenizeWords(text)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

/** FTS5 MATCH expression: OR of quoted prefix terms. Safe against syntax injection. */
export function buildFtsQuery(keywords: string[]): string | null {
  const terms = keywords.map((k) => k.replace(/["*^:(){}]/g, '').trim()).filter((k) => k.length >= 3);
  if (!terms.length) return null;
  return terms.map((k) => `"${k}"*`).join(' OR ');
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): { score: number; shared: number } {
  const A = new Set(a);
  const B = new Set(b);
  let shared = 0;
  for (const x of A) if (B.has(x)) shared += 1;
  const union = A.size + B.size - shared;
  return { score: union ? shared / union : 0, shared };
}
