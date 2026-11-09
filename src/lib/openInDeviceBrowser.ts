"use client";

/**
 * Open a link in the **device's real browser** (Chrome, Firefox, whatever the user picked), not in
 * an in-app Custom Tab.
 *
 * Why: `@capacitor/browser` opens a Custom Tab — a chrome-less web view layered on top of the app.
 * On several Android builds that overlay has no visible close button, and the back gesture is
 * consumed instead of closing it, so the user was stranded on a page inside Pocket Ledger with no
 * way back. An ordinary `ACTION_VIEW` intent hands the URL to the browser app, which owns its own
 * toolbar and its own back stack; pressing back there returns to Pocket Ledger.
 *
 * Fallbacks, in order:
 *   1. our `ExternalBrowser` plugin (real browser, registered in MainActivity)
 *   2. `Browser.open` Custom Tab (stays in-app — still better than a dead link)
 *   3. a plain `window.open` / anchor click (web, Electron)
 */

import { Capacitor, registerPlugin } from "@capacitor/core";

type ExternalBrowserPlugin = {
  openExternal(options: { url: string }): Promise<void>;
  openCustomTab(options: { url: string }): Promise<void>;
};

const ExternalBrowser = registerPlugin<ExternalBrowserPlugin>("ExternalBrowser");

function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function openWithAnchor(href: string): void {
  try {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => {
      try {
        a.remove();
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

async function openWithCustomTab(href: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: href });
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens `url` outside the app. Returns `true` when something handled it.
 * Only http(s) links go to the system browser; blob/data URLs are rendered by the in-app viewers
 * instead, so they are left alone.
 */
export async function openInDeviceBrowser(url: string): Promise<boolean> {
  const href = String(url || "").trim();
  if (!href || !/^https?:\/\//i.test(href)) return false;

  if (isNativeApp()) {
    try {
      await ExternalBrowser.openExternal({ url: href });
      return true;
    } catch (e) {
      console.warn("[openInDeviceBrowser] ExternalBrowser.openExternal failed, trying Custom Tab", e);
    }
    if (await openWithCustomTab(href)) return true;
  }

  const opened = typeof window !== "undefined" ? window.open(href, "_blank", "noopener,noreferrer") : null;
  if (!opened) openWithAnchor(href);
  return true;
}

/**
 * Keeps the in-app Custom Tab on purpose — for flows that must return to the app on a redirect URI
 * (OAuth hand-offs). Everything user-facing should prefer `openInDeviceBrowser`.
 */
export async function openInAppCustomTab(url: string): Promise<boolean> {
  const href = String(url || "").trim();
  if (!href) return false;
  if (await openWithCustomTab(href)) return true;
  openWithAnchor(href);
  return true;
}
