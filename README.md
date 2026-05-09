# Hedge Broker

A chat-based insurance broker that hedges any event risk Polymarket prices — politics, sports, crypto, weather, business — and places the trade for you.

You describe what you're trying to insure. The broker asks the right intake questions, finds a market, sizes the position (cost, max payout, ROI both ways, coverage ratio), and — once you confirm — places a market-buy on Polymarket using your funded wallet.

## Layout

```
apps/
  web/    Next.js 16 chat broker UI (DeepSeek + AI SDK + tool calls)
  cli/    terminal browser for weather markets and hedge math
packages/
  core/   Polymarket client, market classification, hedge math, trading
          (wraps the official polymarket Rust CLI)
```

## Prerequisites

- Node 22+, pnpm 10+
- The official [polymarket Rust CLI](https://github.com/Polymarket/polymarket-cli):

  ```bash
  brew tap Polymarket/polymarket-cli https://github.com/Polymarket/polymarket-cli
  brew install polymarket
  ```

- A DeepSeek API key for the chat broker (`DEEPSEEK_API_KEY`)
- For trading: a Polygon-funded wallet (USDC + a little MATIC for gas). The web app creates the wallet for you — see _Trading_ below.

## Setup

```bash
pnpm install
cp /dev/null apps/web/.env.local
echo "DEEPSEEK_API_KEY=sk-..." >> apps/web/.env.local
pnpm -r build
```

## CLI

Browse weather markets and compute hedge math without trading:

```bash
pnpm cli cities                           # list cities with markets
pnpm cli city Madrid                      # markets for a specific city
pnpm cli list --limit 5                   # all weather markets, top 5
pnpm cli show <slug>                      # market detail
pnpm cli quote <slug> --side yes --budget 100 --exposure 1000
pnpm cli hedge --yes-price 0.25 --budget 100 --exposure 1000  # what-if
```

## Web app

```bash
pnpm web
# http://localhost:3000
```

The UI is two panes:

- **Workspace** (left). On first load, auto-creates a Polymarket trading wallet via the polymarket CLI, then shows a QR code + address for funding. Active markets and trades pin here. Wallet balance polls every 10 seconds.
- **Chat** (right). Streams the broker's reasoning. Markdown-rendered. Tool result cards do not appear inline — they pin to the Workspace.

### Trading flow

1. Open the app. The Workspace creates a wallet if you don't have one.
2. Send USDC to the **proxy address** shown (with `signature_type: proxy`, the default, this is where Polymarket holds collateral). Send a little MATIC to the signer EOA shown next to it.
3. Tell the broker what you want to hedge (event + dollar amount + window). Example: _"Hedge $500 if BTC closes below $90k by year-end."_
4. The broker finds a market, runs `compute_hedge_quote`, and pins the trade card.
5. Confirm in chat ("place it"). The broker checks wallet status, runs approvals if needed (~6 on-chain transactions), and places the market order via `polymarket clob market-order`.
6. Order receipt pins to the Workspace.

### Caveats

- **Real money.** Mainnet only — Polymarket has no testnet. Start with $1–$5 trades.
- **Geoblock.** Polymarket geoblocks some jurisdictions (notably the US). The wallet panel surfaces this; trades will fail if you're blocked.
- **Single wallet, single user.** The polymarket CLI manages one key in `~/.config/polymarket/config.json`. The web app is a self-hosted, single-user tool — don't expose it publicly.
- **Min order size.** Most Polymarket markets have an `orderMinSize` of $1–$5.

## Development

```bash
pnpm -r typecheck   # all workspaces
pnpm -r build       # all workspaces
```

`@weather/core` shells out to the `polymarket` binary for both reads (markets, prices) and writes (wallet, approvals, orders). Override the binary path with `POLYMARKET_BIN=/path/to/polymarket` if needed.

## Project name

`weather-cli` is historical — the original scope was weather hedging. The broker now covers any Polymarket event. The package and repo names stay for continuity.
