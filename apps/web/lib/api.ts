/**
 * Typed fetch wrappers for the workbench.
 *
 * Every route in this app answers with either the payload or `{ error }`, so
 * one helper unwraps both and surfaces the server's own message. Those messages
 * are written to be read by a person — "no rung sits in the loss region" — and
 * swallowing them for a generic failure toast would throw away the most useful
 * thing the calculation produced.
 */
import type {
  BasisResult,
  CoveragePlace,
  CoverOption,
  CoverResult,
  CurveResult,
  PlaceSuggestion,
} from "@/lib/analysis";
import type { Client, ClientDraft } from "@/lib/clients";
import type { DatasetSummary } from "@/lib/datasets";

async function unwrap<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T | { error: string };
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error((payload as { error: string }).error);
  }
  return payload as T;
}

const base = (path: string) => `${process.env["NEXT_PUBLIC_BASE_PATH"] ?? ""}${path}`;

export async function listClients(): Promise<Client[]> {
  return (await unwrap<{ clients: Client[] }>(await fetch(base("/api/clients")))).clients;
}

export async function createClient(draft: ClientDraft): Promise<Client> {
  return (
    await unwrap<{ client: Client }>(
      await fetch(base("/api/clients"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      }),
    )
  ).client;
}

export async function patchClient(id: string, patch: Partial<ClientDraft>): Promise<Client> {
  return (
    await unwrap<{ client: Client }>(
      await fetch(base(`/api/clients/${id}`), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    )
  ).client;
}

export async function uploadRevenue(file: File): Promise<DatasetSummary> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(base("/api/revenue"), { method: "POST", body });
  return (await unwrap<{ dataset: DatasetSummary }>(response)).dataset;
}

export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  return (
    await unwrap<{ places: PlaceSuggestion[] }>(
      await fetch(base(`/api/geocode?q=${encodeURIComponent(query)}`)),
    )
  ).places;
}

export async function fetchCoverage(): Promise<CoveragePlace[]> {
  return (await unwrap<{ places: CoveragePlace[] }>(await fetch(base("/api/coverage")))).places;
}

export async function fetchDataset(id: string): Promise<DatasetSummary> {
  return (
    await unwrap<{ dataset: DatasetSummary }>(await fetch(base(`/api/revenue/${id}`)))
  ).dataset;
}

export async function fetchCurve(clientId: string, scale: "F" | "C" = "F"): Promise<CurveResult> {
  return unwrap<CurveResult>(
    await fetch(base(`/api/analysis/curve?clientId=${clientId}&scale=${scale}`)),
  );
}

export async function fetchCoverOptions(clientId: string): Promise<CoverOption[]> {
  return (
    await unwrap<{ options: CoverOption[] }>(
      await fetch(base(`/api/analysis/options?clientId=${clientId}`)),
    )
  ).options;
}

export async function fetchCover(clientId: string, eventTicker: string): Promise<CoverResult> {
  return unwrap<CoverResult>(
    await fetch(base(`/api/analysis/cover?clientId=${clientId}&eventTicker=${eventTicker}`)),
  );
}

export async function fetchBasis(clientId: string, eventTicker: string): Promise<BasisResult> {
  return unwrap<BasisResult>(
    await fetch(base(`/api/analysis/basis?clientId=${clientId}&eventTicker=${eventTicker}`)),
  );
}
