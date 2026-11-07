import { NextRequest, NextResponse } from "next/server";
import admin from "firebase-admin";
import { startOfDay } from "date-fns";
import { getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";
import type { FyPeriodKind } from "@/lib/fyPagination/types";
import {
  accumulateVouchersForServerClosing,
  createServerClosingAccumulator,
  finalizeServerClosingBalances,
  type ServerLedgerMasterRow,
} from "@/lib/fyPagination/server/computeClosingBalancesAtMs";
import {
  isEncryptedCompanyDoc,
  forEachCompanyVoucherPageAdmin,
} from "@/lib/fyPagination/server/paginateCompanyVouchersAdmin";
import { isCompanyOwner } from "@/lib/server/companyOwner";
import {
  buildFySnapshotBalanceLabels,
  masterDisplayNameFromFirestore,
} from "@/lib/fyPagination/server/buildFySnapshotBalanceLabels";

type Body = {
  companyId?: string;
  periodKind?: FyPeriodKind;
  periodKey?: string;
  /** Opening boundary — all vouchers strictly before this ms are included. */
  beforeMs?: number;
  forceRebuild?: boolean;
};

function canReadCompany(decoded: admin.auth.DecodedIdToken, data: Record<string, unknown>): boolean {
  if (isCompanyOwner(decoded, data as { ownerId?: string; ownerEmail?: string })) return true;
  const emails = Array.isArray(data.sharedWithEmails) ? data.sharedWithEmails : [];
  const e = String(decoded.email || "").toLowerCase().trim();
  if (!e) return false;
  return emails.some((x: unknown) => String(x || "").toLowerCase().trim() === e);
}

function fySnapshotDocId(periodKind: FyPeriodKind, periodKey: string): string {
  return `${periodKind}_${periodKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * POST: Firebase Admin paginates all vouchers → FY/month closing balances → fySnapshots doc.
 * Client FY filter reads this — no prior-period voucher load on device.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isFirebaseAdminConfigured()) {
      return NextResponse.json(
        { ok: false, useClientFallback: true, reason: "admin_not_configured" },
        { status: 503 }
      );
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    getAdminDb();
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
    }

    const body = (await req.json()) as Body;
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    const periodKind = body.periodKind === "month" ? "month" : body.periodKind === "fy" ? "fy" : null;
    const periodKey = typeof body.periodKey === "string" ? body.periodKey.trim() : "";
    const beforeMs = Number(body.beforeMs);
    const forceRebuild = body.forceRebuild === true;

    if (!companyId || !periodKind || !periodKey || !Number.isFinite(beforeMs) || beforeMs <= 0) {
      return NextResponse.json({ error: "companyId, periodKind, periodKey, beforeMs required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection("companies").doc(companyId);
    const companySnap = await ref.get();
    if (!companySnap.exists) {
      return NextResponse.json({ error: "company_not_found" }, { status: 404 });
    }
    const companyData = companySnap.data() || {};
    if (companyData.isDeleted === true) {
      return NextResponse.json({ error: "company_deleted" }, { status: 404 });
    }
    if (!canReadCompany(decoded, companyData as Record<string, unknown>)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const snapRef = ref.collection("fySnapshots").doc(fySnapshotDocId(periodKind, periodKey));

    const normalizedBeforeMs = startOfDay(new Date(beforeMs)).getTime();

    if (!forceRebuild) {
      const existing = await snapRef.get();
      if (existing.exists) {
        const data = existing.data() as {
          balances?: Record<string, number>;
          balanceLabels?: Record<string, string>;
          closingAtMs?: number;
          beforeMs?: number;
          computedOnServer?: boolean;
          stale?: boolean;
          voucherCountScanned?: number;
          preFyVoucherCountScanned?: number;
          schemaVersion?: number;
        };
        const balances = data?.balances ?? {};
        const balanceLabels = data?.balanceLabels ?? {};
        const schemaVersion = Number(data?.schemaVersion) || 1;
        const fySchemaCurrent = periodKind !== "fy" || schemaVersion >= 2;
        const storedBeforeMs = Number(data.beforeMs) || 0;
        const beforeMsMatches =
          !storedBeforeMs || Math.abs(storedBeforeMs - normalizedBeforeMs) <= 1;
        if (
          data?.stale !== true &&
          data?.computedOnServer === true &&
          Object.keys(balances).length > 0 &&
          fySchemaCurrent &&
          beforeMsMatches
        ) {
          return NextResponse.json({
            ok: true,
            useClientFallback: false,
            cached: true,
            periodKind,
            periodKey,
            closingAtMs: Number(data.closingAtMs) || beforeMs - 1,
            balances,
            balanceLabels,
            voucherCountScanned: Number(data.voucherCountScanned) || 0,
            preFyVoucherCountScanned: Number(data.preFyVoucherCountScanned) || 0,
            source: "calculated_pre_fy",
          });
        }
      }
    }

    const masters: ServerLedgerMasterRow[] = [];
    const labelById = new Map<string, string>();

    const [partiesSnap, accountsSnap, staffSnap, taxesSnap, expensesSnap, itemsSnap] = await Promise.all([
      ref.collection("parties").get(),
      ref.collection("bank_accounts").get(),
      ref.collection("staff").get(),
      ref.collection("taxes").get(),
      ref.collection("expense_accounts").get(),
      ref.collection("items").get(),
    ]);

    const pushMaster = (
      kind: ServerLedgerMasterRow["kind"],
      d: admin.firestore.QueryDocumentSnapshot,
      extra?: Partial<ServerLedgerMasterRow>
    ) => {
      const data = d.data() as Record<string, unknown>;
      if (isEncryptedCompanyDoc(data) || data.isDeleted === true) return;
      labelById.set(d.id, masterDisplayNameFromFirestore(kind, data, d.id));
      masters.push({
        id: d.id,
        kind,
        openingBalance: data.openingBalance,
        openingBalanceDate: data.openingBalanceDate,
        ...extra,
      });
    };

    for (const d of partiesSnap.docs) pushMaster("party", d);
    for (const d of accountsSnap.docs) pushMaster("account", d);
    for (const d of staffSnap.docs) pushMaster("staff", d);
    for (const d of taxesSnap.docs) pushMaster("tax", d);
    for (const d of expensesSnap.docs) pushMaster("expense", d);
    for (const d of itemsSnap.docs) {
      const data = d.data() as Record<string, unknown>;
      if (isEncryptedCompanyDoc(data) || data.isDeleted === true) continue;
      labelById.set(d.id, masterDisplayNameFromFirestore("item", data, d.id));
      masters.push({
        id: d.id,
        kind: "item",
        openingBalance: data.openingBalance,
        openingBalanceDate: data.openingBalanceDate,
        purchasePrice: data.purchasePrice,
        unitConversions: data.unitConversions,
      });
    }

    const respectMasterOpeningBalanceDate = periodKind !== "fy";
    const acc = createServerClosingAccumulator(masters, beforeMs, respectMasterOpeningBalanceDate);
    const { encrypted, totalVouchers } = await forEachCompanyVoucherPageAdmin(ref, (page) => {
      accumulateVouchersForServerClosing(acc, page);
    });
    if (encrypted) {
      return NextResponse.json({
        ok: false,
        useClientFallback: true,
        reason: "encrypted_company_data",
      });
    }

    const balances = finalizeServerClosingBalances(acc);
    const balanceLabels = buildFySnapshotBalanceLabels(labelById, balances);
    // Client passes opening boundary as `beforeMs` — closing is end of prior period (server-safe; no BS client imports).
    const closingAtMs = beforeMs - 1;

    const now = Date.now();
    await snapRef.set(
      {
        periodKind,
        periodKey,
        closingAtMs,
        beforeMs: normalizedBeforeMs,
        balances,
        balanceLabels,
        updatedAtMs: now,
        computedOnServer: true,
        stale: false,
        schemaVersion: 2,
        voucherCountScanned: totalVouchers,
        preFyVoucherCountScanned: acc.preFyVoucherCount,
      },
      { merge: true }
    );

    return NextResponse.json({
      ok: true,
      useClientFallback: false,
      cached: false,
      periodKind,
      periodKey,
      closingAtMs,
      balances,
      balanceLabels,
      voucherCountScanned: totalVouchers,
      preFyVoucherCountScanned: acc.preFyVoucherCount,
      source: "calculated_pre_fy",
    });
  } catch (e) {
    console.error("[fy-closing-snapshot]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
