"use client";

import { Timestamp } from "@/lib/pbCompat/firestore";
import type { CloudSyncAction, LocalCloudSyncOperation } from "@/lib/localCloudSync/types";
import { PL_CLIENT_OFFLINE_FIRST_PERSIST_MS } from "@/lib/localMirrorServerMeta";

/** Local/remote row — Firestore Timestamp, ms number, ISO string, `{ seconds }` JSON. */
export function docEditTimeMs(payload: Record<string, unknown> | null | undefined): number {
  if (!payload) return 0;
  for (const key of ["lastEditedAt", "updatedAt", "createdAt"] as const) {
    const raw = payload[key];
    if (raw == null) continue;
    if (raw instanceof Timestamp) {
      const ms = raw.toMillis();
      if (Number.isFinite(ms)) return ms;
    }
    if (raw instanceof Date) {
      const ms = raw.getTime();
      if (Number.isFinite(ms)) return ms;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const ms = Date.parse(raw);
      if (Number.isFinite(ms)) return ms;
    }
    if (typeof raw === "object") {
      const o = raw as { __fsTs?: boolean; seconds?: number; nanoseconds?: number };
      if (typeof o.seconds === "number") {
        const ns = typeof o.nanoseconds === "number" ? o.nanoseconds : 0;
        return o.seconds * 1000 + Math.floor(ns / 1e6);
      }
    }
  }
  const pl = payload[PL_CLIENT_OFFLINE_FIRST_PERSIST_MS];
  if (typeof pl === "number" && Number.isFinite(pl)) return pl;
  return 0;
}

function remoteOpEditTimeMs(remote: LocalCloudSyncOperation): number {
  const fromOp = Number(remote.updatedAt);
  const fromPayload = docEditTimeMs(remote.payload);
  return Math.max(Number.isFinite(fromOp) ? fromOp : 0, fromPayload);
}

/** Remote apply se pehle: latest edit time wins; delete vs update → delete wins; pending local row mat overwrite karo. */
export function shouldApplyRemoteCloudSyncOp(
  localDoc: Record<string, unknown> | null,
  remote: LocalCloudSyncOperation,
  options?: { pendingLocalRow?: boolean }
): boolean {
  if (options?.pendingLocalRow === true) return false;

  const remoteTs = remoteOpEditTimeMs(remote);
  const localDeleted = localDoc?.isDeleted === true;
  const remoteDeleted = remote.action === "delete" || remote.payload.isDeleted === true;

  if (remoteDeleted) {
    if (!localDoc) return true;
    const localTs = docEditTimeMs(localDoc);
    // Naya local add — purani remote delete se UI se mat hatao jab tak op sync na ho.
    return remoteTs >= localTs;
  }
  if (localDeleted) return false;

  if (!localDoc) return true;
  const localTs = docEditTimeMs(localDoc);
  return remoteTs >= localTs;
}

export function mergeRemotePayloadIntoLocal(
  localDoc: Record<string, unknown> | null,
  remote: LocalCloudSyncOperation
): Record<string, unknown> {
  if (remote.action === "delete" || remote.payload.isDeleted === true) {
    return {
      ...(localDoc ?? {}),
      ...remote.payload,
      id: remote.rowId,
      isDeleted: true,
      updatedAt: remote.payload.updatedAt ?? remote.updatedAt,
    };
  }
  return {
    ...(localDoc ?? {}),
    ...remote.payload,
    id: remote.rowId,
    isDeleted: false,
    updatedAt: remote.payload.updatedAt ?? remote.updatedAt,
  };
}

export function inferCloudSyncActionFromPayload(
  payload: Record<string, unknown>,
  fallback: CloudSyncAction = "update"
): CloudSyncAction {
  if (payload.isDeleted === true) return "delete";
  return fallback;
}
