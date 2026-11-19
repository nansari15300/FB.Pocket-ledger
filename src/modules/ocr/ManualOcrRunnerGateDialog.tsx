"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";
import { isNonManualRunnerMode, type AutoPostMode } from "./manualOcrRunnerGate";
import {
  manualOcrRunnerGateAdmin,
  manualOcrRunnerGateMessage,
  manualOcrRunnerGateOk,
  manualOcrRunnerGateSwitch,
  manualOcrRunnerGateTitle,
} from "./manualOcrRunnerGateIntro";

/**
 * Centered notice when Refresh OCR is clicked while Semi / Full is selected
 * on a hand-opened voucher. Stays until OK. The switch writes Manual Runner
 * to the same Select Runner settings store.
 */
export function ManualOcrRunnerGateDialog({
  open,
  onClose,
  mode,
  onSwitchToManual,
  switching,
  canSwitch,
}: {
  open: boolean;
  onClose: () => void;
  mode: AutoPostMode;
  onSwitchToManual: () => Promise<boolean>;
  switching?: boolean;
  canSwitch?: boolean;
}) {
  const i18n = usePlI18nOptional();
  const lang = introTabLang(i18n?.intro);
  const gateMode = isNonManualRunnerMode(mode) ? mode : "semi";
  const checked = mode === "manual";
  const allowFlip = canSwitch === true && !switching && !checked;

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) return; }}>
      <AlertDialogContent
        className="z-[2147483005] max-w-lg text-center"
        overlayClassName="z-[2147483004] bg-black/45 backdrop-blur-sm"
        data-pl-manual-ocr-runner-gate-dialog=""
      >
        <AlertDialogHeader className="sm:text-center">
          <AlertDialogTitle>{manualOcrRunnerGateTitle(lang)}</AlertDialogTitle>
          <AlertDialogDescription className="text-center text-sm text-foreground">
            {manualOcrRunnerGateMessage(lang, gateMode)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center justify-center gap-3 py-1">
          <Switch
            checked={checked}
            disabled={!allowFlip}
            onCheckedChange={(next) => {
              if (next && allowFlip) void onSwitchToManual();
            }}
            aria-label={manualOcrRunnerGateSwitch(lang)}
            data-pl-manual-ocr-runner-gate-switch=""
          />
          <span className="text-sm font-medium text-foreground">{manualOcrRunnerGateSwitch(lang)}</span>
        </div>
        {!canSwitch && !checked ? (
          <p className="text-center text-xs text-muted-foreground">{manualOcrRunnerGateAdmin(lang)}</p>
        ) : null}
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogAction type="button" onClick={onClose} disabled={switching}>
            {manualOcrRunnerGateOk(lang)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
