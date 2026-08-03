"use client";

import { AlertTriangle, MapPin } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CoverProfileChart } from "@/components/charts/cover-profile-chart";
import { Note, Stat, pct, usd } from "@/components/workbench/primitives";
import type { CoverOption, CoverResult } from "@/lib/analysis";
import { cn } from "@/lib/utils";

function LadderPicker({
  options,
  active,
  onPick,
}: {
  options: CoverOption[];
  active: string | null;
  onPick: (eventTicker: string) => void;
}) {
  return (
    <div className="space-y-3">
      {options.map((option) => (
        <div key={option.seriesTicker} className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium">{option.title}</span>
            {option.distanceKm !== null ? (
              <span className="text-muted-foreground tnum text-xs">{option.distanceKm} km away</span>
            ) : null}
            {option.settlementSource ? (
              <span className="text-muted-foreground truncate text-xs">
                · {option.settlementSource}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {option.events.map((event) => (
              <Button
                key={event.eventTicker}
                size="sm"
                variant={event.eventTicker === active ? "default" : "outline"}
                onClick={() => onPick(event.eventTicker)}
                className="h-7 text-xs font-normal"
              >
                {event.eventTicker.split("-").slice(1).join("-")}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CoverCard({
  options,
  optionsLoading,
  active,
  onPick,
  result,
  loading,
  error,
}: {
  options: CoverOption[];
  optionsLoading: boolean;
  active: string | null;
  onPick: (eventTicker: string) => void;
  result: CoverResult | null;
  loading: boolean;
  error: string | null;
}) {
  const unitLabel = result?.curve.unit === "F" ? "°F" : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>The cover</CardTitle>
        <CardDescription>
          Each rung is sized to the loss expected on the days it pays, so the premium falls out
          of the loss rather than being a budget you pick.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {optionsLoading ? <Skeleton className="h-16 w-full" /> : null}
        {!optionsLoading && options.length === 0 ? (
          <Note>
            No live ladder settles near this business for that peril right now. Kalshi&apos;s
            listings change constantly — worth checking again closer to the season.
          </Note>
        ) : (
          <LadderPicker options={options} active={active} onPick={onPick} />
        )}

        {loading ? <Skeleton className="h-[280px] w-full" /> : null}
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
                label="Premium"
                value={usd(result.plan.premiumPerDayUsdc, { cents: true })}
                hint="per day of cover"
              />
              <Stat label="Cover limit" value={usd(Math.round(result.plan.limitUsdc))} hint="worst bucket" />
              <Stat
                label="Attaches"
                value={`${result.plan.direction === "below" ? "↓" : "↑"} ${result.plan.attachment}${unitLabel}`}
              />
              <Stat
                label="Worst day carried"
                value={pct(result.plan.worstDayCovered)}
                tone={result.plan.worstDayCovered > 0.5 ? "good" : "warn"}
                hint={`of ${usd(Math.round(result.plan.worstDayLossUsdc))}`}
              />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket</TableHead>
                  <TableHead className="text-right">Contracts</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Pays</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.plan.legs.map((leg) => (
                  <TableRow key={leg.label}>
                    <TableCell className="font-medium">{leg.label}</TableCell>
                    <TableCell className="tnum text-right">{leg.contracts.toLocaleString()}</TableCell>
                    <TableCell className="tnum text-right">
                      {Math.round(leg.pricePerContract * 100)}¢
                    </TableCell>
                    <TableCell className="tnum text-right">{usd(leg.contracts)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="space-y-2">
              <CoverProfileChart
                profile={result.profile}
                attachment={result.plan.attachment}
                unitLabel={unitLabel}
              />
              <Note>
                A structure that works flattens the green line. The steps are the honest limit of
                bucketed cover: it pays the same across a bucket while the loss slopes through it.
              </Note>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={result.plan.outOfSample ? "secondary" : "outline"} className="gap-1">
                {result.plan.outOfSample ? "Held-out replay" : "In-sample"}
              </Badge>
              <span className="text-muted-foreground">
                {result.plan.replay.days} days ·{" "}
                <span
                  className={cn(
                    "tnum font-medium",
                    result.plan.replay.swingReduction > 0
                      ? "text-[var(--chart-3)]"
                      : "text-[var(--chart-1)]",
                  )}
                >
                  {pct(result.plan.replay.swingReduction)} smoother
                </span>{" "}
                · paid on {result.plan.replay.daysHurtAndPaid} of{" "}
                {result.plan.replay.daysHurt} days that hurt
              </span>
            </div>

            {result.ladder.settlement.station ? (
              <Note>
                <MapPin className="mr-1 inline size-3.5 align-[-2px]" />
                Settles on {result.ladder.settlement.station}
                {result.ladder.settlement.sources[0]
                  ? ` · ${result.ladder.settlement.sources[0].name}`
                  : ""}
                .
              </Note>
            ) : null}

            {result.plan.warnings.map((warning) => (
              <Alert key={warning}>
                <AlertTriangle className="size-4" />
                <AlertDescription>{warning}</AlertDescription>
              </Alert>
            ))}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
