/**
 * Pull-merge helper: a device that holds `local:<id>` (pending IndexedDB ref) for an attachment slot must
 * adopt the server's `pbatt:` / https ref for the SAME slot, even when edit timestamps tie or the local copy is
 * "newer". The outbox push writes the doc with `local:` first and rewrites it to `pbatt:` with the SAME
 * `updatedAtMs`, so the tie-break used to keep `local:` forever on any other device (and on the writer when
 * the local rewrite failed) - the picture never resolved (generic FILE tile).
 *
 * Returns `existing` with only those slots replaced, or null when nothing needs adopting.
 */
function isLocalPendingRef(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("local:");
}

function isServerAttachmentRef(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    (v.startsWith("pbatt:") || /^https?:\/\//i.test(v))
  );
}

export function adoptServerAttachmentRefsOverLocal(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> | null {
  let next: Record<string, unknown> | null = null;
  for (const key of Object.keys(existing)) {
    const ev = existing[key];
    const iv = incoming[key];
    if (isLocalPendingRef(ev)) {
      if (isServerAttachmentRef(iv)) {
        next = next ?? { ...existing };
        next[key] = iv;
      }
    } else if (Array.isArray(ev) && Array.isArray(iv) && ev.length === iv.length && ev.some(isLocalPendingRef)) {
      let changed = false;
      const merged = ev.map((x, i) => {
        if (isLocalPendingRef(x) && isServerAttachmentRef(iv[i])) {
          changed = true;
          return iv[i];
        }
        return x;
      });
      if (changed) {
        next = next ?? { ...existing };
        next[key] = merged;
      }
    }
  }
  return next;
}