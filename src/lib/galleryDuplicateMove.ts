"use client";

/**
 * "Move to Duplicate" — unassigned/duplicate document pool ke beech ek file shift karna.
 *
 * Duplicate guard jab same slip detect kare, user ek click me wo file unassigned se
 * `duplicate_documents` me bhej sakta hai — original pending files me clutter na rahe, par bytes
 * delete na hon (audit ke liye rakhi jati hain).
 *
 * Design: source doc ka poora data copy + `movedFrom`/`movedAtMs` stamp, phir source row
 * `isDeleted` + `deletedAt` se soft-delete (storage bytes intact — `hardDelete` alag action hai).
 */

import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { upsertCompanyDocInBrowserDb } from "@/lib/localCompanyDocMirror";

export const DUPLICATE_DOCUMENTS_COLLECTION = "duplicate_documents";
export const UNASSIGNED_DOCUMENTS_COLLECTION = "unassigned_documents";

/** Gallery ke `firestoreCompanyIdForGallery` jaisa — module standalone rahe (circular import avoid). */
export function galleryCompanyFsId(companyId: string, company: { authoritativeCompanyId?: string } | null | undefined): string {
  return String(company?.authoritativeCompanyId || companyId).trim() || companyId;
}
const fsCompanyId = galleryCompanyFsId;

export type DuplicateMoveTarget = {
  /** unassigned_documents doc id (ya jahan se move kar rahe ho). */
  fileId: string;
  /** Kaun sa voucher duplicate mila — audit trail. */
  duplicateOfVoucherId?: string;
  duplicateOfVoucherNumber?: string;
  /** Kis reason se duplicate maana (file / ref / fields / narration). */
  reasons?: readonly string[];
  /** OCR ka banaya hua narration — Gallery ke "Why Duplicate" me dikhta hai. */
  ocrNarration?: string;
  /** Purane (match hue) voucher ka narration — side-by-side comparison ke liye. */
  matchedNarration?: string;
  /** Purane voucher ka slip ref / txn id. */
  matchedRef?: string;
  /** Purane voucher ka amount aur date text (display). */
  matchedAmount?: number;
  matchedDateText?: string;
  /** Incoming voucher ka slip ref. */
  incomingRef?: string;
};

export type DuplicateMoveResult =
  | { ok: true; duplicateDocId: string }
  | { ok: false; message: string };

/**
 * Firestore: `companies/{fsId}/unassigned_documents/{fileId}` → `duplicate_documents/{newId}`.
 * Source row soft-delete hoti hai (`isDeleted`), bytes nahi udaate.
 */
export async function moveUnassignedFileToDuplicate(
  companyId: string,
  company: unknown,
  target: DuplicateMoveTarget
): Promise<DuplicateMoveResult> {
  const cid = String(companyId || "").trim();
  const fileId = String(target.fileId || "").trim();
  if (!cid || !fileId) return { ok: false, message: "Missing company or file id." };

  try {
    const fsId = fsCompanyId(cid, company as never);
    const sourceRef = doc(firestore, `companies/${fsId}/${UNASSIGNED_DOCUMENTS_COLLECTION}`, fileId);
    const snap = await getDoc(sourceRef);
    if (!snap.exists()) return { ok: false, message: "Original file row not found — refresh the gallery." };
    const data = snap.data() as Record<string, unknown>;
    if (data?.isDeleted === true) return { ok: false, message: "This file was already moved or deleted." };

    const nowMs = Date.now();
    const duplicateRow = {
      ...data,
      /** Naya id auto; purana id trail me. */
      movedFromUnassignedId: fileId,
      movedFromCollection: UNASSIGNED_DOCUMENTS_COLLECTION,
      movedAtMs: nowMs,
      movedAt: serverTimestamp(),
      duplicateOfVoucherId: String(target.duplicateOfVoucherId || ""),
      duplicateOfVoucherNumber: String(target.duplicateOfVoucherNumber || ""),
      duplicateReasons: Array.isArray(target.reasons) ? [...target.reasons] : [],
      /** "Why Duplicate" panel ke liye — OCR narration + original voucher ka comparison snapshot. */
      duplicateOcrNarration: String(target.ocrNarration || ""),
      duplicateMatchedNarration: String(target.matchedNarration || ""),
      duplicateMatchedRef: String(target.matchedRef || ""),
      duplicateMatchedAmount: Number(target.matchedAmount || 0) || 0,
      duplicateMatchedDateText: String(target.matchedDateText || ""),
      duplicateIncomingRef: String(target.incomingRef || ""),
      /** Duplicate tab me row "new" dikhe — upload time original hi rakhte hain (sorting same). */
      status: "FREE",
      isDeleted: false,
      deleted: false,
      updatedAt: serverTimestamp(),
      lastEditedAt: nowMs,
    };

    const dupCol = collection(firestore, `companies/${fsId}/${DUPLICATE_DOCUMENTS_COLLECTION}`);
    const created = await addDoc(dupCol, duplicateRow);

    /* Source ko soft-delete: unassigned list se hatao, bytes/drive file safe rahe. */
    await setDoc(
      sourceRef,
      {
        isDeleted: true,
        deletedAtMs: nowMs,
        deletedAt: serverTimestamp(),
        movedToDuplicateId: created.id,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    /* Offline mirror: dono rows local DB me — device offline bhi duplicate tab turant dikhe. */
    void upsertCompanyDocInBrowserDb(fsId, DUPLICATE_DOCUMENTS_COLLECTION, created.id, {
      ...duplicateRow,
      createdAtMs: nowMs,
    } as never).catch(() => {});
    void upsertCompanyDocInBrowserDb(fsId, UNASSIGNED_DOCUMENTS_COLLECTION, fileId, {
      ...data,
      isDeleted: true,
      deletedAtMs: nowMs,
      movedToDuplicateId: created.id,
    } as never).catch(() => {});

    return { ok: true, duplicateDocId: created.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Duplicate tab se wapas unassigned pool me (reverse action, agar user galti se move kar de). */
export async function moveDuplicateFileBackToUnassigned(
  companyId: string,
  company: unknown,
  duplicateDocId: string
): Promise<DuplicateMoveResult> {
  const cid = String(companyId || "").trim();
  const id = String(duplicateDocId || "").trim();
  if (!cid || !id) return { ok: false, message: "Missing company or file id." };
  try {
    const fsId = fsCompanyId(cid, company as never);
    const dupRef = doc(firestore, `companies/${fsId}/${DUPLICATE_DOCUMENTS_COLLECTION}`, id);
    const snap = await getDoc(dupRef);
    if (!snap.exists()) return { ok: false, message: "Duplicate row not found — refresh the gallery." };
    const data = snap.data() as Record<string, unknown>;

    const backRef = doc(collection(firestore, `companies/${fsId}/${UNASSIGNED_DOCUMENTS_COLLECTION}`));
    await setDoc(backRef, {
      ...data,
      isDeleted: false,
      deleted: false,
      status: "FREE",
      restoredFromDuplicateAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    });
    await deleteDoc(dupRef);
    return { ok: true, duplicateDocId: backRef.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
