"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Company } from "@/hooks/useCompany";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT,
  getFirebaseLedgerCompanySyncEntry,
  replaceFirebaseLedgerCompanySyncEntries,
  type FirebaseLedgerCompanySyncEntry,
} from "@/lib/firebaseLedgerCompanySyncPrefs";
import {
  FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT,
  isFirebaseLedgerDataSyncEnabled,
} from "@/lib/firebaseLedgerDataSyncDisabled";
import { runOfflineFullWarmSync } from "@/lib/offlineFullWarmSync";
import { requestAttachmentUiRefresh } from "@/lib/attachmentLoadReady";
import { notifyBrowserDbCollectionUpdated } from "@/lib/localCompanyDocMirror";
import { COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS } from "@/lib/firestoreToLocalCompanyPull";
import { isSharedOnlineCompany } from "@/lib/companyStorageKind";
import {
  filterFirebaseCompaniesForServerSession,
  isServerOnlyLoginSession,
} from "@/lib/pocketbaseData/serverSessionCompanyScope";

type Props = {
  companies: Company[];
  compact?: boolean;
  /** Full-page selector: list grows into leftover space before scrolling. */
  fillHeight?: boolean;
  /** Shown left of Save (e.g. Log out + Create New Company). */
  leadingActions?: ReactNode;
  activeCompanyId?: string | null;
  onSelectCompany?: (company: Company) => void;
  onLogoutCompany?: (companyId: string) => void;
};

type DraftMap = Record<string, FirebaseLedgerCompanySyncEntry>;

function emptyEntry(): FirebaseLedgerCompanySyncEntry {
  return { selected: false, data: false, attachments: false };
}

function draftsFromCompanies(companies: Company[]): DraftMap {
  const next: DraftMap = {};
  for (const company of companies) {
    const id = String(company.id || "").trim();
    if (!id) continue;
    next[id] = getFirebaseLedgerCompanySyncEntry(id);
  }
  return next;
}

export function FirebaseLedgerOnlineCompanySyncList({
  companies: companiesProp,
  compact = false,
  fillHeight = false,
  leadingActions,
  activeCompanyId,
  onSelectCompany,
  onLogoutCompany,
}: Props) {
  /** Server-only login: Firebase rows never reach this list (defensive - callers filter too). */
  const serverOnlyLogin = isServerOnlyLoginSession();
  const companies = useMemo(() => filterFirebaseCompaniesForServerSession(companiesProp), [companiesProp]);
  const { toast } = useToast();
  const [prefsTick, setPrefsTick] = useState(0);
  const [syncEnabled, setSyncEnabled] = useState(() => isFirebaseLedgerDataSyncEnabled());
  const [draft, setDraft] = useState<DraftMap>(() => draftsFromCompanies(companies));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const bumpPrefs = () => setPrefsTick((n) => n + 1);
    const bumpSync = () => setSyncEnabled(isFirebaseLedgerDataSyncEnabled());
    window.addEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, bumpPrefs);
    window.addEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, bumpSync);
    return () => {
      window.removeEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, bumpPrefs);
      window.removeEventListener(FIREBASE_LEDGER_DATA_SYNC_CHANGED_EVENT, bumpSync);
    };
  }, []);

  // Reload draft from storage when list / prefs change (not while editing).
  useEffect(() => {
    if (dirty) return;
    setDraft(draftsFromCompanies(companies));
  }, [companies, prefsTick, syncEnabled, dirty]);

  const companyIdsKey = useMemo(
    () => companies.map((c) => String(c.id || "").trim()).filter(Boolean).join("|"),
    [companies]
  );

  // New companies appear in draft as unticked.
  useEffect(() => {
    setDraft((prev) => {
      const next: DraftMap = { ...prev };
      let changed = false;
      for (const company of companies) {
        const id = String(company.id || "").trim();
        if (!id) continue;
        if (!next[id]) {
          next[id] = emptyEntry();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when id set changes
  }, [companyIdsKey]);

  const myCompanies = useMemo(() => companies.filter((c) => c.isOwned === true), [companies]);
  const sharedCompanies = useMemo(
    () => companies.filter((c) => c.isOwned !== true && isSharedOnlineCompany(c)),
    [companies]
  );
  const otherCompanies = useMemo(() => {
    const seen = new Set(
      [...myCompanies, ...sharedCompanies].map((c) => String(c.id || "").trim()).filter(Boolean)
    );
    return companies.filter((c) => {
      const id = String(c.id || "").trim();
      return id && !seen.has(id);
    });
  }, [companies, myCompanies, sharedCompanies]);

  if (serverOnlyLogin && companies.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground">
        No online companies yet. In this session online companies come from the Pocket Ledger Server only.
      </p>
    );
  }

  if (!syncEnabled && companies.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/20 px-2 py-3 text-xs text-muted-foreground">
        Turn on <strong>Cloud data sync</strong> in the sidebar to load the Online company list.
        Already loaded/cached Online companies will remain available from Local SQLite.
      </p>
    );
  }

  if (companies.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground">
        No online companies on this device yet. Cloud sync ON pulls the company list from Firebase.
      </p>
    );
  }

  const setDataTick = (companyId: string, on: boolean) => {
    setDirty(true);
    setDraft((prev) => {
      const cur = prev[companyId] ?? emptyEntry();
      return {
        ...prev,
        [companyId]: {
          selected: on,
          data: on,
          attachments: on ? cur.attachments : false,
        },
      };
    });
  };

  const setFilesTick = (companyId: string, on: boolean) => {
    setDirty(true);
    setDraft((prev) => {
      const cur = prev[companyId] ?? emptyEntry();
      if (!cur.data) {
        return {
          ...prev,
          [companyId]: { selected: false, data: false, attachments: false },
        };
      }
      return {
        ...prev,
        [companyId]: { selected: true, data: true, attachments: on },
      };
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const entriesToSave: DraftMap = { ...draft };
      for (const company of companies) {
        const registryId = String(company.id || "").trim();
        const authoritativeId = String(company.authoritativeCompanyId || "").trim();
        if (!registryId || !authoritativeId || registryId === authoritativeId) continue;
        const entry = draft[registryId] ?? emptyEntry();
        entriesToSave[authoritativeId] = entry;
        entriesToSave[registryId] = entry;
      }
      replaceFirebaseLedgerCompanySyncEntries(entriesToSave);
      requestAttachmentUiRefresh();
      setDirty(false);
      toast({
        title: "Online sync saved",
        description:
          "Data = cloud download/upload for masters & vouchers. Untick keeps Local SQLite on screen (offline). Files = attachment download only (needs Data). Untick Files still allows uploading newly added files.",
      });
      const selectedCompanies = companies.filter((company) => {
        const id = String(company.id || "").trim();
        return id && draft[id]?.data === true;
      });
      // Prefs are already saved. Full warm/prefetch can take minutes or hang — never block the Save button.
      if (syncEnabled && selectedCompanies.length > 0 && typeof navigator !== "undefined" && navigator.onLine) {
        void (async () => {
          for (const company of selectedCompanies) {
            const id = String(company.id || "").trim();
            const warm = await runOfflineFullWarmSync({
              company,
              localCompanyId: id,
              // Data mirror only — EXE/APK/web: visible FY rows + click/hover lazy attachment load.
              includeAttachmentPrefetch: false,
              skipWarmBootstrapFlag: true,
            }).catch(() => null);
            if (warm) {
              for (const coll of COMPANY_LOCAL_MIRROR_SUBCOLLECTIONS) {
                notifyBrowserDbCollectionUpdated(id, coll, {
                  immediate: true,
                  source: "firebase_delta_pull",
                });
              }
            }
          }
        })();
      }
    } finally {
      setSaving(false);
    }
  };

  const headerCols = compact
    ? "grid-cols-[minmax(11rem,1fr)_2.75rem_2.75rem]"
    : "grid-cols-[minmax(14rem,1fr)_3.25rem_3.25rem]";

  const renderCompanyRow = (company: Company) => {
    const id = String(company.id || "").trim();
    const entry = draft[id] ?? emptyEntry();
    const ownerHint =
      company.isOwned !== true
        ? String(company.ownerEmail || "").trim()
        : "";
    return (
      <div
        key={id}
        className={cn(
          "grid items-center gap-1 rounded-md border border-border/70 bg-background px-1 py-1 focus-within:border-primary/70",
          headerCols
        )}
        data-pl-company-online-sync-row=""
      >
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            className="min-w-0 flex-1 text-left text-xs font-medium hover:underline"
            title={company.name}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelectCompany?.(company);
            }}
          >
            <span className="block whitespace-normal break-words leading-snug">
              {company.name}
            </span>
            {ownerHint ? (
              <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                Shared by {ownerHint}
              </span>
            ) : null}
            {activeCompanyId === company.id ? (
              <Check className="mt-0.5 inline h-3.5 w-3.5 shrink-0 text-green-600" />
            ) : null}
          </button>
          {onLogoutCompany ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              title="Log out from company"
              onClick={() => onLogoutCompany(company.id)}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
        <div className="flex justify-center">
          <Checkbox
            id={`fb-sync-data-${id}`}
            checked={entry.data}
            disabled={!syncEnabled}
            onCheckedChange={(v) => setDataTick(id, v === true)}
            aria-label={`Sync data for ${company.name}`}
          />
        </div>
        <div className="flex justify-center">
          <Checkbox
            id={`fb-sync-files-${id}`}
            checked={entry.attachments}
            disabled={!syncEnabled || !entry.data}
            onCheckedChange={(v) => setFilesTick(id, v === true)}
            aria-label={`Sync attachment files for ${company.name}`}
          />
        </div>
      </div>
    );
  };

  const renderSection = (title: string, rows: Company[]) => {
    if (rows.length === 0) return null;
    return (
      <div className="space-y-1">
        <h3 className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {rows.map(renderCompanyRow)}
      </div>
    );
  };

  return (
    <div className={cn("space-y-2", fillHeight && "flex h-full min-h-0 flex-col")}>
      {!syncEnabled ? (
        <p className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2 py-2 text-xs text-amber-900">
          Cloud data sync is OFF. Showing cached SQLite online companies only; Data / Files ticks are
          inactive until the main Cloud data sync switch is ON.
        </p>
      ) : null}
      <div
        className={cn(
          "-mx-0.5 overflow-x-auto overscroll-x-contain pb-0.5",
          fillHeight && "min-h-0 flex-1"
        )}
      >
        <div
          className={cn(
            "min-w-[18rem] space-y-1.5",
            compact ? "min-w-[20rem]" : "min-w-[24rem]",
            fillHeight && "flex h-full min-h-0 flex-col"
          )}
        >
          <div
            className={cn(
              "grid shrink-0 items-center gap-1 border-b border-border/60 px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
              headerCols
            )}
          >
            <span>Company</span>
            <span className="text-center">Data</span>
            <span className="text-center">Files</span>
          </div>
          <div
            className={cn(
              "space-y-3 overflow-y-auto pr-0.5",
              fillHeight ? "min-h-0 flex-1" : "max-h-56"
            )}
          >
            {renderSection("My companies", myCompanies)}
            {renderSection("Shared with me", sharedCompanies)}
            {renderSection("Online companies", otherCompanies)}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-1">
        {leadingActions ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{leadingActions}</div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        <Button
          type="button"
          size={compact ? "sm" : "default"}
          className="shrink-0"
          disabled={!syncEnabled || !dirty || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
