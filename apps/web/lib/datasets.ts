/**
 * Revenue datasets a client has uploaded.
 *
 * The analysis surface has been CLI-only because every useful function needs a
 * business's own daily revenue, and the chat broker had no way to receive it.
 * This is that missing piece: a CSV lands here once, gets an id, and the id is
 * all the model has to carry. Tools take the id and pull the rows themselves,
 * so hundreds of days of takings never pass through the conversation.
 *
 * State is plain files rather than a database. There is no user model here yet,
 * and a directory of JSON is inspectable, portable, and trivial to delete —
 * which matters when the contents are somebody's revenue.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseRevenueCsv } from "@weather/core";
import type { RevenueDay } from "@weather/core";

const DATA_DIR = process.env["REVENUE_DATA_DIR"] ?? path.join(process.cwd(), ".data", "revenue");

/** Rows below this can't support a loss fit, so reject at the door. */
const MIN_ROWS = 30;

export interface RevenueDataset {
  id: string;
  rows: RevenueDay[];
  start: string;
  end: string;
  uploadedAt: string;
}

export interface DatasetSummary {
  id: string;
  days: number;
  start: string;
  end: string;
  meanDailyRevenue: number;
}

function idFor(csv: string): string {
  return `rev_${createHash("sha256").update(csv).digest("hex").slice(0, 12)}`;
}

function pathFor(id: string): string {
  if (!/^rev_[a-f0-9]{12}$/.test(id)) {
    throw new Error(`"${id}" is not a dataset id — expected the id returned by the upload`);
  }
  return path.join(DATA_DIR, `${id}.json`);
}

export function summarize(dataset: RevenueDataset): DatasetSummary {
  const total = dataset.rows.reduce((sum, r) => sum + r.revenue, 0);
  return {
    id: dataset.id,
    days: dataset.rows.length,
    start: dataset.start,
    end: dataset.end,
    meanDailyRevenue: total / dataset.rows.length,
  };
}

/**
 * Parse and store an uploaded CSV.
 *
 * The id is a hash of the file, so re-uploading the same takings is idempotent
 * rather than accumulating copies of a client's revenue on disk.
 */
export async function storeRevenueCsv(csv: string): Promise<RevenueDataset> {
  const rows = parseRevenueCsv(csv);
  if (rows.length < MIN_ROWS) {
    throw new Error(
      `found only ${rows.length} usable days — a loss curve needs at least ${MIN_ROWS}. Check the date column is YYYY-MM-DD.`,
    );
  }
  const dates = rows.map((r) => r.date).toSorted();
  const dataset: RevenueDataset = {
    id: idFor(csv),
    rows,
    start: dates[0] ?? "",
    end: dates.at(-1) ?? "",
    uploadedAt: new Date().toISOString(),
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(pathFor(dataset.id), JSON.stringify(dataset), "utf8");
  return dataset;
}

export async function loadDataset(id: string): Promise<RevenueDataset> {
  try {
    return JSON.parse(await readFile(pathFor(id), "utf8")) as RevenueDataset;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `no revenue dataset called "${id}" — ask the client to upload their daily takings first`,
        { cause: error },
      );
    }
    throw error;
  }
}
