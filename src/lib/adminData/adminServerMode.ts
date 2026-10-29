"use client";

/**
 * Admin Panel on a Pocket Ledger Server login.
 *
 * Reads come from the server (see `isAdminServerDataActive` in pbReadSeam). Changes that still
 * need Firebase (or the Next.js admin APIs that need a Firebase token) are turned off with a
 * clear message instead of hanging or failing quietly.
 */

import { isPocketBaseAppSessionActive } from "@/lib/pocketbaseData/pbAppSession";
import { toast } from "@/hooks/use-toast";

export const ADMIN_SERVER_UNAVAILABLE_TITLE = "Not available on the server yet";
export const ADMIN_SERVER_UNAVAILABLE_MESSAGE =
  "You are signed in with Pocket Ledger Server. This change still needs Firebase, so it is turned off here for now.";

export const ADMIN_SERVER_VIEW_UNAVAILABLE_MESSAGE =
  "Not available on the server yet: this view still needs Firebase, so it is turned off on a Pocket Ledger Server login.";

/** The user is signed in with the server login (no Firebase session). */
export function isAdminServerMode(): boolean {
  try {
    return isPocketBaseAppSessionActive();
  } catch {
    return false;
  }
}

/** In server mode: shows the "not available on the server yet" message and returns true. */
export function adminServerWriteBlocked(): boolean {
  if (!isAdminServerMode()) return false;
  toast({ variant: "destructive", title: ADMIN_SERVER_UNAVAILABLE_TITLE, description: ADMIN_SERVER_UNAVAILABLE_MESSAGE });
  return true;
}