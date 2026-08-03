import { errorResponse } from "@/lib/http";
import { searchPlaces } from "@/lib/analysis";

export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) return Response.json({ places: [] });
    return Response.json({ places: await searchPlaces(query) });
  } catch (error) {
    return errorResponse(error);
  }
}
