"use client";

/**
 * Live OCR pref + Select Runner mode for the New Trxn header pill,
 * and a writer that updates the same settings doc the gallery ribbon uses.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { setDoc } from "@/lib/writeGateway/pbWrites";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";
import { loadOcrEngineOptions } from "./engineChoices";
import { ENGINE_NO_KEY_COPY, scanEngineHasKey } from "./engineKeys";
import { setOcrPrefs, useOcrPrefs } from "./prefs";
import { buildSwitchToRunnerModePatch, isCompanyAdminUser } from "./manualOcrRunnerGate";
import {
  applyDialogModeChoice,
  canSelectDialogMode,
  dialogModeFromState,
  dialogRunnerModeFromSettings,
  runnerNeedsLocalDevice,
  runnerProfileForMode,
  type AutoPostMode,
  type VoucherOcrDialogMode,
} from "./voucherOcrDialogMode";
import {
  voucherOcrModeDeviceToast,
  voucherOcrModeSaveError,
  voucherOcrModeSaveRetry,
} from "./voucherOcrDialogModeIntro";

const SETTINGS_DOC_ID = "server_auto_ocr";

export function useVoucherOcrDialogMode(): {
  dialogMode: VoucherOcrDialogMode;
  runnerMode: AutoPostMode;
  ocrEnabled: boolean;
  chooseMode: (next: VoucherOcrDialogMode) => Promise<boolean>;
  choosing: boolean;
  canChangeRunner: boolean;
} {
  const prefs = useOcrPrefs();
  const i18n = usePlI18nOptional();
  const lang = introTabLang(i18n?.intro);
  const { company, companyId } = useCompany();
  const { user } = useAuth();
  const fsId = String((company as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || companyId || "").trim();
  const uid = String(user?.uid || "");
  const isCompanyAdmin = isCompanyAdminUser(company, uid);
  const [savedSettings, setSavedSettings] = useState<Record<string, unknown>>({});
  const [runnerMode, setRunnerMode] = useState<AutoPostMode>("manual");
  const [saving, setSaving] = useState(false);
  const ocrEnabled = prefs.enabled !== false;
  const dialogMode = dialogModeFromState({ ocrEnabled, runnerMode });

  useEffect(() => {
    if (!fsId) {
      setSavedSettings({});
      setRunnerMode("manual");
      return;
    }
    return onSnapshot(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), (snapshot) => {
      const value = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : {};
      setSavedSettings(value);
      setRunnerMode(dialogRunnerModeFromSettings(value));
    }, () => {
      setSavedSettings({});
      setRunnerMode("manual");
    });
  }, [fsId]);

  const chooseMode = useCallback(async (next: VoucherOcrDialogMode): Promise<boolean> => {
    const applied = applyDialogModeChoice({ next, runnerMode });
    if (next === dialogMode) return true;
    if (!canSelectDialogMode({ next, runnerMode, isCompanyAdmin })) return false;

    if (!applied.runnerModeChanged) {
      setOcrPrefs({ enabled: applied.ocrEnabled });
      return true;
    }

    if (!fsId || !uid || !isCompanyAdmin || saving) return false;
    const profile = runnerProfileForMode(savedSettings, applied.runnerMode);
    if (runnerNeedsLocalDevice(profile, applied.runnerMode)) {
      toast.error(voucherOcrModeDeviceToast(lang));
      window.dispatchEvent(new Event("pl:gallery:auto-ocr-settings"));
      return false;
    }
    if (applied.runnerMode !== "manual") {
      const keyed = await loadOcrEngineOptions(fsId).catch(() => null);
      if (!keyed || !scanEngineHasKey(profile.scanEngine || "auto", keyed)) {
        const copyLang = lang === "hi" || lang === "ne" ? lang : "en";
        toast.error(ENGINE_NO_KEY_COPY[copyLang]);
        return false;
      }
    }

    window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-runner-hold", { detail: { companyId: fsId, held: true } }));
    const previous = runnerMode;
    setRunnerMode(applied.runnerMode);
    setSaving(true);
    try {
      await setDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), {
        ...buildSwitchToRunnerModePatch(savedSettings, applied.runnerMode),
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }, { merge: true });
      setOcrPrefs({ enabled: true });
      return true;
    } catch (error) {
      setRunnerMode(previous);
      toast.error(voucherOcrModeSaveError(lang), {
        description: error instanceof Error ? error.message : voucherOcrModeSaveRetry(lang),
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [dialogMode, runnerMode, isCompanyAdmin, fsId, uid, saving, savedSettings, lang]);

  return {
    dialogMode,
    runnerMode,
    ocrEnabled,
    chooseMode,
    choosing: saving,
    canChangeRunner: isCompanyAdmin && !!fsId && !!uid && !saving,
  };
}
