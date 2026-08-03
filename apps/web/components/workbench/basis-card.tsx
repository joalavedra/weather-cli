"use client";

import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BasisScatterChart } from "@/components/charts/basis-scatter-chart";
import { Note, Stat, pct } from "@/components/workbench/primitives";
import { measureUnitLabel, useUnits } from "@/lib/units";
import type { BasisResult } from "@/lib/analysis";

/** Below this share of loss days caught, the station is the wrong proxy. */
const WEAK_TRIGGER = 0.6;

export function BasisCard({
  result,
  loading,
  error,
}: {
  result: BasisResult | null;
  loading: boolean;
  error: string | null;
}) {
  const units = useUnits();
  const unitLabel = measureUnitLabel(result?.measurement.unit ?? null, units);
  // A gap is a difference, so it scales by the ratio and takes no offset.
  const scale = units === "metric" && result?.measurement.unit === "F" ? 5 / 9 : 1;
  const weak = result ? result.measurement.triggerCorrelation < WEAK_TRIGGER : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where it&apos;s measured</CardTitle>
        <CardDescription>
          Cover pays on a reading taken somewhere else. This is how often that reading agreed
          with the business, measured over years of history rather than assumed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? <Skeleton className="h-[260px] w-full" /> : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {result ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Paid when it hurt"
                value={pct(result.measurement.triggerCorrelation)}
                tone={weak ? "bad" : "good"}
                hint={`${result.measurement.lossDays} loss days`}
              />
              <Stat
                label="Correlation"
                value={result.measurement.correlation.toFixed(3)}
                hint="whole distribution"
              />
              <Stat
                label="Typical gap"
                value={`${(result.measurement.meanAbsDifference * scale).toFixed(1)}${unitLabel}`}
                hint={`worst ${(result.measurement.maxAbsDifference * scale).toFixed(1)}${unitLabel}`}
              />
              <Stat label="Days compared" value={result.measurement.days.toLocaleString()} />
            </div>

            <Note>{result.summary}</Note>

            <BasisScatterChart
              scatter={result.scatter}
              threshold={result.measurement.threshold}
              unit={result.measurement.unit}
            />
            <Note>
              Each dot is one day: the station&apos;s reading across, the business&apos;s down.
              Dots below the horizontal line but right of the vertical one are days the business
              was hurting and the contract would not have paid.
            </Note>

            {weak ? (
              <Alert>
                <AlertTriangle className="size-4" />
                <AlertDescription>
                  This station is a poor proxy for this business. A closer series, or spreading
                  the premium across proxies that miss in different ways, would cover more of
                  the real loss.
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
