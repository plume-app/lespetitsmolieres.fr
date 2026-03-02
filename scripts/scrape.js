#!/usr/bin/env node
/**
 * scrape.js — Mirror a Framer site to ./dist for static hosting on GitHub Pages.
 *
 * What it does:
 *  1. Opens the Framer URL with Puppeteer (fully rendered HTML + all network requests)
 *  2. Intercepts every asset request (JS, CSS, fonts, images, …)
 *  3. Downloads Framer-hosted assets into dist/assets/<hash-basename>
 *  4. Rewrites absolute framer/framerusercontent URLs in the HTML to relative paths
 *  5. Writes dist/index.html
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

const DIST_DIR = path.resolve("dist");
const ASSETS_DIR = path.join(DIST_DIR, "assets");

// Domains whose assets we want to download locally.
// framerusercontent.com  → fonts, images, videos uploaded by the user
// assets.framer.com      → Framer runtime JS/CSS (if served from there)
const DOWNLOAD_DOMAINS = [
  "framerusercontent.com",
  "assets.framer.com",
  // add more if needed, e.g. "cdn.framer.com"
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function shouldDownload(url) {
  try {
    const { hostname } = new URL(url);
    return DOWNLOAD_DOMAINS.some((d) => hostname === d || hostname.endsWith("." + d));
  } catch {
    return false;
  }
}

/** Derive a stable, filesystem-safe filename from an asset URL. */
function assetFilename(url) {
  const { pathname, hostname } = new URL(url);
  // Keep the last path segment (usually a hash or meaningful name)
  const basename = pathname.split("/").filter(Boolean).pop() || "asset";
  // Prefix with a short domain hint to avoid collisions across CDNs
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

/** HTML-decode a URL string (converts &amp; → & etc.) */
function htmlDecode(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Replace all occurrences of an asset's absolute URL with its relative path.
 *  Handles both the raw URL and its HTML-encoded variant (& vs &amp;). */
function rewriteUrl(html, originalUrl, relativePath) {
  let result = html.replaceAll(originalUrl, relativePath);
  // Also rewrite the HTML-encoded version (e.g. inside attribute values)
  const encoded = originalUrl.replace(/&/g, "&amp;");
  if (encoded !== originalUrl) {
    result = result.replaceAll(encoded, relativePath);
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🔍  Scraping: ${FRAMER_URL}`);

  // Prepare output directories
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(ASSETS_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // Track every asset URL the page requests
  const assetUrls = new Set();

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (DOWNLOAD_RESOURCE_TYPES.has(req.resourceType()) && shouldDownload(url)) {
      assetUrls.add(url);
    }
    req.continue();
  });

  // Also capture assets loaded after initial render (lazy, dynamic)
  page.on("response", async (res) => {
    const url = res.url();
    if (shouldDownload(url)) {
      assetUrls.add(url);
    }
  });

  console.log("🌐  Loading page …");
  await page.goto(FRAMER_URL, {
    waitUntil: "networkidle0",
    timeout: 60_000,
  });

  // Give JS-heavy pages a moment to trigger late fetches
  await new Promise((r) => setTimeout(r, 2_000));

  // Grab the fully-rendered HTML
  let html = await page.content();
  await browser.close();

  // Also scan the rendered HTML for any asset URLs that were NOT intercepted
  // (e.g. fonts referenced in inline @font-face CSS but never fetched by the browser).
  // HTML-decode each match so it deduplicates with Puppeteer-intercepted URLs.
  const HTML_URL_RE = /https:\/\/(?:[a-z0-9-]+\.)*(?:framerusercontent\.com|assets\.framer\.com)\/[^\s"')\]>]+/g;
  for (const match of html.matchAll(HTML_URL_RE)) {
    assetUrls.add(htmlDecode(match[0]));
  }

  console.log(`📦  Found ${assetUrls.size} Framer-hosted asset(s) to download.`);

  // Download assets and build a URL→localPath map
  const urlToLocal = new Map();
  let downloaded = 0;
  let failed = 0;

  for (const url of assetUrls) {
    const filename = assetFilename(url);
    const destPath = path.join(ASSETS_DIR, filename);
    const relativePath = `assets/${filename}`;

    process.stdout.write(`  ↓ ${filename} … `);
    const ok = await downloadAsset(url, destPath);
    if (ok) {
      downloaded++;
      urlToLocal.set(url, relativePath);
      console.log("✓");
    } else {
      failed++;
      console.log("✗");
    }
  }

  // Rewrite all framer-hosted URLs in the HTML to local relative paths
  for (const [originalUrl, localPath] of urlToLocal) {
    html = rewriteUrl(html, originalUrl, localPath);
  }

  // Write the final HTML
  const outFile = path.join(DIST_DIR, "index.html");
  await fs.writeFile(outFile, html, "utf8");

  console.log("\n✅  Done!");
  console.log(`   Assets downloaded : ${downloaded}`);
  console.log(`   Assets failed     : ${failed}`);
  console.log(`   Output            : ${outFile}`);
  if (failed > 0) {
    console.warn("   Some assets failed to download – check warnings above.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
