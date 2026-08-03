import { errorResponse } from "@/lib/http";
import { listCoverage } from "@/lib/analysis";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ places: await listCoverage() });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
