// Fractional indexing. Reordering an issue is a single field change with no
// cascade: pick a key strictly between its new neighbours. The key is a string
// with a base-62 alphabet so it lex-sorts identically to its numeric value.
//
// The algorithm: treat both bounds as base-62 fractions in (0, 1), pick the
// shortest string lexically between them. If the bounds collide for too long
// we extend with a midpoint digit. This is enough for arbitrary reordering.

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = ALPHABET.length;

function indexOf(ch: string): number {
  const i = ALPHABET.indexOf(ch);
  if (i < 0) throw new Error(`fractional: bad digit ${ch}`);
  return i;
}

function digit(i: number): string {
  const ch = ALPHABET[i];
  if (ch === undefined) throw new Error(`fractional: digit ${i} out of range`);
  return ch;
}

/**
 * Return a key strictly between `before` and `after`. Either bound may be `null`
 * to mean "no bound" (start or end of the list). The returned key always lex-sorts
 * between the two.
 */
export function between(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new Error(`fractional: bounds out of order (${before} >= ${after})`);
  }

  const a = before ?? "";
  const b = after ?? "";

  let prefix = "";
  let i = 0;
  // Walk shared prefix.
  while (true) {
    const ai = i < a.length ? indexOf(a[i] as string) : 0;
    const bi = i < b.length ? indexOf(b[i] as string) : BASE;

    if (ai === bi) {
      prefix += digit(ai);
      i++;
      continue;
    }

    if (bi - ai > 1) {
      // There's room for one digit between them.
      return prefix + digit(Math.floor((ai + bi) / 2));
    }

    // Adjacent digits — keep the lower bound's digit and recurse one level deeper.
    prefix += digit(ai);
    // Move past `a`'s consumed digit so we look for room in the next position.
    i++;
    // From here on, lower bound's remaining digits matter; upper bound is "fully consumed",
    // so the new upper bound is "no bound".
    const aRest = i < a.length ? a.slice(i) : "";
    return prefix + extendAbove(aRest);
  }
}

function extendAbove(rest: string): string {
  // Pick a digit strictly above all of `rest`. If `rest` doesn't max out, we can
  // append a halfway-between digit; otherwise we have to descend one more level.
  let out = "";
  for (let i = 0; i < rest.length; i++) {
    const d = indexOf(rest[i] as string);
    if (d < BASE - 1) {
      out += digit(Math.floor((d + BASE) / 2));
      return out;
    }
    out += digit(d);
  }
  // `rest` is all max digits — pick the midpoint of (0, BASE).
  return out + digit(Math.floor(BASE / 2));
}
