"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, Bot, Clock3, Gauge, Loader2, Monitor, Server, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { doc, onSnapshot, serverTimestamp } from "@/lib/pbCompat/firestore";
import { setDoc } from "@/lib/writeGateway/pbWrites";
import { kickOutDevicesBatch, removeThisDevice } from "@/lib/deviceLimitClient";
import { firestore } from "@/lib/plClientSession";
import { useOcrAiStatus } from "@/modules/ocr/ai/aiClient";
import { useOcrCloudStatus } from "@/modules/ocr/cloud/ocrCloudClient";
import { getOrCreateDeviceId } from "@/lib/writeGateway/legacy/deviceLimitClient";
import { GalleryLocalAutoPostRunner } from "@/components/gallery/GalleryLocalAutoPostRunner";
import { AutoPostModeSwitch } from "@/components/gallery/AutoPostModeSwitch";
import { pbListAppDocs } from "@/lib/pocketbaseData/pbSync";

const SETTINGS_DOC_ID = "server_auto_ocr";

type AutoOcrSettings = {
  enabled: boolean;
  processingMode: "semi" | "full";
  runLocation: "local-pc" | "server";
  localRunnerUid: string;
  localRunnerDeviceId: string;
  runOnUpload: boolean;
  runOnSchedule: boolean;
  scheduleMode: "interval" | "date-time";
  scheduleMinutes: number;
  scheduleDate: string;
  scheduleTime: string;
  scanEngine: "gemini" | "google" | "azure";
  maxCallsPerMinute: number;
  failOnMissingFields: boolean;
  missingFieldAction: "fail-and-continue" | "pause-and-hold";
  checkDuplicateVouchers: boolean;
  duplicateVoucherAction: "move-to-duplicates" | "pause-for-review" | "save-anyway";
};

const DEFAULT_SETTINGS: AutoOcrSettings = {
  enabled: false,
  processingMode: "semi",
  runLocation: "server",
  localRunnerUid: "",
  localRunnerDeviceId: "",
  runOnUpload: true,
  runOnSchedule: false,
  scheduleMode: "interval",
  scheduleMinutes: 5,
  scheduleDate: "",
  scheduleTime: "",
  scanEngine: "gemini",
  maxCallsPerMinute: 5,
  failOnMissingFields: true,
  missingFieldAction: "pause-and-hold",
  checkDuplicateVouchers: true,
  duplicateVoucherAction: "move-to-duplicates",
};

const SCAN_ENGINES = {
  gemini: { name: "Pocket AI (Gemini)", provider: "gemini" },
  google: { name: "Google Cloud Vision", provider: "google" },
  azure: { name: "Azure Vision", provider: "azure" },
} as const;

const LOCAL_INFO = {
  en: "Local PC processes documents on the selected computer. The app and internet connection must remain available; while the computer is offline, Auto post pauses and documents remain pending. Only a registered device belonging to an active company admin is eligible.",
  hi: "Local PC चुने गए कंप्यूटर पर documents process करता है। App और internet चालू रहना चाहिए; कंप्यूटर offline होने पर Auto post रुक जाता है और documents pending रहते हैं। यह सुविधा केवल active company admin के registered device पर चल सकती है।",
  ne: "Local PC ले छानिएको कम्प्युटरमा documents प्रक्रिया गर्छ। App र internet उपलब्ध हुनुपर्छ; कम्प्युटर offline हुँदा Auto post रोकिन्छ र documents pending रहन्छन्। Active company admin को registered device मा मात्र यो सेवा चल्न सक्छ।",
} as const;

const LOCAL_DEVICE_COPY = {
  en: {
    select: "Select the admin device that will run Auto post",
    oneOnly: "Only one admin device can be selected for this service at a time. This prevents the same document from being processed on multiple devices and creating duplicate vouchers.",
    devices: "Registered admin devices",
    selectedCount: "Selected for Auto post",
    loading: "Loading registered admin devices…",
    empty: "No registered admin devices are available. Sign in on an admin device and open this Gallery page first.",
    owner: "Company owner",
    admin: "Company admin",
    required: "Select one registered admin device before saving Local PC mode.",
    moved: "The selected device is different from this PC. Auto post will run only after the selected admin opens the app.",
    remove: "Remove",
    kick: "Kick out",
    selected: "Selected for Auto post",
    confirmTitle: "Remove this device from the company?",
    confirmSelf: "This removes this PC from the company device list and frees its device slot. It also stops Local PC Auto post on this device.",
    confirmOther: "This signs the selected device out of this company and removes its device slot. If it is selected for Local PC Auto post, the service will stop until another admin device is selected.",
    cancel: "Cancel",
    thisDevice: "This device",
    removing: "Removing…",
  },
  hi: {
    select: "Auto post चलाने के लिए admin device चुनें",
    oneOnly: "इस सेवा के लिए एक समय में केवल एक admin device चुना जा सकता है। इससे एक ही document कई devices पर process होकर duplicate vouchers बनाने से बचता है।",
    devices: "Registered admin devices",
    selectedCount: "Auto post के लिए चुने गए devices",
    loading: "Registered admin devices लोड हो रहे हैं…",
    empty: "कोई registered admin device उपलब्ध नहीं है। पहले किसी admin device से sign in करके यह Gallery page खोलें।",
    owner: "Company owner",
    admin: "Company admin",
    required: "Local PC mode save करने से पहले एक registered admin device चुनें।",
    moved: "चुना गया device यह PC नहीं है। Auto post चुने गए admin के app खोलने पर ही चलेगा।",
    remove: "हटाएँ",
    kick: "बाहर करें",
    selected: "Auto post के लिए चुना गया",
    confirmTitle: "इस device को company से हटाएँ?",
    confirmSelf: "इससे यह PC company की device list से हटेगा और इसका device slot खाली होगा। इस device पर Local PC Auto post भी रुक जाएगा।",
    confirmOther: "चुना गया device इस company से sign out होगा और उसका device slot हट जाएगा। यदि वह Local PC Auto post के लिए चुना है, तो दूसरा admin device चुनने तक सेवा रुकी रहेगी।",
    cancel: "रद्द करें",
    thisDevice: "यह device",
    removing: "हटाया जा रहा है…",
  },
  ne: {
    select: "Auto post चलाउन admin device छान्नुहोस्",
    oneOnly: "यो सेवाका लागि एक पटकमा एउटा मात्र admin device छान्न सकिन्छ। यसले एउटै document धेरै device मा प्रक्रिया भएर duplicate voucher बन्नबाट रोक्छ।",
    devices: "Registered admin devices",
    selectedCount: "Auto post का लागि छानिएका devices",
    loading: "Registered admin devices लोड हुँदैछन्…",
    empty: "कुनै registered admin device उपलब्ध छैन। पहिले admin device बाट sign in गरी यो Gallery page खोल्नुहोस्।",
    owner: "Company owner",
    admin: "Company admin",
    required: "Local PC mode save गर्नुअघि एउटा registered admin device छान्नुहोस्।",
    moved: "छानिएको device यो PC होइन। छानिएको admin ले app खोलेपछि मात्र Auto post चल्छ।",
    remove: "हटाउनुहोस्",
    kick: "बाहिर निकाल्नुहोस्",
    selected: "Auto post का लागि छानिएको",
    confirmTitle: "यो device लाई company बाट हटाउने?",
    confirmSelf: "यसले यो PC लाई company को device list बाट हटाएर यसको device slot खाली गर्छ। यो device मा Local PC Auto post पनि रोकिन्छ।",
    confirmOther: "छानिएको device यस company बाट sign out हुन्छ र यसको device slot हट्छ। यो Local PC Auto post का लागि छानिएको भए अर्को admin device नछानेसम्म सेवा रोकिन्छ।",
    cancel: "रद्द गर्नुहोस्",
    thisDevice: "यो device",
    removing: "हटाउँदै…",
  },
} as const;

type AdminDevice = { id: string; userId: string; deviceLabel?: string; deviceType?: "mobile" | "desktop" };

const MISSING_FIELD_ACTION_COPY = {
  en: {
    label: "When required information is missing",
    description: "Use the same rule for Party, Item, Bank/Cash, Account, Date, Tax and other required fields.",
    pause: "Pause runner and keep the voucher open for review",
    fail: "Cancel voucher, move document to Auto post failed, then continue",
  },
  hi: {
    label: "ज़रूरी जानकारी न मिलने पर",
    description: "यह नियम Party, Item, Bank/Cash, Account, Date, Tax और बाकी सभी ज़रूरी fields पर लागू होगा।",
    pause: "Runner रोकें और review के लिए voucher खुला रखें",
    fail: "Voucher cancel करें, document को Auto post failed में भेजें और आगे बढ़ें",
  },
  ne: {
    label: "आवश्यक विवरण नभेटिएमा",
    description: "यो नियम Party, Item, Bank/Cash, Account, Date, Tax र अन्य सबै आवश्यक field मा लागू हुन्छ।",
    pause: "Runner रोक्नुहोस् र review का लागि voucher खुला राख्नुहोस्",
    fail: "Voucher cancel गरी document लाई Auto post failed मा पठाएर अगाडि बढ्नुहोस्",
  },
} as const;

const DUPLICATE_COPY = {
  en: {
    title: "Check for duplicate vouchers",
    description: "Before creating a voucher, compare its transaction reference, date, amount, and party or account with existing vouchers. Choose what should happen when a possible duplicate is found.",
    actionLabel: "When a duplicate is found",
    move: "Move document to Duplicate Documents",
    pause: "Pause auto-scan and ask me to review",
    save: "Show warning, then create unapproved voucher",
  },
  hi: {
    title: "Duplicate voucher की जाँच करें",
    description: "Voucher बनाने से पहले transaction reference, date, amount और party या account का मौजूदा vouchers से मिलान करें। संभावित duplicate मिलने पर आगे क्या करना है, चुनें।",
    actionLabel: "Duplicate मिलने पर",
    move: "Document को Duplicate Documents में भेजें",
    pause: "Auto-scan रोकें और मुझसे review माँगें",
    save: "Warning दिखाकर unapproved voucher बनाएँ",
  },
  ne: {
    title: "Duplicate voucher जाँच गर्नुहोस्",
    description: "Voucher बनाउनुअघि transaction reference, date, amount र party वा account लाई पहिलेका vouchers सँग मिलाउनुहोस्। सम्भावित duplicate भेटिएपछि के गर्ने हो छान्नुहोस्।",
    actionLabel: "Duplicate भेटिएमा",
    move: "Document लाई Duplicate Documents मा पठाउनुहोस्",
    pause: "Auto-scan रोकेर मलाई review गर्न सोध्नुहोस्",
    save: "Warning देखाएर unapproved voucher बनाउनुहोस्",
  },
} as const;

function normalizeSettings(raw: unknown): AutoOcrSettings {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const bounded = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  };
  return {
    enabled: value.enabled === true,
    processingMode: value.processingMode === "full" ? "full" : "semi",
    runLocation: value.runLocation === "local-pc" ? "local-pc" : "server",
    localRunnerUid: typeof value.localRunnerUid === "string" ? value.localRunnerUid : "",
    localRunnerDeviceId: typeof value.localRunnerDeviceId === "string" ? value.localRunnerDeviceId : "",
    runOnUpload: value.runOnUpload !== false,
    runOnSchedule: value.runOnSchedule === true,
    scheduleMode: value.scheduleMode === "date-time" ? "date-time" : "interval",
    scheduleMinutes: bounded(value.scheduleMinutes, DEFAULT_SETTINGS.scheduleMinutes, 1, 1440),
    scheduleDate: typeof value.scheduleDate === "string" ? value.scheduleDate : "",
    scheduleTime: typeof value.scheduleTime === "string" ? value.scheduleTime : "",
    scanEngine: value.scanEngine === "google" || value.scanEngine === "azure" ? value.scanEngine : "gemini",
    maxCallsPerMinute: bounded(value.maxCallsPerMinute, DEFAULT_SETTINGS.maxCallsPerMinute, 1, 15),
    failOnMissingFields: true,
    missingFieldAction: value.missingFieldAction === "fail-and-continue" ? "fail-and-continue" : "pause-and-hold",
    checkDuplicateVouchers: value.checkDuplicateVouchers !== false,
    duplicateVoucherAction: value.duplicateVoucherAction === "pause-for-review" || value.duplicateVoucherAction === "save-anyway"
      ? value.duplicateVoucherAction
      : "move-to-duplicates",
  };
}

function resolveCompanyId(companyId: string, company: { authoritativeCompanyId?: string } | null | undefined) {
  return String(company?.authoritativeCompanyId || companyId).trim() || companyId;
}

function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatLocalDate(value: Date | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function GalleryAutoOcrSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const i18n = usePlI18nOptional();
  const introLang = introTabLang(i18n?.intro);
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const { company, companyId } = useCompany();
  const { user } = useAuth();
  const localDeviceId = useMemo(() => getOrCreateDeviceId(), []);
  const [settings, setSettings] = useState<AutoOcrSettings>(DEFAULT_SETTINGS);
  const [settingsLoadedFor, setSettingsLoadedFor] = useState("");
  const [adminDevices, setAdminDevices] = useState<AdminDevice[]>([]);
  const [adminDevicesLoading, setAdminDevicesLoading] = useState(false);
  const [deviceActionTarget, setDeviceActionTarget] = useState<AdminDevice | null>(null);
  const [deviceActionBusy, setDeviceActionBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fsId = useMemo(() => companyId ? resolveCompanyId(companyId, company) : "", [companyId, company]);
  const scheduleDateAD = useMemo(() => parseLocalDate(settings.scheduleDate), [settings.scheduleDate]);
  const scheduleDateLabel = scheduleDateAD
    ? dateSystem === "AD" ? formatDate(scheduleDateAD)
      : dateSystem === "Both" ? `${formatDateBS(scheduleDateAD)} (${formatDate(scheduleDateAD)})`
        : formatDateBS(scheduleDateAD)
    : "Pick a date";
  const aiEngineStatus = useOcrAiStatus(fsId || null, open && !!fsId).status;
  const visionEngineStatus = useOcrCloudStatus(fsId || null, open && !!fsId).status;
  const scanEngineAvailable = useMemo(() => {
    const aiReady = !!aiEngineStatus?.serverOcrEnabled && !!aiEngineStatus.companyEnabled &&
      (aiEngineStatus.isAdmin ? !!(aiEngineStatus.hasKey || aiEngineStatus.companyHasKey) : !!aiEngineStatus.canUse);
    const visionReady = (provider: "google" | "azure") => {
      if (!visionEngineStatus?.serverOcrEnabled || !visionEngineStatus.companyEnabled) return false;
      if (visionEngineStatus.isAdmin) {
        return visionEngineStatus.keys
          ? !!visionEngineStatus.keys[provider]
          : !!visionEngineStatus.hasKey && visionEngineStatus.provider === provider;
      }
      return !!visionEngineStatus.canUse && (visionEngineStatus.providers
        ? visionEngineStatus.providers.includes(provider)
        : visionEngineStatus.hasKey && visionEngineStatus.provider === provider);
    };
    return { gemini: aiReady, google: visionReady("google"), azure: visionReady("azure") };
  }, [aiEngineStatus, visionEngineStatus]);

  useEffect(() => {
    if (!fsId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const unsubscribe = onSnapshot(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), (snapshot) => {
      if (cancelled) return;
      setSettings(normalizeSettings(snapshot.exists() ? snapshot.data() : DEFAULT_SETTINGS));
      setSettingsLoadedFor(fsId);
      setLoading(false);
    }, (err) => {
      if (cancelled) return;
      setSettings(DEFAULT_SETTINGS);
      setSettingsLoadedFor(fsId);
      setError(err instanceof Error ? err.message : "Could not load settings.");
      setLoading(false);
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [fsId]);

  const isCompanyAdmin = useMemo(() => {
    const uid = String(user?.uid || "");
    if (!uid || !company) return false;
    if (String((company as any).ownerId || (company as any).owner || "") === uid) return true;
    const members = Array.isArray((company as any).sharedWith) ? (company as any).sharedWith : [];
    return members.some((member: any) => String(member?.uid || member?.userId || "") === uid && ["admin", "CompanyAdmin", "SuperAdmin"].includes(String(member?.role || "")));
  }, [company, user?.uid]);

  useEffect(() => {
    if (!fsId || !isCompanyAdmin) {
      setAdminDevices([]);
      setAdminDevicesLoading(false);
      return;
    }
    let cancelled = false;
    setAdminDevicesLoading(true);
    const refreshDevices = async () => {
      try {
        const rows = await pbListAppDocs(fsId, "devices");
        if (cancelled) return;
        const devices: AdminDevice[] = rows.map((row) => ({
          id: String(row.id || ""),
          userId: String(row.userId || ""),
          deviceLabel: typeof row.deviceLabel === "string" ? row.deviceLabel : undefined,
          deviceType: (row.deviceType === "mobile" || row.deviceType === "desktop" ? row.deviceType : undefined) as AdminDevice["deviceType"],
        })).filter((device) => !!device.id && !!device.userId);
        setAdminDevices(devices);
      } catch {
        if (!cancelled) setAdminDevices([]);
      } finally {
        if (!cancelled) setAdminDevicesLoading(false);
      }
    };
    void refreshDevices();
    const timer = window.setInterval(() => void refreshDevices(), 8000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [fsId, isCompanyAdmin]);

  const activeAdminIds = useMemo(() => {
    const ids = new Set<string>();
    const ownerId = String((company as any)?.ownerId || (company as any)?.owner || "");
    if (ownerId) ids.add(ownerId);
    const members = Array.isArray((company as any)?.sharedWith) ? (company as any).sharedWith : [];
    for (const member of members) {
      const role = String(member?.role || "");
      const id = String(member?.uid || member?.userId || "");
      if (id && ["admin", "CompanyAdmin", "SuperAdmin"].includes(role)) ids.add(id);
    }
    return ids;
  }, [company]);
  const selectableAdminDevices = useMemo(() => adminDevices.filter((device) => activeAdminIds.has(device.userId)), [activeAdminIds, adminDevices]);
  const localDeviceIsRegistered = selectableAdminDevices.some((device) => device.id === localDeviceId);
  const selectedDeviceId = settings.localRunnerDeviceId;
  const selectedAdminDevice = selectableAdminDevices.find((device) => device.id === selectedDeviceId);
  const localDeviceCopy = LOCAL_DEVICE_COPY[introLang];
  const isDeviceActionTargetThisDevice = deviceActionTarget?.id === localDeviceId;

  const handleRemoveAdminDevice = async () => {
    if (!fsId || !user?.uid || !deviceActionTarget || !isCompanyAdmin) return;
    const target = deviceActionTarget;
    setDeviceActionBusy(true);
    setError(null);
    try {
      if (settings.localRunnerDeviceId === target.id) {
        await setDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), {
          localRunnerUid: "",
          localRunnerDeviceId: "",
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        }, { merge: true });
      }
      if (target.id === localDeviceId) {
        await removeThisDevice(fsId);
      } else {
        await kickOutDevicesBatch(fsId, [{
          id: target.id,
          userId: target.userId,
          deviceType: target.deviceType,
          deviceLabel: target.deviceLabel,
        }]);
      }
      setAdminDevices((current) => current.filter((device) => device.id !== target.id));
      if (settings.localRunnerDeviceId === target.id) patch({ localRunnerUid: "", localRunnerDeviceId: "" });
      setDeviceActionTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this device.");
    } finally {
      setDeviceActionBusy(false);
    }
  };

  const patch = (next: Partial<AutoOcrSettings>) => setSettings((current) => ({ ...current, ...next }));

  const save = async () => {
    if (!fsId || !user?.uid || !isCompanyAdmin) return;
    if (settings.enabled && settings.runLocation === "local-pc" && !selectedAdminDevice) {
      setError(LOCAL_DEVICE_COPY[introLang].required);
      return;
    }
    if (settings.enabled && settings.runLocation === "local-pc" && !scanEngineAvailable[settings.scanEngine]) {
      setError("The selected scan engine has no configured key or access for this company.");
      return;
    }
    if (settings.enabled && settings.runOnSchedule && settings.scheduleMode === "date-time" && (!settings.scheduleDate || !settings.scheduleTime)) {
      setError("Choose both a date and time for the scheduled scan.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const settingsToSave = {
        ...settings,
        localRunnerUid: settings.runLocation === "local-pc" ? selectedAdminDevice!.userId : settings.localRunnerUid,
        localRunnerDeviceId: settings.runLocation === "local-pc" ? selectedAdminDevice!.id : settings.localRunnerDeviceId,
        scheduleMinutes: Math.max(1, Math.min(1440, Math.round(Number(settings.scheduleMinutes) || DEFAULT_SETTINGS.scheduleMinutes))),
        scheduleTimeZone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
        maxCallsPerMinute: Math.max(1, Math.min(15, Math.round(Number(settings.maxCallsPerMinute) || DEFAULT_SETTINGS.maxCallsPerMinute))),
        failOnMissingFields: true,
        checkDuplicateVouchers: settings.checkDuplicateVouchers,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        provider: SCAN_ENGINES[settings.scanEngine].provider,
        providerLabel: SCAN_ENGINES[settings.scanEngine].name,
        saveApproved: false,
      };
      await setDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), settingsToSave, { merge: true });
      setSettings(settingsToSave);
      setSettingsLoadedFor(fsId);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const selectedAutoMode: "manual" | "semi" | "full" = !settings.enabled
    ? "manual"
    : settings.processingMode === "full" ? "full" : "semi";
  const applyAutoMode = async (mode: "manual" | "semi" | "full") => {
    if (!fsId || !user?.uid || !isCompanyAdmin || saving || loading || mode === selectedAutoMode) return;
    const enabled = mode !== "manual";
    if (enabled && settings.runLocation === "local-pc" && !selectedAdminDevice) {
      setError(LOCAL_DEVICE_COPY[introLang].required);
      return;
    }
    if (enabled && settings.runLocation === "local-pc" && !scanEngineAvailable[settings.scanEngine]) {
      setError("The selected scan engine has no configured key or access for this company.");
      return;
    }
    if (enabled && settings.runOnSchedule && settings.scheduleMode === "date-time" && (!settings.scheduleDate || !settings.scheduleTime)) {
      setError("Choose both a date and time for the scheduled scan.");
      return;
    }
    // Mode selection only configures the runner. Keep it paused until Resume is pressed.
    window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-runner-hold", {
      detail: { companyId: fsId, held: true },
    }));
    setSaving(true);
    setError(null);
    const nextSettings = {
      ...settings,
      enabled,
      processingMode: mode === "full" ? "full" as const : "semi" as const,
      localRunnerUid: settings.runLocation === "local-pc" && enabled ? selectedAdminDevice!.userId : settings.localRunnerUid,
      localRunnerDeviceId: settings.runLocation === "local-pc" && enabled ? selectedAdminDevice!.id : settings.localRunnerDeviceId,
      scheduleTimeZone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
      failOnMissingFields: true,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      provider: SCAN_ENGINES[settings.scanEngine].provider,
      providerLabel: SCAN_ENGINES[settings.scanEngine].name,
      saveApproved: false,
    };
    try {
      await setDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), nextSettings, { merge: true });
      setSettings(nextSettings);
      setSettingsLoadedFor(fsId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply Auto post mode.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <GalleryLocalAutoPostRunner settings={settings} settingsDialogOpen={open} isCompanyAdmin={isCompanyAdmin} settingsReady={settingsLoadedFor === fsId && !!fsId} />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Auto post settings</DialogTitle>
          <DialogDescription>Choose where Auto post scans Unassigned documents and creates vouchers.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
        {!isCompanyAdmin ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Only a company owner or admin can change these settings.</div>
        ) : loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading settings…</div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-xl border bg-background/80 p-3 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium"><Bot className="h-4 w-4" />Enable Auto post vouchers</div>
                <div className="ml-6">
                  <AutoPostModeSwitch
                    mode={selectedAutoMode}
                    onModeChange={(mode) => void applyAutoMode(mode)}
                    disabled={!isCompanyAdmin || saving || loading || !fsId}
                  />
                </div>
              </div>
              <p className="mt-1 pl-8 text-xs text-muted-foreground">
                {selectedAutoMode === "manual"
                  ? "Manual mode: Auto post will not scan Unassigned documents."
                  : selectedAutoMode === "semi"
                    ? "Semi automatic opens each voucher for OCR; complete scans save automatically and issues stay open for review."
                    : "Full automatic scans in the background, saves vouchers that pass checks, and continues past failed files."}
              </p>
              <div className="ml-6 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5">
                <label className="mb-1.5 block text-xs font-semibold" htmlFor="auto-ocr-missing-field-action">{MISSING_FIELD_ACTION_COPY[introLang].label}</label>
                <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">{MISSING_FIELD_ACTION_COPY[introLang].description}</p>
                <Select
                  value={settings.missingFieldAction}
                  onValueChange={(missingFieldAction) => patch({ missingFieldAction: missingFieldAction as AutoOcrSettings["missingFieldAction"] })}
                  disabled={!isCompanyAdmin || loading || saving}
                >
                  <SelectTrigger id="auto-ocr-missing-field-action" className="h-auto min-h-9 whitespace-normal bg-white text-left text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pause-and-hold">{MISSING_FIELD_ACTION_COPY[introLang].pause}</SelectItem>
                    <SelectItem value="fail-and-continue">{MISSING_FIELD_ACTION_COPY[introLang].fail}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border bg-background/80 p-3 shadow-sm">
              <div className="text-sm font-semibold">Run Auto post on</div>
              <RadioGroup value={settings.runLocation} onValueChange={(runLocation) => {
                const nextLocation = runLocation as AutoOcrSettings["runLocation"];
                const currentDeviceRegistered = selectableAdminDevices.some((device) => device.id === localDeviceId);
                patch({
                  runLocation: nextLocation,
                  ...(nextLocation === "local-pc" && !settings.localRunnerDeviceId && currentDeviceRegistered ? { localRunnerDeviceId: localDeviceId } : {}),
                });
              }} disabled={!settings.enabled} className="grid gap-2 sm:grid-cols-2">
                <label htmlFor="auto-ocr-local-pc" className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm"><RadioGroupItem id="auto-ocr-local-pc" value="local-pc" /><Monitor className="h-4 w-4" /><span>Local PC</span></label>
                <label htmlFor="auto-ocr-server" className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm"><RadioGroupItem id="auto-ocr-server" value="server" /><Server className="h-4 w-4" /><span>Server</span></label>
              </RadioGroup>
              {settings.runLocation === "local-pc" ? (
                <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50 p-2.5 text-xs leading-relaxed text-sky-950">
                  <p>{LOCAL_INFO[introLang]}</p>
                  <label className="block space-y-1.5">
                    <span className="font-semibold">{localDeviceCopy.select}</span>
                    <Select
                      value={selectedDeviceId}
                      onValueChange={(localRunnerDeviceId) => patch({ localRunnerDeviceId })}
                      disabled={!settings.enabled || adminDevicesLoading || !selectableAdminDevices.length}
                    >
                      <SelectTrigger className="h-9 bg-white text-foreground"><SelectValue placeholder={adminDevicesLoading ? localDeviceCopy.loading : localDeviceCopy.select} /></SelectTrigger>
                      <SelectContent>
                        {selectableAdminDevices.map((device) => {
                          const deviceLabel = device.deviceLabel || device.deviceType || "Computer";
                          const adminLabel = device.userId === String((company as any)?.ownerId || (company as any)?.owner || "") ? localDeviceCopy.owner : localDeviceCopy.admin;
                          const thisDeviceLabel = device.id === localDeviceId ? ` · ${localDeviceCopy.thisDevice}` : "";
                          return <SelectItem key={device.id} value={device.id}>{deviceLabel} · {adminLabel} · {device.id.slice(-6)}{thisDeviceLabel}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                  </label>
                  {adminDevicesLoading ? <p>{localDeviceCopy.loading}</p> : !selectableAdminDevices.length ? <p>{localDeviceCopy.empty}</p> : null}
                  <p className="rounded border border-sky-200 bg-white/80 p-2">{localDeviceCopy.oneOnly}</p>
                  {selectedAdminDevice && selectedAdminDevice.id !== localDeviceId ? <p className="font-semibold">{localDeviceCopy.moved}</p> : null}
                  {selectableAdminDevices.length ? (
                    <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11px] font-semibold text-sky-950">
                      <span>{localDeviceCopy.devices}: {selectableAdminDevices.length}</span>
                      <span>{localDeviceCopy.selectedCount}: {selectedAdminDevice ? 1 : 0} / 1</span>
                    </div>
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-sky-200 bg-white/80 p-1.5">
                      {selectableAdminDevices.map((device) => {
                        const deviceLabel = device.deviceLabel || device.deviceType || "Computer";
                        const isThisDevice = device.id === localDeviceId;
                        const isSelectedRunner = device.id === settings.localRunnerDeviceId;
                        return (
                          <div key={device.id} className="flex min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-foreground hover:bg-sky-50">
                            <div className="min-w-0">
                              <div className="truncate font-medium" title={deviceLabel}>{deviceLabel} · {device.id.slice(-6)}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {device.userId === String((company as any)?.ownerId || (company as any)?.owner || "") ? localDeviceCopy.owner : localDeviceCopy.admin}
                                {isThisDevice ? <span className="ml-1 font-semibold text-emerald-700">· {localDeviceCopy.thisDevice}</span> : null}
                                {isSelectedRunner ? <span className="ml-1 font-semibold text-sky-700">· {localDeviceCopy.selected}</span> : null}
                              </div>
                            </div>
                            <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={deviceActionBusy} onClick={() => setDeviceActionTarget(device)}>
                              <Trash2 className="mr-1 h-3.5 w-3.5" />{isThisDevice ? localDeviceCopy.remove : localDeviceCopy.kick}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    </div>
                  ) : null}
                </div>
              ) : <div className="rounded-md border bg-muted/50 p-2.5 text-xs text-muted-foreground">Server mode needs the Pocket Ledger Server Auto OCR worker enabled; the app does not run scans on this PC in this mode.</div>}
            </section>

            <section className="space-y-3 rounded-xl border bg-background/80 p-3 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4" />When to scan</div>
              <SettingToggle title="As soon as a file arrives" checked={settings.runOnUpload} onChange={(runOnUpload) => patch({ runOnUpload })} disabled={!settings.enabled} />
              <SettingToggle title="Scan on a schedule" checked={settings.runOnSchedule} onChange={(runOnSchedule) => patch({ runOnSchedule })} disabled={!settings.enabled} />
              {settings.runOnSchedule && <div className="space-y-3 rounded-lg border bg-background/80 p-3 shadow-sm">
                <div className="text-xs font-medium">Schedule type</div>
                <RadioGroup
                  value={settings.scheduleMode}
                  onValueChange={(scheduleMode) => patch({ scheduleMode: scheduleMode as AutoOcrSettings["scheduleMode"] })}
                  disabled={!settings.enabled}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <label htmlFor="auto-ocr-schedule-interval" className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm">
                    <RadioGroupItem id="auto-ocr-schedule-interval" value="interval" />
                    <span>Every interval</span>
                  </label>
                  <label htmlFor="auto-ocr-schedule-date-time" className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm">
                    <RadioGroupItem id="auto-ocr-schedule-date-time" value="date-time" />
                    <span>At a date and time (one time)</span>
                  </label>
                </RadioGroup>
                {settings.scheduleMode === "interval" ? (
                  <NumberSetting label="Run every (minutes)" value={settings.scheduleMinutes} min={1} max={1440} onChange={(scheduleMinutes) => patch({ scheduleMinutes })} disabled={!settings.enabled} />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span className="text-xs text-muted-foreground">Date</span>
                      <BsDatePicker
                        isRange={false}
                        valueAD={scheduleDateAD}
                        onChangeAD={(date) => patch({ scheduleDate: formatLocalDate(date) })}
                        disabled={!settings.enabled}
                        showDateConverterButton={false}
                        className="!h-9 !min-h-9 w-full"
                      >
                        {scheduleDateLabel}
                      </BsDatePicker>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-xs text-muted-foreground">Time</span>
                      <Input type="time" value={settings.scheduleTime} disabled={!settings.enabled} onChange={(event) => patch({ scheduleTime: event.target.value })} />
                    </label>
                  </div>
                )}
              </div>}
            </section>

            <section className="space-y-3 rounded-xl border border-indigo-300 bg-gradient-to-br from-indigo-100 via-sky-50 to-violet-100 p-3 shadow-[0_5px_14px_rgba(49,46,129,0.18)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_10px_22px_rgba(49,46,129,0.24)]">
              <div className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4" />Usage and voucher saving</div>
              <div className="rounded-lg border border-indigo-200 bg-white/90 p-2.5 shadow-[0_2px_6px_rgba(30,41,59,0.12)]">
                <div className="mb-2 text-xs font-medium text-foreground">Scan Engine</div>
                <Select value={settings.scanEngine} onValueChange={(scanEngine) => {
                  const selected = scanEngine as AutoOcrSettings["scanEngine"];
                  if (scanEngineAvailable[selected]) patch({ scanEngine: selected });
                }} disabled={!settings.enabled}>
                  <SelectTrigger className="h-9 bg-white"><SelectValue placeholder="Choose an engine" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCAN_ENGINES).map(([value, engine]) => {
                      const key = value as AutoOcrSettings["scanEngine"];
                      const available = scanEngineAvailable[key];
                      return <SelectItem key={value} value={value} disabled={!available} title={available ? engine.name : `${engine.name} key or company access is not configured`}>
                        <span>{engine.name}</span>
                        {!available && <span className="ml-2 text-[10px] text-muted-foreground">Not configured</span>}
                      </SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-indigo-200 bg-white/90 p-2.5 shadow-[0_2px_6px_rgba(30,41,59,0.12)]">
                <NumberSetting label={`Maximum ${SCAN_ENGINES[settings.scanEngine].name} calls per minute`} value={settings.maxCallsPerMinute} min={1} max={15} onChange={(maxCallsPerMinute) => patch({ maxCallsPerMinute })} disabled={!settings.enabled} />
                <p className="mt-2 text-xs text-muted-foreground">{settings.runLocation === "local-pc"
                  ? "The selected PC runs the scan using this company’s configured engine key. Server and provider safety limits may still apply."
                  : "Limit applies to this company. The server’s engine safety limit may be lower."}</p>
              </div>
              <p className="rounded-lg border border-indigo-200 bg-white/80 p-2.5 text-xs text-muted-foreground shadow-[0_2px_6px_rgba(30,41,59,0.1)]">Automatically created vouchers remain unapproved. Use the required-information rule in the Auto post mode card above to handle incomplete scans.</p>
            </section>

            <section className="rounded-xl border border-rose-300 bg-gradient-to-br from-rose-100 via-pink-50 to-orange-100 p-3 shadow-[0_5px_14px_rgba(159,18,57,0.17)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_10px_22px_rgba(159,18,57,0.23)]">
              <div className="rounded-lg border border-rose-200 bg-white/90 p-2.5 shadow-[0_2px_6px_rgba(30,41,59,0.12)]">
                <SettingToggle
                  title={DUPLICATE_COPY[introLang].title}
                  checked={settings.checkDuplicateVouchers}
                  onChange={(checkDuplicateVouchers) => patch({ checkDuplicateVouchers })}
                  disabled={!settings.enabled}
                />
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{DUPLICATE_COPY[introLang].description}</p>
                <div className="mt-3 space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="auto-ocr-duplicate-action">{DUPLICATE_COPY[introLang].actionLabel}</label>
                  <Select
                    value={settings.duplicateVoucherAction}
                    onValueChange={(action) => patch({ duplicateVoucherAction: action as AutoOcrSettings["duplicateVoucherAction"] })}
                    disabled={!settings.enabled || !settings.checkDuplicateVouchers}
                  >
                    <SelectTrigger id="auto-ocr-duplicate-action" className="h-9 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="move-to-duplicates">{DUPLICATE_COPY[introLang].move}</SelectItem>
                      <SelectItem value="pause-for-review">{DUPLICATE_COPY[introLang].pause}</SelectItem>
                      <SelectItem value="save-anyway">{DUPLICATE_COPY[introLang].save}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <div className="flex items-start gap-2 rounded-lg border bg-muted/60 p-3 text-xs text-muted-foreground shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Files must be uploaded to the Pocket Ledger Server so the selected runner can access them.</div>
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="shrink-0 border-t bg-background pt-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {isCompanyAdmin && <Button type="button" onClick={() => void save()} disabled={loading || saving || !fsId}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!deviceActionTarget} onOpenChange={(nextOpen) => { if (!nextOpen && !deviceActionBusy) setDeviceActionTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{localDeviceCopy.confirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{deviceActionTarget?.deviceLabel || deviceActionTarget?.deviceType || "Device"} · {deviceActionTarget?.id.slice(-6)}</span>{" "}
            {isDeviceActionTargetThisDevice ? localDeviceCopy.confirmSelf : localDeviceCopy.confirmOther}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deviceActionBusy}>{localDeviceCopy.cancel}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deviceActionBusy}
            onClick={(event) => { event.preventDefault(); void handleRemoveAdminDevice(); }}
          >
            {deviceActionBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {deviceActionBusy ? localDeviceCopy.removing : isDeviceActionTargetThisDevice ? localDeviceCopy.remove : localDeviceCopy.kick}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function SettingToggle({ icon, title, checked, onChange, disabled = false }: { icon?: ReactNode; title: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 ${disabled ? "opacity-60" : ""}`}>
    <span className="flex items-center gap-2 text-sm">{icon}{title}</span>
    <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
  </div>;
}

function NumberSetting({ label, value, min, max, onChange, disabled = false }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <label className={`flex items-center justify-between gap-3 text-sm ${disabled ? "opacity-60" : ""}`}>
    <span>{label}</span>
    <Input className="h-9 w-24" type="number" min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}
