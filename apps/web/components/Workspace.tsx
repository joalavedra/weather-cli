"use client";

import { useState } from "react";
import type { HedgeQuote } from "@weather/core";
import { WalletPanel } from "@/components/WalletPanel";

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

function fmtUsdShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

function MarketBlock({ market }: { market: MarketSummary }) {
  const tag = [market.category, market.city].filter(Boolean).join(" / ");
  const yesPrice = market.outcomePrices[0];
  const noPrice = market.outcomePrices[1];
  return (
    <div>
      {tag ? (
        <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-dim)] mb-1.5">
          {tag}
        </div>
      ) : null}
      <div className="text-[13px] text-[var(--text)] mb-3 leading-snug">
        {market.question}
      </div>
      <div className="t-odds">
        {market.outcomes.map((outcome, i) => {
          const price = market.outcomePrices[i];
          if (price === undefined) return null;
          const cls = i === 0 ? "yes" : "no";
          return (
            <div key={outcome} className={`t-odd ${cls}`}>
              <div className="label">{outcome}</div>
              <div className="price">{(price * 100).toFixed(1)}¢</div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-[var(--text-faint)] mt-2 flex justify-between tabular-nums">
        <span>
          {market.liquidity !== undefined ? `Liq ${fmtUsdShort(market.liquidity)}` : ""}
        </span>
        <span>
          {market.endDate ? `Ends ${market.endDate.slice(0, 10)}` : ""}
        </span>
      </div>
      {/* suppress unused */}
      <span className="hidden">{yesPrice}{noPrice}</span>
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
  const rows: Array<[string, string, string?]> = [
    ["Side", side.toUpperCase()],
    ["Price", `${(quote.yesPriceUsdc * 100).toFixed(1)}¢`],
    ["Cost", fmtUsd(quote.costBudgetUsdc)],
    ["Shares", quote.sharesAffordable.toFixed(2)],
    ["Max payout", fmtUsd(quote.maxPayoutUsdc)],
    [
      "If trigger",
      `+${fmtUsd(quote.profitIfYesUsdc)} (${quote.roiIfYesPct.toFixed(1)}%)`,
      "pos",
    ],
    [
      "If no hit",
      `-${fmtUsd(quote.costBudgetUsdc)} (${quote.roiIfNoPct.toFixed(1)}%)`,
      "neg",
    ],
  ];
  if (quote.exposureValueUsdc !== null && quote.coverageRatio !== null) {
    rows.push(
      ["Exposure", fmtUsd(quote.exposureValueUsdc)],
      [
        "Coverage",
        `${(quote.coverageRatio * 100).toFixed(1)}% / ${fmtUsdShort(quote.exposureValueUsdc)}`,
        "amber",
      ],
    );
  }
  return (
    <div className="t-quote mt-3">
      {rows.map(([label, value, cls]) => (
        <div key={label} className="t-row">
          <span className="k">{label}</span>
          <span className={`v ${cls ?? ""}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function ActiveCard({ active }: { active: Pin }) {
  if (active.kind === "market") {
    return (
      <div className="t-panel">
        <div className="t-panel-label mb-3">
          <span className="t-trade-tag">Pinned market</span>
          <span className="t-status-cyan">live</span>
        </div>
        <MarketBlock market={active.market} />
        <a className="t-link" href={active.market.url} target="_blank" rel="noreferrer">
          Open on Polymarket →
        </a>
      </div>
    );
  }
  if (active.kind === "quote") {
    return (
      <div className="t-panel">
        <div className="t-panel-label mb-3">
          <span className="t-trade-tag">Active trade</span>
          <span className="t-status-cyan">streaming</span>
        </div>
        <MarketBlock market={active.market} />
        <QuoteBlock side={active.side} quote={active.quote} />
        <a className="t-link" href={active.market.url} target="_blank" rel="noreferrer">
          Open on Polymarket →
        </a>
      </div>
    );
  }
  return (
    <div className="t-panel" style={{ borderColor: "var(--green)" }}>
      <div className="t-panel-label mb-3">
        <span style={{ color: "var(--green)" }}>Order placed</span>
        <span className="t-status-cyan">filled</span>
      </div>
      <div className="text-[13px] text-[var(--text)] mb-2">
        {active.marketQuestion}
      </div>
      <div className="t-row">
        <span className="k">Side</span>
        <span className="v">{active.side.toUpperCase()}</span>
      </div>
      <div className="t-row">
        <span className="k">Amount</span>
        <span className="v" style={{ color: "var(--amber)" }}>
          {fmtUsd(active.amountUsdc)}
        </span>
      </div>
      {active.orderId ? (
        <div className="t-row">
          <span className="k">Order ID</span>
          <span className="v text-[10px] break-all">
            {active.orderId.slice(0, 14)}…
          </span>
        </div>
      ) : null}
      {active.status ? (
        <div className="t-row">
          <span className="k">Status</span>
          <span className="v">{active.status}</span>
        </div>
      ) : null}
    </div>
  );
}

function HistoryRow({ pin }: { pin: Pin }) {
  if (pin.kind === "market") {
    return (
      <li className="text-[10.5px] text-[var(--text-dim)] truncate flex items-center gap-2">
        <span className="text-[var(--text-faint)]">›</span>
        <span className="truncate">{pin.market.question}</span>
      </li>
    );
  }
  if (pin.kind === "quote") {
    return (
      <li className="text-[10.5px] text-[var(--text-dim)] truncate flex items-center gap-2">
        <span className="text-[var(--text-faint)]">›</span>
        <span className="text-[var(--amber)] tabular-nums">
          {pin.side.toUpperCase()} {fmtUsdShort(pin.quote.costBudgetUsdc)}
        </span>
        <span className="truncate">{pin.market.question}</span>
      </li>
    );
  }
  return (
    <li className="text-[10.5px] truncate flex items-center gap-2">
      <span style={{ color: "var(--green)" }}>✓</span>
      <span className="text-[var(--green)] tabular-nums">
        {pin.side.toUpperCase()} {fmtUsdShort(pin.amountUsdc)}
      </span>
      <span className="text-[var(--text-dim)] truncate">{pin.marketQuestion}</span>
    </li>
  );
}

export function Workspace({ pins }: { pins: Pin[] }) {
  const [showHistory, setShowHistory] = useState(false);
  const active = pins.length > 0 ? pins[pins.length - 1] : null;
  const history = pins.slice(0, -1);

  return (
    <aside className="w-[380px] shrink-0 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col h-screen">
      <div className="px-4 py-3.5 border-b border-[var(--border)]">
        <div className="t-panel-label">
          <span>Workspace</span>
          <span className="t-pill live">live</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3.5 flex flex-col gap-3.5">
        <WalletPanel />
        {active ? <ActiveCard active={active} /> : null}
        {history.length > 0 ? (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="t-history-toggle"
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
        {!active ? (
          <div className="text-[12px] text-[var(--text-dim)] leading-relaxed">
            <span className="text-[var(--text-faint)]">›</span> Tell me what
            you want to hedge — the event, dollar amount at risk, and the time
            window. I&apos;ll size the trade and pin it here.
          </div>
        ) : null}
      </div>
    </aside>
  );
}
