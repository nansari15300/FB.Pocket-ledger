"use client";

/**
 * Inter Company — delete request bhejne ka dialog (locked / target side).
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { doc } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { InterCompanyDeleteRequest } from "@/lib/interCompany/interCompanyDeleteRequests";
import {
  appendInterCompanyDeleteRequest,
  findAnyPendingDeleteForLink,
  newDeleteRequestId,
} from "@/lib/interCompany/interCompanyDeleteRequests";
import { interCompanyInputClass } from "@/lib/interCompany/interCompanyVoucherChrome";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName?: string;
  draft: Omit<
    InterCompanyDeleteRequest,
    "id" | "createdAt" | "status" | "reason" | "requestedByUid" | "requestedByName"
  >;
  onSent?: () => void;
};

export function InterCompanyRequestDeleteDialog({
  open,
  onOpenChange,
  userId,
  userName,
  draft,
  onSent,
}: Props) {
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);

  const peerName =
    draft.requestedBySide === "source" ? draft.targetCompanyName : draft.sourceCompanyName;

  const handleSend = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast.error("Please enter a reason (at least 3 characters)");
      return;
    }
    setSending(true);
    try {
      let targetVoucherNumber = String(draft.targetVoucherNumber || "").trim();
      if (!targetVoucherNumber && draft.targetVoucherId && draft.targetCompanyId) {
        const snap = await getDoc(
          doc(firestore, `companies/${draft.targetCompanyId}/vouchers`, draft.targetVoucherId)
        );
        if (snap.exists()) {
          targetVoucherNumber = String(snap.data()?.voucherNumber || "");
        }
      }
      const requesterCompanyId =
        draft.requestedBySide === "source" ? draft.sourceCompanyId : draft.targetCompanyId;
      const existing = findAnyPendingDeleteForLink({
        companyId: requesterCompanyId,
        linkId: draft.linkId,
        sourceVoucherId: draft.sourceVoucherId,
        targetVoucherId: draft.targetVoucherId,
      });
      if (existing) {
        toast.error("A delete request is already pending for this voucher");
        return;
      }
      const req: InterCompanyDeleteRequest = {
        ...draft,
        targetVoucherNumber,
        id: newDeleteRequestId(),
        createdAt: Date.now(),
        status: "pending",
        reason: trimmed,
        requestedByUid: userId,
        requestedByName: userName,
      };
      appendInterCompanyDeleteRequest(req);
      toast.success(`Delete request sent to ${peerName || "other company"}`);
      setReason("");
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send request");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request delete</DialogTitle>
          <DialogDescription>
            {peerName || "The other company"} will see this on their Inter Company voucher. When they
            confirm, both linked copies move to the recycle bin.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Reason</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why should this inter-company voucher be deleted?"
            className={interCompanyInputClass}
            rows={4}
            disabled={sending}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={() => void handleSend()} disabled={sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send delete request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
