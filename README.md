# crosscheck

Crosscheck: type a word or phrase, get candidate crossword answers as letter
tiles plus what it means. Mobile-first PWA, no backend.

- Spec: [`SPEC.md`](SPEC.md)
- Data contract: [`src/contract.ts`](src/contract.ts)

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: pattern parser, provider mappers, orchestrator
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally (service worker active)
```

## Check the endpoints

Open the cog (top right) and tap **Check data sources** at the bottom of the
sheet. It calls every upstream
endpoint from the current origin and reports status, latency, and whether the
browser let the response through. Run it from a deployed origin at least once
before trusting the no-backend design; "Failed to fetch" with the network up
means CORS or a content blocker.

## Deploy

Hosted on Vercel at <https://crosscheck.dylansmith.dev>. Vercel builds every
push: `main` goes to production, other branches and PRs get a preview URL.
The build runs `npm test && npm run build` (see `vercel.json`), so a failing
test fails the deploy.

## Data sources

Datamuse (answers), Free Dictionary API and Wiktionary (definitions),
Wikipedia (summaries). All free, no keys, called directly from the browser.
