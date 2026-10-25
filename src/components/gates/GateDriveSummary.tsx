"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, HardDrive, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { settingsViewHref } from "@/lib/appNavHref";
import { fetchGoogleDriveConnectionStatus } from "@/lib/driveAuthClient";
import { listLocalCompanies, localCompanyRowIsDeleted } from "@/lib/localCompanyStore";
import { readCloudSyncConfigFromCompany } from "@/lib/localCloudSync/companyConfig";
import {
  isLocalGoogleDriveSyncDisabled,
  LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE,
} from "@/lib/localCloudSync/driveSyncDisabled";

/** Google Drive sync page (sidebar "Google Drive sync"). */
export const GATE_DRIVE_SYNC_HREF_VIEW = "local_cloud_sync";

export type GateDriveCompany = {
  id: string;
  name: string;
  status: string;
  lastSyncAt: number | null;
  lastError: string | null;
};

export type GateDriveSummaryState = {
  loading: boolean;
  disabled: boolean;
  connected: boolean;
  email: string | null;
  companies: GateDriveCompany[];
};

/**
 * Read-only Google Drive summary for the Gate page. Reuses existing Drive helpers
 * (connection status + per-company cloud sync fields) - no sync logic here.
 */
export function useGateDriveSummary(): GateDriveSummaryState {
  const [state, setState] = useState<GateDriveSummaryState>({
    loading: true,
    disabled: false,
    connected: false,
    email: null,
    companies: [],
  });

  const refresh = useCallback(async () => {
    if (isLocalGoogleDriveSyncDisabled()) {
      setState({ loading: false, disabled: true, connected: false, email: null, companies: [] });
      return;
    }
    let companies: GateDriveCompany[] = [];
    try {
      const rows = await listLocalCompanies();
      companies = rows
        .filter((row) => !localCompanyRowIsDeleted(row as { isDeleted?: unknown }))
        .map((row) => ({ row, cfg: readCloudSyncConfigFromCompany(row) }))
        .filter(({ cfg }) => cfg.cloudSyncEnabled && cfg.cloudSyncProvider === "google_drive")
        .map(({ row, cfg }) => ({
          id: String(row.id ?? ""),
          name: String((row as { name?: unknown }).name ?? "") || "Company",
          status: cfg.cloudSyncStatus,
          lastSyncAt: cfg.cloudSyncLastSyncAt,
          lastError: cfg.cloudSyncLastError,
        }));
    } catch {
      companies = [];
    }
    let connected = false;
    let email: string | null = null;
    try {
      const status = await fetchGoogleDriveConnectionStatus();
      connected = status.connected;
      email = status.email;
    } catch {
      connected = false;
    }
    setState({ loading: false, disabled: false, connected, email, companies });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return state;
}

function formatLastSync(ms: number | null): string {
  if (!ms) return "Not synced yet";
  try {
    return `Last sync ${new Date(ms).toLocaleString()}`;
  } catch {
    return "Synced";
  }
}

/** Card body for the Gate page "Drive" section. */
export function GateDriveSummary({
  state,
  showCompanies = true,
}: {
  state: GateDriveSummaryState;
  /** Card header "All companies" toggles the company list. */
  showCompanies?: boolean;
}) {
  const href = settingsViewHref(GATE_DRIVE_SYNC_HREF_VIEW);
  const openButton = (label: string, variant: "default" | "outline" = "outline") => (
    <Button asChild type="button" size="sm" variant={variant}>
      <Link href={href}>
        <ExternalLink className="mr-2 h-4 w-4" />
        {label}
      </Link>
    </Button>
  );

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking Google Drive.
      </div>
    );
  }

  if (state.disabled) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        {LOCAL_GOOGLE_DRIVE_SYNC_DISABLED_MESSAGE}
      </p>
    );
  }

  if (!state.connected && state.companies.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <HardDrive className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">Google Drive not connected</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect Google Drive to back up and share local companies.
        </p>
        <div className="mt-3">{openButton("Open Google Drive sync", "default")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 text-sm">
        <span className="font-medium">Google Drive</span>
        {state.connected ? (
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
            Connected
          </Badge>
        ) : (
          <Badge variant="outline" className="text-amber-700">
            Not connected
          </Badge>
        )}
        {state.email ? <span className="truncate text-xs text-muted-foreground">{state.email}</span> : null}
      </div>
      {state.companies.length > 0 && !showCompanies ? null : state.companies.length > 0 ? (
        <ul className="divide-y rounded-md border bg-background">
          {state.companies.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {c.lastError ? `Error: ${c.lastError}` : formatLastSync(c.lastSyncAt)}
                </span>
              </span>
              <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                {c.status || "idle"}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          No company is syncing to Google Drive yet.
        </p>
      )}
      {openButton("Open Google Drive sync")}
    </div>
  );
}
