/**
 * Playground name normalization — mirrors the server-side logic described in CLAUDE.md.
 *
 * Steps:
 *  1. Trim whitespace, lowercase, NFKC normalize.
 *  2. Split into words, remove generic words.
 *  3. Rejoin and trim.
 *  4. If the result is empty → caller should reject with an error.
 */

const GENERIC_WORDS = new Set([
  // English
  'park', 'garden', 'playground', 'square', 'sq', 'the',
  // Hebrew
  'גן', 'גינה', 'פארק',
]);

export function normalizePlaygroundName(input: string): string {
  const s = input.normalize('NFKC').toLowerCase().trim();
  const words = s.split(/\s+/).filter((w) => w.length > 0 && !GENERIC_WORDS.has(w));
  return words.join(' ');
}
