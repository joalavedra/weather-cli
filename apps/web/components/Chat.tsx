"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Markdown from "react-markdown";
import type { BasisAssessment, CoverQuote } from "@weather/core";
import { Workspace } from "@/components/Workspace";
import type { Pin } from "@/components/Workspace";

interface MarketSummary {
  id: string;
  venue?: string;
  question: string;
  peril?: string | null;
  location?: string | null;
  bucket?: string | null;
  prices?: { yesAsk: number; noAsk: number };
  openInterest?: number;
  endDate?: string | null;
  settlesAt?: string | null;
  settlementSource?: string | null;
  url: string;
}

interface QuoteToolOutput {
  market: MarketSummary;
  side: "Yes" | "No";
  quote: CoverQuote;
}

interface BasisToolOutput {
  market: MarketSummary;
  side: "Yes" | "No";
  quote: CoverQuote;
  basis: BasisAssessment;
}

interface BasketToolOutput {
  plan: {
    allocations: unknown[];
    combinedTriggerCoverage: number;
  };
}

interface OrderToolOutput {
  orderId: string | null;
  status: string | null;
  filled: number | null;
  marketQuestion: string;
  side: "Yes" | "No";
  amountUsdc: number;
}

function deriveState(messages: UIMessage[]): {
  pins: Pin[];
  inlineHints: Map<string, string[]>;
  activeSuggestions: string[];
} {
  const pins: Pin[] = [];
  const inlineHints = new Map<string, string[]>();
  let activeSuggestions: string[] = [];

  function addHint(messageId: string, hint: string) {
    const arr = inlineHints.get(messageId) ?? [];
    arr.push(hint);
    inlineHints.set(messageId, arr);
  }

  for (const m of messages) {
    if (m.role !== "assistant") continue;
    let partIdx = 0;
    for (const part of m.parts) {
      partIdx += 1;
      if (
        part.type === "tool-find_contracts" ||
        part.type === "tool-get_ladder" ||
        part.type === "tool-get_market"
      ) {
        if (part.state !== "output-available") continue;
        const out = part.output as
          | {
              markets?: MarketSummary[];
              market?: MarketSummary;
              ladder?: { rungs?: MarketSummary[] };
            }
          | undefined;
        const markets =
          out?.markets ?? out?.ladder?.rungs ?? (out?.market ? [out.market] : []);
        for (const market of markets) {
          pins.push({
            kind: "market",
            key: `${m.id}-${partIdx}-${market.id}`,
            market,
          });
        }
        if (markets.length > 0) {
          addHint(
            m.id,
            markets.length === 1
              ? `pinned: ${markets[0]?.question ?? ""}`
              : `pinned ${markets.length} contracts`,
          );
        }
      } else if (part.type === "tool-compute_hedge_quote") {
        if (part.state !== "output-available") continue;
        const out = part.output as QuoteToolOutput;
        pins.push({
          kind: "quote",
          key: `${m.id}-${partIdx}`,
          market: out.market,
          side: out.side,
          quote: out.quote,
        });
        addHint(
          m.id,
          `pinned cover · ${out.side} · $${out.quote.premiumUsdc.toFixed(0)} premium`,
        );
      } else if (part.type === "tool-estimate_correlation") {
        if (part.state !== "output-available") continue;
        const out = part.output as {
          estimate: { value: number; weakest: string };
        };
        addHint(
          m.id,
          `correlation ~${Math.round(out.estimate.value * 100)}% · weakest: ${out.estimate.weakest}`,
        );
      } else if (part.type === "tool-assess_basis_risk") {
        if (part.state !== "output-available") continue;
        const out = part.output as BasisToolOutput;
        pins.push({
          kind: "basis",
          key: `${m.id}-${partIdx}`,
          market: out.market,
          side: out.side,
          quote: out.quote,
          basis: out.basis,
        });
        addHint(
          m.id,
          `basis · ${out.basis.verdict} · ${Math.round(out.basis.effectivenessScore * 100)}% effective`,
        );
      } else if (part.type === "tool-compose_basket") {
        if (part.state !== "output-available") continue;
        const out = part.output as BasketToolOutput;
        addHint(
          m.id,
          `basket · ${out.plan.allocations.length} legs · ${Math.round(out.plan.combinedTriggerCoverage * 100)}% coverage`,
        );
      } else if (part.type === "tool-what_if") {
        if (part.state !== "output-available") continue;
        addHint(m.id, "what-if computed");
      } else if (part.type === "tool-find_cover") {
        if (part.state !== "output-available") continue;
        const out = part.output as { series?: unknown[] };
        addHint(m.id, `found ${out.series?.length ?? 0} cover series`);
      } else if (part.type === "tool-list_events") {
        if (part.state !== "output-available") continue;
        addHint(m.id, "listed open dates");
      } else if (part.type === "tool-wallet_status") {
        if (part.state !== "output-available") continue;
        addHint(m.id, "checked wallet");
      } else if (part.type === "tool-setup_wallet") {
        if (part.state !== "output-available") continue;
        const out = part.output as { address: string };
        addHint(
          m.id,
          `wallet created · ${out.address.slice(0, 6)}…${out.address.slice(-4)}`,
        );
      } else if (part.type === "tool-run_approvals") {
        if (part.state !== "output-available") continue;
        addHint(m.id, "approvals submitted");
      } else if (part.type === "tool-place_order") {
        if (part.state !== "output-available") continue;
        const out = part.output as OrderToolOutput;
        pins.push({
          kind: "order",
          key: `${m.id}-${partIdx}`,
          marketQuestion: out.marketQuestion,
          side: out.side,
          amountUsdc: out.amountUsdc,
          orderId: out.orderId,
          status: out.status,
          filled: out.filled,
        });
        addHint(m.id, `order placed · ${out.side} · $${out.amountUsdc}`);
      } else if (part.type === "tool-get_positions") {
        if (part.state !== "output-available") continue;
        addHint(m.id, "fetched positions");
      } else if (part.type === "tool-suggest_replies") {
        if (part.state !== "output-available") continue;
        const out = part.output as { replies: string[] };
        if (Array.isArray(out.replies)) {
          activeSuggestions = out.replies;
        }
      }
    }
  }

  // Suggestions only valid if the last message is the assistant turn that emitted them.
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "assistant") {
    activeSuggestions = [];
  }

  return { pins, inlineHints, activeSuggestions };
}

function AssistantText({ text }: { text: string }) {
  return (
    <div className="t-msg-assistant">
      <Markdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

function InlineHints({ hints }: { hints: string[] }) {
  if (hints.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {hints.map((h, i) => (
        <span
          key={i}
          className={`t-hint ${h.startsWith("pinned") || h.startsWith("order") ? "amber" : ""}`}
        >
          {h}
        </span>
      ))}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    function tick() {
      const d = new Date();
      const h = d.getUTCHours().toString().padStart(2, "0");
      const m = d.getUTCMinutes().toString().padStart(2, "0");
      const s = d.getUTCSeconds().toString().padStart(2, "0");
      setNow(`${h}:${m}:${s} UTC`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;
  return (
    <div className="text-[10px] text-[var(--text-faint)] tracking-[0.1em] flex items-center gap-2">
      <span className="text-[var(--cyan)]">●</span>
      <span>{now}</span>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);
  useEffect(() => {
    const t =
      document.documentElement.getAttribute("data-theme") === "light"
        ? "light"
        : "dark";
    setTheme(t);
  }, []);
  function flip() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      if (next === "light") {
        document.documentElement.setAttribute("data-theme", "light");
        localStorage.setItem("hb-theme", "light");
      } else {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("hb-theme", "dark");
      }
    } catch {
      // ignore storage failures
    }
  }
  if (theme === null) {
    return <div className="t-theme-toggle" aria-hidden style={{ visibility: "hidden" }} />;
  }
  return (
    <button
      type="button"
      onClick={flip}
      className="t-theme-toggle"
      title={theme === "light" ? "Switch to dark" : "Switch to light"}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === "light" ? (
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <line x1="12" y1="2" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22" />
            <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
            <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
            <line x1="2" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
            <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
          </>
        )}
      </svg>
    </button>
  );
}

interface DatasetSummary {
  id: string;
  days: number;
  start: string;
  end: string;
  meanDailyRevenue: number;
}

/**
 * Upload daily takings so the broker can fit a loss curve.
 *
 * The dataset id goes into the conversation but the rows never do — the tools
 * read them server-side. A business's revenue history is not something to pass
 * through a model's context to reach the function that needs it.
 */
function RevenueUpload({
  onLoaded,
  disabled,
}: {
  onLoaded: (dataset: DatasetSummary) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/revenue", { method: "POST", body });
      const payload = (await response.json()) as
        | { dataset: DatasetSummary }
        | { error: string };
      if ("error" in payload) {
        setError(payload.error);
        return;
      }
      onLoaded(payload.dataset);
    } catch {
      setError("upload failed — is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="t-upload-btn" aria-disabled={disabled || busy}>
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          disabled={disabled || busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
        {busy ? "reading…" : "+ revenue CSV"}
      </label>
      {error ? <span className="text-[10px] text-[var(--neg)]">{error}</span> : null}
    </div>
  );
}

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  function onRevenueLoaded(dataset: DatasetSummary) {
    void sendMessage({
      text:
        `I've uploaded my daily revenue: dataset ${dataset.id}, ` +
        `${dataset.days} days from ${dataset.start} to ${dataset.end}, ` +
        `averaging $${Math.round(dataset.meanDailyRevenue)}/day.`,
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim()) return;
    void sendMessage({ text: input });
    setInput("");
  }

  const { pins, inlineHints, activeSuggestions } = deriveState(messages);
  const isBusy = status === "submitted" || status === "streaming";

  function pickSuggestion(text: string) {
    if (isBusy) return;
    void sendMessage({ text });
  }

  return (
    <div className="flex h-screen">
      <Workspace pins={pins} />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-6 py-3.5 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg)]">
          <div className="flex items-center gap-3">
            <div className="t-glyph">▮</div>
            <div>
              <h1 className="t-h1">WEATHER COVER</h1>
              <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
                Parametric weather insurance for small businesses
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Clock />
            <ThemeToggle />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-3.5">
          {messages.length === 0 ? (
            <Welcome onPick={(text) => void sendMessage({ text })} />
          ) : (
            messages.map((m) => {
              const hints = inlineHints.get(m.id) ?? [];
              const text = m.parts
                .filter((p) => p.type === "text")
                .map((p) => (p as { type: "text"; text: string }).text)
                .join("");
              if (m.role === "user") {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="t-msg-user max-w-[78%]">{text}</div>
                  </div>
                );
              }
              return (
                <div key={m.id} className="flex justify-start">
                  <div className="max-w-[85%]">
                    {text ? <AssistantText text={text} /> : null}
                    <InlineHints hints={hints} />
                  </div>
                </div>
              );
            })
          )}
          {isBusy ? (
            <div className="text-[10px] text-[var(--text-dim)] tracking-[0.18em] uppercase italic">
              streaming…
            </div>
          ) : null}
        </div>
        <div className="px-6 pt-3 pb-0">
          {activeSuggestions.length > 0 && !isBusy ? (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {activeSuggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="t-suggest-pill"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <form onSubmit={onSubmit} className="px-6 pb-4 border-t border-[var(--border)] pt-4">
          <div className="t-composer">
            <span className="t-composer-caret">›</span>
            <input
              className="t-composer-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="what weather costs you money? · e.g. cold weekends empty our patio"
              disabled={isBusy}
            />
            <button type="submit" className="t-send-btn" disabled={!input.trim() || isBusy}>
              Send
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <RevenueUpload onLoaded={onRevenueLoaded} disabled={isBusy} />
            <span className="text-[10px] text-[var(--text-faint)]">
              date,revenue — your takings never leave the server
            </span>
          </div>
        </form>
      </main>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  const examples = [
    "Cold weekends empty our patio in Chicago — what can I do?",
    "I run an ice cream shop. How much does a cool July cost me?",
    "Rain kills our outdoor events in Miami. Is there cover for that?",
    "What weather contracts settle near Denver?",
  ];
  return (
    <div className="space-y-3">
      <p className="text-[var(--text-2)] leading-relaxed text-[13px]">
        Parametric weather cover for small businesses, priced on Kalshi. Tell me
        what weather costs you money. Upload a year of daily takings and
        I&apos;ll measure what it actually costs, then size cover against it.
      </p>
      <ul className="space-y-1.5 mt-3">
        {examples.map((ex) => (
          <li key={ex}>
            <button
              type="button"
              onClick={() => onPick(ex)}
              className="w-full text-left border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[12px] text-[var(--text-2)] hover:border-[var(--amber-dim)] hover:text-[var(--amber)] hover:bg-[var(--panel-2)] transition-colors cursor-pointer font-[inherit]"
            >
              <span className="text-[var(--text-faint)] mr-2">›</span>
              {ex}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
