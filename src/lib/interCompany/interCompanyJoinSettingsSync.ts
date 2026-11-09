/**
 * Inter Company join settings — Firestore sync (shared users + devices).
 * localStorage cache ke saath; Save par dono update.
 */
import { setDoc } from "@/lib/writeGateway/pbWrites";
import { doc, serverTimestamp, type Unsubscribe } from "@/lib/pbCompat/firestore";
import { getDoc, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/plClientSession";
import {
  readInterCompanyLocalSettings,
  writeInterCompanyLocalSettings,
  type InterCompanyLocalSettings,
} from "@/lib/interCompany/interCompanyLocalStore";
import { isPureLocalInterCompanyCompany } from "@/lib/interCompany/localInterCompanyPolicy";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";
import {
  DEFAULT_PARTNER_MASK_IN_VIEW,
  DEFAULT_PARTNER_SEARCH_BY,
  DEFAULT_PARTNER_VIEW_FIELDS,
  normalizePartnerFieldFlags,
  normalizePartnerSearchBy,
  normalizePartnerViewFields,
} from "@/lib/interCompany/interCompanyPartnerPrivacy";

export type InterCompanyJoinSettingsDoc = InterCompanyLocalSettings & {
  companyId: string;
  companyGroupId?: string | null;
  updatedByUid?: string;
  updatedAt?: { toDate?: () => Date };
};

function settingsDocRef(companyId: string) {
  return doc(firestore, "companies", companyId, "inter_company_config", "settings");
}

/** Firestore → local shape */
function docToLocalSettings(data: Record<string, unknown>): InterCompanyLocalSettings {
  return {
    notificationsEnabled:
      typeof data.notificationsEnabled === "boolean" ? data.notificationsEnabled : true,
    joinedCompanyIds: Array.isArray(data.joinedCompanyIds)
      ? data.joinedCompanyIds.filter((x) => typeof x === "string")
      : [],
    permanentJoinedCompanyIds: Array.isArray(data.permanentJoinedCompanyIds)
      ? data.permanentJoinedCompanyIds.filter((x) => typeof x === "string")
      : [],
    partnerDisplayMode: data.partnerDisplayMode === "ac_only" ? "ac_only" : "name_and_ac",
    partnerSearchBy: normalizePartnerSearchBy(
      data.partnerSearchBy as Partial<InterCompanyLocalSettings["partnerSearchBy"]>
    ),
    partnerViewFields: normalizePartnerViewFields(
      data.partnerViewFields as Partial<InterCompanyLocalSettings["partnerViewFields"]>
    ),
    partnerMaskInView:
      typeof data.partnerMaskInView === "boolean"
        ? data.partnerMaskInView
        : DEFAULT_PARTNER_MASK_IN_VIEW,
  };
}

/** Load — Firestore pehle, warna localStorage */
export async function loadInterCompanyJoinSettings(
  companyId: string
): Promise<{ settings: InterCompanyLocalSettings; companyGroupId: string | null }> {
  if (!isInterCompanySystemEnabled() || !companyId) {
    return { settings: readInterCompanyLocalSettings(companyId), companyGroupId: null };
  }
  if (await isPureLocalInterCompanyCompany(companyId)) {
    return {
      settings: readInterCompanyLocalSettings(companyId),
      companyGroupId: null,
    };
  }
  try {
    const snap = await getDoc(settingsDocRef(companyId));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      const settings = docToLocalSettings(data);
      writeInterCompanyLocalSettings(companyId, settings);
      return {
        settings,
        companyGroupId: String(data.companyGroupId || "").trim() || null,
      };
    }
  } catch (err) {
    console.warn("[IC join] load settings:", err);
  }
  return {
    settings: readInterCompanyLocalSettings(companyId),
    companyGroupId: null,
  };
}

/** Realtime — shared user admin joins auto dikhe */
export function subscribeInterCompanyJoinSettings(
  companyId: string,
  onData: (payload: { settings: InterCompanyLocalSettings; companyGroupId: string | null }) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  if (!isInterCompanySystemEnabled() || !companyId) return () => undefined;

  let cancelled = false;
  let firestoreUnsub: Unsubscribe = () => undefined;

  void (async () => {
    if (await isPureLocalInterCompanyCompany(companyId)) {
      if (cancelled) return;
      onData({
        settings: readInterCompanyLocalSettings(companyId),
        companyGroupId: null,
      });
      return;
    }
    if (cancelled) return;
    firestoreUnsub = onSnapshot(
      settingsDocRef(companyId),
      (snap) => {
        if (!snap.exists()) {
          onData({ settings: readInterCompanyLocalSettings(companyId), companyGroupId: null });
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        const settings = docToLocalSettings(data);
        writeInterCompanyLocalSettings(companyId, settings);
        onData({
          settings,
          companyGroupId: String(data.companyGroupId || "").trim() || null,
        });
      },
      (err) => onError?.(err)
    );
  })();

  return () => {
    cancelled = true;
    firestoreUnsub();
  };
}

/** Save button — Firestore + localStorage */
export async function saveInterCompanyJoinSettings(args: {
  companyId: string;
  settings: InterCompanyLocalSettings;
  companyGroupId?: string | null;
  updatedByUid: string;
}): Promise<void> {
  if (!isInterCompanySystemEnabled()) return;
  const { companyId, updatedByUid } = args;
  const settings: InterCompanyLocalSettings = {
    ...args.settings,
    partnerSearchBy: normalizePartnerSearchBy(args.settings.partnerSearchBy),
    partnerViewFields: normalizePartnerViewFields(args.settings.partnerViewFields),
  };
  writeInterCompanyLocalSettings(companyId, settings);
  if (await isPureLocalInterCompanyCompany(companyId)) {
    return;
  }
  await setDoc(
    settingsDocRef(companyId),
    {
      companyId,
      ...settings,
      companyGroupId: args.companyGroupId ?? null,
      updatedByUid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Clear joined partner ticks for listed companies (local + Firestore) */
export async function resetInterCompanyJoinLinks(args: {
  companyIds: string[];
  updatedByUid: string;
}): Promise<void> {
  const ids = [...new Set(args.companyIds.filter(Boolean))];
  for (const companyId of ids) {
    const current = readInterCompanyLocalSettings(companyId);
    if (current.joinedCompanyIds.length === 0) continue;
    await saveInterCompanyJoinSettings({
      companyId,
      settings: { ...current, joinedCompanyIds: [] },
      updatedByUid: args.updatedByUid,
    });
  }
}
