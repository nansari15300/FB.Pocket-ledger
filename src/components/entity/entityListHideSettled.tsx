"use client";

import { useCallback, useSyncExternalStore } from "react";

let hideSettledStore = false;
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot() {
  return hideSettledStore;
}

function getServerSnapshot() {
  return false;
}

function setHideSettledStore(next: boolean) {
  if (hideSettledStore === next) return;
  hideSettledStore = next;
  listeners.forEach((listener) => listener());
}

/** Footer Hide Settled / Show Settled — same flag for every master list this session. */
export function useEntityListHideSettled(): {
  hideSettled: boolean;
  setHideSettled: (next: boolean) => void;
} {
  const hideSettled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setHideSettled = useCallback((next: boolean) => {
    setHideSettledStore(next);
  }, []);
  return { hideSettled, setHideSettled };
}
