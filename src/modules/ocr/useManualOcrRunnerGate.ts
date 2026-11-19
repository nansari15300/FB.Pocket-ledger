"use client";

/**
 * Live Select Runner mode for the Manual OCR gate, and a writer that switches
 * exclusively to Manual Runner in the same settings doc the ribbon uses.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import { setDoc } from "@/lib/writeGateway/pbWrites";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { runnerModeFromSettings, buildSwitchToManualPatch, isCompanyAdminUser, type AutoPostMode } from "./manualOcrRunnerGate";

const SETTINGS_DOC_ID = "server_auto_ocr";

export function useManualOcrRunnerGate(): {
  mode: AutoPostMode;
  switchToManual: () => Promise<boolean>;
  switching: boolean;
  canSwitch: boolean;
} {
  const { company, companyId } = useCompany();
  const { user } = useAuth();
  const fsId = String((company as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || companyId || "").trim();
  const uid = String(user?.uid || "");
  const isCompanyAdmin = isCompanyAdminUser(company, uid);
  const [savedSettings, setSavedSettings] = useState<Record<string, unknown>>({});
  const [mode, setMode] = useState<AutoPostMode>("manual");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!fsId) {
      setSavedSettings({});
      setMode("manual");
      return;
    }
    return onSnapshot(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), (snapshot) => {
      const value = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : {};
      setSavedSettings(value);
      setMode(runnerModeFromSettings(value));
    }, () => {
      setSavedSettings({});
      setMode("manual");
    });
  }, [fsId]);

  const switchToManual = useCallback(async (): Promise<boolean> => {
    if (!fsId || !uid || !isCompanyAdmin || saving || mode === "manual") return mode === "manual";
    window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-runner-hold", { detail: { companyId: fsId, held: true } }));
    const previous = mode;
    setMode("manual");
    setSaving(true);
    try {
      await setDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), {
        ...buildSwitchToManualPatch(savedSettings),
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }, { merge: true });
      return true;
    } catch (error) {
      setMode(previous);
      toast.error("Could not change to Manual Runner", { description: error instanceof Error ? error.message : "Please try again." });
      return false;
    } finally {
      setSaving(false);
    }
  }, [fsId, uid, isCompanyAdmin, saving, mode, savedSettings]);

  return {
    mode,
    switchToManual,
    switching: saving,
    canSwitch: isCompanyAdmin && !!fsId && !!uid && mode !== "manual" && !saving,
  };
}
