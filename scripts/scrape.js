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

/** Derive a stable, filesystem-safe filename from an asset URL. */
function assetFilename(url) {
  const { pathname, hostname } = new URL(url);
  const basename = pathname.split("/").filter(Boolean).pop() || "asset";
  const domainTag = hostname.replace(/\./g, "_").slice(0, 20);
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

    // Remove Framer editor UI elements from the DOM before serializing
    await page.evaluate(() => {
      document.getElementById("__framer-editorbar-container")?.remove();
    });

    // Capture fully-rendered HTML and scan for any asset URLs not intercepted
    let html = await page.content();
    for (const match of html.matchAll(HTML_URL_RE)) {
      assetUrls.add(htmlDecode(match[0]));
    }

    pageHtmlMap.set(urlPath, html);
    await page.close();
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

  // ── Rewrite import paths inside downloaded JS modules ─────────────────────
  // The .mjs files use relative imports like "./framer.D8flmtA6.mjs", but we
  // saved them with a domain prefix (e.g. "framerusercontent_co__framer.D8flmtA6.mjs").
  // Rewrite those bare basenames to their prefixed local filenames.
  console.log("\n🔁  Rewriting module imports …");
  const basenameToLocal = new Map();
  for (const [url, filename] of urlToFilename) {
    const basename = new URL(url).pathname.split("/").pop();
    if (basename && basename !== filename) basenameToLocal.set(basename, filename);
  }
  let modulesRewritten = 0;
  for (const filename of urlToFilename.values()) {
    if (!/\.(mjs|js)$/.test(filename)) continue;
    const filePath = path.join(ASSETS_DIR, filename);
    let src;
    try { src = await fs.readFile(filePath, "utf8"); } catch { continue; }
    let out = src;
    // Rewrite absolute CDN URLs that appear inside the module
    for (const [url, localName] of urlToFilename) {
      if (out.includes(url)) out = out.replaceAll(url, `./${localName}`);
    }
    // Rewrite relative bare-basename imports "./name.hash.mjs" → "./prefixed.mjs"
    for (const [basename, localName] of basenameToLocal) {
      out = out.replaceAll(`"./${basename}"`, `"./${localName}"`);
      out = out.replaceAll(`'./${basename}'`, `'./${localName}'`);
    }
    if (out !== src) {
      await fs.writeFile(filePath, out, "utf8");
      modulesRewritten++;
    }
  }
  console.log(`    ✅  ${modulesRewritten} module file(s) rewritten.`);

  // ── Write HTML pages with rewritten URLs ───────────────────────────────────
  console.log("\n📝  Writing pages …");

  for (const [urlPath, rawHtml] of pageHtmlMap) {
    const depth = pathDepth(urlPath);
    const prefix = toRootPrefix(depth);

    let html = rawHtml;

    // Rewrite Framer-hosted asset URLs to depth-correct relative paths
    for (const [originalUrl, filename] of urlToFilename) {
      html = rewriteUrl(html, originalUrl, `${prefix}assets/${filename}`);
    }

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
