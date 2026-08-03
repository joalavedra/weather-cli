import { getClient, updateClient } from "@/lib/clients";
import type { ClientDraft } from "@/lib/clients";
import { errorResponse } from "@/lib/http";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    return Response.json({ client: await getClient(id) });
  } catch (error) {
    return errorResponse(error, 404);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const patch = (await request.json()) as Partial<ClientDraft>;
    return Response.json({ client: await updateClient(id, patch) });
  } catch (error) {
    return errorResponse(error);
  }
}
