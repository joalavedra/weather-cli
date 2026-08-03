/** Turn a thrown error into the JSON shape every route in this app returns. */
export function errorResponse(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status });
}
