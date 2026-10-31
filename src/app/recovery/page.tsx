"use client";

/**
 * Recovery mode (desktop app, super admin only): lists every company stored in this PC's SQLite
 * (all sign-in folders, any owner) and pushes companies to the Pocket Ledger Server, each owned by its
 * ORIGINAL owner email. Read-only on this PC. No other app pages from here: Back / Log out only.
 *
 * Multi-company push: tick companies (or select all), press "Push selected", fill the one popup
 * (owner email / company password per company, same rules as before), then the companies upload one
 * after another (MAX_PARALLEL) with their own progress bar, Stop and Retry. Each company resumes from its
 * own checkpoint (see recoveryUpload.ts). Member passwords are not handled here (set them later from
 * the server panel); members are added by email + role as before.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  LayoutDashboard,
  Loader2,
  LogOut,
  RefreshCw,
  RotateCcw,
  Square,
  UploadCloud,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDate } from "@/hooks/useDate";
import { getPocketBaseServerUrl, getValidPocketBaseAuth, pocketBaseSignIn, pocketBaseSignOut } from "@/lib/pocketbaseData/pbClient";
import {
  clearPocketBaseAppSession,
  pocketBaseSessionUid,
  startPocketBaseAppSession,
} from "@/lib/pocketbaseData/pbAppSession";
import { resolvePostAuthCompanyRoute } from "@/lib/postAuthCompanyRoute";
import { listAllSqliteCompanies, type RecoveryCompany } from "@/lib/recovery/recoveryReader";
import {
  checkRecoveryAccess,
  pushCompanyToServer,
  readResumeMark,
  readUploadedMarks,
  recoveryErrorMessage,
  RecoveryConflictError,
  type RecoveryProgress,
  type RecoveryPushResult,
  type RecoveryUploadedMark,
} from "@/lib/recovery/recoveryUpload";
import {
  allowRecoveryRedirect,
  readRecoveryMode,
  recoveryModeSupported,
  writeRecoveryMode,
} from "@/lib/recovery/recoveryMode";
import {
  RECOVERY_LANGS,
  RECOVERY_TEXT,
  readRecoveryLang,
  writeRecoveryLang,
  type RecoveryLang,
  type RecoveryPushSource,
} from "@/lib/recovery/recoveryLocales";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Companies uploading at the same time (low-end PCs: one after another). Max 2. */
const MAX_PARALLEL = 1;

type JobStatus = "waiting" | "running" | "stopped" | "failed" | "done";

type Job = {
  id: string;
  ownerEmail: string;
  /** Typed company password, kept in memory for Retry only (never saved). */
  password: string;
  status: JobStatus;
  order: number;
  progress: RecoveryProgress | null;
  records: { done: number; total: number };
  message: string;
  ownerProblem: boolean;
  result: RecoveryPushResult | null;
  /** "local" = only this PC's data, Firebase never touched; "firebase" = also copy files from Firebase. */
  source: RecoveryPushSource;
};

type PromptInput = { owner: string; password: string; ownerEditable: boolean };

const isActive = (j: Job | undefined) => !!j && (j.status === "waiting" || j.status === "running");

function jobPct(j: Job): number {
  if (j.status === "done") return 100;
  const { done, total } = j.records;
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
}

export default function RecoveryPage() {
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [companies, setCompanies] = useState<RecoveryCompany[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [marks, setMarks] = useState<Record<string, RecoveryUploadedMark>>({});
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [serverReason, setServerReason] = useState("");
  const [busyExit, setBusyExit] = useState(false);
  const [goAppError, setGoAppError] = useState("");

  // Selection + per-company push jobs
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [summaryIds, setSummaryIds] = useState<string[]>([]);
  const jobsRef = useRef(jobs);
  const companiesRef = useRef<RecoveryCompany[]>([]);
  const controllersRef = useRef(new Map<string, AbortController>());
  const orderRef = useRef(0);

  // Push popup (one field set per company)
  const [promptIds, setPromptIds] = useState<string[] | null>(null);
  const [promptInputs, setPromptInputs] = useState<Record<string, PromptInput>>({});
  const [promptError, setPromptError] = useState("");
  // What the push takes its data from (asked in the push popup; default: only this PC's data) + popup language.
  const [pushSource, setPushSource] = useState<RecoveryPushSource>("local");
  const [lang, setLang] = useState<RecoveryLang>("en");

  // Server sign-in (inside the popup, only when needed)
  const [srvEmail, setSrvEmail] = useState("");
  const [srvPassword, setSrvPassword] = useState("");
  const [srvBusy, setSrvBusy] = useState(false);
  const [srvError, setSrvError] = useState("");

  const fmtTime = useCallback(
    (ms: number): string => {
      if (!ms) return "-";
      try {
        const d = new Date(ms);
        if (isNaN(d.getTime())) return "-";
        const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (dateSystem === "AD") return `${formatDate(d)} ${t}`;
        if (dateSystem === "BS") return `${formatDateBS(d)} ${t}`;
        return `${formatDate(d)} AD / ${formatDateBS(d)} BS ${t}`;
      } catch {
        return "-";
      }
    },
    [dateSystem, formatDate, formatDateBS]
  );

  const refreshServer = useCallback(async () => {
    const r = await checkRecoveryAccess();
    setServerOk(r.ok);
    setServerReason(r.ok ? "" : r.reason || "");
    return r.ok;
  }, []);

  const load = useCallback(async () => {
    setLoadError("");
    setCompanies(null);
    try {
      const list = await listAllSqliteCompanies();
      setCompanies(list);
      setMarks(readUploadedMarks());
    } catch (e) {
      setCompanies([]);
      setLoadError(e instanceof Error ? e.message : "Could not read the local data on this PC.");
    }
  }, []);

  useEffect(() => {
    setLang(readRecoveryLang());
  }, []);

  useEffect(() => {
    const st = readRecoveryMode();
    if (!recoveryModeSupported() || !st) {
      setAllowed(false);
      if (allowRecoveryRedirect()) window.location.replace("/");
      return;
    }
    setAllowed(true);
    setAdminEmail(st.email);
    setSrvEmail(st.email);
    void load();
    void refreshServer();
  }, [load, refreshServer]);

  // Keep refs in step with state (declared before the queue effect so it runs first).
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);
  useEffect(() => {
    companiesRef.current = companies ?? [];
  }, [companies]);

  const anyActive = useMemo(() => Object.values(jobs).some(isActive), [jobs]);

  const exitRecovery = useCallback(async () => {
    if (Object.values(jobsRef.current).some(isActive)) return;
    setBusyExit(true);
    writeRecoveryMode(null);
    try {
      pocketBaseSignOut();
    } catch {
      /* ignore */
    }
    try {
      clearPocketBaseAppSession();
    } catch {
      /* ignore */
    }
    window.location.assign("/");
  }, []);

  // "Go to App": leave recovery mode but keep this sign-in (no password again). With the older
  // (Firebase) account signed in, the normal app opens on it; otherwise a valid Pocket Ledger Server
  // token starts a server-only app session (same as a server-only sign-in). The recovery marker is
  // cleared first, so RecoveryModeGate does not send the app back here. Getting back into recovery
  // mode still needs Log out + sign in with the recovery tick.
  const goToApp = useCallback(async () => {
    if (Object.values(jobsRef.current).some(isActive)) return;
    setGoAppError("");
    setBusyExit(true);
    try {
      let uid: string | undefined;
      let email: string | null | undefined;
      if (getValidPocketBaseAuth()) {
        const p = await startPocketBaseAppSession();
        uid = pocketBaseSessionUid(p);
        email = p.email;
      } else {
        setGoAppError("No signed-in app session to reuse. Use Log out and sign in normally.");
        setBusyExit(false);
        return;
      }
      writeRecoveryMode(null);
      window.location.assign(resolvePostAuthCompanyRoute(uid, email));
    } catch (e) {
      setGoAppError(e instanceof Error ? e.message : "Could not open the app.");
      setBusyExit(false);
    }
  }, []);

  const updateJob = useCallback((id: string, patch: Partial<Job> | ((j: Job) => Partial<Job>)) => {
    setJobs((prev) => {
      const j = prev[id];
      if (!j) return prev;
      const p = typeof patch === "function" ? patch(j) : patch;
      return { ...prev, [id]: { ...j, ...p } };
    });
  }, []);

  // ---- one company upload ----
  const runJob = useCallback(
    async (id: string) => {
      if (controllersRef.current.has(id)) return;
      const job = jobsRef.current[id];
      const company = companiesRef.current.find((c) => c.id === id);
      if (!job || !company) return;
      const ac = new AbortController();
      controllersRef.current.set(id, ac);
      const resume = readResumeMark(id);
      updateJob(id, {
        status: "running",
        progress: null,
        message: "",
        ownerProblem: false,
        result: null,
        records: { done: resume?.sent || 0, total: resume?.total || company.totalRecords },
      });
      try {
        const result = await pushCompanyToServer({
          company,
          ownerEmail: job.ownerEmail,
          password: job.password || undefined,
          source: job.source,
          signal: ac.signal,
          onProgress: (p) =>
            updateJob(id, (j) => ({
              progress: p,
              records: p.phase === "records" ? { done: p.done, total: p.total } : j.records,
            })),
        });
        updateJob(id, { status: "done", result, records: { done: result.records, total: result.records } });
        setMarks(readUploadedMarks());
      } catch (e) {
        const stopped = ac.signal.aborted;
        if (e && typeof e === "object" && (e as { status?: number }).status === 401) void refreshServer();
        updateJob(id, {
          status: stopped ? "stopped" : "failed",
          message: stopped ? "Stopped. Press Retry to continue from where it stopped." : recoveryErrorMessage(e),
          ownerProblem: !stopped && e instanceof RecoveryConflictError,
        });
      } finally {
        controllersRef.current.delete(id);
      }
    },
    [refreshServer, updateJob]
  );

  // ---- queue: start waiting companies in order, MAX_PARALLEL at a time ----
  useEffect(() => {
    if (serverOk === false) {
      // Server sign-in was lost: park the waiting companies so the page is not stuck.
      const parked = Object.values(jobs).filter((j) => j.status === "waiting" && !controllersRef.current.has(j.id));
      if (parked.length && !Object.values(jobs).some((j) => j.status === "running")) {
        setJobs((prev) => {
          const next = { ...prev };
          for (const j of parked) next[j.id] = { ...j, status: "stopped", message: "Server sign-in needed. Press Retry." };
          return next;
        });
      }
      return;
    }
    if (!serverOk) return;
    const list = Object.values(jobs);
    const running = list.filter((j) => j.status === "running").length;
    const free = Math.max(0, Math.min(2, MAX_PARALLEL) - running);
    if (!free) return;
    list
      .filter((j) => j.status === "waiting" && !controllersRef.current.has(j.id))
      .sort((a, b) => a.order - b.order)
      .slice(0, free)
      .forEach((j) => void runJob(j.id));
  }, [jobs, serverOk, runJob]);

  const stopJob = (id: string) => {
    const j = jobsRef.current[id];
    if (!j) return;
    if (j.status === "running") controllersRef.current.get(id)?.abort();
    else if (j.status === "waiting") updateJob(id, { status: "stopped", message: "Stopped before it started. Press Retry to push it." });
  };

  const openPrompt = (ids: string[]) => {
    const list = companiesRef.current;
    const inputs: Record<string, PromptInput> = {};
    const use: string[] = [];
    for (const id of ids) {
      const c = list.find((x) => x.id === id);
      if (!c || isActive(jobsRef.current[id])) continue;
      const j = jobsRef.current[id];
      inputs[id] = {
        owner: j?.ownerEmail || c.ownerEmail,
        password: j?.password || "",
        ownerEditable: !c.ownerEmail || !!j?.ownerProblem,
      };
      use.push(id);
    }
    if (!use.length) return;
    setPromptInputs(inputs);
    setPushSource("local");
    setPromptIds(use);
    setPromptError("");
    setSrvPassword("");
    setSrvError("");
  };

  const closePrompt = () => {
    setPromptIds(null);
    setPromptInputs({});
    setSrvPassword("");
    setPromptError("");
  };

  const retryJob = (id: string) => {
    const j = jobsRef.current[id];
    if (!j) return;
    if (j.ownerProblem || !serverOk) {
      openPrompt([id]);
      return;
    }
    orderRef.current += 1;
    updateJob(id, { status: "waiting", order: orderRef.current, message: "", ownerProblem: false });
    setSummaryIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const confirmPrompt = () => {
    if (!promptIds) return;
    if (!serverOk) {
      setPromptError("Sign in to the Pocket Ledger Server first.");
      return;
    }
    const list = companiesRef.current;
    for (const id of promptIds) {
      const inp = promptInputs[id];
      const c = list.find((x) => x.id === id);
      if (!inp || !EMAIL_RE.test(inp.owner.trim())) {
        setPromptError(`Enter the original owner's email for ${c?.name || "(no name)"}.`);
        return;
      }
    }
    const fresh = !Object.values(jobsRef.current).some(isActive);
    setJobs((prev) => {
      const next = { ...prev };
      for (const id of promptIds) {
        const c = list.find((x) => x.id === id);
        const inp = promptInputs[id];
        orderRef.current += 1;
        const resume = readResumeMark(id);
        next[id] = {
          id,
          ownerEmail: inp.owner.trim().toLowerCase(),
          password: inp.password,
          status: "waiting",
          order: orderRef.current,
          progress: null,
          records: { done: resume?.sent || 0, total: resume?.total || c?.totalRecords || 0 },
          message: "",
          ownerProblem: false,
          result: null,
          source: pushSource,
        };
      }
      return next;
    });
    setSummaryIds((prev) => (fresh ? [...promptIds] : Array.from(new Set([...prev, ...promptIds]))));
    setSelected((prev) => {
      const next = { ...prev };
      for (const id of promptIds) delete next[id];
      return next;
    });
    closePrompt();
  };

  const serverSignIn = async () => {
    setSrvError("");
    if (!EMAIL_RE.test(srvEmail.trim()) || !srvPassword) {
      setSrvError("Enter the server admin email and password.");
      return;
    }
    setSrvBusy(true);
    try {
      await pocketBaseSignIn(srvEmail.trim(), srvPassword);
      const ok = await refreshServer();
      if (!ok) {
        pocketBaseSignOut();
        setSrvError("This account is not the server's main admin. Recovery upload needs the main admin.");
      } else {
        const st = readRecoveryMode();
        if (st) writeRecoveryMode({ ...st, serverVerified: true });
      }
    } catch {
      setSrvError("Could not sign in to the Pocket Ledger Server. Check the email, password and server address.");
    } finally {
      setSrvPassword("");
      setSrvBusy(false);
    }
  };

  const totals = useMemo(() => {
    const list = companies ?? [];
    return { count: list.length, uploaded: list.filter((c) => marks[c.id]).length };
  }, [companies, marks]);

  const selectable = useMemo(() => (companies ?? []).filter((c) => !isActive(jobs[c.id])).map((c) => c.id), [companies, jobs]);
  const selectedIds = selectable.filter((id) => selected[id]);
  const allChecked = selectable.length > 0 && selectedIds.length === selectable.length;
  const someChecked = selectedIds.length > 0 && !allChecked;

  const summaryRows = summaryIds.map((id) => jobs[id]).filter((j): j is Job => !!j);
  const showSummary = summaryRows.length > 0 && !summaryRows.some(isActive);

  if (!allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const nameOf = (id: string) => (companies ?? []).find((c) => c.id === id)?.name || "(no name)";
  const tx = RECOVERY_TEXT[lang];

  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <div className="w-full space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => void exitRecovery()} disabled={busyExit || anyActive}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button size="sm" onClick={() => void goToApp()} disabled={busyExit || anyActive}>
              <LayoutDashboard className="mr-1 h-4 w-4" /> Go to App
            </Button>
            <div>
              <h1 className="text-xl font-semibold">Recovery mode</h1>
              <p className="text-sm text-muted-foreground">
                Signed in as {adminEmail}. Companies saved on this PC, from every account that used it.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void exitRecovery()} disabled={busyExit || anyActive}>
            <LogOut className="mr-1 h-4 w-4" /> Log out
          </Button>
        </header>
        {goAppError ? <p className="text-sm text-destructive">{goAppError}</p> : null}

        <section className="rounded-lg border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium">Pocket Ledger Server:</span> {getPocketBaseServerUrl() || "not set"}{" "}
              {serverOk === null ? (
                <span className="text-muted-foreground">(checking...)</span>
              ) : serverOk ? (
                <span className="text-green-600">(main admin signed in)</span>
              ) : (
                <span className="text-amber-600">
                  (
                  {serverReason === "offline"
                    ? "server not reachable"
                    : serverReason === "not_admin"
                    ? "signed in, but not the main admin"
                    : "not signed in to the server"}
                  {" - you will be asked to sign in before a push"})
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { void load(); void refreshServer(); }} disabled={anyActive}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Nothing on this PC is changed. Each company is uploaded to the server under its original owner email. When the
            owner and members sign up or sign in on the server with the same email, they get the same access they had
            before (owner, and each member&apos;s role). Member passwords are set later from the server panel.
          </p>
        </section>

        {showSummary ? (
          <section className="space-y-2 rounded-lg border bg-card p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">Push summary</p>
              <Button variant="ghost" size="sm" onClick={() => setSummaryIds([])}>
                <X className="mr-1 h-4 w-4" /> Close
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] border-collapse text-xs">
                <thead>
                  <tr className="text-left">
                    <th rowSpan={2} className="border px-2 py-1 font-medium">Company</th>
                    <th rowSpan={2} className="border px-2 py-1 font-medium">Result</th>
                    {["New", "Updated", "Unchanged", "Failed"].map((g) => (
                      <th key={g} colSpan={3} className="border px-2 py-1 text-center font-medium">
                        {g}
                      </th>
                    ))}
                    <th rowSpan={2} className="border px-2 py-1 text-right font-medium" title="Files whose bytes are not on this PC">
                      Files not on PC
                    </th>
                  </tr>
                  <tr className="text-right text-[11px] text-muted-foreground">
                    {[0, 1, 2, 3].flatMap((g) => [
                      <th key={`m${g}`} className="border px-1.5 py-0.5 font-medium" title="Masters (parties, groups, items, accounts, staff, taxes, documents...)">
                        Masters
                      </th>,
                      <th key={`v${g}`} className="border px-1.5 py-0.5 font-medium">
                        Vouchers
                      </th>,
                      <th key={`f${g}`} className="border px-1.5 py-0.5 font-medium">
                        Files
                      </th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((j) => {
                    const r = j.result;
                    return (
                      <tr key={j.id}>
                        <td className="border px-2 py-1">{nameOf(j.id)}</td>
                        <td className="border px-2 py-1">
                          {j.status === "done" && r ? (
                            <span className="text-green-700">
                              Done{r.countMismatch.length ? " (count check differs - push again)" : ""}
                              {r.keptServer ? `, ${r.keptServer} newer on the server kept` : ""}
                            </span>
                          ) : (
                            <span className="text-destructive">
                              {j.status === "stopped" ? "Stopped" : "Failed"}: {j.message}
                            </span>
                          )}
                        </td>
                        {(["created", "updated", "unchanged", "failed"] as const).flatMap((k) =>
                          (["masters", "vouchers", "files"] as const).map((kind) => (
                            <td key={`${k}-${kind}`} className="border px-1.5 py-1 text-right tabular-nums">
                              {!r ? "-" : kind === "files" && k === "updated" ? "-" : r.byKind[kind][k]}
                            </td>
                          ))
                        )}
                        <td className="border px-2 py-1 text-right tabular-nums">{r ? r.byKind.files.notOnPc : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {companies === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the local data on this PC...
          </div>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No companies were found in the local data on this PC.</p>
        ) : (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allChecked ? true : someChecked ? "indeterminate" : false}
                  disabled={!selectable.length}
                  onCheckedChange={(v) => {
                    const on = v === true;
                    setSelected(() => {
                      const next: Record<string, boolean> = {};
                      if (on) for (const id of selectable) next[id] = true;
                      return next;
                    });
                  }}
                  aria-label="Select all companies"
                />
                <span>Select all</span>
                <span className="text-muted-foreground">
                  - {totals.count} {totals.count === 1 ? "company" : "companies"} found, {totals.uploaded} uploaded to this server
                </span>
              </label>
              <Button size="sm" onClick={() => openPrompt(selectedIds)} disabled={!selectedIds.length}>
                <UploadCloud className="mr-1 h-4 w-4" /> Push selected{selectedIds.length ? ` (${selectedIds.length})` : ""}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {companies.map((c) => {
              const mark = marks[c.id];
              const job = jobs[c.id];
              const active = isActive(job);
              const resume = mark && !job ? null : readResumeMark(c.id);
              const top = Object.entries(c.counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6);
              const pct = job ? jobPct(job) : 0;
              return (
                <div key={c.id} className="min-w-0 rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Checkbox
                        className="mt-1"
                        checked={!active && !!selected[c.id]}
                        disabled={active}
                        onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [c.id]: v === true }))}
                        aria-label={`Select ${c.name || "company"}`}
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{c.name || "(no name)"}</span>
                          {c.deleted ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">deleted on this PC</span>
                          ) : null}
                          {mark && (!job || job.status === "done") ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                              <CheckCircle2 className="h-3 w-3" /> Uploaded {fmtTime(mark.atMs)}
                            </span>
                          ) : resume && !active ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                              Upload not finished
                              {resume.sent ? ` - ${resume.sent}${resume.total ? ` / ${resume.total}` : ""} records sent` : ""}
                              {" - "}Push continues from there
                            </span>
                          ) : !mark ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Not uploaded</span>
                          ) : null}
                        </div>
                        <p className="text-sm">
                          Owner: {c.ownerEmail || <span className="text-amber-600">no owner email on this PC</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {c.totalRecords} records
                          {top.length ? ` (${top.map(([k, n]) => `${k}: ${n}`).join(", ")}${Object.keys(c.counts).length > top.length ? ", ..." : ""})` : ""}
                          {" - "}
                          {c.members.length} {c.members.length === 1 ? "member" : "members"}
                          {" - "}
                          password {c.hasPassword ? "saved" : "not saved"} on this PC
                          {" - "}last change {fmtTime(c.updatedAt)}
                        </p>
                        {c.members.length ? (
                          <p className="truncate text-xs text-muted-foreground">
                            Members: {c.members.map((m) => `${m.email} (${m.role || "member"})`).join(", ")}
                          </p>
                        ) : null}
                        {mark && !job ? (
                          <p className="text-xs text-muted-foreground">
                            Last upload: {mark.records} records, {mark.files} files
                            {mark.missingFiles ? `, ${mark.missingFiles} files missing on this PC` : ""}, owner {mark.ownerEmail}.
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {!active ? (
                      <Button size="sm" variant="outline" onClick={() => openPrompt([c.id])}>
                        <UploadCloud className="mr-1 h-4 w-4" />
                        {mark ? "Push again" : "Push"}
                      </Button>
                    ) : null}
                  </div>

                  {job ? (
                    <div className="mt-3 space-y-2 border-t pt-3">
                      {job.status === "waiting" ? (
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className="h-3 w-3" /> Waiting
                            {job.records.done ? ` - continues from ${job.records.done} / ${job.records.total} records` : ""}
                          </span>
                          <Button size="sm" variant="outline" onClick={() => stopJob(c.id)}>
                            <Square className="mr-1 h-3 w-3" /> Stop
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Progress value={pct} />
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className={job.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
                              {job.records.done} / {job.records.total} records ({pct}%)
                              {" - "}
                              {job.status === "running"
                                ? job.progress?.label || "Starting..."
                                : job.status === "done"
                                ? "Finished"
                                : job.message}
                            </span>
                            {job.status === "running" ? (
                              <Button size="sm" variant="outline" onClick={() => stopJob(c.id)}>
                                <Square className="mr-1 h-3 w-3" /> Stop
                              </Button>
                            ) : job.status === "failed" || job.status === "stopped" ? (
                              <Button size="sm" variant="outline" onClick={() => retryJob(c.id)}>
                                <RotateCcw className="mr-1 h-3 w-3" /> Retry
                              </Button>
                            ) : null}
                          </div>
                          {job.status === "done" && job.result ? (
                            <>
                            <p className="text-xs text-muted-foreground">
                              <span className="font-medium">Masters:</span> {job.result.byKind.masters.created} new, {job.result.byKind.masters.updated} updated, {job.result.byKind.masters.unchanged} unchanged, {job.result.byKind.masters.failed} failed.{" "}
<span className="font-medium">Vouchers:</span> {job.result.byKind.vouchers.created} new, {job.result.byKind.vouchers.updated} updated, {job.result.byKind.vouchers.unchanged} unchanged, {job.result.byKind.vouchers.failed} failed.{" "}
<span className="font-medium">Files:</span> {job.result.byKind.files.created} uploaded, {job.result.byKind.files.unchanged} already on the server, {job.result.byKind.files.failed} failed{job.result.tooBigFiles ? " (too big for the server)" : ""}, {job.result.byKind.files.notOnPc}{" "}
{job.result.source === "local" ? tx.notOnPc : "not on this PC and could not be copied from Firebase"}.
{job.result.keptServer ? ` (${job.result.keptServer} records were newer on the server and kept.)` : ""}
                              {job.result.resumedFromBatch ? ` Continued from part ${job.result.resumedFromBatch + 1}.` : ""}
                              {job.result.countMismatch.length
                                ? ` Count check differs: ${job.result.countMismatch.map((m) => `${m.coll} ${m.server}/${m.source}`).join(", ")}. Push again to retry.`
                                : " Count check passed."}
                              {" "}
                              {job.result.source === "local" ? tx.modeLocalDone : tx.modeFirebaseDone}
                            </p>
                            {job.result.notOnPc.length ? (
                              <details className="text-xs text-muted-foreground">
                                <summary className="cursor-pointer">
                                  {job.result.notOnPc.length} {tx.skippedFiles}
                                </summary>
                                <ul className="mt-1 list-disc pl-5">
                                  {job.result.notOnPc.slice(0, 50).map((n, i) => (
                                    <li key={`${i}-${n}`} className="break-all">
                                      {n} - {tx.notOnPc}
                                    </li>
                                  ))}
                                  {job.result.notOnPc.length > 50 ? <li>...</li> : null}
                                </ul>
                              </details>
                            ) : null}
                            </>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            </div>
          </section>
        )}
      </div>

      <Dialog open={!!promptIds} onOpenChange={(o) => { if (!o) closePrompt(); }}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Push to Pocket Ledger Server</DialogTitle>
            <DialogDescription>
              {promptIds && promptIds.length > 1
                ? `${promptIds.length} companies. They upload one after another, each with its own progress, Stop and Retry.`
                : "Pushing again is safe: records already on the server are not duplicated. Choose below where the data comes from."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {!serverOk ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="font-medium">Sign in to the Pocket Ledger Server (main admin)</p>
                <Input
                  value={srvEmail}
                  onChange={(e) => setSrvEmail(e.target.value)}
                  placeholder="admin@example.com"
                  autoComplete="off"
                  disabled={srvBusy}
                />
                <Input
                  type="password"
                  value={srvPassword}
                  onChange={(e) => setSrvPassword(e.target.value)}
                  placeholder="Server password"
                  autoComplete="new-password"
                  disabled={srvBusy}
                  onKeyDown={(e) => { if (e.key === "Enter") void serverSignIn(); }}
                />
                {srvError ? <p className="text-xs text-destructive">{srvError}</p> : null}
                <Button size="sm" onClick={() => void serverSignIn()} disabled={srvBusy}>
                  {srvBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Sign in to server
                </Button>
              </div>
            ) : null}

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{tx.sourceTitle}</p>
                <div className="flex items-center gap-1" aria-label={tx.langLabel}>
                  {RECOVERY_LANGS.map((l) => (
                    <Button
                      key={l.value}
                      type="button"
                      size="sm"
                      variant={lang === l.value ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setLang(l.value);
                        writeRecoveryLang(l.value);
                      }}
                    >
                      {l.label}
                    </Button>
                  ))}
                </div>
              </div>
              {(["local", "firebase"] as RecoveryPushSource[]).map((v) => (
                <label
                  key={v}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 ${pushSource === v ? "border-primary bg-primary/5" : ""}`}
                >
                  <input
                    type="radio"
                    name="recovery-push-source"
                    className="mt-1"
                    checked={pushSource === v}
                    onChange={() => setPushSource(v)}
                  />
                  <span className="space-y-0.5">
                    <span className="block font-medium">{v === "local" ? tx.localTitle : tx.firebaseTitle}</span>
                    <span className="block text-xs text-muted-foreground">{v === "local" ? tx.localDesc : tx.firebaseDesc}</span>
                  </span>
                </label>
              ))}
            </div>

            {(promptIds ?? []).map((id) => {
              const c = (companies ?? []).find((x) => x.id === id);
              const inp = promptInputs[id];
              if (!c || !inp) return null;
              const setInp = (p: Partial<PromptInput>) => setPromptInputs((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
              return (
                <div key={id} className="space-y-3 rounded-md border p-3">
                  <p className="font-medium">
                    {c.name || "(no name)"}{" "}
                    <span className="font-normal text-muted-foreground">
                      - {c.totalRecords} records, {c.members.length} members
                    </span>
                  </p>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Original owner email</label>
                    <Input
                      value={inp.owner}
                      onChange={(e) => setInp({ owner: e.target.value })}
                      placeholder="owner@example.com"
                      autoComplete="off"
                      disabled={!inp.ownerEditable}
                    />
                    {inp.ownerEditable ? (
                      <p className="text-xs text-muted-foreground">
                        The company is created on the server for this email. Until that person signs up on the server, it
                        waits for them.
                      </p>
                    ) : null}
                  </div>
                  {!c.hasPassword ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Company password (optional)</label>
                      <Input
                        type="password"
                        value={inp.password}
                        onChange={(e) => setInp({ password: e.target.value })}
                        placeholder="No password saved on this PC"
                        autoComplete="new-password"
                      />
                      <p className="text-xs text-muted-foreground">
                        No company password is saved on this PC. Leave empty to keep the server&apos;s current setting.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">The company password saved on this PC will be used.</p>
                  )}
                </div>
              );
            })}

            {promptError ? <p className="text-sm text-destructive">{promptError}</p> : null}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closePrompt}>
              Cancel
            </Button>
            <Button onClick={confirmPrompt} disabled={!serverOk}>
              <UploadCloud className="mr-1 h-4 w-4" />
              {promptIds && promptIds.length > 1 ? `OK - Push ${promptIds.length}` : "OK - Push"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
