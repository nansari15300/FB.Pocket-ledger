/**
 * Ek company ke inter-company masters — Firestore (cloud) ya SQLite (pure local).
 * My-company / APK: cloud path empty ho to SQLite mirror fallback.
 */
import { collection, doc, query, where } from "@/lib/pbCompat/firestore";
import { getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import type { InterCompanyEntityDetail } from "@/lib/interCompany/interCompanyEntityTypes";
import { isPureLocalInterCompanyCompany } from "@/lib/interCompany/localInterCompanyPolicy";
import {
  fetchInterCompanyEntitiesFromLocalMirror,
  fetchInterCompanyBankEntityDetailFromLocalMirror,
} from "@/lib/interCompany/fetchInterCompanyEntitiesLocal";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";

async function fetchInterCompanyEntitiesFromFirestore(
  companyId: string
): Promise<InterCompanyEntityDetail[]> {
  const cid = companyId;
  const [banks, parties, staff, taxes, expenses] = await Promise.all([
    getDocs(
      query(collection(firestore, `companies/${cid}/bank_accounts`), where("isDeleted", "==", false))
    ),
    getDocs(query(collection(firestore, `companies/${cid}/parties`), where("isDeleted", "==", false))),
    getDocs(query(collection(firestore, `companies/${cid}/staff`), where("isDeleted", "==", false))),
    getDocs(query(collection(firestore, `companies/${cid}/taxes`), where("isDeleted", "==", false))),
    getDocs(
      query(collection(firestore, `companies/${cid}/expense_accounts`), where("isDeleted", "==", false))
    ),
  ]);

  const rows: InterCompanyEntityDetail[] = [];
  banks.docs.forEach((d) => {
    const data = d.data() as {
      accountName?: string;
      bankName?: string;
      accountNumber?: string;
      phone?: string;
      interCompanyAccountNo?: string;
      isClearing?: boolean;
    };
    rows.push({
      id: d.id,
      kind: "bank",
      label: data.accountName || d.id,
      bankName: data.bankName,
      accountNumber: data.accountNumber,
      phone: data.phone,
      interCompanyAccountNo: data.interCompanyAccountNo,
      isClearing: data.isClearing === true,
    });
  });
  parties.docs.forEach((d) => {
    const data = d.data() as {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
      pan?: string;
      fileUrl?: string | null;
      openingBalance?: number;
      interCompanyAccountNo?: string;
    };
    rows.push({
      id: d.id,
      kind: "party",
      label: data.name || d.id,
      phone: data.phone,
      email: data.email,
      address: data.address,
      pan: data.pan,
      fileUrl: data.fileUrl,
      openingBalance: data.openingBalance,
      interCompanyAccountNo: data.interCompanyAccountNo,
    });
  });
  staff.docs.forEach((d) => {
    const data = d.data() as {
      name?: string;
      phone?: string;
      email?: string;
      pan?: string;
      interCompanyAccountNo?: string;
      fileUrl?: string | null;
    };
    rows.push({
      id: d.id,
      kind: "staff",
      label: data.name || d.id,
      phone: data.phone,
      email: data.email,
      pan: data.pan,
      fileUrl: data.fileUrl,
      interCompanyAccountNo: data.interCompanyAccountNo,
    });
  });
  taxes.docs.forEach((d) => {
    const data = d.data() as { name?: string; interCompanyAccountNo?: string };
    rows.push({
      id: d.id,
      kind: "tax",
      label: data.name || d.id,
      interCompanyAccountNo: data.interCompanyAccountNo,
    });
  });
  expenses.docs.forEach((d) => {
    const data = d.data() as { name?: string; interCompanyAccountNo?: string };
    rows.push({
      id: d.id,
      kind: "expense",
      label: data.name || d.id,
      interCompanyAccountNo: data.interCompanyAccountNo,
    });
  });
  return rows;
}

const FIRESTORE_IC_ENTITIES_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("inter-company-entities-timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** Company id par saare party/bank/staff/tax/expense rows */
export async function fetchInterCompanyEntitiesForCompany(
  companyId: string
): Promise<InterCompanyEntityDetail[]> {
  if (!isInterCompanySystemEnabled()) return [];
  if (!companyId) return [];
  if (await isPureLocalInterCompanyCompany(companyId)) {
    return fetchInterCompanyEntitiesFromLocalMirror(companyId);
  }
  // EXE / offline: SQLite mirror pehle — Firestore hang se "Loading accounts…" mat atkao
  try {
    const local = await fetchInterCompanyEntitiesFromLocalMirror(companyId);
    if (local.length > 0) return local;
  } catch {
    /* cloud try */
  }
  try {
    const cloud = await withTimeout(fetchInterCompanyEntitiesFromFirestore(companyId), FIRESTORE_IC_ENTITIES_MS);
    if (cloud.length > 0) return cloud;
  } catch {
    /* fall through */
  }
  try {
    return await fetchInterCompanyEntitiesFromLocalMirror(companyId);
  } catch {
    return [];
  }
}

/** Edit hydrate: bank id list me na mile to Firestore se naam lao */
export async function fetchInterCompanyBankEntityDetail(
  companyId: string,
  bankAccountId: string
): Promise<InterCompanyEntityDetail | null> {
  const cid = String(companyId || "").trim();
  const bid = String(bankAccountId || "").trim();
  if (!cid || !bid) return null;
  if (await isPureLocalInterCompanyCompany(cid)) {
    return fetchInterCompanyBankEntityDetailFromLocalMirror(cid, bid);
  }
  try {
    const localFirst = await fetchInterCompanyBankEntityDetailFromLocalMirror(cid, bid);
    if (localFirst) return localFirst;
  } catch {
    /* cloud */
  }
  try {
    const snap = await withTimeout(
      getDoc(doc(firestore, `companies/${cid}/bank_accounts`, bid)),
      FIRESTORE_IC_ENTITIES_MS
    );
    if (snap.exists()) {
      const data = snap.data() as {
        accountName?: string;
        bankName?: string;
        accountNumber?: string;
        phone?: string;
        interCompanyAccountNo?: string;
        isClearing?: boolean;
      };
      return {
        id: snap.id,
        kind: "bank",
        label: data.accountName || snap.id,
        bankName: data.bankName,
        accountNumber: data.accountNumber,
        phone: data.phone,
        interCompanyAccountNo: data.interCompanyAccountNo,
        isClearing: data.isClearing === true,
      };
    }
  } catch {
    /* fall through */
  }
  return fetchInterCompanyBankEntityDetailFromLocalMirror(cid, bid);
}
