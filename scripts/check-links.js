#!/usr/bin/env node
/**
 * check-links.js — Verify every internal <a href> in dist/ resolves to a real
 * page, using GitHub Pages URL semantics:
 *
 *   dist/index.html        is served at  /
 *   dist/foo.html          is served at  /foo        (no redirect)
 *   dist/foo/index.html    is served at  /foo/       (/foo → 301 → /foo/)
 *
 * Relative links are resolved against the URL the browser actually ends up on,
 * so a "./parents" link inside dist/enseignants/index.html resolves to
 * /enseignants/parents — exactly the 404 users hit.
 *
 * Usage: node scripts/check-links.js [distDir]
 * Exits 1 if any broken internal link is found.
 */

import fs from "fs/promises";
import path from "path";

const DIST_DIR = path.resolve(process.argv[2] || "dist");
const ORIGIN = "https://mirror.test";

async function listHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
}

/** URL path at which GitHub Pages serves a given dist file (after redirects). */
function servedPath(file) {
  const rel = path.relative(DIST_DIR, file).split(path.sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"index.html".length);
  return "/" + rel.slice(0, -".html".length);
}

async function exists(p) {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Does GitHub Pages serve a real page (not 404.html) for this URL path? */
async function resolvesToPage(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\//, "");
  if (rel === "" || rel.endsWith("/")) {
    return exists(path.join(DIST_DIR, rel, "index.html"));
  }
  return (
    (await exists(path.join(DIST_DIR, rel))) ||
    (await exists(path.join(DIST_DIR, rel + ".html"))) ||
    (await exists(path.join(DIST_DIR, rel, "index.html")))
  );
}

async function main() {
  const files = (await listHtmlFiles(DIST_DIR)).filter(
    (f) => path.basename(f) !== "404.html", // served at arbitrary paths
  );
  if (files.length === 0) {
    console.error(`No HTML files found in ${DIST_DIR}`);
    process.exit(1);
  }

  const broken = [];
  for (const file of files) {
    const pageUrl = ORIGIN + servedPath(file);
    const html = await fs.readFile(file, "utf8");
    for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)) {
      const target = new URL(href.replace(/&amp;/g, "&"), pageUrl);
      if (target.origin !== ORIGIN) continue; // external, mailto:, etc.
      if (!(await resolvesToPage(target.pathname))) {
        broken.push({ page: servedPath(file), href, resolved: target.pathname });
      }
    }
  }

  const unique = [...new Map(broken.map((b) => [`${b.page} ${b.href}`, b])).values()];
  if (unique.length > 0) {
    console.error(`❌  ${unique.length} broken internal link(s):`);
    for (const b of unique) {
      console.error(`    ${b.page}  href="${b.href}"  →  ${b.resolved} (404)`);
    }
    process.exit(1);
  }
  console.log(`✅  All internal links OK across ${files.length} page(s).`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
