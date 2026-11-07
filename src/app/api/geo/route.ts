import { NextRequest, NextResponse } from "next/server";

/**
 * Returns the country of the requesting client by IP (for signup categorization).
 * Uses ip-api.com (no key; 45 req/min). Client IP from x-forwarded-for / x-real-ip.
 */
export async function GET(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const clientIp = forwarded?.split(",")[0]?.trim() || realIp || null;

  const url = clientIp
    ? `http://ip-api.com/json/${encodeURIComponent(clientIp)}?fields=country`
    : "http://ip-api.com/json/?fields=country";

  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) {
      return NextResponse.json({ country: null }, { status: 200 });
    }
    const data = (await res.json()) as { country?: string; status?: string };
    const country =
      data.status === "success" && typeof data.country === "string"
        ? data.country
        : null;
    return NextResponse.json({ country });
  } catch {
    return NextResponse.json({ country: null }, { status: 200 });
  }
}
