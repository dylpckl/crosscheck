# Crosscheck — spec

One input. Type a word or phrase, get (a) candidate crossword answers as
letter tiles and (b) what the phrase means. Mobile-first, installable PWA,
no backend required for v1.

Companion files:

- `src/contract.ts` — the data model contract. Read that first.

---

## 1. Decisions

| Question | Decision | Why |
|---|---|---|
| Backend? | **None for v1.** All calls go browser → public API. | Every API below sends `Access-Control-Allow-Origin: *`. Zero hosting cost, zero secrets, works as a static site on any host (deployed on Vercel). |
| Answer engine | **Datamuse** (`ml=` means-like + `sp=` spelled-like) | Free, no key, 100k req/day, pattern-aware server-side, returns definitions and part-of-speech in the same call. |
| Definition | **Free Dictionary API** first, **Wiktionary REST** fallback | dictionaryapi.dev is richest for single words (phonetics, audio, examples). Wiktionary handles phrases and rarer words. |
| "Web search" | **Wikipedia REST summary** + outbound search links | There is no free, CORS-enabled web search JSON API. Wikipedia's summary endpoint covers proper nouns and phrases well. Real search is a tap-out link (Google / DuckDuckGo / Wordplays). |
| Framework | **None.** Vite + vanilla TypeScript. | App is one screen. Vite gives TS, hashed assets, and `vite-plugin-pwa` for a correct service worker. No React/Preact. |
| Persistence | `localStorage` for history and result cache | Small, synchronous, good enough. Swap to IndexedDB only if cache size becomes a problem. |

---

## 2. Data model contract

Defined in full in `src/contract.ts`. Summary of the flow:

```
user input ──parse──▶ SolveRequest {query, pattern?, length?}
                          │
                          ├──▶ DatamuseAnswers   ──▶ Answer[]
                          ├──▶ DictionaryApi  ─┐  (in parallel; Free Dictionary
                          ├──▶ Wiktionary     ─┴─▶ Definition | null   preferred)
                          ├──▶ WikipediaSummary  ──▶ Reference | null
                          └──▶ buildLinks()      ──▶ SearchLink[]   (no network)
                                    │
                    Promise.allSettled + merge/sort/dedupe
                                    ▼
                           SolveResult ──▶ UI + cache
```

Key invariants:

- `Answer.answer` is grid form (`RIPCURRENT`), `Answer.display` is human form
  (`rip current`). Pattern matching and dedupe use grid form only.
- The constraint field is always visible and has two modes. Plain letters
  ("SC") are a **soft** constraint: nothing is filtered, answers are ranked by
  how many of those letters they contain and matching tiles light up. Any
  `?` (or `_ . - *`) switches to a **positional** pattern ("SC?D?") that
  filters strictly and dims non-matches. Digits alone are a length. Letters
  are applied client-side only and never change what is fetched or cached;
  patterns and lengths go to Datamuse as `sp=`.
- Partial failure is a normal state. Missing definition ≠ error. Provider
  errors are collected into `SolveResult.errors` and shown as a quiet inline
  notice, never a modal.
- `SolveResult` is the only thing the renderer accepts. It is also exactly
  what gets cached, so cache hits and network hits render through one path.

---

## 3. APIs and how they map to the contract

### 3.1 Datamuse → `Answer[]`

```
GET https://api.datamuse.com/words?ml={query}&md=dpf&max=60
GET https://api.datamuse.com/words?ml={query}&sp={pattern}&md=dpf&max=30   (only when pattern/length given)
```

- `ml` = "means like". This is the crossword-clue engine.
- `sp` = "spelled like". `?` = one unknown letter, `*` = any run. A bare length
  becomes `?????`. Datamuse applies this server-side, so constrained queries
  come back pre-filtered.
- `md=dpf` = metadata: **d**efinitions, **p**arts of speech, **f**requency.
- Response: `[{ word, score, tags?: ["n","v","f:1.23"], defs?: ["n\tdefinition"] }]`

Mapping:

| Datamuse | Answer |
|---|---|
| `word` | `display`; `answer = word.toUpperCase().replace(/[^A-Z]/g,'')` |
| `score / maxScore` | `score` (relative to the top answer; raw integer kept in `rawScore`) |
| `defs[0]` after the tab | `gloss` |
| `tags` minus `f:*` and `syn` | `partOfSpeech` |

Both calls run in parallel. Results are merged, deduped by `answer`, and
`fitsPattern` is recomputed client-side against the letters-only pattern.
The unconstrained call matters because Datamuse's `sp` can't see through
spaces: "rip current" (10 letters) won't match `sp=??????????` server-side
but does match after stripping. Cap output at 24.

Also useful later: `rel_syn=` (synonyms) and `rel_trg=` (triggers) as extra
answer sources for short clues, merged with a lower weight.

Limits: 100,000 requests/day without a key, no auth, CORS `*`.

Definitions for clue-bank answers (`src/providers/glosses.ts`). Bank hits
carry no gloss, so each published answer without one gets a lookup:

```
GET https://api.datamuse.com/words?sp={answer}&md=d&max=1
```

The first definition of the exact word becomes the `gloss`, its prefix the
`partOfSpeech`. At most eight lookups per search, memoized for the session,
started as soon as the bank has answered so they run alongside the main
calls. A failed lookup leaves the row as tiles and never fails the solve.

### 3.2 Free Dictionary API → `Definition | null`

```
GET https://api.dictionaryapi.dev/api/v2/entries/en/{query}
```

- 200: `[{ word, phonetic?, phonetics: [{text?, audio?}], meanings: [{partOfSpeech, definitions: [{definition, example?, synonyms[]}]}], sourceUrls[] }]`
- 404: `{ title: "No Definitions Found", ... }` → return `null`, not an error.

Mapping: take entry `[0]`; `phonetic` from `phonetic` or first `phonetics[].text`;
`audioUrl` from first non-empty `phonetics[].audio`; flatten `meanings[]` ×
`definitions[]` into `Sense[]`, cap 6; `sourceUrl = sourceUrls[0]`.

Caveats: community-run, occasionally slow or 5xx. Mostly single words. Runs in
parallel with Wiktionary rather than ahead of it, so a stall costs nothing.

### 3.3 Wiktionary REST → `Definition | null` (fallback)

```
GET https://en.wiktionary.org/api/rest_v1/page/definition/{query}
```

- 200: `{ en: [{ partOfSpeech, definitions: [{ definition (HTML), examples?: [HTML] }] }] }`
- 404 → `null`.

Entries are case-sensitive: `Big_Apple` exists where `big_apple` 404s, so a
404 is retried title-cased before giving up. Strip HTML to text before it
reaches the contract. Better than dictionaryapi
for phrases ("rip current", "in the black") and slang. Send header
`Api-User-Agent: clue-solver/1.0 (contact url)` — Wikimedia asks for it.

### 3.4 Wikipedia REST summary → `Reference | null`

```
GET https://en.wikipedia.org/api/rest_v1/page/summary/{Title_Case_Query}?redirect=true
```

- 200: `{ type: "standard"|"disambiguation"|..., title, extract, thumbnail?: {source}, content_urls: {desktop: {page}} }`
- 404 → `null`.

Mapping is direct. `kind` = `type === 'disambiguation' ? 'disambiguation' : 'standard'`.
Truncate `extract` to ~400 chars at a sentence boundary.

Redirects can land far from the query: "Hasten" redirects to the Saudi national
anthem, whose English title opens with that word. The page is kept only when the
query appears in its title or its lead sentence, where aliases live ("New York,
often called ... or simply NYC, is ..."). A missing card beats a confidently
wrong one, and the Wikipedia search link stays in the links row regardless.

Optional second call when summary 404s, to offer suggestions:
`https://en.wikipedia.org/w/api.php?action=opensearch&search={query}&limit=5&format=json&origin=*`
(`origin=*` is what enables CORS on the action API).

### 3.5 Search links → `SearchLink[]` (local, no network)

Always built. In order:

| Label | URL |
|---|---|
| Wordplays | `https://www.wordplays.com/crossword-solver/{query}` |
| Google | `https://www.google.com/search?q={query}+crossword+clue` |
| DuckDuckGo | `https://duckduckgo.com/?q={query}` |
| Wikipedia | `https://en.wikipedia.org/w/index.php?search={query}` |

Open with `target=_blank rel=noopener`. On mobile these are the real "web
search" affordance; the Wikipedia card is the inline preview.

### 3.6 Rejected / not viable client-side

- **DuckDuckGo Instant Answer API** — no CORS headers on `api.duckduckgo.com`.
- **Google Custom Search / Bing / Brave Search** — need keys, would leak client-side.
- **Crossword-specific clue databases** (XWord Info, Crossword Tracker, xd corpus) —
  no public CORS APIs. The xd corpus now ships as a bundled clue bank instead
  (see `docs/CLUEBANK.md`).
- **Merriam-Webster / Oxford** — keys required.

---

## 4. Libraries

| Need | Choice | Notes |
|---|---|---|
| Build / dev server | `vite` | Zero config, TS out of the box. |
| PWA | `vite-plugin-pwa` (wraps Workbox) | Generates `manifest.webmanifest`, precache for app shell, runtime caching rules, and the "update available" prompt. |
| HTTP | native `fetch` + `AbortController` | No axios. 8s timeout per provider. |
| Storage | `localStorage` behind a 20-line `store.ts` | History (last 50) + result cache (LRU 200, 7-day TTL). |
| HTML sanitizing | `DOMParser` → `textContent` | Only Wiktionary returns HTML; we only need text out of it. |
| Tests | `vitest` | Unit tests for the pattern parser and each adapter's mapper against fixture JSON. |
| Fonts | system stack + optional Georgia for the display serif | No web font loads; keep first paint instant on 3G. |

Nothing else. Total shipped JS target: under 15 KB gzipped excluding the
service worker.

---

## 5. UI spec (mobile)

Single screen, portrait-first, everything reachable with one thumb. Phones
and wide screens speak with one voice, and §5b only widens it: the clue set
large in the display serif, a length slider under it, Meaning as one
collapsed line, answers as cards that turn over, and Recent at the bottom.

```
┌──────────────────────────────┐
│  crosscheck                ⚙ │  ← app bar
│  CLUE                        │
│  tide        (serif, 34px) 🔍│  ← one input, solve button trailing it
│  ─────────────────────────── │
│  LENGTH           Any length │
│  ●─────────────────────────  │  ← slider: Any, 3 … 8
│  Any  3   4   5   6   7   8  │
│  LETTERS YOU HAVE            │
│  [N×][A×] Type a letter      │  ← tags; matching tiles light up
├──────────────────────────────┤
│  MEANING ⌄                   │
│  tide  n. The periodic rise… │  ← one line; tap to open the cards
│  ─────────────────────────── │
│ ┌──────────────────────────┐ │
│ │ [N][E][A][P]             │ │  ← top published answer outlined
│ │ n. The tide of least…    │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ [E][B][B]                │ │  ← every card the same shape:
│ │ v. to flow back or recede│ │    tiles, then the gloss
│ └──────────────────────────┘ │
│  RECENT                      │
│  tide · ocean current · …    │  ← pills, one row, scrolls sideways
└──────────────────────────────┘
```

Sections keep a fixed order for every search: **Meaning, Answers**. Meaning
gathers everything that answers "what is this" — the dictionary entry, the
Wikipedia summary, and the links out — behind one disclosure, each card naming
its own source. It is closed on every search: answers are what was asked for,
and the definition is one tap away when it is wanted. Collapsed it is a single
tappable line carrying the first sense; open it shows the cards. A rule under
it marks where the answers begin. The answer list is never truncated.

Both states stay in the DOM so the open and close can animate: a grid row
transitions between `0fr` and `1fr`, which lets the browser measure the content
without any height being hardcoded. Where motion is not wanted, both changes
simply apply at once. No animation library.

**Length** is a slider under the clue, the same control as desktop with a
shorter track: Any, then 3 to 8. In the shipped clue bank, 3 to 8 letters
covers 94% of published answers, and seven stops across a phone-width track
is what a thumb lands on; the long tail is what the Google hand-off is for.
It is a standing constraint: it sets `SolveRequest.length` (refetching half
a second after the last move, mid-search or not) and filters strictly, so a
length with no answers shows the hand-off naming that length rather than
every length. A longer length arriving from a link or history means any
length on a phone.

**Letters you have** is the desktop tag box under the slider, sized for a
thumb: each letter typed becomes a tag, Backspace removes the last. Letters
re-rank and highlight, never filter or refetch. There is no positional
pattern input; a pattern from history or a link becomes its length plus its
known letters.

**Answers** are cards, every one the same shape — tiles, then the gloss
underneath — with the top published answer outlined in blue. Tiles are
solid, no border, bold monospace; nine letters and up shrink a size. There is no
heading over the cards and no length number beside them. Related words keep
their own labelled list under the published answers.

**Empty and loading** show a face-down board: a blank Meaning line and rows
of blank tiles, so the input, the Meaning line and the first card never move
when results land. The tiles turn over Wordle-style, row by row, as answers
arrive. The first answers wait 250ms so the board turns in one wave; repaints
wait for a flip to finish; later answers turn over on their own. Until there
is any history, one line of welcome and two example buttons sit above the
board.

**Recent** sits under the answers, with its own heading: a single row of
pills that scrolls sideways. Under the input, it outranked the answers.

Behavior:

- Submit with the solve button trailing the clue, or the keyboard's Search
  key (`enterkeyhint=search`), or just pause: search as you type is on
  everywhere, debounced 450ms on phones once the query is 3 characters or
  more, online only. Results already on screen stay until new ones land.
- The search bar sits at the top and scrolls with the page: with the slider
  it is tall enough that pinning it would cost the answers a third of the
  screen.
- A clue over 14 characters steps the input down a size, so more of it stays
  in view.
- Tap an answer card → copies the grid-form answer to clipboard and shows a
  toast. Long-press → sets it as the query (chain lookups). Blank rows on
  the face-down board do neither.
- Sections render independently as each provider resolves; the answers
  usually land first.
- Errors show as a single muted line under the affected section
  ("Couldn't reach dictionary — showing cached result"). Never a modal.
- Design tokens from the prototype are kept: cream `#EFE9DD`, ink `#1B1B1B`,
  blue `#2B4C7E`, serif display, monospace tiles. Dark mode inverts cream/ink.
- Respect `prefers-reduced-motion`. Min tap target 44px. `100dvh` layout so
  the iOS keyboard doesn't push content off-screen.

---

## 5b. UI spec (desktop, ≥ 1024px)

One centered column, max 1080px. Same DOM as mobile, rearranged by CSS grid
(`#out` is `display: contents` so its sections join the view's grid).

```
┌─────────────────────────────────┬───────────────────────┐
│ CLUE                            │ MEANING               │
│ tide            (serif, 44px)   │ ┌───────────────────┐ │
│ ─────────────────────────────── │ │ dictionary entry  │ │
│ LENGTH   Any length │ LETTERS   │ │ Wikipedia summary │ │
│ ●───────────────    │ [N×][A×]  │ │ links             │ │
│ Any 3 4 … 15        │           │ └───────────────────┘ │
├─────────────────────┴───────────┴───────────────────────┤
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [N][E][A][P]   n. The tide of least range…           │ │ ← top answer outlined
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [E][B][B]      n. to flow back or recede             │ │
│ └─────────────────────────────────────────────────────┘ │
│ RECENT  (chips)                                          │
└─────────────────────────────────────────────────────────┘
```

- **Length** is the same slider as the phone's, with the full track: Any,
  3–15. A length past 8 set here is dropped if the window narrows below the
  breakpoint, since the phone slider cannot show it.
- **Search as you type** is debounced 250ms here rather than the phone's
  450ms. A typed search reaches history only after resting 2s on it.
- **Meaning** is always open and holds its column from the start with a
  fixed height (size containment); long entries scroll inside the card.
- **Answers** are the same cards, tiles beside their gloss whatever the
  length, with room reserved for six tiles so glosses line up. Related words
  show only when nothing published came back, and then take the published
  rows' place; the Google hand-off sits below the list.
- **Empty and loading** are the phone's face-down board with the Meaning
  card blank instead of the line; the welcome line is not shown.
- **Recent** wraps instead of scrolling.
- No layout shift: the scrollbar gutter is reserved and the top row's height
  never depends on the definition.

---

## 6. PWA

### Manifest

```json
{
  "name": "Crosscheck",
  "short_name": "Crosscheck",
  "start_url": "/?source=pwa",
  "display": "standalone",
  "background_color": "#EFE9DD",
  "theme_color": "#2B4C7E",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ],
  "share_target": {
    "action": "/",
    "method": "GET",
    "params": { "text": "q" }
  }
}
```

`share_target` lets the user highlight a clue in another app and "share" it
straight into the solver; `?q=` is read on load and submitted.

### Service worker (Workbox via vite-plugin-pwa)

| Route | Strategy | Cache | Expiry |
|---|---|---|---|
| App shell (`index.html`, JS, CSS, icons) | Precache | `app-v{hash}` | On deploy |
| `api.datamuse.com/*` | StaleWhileRevalidate | `api-datamuse` | 100 entries, 7 d |
| `api.dictionaryapi.dev/*`, `en.wiktionary.org/api/*` | StaleWhileRevalidate | `api-dict` | 100 entries, 30 d |
| `en.wikipedia.org/api/rest_v1/*` | StaleWhileRevalidate | `api-wiki` | 100 entries, 30 d |
| Wikipedia thumbnails (`upload.wikimedia.org`) | CacheFirst | `img` | 50 entries, 30 d |

Two cache layers exist on purpose: the SW HTTP cache makes repeat network
calls free, and the app-level `SolveResult` cache in `localStorage` makes
repeat *queries* render with no fetch at all (and works even if the SW
hasn't installed yet).

Offline behavior:

- App shell always loads.
- A query already in the result cache renders normally with an "offline,
  cached" pill.
- A new query offline: answers/definition sections show one line each
  ("You're offline"), the search links still render (they'll open when the
  user is back online), history still works.

Update flow: `registerType: 'prompt'`. When a new SW is waiting, show a
small "Update available — reload" bar. Never auto-reload mid-typing.

iOS notes: no `beforeinstallprompt`, so show an "Add to Home Screen" hint
once (dismissable, stored) when running in Safari and not standalone.
Set `<meta name="apple-mobile-web-app-capable">` and an
`apple-touch-icon`. Safari evicts storage after 7 days of non-use for
non-installed sites; installed PWAs are exempt.

---

## 7. Project layout

```
index.html
vite.config.ts            # vite-plugin-pwa config lives here
public/
  icons/192.png, 512.png, apple-touch-icon.png
scripts/
  build-cluebank.mjs      # XD corpus → src/data/cluebank.json (docs/CLUEBANK.md)
src/
  contract.ts             # the data model
  main.ts                 # boot, read ?q=, wire shell, solver, sheet
  solve.ts                # orchestrator: fan out, merge, gloss, cache
  pattern.ts              # parser + matcher (pure, unit-tested)
  rank.ts                 # merge + order answers
  clue-norm.ts            # clue normalization shared with the bank script
  http.ts                 # fetch with timeout + error mapping
  store.ts                # localStorage history, result cache, settings
  data/
    cluebank.json         # generated clue bank
    crosswordese.ts       # hand-written conventional fill
  providers/
    cluebank.ts           # exact clue lookup (lazy chunk)
    crosswordese.ts
    datamuse.ts
    glosses.ts            # definitions for bank answers
    dictionaryapi.ts
    wiktionary.ts
    wikipedia.ts
    links.ts
  render/
    answers.ts            # letter tiles, blank board
    meaning.ts            # dictionary + reference + links, blank card
    history.ts
    empty.ts
    links.ts
  ui/
    shell.ts              # app bar, sheet, toast
    solver.ts             # inputs, desktop controls, flip, paint
    sheet.ts              # settings + about
    diagnostics.ts        # "Check data sources"
    layout.ts             # the desktop breakpoint
  styles.css
test/
  *.test.ts               # parser, ranking, links, orchestrator
  providers/*.test.ts     # mapper tests against fixtures/
  render/*.test.ts
  fixtures/*.json         # captured real responses
```

---

## 8. Milestones

1. **Scaffold + smoke test.** Vite project, deploy it, one page that
   fetches each of the four endpoints and prints status + CORS result.
   This validates the "no backend" decision before anything else is built.
2. **Pattern parser + Datamuse adapter + tiles.** The core loop. Ship it.
3. **Definition + reference cards, search links.**
4. **Cache, history, offline states.**
5. **PWA polish:** manifest, icons, SW strategies, update prompt, share target,
   iOS install hint. Lighthouse PWA + a11y ≥ 95.

---

## 9. Open questions (non-blocking, defaults chosen)

- **Live-as-you-type vs submit only.** Resolved: on everywhere, no toggle.
  The clue bank and corpus answer locally while you type; the Datamuse
  quota (100k/day) is far beyond what pauses on a phone can spend.
- **Search box at the top or the bottom.** Resolved: top. The bottom dock
  moved the clue away from the length slider it belongs with, and with search
  as you type the input is where the thumb already is.
- **Answer count.** Default cap 24; the prototype showed ~8. Tune after use.
- **Proper-noun answers.** Datamuse tags them `prop`. Default: keep them,
  since crosswords love them, but sort slightly lower than common words.
