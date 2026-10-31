"use client";

/**
 * Tiny progress stores for the Pocket Ledger Server pulls (no deps):
 * - data pull: documents written into the local SQLite (X / N)
 * - files pull: server files saved on this device (X / N)
 * Read with `usePbDataPullProgress()` / `usePbFilesPullProgress()` (or get*Progress()).
 */

import { useSyncExternalStore } from "react";

export type PbDataPullProgress = {
  active: boolean;
  companyId: string;
  /** Collection being pulled (server name, e.g. pl_vouchers). */
  collection: string;
  /** Documents already written to the local database. */
  docs: number;
  /** Documents the server has for this company (null = not known yet). */
  total: number | null;
};

export type PbFilesPullPhase = "idle" | "listing" | "downloading" | "paused" | "done" | "error";

export type PbFilesPullProgress = {
  phase: PbFilesPullPhase;
  companyId: string;
  /** Files already on this device. */
  done: number;
  /** Files the server has for this company (this run). */
  total: number;
  /** Files that could not be downloaded this run (retried later). */
  failed: number;
  /** Files the server no longer has (404). */
  missing: number;
  /** Total size of the files still to download (bytes), when known. */
  remainingBytes: number;
  /** Human-readable note (storage warning, retry notice, ...). */
  message: string;
  /** Automatic pull switched off (after "Clear files cache") until the user starts it again. */
  autoOff: boolean;
};

const DATA_IDLE: PbDataPullProgress = { active: false, companyId: "", collection: "", docs: 0, total: null };
const FILES_IDLE: PbFilesPullProgress = {
  phase: "idle",
  companyId: "",
  done: 0,
  total: 0,
  failed: 0,
  missing: 0,
  remainingBytes: 0,
  message: "",
  autoOff: false,
};

function makeStore<T extends object>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  let lastEmit = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const emit = () => {
    lastEmit = Date.now();
    for (const fn of Array.from(subs)) fn();
  };
  return {
    get: () => state,
    set(patch: Partial<T> | T, opts?: { urgent?: boolean }) {
      state = { ...state, ...patch };
      if (opts?.urgent || Date.now() - lastEmit >= 200) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        emit();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          emit();
        }, 200);
      }
    },
    reset(next: T) {
      state = next;
      emit();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

const dataStore = makeStore<PbDataPullProgress>(DATA_IDLE);
const filesStore = makeStore<PbFilesPullProgress>(FILES_IDLE);

export const getPbDataPullProgress = (): PbDataPullProgress => dataStore.get();
export const getPbFilesPullProgress = (): PbFilesPullProgress => filesStore.get();

export function setPbDataPullProgress(patch: Partial<PbDataPullProgress>, urgent = false): void {
  dataStore.set(patch, { urgent });
}
export function resetPbDataPullProgress(): void {
  dataStore.reset(DATA_IDLE);
}
export function setPbFilesPullProgress(patch: Partial<PbFilesPullProgress>, urgent = false): void {
  filesStore.set(patch, { urgent });
}
export function resetPbFilesPullProgress(patch?: Partial<PbFilesPullProgress>): void {
  filesStore.reset({ ...FILES_IDLE, ...(patch || {}) });
}

export function usePbDataPullProgress(): PbDataPullProgress {
  return useSyncExternalStore(dataStore.subscribe, dataStore.get, () => DATA_IDLE);
}
export function usePbFilesPullProgress(): PbFilesPullProgress {
  return useSyncExternalStore(filesStore.subscribe, filesStore.get, () => FILES_IDLE);
}
