/** English / Hindi / Nepali copy for an Unassigned file that has not reached the server yet. */

export const GALLERY_OFFLINE_PENDING_INTRO = {
  en: "This file is saved only on this PC because there was no internet; it will upload automatically when online.",
  hi: "\u092f\u0939 \u092b\u093c\u093e\u0907\u0932 \u0938\u093f\u0930\u094d\u092b\u093c \u0907\u0938 PC \u092a\u0930 \u0938\u0939\u0947\u091c\u0940 \u0917\u0908 \u0939\u0948, \u0915\u094d\u092f\u094b\u0902\u0915\u093f \u0907\u0902\u091f\u0930\u0928\u0947\u091f \u0928\u0939\u0940\u0902 \u0925\u093e; \u0911\u0928\u0932\u093e\u0907\u0928 \u0939\u094b\u0924\u0947 \u0939\u0940 \u092f\u0939 \u0905\u092a\u0928\u0947 \u0906\u092a \u0905\u092a\u0932\u094b\u0921 \u0939\u094b \u091c\u093e\u090f\u0917\u0940\u0964",
  ne: "\u092f\u094b \u092b\u093e\u0907\u0932 \u0907\u0928\u094d\u091f\u0930\u0928\u0947\u091f \u0928\u092d\u090f\u0915\u093e\u0932\u0947 \u092f\u0938 PC \u092e\u093e \u092e\u093e\u0924\u094d\u0930 \u0938\u0941\u0930\u0915\u094d\u0937\u093f\u0924 \u091b; \u0905\u0928\u0932\u093e\u0907\u0928 \u0939\u0941\u0928\u0947\u092c\u093f\u0924\u094d\u0924\u093f\u0915\u0948 \u0906\u092b\u0948\u0902 \u0905\u092a\u0932\u094b\u0921 \u0939\u0941\u0928\u094d\u091b\u0964",
} as const;

export const GALLERY_OFFLINE_PENDING_MARK = {
  en: "Offline",
  hi: "\u0911\u092b\u0932\u093e\u0907\u0928",
  ne: "\u0905\u092b\u0932\u093e\u0907\u0928",
} as const;

function langOf(introLang?: string | null): "en" | "hi" | "ne" {
  if (introLang === "hi" || introLang === "ne") return introLang;
  return "en";
}

export function galleryOfflinePendingIntro(introLang?: string | null): string {
  return GALLERY_OFFLINE_PENDING_INTRO[langOf(introLang)];
}

export function galleryOfflinePendingMark(introLang?: string | null): string {
  return GALLERY_OFFLINE_PENDING_MARK[langOf(introLang)];
}