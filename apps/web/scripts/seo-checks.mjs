// Pure SEO checks shared by the unit test (app/seo.test.ts) and the
// post-build guard (scripts/seo-guard.mjs). No I/O in here.

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;
export const HOME_CANONICAL = "https://tracker.hiten.dev/";

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "\x27",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

/** Decode HTML entities so lengths are measured on what a searcher sees. */
export function decodeEntities(input) {
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|\x27([^\x27]*)\x27)/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Pull the head values the guard cares about out of rendered HTML. */
export function extractSnippet(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const meta = (key, value) =>
    metas.find((a) => a[key] === value)?.content;
  const canonicals = links.filter((a) => (a.rel ?? "").toLowerCase() === "canonical");
  return {
    title: titleMatch ? decodeEntities(titleMatch[1]).trim() : undefined,
    description: meta("name", "description"),
    canonicals: canonicals.map((a) => a.href),
    ogTitle: meta("property", "og:title"),
    ogDescription: meta("property", "og:description"),
    twitterTitle: meta("name", "twitter:title"),
    twitterDescription: meta("name", "twitter:description"),
  };
}

/** Returns a list of human-readable violations; empty means pass. */
export function checkSnippet(snippet) {
  const v = [];
  const { title, description, canonicals } = snippet;
  if (!title) v.push("missing <title>");
  else if (title.length > TITLE_MAX) v.push(`title is ${title.length} characters (max ${TITLE_MAX}): ${title}`);
  if (!description) v.push("missing meta description");
  else if (description.length > DESCRIPTION_MAX)
    v.push(`description is ${description.length} characters (max ${DESCRIPTION_MAX}): ${description}`);
  if (canonicals.length !== 1) v.push(`expected exactly one canonical link, found ${canonicals.length}`);
  else if (canonicals[0] !== HOME_CANONICAL)
    v.push(`canonical is ${canonicals[0]}, expected ${HOME_CANONICAL}`);
  const mirrors = [
    ["og:title", snippet.ogTitle, title],
    ["twitter:title", snippet.twitterTitle, title],
    ["og:description", snippet.ogDescription, description],
    ["twitter:description", snippet.twitterDescription, description],
  ];
  for (const [name, value, expected] of mirrors) {
    if (value !== undefined && value !== expected) v.push(`${name} differs from the page ${name.split(":")[1]}: ${value}`);
  }
  return v;
}

/** Every sitemap URL must be listed in llms.txt. */
export function checkSitemapCoverage(sitemapUrls, llmsText) {
  if (sitemapUrls.length === 0) return ["sitemap lists no URLs"];
  return sitemapUrls
    .filter((url) => !llmsText.includes(url))
    .map((url) => `sitemap URL missing from llms.txt: ${url}`);
}

/** Extract <loc> values from rendered sitemap.xml. */
export function sitemapLocs(xml) {
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((m) => decodeEntities(m[1]).trim());
}
