"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, Bot, Clock3, Gauge, Loader2, Monitor, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { introTabLang } from "@/lib/i18n/introLangTab";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { setDoc } from "@/lib/writeGateway/pbWrites";
import { firestore } from "@/lib/plClientSession";
import { useOcrAiStatus } from "@/modules/ocr/ai/aiClient";
import { useOcrCloudStatus } from "@/modules/ocr/cloud/ocrCloudClient";
import { getOrCreateClientDeviceId } from "@/lib/security/deviceIdentity";
import { GalleryLocalAutoPostRunner } from "@/components/gallery/GalleryLocalAutoPostRunner";

const SETTINGS_DOC_ID = "server_auto_ocr";

type AutoOcrSettings = {
  enabled: boolean;
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
  checkDuplicateVouchers: boolean;
  duplicateVoucherAction: "move-to-duplicates" | "pause-for-review" | "save-anyway";
};

const DEFAULT_SETTINGS: AutoOcrSettings = {
  enabled: false,
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
  checkDuplicateVouchers: true,
  duplicateVoucherAction: "move-to-duplicates",
};

const SCAN_ENGINES = {
  gemini: { name: "Pocket AI (Gemini)", provider: "gemini" },
  google: { name: "Google Cloud Vision", provider: "google" },
  azure: { name: "Azure Vision", provider: "azure" },
} as const;

const LOCAL_INFO = {
  en: "Local PC runs OCR on this device. The app and internet must stay available; if this PC is offline, Auto post pauses and pending files wait. Only the company admin account and this saved device can run it.",
  hi: "Local PC चुनने पर OCR इसी कंप्यूटर पर चलेगा। App और internet चालू रहना चाहिए; PC offline होने पर Auto post रुक जाएगा और files pending रहेंगी। इसे केवल company admin account और यह saved device चला सकते हैं।",
  ne: "Local PC छान्दा OCR यही कम्प्युटरमा चल्छ। App र internet उपलब्ध हुनुपर्छ; PC offline हुँदा Auto post रोकिन्छ र files pending रहन्छन्। Company admin account र यही saved device ले मात्र चलाउन सक्छ।",
} as const;

const MISSING_FIELDS_COPY = {
  en: {
    title: "Block vouchers with missing required fields",
    description: "This safeguard is always on. If any required field or master is missing, no voucher is created and the document is sent to the Auto post failed Tab for review.",
  },
  hi: {
    title: "ज़रूरी जानकारी अधूरी हो तो voucher रोकें",
    description: "यह सुरक्षा हमेशा चालू रहती है। कोई ज़रूरी field या master न मिलने पर voucher नहीं बनेगा और document जाँच के लिए Auto post failed Tab में भेज दिया जाएगा।",
  },
  ne: {
    title: "आवश्यक विवरण अपूरो भए voucher रोक्नुहोस्",
    description: "यो सुरक्षा सधैँ चालु रहन्छ। कुनै आवश्यक field वा master नभेटिए voucher बन्ने छैन र document जाँचका लागि Auto post failed Tab मा पठाइनेछ।",
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
  const localDeviceId = useMemo(() => getOrCreateClientDeviceId(), []);
  const [settings, setSettings] = useState<AutoOcrSettings>(DEFAULT_SETTINGS);
  const [settingsLoadedFor, setSettingsLoadedFor] = useState("");
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
    void getDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID))
      .then((snapshot) => {
        if (cancelled) return;
        setSettings(normalizeSettings(snapshot.exists() ? snapshot.data() : DEFAULT_SETTINGS));
        setSettingsLoadedFor(fsId);
      })
      .catch((err) => {
        if (!cancelled) {
          setSettings(DEFAULT_SETTINGS);
          setSettingsLoadedFor(fsId);
          setError(err instanceof Error ? err.message : "Could not load settings.");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fsId]);

  const isCompanyAdmin = useMemo(() => {
    const uid = String(user?.uid || "");
    if (!uid || !company) return false;
    if (String((company as any).ownerId || (company as any).owner || "") === uid) return true;
    const members = Array.isArray((company as any).sharedWith) ? (company as any).sharedWith : [];
    return members.some((member: any) => String(member?.uid || member?.userId || "") === uid && ["admin", "CompanyAdmin", "SuperAdmin"].includes(String(member?.role || "")));
  }, [company, user?.uid]);

  const patch = (next: Partial<AutoOcrSettings>) => setSettings((current) => ({ ...current, ...next }));

  const save = async () => {
    if (!fsId || !user?.uid || !isCompanyAdmin) return;
    if (settings.enabled && settings.runOnSchedule && settings.scheduleMode === "date-time" && (!settings.scheduleDate || !settings.scheduleTime)) {
      setError("Choose both a date and time for the scheduled scan.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const settingsToSave = {
        ...settings,
        localRunnerUid: settings.runLocation === "local-pc" ? user.uid : settings.localRunnerUid,
        localRunnerDeviceId: settings.runLocation === "local-pc" ? localDeviceId : settings.localRunnerDeviceId,
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

  return (
    <>
    <GalleryLocalAutoPostRunner settings={settings} settingsDialogOpen={open} isCompanyAdmin={isCompanyAdmin} settingsReady={settingsLoadedFor === fsId && !!fsId} />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Auto post settings</DialogTitle>
          <DialogDescription>Choose where Auto post scans Unassigned documents and creates vouchers.</DialogDescription>
        </DialogHeader>

        {!isCompanyAdmin ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Only a company owner or admin can change these settings.</div>
        ) : loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading settings…</div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-xl border bg-background/80 p-3 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md">
              <SettingToggle icon={<Bot className="h-4 w-4" />} title="Enable Auto post vouchers" checked={settings.enabled} onChange={(enabled) => patch({ enabled })} />
              <p className="mt-1 pl-8 text-xs text-muted-foreground">Automatically create unapproved vouchers from matching documents.</p>
            </section>

            <section className="space-y-3 rounded-xl border bg-background/80 p-3 shadow-sm">
              <div className="text-sm font-semibold">Run Auto post on</div>
              <RadioGroup value={settings.runLocation} onValueChange={(runLocation) => patch({ runLocation: runLocation as AutoOcrSettings["runLocation"] })} disabled={!settings.enabled} className="grid gap-2 sm:grid-cols-2">
                <label htmlFor="auto-ocr-local-pc" className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm"><RadioGroupItem id="auto-ocr-local-pc" value="local-pc" /><Monitor className="h-4 w-4" /><span>Local PC</span></label>
                <label htmlFor="auto-ocr-server" className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-sm"><RadioGroupItem id="auto-ocr-server" value="server" /><Server className="h-4 w-4" /><span>Server</span></label>
              </RadioGroup>
              {settings.runLocation === "local-pc" ? <div className="rounded-md border border-sky-200 bg-sky-50 p-2.5 text-xs leading-relaxed text-sky-950">{LOCAL_INFO[introLang]}{settings.localRunnerDeviceId && (settings.localRunnerUid !== user?.uid || settings.localRunnerDeviceId !== localDeviceId) ? <div className="mt-2 font-semibold">This setting is bound to a different admin account/device. Save Local PC here to move the runner to this device.</div> : null}</div> : <div className="rounded-md border bg-muted/50 p-2.5 text-xs text-muted-foreground">Server mode needs the Pocket Ledger Server Auto OCR worker enabled; the app does not run scans on this PC in this mode.</div>}
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

            <section hidden={settings.runLocation === "local-pc"} className="space-y-3 rounded-xl border border-indigo-300 bg-gradient-to-br from-indigo-100 via-sky-50 to-violet-100 p-3 shadow-[0_5px_14px_rgba(49,46,129,0.18)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_10px_22px_rgba(49,46,129,0.24)]">
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
                <p className="mt-2 text-xs text-muted-foreground">Limit applies to this company. The server’s engine safety limit may be lower.</p>
              </div>
              <p className="rounded-lg border border-indigo-200 bg-white/80 p-2.5 text-xs text-muted-foreground shadow-[0_2px_6px_rgba(30,41,59,0.1)]">Automatically created vouchers remain unapproved. Use the safeguard card below to choose how incomplete scans are handled.</p>
            </section>

            <section className="rounded-xl border border-amber-300 bg-gradient-to-br from-amber-100 via-orange-50 to-rose-100 p-3 shadow-[0_5px_14px_rgba(154,52,18,0.17)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_10px_22px_rgba(154,52,18,0.23)]">
              <div className="rounded-lg border border-amber-200 bg-white/90 p-2.5 shadow-[0_2px_6px_rgba(30,41,59,0.12)]">
                <SettingToggle
                  title={MISSING_FIELDS_COPY[introLang].title}
                  checked
                  onChange={() => {}}
                  disabled
                />
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {MISSING_FIELDS_COPY[introLang].description.split("Auto post failed Tab")[0]}
                  <span className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded-md border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-sm font-semibold leading-none text-rose-800 shadow-sm">Auto post failed</span>
                  {MISSING_FIELDS_COPY[introLang].description.split("Auto post failed Tab")[1]}
                </p>
              </div>
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

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {isCompanyAdmin && <Button type="button" onClick={() => void save()} disabled={loading || saving || !fsId}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
