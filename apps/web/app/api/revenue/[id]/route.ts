import { loadDataset, summarize } from "@/lib/datasets";
import { errorResponse } from "@/lib/http";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    return Response.json({ dataset: summarize(await loadDataset(id)) });
  } catch (error) {
    return errorResponse(error, 404);
  }
}
