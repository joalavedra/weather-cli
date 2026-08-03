import { getClient } from "@/lib/clients";
import { fitClientCurve } from "@/lib/analysis";
import { errorResponse } from "@/lib/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const clientId = params.get("clientId");
    if (!clientId) return errorResponse(new Error("clientId is required"));
    // The standalone curve is a display of the business, so it follows the
    // reader's units. Pricing re-fits in whichever scale the ladder settles in.
    const scale = params.get("scale") === "C" ? "C" : "F";
    return Response.json(await fitClientCurve(await getClient(clientId), scale));
  } catch (error) {
    return errorResponse(error);
  }
}
