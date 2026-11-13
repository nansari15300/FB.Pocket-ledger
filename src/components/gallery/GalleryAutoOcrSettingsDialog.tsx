"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, Bot, Clock3, Gauge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { getDoc } from "@/lib/pocketbaseData/pbReadSeam";
import { setDoc } from "@/lib/writeGateway/pbWrites";
import { firestore } from "@/lib/plClientSession";

const SETTINGS_DOC_ID = "server_auto_ocr";

type AutoOcrSettings = {
  enabled: boolean;
  runOnUpload: boolean;
  runOnSchedule: boolean;
  scheduleMinutes: number;
  maxCallsPerMinute: number;
  createUnapprovedVoucher: boolean;
};

const DEFAULT_SETTINGS: AutoOcrSettings = {
  enabled: false,
  runOnUpload: true,
  runOnSchedule: false,
  scheduleMinutes: 5,
  maxCallsPerMinute: 5,
  createUnapprovedVoucher: true,
};

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
    scheduleMinutes: bounded(value.scheduleMinutes, DEFAULT_SETTINGS.scheduleMinutes, 1, 1440),
    maxCallsPerMinute: bounded(value.maxCallsPerMinute, DEFAULT_SETTINGS.maxCallsPerMinute, 1, 15),
    createUnapprovedVoucher: value.createUnapprovedVoucher !== false,
  };
}

function resolveCompanyId(companyId: string, company: { authoritativeCompanyId?: string } | null | undefined) {
  return String(company?.authoritativeCompanyId || companyId).trim() || companyId;
}

export function GalleryAutoOcrSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { company, companyId } = useCompany();
  const { user } = useAuth();
  const [settings, setSettings] = useState<AutoOcrSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fsId = useMemo(() => companyId ? resolveCompanyId(companyId, company) : "", [companyId, company]);

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
    setSaving(true);
    setError(null);
    try {
      await setDoc(doc(firestore, `companies/${fsId}/auto_ocr_settings`, SETTINGS_DOC_ID), {
        ...settings,
        scheduleMinutes: Math.max(1, Math.min(1440, Math.round(Number(settings.scheduleMinutes) || DEFAULT_SETTINGS.scheduleMinutes))),
        maxCallsPerMinute: Math.max(1, Math.min(15, Math.round(Number(settings.maxCallsPerMinute) || DEFAULT_SETTINGS.maxCallsPerMinute))),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        provider: "gemini",
        providerLabel: "Pocket AI",
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
          <DialogDescription>Unassigned files can be read by Pocket AI on the Pocket Ledger Server while this app is closed.</DialogDescription>
        </DialogHeader>

        {!isCompanyAdmin ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Only a company owner or admin can change these settings.</div>
        ) : loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading settings…</div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-xl border p-3">
              <SettingToggle icon={<Bot className="h-4 w-4" />} title="Enable server Auto OCR" checked={settings.enabled} onChange={(enabled) => patch({ enabled })} />
              <p className="mt-1 pl-8 text-xs text-muted-foreground">New and scheduled scans are processed by Pocket AI (Gemini); no browser needs to stay open.</p>
            </section>

            <section className="space-y-3 rounded-xl border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4" />When to scan</div>
              <SettingToggle title="As soon as a file arrives" checked={settings.runOnUpload} onChange={(runOnUpload) => patch({ runOnUpload })} disabled={!settings.enabled} />
              <SettingToggle title="Scan on a schedule" checked={settings.runOnSchedule} onChange={(runOnSchedule) => patch({ runOnSchedule })} disabled={!settings.enabled} />
              {settings.runOnSchedule && <NumberSetting label="Run every (minutes)" value={settings.scheduleMinutes} min={1} max={1440} onChange={(scheduleMinutes) => patch({ scheduleMinutes })} disabled={!settings.enabled} />}
            </section>

            <section className="space-y-3 rounded-xl border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4" />Usage and voucher saving</div>
              <NumberSetting label="Maximum Gemini calls per minute" value={settings.maxCallsPerMinute} min={1} max={15} onChange={(maxCallsPerMinute) => patch({ maxCallsPerMinute })} disabled={!settings.enabled} />
              <p className="text-xs text-muted-foreground">Limit applies to this company. Server’s Gemini safety limits may be lower.</p>
              <SettingToggle title="Create a voucher automatically" checked={settings.createUnapprovedVoucher} onChange={(createUnapprovedVoucher) => patch({ createUnapprovedVoucher })} disabled={!settings.enabled} />
              <p className="text-xs text-muted-foreground">Created vouchers are always unapproved. If a required field or master cannot be matched, the file goes to Auto failed for review.</p>
            </section>

            <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Files stored only on this device cannot be scanned while the app is closed. The setting applies to files saved on the Pocket Ledger Server.</div>
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
