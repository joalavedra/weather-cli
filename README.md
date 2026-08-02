# Weather cover for small businesses

Businesses lose money when the weather turns. An ice cream shop takes ~20% less on a cold weekend; a patio bar empties in the rain; a landscaper stops billing in a freeze. Large firms have hedged this on weather derivatives since the late 1990s. Small ones never could — until per-city weather contracts started listing on regulated exchanges.

This is a broker for that. Describe the weather that costs you money, and it finds the contracts that pay when it happens, sizes them against your actual exposure, and tells you honestly how much of your real loss the cover neutralizes.

It is agent-native by design: everything the chat UI can do is a tool call over one shared domain core, so an agent can reach the same outcomes a person can.

## Venues

**Kalshi** is the default. It's a CFTC-designated contract market listing 291 series under Climate and Weather — per-city daily high and low temperature ladders, hourly directional temperature, rainfall, snowfall, hurricane landfall. Market data is public, so discovery and pricing need no credentials.

**Polymarket** remains wired up for perils Kalshi doesn't list, and is currently the only venue with order placement implemented.

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

## Basis risk

A "Chicago Midway high < 70°" contract is a proxy for "nobody sat on my patio." The gap between the two is **basis risk**, and pretending it away sells cover that doesn't pay when the client actually gets hurt.

`computeBasisRisk` scores how much of the *real* loss a hedge neutralizes, decomposing it into **trigger correlation** (an explicit, reasoned estimate of P(contract pays | the loss happens) — never silently defaulted), **tenor alignment** (does it resolve inside the exposure window?), and **payout coverage**. It returns an effectiveness score, a verdict (`tight` / `workable` / `loose`), the dollars still exposed, and the dollars exposed purely to trigger mismatch.

Rather than eyeball the correlation, `estimateTriggerCorrelation` decomposes it into **geographic**, **peril** and **threshold** match, and multiplies them — the contract only pays on the loss if it matches on all three at once. The rationale names the weakest link.

When no single contract scores well, `composeBasket` spreads a budget across proxies that miss in different ways. Combined coverage assumes independent misses and is capped below 100%, so a basket never poses as a perfect hedge.

## Cover is a cost

Premium spent in a season where the weather cooperated isn't a loss — it's the price of not carrying the risk. Two rules follow: never size cover above stated exposure (a position bigger than the loss it protects is a bet), and never sell a forecast.

Weather contracts are supplemental, parameterized cover. They don't substitute for property insurance or any mandated policy.

## Architecture

```
weather-cli/
├── packages/core/        # @weather/core — shared domain logic
│   ├── types.ts          # venue-neutral Market, Strike, Settlement, Ladder
│   ├── weather.ts        # peril / location / station taxonomy, shared by venues
│   ├── kalshi.ts         # Kalshi adapter (public HTTP, no credentials)
│   ├── polymarket.ts     # Polymarket adapter (wraps the `polymarket` CLI)
│   ├── venue.ts          # Venue interface + registry + routing
│   ├── hedge.ts          # sizing and coverage math
│   ├── basis.ts          # computeBasisRisk / composeBasket
│   ├── elicit.ts         # estimateTriggerCorrelation
│   └── trading.ts        # Polymarket wallet, approvals, orders
├── apps/cli/             # @weather/cli — `weather` command
└── apps/web/             # @weather/web — Next.js 16 chat broker
```

Tools exposed to the model: `find_cover`, `list_events`, `get_ladder`, `find_contracts`, `get_market`, `compute_hedge_quote`, `estimate_correlation`, `assess_basis_risk`, `compose_basket`, `what_if`, `wallet_status`, `setup_wallet`, `run_approvals`, `place_order`, `get_positions`, `suggest_replies`.

## Running it

Requirements: **Node 22+** and **pnpm 10**. Kalshi discovery works with no further setup. Polymarket needs the [`polymarket` CLI](https://github.com/Polymarket) on `$PATH` (or `POLYMARKET_BIN` set).

```bash
pnpm install
pnpm build

pnpm web    # chat broker at http://localhost:3000
pnpm check  # lint + typecheck + tests
```

`apps/web/.env.local` needs `DEEPSEEK_API_KEY` (the chat route uses `@ai-sdk/deepseek`).

### CLI

```bash
weather cover --location Chicago --peril high_temp   # find series
weather events KXHIGHCHI                             # open dates
weather ladder KXHIGHCHI-26AUG02                     # the strike ladder
weather show KXHIGHCHI-26AUG02-B73.5                 # one contract + its rules
weather contracts --location Miami --peril rain      # skip straight to contracts

weather quote KXHIGHCHI-26AUG02-B73.5 --side yes --budget 300 --exposure 10000

weather basis KXHIGHCHI-26AUG02-B73.5 --side yes --budget 300 --exposure 10000 \
  --loss "patio empties below 75" \
  --window-start 2026-08-01 --window-end 2026-08-31 \
  --correlation 0.7 --rationale "Midway tracks our neighborhood within a degree or two"
```

Add `--json` for machine-readable output, `--venue polymarket` to route elsewhere.

## Placing cover

Order placement is implemented for Polymarket only. Kalshi contracts are discoverable and priceable, but binding them needs an API key with RSA request signing, which isn't wired up — `place_order` refuses non-Polymarket contracts rather than routing to the wrong venue.

For Polymarket, trades cost real USDC and the broker walks through wallet setup, funding, approvals, and an explicit confirmation before placing. It never claims an order landed unless `place_order` returned an `orderId`.

## Stack

- **Runtime** — Node 22, ESM, TypeScript 6
- **Web** — Next.js 16, React 19, Tailwind 4, AI SDK 6, DeepSeek
- **CLI** — Commander 14
- **Core** — Zod 4, native `fetch` for Kalshi, `execa` for the Polymarket binary
- **Checks** — oxlint, `tsc --noEmit`, vitest
