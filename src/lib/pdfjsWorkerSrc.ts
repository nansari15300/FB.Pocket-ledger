/**
 * Single place to set pdf.js worker URL (pdfToImage, in-app PDF preview, etc.).
 *
 * `public/pdf.worker.min.mjs` is copied from `node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs`
 * on `npm install` (see `scripts/copy-pdf-worker.cjs`). API and worker builds must match.
 *
 * EXE (Electron localhost static server) + APK WebView: root-relative `/...` kabhi MIME/host resolve me atak jata tha —
 * **`origin` + absolute href** + (packaged Electron) **`text/javascript` for *.mjs`** se worker load web jaisa stable.
 */

import { publicAssetUrl } from "@/lib/webAppBasePath";

const LOCAL_PDF_WORKER_PATH = "/pdf.worker.min.mjs";

/** Last-resort fallback when `version` is missing (keep aligned with installed `pdfjs-dist`). */
export const PDFJS_WORKER_VERSION_FALLBACK = "5.6.205";

/** `file://` + nested `out/.../index.html`: har parent folder me `pdf.worker.min.mjs` probe (Next export worker sirf `out/` root par) */
function collectLocalPdfWorkerHrefCandidates(): string[] {
  if (typeof window === "undefined") return [publicAssetUrl(LOCAL_PDF_WORKER_PATH)];
  const list: string[] = [];
  try {
    if (window.location.protocol === "file:") {
      let cur = new URL(window.location.href);
      for (let i = 0; i < 10; i++) {
        list.push(new URL("pdf.worker.min.mjs", cur.href).href);
        const next = new URL("../", cur.href);
        if (next.href === cur.href) break;
        cur = next;
      }
      return list.length ? list : [publicAssetUrl(LOCAL_PDF_WORKER_PATH)];
    }
    list.push(new URL(publicAssetUrl(LOCAL_PDF_WORKER_PATH), window.location.origin).href);
  } catch {
    list.push(publicAssetUrl(LOCAL_PDF_WORKER_PATH));
  }
  return list;
}

/** Pehli candidate — legacy `setPdfJsWorkerSrc` / imports */
export function resolvePdfJsWorkerHref(): string {
  return collectLocalPdfWorkerHrefCandidates()[0] ?? LOCAL_PDF_WORKER_PATH;
}

/**
 * Har `getDocument` se pehle await karo — worker URL set + local asset reachable check;
 * fail par CDN worker (sirf online) ta EXE/APK me bhi web jaisa PDF→canvas flow chale.
 */
export async function ensurePdfJsWorker(pdfjs: unknown, version?: string): Promise<void> {
  if (typeof window === "undefined") return;
  const ns = pdfjs as { GlobalWorkerOptions?: { workerSrc?: string } };
  if (!ns?.GlobalWorkerOptions) return;

  const v = version || PDFJS_WORKER_VERSION_FALLBACK;
  const locals = collectLocalPdfWorkerHrefCandidates();
  const cdn = `https://unpkg.com/pdfjs-dist@${v}/legacy/build/pdf.worker.min.mjs`;

  for (const href of locals) {
    ns.GlobalWorkerOptions.workerSrc = href;
    if (await fetchWorkerProbe(href)) return;
  }

  if (await fetchWorkerProbe(cdn)) {
    ns.GlobalWorkerOptions.workerSrc = cdn;
    return;
  }

  ns.GlobalWorkerOptions.workerSrc = locals[0] ?? resolvePdfJsWorkerHref();
}

async function fetchWorkerProbe(href: string): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = window.setTimeout(() => ac.abort(), 12_000);
    try {
      const res = await fetch(href, { method: "GET", cache: "force-cache", signal: ac.signal });
      if (!res.ok) return false;
      // Module workers reject application/octet-stream. A 200 with the wrong type is not a usable worker.
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct) return true;
      return ct.includes("javascript") || ct.includes("ecmascript");
    } finally {
      window.clearTimeout(t);
    }
  } catch {
    return false;
  }
}

/** Legacy sync hook — sirf URL set karta hai; naya code `ensurePdfJsWorker` prefer kare */
export function setPdfJsWorkerSrc(pdfjs: unknown, _version?: string): void {
  if (typeof window === "undefined") return;
  const ns = pdfjs as { GlobalWorkerOptions?: { workerSrc?: string } };
  if (ns?.GlobalWorkerOptions) {
    ns.GlobalWorkerOptions.workerSrc = resolvePdfJsWorkerHref();
  }
}

/**
 * `compressPdfForAttachment` retry: pehli baar same-origin worker fail ho to CDN worker try karo (ya ulta).
 * version pdfjs-dist se aata hai taaki worker build match rahe.
 */
export function alternatePdfJsWorkerSrc(current: string | undefined, version: string): string {
  const v = version || PDFJS_WORKER_VERSION_FALLBACK;
  const cdn = `https://unpkg.com/pdfjs-dist@${v}/legacy/build/pdf.worker.min.mjs`;
  const local = publicAssetUrl(LOCAL_PDF_WORKER_PATH);
  if (!current || current === LOCAL_PDF_WORKER_PATH || current === local || !current.includes("unpkg.com")) {
    return cdn;
  }
  return resolvePdfJsWorkerHref();
}
