import { storeRevenueCsv, summarize } from "@/lib/datasets";

/** Guard against a stray large file being read entirely into memory. */
const MAX_BYTES = 2_000_000;

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "expected a `file` field holding a CSV" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json(
        { error: `that file is ${Math.round(file.size / 1000)}kB; the limit is ${MAX_BYTES / 1000}kB` },
        { status: 413 },
      );
    }
    const dataset = await storeRevenueCsv(await file.text());
    return Response.json({ dataset: summarize(dataset) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
