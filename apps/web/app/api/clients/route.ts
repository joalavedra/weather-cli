import { createClient, listClients } from "@/lib/clients";
import type { ClientDraft } from "@/lib/clients";
import { errorResponse } from "@/lib/http";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ clients: await listClients() });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const draft = (await request.json()) as ClientDraft;
    return Response.json({ client: await createClient(draft) });
  } catch (error) {
    return errorResponse(error);
  }
}
