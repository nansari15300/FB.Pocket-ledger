"use client";

import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { apkEmbeddedSqliteFirstWritesPreferred } from "@/lib/apkOnlineFirestoreWritePolicy";

/**
 * EXE/APK/static IndexedDB `local:` bytes resolve kar sakte hain.
 * Web bhi ab EXE jaisa global local-first hai (2026-10-22): master avatar/docs `local:` pending (same browser
 * IndexedDB) me stage hote hain jab tak outbox push `pbatt:` na bana de - isliye web par bhi resolvable.
 * (Pehle yahan web = false tha -> naye account ka avatar list/header me hide hota tha, Edit kholne par hi dikhta.)
 * Kill switch (`pl_web_local_first_writes_off=1`) par purana hosted-web behaviour.
 */
export function canResolveLocalFileRefsOnThisDevice(): boolean {
  if (typeof window === "undefined") return false;
  if (isElectronDesktopApp() || isCapacitorNativeApp() || isStaticAppBuild()) return true;
  try {
    return apkEmbeddedSqliteFirstWritesPreferred();
  } catch {
    return false;
  }
}