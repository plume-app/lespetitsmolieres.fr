#!/usr/bin/env node
/**
 * scrape.js — Mirror a Framer site to ./dist for static hosting on GitHub Pages.
 *
 * What it does:
 *  1. Crawls all pages of the Framer site starting from the root URL
 *  2. For each page: scrolls to the bottom to trigger lazy-loaded content
 *  3. Intercepts every asset request (JS, CSS, fonts, images, …)
 *  4. Downloads Framer-hosted assets into dist/assets/<hash-basename>
 *  5. Rewrites absolute framer/framerusercontent URLs to depth-correct relative paths
 *  6. Writes each page to dist/<path>/index.html
 *
 * Usage:
 *   node scripts/scrape.js [URL]
 *   FRAMER_URL=https://… node scripts/scrape.js
 */

import puppeteer from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

// ── Config ────────────────────────────────────────────────────────────────────
const FRAMER_URL =
  process.argv[2] ||
  process.env.FRAMER_URL ||
  "https://breezy-founders-904817.framer.app/";

const BASE_ORIGIN = new URL(FRAMER_URL).origin;
const DIST_DIR = path.resolve("dist");
const ASSETS_DIR = path.join(DIST_DIR, "assets");

// Domains whose assets we want to download locally.
const DOWNLOAD_DOMAINS = [
  "framerusercontent.com",
  "assets.framer.com",
];

// Request types to download
const DOWNLOAD_RESOURCE_TYPES = new Set([
  "stylesheet",
  "image",
  "font",
  "media",
  "script",
  "fetch",
  "xhr",
  "other",
]);

const HTML_URL_RE =
  /https:\/\/(?:[a-z0-9-]+\.)*(?:framerusercontent\.com|assets\.framer\.com)\/[^\s"')\]>]+/g;

// ── Helpers ───────────────────────────────────────────────────────────────────

function shouldDownload(url) {
  try {
    const { hostname } = new URL(url);
    return DOWNLOAD_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith("." + d)
    );
  } catch {
    return false;
  }
}

/** Identify size-variant query params that produce distinct image bytes. */
function sizeVariantTag(url) {
  const { searchParams } = new URL(url);
  const scale = searchParams.get("scale-down-to");
  return scale ? `_s${scale}` : "";
}

/** Derive a stable, filesystem-safe filename from an asset URL. */
function assetFilename(url) {
  const { pathname, hostname } = new URL(url);
  const basename = pathname.split("/").filter(Boolean).pop() || "asset";
  const domainTag = hostname.replace(/\./g, "_").slice(0, 20);
  const variant = sizeVariantTag(url);
  if (variant) {
    const dot = basename.lastIndexOf(".");
    const named = dot > 0
      ? `${basename.slice(0, dot)}${variant}${basename.slice(dot)}`
      : `${basename}${variant}`;
    return `${domainTag}__${named}`;
  }
  return `${domainTag}__${basename}`;
}

/** Download a URL to a local file (streams, no full buffer in memory). */
async function downloadAsset(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  ⚠️  HTTP ${res.status} for ${url}`);
    return false;
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
  return true;
}

/**
 * Remove Framer-injected runtime artifacts that only work on the original
 * Framer domain and cause CSP errors when served from anywhere else:
 *  - The editor-bar iframe  (<iframe id="__framer-editorbar" …>)
 *  - framer.com script tags (edit/init.mjs, script?v=2, …)
 */
function removeFramerArtifacts(html) {
  // Editor bar iframe — causes CSP errors outside framer.com
  html = html.replace(/<iframe[^>]+id="__framer-editorbar"[^>]*>(\s*<\/iframe>)?/gis, "");
  // <script src="…"> tags pointing to framer.com or events.framer.com (analytics / editor init)
  html = html.replace(/<script\b[^>]*\bsrc="https:\/\/(?:[\w-]+\.)*framer\.com\/[^"]*"[^>]*>[\s\S]*?<\/script>/gi, "");
  // Inline <script> blocks that dynamically load framer.com editor assets
  html = html.replace(/<script\b[^>]*>[\s\S]*?framer\.com\/edit[^<]*<\/script>/gi, "");
  // <link> preload/prefetch tags pointing to framer.com
  html = html.replace(/<link\b[^>]+href="https:\/\/framer\.com\/[^"]*"[^>]*\/?>/gi, "");
  // Inject CSS to hide any Framer editor UI that JS may re-create at runtime
  const hideFramerUi = `<style>
#__framer-editorbar-container,a[href="https://www.framer.com"]{display:none!important}
</style>`;
  html = html.replace("</head>", hideFramerUi + "</head>");
  return html;
}

/** HTML-decode a URL string (converts &amp; → & etc.) */
function htmlDecode(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Replace all occurrences of an asset's absolute URL with its relative path. */
function rewriteUrl(html, originalUrl, relativePath) {
  let result = html.replaceAll(originalUrl, relativePath);
  const encoded = originalUrl.replace(/&/g, "&amp;");
  if (encoded !== originalUrl) {
    result = result.replaceAll(encoded, relativePath);
  }
  return result;
}

/** Normalize a URL path: strip trailing slash, default to "/" for root. */
function normalizePath(urlPath) {
  const p = urlPath.replace(/\/$/, "");
  return p || "/";
}

/** How many directory levels deep is this URL path. */
function pathDepth(urlPath) {
  return urlPath.split("/").filter(Boolean).length;
}

/** Relative prefix to reach dist root from a page at given depth.
 *  depth 0 → ""  (root index.html)
 *  depth 1 → "../"  (/about/index.html)
 *  depth 2 → "../../"  (/blog/post/index.html)
 */
function toRootPrefix(depth) {
  return depth > 0 ? "../".repeat(depth) : "";
}

/** Convert a URL path to its output file path under dist/. */
function urlPathToFile(urlPath) {
  const segments = urlPath.split("/").filter(Boolean);
  return segments.length === 0
    ? path.join(DIST_DIR, "index.html")
    : path.join(DIST_DIR, ...segments, "index.html");
}

/**
 * Scroll the page incrementally to the bottom to trigger lazy-loaded content,
 * then scroll back to the top.
 */
async function scrollToBottom(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const distance = 400; // px per step
      const intervalMs = 120;
      let scrolled = 0;

      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        scrolled += distance;
        if (scrolled >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, intervalMs);
    });
  });

  // Give lazy-triggered requests a moment to fire and settle
  await new Promise((r) => setTimeout(r, 2_000));
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Return all same-origin internal links found on the page (normalized, no hash). */
async function collectInternalLinks(page) {
  return page.evaluate((origin) => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map((a) => {
        try {
          return new URL(a.href);
        } catch {
          return null;
        }
      })
      .filter((u) => u && u.origin === origin)
      .map((u) => {
        // Strip hash fragments; normalize trailing slash
        const p = u.pathname.replace(/\/$/, "") || "/";
        return u.origin + p;
      });
  }, BASE_ORIGIN);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🔍  Crawling: ${FRAMER_URL}`);

  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(ASSETS_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Shared asset tracking across all pages
  const assetUrls = new Set();

  // BFS crawl queue — keyed by normalized URL path to avoid duplicates
  const visited = new Set();
  const queue = [BASE_ORIGIN + "/"];

  // HTML content per page: Map<normalizedPath, htmlString>
  const pageHtmlMap = new Map();

  while (queue.length > 0) {
    const url = queue.shift();
    const urlPath = normalizePath(new URL(url).pathname);

    if (visited.has(urlPath)) continue;
    visited.add(urlPath);

    console.log(`\n📄  [${visited.size}] ${urlPath}`);

    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      if (DOWNLOAD_RESOURCE_TYPES.has(req.resourceType()) && shouldDownload(u)) {
        assetUrls.add(u);
      }
      req.continue();
    });
    page.on("response", (res) => {
      const u = res.url();
      if (shouldDownload(u)) assetUrls.add(u);
    });

    await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });

    console.log("    ↕️  Scrolling to bottom …");
    await scrollToBottom(page);

    // Discover internal links before closing the page
    const links = await collectInternalLinks(page);
    for (const link of links) {
      const lPath = normalizePath(new URL(link).pathname);
      if (!visited.has(lPath)) {
        queue.push(link);
      }
    }
    console.log(`    🔗  Found ${links.length} link(s), queue: ${queue.length}`);

    // Scan the live DOM for asset URLs (srcset, style backgrounds, etc.) not
    // caught by request interception.
    const domHtml = await page.content();
    for (const match of domHtml.matchAll(HTML_URL_RE)) {
      assetUrls.add(htmlDecode(match[0]));
    }

    await page.close();

    // Fetch the raw SSR HTML directly (no JS execution, no DOM mutation) so
    // that React hydration on the mirror matches exactly what Framer served.
    const ssrRes = await fetch(url);
    let ssrHtml = await ssrRes.text();
    for (const match of ssrHtml.matchAll(HTML_URL_RE)) {
      assetUrls.add(htmlDecode(match[0]));
    }

    pageHtmlMap.set(urlPath, ssrHtml);
  }

  await browser.close();

  console.log(`\n📊  Crawl complete`);
  console.log(`    Pages  : ${visited.size} (${[...visited].join(", ")})`);
  console.log(`    Assets : ${assetUrls.size} to download`);

  // ── Download all assets ────────────────────────────────────────────────────
  const urlToFilename = new Map();
  let downloaded = 0;
  let failed = 0;

  for (const url of assetUrls) {
    const filename = assetFilename(url);
    const destPath = path.join(ASSETS_DIR, filename);

    process.stdout.write(`  ↓ ${filename} … `);
    const ok = await downloadAsset(url, destPath);
    if (ok) {
      downloaded++;
      urlToFilename.set(url, filename);
      console.log("✓");
    } else {
      failed++;
      console.log("✗");
    }
  }

  // ── Crawl JS module dependency graph (catch lazily-imported bundles) ────────
  // Some page bundles are never requested by Puppeteer (e.g. 404, alternate routes)
  // but are referenced via dynamic import() inside script_main.mjs. Walk the graph
  // so every import specifier has a local file to resolve to.
  console.log("\n🔍  Scanning JS modules for undiscovered imports …");
  // Regex matches all quote styles: "…", '…', `…`
  const SPECIFIER_RE = /(?:from\s*|import\s*\(\s*)([`"'])([^`"'\n]+)\1/g;

  const jsQueue = new Set(
    [...urlToFilename.keys()].filter(u => /\.(mjs|js)(\?|$)/.test(u))
  );
  const jsProcessed = new Set();

  while (jsQueue.size > 0) {
    const [url] = jsQueue;
    jsQueue.delete(url);
    if (jsProcessed.has(url)) continue;
    jsProcessed.add(url);

    const filename = urlToFilename.get(url);
    if (!filename) continue;
    let src;
    try { src = await fs.readFile(path.join(ASSETS_DIR, filename), "utf8"); } catch { continue; }

    for (const [, , specifier] of src.matchAll(SPECIFIER_RE)) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../") &&
          !specifier.startsWith("https://")) continue;
      let resolved;
      try { resolved = new URL(specifier, url).href; } catch { continue; }
      if (urlToFilename.has(resolved) || !shouldDownload(resolved)) continue;

      const newFilename = assetFilename(resolved);
      const destPath = path.join(ASSETS_DIR, newFilename);
      process.stdout.write(`  ↓ ${newFilename} (lazy) … `);
      const ok = await downloadAsset(resolved, destPath);
      if (ok) {
        downloaded++;
        urlToFilename.set(resolved, newFilename);
        jsQueue.add(resolved); // scan this file's imports too
        console.log("✓");
      } else {
        failed++;
        console.log("✗");
      }
    }
  }

  // ── Rewrite import paths inside every JS module ────────────────────────────
  // Resolve each import specifier relative to the file's original CDN URL so the
  // rewrite is stable regardless of filename changes between Framer deploys.
  console.log("\n🔁  Rewriting module imports …");
  const filenameToUrl = new Map([...urlToFilename].map(([u, f]) => [f, u]));
  let modulesRewritten = 0;

  for (const [filename, originalUrl] of filenameToUrl) {
    if (!/\.(mjs|js)$/.test(filename)) continue;
    const filePath = path.join(ASSETS_DIR, filename);
    let src;
    try { src = await fs.readFile(filePath, "utf8"); } catch { continue; }

    let changed = false;
    const out = src.replace(SPECIFIER_RE, (match, quote, specifier) => {
      if (!specifier.startsWith("./") && !specifier.startsWith("../") &&
          !specifier.startsWith("https://")) return match;
      let resolved;
      try { resolved = new URL(specifier, originalUrl).href; } catch { return match; }
      const localName = urlToFilename.get(resolved);
      if (!localName) return match;
      changed = true;
      return match.replace(`${quote}${specifier}${quote}`, `${quote}./${localName}${quote}`);
    });

    if (changed) {
      await fs.writeFile(filePath, out, "utf8");
      modulesRewritten++;
    }
  }
  console.log(`    ✅  ${modulesRewritten} module file(s) rewritten.`);

  // ── Write HTML pages with rewritten URLs ───────────────────────────────────
  console.log("\n📝  Writing pages …");

  // Build a pathname → filename index so we can rewrite URL variants that differ
  // only by query string (e.g. srcset entries with ?scale-down-to=…).
  const pathnameToFilename = new Map();
  for (const [u, f] of urlToFilename) {
    try {
      const { hostname, pathname } = new URL(u);
      pathnameToFilename.set(hostname + pathname + sizeVariantTag(u), f);
    } catch {}
  }

  for (const [urlPath, rawHtml] of pageHtmlMap) {
    const depth = pathDepth(urlPath);
    const prefix = toRootPrefix(depth);

    let html = rawHtml;

    // Rewrite Framer-hosted asset URLs to depth-correct relative paths
    for (const [originalUrl, filename] of urlToFilename) {
      html = rewriteUrl(html, originalUrl, `${prefix}assets/${filename}`);
    }

    // Catch any remaining framer CDN URLs (srcset variants with query strings,
    // URLs not seen during crawl, etc.) by matching on pathname.
    html = html.replace(HTML_URL_RE, (match) => {
      const decoded = htmlDecode(match);
      try {
        const { hostname, pathname } = new URL(decoded);
        const key = hostname + pathname + sizeVariantTag(decoded);
        const filename = pathnameToFilename.get(key) || pathnameToFilename.get(hostname + pathname);
        return filename ? `${prefix}assets/${filename}` : match;
      } catch {
        return match;
      }
    });

    // Rewrite internal Framer site URLs to relative paths
    // e.g. https://breezy-founders-904817.framer.app/about → ../about (depth 1)
    html = html.replaceAll(BASE_ORIGIN + "/", prefix || "./");

    // Strip Framer editor artifacts that cause CSP errors outside framer.com
    html = removeFramerArtifacts(html);

    const outFile = urlPathToFile(urlPath);
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, html, "utf8");
    console.log(`    ✅  ${urlPath} → ${path.relative(DIST_DIR, outFile)}`);
  }

  console.log("\n✅  Done!");
  console.log(`   Pages crawled     : ${visited.size}`);
  console.log(`   Assets downloaded : ${downloaded}`);
  console.log(`   Assets failed     : ${failed}`);
  if (failed > 0) {
    console.warn("   Some assets failed to download – check warnings above.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
