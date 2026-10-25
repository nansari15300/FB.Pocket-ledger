"use client";

import { doc, setDoc, collection, collectionGroup, deleteDoc, serverTimestamp, query, orderBy, where, writeBatch } from "firebase/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { resolveDeviceSlotForCompanyWrite } from "@/lib/deviceSlotForUserDevices";
import { isUnlimitedEntitlementCap } from "@/config/plans";

type PlElectronDeviceApi = { getDisplayLabel?: () => Promise<string> };

const DEVICE_ID_KEY = "pocket_ledger_device_id";
/** `localStorage` wipe par bhi UUID wapas mile — sirf ek hi jagah rakhe to duplicate Firestore `/devices/{id}` docs kam */
const DEVICE_ID_COOKIE = "pl_did_v1";
const KICKED_STORAGE_PREFIX = "pl_kicked_";

function readDeviceIdFromCookie(): string {
  if (typeof document === "undefined") return "";
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${DEVICE_ID_COOKIE}=([^;]*)`));
    const raw = m?.[1] ? decodeURIComponent(m[1]).trim() : "";
    return raw.length >= 8 ? raw : "";
  } catch {
    return "";
  }
}

function writeDeviceIdCookie(id: string): void {
  if (typeof document === "undefined" || !id) return;
  try {
    const maxAgeSec = 10 * 365 * 24 * 60 * 60;
    const isHttps = typeof location !== "undefined" && location.protocol === "https:";
    const securePart = isHttps ? ";Secure" : "";
    document.cookie = `${DEVICE_ID_COOKIE}=${encodeURIComponent(id)};path=/;max-age=${maxAgeSec};SameSite=Lax${securePart}`;
  } catch {
    /* strict mode / iframe — ignore */
  }
}

export function getWasKicked(companyId: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KICKED_STORAGE_PREFIX + companyId) === "1";
}

export function setKickedForCompany(companyId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KICKED_STORAGE_PREFIX + companyId, "1");
}

export function clearKickedForCompany(companyId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KICKED_STORAGE_PREFIX + companyId);
}

/**
 * Human-readable device name from user agent (e.g. "Chrome (Windows)", "Safari (iPhone)", "Chrome (Android)").
 * Only available on client; returns "" on server.
 */
export function getDeviceLabel(): string {
  if (typeof navigator === "undefined" || !navigator.userAgent) return "";
  const ua = navigator.userAgent;
  const isMobile = /Mobile|Android|iPhone|iPad|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  let browser = "Browser";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("SamsungBrowser")) browser = "Samsung Internet";
  else if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Opera") || ua.includes("OPR")) browser = "Opera";
  if (isMobile) {
    if (/iPhone|iPad/i.test(ua)) return `${browser} (${/iPad/.test(ua) ? "iPad" : "iPhone"})`;
    if (/Android/i.test(ua)) {
      const m = ua.match(/Android\s*[^;]*;\s*([^)]+)\)/);
      const part = m ? m[1].trim() : "";
      // Short/unclear codes (e.g. "K") show as "Mobile" for clarity
      if (part && part.length >= 2 && part.length < 30) return `${browser} (${part})`;
      return `${browser} (Mobile)`;
    }
    return `${browser} (Mobile)`;
  }
  if (/Windows/i.test(ua)) return `${browser} (Windows)`;
  if (/Mac OS X|Macintosh/i.test(ua)) return `${browser} (Mac)`;
  if (/Linux/i.test(ua)) return `${browser} (Linux)`;
  return browser;
}

const NATIVE_DEVICE_LABEL_MAX = 120;

/**
 * Firestore `deviceLabel` ke liye:
 * - **Electron EXE**: main process `os.hostname` + platform/release (PC naam, APK-style readable).
 * - **Capacitor**: `@capacitor/device` model/manufacturer/OS.
 * - **Web**: UA string (`getDeviceLabel`) — "Chrome (Windows)" etc.
 */
export async function resolveDeviceLabelForFirestoreAsync(): Promise<string | undefined> {
  if (typeof navigator === "undefined") return undefined;
  // Electron EXE: preload `plElectronDevice` — PC hostname + OS (Capacitor `Device.getInfo` jaisa readable).
  if (typeof window !== "undefined") {
    try {
      const api = (window as unknown as { plElectronDevice?: PlElectronDeviceApi }).plElectronDevice;
      if (typeof api?.getDisplayLabel === "function") {
        const raw = await api.getDisplayLabel();
        const s = String(raw ?? "").trim();
        if (s.length > 0) return s.slice(0, NATIVE_DEVICE_LABEL_MAX);
      }
    } catch {
      /* preload purana / IPC — niche UA fallback */
    }
  }
  if (!isCapacitorNativeApp()) {
    const s = getDeviceLabel().trim();
    return s.length > 0 ? s.slice(0, NATIVE_DEVICE_LABEL_MAX) : undefined;
  }
  try {
    const { Device } = await import("@capacitor/device");
    const info = await Device.getInfo();
    const brand = String(info.manufacturer ?? "").trim();
    const model = String(info.model ?? "").trim();
    const name = String(info.name ?? "").trim();
    const coreRaw = [brand, model || name].filter(Boolean).join(" ").trim() || name || model || "Device";
    const os = String(info.operatingSystem ?? "").trim();
    const ver = String(info.osVersion ?? "").trim();
    const osPart = os && ver ? `${os} ${ver}` : os || ver;
    const combined = osPart ? `${coreRaw} (${osPart})` : coreRaw;
    const cleaned = combined.replace(/\s+/g, " ").trim();
    if (cleaned.length > 0) return cleaned.slice(0, NATIVE_DEVICE_LABEL_MAX);
  } catch {
    /* plugin missing / WebView — UA fallback */
  }
  const fallback = getDeviceLabel().trim();
  return fallback.length > 0 ? fallback.slice(0, NATIVE_DEVICE_LABEL_MAX) : undefined;
}

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = (localStorage.getItem(DEVICE_ID_KEY) || "").trim();
  /** Sirf LS clear hone par hi naya slot — cookie me purana UUID ho to wahi restore (duplicate "Chrome Windows" rows kam). */
  if (!id) {
    const fromCookie = readDeviceIdFromCookie();
    if (fromCookie) {
      id = fromCookie;
      try {
        localStorage.setItem(DEVICE_ID_KEY, id);
      } catch {
        /* LS full / blocked — cookie se hi age badhenge */
      }
    }
  }
  if (!id) {
    id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      /* ignore */
    }
    writeDeviceIdCookie(id);
    return id;
  }
  if (readDeviceIdFromCookie() !== id) writeDeviceIdCookie(id);
  return id;
}

export type DeviceLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  isNewDevice: boolean;
  singleDeviceOnly?: boolean;
  /** True when slot is full but this user has another device; show "Logout on old device and use this device?" Yes/No. */
  replaceOffer?: boolean;
  /** True when User Can Use Multi Device = Off and shared user tries to use a new device; show "No permission to use multi device. Only one device allowed." */
  noPermissionNewDevice?: boolean;
  /** True when this device was kicked; show message with Switch company / Logout / Rejoin. Do not auto re-add until user chooses. */
  kickedAndBlocked?: boolean;
};

/**
 * Register current device for the company and check if within plan limit.
 * Call when user has company selected. Returns allowed: false when over limit (new device and count >= maxDevices).
 * When userCanUseMultiDevice is false and user is not owner, shared user can only have one device (singleDeviceOnly).
 */
export async function registerDeviceAndCheckLimit(
  companyId: string,
  userId: string,
  maxDevices: number,
  hasMultiDeviceSync: boolean,
  options?: {
    userCanUseMultiDevice?: boolean;
    isOwner?: boolean;
    wasKicked?: boolean;
    /** Count physical device IDs across all companies for this user, not once per company. */
    accountScoped?: boolean;
  }
): Promise<DeviceLimitResult> {
  // Caps: 0 = none; -1 = unlimited; >0 = hard limit. Multi-sync off → single device.
  if (!hasMultiDeviceSync) {
    return { allowed: true, count: 1, limit: 1, isNewDevice: false };
  }

  const unlimited = isUnlimitedEntitlementCap(maxDevices);
  const cap = unlimited ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.floor(Number(maxDevices) || 0));
  const limitForUi = unlimited ? -1 : cap;

  const deviceId = getOrCreateDeviceId();
  if (!deviceId) return { allowed: true, count: 1, limit: limitForUi, isNewDevice: false };

  const deviceType = typeof navigator !== "undefined" && /Mobile|Android|iPhone|iPad|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ? "mobile" : "desktop";

  const [companySnap, allDevicesSnap, accountDevicesSnap] = await Promise.all([
    getDoc(doc(firestore, "companies", companyId)),
    getDocs(collection(firestore, "companies", companyId, "devices")),
    options?.accountScoped
      ? getDocs(query(collectionGroup(firestore, "devices"), where("userId", "==", userId)))
      : Promise.resolve(null),
  ]);
  const companyData = companySnap.data();
  // Prefer caller's value (from company context, real-time) so ON takes effect immediately; fallback to Firestore
  const userCanUseMultiDevice =
    options?.userCanUseMultiDevice !== undefined
      ? options.userCanUseMultiDevice !== false
      : (companyData?.userCanUseMultiDevice !== false);
  const isOwner = options?.isOwner === true;

  const accountDeviceIds = new Set(accountDevicesSnap?.docs.map((d) => d.id) ?? []);
  const totalCount = options?.accountScoped ? accountDeviceIds.size : allDevicesSnap.size;
  const existing = allDevicesSnap.docs.find((d) => d.id === deviceId);
  const existingForQuota = options?.accountScoped ? accountDeviceIds.has(deviceId) : Boolean(existing);
  const myOtherDevices = allDevicesSnap.docs.filter((d) => d.data()?.userId === userId && d.id !== deviceId);

  // Kicked device: do not auto re-add; show message so user can Switch company / Logout / Rejoin
  if (!existing && options?.wasKicked) {
    return { allowed: false, count: totalCount, limit: limitForUi, isNewDevice: true, kickedAndBlocked: true };
  }

  const deviceLabel = await resolveDeviceLabelForFirestoreAsync();
  const slotCap = unlimited || cap < 1 ? Number.MAX_SAFE_INTEGER : cap;
  /** deviceSlot — multi-company sync list ke liye; pehle khali slot reuse ho sake isliye collectionGroup se resolve. */
  const doReplaceAndRegister = async () => {
    for (const d of myOtherDevices) {
      await deleteDoc(doc(firestore, "companies", companyId, "devices", d.id));
    }
    const deviceSlot = await resolveDeviceSlotForCompanyWrite(userId, deviceId, slotCap);
    await setDoc(doc(firestore, "companies", companyId, "devices", deviceId), {
      userId,
      lastActive: serverTimestamp(),
      deviceType,
      deviceSlot,
      ...(deviceLabel ? { deviceLabel } : {}),
    });
  };

  // Exact 0 devices: keep existing registration; block new devices.
  if (!unlimited && cap < 1) {
    if (existing || existingForQuota) {
      const prevData = existing?.data() as { deviceSlot?: unknown } | undefined;
      const prevSlot =
        typeof prevData?.deviceSlot === "number" && Number.isFinite(prevData.deviceSlot)
          ? Math.floor(prevData.deviceSlot)
          : undefined;
      const deviceSlot =
        prevSlot != null && prevSlot >= 1 ? prevSlot : await resolveDeviceSlotForCompanyWrite(userId, deviceId, 1);
      await setDoc(doc(firestore, "companies", companyId, "devices", deviceId), {
        userId,
        lastActive: serverTimestamp(),
        deviceType,
        deviceSlot,
        ...(deviceLabel ? { deviceLabel } : {}),
      });
      return { allowed: true, count: totalCount, limit: 0, isNewDevice: false };
    }
    return { allowed: false, count: totalCount, limit: 0, isNewDevice: true };
  }

  // User Can Use Multi Device = Off + shared user + this user has other device(s): do not allow new device; show no-permission message
  if (!userCanUseMultiDevice && !isOwner && myOtherDevices.length >= 1 && !existing) {
    return { allowed: false, count: totalCount, limit: limitForUi, isNewDevice: true, singleDeviceOnly: true, noPermissionNewDevice: true };
  }

  if (existing) {
    const prevData = existing.data() as { deviceSlot?: unknown };
    const prevSlot =
      typeof prevData?.deviceSlot === "number" && Number.isFinite(prevData.deviceSlot)
        ? Math.floor(prevData.deviceSlot)
        : undefined;
    const deviceSlot =
      prevSlot != null && prevSlot >= 1 ? prevSlot : await resolveDeviceSlotForCompanyWrite(userId, deviceId, slotCap);
    await setDoc(doc(firestore, "companies", companyId, "devices", deviceId), {
      userId,
      lastActive: serverTimestamp(),
      deviceType,
      deviceSlot,
      ...(deviceLabel ? { deviceLabel } : {}),
    });
    return { allowed: true, count: totalCount, limit: limitForUi, isNewDevice: false };
  }

  // Slot full: if User Can Use Multi Device = Off and shared user has other devices, do not allow (no-permission)
  if (!unlimited && !existingForQuota && totalCount >= cap && !userCanUseMultiDevice && !isOwner && myOtherDevices.length >= 1) {
    return { allowed: false, count: totalCount, limit: limitForUi, isNewDevice: true, singleDeviceOnly: true, noPermissionNewDevice: true };
  }

  if (!unlimited && !existingForQuota && totalCount >= cap) {
    const replaceOffer = !isOwner && myOtherDevices.length >= 1;
    return { allowed: false, count: totalCount, limit: limitForUi, isNewDevice: true, replaceOffer: replaceOffer || undefined };
  }

  const deviceSlotNew = await resolveDeviceSlotForCompanyWrite(userId, deviceId, slotCap);
  await setDoc(doc(firestore, "companies", companyId, "devices", deviceId), {
    userId,
    lastActive: serverTimestamp(),
    deviceType,
    deviceSlot: deviceSlotNew,
    ...(deviceLabel ? { deviceLabel } : {}),
  });
  return {
    allowed: true,
    count: existingForQuota ? totalCount : totalCount + 1,
    limit: limitForUi,
    isNewDevice: !existingForQuota,
  };
}

export async function replaceMyOtherDevicesAndRegister(
  companyId: string,
  userId: string,
  maxDevices: number,
): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  if (!deviceId) return;
  const deviceType = typeof navigator !== "undefined" && /Mobile|Android|iPhone|iPad|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ? "mobile" : "desktop";
  const snap = await getDocs(collection(firestore, "companies", companyId, "devices"));
  const myOther = snap.docs.filter((d) => d.data()?.userId === userId && d.id !== deviceId);
  for (const d of myOther) {
    await deleteDoc(doc(firestore, "companies", companyId, "devices", d.id));
  }
  const deviceLabel = await resolveDeviceLabelForFirestoreAsync();
  const cap = isUnlimitedEntitlementCap(maxDevices)
    ? Number.MAX_SAFE_INTEGER
    : Math.max(1, Math.floor(Number(maxDevices) || 1));
  const deviceSlotRep = await resolveDeviceSlotForCompanyWrite(userId, deviceId, cap);
  await setDoc(doc(firestore, "companies", companyId, "devices", deviceId), {
    userId,
    lastActive: serverTimestamp(),
    deviceType,
    deviceSlot: deviceSlotRep,
    ...(deviceLabel ? { deviceLabel } : {}),
  });
}

/** Ek device ko kick/remove karte waqt Firestore payloads — batch API ke liye */
export type KickOutDeviceInput = {
  id: string;
  userId: string;
  deviceType?: "mobile" | "desktop";
  deviceLabel?: string;
};

/** Har device par 2 ops (history set + devices delete); 500 limit se niche chunk — UI hang kam, ek trim */
const FIRESTORE_BATCH_MAX_OPS = 450;

/**
 * Ek ya zyada devices: history rows + deletes ek hi (ya chunked) writeBatch me; company doc ek baar; trim ek baar.
 * Pehle har kick par alag addDoc + trim tha → jaldi hang; ab bulk kick realistic.
 */
export async function kickOutDevicesBatch(companyId: string, devices: KickOutDeviceInput[]): Promise<void> {
  if (devices.length === 0) return;
  const companySnap = await getDoc(doc(firestore, "companies", companyId));
  const maxHistory = companySnap.data()?.deviceHistoryLimit;
  const maxEntries = typeof maxHistory === "number" && maxHistory >= 1 ? Math.min(1000, maxHistory) : 0;
  const historyCol = collection(firestore, "companies", companyId, "device_history");
  const devicesCol = collection(firestore, "companies", companyId, "devices");
  const perDeviceOps = 2;
  const chunkSize = Math.max(1, Math.floor(FIRESTORE_BATCH_MAX_OPS / perDeviceOps));

  for (let i = 0; i < devices.length; i += chunkSize) {
    const slice = devices.slice(i, i + chunkSize);
    const batch = writeBatch(firestore);
    for (const device of slice) {
      const deviceType = device.deviceType ?? "desktop";
      const histRef = doc(historyCol);
      batch.set(histRef, {
        deviceId: device.id,
        userId: device.userId,
        lastActive: serverTimestamp(),
        deviceType,
        ...(device.deviceLabel ? { deviceLabel: device.deviceLabel } : {}),
        createdAt: serverTimestamp(),
      });
      batch.delete(doc(devicesCol, device.id));
    }
    await batch.commit();
  }
  if (maxEntries > 0) await trimDeviceHistoryToLimit(companyId, maxEntries);
}

/**
 * Back-compat: ek device — ab bhi ek hi code path (batch) taaki callers hang na karein
 */
export async function addDeviceHistoryEntryWhenRemoved(
  companyId: string,
  device: KickOutDeviceInput
): Promise<void> {
  try {
    await kickOutDevicesBatch(companyId, [device]);
  } catch {
    // non-blocking callers ke liye
  }
}

/**
 * Trim device_history to at most maxEntries. Keeps newest; deletes oldest.
 */
export async function trimDeviceHistoryToLimit(companyId: string, maxEntries: number): Promise<void> {
  if (maxEntries < 1) return;
  const col = collection(firestore, "companies", companyId, "device_history");
  const snap = await getDocs(query(col, orderBy("createdAt", "asc")));
  if (snap.size <= maxEntries) return;
  const toDeleteCount = snap.size - maxEntries;
  const toDelete = snap.docs.slice(0, toDeleteCount);
  // Sequential delete bahut dheere; batch se trim bhi responsive
  for (let i = 0; i < toDelete.length; i += FIRESTORE_BATCH_MAX_OPS) {
    const batch = writeBatch(firestore);
    toDelete.slice(i, i + FIRESTORE_BATCH_MAX_OPS).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

/**
 * Enforce plan device limit: if current device count exceeds maxDevices, remove oldest-active devices
 * (add to device_history then delete) until count <= maxDevices. Call when plan limit is reduced.
 */
export async function enforceDeviceLimitByPlan(companyId: string, maxDevices: number): Promise<void> {
  if (isUnlimitedEntitlementCap(maxDevices) || maxDevices < 1) return;
  const snap = await getDocs(collection(firestore, "companies", companyId, "devices"));
  if (snap.size <= maxDevices) return;
  const withTime = snap.docs.map((d) => {
    const data = d.data();
    const la = data?.lastActive;
    const lastActiveMs = la && typeof (la as { toMillis?: () => number }).toMillis === "function" ? (la as { toMillis: () => number }).toMillis() : 0;
    return {
      id: d.id,
      userId: data?.userId ?? "",
      lastActiveMs,
      deviceType: data?.deviceType === "mobile" || data?.deviceType === "desktop" ? data.deviceType : undefined,
      deviceLabel: typeof data?.deviceLabel === "string" ? data.deviceLabel : undefined,
    };
  });
  withTime.sort((a, b) => a.lastActiveMs - b.lastActiveMs); // oldest first
  const toRemove = withTime.slice(0, withTime.length - maxDevices);
  if (toRemove.length === 0) return;
  // N baar trim + sequential delete ki jagah ek batch pipeline
  await kickOutDevicesBatch(
    companyId,
    toRemove.map((dev) => ({ id: dev.id, userId: dev.userId, deviceType: dev.deviceType, deviceLabel: dev.deviceLabel }))
  );
}

/**
 * Remove this device from the company (session kill). Only frees the slot — user is NOT logged out.
 * So: new device can get a slot; this device will need to pass device check again when opening the company.
 */
export async function removeThisDevice(companyId: string): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  if (!deviceId) return;
  const devRef = doc(firestore, "companies", companyId, "devices", deviceId);
  await deleteDoc(devRef);
  // Do NOT write device_commands and do NOT signOut — user stays logged in on this device
}

export { getOrCreateDeviceId };
