"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, Bot, ChevronRight, Clock3, Copy, Gauge, Info, KeyRound, ListChecks, Loader2, Monitor, PanelLeftClose, PanelLeftOpen, ScanText, Server, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import { OCR_SETTINGS_DIALOG_CONTENT_CN, OCR_SETTINGS_DIALOG_OVERLAY_CN } from "@/lib/dialogShellChrome";
import { useAuth } from "@/hooks/useAuth";
import { doc, onSnapshot, serverTimestamp } from "@/lib/pbCompat/firestore";
import { setDoc } from "@/lib/writeGateway/pbWrites";
import { kickOutDevicesBatch, removeThisDevice } from "@/lib/deviceLimitClient";
import { firestore } from "@/lib/plClientSession";
import { useOcrAiStatus } from "@/modules/ocr/ai/aiClient";
import { useOcrCloudStatus } from "@/modules/ocr/cloud/ocrCloudClient";
import { getOrCreateDeviceId } from "@/lib/writeGateway/legacy/deviceLimitClient";
import { GalleryLocalAutoPostRunner } from "@/components/gallery/GalleryLocalAutoPostRunner";
import { VoucherOcrBankAliasesPanel, VoucherOcrKeySettingsPanel, VoucherOcrSettingsPanel } from "@/modules/ocr/VoucherOcrHeaderToggles";
import { OcrEngineUsage } from "@/modules/ocr/OcrEngineUsage";
import { pbListAppDocs } from "@/lib/pocketbaseData/pbSync";
import { DEFAULT_GALLERY_QUEUE_SEQUENCE, DEFAULT_GALLERY_SORT_ORDER, normalizeGalleryQueueSequence, normalizeGallerySortOrder, type GalleryQueueSequence, type GallerySortOrder } from "@/components/gallery/galleryQueueSequence";
import { SCAN_RUN_LIMIT_DEFAULT, scanRunLimitValue } from "@/components/gallery/scanRunLimit";
import { exclusiveScanTriggers, isManualStartTrigger, normalizeDefaultDueDayValue, normalizeExclusiveTriggers, normalizeRunLocation } from "@/components/gallery/autoPostRunPolicy";
import { activeRunnerFromSettings, buildRunnerSettingsSave, copyRunnerProfileFields, enforceProfileRules, pickProfileRules, withExclusiveRunnerProfiles } from "@/components/gallery/autoPostMode";
import { setOcrPrefs, type OcrPrefs } from "@/modules/ocr/prefs";
import { AUTO_POST_UI, useAutoPostUiCopy } from "@/components/gallery/autoPostUiCopy";
import { setOcrDefaultDueDays } from "@/modules/ocr/dueDate";

const SETTINGS_DOC_ID = "server_auto_ocr";

type AutoOcrSettings = {
  enabled: boolean;
  manualScan: boolean;
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
  /** "all" = no cap (current behaviour). A number 1–500 caps each scan run. */
  maxVouchersPerRun: number | "all";
  autoSaveEnabled: boolean;
  overwriteEdited: boolean;
  autoSaveSeconds: number;
  scanEngine: "gemini" | "google" | "azure" | "auto";
  maxCallsPerMinute: number;
  failOnMissingFields: boolean;
  missingFieldAction: "fail-and-continue" | "pause-and-hold";
  missingFieldRules: {
    debitMaster: "fail-and-continue" | "pause-and-hold";
    creditMaster: "fail-and-continue" | "pause-and-hold";
    item: "fail-and-continue" | "pause-and-hold" | "save-without";
    date: "fail-and-continue" | "pause-and-hold";
    tax: "fail-and-continue" | "pause-and-hold";
    other: "fail-and-continue" | "pause-and-hold";
  };
  itemRowMismatchAction: "fail-and-continue" | "pause-and-hold";
  amountMismatchAction: "fail-and-continue" | "pause-and-hold";
  queueSequence: GalleryQueueSequence;
  gallerySortOrder: GallerySortOrder;
  checkDuplicateVouchers: boolean;
  duplicateVoucherAction: "move-to-duplicates" | "save-anyway" | "pause-for-review";
  /** Blank (null) means leave Due Date empty. Clamped 0–365. */
  defaultDueDaysSale: number | null;
  defaultDueDaysPurchase: number | null;
};

const DEFAULT_MISSING_RULES: AutoOcrSettings["missingFieldRules"] = {
  debitMaster: "pause-and-hold",
  creditMaster: "pause-and-hold",
  item: "save-without",
  date: "pause-and-hold",
  tax: "pause-and-hold",
  other: "pause-and-hold",
};

const DEFAULT_SETTINGS: AutoOcrSettings = {
  enabled: false,
  manualScan: false,
  processingMode: "semi",
  runLocation: "local-pc",
  localRunnerUid: "",
  localRunnerDeviceId: "",
  runOnUpload: true,
  runOnSchedule: false,
  scheduleMode: "interval",
  scheduleMinutes: 5,
  scheduleDate: "",
  scheduleTime: "",
  maxVouchersPerRun: "all",
  autoSaveEnabled: true,
  overwriteEdited: false,
  autoSaveSeconds: 10,
  scanEngine: "gemini",
  maxCallsPerMinute: 5,
  failOnMissingFields: true,
  missingFieldAction: "pause-and-hold",
  missingFieldRules: DEFAULT_MISSING_RULES,
  itemRowMismatchAction: "pause-and-hold",
  amountMismatchAction: "pause-and-hold",
  queueSequence: DEFAULT_GALLERY_QUEUE_SEQUENCE,
  gallerySortOrder: DEFAULT_GALLERY_SORT_ORDER,
  checkDuplicateVouchers: true,
  duplicateVoucherAction: "save-anyway",
  defaultDueDaysSale: null,
  defaultDueDaysPurchase: null,
};

type RunnerMode = "full" | "semi" | "manual";
type SettingsSection = RunnerMode | "runner-select" | "rules" | "voucher-settings" | "keys";
type RunnerProfiles = Record<RunnerMode, AutoOcrSettings>;
const isRunnerMode = (section: SettingsSection): section is RunnerMode => section === "full" || section === "semi" || section === "manual";
const DEFAULT_PROFILES: RunnerProfiles = {
  full: { ...DEFAULT_SETTINGS, enabled: false, processingMode: "full", autoSaveEnabled: true },
  semi: { ...DEFAULT_SETTINGS, enabled: false, processingMode: "semi", autoSaveEnabled: true },
  manual: { ...DEFAULT_SETTINGS, enabled: false, manualScan: true, processingMode: "semi", runLocation: "local-pc", autoSaveEnabled: false },
};

const LOCAL_INFO = {
  en: "Local PC processes documents on the selected computer. The app and internet connection must remain available; while the computer is offline, Auto post pauses and documents remain pending. Only a registered device belonging to an active company admin is eligible.",
  hi: "Local PC चुने गए कंप्यूटर पर documents process करता है। App और internet चालू रहना चाहिए; कंप्यूटर offline होने पर Auto post रुक जाता है और documents pending रहते हैं। यह सुविधा केवल active company admin के registered device पर चल सकती है।",
  ne: "Local PC ले छानिएको कम्प्युटरमा documents प्रक्रिया गर्छ। App र internet उपलब्ध हुनुपर्छ; कम्प्युटर offline हुँदा Auto post रोकिन्छ र documents pending रहन्छन्। Active company admin को registered device मा मात्र यो सेवा चल्न सक्छ।",
} as const;

const SCAN_ENGINES = {
  gemini: { name: "Gemini AI", provider: "gemini" },
  google: { name: "Google OCR", provider: "google" },
  azure: { name: "Azure OCR", provider: "azure" },
  auto: { name: "Auto OCR", provider: "auto" },
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

const MISSING_RULE_LABELS = {
  en: { help: "Choose separate rules for debit-side and credit-side masters (party, bank/cash, staff, ledger/account). If no item matches, the voucher can save without that item when the other fields are complete.", debitMaster: "Debit-side master (party / bank / staff / account)", creditMaster: "Credit-side master (party / bank / staff / account)", item: "Item master", rowMismatch: "If bill row count and voucher row count do not match", amountMismatch: "If bill amount and item-row total do not match", date: "Date", tax: "Tax / VAT / TDS", other: "Other required fields", pause: "Pause and review", fail: "Move to Auto post failed and continue", saveWithout: "Save without the item" },
  hi: { help: "Debit और Credit side के masters (party, bank/cash, staff, ledger/account) के लिए अलग नियम चुनें। Item master न मिले तो बाकी fields पूरी होने पर item के बिना save किया जा सकता है।", debitMaster: "Debit-side master (party / bank / staff / account)", creditMaster: "Credit-side master (party / bank / staff / account)", item: "Item master", rowMismatch: "Bill और voucher की item row count match न हो", amountMismatch: "Bill amount और item rows का total match न हो", date: "Date", tax: "Tax / VAT / TDS", other: "अन्य ज़रूरी जानकारी", pause: "रोकें और review करें", fail: "Auto post failed में भेजें और आगे बढ़ें", saveWithout: "Item के बिना save करें" },
  ne: { help: "Debit र Credit side का master (party, bank/cash, staff, ledger/account) का लागि छुट्टाछुट्टै नियम छान्नुहोस्। Item master भेटिएन भने अरू fields पूरा भएको अवस्थामा item बिना voucher save गर्न सकिन्छ।", debitMaster: "Debit-side master (party / bank / staff / account)", creditMaster: "Credit-side master (party / bank / staff / account)", item: "Item master", rowMismatch: "Bill र voucher को item row count नमिलेमा", amountMismatch: "Bill amount र item rows को total नमिलेमा", date: "Date", tax: "Tax / VAT / TDS", other: "अन्य आवश्यक विवरण", pause: "रोक्नुहोस् र review गर्नुहोस्", fail: "Auto post failed मा पठाएर अगाडि बढ्नुहोस्", saveWithout: "Item बिना save गर्नुहोस्" },
} as const;

const FULL_AUTO_RULE_NOTE = {
  en: "Full Auto Post never pauses: missing information always moves the document to Auto post failed (an unmatched item may still be saved without the item).",
  hi: "Full Auto Post कभी नहीं रुकता: ज़रूरी जानकारी न मिले तो document हमेशा Auto post failed में जाता है (item न मिले तो item के बिना save हो सकता है)।",
  ne: "Full Auto Post कहिल्यै रोकिँदैन: आवश्यक विवरण नभेटिए document सधैं Auto post failed मा जान्छ (item नभेटिए item बिना save हुन सक्छ)।",
} as const;

const FULL_AUTO_SAVE_NOTE = {
  en: "Full Auto Post saves directly (unapproved) without opening the voucher window or a countdown.",
  hi: "Full Auto Post voucher window या countdown खोले बिना सीधे save (unapproved) करता है।",
  ne: "Full Auto Post ले voucher window वा countdown नखोली सिधै save (unapproved) गर्छ।",
} as const;

const COMMON_SETTING_NOTE = {
  en: "Duplicate check, default due days and bank-name matching are shared by Full Auto Post, Semi Automatic and Manual Runner. Missing-information rules are set inside each runner.",
  hi: "Duplicate जाँच, default due days और bank-name matching तीनों runner (Full Auto Post, Semi Automatic, Manual Runner) में common हैं। ज़रूरी जानकारी न मिलने के नियम हर runner में अलग से set होते हैं।",
  ne: "Duplicate जाँच, default due days र bank-name matching तीनै runner (Full Auto Post, Semi Automatic, Manual Runner) मा साझा छन्। आवश्यक विवरण नभेटिँदाका नियम हरेक runner भित्र छुट्टै set हुन्छन्।",
} as const;

const DUPLICATE_COPY = {
  en: {
    title: "Check for duplicate vouchers",
    description: "Before creating a voucher, compare its transaction reference, date, amount, and party or account with existing vouchers. Choose what should happen when a possible duplicate is found.",
    actionLabel: "When a duplicate is found",
    move: "Move to Duplicate",
    pause: "Pause and open for review",
    save: "Save anyway",
  },
  hi: {
    title: "Duplicate voucher की जाँच करें",
    description: "Voucher बनाने से पहले transaction reference, date, amount और party या account का मौजूदा vouchers से मिलान करें। संभावित duplicate मिलने पर आगे क्या करना है, चुनें।",
    actionLabel: "Duplicate मिलने पर",
    move: "Duplicate में भेजें",
    pause: "रोकें और review के लिए खोलें",
    save: "फिर भी save करें",
  },
  ne: {
    title: "Duplicate voucher जाँच गर्नुहोस्",
    description: "Voucher बनाउनुअघि transaction reference, date, amount र party वा account लाई पहिलेका vouchers सँग मिलाउनुहोस्। सम्भावित duplicate भेटिएपछि के गर्ने हो छान्नुहोस्।",
    actionLabel: "Duplicate भेटिएमा",
    move: "Duplicate मा पठाउनुहोस्",
    pause: "रोक्नुहोस् र review का लागि खोल्नुहोस्",
    save: "तैपनि save गर्नुहोस्",
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
    manualScan: value.manualScan === true,
    processingMode: value.processingMode === "full" ? "full" : "semi",
    runLocation: normalizeRunLocation(value.runLocation),
    localRunnerUid: typeof value.localRunnerUid === "string" ? value.localRunnerUid : "",
    localRunnerDeviceId: typeof value.localRunnerDeviceId === "string" ? value.localRunnerDeviceId : "",
    ...normalizeExclusiveTriggers(value.runOnUpload !== false, value.runOnSchedule === true),
    scheduleMode: value.scheduleMode === "date-time" ? "date-time" : "interval",
    scheduleMinutes: bounded(value.scheduleMinutes, DEFAULT_SETTINGS.scheduleMinutes, 1, 1440),
    scheduleDate: typeof value.scheduleDate === "string" ? value.scheduleDate : "",
    scheduleTime: typeof value.scheduleTime === "string" ? value.scheduleTime : "",
    maxVouchersPerRun: scanRunLimitValue(value.maxVouchersPerRun),
    autoSaveEnabled: typeof value.autoSaveEnabled === "boolean" ? value.autoSaveEnabled : DEFAULT_SETTINGS.autoSaveEnabled,
    overwriteEdited: value.overwriteEdited === true,
    autoSaveSeconds: bounded(value.autoSaveSeconds, DEFAULT_SETTINGS.autoSaveSeconds, 1, 60),
    scanEngine: value.scanEngine === "google" || value.scanEngine === "azure" || value.scanEngine === "auto" ? value.scanEngine : "gemini",
    maxCallsPerMinute: bounded(value.maxCallsPerMinute, DEFAULT_SETTINGS.maxCallsPerMinute, 1, 15),
    failOnMissingFields: true,
    missingFieldAction: value.missingFieldAction === "fail-and-continue" ? "fail-and-continue" : "pause-and-hold",
    missingFieldRules: (() => {
      const rawRules = value.missingFieldRules && typeof value.missingFieldRules === "object" ? value.missingFieldRules as Record<string, unknown> : {};
      const action = (key: string, fallback: string): string => rawRules[key] === "fail-and-continue" || rawRules[key] === "pause-and-hold" || (key === "item" && rawRules[key] === "save-without") ? String(rawRules[key]) : fallback;
      return {
        debitMaster: action("debitMaster", action("party", value.missingFieldAction === "fail-and-continue" ? "fail-and-continue" : "pause-and-hold")) as AutoOcrSettings["missingFieldRules"]["debitMaster"],
        creditMaster: action("creditMaster", action("party", value.missingFieldAction === "fail-and-continue" ? "fail-and-continue" : "pause-and-hold")) as AutoOcrSettings["missingFieldRules"]["creditMaster"],
        item: action("item", "save-without") as AutoOcrSettings["missingFieldRules"]["item"],
        date: action("date", value.missingFieldAction === "fail-and-continue" ? "fail-and-continue" : "pause-and-hold") as AutoOcrSettings["missingFieldRules"]["date"],
        tax: action("tax", value.missingFieldAction === "fail-and-continue" ? "fail-and-continue" : "pause-and-hold") as AutoOcrSettings["missingFieldRules"]["tax"],
        other: action("other", value.missingFieldAction === "fail-and-continue" ? "fail-and-continue" : "pause-and-hold") as AutoOcrSettings["missingFieldRules"]["other"],
      };
    })(),
    itemRowMismatchAction: value.itemRowMismatchAction === "fail-and-continue" ? "fail-and-continue" : "pause-and-hold",
    amountMismatchAction: value.amountMismatchAction === "fail-and-continue" ? "fail-and-continue" : "pause-and-hold",
    queueSequence: normalizeGalleryQueueSequence(value.queueSequence),
    gallerySortOrder: normalizeGallerySortOrder(value.gallerySortOrder),
    checkDuplicateVouchers: value.checkDuplicateVouchers !== false,
    duplicateVoucherAction: value.duplicateVoucherAction === "pause-for-review" ? "pause-for-review" : value.duplicateVoucherAction === "fail-and-continue" || value.duplicateVoucherAction === "move-to-duplicates" ? "move-to-duplicates" : "save-anyway",
    defaultDueDaysSale: normalizeDefaultDueDayValue(value.defaultDueDaysSale),
    defaultDueDaysPurchase: normalizeDefaultDueDayValue(value.defaultDueDaysPurchase),
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

export function GalleryAutoOcrSettingsDialog({ open, onOpenChange, showRunner = true, initialSection }: { open: boolean; onOpenChange: (open: boolean) => void; showRunner?: boolean; initialSection?: RunnerMode }) {
  const i18n = usePlI18nOptional();
  const introLang = introTabLang(i18n?.intro);
  useAutoPostUiCopy();
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const { company, companyId } = useCompany();
  const { user } = useAuth();
  const localDeviceId = useMemo(() => getOrCreateDeviceId(), []);
  const [runnerSettings, setRunnerSettings] = useState<AutoOcrSettings>(DEFAULT_SETTINGS);
  const [profiles, setProfiles] = useState<RunnerProfiles>(DEFAULT_PROFILES);
  const [savedProfiles, setSavedProfiles] = useState<RunnerProfiles>(DEFAULT_PROFILES);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("full");
  const [activeRunnerMode, setActiveRunnerMode] = useState<RunnerMode>("full");
  const [savedRunnerMode, setSavedRunnerMode] = useState<RunnerMode>("full");
  /* Decision 1 (2026-11-18): the tab being viewed never becomes the active runner. `activeRunnerMode` is the
   * Select Runner draft (saved on Save / Apply); `settings` is the profile shown on screen. */
  const viewMode: RunnerMode = isRunnerMode(settingsSection) ? settingsSection : activeRunnerMode;
  const settings = profiles[viewMode];
  /** Decision 10: Full Auto Post never pauses for review and has no voucher window / countdown. */
  const fullAutoRules = viewMode === "full" && isRunnerMode(settingsSection);
  /* Decision 8: the embedded Voucher OCR panel is a draft too (device prefs written on Save / Apply). */
  const [ocrPrefsDraft, setOcrPrefsDraft] = useState<Partial<OcrPrefs>>({});
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [commonSettingExpanded, setCommonSettingExpanded] = useState(false);
  const [settingsLoadedFor, setSettingsLoadedFor] = useState("");
  const settingsInitRef = useRef("");
  const openRef = useRef(open);
  openRef.current = open;
  const settingsScrollRef = useRef<HTMLDivElement | null>(null);
  const [adminDevices, setAdminDevices] = useState<AdminDevice[]>([]);
  const [adminDevicesLoading, setAdminDevicesLoading] = useState(false);
  const [deviceActionTarget, setDeviceActionTarget] = useState<AdminDevice | null>(null);
  const [deviceActionBusy, setDeviceActionBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savePrompt, setSavePrompt] = useState<null | "continue-stop" | "start-now">(null);
  const priorRunActiveRef = useRef(false);
  const lastProcessStateRef = useRef<{ held: boolean; enabled: boolean; active: boolean; schedule: boolean }>({ held: true, enabled: false, active: false, schedule: false });
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const fsId = useMemo(() => companyId ? resolveCompanyId(companyId, company) : "", [companyId, company]);

  useEffect(() => {
    if (!open || !initialSection || settingsLoadedFor !== fsId) return;
    // Only show that tab; the active runner stays as saved.
    setSettingsSection(initialSection);
  }, [open, initialSection, settingsLoadedFor, fsId]);
  useEffect(() => {
    if (open) setOcrPrefsDraft({});
  }, [open]);
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
    const google = visionReady("google");
    const azure = visionReady("azure");
    // Decision 6: Auto only picks an engine that has a saved key; with no key at all it is unavailable.
    return { gemini: aiReady, google, azure, auto: aiReady || google || azure };
  }, [aiEngineStatus, visionEngineStatus]);

  useEffect(() => {
    if (!fsId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const unsubscribe = onSnapshot(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), (snapshot) => {
      if (cancelled) return;
      const isInitialSnapshot = settingsInitRef.current !== fsId;
      if (isInitialSnapshot) settingsInitRef.current = fsId;
      const raw = snapshot.exists() ? snapshot.data() as Record<string, unknown> : {};
      const legacy = normalizeSettings(raw);
      const savedProfiles = raw.runnerProfiles && typeof raw.runnerProfiles === "object" ? raw.runnerProfiles as Record<string, unknown> : {};
      const nextProfiles: RunnerProfiles = {
        full: normalizeSettings(savedProfiles.full || { ...legacy, processingMode: "full" }),
        semi: normalizeSettings(savedProfiles.semi || { ...legacy, processingMode: "semi" }),
        manual: normalizeSettings(savedProfiles.manual || { ...legacy, enabled: false, manualScan: true, processingMode: "semi" }),
      };
      nextProfiles.full = { ...nextProfiles.full, manualScan: false };
      nextProfiles.semi = { ...nextProfiles.semi, manualScan: false, runLocation: "local-pc" };
      const manualProfileData = savedProfiles.manual && typeof savedProfiles.manual === "object" ? savedProfiles.manual as Record<string, unknown> : {};
      nextProfiles.manual = {
        ...nextProfiles.manual,
        enabled: false,
        runLocation: "local-pc",
        autoSaveEnabled: typeof manualProfileData.autoSaveEnabled === "boolean" ? manualProfileData.autoSaveEnabled : false,
        manualScan: typeof manualProfileData.manualScan === "boolean" ? manualProfileData.manualScan : true,
      };
      // Missing-info rules are per profile (2026-11-18). A profile saved before that keeps the old Common
      // values as its own defaults. Duplicate check and default due days stay common (top level wins).
      for (const mode of ["full", "semi", "manual"] as const) {
        const rules = pickProfileRules(savedProfiles[mode], nextProfiles[mode], legacy);
        nextProfiles[mode] = enforceProfileRules(mode, { ...nextProfiles[mode], ...rules as Pick<AutoOcrSettings, "missingFieldRules" | "itemRowMismatchAction" | "amountMismatchAction">, checkDuplicateVouchers: legacy.checkDuplicateVouchers, duplicateVoucherAction: legacy.duplicateVoucherAction, defaultDueDaysSale: legacy.defaultDueDaysSale, defaultDueDaysPurchase: legacy.defaultDueDaysPurchase });
      }
      const activeMode: RunnerMode = activeRunnerFromSettings(raw);
      setSavedProfiles(nextProfiles);
      setSavedRunnerMode(activeMode);
      // While the dialog is open, keep the user's unsaved drafts (Select Runner, profile edits).
      if (isInitialSnapshot || !openRef.current) {
        setProfiles(nextProfiles);
        setActiveRunnerMode(activeMode);
        if (isInitialSnapshot) setSettingsSection(activeMode);
      }
      setRunnerSettings(nextProfiles[activeMode]);
      setSettingsLoadedFor(fsId);
      setOcrDefaultDueDays(fsId, { sale: nextProfiles[activeMode].defaultDueDaysSale, purchase: nextProfiles[activeMode].defaultDueDaysPurchase });
      setLoading(false);
    }, (err) => {
      if (cancelled) return;
      setRunnerSettings(DEFAULT_SETTINGS);
      setProfiles(DEFAULT_PROFILES);
      setSavedProfiles(DEFAULT_PROFILES);
      setSettingsSection("full");
      setActiveRunnerMode("full");
      setSavedRunnerMode("full");
      setSettingsLoadedFor(fsId);
      setError(err instanceof Error ? err.message : "Could not load settings.");
      setLoading(false);
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [fsId]);


  useEffect(() => {
    if (!fsId) return;
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; held?: boolean; enabled?: boolean; active?: boolean }>).detail;
      if (String(detail?.companyId || "") !== fsId) return;
      lastProcessStateRef.current = {
        held: detail.held === true,
        enabled: detail.enabled === true,
        active: detail.active === true,
        schedule: runnerSettings.runOnSchedule,
      };
    };
    window.addEventListener("pl:gallery:auto-post-process-state", onState);
    window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-process-state-request", { detail: { companyId: fsId } }));
    return () => window.removeEventListener("pl:gallery:auto-post-process-state", onState);
  }, [fsId, runnerSettings.runOnSchedule]);

  useEffect(() => {
    if (!open) return;
    const state = lastProcessStateRef.current;
    priorRunActiveRef.current = (!state.held && state.enabled) || state.schedule || state.active || runnerSettings.runOnSchedule;
  }, [open, runnerSettings.runOnSchedule]);

  useEffect(() => {
    if (!fsId) return;
    const onDisableSchedule = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail;
      if (String(detail?.companyId || "") !== fsId) return;
      const current = profilesRef.current;
      const nextProfiles: RunnerProfiles = {
        full: { ...current.full, runOnSchedule: false },
        semi: { ...current.semi, runOnSchedule: false },
        manual: { ...current.manual, runOnSchedule: false },
      };
      setProfiles(nextProfiles);
      setSavedProfiles(nextProfiles);
      setRunnerSettings((s) => ({ ...s, runOnSchedule: false }));
      void setDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), {
        runOnSchedule: false,
        runnerProfiles: nextProfiles,
        updatedAt: serverTimestamp(),
      }, { merge: true }).then(() => {
        window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-schedule-disabled", { detail: { companyId: fsId, ok: true } }));
      }).catch((err) => {
        console.warn("[GalleryAutoOcrSettings] could not turn off schedule", err);
        window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-schedule-disabled", { detail: { companyId: fsId, ok: false } }));
      });
    };
    window.addEventListener("pl:gallery:auto-post-disable-schedule", onDisableSchedule);
    return () => window.removeEventListener("pl:gallery:auto-post-disable-schedule", onDisableSchedule);
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
  const manualProfileReadOnly = settingsSection === "manual";

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
      setProfiles((items) => {
        const next = { ...items };
        for (const mode of ["full", "semi", "manual"] as const) {
          if (next[mode].localRunnerDeviceId === target.id) next[mode] = { ...next[mode], localRunnerUid: "", localRunnerDeviceId: "" };
        }
        return next;
      });
      setDeviceActionTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this device.");
    } finally {
      setDeviceActionBusy(false);
    }
  };

  const patch = (next: Partial<AutoOcrSettings> & { runOnManualStart?: boolean }) => {
    const { runOnManualStart: _runOnManualStart, ...settingsPatch } = next;
    const updated = { ...settings, ...settingsPatch };
    if ("runOnUpload" in next || "runOnSchedule" in next || "runOnManualStart" in next) {
      const exclusive = exclusiveScanTriggers(next, settings);
      updated.runOnUpload = exclusive.runOnUpload;
      updated.runOnSchedule = exclusive.runOnSchedule;
    }
    if (viewMode === "full" || viewMode === "semi") updated.manualScan = false;
    if (next.runLocation === "server") updated.runLocation = "local-pc";
    // Common fields (duplicate check, default due days) are shared by every profile.
    const commonChanged = "checkDuplicateVouchers" in next || "duplicateVoucherAction" in next || "defaultDueDaysSale" in next || "defaultDueDaysPurchase" in next;
    setProfiles((items) => {
      const out: RunnerProfiles = { ...items, [viewMode]: enforceProfileRules(viewMode, updated) };
      if (!commonChanged) return out;
      const common = { checkDuplicateVouchers: updated.checkDuplicateVouchers, duplicateVoucherAction: updated.duplicateVoucherAction, defaultDueDaysSale: updated.defaultDueDaysSale, defaultDueDaysPurchase: updated.defaultDueDaysPurchase };
      return { full: { ...out.full, ...common }, semi: { ...out.semi, ...common }, manual: { ...out.manual, ...common } };
    });
  };

  /** Select Runner is a draft (Decision 8): applied on Save / Apply, reverted by Cancel. One runner is always selected;
   * turning Semi / Full off falls back to Manual Runner (no automatic runner). */
  const setRunnerEnabled = (mode: RunnerMode, enabled: boolean) => {
    const nextMode: RunnerMode = enabled ? mode : mode === activeRunnerMode ? "manual" : activeRunnerMode;
    if (nextMode === activeRunnerMode) return;
    setProfiles((items) => withExclusiveRunnerProfiles(items, nextMode) as RunnerProfiles);
    setActiveRunnerMode(nextMode);
  };

  const selectSection = (section: SettingsSection) => {
    if (section === "voucher-settings") setCommonSettingExpanded(true);
    setSettingsSection(section);
    setError(null);
  };

  /** Decision 4: copy only engine, Auto Post, countdown, Overwrite edited, file limit and missing-info rules. */
  const copyProfileFrom = (sourceMode: RunnerMode) => {
    if (!isRunnerMode(settingsSection) || settingsSection === "manual" || sourceMode === settingsSection) return;
    const target = settingsSection;
    setProfiles((current) => ({ ...current, [target]: copyRunnerProfileFields(current[target], current[sourceMode], target) }));
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setProfiles(savedProfiles);
      setActiveRunnerMode(savedRunnerMode);
      setSettingsSection(savedRunnerMode);
      setOcrPrefsDraft({});
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const save = async (closeAfterSave: boolean) => {
    if (!fsId || !user?.uid || !isCompanyAdmin) return;
    const sectionToKeep = settingsSection;
    const scrollTopToKeep = settingsScrollRef.current?.scrollTop ?? 0;
    // Decision 1: the active runner is the Select Runner / slider choice, never the viewed tab.
    const mode = activeRunnerMode;
    const activeProfile = profiles[mode];
    const runnerEnabled = mode !== "manual";
    const activeDevice = selectableAdminDevices.find((device) => device.id === activeProfile.localRunnerDeviceId);
    const modeLabel = mode === "full" ? "Full Auto Post" : "Semi Automatic";
    if (runnerEnabled && activeProfile.runLocation === "local-pc" && !activeDevice) {
      setError(`${modeLabel}: ${LOCAL_DEVICE_COPY[introLang].required}`);
      return;
    }
    if (runnerEnabled && !scanEngineAvailable[activeProfile.scanEngine]) {
      setError(`${modeLabel}: the selected scan engine has no configured key or access for this company.`);
      return;
    }
    for (const m of ["semi", "full"] as const) {
      const p = profiles[m];
      if (p.runOnSchedule && p.scheduleMode === "date-time" && (!p.scheduleDate || !p.scheduleTime) && (m === mode || m === viewMode)) {
        setError("Choose both a date and time for the scheduled scan.");
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const prepared = {} as RunnerProfiles;
      for (const m of ["full", "semi", "manual"] as const) {
        const p = profiles[m];
        const device = selectableAdminDevices.find((d) => d.id === p.localRunnerDeviceId);
        prepared[m] = {
          ...p,
          runLocation: "local-pc",
          localRunnerUid: device ? device.userId : p.localRunnerUid,
          scheduleMinutes: Math.max(1, Math.min(1440, Math.round(Number(p.scheduleMinutes) || DEFAULT_SETTINGS.scheduleMinutes))),
          maxCallsPerMinute: Math.max(1, Math.min(15, Math.round(Number(p.maxCallsPerMinute) || DEFAULT_SETTINGS.maxCallsPerMinute))),
          maxVouchersPerRun: scanRunLimitValue(p.maxVouchersPerRun),
          defaultDueDaysSale: normalizeDefaultDueDayValue(p.defaultDueDaysSale),
          defaultDueDaysPurchase: normalizeDefaultDueDayValue(p.defaultDueDaysPurchase),
          ...({ provider: SCAN_ENGINES[p.scanEngine].provider, providerLabel: SCAN_ENGINES[p.scanEngine].name } as object),
        } as AutoOcrSettings;
      }
      const built = buildRunnerSettingsSave(prepared, mode);
      const savedProfilesNext = built.runnerProfiles as RunnerProfiles;
      const settingsToSave = {
        ...built,
        scheduleTimeZone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
        failOnMissingFields: true,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        saveApproved: false,
      };
      const runnerChanged = mode !== savedRunnerMode;
      if (runnerChanged) window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-runner-hold", { detail: { companyId: fsId, held: true } }));
      await setDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), settingsToSave, { merge: true });
      if (Object.keys(ocrPrefsDraft).length) setOcrPrefs(ocrPrefsDraft);
      setOcrPrefsDraft({});
      setOcrDefaultDueDays(fsId, { sale: savedProfilesNext[mode].defaultDueDaysSale, purchase: savedProfilesNext[mode].defaultDueDaysPurchase });
      setProfiles(savedProfilesNext);
      setSavedProfiles(savedProfilesNext);
      setActiveRunnerMode(mode);
      setSavedRunnerMode(mode);
      setRunnerSettings(settingsToSave as unknown as AutoOcrSettings);
      setSettingsLoadedFor(fsId);
      if (closeAfterSave) {
        onOpenChange(false);
        setSavePrompt(priorRunActiveRef.current || savedProfilesNext[mode].runOnSchedule || runnerEnabled ? "continue-stop" : "start-now");
      } else {
        setSettingsSection(sectionToKeep);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          if (settingsScrollRef.current) settingsScrollRef.current.scrollTop = scrollTopToKeep;
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    {showRunner && <GalleryLocalAutoPostRunner settings={runnerSettings} settingsDialogOpen={open} isCompanyAdmin={isCompanyAdmin} settingsReady={settingsLoadedFor === fsId && !!fsId} />}
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        data-pl-full-auto-post=""
        data-ocr-settings-open={showRunner ? undefined : "1"}
        overlayClassName={showRunner ? undefined : OCR_SETTINGS_DIALOG_OVERLAY_CN}
        className={`full-auto-post-dialog flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden bg-[#e5e7eb] p-0 sm:h-[88dvh] sm:max-h-[88dvh] sm:max-w-4xl ${showRunner ? "" : OCR_SETTINGS_DIALOG_CONTENT_CN}`}
      >
        <style>{`
          [data-pl-full-auto-post].full-auto-post-dialog { background: #e5e7eb !important; }
          [data-pl-full-auto-post] .full-auto-post-body { background: #e5e7eb; }
          [data-pl-full-auto-post] .full-auto-post-card {
            background: linear-gradient(180deg,#fff 0%,#f8fafc 100%) !important;
            border: 1px solid rgba(15,23,42,.08) !important;
            border-radius: 14px !important;
            box-shadow: 0 1px 2px rgba(15,23,42,.06),0 4px 10px -2px rgba(15,23,42,.10),0 12px 24px -12px rgba(15,23,42,.18) !important;
            transition: transform 180ms ease,box-shadow 180ms ease;
          }
          [data-pl-full-auto-post] .full-auto-post-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 2px 4px rgba(15,23,42,.08),0 10px 20px -4px rgba(15,23,42,.16),0 22px 40px -14px rgba(15,23,42,.28) !important;
          }
          [data-pl-full-auto-post] .full-auto-post-sidebar { background: #e5e7eb; }
          [data-pl-full-auto-post] .full-auto-post-sideitem {
            background: linear-gradient(180deg,#e5e7eb 0%,#dfe3e8 100%);
            border: 1px solid rgba(15,23,42,.08);
            border-radius: 12px;
            box-shadow: 0 1px 2px rgba(15,23,42,.06),0 4px 10px -2px rgba(15,23,42,.10),0 12px 24px -12px rgba(15,23,42,.18);
            transition: transform 180ms ease,box-shadow 180ms ease;
          }
          [data-pl-full-auto-post] .full-auto-post-sideitem:hover { transform: translateY(-2px); box-shadow: 0 2px 4px rgba(15,23,42,.08),0 8px 16px -4px rgba(15,23,42,.16),0 18px 32px -14px rgba(15,23,42,.24); }
          [data-pl-full-auto-post] .full-auto-post-sideitem[aria-current="page"] { background: linear-gradient(180deg,#dbeafe 0%,#bfdbfe 100%); border-color: rgba(59,130,246,.35); color: #1e3a8a; box-shadow: inset 0 1px 2px rgba(255,255,255,.75),0 3px 6px rgba(15,23,42,.12),0 10px 18px -10px rgba(15,23,42,.32); }
          .dark [data-pl-full-auto-post] .full-auto-post-body { background: #0b1120; }
          .dark [data-pl-full-auto-post].full-auto-post-dialog { background: #0b1120 !important; }
          .dark [data-pl-full-auto-post] .full-auto-post-card { background: linear-gradient(180deg,#1e293b 0%,#172033 100%) !important; border-color: rgba(148,163,184,.18) !important; box-shadow: 0 1px 2px rgba(0,0,0,.4),0 6px 14px -4px rgba(0,0,0,.5) !important; }
          .dark [data-pl-full-auto-post] .full-auto-post-card:hover { box-shadow: 0 2px 4px rgba(0,0,0,.45),0 14px 28px -8px rgba(0,0,0,.65) !important; }
          .dark [data-pl-full-auto-post] .full-auto-post-sidebar { background: #0b1120; }
          .dark [data-pl-full-auto-post] .full-auto-post-sideitem { background: linear-gradient(180deg,#0b1120 0%,#111827 100%); border-color: rgba(148,163,184,.18); color: #e2e8f0; box-shadow: 0 1px 2px rgba(0,0,0,.4),0 6px 14px -4px rgba(0,0,0,.5); }
          [data-pl-full-auto-post] .full-auto-post-footer { background: #e5e7eb; }
          .dark [data-pl-full-auto-post] .full-auto-post-footer { background: #0b1120; }
          .dark [data-pl-full-auto-post] .full-auto-post-sideitem[aria-current="page"] { background: linear-gradient(180deg,#1e40af 0%,#1e3a8a 100%); color: #eff6ff; }
          @media (prefers-reduced-motion: reduce) { [data-pl-full-auto-post] .full-auto-post-card,[data-pl-full-auto-post] .full-auto-post-sideitem { transition: none; } [data-pl-full-auto-post] .full-auto-post-card:hover,[data-pl-full-auto-post] .full-auto-post-sideitem:hover { transform: none; } }
        `}</style>
        <DialogHeader className="relative shrink-0 bg-sky-200 px-3 py-3 sm:px-6">
        <DialogTitle className="text-center font-bold">Voucher Post Setting <span className="mx-1 opacity-70">→</span> {settingsSection === "full" ? "Full Auto Post" : settingsSection === "semi" ? "Semi Automatic" : settingsSection === "manual" ? "Manual Runner" : settingsSection === "runner-select" ? "Select Runner" : settingsSection === "rules" ? "Common Setting" : settingsSection === "voucher-settings" ? "Voucher OCR Settings" : "Key Setting"}</DialogTitle>
          <DialogDescription />
        </DialogHeader>

        <div className="full-auto-post-body min-h-0 flex-1 overflow-hidden">
        {!isCompanyAdmin ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Only a company owner or admin can change these settings.</div>
        ) : loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading settings…</div>
        ) : (
          <div className={`flex h-full min-h-0 flex-col gap-3 p-[10px] md:grid ${sidebarVisible ? "md:grid-cols-[190px_minmax(0,1fr)]" : "md:grid-cols-1"}`}>
            <div className="md:hidden">
              <Select value={settingsSection} onValueChange={(value) => selectSection(value as SettingsSection)}>
                <SelectTrigger className="h-10 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual Runner</SelectItem>
                  <SelectItem value="semi">Semi Automatic</SelectItem>
                  <SelectItem value="full">Full Auto Post</SelectItem>
                  <SelectItem value="runner-select">Select Runner</SelectItem>
                  <SelectItem value="rules">Common Setting</SelectItem>
                  <SelectItem value="voucher-settings">Voucher</SelectItem>
                  <SelectItem value="keys">Key Setting</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {sidebarVisible && <nav aria-label="Auto post settings sections" className="full-auto-post-sidebar hidden h-full min-h-0 flex-col gap-2 border-r pr-3 md:flex">
              <div className="mb-1 flex items-center justify-between gap-1 rounded-md bg-sky-200 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800">
                <span>Runner Profiles</span>
                <button type="button" aria-label="Hide sidebar" title="Hide sidebar" className="rounded p-1 hover:bg-white/70" onClick={() => setSidebarVisible(false)}><PanelLeftClose className="h-4 w-4" /></button>
              </div>
              {([
                ["manual", "Manual Runner", Monitor],
                ["semi", "Semi Automatic", Clock3],
                ["full", "Full Auto Post", Bot],
              ] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  aria-current={settingsSection === key ? "page" : undefined}
                  onClick={() => selectSection(key)}
                  className={`full-auto-post-sideitem flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm font-medium ${settingsSection === key ? "text-emerald-900" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
              <button
                type="button"
                aria-current={settingsSection === "runner-select" ? "page" : undefined}
                onClick={() => selectSection("runner-select")}
                className={`full-auto-post-sideitem flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm font-medium ${settingsSection === "runner-select" ? "text-emerald-900" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ListChecks className="h-4 w-4 shrink-0" />
                <span>Select Runner</span>
              </button>
              <div aria-current={settingsSection === "rules" || settingsSection === "voucher-settings" ? "page" : undefined} className={`full-auto-post-sideitem flex w-full items-center gap-1 px-2 py-1.5 ${settingsSection === "rules" || settingsSection === "voucher-settings" ? "text-emerald-900" : "text-muted-foreground"}`}>
                <button type="button" onClick={() => selectSection("rules")} className="flex min-w-0 flex-1 items-center gap-2 px-0.5 py-0.5 text-left text-sm font-medium">
                  <Gauge className="h-4 w-4 shrink-0" />
                  <span className="truncate">Common Setting</span>
                </button>
                <button type="button" aria-label={commonSettingExpanded ? "Hide Voucher menu" : "Show Voucher menu"} aria-expanded={commonSettingExpanded} onClick={() => setCommonSettingExpanded((value) => !value)} className="rounded p-1 hover:bg-white/70">
                  <ChevronRight className={`h-4 w-4 transition-transform ${commonSettingExpanded ? "rotate-90" : ""}`} />
                </button>
              </div>
              {commonSettingExpanded && <button
                type="button"
                aria-current={settingsSection === "voucher-settings" ? "page" : undefined}
                onClick={() => selectSection("voucher-settings")}
                className={`full-auto-post-sideitem ml-3 flex w-[calc(100%-0.75rem)] items-center gap-2 px-2.5 py-2 text-left text-sm font-medium ${settingsSection === "voucher-settings" ? "text-emerald-900" : "text-muted-foreground hover:text-foreground"}`}
              >
                <ScanText className="h-4 w-4 shrink-0" />
                <span>Voucher</span>
              </button>}
              <div className="my-1 border-t border-slate-300/80" />
              <div className="mt-auto border-t border-slate-300/80 pt-2">
                <button
                  type="button"
                  aria-current={settingsSection === "keys" ? "page" : undefined}
                  onClick={() => selectSection("keys")}
                  className={`full-auto-post-sideitem flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm font-medium ${settingsSection === "keys" ? "text-emerald-900" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <KeyRound className="h-4 w-4 shrink-0" />
                  <span>Key Setting</span>
                </button>
              </div>
            </nav>}

            <div ref={settingsScrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
            <div className="space-y-4">
            {!sidebarVisible && <button type="button" aria-label="Show sidebar" title="Show sidebar" className="hidden rounded-lg border bg-white/90 p-2 text-muted-foreground shadow-sm hover:text-foreground md:inline-flex" onClick={() => setSidebarVisible(true)}><PanelLeftOpen className="h-4 w-4" /><span className="ml-2 text-xs">Show profiles</span></button>}
            {settingsSection === "runner-select" && <section className="full-auto-post-card space-y-3 p-3">
              <h3 className="flex items-center gap-2 border-b border-indigo-200 pb-2 text-base font-semibold"><Monitor className="h-4 w-4" />Select Runner</h3>
              <p className="text-xs text-muted-foreground">Only one runner can be enabled at a time. Turning one on turns the others off.</p>
              <div className="space-y-3">
                {([
                  ["manual", "Manual Runner", Monitor, profiles.manual.manualScan],
                  ["semi", "Semi Automatic", Clock3, profiles.semi.enabled],
                  ["full", "Full Auto Post", Bot, profiles.full.enabled],
                ] as const).map(([mode, label, Icon, checked]) => (
                  <div key={mode} className="full-auto-post-card flex items-center justify-between gap-4 p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-sky-700" />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <Switch
                      checked={checked}
                      onCheckedChange={(enabled) => setRunnerEnabled(mode, enabled)}
                      disabled={loading || saving}
                      aria-label={`${label} ${mode === "manual" ? "manual scan" : "runner profile"}`}
                    />
                  </div>
                ))}
              </div>
            </section>}
            {isRunnerMode(settingsSection) && settingsSection !== "manual" && <section className="full-auto-post-card space-y-3 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{settingsSection === "full" ? "Full Auto Post" : settingsSection === "semi" ? "Semi Automatic" : "Manual Runner"}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">Copy settings from</span>
                  <Select onValueChange={(value) => copyProfileFrom(value as RunnerMode)}>
                    <SelectTrigger className="h-9 w-40 bg-white"><SelectValue placeholder="Choose profile" /></SelectTrigger>
                    <SelectContent>
                      {(["full", "semi"] as const).filter((mode) => mode !== settingsSection).map((mode) => <SelectItem key={mode} value={mode}>{mode === "full" ? "Full Auto Post" : "Semi Automatic"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Copy className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </section>}
            {isRunnerMode(settingsSection) && <section className="full-auto-post-card space-y-3 p-3">
              <h3 className="flex items-center gap-2 border-b border-indigo-200 pb-2 text-base font-semibold"><ScanText className="h-4 w-4" />Select Engine</h3>
              <RadioGroup
                value={settings.scanEngine}
                onValueChange={(scanEngine) => patch({ scanEngine: scanEngine as AutoOcrSettings["scanEngine"] })}
                disabled={!isCompanyAdmin || loading || saving}
                className="grid grid-cols-3 gap-2"
              >
                {([ ["gemini", "Gemini AI"], ["google", "Google OCR"], ["azure", "Azure OCR"], ["auto", "Auto OCR"] ] as const).map(([engine, label]) => {
                  const available = scanEngineAvailable[engine];
                  const id = `runner-engine-${settingsSection}-${engine}`;
                  return <label key={engine} htmlFor={id} title={available ? label : `${label} key or company access is not configured`} className={`flex cursor-pointer items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-sm ${!available ? "cursor-not-allowed opacity-50" : "hover:bg-sky-50"}`}>
                    <RadioGroupItem id={id} value={engine} disabled={!available} />
                    <span>{label}{!available && <span className="ml-1 text-[10px] text-muted-foreground">Not configured</span>}</span>
                  </label>;
                })}
              </RadioGroup>
            </section>}
            {isRunnerMode(settingsSection) && <section className="full-auto-post-card space-y-3 p-3">
              <h3 className="flex items-center gap-2 border-b border-indigo-200 pb-2 text-base font-semibold"><Gauge className="h-4 w-4" />Auto save</h3>
              <SettingToggle title="Auto Post" checked={fullAutoRules ? true : settings.autoSaveEnabled} onChange={(autoSaveEnabled) => patch({ autoSaveEnabled })} disabled={!isCompanyAdmin || loading || saving || fullAutoRules} />
              <SettingToggle title="Overwrite edited" checked={settings.overwriteEdited} onChange={(overwriteEdited) => patch({ overwriteEdited })} disabled={!isCompanyAdmin || loading || saving} />
              {fullAutoRules
                ? <p className="text-xs text-muted-foreground">{FULL_AUTO_SAVE_NOTE[introLang]}</p>
                : <NumberSetting label="Auto save countdown (seconds)" value={settings.autoSaveSeconds} min={1} max={60} onChange={(autoSaveSeconds) => patch({ autoSaveSeconds })} disabled={!isCompanyAdmin || loading || saving || !settings.autoSaveEnabled} />}
            </section>}
            {isRunnerMode(settingsSection) && <section className="full-auto-post-card space-y-3 p-3">
              <h3 className="flex items-center gap-2 border-b border-indigo-200 pb-2 text-base font-semibold">
                <AlertCircle className="h-4 w-4" />{MISSING_FIELD_ACTION_COPY[introLang].label}
                <Popover>
                  <PopoverTrigger asChild><button type="button" aria-label="Missing information rule help" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-sky-100 hover:text-foreground"><Info className="h-4 w-4" /></button></PopoverTrigger>
                  <PopoverContent align="start" data-pl-intro="" className={`max-w-sm text-xs font-normal leading-relaxed ${showRunner ? "" : "!z-[2147483003]"}`}>
                    <p>{MISSING_RULE_LABELS[introLang].help}</p>
                    {fullAutoRules ? <p className="mt-2">{FULL_AUTO_RULE_NOTE[introLang]}</p> : null}
                  </PopoverContent>
                </Popover>
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {(["debitMaster", "creditMaster", "item", "date", "tax", "other"] as const).map((ruleKey) => {
                    const options = ruleKey === "item"
                      ? ["pause-and-hold", "fail-and-continue", "save-without"] as const
                      : ["pause-and-hold", "fail-and-continue"] as const;
                    return (
                      <div key={ruleKey} className="full-auto-post-card p-2">
                        <div className="mb-1.5 text-sm font-semibold">{MISSING_RULE_LABELS[introLang][ruleKey]}</div>
                        <RadioGroup
                          value={settings.missingFieldRules[ruleKey]}
                          onValueChange={(action) => patch({ missingFieldRules: { ...settings.missingFieldRules, [ruleKey]: action } as AutoOcrSettings["missingFieldRules"] })}
                          disabled={!isCompanyAdmin || loading || saving}
                          className="space-y-1.5"
                        >
                          {options.map((action) => {
                            const label = action === "pause-and-hold" ? MISSING_RULE_LABELS[introLang].pause : action === "fail-and-continue" ? MISSING_RULE_LABELS[introLang].fail : MISSING_RULE_LABELS[introLang].saveWithout;
                            const id = `auto-ocr-${viewMode}-${ruleKey}-${action}`;
                            const off = fullAutoRules && action === "pause-and-hold";
                            return <label key={action} htmlFor={id} aria-disabled={off || undefined} className={`flex items-start gap-2 rounded border bg-background p-1.5 text-xs transition-all duration-150 ${off ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:-translate-y-0.5 hover:shadow-sm"}`}><RadioGroupItem id={id} value={action} disabled={off} className="mt-0.5" /><span>{label}</span></label>;
                          })}
                        </RadioGroup>
                      </div>
                    );
                  })}
                  <div className="full-auto-post-card p-2">
                    <div className="mb-1.5 text-sm font-semibold">{MISSING_RULE_LABELS[introLang].rowMismatch}</div>
                    <RadioGroup value={settings.itemRowMismatchAction} onValueChange={(action) => patch({ itemRowMismatchAction: action as AutoOcrSettings["itemRowMismatchAction"] })} disabled={!isCompanyAdmin || loading || saving} className="space-y-1.5">
                      <label htmlFor={`auto-ocr-${viewMode}-item-row-count-pause`} aria-disabled={fullAutoRules || undefined} className={`flex items-start gap-2 rounded border bg-background p-1.5 text-xs ${fullAutoRules ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}><RadioGroupItem id={`auto-ocr-${viewMode}-item-row-count-pause`} value="pause-and-hold" disabled={fullAutoRules} className="mt-0.5" /><span>{MISSING_RULE_LABELS[introLang].pause}</span></label>
                      <label htmlFor={`auto-ocr-${viewMode}-item-row-count-fail`} className="flex cursor-pointer items-start gap-2 rounded border bg-background p-1.5 text-xs"><RadioGroupItem id={`auto-ocr-${viewMode}-item-row-count-fail`} value="fail-and-continue" className="mt-0.5" /><span>{MISSING_RULE_LABELS[introLang].fail}</span></label>
                    </RadioGroup>
                  </div>
                  <div className="full-auto-post-card p-2">
                    <div className="mb-1.5 text-sm font-semibold">{MISSING_RULE_LABELS[introLang].amountMismatch}</div>
                    <RadioGroup value={settings.amountMismatchAction} onValueChange={(action) => patch({ amountMismatchAction: action as AutoOcrSettings["amountMismatchAction"] })} disabled={!isCompanyAdmin || loading || saving} className="space-y-1.5">
                      <label htmlFor={`auto-ocr-${viewMode}-item-amount-pause`} aria-disabled={fullAutoRules || undefined} className={`flex items-start gap-2 rounded border bg-background p-1.5 text-xs ${fullAutoRules ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}><RadioGroupItem id={`auto-ocr-${viewMode}-item-amount-pause`} value="pause-and-hold" disabled={fullAutoRules} className="mt-0.5" /><span>{MISSING_RULE_LABELS[introLang].pause}</span></label>
                      <label htmlFor={`auto-ocr-${viewMode}-item-amount-fail`} className="flex cursor-pointer items-start gap-2 rounded border bg-background p-1.5 text-xs"><RadioGroupItem id={`auto-ocr-${viewMode}-item-amount-fail`} value="fail-and-continue" className="mt-0.5" /><span>{MISSING_RULE_LABELS[introLang].fail}</span></label>
                    </RadioGroup>
                  </div>
                </div>
              </div>
            </section>}
            {settingsSection === "rules" && <section className="space-y-3">
              <h3 className="mb-3 flex items-center gap-2 border-b pb-2 text-base font-semibold">
                <Bot className="h-4 w-4" />Common Setting
                <Popover>
                  <PopoverTrigger asChild><button type="button" aria-label="Common Setting information" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-sky-100 hover:text-foreground"><Info className="h-4 w-4" /></button></PopoverTrigger>
                  <PopoverContent align="start" data-pl-intro="" className={`max-w-sm text-xs font-normal leading-relaxed ${showRunner ? "" : "!z-[2147483003]"}`}>
                    {COMMON_SETTING_NOTE[introLang]}
                  </PopoverContent>
                </Popover>
              </h3>
              <div className="space-y-3">
                <div className="full-auto-post-card space-y-2 p-2.5">
                  <SettingToggle
                    title={DUPLICATE_COPY[introLang].title}
                    checked={settings.checkDuplicateVouchers}
                    onChange={(checkDuplicateVouchers) => patch({ checkDuplicateVouchers })}
                    disabled={!isCompanyAdmin || loading || saving}
                    info={(
                      <Popover>
                        <PopoverTrigger asChild><button type="button" aria-label="Duplicate voucher rule information" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-sky-100 hover:text-foreground"><Info className="h-4 w-4" /></button></PopoverTrigger>
                        <PopoverContent align="start" data-pl-intro="" className={`max-w-sm text-xs font-normal leading-relaxed ${showRunner ? "" : "!z-[2147483003]"}`}>
                          {DUPLICATE_COPY[introLang].description}
                        </PopoverContent>
                      </Popover>
                    )}
                  />
                  <RadioGroup
                    value={settings.duplicateVoucherAction}
                    onValueChange={(duplicateVoucherAction) => patch({ duplicateVoucherAction: duplicateVoucherAction as AutoOcrSettings["duplicateVoucherAction"] })}
                    disabled={!isCompanyAdmin || loading || saving || !settings.checkDuplicateVouchers}
                    className="grid grid-cols-1 gap-2 lg:grid-cols-2"
                  >
                    <label htmlFor="auto-ocr-duplicate-save" className="flex cursor-pointer items-start gap-2 rounded-md border bg-white p-2 text-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm"><RadioGroupItem id="auto-ocr-duplicate-save" value="save-anyway" className="mt-0.5" /><span>{DUPLICATE_COPY[introLang].save}</span></label>
                    <label htmlFor="auto-ocr-duplicate-move" className="flex cursor-pointer items-start gap-2 rounded-md border bg-white p-2 text-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm"><RadioGroupItem id="auto-ocr-duplicate-move" value="move-to-duplicates" className="mt-0.5" /><span>{DUPLICATE_COPY[introLang].move}</span></label>
                    <label htmlFor="auto-ocr-duplicate-pause" className="flex cursor-pointer items-start gap-2 rounded-md border bg-white p-2 text-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm"><RadioGroupItem id="auto-ocr-duplicate-pause" value="pause-for-review" className="mt-0.5" /><span>{DUPLICATE_COPY[introLang].pause}</span></label>
                  </RadioGroup>
                </div>
                <div className="full-auto-post-card space-y-2 p-2.5">
                  <div className="text-sm font-semibold">{AUTO_POST_UI.defaultDueDaysTitle}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DefaultDueDayInput
                      label={AUTO_POST_UI.sale}
                      ariaLabel={AUTO_POST_UI.defaultDueDaysSale}
                      value={settings.defaultDueDaysSale}
                      onChange={(defaultDueDaysSale) => patch({ defaultDueDaysSale })}
                      disabled={!isCompanyAdmin || loading || saving}
                    />
                    <DefaultDueDayInput
                      label={AUTO_POST_UI.purchase}
                      ariaLabel={AUTO_POST_UI.defaultDueDaysPurchase}
                      value={settings.defaultDueDaysPurchase}
                      onChange={(defaultDueDaysPurchase) => patch({ defaultDueDaysPurchase })}
                      disabled={!isCompanyAdmin || loading || saving}
                    />
                  </div>
                </div>
                <div className="full-auto-post-card p-3">
                  <VoucherOcrBankAliasesPanel />
                </div>
              </div>
            </section>}

            {isRunnerMode(settingsSection) && <section className="full-auto-post-card space-y-3 p-3">
              <h3 className="flex items-center gap-2 border-b pb-2 text-base font-semibold"><Clock3 className="h-4 w-4" />When to scan</h3>
              <div className="space-y-2">
                <SettingToggle
                  title="As soon as a file arrives"
                  checked={settingsSection === "manual" ? false : settings.runOnUpload}
                  onChange={(runOnUpload) => patch({ runOnUpload })}
                  disabled={manualProfileReadOnly || !isCompanyAdmin || loading || saving}
                />
                <SettingToggle
                  title="Scan on a schedule"
                  checked={settingsSection === "manual" ? false : settings.runOnSchedule}
                  onChange={(runOnSchedule) => patch({ runOnSchedule })}
                  disabled={manualProfileReadOnly || !isCompanyAdmin || loading || saving}
                />
                <div className="space-y-1">
                  <SettingToggle
                    title={AUTO_POST_UI.onlyWhenStart}
                    checked={settingsSection === "manual" || isManualStartTrigger(settings)}
                    onChange={(on) => { if (on) patch({ runOnManualStart: true }); }}
                    disabled={manualProfileReadOnly || !isCompanyAdmin || loading || saving}
                  />
                  {(settingsSection === "manual" || isManualStartTrigger(settings)) && (
                    <p className="text-xs text-muted-foreground">{AUTO_POST_UI.onlyWhenStartHint}</p>
                  )}
                </div>
                <ScanRunLimitSetting
                  value={settings.maxVouchersPerRun}
                  onChange={(maxVouchersPerRun) => patch({ maxVouchersPerRun })}
                  disabled={!isCompanyAdmin || loading || saving}
                />
              </div>
              {settingsSection !== "manual" && settings.runOnSchedule && <div className="full-auto-post-card space-y-3 p-3">
                <div className="text-xs font-medium">Schedule type</div>
                <RadioGroup
                  value={settings.scheduleMode}
                  onValueChange={(scheduleMode) => patch({ scheduleMode: scheduleMode as AutoOcrSettings["scheduleMode"] })}
                  disabled={!isCompanyAdmin || loading || saving}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <label htmlFor="auto-ocr-schedule-interval" className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm"><RadioGroupItem id="auto-ocr-schedule-interval" value="interval" /><span>Every interval</span></label>
                  <label htmlFor="auto-ocr-schedule-date-time" className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm"><RadioGroupItem id="auto-ocr-schedule-date-time" value="date-time" /><span>At a date and time (one time)</span></label>
                </RadioGroup>
                {settings.scheduleMode === "interval" ? (
                  <NumberSetting label="Run every (minutes)" value={settings.scheduleMinutes} min={1} max={1440} onChange={(scheduleMinutes) => patch({ scheduleMinutes })} disabled={!isCompanyAdmin || loading || saving} />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm"><span className="text-xs text-muted-foreground">Date</span><BsDatePicker isRange={false} valueAD={scheduleDateAD} onChangeAD={(date) => patch({ scheduleDate: formatLocalDate(date) })} disabled={!isCompanyAdmin || loading || saving} showDateConverterButton={false} className="!h-9 !min-h-9 w-full">{scheduleDateLabel}</BsDatePicker></label>
                    <label className="space-y-1 text-sm"><span className="text-xs text-muted-foreground">Time</span><Input type="time" value={settings.scheduleTime} disabled={!isCompanyAdmin || loading || saving} onChange={(event) => patch({ scheduleTime: event.target.value })} /></label>
                  </div>
                )}
              </div>}
            </section>}

            {settingsSection === "keys" && <section className="full-auto-post-card space-y-3 p-3">
              <h3 className="border-b pb-2 text-base font-semibold">Key Setting</h3>
              <VoucherOcrKeySettingsPanel />
            </section>}
            {settingsSection === "voucher-settings" && <section className="full-auto-post-card space-y-3 p-3">
              <h3 className="border-b pb-2 text-base font-semibold">Voucher OCR Settings</h3>
              <VoucherOcrSettingsPanel draft={ocrPrefsDraft} onDraftChange={(patch) => setOcrPrefsDraft((current) => ({ ...current, ...patch }))} />
            </section>}

            {isRunnerMode(settingsSection) && <section className="full-auto-post-card space-y-3 p-3">
              <h3 className="flex items-center gap-2 border-b pb-2 text-base font-semibold">
                <Monitor className="h-4 w-4" />Run location
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label="Local PC information" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-sky-100 hover:text-foreground">
                      <Info className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" data-pl-intro="" className={`max-w-sm text-xs font-normal leading-relaxed ${showRunner ? "" : "!z-[2147483003]"}`}>
                    <p>{LOCAL_INFO[introLang]}</p>
                    <p className="mt-2 border-t pt-2">{localDeviceCopy.oneOnly}</p>
                  </PopoverContent>
                </Popover>
              </h3>
              <div className="text-sm font-semibold">Run Auto post on</div>
              <RadioGroup value={settings.runLocation === "server" ? "local-pc" : settings.runLocation} onValueChange={(runLocation) => {
                if (runLocation === "server") return;
                const nextLocation = "local-pc" as const;
                const currentDeviceRegistered = selectableAdminDevices.some((device) => device.id === localDeviceId);
                patch({
                  runLocation: nextLocation,
                  ...(!settings.localRunnerDeviceId && currentDeviceRegistered ? { localRunnerDeviceId: localDeviceId } : {}),
                });
              }} disabled={!isCompanyAdmin || loading || saving} className="grid gap-2 sm:grid-cols-2">
                <label htmlFor="auto-ocr-local-pc" className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm"><RadioGroupItem id="auto-ocr-local-pc" value="local-pc" /><Monitor className="h-4 w-4" /><span>Local PC</span></label>
                <label htmlFor="auto-ocr-server" aria-disabled="true" className="flex cursor-not-allowed items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm opacity-50"><RadioGroupItem id="auto-ocr-server" value="server" disabled /><Server className="h-4 w-4" /><span>Server ({AUTO_POST_UI.comingSoon})</span></label>
              </RadioGroup>
              {settings.runLocation === "local-pc" ? (
                <div className="full-auto-post-card space-y-3 p-2.5 text-xs leading-relaxed">
                  <label className="block space-y-1.5">
                    <span className="font-semibold">{localDeviceCopy.select}</span>
                    <Select
                      value={selectedDeviceId}
                      onValueChange={(localRunnerDeviceId) => patch({ localRunnerDeviceId })}
                      disabled={!isCompanyAdmin || loading || saving || adminDevicesLoading || !selectableAdminDevices.length}
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
                          <div key={device.id} className="flex min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-foreground transition-all duration-150 hover:-translate-y-0.5 hover:bg-sky-50 hover:shadow-sm">
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
            </section>}

            {isRunnerMode(settingsSection) && <section className="full-auto-post-card space-y-3 p-3">
              <h3 className="flex items-center gap-2 border-b border-indigo-200 pb-2 text-base font-semibold">
                <Gauge className="h-4 w-4" />Usage and voucher saving
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label="Voucher saving information" className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-sky-100 hover:text-foreground">
                      <Info className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" data-pl-intro="" className={`max-w-sm text-xs font-normal leading-relaxed ${showRunner ? "" : "!z-[2147483003]"}`}>
                    Automatically created vouchers remain unapproved. Use the required-information rule in the Common Setting tab to handle incomplete scans.
                  </PopoverContent>
                </Popover>
              </h3>
              <div className="full-auto-post-card p-2.5">
                <NumberSetting label={`Maximum ${SCAN_ENGINES[settings.scanEngine].name} calls per minute`} value={settings.maxCallsPerMinute} min={1} max={15} onChange={(maxCallsPerMinute) => patch({ maxCallsPerMinute })} disabled={!isCompanyAdmin || loading || saving} />
                <p className="mt-2 text-xs text-muted-foreground">{settings.runLocation === "local-pc"
                  ? "The selected PC runs the scan using this company’s configured engine key. Server and provider safety limits may still apply."
                  : "Limit applies to this company. The server’s engine safety limit may be lower."}</p>
              </div>
              <OcrEngineUsage companyId={fsId} selectedEngine={settings.scanEngine} />
            </section>}

            {isRunnerMode(settingsSection) && <div className="flex items-start gap-2 rounded-lg border bg-muted/60 p-3 text-xs text-muted-foreground shadow-sm"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Files must be uploaded to the Pocket Ledger Server so the selected runner can access them.</div>}
            </div>
            </div>
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="full-auto-post-footer shrink-0 border-t px-[10px] pb-[10px] pt-3">
          <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>Cancel</Button>
          {isCompanyAdmin && <>
            <Button type="button" variant="outline" onClick={() => void save(false)} disabled={loading || saving || !fsId}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Apply</Button>
            <Button type="button" onClick={() => void save(true)} disabled={loading || saving || !fsId}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={savePrompt != null} onOpenChange={(nextOpen) => { if (!nextOpen) setSavePrompt(null); }}>
      <AlertDialogContent overlayClassName={showRunner ? undefined : "z-[2147483004] bg-black/45 backdrop-blur-sm"} className={showRunner ? undefined : "!z-[2147483005]"}>
        <AlertDialogHeader>
          <AlertDialogTitle>{savePrompt === "continue-stop" ? AUTO_POST_UI.previousRunPrompt : AUTO_POST_UI.settingsSavedStart}</AlertDialogTitle>
          <AlertDialogDescription className="sr-only">{savePrompt === "continue-stop" ? AUTO_POST_UI.previousRunPrompt : AUTO_POST_UI.settingsSavedStart}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {savePrompt === "continue-stop" ? <>
            <AlertDialogCancel onClick={() => {
              setSavePrompt(null);
              window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-runner-hold", { detail: { companyId: fsId, held: true } }));
            }}>{AUTO_POST_UI.stop}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setSavePrompt(null);
              window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-runner-hold", { detail: { companyId: fsId, held: false } }));
            }}>{AUTO_POST_UI.continue}</AlertDialogAction>
          </> : <>
            <AlertDialogCancel onClick={() => setSavePrompt(null)}>{AUTO_POST_UI.no}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setSavePrompt(null);
              window.dispatchEvent(new CustomEvent("pl:gallery:auto-post-runner-hold", { detail: { companyId: fsId, held: false } }));
            }}>{AUTO_POST_UI.yes}</AlertDialogAction>
          </>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={!!deviceActionTarget} onOpenChange={(nextOpen) => { if (!nextOpen && !deviceActionBusy) setDeviceActionTarget(null); }}>
      <AlertDialogContent overlayClassName={showRunner ? undefined : "z-[2147483004] bg-black/45 backdrop-blur-sm"} className={showRunner ? undefined : "!z-[2147483005]"}>
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

function SettingToggle({ icon, title, checked, onChange, disabled = false, info }: { icon?: ReactNode; title: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; info?: ReactNode }) {
  return <div className={`flex items-center justify-between gap-3 ${disabled ? "opacity-60" : ""}`}>
    <span className="flex items-center gap-2 text-sm">{icon}{title}{info}</span>
    <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
  </div>;
}

function NumberSetting({ label, value, min, max, onChange, disabled = false }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <label className={`flex items-center justify-between gap-3 text-sm ${disabled ? "opacity-60" : ""}`}>
    <span>{label}</span>
    <Input className="h-9 w-24" type="number" min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}

function DefaultDueDayInput({ label, ariaLabel, value, onChange, disabled = false }: { label: string; ariaLabel: string; value: number | null; onChange: (value: number | null) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);
  return <label className={`space-y-1 text-sm ${disabled ? "opacity-60" : ""}`}>
    <span className="text-xs text-muted-foreground">{label}</span>
    <Input
      className="h-9"
      type="number"
      min={0}
      max={365}
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        if (raw.trim() === "") onChange(null);
        else onChange(normalizeDefaultDueDayValue(raw));
      }}
    />
  </label>;
}

function ScanRunLimitSetting({ value, onChange, disabled = false }: { value: number | "all"; onChange: (value: number | "all") => void; disabled?: boolean }) {
  const isAll = value === "all";
  const [draft, setDraft] = useState(typeof value === "number" ? String(value) : String(SCAN_RUN_LIMIT_DEFAULT));
  useEffect(() => {
    if (typeof value === "number") setDraft(String(value));
  }, [value]);
  return <div className={`flex items-center justify-between gap-3 ${disabled ? "opacity-60" : ""}`}>
    <span className="text-sm">{AUTO_POST_UI.howManyFiles}</span>
    <div className="flex items-center gap-2">
      <Input
        className="h-9 w-24"
        type="number"
        min={1}
        max={500}
        value={isAll ? draft : value}
        disabled={disabled}
        aria-label={AUTO_POST_UI.howManyFiles}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          if (raw === "") return;
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(scanRunLimitValue(n));
        }}
      />
      <label className={`flex items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-sm shadow-sm ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={isAll}
          disabled={disabled}
          aria-label={AUTO_POST_UI.scanAllFiles}
          onChange={(event) => {
            if (event.target.checked) onChange("all");
            else {
              const next = scanRunLimitValue(draft);
              onChange(next === "all" ? SCAN_RUN_LIMIT_DEFAULT : next);
            }
          }}
        />
        <span>{AUTO_POST_UI.all}</span>
      </label>
    </div>
  </div>;
}
