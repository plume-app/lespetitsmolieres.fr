# lespetitsmolieres.fr — Project Guide

## What this project does

Static mirror of the [lespetitsmolieres.fr](https://breezy-founders-904817.framer.app/) Framer site, hosted on GitHub Pages at `https://plume-app.github.io/lespetitsmolieres.fr`.

A Puppeteer scraper crawls the live Framer site, downloads all assets locally, rewrites all URLs to relative paths, and outputs a fully self-contained static site into `dist/`.

---

## Repository layout

```
scripts/scrape.js          — The scraper (the only real source code)
dist/                      — Generated output; committed and deployed as-is
  index.html               — Home page
  <page>/index.html        — One file per crawled route
  assets/                  — All downloaded assets (images, fonts, JS modules)
.github/workflows/deploy.yml — CI: scrape + deploy to gh-pages daily
```

---

## How to update the site

Run the scraper locally, then commit and push `dist/`:

```bash
FRAMER_URL=https://breezy-founders-904817.framer.app/ npm run scrape
git add dist/
git commit -m "chore: mirror update"
git push
```

CI also runs the scraper automatically on every push to `master` and on a daily schedule (03:00 UTC).

---

## What the scraper does (scrape.js)

1. **BFS page crawl** — starts at the root URL, follows all same-origin `<a href>` links
2. **Scroll to bottom** — each page is scrolled incrementally to trigger lazy-loaded content
3. **Asset interception** — Puppeteer intercepts all requests to `framerusercontent.com` and `assets.framer.com`
4. **DOM cleanup** — before capturing HTML, removes from the DOM:
   - `#__framer-editorbar-container`
   - `#plume-cookie-banner`
5. **Asset download** — all intercepted assets saved to `dist/assets/` with a `{domain}__{basename}` filename
6. **JS module dependency crawl** — walks the import graph of downloaded `.mjs` files to discover lazily-loaded page bundles not visited by Puppeteer
7. **Module import rewriting** — rewrites all import specifiers inside `.mjs` files using URL resolution (handles `"`, `'`, `` ` `` quote styles; stable across Framer hash changes)
8. **HTML rewriting** — rewrites CDN asset URLs and internal Framer links to depth-correct relative paths per page
9. **Framer artifact removal** — strips `#__framer-editorbar` iframe, `framer.com` scripts/links, and injects CSS to hide any that JS recreates at runtime

### Key design decisions

- **Asset naming**: `{domainTag}__{basename}` (e.g. `framerusercontent_co__react.CdOXKDY6.mjs`) avoids collisions across CDN domains
- **Import rewriting uses URL resolution**, not basename matching — resolves each specifier relative to the file's original CDN URL, then looks up in the `url→filename` map. This is robust to Framer content-hash changes
- **Relative asset paths are depth-aware**: root page uses `assets/foo`, `/about/index.html` uses `../assets/foo`, etc.

---

## CI workflow (.github/workflows/deploy.yml)

Triggers: push to `master`, manual dispatch, daily cron at 03:00 UTC.

Steps:
1. Checkout
2. Setup Node 20
3. Install Chromium system deps (Ubuntu 24.04 — uses `libasound2t64`, not `libasound2`)
4. `npm ci`
5. `node scripts/scrape.js`
6. `touch dist/.nojekyll`
7. Deploy `dist/` to `gh-pages` branch via `peaceiris/actions-gh-pages`

---

## Common tasks

| Task | Command |
|------|---------|
| Run scraper locally | `FRAMER_URL=https://breezy-founders-904817.framer.app/ npm run scrape` |
| Check GitHub Pages URL | `https://plume-app.github.io/lespetitsmolieres.fr` |

## Known gotchas

- **`libasound2` vs `libasound2t64`**: Ubuntu 24.04 renamed the package; the workflow uses `libasound2t64`
- **Framer editor bar**: injected as `#__framer-editorbar-container` and an iframe at runtime — removed in DOM before HTML capture and also hidden via CSS
- **Lazy page bundles**: Framer's `script_main.mjs` dynamically imports page bundles for routes not visited during crawl (404, old routes) — the JS dependency crawler handles these
- **Template literal imports**: Framer uses `` import(`./foo.mjs`) `` in addition to `import("./foo.mjs")` — the rewriter handles all three quote styles
