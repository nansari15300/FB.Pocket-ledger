"use client";

import { Button } from "@/components/ui/button";
import { AUTO_POST_UI, useAutoPostUiCopy } from "@/components/gallery/autoPostUiCopy";
import type { AutoPostMode } from "@/components/gallery/autoPostMode";

/** Runner Start/Resume/Stop and Skip controls for the New Trxn footer. */
export function RunnerFooterControls({
  companyId,
  held,
  active,
  enabled,
  mode,
}: {
  companyId: string;
  held: boolean;
  active: boolean;
  enabled: boolean;
  mode: AutoPostMode;
}) {
  const { t } = useAutoPostUiCopy();
  const canToggle = enabled || (mode === "manual" && active);
  return (
    <>
      <Button
        type="button"
        className="h-8 shrink-0 rounded-full border border-green-600 bg-white px-3 text-[11px] font-medium text-green-900 shadow-sm hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
        aria-pressed={enabled && !held}
        disabled={!canToggle}
        title={!canToggle ? t(AUTO_POST_UI.enableAutoPostToStart) : undefined}
        onClick={() => window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-runner-hold", { detail: { companyId, held: !held } }))}
      >
        {held ? (active ? t(AUTO_POST_UI.resumeRunner) : t(AUTO_POST_UI.startRunner)) : t(AUTO_POST_UI.stopRunner)}
      </Button>
      {active && held ? (
        <Button
          type="button"
          className="h-8 shrink-0 rounded-full border border-amber-500 bg-white px-3 text-[11px] font-medium text-amber-900 shadow-sm hover:bg-amber-50"
          title={t(AUTO_POST_UI.skipMoveToAutoFailedTitle)}
          onClick={() => window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-skip-current", { detail: { companyId } }))}
        >
          {t(AUTO_POST_UI.skipMoveToAutoFailed)}
        </Button>
      ) : null}
    </>
  );
}
