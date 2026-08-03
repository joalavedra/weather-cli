# Weather Cover

Weather risk intelligence for small businesses.

An ice cream shop takes about a fifth less on a cold weekend. A patio bar empties in the rain. A landscaper stops billing in a freeze. Large firms have hedged that since the 1990s, on derivatives written for utilities and airlines. Small ones never could, because nobody would write a contract that small.

Traded weather contracts changed that, and this works out whether they're any use to a particular business: what the weather actually costs it, which contracts would pay when it happens, and how much of the real loss they'd have covered.

It doesn't hold funds or place orders. It tells you what to buy, how much, and — often — that you shouldn't.

**Live at [joalavedra.com/weather](https://joalavedra.com/weather).**

---

## What it does

**Measures the loss instead of asking for it.** Upload a year of daily takings and it regresses them against the weather at that exact location, recovering where revenue starts falling and what each degree past that costs. The owner of a Chicago patio bar guesses "we're down about 20% when it's cold"; the fit says below 72.5°F they lose $138 per degree, and that weather explains 52% of their revenue swings.

**Says when not to buy.** That last figure is the one that matters. If weather explains 9% of the swings, something else is moving the till and cover would hedge a risk the business doesn't have. The product says so rather than selling anyway.

**Finds cover on two venues, worldwide.** Kalshi lists US weather; Polymarket lists roughly fifty cities across Europe, Asia, the Middle East, Africa, Oceania and South America. Neither is a superset. Candidates are ranked by distance from the business to the station the contract settles on, because that distance is the risk.

**Measures basis risk rather than estimating it.** Not "does this contract look related to the loss" but "over four years of history, on the days this business was actually hurting, how often did the contract pay?" That number routinely disagrees with intuition. A Chicago station can correlate at 0.991 with a lakefront bar and still miss a tenth of its loss days, because correlation describes the whole distribution while a trigger cares about one edge of it.

**Sizes the structure from the loss, not from a budget.** Each rung is sized to the loss expected on the days that rung pays, and the premium falls out. Sizing is solved rather than exposed as a knob because it can't be guessed — at a flat contract count the swing reduction runs 4% → 19% → 37% → −1% as size climbs. Past the optimum, cover starts *adding* volatility.

**Proves it on days it wasn't fitted to.** Structures are sized on the earlier part of history and scored on a held-out tail. Where history is too short to split, the result is labelled optimistic rather than presented as evidence.

---

## Does traded weather cover actually work?

`weather basis-study` runs the same measurement against every city with a live ladder, with each city's loss threshold set from its own temperature distribution.

Across 40 cities: **median 97% of loss days caught, 88% at or above 85%, none below 70%**, median station gap 18km.

Read it as an upper bound, and the command says so. Both series come from ~10km gridded reanalysis, which smooths the very microclimates that create basis risk. Pairs the grid can't separate are excluded outright rather than counted as perfect hedges — including them put the median near 100% and measured the weather archive rather than the weather.

The risk concentrates where you'd expect: the worst results are Cape Town, San Francisco, Karachi, Manila and Miami. Coastal and elevated businesses are where the measurement earns its keep.

---

## The two venues

Neither covers the other, and the difference is worth putting in front of a client.

| | Kalshi | Polymarket |
|---|---|---|
| Coverage | US cities | ~50 cities, six continents |
| Scale | Fahrenheit | Celsius |
| Settles against | NWS climatological reports | Wunderground airport stations |
| Standing | CFTC-designated contract market | Offshore |
| Buckets | Wide brackets, plus rain/snow/hurricane | 1°C, clustered near the likely outcome |

Both are read over public HTTP with no credentials. A resolution source is a thing that can be gamed, so which one a contract uses matters.

Contracts are normalized onto one venue-neutral `Market`, so nothing downstream knows or cares where a ladder came from.

---

## Architecture

A pnpm workspace: one domain core, two surfaces over it.

```
packages/core/          @weather/core — every calculation, no I/O beyond HTTP
  types.ts              Market, Strike, Settlement, Ladder, CoverQuote
  weather.ts            peril / location / station taxonomy shared by venues
  kalshi.ts             Kalshi adapter        ── public HTTP
  polymarket.ts         Polymarket adapter    ── public Gamma API
  venue.ts              Venue interface, registry, routing
  observations.ts       Open-Meteo history + geocoding, in °F or °C
  loss.ts               fit a loss curve from revenue; parse the CSV
  geobasis.ts           measured station-vs-premises trigger correlation
  basis.ts              basis-risk scoring and baskets
  elicit.ts             decomposed correlation, when it can't be measured
  hedge.ts              price one contract; the exposure invariant
  cover.ts              solve a structure from a loss curve
  backtest.ts           replay it against past seasons; solve sizing
  study.ts              the same measurement across every covered city

apps/web/               @weather/web — Next.js 16 workbench + assistant
  app/api/              analysis, clients, revenue, coverage, geocode, chat
  lib/analysis.ts       turns a stored client into inputs the core wants
  lib/store.ts          Vercel Blob in production, filesystem locally
  components/workbench/ the canvas: revenue → curve → cover → basis
  components/charts/    Recharts via shadcn, fixed colour roles

apps/cli/               @weather/cli — the `weather` command
```

**The core does the thinking.** Both surfaces call the same functions, so clicking through the canvas and asking the assistant give the same answers. A broker shouldn't have to ask a model to do arithmetic.

**Venue is a routing decision.** Adding or dropping one is a change in `venue.ts`; everything downstream works off `Market`.

**State is JSON.** Clients, revenue and caches go through `lib/store.ts` — Vercel Blob when its token is present, the filesystem otherwise. Local development stays a directory of files you can open.

**Revenue never reaches the model.** A CSV uploads, gets an id, and the id is all the assistant carries. Tools read the rows server-side.

### The workbench

Client list on the left, an analysis canvas in the middle, the assistant docked right. The canvas runs revenue → loss curve → cover → basis, each an inspectable card with a chart. Charts use fixed colour roles rather than a categorical ramp: loss is warm, payout is blue, net is green.

A self-serve owner has one business and sees a guided empty state; a broker has many. Same surface.

---

## Running it

Node 22+, pnpm 10. Both venues and the weather archive are public HTTP, so there's nothing to configure for data.

```bash
pnpm install
pnpm build
pnpm web      # http://localhost:3000/weather
pnpm check    # lint + typecheck + tests
```

`apps/web/.env.local` needs `DEEPSEEK_API_KEY` for the assistant; everything else works without it. Uploaded revenue goes to the system temp directory locally, or Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set.

### CLI

```bash
weather cover --location Chicago --peril high_temp     # what could cover this
weather events KXHIGHCHI                               # open dates
weather ladder KXHIGHCHI-26AUG02                       # the strike ladder
weather show KXHIGHCHI-26AUG02-B73.5                   # one contract and its rules

weather fit --revenue takings.csv --location Chicago   # what weather costs them
weather station-basis --station "Chicago Midway" --premises 41.93,-87.64 \
  --threshold 72 --direction below                     # how well a station tracks
weather solve KXHIGHCHI-26AUG02 --revenue takings.csv \
  --premises 41.93,-87.64 --months 5,6,7,8,9           # the structure and premium
weather backtest KXHIGHCHI-26AUG02 --revenue takings.csv \
  --premises 41.93,-87.64 --months 5,6,7,8,9           # replay past seasons

weather basis-study                                    # does cover track, everywhere
```

`--json` for machine-readable output, `--venue polymarket` to route elsewhere.

---

## What it deliberately doesn't do

**Place trades.** No wallet, no order routing, no positions. The measurements are the product and they're worth having whether or not anyone executes here. Every contract links to its venue, so placing a position takes a minute in the client's own account.

**Claim precision it doesn't have.** Basis comes from gridded reanalysis, not station records. Backtest premium is charged at today's ask on every replayed day. Where a number is an upper bound or an in-sample result, it's labelled.

**Sell cover to businesses that don't need it.** A weak fit is reported as a weak fit.

---

## Checks

`pnpm check` runs oxlint, `tsc --noEmit` across three packages, and 165 vitest tests. Adapter parsing is pinned against fixtures captured from the live APIs; the loss fit is validated by recovering a known curve from synthetic data; sizing and basis are mutation-tested.

The web app has no component tests. Every UI defect so far was found by driving it in a browser, and nothing guards against regression.

---

## Stack

- **Runtime** — Node 22, ESM, TypeScript 6
- **Web** — Next.js 16, React 19, Tailwind 4, shadcn/ui, Recharts, AI SDK 6 over DeepSeek
- **CLI** — Commander 14
- **Core** — Zod 4 and native `fetch`, nothing else
- **Data** — Kalshi, Polymarket Gamma, Open-Meteo archive and geocoding. All keyless.
