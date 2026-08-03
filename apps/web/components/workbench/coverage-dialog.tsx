"use client";

import { useState } from "react";
import { Globe2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchCoverage } from "@/lib/api";
import type { CoveragePlace } from "@/lib/analysis";

const PERIL_LABEL: Record<string, string> = {
  high_temp: "Hot / cold days",
  low_temp: "Overnight lows",
  rain: "Rain",
  snow: "Snow",
};

/**
 * Where cover exists today.
 *
 * "Is my city covered?" is the first thing anyone asks, and the only way to
 * find out used to be adding a business and watching the cover card come back
 * empty. Only places with a live contract are listed — a dormant ticker is not
 * cover.
 */
export function CoverageDialog() {
  const [places, setPlaces] = useState<CoveragePlace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  function load() {
    if (places || error) return;
    void fetchCoverage()
      .then(setPlaces)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }

  const shown = (places ?? []).filter((p) =>
    p.location.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <Dialog onOpenChange={(open) => open && load()}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground w-full justify-start gap-2">
          <Globe2 className="size-4" /> Where there&apos;s cover
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Where there&apos;s cover</DialogTitle>
          <DialogDescription>
            Places with a live weather contract on Kalshi right now. US only — the exchange
            lists no weather elsewhere.
          </DialogDescription>
        </DialogHeader>

        {places === null && !error ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-40 w-full" />
            <p className="text-muted-foreground text-xs">
              Checking every listed series for an open contract. Takes a few seconds the first
              time.
            </p>
          </div>
        ) : null}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        {places !== null ? (
          <div className="space-y-3">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${places.length} places…`}
            />
            <ScrollArea className="h-72">
              <ul className="space-y-1 pr-3">
                {shown.map((place) => (
                  <li
                    key={`${place.latitude},${place.longitude}`}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <span className="truncate text-sm font-medium">{place.location}</span>
                    <span className="flex shrink-0 flex-wrap gap-1">
                      {place.perils.map((peril) => (
                        <Badge key={peril} variant="secondary" className="font-normal">
                          {PERIL_LABEL[peril] ?? peril}
                        </Badge>
                      ))}
                    </span>
                  </li>
                ))}
                {shown.length === 0 ? (
                  <li className="text-muted-foreground py-6 text-center text-sm">
                    Nothing matches “{filter}”. Cover is city-level, so try the nearest large
                    city — the station may still be close enough.
                  </li>
                ) : null}
              </ul>
            </ScrollArea>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
