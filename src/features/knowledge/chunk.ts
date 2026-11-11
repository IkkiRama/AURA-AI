/** Splits a document into overlapping chunks on paragraph/sentence boundaries. */
export function chunkText(text: string, maxChars = 800, overlap = 120): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      pieces.push(p);
      continue;
    }
    let buf = '';
    for (const s of p.split(/(?<=[.!?])\s+/)) {
      if ((buf + ' ' + s).trim().length > maxChars && buf) {
        pieces.push(buf.trim());
        buf = '';
      }
      if (s.length > maxChars) {
        for (let i = 0; i < s.length; i += maxChars) pieces.push(s.slice(i, i + maxChars));
      } else {
        buf = `${buf} ${s}`;
      }
    }
    if (buf.trim()) pieces.push(buf.trim());
  }
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if ((current + '\n\n' + piece).length > maxChars && current) {
      chunks.push(current);
      const tail = current.slice(-overlap);
      const cut = tail.indexOf(' ');
      current = (cut >= 0 ? tail.slice(cut + 1) : tail) + '\n\n' + piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown'];
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export function isSupportedTextFile(name: string, size: number): string | null {
  const lower = name.toLowerCase();
  if (!TEXT_EXTENSIONS.some((e) => lower.endsWith(e))) {
    return 'Format belum didukung. Gunakan .txt atau .md (PDF/DOCX direncanakan di Fase 2).';
  }
  if (size > MAX_TEXT_BYTES) return 'File terlalu besar (maksimal 2 MB).';
  return null;
}
