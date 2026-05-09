"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useState } from "react";
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
} {
  const pins: Pin[] = [];
  const inlineHints = new Map<string, string[]>();

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
        addHint(m.id, `pinned trade: ${out.side} · $${out.quote.costBudgetUsdc.toFixed(0)}`);
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
          `wallet created: ${out.address.slice(0, 6)}…${out.address.slice(-4)}`,
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
        addHint(m.id, `order placed: ${out.side} · $${out.amountUsdc}`);
      } else if (part.type === "tool-get_positions") {
        if (part.state !== "output-available") continue;
        addHint(m.id, "fetched positions");
      }
    }
  }
  return { pins, inlineHints };
}

function AssistantText({ text }: { text: string }) {
  return (
    <div className="text-[15px] leading-relaxed">
      <Markdown
        components={{
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-1.5 ml-5 list-disc space-y-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 ml-5 list-decimal space-y-0.5">{children}</ol>
          ),
          li: ({ children }) => <li className="my-0">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-zinc-900">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => (
            <h3 className="mt-3 mb-1 font-semibold text-zinc-900">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="mt-3 mb-1 font-semibold text-zinc-900">{children}</h3>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1 font-semibold text-zinc-900">{children}</h3>
          ),
          code: ({ children }) => (
            <code className="font-mono text-[13px] bg-zinc-100 rounded px-1 py-0.5">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="font-mono text-[13px] bg-zinc-100 rounded p-2 my-2 overflow-x-auto">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-zinc-300 pl-3 my-1.5 text-zinc-600">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-zinc-200" />,
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
          className="text-[11px] text-zinc-500 bg-zinc-100 border border-zinc-200 rounded px-2 py-0.5"
        >
          {h}
        </span>
      ))}
    </div>
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

  const { pins, inlineHints } = deriveState(messages);
  const isBusy = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-screen">
      <Workspace pins={pins} />
      <div className="flex-1 flex flex-col">
        <header className="border-b border-zinc-200 px-6 py-4 bg-white">
          <h1 className="font-semibold text-lg">Hedge Broker</h1>
          <p className="text-sm text-zinc-500">
            Insurance for any event Polymarket prices — politics, sports,
            crypto, weather, business risk. Tell me what to hedge.
          </p>
        </header>
        <main className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 ? (
            <Welcome />
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
                    <div className="max-w-[80%] bg-zinc-900 text-white rounded-lg px-4 py-2 whitespace-pre-wrap">
                      {text}
                    </div>
                  </div>
                );
              }
              return (
                <div key={m.id} className="flex justify-start">
                  <div className="max-w-[85%] text-zinc-900">
                    {text ? <AssistantText text={text} /> : null}
                    <InlineHints hints={hints} />
                  </div>
                </div>
              );
            })
          )}
          {isBusy ? (
            <div className="text-xs text-zinc-500 italic">thinking…</div>
          ) : null}
        </main>
        <form
          onSubmit={onSubmit}
          className="border-t border-zinc-200 px-6 py-4 bg-white"
        >
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Hedge $10k against the Fed cutting in December…"
              className="flex-1 border border-zinc-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900"
              disabled={isBusy}
            />
            <button
              type="submit"
              className="bg-zinc-900 text-white rounded-lg px-4 py-2 font-medium disabled:opacity-50"
              disabled={!input.trim() || isBusy}
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Welcome() {
  const examples = [
    "Outdoor wedding in Madrid Saturday, $5k at risk if patio is too cold.",
    "$10k crypto treasury — hedge me if BTC closes below $90k by year-end.",
    "I'm long a sports-betting startup. Hedge $3k if the Super Bowl is a blowout.",
    "Pharma exposure — $20k at risk if FDA rejects the lead approval.",
  ];
  return (
    <div className="text-zinc-600 space-y-3">
      <p>
        I write event-risk insurance using Polymarket. Tell me what&apos;s at
        risk and the dollar amount — I&apos;ll find a market, size the trade,
        and place it once you confirm.
      </p>
      <ul className="space-y-2">
        {examples.map((ex) => (
          <li
            key={ex}
            className="border border-zinc-200 rounded-lg px-3 py-2 bg-white text-sm"
          >
            {ex}
          </li>
        ))}
      </ul>
    </div>
  );
}
