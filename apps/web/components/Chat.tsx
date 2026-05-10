"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Markdown from "react-markdown";
import type { HedgeQuote } from "@weather/core";
import { Workspace } from "@/components/Workspace";
import type { Pin } from "@/components/Workspace";

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

interface QuoteToolOutput {
  market: MarketSummary;
  side: "Yes" | "No";
  quote: HedgeQuote;
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
        part.type === "tool-search_weather_markets" ||
        part.type === "tool-search_markets" ||
        part.type === "tool-get_market"
      ) {
        if (part.state !== "output-available") continue;
        const out = part.output as
          | { markets?: MarketSummary[]; market?: MarketSummary }
          | undefined;
        const markets = out?.markets ?? (out?.market ? [out.market] : []);
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
              : `pinned ${markets.length} markets`,
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
          `pinned trade · ${out.side} · $${out.quote.costBudgetUsdc.toFixed(0)}`,
        );
      } else if (part.type === "tool-what_if") {
        if (part.state !== "output-available") continue;
        addHint(m.id, "what-if computed");
      } else if (part.type === "tool-list_cities") {
        if (part.state !== "output-available") continue;
        addHint(m.id, "checked city inventory");
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

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

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
              <h1 className="t-h1">HEDGE BROKER</h1>
              <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
                Polymarket event-risk insurance
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
              placeholder="describe the risk · e.g. hedge $10k if BTC closes below 90k"
              disabled={isBusy}
            />
            <button type="submit" className="t-send-btn" disabled={!input.trim() || isBusy}>
              Send
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  const examples = [
    "Outdoor wedding in Madrid Saturday, $5k at risk if patio is too cold.",
    "$10k crypto treasury — hedge me if BTC closes below $90k by year-end.",
    "I'm long a sports-betting startup. Hedge $3k if the Super Bowl is a blowout.",
    "Pharma exposure — $20k at risk if FDA rejects the lead approval.",
  ];
  return (
    <div className="space-y-3">
      <p className="text-[var(--text-2)] leading-relaxed text-[13px]">
        Event-risk insurance via Polymarket. Tell me what&apos;s at risk and the
        dollar amount — I&apos;ll size the trade and place it once you confirm.
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
