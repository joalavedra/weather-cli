# Roadmap

Agent-native weather cover for small businesses. The thesis: per-city weather contracts on a regulated exchange can serve as supplemental, parameterized cover for the niche, short-tenor risks traditional insurers won't write — provided the two hard problems are confronted rather than hidden: **basis risk** (the contract trigger rarely matches the real cost center) and **privacy** (public orderbooks leak the hedge).

## Shipped

- **Basis-risk engine** (`packages/core/src/basis.ts`). `computeBasisRisk` scores effectiveness as trigger correlation × tenor alignment × payout coverage, with residual-risk and basis-risk dollars broken out. `composeBasket` spreads a budget across proxy legs with independence-capped combined coverage.
- **Loss-function elicitation** (`packages/core/src/elicit.ts`). `estimateTriggerCorrelation` decomposes correlation into geographic × peril × threshold and names the weakest link.
- **Kalshi venue adapter** (`packages/core/src/kalshi.ts`). Public HTTP, no credentials. Series catalogue, open events, and full strike ladders normalized onto a venue-neutral `Market`. Kalshi's exclusive `less`/`greater` strike bounds are converted to the inclusive reading their own labels use, so a ladder can be shaped against a loss curve. Settlement station and source are parsed from contract rules and surfaced everywhere.
- **Venue routing** (`packages/core/src/venue.ts`). Kalshi by default, Polymarket for perils it doesn't list. Candidate series are ranked by cadence before fan-out, because Kalshi's catalogue carries dormant and superseded tickers next to live ones.
- **Weather-only scope.** Politics, sports, crypto and entertainment routing removed from the core, tools, prompt and docs. A broker that also writes Lakers futures reads as a betting app.
- **Checks.** `pnpm check` runs oxlint, `tsc --noEmit` across three packages, and vitest (67 tests).

## Next

- **Weather data.** The product has no weather data — only contracts. Open-Meteo's archive API is free and keyless. This unlocks the four things that make the cover defensible: fit the loss function from the client's own revenue history instead of interviewing for it, measure station-to-premises correlation empirically instead of hand-scoring it, backtest a structure against past seasons before binding, and sanity-check market-implied probability against the climatological base rate.
- **Insurance framing of the math.** `hedge.ts` still takes a budget and buys what it affords, returning ROI. Invert it: solve for the ladder that flattens the fitted loss curve, then report the premium. Outputs become premium, limit, attachment point, expected loss ratio. Enforce "never size above measured exposure" as a code invariant, not prompt text.
- **MCP server.** The tool layer is trapped in `apps/web/lib/tools.ts`. Extract it so one implementation serves MCP, HTTP and the CLI, and the client's own agent can buy cover.
- **Standing policies.** There is no `Policy` object — only one-shot quotes. Real cover renews, rolls, expires and settles. "Keep me covered for cold LA weekends through October, ≤$25/day" is a scheduled agent plus spend limits, and it's the difference between a demo and a product.
- **Kalshi execution.** Discovery and pricing are done; binding needs an API key with RSA request signing. `place_order` currently refuses non-Polymarket contracts rather than misrouting.
- **Settlement accounting.** After resolution, report loss vs payout vs realized basis. That's the dataset that makes correlation scoring credible, and nobody else publishes it.
- **Vertical templates.** Ice cream, patio bar, ski rental, landscaping, outdoor events, golf — each with a default peril, threshold and starting loss curve.

## Deferred

- **Privacy / pooling.** Public orderbooks can dox a business's hedge. Mitigation: route pooled positions through backend wallets so individual exposure isn't legible. Parked, kept here so it isn't lost.

## Known debt

- `--type-aware` linting flags `no-unsafe-type-assertion` across `Chat.tsx` and `WalletPanel.tsx`, where AI SDK tool outputs are narrowed from `unknown`. Fixing it properly means deriving those types from the tool schemas. The default `pnpm lint` gate is plain oxlint and is clean.
- `apps/web` still renders quotes in trading vocabulary ("Cost", "Shares"). That's part of the insurance-framing work above.
