"use client";

import { quotaErrorKind, hasQuotaErrorThisPageLoad, notifyQuotaErrorForAdmin } from "@/lib/quotaAdminNotice";
import { isServerQuotaHoldActive, startServerQuotaHold } from "@/lib/serverQuotaHold";

export type FirestoreClientErrorKind =
  | "quota"
  | "permission"
  | "unauthenticated"
  | "unavailable"
  | "other";

export type ClassifiedFirestoreError = {
  kind: FirestoreClientErrorKind;
  title: string;
  reason: string;
  code: string;
  message: string;
  permissionMaskedQuota: boolean;
};

function errParts(err: unknown): { code: string; message: string } {
  const o = err as { code?: unknown; message?: unknown } | null;
  return {
    code: String(o?.code ?? "").trim(),
    message: String(o?.message ?? (err instanceof Error ? err.message : err) ?? "").trim(),
  };
}

/** Classify the Firebase SDK error — quota vs real permission vs other. */
export function classifyFirestoreClientError(err: unknown): ClassifiedFirestoreError {
  const { code, message } = errParts(err);
  const hay = `${code} ${message}`.toLowerCase();
  const quotaFromText = Boolean(quotaErrorKind(`${code} ${message}`)) || /resource-exhausted|quota exceeded/.test(hay);
  const quotaHold =
    (typeof window !== "undefined" && isServerQuotaHoldActive()) || hasQuotaErrorThisPageLoad();
  const looksPermission = /permission-denied|missing or insufficient permissions/.test(hay);

  if (quotaFromText || (looksPermission && quotaHold)) {
    return {
      kind: "quota",
      title: "Firebase quota exceeded",
      reason: looksPermission && !quotaFromText
        ? "Firebase returned permission-denied while quota is already exceeded. This is quota, not a missing permission."
        : "Firestore quota exceeded (resource-exhausted).",
      code: code || "resource-exhausted",
      message,
      permissionMaskedQuota: looksPermission && !quotaFromText,
    };
  }
  if (/unauthenticated/.test(hay)) {
    return {
      kind: "unauthenticated",
      title: "Not signed in",
      reason: "Firebase auth is missing or expired.",
      code: code || "unauthenticated",
      message,
      permissionMaskedQuota: false,
    };
  }
  if (looksPermission) {
    return {
      kind: "permission",
      title: "No permission",
      reason: "Firebase rules denied this read. This is a real permission-denied, not quota.",
      code: code || "permission-denied",
      message,
      permissionMaskedQuota: false,
    };
  }
  if (/unavailable|offline|could not reach/.test(hay)) {
    return {
      kind: "unavailable",
      title: "Server unavailable",
      reason: "Could not reach Firestore (offline / backend down).",
      code: code || "unavailable",
      message,
      permissionMaskedQuota: false,
    };
  }
  return {
    kind: "other",
    title: "Firebase error",
    reason: message || code || "Unknown Firebase error",
    code: code || "unknown",
    message,
    permissionMaskedQuota: false,
  };
}

type PendingRow = ClassifiedFirestoreError & { source: string; collectionPath: string };

const pending = new Map<string, PendingRow>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let noticeEl: HTMLDivElement | null = null;

/**
 * Recycle-bin (and similar) Firestore listen failures: no console overlay.
 * Popup shows whether Firebase said permission, quota, or something else.
 */
export function reportFirestoreListenFailure(source: string, collectionPath: string, err: unknown): void {
  const classified = classifyFirestoreClientError(err);
  if (classified.kind === "quota") {
    startServerQuotaHold();
    void import("@/lib/firebase")
      .then((m) => notifyQuotaErrorForAdmin(`${classified.code} ${classified.message}`, m.auth.currentUser?.email))
      .catch(() => undefined);
  }
  pending.set(`${source}:${collectionPath}`, { ...classified, source, collectionPath });
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    showListenFailurePopup();
  }, 400);
}

function showListenFailurePopup(): void {
  if (typeof document === "undefined") return;
  const rows = [...pending.values()];
  if (!rows.length) return;
  const quotaRows = rows.filter((r) => r.kind === "quota");
  const permRows = rows.filter((r) => r.kind === "permission");
  const title = quotaRows.length && quotaRows.length === rows.length
    ? "Firebase quota exceeded"
    : permRows.length && permRows.length === rows.length
      ? "No permission"
      : "Recycle bin: Firebase error";

  try {
    noticeEl?.remove();
    const wrap = document.createElement("div");
    wrap.setAttribute("role", "alertdialog");
    wrap.setAttribute("aria-live", "assertive");
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-center;pointer-events:none;";
    const card = document.createElement("div");
    card.style.cssText =
      "pointer-events:auto;max-width:460px;width:calc(100vw - 32px);max-height:min(80vh,560px);overflow:auto;background:#fff;color:#0f172a;" +
      "border:1px solid rgb(239 68 68);border-radius:10px;box-shadow:0 10px 30px rgba(15,23,42,.25);padding:16px;font:14px/1.4 system-ui,sans-serif;";
    const h = document.createElement("div");
    h.style.cssText = "font-weight:700;margin-bottom:8px;";
    h.textContent = title;
    card.append(h);
    const intro = document.createElement("div");
    intro.style.cssText = "font-size:12px;color:#475569;margin-bottom:10px;";
    intro.textContent = "Real Firebase reply (not the terminal overlay). Quota vs permission vs other:";
    card.append(intro);
    for (const r of rows) {
      const box = document.createElement("div");
      box.style.cssText =
        "font-size:12px;background:#f8fafc;border-radius:6px;padding:8px;margin-bottom:6px;text-align:left;word-break:break-word;";
      const kindLabel =
        r.kind === "quota"
          ? "QUOTA"
          : r.kind === "permission"
            ? "PERMISSION"
            : r.kind === "unauthenticated"
              ? "AUTH"
              : r.kind === "unavailable"
                ? "UNAVAILABLE"
                : "OTHER";
      box.textContent =
        `${r.collectionPath}  ·  ${kindLabel}\n` +
        `Firebase code: ${r.code || "—"}\n` +
        `Real reason: ${r.reason}\n` +
        `Raw: ${r.message || "—"}`;
      box.style.whiteSpace = "pre-wrap";
      card.append(box);
    }
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "OK";
    ok.style.cssText =
      "min-width:72px;height:32px;margin-top:4px;border-radius:6px;border:0;background:rgb(16 185 129);color:#fff;font-weight:600;cursor:pointer;";
    const close = () => {
      wrap.remove();
      if (noticeEl === wrap) noticeEl = null;
    };
    ok.addEventListener("click", close);
    card.append(ok);
    wrap.append(card);
    document.body.appendChild(wrap);
    noticeEl = wrap;
    window.setTimeout(close, 20_000);
  } catch {
    /* ignore */
  }
}
