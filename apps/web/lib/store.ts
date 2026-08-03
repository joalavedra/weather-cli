/**
 * Durable JSON storage.
 *
 * A serverless filesystem is per-instance and ephemeral, which broke the
 * product outright in production: a client created on one lambda was invisible
 * to the next request, so attaching revenue to it failed with "no client called
 * …" while the same flow worked perfectly on a local server. Anything that has
 * to survive between two requests belongs here, not on disk.
 *
 * Vercel Blob is used when its token is present and the filesystem otherwise,
 * so local development stays inspectable — a directory of JSON you can open —
 * without a second code path for the parts that matter.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { head, list, put } from "@vercel/blob";

const TOKEN = process.env["BLOB_READ_WRITE_TOKEN"];

const LOCAL_ROOT =
  process.env["WEATHER_DATA_DIR"] ?? path.join(os.tmpdir(), "weather-cover");

function localPath(key: string): string {
  return path.join(LOCAL_ROOT, `${key}.json`);
}

function assertSafeKey(key: string): void {
  if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(key) || key.includes("..")) {
    throw new Error(`"${key}" is not a valid storage key`);
  }
}

export async function putJson(key: string, value: unknown): Promise<void> {
  assertSafeKey(key);
  const body = JSON.stringify(value);
  if (TOKEN) {
    await put(`${key}.json`, body, {
      access: "public",
      token: TOKEN,
      contentType: "application/json",
      // Keys are looked up by name, so the pathname has to stay predictable,
      // and writing the same key twice is an update rather than a conflict.
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  await mkdir(path.dirname(localPath(key)), { recursive: true });
  await writeFile(localPath(key), body, "utf8");
}

export async function getJson<T>(key: string): Promise<T | null> {
  assertSafeKey(key);
  if (TOKEN) {
    const found = await head(`${key}.json`, { token: TOKEN }).catch(() => null);
    if (!found) return null;
    const response = await fetch(found.downloadUrl ?? found.url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  }
  try {
    return JSON.parse(await readFile(localPath(key), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Every value stored under a `prefix/` namespace. */
export async function listJson<T>(prefix: string): Promise<T[]> {
  assertSafeKey(prefix);
  if (TOKEN) {
    const { blobs } = await list({ prefix: `${prefix}/`, token: TOKEN, limit: 1000 });
    const loaded = await Promise.all(
      blobs.map(async (blob): Promise<T | null> => {
        const response = await fetch(blob.downloadUrl ?? blob.url, { cache: "no-store" });
        return response.ok ? ((await response.json()) as T) : null;
      }),
    );
    return loaded.filter((value): value is Awaited<T> => value !== null);
  }
  const dir = path.join(LOCAL_ROOT, prefix);
  try {
    const files = await readdir(dir);
    return await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as T),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
