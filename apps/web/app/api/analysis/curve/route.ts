import { getClient } from "@/lib/clients";
import { fitClientCurve } from "@/lib/analysis";
import { errorResponse } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const clientId = new URL(request.url).searchParams.get("clientId");
    if (!clientId) return errorResponse(new Error("clientId is required"));
    return Response.json(await fitClientCurve(await getClient(clientId)));
  } catch (error) {
    return errorResponse(error);
  }
}
