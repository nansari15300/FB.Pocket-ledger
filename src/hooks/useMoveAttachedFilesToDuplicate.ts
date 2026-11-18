"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  hasGalleryMoveableAttachment,
  moveAttachedFilesToDuplicate,
} from "@/lib/galleryDuplicateMove";
import type { DuplicateMatch } from "@/lib/voucherDuplicateGuard";

export function useMoveAttachedFilesToDuplicate(options: {
  files: readonly (File | string)[] | null | undefined;
  companyId?: string | null;
  company?: unknown;
  onClosed?: (match: DuplicateMatch) => void;
}) {
  const { files, companyId, company, onClosed } = options;
  const [moveBusy, setMoveBusy] = useState(false);
  const canAutoMove = hasGalleryMoveableAttachment(files);

  const moveToDuplicate = useCallback(
    async (match: DuplicateMatch) => {
      if (!companyId || moveBusy) return;
      setMoveBusy(true);
      const toastId = toast.loading("Moving file to Duplicate Documents…");
      try {
        const result = await moveAttachedFilesToDuplicate(companyId, company, files, match);
        if (result.kind === "moved") {
          toast.success("Moved to Duplicate Documents", {
            id: toastId,
            description: `${result.moved} file(s) moved. You will find them in Gallery → Duplicate.`,
          });
        } else if (result.kind === "already") {
          toast.success("File is already in Duplicate Documents", {
            id: toastId,
            description: "Nothing to move — this slip was already filed as a duplicate.",
          });
        } else if (result.kind === "no-gallery-file") {
          toast.info("Nothing to move", {
            id: toastId,
            description: "This attachment is not in Unassigned Documents — closing without saving.",
          });
        } else {
          toast.info("File not found in Unassigned Documents", {
            id: toastId,
            description: "Closing the voucher without saving.",
          });
        }
        onClosed?.(match);
      } finally {
        setMoveBusy(false);
      }
    },
    [company, companyId, files, moveBusy, onClosed],
  );

  return { moveBusy, moveToDuplicate, canAutoMove };
}
