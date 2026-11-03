// Post-build SEO guard. Starts the built standalone server, fetches the
// rendered home page and sitemap.xml, and exits non-zero on any violation.
// Run by `pnpm build` (so CI and the Docker build both block on it) or
// directly with `pnpm test:seo` after a build.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSitemapCoverage, checkSnippet, extractSnippet, sitemapLocs } from "./seo-checks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, ".next", "standalone", "apps", "web", "server.js");
if (!existsSync(server)) {
  console.error(`seo-guard: ${server} not found, run the build first`);
  process.exit(2);
}

const port = String(30000 + Math.floor(Math.random() * 20000));
const child = spawn(process.execPath, [server], {
  cwd: dirname(server),
  env: { ...process.env, PORT: port, HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
  stdio: ["ignore", "inherit", "inherit"],
});

const base = `http://127.0.0.1:${port}`;
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/`, { redirect: "manual" });
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not become ready within 30s");
}

let violations = [];
try {
  await waitUp();
  const html = await (await fetch(`${base}/`)).text();
  const sitemapXml = await (await fetch(`${base}/sitemap.xml`)).text();
  const llms = readFileSync(join(root, "public", "llms.txt"), "utf8");
  const snippet = extractSnippet(html);
  violations = [
    ...checkSnippet(snippet),
    ...checkSitemapCoverage(sitemapLocs(sitemapXml), llms),
  ];
  console.log(
    `seo-guard: title=${snippet.title?.length} description=${snippet.description?.length} canonical=${snippet.canonicals.join(",")}`,
  );
} catch (err) {
  violations.push(String(err));
} finally {
  child.kill("SIGTERM");
}

if (violations.length > 0) {
  console.error("seo-guard FAILED:");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log("seo-guard: ok");
