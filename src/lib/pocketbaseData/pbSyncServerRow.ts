/**
 * Re-read one PocketBase row straight from the server for a realtime event.
 *
 * A delete is stored as a tombstone (`deleted: true` + `_pbHardDeleted`) and PocketBase reports it
 * as an "update" action, so the SSE payload alone cannot tell a delete from a normal edit. Reading
 * the row again gives the device the real `deleted` / `_pbHardDeleted` flags.
 *
 * Returns `null` when the row is not found (hard-deleted for real) or the request fails — the
 * caller then falls back to the event payload.
 */
export async function fetchPocketBaseRowByRecId(
  collection: string,
  rec: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const recId = String(rec?.id || "").trim();
  if (!collection || !recId) return null;
  try {
    const { pbFirst, pbQuote } = await import("@/lib/pocketbaseData/pbClient");
    const found = await pbFirst<Record<string, unknown>>(
      collection,
      `id = ${pbQuote(recId)}`
    );
    return found && typeof found === "object" ? found : null;
  } catch {
    return null;
  }
}
