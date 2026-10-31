"use client";

import { addDoc } from "@/lib/writeGateway/pbWrites";
import { collection, serverTimestamp } from "@/lib/pbCompat/firestore";
import { RECON_SHARE_HEADER_LABEL } from "@/lib/reconciliation/labels";
import {
  reconciliationPagePath,
  reconciliationUserLabel,
  sendReconciliationChatMessage,
} from "@/lib/reconciliation/reconciliationChat";
import { firestore } from "@/lib/firebase";

type ReconAlertBase = {
  shareId: string;
  recipientUserId: string;
  companyId: string;
  message: string;
  kind: string;
};

/** Messages → Alerts row — reconciliation events ke liye common shape. */
async function addReconciliationAlert(params: ReconAlertBase): Promise<void> {
  await addDoc(collection(firestore, "admin_notifications"), {
    kind: params.kind,
    type: "reconciliation_share",
    context: "Reconciliation",
    shareId: params.shareId,
    recipientUserId: params.recipientUserId,
    companyId: params.companyId,
    message: params.message,
    isRead: false,
    timestamp: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
}

/** Target user ko alert + chat — naya reconcilink request. */
export async function sendReconciliationShareAlert(params: {
  shareId: string;
  recipientUserId: string;
  senderUserId: string;
  senderCompanyId: string;
  senderCompanyName: string;
  senderAccountName: string;
  senderUserEmail?: string;
}): Promise<void> {
  const fromLabel = reconciliationUserLabel(params.senderUserEmail, params.senderUserId);
  const msg = `You have — user ${fromLabel} sent you a reconcilink request for account "${params.senderAccountName}" from ${params.senderCompanyName}. Open ${RECON_SHARE_HEADER_LABEL} → Shared list to link your account.`;
  await addReconciliationAlert({
    shareId: params.shareId,
    recipientUserId: params.recipientUserId,
    companyId: params.senderCompanyId,
    message: msg,
    kind: "reconciliation_share_pending",
  });
  await sendReconciliationChatMessage({
    fromUserId: params.senderUserId,
    toUserId: params.recipientUserId,
    text: msg,
    companyName: params.senderCompanyName,
    shareId: params.shareId,
    kind: "reconciliation_request",
  });
}

/** Receiver link kare — sender ko accept message + reconciling page link. */
export async function sendReconciliationAcceptedAlert(params: {
  shareId: string;
  senderUserId: string;
  receiverUserId: string;
  receiverUserEmail?: string;
  receiverCompanyId: string;
  receiverCompanyName: string;
  receiverAccountName: string;
}): Promise<void> {
  const fromLabel = reconciliationUserLabel(params.receiverUserEmail, params.receiverUserId);
  const pagePath = reconciliationPagePath(params.shareId);
  const msg = `User ${fromLabel}, company ${params.receiverCompanyName}, account ${params.receiverAccountName} accepted reconcilink request. Go to reconciling page: ${pagePath}`;
  await addReconciliationAlert({
    shareId: params.shareId,
    recipientUserId: params.senderUserId,
    companyId: params.receiverCompanyId,
    message: msg,
    kind: "reconciliation_share_accepted",
  });
  await sendReconciliationChatMessage({
    fromUserId: params.receiverUserId,
    toUserId: params.senderUserId,
    text: msg,
    companyName: params.receiverCompanyName,
    shareId: params.shareId,
    kind: "reconciliation_accepted",
  });
}

/** Koi bhi party unlink kare — doosri side ko chat + alert. */
export async function sendReconciliationUnlinkedAlert(params: {
  shareId: string;
  recipientUserId: string;
  actorUserId: string;
  actorUserEmail?: string;
  actorCompanyName: string;
  actorAccountName: string;
  otherCompanyName: string;
  otherAccountName: string;
  companyIdForAlert: string;
}): Promise<void> {
  const actorLabel = reconciliationUserLabel(params.actorUserEmail, params.actorUserId);
  const msg = `User ${actorLabel}, account ${params.actorAccountName} has disconnected reconciling with your company ${params.otherCompanyName} account ${params.otherAccountName}.`;
  await addReconciliationAlert({
    shareId: params.shareId,
    recipientUserId: params.recipientUserId,
    companyId: params.companyIdForAlert,
    message: msg,
    kind: "reconciliation_share_unlinked",
  });
  await sendReconciliationChatMessage({
    fromUserId: params.actorUserId,
    toUserId: params.recipientUserId,
    text: msg,
    companyName: params.actorCompanyName,
    shareId: params.shareId,
    kind: "reconciliation_unlinked",
  });
}

/** Unlinked tab se request again — doosri party ko dubara request. */
export async function sendReconciliationRequestAgainAlert(params: {
  shareId: string;
  recipientUserId: string;
  actorUserId: string;
  actorUserEmail?: string;
  senderCompanyId: string;
  senderCompanyName: string;
  senderAccountName: string;
}): Promise<void> {
  const fromLabel = reconciliationUserLabel(params.actorUserEmail, params.actorUserId);
  const msg = `User ${fromLabel} sent you a reconcilink request again for account "${params.senderAccountName}" from ${params.senderCompanyName}. Open ${RECON_SHARE_HEADER_LABEL} → Shared list to link your account.`;
  await addReconciliationAlert({
    shareId: params.shareId,
    recipientUserId: params.recipientUserId,
    companyId: params.senderCompanyId,
    message: msg,
    kind: "reconciliation_share_pending",
  });
  await sendReconciliationChatMessage({
    fromUserId: params.actorUserId,
    toUserId: params.recipientUserId,
    text: msg,
    companyName: params.senderCompanyName,
    shareId: params.shareId,
    kind: "reconciliation_request_again",
  });
}
