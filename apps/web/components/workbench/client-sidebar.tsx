"use client";

import { CloudRain, Snowflake, Sun, Thermometer, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { NewClientDialog } from "@/components/workbench/new-client-dialog";
import { MONTHS } from "@/components/workbench/primitives";
import type { Client } from "@/lib/clients";
import { cn } from "@/lib/utils";

const PERIL_ICON: Record<string, typeof Sun> = {
  high_temp: Sun,
  low_temp: Thermometer,
  rain: CloudRain,
  snow: Snowflake,
  wind: Wind,
};

function seasonLabel(months: number[]): string {
  if (months.length === 0) return "Year-round";
  if (months.length === 1) return MONTHS[months[0]! - 1] ?? "";
  const contiguous = months.every((m, i) => i === 0 || m === months[i - 1]! + 1);
  return contiguous
    ? `${MONTHS[months[0]! - 1]}–${MONTHS[months.at(-1)! - 1]}`
    : `${months.length} months`;
}

export function ClientSidebar({
  clients,
  activeId,
  onSelect,
  onCreated,
}: {
  clients: Client[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreated: (client: Client) => void;
}) {
  return (
    <aside className="bg-sidebar flex h-full w-64 shrink-0 flex-col overflow-hidden border-r">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="bg-primary text-primary-foreground grid size-6 place-items-center rounded-md">
          <Sun className="size-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Weather Cover</span>
      </div>

      <div className="p-3">
        <NewClientDialog onCreated={onCreated} />
      </div>
      <Separator />

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-2">
          {clients.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-xs leading-relaxed">
              No businesses yet.
              <br />
              Add one to start measuring.
            </p>
          ) : (
            clients.map((client) => {
              const Icon = PERIL_ICON[client.peril] ?? Sun;
              const active = client.id === activeId;
              return (
                <Button
                  key={client.id}
                  variant="ghost"
                  onClick={() => onSelect(client.id)}
                  className={cn(
                    "h-auto w-full justify-start gap-2.5 px-2 py-2 text-left",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{client.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {client.premises} · {seasonLabel(client.months)}
                    </span>
                  </span>
                  {client.datasetId ? (
                    <span className="bg-[var(--chart-3)] size-1.5 shrink-0 rounded-full" />
                  ) : null}
                </Button>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="text-muted-foreground border-t p-3 text-[11px] leading-relaxed">
        Cover is priced on Kalshi, a CFTC-regulated exchange. It is supplemental
        parametric cover, not a substitute for property insurance.
      </div>
    </aside>
  );
}
