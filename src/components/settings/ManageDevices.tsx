"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  deleteDoc,
  doc,
  query,
  where,
  updateDoc,
  orderBy,
  writeBatch,
} from "firebase/firestore";
import { getDocs, getDoc, onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Smartphone, Loader2, Trash2, Monitor, History, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getPlanFromPlans, useLivePlans } from "@/hooks/useLivePlans";
import { formatEntitlementCapLabel, isUnlimitedEntitlementCap } from "@/config/plans";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
// batch kick: optimistic UI + single Firestore burst — old path did N sequential trims and felt hung
import { getOrCreateDeviceId, removeThisDevice, trimDeviceHistoryToLimit, kickOutDevicesBatch } from "@/lib/deviceLimitClient";
import { formatDeviceSlotLabel } from "@/lib/deviceSlotForUserDevices";
import { deviceLabelTooltipIfTruncated, shortDeviceLabelForList } from "@/lib/deviceLabelDisplay";
import { useDeviceLimitContext } from "@/contexts/DeviceLimitContext";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  canPickWebBackupFolder,
  clearWebBackupDirectoryHandle,
  ensureNativeBackupStoragePermission,
  isNativeRuntime,
  readBackupSaveLocationPrefs,
  saveBackupSaveLocationPrefs,
  storeWebBackupDirectoryHandle,
  type BackupNativeDirectory,
} from "@/lib/backupSaveLocation";

type DeviceRow = {
  id: string;
  userId: string;
  lastActive: Date | null;
  deviceType?: "mobile" | "desktop";
  deviceLabel?: string;
  /** Plan slot 01..max — multi-company me same deviceId par same number (Firestore `deviceSlot`). */
  deviceSlot?: number;
};

type DeviceHistoryRow = {
  id: string;
  deviceId: string;
  userId: string;
  lastActive: Date | null;
  deviceType?: "mobile" | "desktop";
  deviceLabel?: string;
  createdAt: Date | null;
};

const userNamesCache: Record<string, string> = {};
const DEFAULT_HISTORY_LIMIT = 50;

/** Long help for “User Can Use Multi Device” — shown only inside the (i) popover on each company card. */
const USER_MULTI_DEVICE_HELP =
  "Yes: shared users can sign in on multiple devices (within plan limit). No: each shared user can use only one device; on a new device they must log out from this device or replace the old one.";

/** “Other companies — synced devices” ke neeche wala paragraph ab sirf (i) popover me — heading clean */
const OTHER_COMPANIES_DEVICES_SECTION_HELP =
  "Each card is a company other than the one open above. Same selection ticks and bulk kick as the card above.";

/** Pastel card shells — same order as dashboard `FinancialSummaryCards` (`pl-dashboard-ribbon-*` in globals.css). */
const DASHBOARD_DEVICE_CARD_PALETTE = [
  "border-emerald-300/70 pl-dashboard-ribbon-emerald",
  "border-sky-300/70 pl-dashboard-ribbon-sky",
  "border-violet-300/70 pl-dashboard-ribbon-violet",
  "border-amber-300/70 pl-dashboard-ribbon-amber",
  "border-rose-300/70 pl-dashboard-ribbon-rose",
  "border-teal-300/70 pl-dashboard-ribbon-teal",
  "border-indigo-300/70 pl-dashboard-ribbon-indigo",
] as const;

/** Poori table ke liye hamesha `overflow-x-auto` — mobile par negative mx nahi taake shell `px-[2px]` barabar rahe */
const DEVICE_SYNC_TABLE_SCROLL_SHELL =
  "min-w-0 overflow-x-auto overscroll-x-contain scrollbar-slim-dim md:-mx-1";

/** `table-auto` + `w-max` = content width; `min-w-full` = khali jagah bharne ke liye — zyada text par horizontal scroll. */
const DEVICE_SYNC_TABLE_CLASS = "table-auto min-w-full w-max";

/** User: Manage Devices cards — table/header horizontal rules pure black */
const DEVICE_RULE_H_BLACK = "border-b border-black";
const DEVICE_TABLE_HEADER_TR_BLACK = "[&_tr]:border-b [&_tr]:border-black";

/** CardContent: shadcn default `p-6` horizontal mobile par 2px — green card full width */
const MANAGE_DEVICES_MOBILE_CARD_PX = "max-md:px-[2px]";

/** Device / user / datetime: kabhi ellipsis/wrap nahi — ek line + baahar scroll shell. */
const SYNC_TD_DEVICE = "max-w-none whitespace-nowrap text-sm";

const SYNC_TD_USER = "max-w-none whitespace-nowrap text-sm";

const SYNC_TD_DATETIME = "max-w-none whitespace-nowrap text-sm leading-snug text-muted-foreground";

function dashboardDeviceCardClass(toneIndex: number): string {
  return cn(
    "app-chrome-top-ribbon rounded-lg border-2 border-foreground/30 shadow-sm transition-colors",
    DASHBOARD_DEVICE_CARD_PALETTE[toneIndex % DASHBOARD_DEVICE_CARD_PALETTE.length]
  );
}

/** Owner check for a registry `Company` row (same rules as the selected company’s `isCompanyOwner`). */
function isOwnerOfRegistryCompany(
  c: { storageOption?: string; ownerId?: string; ownerEmail?: string } | undefined,
  uid: string | undefined,
  email: string | null | undefined
): boolean {
  if (!c) return false;
  const local = String(c.storageOption || "local").toLowerCase() === "local";
  if (local) return true;
  return !!(uid && (c.ownerId === uid || (email && c.ownerEmail === email)));
}

/** Same physical `deviceId` can be registered under multiple companies — hide rows per Firestore company path. */
function optimisticDeviceKey(firestoreCompanyId: string, deviceDocId: string): string {
  return `${firestoreCompanyId}@@${deviceDocId}`;
}

function parseOptimisticDeviceKey(key: string): { firestoreCompanyId: string; deviceDocId: string } | null {
  const idx = key.indexOf("@@");
  if (idx <= 0) return null;
  return { firestoreCompanyId: key.slice(0, idx), deviceDocId: key.slice(idx + 2) };
}

/** Shared top bar: count line, multi-device switch + (i) popover. Selected = phone icon + “This company (name)”; other = sirf company naam. */
function DeviceCardHeaderBar(props: {
  titleName: string;
  count: number;
  max: number;
  /** Selected company card vs “Other companies” — overview me phone icon / “This company” prefix nahi. */
  variant?: "selected" | "otherCompany";
  /** Optional note after the count line (e.g. local-only hint). */
  subtitleExtra?: string;
  showMultiDevice: boolean;
  multiId: string;
  multiChecked: boolean;
  multiDisabled: boolean;
  /** Abhi Switch `disabled` me use nahi — optimistic toggle live; prop callers se compatible rehne ke liye. */
  multiSaving: boolean;
  isOwner: boolean;
  onMultiChange: (c: boolean) => void;
}) {
  const p = props;
  const variant = p.variant ?? "selected";
  const isSelectedCard = variant === "selected";
  return (
    // Pehli row: sirf title + multi-device (`items-start` — center se niche multi-device nahi); count line neeche alag
    <CardHeader className={cn("flex min-w-0 flex-col space-y-0 py-2 max-md:px-[2px] md:px-3", DEVICE_RULE_H_BLACK)}>
      <div className="flex min-w-0 flex-col gap-1">
        {/* Mobile: icon se switch tak ek hi horizontal scroll; desktop: wrap + justify-between */}
        <div className="min-w-0 max-md:overflow-x-auto max-md:overscroll-x-contain max-md:touch-pan-x max-md:[scrollbar-width:thin] md:overflow-x-visible">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 max-md:w-max max-md:flex-nowrap max-md:items-center md:w-full">
            <div className="flex min-w-0 max-w-full flex-1 items-start gap-2 max-md:max-w-none max-md:flex-none max-md:shrink-0 md:flex-1">
              {isSelectedCard ? (
                <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground max-md:mt-0" aria-hidden />
              ) : null}
              <CardTitle
                className="whitespace-nowrap text-sm font-semibold leading-snug tracking-tight sm:text-base md:min-w-0 md:whitespace-normal md:break-words"
                title={isSelectedCard ? `This company (${p.titleName})` : p.titleName}
              >
                {isSelectedCard ? `This company (${p.titleName})` : p.titleName}
              </CardTitle>
            </div>
            {p.showMultiDevice ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 self-start max-md:flex-none max-md:self-center -translate-y-px sm:-translate-y-0.5">
                {/* (i) label ke baen, beech 15px — pehle label ke daen tha */}
                <div className="flex flex-nowrap items-center gap-[15px]">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="About multi-device for shared users">
                        <Info className="h-3.5 w-3.5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="max-w-sm text-sm" align="end" side="bottom">
                      <p className="text-muted-foreground">{USER_MULTI_DEVICE_HELP}</p>
                      {!p.isOwner ? (
                        <p className="text-xs text-amber-800 dark:text-amber-200 mt-2">Only the company owner can change this policy.</p>
                      ) : null}
                    </PopoverContent>
                  </Popover>
                  <Label htmlFor={p.multiId} className="text-xs font-medium whitespace-nowrap cursor-pointer sm:text-sm">
                    User Can Use Multi Device
                  </Label>
                </div>
                <Switch id={p.multiId} checked={p.multiChecked} onCheckedChange={p.onMultiChange} disabled={p.multiDisabled} />
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-2">
          {/* Selected row icon ke neeche count align; otherCompany me icon nahi — spacer bhi nahi */}
          {isSelectedCard ? <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : null}
          <CardDescription className="mt-0 flex-1 text-xs text-muted-foreground leading-snug">
            devices in use. Count: {p.count} / {formatEntitlementCapLabel(p.max)}.
            {p.subtitleExtra ? ` ${p.subtitleExtra}` : ""}
          </CardDescription>
        </div>
      </div>
    </CardHeader>
  );
}

/** Per-company snapshot for the “all companies” section — full device list + plan cap. */
type CompanyDevicesOverviewRow = {
  /** Local registry company id (matches `companyId` when that company is selected). */
  registryId: string;
  name: string;
  /** Firestore `companies/{id}` segment for paths. */
  firestoreCompanyId: string;
  isLocal: boolean;
  error?: string;
  maxDevices: number;
  devices: DeviceRow[];
  /** From registry list; cloud policy toggle mirrors Firestore company doc. */
  userCanUseMultiDevice: boolean;
};

export function ManageDevices() {
  const { company, companyId, allCompanies } = useCompany();
  const { user } = useAuth();
  const { toast } = useToast();
  const livePlans = useLivePlans();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>(() => ({ ...userNamesCache }));
  const [loading, setLoading] = useState(true);
  /** Firestore commit ke daur selective kick buttons band */
  const [kickInFlight, setKickInFlight] = useState(false);
  /** Sirf toolbar “Kick selected” spinner — ek-off kick par toolbar spin na ho */
  const [bulkKickBusy, setBulkKickBusy] = useState(false);
  /** Turant rows hataane ke liye local set — authoritative list ab bhi Firestore snapshot */
  const [optimisticRemovedIds, setOptimisticRemovedIds] = useState<Set<string>>(() => new Set());
  const [selectedKickIds, setSelectedKickIds] = useState<Set<string>>(() => new Set());
  /** Overview tables: composite `firestoreCompanyId@@deviceId` so ticks work per company without clashing with the selected-company table. */
  const [overviewSelectedKickKeys, setOverviewSelectedKickKeys] = useState<Set<string>>(() => new Set());
  /** Per-company bulk kick from an overview card (different Firestore path than the shell selection). */
  const [confirmOverviewBulk, setConfirmOverviewBulk] = useState<{ firestoreCompanyId: string; name: string } | null>(null);
  /** Kick dialog must know which `companies/{id}` path to hit (overview ≠ selected company). */
  const [confirmKick, setConfirmKick] = useState<{ device: DeviceRow; firestoreCompanyId: string } | null>(null);
  const [confirmBulkKick, setConfirmBulkKick] = useState(false);
  /** Firestore `companies/{id}` id whose multi-device toggle is saving (any card). */
  const [multiDeviceSavingFsId, setMultiDeviceSavingFsId] = useState<string | null>(null);
  /** Click turant UI — `company` snapshot aane tak `multiChecked` yahi se (0.5s “hold” band). */
  const [optimisticMultiDeviceByFsId, setOptimisticMultiDeviceByFsId] = useState<Record<string, boolean>>({});
  /** Which company’s Remove is running — same device id can exist on several companies. */
  const [removingThisDeviceCompanyId, setRemovingThisDeviceCompanyId] = useState<string | null>(null);
  const currentDeviceId = typeof window !== "undefined" ? getOrCreateDeviceId() : "";
  const [deviceHistory, setDeviceHistory] = useState<DeviceHistoryRow[]>([]);
  const [historyLimitInput, setHistoryLimitInput] = useState<string>(String(DEFAULT_HISTORY_LIMIT));
  const [savingHistoryLimit, setSavingHistoryLimit] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [confirmDeleteAllHistory, setConfirmDeleteAllHistory] = useState(false);
  const [deletingAllHistory, setDeletingAllHistory] = useState(false);
  /** Cross-company device snapshots (one full-width card per company, same columns as “Synced devices”). */
  const [companyDevicesOverview, setCompanyDevicesOverview] = useState<CompanyDevicesOverviewRow[]>([]);
  const [companyDevicesOverviewLoading, setCompanyDevicesOverviewLoading] = useState(false);
  /** Bump after kicks/removes so the multi-company list refetches (device rows change). */
  const [adminOverviewTick, setAdminOverviewTick] = useState(0);

  const { refreshDeviceCheck } = useDeviceLimitContext();
  // Local company: device list should not depend on Firestore listeners.
  const isLocalCompany = String((company as { storageOption?: string } | null)?.storageOption || "local").toLowerCase() === "local";
  // Local company behaves as owner-managed on this device (no cloud owner doc check required).
  // Full device list + kicks: anyone with `configure_company_settings` (Settings tab already gated).
  // Previously only `ownerId` / ownerEmail matched — company admins saw a tiny "Remove" card and missed the multi-company overview.
  const isCompanyOwner = isLocalCompany || (!!company && (company.ownerId === user?.uid || (user?.email && company?.ownerEmail === user.email)));
  const userCanUseMultiDevice = company?.userCanUseMultiDevice !== false;
  /** `devices` / `device_history` Firestore path: overview jaisa — agar sirf registry `companyId` use kiya to mismatch (upar 0 row, neeche overview me 1). */
  const selectedFirestoreCompanyId = useMemo(() => {
    if (!companyId) return "";
    if (isLocalCompany) return companyId;
    return String((company as { authoritativeCompanyId?: string } | null)?.authoritativeCompanyId || companyId).trim() || companyId;
  }, [companyId, company, isLocalCompany]);
  const selectedMultiDeviceChecked = useMemo(() => {
    if (selectedFirestoreCompanyId && Object.prototype.hasOwnProperty.call(optimisticMultiDeviceByFsId, selectedFirestoreCompanyId)) {
      return optimisticMultiDeviceByFsId[selectedFirestoreCompanyId];
    }
    return userCanUseMultiDevice;
  }, [selectedFirestoreCompanyId, optimisticMultiDeviceByFsId, userCanUseMultiDevice]);
  const plan = getPlanFromPlans(livePlans, company?.planId as any);
  const maxDevicesRaw = Number(plan?.entitlements?.maxDevices);
  const maxDevices = isUnlimitedEntitlementCap(maxDevicesRaw)
    ? -1
    : Math.max(0, Number.isFinite(maxDevicesRaw) ? Math.floor(maxDevicesRaw) : 1);

  const companiesOverviewKey = useMemo(() => allCompanies.map((c) => c.id).join("|"), [allCompanies]);

  useEffect(() => {
    if (!user?.uid || allCompanies.length === 0) {
      setCompanyDevicesOverview([]);
      setCompanyDevicesOverviewLoading(false);
      return;
    }
    let cancelled = false;
    // Pehli load / empty overview par hi spinner — baad ke silent refetch par poora page jump nahi (multi-device toggle)
    const showBlockingSpinner = companyDevicesOverview.length === 0;
    if (showBlockingSpinner) setCompanyDevicesOverviewLoading(true);
    void (async () => {
      const rows = await Promise.all(
        allCompanies.map(async (c): Promise<CompanyDevicesOverviewRow> => {
          const name = (c.name || "").trim() || c.id;
          const fsCompanyId = String((c as { authoritativeCompanyId?: string }).authoritativeCompanyId || c.id).trim() || c.id;
          const planRow = getPlanFromPlans(livePlans, (c as { planId?: string }).planId as any);
          const maxDevRaw = Number(planRow?.entitlements?.maxDevices);
          const maxDev = isUnlimitedEntitlementCap(maxDevRaw)
            ? -1
            : Math.max(0, Number.isFinite(maxDevRaw) ? Math.floor(maxDevRaw) : 1);
          const ownerIdForCompany = (c.ownerId || "").trim();
          const isLocalRow = String(c.storageOption || "local").toLowerCase() === "local";
          if (isLocalRow) {
            const hasSlot =
              !!ownerIdForCompany && ownerIdForCompany === user.uid ? 1 : 0;
            return {
              registryId: c.id,
              name,
              firestoreCompanyId: fsCompanyId,
              isLocal: true,
              maxDevices: maxDev,
              userCanUseMultiDevice: (c as { userCanUseMultiDevice?: boolean }).userCanUseMultiDevice !== false,
              devices:
                hasSlot > 0
                  ? [
                      {
                        id: currentDeviceId || "local-device",
                        userId: user.uid,
                        lastActive: new Date(),
                        deviceType: isNativeRuntime() ? "mobile" : "desktop",
                        deviceLabel: isNativeRuntime() ? "This mobile device" : "This desktop device",
                        deviceSlot: 1,
                      },
                    ]
                  : [],
            };
          }
          try {
            const snap = await getDocs(collection(firestore, "companies", fsCompanyId, "devices"));
            const deviceRows: DeviceRow[] = snap.docs.map((d) => {
              const data = d.data();
              const la = data?.lastActive;
              const lastActive = la && typeof la.toMillis === "function" ? new Date(la.toMillis()) : null;
              const deviceType = (data?.deviceType === "mobile" || data?.deviceType === "desktop" ? data.deviceType : undefined) as DeviceRow["deviceType"];
              const deviceLabel = typeof data?.deviceLabel === "string" ? data.deviceLabel : undefined;
              const ds = data?.deviceSlot;
              const deviceSlot =
                typeof ds === "number" && Number.isFinite(ds) && Math.floor(ds) >= 1 ? Math.floor(ds) : undefined;
              return { id: d.id, userId: data?.userId ?? "", lastActive, deviceType, deviceLabel, deviceSlot };
            });
            deviceRows.sort((a, b) => (b.lastActive?.getTime() ?? 0) - (a.lastActive?.getTime() ?? 0));
            return {
              registryId: c.id,
              name,
              firestoreCompanyId: fsCompanyId,
              isLocal: false,
              maxDevices: maxDev,
              userCanUseMultiDevice: (c as { userCanUseMultiDevice?: boolean }).userCanUseMultiDevice !== false,
              devices: deviceRows,
            };
          } catch (e) {
            return {
              registryId: c.id,
              name,
              firestoreCompanyId: fsCompanyId,
              isLocal: false,
              maxDevices: maxDev,
              userCanUseMultiDevice: (c as { userCanUseMultiDevice?: boolean }).userCanUseMultiDevice !== false,
              devices: [],
              error: e instanceof Error ? e.message : "Could not load devices",
            };
          }
        })
      );
      if (!cancelled) {
        setCompanyDevicesOverview(rows);
        setCompanyDevicesOverviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companiesOverviewKey, user?.uid, allCompanies, adminOverviewTick, livePlans, currentDeviceId]);

  useEffect(() => {
    if (!companyId) {
      setDevices([]);
      setLoading(false);
      return;
    }
    if (isLocalCompany) {
      // Local-only: show this selected company as using one current device slot instantly.
      setDevices([
        {
          id: currentDeviceId || "local-device",
          userId: user?.uid || "local-user",
          lastActive: new Date(),
          deviceType: isNativeRuntime() ? "mobile" : "desktop",
          deviceLabel: isNativeRuntime() ? "This mobile device" : "This desktop device",
          deviceSlot: 1,
        },
      ]);
      setLoading(false);
      return;
    }
    const devicesRef = collection(firestore, "companies", selectedFirestoreCompanyId, "devices");
    const unsub = onSnapshot(devicesRef, (snap) => {
      const rows: DeviceRow[] = snap.docs.map((d) => {
        const data = d.data();
        const la = data?.lastActive;
        const lastActive = la && typeof la.toMillis === "function" ? new Date(la.toMillis()) : null;
        const deviceType = (data?.deviceType === "mobile" || data?.deviceType === "desktop" ? data.deviceType : undefined) as DeviceRow["deviceType"];
        const deviceLabel = typeof data?.deviceLabel === "string" ? data.deviceLabel : undefined;
        const ds = data?.deviceSlot;
        const deviceSlot =
          typeof ds === "number" && Number.isFinite(ds) && Math.floor(ds) >= 1 ? Math.floor(ds) : undefined;
        return { id: d.id, userId: data?.userId ?? "", lastActive, deviceType, deviceLabel, deviceSlot };
      });
      rows.sort((a, b) => (b.lastActive?.getTime() ?? 0) - (a.lastActive?.getTime() ?? 0));
      setDevices(rows);
      setLoading(false);
    });
    return () => unsub();
  }, [companyId, selectedFirestoreCompanyId, currentDeviceId, isLocalCompany, user?.uid]);

  const ownerId = company?.ownerId ?? "";
  const companyHistoryLimit = (company as { deviceHistoryLimit?: number } | null)?.deviceHistoryLimit ?? DEFAULT_HISTORY_LIMIT;

  useEffect(() => {
    setHistoryLimitInput(String(companyHistoryLimit));
  }, [companyHistoryLimit]);

  useEffect(() => {
    if (!companyId) {
      setDeviceHistory([]);
      return;
    }
    if (isLocalCompany) {
      // Local-only: no Firestore device history stream, so avoid spinner/waits.
      setDeviceHistory([]);
      return;
    }
    const historyRef = collection(firestore, "companies", selectedFirestoreCompanyId, "device_history");
    const q = query(historyRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const rows: DeviceHistoryRow[] = snap.docs.map((d) => {
        const data = d.data();
        const la = data?.lastActive;
        const ca = data?.createdAt;
        const lastActive = la && typeof (la as { toMillis?: () => number })?.toMillis === "function" ? new Date((la as { toMillis: () => number }).toMillis()) : null;
        const createdAt = ca && typeof (ca as { toMillis?: () => number })?.toMillis === "function" ? new Date((ca as { toMillis: () => number }).toMillis()) : null;
        const deviceType = (data?.deviceType === "mobile" || data?.deviceType === "desktop" ? data.deviceType : undefined) as DeviceHistoryRow["deviceType"];
        const deviceLabel = typeof data?.deviceLabel === "string" ? data.deviceLabel : undefined;
        return {
          id: d.id,
          deviceId: data?.deviceId ?? "",
          userId: data?.userId ?? "",
          lastActive,
          deviceType,
          deviceLabel,
          createdAt,
        };
      });
      setDeviceHistory(rows);
    });
    return () => unsub();
  }, [companyId, selectedFirestoreCompanyId, isLocalCompany]);

  const sortedDevices = useMemo(() => {
    return [...devices].sort((a, b) => {
      const aThis = a.id === currentDeviceId;
      const bThis = b.id === currentDeviceId;
      if (aThis && !bThis) return -1;
      if (!aThis && bThis) return 1;
      const aOwner = a.userId === ownerId;
      const bOwner = b.userId === ownerId;
      if (aOwner && !bOwner) return -1;
      if (!aOwner && bOwner) return 1;
      return (b.lastActive?.getTime() ?? 0) - (a.lastActive?.getTime() ?? 0);
    });
  }, [devices, ownerId, currentDeviceId]);

  // Snapshot + optimistic filtered table + bulk tick target list
  const visibleSortedDevices = useMemo(
    () =>
      sortedDevices.filter((d) => {
        if (!selectedFirestoreCompanyId) return true;
        return !optimisticRemovedIds.has(optimisticDeviceKey(selectedFirestoreCompanyId, d.id));
      }),
    [sortedDevices, optimisticRemovedIds, selectedFirestoreCompanyId]
  );
  const kickableVisibleIds = useMemo(
    () => visibleSortedDevices.filter((d) => d.id !== currentDeviceId).map((d) => d.id),
    [visibleSortedDevices, currentDeviceId]
  );
  const kickableIdsKey = useMemo(() => kickableVisibleIds.join(","), [kickableVisibleIds]);

  /** Snapshot / overview refetch ke baad jo docs gayab ho chuke hon unke optimistic keys hatao */
  useEffect(() => {
    setOptimisticRemovedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set(prev);
      for (const key of prev) {
        const parsed = parseOptimisticDeviceKey(key);
        if (!parsed) {
          next.delete(key);
          changed = true;
          continue;
        }
        const { firestoreCompanyId: cid, deviceDocId: did } = parsed;
        const inSelected = selectedFirestoreCompanyId === cid && devices.some((d) => d.id === did);
        const ov = companyDevicesOverview.find((r) => r.firestoreCompanyId === cid);
        const inOverview = ov?.devices.some((d) => d.id === did) ?? false;
        if (!inSelected && !inOverview) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [devices, companyId, companyDevicesOverview]);

  /** Kickable overview rows dropped from snapshot / refetch — drop stale tick keys */
  useEffect(() => {
    setOverviewSelectedKickKeys((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const key of prev) {
        const parsed = parseOptimisticDeviceKey(key);
        if (!parsed) continue;
        const { firestoreCompanyId: cid, deviceDocId: did } = parsed;
        const ov = companyDevicesOverview.find((r) => r.firestoreCompanyId === cid);
        if (!ov || ov.isLocal) continue;
        if (did === currentDeviceId) continue;
        if (ov.devices.some((d) => d.id === did)) next.add(key);
      }
      return next.size === prev.size && [...prev].every((x) => next.has(x)) ? prev : next;
    });
  }, [companyDevicesOverview, currentDeviceId]);

  /** Kickable list shrink (refresh / optimistic) → tick state invalid IDs saaf */
  useEffect(() => {
    const allowed = new Set(kickableVisibleIds);
    setSelectedKickIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (allowed.has(id)) next.add(id);
      });
      return next.size === prev.size && [...prev].every((x) => next.has(x)) ? prev : next;
    });
  }, [kickableIdsKey]);

  const overviewDeviceUserIds = useMemo(
    () => companyDevicesOverview.flatMap((r) => r.devices.map((d) => d.userId)).filter(Boolean),
    [companyDevicesOverview]
  );

  const userIdsKey = useMemo(
    () =>
      [...new Set([...devices.map((d) => d.userId), ...deviceHistory.map((h) => h.userId), ...overviewDeviceUserIds].filter(Boolean))].sort().join(","),
    [devices, deviceHistory, overviewDeviceUserIds]
  );

  const mergedSharedWithForNames = useMemo(() => {
    const out: Array<{ uid?: string; name?: string; email?: string }> = [];
    for (const c of allCompanies) {
      const sw = (c as { sharedWith?: Array<{ uid?: string; name?: string; email?: string }> }).sharedWith;
      if (Array.isArray(sw)) out.push(...sw);
    }
    return out;
  }, [allCompanies]);

  useEffect(() => {
    const userIds = [...new Set([...devices.map((d) => d.userId), ...deviceHistory.map((h) => h.userId), ...overviewDeviceUserIds].filter(Boolean))];
    if (userIds.length === 0) return;
    let cancelled = false;
    const map: Record<string, string> = {};
    // Merge sharedWith from all registry companies so overview tables can show names for non-current company.
    const sharedWith =
      mergedSharedWithForNames.length > 0
        ? mergedSharedWithForNames
        : ((company?.sharedWith || []) as Array<{ uid?: string; name?: string; email?: string }>);
    Promise.all(
      userIds.map(async (uid) => {
        if (cancelled) return;
        const byId = await getDoc(doc(firestore, "users", uid));
        let d: Record<string, unknown> | null = byId.exists() ? byId.data() : null;
        if (!d) {
          const byUid = await getDocs(query(collection(firestore, "users"), where("uid", "==", uid)));
          d = byUid.docs[0]?.data() ?? null;
        }
        if (cancelled) return;
        if (d) {
          const name = (d.name as string)?.trim();
          const displayName = (d.displayName as string)?.trim();
          const email = (d.email as string)?.trim();
          const raw = name || displayName || email || "";
          const isUidLike = raw === uid || /^[a-zA-Z0-9_-]{20,}$/.test(raw);
          map[uid] = raw && !isUidLike ? raw : "—";
        } else {
          map[uid] = "—";
        }
        if (map[uid] === "—" && sharedWith.length > 0) {
          const shared = sharedWith.find((u) => u.uid === uid);
          if (shared) map[uid] = (shared.name as string)?.trim() || (shared.email as string)?.trim() || "—";
        }
      })
    ).then(() => {
      if (!cancelled) {
        Object.assign(userNamesCache, map);
        setUserNames((prev) => ({ ...prev, ...map }));
      }
    });
    return () => { cancelled = true; };
  }, [userIdsKey, mergedSharedWithForNames, company?.sharedWith]);

  const persistUserCanUseMultiDevice = async (targetFirestoreCompanyId: string, checked: boolean, isOwnerForTarget: boolean) => {
    if (!targetFirestoreCompanyId || !isOwnerForTarget) return;
    setOptimisticMultiDeviceByFsId((prev) => ({ ...prev, [targetFirestoreCompanyId]: checked }));
    setMultiDeviceSavingFsId(targetFirestoreCompanyId);
    try {
      await updateDoc(doc(firestore, "companies", targetFirestoreCompanyId), { userCanUseMultiDevice: checked });
      // Non-selected company cards `companyDevicesOverview` se aate hain — listener har doc par nahi; turant patch taake refetch/tick bina sync
      setCompanyDevicesOverview((prev) =>
        prev.map((r) =>
          r.firestoreCompanyId === targetFirestoreCompanyId ? { ...r, userCanUseMultiDevice: checked } : r
        )
      );
      toast({
        title: "Setting saved",
        description: checked ? "Shared users can use multiple devices (within plan limit)." : "Shared users can use only one device at a time.",
      });
    } catch (e: unknown) {
      setOptimisticMultiDeviceByFsId((prev) => {
        const n = { ...prev };
        delete n[targetFirestoreCompanyId];
        return n;
      });
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed to save", variant: "destructive" });
    } finally {
      setMultiDeviceSavingFsId(null);
    }
  };

  /** Server / overview patch optimistic value se match ho to overlay hata — double source of truth na rahe */
  useEffect(() => {
    setOptimisticMultiDeviceByFsId((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      const next = { ...prev };
      let changed = false;
      for (const fid of keys) {
        const want = prev[fid];
        if (fid === selectedFirestoreCompanyId) {
          if (!company) continue;
          const live = company.userCanUseMultiDevice !== false;
          if (live === want) {
            delete next[fid];
            changed = true;
          }
          continue;
        }
        const row = companyDevicesOverview.find((r) => r.firestoreCompanyId === fid);
        if (row && row.userCanUseMultiDevice === want) {
          delete next[fid];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [companyId, selectedFirestoreCompanyId, company, companyDevicesOverview]);

  /** One or more rows under `companies/{targetFirestoreCompanyId}` — overview or selected table. */
  const confirmAndKickDevices = (targetFirestoreCompanyId: string, rows: DeviceRow[]) => {
    setConfirmKick(null);
    setConfirmBulkKick(false);
    setConfirmOverviewBulk(null);
    if (!targetFirestoreCompanyId || rows.length === 0) return;
    const keys = rows.map((r) => optimisticDeviceKey(targetFirestoreCompanyId, r.id));
    const ids = rows.map((r) => r.id);
    setOptimisticRemovedIds((prev) => {
      const n = new Set(prev);
      keys.forEach((k) => n.add(k));
      return n;
    });
    setSelectedKickIds((prev) => {
      const n = new Set(prev);
      ids.forEach((id) => n.delete(id));
      return n;
    });
    setOverviewSelectedKickKeys((prev) => {
      const n = new Set(prev);
      keys.forEach((k) => n.delete(k));
      return n;
    });
    setKickInFlight(true);
    if (rows.length > 1) setBulkKickBusy(true);
    void (async () => {
      try {
        await kickOutDevicesBatch(
          targetFirestoreCompanyId,
          rows.map((r) => ({
            id: r.id,
            userId: r.userId,
            deviceType: r.deviceType,
            deviceLabel: r.deviceLabel,
          }))
        );
        refreshDeviceCheck();
        setAdminOverviewTick((t) => t + 1);
        toast({
          title: rows.length > 1 ? "Devices removed" : "Device removed",
          description:
            rows.length > 1
              ? `${rows.length} slot(s) freed. Those sessions will hit the limit or need sign-in again.`
              : "That device will see slot full and can switch company or remove that device.",
        });
      } catch (e: unknown) {
        setOptimisticRemovedIds((prev) => {
          const n = new Set(prev);
          keys.forEach((k) => n.delete(k));
          return n;
        });
        const msg = e instanceof Error ? e.message : "Failed to remove device";
        toast({ title: "Error", description: msg, variant: "destructive" });
      } finally {
        setKickInFlight(false);
        setBulkKickBusy(false);
      }
    })();
  };

  const handleSaveHistoryLimit = async () => {
    if (!companyId) return;
    const num = Math.max(1, Math.min(1000, parseInt(historyLimitInput, 10) || DEFAULT_HISTORY_LIMIT));
    setSavingHistoryLimit(true);
    try {
      await updateDoc(doc(firestore, "companies", selectedFirestoreCompanyId), { deviceHistoryLimit: num });
      await trimDeviceHistoryToLimit(selectedFirestoreCompanyId, num);
      setHistoryLimitInput(String(num));
      toast({ title: "Saved", description: `Device history will keep up to ${num} entries.` });
    } catch (e: unknown) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed to save", variant: "destructive" });
    } finally {
      setSavingHistoryLimit(false);
    }
  };

  const handleDeleteHistoryEntry = async (entryId: string) => {
    if (!companyId) return;
    setDeletingHistoryId(entryId);
    try {
      await deleteDoc(doc(firestore, "companies", selectedFirestoreCompanyId, "device_history", entryId));
      toast({ title: "Entry removed", description: "History entry deleted." });
    } catch (e: unknown) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed to delete", variant: "destructive" });
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const handleDeleteAllHistory = async () => {
    if (!companyId) return;
    setDeletingAllHistory(true);
    try {
      const snap = await getDocs(collection(firestore, "companies", selectedFirestoreCompanyId, "device_history"));
      const docs = snap.docs;
      const chunk = 450;
      for (let i = 0; i < docs.length; i += chunk) {
        const batch = writeBatch(firestore);
        docs.slice(i, i + chunk).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      toast({ title: "History cleared", description: "All device history entries removed." });
      setConfirmDeleteAllHistory(false);
    } catch (e: unknown) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to delete all",
        variant: "destructive",
      });
    } finally {
      setDeletingAllHistory(false);
    }
  };

  /** Free slot for this browser on any company path (used from overview cards too). */
  const handleRemoveThisDeviceForCompany = async (targetFirestoreCompanyId: string) => {
    if (!targetFirestoreCompanyId) return;
    const did = currentDeviceId || "local-device";
    const optKey = optimisticDeviceKey(targetFirestoreCompanyId, did);
    setRemovingThisDeviceCompanyId(targetFirestoreCompanyId);
    setOptimisticRemovedIds((prev) => new Set(prev).add(optKey));
    try {
      await removeThisDevice(targetFirestoreCompanyId);
      refreshDeviceCheck();
      setAdminOverviewTick((t) => t + 1);
      toast({
        title: "Device removed",
        description: "This device no longer uses a slot. You can open the company again to use a slot if available.",
      });
    } catch (e: unknown) {
      setOptimisticRemovedIds((prev) => {
        const n = new Set(prev);
        n.delete(optKey);
        return n;
      });
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed to remove device", variant: "destructive" });
    } finally {
      setRemovingThisDeviceCompanyId(null);
    }
  };

  const handleRemoveThisDevice = () => {
    if (!selectedFirestoreCompanyId) return;
    void handleRemoveThisDeviceForCompany(selectedFirestoreCompanyId);
  };

  /** Selected company is shown only in the top “Synced devices” card — avoid listing it again here. */
  const otherCompaniesDevicesOverview = useMemo(() => {
    return [...companyDevicesOverview]
      .filter(
        (r) => r.registryId !== companyId && r.firestoreCompanyId !== companyId && r.firestoreCompanyId !== selectedFirestoreCompanyId
      )
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [companyDevicesOverview, companyId, selectedFirestoreCompanyId]);

  if (!companyId || !company) {
    return (
      <Card className={cn(dashboardDeviceCardClass(0), "w-full min-w-0 max-w-full")}>
        <CardHeader>
          <CardTitle>Synced devices</CardTitle>
          <CardDescription>Select a company to view and manage devices.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Header checkbox state: all kickable / partial / none selected
  const bulkHeadCheckboxChecked: boolean | "indeterminate" =
    kickableVisibleIds.length === 0
      ? false
      : kickableVisibleIds.every((id) => selectedKickIds.has(id))
        ? true
        : kickableVisibleIds.some((id) => selectedKickIds.has(id))
          ? "indeterminate"
          : false;

  return (
    <div className="w-full min-w-0 max-w-full space-y-3 rounded-xl border border-border/50 bg-slate-50/85 px-[2px] py-3 dark:bg-slate-950/35 sm:space-y-4 md:px-3 md:py-3">
      <Card className={cn(dashboardDeviceCardClass(0), "w-full min-w-0 max-w-full")}>
        <DeviceCardHeaderBar
          titleName={(company?.name || "").trim() || companyId}
          count={visibleSortedDevices.length}
          max={maxDevices}
          subtitleExtra={isLocalCompany ? "Local company data uses this device only." : undefined}
          showMultiDevice
          multiId={`multi-dev-sel-${companyId}`}
          multiChecked={selectedMultiDeviceChecked}
          multiDisabled={!isCompanyOwner}
          multiSaving={multiDeviceSavingFsId === selectedFirestoreCompanyId}
          isOwner={isCompanyOwner}
          onMultiChange={(c) => void persistUserCanUseMultiDevice(selectedFirestoreCompanyId, c, isCompanyOwner)}
        />
        <CardContent className={cn("min-w-0 space-y-4", MANAGE_DEVICES_MOBILE_CARD_PX)}>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No devices registered yet.</p>
          ) : visibleSortedDevices.length === 0 && optimisticRemovedIds.size > 0 ? (
            <p className="text-sm text-muted-foreground py-4 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Syncing removals…
            </p>
          ) : (
            <div className={DEVICE_SYNC_TABLE_SCROLL_SHELL}>
              <Table scrollContainer={false} className={DEVICE_SYNC_TABLE_CLASS}>
              <TableHeader className={DEVICE_TABLE_HEADER_TR_BLACK}>
                <TableRow className={cn(DEVICE_RULE_H_BLACK, "hover:bg-transparent")}>
                  <TableHead className="w-12 shrink-0 pt-2">
                    <Checkbox
                      checked={bulkHeadCheckboxChecked}
                      disabled={kickInFlight || kickableVisibleIds.length === 0}
                      onCheckedChange={(c) => {
                        if (c === true) setSelectedKickIds(new Set(kickableVisibleIds));
                        else setSelectedKickIds(new Set());
                      }}
                      aria-label="Select all devices you can kick"
                    />
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Device</TableHead>
                  <TableHead className="w-[4.5rem] shrink-0 whitespace-nowrap">Slot</TableHead>
                  <TableHead className="whitespace-nowrap">User name</TableHead>
                  <TableHead className="whitespace-nowrap">Last active</TableHead>
                  <TableHead className="w-12 shrink-0 text-center">Device type</TableHead>
                  {/* Bulk kick ab yahi — tick select hone par “Kick selected” (upar alag row band) */}
                  <TableHead className="min-w-[9rem] whitespace-nowrap py-2 text-right align-bottom">
                    <div className="flex flex-col items-end gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Actions</span>
                      {kickableVisibleIds.length > 0 && selectedKickIds.size > 0 ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-8 shrink-0"
                          disabled={kickInFlight}
                          onClick={() => setConfirmBulkKick(true)}
                        >
                          {bulkKickBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          <span className={bulkKickBusy ? "ml-1.5" : ""}>Kick selected ({selectedKickIds.size})</span>
                        </Button>
                      ) : null}
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleSortedDevices.map((device) => {
                  const isAdmin = device.userId === ownerId;
                  const displayName = isAdmin ? "Admin" : (userNames[device.userId] ?? "—");
                  const isUid = !isAdmin && (displayName === device.userId || /^[a-zA-Z0-9]{20,32}$/.test(displayName));
                  const isThisDevice = device.id === currentDeviceId;
                  // Checkbox / screen reader: readable name (DEV- code hata diya UI se)
                  const deviceNameText = shortDeviceLabelForList(device.deviceLabel, device.deviceType);
                  const deviceNameTitle = deviceLabelTooltipIfTruncated(device.deviceLabel, deviceNameText);
                  return (
                  <TableRow
                    key={device.id}
                    className={cn(
                      DEVICE_RULE_H_BLACK,
                      isThisDevice ? "cursor-default pointer-events-none hover:bg-transparent" : undefined
                    )}
                  >
                    <TableCell className="w-12 shrink-0 pointer-events-auto align-middle">
                      {isThisDevice ? (
                        <span className="inline-block w-4" aria-hidden />
                      ) : (
                        <Checkbox
                          checked={selectedKickIds.has(device.id)}
                          disabled={kickInFlight}
                          onCheckedChange={(c) => {
                            setSelectedKickIds((prev) => {
                              const n = new Set(prev);
                              if (c) n.add(device.id);
                              else n.delete(device.id);
                              return n;
                            });
                          }}
                          aria-label={`Select device ${deviceNameText} for bulk kick`}
                        />
                      )}
                    </TableCell>
                    <TableCell className={cn(SYNC_TD_DEVICE)} title={device.id}>
                      <span
                        className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0"
                        title={deviceNameTitle}
                      >
                        <span>{deviceNameText}</span>
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(SYNC_TD_DEVICE, "tabular-nums")}
                      title={device.deviceSlot != null ? `Slot ${device.deviceSlot}` : undefined}
                    >
                      {/* Slot number + "This device" — device naam aur user name ke beech column */}
                      <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0">
                        <span className="font-medium text-foreground">{formatDeviceSlotLabel(device.deviceSlot)}</span>
                        {isThisDevice ? (
                          <span className="shrink-0 text-xs font-medium text-muted-foreground">This device</span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className={cn(SYNC_TD_USER)} title={isAdmin ? "Admin" : isUid ? undefined : displayName}>
                      {isAdmin ? "Admin" : (isUid ? "—" : displayName)}
                    </TableCell>
                    <TableCell
                      className={SYNC_TD_DATETIME}
                      title={device.lastActive ? device.lastActive.toLocaleString() : undefined}
                    >
                      {device.lastActive ? device.lastActive.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="w-12 shrink-0 text-center text-muted-foreground">
                      {device.deviceType === "mobile" ? (
                        <span title="Mobile"><Smartphone className="h-4 w-4 inline" /></span>
                      ) : device.deviceType === "desktop" ? (
                        <span title="PC"><Monitor className="h-4 w-4 inline" /></span>
                      ) : (
                        <span title="Device"><Monitor className="h-4 w-4 inline" /></span>
                      )}
                    </TableCell>
                    <TableCell className={cn("min-w-0 whitespace-normal text-right align-middle", isThisDevice && "pointer-events-auto")}>
                      <div className="flex flex-col items-end gap-1">
                        {isThisDevice ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 -mr-2"
                            onClick={handleRemoveThisDevice}
                            disabled={removingThisDeviceCompanyId !== null || kickInFlight}
                          >
                            {removingThisDeviceCompanyId === selectedFirestoreCompanyId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            <span className="ml-1">Remove</span>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10 -mr-2"
                            onClick={() => selectedFirestoreCompanyId && setConfirmKick({ device, firestoreCompanyId: selectedFirestoreCompanyId })}
                            disabled={kickInFlight || !selectedFirestoreCompanyId}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="ml-1">Kick out</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );})}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="h-px w-full bg-black" aria-hidden />

      {/* Other companies: each card cycles dashboard pastel tones (index 1+). */}
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <h2 className="text-base font-semibold tracking-tight">Other companies — synced devices</h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="About other companies synced devices"
              >
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="max-w-sm text-sm" align="end" side="bottom">
              <p className="text-muted-foreground">{OTHER_COMPANIES_DEVICES_SECTION_HELP}</p>
            </PopoverContent>
          </Popover>
        </div>
        {companyDevicesOverviewLoading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading devices for all companies…</span>
          </div>
        ) : otherCompaniesDevicesOverview.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No other companies in your list. The selected company is managed in the card above.</p>
        ) : (
          otherCompaniesDevicesOverview.map((row, rowIdx) => {
            const ownerIdForRow = (allCompanies.find((c) => c.id === row.registryId)?.ownerId || "").trim();
            const visibleOverviewDevices = row.devices.filter(
              (d) => !optimisticRemovedIds.has(optimisticDeviceKey(row.firestoreCompanyId, d.id))
            );
            const fs = row.firestoreCompanyId;
            // Cloud-only bulk: same rules as the selected-company table (cannot kick this browser row from a tick).
            const overviewKickable = visibleOverviewDevices.filter((d) => !row.isLocal && d.id !== currentDeviceId);
            const overviewPickCount = overviewKickable.filter((d) => overviewSelectedKickKeys.has(optimisticDeviceKey(fs, d.id))).length;
            const overviewBulkHeadCheckboxChecked: boolean | "indeterminate" =
              overviewKickable.length === 0
                ? false
                : overviewKickable.every((d) => overviewSelectedKickKeys.has(optimisticDeviceKey(fs, d.id)))
                  ? true
                  : overviewKickable.some((d) => overviewSelectedKickKeys.has(optimisticDeviceKey(fs, d.id)))
                    ? "indeterminate"
                    : false;
            const reg = allCompanies.find((c) => c.id === row.registryId);
            const isOwnerForRow = isOwnerOfRegistryCompany(reg, user?.uid, user?.email);
            return (
              <Card key={row.registryId} className={cn(dashboardDeviceCardClass(1 + rowIdx), "w-full min-w-0 max-w-full")}>
                <DeviceCardHeaderBar
                  variant="otherCompany"
                  titleName={row.name}
                  count={visibleOverviewDevices.length}
                  max={row.maxDevices}
                  subtitleExtra={row.isLocal ? "Local company data uses this device only." : undefined}
                  showMultiDevice={!row.isLocal}
                  multiId={`multi-dev-ov-${row.registryId}`}
                  multiChecked={
                    Object.prototype.hasOwnProperty.call(optimisticMultiDeviceByFsId, row.firestoreCompanyId)
                      ? optimisticMultiDeviceByFsId[row.firestoreCompanyId]
                      : row.userCanUseMultiDevice
                  }
                  multiDisabled={!isOwnerForRow}
                  multiSaving={multiDeviceSavingFsId === row.firestoreCompanyId}
                  isOwner={isOwnerForRow}
                  onMultiChange={(c) => void persistUserCanUseMultiDevice(row.firestoreCompanyId, c, isOwnerForRow)}
                />
                <CardContent className={cn("min-w-0 space-y-4 pt-6", MANAGE_DEVICES_MOBILE_CARD_PX)}>
                  {row.error ? (
                    <p className="text-sm text-destructive">{row.error}</p>
                  ) : row.devices.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">No devices registered yet.</p>
                  ) : visibleOverviewDevices.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Syncing removals…
                    </p>
                  ) : (
                    <>
                      <div className={DEVICE_SYNC_TABLE_SCROLL_SHELL}>
                      <Table scrollContainer={false} className={DEVICE_SYNC_TABLE_CLASS}>
                        <TableHeader className={DEVICE_TABLE_HEADER_TR_BLACK}>
                          <TableRow className={cn(DEVICE_RULE_H_BLACK, "hover:bg-transparent")}>
                            <TableHead className="w-12 shrink-0 pt-2">
                              <Checkbox
                                checked={overviewBulkHeadCheckboxChecked}
                                disabled={kickInFlight || row.isLocal || overviewKickable.length === 0}
                                onCheckedChange={(c) => {
                                  setOverviewSelectedKickKeys((prev) => {
                                    const next = new Set(prev);
                                    if (c === true) overviewKickable.forEach((d) => next.add(optimisticDeviceKey(fs, d.id)));
                                    else overviewKickable.forEach((d) => next.delete(optimisticDeviceKey(fs, d.id)));
                                    return next;
                                  });
                                }}
                                aria-label={`Select all kickable devices in ${row.name}`}
                              />
                            </TableHead>
                            <TableHead className="whitespace-nowrap">Device</TableHead>
                            <TableHead className="w-[4.5rem] shrink-0 whitespace-nowrap">Slot</TableHead>
                            <TableHead className="whitespace-nowrap">User name</TableHead>
                            <TableHead className="whitespace-nowrap">Last active</TableHead>
                            <TableHead className="w-12 shrink-0 text-center">Device type</TableHead>
                            <TableHead className="min-w-[9rem] whitespace-nowrap py-2 text-right align-bottom">
                              <div className="flex flex-col items-end gap-1.5">
                                <span className="text-xs font-medium text-muted-foreground">Actions</span>
                                {!row.isLocal && overviewKickable.length > 0 && overviewPickCount > 0 ? (
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    className="h-8 shrink-0"
                                    disabled={kickInFlight}
                                    onClick={() => setConfirmOverviewBulk({ firestoreCompanyId: fs, name: row.name })}
                                  >
                                    Kick selected ({overviewPickCount})
                                  </Button>
                                ) : null}
                              </div>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleOverviewDevices.map((device) => {
                            const isAdmin = device.userId === ownerIdForRow;
                            const displayName = isAdmin ? "Admin" : (userNames[device.userId] ?? "—");
                            const isUid =
                              !isAdmin && (displayName === device.userId || /^[a-zA-Z0-9]{20,32}$/.test(displayName));
                            const isThisDevice = device.id === currentDeviceId;
                            const removingHere = removingThisDeviceCompanyId === row.firestoreCompanyId;
                            const deviceNameTextOv = shortDeviceLabelForList(device.deviceLabel, device.deviceType);
                            const deviceNameTitleOv = deviceLabelTooltipIfTruncated(device.deviceLabel, deviceNameTextOv);
                            return (
                              <TableRow
                                key={`${row.registryId}-${device.id}`}
                                className={cn(
                                  DEVICE_RULE_H_BLACK,
                                  isThisDevice ? "cursor-default pointer-events-none hover:bg-transparent" : undefined
                                )}
                              >
                                <TableCell className="w-12 shrink-0 align-middle pointer-events-auto">
                                  {isThisDevice || row.isLocal ? (
                                    <span className="inline-block w-4" aria-hidden />
                                  ) : (
                                    <Checkbox
                                      checked={overviewSelectedKickKeys.has(optimisticDeviceKey(fs, device.id))}
                                      disabled={kickInFlight}
                                      onCheckedChange={(c) => {
                                        const k = optimisticDeviceKey(fs, device.id);
                                        setOverviewSelectedKickKeys((prev) => {
                                          const next = new Set(prev);
                                          if (c) next.add(k);
                                          else next.delete(k);
                                          return next;
                                        });
                                      }}
                                      aria-label={`Select device ${deviceNameTextOv} for bulk kick`}
                                    />
                                  )}
                                </TableCell>
                                <TableCell className={SYNC_TD_DEVICE} title={device.id}>
                                  <span
                                    className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0"
                                    title={deviceNameTitleOv}
                                  >
                                    <span>{deviceNameTextOv}</span>
                                  </span>
                                </TableCell>
                                <TableCell
                                  className={cn(SYNC_TD_DEVICE, "tabular-nums")}
                                  title={device.deviceSlot != null ? `Slot ${device.deviceSlot}` : undefined}
                                >
                                  <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0">
                                    <span className="font-medium text-foreground">{formatDeviceSlotLabel(device.deviceSlot)}</span>
                                    {isThisDevice ? (
                                      <span className="shrink-0 text-xs font-medium text-muted-foreground">This device</span>
                                    ) : null}
                                  </span>
                                </TableCell>
                                <TableCell className={SYNC_TD_USER} title={isAdmin ? "Admin" : isUid ? undefined : displayName}>
                                  {isAdmin ? "Admin" : isUid ? "—" : displayName}
                                </TableCell>
                                <TableCell
                                  className={SYNC_TD_DATETIME}
                                  title={device.lastActive ? device.lastActive.toLocaleString() : undefined}
                                >
                                  {device.lastActive ? device.lastActive.toLocaleString() : "—"}
                                </TableCell>
                                <TableCell className="w-12 shrink-0 text-center text-muted-foreground">
                                  {device.deviceType === "mobile" ? (
                                    <span title="Mobile">
                                      <Smartphone className="h-4 w-4 inline" />
                                    </span>
                                  ) : device.deviceType === "desktop" ? (
                                    <span title="PC">
                                      <Monitor className="h-4 w-4 inline" />
                                    </span>
                                  ) : (
                                    <span title="Device">
                                      <Monitor className="h-4 w-4 inline" />
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className={cn("min-w-0 whitespace-normal text-right align-middle", isThisDevice && "pointer-events-auto")}>
                                  <div className="flex flex-col items-end gap-1">
                                    {isThisDevice ? (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive hover:bg-destructive/10 -mr-2"
                                        onClick={() => void handleRemoveThisDeviceForCompany(row.firestoreCompanyId)}
                                        disabled={removingThisDeviceCompanyId !== null || kickInFlight}
                                      >
                                        {removingHere ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                        <span className="ml-1">Remove</span>
                                      </Button>
                                    ) : row.isLocal ? (
                                      <span className="text-sm text-muted-foreground">—</span>
                                    ) : (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive hover:bg-destructive/10 -mr-2"
                                        onClick={() => setConfirmKick({ device, firestoreCompanyId: row.firestoreCompanyId })}
                                        disabled={kickInFlight}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        <span className="ml-1">Kick out</span>
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <div className="h-px w-full bg-black" aria-hidden />

      <Card className={cn(dashboardDeviceCardClass(1 + otherCompaniesDevicesOverview.length), "w-full min-w-0 max-w-full")}>
        <CardHeader className={cn("min-w-0", DEVICE_RULE_H_BLACK)}>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Device history
          </CardTitle>
          <CardDescription>
            Log of devices that were kicked or removed. Set how many entries to keep; oldest are removed when over limit.
          </CardDescription>
        </CardHeader>
        <CardContent className={cn("min-w-0 space-y-4", MANAGE_DEVICES_MOBILE_CARD_PX)}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="history-limit">Max history entries to save</Label>
              <Input
                id="history-limit"
                type="number"
                min={1}
                max={1000}
                value={historyLimitInput}
                onChange={(e) => setHistoryLimitInput(e.target.value)}
                className="w-28"
              />
            </div>
            <Button onClick={handleSaveHistoryLimit} disabled={savingHistoryLimit}>
              {savingHistoryLimit ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span className={savingHistoryLimit ? "ml-2" : ""}>Save</span>
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{deviceHistory.length} entries (keeping up to {companyHistoryLimit})</p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDeleteAllHistory(true)}
              disabled={deviceHistory.length === 0}
            >
              <Trash2 className="h-4 w-4" />
              <span className="ml-2">Delete all history</span>
            </Button>
          </div>
          {deviceHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No history yet. Entries are added when a device is kicked or removed.</p>
          ) : (
            <div className={DEVICE_SYNC_TABLE_SCROLL_SHELL}>
            <Table scrollContainer={false} className={DEVICE_SYNC_TABLE_CLASS}>
              <TableHeader className={DEVICE_TABLE_HEADER_TR_BLACK}>
                <TableRow className={cn(DEVICE_RULE_H_BLACK, "hover:bg-transparent")}>
                  <TableHead className="whitespace-nowrap">Device</TableHead>
                  <TableHead className="whitespace-nowrap">User name</TableHead>
                  <TableHead className="whitespace-nowrap">Last active</TableHead>
                  <TableHead className="whitespace-nowrap">Recorded at</TableHead>
                  <TableHead className="w-12 shrink-0 text-center">Device type</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deviceHistory.map((row) => {
                  const isAdmin = row.userId === ownerId;
                  const displayName = isAdmin ? "Admin" : (userNames[row.userId] ?? "—");
                  const histShort = shortDeviceLabelForList(row.deviceLabel, row.deviceType);
                  const histTitle = deviceLabelTooltipIfTruncated(row.deviceLabel, histShort);
                  return (
                    <TableRow key={row.id} className={DEVICE_RULE_H_BLACK}>
                      <TableCell className={SYNC_TD_DEVICE} title={row.deviceId}>
                        <span title={histTitle}>{histShort}</span>
                      </TableCell>
                      <TableCell className={SYNC_TD_USER}>{displayName}</TableCell>
                      <TableCell
                        className={SYNC_TD_DATETIME}
                        title={row.lastActive ? row.lastActive.toLocaleString() : undefined}
                      >
                        {row.lastActive ? row.lastActive.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell
                        className={SYNC_TD_DATETIME}
                        title={row.createdAt ? row.createdAt.toLocaleString() : undefined}
                      >
                        {row.createdAt ? row.createdAt.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="w-12 shrink-0 text-center text-muted-foreground">
                        {row.deviceType === "mobile" ? <Smartphone className="h-4 w-4 inline" /> : row.deviceType === "desktop" ? <Monitor className="h-4 w-4 inline" /> : "—"}
                      </TableCell>
                      <TableCell className="min-w-0 whitespace-normal text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteHistoryEntry(row.id)}
                          disabled={deletingHistoryId === row.id}
                        >
                          {deletingHistoryId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          <span className="ml-1">Delete</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Kick in-flight par dialog accidental close band — UX clear */}
      <AlertDialog open={!!confirmKick} onOpenChange={(open) => { if (!open && !kickInFlight) setConfirmKick(null); }}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove this device?</AlertDialogTitle>
          <AlertDialogDescription>
            This will sign out the device from this company. The user can sign in again from that device if the plan allows. Device: ...{confirmKick?.device.id.slice(-8)}.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={kickInFlight}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={kickInFlight}
              onClick={(e) => {
                e.preventDefault();
                if (confirmKick) confirmAndKickDevices(confirmKick.firestoreCompanyId, [confirmKick.device]);
              }}
            >
              Kick out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Multi tick ke baad ek hi Firestore batch — bulk confirm */}
      <AlertDialog
        open={confirmBulkKick}
        onOpenChange={(open) => {
          if (!open && !kickInFlight) setConfirmBulkKick(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kick selected devices?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes {selectedKickIds.size} device slot(s). Those sessions lose this company until they connect again within plan limits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={kickInFlight}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={kickInFlight || selectedKickIds.size === 0}
              onClick={(e) => {
                e.preventDefault();
                const ids = [...selectedKickIds];
                const rows = visibleSortedDevices.filter((d) => ids.includes(d.id));
                if (rows.length && selectedFirestoreCompanyId) confirmAndKickDevices(selectedFirestoreCompanyId, rows);
              }}
            >
              Kick {selectedKickIds.size} device(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Overview cards: bulk kick only rows ticked in that company’s table (composite keys). */}
      <AlertDialog
        open={!!confirmOverviewBulk}
        onOpenChange={(open) => {
          if (!open && !kickInFlight) setConfirmOverviewBulk(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kick selected devices?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmOverviewBulk ? (
                <>
                  Company: <span className="font-medium">{confirmOverviewBulk.name}</span>. Removes{" "}
                  {
                    [...overviewSelectedKickKeys].filter((k) => {
                      const p = parseOptimisticDeviceKey(k);
                      return p?.firestoreCompanyId === confirmOverviewBulk.firestoreCompanyId;
                    }).length
                  }{" "}
                  device slot(s). Those sessions lose this company until they connect again within plan limits.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={kickInFlight}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={
                kickInFlight ||
                !confirmOverviewBulk ||
                [...overviewSelectedKickKeys].filter((k) => {
                  const p = parseOptimisticDeviceKey(k);
                  return p?.firestoreCompanyId === confirmOverviewBulk.firestoreCompanyId;
                }).length === 0
              }
              onClick={(e) => {
                e.preventDefault();
                const target = confirmOverviewBulk;
                if (!target) return;
                const ovRow = companyDevicesOverview.find((r) => r.firestoreCompanyId === target.firestoreCompanyId);
                if (!ovRow || ovRow.isLocal) return;
                const visible = ovRow.devices.filter(
                  (d) => !optimisticRemovedIds.has(optimisticDeviceKey(target.firestoreCompanyId, d.id))
                );
                const rows = visible.filter(
                  (d) =>
                    d.id !== currentDeviceId &&
                    overviewSelectedKickKeys.has(optimisticDeviceKey(target.firestoreCompanyId, d.id))
                );
                if (rows.length) confirmAndKickDevices(target.firestoreCompanyId, rows);
                else setConfirmOverviewBulk(null);
              }}
            >
              Kick selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pehle sirf `setConfirmDeleteAllHistory(true)` tha — koi AlertDialog nahi tha, isliye "Delete all history" dead tha */}
      <AlertDialog
        open={confirmDeleteAllHistory}
        onOpenChange={(open) => {
          if (!deletingAllHistory) setConfirmDeleteAllHistory(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all device history?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every history row for this company. Active synced devices are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAllHistory}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingAllHistory}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteAllHistory();
              }}
            >
              {deletingAllHistory ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span className={deletingAllHistory ? "ml-2" : ""}>Delete all</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
