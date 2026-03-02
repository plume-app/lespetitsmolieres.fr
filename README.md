# lespetitsmolieres.fr

Static mirror of the Framer site, hosted on GitHub Pages.

## Automatic deployment

On every push to master the scraper is run and the `dist/` folder is committed and pushed to the `gh-pages` branch.

You can manually run the workflow from the Actions tab.

https://github.com/plume-app/lespetitsmolieres.fr/actions/workflows/deploy.yml

click on the "Run workflow" button and select the `master` branch.

## Scrape

```bash
FRAMER_URL=https://breezy-founders-904817.framer.app/ npm run scrape
```

Then commit `dist/` and push.
