"use client";

import type { UpsertCompanyBrowserOptions } from "@/lib/localCompanyDocMirror";
import { shouldCommitOnHostBridge, invokeHostBridgeCompanyDocUpsert } from "@/lib/hostBridgeWrite";
import {
  shouldRoutePlServerAuthoritativeWrite,
  invokePlServerAuthoritativeDocUpsert,
  PlServerAuthoritativeWriteError,
} from "@/lib/plServerClientAuthoritativeWrite";
import {
  enqueuePendingAuthoritativeCompanyDocWrite,
  classifyAuthoritativeWriteFailure,
  isAuthoritativeWriteFailureRetryable,
} from "@/lib/plServerAuthoritativePendingQueue";
import { schedulePlServerAuthoritativeReplayDrain } from "@/lib/plServerAuthoritativeReplay";

export type CompanyDocBrowserWriteRoute =
  | { kind: "host_bridge" }
  | { kind: "authoritative_http" }
  | { kind: "pending_enqueue" }
  | { kind: "local_commit" };

export type CompanyDocBrowserWriteDispatchRoute = Exclude<
  CompanyDocBrowserWriteRoute,
  { kind: "local_commit" }
>;

export type CompanyDocBrowserWriteDispatchOptions = {
  /** Staff thin saves need online-company semantics: success only after Host acknowledges the write. */
  requireAuthoritativeAck?: boolean;
};

/** Runtime verify: one-shot Host bridge bypass for LAN client simulation. */
export function consumeVerifySkipHostBridgeFlag(): boolean {
  if (typeof window === "undefined") return false;
  const key = "__plPhase1bVerifySkipHostBridgeForNextUpsert" as const;
  const win = window as unknown as { [key]?: boolean };
  if (!win[key]) return false;
  delete win[key];
  return true;
}

function isBrowserFileOrBlob(value: unknown): boolean {
  return (
    (typeof File !== "undefined" && value instanceof File) ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  );
}

function isAttachmentPayloadPath(path: readonly string[]): boolean {
  return path.some((segment) => {
    const key = String(segment || "").toLowerCase();
    return (
      key === "fileurl" ||
      key === "avatarurl" ||
      key === "logourl" ||
      key === "documentfileurls" ||
      key === "fileurls" ||
      key.includes("attachment") ||
      key.includes("file")
    );
  });
}

function assertNoUnsafeAttachmentPayloadForAuthoritativeWrite(data: Record<string, unknown>): void {
  const unsafe: string[] = [];
  const seen = typeof WeakSet !== "undefined" ? new WeakSet<object>() : null;
  const scan = (value: unknown, path: string[]) => {
    if (unsafe.length >= 5) return;
    if (isBrowserFileOrBlob(value)) {
      unsafe.push(path.join(".") || "<root>");
      return;
    }
    if (typeof value === "string" && /^(blob|data):/i.test(value.trim()) && isAttachmentPayloadPath(path)) {
      unsafe.push(path.join(".") || "<root>");
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value instanceof Date) return;
    if (seen) {
      if (seen.has(value)) return;
      seen.add(value);
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => scan(entry, [...path, String(index)]));
      return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      scan(entry, [...path, key]);
    }
  };
  scan(data, []);
  if (unsafe.length > 0) {
    throw new PlServerAuthoritativeWriteError(`unsafe_attachment_payload:${unsafe.join(",")}`);
  }
}

async function preflightAttachmentsForAuthoritativeRoute(
  route: CompanyDocBrowserWriteRoute,
  companyId: string,
  data: Record<string, unknown>
): Promise<void> {
  if (route.kind === "local_commit") return;
  assertNoUnsafeAttachmentPayloadForAuthoritativeWrite(data);
  const {
    ensurePlServerAttachmentsQueuedFromRecord,
    flushPlServerAttachmentsForRecordBeforeAuthoritativeSave,
    listLocalAttachmentIdsInRecord,
  } = await import("@/lib/plServerAttachmentUploadQueue");
  if ((await listLocalAttachmentIdsInRecord(data)).length === 0) return;
  if (route.kind === "pending_enqueue") {
    await ensurePlServerAttachmentsQueuedFromRecord(companyId, data);
    return;
  }
  if (route.kind !== "host_bridge" && route.kind !== "authoritative_http") return;
  const result = await flushPlServerAttachmentsForRecordBeforeAuthoritativeSave(companyId, data, {
    throwOnFailure: true,
  });
  if (!result.ok) {
    throw new PlServerAuthoritativeWriteError(result.error || "attachment_upload_failed");
  }
}

/**
 * Single routing decision for user-origin company doc writes.
 * Host bridge → authoritative HTTP → pending queue → local SQLite fallback.
 */
export async function resolveCompanyDocBrowserWriteRoute(
  companyId: string,
  options?: UpsertCompanyBrowserOptions,
  ctx?: { simulateLanClient?: boolean }
): Promise<CompanyDocBrowserWriteRoute> {
  const simulateLanClient = ctx?.simulateLanClient === true;

  if (!simulateLanClient && (await shouldCommitOnHostBridge(companyId, options))) {
    return { kind: "host_bridge" };
  }

  if (
    await shouldRoutePlServerAuthoritativeWrite(companyId, options, {
      simulateLanClient,
    })
  ) {
    return { kind: "authoritative_http" };
  }

  const { isAuthoritativeLanClientWriteEligible } = await import("@/lib/plServerAuthoritativePendingQueue");
  if (await isAuthoritativeLanClientWriteEligible(companyId, options, { simulateLanClient })) {
    return { kind: "pending_enqueue" };
  }

  return { kind: "local_commit" };
}

/** Dispatch a resolved route — local_commit stays in the upsert orchestrator. */
export async function executeCompanyDocBrowserWriteRoute(
  route: CompanyDocBrowserWriteDispatchRoute,
  companyId: string,
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  options?: UpsertCompanyBrowserOptions,
  dispatchOptions?: CompanyDocBrowserWriteDispatchOptions
): Promise<void> {
  switch (route.kind) {
    case "host_bridge":
      await invokeHostBridgeCompanyDocUpsert(companyId, collectionName, docId, data, options);
      return;
    case "authoritative_http": {
      /**
       * Durable-first: land the write in the IndexedDB pending queue BEFORE the network call.
       * A refresh 1-2s after Save used to abort the in-flight HTTP write, so the server never
       * saw it and the next pull reverted the voucher / resurrected the deleted row. With the
       * queue row already persisted, the replay drain finishes it after the reload (or on the
       * next start / focus), and the pull keeps the unsynced local row win.
       * The optimistic write is only a safety net: when the queue is unavailable (or a privileged
       * caller needs a synchronous ack) we fall back to the old direct path.
       */
      const requireAck = dispatchOptions?.requireAuthoritativeAck === true;
      if (!requireAck) {
        try {
          await enqueuePendingAuthoritativeCompanyDocWrite(companyId, collectionName, docId, data, options);
          schedulePlServerAuthoritativeReplayDrain("authoritative_http_durable_first");
          return;
        } catch {
          /* queue unavailable (no transport / hardened store) — fall through to the direct write */
        }
      }
      try {
        await invokePlServerAuthoritativeDocUpsert(companyId, collectionName, docId, data, options);
      } catch (e) {
        if (dispatchOptions?.requireAuthoritativeAck) {
          throw e;
        }
        const { flushPlServerDeltaDocPushNow } = await import("@/lib/plServerClientDeltaSync");
        const mirrorPush = await flushPlServerDeltaDocPushNow(companyId, collectionName, docId, data);
        if (mirrorPush.ok) {
          return;
        }
        if (isAuthoritativeWriteFailureRetryable(classifyAuthoritativeWriteFailure(e))) {
          await enqueuePendingAuthoritativeCompanyDocWrite(
            companyId,
            collectionName,
            docId,
            data,
            options
          );
          schedulePlServerAuthoritativeReplayDrain("authoritative_http_retryable_failure");
          return;
        }
        throw e;
      }
      return;
    }
    case "pending_enqueue":
      if (dispatchOptions?.requireAuthoritativeAck) {
        throw new PlServerAuthoritativeWriteError("authoritative_route_unavailable");
      }
      await enqueuePendingAuthoritativeCompanyDocWrite(companyId, collectionName, docId, data, options);
      schedulePlServerAuthoritativeReplayDrain("pending_enqueue");
      return;
    default: {
      const _exhaustive: never = route;
      return _exhaustive;
    }
  }
}

/** Resolve route then execute (except local_commit). */
export async function orchestrateCompanyDocBrowserWrite(
  companyId: string,
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  options?: UpsertCompanyBrowserOptions,
  dispatchOptions?: CompanyDocBrowserWriteDispatchOptions
): Promise<CompanyDocBrowserWriteRoute> {
  const simulateLanClient = consumeVerifySkipHostBridgeFlag();
  const route = await resolveCompanyDocBrowserWriteRoute(companyId, options, { simulateLanClient });
  if (dispatchOptions?.requireAuthoritativeAck && route.kind === "local_commit") {
    throw new PlServerAuthoritativeWriteError("authoritative_route_unavailable");
  }
  if (route.kind !== "local_commit") {
    await preflightAttachmentsForAuthoritativeRoute(route, companyId, data);
    await executeCompanyDocBrowserWriteRoute(route, companyId, collectionName, docId, data, options, dispatchOptions);
  }
  return route;
}

export { PlServerAuthoritativeWriteError };
