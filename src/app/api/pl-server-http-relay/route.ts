import { NextRequest, NextResponse } from "next/server";

const RELAY_TIMEOUT_MS = 180_000;
const MAX_BINARY_BYTES = 12 * 1024 * 1024;

const ALLOWED_PATH_PREFIXES = ["/__pl_", "/__firebase_blob_proxy"];

function isAllowedPlServerRelayUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (!ALLOWED_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) return false;
    return true;
  } catch {
    return false;
  }
}

type RelayBody = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  responseMode?: "text" | "binary";
};

export async function POST(request: NextRequest) {
  let payload: RelayBody;
  try {
    payload = (await request.json()) as RelayBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = String(payload.url || "").trim();
  if (!url || !isAllowedPlServerRelayUrl(url)) {
    return NextResponse.json({ error: "Invalid or disallowed PL server URL" }, { status: 400 });
  }

  const method = String(payload.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return NextResponse.json({ error: "Only GET and POST are supported" }, { status: 400 });
  }

  const forwardHeaders: Record<string, string> = { Accept: "application/json" };
  const incoming = payload.headers && typeof payload.headers === "object" ? payload.headers : {};
  for (const [key, value] of Object.entries(incoming)) {
    const k = String(key || "").trim();
    if (!k || k.toLowerCase() === "host") continue;
    forwardHeaders[k] = String(value ?? "");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method,
      headers: forwardHeaders,
      body: method === "POST" && payload.body != null ? String(payload.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });

    if (payload.responseMode === "binary") {
      const buffer = await upstream.arrayBuffer();
      if (buffer.byteLength > MAX_BINARY_BYTES) {
        return NextResponse.json({ error: "Attachment too large for relay" }, { status: 413 });
      }
      const bodyBase64 = Buffer.from(buffer).toString("base64");
      return NextResponse.json({
        status: upstream.status,
        bodyBase64,
        contentType: upstream.headers.get("content-type"),
      });
    }

    const body = await upstream.text();
    return NextResponse.json({ status: upstream.status, body });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = /abort|timeout/i.test(msg);
    return NextResponse.json(
      {
        error: timedOut
          ? "Host server timed out — check that sharing is on and the address is reachable from the internet."
          : "Cannot reach host server — verify public IP, port forwarding, and firewall.",
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
