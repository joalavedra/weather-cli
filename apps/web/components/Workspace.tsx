"use client";

import { useState } from "react";
import type { HedgeQuote } from "@weather/core";

interface MarketSummary {
  id: string;
  slug: string;
  question: string;
  category?: string;
  city?: string | null;
  liquidity?: number;
  outcomes: string[];
  outcomePrices: number[];
  endDate?: string | null;
  url: string;
}

export type Pin =
  | { kind: "market"; key: string; market: MarketSummary }
  | {
      kind: "quote";
      key: string;
      market: MarketSummary;
      side: "Yes" | "No";
      quote: HedgeQuote;
    }
  | {
      kind: "order";
      key: string;
      marketQuestion: string;
      side: "Yes" | "No";
      amountUsdc: number;
      orderId: string | null;
      status: string | null;
      filled: number | null;
    };

export interface WalletState {
  configured: boolean;
  address: string | null;
  usdcBalanceUsd: number | null;
  approvalsReady: boolean | null;
  geoblocked: boolean | null;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function WalletBadge({ wallet }: { wallet: WalletState | null }) {
  if (!wallet) {
    return (
      <div className="text-xs text-zinc-500 px-3 py-2 border border-dashed border-zinc-300 rounded">
        No wallet checked yet
      </div>
    );
  }
  if (wallet.geoblocked === true) {
    return (
      <div className="text-xs text-amber-700 px-3 py-2 bg-amber-50 border border-amber-200 rounded">
        Polymarket is geoblocked from this location.
      </div>
    );
  }
  if (!wallet.configured) {
    return (
      <div className="text-xs text-zinc-600 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded">
        No wallet configured.
      </div>
    );
  }
  return (
    <div className="text-xs px-3 py-2 bg-white border border-zinc-200 rounded space-y-0.5">
      <div className="flex justify-between">
        <span className="text-zinc-500">Wallet</span>
        <span className="font-mono">
          {wallet.address ? shortAddr(wallet.address) : "—"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-500">USDC</span>
        <span className="font-mono">
          {wallet.usdcBalanceUsd !== null
            ? fmtUsd(wallet.usdcBalanceUsd)
            : "—"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-500">Approvals</span>
        <span
          className={
            wallet.approvalsReady === true
              ? "text-emerald-700"
              : wallet.approvalsReady === false
                ? "text-amber-700"
                : "text-zinc-500"
          }
        >
          {wallet.approvalsReady === true
            ? "ready"
            : wallet.approvalsReady === false
              ? "needed"
              : "unknown"}
        </span>
      </div>
    </div>
  );
}

function MarketBlock({ market }: { market: MarketSummary }) {
  const tag = [market.category, market.city].filter(Boolean).join(" / ");
  return (
    <div>
      {tag ? (
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
          {tag}
        </div>
      ) : null}
      <div className="font-medium text-zinc-900 mb-2">{market.question}</div>
      <div className="grid grid-cols-2 gap-2 text-sm mb-2">
        {market.outcomes.map((outcome, i) => {
          const price = market.outcomePrices[i];
          if (price === undefined) return null;
          return (
            <div
              key={outcome}
              className="flex justify-between border border-zinc-100 rounded px-3 py-1.5 bg-zinc-50"
            >
              <span className="text-zinc-700">{outcome}</span>
              <span className="font-mono font-semibold">
                {(price * 100).toFixed(1)}¢
              </span>
            </div>
          );
        })}
      </div>
      <div className="text-xs text-zinc-500">
        {market.liquidity !== undefined
          ? `Liquidity ${fmtUsd(market.liquidity)}`
          : ""}
        {market.endDate ? ` · Ends ${market.endDate.slice(0, 10)}` : ""}
      </div>
    </div>
  );
}

function QuoteBlock({
  side,
  quote,
}: {
  side: "Yes" | "No";
  quote: HedgeQuote;
}) {
  const rows: Array<[string, string]> = [
    ["Side", side],
    ["YES price", `${(quote.yesPriceUsdc * 100).toFixed(1)}¢`],
    ["Cost", fmtUsd(quote.costBudgetUsdc)],
    ["Shares", quote.sharesAffordable.toFixed(2)],
    ["Max payout", fmtUsd(quote.maxPayoutUsdc)],
    [
      "If trigger",
      `+${fmtUsd(quote.profitIfYesUsdc)} (${quote.roiIfYesPct.toFixed(1)}%)`,
    ],
    [
      "If no hit",
      `-${fmtUsd(quote.costBudgetUsdc)} (${quote.roiIfNoPct.toFixed(1)}%)`,
    ],
  ];
  if (quote.exposureValueUsdc !== null && quote.coverageRatio !== null) {
    rows.push(
      ["Exposure", fmtUsd(quote.exposureValueUsdc)],
      ["Coverage", `${(quote.coverageRatio * 100).toFixed(1)}%`],
    );
  }
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-b border-zinc-100 last:border-0">
            <td className="py-1 text-zinc-600">{label}</td>
            <td className="py-1 text-right font-mono text-zinc-900">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ActiveCard({ active }: { active: Pin | null }) {
  if (!active) return null;
  if (active.kind === "market") {
    return (
      <div className="border border-zinc-200 rounded-lg p-4 bg-white shadow-sm space-y-3">
        <div className="text-xs uppercase tracking-wide text-zinc-400">
          Pinned market
        </div>
        <MarketBlock market={active.market} />
        <a
          href={active.market.url}
          target="_blank"
          rel="noreferrer"
          className="block text-sm text-blue-600 hover:underline font-medium"
        >
          Open on Polymarket →
        </a>
      </div>
    );
  }
  if (active.kind === "quote") {
    return (
      <div className="border border-zinc-200 rounded-lg p-4 bg-white shadow-sm space-y-3">
        <div className="text-xs uppercase tracking-wide text-zinc-400">
          Active trade
        </div>
        <MarketBlock market={active.market} />
        <div className="border-t border-zinc-100 pt-3">
          <QuoteBlock side={active.side} quote={active.quote} />
        </div>
        <a
          href={active.market.url}
          target="_blank"
          rel="noreferrer"
          className="block text-sm text-blue-600 hover:underline font-medium"
        >
          Open on Polymarket →
        </a>
      </div>
    );
  }
  return (
    <div className="border border-emerald-300 rounded-lg p-4 bg-emerald-50 shadow-sm space-y-2">
      <div className="text-xs uppercase tracking-wide text-emerald-700">
        Order placed
      </div>
      <div className="font-medium text-zinc-900">{active.marketQuestion}</div>
      <div className="text-sm text-zinc-700">
        Bought <strong>{active.side}</strong> · {fmtUsd(active.amountUsdc)}
      </div>
      <div className="text-xs font-mono text-zinc-500 break-all">
        {active.orderId ? `Order ${active.orderId}` : "Order ID pending"}
        {active.status ? ` · ${active.status}` : ""}
      </div>
    </div>
  );
}

function HistoryRow({ pin }: { pin: Pin }) {
  if (pin.kind === "market") {
    return (
      <li className="text-xs text-zinc-600 truncate">· {pin.market.question}</li>
    );
  }
  if (pin.kind === "quote") {
    return (
      <li className="text-xs text-zinc-600 truncate">
        · {pin.side} · {fmtUsd(pin.quote.costBudgetUsdc)} ·{" "}
        {pin.market.question}
      </li>
    );
  }
  return (
    <li className="text-xs text-emerald-700 truncate">
      ✓ {pin.side} · {fmtUsd(pin.amountUsdc)} · {pin.marketQuestion}
    </li>
  );
}

export function Workspace({
  pins,
  wallet,
}: {
  pins: Pin[];
  wallet: WalletState | null;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const active = pins.length > 0 ? pins[pins.length - 1] : null;
  const history = pins.slice(0, -1);

  return (
    <aside className="w-[380px] shrink-0 border-r border-zinc-200 bg-zinc-100/60 flex flex-col h-screen">
      <div className="px-4 py-4 border-b border-zinc-200 bg-white">
        <h2 className="text-sm font-semibold text-zinc-900 mb-2">Workspace</h2>
        <WalletBadge wallet={wallet} />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {history.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="text-xs text-zinc-500 hover:text-zinc-900 flex items-center gap-1"
            >
              <span>{showHistory ? "▾" : "▸"}</span>
              <span>History ({history.length})</span>
            </button>
            {showHistory ? (
              <ul className="mt-2 space-y-1">
                {history.map((p) => (
                  <HistoryRow key={p.key} pin={p} />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {active ? (
          <ActiveCard active={active} />
        ) : (
          <div className="text-sm text-zinc-500 leading-relaxed">
            Tell me what you want to hedge — the event, dollar amount at risk,
            and the time window. I&apos;ll size the trade and pin it here.
          </div>
        )}
      </div>
    </aside>
  );
}
