# Roadmap

stable-insurance is a parametric-insurance broker built on Polymarket. The thesis: prediction markets can serve as supplemental, parameterized hedging for SMBs — covering niche, short-tenor risks traditional insurers won't write — provided the two hard problems are confronted head-on, not hidden: **basis risk** (the market trigger rarely matches the real cost center) and **privacy** (public orderbooks leak the hedge).

## Shipped

- **Basis-risk engine** (`packages/core/src/basis.ts`). `computeBasisRisk` scores hedge effectiveness as trigger correlation × tenor alignment × payout coverage, with residual-risk and basis-risk dollars broken out. `composeBasket` spreads a budget across proxy legs (independence-capped combined coverage). Surfaced as the `assess_basis_risk` / `compose_basket` tools, a `weather basis` CLI command, and a Workspace basis card.

## In progress

- **Loss-function elicitation**. A structured flow that extracts the client's real loss (event, dollar exposure, risk window) and decomposes trigger correlation into legible factors — geographic, peril, and threshold match — instead of the broker eyeballing a single number.

## Next

- **Openfort-native UX**. The settlement *rail* is already USDC end to end (Polymarket collateral is USDC; quotes, orders, and payouts are all dollars — see `packages/core/src/trading.ts`). What's missing is removing the crypto-native friction sitting on top of it: today the client still funds MATIC for gas, runs ~6 on-chain approvals on Polygon, and a raw private key is written to `~/.config/polymarket/config.json`. Replace that with an Openfort embedded/backend wallet (no key handling), a paymaster to sponsor gas (no MATIC), and the policy engine gating trades — plus a semantic relabel of cost → **premium** and max payout → **claim/payout**. Goal: the SMB sees "pay a premium in USD, get a payout when it triggers," never a chain.
- **Logistics-weather pilot**. Run real parametric hedges to settlement and measure *realized* basis — the dataset that makes correlation scoring credible.

## Deferred

- **Privacy / pooling**. Public Polymarket orderbooks can dox an SMB's hedge (cf. the surfaced NYC-bar hedge). Mitigation: route pooled positions through backend wallets so individual exposure isn't legible. The Openfort-native angle — embedded/backend wallets plus a policy engine orchestrating the pool. Parked for now; kept here so it isn't lost.
