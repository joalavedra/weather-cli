import { getClient } from "@/lib/clients";
import { solveClientCover } from "@/lib/analysis";
import { errorResponse } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const clientId = params.get("clientId");
    const eventTicker = params.get("eventTicker");
    if (!clientId || !eventTicker) {
      return errorResponse(new Error("clientId and eventTicker are required"));
    }
    return Response.json(await solveClientCover(await getClient(clientId), eventTicker));
  } catch (error) {
    return errorResponse(error);
  }
}
