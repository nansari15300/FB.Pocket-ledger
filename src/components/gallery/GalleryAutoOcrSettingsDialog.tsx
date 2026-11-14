"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, Bot, Clock3, Gauge, Loader2 } from "lucide-react";
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

const SETTINGS_DOC_ID = "server_auto_ocr";

type AutoOcrSettings = {
  enabled: boolean;
  runOnUpload: boolean;
  runOnSchedule: boolean;
  scheduleMode: "interval" | "date-time";
  scheduleMinutes: number;
  scheduleDate: string;
  scheduleTime: string;
  scanEngine: "gemini" | "google" | "azure";
  maxCallsPerMinute: number;
  failOnMissingFields: boolean;
};

const DEFAULT_SETTINGS: AutoOcrSettings = {
  enabled: false,
  runOnUpload: true,
  runOnSchedule: false,
  scheduleMode: "interval",
  scheduleMinutes: 5,
  scheduleDate: "",
  scheduleTime: "",
  scanEngine: "gemini",
  maxCallsPerMinute: 5,
  failOnMissingFields: true,
};

const SCAN_ENGINES = {
  gemini: { name: "Pocket AI (Gemini)", provider: "gemini" },
  google: { name: "Google Cloud Vision", provider: "google" },
  azure: { name: "Azure Vision", provider: "azure" },
} as const;

const INTRO_COPY = {
  en: "Unassigned files can be processed by Pocket AI on the Pocket Ledger Server, whether this app is open or closed. Choose when files are scanned and whether matching vouchers are created automatically.",
  hi: "इस ऐप के खुले या बंद रहने पर भी, Pocket AI Pocket Ledger Server पर मौजूद Unassigned files को process कर सकता है। चुनें कि files कब scan हों और matching vouchers अपने आप बनाए जाएँ या नहीं।",
  ne: "यो app खुला वा बन्द हुँदा पनि Pocket AI ले Pocket Ledger Server मा रहेका Unassigned files प्रक्रिया गर्न सक्छ। Files कहिले scan गर्ने र मिल्ने vouchers स्वतः बनाउने कि नबनाउने छान्नुहोस्।",
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

function normalizeSettings(raw: unknown): AutoOcrSettings {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const bounded = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
  };
  return {
    enabled: value.enabled === true,
    runOnUpload: value.runOnUpload !== false,
    runOnSchedule: value.runOnSchedule === true,
    scheduleMode: value.scheduleMode === "date-time" ? "date-time" : "interval",
    scheduleMinutes: bounded(value.scheduleMinutes, DEFAULT_SETTINGS.scheduleMinutes, 1, 1440),
    scheduleDate: typeof value.scheduleDate === "string" ? value.scheduleDate : "",
    scheduleTime: typeof value.scheduleTime === "string" ? value.scheduleTime : "",
    scanEngine: value.scanEngine === "google" || value.scanEngine === "azure" ? value.scanEngine : "gemini",
    maxCallsPerMinute: bounded(value.maxCallsPerMinute, DEFAULT_SETTINGS.maxCallsPerMinute, 1, 15),
    failOnMissingFields: true,
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
  const [settings, setSettings] = useState<AutoOcrSettings>(DEFAULT_SETTINGS);
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
    if (!open || !fsId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID))
      .then((snapshot) => {
        if (cancelled) return;
        setSettings(normalizeSettings(snapshot.exists() ? snapshot.data() : DEFAULT_SETTINGS));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load settings.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, fsId]);

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
      await setDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), {
        ...settings,
        scheduleMinutes: Math.max(1, Math.min(1440, Math.round(Number(settings.scheduleMinutes) || DEFAULT_SETTINGS.scheduleMinutes))),
        scheduleTimeZone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
        maxCallsPerMinute: Math.max(1, Math.min(15, Math.round(Number(settings.maxCallsPerMinute) || DEFAULT_SETTINGS.maxCallsPerMinute))),
        failOnMissingFields: true,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        provider: SCAN_ENGINES[settings.scanEngine].provider,
        providerLabel: SCAN_ENGINES[settings.scanEngine].name,
        saveApproved: false,
      }, { merge: true });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Server Auto OCR settings</DialogTitle>
          <DialogDescription>{INTRO_COPY[introLang]}</DialogDescription>
        </DialogHeader>

        {!isCompanyAdmin ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Only a company owner or admin can change these settings.</div>
        ) : loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading settings…</div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-xl border bg-background/80 p-3 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md">
              <SettingToggle icon={<Bot className="h-4 w-4" />} title="Enable Auto post vouchers" checked={settings.enabled} onChange={(enabled) => patch({ enabled })} />
              <p className="mt-1 pl-8 text-xs text-muted-foreground">New and scheduled scans are processed by Pocket AI (Gemini); no browser needs to stay open.</p>
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

            <div className="flex items-start gap-2 rounded-lg border bg-muted/60 p-3 text-xs text-muted-foreground shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Files stored only on this device cannot be scanned while the app is closed. The setting applies to files saved on the Pocket Ledger Server.</div>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {isCompanyAdmin && <Button type="button" onClick={() => void save()} disabled={loading || saving || !fsId}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
