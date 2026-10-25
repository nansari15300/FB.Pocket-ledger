"use client";

import { FileDigit, Crown, Landmark } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { reportEntityInitials } from "@/lib/reportEntityInitials";
import {
  LEDGER_HEADER_AVATAR_CN,
  LEDGER_HEADER_AVATAR_IMAGE_CN,
} from "@/lib/ledgerHeaderChrome";

/** Party / Bank / Staff / Tax / In-Exp / Item / Group — ek hi header avatar pattern (entity reports). */
const avatarClassName = LEDGER_HEADER_AVATAR_IMAGE_CN;

export type ReportStatementAvatarKind =
  | "party"
  | "staff"
  | "tax"
  | "expense"
  | "item"
  | "bank"
  | "group";

export type ReportStatementHeaderAvatarProps = {
  kind: ReportStatementAvatarKind;
  displayName: string;
  fileUrl?: string | null | undefined;
  /** Party: Opening Balance / system ledger — FileDigit fallback (PartyDetails). */
  isSystemEntity?: boolean;
  /** Bank: special account → Crown, warna Landmark (AccountDetails). */
  bankIsSpecial?: boolean;
};

export function ReportStatementHeaderAvatar({
  kind,
  displayName,
  fileUrl,
  isSystemEntity,
  bankIsSpecial,
}: ReportStatementHeaderAvatarProps) {
  const initials = reportEntityInitials(displayName || "NA");

  if (kind === "group") {
    return (
      <div className={LEDGER_HEADER_AVATAR_CN} title={displayName}>
        <Avatar className={avatarClassName}>
          <AvatarFallback className="bg-muted text-lg font-semibold">{initials}</AvatarFallback>
        </Avatar>
      </div>
    );
  }

  if (kind === "bank") {
    return (
      <div className={LEDGER_HEADER_AVATAR_CN} title={displayName}>
        <ResolvedEntityAvatar
          className={avatarClassName}
          src={fileUrl}
          alt={displayName}
          fallbackSlot={
            bankIsSpecial ? (
              <Crown className="h-6 w-6 text-amber-500" aria-hidden />
            ) : (
              <Landmark className="h-6 w-6 text-muted-foreground" aria-hidden />
            )
          }
        />
      </div>
    );
  }

  if (kind === "party" && isSystemEntity) {
    return (
      <div className={LEDGER_HEADER_AVATAR_CN} title={displayName}>
        <Avatar className={avatarClassName}>
          <AvatarImage src={fileUrl ?? undefined} alt={displayName} className="rounded-none" />
          <AvatarFallback className="rounded-none bg-muted p-0 text-muted-foreground">
            <FileDigit className="h-6 w-6" aria-hidden />
          </AvatarFallback>
        </Avatar>
      </div>
    );
  }

  return (
    <div className={LEDGER_HEADER_AVATAR_CN} title={displayName}>
      <ResolvedEntityAvatar
        className={avatarClassName}
        src={fileUrl}
        alt={displayName}
        fallbackText={initials}
      />
    </div>
  );
}
