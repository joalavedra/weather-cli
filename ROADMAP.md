# Roadmap

Agent-native weather cover for small businesses. The thesis: per-city weather contracts on a regulated exchange can serve as supplemental, parameterized cover for the niche, short-tenor risks traditional insurers won't write — provided the two hard problems are confronted rather than hidden: **basis risk** (the contract trigger rarely matches the real cost center) and **privacy** (public orderbooks leak the hedge).

## Shipped

- **Basis-risk engine** (`packages/core/src/basis.ts`). `computeBasisRisk` scores effectiveness as trigger correlation × tenor alignment × payout coverage, with residual-risk and basis-risk dollars broken out. `composeBasket` spreads a budget across proxy legs with independence-capped combined coverage.
- **Loss-function elicitation** (`packages/core/src/elicit.ts`). `estimateTriggerCorrelation` decomposes correlation into geographic × peril × threshold and names the weakest link.
- **Kalshi venue adapter** (`packages/core/src/kalshi.ts`). Public HTTP, no credentials. Series catalogue, open events, and full strike ladders normalized onto a venue-neutral `Market`. Kalshi's exclusive `less`/`greater` strike bounds are converted to the inclusive reading their own labels use, so a ladder can be shaped against a loss curve. Settlement station and source are parsed from contract rules and surfaced everywhere.
- **Venue routing** (`packages/core/src/venue.ts`). Kalshi by default, Polymarket for perils it doesn't list. Candidate series are ranked by cadence before fan-out, because Kalshi's catalogue carries dormant and superseded tickers next to live ones.
- **Weather-only scope.** Politics, sports, crypto and entertainment routing removed from the core, tools, prompt and docs. A broker that also writes Lakers futures reads as a betting app.
- **Weather data** (`observations.ts`, `loss.ts`, `geobasis.ts`). Open-Meteo archive and geocoding, free and keyless. `fitLossCurve` recovers the threshold and dollars-per-degree from a business's own daily revenue, reporting how much of the revenue swing weather explains at all — a weak fit means cover isn't warranted, and the tool says so. `measureGeographicBasis` compares the settlement station against the premises over years of history and returns the *measured* trigger correlation.
- **Measured basis beats estimated basis.** Chicago Midway and a lakefront bar nine miles away correlate at 0.991 but the contract catches only 89.6% of the bar's loss days. Correlation describes the whole distribution; a trigger cares about one edge. The `measure_geographic_basis` tool now feeds `assess_basis_risk`, and the prompt falls back to `estimate_correlation` only where nothing is measurable.
- **Checks.** `pnpm check` runs oxlint, `tsc --noEmit` across three packages, and vitest (149 tests).

- **Backtest and solved sizing** (`backtest.ts`). Replays a structure over past seasons and reports the change in daily swing, the loss ratio, the worst day, and how many of the days that actually hurt the cover paid on. `sizeLegsFromHistory` sets each rung's contract count to the loss expected on the days that rung pays, which beat every flat count tried by hand (44% swing reduction against a best-manual 37%).
- **Overhedging is visible and real.** At a flat count, swing reduction runs 4% → 19% → 37% → −1% as size climbs: too much cover adds volatility rather than removing it. The optimum is interior and asymmetric across rungs, which is the case for solving sizing instead of exposing it as a knob.

- **Cover solved from the loss** (`cover.ts`, rewritten `hedge.ts`). `solveCover` starts from the fitted curve rather than a budget: it sizes each rung to the loss expected on the days that rung pays, prices it as a premium, and returns a `coverProfile` showing loss, payout and net across outcomes. Quotes now carry premium, contracts, limit and net-if-triggered, and no return figure at all.
- **The exposure invariant is enforced in code.** `priceCover` refuses a position whose payout would exceed stated exposure and names the premium that fits. Previously this was prompt text, which a model can talk itself out of.
- **Out-of-sample evaluation.** Structures are sized on the earlier part of history and scored on a held-out tail. Sizing and scoring on the same days flatters every structure; when history is too short to split, `outOfSample` is false and the plan warns.

- **Revenue upload in the chat broker.** `POST /api/revenue` parses and stores a `date,revenue` CSV keyed by a hash of the file; the `fit_loss_curve` and `solve_cover` tools take the id and read the rows server-side, so takings never pass through the model's context. Closes the gap that made the analysis CLI-only. The parser moved into core and now survives currency symbols, thousands separators, CRLF and extra columns.

## Next
- **Revenue upload in the web app.** Loss fitting is CLI-only today because it needs a CSV. The chat broker needs a file drop before an owner can use it.
- **Fair-value check.** Compare the market-implied probability of a rung against the climatological base rate from the same archive, so a client can see whether cover is cheap or dear.
- **Backtest tool for the chat broker.** `solve_cover` carries a replay, but there's no way to replay an arbitrary hand-built structure from chat the way `weather backtest` can.
- **Historical prices.** Premium is charged at today's ask on every replayed day. Kalshi publishes candlesticks per market; using them would make the loss ratio trustworthy rather than indicative.
- **MCP server.** The tool layer is trapped in `apps/web/lib/tools.ts`. Extract it so one implementation serves MCP, HTTP and the CLI, and the client's own agent can buy cover.
- **Standing policies.** There is no `Policy` object — only one-shot quotes. Real cover renews, rolls, expires and settles. "Keep me covered for cold LA weekends through October, ≤$25/day" is a scheduled agent plus spend limits, and it's the difference between a demo and a product.
- **Kalshi execution.** Discovery and pricing are done; binding needs an API key with RSA request signing. `place_order` currently refuses non-Polymarket contracts rather than misrouting.
- **Settlement accounting.** After resolution, report loss vs payout vs realized basis. That's the dataset that makes correlation scoring credible, and nobody else publishes it.
- **Vertical templates.** Ice cream, patio bar, ski rental, landscaping, outdoor events, golf — each with a default peril, threshold and starting loss curve.
- **Station-grade observations.** Open-Meteo's archive is gridded reanalysis, not the NWS station record contracts settle on. It measures the relationship between two places well, but two points in one grid cell read as identical. GHCN or the NWS API would give the true station series.

## Deferred

- **Privacy / pooling.** Public orderbooks can dox a business's hedge. Mitigation: route pooled positions through backend wallets so individual exposure isn't legible. Parked, kept here so it isn't lost.

- Uploaded revenue is stored unencrypted with no user model, no expiry and no access control — the id is the only thing gating it. Fine for a single-tenant demo, not for real clients.
- On serverless the store falls back to the system temp directory, which is per-instance and ephemeral: an upload and a later tool call can land on different lambdas and the dataset won't be found. Needs blob storage or a database to be reliable in production. `REVENUE_DATA_DIR` points it at a real disk when one exists.

## Known limitations

- "Cold hurts me" usually belongs on the *high* temperature ladder rather than the low one — a cold day is a day whose high stayed low. The prompt says so, but peril routing doesn't yet derive this from the fitted curve, and a `low_temp` filter can miss live cover.

## Known debt

- `--type-aware` linting flags `no-unsafe-type-assertion` across `Chat.tsx` and `WalletPanel.tsx`, where AI SDK tool outputs are narrowed from `unknown`. Fixing it properly means deriving those types from the tool schemas. The default `pnpm lint` gate is plain oxlint and is clean.
- Bucketed cover approximates a sloped loss with a step function, so it overpays at the top of a bucket and underpays at the bottom. Visible in `coverProfile`; narrower rungs would reduce it.
