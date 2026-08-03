"use client";

import { useRef, useState } from "react";
import { Check, FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Note, Stat, usd } from "@/components/workbench/primitives";
import { patchClient, uploadRevenue } from "@/lib/api";
import type { Client } from "@/lib/clients";
import type { DatasetSummary } from "@/lib/datasets";

export function RevenueCard({
  client,
  summary,
  onAttached,
}: {
  client: Client;
  summary: DatasetSummary | null;
  onAttached: (client: Client, dataset: DatasetSummary) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handle(file: File) {
    setBusy(true);
    try {
      const dataset = await uploadRevenue(file);
      const updated = await patchClient(client.id, { datasetId: dataset.id });
      onAttached(updated, dataset);
      toast.success(`${dataset.days} days of revenue attached to ${updated.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {summary ? <Check className="size-4 text-[var(--chart-3)]" /> : null}
          Daily revenue
        </CardTitle>
        <CardDescription>
          A year of daily takings turns every number below from a guess into a measurement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary ? (
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Days" value={summary.days.toLocaleString()} />
            <Stat label="Average day" value={usd(summary.meanDailyRevenue)} />
            <Stat
              label="Covering"
              value={<span className="text-base">{summary.start}</span>}
              hint={`to ${summary.end}`}
            />
          </div>
        ) : (
          <Note>
            Export a <span className="tnum">date,revenue</span> CSV from your point of sale —
            Square, Toast, Shopify and Stripe can all produce one. Takings stay on the server
            and are never sent to the assistant.
          </Note>
        )}
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handle(file);
            e.target.value = "";
          }}
        />
        <Button
          variant={summary ? "outline" : "default"}
          size="sm"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="gap-2"
        >
          <FileUp className="size-4" />
          {busy ? "Reading…" : summary ? "Replace CSV" : "Upload revenue CSV"}
        </Button>
      </CardContent>
    </Card>
  );
}
