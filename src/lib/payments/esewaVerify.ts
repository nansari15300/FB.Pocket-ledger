import crypto from "crypto";

/**
 * Security fix 2: never trust the browser's decoded eSewa payload alone.
 * 1) HMAC-SHA256 signature over `signed_field_names` with the merchant secret.
 * 2) Server-to-server eSewa transaction status API must say COMPLETE.
 */

const ESEWA_UAT_CODE = "EPAYTEST";
const ESEWA_STATUS_URL_UAT = "https://rc.esewa.com.np/api/epay/transaction/status/";
const ESEWA_STATUS_URL_LIVE = "https://epay.esewa.com.np/api/epay/transaction/status/";

export function getEsewaStatusUrl(merchantCode: string): string {
  const override = process.env.ESEWA_STATUS_URL?.trim();
  if (override) return override;
  return merchantCode.trim() === ESEWA_UAT_CODE ? ESEWA_STATUS_URL_UAT : ESEWA_STATUS_URL_LIVE;
}

function fieldString(v: unknown): string {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

export function esewaSignatureValid(decoded: Record<string, unknown>, secretKey: string): boolean {
  const secret = secretKey.trim();
  const names = fieldString(decoded.signed_field_names).trim();
  const sig = fieldString(decoded.signature).trim();
  if (!secret || !names || !sig) return false;
  const message = names
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => `${n}=${fieldString(decoded[n])}`)
    .join(",");
  const want = crypto.createHmac("sha256", secret).update(message).digest("base64");
  const a = Buffer.from(want);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type EsewaVerifyResult =
  | { ok: true; refId: string }
  | { ok: false; error: string; status: number };

export async function verifyEsewaPayment(input: {
  decoded: Record<string, unknown>;
  merchantCode: string;
  secretKey: string;
  transactionUuid: string;
  totalAmount: unknown;
}): Promise<EsewaVerifyResult> {
  const code = input.merchantCode.trim();
  if (!code || !input.secretKey.trim()) {
    return { ok: false, error: "eSewa is not configured on this server.", status: 503 };
  }
  if (!esewaSignatureValid(input.decoded, input.secretKey)) {
    return { ok: false, error: "eSewa signature check failed.", status: 400 };
  }
  const productCode = fieldString(input.decoded.product_code).trim();
  if (productCode && productCode !== code) {
    return { ok: false, error: "eSewa merchant mismatch.", status: 400 };
  }
  const qs = new URLSearchParams({
    product_code: code,
    total_amount: fieldString(input.totalAmount).replace(/,/g, ""),
    transaction_uuid: input.transactionUuid,
  });
  let res: Response;
  try {
    res = await fetch(`${getEsewaStatusUrl(code)}?${qs.toString()}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, error: "Could not reach eSewa to confirm the payment. Try again.", status: 502 };
  }
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    transaction_uuid?: string;
    ref_id?: string | null;
  };
  if (!res.ok) {
    return { ok: false, error: "eSewa status check failed.", status: 502 };
  }
  if (json.transaction_uuid && json.transaction_uuid !== input.transactionUuid) {
    return { ok: false, error: "eSewa status mismatch.", status: 400 };
  }
  if (String(json.status || "").toUpperCase() !== "COMPLETE") {
    return { ok: false, error: `eSewa says the payment is ${json.status || "not complete"}.`, status: 402 };
  }
  return { ok: true, refId: String(json.ref_id || "") };
}

/**
 * Patch 10/13: eSewa verify switch from the sub-server Gateway page
 * (`app_settings/payment_gateways.esewaVerifyMode`). App default = auto (signature + status API).
 */
export type EsewaVerifyMode = "auto" | "manual";

export function esewaVerifyModeOf(raw: Record<string, unknown> | null | undefined): EsewaVerifyMode {
  return raw && raw.esewaVerifyMode === "manual" ? "manual" : "auto";
}

export const ESEWA_MANUAL_PENDING_MESSAGE =
  "Payment received. It will be activated after an admin verifies it.";
