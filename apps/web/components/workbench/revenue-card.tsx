"use client";

import { useRef, useState } from "react";
import { Check, Download, FileUp } from "lucide-react";
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
          <div className="space-y-2">
            <Note>
              Two columns: the date as <span className="tnum">YYYY-MM-DD</span> and that
              day&apos;s total takings. Square, Toast, Shopify and Stripe can all export it. A
              header row is fine, extra columns are ignored, and closed days can be left out.
            </Note>
            <pre className="bg-muted text-muted-foreground overflow-x-auto rounded-md p-3 text-xs leading-relaxed">
              {"date,revenue\n2025-06-14,5310.00\n2025-06-15,4880.50\n2025-06-16,3120.75"}
            </pre>
            <Note>
              A full season is ideal — the fit needs at least 30 days inside the months the
              business is exposed. Takings stay on the server and are never sent to the
              assistant. The sample file is an invented Chicago patio bar; pair it with a
              business at <span className="tnum">Chicago</span> to see the whole thing run.
            </Note>
          </div>
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
        <div className="flex flex-wrap items-center gap-2">
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
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground gap-2">
            <a
              href={`${process.env["NEXT_PUBLIC_BASE_PATH"] ?? ""}/api/sample-csv`}
              download="sample-chicago-patio-revenue.csv"
            >
              <Download className="size-4" /> Sample file
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
