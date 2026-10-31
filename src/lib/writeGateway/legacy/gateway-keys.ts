
/* No 'use server' - static export compatible */

/**
 * @fileOverview Securely manages payment gateway API keys using Firebase Firestore.
 * Plain async helpers (no Genkit) so admin UI and API routes can import without bundling Node-only AI SDK code in the browser.
 */

import { setDoc } from "@/lib/writeGateway/firestoreMutationsInternal";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { z } from 'zod';
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from '@/lib/firebase';

const GatewayKeysSchema = z.object({
  stripeSecretKey: z.string().optional(),
  khaltiPublicKey: z.string().optional(),
  esewaMerchantCode: z.string().optional(),
  esewaSecretKey: z.string().optional(),
});

export type GatewayKeys = z.infer<typeof GatewayKeysSchema>;

/** `app_settings/payment_gateways` — plan page par kaunsa gateway dikhe (keys alag configure hote hain). */
export type GatewayPaymentFlags = {
  stripePaymentEnabled: boolean;
  khaltiPaymentEnabled: boolean;
  esewaPaymentEnabled: boolean;
};

export const DEFAULT_GATEWAY_PAYMENT_FLAGS: GatewayPaymentFlags = {
  stripePaymentEnabled: true,
  khaltiPaymentEnabled: true,
  esewaPaymentEnabled: true,
};

export function parseGatewayPaymentFlags(
  raw: Record<string, unknown> | null | undefined
): GatewayPaymentFlags {
  if (!raw) return { ...DEFAULT_GATEWAY_PAYMENT_FLAGS };
  return {
    stripePaymentEnabled: raw.stripePaymentEnabled !== false,
    khaltiPaymentEnabled: raw.khaltiPaymentEnabled !== false,
    esewaPaymentEnabled: raw.esewaPaymentEnabled !== false,
  };
}

/** Billing UI + `/api/payments/gateway-status` — configured keys + admin toggle dono true hon. */
export function resolveBillingGatewayAvailability(
  keys: GatewayKeys,
  flags: GatewayPaymentFlags
): { stripe: boolean; khalti: boolean; esewa: boolean } {
  return {
    stripe: !!keys.stripeSecretKey?.trim() && flags.stripePaymentEnabled,
    khalti: !!keys.khaltiPublicKey?.trim() && flags.khaltiPaymentEnabled,
    esewa:
      !!(keys.esewaMerchantCode?.trim() && keys.esewaSecretKey?.trim()) && flags.esewaPaymentEnabled,
  };
}

export type BillingGatewayId = "stripe" | "khalti" | "esewa";

export function isBillingGatewayAvailable(
  gateway: BillingGatewayId,
  keys: GatewayKeys,
  flags: GatewayPaymentFlags
): boolean {
  return resolveBillingGatewayAvailability(keys, flags)[gateway];
}

/** Official eSewa Epay v2 UAT merchant id — public test credential (developer.esewa.com.np Test credentials). */
export const ESEWA_UAT_MERCHANT_CODE = 'EPAYTEST';

/**
 * Official eSewa Epay v2 UAT HMAC secret — public test-only value from eSewa docs (not a live merchant secret).
 * Use with EPAYTEST + rc-epay UAT form URL; test wallet 9806800001–5 / Nepal@123.
 */
export const ESEWA_UAT_SECRET_KEY = '8gBm/:&EnhH.1/q';

/** Epay v2 form POST — UAT `rc-epay` (not legacy `uat.esewa.com.np`, DNS often fails). */
export const ESEWA_EPAY_V2_FORM_URL_UAT = 'https://rc-epay.esewa.com.np/api/epay/main/v2/form';
export const ESEWA_EPAY_V2_FORM_URL_LIVE = 'https://epay.esewa.com.np/api/epay/main/v2/form';

/** Merchant EPAYTEST → rc UAT; else production v2 form. Optional env override for either. */
export function getEsewaEpayV2FormUrl(merchantCode: string): string {
  const override = process.env.ESEWA_EPAY_FORM_URL?.trim();
  if (override) return override;
  const code = merchantCode.trim();
  return code === ESEWA_UAT_MERCHANT_CODE ? ESEWA_EPAY_V2_FORM_URL_UAT : ESEWA_EPAY_V2_FORM_URL_LIVE;
}

/** Khalti widget sandbox public key — khalti-checkout-web docs / test-admin merchant. */
export const KHALTI_UAT_PUBLIC_KEY = 'test_public_key_dc74e0fd57cb46cd93832aee0a507256';

/** Khalti payment verify (sandbox + live both use v2 on khalti.com). */
export const KHALTI_PAYMENT_VERIFY_URL = 'https://khalti.com/api/v2/payment/verify/';

export function isKhaltiSandboxPublicKey(publicKey: string): boolean {
  return publicKey.trim().startsWith('test_public_key_');
}

/** Optional `KHALTI_VERIFY_URL` override; default official v2 verify endpoint. */
export function getKhaltiPaymentVerifyUrl(): string {
  const override = process.env.KHALTI_VERIFY_URL?.trim();
  return override || KHALTI_PAYMENT_VERIFY_URL;
}

/** Server verify — `KHALTI_SECRET_KEY` or `KHALTI_TEST_SECRET_KEY` (pair with test_public_key_*). */
export function resolveKhaltiSecretKeyFromEnv(): string | undefined {
  const s =
    process.env.KHALTI_SECRET_KEY?.trim() || process.env.KHALTI_TEST_SECRET_KEY?.trim();
  return s || undefined;
}

const keysDocRef = doc(firestore, 'app_settings', 'payment_gateways');

/** eSewa public UAT defaults — only auto-filled in development. */
function isDevPaymentFallbackEnabled(): boolean {
  return process.env.NODE_ENV === 'development';
}

function pickStr(v: string | undefined): string | undefined {
  const t = v?.trim();
  if (!t) return undefined;
  // `.env.example` placeholders — treat as unset so dev UAT fallbacks apply
  if (/^your_/i.test(t) || /^changeme$/i.test(t) || /^placeholder$/i.test(t)) return undefined;
  return t;
}

/**
 * Merge stored gateway doc with server env (Stripe/Khalti/eSewa; Khalti/eSewa UAT in dev when still empty).
 * Khalti: Firestore → KHALTI_TEST_PUBLIC_KEY → NEXT_PUBLIC_* / KHALTI_PUBLIC_KEY → dev `KHALTI_UAT_PUBLIC_KEY`.
 * eSewa: Firestore → ESEWA_* env → dev EPAYTEST + UAT secret.
 * Payment API route should pass `stored` from Firebase Admin read — client `getGatewayKeys()` cannot run unauthenticated on the server.
 */
export function mergeGatewayKeysWithEnv(stored: GatewayKeys): GatewayKeys {
  const stripe =
    pickStr(stored.stripeSecretKey) ??
    pickStr(process.env.STRIPE_TEST_SECRET_KEY) ??
    pickStr(process.env.STRIPE_SECRET_KEY);
  const khalti =
    pickStr(stored.khaltiPublicKey) ??
    pickStr(process.env.KHALTI_TEST_PUBLIC_KEY) ??
    pickStr(process.env.NEXT_PUBLIC_KHALTI_PUBLIC_KEY) ??
    pickStr(process.env.KHALTI_PUBLIC_KEY) ??
    (isDevPaymentFallbackEnabled() ? KHALTI_UAT_PUBLIC_KEY : undefined);
  const esewaCodeStored = pickStr(stored.esewaMerchantCode);
  const esewaSecretStored = pickStr(stored.esewaSecretKey);
  const esewaCode =
    esewaCodeStored ??
    pickStr(process.env.ESEWA_MERCHANT_CODE) ??
    (isDevPaymentFallbackEnabled() ? ESEWA_UAT_MERCHANT_CODE : undefined);
  const esewaSecret =
    esewaSecretStored ??
    pickStr(process.env.ESEWA_SECRET_KEY) ??
    (isDevPaymentFallbackEnabled() ? ESEWA_UAT_SECRET_KEY : undefined);

  return {
    stripeSecretKey: stripe,
    khaltiPublicKey: khalti,
    esewaMerchantCode: esewaCode,
    esewaSecretKey: esewaSecret,
  };
}

/** Client-side: authenticated Firestore read + env merge (do not use from API routes without auth). */
export async function resolveGatewayKeysForPayments(): Promise<GatewayKeys> {
  const stored = await getGatewayKeys();
  return mergeGatewayKeysWithEnv(stored);
}

export async function getGatewayKeys(): Promise<GatewayKeys> {
  let serverSession = false;
  try {
    if (typeof window !== 'undefined') {
      const { isPocketBaseAppSessionActive } = await import('@/lib/pocketbaseData/pbAppSession');
      serverSession = isPocketBaseAppSessionActive();
    }
    if (serverSession) {
      // Server login: Firestore is offline. Admin Panel (super admin) reads via the server; otherwise no keys.
      const seam = await import('@/lib/pocketbaseData/pbReadSeam');
      if (!seam.isAdminServerDataActive()) return {};
      const snap = await seam.getDoc(keysDocRef);
      return snap.exists() ? (snap.data() as GatewayKeys) : {};
    }
    const docSnap = await getDoc(keysDocRef);
    if (docSnap.exists()) {
      return docSnap.data() as GatewayKeys;
    }
    return {};
  } catch (e) {
    if (serverSession) {
      console.warn('[gateway-keys] server read failed', e instanceof Error ? e.message : String(e));
      return {};
    }
    console.error('Error fetching gateway keys:', e);
    return {};
  }
}

/** Admin card switch — sirf plan page payment option; keys/doc merge. */
export async function updateGatewayPaymentFlags(
  patch: Partial<GatewayPaymentFlags>
): Promise<void> {
  await setDoc(keysDocRef, patch, { merge: true });
}

export async function updateGatewayKeys(keys: GatewayKeys): Promise<void> {
  // Firestore rejects `undefined` (and non-primitive oddities); normalise every field to string.
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  await setDoc(
    keysDocRef,
    {
      stripeSecretKey: str(keys.stripeSecretKey),
      khaltiPublicKey: str(keys.khaltiPublicKey),
      esewaMerchantCode: str(keys.esewaMerchantCode),
      esewaSecretKey: str(keys.esewaSecretKey),
    },
    { merge: true }
  );
}
