"use client";
/** Add Voucher header: 4-position OCR mode pill (Off / Manual / Semi / Full Auto) + settings gear. */
import React, { useEffect, useState } from "react";
import { Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { useCompany } from "@/hooks/useCompany";
import { cn } from "@/lib/utils";
import { AUTO_POST_SECONDS_MAX, AUTO_POST_SECONDS_MIN, clampAutoPostSeconds, setOcrPrefs, useOcrPrefs, type OcrConnectorStyle, type OcrNarrationStyle, type OcrPrefs } from "./prefs";
import { useOcrPlanAllowed } from "./gate";
import { VoucherOcrModeSwitch } from "./VoucherOcrModeSwitch";
import { useVoucherOcrDialogMode } from "./useVoucherOcrDialogMode";
import { ocrCloud, ocrCloudErrorText, useOcrCloudStatus } from "./cloud/ocrCloudClient";
import { invalidateOcrOwnAliases } from "./ownAliases";
import { deleteOcrAiKey, invalidateOcrAiStatus, listOcrAiAliases, looksLikeGeminiKeyInput, ocrAiErrorText, removeOcrAiAlias, saveOcrAiAliases, saveOcrAiKey, useOcrAiStatus, type OcrAiAliasKind, type OcrAiAliasesList } from "./ai/aiClient";
import { AiChatButton } from "./ai/AiChatDialog";
import { useAiChatStrings } from "./ai/aiChatStrings";

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
          style={{ width: "4.5rem" }}
          className="h-8 min-w-0 rounded-md border border-slate-300 bg-transparent px-2 text-sm disabled:opacity-50 dark:border-slate-600"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOk(); }}
          className="h-8 shrink-0 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          OK
        </button>
      </div>
    </>
  );
}


/** OCR settings look: gray body + raised ("3D") cards that lift on hover. Plain CSS in a scoped <style>
 *  (tailwind.config does not scan src/modules, so arbitrary classes here would never be generated). */
const OCR_CARD_CSS = `
.pl-ocr-body{background:#e5e7eb;}
.dark .pl-ocr-body{background:#0b1120;}
.pl-ocr-card{background:linear-gradient(180deg,#ffffff 0%,#f8fafc 100%);border:1px solid rgba(15,23,42,.08);border-radius:14px;box-shadow:0 1px 2px rgba(15,23,42,.06),0 4px 10px -2px rgba(15,23,42,.10),0 12px 24px -12px rgba(15,23,42,.18);transition:transform 180ms ease,box-shadow 180ms ease;}
.pl-ocr-card:hover{transform:translateY(-3px);box-shadow:0 2px 4px rgba(15,23,42,.08),0 10px 20px -4px rgba(15,23,42,.16),0 22px 40px -14px rgba(15,23,42,.28);}
.dark .pl-ocr-card{background:linear-gradient(180deg,#1e293b 0%,#172033 100%);border-color:rgba(148,163,184,.18);box-shadow:0 1px 2px rgba(0,0,0,.4),0 6px 14px -4px rgba(0,0,0,.5);}
.dark .pl-ocr-card:hover{box-shadow:0 2px 4px rgba(0,0,0,.45),0 14px 28px -8px rgba(0,0,0,.65);}
.pl-ocr-off{opacity:.5;pointer-events:none;user-select:none;}
.pl-ocr-off .pl-ocr-card,.pl-ocr-off .pl-ocr-card:hover{transform:none;}
.pl-ocr-body{container-type:inline-size;}
.pl-ocr-stack{display:flex;flex-direction:column;gap:14px;}
.pl-ocr-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;align-items:stretch;}
@container (min-width: 520px){.pl-ocr-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
@media (min-width: 1024px){[data-pl-ocr-settings-wide]{width:max(30vw,600px)!important;max-width:min(max(30vw,600px),calc(100vw - 1.5rem))!important;}}
@media (prefers-reduced-motion: reduce){.pl-ocr-card{transition:none;}.pl-ocr-card:hover{transform:none;}}
`;

/** One settings card. flat = heading only (its children are their own cards, e.g. Online OCR for the admin). */
function Section({ title, hint, children, flat, action }: { title: string; hint?: React.ReactNode; children: React.ReactNode; flat?: boolean; action?: React.ReactNode }) {
  return (
    <section className={flat ? "pl-ocr-stack" : "pl-ocr-card space-y-3 p-4"}>
      {/* flat: the header (title + (i) + action) is its own card */}
      <div className={cn("flex items-center justify-between gap-3", flat && "pl-ocr-card px-4 py-3")}>
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <span className="truncate">{title}</span>
          {hint ? <OcrInfo label={title}>{hint}</OcrInfo> : null}
        </h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** (i) help: same icon as the app (AppFreshInfoButton); opens on click / tap, and on mouse hover. Inline z-index: above the
 *  OCR settings dialog (2147483000); the shared AttachmentPdfOptionHelpPopover uses z-[10050] and would open behind it. */
function OcrInfo({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <AppFreshInfoButton
          size="sm"
          className={cn(open && "border-blue-400 bg-blue-200/80 text-blue-400")}
          aria-label={label}
          aria-expanded={open}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") setOpen(true); }}
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        collisionPadding={12}
        style={{ zIndex: 2147483003, maxWidth: "min(22rem, calc(100vw - 2rem))" }}
        className="p-3 text-xs font-normal leading-relaxed text-foreground"
        data-pl-intro=""
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setOpen(false); }}
      >
        <p className="mb-1.5 text-sm font-semibold">{label}</p>
        <div className="space-y-2 text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

/** fill = one wrapping row whose boxes share the width equally (2 / 3 / 4 per row); titles = hover tooltip per option. */
/** compact = rows may wrap; boxes grow to fill each row (sizes differ); text inside a box never wraps (~5px side padding). */
function RadioRow<T extends string>({ name, value, options, onChange, disabledValues, fill, titles, compact }: { name: string; value: T; options: readonly (readonly [T, string, string?])[]; onChange: (v: T) => void; disabledValues?: readonly T[]; fill?: boolean; titles?: Partial<Record<T, string>>; compact?: boolean }) {
  return (
    <div className={cn("flex items-start", compact ? "gap-1" : "flex-wrap gap-1.5")} style={compact ? { flexWrap: "wrap" } : undefined}>
      {options.map(([v, label, sub]) => (
        <label
          key={v}
          title={titles?.[v]}
          style={compact ? { flex: "1 1 auto", paddingLeft: 5, paddingRight: 5, gap: 4, whiteSpace: "nowrap" } : fill ? { flex: "1 1 0", minWidth: "6.25rem" } : undefined}
          className={cn(
            "inline-flex max-w-full cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
            fill || compact ? "items-center" : "w-fit",
            value === v ? "border-emerald-500 bg-emerald-50 dark:border-emerald-500/70 dark:bg-emerald-950/30" : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60",
            disabledValues?.includes(v) && "cursor-not-allowed opacity-50"
          )}
        >
          <input type="radio" name={name} checked={value === v} disabled={disabledValues?.includes(v)} onChange={() => onChange(v)} className="mt-0.5 shrink-0 accent-emerald-600" />
          <span className="min-w-0">
            <span className="block font-medium">{label}</span>
            {sub ? <span className="block text-[11px] leading-snug text-muted-foreground">{sub}</span> : null}
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
const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";

/** AI (Gemini) card inside "Online OCR": admin saves / tests / deletes the key; "Open AI chat / teaching". Company on/off + shared users = the Online OCR switch below. */
/** embedded = inside the Online OCR box (Gemini tab of the provider picker): no own border / title. */
function AiCard({ companyId, hint, children, embedded }: { companyId: string; hint?: React.ReactNode; children?: React.ReactNode; embedded?: boolean }) {
  const t = useAiChatStrings();
  return (
    <div className={embedded ? "space-y-2" : "space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-950/40"} data-pl-ocr-ai-card="">
      <div className={cn("flex flex-wrap items-center gap-2", embedded ? "justify-end" : "justify-between")}>
        {embedded ? null : <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{t.geminiTab}</span>}
        <AiChatButton companyId={companyId} label={t.openChatTeaching} className="h-7 gap-1 text-xs" />
      </div>
      {hint && !embedded ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  );
}

function AiOffHint() {
  const t = useAiChatStrings();
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-pl-ocr-ai-off="">
      {t.aiOff}
    </p>
  );
}

function AiOcrCard({ companyId, open, embedded }: { companyId: string | null; open: boolean; embedded?: boolean }) {
  const { status, error, reload } = useOcrAiStatus(companyId, open);
  const [keyDraft, setKeyDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const hint = useAiChatStrings().cardHint;
  const act = async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name);
    setMsg(null);
    try {
      const t = await fn();
      if (t) setMsg({ ok: true, text: t });
    } catch (e) {
      setMsg({ ok: false, text: ocrAiErrorText(e) });
    } finally {
      setBusy(null);
    }
  };
  if (!companyId) return null;
  if (!status) {
    return (
      <AiCard companyId={companyId} hint={hint} embedded={embedded}>
        <div className="flex items-start gap-2 rounded-md bg-slate-100 px-2 py-2 text-xs dark:bg-slate-800">
          <span className="min-w-0 flex-1 break-words text-[11px] leading-snug">{error ? `AI status unavailable: ${error}` : "Checking AI status…"}</span>
          {error ? <button type="button" onClick={reload} className="shrink-0 rounded-md border px-1.5 py-1 text-[10px] font-medium leading-none hover:bg-white dark:hover:bg-slate-700">Retry</button> : null}
        </div>
      </AiCard>
    );
  }
  if (!status.aiReady) {
    return <AiCard companyId={companyId} hint={hint} embedded={embedded}><p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">AI OCR is not installed on the server yet. Configure an online OCR provider or review the scan manually.</p></AiCard>;
  }
  if (!status.isAdmin) {
    return (
      <AiCard companyId={companyId} hint={hint} embedded={embedded}>
        <p className={cn("rounded-md px-3 py-2 text-xs", status.canUse ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300")}>
          {status.canUse ? "AI is enabled for you in this company." : "AI is not enabled for you in this company. Ask the company admin."}
        </p>
      </AiCard>
    );
  }
  const canSave = looksLikeGeminiKeyInput(keyDraft) && !busy;
  return (
    <AiCard
      companyId={companyId}
      embedded={embedded}
      hint={<>{hint} Only you (admin) can see or change the key. <a href={GEMINI_KEY_URL} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline dark:text-emerald-400">Get a Gemini API key</a></>}
    >
      {!status.companyEnabled ? <AiOffHint /> : null}
      <div className="space-y-2">
        <div className={cn("items-center justify-between gap-2 text-xs", embedded ? "hidden" : "flex")}>
          <span className="font-medium">Gemini API key</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", status.hasKey ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
            {status.hasKey ? `Gemini ••••${status.keyLast4 ?? ""}` : "No key"}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 sm:flex-row">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-pl-ocr-key-input=""
            placeholder={status.hasKey ? "Paste a new key to replace" : "Paste Gemini API key (AIza… or AQ.…)"}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-600"
          />
          <button
            type="button"
            disabled={!canSave}
            onClick={() => act("save", async () => {
              const r = await saveOcrAiKey(keyDraft.trim(), { model: modelDraft.trim() || undefined });
              setKeyDraft("");
              return `Gemini key tested and saved on the server${r.model ? ` (model ${r.model})` : ""}.`;
            })}
            className="h-9 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === "save" ? "Testing…" : "Save"}
          </button>
        </div>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={`Model (optional, now: ${status.model ?? "default"})`}
          value={modelDraft}
          onChange={(e) => setModelDraft(e.target.value)}
          className="h-8 w-full rounded-md border border-slate-300 bg-transparent px-2 text-xs dark:border-slate-600"
        />
        <p className={cn("text-[11px] text-muted-foreground", embedded && "hidden")}>Save tests the key with Google first. Google bills by tokens (document photo + our rules + the JSON answer); each scan or chat message is 1 request. The free tier has per-minute and per-day limits. The &quot;Read by&quot; badge tooltip shows the tokens used for each scan.</p>
        <p className={cn("text-[11px]", status.canUse ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
          {status.canUse ? "Ready: AI OCR can be used in this company." : !status.companyEnabled ? "Turn on \"Enable online OCR for this company\" below to use AI here." : "Not ready yet: save a Gemini key."}
        </p>
      </div>
      {msg ? <p className={cn("rounded-md px-3 py-2 text-xs", msg.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200")}>{msg.text}</p> : null}
    </AiCard>
  );
}

/**
 * "Names that are OUR company on a bank slip" — connectIPS user names, account-holder names, last digits.
 * Per company only: never shared with, or used for, another company's scans.
 */
function BankAliasesSection({ companyId, open }: { companyId: string; open: boolean }) {
  const [list, setList] = useState<OcrAiAliasesList | null>(null);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<OcrAiAliasKind>("account_holder");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open || !companyId) return;
    let alive = true;
    listOcrAiAliases(companyId)
      .then((r) => { if (alive) setList(r); })
      .catch(() => { if (alive) setList(null); });
    return () => { alive = false; };
  }, [open, companyId]);

  const add = async () => {
    const texts = draft.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    if (!texts.length || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await saveOcrAiAliases(companyId, { kind, texts });
      invalidateOcrOwnAliases(companyId);
      setList(r);
      setDraft("");
      setMsg({ ok: true, text: `${texts.length} name(s) added.` });
    } catch (e) {
      setMsg({ ok: false, text: ocrAiErrorText(e) });
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setMsg(null);
    try { setList(await removeOcrAiAlias(companyId, id)); invalidateOcrOwnAliases(companyId); }
    catch (e) { setMsg({ ok: false, text: ocrAiErrorText(e) }); }
    finally { setBusy(false); }
  };

  const mine = (list?.aliases ?? []).filter((a) => a.kind === "account_holder" || a.kind === "beneficiary");
  const digits = (list?.aliases ?? []).filter((a) => a.kind === "account_last4");

  return (
    <div className="space-y-1.5 border-t border-slate-200 pt-2 dark:border-slate-700" data-pl-ocr-bank-aliases="">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <span>Our own names on bank slips</span>
        <OcrInfo label="Our own names on bank slips">
          <p>Bank slips often print our name only as the sender (e.g. <span className="font-mono">ACCOUNTFT:Nabiullah Ansari</span>). Add it here so a bank-to-bank transfer is read as <span className="font-medium">Contra</span> instead of &quot;other&quot;.</p>
          <p>Small OCR spelling differences are matched automatically (5-10 letters off still works). Names are used only for this company.</p>
        </OcrInfo>
      </div>
      <div className="flex flex-col gap-1.5 sm:flex-row">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as OcrAiAliasKind)}
          className="h-8 shrink-0 rounded-md border border-slate-300 bg-transparent px-1.5 text-xs dark:border-slate-600"
        >
          <option value="account_holder">Account holder name</option>
          <option value="beneficiary">Beneficiary name</option>
          <option value="account_last4">Account last digits</option>
        </select>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={kind === "account_last4" ? "e.g. 013" : "e.g. Nabiullah Ansari (comma separated)"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-2 text-xs dark:border-slate-600"
        />
        <button
          type="button"
          disabled={!draft.trim() || busy || list?.canEdit === false}
          onClick={() => void add()}
          className="h-8 rounded-md border border-slate-300 px-2.5 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          {busy ? "Saving…" : "Add"}
        </button>
      </div>
      {mine.length || digits.length ? (
        <ul className="flex flex-wrap gap-1">
          {[...mine, ...digits].map((a) => (
            <li key={a.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] dark:bg-slate-800">
              <span className="text-slate-400">{a.kind === "account_last4" ? "#" : a.kind === "beneficiary" ? "recv" : "holder"}</span>
              <span className="max-w-[180px] truncate">{a.text}</span>
              {list?.canEdit !== false ? (
                <button type="button" onClick={() => void remove(a.id)} disabled={busy} title="Remove" className="text-slate-400 hover:text-red-500 disabled:opacity-40">×</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">{list ? "No names added yet." : "Loading…"}</p>
      )}
      {msg ? <p className={cn("text-[11px]", msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600")}>{msg.text}</p> : null}
    </div>
  );
}

/** Company-wide own-name matching is shared by every OCR runner, so expose it with common rules. */
export function VoucherOcrBankAliasesPanel() {
  const { companyId } = useCompany();
  const allowed = useOcrPlanAllowed();
  if (!allowed) return <p className="text-xs text-muted-foreground">OCR rules are unavailable for this plan.</p>;
  if (!companyId) return <p className="text-xs text-muted-foreground">Select a company first.</p>;
  return <BankAliasesSection companyId={companyId} open />;
}
const GOOGLE_VISION_URL = "https://console.cloud.google.com/apis/library/vision.googleapis.com";

function GoogleOcrSection({ companyId, open }: { companyId: string | null; open: boolean }) {
  const { status, error, loading, reload } = useOcrCloudStatus(companyId, open);
  const aiKey = useOcrAiStatus(companyId, open).status;
  const hasMyKey = !!(status?.hasKey || aiKey?.hasKey || aiKey?.companyHasKey);
  const hasAllowedServerKey = !!(status?.allowedKeySources?.includes("server") && status?.serverKeyProviders?.length);
  const anyKey = hasMyKey || hasAllowedServerKey;
  const [keyDraft, setKeyDraft] = useState("");
  const [provider, setProvider] = useState<"google" | "azure">("google");
  const [endpointDraft, setEndpointDraft] = useState("");
  // Picker tab "AI (Gemini)" is a VIEW only: it never changes the saved vision provider (google / azure).
  const [aiView, setAiView] = useState(false);
  const tAi = useAiChatStrings();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Saved keys card: which row's delete confirmation is open
  const [confirmDelete, setConfirmDelete] = useState<"ai" | "google" | "azure" | null>(null);
  const addKeyRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (status?.provider === "azure" || status?.provider === "google") setProvider(status.provider);
    if (status?.endpointHost) {
      setEndpointDraft((cur) => (cur.trim() ? cur : `https://${status.endpointHost}/`));
    }
  }, [status?.provider, status?.endpointHost]);
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
  const visionProvider: "google" | "azure" | null = status?.provider === "azure" ? "azure" : status?.provider === "google" ? "google" : null;
  // Masked key per provider; older servers only report the latest key (provider + keyLast4)
  const keyOf = (p: "google" | "azure") => status?.keys
    ? status.keys[p]
    : status?.hasKey && visionProvider === p ? { last4: status.keyLast4, endpointHost: status.endpointHost } : undefined;
  const hint = "Add and manage this company’s OCR provider keys here. Choose the engine separately in each runner profile.";
  const title = "Online OCR";
  if (!companyId) return <Section title={title} hint={hint}><p className="text-xs text-muted-foreground">Select a company first.</p></Section>;
  if (loading && !status) return <Section title={title} hint={hint}><p className="text-xs text-muted-foreground">Checking online OCR status…</p></Section>;
  if (!status) {
    const msg = `Online OCR status unavailable${error ? `: ${error}` : ""}. Auto and Online require an available provider.`;
    return (
      <Section title={title} hint={hint}>
        <div className="flex items-start gap-2 rounded-md bg-slate-100 px-2 py-2 text-xs dark:bg-slate-800">
          {/* Narrow block: the message wraps in the middle, Retry stays a small button on the right. */}
          <span className="min-w-0 flex-1 break-words whitespace-normal text-[11px] leading-snug">{msg}</span>
          <button type="button" onClick={reload} className="shrink-0 rounded-md border px-1.5 py-1 text-[10px] font-medium leading-none hover:bg-white dark:hover:bg-slate-700">Retry</button>
        </div>
      </Section>
    );
  }
  if (!status.serverOcrEnabled) {
    return (
      <Section title={title} hint={hint}>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Online OCR is disabled by the server. Auto and Online require an available provider.</p>
      </Section>
    );
  }
  if (!status.isAdmin) {
    // shared user: status only, never any key information
    return (
      <Section title={title} hint={hint}>
        <p className={cn("rounded-md px-3 py-2 text-xs", status.canUse ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300")}>
          {status.canUse ? "Enabled for you in this company." : "Not enabled for you in this company. Ask the company admin. Auto and Online require an available provider."}
        </p>
        <AiOcrCard companyId={companyId} open={open} />
      </Section>
    );
  }
  const users = status.sharedUsers ?? [];
  const cardsOff = !status.companyEnabled && anyKey;
  const curKey = keyOf(provider);
  // Saved keys card: Edit opens that provider's tab in "Add key" and focuses the key box
  const editKey = (id: "ai" | "google" | "azure") => {
    setConfirmDelete(null);
    if (id === "ai") setAiView(true);
    else { setAiView(false); setProvider(id); }
    window.setTimeout(() => {
      const box = addKeyRef.current;
      box?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      box?.querySelector<HTMLInputElement>("[data-pl-ocr-key-input]")?.focus();
    }, 80);
  };
  const deleteKeyOf = (id: "ai" | "google" | "azure", name: string) => act("delete", async () => {
    if (id === "ai") { await deleteOcrAiKey(); invalidateOcrAiStatus(companyId); }
    else await ocrCloud.deleteKey(undefined, id);
    setConfirmDelete(null);
    return `${name} key deleted.`;
  });
  const iconBtn = "inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100";
  const canSave = !!keyDraft.trim() && (provider === "google" || !!endpointDraft.trim()) && !busy;
  const providerLabel = provider === "azure" ? "Azure" : "Google";
  const selectedKeySource = status.keySource ?? "my";
  const keySources = status.allowedKeySources ?? ["my"];
  const serverProviders = status.serverKeyProviders ?? [];
  const canSelectMyKey = keySources.includes("my");
  const canSelectServerKey = keySources.includes("server") && serverProviders.length > 0;
  const selectKeySource = (source: "my" | "server") => {
    if (source === selectedKeySource || !!busy) return;
    void act("source", async () => {
      await ocrCloud.setCompany({ company: companyId, keySource: source });
      return `${source === "my" ? "My Key" : "Server Key"} selected for this company.`;
    });
  };
  return (
    <Section
      flat
      title={title}
      action={
        <div className="flex items-center gap-2" data-pl-ocr-company-switch="">
          <label htmlFor="pl-ocr-google-company" className={cn("text-right text-xs", (!!busy || !anyKey) && "opacity-50")} title="Enable online OCR for this company">
            <span className="block whitespace-nowrap font-medium">Enable for this company</span>
            <span className="block text-[11px] text-muted-foreground">{anyKey ? "Also used by AI (Gemini)" : "Save a key first"}</span>
          </label>
          <Switch
            id="pl-ocr-google-company"
            checked={status.companyEnabled}
            disabled={!!busy || !anyKey}
            onCheckedChange={(v) => act("company", async () => { await ocrCloud.setCompany({ company: companyId, enabled: v === true }); invalidateOcrAiStatus(companyId); })}
          />
        </div>
      }
      hint={<>{hint} Only you (admin) can see or change the key. {aiView ? null : provider === "google" ? <><a href={GOOGLE_VISION_URL} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline dark:text-emerald-400">Enable Vision API</a> · <a href={GOOGLE_KEY_URL} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline dark:text-emerald-400">Create API key</a></> : <span>Paste the Azure Computer Vision key and endpoint (https://&lt;name&gt;.cognitiveservices.azure.com/).</span>}</>}
    >
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 dark:border-slate-700 dark:bg-slate-900/50" role="tablist" aria-label="OCR key source">
        <button type="button" role="tab" aria-selected={selectedKeySource === "my"} disabled={!canSelectMyKey || !!busy} onClick={() => selectKeySource("my")} className={cn("rounded-lg px-3 py-2 text-xs font-semibold transition", selectedKeySource === "my" ? "bg-white text-slate-900 shadow dark:bg-slate-800 dark:text-white" : "text-slate-600 hover:bg-white/70 dark:text-slate-300", (!canSelectMyKey || !!busy) && "cursor-not-allowed opacity-50")}>My Key</button>
        <button type="button" role="tab" aria-selected={selectedKeySource === "server"} disabled={!canSelectServerKey || !!busy} onClick={() => selectKeySource("server")} className={cn("rounded-lg px-3 py-2 text-xs font-semibold transition", selectedKeySource === "server" ? "bg-white text-slate-900 shadow dark:bg-slate-800 dark:text-white" : "text-slate-600 hover:bg-white/70 dark:text-slate-300", (!canSelectServerKey || !!busy) && "cursor-not-allowed opacity-50")}>Server Key</button>
      </div>
      {!canSelectMyKey && selectedKeySource === "my" ? <p className="text-[11px] text-amber-700 dark:text-amber-300">This plan does not allow company-provided OCR keys. Enable that option in the plan settings or select Server Key if available.</p> : null}
      {selectedKeySource === "server" ? (
        <div className="pl-ocr-card space-y-2 p-3">
          <p className="text-xs font-medium">Server-managed OCR keys</p>
          <p className="text-[11px] text-muted-foreground">Scans use the OCR credentials configured on Pocket Ledger Server. Your company’s saved keys are not used while this option is selected.</p>
          <div className="flex flex-wrap gap-1.5">
            {(["Gemini AI", "Google OCR", "Azure OCR"] as const).map((label, i) => {
              const providerId = (["gemini", "google", "azure"] as const)[i];
              const ready = serverProviders.includes(providerId);
              return <span key={providerId} className={cn("rounded-full border px-2 py-1 text-[11px]", ready ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-slate-200 text-slate-400 dark:border-slate-700")}>{label}{ready ? " · ready" : " · not configured"}</span>;
            })}
          </div>
          {!canSelectServerKey ? <p className="text-[11px] text-amber-700 dark:text-amber-300">Server Key is unavailable. The plan must allow server OCR and the server must have at least one OCR provider configured.</p> : null}
        </div>
      ) : (
      // Switch off (and a key exists): the key-management controls are disabled; with no key yet admins can add the first key.
      <fieldset disabled={cardsOff || !canSelectMyKey} aria-disabled={cardsOff || !canSelectMyKey} className={cn("pl-ocr-stack", (cardsOff || !canSelectMyKey) && "pl-ocr-off")} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <div className="pl-ocr-card space-y-1 p-3" data-pl-ocr-saved-keys="">
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{tAi.savedKeys}</p>
        <ul>
          {([
            { id: "ai", name: tAi.geminiTab, sub: aiKey?.model ?? "", has: !!aiKey?.hasKey, last4: aiKey?.keyLast4 ?? "" },
            { id: "google", name: "Google", sub: "Cloud Vision", has: !!keyOf("google"), last4: keyOf("google")?.last4 ?? "" },
            { id: "azure", name: "Azure", sub: keyOf("azure")?.endpointHost ?? "Image Analysis Read", has: !!keyOf("azure"), last4: keyOf("azure")?.last4 ?? "" },
          ] as const).map((k, i) => (
              <li key={k.id} className="py-1.5 text-xs" style={i ? { borderTop: "1px solid rgba(148, 163, 184, 0.28)" } : undefined}>
                <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{k.name}</span>
                  {k.sub ? <span className="ml-1 text-[11px] text-muted-foreground">{k.sub}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={k.has ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" : "rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"}>{k.has ? `••••${k.last4}` : tAi.noKey}</span>
                  {/* admin only (this card is the admin view): edit / delete per provider; no key = add */}
                  <button type="button" disabled={!!busy} title={k.has ? tAi.editKeyTip : tAi.addKey} aria-label={`${k.has ? tAi.editKeyTip : tAi.addKey}: ${k.name}`} onClick={() => editKey(k.id)} className={iconBtn}>
                    {k.has ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                  {k.has ? (
                    <button type="button" disabled={!!busy} title={tAi.deleteKeyTip} aria-label={`${tAi.deleteKeyTip}: ${k.name}`} onClick={() => setConfirmDelete(confirmDelete === k.id ? null : k.id)} className={cn(iconBtn, "hover:text-red-600 dark:hover:text-red-400")}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </span>
                </div>
                {confirmDelete === k.id && k.has ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-900 dark:bg-red-950/40 dark:text-red-200">
                    <span className="flex-1">{tAi.deleteKeyAsk.replace("{name}", k.name)}</span>
                    <button type="button" disabled={!!busy} onClick={() => deleteKeyOf(k.id, k.name)} className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                      {busy === "delete" ? "…" : tAi.deleteKeyYes}
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-md border px-2.5 py-1 text-[11px] font-medium">{tAi.settingsCancel}</button>
                  </div>
                ) : null}
              </li>
          ))}
        </ul>
      </div>
      <div ref={addKeyRef} className="pl-ocr-card space-y-2 p-3" data-pl-ocr-add-key="">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium">
            {tAi.addKey}
            <OcrInfo label={tAi.addKey}>
              {aiView ? (
                <>
                  <p>{tAi.cardHint}</p>
                  <p>Save tests the key with Google first. Google bills by tokens (document photo + our rules + the JSON answer); each scan or chat message is 1 request. The free tier has per-minute and per-day limits. The &quot;Read by&quot; badge tooltip shows the tokens used for each scan.</p>
                  <p>Only you (admin) can see or change the key. <a href={GEMINI_KEY_URL} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline dark:text-emerald-400">Get a Gemini API key</a></p>
                </>
              ) : provider === "azure" ? (
                <>
                  <p>Paste the Azure Computer Vision key and endpoint (https://&lt;name&gt;.cognitiveservices.azure.com/).</p>
                  <p>Azure Free (F0): 20 calls/minute, 5,000 calls/month. Nepali / Devanagari printed text is supported. If Central India rejects Read, create the resource in a region that supports Image Analysis 4.0.</p>
                </>
              ) : (
                <>
                  <p><a href={GOOGLE_VISION_URL} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline dark:text-emerald-400">Enable Vision API</a> · <a href={GOOGLE_KEY_URL} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline dark:text-emerald-400">Create API key</a></p>
                  <p>Tip: in Google Cloud restrict the key to &quot;Cloud Vision API&quot; only and set a budget alert / daily quota. About 1000 images a month are free.</p>
                </>
              )}
            </OcrInfo>
          </span>
        </div>
        <RadioRow
          name="pl-ocr-provider"
          value={aiView ? "ai" : provider}
          onChange={(v) => {
            if (v === "ai") { setAiView(true); return; }
            setAiView(false);
            if (v === "google" || v === "azure") setProvider(v);
          }}
          options={[
            // key tabs: only choose which key box is shown (never the engine / provider)
            ["ai", tAi.keyTabGemini, tAi.geminiTabSub],
            ["google", tAi.keyTabGoogle, "Cloud Vision API"],
            ["azure", tAi.keyTabAzure, "Image Analysis Read"],
          ] as const}
        />
        {aiView ? (
          <AiOcrCard companyId={companyId} open={open} embedded />
        ) : (
          <>
        {provider === "azure" ? (
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://your-resource.cognitiveservices.azure.com/"
            value={endpointDraft}
            onChange={(e) => setEndpointDraft(e.target.value)}
            className="h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-600"
          />
        ) : null}
        <div className="flex flex-col gap-1.5 sm:flex-row">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-pl-ocr-key-input=""
            placeholder={curKey ? "Paste a new key to replace" : (provider === "azure" ? "Paste Azure subscription key" : "Paste API key (AIza…)")}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-600"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={!canSave}
              onClick={() => act("save", async () => {
                await ocrCloud.saveKey(keyDraft.trim(), companyId, {
                  provider,
                  ...(provider === "azure" ? { endpoint: endpointDraft.trim() } : {}),
                });
                setKeyDraft("");
                return `${providerLabel} key saved on the server.`;
              })}
              className="h-9 flex-1 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 sm:flex-none"
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={!curKey || !!busy}
              title={status.companyEnabled ? `Read a small test image with ${providerLabel}` : "Enable online OCR for this company first"}
              onClick={() => act("test", async () => {
                const r = await ocrCloud.vision(companyId, await testImageBase64(), { provider });
                const t = String(r?.text ?? "").replace(/\s+/g, " ").trim();
                if (!t) throw new Error("Online OCR returned no text");
                const used = (r?.provider ?? provider) === "azure" ? "Azure" : "Google";
                return `Test OK - ${used} read: "${t.slice(0, 60)}"`;
              })}
              className="h-9 flex-1 rounded-md border border-slate-300 px-3 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800 sm:flex-none"
            >
              {busy === "test" ? "Testing…" : "Test"}
            </button>
          </div>
        </div>
          </>
        )}
      </div>
      <div className="pl-ocr-card space-y-1.5 p-3">
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
                  aria-label={`Allow online OCR for ${u.name || u.email || u.userId}`}
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
      </fieldset>
      )}
      {msg ? <p className={cn("rounded-md px-3 py-2 text-xs", msg.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200")}>{msg.text}</p> : null}
    </Section>
  );
}

function OcrSettingsGear({
  connectorStyle, narrationStyle, switchOn, switchSeconds, translateToEnglish, aiCopilot, embedded = false, onPrefs,
}: {
  embedded?: boolean;
  /** Draft mode (Voucher Post Setting): changes go here and are saved on Save / Apply instead of instantly. */
  onPrefs?: (patch: Partial<OcrPrefs>) => void;
  connectorStyle: OcrConnectorStyle;
  narrationStyle: OcrNarrationStyle;
  switchOn: boolean;
  switchSeconds: number;
  /** Gemini/AI output ko English me translate karwao. */
  translateToEnglish: boolean;
  /** aiCopilot pref — "Live chat for voucher fill" switch. */
  aiCopilot: boolean;
}) {
  const applyPrefs = onPrefs ?? setOcrPrefs;
  const [swDraft, setSwDraft] = useState(String(switchSeconds));
  useEffect(() => { setSwDraft(String(switchSeconds)); }, [switchSeconds]);
  const commitSw = () => { const v = clampAutoPostSeconds(swDraft); applyPrefs({ autoSwitchSeconds: v }); setSwDraft(String(v)); };
  const settingsBody = (
        <div className={cn("pl-ocr-body pl-ocr-stack px-3 py-3", !embedded && "min-h-0 flex-1 overflow-y-auto overscroll-contain")}>
          <style>{OCR_CARD_CSS}</style>
          {/* PC: 2 columns; narrow: 1 column */}
          <div className="pl-ocr-grid">
          <Section title="Field popups Direction" hint="How a popup points at its field.">
            <RadioRow
              name="pl-ocr-connector"
              value={connectorStyle}
              onChange={(v) => applyPrefs({ connectorStyle: v })}
              options={[["tail", "Speech-bubble tail"], ["line", "Straight arrow line"]] as const}
            />
          </Section>
          <Section title="Narration" hint={<>Short example: Bill No SI-00780 Pur from Party on date. Sale uses &quot;Sale to&quot;.</>}>
            <RadioRow
              name="pl-ocr-narration"
              value={narrationStyle}
              onChange={(v) => applyPrefs({ narrationStyle: v })}
              options={[["full", "Full", "With item names"], ["short", "Short", "Bill no, party, date"]] as const}
            />
          </Section>
          <Section title="Voucher type" hint={switchOn ? "Wrong voucher type: switches automatically after the countdown." : "Off: shows a plain Switch button, no auto change."}>
            <SwitchRow id="pl-ocr-autoswitch" label="Auto voucher change" checked={switchOn} onChange={(v) => applyPrefs({ autoSwitchVoucher: v })} />
            <SecondsRow id="pl-ocr-autoswitch-secs" label="Switch countdown (seconds)" draft={swDraft} setDraft={setSwDraft} onCommit={commitSw} onOk={commitSw} disabled={!switchOn} />
          </Section>
          <Section title="Translation" hint="Gemini can translate local-language text in voucher fields.">
            <SwitchRow
              id="pl-ocr-translate"
              label="Translate to English"
              sub="Item names, party and narration in English (numbers, PAN, dates untouched)"
              checked={translateToEnglish}
              onChange={(v) => applyPrefs({ translateToEnglish: v })}
            />
          </Section>          {/* Pocket AI: turns the OCR panel into a split view — live form on the left, Gemini chat on
              the right. OFF = the classic flow (fill + bubbles + popup AI chat), untouched. */}
          <Section
            title="Pocket AI"
            hint={aiCopilot ? "On: after OCR the form opens with a chat beside it. Ask for changes in chat — the form updates live. No popup covers the form." : "Off: the classic OCR flow (auto-fill + field bubbles + AI button opens the chat popup)."}
          >
            <SwitchRow
              id="pl-ocr-copilot"
              label="Live chat for voucher fill"
              sub="Split view: form (left) + Gemini chat (right), updates applied instantly"
              checked={aiCopilot}
              onChange={(v) => applyPrefs({ aiCopilot: v })}
            />
          </Section>
          </div>
        </div>
  );
  if (embedded) return settingsBody;
  return (
        <button
          type="button"
          title="Voucher Post Setting"
          aria-label="Voucher Post Setting"
          onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new Event("pl:voucher-post-setting-open")); }}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-400/50 bg-white/70 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
  );
}

/** Reuse the voucher OCR preferences inside Voucher Post Setting → Manual Runner. */
export function VoucherOcrSettingsPanel({ draft, onDraftChange }: { draft?: Partial<OcrPrefs>; onDraftChange?: (patch: Partial<OcrPrefs>) => void } = {}) {
  const allowed = useOcrPlanAllowed();
  const saved = useOcrPrefs();
  const p = draft ? { ...saved, ...draft } : saved;
  if (!allowed) return <p className="text-xs text-muted-foreground">OCR settings are unavailable for this plan.</p>;
  return (
    <OcrSettingsGear
      embedded
      connectorStyle={p.connectorStyle === "line" ? "line" : "tail"}
      narrationStyle={p.narrationStyle === "short" ? "short" : "full"}
      switchOn={p.autoSwitchVoucher !== false}
      switchSeconds={clampAutoPostSeconds(p.autoSwitchSeconds)}
      translateToEnglish={p.translateToEnglish === true}
      aiCopilot={p.aiCopilot === true}
      onPrefs={onDraftChange}
    />
  );
}

/** Company OCR providers, saved API keys, sharing and engine choices live in their own sidebar page. */
export function VoucherOcrKeySettingsPanel() {
  const allowed = useOcrPlanAllowed();
  const p = useOcrPrefs();
  const { companyId } = useCompany();
  if (!allowed) return <p className="text-xs text-muted-foreground">OCR key settings are unavailable for this plan.</p>;
  return (
    <div className="pl-ocr-body pl-ocr-stack px-3 py-3">
      <style>{OCR_CARD_CSS}</style>
      <GoogleOcrSection companyId={companyId ?? null} open={true} />
    </div>
  );
}


export function VoucherOcrHeaderToggles({ className }: { className?: string }) {
  const allowed = useOcrPlanAllowed();
  const p = useOcrPrefs();
  const { dialogMode, runnerMode, ocrEnabled, chooseMode, choosing, canChangeRunner } = useVoucherOcrDialogMode();
  if (!allowed) return null;
  const style: OcrConnectorStyle = p.connectorStyle === "line" ? "line" : "tail";
  const narrationStyle: OcrNarrationStyle = p.narrationStyle === "short" ? "short" : "full";
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1 overflow-hidden", className)} data-pl-ocr-header-toggles="">
      <VoucherOcrModeSwitch
        mode={dialogMode}
        collapsed={!ocrEnabled}
        restoreMode={runnerMode}
        onModeChange={(next) => { void chooseMode(next); }}
        runnerPositionsDisabled={!canChangeRunner}
        disabled={choosing}
      />
      <OcrSettingsGear
        connectorStyle={style}
        narrationStyle={narrationStyle}
        switchOn={p.autoSwitchVoucher !== false}
        switchSeconds={clampAutoPostSeconds(p.autoSwitchSeconds)}
        translateToEnglish={p.translateToEnglish === true}
        aiCopilot={p.aiCopilot === true}
      />
    </div>
  );
}
