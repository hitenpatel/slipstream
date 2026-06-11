import type { PaletteItem } from "./palette-types";

/**
 * Substring scorer with a couple of cheap heuristics:
 *
 *   - Empty query keeps the original order (commands before issues), so the
 *     palette is also a "what can I do here?" surface.
 *   - Exact substring at the start of a word scores higher than mid-word.
 *   - Commands win ties to keep them discoverable.
 *
 * Returns a *new* array sorted by score descending; never mutates input.
 */
export function scoreItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  type Scored = { item: PaletteItem; score: number; order: number };
  const out: Scored[] = [];

  items.forEach((item, order) => {
    const haystack = item.label.toLowerCase();
    const idx = haystack.indexOf(q);
    if (idx === -1) {
      // tokenise the query and require every token to appear (in any order)
      const tokens = q.split(/\s+/).filter(Boolean);
      if (tokens.length > 1 && tokens.every((t) => haystack.includes(t))) {
        out.push({ item, score: 0.5, order });
      }
      return;
    }
    // base score: shorter matches (relative to haystack length) rank higher
    let score = 1 - (haystack.length - q.length) / Math.max(haystack.length, 1);
    // start of string is the strongest possible signal
    if (idx === 0) score += 2;
    // start of a word
    else if (idx > 0 && /\s|\W/.test(haystack[idx - 1] ?? "")) score += 1;
    // commands get a small tie-break bonus
    if (item.kind === "command") score += 0.1;
    out.push({ item, score, order });
  });

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.order - b.order;
  });

  return out.map((s) => s.item);
}
