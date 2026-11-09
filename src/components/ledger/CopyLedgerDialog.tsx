"use client";
import { addDoc, updateDoc } from "@/lib/writeGateway/pbWrites";
import { STAFF_ENTITY_LABEL, STAFF_ENTITY_TYPE_KEY, STAFF_ENTITY_SEARCH_PLACEHOLDER, STAFF_ENTITY_ADD_BUTTON, staffEntityDisplayLabel } from "@/lib/staffEntityDisplayName";

import * as React from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/hooks/useCompany";
import { filterCompaniesForActiveGate } from "@/lib/gates/gateRuntime";
import { getActiveGate } from "@/lib/gates/gateStore";
import { PL_GATE_CHANGED_EVENT } from "@/lib/gates/gateTypes";
import {
  filterCompaniesForPlServerAccess,
  PL_SERVER_ACCESS_CONTEXT_EVENT,
} from "@/lib/plServerAccessContext";
import { useVouchers } from "@/hooks/useVouchers";
import { useToast } from "@/hooks/use-toast";
import { voucherTouchesPartyLedger } from "@/lib/voucherTouchesPartyLedger";
import {
  executeCopyLedgerCrossCompany,
  buildCopyLedgerComparison,
  copyCompareBucketToLedgerContext,
  collectVoucherReferenceIds,
  collectOppositeReferenceIdsForCompare,
  pairCompareLedgerRows,
  sortComparePairsChronologically,
  type CompareLedgerPair,
  type CopyLedgerComparisonRow,
  type CopyLedgerMode,
} from "@/lib/copyLedgerCrossCompany";
import { useAuth } from "@/hooks/useAuth";
import { useDate } from "@/hooks/useDate";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { getDisplayType } from "@/components/vouchers/transactionTableShared";
import { Combobox } from "@/components/ui/combobox";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { isPartyMasterDetailPath, PARTY_PAGE_OVERDUE_SELECTED_ID } from "@/lib/partyUrlContext";
import { collection, doc } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { auth, firestore } from "@/lib/plClientSession";
import { isLocalOnlyMode } from "@/lib/localMode";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { flushVoucherOutbox } from "@/lib/localVoucherOutbox";
import { ArrowLeft, ArrowRight, Pencil, RefreshCw, RotateCw } from "lucide-react";

/** Copy merge + async `getDocs` race: naya voucher `setState` ke baad purani fetch overwrite na kare — id map merge, incoming same id par authoritative. */
function mergeVoucherRowsById(
  prev: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const m = new Map(prev.map((v) => [String(v.id), v]));
  incoming.forEach((v) => m.set(String(v.id), v));
  return Array.from(m.values());
}

type CopyLedgerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type PartyOption = {
  id: string;
  name: string;
  kind?: "party" | "bank" | "staff" | "tax" | "item" | "expense";
  collection?: string;
};

const LEDGER_COLLECTIONS: Array<{ collection: string; kind: PartyOption["kind"] }> = [
  { collection: "parties", kind: "party" },
  { collection: "bank_accounts", kind: "bank" },
  { collection: "staff", kind: "staff" },
  { collection: "taxes", kind: "tax" },
  { collection: "items", kind: "item" },
  { collection: "expense_accounts", kind: "expense" },
];

async function loadLedgerOptionsForCompany(companyId: string): Promise<PartyOption[]> {
  // Compare mapping ke liye all ledger-like entities load karo; sirf parties se unknown/missing zyada aa raha tha.
  const all = await Promise.all(
    LEDGER_COLLECTIONS.map(async ({ collection: col, kind }) => {
      const snap = await getDocs(collection(firestore, `companies/${companyId}/${col}`));
      return snap.docs
        .map((d) => {
          const data = d.data() as {
            name?: string;
            accountName?: string;
            itemName?: string;
            isDeleted?: boolean;
          };
          if (data.isDeleted === true) return null;
          // Different ledgers use different display fields (`accountName`, `itemName`, etc.).
          const displayName = (data.name || data.accountName || data.itemName || d.id).trim() || d.id;
          return { id: d.id, name: displayName, kind, collection: col };
        })
        .filter((x) => x != null) as PartyOption[];
    })
  );
  const byId = new Map<string, PartyOption>();
  all.flat().forEach((r) => {
    if (!byId.has(r.id)) byId.set(r.id, r);
  });
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Copy click par IDs freeze — compare/copy actions stale state na pakde. */
type CopyLedgerFrozenPayload = {
  sourceCompanyId: string;
  targetCompanyId: string;
  sourcePartyId: string;
  targetPartyId: string;
  liveCount: number;
  vouchers: Array<Record<string, unknown>>;
  accountNote: string;
  noteColorHex: string;
  selectedVoucherIds: string[];
  idMap: Record<string, string>;
};

/** App sidebar jaisa: Items + expense (income/expense) ek hi "Income & Expense" bucket. `all` = reports jaisa poora ledger list. */
type CompareEntityBucket = "all" | "party" | "bank" | "staff" | "tax" | "income_expense";

const COMPARE_ENTITY_SELECT_ITEMS: { value: CompareEntityBucket; label: string }[] = [
  { value: "all", label: "All accounts" },
  { value: "party", label: "Parties" },
  { value: "bank", label: "Bank/Cash" },
  { value: "staff", label: STAFF_ENTITY_LABEL },
  { value: "tax", label: "Tax" },
  { value: "income_expense", label: "Income & Expense" },
];

/** Compare table Type column — party ledger jaisa label (e.g. Add Salary, not raw `journal`). */
function compareRowTypeLabel(row: CopyLedgerComparisonRow): string {
  return getDisplayType({ type: row.type, subType: row.subType });
}

const COMPARE_SYNC_TICK_COL_W = "w-11 min-w-[2.75rem] max-w-[2.75rem] px-2";
/** Center V-line se dono tick columns ka gap same — Side A end-align, Side B start-align. */
const COMPARE_SYNC_CHECKBOX_CN =
  "h-[18px] w-[18px] border-2 border-primary bg-background shadow-sm ring-1 ring-primary/30 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground disabled:opacity-85 disabled:border-primary/75";

/** Dono sides par voucher aligned (signature / cross-copy ref) — sync select band. */
function isComparePairRowSyncMatched(pair: CompareLedgerPair): boolean {
  return Boolean(pair.left?.id && pair.right?.id);
}

function CompareSyncTickStack({
  side,
  children,
  showArrow = true,
}: {
  side: "left" | "right";
  children: React.ReactNode;
  showArrow?: boolean;
}) {
  const towardCenter = side === "left";
  return (
    <div
      className={`flex w-full flex-col gap-0.5 ${towardCenter ? "items-end" : "items-start"}`}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
      {showArrow ? (
        towardCenter ? (
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
        ) : (
          <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
        )
      ) : null}
    </div>
  );
}

function partyOptionMatchesCompareBucket(opt: PartyOption, bucket: CompareEntityBucket): boolean {
  if (bucket === "all") return true;
  const k = opt.kind || "party";
  if (bucket === "income_expense") return k === "item" || k === "expense";
  return k === bucket;
}

/** Compare table: har side par 9 cells (BS + AD date alag, …, tick). */
const COMPARE_SIDE_COL_COUNT = 9;

/**
 * Ek hi compare `<tr>` me kabhi 18 cells, kabhi 10 (ek half `colSpan={9}`) — double-click half detect.
 */
function getCompareHalfFromCell(tr: HTMLTableRowElement, cellIndex: number): "left" | "right" {
  const half = COMPARE_SIDE_COL_COUNT;
  const cells = tr.cells;
  const n = cells.length;
  if (n === half * 2) return cellIndex < half ? "left" : "right";
  if (n === half + 1) {
    const c0 = cells[0] as HTMLTableCellElement;
    const cHalf = cells[half] as HTMLTableCellElement;
    if (c0.colSpan === half) return cellIndex === 0 ? "left" : "right";
    if (cHalf.colSpan === half) return cellIndex < half ? "left" : "right";
    return cellIndex < half ? "left" : "right";
  }
  if (n === 4) return cellIndex <= 1 ? "left" : "right";
  if (n === 3) {
    const c0 = cells[0] as HTMLTableCellElement;
    const c2 = cells[2] as HTMLTableCellElement;
    if (c0.colSpan === half) return cellIndex === 0 ? "left" : "right";
    if (c2.colSpan === half) return cellIndex === 2 ? "right" : "left";
    return cellIndex <= 1 ? "left" : "right";
  }
  if (n === 2) {
    const c0 = cells[0] as HTMLTableCellElement;
    const c1 = cells[1] as HTMLTableCellElement;
    if (c0.colSpan === half && c1.colSpan === half) return cellIndex === 0 ? "left" : "right";
  }
  return cellIndex < half ? "left" : "right";
}

/**
 * Source party screen se (`/party?selected=`) + company context.
 * Target: alag company + wahan ka party (entity) map; optional account note.
 */
export function CopyLedgerDialog({ open, onOpenChange }: CopyLedgerDialogProps) {
  const { company, companyId, allCompanies, allCompaniesRegistry } = useCompany();
  /** Gate / server token change par company dropdown dubara filter — `useCompany` fallback list mat use karo. */
  const [syncLedgerGateEpoch, setSyncLedgerGateEpoch] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setSyncLedgerGateEpoch((n) => n + 1);
    window.addEventListener(PL_GATE_CHANGED_EVENT, bump);
    window.addEventListener(PL_SERVER_ACCESS_CONTEXT_EVENT, bump);
    return () => {
      window.removeEventListener(PL_GATE_CHANGED_EVENT, bump);
      window.removeEventListener(PL_SERVER_ACCESS_CONTEXT_EVENT, bump);
    };
  }, []);

  const syncLedgerCompanies = React.useMemo(() => {
    void syncLedgerGateEpoch;
    const source =
      (allCompaniesRegistry?.length ? allCompaniesRegistry : allCompanies)?.filter(
        (c) => c.isDeleted !== true && c.movedToAdminRecycleAt == null
      ) ?? [];
    const gate = getActiveGate();
    const byGate = filterCompaniesForActiveGate(source, gate);
    return filterCompaniesForPlServerAccess(byGate);
  }, [allCompaniesRegistry, allCompanies, syncLedgerGateEpoch]);
  const { processedParties, vouchers: vouchersForDisplay } = useVouchers();
  const { user, customUser } = useAuth();
  const { formatDate, formatDateBS } = useDate();
  const { toast } = useToast();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeParams = useParams() as { id?: string };

  const partyIdFromRoute = React.useMemo(() => {
    if (pathname?.includes("/party/group/")) return null;
    if (routeParams?.id && String(routeParams.id) !== "group") return String(routeParams.id);
    const seg = pathname?.replace(/\/+$/, "") || "";
    const m = seg.match(/\/party\/([^/]+)/);
    if (m?.[1] && m[1] !== "group") return m[1];
    if (isPartyMasterDetailPath(pathname)) {
      const view = searchParams.get("view");
      if (view === "groups") return null;
      const sel = searchParams.get("selected")?.trim();
      if (!sel || sel === PARTY_PAGE_OVERDUE_SELECTED_ID) return null;
      return sel;
    }
    return null;
  }, [pathname, routeParams?.id, searchParams]);

  /** Dialog mein source party — route se seedha ya dropdown se; preview/copy isi id par */
  const [sourcePartyId, setSourcePartyId] = React.useState<string>("");

  React.useEffect(() => {
    if (!open) return;
    setSourcePartyId(partyIdFromRoute ?? "");
  }, [open, partyIdFromRoute]);

  const [targetCompanyId, setTargetCompanyId] = React.useState<string>("");
  /** Side B ke accounts — **`compareRightCompanyId` se** load (vouchers jaisi hi company); `targetCompanyId` ek tick late ho sakta tha → same naam par galat id + 0 rows. */
  const [compareRightLedgerOptions, setCompareRightLedgerOptions] = React.useState<PartyOption[]>([]);
  const [targetCompanyVouchers, setTargetCompanyVouchers] = React.useState<Array<Record<string, unknown>>>([]);
  /** Compare header: left/right company — same list me se, dono alag; ek side select = doosri side same id disabled. */
  const [compareLeftCompanyId, setCompareLeftCompanyId] = React.useState("");
  const [compareRightCompanyId, setCompareRightCompanyId] = React.useState("");
  /** Side B = Side A company (tick on right header); Side A ledger combobox band — account sirf B par. */
  const [compareUseSameCompanyOnSideB, setCompareUseSameCompanyOnSideB] = React.useState(false);
  /** Side A = Side B company (tick on left header); Side B ledger combobox band. */
  const [compareUseSameCompanyOnSideA, setCompareUseSameCompanyOnSideA] = React.useState(false);
  /** Dono header me ek hi bucket — ek side change = dono sync (ledger list isi se filter). Default `all` = sale/purchase/items sab dikhen. */
  const [compareEntityBucket, setCompareEntityBucket] = React.useState<CompareEntityBucket>("all");
  /** Side A vouchers — hamesha `compareLeftCompanyId` se Firestore+local merge (app header `useVouchers` se alag). */
  const [compareRemoteVouchers, setCompareRemoteVouchers] = React.useState<Array<Record<string, unknown>>>([]);
  /** Refresh button pe `getDocs` chal raha hai — dialog andar hi, layout shake nahi. */
  const [compareRefreshing, setCompareRefreshing] = React.useState(false);
  const [compareLeftLedgerOptions, setCompareLeftLedgerOptions] = React.useState<PartyOption[]>([]);
  /** Same company (context) me Combobox me naya party — remote list me merge; compareLeftLedgerOptions remote ke saath. */
  const [compareLeftExtraLedgers, setCompareLeftExtraLedgers] = React.useState<PartyOption[]>([]);
  /** Rename save ke baad options label turant update (Firestore + local lists lag ho to bhi). */
  const [compareLedgerNameOverrides, setCompareLedgerNameOverrides] = React.useState<Record<string, string>>({});
  /** Compare subheader pencil: party rename (same EditParty flow nahi, lightweight dialog). */
  const [compareLedgerEditSide, setCompareLedgerEditSide] = React.useState<null | "left" | "right">(null);
  const [compareLedgerEditName, setCompareLedgerEditName] = React.useState("");
  const [targetPartyId, setTargetPartyId] = React.useState<string>("");
  /** Copy marker narration: compare ke bina bhi default — `executeCopyLedgerCrossCompany` isi text/color se. */
  const [targetAccountNote] = React.useState<string>("Copied");
  const [targetAccountNoteColor] = React.useState<string>("#f97316");
  const [copyingProgress, setCopyingProgress] = React.useState<{
    done: number;
    total: number;
    currentLabel?: string;
  } | null>(null);
  const [selectedVoucherIds, setSelectedVoucherIds] = React.useState<string[]>([]);
  /** Side B par alag selection — B→A copy sirf in ids se; left wale `selectedVoucherIds` se mix nahi. */
  const [selectedRightVoucherIds, setSelectedRightVoucherIds] = React.useState<string[]>([]);
  const [manualIdMap, setManualIdMap] = React.useState<Record<string, string>>({});
  /** Missing refs dialog: `source` = Side A voucher (copy→B map); `target` = sirf Side B row (B-local orphan refs). */
  const [mappingPopup, setMappingPopup] = React.useState<
    { kind: "source"; voucherId: string } | { kind: "target"; voucherId: string } | null
  >(null);
  const copyLedgerFrozenRef = React.useRef<CopyLedgerFrozenPayload | null>(null);
  const [isVoucherEditOpen, setIsVoucherEditOpen] = React.useState(false);
  const [voucherForEdit, setVoucherForEdit] = React.useState<any | null>(null);
  /** Edit dialog ko batane ke liye voucher kis company ka hai (Side A / Side B) — `AddVoucherDialog` account lists + save path. */
  const [voucherEditCompanyId, setVoucherEditCompanyId] = React.useState<string | null>(null);

  /** `companyId` context kabhi null ho `company.id` ke saath — cross-company list + copy dono isi se */
  const effectiveSourceCompanyId = React.useMemo(
    () => String(company?.id ?? companyId ?? "").trim(),
    [company?.id, companyId]
  );

  const otherCompanies = React.useMemo(
    () => syncLedgerCompanies.filter((c) => c.id && c.id !== effectiveSourceCompanyId),
    [syncLedgerCompanies, effectiveSourceCompanyId]
  );

  /** Compare dropdowns: active gate + server token ke allowed companies; alphabetical. */
  const allCompaniesSorted = React.useMemo(
    () =>
      syncLedgerCompanies
        .filter((c): c is typeof c & { id: string } => Boolean(String(c.id || "").trim()))
        .map((c) => ({ ...c, id: String(c.id) }))
        .sort((a, b) =>
          String(a.name || a.id).localeCompare(String(b.name || b.id), undefined, { sensitivity: "base" })
        ),
    [syncLedgerCompanies]
  );
  const companyDisplayNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    allCompaniesSorted.forEach((c) => m.set(c.id, String(c.name || c.id)));
    return m;
  }, [allCompaniesSorted]);

  const targetCompanyName = React.useMemo(
    () => otherCompanies.find((c) => c.id === targetCompanyId)?.name ?? "",
    [otherCompanies, targetCompanyId]
  );

  const targetPartyName = React.useMemo(
    () => compareRightLedgerOptions.find((p) => p.id === targetPartyId)?.name ?? "",
    [compareRightLedgerOptions, targetPartyId]
  );
  const compareTargetPartyId = React.useMemo(
    () => (open ? copyLedgerFrozenRef.current?.targetPartyId || targetPartyId : targetPartyId),
    [open, targetPartyId]
  );
  const sourcePartyName = React.useMemo(
    () => (processedParties || []).find((p) => String(p.id) === String(sourcePartyId))?.name || "",
    [processedParties, sourcePartyId]
  );

  /** Source party names — compare screen me missing id rows ko human readable label dene ke liye. */
  const sourcePartyNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    (processedParties || []).forEach((p) => map.set(String(p.id), String(p.name || p.id)));
    compareLeftLedgerOptions.forEach((p) => {
      if (!map.has(String(p.id))) map.set(String(p.id), String(p.name || p.id));
    });
    compareLeftExtraLedgers.forEach((p) => {
      if (!map.has(String(p.id))) map.set(String(p.id), String(p.name || p.id));
    });
    compareRightLedgerOptions.forEach((p) => {
      if (!map.has(String(p.id))) map.set(String(p.id), String(p.name || p.id));
    });
    return map;
  }, [processedParties, compareLeftLedgerOptions, compareLeftExtraLedgers, compareRightLedgerOptions]);
  const sourceNameOnly = React.useCallback(
    (srcId: string) => {
      // Compare subheader rename — turant label update (Firestore list refresh se pehle).
      if (compareLedgerNameOverrides[srcId]) return compareLedgerNameOverrides[srcId];
      const raw = (sourcePartyNameById.get(srcId) || "").trim();
      // UID-like fallback text hide: only human-readable account names show in compare mapping.
      if (!raw || raw === srcId) return "Unmapped source ledger";
      return raw;
    },
    [sourcePartyNameById, compareLedgerNameOverrides]
  );
  const sourceLedgerMetaById = React.useMemo(() => {
    const map = new Map<string, PartyOption>();
    compareLeftLedgerOptions.forEach((o) => map.set(String(o.id), o));
    compareLeftExtraLedgers.forEach((o) => {
      if (!map.has(String(o.id))) map.set(String(o.id), o);
    });
    compareRightLedgerOptions.forEach((o) => {
      if (!map.has(String(o.id))) map.set(String(o.id), o);
    });
    return map;
  }, [compareLeftLedgerOptions, compareLeftExtraLedgers, compareRightLedgerOptions]);

  /** Add-matching popup: orphan id kabhi target list me ho (same company) — kind infer ke liye dono merge. */
  const sourceOrTargetLedgerMetaById = React.useMemo(() => {
    const map = new Map<string, PartyOption>();
    sourceLedgerMetaById.forEach((v, k) => map.set(k, v));
    compareRightLedgerOptions.forEach((o) => {
      if (!map.has(o.id)) map.set(o.id, o);
    });
    return map;
  }, [sourceLedgerMetaById, compareRightLedgerOptions]);

  const targetKnownPartyIds = React.useMemo(
    // Missing-check me all target ledgers include karo (parties + bank/staff/tax/items/expense).
    () => new Set(compareRightLedgerOptions.map((p) => p.id)),
    [compareRightLedgerOptions]
  );
  /** Target side readable names — mapping preview me right column ledger name dikhane ke liye. */
  const targetPartyNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    compareRightLedgerOptions.forEach((p) => map.set(String(p.id), String(p.name || p.id)));
    return map;
  }, [compareRightLedgerOptions]);
  const compareTargetPartyName = React.useMemo(() => {
    if (compareTargetPartyId && compareLedgerNameOverrides[compareTargetPartyId]) {
      return compareLedgerNameOverrides[compareTargetPartyId];
    }
    if (targetPartyName) return targetPartyName;
    if (compareTargetPartyId && targetPartyNameById.get(compareTargetPartyId)) {
      return targetPartyNameById.get(compareTargetPartyId) || "";
    }
    return "—";
  }, [targetPartyName, compareTargetPartyId, targetPartyNameById, compareLedgerNameOverrides]);
  const targetPartyIdByName = React.useMemo(() => {
    const map = new Map<string, string>();
    compareRightLedgerOptions.forEach((p) => {
      const k = String(p.name || "").trim().toLowerCase();
      if (k && !map.has(k)) map.set(k, p.id);
    });
    return map;
  }, [compareRightLedgerOptions]);

  /** Compare: left = hamesha `compareLeftCompanyId` ke liye load — app header company se alag ho sakta hai. */
  const compareLeftLedgerOptionsFull = React.useMemo((): PartyOption[] => {
    if (!open || !compareLeftCompanyId) return [];
    const m = new Map<string, PartyOption>();
    compareLeftLedgerOptions.forEach((o) => m.set(o.id, o));
    compareLeftExtraLedgers.forEach((o) => {
      if (!m.has(o.id)) m.set(o.id, o);
    });
    return Array.from(m.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [open, compareLeftCompanyId, compareLeftLedgerOptions, compareLeftExtraLedgers]);

  /** Selected `compareEntityBucket` ke hisaab se hi — Ledger combobox yahi list dikhata hai. */
  const compareLeftEntityOptions = React.useMemo((): PartyOption[] => {
    return compareLeftLedgerOptionsFull.filter((o) => partyOptionMatchesCompareBucket(o, compareEntityBucket));
  }, [compareLeftLedgerOptionsFull, compareEntityBucket]);

  /** Right company full list phir bucket filter. */
  const compareRightLedgerOptionsFull = React.useMemo((): PartyOption[] => {
    if (!open || !String(compareRightCompanyId || "").trim()) return [];
    return compareRightLedgerOptions
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [open, compareRightCompanyId, compareRightLedgerOptions]);

  /** B→A: opposite-ref map ke baad id Side A ledger list me honi chahiye — `compareLeftLedgerOptionsFull` ke baad define. */
  const leftKnownPartyIds = React.useMemo(
    () => new Set(compareLeftLedgerOptionsFull.map((p) => p.id)),
    [compareLeftLedgerOptionsFull]
  );

  const compareRightEntityOptions = React.useMemo((): PartyOption[] => {
    return compareRightLedgerOptionsFull.filter((o) => partyOptionMatchesCompareBucket(o, compareEntityBucket));
  }, [compareRightLedgerOptionsFull, compareEntityBucket]);

  /** Side A ledger: sirf source id — Side B alag choose (entity *type* dono par `compareEntityBucket` se match). */
  const onCompareEntitySelectLeft = React.useCallback((leftId: string) => {
    setSourcePartyId(leftId);
  }, []);

  /** Side B ledger: sirf target id — Side A auto-change nahi. */
  const onCompareEntitySelectRight = React.useCallback((rightId: string) => {
    setTargetPartyId(rightId);
  }, []);

  React.useEffect(() => {
    setCompareLeftExtraLedgers([]);
  }, [compareLeftCompanyId]);

  const compareLeftComboboxOptions = React.useMemo(
    () =>
      compareLeftEntityOptions.map((o) => {
        const display = compareLedgerNameOverrides[o.id] || o.name;
        return {
          value: o.id,
          label: o.kind ? `${display} (${o.kind})` : display,
          triggerLabel: display,
        };
      }),
    [compareLeftEntityOptions, compareLedgerNameOverrides]
  );

  const compareRightComboboxOptions = React.useMemo(
    () =>
      compareRightEntityOptions.map((o) => {
        const display = compareLedgerNameOverrides[o.id] || o.name;
        return {
          value: o.id,
          label: o.kind ? `${display} (${o.kind})` : display,
          triggerLabel: display,
        };
      }),
    [compareRightEntityOptions, compareLedgerNameOverrides]
  );

  const compareLeftComboboxValue = React.useMemo(
    () =>
      sourcePartyId && compareLeftEntityOptions.some((o) => o.id === sourcePartyId) ? sourcePartyId : "",
    [sourcePartyId, compareLeftEntityOptions]
  );
  const compareRightComboboxValue = React.useMemo(
    () =>
      targetPartyId && compareRightEntityOptions.some((o) => o.id === targetPartyId) ? targetPartyId : "",
    [targetPartyId, compareRightEntityOptions]
  );

  /** Side par valid ledger select hai tab hi 9-column grid; warna placeholder half ko center me `colSpan={9}`. */
  const compareSideAHasLedger = React.useMemo(
    () =>
      Boolean(String(sourcePartyId || "").trim()) &&
      compareLeftEntityOptions.some((o) => o.id === sourcePartyId),
    [sourcePartyId, compareLeftEntityOptions]
  );
  const compareSideBHasLedger = React.useMemo(
    () =>
      Boolean(String(targetPartyId || "").trim()) &&
      compareRightEntityOptions.some((o) => o.id === targetPartyId),
    [targetPartyId, compareRightEntityOptions]
  );

  const addCompareLedgerParty = React.useCallback(
    async (side: "left" | "right", name: string) => {
      const cid = side === "left" ? compareLeftCompanyId : compareRightCompanyId;
      const n = name.trim();
      if (!cid || !n) return;
      try {
        const ref = await addDoc(collection(firestore, `companies/${cid}/parties`), {
          name: n,
          isDeleted: false,
          createdAt: new Date(),
        });
        const row: PartyOption = { id: ref.id, name: n, kind: "party", collection: "parties" };
        if (side === "left") {
          // Side A dropdown ka company — header se alag ho sakta hai; naya party `extra` me merge (full list memo me)
          setCompareLeftExtraLedgers((prev) => [...prev, row]);
          setSourcePartyId(ref.id);
        } else {
          setCompareRightLedgerOptions((prev) =>
            [...prev, row].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
          );
          setTargetPartyId(ref.id);
        }
        toast({ title: "Account added", description: `"${n}" created and selected.` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast({ variant: "destructive", title: "Cannot add account", description: msg });
      }
    },
    [compareLeftCompanyId, compareRightCompanyId, toast]
  );

  const openCompareLedgerEdit = React.useCallback(
    (side: "left" | "right") => {
      const id = side === "left" ? sourcePartyId : targetPartyId;
      const opts = side === "left" ? compareLeftEntityOptions : compareRightEntityOptions;
      const meta = opts.find((o) => o.id === id);
      if (!id || !meta) {
        toast({ variant: "destructive", title: "Select a ledger", description: "Choose an account in the list first." });
        return;
      }
      if (meta.kind && meta.kind !== "party") {
        toast({
          title: "Edit from master screen",
          description: "Rename Bank / Staff / Item / Tax accounts from their own pages.",
        });
        return;
      }
      setCompareLedgerEditSide(side);
      setCompareLedgerEditName(compareLedgerNameOverrides[id] || meta.name);
    },
    [sourcePartyId, targetPartyId, compareLeftEntityOptions, compareRightEntityOptions, compareLedgerNameOverrides, toast]
  );

  const saveCompareLedgerEdit = React.useCallback(async () => {
    if (!compareLedgerEditSide) return;
    const id = compareLedgerEditSide === "left" ? sourcePartyId : targetPartyId;
    const cid = compareLedgerEditSide === "left" ? compareLeftCompanyId : compareRightCompanyId;
    const name = compareLedgerEditName.trim();
    if (!id || !cid || !name) return;
    try {
      await updateDoc(doc(firestore, `companies/${cid}/parties/${id}`), { name });
      setCompareLedgerNameOverrides((prev) => ({ ...prev, [id]: name }));
      setCompareLeftExtraLedgers((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
      setCompareLeftLedgerOptions((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
      setCompareRightLedgerOptions((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
      toast({ title: "Account updated", description: `Saved as "${name}".` });
      setCompareLedgerEditSide(null);
      setCompareLedgerEditName("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: "Cannot save", description: msg });
    }
  }, [
    compareLedgerEditSide,
    compareLedgerEditName,
    sourcePartyId,
    targetPartyId,
    compareLeftCompanyId,
    compareRightCompanyId,
    toast,
  ]);

  // Compare band hone par rename dialog band — nested state leak na ho.
  React.useEffect(() => {
    if (!open) {
      setCompareLedgerEditSide(null);
      setCompareLedgerEditName("");
      setCompareEntityBucket("all");
    }
  }, [open]);

  const compareLeftCompanyIdPrevRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      compareLeftCompanyIdPrevRef.current = null;
      return;
    }
    compareLeftCompanyIdPrevRef.current = String(compareLeftCompanyId || "").trim() || null;
  }, [open, compareLeftCompanyId]);

  // Party bucket nahi aur "All accounts" bhi nahi — party-only extra rows hata do (bank switch par clutter avoid).
  React.useEffect(() => {
    if (compareEntityBucket !== "party" && compareEntityBucket !== "all") setCompareLeftExtraLedgers([]);
  }, [compareEntityBucket]);

  // Bucket/company ke hisaab se chuna id filtered list me nahi → clear (lists load hone tak skip — flash clear avoid).
  React.useEffect(() => {
    if (!open) return;
    if (!sourcePartyId && !targetPartyId) return;
    if (compareLeftCompanyId && compareLeftLedgerOptionsFull.length === 0) return;
    if (compareRightCompanyId && compareRightLedgerOptionsFull.length === 0) return;
    const leftOk = sourcePartyId ? compareLeftEntityOptions.some((o) => o.id === sourcePartyId) : true;
    const rightOk = targetPartyId ? compareRightEntityOptions.some((o) => o.id === targetPartyId) : true;
    if (leftOk && rightOk) return;
    setSourcePartyId("");
    setTargetPartyId("");
  }, [
    open,
    compareEntityBucket,
    compareLeftCompanyId,
    compareRightCompanyId,
    compareLeftEntityOptions,
    compareRightEntityOptions,
    compareLeftLedgerOptionsFull.length,
    compareRightLedgerOptionsFull.length,
    sourcePartyId,
    targetPartyId,
  ]);

  /** Side A vouchers — sirf `compareLeftCompanyId` (dropdown); header `companyId`/`useVouchers` se bind nahi. */
  const vouchersForCompareSource = React.useMemo(() => {
    if (!open || !compareLeftCompanyId) return vouchersForDisplay || [];
    return (compareRemoteVouchers || []) as typeof vouchersForDisplay;
  }, [open, compareLeftCompanyId, compareRemoteVouchers, vouchersForDisplay]);

  /** Compare list ka base set: source party ledger se touch hone wale vouchers. */
  const touchedVouchers = React.useMemo(
    () =>
      vouchersForCompareSource
        .filter((v) => voucherTouchesPartyLedger(v, sourcePartyId))
        .map((v) => v as Record<string, unknown>),
    [vouchersForCompareSource, sourcePartyId]
  );

  const compareRows = React.useMemo(() => {
    const autoNameMap: Record<string, string> = {};
    // Auto map by same account name: source name exists and target me same-name ledger mile to mapping infer karo.
    sourcePartyNameById.forEach((srcName, srcId) => {
      const k = String(srcName || "").trim().toLowerCase();
      const tId = targetPartyIdByName.get(k);
      if (tId) autoNameMap[srcId] = tId;
    });
    const res = buildCopyLedgerComparison({
      vouchers: touchedVouchers,
      sourcePartyId,
      // Compare table me sab rows dikhao; copy selection checkbox alag state handle karta hai.
      selectedVoucherIds: undefined,
      idMap: { ...autoNameMap, [sourcePartyId]: targetPartyId, ...manualIdMap },
      targetKnownIds: targetKnownPartyIds,
      ledgerContext: copyCompareBucketToLedgerContext(compareEntityBucket),
    });
    return res.rows;
  }, [
    touchedVouchers,
    sourcePartyId,
    selectedVoucherIds,
    targetPartyId,
    manualIdMap,
    targetKnownPartyIds,
    sourcePartyNameById,
    targetPartyIdByName,
    compareEntityBucket,
  ]);

  /** Side B: target company ke vouchers jo sirf Side B ke selected ledger ko touch karte — Side A list se independent. */
  const touchedVouchersSideB = React.useMemo(
    () =>
      targetCompanyVouchers
        .filter((v) => voucherTouchesPartyLedger(v, targetPartyId))
        .map((v) => v as Record<string, unknown>),
    [targetCompanyVouchers, targetPartyId]
  );

  const compareRowsSideB = React.useMemo(() => {
    const autoNameMap: Record<string, string> = {};
    sourcePartyNameById.forEach((srcName, srcId) => {
      const k = String(srcName || "").trim().toLowerCase();
      const tId = targetPartyIdByName.get(k);
      if (tId) autoNameMap[srcId] = tId;
    });
    const res = buildCopyLedgerComparison({
      vouchers: touchedVouchersSideB,
      sourcePartyId: targetPartyId,
      selectedVoucherIds: undefined,
      idMap: { ...autoNameMap, [sourcePartyId]: targetPartyId, ...manualIdMap },
      targetKnownIds: targetKnownPartyIds,
      ledgerContext: copyCompareBucketToLedgerContext(compareEntityBucket),
    });
    return res.rows;
  }, [
    touchedVouchersSideB,
    targetPartyId,
    sourcePartyId,
    manualIdMap,
    targetKnownPartyIds,
    sourcePartyNameById,
    targetPartyIdByName,
    compareEntityBucket,
  ]);

  /** Pehle `crossCopySourceRef` (copy = same horizontal line), phir signature; phir dono dates mix sort. */
  const comparePairs = React.useMemo(
    () =>
      sortComparePairsChronologically(
        pairCompareLedgerRows(compareRows, compareRowsSideB, {
          leftCompanyId: String(compareLeftCompanyId || "").trim(),
          rightCompanyId: String(compareRightCompanyId || "").trim(),
        })
      ),
    [compareRows, compareRowsSideB, compareLeftCompanyId, compareRightCompanyId]
  );

  /** Sirf unmatched + us side par voucher — matched / khali line par tick band. */
  const selectableCompareLeftRowIds = React.useMemo(
    () =>
      comparePairs
        .filter((p) => p.left?.id && !isComparePairRowSyncMatched(p))
        .map((p) => String(p.left!.id)),
    [comparePairs]
  );
  const selectableCompareRightRowIds = React.useMemo(
    () =>
      comparePairs
        .filter((p) => p.right?.id && !isComparePairRowSyncMatched(p))
        .map((p) => String(p.right!.id)),
    [comparePairs]
  );

  /** Matched rows state me ho sakte hain — sync / unresolved sirf selectable ids (no setState loop). */
  const selectedVoucherIdsForSync = React.useMemo(() => {
    const allowed = new Set(selectableCompareLeftRowIds);
    return selectedVoucherIds.filter((id) => allowed.has(id));
  }, [selectedVoucherIds, selectableCompareLeftRowIds]);

  const selectedRightVoucherIdsForSync = React.useMemo(() => {
    const allowed = new Set(selectableCompareRightRowIds);
    return selectedRightVoucherIds.filter((id) => allowed.has(id));
  }, [selectedRightVoucherIds, selectableCompareRightRowIds]);

  /** Side A: missing refs → mapping popup (copy ke liye resolve). Ready = map complete. */
  const renderSideAStatus = React.useCallback(
    (r: CopyLedgerComparisonRow) => {
      const n = r.missingReferenceIds.length;
      if (n > 0) {
        return (
          <button
            type="button"
            className="text-amber-700 underline underline-offset-2"
            onClick={(e) => {
              e.stopPropagation();
              setMappingPopup({ kind: "source", voucherId: r.id });
            }}
          >
            Missing refs: {n}
          </button>
        );
      }
      return <span className="text-green-700">Ready</span>;
    },
    [setMappingPopup]
  );

  /**
   * Side B status: jab Side A row hai to A→B sync readiness (left.missing) dono columns par same;
   * sirf B row ho to B-local opposite refs (target popup).
   */
  const renderSideBStatus = React.useCallback((pair: CompareLedgerPair) => {
    const left = pair.left;
    const right = pair.right;
    const rowForSync = left ?? right;
    if (!rowForSync) return <span className="text-muted-foreground">—</span>;
    const n = left ? left.missingReferenceIds.length : (right?.missingReferenceIds.length ?? 0);
    if (n > 0) {
      return (
        <button
          type="button"
          className="text-amber-700 underline underline-offset-2"
          onClick={(e) => {
            e.stopPropagation();
            if (left) setMappingPopup({ kind: "source", voucherId: left.id });
            else if (right) setMappingPopup({ kind: "target", voucherId: right.id });
          }}
        >
          Missing refs: {n}
        </button>
      );
    }
    return <span className="text-green-700">OK</span>;
  }, [setMappingPopup]);

  const unresolvedReferenceIds = React.useMemo(() => {
    const out = new Set<string>();
    const selectedSet = new Set(selectedVoucherIdsForSync);
    const autoNameMap: Record<string, string> = {};
    sourcePartyNameById.forEach((srcName, srcId) => {
      const k = String(srcName || "").trim().toLowerCase();
      const tId = targetPartyIdByName.get(k);
      if (tId) autoNameMap[srcId] = tId;
    });
    const map = { ...autoNameMap, [sourcePartyId]: targetPartyId, ...manualIdMap };
    touchedVouchers.forEach((v) => {
      const id = String(v.id || "");
      if (selectedSet.size > 0 && !selectedSet.has(id)) return;
      const refs = collectOppositeReferenceIdsForCompare(v, sourcePartyId);
      refs.forEach((srcId) => {
        const mapped = map[srcId] || srcId;
        if (!targetKnownPartyIds.has(mapped)) out.add(srcId);
      });
    });
    return Array.from(out);
  }, [
    selectedVoucherIdsForSync,
    sourcePartyId,
    targetPartyId,
    manualIdMap,
    touchedVouchers,
    targetKnownPartyIds,
    sourcePartyNameById,
    targetPartyIdByName,
  ]);

  /** B→A: Side B voucher ke opposite refs → map ke baad Side A par valid account hona chahiye. */
  const unresolvedReferenceIdsBtoA = React.useMemo(() => {
    const out = new Set<string>();
    const selectedSet = new Set(selectedRightVoucherIdsForSync);
    const reverseManual: Record<string, string> = {};
    Object.entries(manualIdMap).forEach(([a, b]) => {
      if (b && typeof b === "string") reverseManual[b] = a;
    });
    const autoNameMapBtoA: Record<string, string> = {};
    compareRightLedgerOptionsFull.forEach((ro) => {
      const k = String(ro.name || "").trim().toLowerCase();
      const lo = compareLeftLedgerOptionsFull.find((l) => String(l.name || "").trim().toLowerCase() === k);
      if (lo) autoNameMapBtoA[ro.id] = lo.id;
    });
    const map = { ...autoNameMapBtoA, [targetPartyId]: sourcePartyId, ...reverseManual };
    touchedVouchersSideB.forEach((v) => {
      const id = String(v.id || "");
      if (selectedSet.size > 0 && !selectedSet.has(id)) return;
      collectOppositeReferenceIdsForCompare(v, targetPartyId).forEach((srcId) => {
        const mapped = map[srcId] || srcId;
        if (!leftKnownPartyIds.has(mapped)) out.add(srcId);
      });
    });
    return Array.from(out);
  }, [
    selectedRightVoucherIdsForSync,
    sourcePartyId,
    targetPartyId,
    manualIdMap,
    touchedVouchersSideB,
    leftKnownPartyIds,
    compareRightLedgerOptionsFull,
    compareLeftLedgerOptionsFull,
  ]);
  const mappingPopupRow = React.useMemo(() => {
    if (!mappingPopup) return null;
    if (mappingPopup.kind === "source") {
      return compareRows.find((r) => r.id === mappingPopup.voucherId) || null;
    }
    return compareRowsSideB.find((r) => r.id === mappingPopup.voucherId) || null;
  }, [mappingPopup, compareRows, compareRowsSideB]);
  const mappingPopupSourceIds = React.useMemo(
    () => (mappingPopupRow?.missingReferenceIds || []).slice(),
    [mappingPopupRow]
  );
  /** Mapping dialog: source = A ledger names; target = B orphan id ke liye target map + fallback short id. */
  const refLabelForMappingPopup = React.useCallback(
    (id: string) => {
      if (!mappingPopup || mappingPopup.kind === "source") return sourceNameOnly(id);
      if (compareLedgerNameOverrides[id]) return compareLedgerNameOverrides[id];
      const t = (targetPartyNameById.get(id) || "").trim();
      if (t && t !== id) return t;
      const s = (sourcePartyNameById.get(id) || "").trim();
      if (s && s !== id) return s;
      return id.length > 14 ? `${id.slice(0, 10)}…` : id;
    },
    [mappingPopup, sourceNameOnly, compareLedgerNameOverrides, targetPartyNameById, sourcePartyNameById]
  );
  /** Reference mapping dialog — English: target company + account (A→B = right co., B→A = left co.). */
  const mappingReferenceDialogDescription = React.useMemo(() => {
    if (!mappingPopup || !mappingPopupRow) return "";
    const vn = String(mappingPopupRow.voucherNumber || "—").trim() || "—";
    const targetCid =
      mappingPopup.kind === "source"
        ? String(compareRightCompanyId || "").trim()
        : String(compareLeftCompanyId || "").trim();
    const companyName =
      companyDisplayNameById.get(targetCid) || targetCid || "the selected company";
    const ids = mappingPopupSourceIds;
    if (ids.length === 0) {
      return `Voucher ${vn} has no unresolved account references — mapping is not required.`;
    }
    if (ids.length === 1) {
      const acc = refLabelForMappingPopup(ids[0]);
      return `In company "${companyName}", the account "${acc}" does not exist. To copy voucher ${vn}, you must add or edit a ledger to map this account.`;
    }
    return `In company "${companyName}", one or more accounts used by voucher ${vn} do not exist yet. Map each row below to a ledger to copy this voucher.`;
  }, [
    mappingPopup,
    mappingPopupRow,
    mappingPopupSourceIds,
    compareRightCompanyId,
    compareLeftCompanyId,
    companyDisplayNameById,
    refLabelForMappingPopup,
  ]);
  /** Paired compare rows: ek index dono tables par highlight (align ke baad parallel index). */
  const [activeComparePairIndex, setActiveComparePairIndex] = React.useState(0);
  /** Side A ki saari rows tick hon — tab button "Deselect all" dikhata hai. */
  const compareSideASelectAllActive = React.useMemo(() => {
    const ids = selectableCompareLeftRowIds;
    return ids.length > 0 && ids.every((id) => selectedVoucherIds.includes(id));
  }, [selectableCompareLeftRowIds, selectedVoucherIds]);
  const toggleSelectAllCompareVouchers = React.useCallback(() => {
    const ids = selectableCompareLeftRowIds;
    const idSet = new Set(ids);
    const allSelected = ids.length > 0 && ids.every((id) => selectedVoucherIds.includes(id));
    if (allSelected) {
      setSelectedVoucherIds((prev) => prev.filter((id) => !idSet.has(id)));
    } else {
      setSelectedVoucherIds(ids);
    }
  }, [selectableCompareLeftRowIds, selectedVoucherIds]);

  const compareSideBSelectAllActive = React.useMemo(() => {
    const ids = selectableCompareRightRowIds;
    return ids.length > 0 && ids.every((id) => selectedRightVoucherIds.includes(id));
  }, [selectableCompareRightRowIds, selectedRightVoucherIds]);
  const toggleSelectAllCompareVouchersSideB = React.useCallback(() => {
    const ids = selectableCompareRightRowIds;
    const idSet = new Set(ids);
    const allSelected = ids.length > 0 && ids.every((id) => selectedRightVoucherIds.includes(id));
    if (allSelected) {
      setSelectedRightVoucherIds((prev) => prev.filter((id) => !idSet.has(id)));
    } else {
      setSelectedRightVoucherIds(ids);
    }
  }, [selectableCompareRightRowIds, selectedRightVoucherIds]);
  const openVoucherEditForRow = React.useCallback(
    (pairIndex: number) => {
      const row = comparePairs[pairIndex]?.left;
      if (!row) return;
      const voucher = touchedVouchers.find((v) => String(v.id || "") === row.id) || null;
      if (!voucher) return;
      // Double click / Enter: open voucher in edit dialog.
      setVoucherEditCompanyId(String(compareLeftCompanyId || "").trim() || null);
      setVoucherForEdit(voucher);
      setIsVoucherEditOpen(true);
    },
    [comparePairs, touchedVouchers, compareLeftCompanyId]
  );
  /** Side B: paired index se target voucher — align ke baad Right row bhi same pairIndex. */
  const openVoucherEditForRowRight = React.useCallback(
    (pairIndex: number) => {
      const row = comparePairs[pairIndex]?.right;
      if (!row) return;
      const voucher = touchedVouchersSideB.find((v) => String(v.id || "") === row.id) || null;
      if (!voucher) return;
      setVoucherEditCompanyId(String(compareRightCompanyId || "").trim() || null);
      setVoucherForEdit(voucher);
      setIsVoucherEditOpen(true);
    },
    [comparePairs, touchedVouchersSideB, compareRightCompanyId]
  );
  React.useEffect(() => {
    if (activeComparePairIndex >= comparePairs.length) {
      setActiveComparePairIndex(comparePairs.length > 0 ? comparePairs.length - 1 : 0);
    }
  }, [activeComparePairIndex, comparePairs.length]);

  /** Ek hi `<table>` me 16 columns — dono half same `<tr>` me hain to row height hamesha match (do alag table + JS sync ki zarurat nahi). */
  const onComparePairDoubleClick = React.useCallback(
    (e: React.MouseEvent, pairIdx: number) => {
      const td = (e.target as HTMLElement).closest("td");
      if (!td) return;
      const tr = td.parentElement as HTMLTableRowElement | null;
      if (!tr) return;
      const cellIndex = Array.prototype.indexOf.call(tr.cells, td);
      const pair = comparePairs[pairIdx];
      const half = getCompareHalfFromCell(tr, cellIndex);
      if (half === "left") {
        if (pair?.left) openVoucherEditForRow(pairIdx);
        else if (pair?.right) openVoucherEditForRowRight(pairIdx);
      } else {
        if (pair?.right) openVoucherEditForRowRight(pairIdx);
        else if (pair?.left) openVoucherEditForRow(pairIdx);
      }
    },
    [comparePairs, openVoucherEditForRow, openVoucherEditForRowRight]
  );

  const formatLedgerAmountCell = React.useCallback((n: number) => {
    // Visual scan: zero amount ko short dash dikhayein.
    return Number(n) === 0 ? "-" : n.toFixed(2);
  }, []);

  /** Per-voucher left/right ledger label summary — user ko row copy decision me quick context mile. */
  const compareRowLedgerSummary = React.useMemo(() => {
    const map = { [sourcePartyId]: targetPartyId, ...manualIdMap };
    const out = new Map<string, { fromLedger: string; toLedger: string }>();
    compareRows.forEach((r) => {
      const voucher = touchedVouchers.find((v) => String(v.id || "") === r.id);
      if (!voucher) return;
      const refs = collectVoucherReferenceIds(voucher);
      const firstSource = refs[0] || sourcePartyId;
      const mapped = map[firstSource] || "";
      out.set(r.id, {
        // User intent: From ledger column should always show selected source ledger only.
        fromLedger: sourceNameOnly(sourcePartyId) || "—",
        toLedger: mapped ? targetPartyNameById.get(mapped) || mapped : "Not mapped",
      });
    });
    return out;
  }, [compareRows, touchedVouchers, sourcePartyId, targetPartyId, manualIdMap, sourceNameOnly, targetPartyNameById]);
  const compareRowDateCells = React.useMemo(() => {
    const out = new Map<string, { bs: string; ad: string }>();
    const parseRawDate = (raw: unknown): Date | null => {
      if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
      if (raw && typeof raw === "object" && "toDate" in (raw as Record<string, unknown>)) {
        try {
          const d = (raw as { toDate?: () => Date }).toDate?.();
          return d instanceof Date && !isNaN(d.getTime()) ? d : null;
        } catch {
          return null;
        }
      }
      if (typeof raw === "string" || typeof raw === "number") {
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    };
    const addLabel = (r: CopyLedgerComparisonRow) => {
      const d = parseRawDate(r.rawDate);
      out.set(r.id, {
        bs: d ? formatDateBS(d) : "—",
        ad: d ? formatDate(d) : "—",
      });
    };
    compareRows.forEach(addLabel);
    compareRowsSideB.forEach(addLabel);
    return out;
  }, [compareRows, compareRowsSideB, formatDate, formatDateBS]);

  const compareDateCellCn = "whitespace-nowrap px-1 py-0.5 text-[11px] tabular-nums leading-tight";

  /** Default target company — compare open + ledger list ke liye. */
  React.useEffect(() => {
    if (!open) return;
    if (otherCompanies.length && !targetCompanyId) {
      setTargetCompanyId(otherCompanies[0].id);
    }
  }, [open, otherCompanies, targetCompanyId]);

  // Side B ledgers — **`compareRightCompanyId`** (vouchers ke saath sync); `targetCompanyId` effect se mat lo (race → galat party id).
  React.useEffect(() => {
    if (!open || !String(compareRightCompanyId || "").trim()) {
      setCompareRightLedgerOptions([]);
      return;
    }
    const cid = String(compareRightCompanyId).trim();
    let cancelled = false;
    (async () => {
      try {
        const rows = await loadLedgerOptionsForCompany(cid);
        if (cancelled) return;
        setCompareRightLedgerOptions(rows);
        setTargetPartyId((prev) => (prev && rows.some((p) => p.id === prev) ? prev : ""));
      } catch (e) {
        console.error(e);
        if (!cancelled) setCompareRightLedgerOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, compareRightCompanyId]);

  /** Side B company id — fetch complete hone se pehle copy ho jaye to purani `getDocs` poori list se overwrite na ho (mergeVoucherRowsById). */
  const lastRightCompareFetchCidRef = React.useRef<string>("");
  /** Remote Side A company id — wahi race fix B→A ke liye. */
  const lastLeftRemoteCompareFetchCidRef = React.useRef<string>("");

  // Side A: hamesha `compareLeftCompanyId` se vouchers + ledger list — app header company se independent.
  React.useEffect(() => {
    if (!open || !String(compareLeftCompanyId || "").trim()) {
      lastLeftRemoteCompareFetchCidRef.current = "";
      setCompareRemoteVouchers([]);
      setCompareLeftLedgerOptions([]);
      return;
    }
    const leftCid = String(compareLeftCompanyId).trim();
    if (lastLeftRemoteCompareFetchCidRef.current !== leftCid) {
      lastLeftRemoteCompareFetchCidRef.current = leftCid;
      setCompareRemoteVouchers([]);
    }
    let cancelled = false;
    (async () => {
      try {
        const [vSnap, ledgerRows] = await Promise.all([
          getDocs(collection(firestore, `companies/${leftCid}/vouchers`)),
          loadLedgerOptionsForCompany(leftCid),
        ]);
        if (cancelled) return;
        let rows: Array<Record<string, unknown>> = vSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
        if (isLocalOnlyMode()) {
          const localRows = await listCompanyDocsFromBrowserDb(leftCid, "vouchers");
          rows = mergeVoucherRowsById(rows, localRows);
        }
        setCompareRemoteVouchers((prev) => mergeVoucherRowsById(prev, rows));
        setCompareLeftLedgerOptions(ledgerRows);
      } catch {
        if (!cancelled) {
          setCompareRemoteVouchers([]);
          setCompareLeftLedgerOptions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, compareLeftCompanyId]);

  // Compare ke liye "To" company vouchers — compare header ke right dropdown (`compareRightCompanyId`) se bind.
  React.useEffect(() => {
    if (!open) {
      lastRightCompareFetchCidRef.current = "";
      setTargetCompanyVouchers([]);
      return;
    }
    const cid = String(compareRightCompanyId || "").trim();
    if (!cid) {
      setTargetCompanyVouchers([]);
      return;
    }
    if (lastRightCompareFetchCidRef.current !== cid) {
      lastRightCompareFetchCidRef.current = cid;
      setTargetCompanyVouchers([]);
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(collection(firestore, `companies/${cid}/vouchers`));
        if (cancelled) return;
        let rows: Array<Record<string, unknown>> = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
        if (isLocalOnlyMode()) {
          const localRows = await listCompanyDocsFromBrowserDb(cid, "vouchers");
          rows = mergeVoucherRowsById(rows, localRows);
        }
        setTargetCompanyVouchers((prev) => mergeVoucherRowsById(prev, rows));
      } catch {
        if (!cancelled) setTargetCompanyVouchers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, compareRightCompanyId]);

  // Right dropdown change → main Copy dialog ka `targetCompanyId` sync (parties load effect ke liye).
  React.useEffect(() => {
    if (!open) return;
    const r = String(compareRightCompanyId || "").trim();
    if (r) setTargetCompanyId(r);
  }, [open, compareRightCompanyId]);

  // Dono side same company na ho — jab tak "Same company" tick nahi (within-company sync).
  React.useEffect(() => {
    if (!open || !compareLeftCompanyId || !compareRightCompanyId) return;
    if (compareUseSameCompanyOnSideA || compareUseSameCompanyOnSideB) return;
    if (compareLeftCompanyId !== compareRightCompanyId) return;
    const alt = allCompaniesSorted.find((c) => c.id !== compareLeftCompanyId)?.id;
    if (alt) setCompareRightCompanyId(alt);
  }, [
    open,
    compareLeftCompanyId,
    compareRightCompanyId,
    allCompaniesSorted,
    compareUseSameCompanyOnSideA,
    compareUseSameCompanyOnSideB,
  ]);

  React.useEffect(() => {
    if (!open || !compareUseSameCompanyOnSideB || !compareLeftCompanyId) return;
    if (compareRightCompanyId !== compareLeftCompanyId) {
      setCompareRightCompanyId(compareLeftCompanyId);
    }
  }, [open, compareUseSameCompanyOnSideB, compareLeftCompanyId, compareRightCompanyId]);

  React.useEffect(() => {
    if (!open || !compareUseSameCompanyOnSideA || !compareRightCompanyId) return;
    if (compareLeftCompanyId !== compareRightCompanyId) {
      setCompareLeftCompanyId(compareRightCompanyId);
    }
  }, [open, compareUseSameCompanyOnSideA, compareRightCompanyId, compareLeftCompanyId]);

  const onCompareLeftCompanyChange = React.useCallback(
    (nextId: string) => {
      if (compareRightCompanyId && nextId === compareRightCompanyId) {
        setCompareUseSameCompanyOnSideA(true);
        setCompareUseSameCompanyOnSideB(false);
        setCompareLeftCompanyId(nextId);
        return;
      }
      setCompareUseSameCompanyOnSideA(false);
      setCompareLeftCompanyId(nextId);
      if (compareUseSameCompanyOnSideB) setCompareRightCompanyId(nextId);
    },
    [compareRightCompanyId, compareUseSameCompanyOnSideB]
  );

  const onCompareRightCompanyChange = React.useCallback(
    (nextId: string) => {
      if (compareLeftCompanyId && nextId === compareLeftCompanyId) {
        setCompareUseSameCompanyOnSideB(true);
        setCompareUseSameCompanyOnSideA(false);
        setCompareRightCompanyId(nextId);
        return;
      }
      setCompareUseSameCompanyOnSideB(false);
      setCompareRightCompanyId(nextId);
      if (compareUseSameCompanyOnSideA) setCompareLeftCompanyId(nextId);
    },
    [compareLeftCompanyId, compareUseSameCompanyOnSideA]
  );

  const compareLeftLedgerPickerDisabled =
    !compareLeftCompanyId || compareUseSameCompanyOnSideB;
  const compareRightLedgerPickerDisabled =
    !compareRightCompanyId || compareUseSameCompanyOnSideA;

  // Compare me company / voucher list badle to frozen copy payload bhi align rahe.
  React.useEffect(() => {
    if (!open) return;
    const ref = copyLedgerFrozenRef.current;
    if (!ref) return;
    const src = String(compareLeftCompanyId || "").trim() || ref.sourceCompanyId;
    const tgt = String(compareRightCompanyId || "").trim() || ref.targetCompanyId;
    ref.sourceCompanyId = src;
    ref.targetCompanyId = tgt;
    // Bootstrap sirf `open` flip par chalta hai — us waqt route se party id kabhi abhi apply nahi hui hoti; ref me khali ids na rahein.
    ref.sourcePartyId = String(sourcePartyId || "").trim();
    ref.targetPartyId = String(targetPartyId || "").trim();
    ref.vouchers = touchedVouchers;
    ref.liveCount = touchedVouchers.length;
  }, [open, compareLeftCompanyId, compareRightCompanyId, sourcePartyId, targetPartyId, touchedVouchers]);

  /** Header se seed: companies, freeze ref, selection — poora pehla dialog skip. */
  const bootstrapCompareLedgerSession = React.useCallback(() => {
    const touched = (vouchersForDisplay || []).filter((v) => voucherTouchesPartyLedger(v, sourcePartyId)) as Array<
      Record<string, unknown>
    >;
    const liveCount = touched.length;
    const initialSelectedIds = touched.map((v) => String(v.id || "")).filter(Boolean);
    setSelectedVoucherIds(initialSelectedIds);
    // Side B selection alag — har Compare open par clear taaki galati se B→A run na ho.
    setSelectedRightVoucherIds([]);
    setManualIdMap({});
    const leftCo = effectiveSourceCompanyId;
    let rightCo = String(targetCompanyId || "").trim();
    if (!rightCo || rightCo === leftCo) {
      rightCo = allCompaniesSorted.find((c) => c.id !== leftCo)?.id ?? "";
    }
    setCompareLeftCompanyId(leftCo);
    setCompareRightCompanyId(rightCo);
    if (rightCo) setTargetCompanyId(rightCo);

    copyLedgerFrozenRef.current = {
      sourceCompanyId: leftCo,
      targetCompanyId: String(rightCo || targetCompanyId).trim(),
      sourcePartyId: String(sourcePartyId).trim(),
      targetPartyId: String(targetPartyId).trim(),
      liveCount,
      vouchers: touched,
      accountNote: targetAccountNote.trim(),
      noteColorHex: targetAccountNoteColor,
      selectedVoucherIds: initialSelectedIds,
      idMap: {},
    };
    // Default "All accounts" — sale/purchase/item ledgers bhi combobox me (sirf Parties filter nahi).
    setCompareEntityBucket("all");
    setCompareUseSameCompanyOnSideA(false);
    setCompareUseSameCompanyOnSideB(false);
  }, [
    effectiveSourceCompanyId,
    targetCompanyId,
    sourcePartyId,
    targetPartyId,
    vouchersForDisplay,
    targetAccountNote,
    targetAccountNoteColor,
    allCompaniesSorted,
  ]);

  // Sirf `open` edge — `sourcePartyId` wagaira har change pe compare reset na ho (ref se latest bootstrap).
  const bootstrapCompareLedgerSessionRef = React.useRef(bootstrapCompareLedgerSession);
  bootstrapCompareLedgerSessionRef.current = bootstrapCompareLedgerSession;
  React.useEffect(() => {
    if (!open) return;
    bootstrapCompareLedgerSessionRef.current();
  }, [open]);

  /** Mode + direction: A→B (default) ya B→A — `executeCopyLedgerCrossCompany` hamesha "source company → target company". */
  const runCopyWithMode = React.useCallback(
    async (mode: CopyLedgerMode, direction: "AtoB" | "BtoA") => {
      const frozen = copyLedgerFrozenRef.current;
      const uid = auth.currentUser?.uid ?? user?.uid ?? customUser?.uid ?? "";
      if (!uid) {
        toast({ variant: "destructive", title: "Cannot copy", description: "Sign in again, then retry." });
        return;
      }

      const isBtoA = direction === "BtoA";
      // Party ids: A→B = left→right; B→A copy source = Side B ledger, target = Side A ledger.
      const sourcePartyIdResolved = (frozen?.sourcePartyId || "").trim() || String(sourcePartyId).trim();
      const targetPartyIdResolved = (frozen?.targetPartyId || "").trim() || String(targetPartyId).trim();
      const leftCo = String(compareLeftCompanyId || effectiveSourceCompanyId).trim();
      const rightCo = String(compareRightCompanyId || targetCompanyId).trim();

      let sourceCompanyIdResolved = (frozen?.sourceCompanyId || "").trim() || leftCo;
      let targetCompanyIdResolved = (frozen?.targetCompanyId || "").trim() || rightCo;
      let copySourcePartyId = sourcePartyIdResolved;
      let copyTargetPartyId = targetPartyIdResolved;
      let vouchersForRun: Array<Record<string, unknown>>;
      if (isBtoA) {
        sourceCompanyIdResolved = rightCo;
        targetCompanyIdResolved = leftCo;
        copySourcePartyId = targetPartyIdResolved;
        copyTargetPartyId = sourcePartyIdResolved;
        vouchersForRun = touchedVouchersSideB;
      } else {
        vouchersForRun = (frozen?.vouchers?.length ?? 0) > 0 ? frozen!.vouchers : touchedVouchers;
      }
      const liveCountResolved = vouchersForRun.length;

      if (!sourceCompanyIdResolved || !targetCompanyIdResolved || !sourcePartyIdResolved || !targetPartyIdResolved) {
        toast({
          variant: "destructive",
          title: "Cannot copy",
          description:
            "Pehle Compare me dono companies aur dono sides par source / target ledger choose karo, phir Copy karo.",
        });
        return;
      }
      if (targetCompanyIdResolved === sourceCompanyIdResolved) {
        toast({
          variant: "destructive",
          title: "Cannot copy",
          description: "Dono companies alag honi chahiye — left aur right same company par copy nahi.",
        });
        return;
      }
      if (liveCountResolved < 1) {
        toast({
          variant: "destructive",
          title: "Cannot copy",
          description: "Is ledger ko touch karne wala koi voucher nahi — doosra account check karo.",
        });
        return;
      }

      const autoNameMap: Record<string, string> = {};
      sourcePartyNameById.forEach((srcName, srcId) => {
        const k = String(srcName || "").trim().toLowerCase();
        const tId = targetPartyIdByName.get(k);
        if (tId) autoNameMap[srcId] = tId;
      });
      const reverseManual: Record<string, string> = {};
      Object.entries(manualIdMap).forEach(([a, b]) => {
        if (b && typeof b === "string") reverseManual[b] = a;
      });
      const autoNameMapBtoA: Record<string, string> = {};
      compareRightLedgerOptionsFull.forEach((ro) => {
        const k = String(ro.name || "").trim().toLowerCase();
        const lo = compareLeftLedgerOptionsFull.find((l) => String(l.name || "").trim().toLowerCase() === k);
        if (lo) autoNameMapBtoA[ro.id] = lo.id;
      });

      let effectiveSelectedVoucherIds: string[];
      let effectiveIdMap: Record<string, string>;
      let knownIdsForUnresolved: Set<string>;

      if (isBtoA) {
        effectiveSelectedVoucherIds = selectedRightVoucherIdsForSync;
        effectiveIdMap = {
          ...autoNameMapBtoA,
          [copySourcePartyId]: copyTargetPartyId,
          ...reverseManual,
        };
        knownIdsForUnresolved = leftKnownPartyIds;
      } else {
        effectiveSelectedVoucherIds =
          selectedVoucherIdsForSync.length > 0 ? selectedVoucherIdsForSync : frozen?.selectedVoucherIds ?? [];
        effectiveIdMap = { ...autoNameMap, [copySourcePartyId]: copyTargetPartyId, ...(manualIdMap || {}) };
        knownIdsForUnresolved = targetKnownPartyIds;
      }

      if (effectiveSelectedVoucherIds.length < 1) {
        toast({
          variant: "destructive",
          title: "Cannot copy",
          description: isBtoA
            ? "Side B par kam se kam ek row select karo (right checkbox)."
            : "Side A par kam se kam ek row select karo (left checkbox).",
        });
        return;
      }

      const unresolvedInSelection = new Set<string>();
      const selectedSet = new Set(effectiveSelectedVoucherIds);
      vouchersForRun.forEach((v) => {
        const vid = String(v.id || "");
        if (!selectedSet.has(vid)) return;
        collectOppositeReferenceIdsForCompare(v, copySourcePartyId).forEach((srcId) => {
          const mapped = effectiveIdMap[srcId] || srcId;
          if (!knownIdsForUnresolved.has(mapped)) unresolvedInSelection.add(srcId);
        });
      });
      if (unresolvedInSelection.size > 0) {
        toast({
          variant: "destructive",
          title: "Mapping required",
          description:
            "Some selected vouchers still have unmapped opposite accounts. Resolve them in Compare (Reference mapping / Missing refs) first.",
        });
        return;
      }

      setCopyingProgress({ done: 0, total: effectiveSelectedVoucherIds.length, currentLabel: undefined });
      try {
        const result = await executeCopyLedgerCrossCompany({
          userId: uid,
          sourceCompanyId: sourceCompanyIdResolved,
          targetCompanyId: targetCompanyIdResolved,
          sourcePartyId: copySourcePartyId,
          targetPartyId: copyTargetPartyId,
          vouchers: vouchersForRun,
          selectedVoucherIds: effectiveSelectedVoucherIds,
          idMap: effectiveIdMap,
          mode,
          accountNote: frozen?.accountNote?.trim() || targetAccountNote.trim() || undefined,
          noteColorHex: frozen?.noteColorHex || targetAccountNoteColor || "#f97316",
          onProgress: (p) => setCopyingProgress(p),
        });
        const leftCoName = companyDisplayNameById.get(compareLeftCompanyId) || company?.name || "—";
        const rightCoName = companyDisplayNameById.get(compareRightCompanyId) || targetCompanyName || "—";
        const leftPartyLabel = sourceNameOnly(sourcePartyId) || "—";
        if (result.failed === 0) {
          toast({
            title: "Copy complete",
            description: isBtoA
              ? `Copied ${result.success} voucher(s) to "${leftCoName}" (Side A ledger: ${leftPartyLabel}).`
              : `Copied ${result.success} voucher(s) to "${rightCoName}" as "${targetPartyName}". Compare me Side B par rows update ho jayengi.`,
          });
        } else {
          toast({
            variant: "destructive",
            title: "Copy finished with errors",
            description: `Saved ${result.success}, failed ${result.failed}. First error: ${result.errors[0]?.message ?? "—"}`,
          });
        }
        // Turant dusri side par row: `writtenTargetDocs` merge — effect/`getDocs` race ab mergeVoucherRowsById se safe.
        const written = result.writtenTargetDocs ?? [];
        if (result.success > 0 && written.length > 0) {
          if (isBtoA) {
            setCompareRemoteVouchers((prev) => mergeVoucherRowsById(prev, written));
          } else {
            setTargetCompanyVouchers((prev) => mergeVoucherRowsById(prev, written));
          }
        }
        // Thodi der baad full collection sync — merge hi use karo taaki optimistic row na kite.
        const cidSync = String(targetCompanyIdResolved || "").trim();
        const shouldDeferFullSync = Boolean(cidSync && result.success > 0);
        if (shouldDeferFullSync) {
          window.setTimeout(() => {
            void (async () => {
              try {
                const snap = await getDocs(collection(firestore, `companies/${cidSync}/vouchers`));
                const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
                if (isBtoA) {
                  setCompareRemoteVouchers((prev) => mergeVoucherRowsById(prev, rows));
                } else {
                  setTargetCompanyVouchers((prev) => mergeVoucherRowsById(prev, rows));
                }
              } catch {
                /* ignore */
              }
            })();
          }, 400);
        }
        // Local-first + online: outbox jaldi flush taaki Firestore par copy turant reflect ho (VoucherOutboxFlushManager bhi periodic).
        if (result.success > 0 && isLocalOnlyMode()) {
          void flushVoucherOutbox();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast({ variant: "destructive", title: "Copy failed", description: msg });
      } finally {
        setCopyingProgress(null);
      }
    },
    [
      user?.uid,
      customUser?.uid,
      selectedVoucherIdsForSync,
      selectedRightVoucherIdsForSync,
      manualIdMap,
      targetKnownPartyIds,
      leftKnownPartyIds,
      compareRightLedgerOptionsFull,
      compareLeftLedgerOptionsFull,
      sourceNameOnly,
      sourcePartyNameById,
      targetPartyIdByName,
      toast,
      targetCompanyName,
      targetPartyName,
      sourcePartyId,
      targetPartyId,
      compareLeftCompanyId,
      compareRightCompanyId,
      targetCompanyId,
      touchedVouchers,
      touchedVouchersSideB,
      targetAccountNote,
      targetAccountNoteColor,
      companyDisplayNameById,
      company?.name,
    ]
  );

  /** Ek hi Sync: left tick → Side B; right tick → Side A; batch (fast). Dono tick ho to pehle A→B phir B→A. */
  const runUnifiedSync = React.useCallback(async () => {
    const leftOk = selectedVoucherIdsForSync.length > 0 && unresolvedReferenceIds.length === 0;
    const rightOk = selectedRightVoucherIdsForSync.length > 0 && unresolvedReferenceIdsBtoA.length === 0;
    if (!leftOk && !rightOk) {
      toast({
        variant: "destructive",
        title: "Cannot sync",
        description:
          "Select at least one row on one side, and map any missing references before syncing.",
      });
      return;
    }
    if (leftOk) await runCopyWithMode("batch", "AtoB");
    if (rightOk) await runCopyWithMode("batch", "BtoA");
  }, [
    runCopyWithMode,
    toast,
    selectedVoucherIdsForSync,
    selectedRightVoucherIdsForSync,
    unresolvedReferenceIds,
    unresolvedReferenceIdsBtoA,
  ]);

  /** Dialog ke andar lists dubara load — `router.refresh` / window reload nahi, page shake nahi. */
  const refreshCompareData = React.useCallback(async () => {
    if (!open) return;
    setCompareRefreshing(true);
    try {
      // Local-first: vouchers SQLite me hon, Firestore list khaali — merge se Side B row gayab na ho.
      const mergeWithLocalVouchers = async (companyId: string, firestoreRows: Array<Record<string, unknown>>) => {
        if (!isLocalOnlyMode()) return firestoreRows;
        const localRows = await listCompanyDocsFromBrowserDb(companyId, "vouchers");
        return mergeVoucherRowsById(firestoreRows, localRows);
      };
      const r = String(compareRightCompanyId || "").trim();
      if (r) {
        const snap = await getDocs(collection(firestore, `companies/${r}/vouchers`));
        const fsRows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
        setTargetCompanyVouchers(await mergeWithLocalVouchers(r, fsRows));
      }
      const l = String(compareLeftCompanyId || "").trim();
      if (l) {
        const snap = await getDocs(collection(firestore, `companies/${l}/vouchers`));
        const fsRows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
        setCompareRemoteVouchers(await mergeWithLocalVouchers(l, fsRows));
      }
      toast({ title: "Refreshed", description: "Compare ke voucher lists update ho gayi." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: "Refresh failed", description: msg });
    } finally {
      setCompareRefreshing(false);
    }
  }, [open, compareRightCompanyId, compareLeftCompanyId, toast]);

  const addMatchingLedgerForSourceId = React.useCallback(
    async (srcId: string, preferredName?: string) => {
      // Mapping popup hamesha Side B company mein doc banata — header `compareRightCompanyId` authoritative.
      const cidForTarget = String(compareRightCompanyId || "").trim() || String(targetCompanyId || "").trim();
      if (!cidForTarget) return null;
      const sourceMeta = sourceOrTargetLedgerMetaById.get(srcId);
      const kind = sourceMeta?.kind || "party";
      const collectionName =
        sourceMeta?.collection ||
        (kind === "party"
          ? "parties"
          : kind === "bank"
            ? "bank_accounts"
            : kind === "staff"
              ? "staff"
              : kind === "tax"
                ? "taxes"
                : kind === "item"
                  ? "items"
                  : "expense_accounts");
      const name = (preferredName || sourceNameOnly(srcId)).trim();
      if (!name || name === "Unmapped source ledger") return null;
      const payload: Record<string, unknown> = { isDeleted: false, createdAt: new Date() };
      // Collection-wise defaults so newly added ledger instantly usable in forms and copy mapping.
      if (collectionName === "bank_accounts") {
        payload.accountName = name;
        payload.accountType = "Bank";
        payload.balance = 0;
        payload.openingBalance = 0;
      } else if (collectionName === "items") {
        payload.name = name;
        payload.itemName = name;
        payload.salePrice = 0;
        payload.purchasePrice = 0;
        payload.stock = 0;
        payload.unit = "pcs";
      } else if (collectionName === "taxes") {
        payload.name = name;
        payload.rate = 0;
      } else {
        payload.name = name;
      }
      const ref = await addDoc(collection(firestore, `companies/${cidForTarget}/${collectionName}`), payload);
      const row: PartyOption = { id: ref.id, name, kind, collection: collectionName };
      setCompareRightLedgerOptions((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
      return ref.id;
    },
    [compareRightCompanyId, targetCompanyId, sourceOrTargetLedgerMetaById, sourceNameOnly]
  );

  /** Compare band → ref clear taaki purana freeze dubara use na ho */
  React.useEffect(() => {
    // Compare बंद + copying बंद होने पर frozen payload clear.
    if (!open && !copyingProgress) copyLedgerFrozenRef.current = null;
  }, [open, copyingProgress]);

  /** Har render par sync: nested voucher edit khula ho to Compare ka `onOpenChange(false)` ignore (edit band hone par sync page open rahe). */
  const blockCompareCloseWhileVoucherEditRef = React.useRef(false);
  blockCompareCloseWhileVoucherEditRef.current = isVoucherEditOpen;

  /** Sync button enable: left ya right me se kam se kam ek valid selection. */
  const canSyncAtoB =
    selectedVoucherIdsForSync.length > 0 && unresolvedReferenceIds.length === 0;
  const canSyncBtoA =
    selectedRightVoucherIdsForSync.length > 0 && unresolvedReferenceIdsBtoA.length === 0;
  const canRunUnifiedSync = canSyncAtoB || canSyncBtoA;

  return (
    <>
      {/* modal={false} par Radix overlay kam blur deta hai — alag fixed backdrop. */}
      {open ? (
        <div
          className="fixed inset-0 z-[48] bg-black/50 backdrop-blur-lg dark:bg-black/60 pointer-events-auto"
          aria-hidden="true"
        />
      ) : null}
      {/* Sirf Compare before Sync — pehla setup dialog hata diya gaya. */}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && blockCompareCloseWhileVoucherEditRef.current) return;
          onOpenChange(next);
        }}
        modal={false}
      >
        <DialogContent
          overlayClassName="bg-transparent pointer-events-none backdrop-blur-none"
          className={
            /* Neela border + white ki jagah halka slate — plain white canvas kam harsh */
            "w-[95vw] max-w-[95vw] h-[92vh] !flex !flex-col overflow-hidden !p-0 gap-0 !rounded-xl " +
            "border-2 border-blue-600 shadow-xl shadow-blue-900/10 " +
            "bg-slate-100/95 dark:bg-slate-900/95 dark:border-blue-500"
          }
        >
          {/* Left/Right "pages" ko header se table tak ek vertical line se divide — lg pe 2x2 grid, mobile pe stack (title→company→from→to). */}
          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-b-[calc(0.75rem-2px)] border border-slate-300/80 dark:border-slate-700">
            {/* Ek hi row: left/right dono jagah Company dropdown + beech me centered title — pehle sirf dahina tha. */}
            {/* pr-12+: absolute close (X) se overlap na ho — Side B Company/Entity thoda left shift (padding se). */}
            <div className="col-span-1 row-start-1 shrink-0 border-b border-border bg-muted/40 px-3 py-2 pr-12 sm:pr-14 lg:col-span-2">
              {/* 3-column row: dono ends Company, beech me title hamesha geometric center (`1fr / auto / 1fr`). */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                <div className="flex min-w-0 flex-wrap items-center justify-start gap-x-2 gap-y-1.5 sm:justify-self-start">
                  <Label htmlFor="compare-sync-target-company-left" className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    Company
                  </Label>
                  {/* Saari companies; jo right par select hai wahi yahan disabled (same id do jagah nahi). */}
                  <Select value={compareLeftCompanyId} onValueChange={onCompareLeftCompanyChange}>
                    <SelectTrigger id="compare-sync-target-company-left" className="h-8 min-w-[120px] max-w-[46%] flex-1 text-xs sm:max-w-[200px]">
                      <SelectValue placeholder="Select company" />
                    </SelectTrigger>
                    <SelectContent>
                      {compareRightCompanyId ? (
                        <SelectItem key="same-co-side-a" value={compareRightCompanyId}>
                          Same company
                        </SelectItem>
                      ) : null}
                      {allCompaniesSorted
                        .filter((c) => c.id !== compareRightCompanyId)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {/* Dono header me same `compareEntityBucket` — ek jagah change = doosri auto sync. */}
                  <Label htmlFor="compare-entity-bucket-left" className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    Entity
                  </Label>
                  <Select
                    value={compareEntityBucket}
                    onValueChange={(v) => setCompareEntityBucket(v as CompareEntityBucket)}
                  >
                    <SelectTrigger id="compare-entity-bucket-left" className="h-8 min-w-[128px] max-w-[46%] flex-1 text-xs sm:max-w-[200px]">
                      <SelectValue placeholder="Entity" />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPARE_ENTITY_SELECT_ITEMS.map((it) => (
                        <SelectItem key={it.value} value={it.value}>
                          {it.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Beech title ke left/right: Side A & Side B labels (sync direction clear). */}
                <div className="m-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center sm:justify-self-center sm:px-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                    Side A
                  </span>
                  <DialogTitle className="m-0 text-base font-semibold leading-tight">
                    Compare before Sync
                  </DialogTitle>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-400">
                    Side B
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1.5 sm:mr-1 sm:justify-self-end">
                  <Label htmlFor="compare-sync-target-company-right" className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    Company
                  </Label>
                  <Select value={compareRightCompanyId} onValueChange={onCompareRightCompanyChange}>
                    <SelectTrigger id="compare-sync-target-company-right" className="h-8 min-w-[120px] max-w-[42%] flex-1 text-xs sm:max-w-[180px]">
                      <SelectValue placeholder="Select company" />
                    </SelectTrigger>
                    <SelectContent>
                      {compareLeftCompanyId ? (
                        <SelectItem key="same-co-side-b" value={compareLeftCompanyId}>
                          Same company
                        </SelectItem>
                      ) : null}
                      {allCompaniesSorted
                        .filter((c) => c.id !== compareLeftCompanyId)
                        .map((c) => (
                          <SelectItem key={`r-${c.id}`} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Label htmlFor="compare-entity-bucket-right" className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    Entity
                  </Label>
                  <Select value={compareEntityBucket} onValueChange={(v) => setCompareEntityBucket(v as CompareEntityBucket)}>
                    <SelectTrigger id="compare-entity-bucket-right" className="h-8 min-w-[120px] max-w-[42%] flex-1 text-xs sm:max-w-[180px]">
                      <SelectValue placeholder="Entity" />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPARE_ENTITY_SELECT_ITEMS.map((it) => (
                        <SelectItem key={`er-${it.value}`} value={it.value}>
                          {it.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogDescription className="sr-only">Compare source and target ledger rows before sync.</DialogDescription>
              {allCompaniesSorted.length === 0 ? (
                <p className="mt-2 text-center text-xs text-muted-foreground">Add or join another company first.</p>
              ) : null}
            </div>
            {/* From/To subheaders fix, tables neeche ek hi scroll — left/right alag scrollbar nahi. */}
            <div className="col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden border-border bg-slate-50/90 dark:bg-slate-950/60">
              <div className="grid shrink-0 grid-cols-1 border-b border-border lg:grid-cols-2 lg:divide-x lg:divide-border">
                <div className="flex items-start gap-2 bg-muted/40 px-3 py-2">
                  {/* Company line + Ledger row: searchable account (selected company) + pencil rename (party only). */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      Side A — company: {companyDisplayNameById.get(compareLeftCompanyId) || company?.name || "—"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium shrink-0">Ledger</span>
                      <Combobox
                        options={compareLeftComboboxOptions}
                        value={compareLeftComboboxValue}
                        onChange={(val, newName) => {
                          if (val === "add-new") {
                            const name = (newName || "").trim();
                            if (!name) return;
                            void addCompareLedgerParty("left", name);
                            return;
                          }
                          if (val) onCompareEntitySelectLeft(val);
                        }}
                        placeholder={compareLeftCompanyId ? "Select account" : "Select company first"}
                        searchPlaceholder="Search account…"
                        addNewLabel={compareEntityBucket === "party" ? "Add new account" : undefined}
                        disabled={compareLeftLedgerPickerDisabled}
                        title={
                          compareUseSameCompanyOnSideB
                            ? "Same company — account Side B par select karein"
                            : undefined
                        }
                        triggerClassName="h-8 min-w-[160px] max-w-full flex-1 justify-between"
                        contentWidthMode="auto"
                        popoverModal={false}
                        autoFocusSearchOnOpen
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        title="Edit selected account"
                        disabled={!sourcePartyId || compareUseSameCompanyOnSideB}
                        onClick={() => openCompareLedgerEdit("left")}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2 border-t border-border bg-muted/40 px-3 py-2 lg:border-t-0">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      Side B — company: {companyDisplayNameById.get(compareRightCompanyId) || targetCompanyName || "—"}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium shrink-0">Ledger</span>
                      <Combobox
                        options={compareRightComboboxOptions}
                        value={compareRightComboboxValue}
                        onChange={(val, newName) => {
                          if (val === "add-new") {
                            const name = (newName || "").trim();
                            if (!name) return;
                            void addCompareLedgerParty("right", name);
                            return;
                          }
                          if (val) onCompareEntitySelectRight(val);
                        }}
                        placeholder={compareRightCompanyId ? "Select account" : "Select company first"}
                        searchPlaceholder="Search account…"
                        addNewLabel={compareEntityBucket === "party" ? "Add new account" : undefined}
                        disabled={compareRightLedgerPickerDisabled}
                        title={
                          compareUseSameCompanyOnSideA
                            ? "Same company — account Side A par select karein"
                            : undefined
                        }
                        triggerClassName="h-8 min-w-[160px] max-w-full flex-1 justify-between"
                        contentWidthMode="auto"
                        popoverModal={false}
                        autoFocusSearchOnOpen
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        title="Edit selected account"
                        disabled={!targetPartyId || compareUseSameCompanyOnSideA}
                        onClick={() => openCompareLedgerEdit("right")}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
              {/* Ek row: Side A/B ka selected ledger — neeche table rows se map Missing refs samajhna asaan. */}
              <div className="grid shrink-0 grid-cols-1 border-b border-border bg-blue-50/70 dark:bg-blue-950/25 lg:grid-cols-2 lg:divide-x lg:divide-border">
                <div className="px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300">Side A · ledger</p>
                  {/* Row count ledger naam ke saath — dropdown ke paas nahi. */}
                  <p className="truncate text-sm font-medium text-foreground" title={sourceNameOnly(sourcePartyId) || undefined}>
                    {sourceNameOnly(sourcePartyId) || "—"}
                    <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                      ({compareRows.length} rows)
                    </span>
                  </p>
                </div>
                <div className="border-t border-border px-3 py-2 lg:border-t-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300">Side B · ledger</p>
                  <p
                    className="truncate text-sm font-medium text-foreground"
                    title={compareTargetPartyName !== "—" ? compareTargetPartyName : undefined}
                  >
                    {compareTargetPartyName}
                    <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                      ({compareRowsSideB.length} rows)
                    </span>
                  </p>
                </div>
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (comparePairs.length === 0) return;
                  // Transaction-like navigation: Arrow up/down and Enter opens edit popup.
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveComparePairIndex((n) => Math.min(comparePairs.length - 1, n + 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveComparePairIndex((n) => Math.max(0, n - 1));
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const pair = comparePairs[activeComparePairIndex];
                    // Pehle Side A jahan row hai; warna sirf Side B wali row.
                    if (pair?.left) openVoucherEditForRow(activeComparePairIndex);
                    else if (pair?.right) openVoucherEditForRowRight(activeComparePairIndex);
                    return;
                  }
                }}
              >
                <div className="min-w-0 overflow-x-hidden overflow-y-visible">
                  {/* `table-fixed` + colgroup 50%/50% — vertical scroll only; BS/AD alag columns (ledger Both jaisa). */}
                  <table className="w-full min-w-0 table-fixed border-collapse text-xs">
                    <colgroup>
                      <col span={COMPARE_SIDE_COL_COUNT} style={{ width: "50%" }} />
                      <col span={COMPARE_SIDE_COL_COUNT} style={{ width: "50%" }} />
                    </colgroup>
                    <thead className="bg-muted sticky top-0 z-10">
                      <tr>
                        {/* Side A: tick Cr ke baad (A→B copy); Side B: tick Date se pehle (B→A). */}
                        <th className="py-2 pl-2 pr-0.5 text-left whitespace-nowrap">Date (BS)</th>
                        <th className="py-2 px-0.5 text-left whitespace-nowrap">Date (AD)</th>
                        <th className="px-1 py-2 text-left">Voucher</th>
                        <th className="px-1 py-2 text-left">Type</th>
                        <th className="px-1 py-2 text-left truncate">Ledger</th>
                        <th className="px-1 py-2 text-left">Status</th>
                        <th className="px-1 py-2 text-right">Dr</th>
                        <th className="px-1 py-2 text-right">Cr</th>
                        <th className={`${COMPARE_SYNC_TICK_COL_W} border-r border-border py-1.5 align-bottom`}>
                          <CompareSyncTickStack side="left" showArrow={false}>
                            <Checkbox
                              className={COMPARE_SYNC_CHECKBOX_CN}
                              checked={compareSideASelectAllActive}
                              disabled={selectableCompareLeftRowIds.length === 0}
                              title={compareSideASelectAllActive ? "Deselect all (Side A)" : "Select all (Side A)"}
                              aria-label={compareSideASelectAllActive ? "Deselect all Side A rows" : "Select all Side A rows"}
                              onCheckedChange={() => toggleSelectAllCompareVouchers()}
                            />
                          </CompareSyncTickStack>
                        </th>
                        <th className={`${COMPARE_SYNC_TICK_COL_W} py-1.5 align-bottom`}>
                          <CompareSyncTickStack side="right" showArrow={false}>
                            <Checkbox
                              className={COMPARE_SYNC_CHECKBOX_CN}
                              checked={compareSideBSelectAllActive}
                              disabled={selectableCompareRightRowIds.length === 0}
                              title={compareSideBSelectAllActive ? "Deselect all (Side B)" : "Select all (Side B)"}
                              aria-label={compareSideBSelectAllActive ? "Deselect all Side B rows" : "Select all Side B rows"}
                              onCheckedChange={() => toggleSelectAllCompareVouchersSideB()}
                            />
                          </CompareSyncTickStack>
                        </th>
                        <th className="py-2 pl-0 pr-0.5 text-left whitespace-nowrap">Date (BS)</th>
                        <th className="py-2 px-0.5 text-left whitespace-nowrap">Date (AD)</th>
                        <th className="px-1 py-2 text-left">Voucher</th>
                        <th className="px-1 py-2 text-left">Type</th>
                        <th className="px-1 py-2 text-left">Ledger</th>
                        <th className="px-1 py-2 text-left">Status</th>
                        <th className="px-1 py-2 text-right">Dr</th>
                        <th className="px-1 py-2 text-right">Cr</th>
                      </tr>
                    </thead>
                    <tbody className="[&_td]:align-top [&_th]:align-top">
                      {comparePairs.map((pair, idx) => {
                        const r = pair.left;
                        const br = pair.right;
                        const rowActive = idx === activeComparePairIndex;
                        const rowBg = rowActive ? "bg-blue-100/70 dark:bg-blue-900/30" : "";
                        const dash = "—";
                        const pairTitle =
                          !r && br
                            ? "No row on Side A for this line (Side B has a voucher)"
                            : r && !br
                              ? "No row on Side B for this line (Side A has a voucher)"
                              : undefined;
                        // Left = A→B selection (Side A voucher id); right = B→A (Side B id) — alag state.
                        const pairRowSyncMatched = isComparePairRowSyncMatched(pair);
                        const canToggleLeft = Boolean(r?.id) && !pairRowSyncMatched;
                        const canToggleRight = Boolean(br?.id) && !pairRowSyncMatched;
                        const checkedLeft = canToggleLeft ? selectedVoucherIds.includes(r!.id) : false;
                        const checkedRight = canToggleRight ? selectedRightVoucherIds.includes(br!.id) : false;
                        const rowSummary = r ? compareRowLedgerSummary.get(r.id) : undefined;
                        const onLeftCheckChange = (next: boolean) => {
                          if (!r?.id) return;
                          setActiveComparePairIndex(idx);
                          setSelectedVoucherIds((prev) =>
                            next ? Array.from(new Set([...prev, r.id])) : prev.filter((id) => id !== r.id)
                          );
                        };
                        const onRightCheckChange = (next: boolean) => {
                          if (!br?.id) return;
                          setActiveComparePairIndex(idx);
                          setSelectedRightVoucherIds((prev) =>
                            next ? Array.from(new Set([...prev, br.id])) : prev.filter((id) => id !== br.id)
                          );
                        };
                        const renderLeftCheckbox = () => (
                          <Checkbox
                            className={COMPARE_SYNC_CHECKBOX_CN}
                            checked={checkedLeft}
                            disabled={!canToggleLeft}
                            title={
                              canToggleLeft
                                ? undefined
                                : pairRowSyncMatched
                                  ? "Side A aur B matched — select nahi"
                                  : "Is line par Side A par voucher nahi — select nahi"
                            }
                            onCheckedChange={(next) => onLeftCheckChange(!!next)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        );
                        const renderRightCheckbox = () => (
                          <Checkbox
                            className={COMPARE_SYNC_CHECKBOX_CN}
                            checked={checkedRight}
                            disabled={!canToggleRight}
                            title={
                              canToggleRight
                                ? undefined
                                : pairRowSyncMatched
                                  ? "Side A aur B matched — select nahi"
                                  : "Is line par Side B par voucher nahi — select nahi"
                            }
                            onCheckedChange={(next) => onRightCheckChange(!!next)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        );
                        return (
                          <React.Fragment key={`pair-${idx}-${r?.id ?? "a"}-${br?.id ?? "b"}`}>
                            <tr
                              data-compare-row="main"
                              className={`border-t cursor-pointer ${rowBg}`}
                              title={pairTitle}
                              onClick={() => setActiveComparePairIndex(idx)}
                              onDoubleClick={(e) => onComparePairDoubleClick(e, idx)}
                            >
                              {r ? (
                                <>
                                  <td className={`${compareDateCellCn} pl-2 ${rowBg}`}>
                                    {compareRowDateCells.get(r.id)?.bs ?? "—"}
                                  </td>
                                  <td className={`${compareDateCellCn} ${rowBg}`}>
                                    {compareRowDateCells.get(r.id)?.ad ?? "—"}
                                  </td>
                                  <td className={`px-1 py-0.5 font-medium truncate ${rowBg}`}>{r.voucherNumber || "—"}</td>
                                  <td className={`px-2 py-0.5 ${rowBg}`}>{compareRowTypeLabel(r)}</td>
                                  <td className={`px-2 py-0.5 ${rowBg}`}>{rowSummary?.fromLedger || "—"}</td>
                                  <td className={`px-2 py-0.5 ${rowBg}`}>{renderSideAStatus(r)}</td>
                                  <td className={`px-2 py-0.5 text-right text-green-700 ${rowBg}`}>
                                    {formatLedgerAmountCell(r.debit || 0)}
                                  </td>
                                  <td className={`px-2 py-0.5 text-right text-red-600 ${rowBg}`}>
                                    {formatLedgerAmountCell(r.credit || 0)}
                                  </td>
                                  <td className={`${COMPARE_SYNC_TICK_COL_W} border-r border-border py-0.5 align-top ${rowBg}`}>
                                    <CompareSyncTickStack side="left">{renderLeftCheckbox()}</CompareSyncTickStack>
                                  </td>
                                </>
                              ) : !compareSideAHasLedger ? (
                                <td
                                  colSpan={COMPARE_SIDE_COL_COUNT}
                                  className={`border-r border-border px-3 py-3 text-center align-middle text-muted-foreground/90 ${rowBg}`}
                                >
                                  {/* Account choose nahi — poora half center (dash grid left-align na lage). */}
                                  <div className="flex flex-col items-center justify-center gap-2 sm:flex-row sm:justify-end">
                                    <span className="max-w-[14rem] text-[11px] leading-snug">
                                      Select account above (Side A)
                                    </span>
                                    <CompareSyncTickStack side="left">{renderLeftCheckbox()}</CompareSyncTickStack>
                                  </div>
                                </td>
                              ) : (
                                <>
                                  <td className={`${compareDateCellCn} pl-2 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`${compareDateCellCn} text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`${COMPARE_SYNC_TICK_COL_W} border-r border-border py-0.5 align-top ${rowBg}`}>
                                    <CompareSyncTickStack side="left">{renderLeftCheckbox()}</CompareSyncTickStack>
                                  </td>
                                </>
                              )}
                              {br ? (
                                <>
                                  <td className={`${COMPARE_SYNC_TICK_COL_W} py-0.5 align-top ${rowBg}`}>
                                    <CompareSyncTickStack side="right">{renderRightCheckbox()}</CompareSyncTickStack>
                                  </td>
                                  <td className={`${compareDateCellCn} pl-0 ${rowBg}`}>
                                    {compareRowDateCells.get(br.id)?.bs ?? "—"}
                                  </td>
                                  <td className={`${compareDateCellCn} ${rowBg}`}>
                                    {compareRowDateCells.get(br.id)?.ad ?? "—"}
                                  </td>
                                  <td className={`px-2 py-0.5 font-medium ${rowBg}`}>{br.voucherNumber || "—"}</td>
                                  <td className={`px-2 py-0.5 ${rowBg}`}>{compareRowTypeLabel(br)}</td>
                                  <td className={`px-2 py-0.5 ${rowBg}`}>{compareTargetPartyName}</td>
                                  <td className={`px-2 py-0.5 ${rowBg}`}>{renderSideBStatus(pair)}</td>
                                  <td className={`px-2 py-0.5 text-right text-green-700 ${rowBg}`}>
                                    {formatLedgerAmountCell(br.debit || 0)}
                                  </td>
                                  <td className={`px-2 py-0.5 text-right text-red-600 ${rowBg}`}>
                                    {formatLedgerAmountCell(br.credit || 0)}
                                  </td>
                                </>
                              ) : !compareSideBHasLedger ? (
                                <td colSpan={COMPARE_SIDE_COL_COUNT} className={`px-3 py-3 text-center align-middle text-muted-foreground/90 ${rowBg}`}>
                                  <div className="flex flex-col items-center justify-center gap-2 sm:flex-row sm:justify-start">
                                    <CompareSyncTickStack side="right">{renderRightCheckbox()}</CompareSyncTickStack>
                                    <span className="max-w-[14rem] text-[11px] leading-snug">
                                      Select account above (Side B)
                                    </span>
                                  </div>
                                </td>
                              ) : (
                                <>
                                  <td className={`${COMPARE_SYNC_TICK_COL_W} py-0.5 align-top ${rowBg}`}>
                                    <CompareSyncTickStack side="right">{renderRightCheckbox()}</CompareSyncTickStack>
                                  </td>
                                  <td className={`${compareDateCellCn} pl-0 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`${compareDateCellCn} text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                  <td className={`px-1 py-0.5 text-center text-muted-foreground/80 ${rowBg}`}>{dash}</td>
                                </>
                              )}
                            </tr>
                            <tr
                              data-compare-row="narr"
                              className={`cursor-pointer ${rowBg}`}
                              onClick={() => setActiveComparePairIndex(idx)}
                              onDoubleClick={(e) => onComparePairDoubleClick(e, idx)}
                            >
                              {!r && !compareSideAHasLedger ? (
                                <td
                                  colSpan={COMPARE_SIDE_COL_COUNT}
                                  className={`border-r border-border px-2 pb-0.5 text-center text-[9px] leading-tight text-muted-foreground italic whitespace-normal break-words ${rowBg}`}
                                >
                                  Narration: —
                                </td>
                              ) : (
                                <>
                                  <td
                                    colSpan={COMPARE_SIDE_COL_COUNT - 1}
                                    className={`px-2 pb-0.5 text-[9px] leading-tight text-muted-foreground italic whitespace-normal break-words ${rowBg}`}
                                  >
                                    Narration: {r ? r.narration || "-" : "—"}
                                  </td>
                                  <td className={`${COMPARE_SYNC_TICK_COL_W} border-r border-border py-0 ${rowBg}`} />
                                </>
                              )}
                              {!br && !compareSideBHasLedger ? (
                                <td
                                  colSpan={COMPARE_SIDE_COL_COUNT}
                                  className={`px-2 pb-0.5 text-center text-[9px] leading-tight text-muted-foreground italic whitespace-normal break-words ${rowBg}`}
                                >
                                  Narration: —
                                </td>
                              ) : (
                                <>
                                  <td className={`${COMPARE_SYNC_TICK_COL_W} py-0 ${rowBg}`} />
                                  <td
                                    colSpan={COMPARE_SIDE_COL_COUNT - 1}
                                    className={`px-2 pb-0.5 text-[9px] leading-tight text-muted-foreground italic whitespace-normal break-words ${rowBg}`}
                                  >
                                    Narration: {br ? br.narration || "-" : "—"}
                                  </td>
                                </>
                              )}
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Sync progress — pehle wale dialog ka progress block yahan shift. */}
          {copyingProgress ? (
            <div className="shrink-0 space-y-2 border-t border-slate-300/80 bg-slate-100/90 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/80">
              <p className="text-xs text-muted-foreground">
                Syncing… {copyingProgress.done} / {copyingProgress.total}
                {copyingProgress.currentLabel ? (
                  <span className="ml-1 font-mono text-[11px]">({copyingProgress.currentLabel})</span>
                ) : null}
              </p>
              <Progress
                value={copyingProgress.total > 0 ? (copyingProgress.done / copyingProgress.total) * 100 : 0}
              />
            </div>
          ) : null}

          <DialogFooter className="shrink-0 flex flex-wrap gap-2 border-t border-slate-300/80 bg-slate-100/90 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/80 sm:justify-end">
            <Button type="button" variant="outline" disabled={!!copyingProgress} onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {/* Sirf lists reload — full page navigation nahi, dialog layout stable. */}
            <Button
              type="button"
              variant="outline"
              disabled={!!copyingProgress || compareRefreshing}
              onClick={() => void refreshCompareData()}
            >
              <RotateCw className={`mr-2 h-4 w-4 ${compareRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {/* Left tick → Side B; right tick → Side A; batch (ek hi sync flow). */}
            <Button
              type="button"
              className="bg-orange-500 hover:bg-orange-600 text-white"
              disabled={!!copyingProgress || !canRunUnifiedSync}
              onClick={() => void runUnifiedSync()}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${copyingProgress ? "animate-spin" : ""}`} />
              Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compare subheader pencil: party rename (non-party → toast); master screens se match. */}
      <Dialog
        open={compareLedgerEditSide !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCompareLedgerEditSide(null);
            setCompareLedgerEditName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Rename account</DialogTitle>
          <DialogDescription>
            Party ledger name update — Bank / Staff / Tax etc. apni master screen se karein.
          </DialogDescription>
          <Input
            value={compareLedgerEditName}
            onChange={(e) => setCompareLedgerEditName(e.target.value)}
            placeholder="Account name"
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveCompareLedgerEdit();
              }
            }}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCompareLedgerEditSide(null);
                setCompareLedgerEditName("");
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveCompareLedgerEdit()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Missing refs row popup: mapping section ab yahan alag dialog me dikhta hai. */}
      <Dialog
        open={!!mappingPopup}
        onOpenChange={(open) => {
          if (!open) setMappingPopup(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-auto">
          <DialogTitle>Reference mapping</DialogTitle>
          <DialogDescription>{mappingReferenceDialogDescription}</DialogDescription>
          <div className="space-y-2">
            {mappingPopupSourceIds.length === 0 ? (
              <p className="text-sm text-green-700">No unresolved references in this voucher.</p>
            ) : (
              mappingPopupSourceIds.map((srcId) => (
                <div key={`popup-${srcId}`} className="grid grid-cols-2 gap-2 items-center border rounded p-2">
                  <div className="text-xs rounded border p-2 bg-muted/20">
                    <p className="font-medium">From ledger/account</p>
                    <p>{refLabelForMappingPopup(srcId)}</p>
                  </div>
                  <div className="text-xs rounded border p-2">
                    <p className="font-medium">To ledger/account</p>
                    <Combobox
                      value={manualIdMap[srcId] || ""}
                      onChange={async (val, newName) => {
                        if (val === "add-new") {
                          const name = (newName || refLabelForMappingPopup(srcId)).trim();
                          if (!name || name === "Unmapped source ledger") return;
                          try {
                            const newId = await addMatchingLedgerForSourceId(srcId, name);
                            if (newId) setManualIdMap((prev) => ({ ...prev, [srcId]: newId }));
                          } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e);
                            toast({ variant: "destructive", title: "Cannot add matching account", description: msg });
                          }
                          return;
                        }
                        setManualIdMap((prev) => ({ ...prev, [srcId]: val }));
                      }}
                      options={compareRightLedgerOptions.map((p) => ({ value: p.id, label: p.name }))}
                      placeholder="Add or select target ledger mapping"
                      searchPlaceholder={`Search ${refLabelForMappingPopup(srcId)}`}
                      addNewLabel="Add new matching account"
                      popoverModal={false}
                      autoFocusSearchOnOpen
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {manualIdMap[srcId]
                        ? `Mapped to ${targetPartyNameById.get(manualIdMap[srcId]) || manualIdMap[srcId]}`
                        : "Not mapped yet"}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMappingPopup(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voucher edit mode opened from compare row double-click / Enter */}
      <AddVoucherDialog
        dialogRootModal={false}
        isOpen={isVoucherEditOpen}
        onOpenChange={(open) => {
          setIsVoucherEditOpen(open);
          if (!open) {
            setVoucherForEdit(null);
            setVoucherEditCompanyId(null);
          }
        }}
        editCompanyId={voucherEditCompanyId ?? undefined}
        voucher={voucherForEdit}
        onVoucherAction={() => {
          setIsVoucherEditOpen(false);
          setVoucherForEdit(null);
          setVoucherEditCompanyId(null);
        }}
      />
    </>
  );
}
