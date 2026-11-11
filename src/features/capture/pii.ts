export interface PiiFinding {
  kind: 'email' | 'telepon' | 'nik' | 'npwp' | 'kartu';
  sample: string;
}

const mask = (s: string) => (s.length <= 4 ? '****' : `${s.slice(0, 2)}***${s.slice(-2)}`);

/**
 * Local PII warning before text is sent to a cloud provider. Image content
 * cannot be checked locally — the UI tells the user to review screenshots.
 */
export function detectPii(text: string): PiiFinding[] {
  const found: PiiFinding[] = [];
  const add = (kind: PiiFinding['kind'], m: string) => found.push({ kind, sample: mask(m) });
  for (const m of text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []) add('email', m);
  for (const m of text.match(/\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/g) ?? []) add('npwp', m);
  for (const m of text.match(/\b\d{16}\b/g) ?? []) add('nik', m);
  for (const m of text.match(/\b(?:\d{4}[ -]){3}\d{4}\b/g) ?? []) add('kartu', m);
  for (const m of text.match(/(?:\+62|\b62|\b0)8\d{1,3}[- ]?\d{3,4}[- ]?\d{3,5}\b/g) ?? []) add('telepon', m);
  return found;
}
