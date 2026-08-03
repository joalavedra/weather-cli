/**
 * Clients a broker is placing cover for.
 *
 * A workbench needs something to hang analysis off. Everything the product
 * computes — the loss curve, the basis measurement, the solved structure —
 * depends on the same four facts: where the business is, what weather hurts it,
 * which months it's exposed, and what its revenue did. A client record holds
 * those together so they're stated once rather than re-elicited per question.
 *
 * A self-serve owner has exactly one of these and never thinks of it as a
 * "client"; a broker has many. Same record either way.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { Peril } from "@weather/core";

const DATA_DIR =
  process.env["CLIENT_DATA_DIR"] ?? path.join(os.tmpdir(), "weather-cover", "clients");

export interface Client {
  id: string;
  name: string;
  /** Free text the geocoder resolves, or a raw "lat,lon" pair. */
  premises: string;
  peril: Peril;
  /** Calendar months (1–12) the business is exposed. Empty means year-round. */
  months: number[];
  /** Revenue dataset backing the loss curve, once one is uploaded. */
  datasetId: string | null;
  createdAt: string;
}

export type ClientDraft = Pick<Client, "name" | "premises" | "peril"> &
  Partial<Pick<Client, "months" | "datasetId">>;

function pathFor(id: string): string {
  if (!/^[a-f0-9-]{8,40}$/.test(id)) {
    throw new Error(`"${id}" is not a client id`);
  }
  return path.join(DATA_DIR, `${id}.json`);
}

function validate(draft: ClientDraft): void {
  if (draft.name.trim() === "") throw new Error("a client needs a name");
  if (draft.premises.trim() === "") {
    throw new Error("a client needs a location — a place name or 'lat,lon'");
  }
  for (const month of draft.months ?? []) {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error(`months must be calendar numbers 1-12, got ${month}`);
    }
  }
}

export async function createClient(draft: ClientDraft): Promise<Client> {
  validate(draft);
  const client: Client = {
    id: randomUUID(),
    name: draft.name.trim(),
    premises: draft.premises.trim(),
    peril: draft.peril,
    months: draft.months ?? [],
    datasetId: draft.datasetId ?? null,
    createdAt: new Date().toISOString(),
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(pathFor(client.id), JSON.stringify(client), "utf8");
  return client;
}

export async function getClient(id: string): Promise<Client> {
  try {
    return JSON.parse(await readFile(pathFor(id), "utf8")) as Client;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`no client called "${id}"`, { cause: error });
    }
    throw error;
  }
}

export async function updateClient(id: string, patch: Partial<ClientDraft>): Promise<Client> {
  const existing = await getClient(id);
  const merged: Client = {
    ...existing,
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.premises !== undefined && { premises: patch.premises.trim() }),
    ...(patch.peril !== undefined && { peril: patch.peril }),
    ...(patch.months !== undefined && { months: patch.months }),
    ...(patch.datasetId !== undefined && { datasetId: patch.datasetId }),
  };
  validate(merged);
  await writeFile(pathFor(id), JSON.stringify(merged), "utf8");
  return merged;
}

/** Every client on disk, newest first. */
export async function listClients(): Promise<Client[]> {
  try {
    const files = await readdir(DATA_DIR);
    const clients = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8")) as Client),
    );
    return clients.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Stable colour seed so a client reads the same across the UI. */
export function clientAccent(id: string): number {
  const hash = createHash("sha256").update(id).digest();
  return (hash[0] ?? 0) % 360;
}
