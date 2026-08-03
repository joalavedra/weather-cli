"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { ArrowUp, Sparkles } from "lucide-react";
import Markdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { Client } from "@/lib/clients";
import { cn } from "@/lib/utils";

/** Tool names the assistant may call, rendered as a readable trace. */
const TOOL_LABELS: Record<string, string> = {
  "tool-fit_loss_curve": "fitting the loss curve",
  "tool-solve_cover": "solving cover",
  "tool-measure_geographic_basis": "measuring basis",
  "tool-find_cover": "finding cover",
  "tool-list_events": "listing dates",
  "tool-get_ladder": "reading the ladder",
  "tool-find_contracts": "searching contracts",
  "tool-get_market": "reading a contract",
  "tool-compute_hedge_quote": "pricing",
  "tool-assess_basis_risk": "scoring basis risk",
  "tool-estimate_correlation": "estimating correlation",
  "tool-compose_basket": "building a basket",
};

function messageText(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("");
}

function toolTrace(message: UIMessage): string[] {
  return message.parts
    .map((p) => TOOL_LABELS[p.type])
    .filter((label): label is string => Boolean(label));
}

const STARTERS = [
  "Is this cover worth buying?",
  "What would make the basis tighter?",
  "Explain the premium to my client",
];

export function AssistantPanel({ client }: { client: Client | null }) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: `${process.env["NEXT_PUBLIC_BASE_PATH"] ?? ""}/api/chat`,
    }),
  });
  const busy = status === "submitted" || status === "streaming";

  function send(text: string) {
    if (!text.trim() || busy) return;
    void sendMessage({ text }, { body: { clientId: client?.id } });
    setInput("");
  }

  return (
    <aside className="bg-sidebar hidden h-full w-[22rem] shrink-0 flex-col overflow-hidden border-l xl:flex">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Sparkles className="size-4 opacity-70" />
        <span className="text-sm font-medium">Assistant</span>
        {client ? (
          <Badge variant="outline" className="ml-auto max-w-[10rem] truncate text-xs font-normal">
            {client.name}
          </Badge>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm leading-relaxed">
                Ask about anything on the canvas — why the premium is what it is, whether the
                station is close enough, what would change the answer.
              </p>
              <div className="space-y-1.5">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="hover:bg-accent hover:text-accent-foreground w-full rounded-md border px-3 py-2 text-left text-xs transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => {
              const text = messageText(message);
              const trace = toolTrace(message);
              if (message.role === "user") {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm">
                      {text}
                    </div>
                  </div>
                );
              }
              return (
                <div key={message.id} className="space-y-1.5">
                  {trace.length > 0 ? (
                    <div className="text-muted-foreground text-xs italic">{trace.join(" · ")}</div>
                  ) : null}
                  {text ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&_p]:my-1.5 [&_strong]:font-semibold [&_ul]:my-1.5 [&_ul]:pl-4">
                      <Markdown>{text}</Markdown>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
          {busy ? <div className="text-muted-foreground text-xs italic">thinking…</div> : null}
        </div>
      </ScrollArea>

      <form
        className="border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={client ? `Ask about ${client.name}…` : "Ask a question…"}
            className="max-h-40 min-h-[4.5rem] resize-none pr-11 text-sm"
            disabled={busy}
          />
          <Button
            type="submit"
            size="icon"
            className={cn("absolute right-2 bottom-2 size-7")}
            disabled={!input.trim() || busy}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </form>
    </aside>
  );
}
