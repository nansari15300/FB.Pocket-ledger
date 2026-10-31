"use client";

import { Timestamp } from "@/lib/pbCompat/firestore";

/** Firestore/plain timestamp → usable Date (cross-company clone forms). */
export function toJsDateMaybe(v: unknown): Date | undefined {
  if (v == null || v === undefined) return undefined;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof (v as Timestamp).toDate === "function") {
    try {
      return (v as Timestamp).toDate();
    } catch {
      return undefined;
    }
  }
  if (typeof v === "object" && v !== null && typeof (v as { seconds?: unknown }).seconds === "number") {
    try {
      return new Timestamp(
        Number((v as { seconds: number }).seconds),
        Number((v as { nanoseconds?: number }).nanoseconds ?? 0)
      ).toDate();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Server/SQLite row ko target company duplicate se pehle id/timestamps hata kar clone-friendly payload बनाओ. */
export function stripIdsForCrossCompanyClone(row: Record<string, unknown>): Record<string, unknown> {
  const o = { ...row };
  delete o.id;
  delete o.companyId;
  delete o.ownerId;
  delete o.createdAt;
  delete o.updatedAt;
  delete o.deletedAt;
  delete o.movedToAdminRecycleAt;
  return o;
}

/** Remote HTTPS/GCS avatar ya doc URL → File taaki Create Party/Bank wala save flow unchanged rahe (local File staging). */
export async function fetchRemoteUrlAsFile(url: string, fallbackFileName: string): Promise<File | null> {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null;
  try {
    const res = await fetch(trimmed);
    if (!res.ok) return null;
    const blob = await res.blob();
    const safeName = fallbackFileName.replace(/[^\w.\-()+ ]/g, "_") || "attachment";
    return new File([blob], safeName, { type: blob.type || "application/octet-stream" });
  } catch {
    return null;
  }
}

/** Party row (Firestore stripped) → CreatePartyForm default values + remote attachment URLs — target company me dubara staging ke liye. */
export function partyPrefillPartsFromPartyRow(row: Record<string, unknown>): {
  defaults: {
    name: string;
    address: string;
    phone: string;
    email: string;
    pan: string;
    openingBalance: number;
    openingBalanceDate?: Date;
    openingBalanceNarration: string;
  };
  remoteAvatarUrl?: string;
  remoteDocumentUrls: string[];
} {
  const docUrls = Array.isArray(row.documentFileUrls)
    ? (row.documentFileUrls as unknown[]).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
    : [];
  return {
    defaults: {
      name: String(row.name ?? "").trim(),
      address: String(row.address ?? ""),
      phone: String(row.phone ?? ""),
      email: String(row.email ?? ""),
      pan: String(row.pan ?? ""),
      openingBalance: Number(row.openingBalance ?? 0) || 0,
      openingBalanceDate: toJsDateMaybe(row.openingBalanceDate),
      openingBalanceNarration: String(row.openingBalanceNarration ?? ""),
    },
    remoteAvatarUrl:
      typeof row.fileUrl === "string" && /^https?:\/\//.test(row.fileUrl) ? row.fileUrl : undefined,
    remoteDocumentUrls: docUrls,
  };
}

/** bank_accounts row stripped → CreateBankAccountDialog defaults + URLs (group dialog layer ungrouped set karta hai). */
export function bankPrefillPartsFromRow(row: Record<string, unknown>): {
  defaults: {
    accountName: string;
    aliasName: string;
    accountType: "Bank" | "Cash";
    openingBalance: number;
    openingBalanceDate?: Date;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    openingBalanceNarration: string;
    isSpecial: boolean;
    useFor?: { in: string[]; out: string[] };
  };
  remoteAvatarUrl?: string;
  remoteDocumentUrls: string[];
} {
  const rawType = String(row.accountType ?? "Bank");
  const accountType = rawType === "Cash" ? "Cash" : "Bank";
  const docUrls = Array.isArray(row.documentFileUrls)
    ? (row.documentFileUrls as unknown[]).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
    : [];
  const useForRaw = row.useFor as { in?: unknown[]; out?: unknown[] } | undefined;
  const useFor =
    useForRaw && typeof useForRaw === "object"
      ? {
          in: (Array.isArray(useForRaw.in) ? useForRaw.in : []).map((x) => String(x)),
          out: (Array.isArray(useForRaw.out) ? useForRaw.out : []).map((x) => String(x)),
        }
      : undefined;
  return {
    defaults: {
      accountName: String(row.accountName ?? "").trim(),
      aliasName: String(row.aliasName ?? "").trim(),
      accountType,
      openingBalance: Number(row.openingBalance ?? 0) || 0,
      openingBalanceDate: toJsDateMaybe(row.openingBalanceDate),
      bankName: String(row.bankName ?? ""),
      accountNumber: String(row.accountNumber ?? ""),
      ifscCode: String(row.ifscCode ?? row.swiftCode ?? ""),
      openingBalanceNarration: String(row.openingBalanceNarration ?? ""),
      isSpecial: row.isSpecial === true,
      useFor,
    },
    remoteAvatarUrl:
      typeof row.fileUrl === "string" && /^https?:\/\//.test(row.fileUrl) ? row.fileUrl : undefined,
    remoteDocumentUrls: docUrls,
  };
}

/** `staff` collection row stripped — CreateStaffForm scalar fields + avatar/doc URLs (group target par Ungrouped). */
export function staffPrefillPartsFromStaffRow(row: Record<string, unknown>): {
  defaults: {
    name: string;
    email: string;
    phone: string;
    address: string;
    salary: number;
    openingBalance: number;
    openingBalanceDate?: Date;
    salaryPeriod: "Daily" | "Weekly" | "Monthly" | "Yearly";
    openingBalanceNarration: string;
  };
  remoteAvatarUrl?: string;
  remoteDocumentUrls: string[];
} {
  const docUrls = Array.isArray(row.documentFileUrls)
    ? (row.documentFileUrls as unknown[]).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
    : [];
  const sp = row.salaryPeriod;
  const salaryPeriod: "Daily" | "Weekly" | "Monthly" | "Yearly" =
    sp === "Daily" || sp === "Weekly" || sp === "Monthly" || sp === "Yearly" ? sp : "Monthly";
  return {
    defaults: {
      name: String(row.name ?? "").trim(),
      email: String(row.email ?? ""),
      phone: String(row.phone ?? ""),
      address: String(row.address ?? ""),
      salary: Number(row.salary ?? 0) || 0,
      openingBalance: Number(row.openingBalance ?? 0) || 0,
      openingBalanceDate: toJsDateMaybe(row.openingBalanceDate),
      salaryPeriod,
      openingBalanceNarration: String(row.openingBalanceNarration ?? ""),
    },
    remoteAvatarUrl:
      typeof row.fileUrl === "string" && /^https?:\/\//.test(row.fileUrl) ? row.fileUrl : undefined,
    remoteDocumentUrls: docUrls,
  };
}

/** expense_accounts row stripped — CreateExpenseAccountDialog के लिए scalar fields + URLs. */
export function expenseAccountPrefillPartsFromRow(row: Record<string, unknown>): {
  defaults: {
    name: string;
    openingBalance: number;
    openingBalanceDate?: Date;
    openingBalanceNarration: string;
  };
  remoteAvatarUrl?: string;
  remoteDocumentUrls: string[];
} {
  const docUrls = Array.isArray(row.documentFileUrls)
    ? (row.documentFileUrls as unknown[]).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
    : [];
  return {
    defaults: {
      name: String(row.name ?? "").trim(),
      openingBalance: Number(row.openingBalance ?? 0) || 0,
      openingBalanceDate: toJsDateMaybe(row.openingBalanceDate),
      openingBalanceNarration: String(row.openingBalanceNarration ?? ""),
    },
    remoteAvatarUrl:
      typeof row.fileUrl === "string" && /^https?:\/\//.test(row.fileUrl) ? row.fileUrl : undefined,
    remoteDocumentUrls: docUrls,
  };
}

/**
 * `items` collection row (IDs stripped) → CreateItemDialog `form.reset` merge patch.
 * Source tax / group IDs target company par invalid — khali chhodkar user naya map kare.
 */
export function itemStrippedRowToCreateItemFormPatch(
  row: Record<string, unknown>,
  fallbackType: "item" | "service" | "finished_good"
): Record<string, unknown> {
  const t =
    row.type === "service" || row.type === "finished_good" || row.type === "item"
      ? row.type
      : fallbackType;
  const rawUnits = row.unitConversions;
  const unitConversions =
    Array.isArray(rawUnits) && rawUnits.length > 0
      ? (rawUnits as Record<string, unknown>[]).map((u) => ({
          fromUnit: String(u?.fromUnit ?? ""),
          toUnit: String(u?.toUnit ?? ""),
          conversionFactor: Number(u?.conversionFactor ?? 1) || 1,
        }))
      : [{ fromUnit: "", toUnit: "", conversionFactor: 1 }];
  return {
    name: String(row.name ?? "").trim(),
    type: t,
    hsCode: String(row.hsCode ?? ""),
    salePrice: Number(row.salePrice ?? 0) || 0,
    isSalePriceTaxInclusive: row.isSalePriceTaxInclusive === true,
    purchasePrice: Number(row.purchasePrice ?? 0) || 0,
    isPurchasePriceTaxInclusive: row.isPurchasePriceTaxInclusive === true,
    openingBalance: Number(row.openingBalance ?? 0) || 0,
    openingBalanceUnit: String(row.openingBalanceUnit ?? ""),
    openingBalanceTaxId: "",
    openingBalanceDate: toJsDateMaybe(row.openingBalanceDate),
    openingBalanceRate: Number(row.openingBalanceRate ?? 0) || 0,
    isOpeningBalanceTaxInclusive: row.isOpeningBalanceTaxInclusive === true,
    groupId: "",
    unitConversions,
    salePriceUnit: String(row.salePriceUnit ?? ""),
    purchasePriceUnit: String(row.purchasePriceUnit ?? ""),
    saleTaxId: "",
    purchaseTaxId: "",
    openingBalanceNarration: String(row.openingBalanceNarration ?? ""),
  };
}

/** `taxes` stripped row → CreateTaxForm `form.reset` merge patch (groupId baad me ungrouped se set hota hai). */
export function taxStrippedRowToCreateTaxFormPatch(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: String(row.name ?? "").trim(),
    rate: Number(row.rate ?? 0) || 0,
    openingBalance: Number(row.openingBalance ?? 0) || 0,
    openingBalanceDate: toJsDateMaybe(row.openingBalanceDate),
    groupId: "",
    openingBalanceNarration: String(row.openingBalanceNarration ?? ""),
  };
}

/** taxes row → scalar patch + profile/doc HTTPS URLs (copy chip full parity — party/staff jaisa). */
export function taxPrefillPartsFromTaxRow(row: Record<string, unknown>): {
  patch: Record<string, unknown>;
  remoteAvatarUrl?: string;
  remoteDocumentUrls: string[];
} {
  const docUrls = Array.isArray(row.documentFileUrls)
    ? (row.documentFileUrls as unknown[]).filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
    : [];
  return {
    patch: taxStrippedRowToCreateTaxFormPatch(row),
    remoteAvatarUrl:
      typeof row.fileUrl === "string" && /^https?:\/\//.test(row.fileUrl) ? row.fileUrl : undefined,
    remoteDocumentUrls: docUrls,
  };
}
