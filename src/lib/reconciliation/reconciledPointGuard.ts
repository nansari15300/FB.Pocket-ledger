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
  allVouchers?: readonly any[] | null;
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

/** Check if voucherDate is strictly before an established Reconciled Point in any of the involved accounts. */
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

  if (candidates.length === 0) return { hasConflict: false };

  let allChecks: any[] = [];
  try {
    allChecks = (await listCompanyDocsFromBrowserDb(companyId, "ledger_statement_checks")) || [];
  } catch {
    return { hasConflict: false };
  }

  if (!Array.isArray(allChecks) || allChecks.length === 0) {
    return { hasConflict: false };
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
      (c) => String(c?.contextId || "").trim() === cand.id
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

    // If voucher date is strictly before the reconciled date
    if (targetVDateStart < reconStart) {
      let entityName = "Account";
      try {
        if (cand.context === "party") {
          const party = await getCompanyDocFromBrowserDb(companyId, "parties", cand.id);
          entityName = String(party?.name || party?.partyName || "Party");
        } else if (cand.context === "account") {
          const acc =
            (await getCompanyDocFromBrowserDb(companyId, "bank_accounts", cand.id)) ||
            (await getCompanyDocFromBrowserDb(companyId, "accounts", cand.id));
          entityName = String(acc?.accountName || acc?.name || "Bank / Cash Account");
        } else if (cand.context === "staff") {
          const st = await getCompanyDocFromBrowserDb(companyId, "staff", cand.id);
          entityName = String(st?.name || "Staff Member");
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
  voucherDate: string = ""
): ReconciledWarningDialogCopy {
  return {
    title: pickIntroCopy(introLang, {
      en: "Warning: Reconciled Point Alert",
      ne: "चेतावनी: मेलमिलाप बिन्दु अलर्ट",
      hi: "चेतावनी: मेलमिलाप बिंदु अलर्ट",
    }),
    lead: pickIntroCopy(introLang, {
      en: `The ledger for "${accountName}" has an established Reconciled Point on ${reconciledDate}.`,
      ne: `"${accountName}" को खातामा ${reconciledDate} सम्मको हिसाब-किताब मेलमिलाप (Reconciled) भइसकेको छ।`,
      hi: `"${accountName}" के खाते में ${reconciledDate} तक के लेन-देन का मेलमिलाप (Reconciliation) पूर्ण हो चुका है।`,
    }),
    body: pickIntroCopy(introLang, {
      en: `Recording or updating a transaction with a date (${voucherDate}) prior to this reconciled date will alter previously verified balances and may disrupt previous reconciliation.`,
      ne: `उक्त मितिभन्दा पहिलेको मिति (${voucherDate}) मा नयाँ भौचर थप्दा वा परिवर्तन गर्दा प्रमाणित अघिल्लो हिसाब-किताब बिग्रन सक्छ र पुनः मेलमिलाप गर्नुपर्ने हुन सक्छ।`,
      hi: `इस मेलमिलाप तिथि से पूर्व की तारीख (${voucherDate}) पर वाउचर जोड़ने या बदलने से पूर्व-सत्यापित शेष राशि प्रभावित हो सकती है और पिछला हिसाब-किताब बदल सकता है।`,
    }),
    permissionDenied: pickIntroCopy(introLang, {
      en: "You do not have permission to record transactions prior to an established Reconciled Point. Please contact your company administrator.",
      ne: "मेलमिलाप भइसकेको मितिभन्दा पहिले कारोबार प्रविष्ट गर्ने अनुमति तपाईंलाई छैन। कृपया व्यवस्थापकसँग सम्पर्क गर्नुहोस्।",
      hi: "रिकॉन्सिल्ड तिथि से पूर्व लेनदेन दर्ज करने की अनुमति आपके पास नहीं है। कृपया व्यवस्थापक से संपर्क करें।",
    }),
    dontSave: pickIntroCopy(introLang, {
      en: "Don't Save",
      ne: "बचत नगर्नुहोस्",
      hi: "सहेजें नहीं (रद्द करें)",
    }),
    saveAnyway: pickIntroCopy(introLang, {
      en: "Save Anyway",
      ne: "तैपनि बचत गर्नुहोस्",
      hi: "फिर भी सहेजें",
    }),
  };
}
