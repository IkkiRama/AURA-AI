/** Approximate token count for budgeting (≈3.8 chars/token for ID/EN text). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

/** Cut text to approximately `tokens` tokens on a word boundary. */
export function truncateToTokens(text: string, tokens: number): string {
  const maxChars = Math.floor(tokens * 3.8);
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}
