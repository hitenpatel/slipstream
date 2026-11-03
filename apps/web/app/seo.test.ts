import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  checkSitemapCoverage,
  checkSnippet,
  decodeEntities,
  extractSnippet,
  HOME_CANONICAL,
} from "../scripts/seo-checks.mjs";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "mock-font" });
  return { Fraunces: font, Inter: font, Space_Mono: font, JetBrains_Mono: font };
});

vi.mock("@/lib/session", () => ({ getMe: async () => null }));

const { metadata } = await import("./layout");
const { default: HomePage } = await import("./page");
const { default: sitemap } = await import("./sitemap");

const llms = readFileSync(join(__dirname, "..", "public", "llms.txt"), "utf8");

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

describe("home page metadata export", () => {
  const title = str(metadata.title);
  const description = str(metadata.description);

  it("keeps the title within 60 characters", () => {
    expect(title.length).toBeGreaterThan(0);
    expect(decodeEntities(title).length).toBeLessThanOrEqual(60);
  });

  it("keeps the description within 160 characters", () => {
    expect(description.length).toBeGreaterThan(0);
    expect(decodeEntities(description).length).toBeLessThanOrEqual(160);
  });

  it("keeps og and twitter title and description in sync", () => {
    const og = metadata.openGraph as { title?: string; description?: string } | null | undefined;
    const tw = metadata.twitter as { title?: string; description?: string } | null | undefined;
    expect(og?.title).toBe(title);
    expect(og?.description).toBe(description);
    expect(tw?.title).toBe(title);
    expect(tw?.description).toBe(description);
  });
});

describe("home page canonical", () => {
  it("renders exactly one absolute self-canonical", async () => {
    const html = renderToStaticMarkup(await HomePage());
    const links = [...html.matchAll(/<link[^>]*rel="canonical"[^>]*>/g)];
    expect(links).toHaveLength(1);
    expect(links[0]?.[0]).toContain(`href="${HOME_CANONICAL}"`);
  });
});

describe("sitemap and llms.txt", () => {
  it("lists every sitemap URL in llms.txt", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain(HOME_CANONICAL);
    expect(checkSitemapCoverage(urls, llms)).toEqual([]);
  });
});

describe("guard checks", () => {
  const good = (over = "") => `<html><head><title>Short title</title>
    <meta name="description" content="Short &amp; sweet"/>
    <link rel="canonical" href="${HOME_CANONICAL}"/>${over}</head></html>`;

  it("passes a compliant page", () => {
    expect(checkSnippet(extractSnippet(good()))).toEqual([]);
  });

  it("decodes entities before measuring", () => {
    const desc = "&amp;".repeat(160);
    const html = good().replace("Short &amp; sweet", desc);
    expect(checkSnippet(extractSnippet(html))).toEqual([]);
  });

  it("flags a long title and description", () => {
    const html = good()
      .replace("Short title", "t".repeat(61))
      .replace("Short &amp; sweet", "d".repeat(161));
    const v = checkSnippet(extractSnippet(html));
    expect(v.some((m) => m.startsWith("title is 61"))).toBe(true);
    expect(v.some((m) => m.startsWith("description is 161"))).toBe(true);
  });

  it("flags a missing, relative or wrong canonical", () => {
    expect(checkSnippet(extractSnippet(good().replace(/<link[^>]*>/, "")))).toHaveLength(1);
    expect(checkSnippet(extractSnippet(good().replace(HOME_CANONICAL, "/")))[0]).toMatch(/canonical is \//);
  });

  it("flags og values that drift from the page values", () => {
    const html = good(`<meta property="og:title" content="Other"/>`);
    expect(checkSnippet(extractSnippet(html))[0]).toMatch(/og:title differs/);
  });

  it("flags sitemap URLs absent from llms.txt and an empty sitemap", () => {
    expect(checkSitemapCoverage(["https://x.test/a"], "nothing")).toHaveLength(1);
    expect(checkSitemapCoverage([], "nothing")).toHaveLength(1);
  });
});
