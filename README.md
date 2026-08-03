# Weather risk intelligence for small businesses

Businesses lose money when the weather turns. An ice cream shop takes ~20% less on a cold weekend; a patio bar empties in the rain; a landscaper stops billing in a freeze. Large firms have hedged this on weather derivatives since the late 1990s. Small ones never could — until per-city weather contracts started listing on regulated exchanges.

This works out what that costs a specific business, finds the traded contracts that would pay when it happens, and measures honestly how much of the real loss they'd actually cover. It does not hold funds or place orders: it tells you what to buy, how much of it, and — often — that you shouldn't.

It is agent-native by design: everything the chat UI can do is a tool call over one shared domain core, so an agent can reach the same outcomes a person can. Both surfaces — chat and CLI — run the same analysis, because a client can upload a year of daily takings to either.

## Venues

Neither venue is a superset of the other, so both are read.

**Kalshi** — US weather on a CFTC-designated contract market. 291 series under Climate and Weather: per-city daily high and low temperature ladders, rainfall, snowfall, hurricane landfall. Denominated in Fahrenheit, settling against National Weather Service climatological reports.

**Polymarket** — the rest of the world. Daily high and low temperature ladders for around fifty cities across Europe, Asia, the Middle East, Africa, Oceania and South America, in 1°C buckets, settling against Wunderground airport stations.

Both are read over public HTTP with no credentials. The difference in regulatory standing and resolution source is a real one and worth putting in front of a client — a resolution source is a thing that can be gamed.

Routing lives in `packages/core/src/venue.ts`. Everything downstream works off a venue-neutral `Market`.

## The ladder is the product

A single binary contract is a bet. A **ladder** — every temperature bucket for one place on one date — can be shaped to match a loss curve, and that's what separates cover from gambling.

```
$ weather ladder KXHIGHCHI-26AUG02

Highest temperature in Chicago on Aug 2, 2026?

Peril:       high_temp
Place:       Chicago
Measured at: Chicago Midway, IL
Source:      NWS Climatological Report Chicago Midway
Closes:      2026-08-03 05:59

  70° or below     YES   2¢   NO 100¢   OI    1,022
  71° to 72°       YES   2¢   NO  99¢   OI    1,267
  73° to 74°       YES  17¢   NO  85¢   OI    2,554
  75° to 76°       YES  40¢   NO  61¢   OI    1,122
  77° to 78°       YES  34¢   NO  67¢   OI    1,053
  79° or above     YES   7¢   NO  94¢   OI    1,439
```

A shop that loses money below 70° buys the rungs below 70° — not one contract at an arbitrary strike.

Note that "cold" usually lives on the *high* temperature ladder: a cold day is a day whose high stayed low.

## Where your cover is measured

Every contract settles on a specific observation — `Central Park, New York`, `Chicago Midway, IL`, a station code like `CLIMIA`. The adapter parses it out of the contract's resolution rules and surfaces it on every quote, ladder and card.

This isn't decoration. The distance between that sensor and your front door is the geographic half of basis risk. A client who doesn't know where their cover is measured can't judge it, and public prediction markets have already seen settlement sources gamed.

## Fitting the loss instead of guessing it

The hardest number in the system is how much a business actually loses to weather. Asking the owner gets a figure they half remember. Their own daily revenue answers it.

```
$ weather fit --revenue takings.csv --location Chicago

Paired days:      884 of 884 revenue rows

Loss starts:      below 73.7°F
Sensitivity:      $134 per °F
Baseline revenue: $5617/day
Explained:        91% of revenue swings
```

The model is a hockey stick — revenue flat while the weather is fine, then falling at a constant rate past a threshold — because that is how these businesses describe the loss, and because its two parameters are exactly what cover needs: where the trigger belongs, and what a degree is worth.

The `Explained` figure is the one that decides whether to buy at all. At 91%, weather is the business. At 9%, something else is moving the till and cover would hedge a risk they don't have — the tool says so rather than selling anyway.

## Basis risk

A "Chicago Midway high < 70°" contract is a proxy for "nobody sat on my patio." The gap between the two is **basis risk**, and pretending it away sells cover that doesn't pay when the client actually gets hurt.

### Measured, not estimated

Scoring that gap by reasoning about it is a guess about something history can answer directly:

```
$ weather station-basis --station 41.786,-87.752 --premises 41.93,-87.64 \
    --threshold 72 --direction below

Days compared:      1461
Correlation:        0.991
Typical gap:        2.5°F (worst 14.3°F)
Trigger corr.:      0.896
Loss days:          991
Paid when fine:     0 days
```

Midway settles the Chicago contracts; the bar is nine miles away on the lakefront. The two track at **0.991 correlation** — which reads like a perfect hedge — but the contract crosses the trigger on only **89.6%** of the days the bar is actually hurting. A tenth of the loss days are uncovered, and no amount of reasoning about "same metro, same peril" would have surfaced that.

Correlation describes the whole distribution. A trigger only cares about one edge of it. That difference is the product.

One caveat worth stating: Open-Meteo's archive is gridded reanalysis, not the raw NWS station record the contract settles on. It measures the relationship between two places well, but it is not the settlement value itself — two points inside one grid cell will read as identical.

`computeBasisRisk` scores how much of the *real* loss a hedge neutralizes, decomposing it into **trigger correlation** (an explicit, reasoned estimate of P(contract pays | the loss happens) — never silently defaulted), **tenor alignment** (does it resolve inside the exposure window?), and **payout coverage**. It returns an effectiveness score, a verdict (`tight` / `workable` / `loose`), the dollars still exposed, and the dollars exposed purely to trigger mismatch.

Rather than eyeball the correlation, `estimateTriggerCorrelation` decomposes it into **geographic**, **peril** and **threshold** match, and multiplies them — the contract only pays on the loss if it matches on all three at once. The rationale names the weakest link.

When no single contract scores well, `composeBasket` spreads a budget across proxies that miss in different ways. Combined coverage assumes independent misses and is capped below 100%, so a basket never poses as a perfect hedge.

## Solving the cover, not budgeting for it

`priceCover` answers "I have $300, what does it buy?" — a trading question that is the wrong way round for insurance. Nobody decides how much fire cover to hold by picking a premium first; they start from the building.

`weather solve` starts from the loss. It sizes each rung to the loss expected on the days that rung pays, prices the result, and replays it on days the sizing never saw.

```
$ weather solve KXHIGHCHI-26AUG02 --revenue takings.csv \
    --premises 41.93,-87.64 --months 5,6,7,8,9

Attaches:         below 72.5°F
Premium:          $21.42 per day of cover
Cover limit:      $1,704 on the worst bucket
Worst day seen:   -$3,571, of which cover carries 48%

  70° or below         1704 contracts @ 1¢
  71° to 72°            438 contracts @ 1¢

  °F   loss      payout     net
    68  -$   623  +$  1704  $   1060
    71  -$   208  +$   438  $    209
  77.5  -$     0  +$     0  $    -21

Replayed on 153 held-out days: 46% smoother, paid on 33 of 51 days that hurt.
```

Sizing is an output here, not an input. The premium falls out of the loss.

That last table is the product in one view: what the day costs, what the cover returns, what's left. A good structure flattens the net column. It also shows the honest limitation of bucketed cover — the `70° or below` rung pays a flat amount whether it's 68° or 55°, so it overpays at the top of the bucket and underpays at the bottom. A step function approximating a slope.

**Sizing is solved because it can't be guessed.** Holding a flat count on every rung, the swing reduction runs 4% → 19% → 37% → **−1%** as the count climbs. Too little cover does nothing; too much turns the position into a bet that *adds* volatility. The optimum is interior and asymmetric — the deep-cold rung wants four times the contracts of the mild one, because the loss conditional on landing there is far larger.

Two guards come with it. Structures are sized on the earlier part of history and scored on a held-out tail, because sizing and scoring on the same days flatters every structure; when history is too short to split, the plan says so. And `priceCover` refuses outright to build a position whose payout would exceed the exposure it protects, naming the premium that fits instead. That rule lives in code rather than in a prompt, because a rule a model can talk itself out of is not a rule.

## Backtesting before you bind

With a fitted curve and both locations' history in hand, the structure can be replayed against the seasons that already happened. Rungs are sized to the loss each one stands in for, so the contract count is solved rather than guessed.

```
$ weather backtest KXHIGHCHI-26AUG02 --revenue takings.csv \
    --premises 41.93,-87.64 --months 5,6,7,8,9

Fitted loss:      below 72.5°F, $138/°F (R² 0.91)
Cover bought:     2 rungs, sized to each rung's own loss
  70° or below         1765 contracts @ 2¢
  71° to 72°            404 contracts @ 3¢

Replayed:         612 days
Weather losses:   $204,480
Cover paid:       $163,145 (80% of losses)
Premium spent:    $29,021

Daily swing:      $717 -> $405  (44% smoother)
Worst day:        -$3,806 -> -$2,089
Paid when hurt:   103 of 192 days (54%)
```

The headline is the **swing**, not the profit. A hedge is supposed to cost money on average; what it buys is a flatter year.

That makes the sizing failure mode visible, and it is not the one people expect. Holding a flat count on every rung, the swing reduction runs 4% → 19% → 37% → **−1%** as the count climbs. Too little cover does nothing; too much turns the position into a bet that *adds* volatility. The optimum is interior and asymmetric — here the deep-cold rung wants four times the contracts of the mild one, because the loss conditional on landing there is far larger. Solving it beat every flat count tried by hand.

One caveat: premium is charged at today's ask on every replayed day. Real prices moved with the season, so treat the loss ratio as indicative and the swing reduction — which depends only on realized weather — as the solid number.

## Cover is a cost

Premium spent in a season where the weather cooperated isn't a loss — it's the price of not carrying the risk. Two rules follow: never size cover above stated exposure (a position bigger than the loss it protects is a bet), and never sell a forecast.

Weather contracts are supplemental, parameterized cover. They don't substitute for property insurance or any mandated policy.

## Architecture

```
weather-cli/
├── packages/core/        # @weather/core — shared domain logic
│   ├── types.ts          # venue-neutral Market, Strike, Settlement, Ladder
│   ├── weather.ts        # peril / location / station taxonomy, shared by venues
│   ├── observations.ts   # Open-Meteo history + geocoding (free, no key)
│   ├── loss.ts           # fit a loss curve from revenue; parse the CSV
│   ├── geobasis.ts       # measured station-vs-premises trigger correlation
│   ├── backtest.ts       # replay a structure against past seasons; solve sizing
│   ├── cover.ts          # solve cover from a loss curve, priced as a premium
│   ├── hedge.ts          # price one contract as insurance; exposure invariant
│   ├── kalshi.ts         # Kalshi adapter (public HTTP, no credentials)
│   ├── polymarket.ts     # Polymarket adapter (public Gamma API, international)
│   ├── venue.ts          # Venue interface + registry + routing
│   ├── basis.ts          # computeBasisRisk / composeBasket
│   └── elicit.ts         # estimateTriggerCorrelation
├── apps/cli/             # @weather/cli — `weather` command
└── apps/web/             # @weather/web — Next.js 16 workbench + assistant
```

Revenue lands via `POST /api/revenue` and is stored as JSON under `.data/revenue/`, keyed by a hash of the file so re-uploading is idempotent. The id goes into the conversation; the rows never do — tools read them server-side, so a business's takings don't pass through a model's context to reach the function that needs them.

Tools exposed to the model: `fit_loss_curve`, `solve_cover`, `find_cover`, `list_events`, `get_ladder`, `find_contracts`, `get_market`, `compute_hedge_quote`, `estimate_correlation`, `measure_geographic_basis`, `assess_basis_risk`, `compose_basket`, `what_if`, `suggest_replies`.

## Running it

Requirements: **Node 22+** and **pnpm 10**. Both venues read over public HTTP, so there's nothing to configure for market data.

```bash
pnpm install
pnpm build

pnpm web    # chat broker at http://localhost:3000
pnpm check  # lint + typecheck + tests
```

`apps/web/.env.local` needs `DEEPSEEK_API_KEY` (the chat route uses `@ai-sdk/deepseek`). The app serves under `/weather`, so local dev is at `http://localhost:3000/weather`. Uploaded revenue is written to `.data/revenue/` (gitignored); set `REVENUE_DATA_DIR` to move it.

### CLI

```bash
weather cover --location Chicago --peril high_temp   # find series
weather events KXHIGHCHI                             # open dates
weather ladder KXHIGHCHI-26AUG02                     # the strike ladder
weather show KXHIGHCHI-26AUG02-B73.5                 # one contract + its rules
weather contracts --location Miami --peril rain      # skip straight to contracts

weather fit --revenue takings.csv --location Chicago       # fit your loss curve
weather station-basis --station "Chicago Midway" --premises "41.93,-87.64" \
  --threshold 72 --direction below                         # measure the real basis
weather solve KXHIGHCHI-26AUG02 --revenue takings.csv \
  --premises 41.93,-87.64 --months 5,6,7,8,9               # solve the cover
weather backtest KXHIGHCHI-26AUG02 --revenue takings.csv \
  --premises 41.93,-87.64 --months 5,6,7,8,9               # replay past seasons

weather quote KXHIGHCHI-26AUG02-B73.5 --side yes --budget 300 --exposure 10000

weather basis KXHIGHCHI-26AUG02-B73.5 --side yes --budget 300 --exposure 10000 \
  --loss "patio empties below 75" \
  --window-start 2026-08-01 --window-end 2026-08-31 \
  --correlation 0.7 --rationale "Midway tracks our neighborhood within a degree or two"
```

Add `--json` for machine-readable output, `--venue polymarket` to route elsewhere.

## What it doesn't do

It doesn't place trades. There's no wallet, no order routing and no position keeping.

That's deliberate for now. The measurements are the product — what the weather costs a business, and how much of that a given contract would actually have covered — and those are worth having whether or not anyone executes through here. Every contract links to its venue, so placing a position takes a minute in the client's own account.

## Stack

- **Runtime** — Node 22, ESM, TypeScript 6
- **Web** — Next.js 16, React 19, Tailwind 4, AI SDK 6, DeepSeek
- **CLI** — Commander 14
- **Data** — Kalshi (contracts), Open-Meteo archive + geocoding (weather history), both keyless
- **Core** — Zod 4, native `fetch`, no runtime dependencies beyond those
- **Checks** — oxlint, `tsc --noEmit`, vitest
