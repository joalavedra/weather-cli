"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchPlaces } from "@/lib/api";
import type { PlaceSuggestion } from "@/lib/analysis";
import { cn } from "@/lib/utils";

/** Long enough that a fast typist isn't firing a request per keystroke. */
const DEBOUNCE_MS = 250;

/**
 * Location field with place suggestions.
 *
 * Picking from a list stores coordinates rather than a name, which matters more
 * here than it looks: cover settles at one specific weather station, and a
 * business pinned to a city centre instead of its own street can measure a
 * different microclimate entirely.
 */
export function PlaceInput({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string | null;
  onChange: (value: string, label: string | null) => void;
}) {
  const [query, setQuery] = useState(label ?? "");
  const [places, setPlaces] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    // A raw coordinate pair is already precise; don't second-guess it.
    if (/^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(query)) {
      setPlaces([]);
      return;
    }
    if (query.trim().length < 2 || query === label) {
      setPlaces([]);
      return;
    }
    const token = ++latest.current;
    setBusy(true);
    const timer = setTimeout(() => {
      void searchPlaces(query)
        .then((found) => {
          // Ignore a slow response that a newer keystroke has superseded.
          if (token !== latest.current) return;
          setPlaces(found);
          setOpen(found.length > 0);
        })
        .catch(() => setPlaces([]))
        .finally(() => {
          if (token === latest.current) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, label]);

  function pick(place: PlaceSuggestion) {
    setQuery(place.label);
    setOpen(false);
    setPlaces([]);
    onChange(`${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`, place.label);
  }

  return (
    <div className="relative">
      <Input
        id="nc-premises"
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value, null);
        }}
        onFocus={() => setOpen(places.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Start typing a town or city…"
      />
      {busy ? (
        <Loader2 className="text-muted-foreground absolute top-2.5 right-2.5 size-4 animate-spin" />
      ) : null}
      {open ? (
        <ul className="bg-popover absolute z-50 mt-1 w-full overflow-hidden rounded-md border shadow-md">
          {places.map((place) => (
            <li key={`${place.latitude},${place.longitude}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(place)}
                className={cn(
                  "hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2",
                  "px-3 py-2 text-left text-sm transition-colors",
                )}
              >
                <MapPin className="text-muted-foreground size-3.5 shrink-0" />
                <span className="truncate">{place.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {label ? (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Pinned to {value} — {label}
        </p>
      ) : (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Pick a suggestion to pin exact coordinates, or paste your own as{" "}
          <span className="tnum">lat,lon</span>. Cover is measured at one specific station, so a
          few miles can change what it pays.
        </p>
      )}
    </div>
  );
}
