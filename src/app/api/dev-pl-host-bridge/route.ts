import { NextResponse } from "next/server";
import {
  claimNextDevHostBridgeJob,
  completeDevHostBridgeJob,
  invokeDevHostBridgeJob,
  type DevHostBridgeJobType,
} from "@/lib/devPlHostBridge/queue";

function isDevHostBridgeEnabled(req?: Request): boolean {
  if (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_PL_DEV_LOCAL_SERVER === "1") {
    return true;
  }
  if (!req) return false;
  const host = (req.headers.get("host") || "").split(":")[0]?.toLowerCase();
  const fwd = (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim().toLowerCase();
  const loopback = (h: string) =>
    h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
  return loopback(host) || loopback(fwd);
}

function isLoopbackRequest(req: Request): boolean {
  const fwd = (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim();
  const host = (req.headers.get("host") || "").split(":")[0]?.toLowerCase();
  const candidates = [fwd, host].filter(Boolean);
  return candidates.some(
    (h) => h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1"
  );
}

export async function GET(req: Request) {
  if (!isDevHostBridgeEnabled(req)) {
    return NextResponse.json({ error: "Not available outside development" }, { status: 403 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get("action") !== "claim") {
    return NextResponse.json({ error: "Missing action=claim" }, { status: 400 });
  }
  const job = claimNextDevHostBridgeJob();
  return NextResponse.json({ job });
}

export async function POST(req: Request) {
  if (!isDevHostBridgeEnabled(req)) {
    return NextResponse.json({ error: "Not available outside development" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    jobId?: string;
    result?: unknown;
    type?: DevHostBridgeJobType;
    payload?: Record<string, unknown>;
  };
  const action = String(body.action || "").trim();

  if (action === "complete") {
    const jobId = String(body.jobId || "").trim();
    if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    completeDevHostBridgeJob(jobId, body.result ?? null);
    return NextResponse.json({ ok: true });
  }

  if (action === "invoke") {
    if (!isLoopbackRequest(req)) {
      return NextResponse.json({ error: "Invoke allowed from loopback only" }, { status: 403 });
    }
    const type = body.type;
    if (!type) return NextResponse.json({ error: "Missing type" }, { status: 400 });
    const result = await invokeDevHostBridgeJob(type, body.payload || {});
    if (result == null) {
      return NextResponse.json(
        {
          error: "host_bridge_timeout",
          message:
            "Host browser bridge did not respond. On the server PC keep Pocket Ledger open in the browser (npm run dev tab) with Server sharing ON, then try again.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true, result });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
