"use client";
/** Add Voucher header: OCR / Auto Post / Overwrite pills + one OCR-settings gear (dialog, when OCR is on). */
import React, { useState } from "react";
import { Settings } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCompany } from "@/hooks/useCompany";
import { cn } from "@/lib/utils";
import { OCR_SETTINGS_DIALOG_CONTENT_CN, OCR_SETTINGS_DIALOG_OVERLAY_CN } from "@/lib/dialogShellChrome";
import { AUTO_POST_SECONDS_MAX, AUTO_POST_SECONDS_MIN, clampAutoPostSeconds, setOcrPrefs, useOcrPrefs, type OcrConnectorStyle, type OcrEnginePref, type OcrNarrationStyle } from "./prefs";
import { useOcrPlanAllowed } from "./gate";
import { ocrCloud, ocrCloudErrorText, useOcrCloudStatus } from "./cloud/ocrCloudClient";

function Pill({ id, label, checked, onChange, title, extra }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; title: string; extra?: React.ReactNode }) {
  return (
    <label htmlFor={id} title={title} className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-slate-400/50 bg-white/70 px-2 text-xs font-medium text-slate-800 dark:bg-slate-900/60 dark:text-slate-100">
      <span className="whitespace-nowrap">{label}</span>
      <Switch id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="scale-75" />
      {extra}
    </label>
  );
}

function SecondsRow({ id, label, draft, setDraft, onCommit, onOk, disabled }: { id: string; label: string; draft: string; setDraft: (v: string) => void; onCommit: () => void; onOk: () => void; disabled?: boolean }) {
  return (
    <>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          min={AUTO_POST_SECONDS_MIN}
          max={AUTO_POST_SECONDS_MAX}
          step={1}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOk(); } }}
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-2 text-sm disabled:opacity-50 dark:border-slate-600"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOk(); }}
          className="h-8 shrink-0 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          OK
        </button>
      </div>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function RadioRow<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: readonly (readonly [T, string, string?])[]; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {options.map(([v, label, sub]) => (
        <label
          key={v}
          className={cn(
            "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs transition-colors",
            value === v ? "border-emerald-500 bg-emerald-50 dark:border-emerald-500/70 dark:bg-emerald-950/30" : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
          )}
        >
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} className="mt-0.5 accent-emerald-600" />
          <span>
            <span className="block font-medium">{label}</span>
            {sub ? <span className="block text-[11px] text-muted-foreground">{sub}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

function SwitchRow({ id, label, sub, checked, onChange, disabled }: { id: string; label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className={cn("min-w-0 text-xs", disabled && "opacity-50")}>
        <span className="block font-medium">{label}</span>
        {sub ? <span className="block text-[11px] text-muted-foreground">{sub}</span> : null}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
    </div>
  );
}

/** Small generated test image ("PL OCR TEST 2083") for the admin "Test" button. */
async function testImageBase64(): Promise<string> {
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 120;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#000";
  g.font = "bold 44px Arial, sans-serif";
  g.fillText("PL OCR TEST 2083", 20, 76);
  return c.toDataURL("image/jpeg", 0.9).replace(/^data:[^;,]*;base64,/, "");
}

const GOOGLE_KEY_URL = "https://console.cloud.google.com/apis/credentials";
const GOOGLE_VISION_URL = "https://console.cloud.google.com/apis/library/vision.googleapis.com";

function GoogleOcrSection({ companyId, open, enginePref }: { companyId: string | null; open: boolean; enginePref: OcrEnginePref }) {
  const { status, error, loading, reload } = useOcrCloudStatus(companyId, open);
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const act = async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name);
    setMsg(null);
    try {
      const t = await fn();
      if (t) setMsg({ ok: true, text: t });
    } catch (e) {
      setMsg({ ok: false, text: ocrCloudErrorText(e) });
    } finally {
      setBusy(null);
    }
  };
  const engineRadio = (
    <RadioRow
      name="pl-ocr-engine"
      value={enginePref}
      onChange={(v) => setOcrPrefs({ engine: v })}
      options={[
        ["auto", "Auto", "Google when available, else offline"],
        ["offline", "Offline only", "Always this device (tesseract)"],
      ] as const}
    />
  );
  const hint = "Google Cloud Vision reads handwriting and Nepali much better. Needs internet; offline OCR is always the fallback.";
  if (!companyId) return <Section title="Google Online OCR" hint={hint}><p className="text-xs text-muted-foreground">Select a company first.</p>{engineRadio}</Section>;
  if (loading && !status) return <Section title="Google Online OCR" hint={hint}><p className="text-xs text-muted-foreground">Checking online OCR status…</p>{engineRadio}</Section>;
  if (!status) {
    return (
      <Section title="Google Online OCR" hint={hint}>
        <div className="flex items-center justify-between gap-2 rounded-md bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800">
          <span>Online OCR status unavailable{error ? `: ${error}` : ""}. Offline OCR is used.</span>
          <button type="button" onClick={reload} className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-white dark:hover:bg-slate-700">Retry</button>
        </div>
        {engineRadio}
      </Section>
    );
  }
  if (!status.serverOcrEnabled) {
    return (
      <Section title="Google Online OCR" hint={hint}>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Online OCR is disabled by the server. Offline OCR works as usual.</p>
      </Section>
    );
  }
  if (!status.isAdmin) {
    // shared user: status only, never any key information
    return (
      <Section title="Google Online OCR" hint={hint}>
        <p className={cn("rounded-md px-3 py-2 text-xs", status.canUse ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300")}>
          {status.canUse ? "Enabled for you in this company." : "Not enabled for you in this company. Ask the company admin. Offline OCR is used."}
        </p>
        {status.canUse ? engineRadio : null}
      </Section>
    );
  }
  const users = status.sharedUsers ?? [];
  return (
    <Section
      title="Google Online OCR"
      hint={<>{hint} Only you (admin) can see or change the key. <a href={GOOGLE_VISION_URL} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline dark:text-emerald-400">Enable Vision API</a> · <a href={GOOGLE_KEY_URL} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline dark:text-emerald-400">Create API key</a></>}
    >
      <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium">Google Vision API key</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", status.hasKey ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
            {status.hasKey ? `Saved ••••${status.keyLast4 ?? ""}` : "No key"}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 sm:flex-row">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={status.hasKey ? "Paste a new key to replace" : "Paste API key (AIza…)"}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-600"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={!keyDraft.trim() || !!busy}
              onClick={() => act("save", async () => { await ocrCloud.saveKey(keyDraft.trim()); setKeyDraft(""); return "Key saved on the server."; })}
              className="h-9 flex-1 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 sm:flex-none"
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={!status.hasKey || !!busy}
              title={status.companyEnabled ? "Read a small test image with Google" : "Enable Google OCR for this company first"}
              onClick={() => act("test", async () => {
                const r = await ocrCloud.vision(companyId, await testImageBase64());
                const t = String(r?.text ?? "").replace(/\s+/g, " ").trim();
                if (!t) throw new Error("Google returned no text");
                return `Test OK - Google read: "${t.slice(0, 60)}"`;
              })}
              className="h-9 flex-1 rounded-md border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800 sm:flex-none"
            >
              {busy === "test" ? "Testing…" : "Test"}
            </button>
          </div>
        </div>
        {status.hasKey ? (
          confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-900 dark:bg-red-950/40 dark:text-red-200">
              <span className="flex-1">Delete the saved key? Google OCR stops for every company using it.</span>
              <button type="button" disabled={!!busy} onClick={() => act("delete", async () => { await ocrCloud.deleteKey(); setConfirmDelete(false); return "Key deleted."; })} className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {busy === "delete" ? "Deleting…" : "Delete"}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md border px-2.5 py-1 text-[11px] font-medium">Cancel</button>
            </div>
          ) : (
            <button type="button" disabled={!!busy} onClick={() => setConfirmDelete(true)} className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400">Delete key</button>
          )
        ) : null}
        <p className="text-[11px] text-muted-foreground">Tip: in Google Cloud restrict the key to &quot;Cloud Vision API&quot; only and set a budget alert / daily quota. About 1000 images a month are free.</p>
      </div>
      <SwitchRow
        id="pl-ocr-google-company"
        label="Enable Google OCR for this company"
        sub={status.hasKey ? undefined : "Save a key first"}
        checked={status.companyEnabled}
        disabled={!!busy || !status.hasKey}
        onChange={(v) => act("company", async () => { await ocrCloud.setCompany({ company: companyId, enabled: v }); })}
      />
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Shared users of this company</p>
        {users.length ? (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {users.map((u) => (
              <li key={u.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-xs">
                  {u.name || u.email || u.userId}
                  {u.name && u.email ? <span className="ml-1 text-[11px] text-muted-foreground">{u.email}</span> : null}
                </span>
                <Switch
                  checked={u.allowed}
                  disabled={!!busy || !status.companyEnabled}
                  aria-label={`Allow Google OCR for ${u.name || u.email || u.userId}`}
                  onCheckedChange={(v) => act(`user:${u.userId}`, async () => { await ocrCloud.setCompany({ company: companyId, sharedUserId: u.userId, allowed: v === true }); })}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">No shared users in this company.</p>
        )}
        <p className="text-[11px] text-muted-foreground">Allowed users use your key for this company only. They never see the key.</p>
      </div>
      {msg ? <p className={cn("rounded-md px-3 py-2 text-xs", msg.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200")}>{msg.text}</p> : null}
      <div className="space-y-1.5 pt-1">
        <p className="text-xs font-medium">OCR engine on this device</p>
        {engineRadio}
      </div>
    </Section>
  );
}

function OcrSettingsGear({
  connectorStyle, narrationStyle, autoPost, overwriteEdited, seconds, switchOn, switchSeconds, enginePref, companyId,
}: {
  connectorStyle: OcrConnectorStyle;
  narrationStyle: OcrNarrationStyle;
  autoPost: boolean;
  overwriteEdited: boolean;
  seconds: number;
  switchOn: boolean;
  switchSeconds: number;
  enginePref: OcrEnginePref;
  companyId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(seconds));
  const [swDraft, setSwDraft] = useState(String(switchSeconds));
  const commit = () => { const v = clampAutoPostSeconds(draft); setOcrPrefs({ autoPostSeconds: v }); setDraft(String(v)); };
  const commitSw = () => { const v = clampAutoPostSeconds(swDraft); setOcrPrefs({ autoSwitchSeconds: v }); setSwDraft(String(v)); };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) { setDraft(String(seconds)); setSwDraft(String(switchSeconds)); } else { commit(); commitSw(); } }}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="OCR settings"
          aria-label="OCR settings"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-400/50 bg-white/70 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          // 60% of the screen wide, 80% of the screen tall (small screens keep a safe inset).
          "flex h-[80vh] max-h-[80vh] w-[60vw] max-w-[60vw] min-w-[min(100vw-1.5rem,360px)] flex-col gap-0 overflow-hidden p-0",
          "max-sm:h-[calc(100vh-1.5rem)] max-sm:max-h-[calc(100vh-1.5rem)] max-sm:w-[calc(100vw-1.5rem)] max-sm:max-w-[calc(100vw-1.5rem)] max-sm:min-w-0",
          OCR_SETTINGS_DIALOG_CONTENT_CN
        )}
        overlayClassName={OCR_SETTINGS_DIALOG_OVERLAY_CN}
        data-ocr-settings-open="1"
        onClick={(e) => e.stopPropagation()}
        aria-describedby={undefined}
      >
        <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 text-left dark:border-slate-700">
          <DialogTitle className="text-base">OCR settings</DialogTitle>
          <p className="text-xs text-muted-foreground">How bills are read and filled on this device.</p>
        </DialogHeader>
        <div className="min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto overscroll-contain dark:divide-slate-700">
          <GoogleOcrSection companyId={companyId} open={open} enginePref={enginePref} />
          <Section title="Field popups" hint="How a popup points at its field.">
            <RadioRow
              name="pl-ocr-connector"
              value={connectorStyle}
              onChange={(v) => setOcrPrefs({ connectorStyle: v })}
              options={[["tail", "Speech-bubble tail"], ["line", "Straight arrow line"]] as const}
            />
          </Section>
          <Section title="Narration" hint={<>Short example: Bill No SI-00780 Pur from Party on date. Sale uses &quot;Sale to&quot;.</>}>
            <RadioRow
              name="pl-ocr-narration"
              value={narrationStyle}
              onChange={(v) => setOcrPrefs({ narrationStyle: v })}
              options={[["full", "Full", "With item names"], ["short", "Short", "Bill no, party, date"]] as const}
            />
          </Section>
          <Section title="Auto save" hint={`${AUTO_POST_SECONDS_MIN}-${AUTO_POST_SECONDS_MAX}s. Saves after OCR unless cancelled (always UNAPPROVED).`}>
            <SwitchRow id="pl-ocr-settings-autopost" label="Auto Post" checked={autoPost} onChange={(v) => setOcrPrefs({ autoPost: v })} />
            <SwitchRow id="pl-ocr-settings-overwrite" label="Overwrite edited" sub="Refresh re-fills fields you edited by hand too" checked={overwriteEdited} onChange={(v) => setOcrPrefs({ overwriteEdited: v })} />
            <SecondsRow id="pl-ocr-autopost-secs" label="Auto save countdown (seconds)" draft={draft} setDraft={setDraft} onCommit={commit} onOk={commit} />
          </Section>
          <Section title="Voucher type" hint={switchOn ? "Wrong voucher type: switches automatically after the countdown." : "Off: shows a plain Switch button, no auto change."}>
            <SwitchRow id="pl-ocr-autoswitch" label="Auto voucher change" checked={switchOn} onChange={(v) => setOcrPrefs({ autoSwitchVoucher: v })} />
            <SecondsRow id="pl-ocr-autoswitch-secs" label="Switch countdown (seconds)" draft={swDraft} setDraft={setSwDraft} onCommit={commitSw} onOk={commitSw} disabled={!switchOn} />
          </Section>
        </div>
        <div className="flex shrink-0 justify-end border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <button type="button" onClick={() => { commit(); commitSw(); setOpen(false); }} className="h-9 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">Done</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VoucherOcrHeaderToggles({ className }: { className?: string }) {
  const allowed = useOcrPlanAllowed();
  const p = useOcrPrefs();
  const { companyId } = useCompany();
  if (!allowed) return null;
  const style: OcrConnectorStyle = p.connectorStyle === "line" ? "line" : "tail";
  const narrationStyle: OcrNarrationStyle = p.narrationStyle === "short" ? "short" : "full";
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)} data-pl-ocr-header-toggles="">
      <Pill
        id="pl-ocr-enabled"
        label={p.enabled ? "OCR" : "OCR Off"}
        checked={p.enabled}
        onChange={(v) => setOcrPrefs({ enabled: v })}
        title={p.enabled ? "OCR Enabled - bill is read when the first file is attached" : "OCR Disabled"}
      />
      {p.enabled ? (
        <>
          <OcrSettingsGear
            connectorStyle={style}
            narrationStyle={narrationStyle}
            autoPost={p.autoPost}
            overwriteEdited={p.overwriteEdited}
            seconds={clampAutoPostSeconds(p.autoPostSeconds)}
            switchOn={p.autoSwitchVoucher !== false}
            switchSeconds={clampAutoPostSeconds(p.autoSwitchSeconds)}
            enginePref={p.engine === "offline" ? "offline" : "auto"}
            companyId={companyId ?? null}
          />
          <Pill
            id="pl-ocr-autopost"
            label="Auto Post"
            checked={p.autoPost}
            onChange={(v) => setOcrPrefs({ autoPost: v })}
            title="Save automatically after OCR (always UNAPPROVED)"
          />
          <Pill id="pl-ocr-overwrite" label="Overwrite edited" checked={p.overwriteEdited} onChange={(v) => setOcrPrefs({ overwriteEdited: v })} title="Refresh re-fills fields you edited by hand too" />
        </>
      ) : null}
    </div>
  );
}
