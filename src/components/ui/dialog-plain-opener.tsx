"use client";

import * as React from "react";

/**
 * Non-Radix opener for master Edit* dialogs.
 *
 * `<DialogTrigger asChild>{button}</DialogTrigger>` merges refs through Radix Slot (composeRefs is
 * recreated on every render), so when the parent re-renders after Save (fileUrl / documentFileUrls patch)
 * the trigger button's ref detaches + re-attaches each commit and, together with any state-setting Radix
 * ref in the same tree, trips "Maximum update depth exceeded" (see `DialogControlledOpener` in ui/dialog.tsx).
 * Here the caller's own element is rendered untouched; the click just bubbles to a `display: contents` span.
 * Open-only on purpose: Dialog `onOpenChange` still handles closing.
 */
export function DialogPlainOpener({
  onOpen,
  children,
}: {
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <span className="contents" onClick={onOpen}>
      {children}
    </span>
  );
}