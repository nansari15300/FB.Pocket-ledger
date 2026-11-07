import { NextRequest, NextResponse } from "next/server";

/**
 * Proxies image requests to avoid CORS when embedding in PDFs.
 * Only allows Firebase Storage URLs for security.
 */
const ALLOWED_ORIGINS = [
  "https://firebasestorage.googleapis.com",
  "https://storage.googleapis.com",
];

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_ORIGINS.some((origin) => parsed.href.startsWith(origin));
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || !isAllowedUrl(url)) {
    return NextResponse.json(
      { error: "Invalid or disallowed URL" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream fetch failed: ${res.status}` },
        { status: 502 }
      );
    }
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const dataUrl = `data:${contentType};base64,${base64}`;
    return NextResponse.json({ dataUrl });
  } catch (err) {
    console.error("Image proxy error:", err);
    return NextResponse.json(
      { error: "Failed to fetch image" },
      { status: 502 }
    );
  }
}
