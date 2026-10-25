"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { openAttachmentInApp } from "@/lib/openAttachmentInApp";
import { mdc, mdcMobileHeaderAvatarData, mdcMobileHeaderAvatarNoPhotoData } from "@/lib/mobileDetailChrome";
import { LEDGER_HEADER_AVATAR_CN } from "@/lib/ledgerHeaderChrome";

function initialsFromName(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "NA"
  );
}

/** Merged mobile master-detail header — square avatar, list-dock chevron blue when no photo. */
export function MobileMasterDetailHeaderAvatar({
  name,
  attachmentUrl,
  fallbackSlot,
  previewTitle,
  editTrigger,
}: {
  name: string;
  attachmentUrl?: string | null;
  fallbackSlot?: React.ReactNode;
  previewTitle?: string;
  /** e.g. EditPartyDialog trigger — desktop ribbon pen jaisa overlay */
  editTrigger?: React.ReactNode;
}) {
  const label = previewTitle ?? name;
  const initials = initialsFromName(name || "NA");
  const hasAvatarImage = Boolean(attachmentUrl?.trim());
  const openPreview = () => {
    if (!attachmentUrl?.trim()) return;
    void openAttachmentInApp(attachmentUrl, { title: label });
  };

  return (
    <div className={cn(LEDGER_HEADER_AVATAR_CN, "inline-flex shrink-0")}>
      <EntityFileAttachmentHover
        fileUrl={attachmentUrl ?? undefined}
        triggerClassName={cn("inline-flex", mdc.mobileHeaderAvatarBox)}
      >
        <button
          type="button"
          {...mdcMobileHeaderAvatarData}
          {...(!hasAvatarImage ? mdcMobileHeaderAvatarNoPhotoData : {})}
          className={cn(
            "inline-flex items-center justify-center overflow-hidden rounded-lg border p-0",
            mdc.mobileHeaderAvatarBox,
            hasAvatarImage ? mdc.mobileHeaderAvatarWithPhoto : mdc.mobileHeaderAvatarNoPhoto
          )}
          onClick={openPreview}
          aria-label={`Preview ${label} avatar`}
        >
          <ResolvedEntityAvatar
            className={cn(mdc.mobileHeaderAvatarBox, "rounded-none text-sm font-semibold [&_img]:object-cover [&_img]:rounded-none")}
            src={attachmentUrl ?? undefined}
            alt={label}
            fallbackText={initials}
            fallbackSlot={fallbackSlot}
            fallbackClassName={hasAvatarImage ? undefined : mdc.mobileHeaderAvatarNoPhotoFallback}
          />
        </button>
      </EntityFileAttachmentHover>
      {editTrigger}
    </div>
  );
}
