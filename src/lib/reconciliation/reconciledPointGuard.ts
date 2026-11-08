import {
  getCompanyDocFromBrowserDb,
  listCompanyDocsFromBrowserDb,
} from "@/lib/localCompanyDocMirror";
import { parseFirestoreDateFieldToJsDate } from "@/lib/voucherDateNormalize";
import { startOfDay } from "date-fns";
import { pickIntroCopy } from "@/lib/i18n/introCopy";

export type ReconciledPointConflict = {
  hasConflict: boolean;
  accountName?: string;
  reconciledDateFormatted?: string;
  voucherDateFormatted?: string;
  reconciledDate?: Date;
  voucherDate?: Date;
};

export type ReconciledPointCheckParams = {
  companyId: string;
  voucherDate: unknown;
  partyId?: string | null;
  accountId?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  creditAccountId?: string | null;
  debitAccountId?: string | null;
  staffId?: string | null;
  entityIds?: Array<string | null | undefined>;
  allVouchers?: readonly any[] | null;
  // Smart conditions:
  isEdit?: boolean;
  existingVoucher?: any;
  newVoucherData?: any;
  isDelete?: boolean;
};

function formatDateNice(date: Date): string {
  try {
    if (typeof window !== "undefined" && (window as any).plDate?.format) {
      return (window as any).plDate.format(date);
    }
    return date.toISOString().split("T")[0]!;
  } catch {
    return date.toISOString().split("T")[0]!;
  }
}

/** Calculate the net signed balance impact of a voucher on a specific entity / account */
export function getEntityNetEffect(v: any, entityId: string): number {
  if (!v || !entityId) return 0;
  const cleanId = String(entityId).trim();
  const vType = String(v.type || "").toLowerCase();

  // 1. Journal / Adjustment:
  const lines = Array.isArray(v.lines) ? v.lines : (Array.isArray(v.entries) ? v.entries : null);
  if (lines) {
    let net = 0;
    for (const line of lines) {
      const lineAcc = String(line.accountId || line.partyId || line.entityId || "").trim();
      if (lineAcc === cleanId) {
        const amt = Number(line.amount ?? (line.debit || line.credit || 0)) || 0;
        const lineType = String(line.type || (Number(line.debit) > 0 ? "debit" : "credit")).toLowerCase();
        net += (lineType === "debit" ? amt : -amt);
      }
    }
    return net;
  }

  // 2. Payment In:
  if (vType === "payment_in" || vType === "direct_income") {
    const amt = Number(v.amount ?? v.total ?? 0) || 0;
    if (String(v.partyId || "").trim() === cleanId) return -amt; // credit to party
    if (String(v.accountId || "").trim() === cleanId) return amt; // debit to cash/bank
    return 0;
  }

  // 3. Payment Out:
  if (vType === "payment_out" || vType === "direct_expense") {
    const amt = Number(v.amount ?? v.total ?? 0) || 0;
    if (String(v.partyId || "").trim() === cleanId) return amt; // debit to party
    if (String(v.accountId || v.fromAccountId || "").trim() === cleanId) return -amt; // credit to cash/bank
    return 0;
  }

  // 4. Sale:
  if (vType === "sale") {
    const amt = Number(v.total ?? v.amount ?? 0) || 0;
    if (String(v.partyId || "").trim() === cleanId) return amt; // debit to party
    return 0;
  }

  // 5. Purchase:
  if (vType === "purchase") {
    const amt = Number(v.total ?? v.amount ?? 0) || 0;
    if (String(v.partyId || "").trim() === cleanId) return -amt; // credit to party
    return 0;
  }

  // 6. Contra:
  if (vType === "contra") {
    const amt = Number(v.amount ?? v.total ?? 0) || 0;
    if (String(v.fromAccountId || "").trim() === cleanId) return -amt;
    if (String(v.toAccountId || "").trim() === cleanId) return amt;
    return 0;
  }

  // 7. Salary:
  if (vType === "salary") {
    const lines = Array.isArray(v.lineItems) ? v.lineItems : null;
    let net = 0;
    if (lines) {
      for (const item of lines) {
        if (String(item.staffId || "").trim() === cleanId) {
          const sal = Number(item.afterTaxSalary ?? item.salary ?? 0) || 0;
          net -= sal;
        }
      }
    }
    const paidFrom = String(v.paidFromAccountId || v.debitAccountId || "").trim();
    if (paidFrom === cleanId) {
      const tot = Number(v.totalSalary ?? v.amount ?? 0) || 0;
      net -= tot;
    }
    return net;
  }

  // Fallback: check if partyId or accountId matches
  const amt = Number(v.total ?? v.amount ?? 0) || 0;
  if (String(v.partyId || "").trim() === cleanId || String(v.accountId || "").trim() === cleanId) {
    return amt;
  }

  return 0;
}

/** Check if voucher action affects ledger balance strictly on or before an established Reconciled Point */
export async function checkReconciledPointConflict(
  params: ReconciledPointCheckParams
): Promise<ReconciledPointConflict> {
  const { companyId } = params;
  if (!companyId) return { hasConflict: false };

  const vDate = parseFirestoreDateFieldToJsDate(params.voucherDate);
  if (!vDate) return { hasConflict: false };

  const targetVDateStart = startOfDay(vDate).getTime();

  // Gather unique involved entities (party, account, staff)
  const candidates: Array<{ context: string; id: string }> = [];
  const seenIds = new Set<string>();

  const add = (context: string, id?: string | null) => {
    const cleanId = String(id || "").trim();
    if (!cleanId || seenIds.has(cleanId)) return;
    seenIds.add(cleanId);
    candidates.push({ context, id: cleanId });
  };

  add("party", params.partyId);
  add("account", params.accountId);
  add("account", params.fromAccountId);
  add("account", params.toAccountId);
  add("account", params.creditAccountId);
  add("account", params.debitAccountId);
  add("staff", params.staffId);
  if (Array.isArray(params.entityIds)) {
    for (const eid of params.entityIds) add("any", eid);
  }

  // Also include entities from existingVoucher if in edit/delete mode
  if (params.existingVoucher) {
    const ev = params.existingVoucher;
    add("party", ev.partyId);
    add("account", ev.accountId);
    add("account", ev.fromAccountId);
    add("account", ev.toAccountId);
    add("staff", ev.staffId);
    const evLines = Array.isArray(ev.lines) ? ev.lines : (Array.isArray(ev.entries) ? ev.entries : null);
    if (evLines) {
      for (const line of evLines) {
        add("any", line.accountId || line.partyId || line.entityId);
      }
    }
  }

  if (candidates.length === 0) return { hasConflict: false };

  let allChecks: any[] = [];
  try {
    allChecks = (await listCompanyDocsFromBrowserDb(companyId, "ledger_statement_checks", { forBackupMerge: true })) || [];
  } catch {
    allChecks = [];
  }

  // Pre-index memory vouchers if provided
  const voucherMap = new Map<string, any>();
  if (Array.isArray(params.allVouchers)) {
    for (const v of params.allVouchers) {
      if (v?.id) voucherMap.set(String(v.id), v);
    }
  }

  for (const cand of candidates) {
    // Find checks for this entity
    const matchingDocs = allChecks.filter(
      (c) => String(c?.contextId || "").trim() === cand.id || String(c?.id || "").includes(`__${cand.id}`)
    );

    if (matchingDocs.length === 0) continue;

    // Collect all marked transaction IDs for this entity
    const markedIds = new Set<string>();
    for (const doc of matchingDocs) {
      if (Array.isArray(doc?.markedIds)) {
        for (const mid of doc.markedIds) {
          if (typeof mid === "string" && mid.trim()) markedIds.add(mid.trim());
        }
      }
    }

    if (markedIds.size === 0) continue;

    // Find latest date among marked transactions
    let latestReconDate: Date | null = null;
    let latestReconTime = -Infinity;

    for (const txnId of markedIds) {
      let v = voucherMap.get(txnId);
      if (!v) {
        try {
          v = await getCompanyDocFromBrowserDb(companyId, "vouchers", txnId);
          if (v) voucherMap.set(txnId, v);
        } catch {
          /* ignore */
        }
      }
      if (!v) continue;
      const d = parseFirestoreDateFieldToJsDate(v.date);
      if (d && d.getTime() > latestReconTime) {
        latestReconTime = d.getTime();
        latestReconDate = d;
      }
    }

    if (!latestReconDate) continue;

    const reconStart = startOfDay(latestReconDate).getTime();

    // Prepare new voucher object for net calculation
    const newVoucher = params.newVoucherData || {
      partyId: params.partyId,
      accountId: params.accountId,
      fromAccountId: params.fromAccountId,
      toAccountId: params.toAccountId,
      staffId: params.staffId,
      date: vDate,
      lines: Array.isArray(params.entityIds) ? params.entityIds.map(id => ({ accountId: id })) : undefined,
    };

    // Evaluate Smart Conditions for this entity
    let hasEntityConflict = false;

    if (params.isDelete) {
      // 1. DELETE ACTION:
      const evDate = params.existingVoucher ? parseFirestoreDateFieldToJsDate(params.existingVoucher.date) : vDate;
      const evTime = evDate ? startOfDay(evDate).getTime() : targetVDateStart;
      const isPast = evTime <= reconStart;
      const origNet = params.existingVoucher ? getEntityNetEffect(params.existingVoucher, cand.id) : 1;
      if (isPast && Math.abs(origNet) > 0.001) {
        hasEntityConflict = true;
      }
    } else if (params.isEdit && params.existingVoucher) {
      // 2. EDIT ACTION:
      const evDate = parseFirestoreDateFieldToJsDate(params.existingVoucher.date);
      const evTime = evDate ? startOfDay(evDate).getTime() : 0;
      const origInRecon = evDate ? evTime <= reconStart : false;
      const newInRecon = targetVDateStart <= reconStart;

      const origNet = getEntityNetEffect(params.existingVoucher, cand.id);
      const newNet = getEntityNetEffect(newVoucher, cand.id);

      if (origInRecon !== newInRecon) {
        // Date moved across the Reconciled Point boundary!
        hasEntityConflict = true;
      } else if (!origInRecon && !newInRecon) {
        // Both were after Reconciled Point, so Reconciled Point balance is unaffected
        hasEntityConflict = false;
      } else {
        // Both are on/before Reconciled Point:
        // Only trigger warning if financial balance impact on this account changed!
        if (Math.abs(origNet - newNet) >= 0.001) {
          hasEntityConflict = true;
        } else {
          // Amount / balance impact is identical (e.g. only narration changed, or date shifted within past)
          hasEntityConflict = false;
        }
      }
    } else {
      // 3. CREATE NEW ACTION:
      const newInRecon = targetVDateStart <= reconStart;
      const newNet = getEntityNetEffect(newVoucher, cand.id);
      if (newInRecon && Math.abs(newNet) > 0.001) {
        hasEntityConflict = true;
      }
    }

    if (hasEntityConflict) {
      let entityName = "Account";
      try {
        const party = await getCompanyDocFromBrowserDb(companyId, "parties", cand.id);
        if (party?.name || party?.partyName) {
          entityName = String(party.name || party.partyName);
        } else {
          const acc =
            (await getCompanyDocFromBrowserDb(companyId, "bank_accounts", cand.id)) ||
            (await getCompanyDocFromBrowserDb(companyId, "accounts", cand.id));
          if (acc?.accountName || acc?.name) {
            entityName = String(acc.accountName || acc.name);
          } else {
            const st = await getCompanyDocFromBrowserDb(companyId, "staff", cand.id);
            if (st?.name) entityName = String(st.name);
          }
        }
      } catch {
        /* fallback */
      }

      return {
        hasConflict: true,
        accountName: entityName,
        reconciledDateFormatted: formatDateNice(latestReconDate),
        voucherDateFormatted: formatDateNice(vDate),
        reconciledDate: latestReconDate,
        voucherDate: vDate,
      };
    }
  }

  return { hasConflict: false };
}

export type ReconciledWarningDialogCopy = {
  title: string;
  lead: string;
  body: string;
  permissionDenied: string;
  dontSave: string;
  saveAnyway: string;
};

export function getReconciledWarningDialogCopy(
  introLang: string = "en",
  accountName: string = "Account",
  reconciledDate: string = "",
  voucherDate: string = "",
  uiLang: string = "en"
): ReconciledWarningDialogCopy {
  const isNe = introLang === "ne";
  const isHi = introLang === "hi";

  const isUiNe = uiLang === "ne";
  const isUiHi = uiLang === "hi";

  // Buttons strictly bound to UI language:
  const dontSave = isUiNe
    ? "पछाडि / रद्द गर्नुहोस्"
    : isUiHi
    ? "वापस / रद्द करें"
    : "Back / Cancel";

  const saveAnyway = isUiNe
    ? "जारी राख्नुहोस्"
    : isUiHi
    ? "जारी रखें"
    : "Continue";

  if (isNe) {
    return {
      title: "मेलमिलाप बिन्दु चेतावनी",
      lead: `यस लेजर खाता (${accountName}) मा ${reconciledDate} मा Reconciled Point (मेलमिलाप बिन्दु) चिन्हित छ।`,
      body: `यदि तपाईंले Reconciled Point भन्दा अघिल्लो मिति (${voucherDate}) मा भौचर थप्नुभयो भने, तपाईंको मेलमिलाप बेमेल (Mismatch) हुनेछ।`,
      dontSave,
      saveAnyway,
      permissionDenied: "तपाईंसँग मेलमिलाप बिन्दु अघिको प्रविष्टि थप्ने वा परिवर्तन गर्ने अनुमति छैन।",
    };
  }

  if (isHi) {
    return {
      title: "मेलमिलाप बिंदु चेतावनी",
      lead: `इस लेज़र (${accountName}) में ${reconciledDate} को Reconciled Point (मेलमिलाप बिंदु) निर्धारित है।`,
      body: `यदि आप Reconciled Point की तारीख से पहले (${voucherDate}) कोई वाउचर जोड़ते हैं, तो आपका मेलमिलाप बेमेल (Mismatch) हो जाएगा।`,
      dontSave,
      saveAnyway,
      permissionDenied: "आपके पास मेलमिलाप बिंदु से पहले की प्रविष्टि जोड़ने की अनुमति नहीं है।",
    };
  }

  return {
    title: "Reconciled Point Conflict",
    lead: `This ledger (${accountName}) has a Reconciled Point on ${reconciledDate}.`,
    body: `If you add a voucher on ${voucherDate} behind the reconciled date, your reconciliation will be mismatched.`,
    dontSave,
    saveAnyway,
    permissionDenied: "You do not have permission to post vouchers prior to an established Reconciled Point.",
  };
}
