"use client";

import { writeBatch, updateDoc, deleteDoc } from "@/lib/writeGateway/pbWrites";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar as CalendarIcon,
  XCircle,
  UploadCloud,
  UserCircle,
  MoreVertical,
  Loader2,
  Trash2,
  Ruler,
  Search,
  Edit,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  CheckSquare,
  Square,
} from "lucide-react";
import type { DateRange } from "@/components/ui/ad-calendar";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { cn } from "@/lib/utils";
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, subDays } from "date-fns";
import { FilePreview, prewarmPdfThumbnailsForGallery } from "@/components/vouchers/FilePreview";
import {
  tryGetStoragePathFromFirebaseDownloadUrl,
  normalizeFirebaseStorageObjectPathForSdk,
} from "@/lib/firebaseStorageDownloadUrl";
import { Combobox } from "@/components/ui/combobox";
import { useDropzone } from "react-dropzone";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { firestore } from "@/lib/firebase";
import { collection, query, where, serverTimestamp, doc, orderBy, arrayRemove, Timestamp } from "@/lib/pbCompat/firestore";
import { onSnapshot, getDoc, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { toast } from "sonner";
import { compressImageForCompany, attachmentImageStillTooLargeToastFields } from "@/lib/attachmentCompressionUi";
import { uploadFileClient, deleteFileFromStorageClient } from "@/lib/storageClient";
import { hardDeleteUnassignedDoc, hardDeleteUnassignedDocsBatch } from "@/lib/unassignedDocHardDelete";
import { checkStorageLimit, incrementCompanyStorage, decrementCompanyStorage } from "@/lib/storageUsageClient";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { openAttachmentInApp } from "@/lib/openAttachmentInApp";
import { getAttachmentFormatLabel, getAttachmentFormatLabelFromHints } from "@/lib/attachmentFormatLabel";
import { isLocalOnlyMode } from "@/lib/localMode";
import { canSyncCompanyToServer } from "@/lib/localVoucherOutbox";
import { getPendingFiles, isLocalFileRef, LOCAL_FILE_PREFIX } from "@/lib/localPendingFiles";
import { usePrewarmVisibleAttachments } from "@/hooks/usePrewarmVisibleAttachments";
import { companyUsesLocalAttachmentSourcesOnly } from "@/lib/staticAttachmentDisplayUrl";
import { FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT } from "@/lib/firebaseLedgerCompanySyncPrefs";
import { setVisiblePageAttachmentUrls } from "@/lib/attachmentNetworkGate";


const ATTACHABLE_VOUCHER_TYPES = [
  { id: 'sale', label: 'Sale' },
  { id: 'purchase', label: 'Purchase' },
  { id: 'payment_in', label: 'Receipt' },
  { id: 'payment_out', label: 'Payment' },
  { id: 'direct_income', label: 'Direct Income' },
  { id: 'direct_expense', label: 'Direct Expense' },
  { id: 'contra', label: 'Contra' },
  { id: 'journal', label: 'Journal' },
  { id: 'add_salary', label: 'Add Salary' },
  { id: 'note', label: 'Note' },
];

const ALL_VOUCHER_TYPES_WITH_ALL = [
    { id: 'all', label: 'All' },
    ...ATTACHABLE_VOUCHER_TYPES,
];


const CATEGORIES = [
    { id: 'party', label: 'Party' },
    { id: 'staff', label: STAFF_ENTITY_LABEL },
    { id: 'bank_cash', label: 'Bank/Cash' },
    { id: 'tax', label: 'Tax' },
    { id: 'items', label: 'Items' },
    { id: 'expense_income', label: 'Expense/Income'},
];

export type FileData = { id: string; url: string; name: string; type: 'pdf' | 'image' | 'other'; path?: string; };

/** Gallery full-hover preview: 600×700px fix (sirf is page par) */
const GALLERY_HOVER_PREVIEW_BOX = { width: 600, height: 700 } as const;

/** Pagination: kitni file tiles ek page par — company + unassigned dono tabs */
const GALLERY_FILES_PER_PAGE_OPTIONS = [20, 30, 40, 50] as const;
const DEFAULT_GALLERY_FILES_PER_PAGE = 20;

function isValidGalleryPageSize(n: number): n is (typeof GALLERY_FILES_PER_PAGE_OPTIONS)[number] {
  return (GALLERY_FILES_PER_PAGE_OPTIONS as readonly number[]).includes(n);
}

/** Company Files: voucher `files[]` + neeche caption ka asli naam / MIME (local: par URL = "FILE") */
function getVoucherAttachmentMeta(
  item: any,
  url: string,
  fileIndex: number,
  companyId?: string
): { storagePath?: string; fileSize?: number; sourceFileName?: string; contentType?: string } {
  // Online→local restore: `url` already `local:` — leftover `storagePath` Firebase disturb na kare.
  if (isLocalFileRef(String(url || "").trim())) {
    const arr = item?.files;
    let fileSize: number | undefined;
    let sourceFileName: string | undefined;
    let contentType: string | undefined;
    if (Array.isArray(arr) && arr.length > 0) {
      const match = arr.find((f: any) => f && (f.url === url || f.downloadUrl === url));
      const at = arr[fileIndex];
      const szRaw = match?.size ?? at?.size;
      fileSize = typeof szRaw === "number" && szRaw > 0 ? szRaw : undefined;
      const nameRaw = match?.name ?? at?.name ?? match?.fileName ?? at?.fileName;
      sourceFileName = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : undefined;
      const ctRaw = match?.contentType ?? at?.contentType ?? match?.mimeType;
      contentType = typeof ctRaw === "string" && ctRaw.includes("/") ? ctRaw.trim() : undefined;
    }
    return { storagePath: undefined, fileSize, sourceFileName, contentType };
  }
  const fromParser = tryGetStoragePathFromFirebaseDownloadUrl(url) ?? undefined;
  // Mirror / SQLite kabhi HTTPS ke bajay encoded tail rakhta hai — `FilePreview` + PDF thumb ke liye SDK path banao.
  const fromBareTail =
    !fromParser && typeof url === "string" && !/^https?:\/\//i.test(url.trim())
      ? normalizeFirebaseStorageObjectPathForSdk(url, { companyId })
      : "";
  const fromNormalized =
    fromBareTail &&
    (/^voucher-files\//i.test(fromBareTail) ||
      /^companies\//i.test(fromBareTail) ||
      /^entity-files\//i.test(fromBareTail))
      ? fromBareTail
      : undefined;
  const arr = item?.files;
  if (Array.isArray(arr) && arr.length > 0) {
    const match = arr.find((f: any) => f && (f.url === url || f.downloadUrl === url));
    const at = arr[fileIndex];
    const spRaw = match?.storagePath ?? at?.storagePath;
    const sp = typeof spRaw === "string" && spRaw.length > 0 ? spRaw : undefined;
    const szRaw = match?.size ?? at?.size;
    const fileSize = typeof szRaw === "number" && szRaw > 0 ? szRaw : undefined;
    const nameRaw = match?.name ?? at?.name ?? match?.fileName ?? at?.fileName;
    const sourceFileName = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : undefined;
    const ctRaw = match?.contentType ?? at?.contentType ?? match?.mimeType;
    const contentType = typeof ctRaw === "string" && ctRaw.includes("/") ? ctRaw.trim() : undefined;
    return { storagePath: sp ?? fromParser ?? fromNormalized, fileSize, sourceFileName, contentType };
  }
  return { storagePath: fromParser ?? fromNormalized, fileSize: undefined, sourceFileName: undefined, contentType: undefined };
}

/** Tile neeche: URL se label; warna IndexedDB pending / voucher naam — JPEG, PDF, … */
function companyGalleryFormatCaption(
  url: string,
  meta: { sourceFileName?: string; contentType?: string },
  pendingByRef: Record<string, string>
): string {
  const urlLbl = getAttachmentFormatLabel(url);
  if (urlLbl !== "FILE") return urlLbl;
  return (
    pendingByRef[url] ||
    getAttachmentFormatLabelFromHints(meta.sourceFileName, meta.contentType) ||
    "FILE"
  );
}

/** Gallery tile click: caption + data: se open kind */
function openKindFromGalleryCaption(caption: string, url: string): "pdf" | "image" | "other" {
  if (caption === "PDF") return "pdf";
  if (
    ["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG", "HEIC", "HEIF"].includes(caption) ||
    String(url).startsWith("data:image/")
  )
    return "image";
  return "other";
}

/** Footer card ke andar, Per page ke niche — chhota pager taaki poora footer patla rahe */
function GalleryPagerInCard({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-0.5 flex w-full flex-col gap-1 border-t border-border/40 pt-1 sm:w-auto sm:items-end">
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[3rem] text-center text-[10px] tabular-nums text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Mobile collapsed ribbon ki height (~20% patla) — grid scroll `pb` isi se match */
const GALLERY_COLLAPSED_RIBBON_SCROLL_PB =
  "pb-[calc(2.6rem+env(safe-area-inset-bottom,0px))]";

/** Footer collapse: poori width ribbon — ← bilkul left, → bilkul right; ↑ + beech me current page; arrow ke paas page counts */
function GalleryCollapsedFooterBar({
  page,
  totalPages,
  onPageChange,
  onExpand,
  expandAriaLabel,
  variant = "company",
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onExpand: () => void;
  expandAriaLabel: string;
  variant?: "company" | "unassigned";
}) {
  const isMobile = useIsMobile();
  const safeTotal = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotal);
  const isCompany = variant === "company";
  // Peeche kitne page, aage kitne page — ribbon ke left/right text (arrow ke just andar)
  const pagesBehind = safePage - 1;
  const pagesAhead = safeTotal - safePage;
  // ~20% chhota ribbon: side buttons 32px, beech 36px (pehle 40/44px)
  const ribbonBtnClass = cn(
    "h-8 w-8 shrink-0 rounded-full border-2 shadow-sm",
    isCompany
      ? "border-blue-400/90 bg-blue-50/95 dark:border-blue-600 dark:bg-blue-950/90"
      : "border-primary/30 bg-background"
  );
  const sideCountClass =
    "max-w-[4rem] shrink truncate text-center text-[10px] font-semibold tabular-nums leading-tight text-muted-foreground sm:max-w-none";
  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full shrink-0 items-center justify-between gap-0.5 border-t-2 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:px-1.5",
        // Mobile: viewport ke bilkul niche chipka ribbon (neeche white gap na rahe)
        isMobile && "fixed bottom-0 left-0 right-0 z-[56] rounded-none",
        isCompany
          ? "border-blue-300/90 bg-blue-100/95 shadow-[0_-4px_12px_-4px_rgba(30,58,138,0.12)] dark:border-blue-800/70 dark:bg-blue-950/45"
          : "border-primary/25 bg-background/95 shadow-[0_-2px_8px_-2px_rgba(0,0,0,0.08)]"
      )}
      aria-label={`Page ${safePage} of ${safeTotal}`}
    >
      {/* Left edge: ← sabse pehle; uske baad peeche kitne page */}
      <div className="flex min-w-0 max-w-[42%] flex-1 items-center justify-start gap-1 sm:max-w-none sm:gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={ribbonBtnClass}
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <span className={sideCountClass} title="Pages before this page (tap ←)">
          {pagesBehind}
        </span>
      </div>

      {/* Beech: expand — upar ↑, neeche current page number */}
      <Button
        type="button"
        variant="outline"
        className={cn(
          "flex h-9 min-w-[2.35rem] shrink-0 flex-col items-center justify-center gap-0 rounded-full border-2 px-2 pb-0.5 pt-0 shadow-md",
          isCompany
            ? "border-blue-400/90 bg-blue-100/95 dark:border-blue-600 dark:bg-blue-950/90"
            : "border-primary/30 bg-background"
        )}
        aria-label={`${expandAriaLabel}. Page ${safePage} of ${safeTotal}`}
        onClick={onExpand}
      >
        <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-xs font-bold leading-none tabular-nums" aria-live="polite">
          {safePage}
        </span>
      </Button>

      {/* Right edge: aage kitne page, phir → sabse last */}
      <div className="flex min-w-0 max-w-[42%] flex-1 items-center justify-end gap-1 sm:max-w-none sm:gap-2">
        <span className={sideCountClass} title="Pages after this page (tap →)">
          {pagesAhead}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={ribbonBtnClass}
          disabled={safePage >= safeTotal}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

// --- Sub-Component: Company Files Tab ---
function CompanyFilesTab({ previewSize, onSizeChange, onEditVoucher }: { previewSize: number, onSizeChange: (size: string | number) => void, onEditVoucher: (voucher: any) => void }) {
  const isMobile = useIsMobile();
  const { vouchers, loading, journalAccountNames, processedParties, processedPartiesForSelection, processedStaff, processedAccounts, processedItems, expenseAccounts, processedTaxes, userNames: vouchersUserNames } = useVouchers();
  const { dateSystem, formatDate, formatDateBS } = useDate();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const today = new Date();
    const thirtyDaysAgo = subDays(today, 30);
    return { from: thirtyDaysAgo, to: today };
  });
  
  const [selectedEntityId, setSelectedEntityId] = useState<string | "all">("all");
  const [selectedVoucherTypes, setSelectedVoucherTypes] = useState<string[]>(['all']);
  const [voucherNumberSearch, setVoucherNumberSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | "all">("all");
  const [selectedAccountType, setSelectedAccountType] = useState<string>("all");
  const [showAvatarsOnly, setShowAvatarsOnly] = useState(false);
  /** Neela footer card: arrow se filters slide up/down — zyada grid dikhe mobile par */
  const [companyFooterExpanded, setCompanyFooterExpanded] = useState(true);
  // Desktop hover: refresh ke baad pehle false jab tak PDF prewarm na ho; phir localStorage (default on)
  const [fullHoverPreview, setFullHoverPreview] = useState(false);
  // Is page ke PDF preload chal raha — is waqt hover preview band + button par spinner
  const [pdfPrewarmLoading, setPdfPrewarmLoading] = useState(false);
  /** Prewarm ke baad grid FilePreview ko cache se dubara mount — PDF raster turant dikhe. */
  const [galleryPdfThumbEpoch, setGalleryPdfThumbEpoch] = useState(0);
  /** Local voucher refs ka JPEG/PDF label — `getAttachmentFormatLabel('local:…')` = FILE */
  const [pendingLocalLabelsByRef, setPendingLocalLabelsByRef] = useState<Record<string, string>>({});
  const fullPreviewBootstrapDoneRef = useRef(false);
  const { companyId, company } = useCompany();
  const [filesTickEpoch, setFilesTickEpoch] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrefs = () => setFilesTickEpoch((n) => n + 1);
    window.addEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, onPrefs);
    return () => window.removeEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, onPrefs);
  }, []);
  // SQLite-first Online companies: Files tick ON → network lazy load (not device-cache-only).
  const localAttachmentsOnly = React.useMemo(
    () => companyUsesLocalAttachmentSourcesOnly(company),
    [company, filesTickEpoch]
  );
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const router = useRouter();
  // Defer Radix Popover/Combobox until client mount to avoid hydration mismatch (aria-controls IDs differ on server vs client).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [companyFilesPerPage, setCompanyFilesPerPage] = useState(DEFAULT_GALLERY_FILES_PER_PAGE);
  const [companyFilesPage, setCompanyFilesPage] = useState(1);

  useEffect(() => {
    try {
      if (localStorage.getItem("galleryCompanyFooterExpanded") === "0") setCompanyFooterExpanded(false);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("galleryCompanyFooterExpanded", companyFooterExpanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [companyFooterExpanded]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("galleryCompanyFilesPerPage");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (isValidGalleryPageSize(n)) setCompanyFilesPerPage(n);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("galleryCompanyFilesPerPage", String(companyFilesPerPage));
    } catch {
      /* ignore */
    }
  }, [companyFilesPerPage]);

  useEffect(() => {
    try {
      localStorage.setItem("galleryCompanyFullHoverPreview", fullHoverPreview ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [fullHoverPreview]);

  useEffect(() => {
    setCompanyFilesPage(1);
  }, [
    selectedEntityId,
    selectedUserId,
    selectedAccountType,
    voucherNumberSearch,
    showAvatarsOnly,
    dateRange?.from?.getTime(),
    dateRange?.to?.getTime(),
    selectedVoucherTypes.join(","),
  ]);

  // Fetch all users (same as Unassigned) so userId resolves by doc id, uid, or userId field.
  useEffect(() => {
    // Local-only mode me user list Firestore stream avoid karo.
    if (isLocalOnlyMode()) return;
    const q = query(collection(firestore, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData: Record<string, string> = {};
      snapshot.forEach((userDoc) => {
        const data = userDoc.data();
        const label = getUserLabelFromDoc(data) || 'Unknown User';
        usersData[userDoc.id] = label;
        const uid = String(data?.uid || data?.userId || "").trim();
        if (uid) usersData[uid] = label;
      });
      setUserNames(usersData);
    });
    return () => unsubscribe();
  }, []);

  // Fallback: for voucher userIds still missing, try uid/userId queries (legacy schemas).
  useEffect(() => {
    // Local-only mode me fallback user lookups skip karo.
    if (isLocalOnlyMode()) return;
    const allUserIds = vouchers.flatMap((t) => [t.userId, (t as any).createdBy, (t as any).createdByUserId, (t as any).changedBy].filter(Boolean) as string[]);
    const missingIds = Array.from(new Set(allUserIds))
      .filter((id) => !userNames[id]);
    if (missingIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolvedMap: Record<string, string> = {};
      for (const uploaderId of missingIds) {
        try {
          const byId = await getDoc(doc(firestore, "users", uploaderId));
          if (byId.exists()) {
            const label = getUserLabelFromDoc(byId.data());
            if (label) { resolvedMap[uploaderId] = label; continue; }
          }
          const byUid = await getDocs(query(collection(firestore, "users"), where("uid", "==", uploaderId)));
          if (!byUid.empty) {
            const label = getUserLabelFromDoc(byUid.docs[0].data());
            if (label) { resolvedMap[uploaderId] = label; continue; }
          }
          const byUserId = await getDocs(query(collection(firestore, "users"), where("userId", "==", uploaderId)));
          if (!byUserId.empty) {
            const label = getUserLabelFromDoc(byUserId.docs[0].data());
            if (label) resolvedMap[uploaderId] = label;
          }
        } catch { /* ignore */ }
      }
      if (!cancelled && Object.keys(resolvedMap).length > 0) {
        setUserNames((prev) => ({ ...prev, ...resolvedMap }));
      }
    })();
    return () => { cancelled = true; };
  }, [vouchers, userNames]);

  useEffect(() => {
    // Offline labels ke liye voucher hook se cached user names merge karo.
    if (vouchersUserNames && Object.keys(vouchersUserNames).length > 0) {
      setUserNames((prev) => ({ ...vouchersUserNames, ...prev }));
    }
  }, [vouchersUserNames]);
  
  // Company users only: owner + shared users (for dropdown filter).
  const companyUserIds = useMemo(() => {
    if (!company) return new Set<string>();
    const ids = [company.ownerId, ...(company.sharedWith || []).map((u: any) => u?.uid).filter(Boolean)];
    return new Set(ids);
  }, [company]);

  // Dedupe by label; show only company users in dropdown (not all signed-up users).
  const userOptions = useMemo(() => {
    const voucherUserIds = new Set(vouchers.flatMap((v) => [v.userId, (v as any).createdBy, (v as any).createdByUserId, (v as any).changedBy].filter(Boolean) as string[]));
    const byLabel = new Map<string, string>();
    for (const [id, name] of Object.entries(userNames)) {
      if (!name || name === 'Unknown User') continue;
      // Include only company users (owner + shared) in dropdown
      if (companyUserIds.size > 0 && !companyUserIds.has(id)) continue;
      const existing = byLabel.get(name);
      if (!existing) {
        byLabel.set(name, id);
      } else if (voucherUserIds.has(id) && !voucherUserIds.has(existing)) {
        byLabel.set(name, id);
      }
    }
    return Array.from(byLabel.entries()).map(([label, value]) => ({ value, label }));
  }, [userNames, vouchers, companyUserIds]);

  const allEntityOptions = useMemo(() => {
    const options = [
      ...processedPartiesForSelection.map((p) => ({ value: `party-${p.id}`, label: p.name, context: 'Party' })),
      ...processedAccounts.map((a) => ({ value: `account-${a.id}`, label: a.accountName, context: 'Bank/Cash' })),
      ...processedStaff.map((s) => ({ value: `staff-${s.id}`, label: s.name, context: 'Staff' })),
      ...processedItems.map((i) => ({ value: `item-${i.id}`, label: i.name, context: 'Item' })),
      ...processedTaxes.map((t) => ({ value: `tax-${t.id}`, label: t.name, context: 'Tax' })),
    ];
    return options.filter(opt => opt.label).sort((a, b) => a.label.localeCompare(b.label));
  }, [processedPartiesForSelection, processedAccounts, processedStaff, processedItems, processedTaxes]);

  const avatarFiles = useMemo(() => {
    const allAvatars: any[] = [];
    processedParties.forEach(p => p.fileUrl && allAvatars.push({ id: `party-${p.id}`, name: p.name, type: 'Party', url: p.fileUrl, date: (p as any).createdAt, userId: (p as any).ownerId }));
    processedStaff.forEach(s => s.fileUrl && allAvatars.push({ id: `staff-${s.id}`, name: s.name, type: 'Staff', url: s.fileUrl, date: (s as any).createdAt, userId: (s as any).ownerId }));
    processedAccounts.forEach(a => a.fileUrl && allAvatars.push({ id: `account-${a.id}`, name: a.accountName, type: 'Bank/Cash', url: a.fileUrl, date: (a as any).createdAt, userId: (a as any).ownerId }));
    return allAvatars;
  }, [processedParties, processedStaff, processedAccounts]);

  const displayItems = useMemo(() => {
      let itemsToFilter = showAvatarsOnly ? avatarFiles.map(a => ({...a, fileUrls: [a.url], voucherNumber: a.name, type: a.type, isAvatar: true })) : vouchers.filter(v => Array.isArray(v.fileUrls) && v.fileUrls.length > 0);

      // Apply common filters
      if (selectedUserId !== 'all') {
        itemsToFilter = itemsToFilter.filter(item => {
          const uid = item.userId || (item as any).createdBy || (item as any).createdByUserId || (item as any).changedBy;
          return uid === selectedUserId;
        });
      }
      if (voucherNumberSearch.trim()) {
        const q = voucherNumberSearch.trim().toLowerCase().replace(/[\s\-]/g, "");
        itemsToFilter = itemsToFilter.filter((item) => {
          const nos = [item.voucherNumber, item.voucherNumberIn, item.voucherNumberOut, (item as any).voucher_number];
          return nos.some((n) => n != null && String(n).toLowerCase().replace(/[\s\-]/g, "").includes(q));
        });
      }
       if (dateRange?.from && !voucherNumberSearch.trim()) {
        const fromDate = startOfDay(dateRange.from);
        const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(fromDate);
        itemsToFilter = itemsToFilter.filter(item => {
            const itemDate = item.date?.toDate ? item.date.toDate() : new Date();
            return itemDate >= fromDate && itemDate <= toDate;
        });
      }
      if (selectedVoucherTypes.length > 0 && !selectedVoucherTypes.includes('all')) {
        itemsToFilter = itemsToFilter.filter(item => {
            const typeToCheck = item.type === 'journal' && item.subType === 'add_salary' ? 'add_salary' : item.type;
            return selectedVoucherTypes.includes(typeToCheck);
        });
      }
       if (selectedEntityId !== 'all') {
        const [type, actualId] = selectedEntityId.split('-');
        itemsToFilter = itemsToFilter.filter(item => {
            if (showAvatarsOnly) {
                return item.id === selectedEntityId.replace(`${type}-`, '');
            } else {
                if (type === 'party') return item.partyId === actualId;
                if (type === 'staff') return item.staffId === actualId || (Array.isArray(item.entries) && item.entries.some((e: any) => e.accountId === actualId));
                if (type === 'account') return item.accountId === actualId || item.fromAccountId === actualId || item.toAccountId === actualId || (Array.isArray(item.entries) && item.entries.some((e: any) => e.accountId === actualId));
                if (type === 'item') return Array.isArray(item.lineItems) && item.lineItems.some((li: any) => li.itemId === actualId);
                if (type === 'tax') return item.taxAccountId === actualId || (Array.isArray(item.lineItems) && item.lineItems.some((li:any) => li.taxAccountId === actualId)) || (Array.isArray(item.entries) && item.entries.some((e: any) => e.accountId === actualId));
            }
            return false;
        });
      }
      if (selectedAccountType !== 'all') {
        itemsToFilter = itemsToFilter.filter(item => {
            if (showAvatarsOnly) {
                const typeMap: Record<string, string> = { 
                    'party': 'Party', 'staff': STAFF_ENTITY_LABEL, 'bank_cash': 'Bank/Cash', 
                    'tax': 'Tax', 'items': 'Item', 'expense_income': 'Expense/Income'
                };
                return item.type === typeMap[selectedAccountType];
            } else {
                if (selectedAccountType === 'party') return !!item.partyId;
                if (selectedAccountType === 'staff') return !!item.staffId || (Array.isArray(item.entries) && item.entries.some((e: any) => processedStaff.some(s => s.id === e.accountId)));
                if (selectedAccountType === 'bank_cash') return !!item.accountId || !!item.fromAccountId || !!item.toAccountId;
                if (selectedAccountType === 'items') return item.lineItems?.length > 0;
                if (selectedAccountType === 'tax') return !!item.taxAccountId;
                return true;
            }
        });
    }

      return itemsToFilter.sort((a,b) => (b.date?.toDate ? b.date.toDate().getTime() : 0) - (a.date?.toDate ? a.date.toDate().getTime() : 0));
    }, [showAvatarsOnly, avatarFiles, vouchers, selectedUserId, voucherNumberSearch, dateRange, selectedVoucherTypes, selectedEntityId, selectedAccountType]);


  const allFilesCount = useMemo(() => {
    return vouchers.reduce((acc, v) => acc + (v.fileUrls?.length || 0), 0);
  }, [vouchers]);

  const filteredFilesCount = useMemo(() => {
    return displayItems.reduce((acc, v) => acc + (v.fileUrls?.length || 0), 0);
  }, [displayItems]);

  // Har tile ek row — pagination flat list (voucher × fileUrls)
  const companyFlatRows = useMemo(() => {
    const rows: { item: (typeof displayItems)[number]; url: string; fileIndex: number }[] = [];
    for (const item of displayItems) {
      const urls = item.fileUrls || [];
      for (let fileIndex = 0; fileIndex < urls.length; fileIndex++) {
        rows.push({ item, url: urls[fileIndex], fileIndex });
      }
    }
    return rows;
  }, [displayItems]);

  const companyTotalPages = Math.max(1, Math.ceil(companyFlatRows.length / companyFilesPerPage));
  const companyPageClamped = Math.min(Math.max(1, companyFilesPage), companyTotalPages);
  const companySliceStart = (companyPageClamped - 1) * companyFilesPerPage;
  const paginatedCompanyRows = useMemo(
    () => companyFlatRows.slice(companySliceStart, companySliceStart + companyFilesPerPage),
    [companyFlatRows, companySliceStart, companyFilesPerPage]
  );

  const paginatedCompanyUrls = useMemo(
    () => paginatedCompanyRows.map(({ url }) => String(url || "").trim()).filter(Boolean),
    [paginatedCompanyRows]
  );
  // Web Files-tick lazy gate: current Gallery page URLs network-eligible.
  useEffect(() => {
    if (!companyId) return;
    setVisiblePageAttachmentUrls(companyId, paginatedCompanyUrls);
  }, [companyId, paginatedCompanyUrls, filesTickEpoch, localAttachmentsOnly]);
  // Page flip: warm current tiles (incl. PL-server `local:`) before/while FilePreview mounts.
  usePrewarmVisibleAttachments(paginatedCompanyUrls, companyId);

  useEffect(() => {
    if (companyFilesPage !== companyPageClamped) setCompanyFilesPage(companyPageClamped);
  }, [companyFilesPage, companyPageClamped]);

  // Har page par PDF prewarm: pehli baar khatam hone par full preview localStorage se on (default on); har bar loading dikhana
  const companyPdfPrewarmKey = useMemo(
    () => paginatedCompanyRows.map(({ url }) => url).join("\0"),
    [paginatedCompanyRows]
  );
  const hasPdfToPrewarmOnPage = useMemo(
    () =>
      paginatedCompanyRows.some(({ item, url, fileIndex }) => {
        const u = String(url);
        if (
          u.startsWith("data:application/pdf") ||
          getAttachmentFormatLabel(u) === "PDF" ||
          u.split("?")[0].toLowerCase().endsWith(".pdf")
        ) {
          return true;
        }
        // `local:uuid` — URL pe .pdf nahi; voucher meta / pending label se PDF detect.
        const meta = getVoucherAttachmentMeta(item, url, fileIndex, companyId);
        if (getAttachmentFormatLabelFromHints(meta.sourceFileName, meta.contentType) === "PDF") {
          return true;
        }
        return pendingLocalLabelsByRef[u] === "PDF";
      }),
    [paginatedCompanyRows, companyId, pendingLocalLabelsByRef]
  );

  const companyLocalRefsKey = useMemo(
    () =>
      [...new Set(paginatedCompanyRows.filter(({ url }) => isLocalFileRef(String(url))).map(({ url }) => String(url)))].sort().join("\0"),
    [paginatedCompanyRows]
  );
  useEffect(() => {
    let cancelled = false;
    if (!companyLocalRefsKey) {
      setPendingLocalLabelsByRef({});
      return;
    }
    void (async () => {
      try {
        const rows = await getPendingFiles();
        const map: Record<string, string> = {};
        for (const p of rows) {
          const ref = `${LOCAL_FILE_PREFIX}${p.id}`;
          const lbl =
            getAttachmentFormatLabelFromHints(p.fileName, p.contentType) ||
            getAttachmentFormatLabelFromHints(null, p.blob?.type ?? null);
          if (lbl) map[ref] = lbl;
        }
        if (!cancelled) setPendingLocalLabelsByRef(map);
      } catch {
        if (!cancelled) setPendingLocalLabelsByRef({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyLocalRefsKey]);

  useEffect(() => {
    if (!mounted) return;
    if (!hasPdfToPrewarmOnPage) {
      return;
    }
    const ac = new AbortController();
    const entries = paginatedCompanyRows.map(({ item, url, fileIndex }) => {
      const meta = getVoucherAttachmentMeta(item, url, fileIndex, companyId);
      return { url, storagePath: meta.storagePath };
    });

    void (async () => {
      setPdfPrewarmLoading(true);
      try {
        await prewarmPdfThumbnailsForGallery(entries, ac.signal, localAttachmentsOnly, {
          companyId,
        });
      } finally {
        setPdfPrewarmLoading(false);
        setGalleryPdfThumbEpoch((n) => n + 1);
        if (ac.signal.aborted) return;
        // Sirf pehli dafa (refresh): prewarm ke baad hi full preview on/off localStorage se
        if (!fullPreviewBootstrapDoneRef.current) {
          fullPreviewBootstrapDoneRef.current = true;
          try {
            const v = localStorage.getItem("galleryCompanyFullHoverPreview");
            setFullHoverPreview(v !== "0");
          } catch {
            setFullHoverPreview(true);
          }
        }
      }
    })();

    return () => ac.abort();
  }, [mounted, companyPdfPrewarmKey, hasPdfToPrewarmOnPage, companyId, localAttachmentsOnly]);

 const getAccountNameFromVoucher = (voucher: any) => {
    if (voucher.isAvatar) return voucher.name;
    if (voucher.type === 'journal' && voucher.subType === 'add_salary') {
        const staffEntries = (voucher.entries || []).filter((e: any) =>
            processedStaff.some(s => s.id === e.accountId)
        );
        if (staffEntries.length > 0) {
            return staffEntries.map((e: any) => journalAccountNames[e.accountId] || e.accountId).join(', ');
        }
    }
    if (voucher.type === 'journal') {
        const debits = (voucher.entries || []).filter((e: any) => e.debit > 0).map((e: any) => `Dr: ${journalAccountNames[e.accountId] || e.accountId}`);
        const credits = (voucher.entries || []).filter((e: any) => e.credit > 0).map((e: any) => `Cr: ${journalAccountNames[e.accountId] || e.accountId}`);
        if(debits.length > 0 || credits.length > 0) return [...debits, ...credits].join(' | ');
    }
    if (voucher.type === 'contra') {
        const from = journalAccountNames[voucher.fromAccountId] || voucher.fromAccountId;
        const to = journalAccountNames[voucher.toAccountId] || voucher.toAccountId;
        return `${from} ➔ ${to}`;
    }
    const relevantId = voucher.partyId || voucher.staffId || voucher.accountId || voucher.entityId || voucher.incomeAccountId || voucher.expenseAccountId;
    return journalAccountNames[relevantId] || voucher.voucherNumber;
};
  
  const handleClearFilters = () => {
      setSelectedEntityId('all');
      setSelectedVoucherTypes(['all']);
      setVoucherNumberSearch('');
      setDateRange(undefined);
      setSelectedUserId('all');
      setSelectedAccountType('all');
      setShowAvatarsOnly(false);
  };

  // Pehli baar jo default 30-day range load hoti hai usse match = "no filter"; tabhi Clear All chhupa rahein
  const baselineDateRangeRef = useRef<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (baselineDateRangeRef.current === null && dateRange?.from && dateRange?.to) {
      baselineDateRangeRef.current = { from: dateRange.from.getTime(), to: dateRange.to.getTime() };
    }
  }, [dateRange]);
  const isDateRangeDeviated =
    dateRange?.from != null &&
    dateRange?.to != null &&
    baselineDateRangeRef.current != null &&
    (dateRange.from.getTime() !== baselineDateRangeRef.current.from ||
      dateRange.to.getTime() !== baselineDateRangeRef.current.to);

  const hasFiltersApplied =
    selectedAccountType !== "all" ||
    selectedEntityId !== "all" ||
    selectedUserId !== "all" ||
    showAvatarsOnly ||
    voucherNumberSearch.trim() !== "" ||
    selectedVoucherTypes.length !== 1 ||
    selectedVoucherTypes[0] !== "all" ||
    isDateRangeDeviated;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", isMobile && "w-full")}>
      {/* Sirf file grid yahan scroll — header/tab neeche wale footer card me fixed */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain",
          isMobile && "px-0.5",
          isMobile && !companyFooterExpanded && GALLERY_COLLAPSED_RIBBON_SCROLL_PB
        )}
      >
        <TooltipProvider delayDuration={100}>
        <div
          className="grid gap-x-8 gap-y-12 pb-4"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${previewSize}px, 1fr))` }}
        >
        {paginatedCompanyRows.map(({ item, url, fileIndex: index }) => {
              const attachMeta = getVoucherAttachmentMeta(item, url, index, companyId);
              const formatCaption = companyGalleryFormatCaption(url, attachMeta, pendingLocalLabelsByRef);
              const cleanFileName = getCleanName(
                attachMeta.sourceFileName || url.split("/").pop()?.split("?")[0] || ""
              );
              const voucherDate = item.date?.toDate ? item.date.toDate() : new Date();
              const effectiveUserId = item.userId || (item as any).createdBy || (item as any).createdByUserId || (item as any).changedBy;
              const userName = (effectiveUserId && userNames[effectiveUserId]) || 'Unknown User';
              const accountName = getAccountNameFromVoucher(item);
              
              const displayDate = () => {
                if (!voucherDate) return '-';
                if (dateSystem === 'AD') return formatDate(voucherDate);
                if (dateSystem === 'BS') return formatDateBS(voucherDate);
                return `${formatDate(voucherDate)} (${formatDateBS(voucherDate)})`;
              };

              const tileEl = (
                       <div className="relative group w-full flex flex-col gap-2 no-underline">
                         <div
                            className="relative w-full aspect-square border-2 border-transparent group-hover:border-primary group-hover:shadow-lg transition-all rounded-lg overflow-hidden bg-muted/30 cursor-pointer"
                            style={{ width: `${previewSize}px`, height: `${previewSize}px` }}
                            onClick={() => {
                              void openAttachmentInApp(url, {
                                title: cleanFileName,
                                kind: openKindFromGalleryCaption(formatCaption, url),
                                serverFallback:
                                  companyId && item?.id
                                    ? {
                                        companyId,
                                        voucherId: String(item.id),
                                        clientFileUrls: item.fileUrls,
                                      }
                                    : undefined,
                              });
                            }}
                         >
                            {/* Unassigned jaisa: storagePath + size — online getBlob / offline sniff same pipeline */}
                            <FilePreview
                              key={`cf-${item.id}-${index}-e${galleryPdfThumbEpoch}`}
                              file={url}
                              size={Number(previewSize)}
                              storagePath={attachMeta.storagePath}
                              fileSize={attachMeta.fileSize}
                              sourceFileName={attachMeta.sourceFileName}
                              contentType={attachMeta.contentType}
                              attachmentCompanyId={companyId}
                              attachmentClientFileUrls={item.fileUrls}
                              forceLocalAttachmentOnly={localAttachmentsOnly}
                              stableLocalPreviewOnly
                              enableHoverFullPreview={false}
                              holdAttachmentClipboard={false}
                            />
                            {!item.isAvatar && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    className={cn(
                                      "absolute top-1 right-1 h-7 w-7 bg-background/80 backdrop-blur-sm",
                                      isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                    )}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-64 p-0" onClick={(e) => e.stopPropagation()}>
                                  <div className="p-3 space-y-2 border-b">
                                    <p className="text-xs"><span className="font-semibold">Voucher No:</span> {item.voucherNumber}</p>
                                    <p className="text-xs max-w-xs truncate"><span className="font-semibold">Account:</span> {accountName}</p>
                                    <p className="text-xs"><span className="font-semibold">Date:</span> {displayDate()}</p>
                                    <p className="text-xs"><span className="font-semibold">Time:</span> {format(voucherDate, "h:mm a")}</p>
                                    <p className="text-xs"><span className="font-semibold">By:</span> {userName}</p>
                                  </div>
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEditVoucher(item); }}>
                                    <Edit className="h-3 w-3 mr-2" /> Edit Voucher
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                         </div>
                         <p className="text-[10px] text-center truncate px-2 text-muted-foreground">
                            {cleanFileName}
                         </p>
                         <p className="text-[9px] text-center font-semibold uppercase tracking-wide text-muted-foreground">
                            {formatCaption}
                         </p>
                      </div>
              );

              // Keep stable Tooltip wrapper — swapping div↔Tooltip on pdfPrewarmLoading
              // remounts every FilePreview and aborts in-flight PL thumb fetches (blank next page).
              const hoverPreviewActive = fullHoverPreview && !pdfPrewarmLoading;
              if (isMobile) {
                return (
                  <div key={`${item.id}-${index}`}>
                    {tileEl}
                  </div>
                );
              }

              return (
                <Tooltip key={`${item.id}-${index}`} open={hoverPreviewActive ? undefined : false}>
                    <TooltipTrigger asChild>
                      {tileEl}
                    </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        align="center"
                        sideOffset={10}
                        collisionPadding={12}
                        avoidCollisions
                        className={cn(
                          // Transaction / voucher hover preview jaisa: mota neela border + 15mm round + shadow (`AttachmentHoverPortal`)
                          "z-[9999] max-h-[calc(100dvh-10px)] max-w-[min(calc(100vw-20px),96vw)] overflow-x-hidden overflow-y-auto p-0 text-popover-foreground",
                          "rounded-[15mm] border-[3px] border-blue-600 bg-white shadow-2xl dark:bg-zinc-950"
                        )}
                      >
                        {/* flip: right ↔ left; andar preview 600×700 fix */}
                        <div className="flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[15mm]">
                          <div className="flex shrink-0 items-center justify-center border-b border-blue-600/25 px-2 py-1.5">
                            <span className="text-xs font-medium text-muted-foreground">Preview</span>
                          </div>
                          <div
                            className="flex shrink-0 items-center justify-center overflow-auto border-b border-blue-600/25 bg-white p-2 dark:bg-zinc-950"
                            style={{ width: GALLERY_HOVER_PREVIEW_BOX.width, height: GALLERY_HOVER_PREVIEW_BOX.height }}
                          >
                            {(() => {
                              // Tile jaisa: signed URL `<img>` offline WebView me fail — `FilePreview` IndexedDB / blob path
                              return (
                                <FilePreview
                                  key={`cf-hover-${item.id}-${index}-e${galleryPdfThumbEpoch}`}
                                  file={url}
                                  storagePath={attachMeta.storagePath}
                                  fileSize={attachMeta.fileSize}
                                  sourceFileName={attachMeta.sourceFileName}
                                  contentType={attachMeta.contentType}
                                  attachmentCompanyId={companyId}
                                  attachmentClientFileUrls={item.fileUrls}
                                  forceLocalAttachmentOnly={localAttachmentsOnly}
                                  stableLocalPreviewOnly
                                  size={700}
                                  previewBox={GALLERY_HOVER_PREVIEW_BOX}
                                  objectFit="contain"
                                  enableHoverFullPreview={false}
                                  showFormatBadge={false}
                                  holdAttachmentClipboard={false}
                                />
                              );
                            })()}
                          </div>
                          <p className="border-b border-blue-600/25 bg-white px-2 py-1 text-center text-[10px] font-bold text-muted-foreground dark:bg-zinc-950">
                            {formatCaption}
                          </p>
                          <div className="space-y-1 bg-white p-2 text-center text-xs dark:bg-zinc-950">
                            <p><span className="font-semibold">Voucher No:</span> {item.voucherNumber}</p>
                            <p className="mx-auto max-w-[min(100%,20rem)] break-words">
                              <span className="font-semibold">Account:</span> {accountName}
                            </p>
                            <p><span className="font-semibold">Date:</span> {displayDate()}</p>
                            <p><span className="font-semibold">Time:</span> {format(voucherDate, "h:mm a")}</p>
                            <p><span className="font-semibold">By:</span> {userName}</p>
                          </div>
                          {!item.isAvatar && (
                            <div className="flex justify-center border-t border-blue-600/25 bg-white p-2 dark:bg-zinc-950">
                              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onEditVoucher(item)}>
                                <Edit className="mr-1 h-3 w-3" /> Edit Voucher
                              </Button>
                            </div>
                          )}
                        </div>
                      </TooltipContent>
                </Tooltip>
              );
        })}
        </div>
        </TooltipProvider>
      </div>

      {companyFooterExpanded ? (
      <Card
        className={cn(
          // Halka neela footer + clear card border (charon taraf)
          "shrink-0 rounded-b-none border-2 border-blue-300/90 bg-blue-100/90 shadow-[0_-4px_12px_-4px_rgba(30,58,138,0.12)] sm:rounded-b-lg dark:border-blue-800/70 dark:bg-blue-950/45",
          isMobile && "w-full"
        )}
      >
        <CardHeader
          className={cn(
            // Default CardHeader p-6 hatake ~40% kam vertical: p-3 + chhota gap
            "flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 !p-3 bg-transparent sm:gap-2",
            isMobile && "flex-col items-stretch gap-2 px-0.5"
          )}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-1.5">
              {/* Poora panel band: sirf niche center arrow up dikhega — yahan ChevronDown = hide */}
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mt-0.5 h-8 w-8 shrink-0 border-blue-400/70 bg-background/90 dark:border-blue-600/70"
                aria-expanded
                aria-label="Hide gallery panel"
                onClick={() => setCompanyFooterExpanded(false)}
              >
                <ChevronDown className="h-4 w-4" aria-hidden />
              </Button>
              <div className="min-w-0">
              <CardTitle className="text-base font-semibold leading-tight">
                {showAvatarsOnly ? "Account Avatars" : "Company File Gallery"}
              </CardTitle>
              <CardDescription className="text-[11px] leading-snug">
                {showAvatarsOnly ? "Profile pictures for parties, staff, etc." : "All transaction documents."}
              </CardDescription>
              </div>
              {!showAvatarsOnly && (
                <div className="relative w-28 shrink-0 sm:w-32">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    value={voucherNumberSearch}
                    onChange={(e) => setVoucherNumberSearch(e.target.value)}
                    placeholder="Voucher no…"
                    className="h-8 border-blue-300/70 bg-background/95 pl-8 text-xs dark:border-blue-700/60"
                    aria-label="Search by voucher number"
                  />
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-start sm:gap-2">
              <Badge
                variant="secondary"
                className="max-w-[min(100%,280px)] px-2 py-0 text-center text-[10px] sm:max-w-none sm:text-right"
              >
                {companyFlatRows.length === 0
                  ? `Showing 0 of ${allFilesCount} files`
                  : `Showing ${companySliceStart + 1}–${Math.min(companySliceStart + companyFilesPerPage, companyFlatRows.length)} of ${filteredFilesCount} files (${allFilesCount} in company)`}
              </Badge>
              {/* Per page ke niche page prev/next — same card */}
              <div className="flex flex-col items-end gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">Per page</span>
                  {/* Radix Select SSR par random aria-controls; mount ke baad hi render = hydration mismatch avoid */}
                  {mounted ? (
                    <Select
                      value={String(companyFilesPerPage)}
                      onValueChange={(v) => {
                        setCompanyFilesPerPage(Number(v));
                        setCompanyFilesPage(1);
                      }}
                    >
                      <SelectTrigger className="h-9 w-[76px] text-xs" aria-label="Files per page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GALLERY_FILES_PER_PAGE_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Skeleton className="h-9 w-[76px] rounded-md" />
                  )}
                </div>
                <GalleryPagerInCard
                  page={companyPageClamped}
                  totalPages={companyTotalPages}
                  onPageChange={setCompanyFilesPage}
                />
              </div>
            </div>
          </div>
          <div className={cn("flex flex-wrap items-center gap-1.5", isMobile && "flex min-w-0 w-full flex-row flex-nowrap gap-1.5")}>
            <div className={cn("flex h-9 shrink-0 items-center gap-0.5 rounded-md border bg-background", isMobile ? "w-16 px-1" : "px-2")}>
              {!isMobile && <Ruler className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <Input
                type="text"
                value={previewSize}
                onChange={(e) => onSizeChange(e.target.value.replace(/[^0-9]/g, ""))}
                className={cn("h-9 border-0 p-0 text-xs focus-visible:ring-0", isMobile ? "w-9 text-center" : "w-20")}
                placeholder="Size"
              />
              <span className="shrink-0 text-xs text-muted-foreground">px</span>
            </div>
            <Button
              variant={showAvatarsOnly ? "secondary" : "outline"}
              onClick={() => setShowAvatarsOnly(!showAvatarsOnly)}
              className={cn("h-9 shrink-0 px-2.5 text-xs", isMobile && "shrink-0")}
            >
              {!isMobile && <UserCircle className="mr-1.5 h-3.5 w-3.5" />}
              Avatars
            </Button>
            {mounted &&
              (isMobile ? (
                <div className="min-w-0 flex-1 overflow-hidden">
                  <BsDatePicker
                    valueAD={dateRange}
                    onChangeAD={setDateRange as any}
                    className="h-9 min-h-9 w-full min-w-0 px-2 text-xs"
                  />
                </div>
              ) : (
                <BsDatePicker valueAD={dateRange} onChangeAD={setDateRange as any} className="h-9 min-h-9 px-2 text-xs" />
              ))}
            {!mounted && <Skeleton className="h-9 w-[180px] shrink-0 rounded-md" />}
          </div>
        </CardHeader>
        <CardContent className={cn("bg-transparent px-3 pb-2.5 pt-0", isMobile && "px-0.5")}>
          <div
            className={cn(
              isMobile ? "flex flex-row flex-wrap items-center gap-1.5" : "grid grid-cols-2 items-center gap-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-7"
            )}
          >
            {mounted ? (
              <>
                <div className={cn(isMobile && "min-w-[100px] flex-1")}>
                  <Combobox
                    options={[{ id: "all", label: "All Accounts" }, ...CATEGORIES].map((c) => ({ value: c.id, label: c.label }))}
                    value={selectedAccountType}
                    onChange={setSelectedAccountType}
                    placeholder="Account Type"
                    triggerClassName="h-9 text-xs"
                  />
                </div>
                <div className={cn(isMobile && "min-w-[100px] flex-1")}>
                  <Combobox
                    options={allEntityOptions}
                    value={selectedEntityId}
                    onChange={setSelectedEntityId}
                    placeholder="Search Account..."
                    triggerClassName="h-9 text-xs"
                  />
                </div>
                <div className={cn(isMobile && "min-w-[100px] flex-1")}>
                  <Combobox
                    options={[{ value: "all", label: "All Users" }, ...userOptions]}
                    value={selectedUserId}
                    onChange={setSelectedUserId}
                    placeholder="Filter by user"
                    triggerClassName="h-9 text-xs"
                  />
                </div>
                <Button
                  type="button"
                  variant={fullHoverPreview ? "secondary" : "outline"}
                  className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-xs", isMobile && "min-w-[100px] flex-1")}
                  disabled={pdfPrewarmLoading}
                  onClick={() => setFullHoverPreview((v) => !v)}
                  aria-pressed={fullHoverPreview}
                  aria-busy={pdfPrewarmLoading}
                  title={
                    pdfPrewarmLoading
                      ? "PDF preview load ho raha hai…"
                      : fullHoverPreview
                        ? "Hover preview on"
                        : "Hover preview off"
                  }
                >
                  {pdfPrewarmLoading ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                  ) : fullHoverPreview ? (
                    <Eye className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 shrink-0" />
                  )}
                  Full preview
                </Button>
                {hasFiltersApplied && (
                  <Button
                    variant="ghost"
                    onClick={handleClearFilters}
                    size={isMobile ? "icon" : "sm"}
                    className={cn(
                      "h-9 border border-dashed border-blue-400/70 px-2.5 text-xs dark:border-blue-600/70",
                      isMobile && "w-9 shrink-0 p-0"
                    )}
                    title={isMobile ? "Clear filters" : undefined}
                  >
                    <XCircle className={cn("h-3.5 w-3.5", !isMobile && "mr-1.5")} />
                    {!isMobile && "Clear All"}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Skeleton className="h-9 min-w-[100px] flex-1 rounded-md" />
                <Skeleton className="h-9 min-w-[100px] flex-1 rounded-md" />
                <Skeleton className="h-9 min-w-[100px] flex-1 rounded-md" />
              </>
            )}
          </div>
        </CardContent>
      </Card>
      ) : (
        <GalleryCollapsedFooterBar
          page={companyPageClamped}
          totalPages={companyTotalPages}
          onPageChange={setCompanyFilesPage}
          onExpand={() => setCompanyFooterExpanded(true)}
          expandAriaLabel="Show gallery panel"
          variant="company"
        />
      )}
    </div>
  );
}

// --- Type for Unassigned File ---
type UnassignedFile = {
    id: string;
    name: string;
    url: string;
    path: string;
    type: 'image' | 'pdf' | 'other';
    size: number;
    uploadedAt: Timestamp;
    uploadedBy: string;
    status: 'FREE' | 'LOCKED' | 'ASSIGNED';
    isDeleted?: boolean;
    deleted?: boolean;
}

type UploadingFile = {
  id: string; // Use a temporary unique ID
  name: string;
  size: number;
};

const LOCAL_UNASSIGNED_DOCS_KEY = "local_unassigned_documents_v1";

function createLocalEntityId(prefix: string): string {
  // Local-only mode me stable client-side IDs use karo taaki CRUD consistent rahe.
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function getUploadedAtDate(input: any): Date {
  // Firestore Timestamp, ISO string, epoch number sabko Date me normalize karo.
  if (!input) return new Date();
  if (typeof input?.toDate === "function") return input.toDate();
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  if (typeof input === "string") return new Date(input);
  if (typeof input?.seconds === "number") return new Date(input.seconds * 1000);
  return new Date();
}

function readLocalUnassignedDocs(): UnassignedFile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_UNASSIGNED_DOCS_KEY);
    const parsed = raw ? (JSON.parse(raw) as UnassignedFile[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalUnassignedDocs(value: UnassignedFile[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_UNASSIGNED_DOCS_KEY, JSON.stringify(value));
  } catch {
    // Local cache write failure ignore; UI still keeps runtime state.
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  // Offline preview/open support ke liye local unassigned docs me data URL store karo.
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Convert an email to the text after '@' for compact fallback labels.
function getEmailSuffixLabel(value?: string): string | null {
  if (!value || !value.includes("@")) return null;
  const parts = value.split("@");
  const suffix = parts[1]?.trim();
  return suffix ? suffix : null;
}

// Build a user label with preference: displayName -> email suffix -> email.
function getUserLabelFromDoc(data: any): string | null {
  const displayName = String(data?.displayName || data?.name || "").trim();
  if (displayName) return displayName;
  const email = String(data?.email || "").trim();
  return getEmailSuffixLabel(email) || (email || null);
}

/** Firestore + Storage paths: cloud mirror companies use authoritative id when present. */
function firestoreCompanyIdForGallery(
  companyId: string,
  company: { authoritativeCompanyId?: string } | null | undefined
): string {
  return String(company?.authoritativeCompanyId || companyId).trim() || companyId;
}

// --- Sub-Component: Unassigned Documents Tab ---
function UnassignedDocumentsTab({ handleAttachToVoucher, previewSize, onSizeChange }: { handleAttachToVoucher: any; previewSize: number; onSizeChange: any; }) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const [filesTickEpoch, setFilesTickEpoch] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrefs = () => setFilesTickEpoch((n) => n + 1);
    window.addEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, onPrefs);
    return () => window.removeEventListener(FIREBASE_LEDGER_COMPANY_SYNC_PREFS_CHANGED_EVENT, onPrefs);
  }, []);
  const localAttachmentsOnly = React.useMemo(
    () => companyUsesLocalAttachmentSourcesOnly(company),
    [company, filesTickEpoch]
  );
  // Company users only: owner + shared (for user filter dropdown)
  const companyUserIds = useMemo(() => {
    if (!company) return new Set<string>();
    return new Set([company.ownerId, ...(company.sharedWith || []).map((u: any) => u?.uid).filter(Boolean)]);
  }, [company]);
  const { dateSystem, formatDate, formatDateBS } = useDate();
  // Render popover-driven controls only after mount to avoid Radix SSR/client id mismatch during hydration.
  const [isHydrated, setIsHydrated] = useState(false);
  const [unassignedFiles, setUnassignedFiles] = useState<UnassignedFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [fileToDelete, setFileToDelete] = useState<UnassignedFile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [fileToRename, setFileToRename] = useState<UnassignedFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [selectedUploaderId, setSelectedUploaderId] = useState<string | "all">("all");
  const [unassignedFilesPerPage, setUnassignedFilesPerPage] = useState(DEFAULT_GALLERY_FILES_PER_PAGE);
  const [unassignedFilesPage, setUnassignedFilesPage] = useState(1);
  /** Footer filters row hide — company tab jaisa chevron */
  const [unassignedFooterExpanded, setUnassignedFooterExpanded] = useState(true);
  /** Company Files jaisa: hover par bada preview on/off; dono tabs same localStorage key share karte hain */
  const [fullHoverPreview, setFullHoverPreview] = useState(false);
  const [pdfPrewarmLoading, setPdfPrewarmLoading] = useState(false);
  /** Prewarm ke baad grid FilePreview ko cache se dubara mount — PDF raster turant dikhe. */
  const [galleryPdfThumbEpoch, setGalleryPdfThumbEpoch] = useState(0);
  const fullPreviewBootstrapDoneRef = useRef(false);
  /** Menu item select ke baad Radix portal hataane par jo click neeche tile par lagta hai — wahan `openAttachmentInApp` se khali `_blank` tab bachti hai */
  const suppressTileOpenUntilPerfRef = useRef(0);

  useEffect(() => {
    try {
      if (localStorage.getItem("galleryUnassignedFooterExpanded") === "0") setUnassignedFooterExpanded(false);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("galleryUnassignedFooterExpanded", unassignedFooterExpanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [unassignedFooterExpanded]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("galleryUnassignedFilesPerPage");
      const n = raw ? parseInt(raw, 10) : NaN;
      if (isValidGalleryPageSize(n)) setUnassignedFilesPerPage(n);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("galleryUnassignedFilesPerPage", String(unassignedFilesPerPage));
    } catch {
      /* ignore */
    }
  }, [unassignedFilesPerPage]);

  useEffect(() => {
    try {
      localStorage.setItem("galleryCompanyFullHoverPreview", fullHoverPreview ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [fullHoverPreview]);

  useEffect(() => {
    setUnassignedFilesPage(1);
  }, [selectedUploaderId, dateRange?.from?.getTime(), dateRange?.to?.getTime()]);

  useEffect(() => {
    // Mark mounted on client so popover ids are generated only client-side for these controls.
    setIsHydrated(true);
  }, []);

  /**
   * Pure offline company: unassigned list is device-localStorage only.
   * Local-first APK + company that syncs to Firestore: same subcollection + Storage as web — multi-device.
   */
  const [unassignedUseDeviceLocalOnly, setUnassignedUseDeviceLocalOnly] = useState<boolean | null>(null);

  useEffect(() => {
    if (!companyId) {
      setUnassignedUseDeviceLocalOnly(null);
      return;
    }
    if (!isLocalOnlyMode()) {
      setUnassignedUseDeviceLocalOnly(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const deviceOnly = !(await canSyncCompanyToServer(companyId));
      if (!cancelled) setUnassignedUseDeviceLocalOnly(deviceOnly);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);
  
  // Fetch unassigned files
  useEffect(() => {
    if (!companyId || unassignedUseDeviceLocalOnly === null) return;
    if (unassignedUseDeviceLocalOnly) {
      setUnassignedFiles(readLocalUnassignedDocs());
      return;
    }
    const fsId = firestoreCompanyIdForGallery(companyId, company);
    const q = query(collection(firestore, `companies/${fsId}/unassigned_documents`), orderBy('uploadedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const filesData = snapshot.docs
          .map(d => ({id: d.id, ...d.data()}) as UnassignedFile)
          .filter(f => !f.isDeleted && !f.deleted && (f.status as any) !== 'ASSIGNED');
        setUnassignedFiles(filesData);
    });
    return () => unsubscribe();
  }, [companyId, company, unassignedUseDeviceLocalOnly]);

  // Fetch users separately to avoid re-fetching files when a user is added
  useEffect(() => {
    if (unassignedUseDeviceLocalOnly !== false) return;
    const q = query(collection(firestore, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const usersData: Record<string, string> = {};
        snapshot.forEach((userDoc) => {
            // Store mapping by both doc id and uid/userId fields so uploadedBy can resolve in all id formats.
            const data = userDoc.data();
            const label = getUserLabelFromDoc(data) || "Unknown User";
            usersData[userDoc.id] = label;
            const uid = String(data?.uid || data?.userId || "").trim();
            if (uid) usersData[uid] = label;
        });
        setUserNames(usersData);
    });
    return () => unsubscribe();
  }, [unassignedUseDeviceLocalOnly]);

  useEffect(() => {
    if (unassignedUseDeviceLocalOnly !== false) return;
    // Fallback resolver: for any still-missing uploader id, fetch displayName directly from users collection.
    const missingUploaderIds = Array.from(new Set(unassignedFiles.map((f) => f.uploadedBy).filter(Boolean)))
      .filter((id) => !userNames[id]);
    if (missingUploaderIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolvedMap: Record<string, string> = {};
      for (const uploaderId of missingUploaderIds) {
        try {
          // Try direct doc id first (users/{uploadedBy}).
          const byId = await getDoc(doc(firestore, "users", uploaderId));
          if (byId.exists()) {
            const label = getUserLabelFromDoc(byId.data());
            if (label) {
              resolvedMap[uploaderId] = label;
              continue;
            }
          }
          // Then try users.uid == uploadedBy.
          const byUid = await getDocs(query(collection(firestore, "users"), where("uid", "==", uploaderId)));
          if (!byUid.empty) {
            const label = getUserLabelFromDoc(byUid.docs[0].data());
            if (label) {
              resolvedMap[uploaderId] = label;
              continue;
            }
          }
          // Last fallback: users.userId == uploadedBy (legacy schemas).
          const byUserId = await getDocs(query(collection(firestore, "users"), where("userId", "==", uploaderId)));
          if (!byUserId.empty) {
            const label = getUserLabelFromDoc(byUserId.docs[0].data());
            if (label) resolvedMap[uploaderId] = label;
          }
        } catch {
          // Intentionally ignore per-id failures; UI fallback handles unresolved labels.
        }
      }
      if (!cancelled && Object.keys(resolvedMap).length > 0) {
        setUserNames((prev) => ({ ...prev, ...resolvedMap }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unassignedFiles, userNames, unassignedUseDeviceLocalOnly]);
  
  const uploaderOptions = useMemo(() => {
    const uniqueNamesMap = new Map();
    unassignedFiles.forEach(file => {
      // Include only company users (owner + shared) in dropdown
      if (companyUserIds.size > 0 && !companyUserIds.has(file.uploadedBy)) return;
      // Fallback priority: resolved name -> email suffix (text after '@') -> unknown.
      const resolved = userNames[file.uploadedBy];
      const uploaderName = resolved && resolved !== "Unknown"
        ? (getEmailSuffixLabel(resolved) || resolved)
        : (getEmailSuffixLabel(file.uploadedBy) || "Unknown User");
      if (uploaderName && !Array.from(uniqueNamesMap.values()).some((obj: any) => obj.label === uploaderName)) {
        uniqueNamesMap.set(file.uploadedBy, { value: file.uploadedBy, label: uploaderName });
      }
    });
    return Array.from(uniqueNamesMap.values());
  }, [unassignedFiles, userNames, companyUserIds]);

  const onDrop = useCallback(async (acceptedFiles: File[], rejectedFiles?: any[]) => {
    if (!companyId || !user) {
      toast.error("Cannot upload", { description: "Please select a company and ensure you are signed in." });
      return;
    }
    if (!acceptedFiles?.length) {
      if (rejectedFiles?.length) {
        toast.error("Invalid files", { description: "Some files could not be accepted. Try images or PDFs." });
      }
      return;
    }

    const newUploadingFiles: UploadingFile[] = acceptedFiles.map(file => ({
      id: `${file.name}-${file.size}-${Math.random()}`,
      name: file.name,
      size: file.size,
    }));
    setUploadingFiles(prev => [...prev, ...newUploadingFiles]);

    let compressedFiles: File[] = [];
    let storeUnassignedOnDeviceOnly = false;
    try {
      compressedFiles = await Promise.all(
        acceptedFiles.map(async (f) => {
          const r = await compressImageForCompany(f, companyId);
          return r.file;
        })
      );
      const fsIdForLimits = firestoreCompanyIdForGallery(companyId, company);
      storeUnassignedOnDeviceOnly =
        isLocalOnlyMode() && !(await canSyncCompanyToServer(companyId));
      if (!storeUnassignedOnDeviceOnly) {
        const totalNewBytes = compressedFiles.reduce((sum, c) => sum + c.size, 0);
        const limitCheck = await checkStorageLimit(fsIdForLimits, company?.planId, {
          attachmentsBytes: totalNewBytes,
          storageBytes: totalNewBytes,
        }, company?.storageOption);
        if (!limitCheck.allowed) {
          toast.error("Storage limit reached", { description: limitCheck.message });
          setUploadingFiles(prev => prev.filter(p => !newUploadingFiles.some(n => n.id === p.id)));
          return;
        }
      }
    } catch (e) {
      setUploadingFiles(prev => prev.filter(p => !newUploadingFiles.some(n => n.id === p.id)));
      toast.error("Upload failed", { description: "Could not process files. Please try again." });
      return;
    }

    if (storeUnassignedOnDeviceOnly) {
      // Sirf asli offline-only company: data URL + localStorage (dusre device par nahi dikhega).
      const toAppend: UnassignedFile[] = [];
      await Promise.all(
        compressedFiles.map(async (compressedFile, idx) => {
          try {
            const url = await fileToDataUrl(compressedFile);
            toAppend.push({
              id: createLocalEntityId("unassigned"),
              name: compressedFile.name,
              url,
              path: "",
              type: compressedFile.type.startsWith("image/") ? "image" : compressedFile.type.includes("pdf") ? "pdf" : "other",
              size: compressedFile.size,
              uploadedAt: new Date().toISOString() as unknown as Timestamp,
              uploadedBy: user.uid,
              status: "FREE",
            });
          } finally {
            const uploadingFile = newUploadingFiles[idx];
            if (uploadingFile) {
              setUploadingFiles((prev) => prev.filter((f) => f.id !== uploadingFile.id));
            }
          }
        })
      );
      const nextDocs = [...toAppend, ...readLocalUnassignedDocs()].sort(
        (a, b) => getUploadedAtDate(b.uploadedAt).getTime() - getUploadedAtDate(a.uploadedAt).getTime()
      );
      writeLocalUnassignedDocs(nextDocs);
      setUnassignedFiles(nextDocs);
      toast.success("Upload complete", { description: `${toAppend.length} file(s) saved locally.` });
      return;
    }

    const fsId = firestoreCompanyIdForGallery(companyId, company);
    const batch = writeBatch(firestore);
    let batchOperationsCount = 0;

    await Promise.all(newUploadingFiles.map(async (uploadingFile) => {
      const idx = acceptedFiles.findIndex(f => f.name === uploadingFile.name && f.size === uploadingFile.size);
      const compressedFile = idx >= 0 ? compressedFiles[idx] : null;
      if (!compressedFile) return;
      try {
        const uploadResult = await uploadFileClient(
          { name: compressedFile.name, type: compressedFile.type, arrayBuffer: await compressedFile.arrayBuffer() },
          fsId,
          company?.name,
          new Date()
        );
        if (uploadResult.success) {
          await incrementCompanyStorage(fsId, {
            attachmentsBytes: compressedFile.size,
            storageBytes: compressedFile.size,
          });
          const docRef = doc(collection(firestore, `companies/${fsId}/unassigned_documents`));
          batch.set(docRef, {
            url: uploadResult.url, path: uploadResult.path, name: compressedFile.name,
            type: compressedFile.type.startsWith("image/") ? 'image' : 'pdf',
            size: compressedFile.size, uploadedAt: serverTimestamp(), uploadedBy: user.uid, status: 'FREE'
          });
          batchOperationsCount++;
        } else {
          toast.error(`Upload failed: ${uploadingFile.name}`, { description: (uploadResult as any).error || "Upload failed." });
        }
      } catch (error) {
        const message = error instanceof Error && error.message?.includes("fetch")
          ? "Check your internet connection and try again."
          : "Something went wrong. Please try again.";
        toast.error(`Upload failed: ${uploadingFile.name}`, { description: message });
        console.error("Upload failed for file:", uploadingFile.name, error);
      } finally {
        setUploadingFiles(prev => prev.filter(f => f.id !== uploadingFile.id));
      }
    }));

    if (batchOperationsCount > 0) {
      await batch.commit();
      const failedCount = newUploadingFiles.length - batchOperationsCount;
      if (failedCount > 0) {
        toast.success(`${batchOperationsCount} file(s) uploaded.`, { description: `${failedCount} file(s) failed.` });
      } else {
        toast.success("Upload complete", { description: `${batchOperationsCount} file(s) uploaded.` });
      }
    } else if (newUploadingFiles.length > 0) {
      toast.error("Upload failed", { description: "Could not upload files. Check your connection and try again." });
    }
  }, [companyId, user, company]);
  
  const { getRootProps, getInputProps } = useDropzone({ onDrop });
  
  useEffect(() => {
    if (fileToRename) setRenameValue(getCleanName(fileToRename.name));
    else setRenameValue("");
  }, [fileToRename]);

  const handleRenameFile = async () => {
    if (!fileToRename || !companyId || !renameValue.trim()) return;
    const newName = renameValue.trim();
    if (newName === getCleanName(fileToRename.name)) {
      setFileToRename(null);
      return;
    }
    setIsRenaming(true);
    try {
      const deviceOnly =
        isLocalOnlyMode() && !(await canSyncCompanyToServer(companyId));
      if (deviceOnly) {
        const next = readLocalUnassignedDocs().map((f) =>
          f.id === fileToRename.id ? { ...f, name: newName } : f
        );
        writeLocalUnassignedDocs(next);
        setUnassignedFiles(next);
        toast.success("File renamed successfully");
        setFileToRename(null);
        return;
      }
      const fsId = firestoreCompanyIdForGallery(companyId, company);
      await updateDoc(doc(firestore, `companies/${fsId}/unassigned_documents`, fileToRename.id), { name: newName });
      toast.success("File renamed successfully");
      setFileToRename(null);
    } catch (error) {
      console.error("Error renaming file:", error);
      toast.error("Failed to rename file");
    } finally {
      setIsRenaming(false);
    }
  };

  const toggleSelectFile = useCallback((fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  const handleDeleteFile = async () => {
    // `AlertDialogAction` closes the dialog on click (`onOpenChange` -> setFileToDelete(null)),
    // so keep the target in local state for the whole async delete.
    const target = fileToDelete;
    if (!target || !companyId) return;
    setIsDeleting(true);
    try {
        const deviceOnly =
          isLocalOnlyMode() && !(await canSyncCompanyToServer(companyId));
        if (deviceOnly) {
          const next = readLocalUnassignedDocs().filter((f) => f.id !== target.id);
          writeLocalUnassignedDocs(next);
          setUnassignedFiles(next);
          setSelectedFileIds((prev) => {
            const copy = new Set(prev);
            copy.delete(target.id);
            return copy;
          });
          toast.success("File deleted successfully");
          return;
        }

        const deleted = await hardDeleteUnassignedDoc(companyId, target, company);
        if (!deleted) {
          toast.error("Failed to delete file", {
            description: "The file could not be removed from the server. Refresh and try again.",
          });
          return;
        }

        const fsId = firestoreCompanyIdForGallery(companyId, company);
        if (target.size) {
          await decrementCompanyStorage(fsId, {
            attachmentsBytes: target.size,
            storageBytes: target.size,
          }).catch(() => {});
        }

        setUnassignedFiles((prev) => prev.filter((f) => f.id !== target.id));
        setSelectedFileIds((prev) => {
          const copy = new Set(prev);
          copy.delete(target.id);
          return copy;
        });
        toast.success("File deleted permanently");
    } catch (error) {
        console.error("Error deleting file:", error);
        toast.error("Failed to delete file");
    } finally {
        setIsDeleting(false);
        setFileToDelete(null);
    }
  };

  const filteredFiles = useMemo(() => {
    let filtered = [...unassignedFiles];
    
    if (selectedUploaderId !== 'all') {
      filtered = filtered.filter(f => f.uploadedBy === selectedUploaderId);
    }
    if (dateRange?.from) {
        const fromDate = startOfDay(dateRange.from);
        const toDate = dateRange.to ? endOfDay(dateRange.to) : endOfDay(fromDate);
        filtered = filtered.filter(f => {
            if (!f.uploadedAt) return false;
            const uploadedAt = getUploadedAtDate(f.uploadedAt);
            return uploadedAt >= fromDate && uploadedAt <= toDate;
        });
    }
    return filtered;
  }, [unassignedFiles, selectedUploaderId, dateRange]);

  const unassignedTotalPages = Math.max(1, Math.ceil(filteredFiles.length / unassignedFilesPerPage));
  const unassignedPageClamped = Math.min(Math.max(1, unassignedFilesPage), unassignedTotalPages);
  const unassignedSliceStart = (unassignedPageClamped - 1) * unassignedFilesPerPage;
  const paginatedUnassignedFiles = useMemo(
    () => filteredFiles.slice(unassignedSliceStart, unassignedSliceStart + unassignedFilesPerPage),
    [filteredFiles, unassignedSliceStart, unassignedFilesPerPage]
  );

  const handleSelectAll = useCallback(() => {
    if (filteredFiles.length === 0) return;
    setSelectedFileIds((prev) => {
      const allFilteredSelected = filteredFiles.every((f) => prev.has(f.id));
      if (allFilteredSelected) {
        // Deselect all
        return new Set();
      } else {
        // Select all filtered
        return new Set(filteredFiles.map((f) => f.id));
      }
    });
  }, [filteredFiles]);

  const handleBatchDelete = async () => {
    if (selectedFileIds.size === 0 || !companyId) return;
    setIsBatchDeleting(true);
    const toDeleteDocs = unassignedFiles.filter((f) => selectedFileIds.has(f.id));
    try {
      const deviceOnly =
        isLocalOnlyMode() && !(await canSyncCompanyToServer(companyId));
      if (deviceOnly) {
        const next = readLocalUnassignedDocs().filter((f) => !selectedFileIds.has(f.id));
        writeLocalUnassignedDocs(next);
        setUnassignedFiles(next);
        setSelectedFileIds(new Set());
        toast.success(`${toDeleteDocs.length} file(s) deleted successfully`);
        return;
      }

      const { successCount, failCount } = await hardDeleteUnassignedDocsBatch(
        companyId,
        toDeleteDocs,
        company
      );

      const fsId = firestoreCompanyIdForGallery(companyId, company);
      const totalBytes = toDeleteDocs.reduce((acc, f) => acc + (f.size || 0), 0);
      if (totalBytes > 0) {
        await decrementCompanyStorage(fsId, {
          attachmentsBytes: totalBytes,
          storageBytes: totalBytes,
        }).catch(() => {});
      }

      setUnassignedFiles((prev) => prev.filter((f) => !selectedFileIds.has(f.id)));
      setSelectedFileIds(new Set());

      if (failCount > 0) {
        toast.warning(`Deleted ${successCount} file(s), ${failCount} failed`);
      } else {
        toast.success(`${successCount} file(s) permanently deleted`);
      }
    } catch (error) {
      console.error("Batch delete error:", error);
      toast.error("Failed to delete selected files");
    } finally {
      setIsBatchDeleting(false);
      setBatchDeleteOpen(false);
    }
  };

  const unassignedPdfPrewarmKey = useMemo(
    () => paginatedUnassignedFiles.map((f) => f.url).join("\0"),
    [paginatedUnassignedFiles]
  );
  const paginatedUnassignedUrls = useMemo(
    () => paginatedUnassignedFiles.map((f) => String(f.url || "").trim()).filter(Boolean),
    [paginatedUnassignedFiles]
  );
  useEffect(() => {
    setVisiblePageAttachmentUrls(companyId, paginatedUnassignedUrls);
  }, [companyId, paginatedUnassignedUrls, filesTickEpoch, localAttachmentsOnly]);
  const hasPdfToPrewarmUnassignedPage = useMemo(
    () =>
      paginatedUnassignedFiles.some((f) => {
        const u = String(f.url);
        // Local company: `data:application/pdf`; Firestore doc me `type: "pdf"` bhi
        return (
          u.startsWith("data:application/pdf") ||
          getAttachmentFormatLabel(u) === "PDF" ||
          f.type === "pdf" ||
          u.split("?")[0].toLowerCase().endsWith(".pdf")
        );
      }),
    [paginatedUnassignedFiles]
  );

  useEffect(() => {
    if (!isHydrated) return;
    if (!hasPdfToPrewarmUnassignedPage) {
      return;
    }
    const ac = new AbortController();
    const entries = paginatedUnassignedFiles.map((f) => ({
      url: f.url,
      storagePath: f.path || tryGetStoragePathFromFirebaseDownloadUrl(f.url) || undefined,
    }));
    void (async () => {
      setPdfPrewarmLoading(true);
      try {
        await prewarmPdfThumbnailsForGallery(entries, ac.signal, localAttachmentsOnly, {
          companyId,
        });
      } finally {
        setPdfPrewarmLoading(false);
        setGalleryPdfThumbEpoch((n) => n + 1);
        if (ac.signal.aborted) return;
        if (!fullPreviewBootstrapDoneRef.current) {
          fullPreviewBootstrapDoneRef.current = true;
          try {
            const v = localStorage.getItem("galleryCompanyFullHoverPreview");
            setFullHoverPreview(v !== "0");
          } catch {
            setFullHoverPreview(true);
          }
        }
      }
    })();
    return () => ac.abort();
  }, [isHydrated, unassignedPdfPrewarmKey, hasPdfToPrewarmUnassignedPage, localAttachmentsOnly, companyId]);

  useEffect(() => {
    if (unassignedFilesPage !== unassignedPageClamped) setUnassignedFilesPage(unassignedPageClamped);
  }, [unassignedFilesPage, unassignedPageClamped]);

  const formatBytes = (bytes: number, decimals = 2) => {
    if (!bytes || bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Upload + tiles scroll; filters/title footer me fix (company tab jaisa) */}
      <div
        className={cn(
          "min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain",
          isMobile && !unassignedFooterExpanded ? GALLERY_COLLAPSED_RIBBON_SCROLL_PB : "pb-2"
        )}
      >
        <div
          {...getRootProps()}
          className="cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors hover:bg-slate-50"
        >
          <input {...getInputProps()} />
          <UploadCloud className="mx-auto h-10 w-10 text-slate-400" />
          <p className="mt-2 text-sm text-slate-500">Drag or click to upload</p>
        </div>

        <TooltipProvider delayDuration={100}>
        <div className="grid gap-x-8 gap-y-12" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${previewSize}px, 1fr))` }}>
            {uploadingFiles.map((file) => (
              <div key={file.id} className="relative w-full flex flex-col gap-2">
                  <div className="relative w-full aspect-square rounded-lg bg-muted/30 flex items-center justify-center" style={{ width: `${previewSize}px`, height: `${previewSize}px` }}>
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin" />
                        <span className="text-xs">Uploading...</span>
                      </div>
                  </div>
                  <p className="text-[10px] text-center truncate px-2 text-muted-foreground">{file.name}</p>
              </div>
            ))}
            {paginatedUnassignedFiles.map((file) => {
              const uploadDate = getUploadedAtDate(file.uploadedAt);
              const resolved = userNames[file.uploadedBy];
              const uploaderName = resolved && resolved !== "Unknown"
                ? (getEmailSuffixLabel(resolved) || resolved)
                : (getEmailSuffixLabel(file.uploadedBy) || "Unknown User");
              const cleanFileName = getCleanName(file.name);

              const displayDate = () => {
                if (dateSystem === 'AD') return formatDate(uploadDate);
                if (dateSystem === 'BS') return formatDateBS(uploadDate);
                return `${formatDate(uploadDate)} (${formatDateBS(uploadDate)})`;
              };

              const markDropdownMenuAction = () => {
                if (typeof performance !== "undefined") {
                  suppressTileOpenUntilPerfRef.current = performance.now() + 550;
                }
              };

              const openAtt = () => {
                if (typeof performance !== "undefined" && performance.now() < suppressTileOpenUntilPerfRef.current) {
                  return;
                }
                const fmt = getAttachmentFormatLabel(file.url);
                const kind: "pdf" | "image" | "other" =
                  fmt === "PDF"
                    ? "pdf"
                    : ["JPG", "JPEG", "PNG", "GIF", "WEBP", "BMP", "SVG"].includes(fmt) ||
                        String(file.url).startsWith("data:image/")
                      ? "image"
                      : "other";
                void openAttachmentInApp(file.url, { title: cleanFileName, kind });
              };

              const isSelected = selectedFileIds.has(file.id);

              const tileEl = (
                <div className="relative group w-full flex flex-col gap-2">
                  <div
                    className={cn(
                      "relative w-full aspect-square border-2 transition-all rounded-lg overflow-hidden bg-muted/30 cursor-pointer",
                      isSelected
                        ? "border-primary ring-2 ring-primary/40 shadow-md"
                        : "border-transparent group-hover:border-primary group-hover:shadow-lg"
                    )}
                    style={{ width: `${previewSize}px`, height: `${previewSize}px` }}
                    onClick={openAtt}
                  >
                    <FilePreview
                      key={`ua-${file.id}-e${galleryPdfThumbEpoch}`}
                      file={file.url}
                      size={Number(previewSize)}
                      fileSize={file.size}
                      storagePath={isLocalFileRef(String(file.url || "")) ? undefined : file.path}
                      forceLocalAttachmentOnly={localAttachmentsOnly}
                      stableLocalPreviewOnly
                      enableHoverFullPreview={false}
                      holdAttachmentClipboard={false}
                    />
                    <div
                      className={cn(
                        "absolute top-1.5 left-1.5 z-20 flex items-center justify-center rounded bg-white/90 dark:bg-zinc-900/90 p-0.5 shadow-sm transition-opacity",
                        isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectFile(file.id);
                      }}
                      title={isSelected ? "Deselect" : "Select"}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="h-4 w-4 rounded border-gray-300 text-primary cursor-pointer accent-primary"
                        aria-label={`Select ${cleanFileName}`}
                      />
                    </div>
                    <div className="absolute top-1 left-8 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-7 w-7 shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFileToDelete(file);
                        }}
                        title="Delete file"
                      >
                        <Trash2 className="h-4 w-4"/>
                      </Button>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="absolute top-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 z-20" onClick={(e) => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4"/>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem
                          onSelect={() => {
                            markDropdownMenuAction();
                            setFileToRename(file);
                          }}
                        >
                          <Edit className="h-3.5 w-3.5 mr-2" /> Rename
                        </DropdownMenuItem>
                        {ATTACHABLE_VOUCHER_TYPES.map((type) => (
                          <DropdownMenuItem
                            key={type.id}
                            onSelect={() => {
                              markDropdownMenuAction();
                              handleAttachToVoucher(type.id, file);
                            }}
                          >
                            Attach to {type.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="text-[10px] text-center truncate px-2 text-muted-foreground">{cleanFileName}</p>
                  <p className="text-[9px] text-center font-semibold uppercase tracking-wide text-muted-foreground">
                    {getAttachmentFormatLabel(file.url)}
                  </p>
                </div>
              );

              const hoverPreviewActive = fullHoverPreview && !pdfPrewarmLoading;
              if (isMobile || !hoverPreviewActive) {
                return (
                  <div key={file.id}>
                    {tileEl}
                  </div>
                );
              }

              return (
                <Tooltip key={file.id}>
                  <TooltipTrigger asChild>
                    {tileEl}
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    align="center"
                    sideOffset={10}
                    collisionPadding={12}
                    avoidCollisions
                    className={cn(
                      // Company Files tab jaisa — voucher AttachmentHoverPortal frame
                      "z-[9999] max-h-[calc(100dvh-10px)] max-w-[min(calc(100vw-20px),96vw)] overflow-x-hidden overflow-y-auto p-0 text-popover-foreground",
                      "rounded-[15mm] border-[3px] border-blue-600 bg-white shadow-2xl dark:bg-zinc-950"
                    )}
                  >
                    <div className="flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[15mm]">
                      <div className="flex shrink-0 items-center justify-center border-b border-blue-600/25 px-2 py-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Preview</span>
                      </div>
                      <div
                        className="flex shrink-0 items-center justify-center overflow-auto border-b border-blue-600/25 bg-white p-2 dark:bg-zinc-950"
                        style={{ width: GALLERY_HOVER_PREVIEW_BOX.width, height: GALLERY_HOVER_PREVIEW_BOX.height }}
                      >
                        {(() => (
                          <FilePreview
                            key={`ua-hover-${file.id}-e${galleryPdfThumbEpoch}`}
                            file={file.url}
                            storagePath={isLocalFileRef(String(file.url || "")) ? undefined : file.path}
                            forceLocalAttachmentOnly={localAttachmentsOnly}
                            stableLocalPreviewOnly
                            size={700}
                            previewBox={GALLERY_HOVER_PREVIEW_BOX}
                            objectFit="contain"
                            enableHoverFullPreview={false}
                            showFormatBadge={false}
                            fileSize={file.size}
                            holdAttachmentClipboard={false}
                          />
                        ))()}
                      </div>
                      <p className="border-b border-blue-600/25 bg-white px-2 py-1 text-center text-[10px] font-bold text-muted-foreground dark:bg-zinc-950">
                        {getAttachmentFormatLabel(file.url)}
                      </p>
                      <div className="space-y-1 bg-white p-2 text-center text-xs dark:bg-zinc-950">
                        <p className="break-words">
                          <span className="font-semibold">File:</span> {cleanFileName}
                        </p>
                        {file.size ? (
                          <p>
                            <span className="font-semibold">Size:</span> {formatBytes(file.size)}
                          </p>
                        ) : null}
                        <p><span className="font-semibold">Date:</span> {displayDate()}</p>
                        <p><span className="font-semibold">Time:</span> {format(uploadDate, "h:mm a")}</p>
                        <p><span className="font-semibold">By:</span> {uploaderName}</p>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
        </div>
        </TooltipProvider>
      </div>

      {unassignedFooterExpanded ? (
      <Card className="shrink-0 rounded-b-none border-b-0 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)] sm:rounded-b-lg sm:border-b">
        <CardHeader className="space-y-0 !p-3 pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="mt-0.5 h-8 w-8 shrink-0"
                aria-expanded
                aria-label="Hide unassigned panel"
                onClick={() => setUnassignedFooterExpanded(false)}
              >
                <ChevronDown className="h-4 w-4" aria-hidden />
              </Button>
              <div className="min-w-0">
              <CardTitle className="text-base font-bold leading-tight">Unassigned Documents</CardTitle>
              <CardDescription className="text-[11px] leading-snug">
                Drag or click to upload. Attach them to vouchers later.
              </CardDescription>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-start sm:gap-2">
              <Badge
                variant="secondary"
                className="max-w-[min(100%,280px)] px-2 py-0 text-center text-[10px] sm:max-w-none sm:text-right"
              >
                {filteredFiles.length === 0
                  ? `Showing 0 of ${unassignedFiles.length} files`
                  : `Showing ${unassignedSliceStart + 1}–${Math.min(unassignedSliceStart + unassignedFilesPerPage, filteredFiles.length)} of ${filteredFiles.length} files (${unassignedFiles.length} total)`}
              </Badge>
              <div className="flex flex-col items-end gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">Per page</span>
                  {isHydrated ? (
                    <Select
                      value={String(unassignedFilesPerPage)}
                      onValueChange={(v) => {
                        setUnassignedFilesPerPage(Number(v));
                        setUnassignedFilesPage(1);
                      }}
                    >
                      <SelectTrigger className="h-9 w-[76px] text-xs" aria-label="Files per page">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GALLERY_FILES_PER_PAGE_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Skeleton className="h-9 w-[76px] rounded-md" />
                  )}
                </div>
                <GalleryPagerInCard
                  page={unassignedPageClamped}
                  totalPages={unassignedTotalPages}
                  onPageChange={setUnassignedFilesPage}
                />
              </div>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
            <div className="flex-shrink-0">
              {isHydrated ? (
                <BsDatePicker
                  valueAD={dateRange}
                  onChangeAD={setDateRange as any}
                  className="h-9 min-h-9 px-2 text-xs"
                />
              ) : (
                <Button type="button" variant="outline" className="h-9 w-[190px] justify-start text-xs text-muted-foreground" disabled>
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  Pick a date range
                </Button>
              )}
            </div>

            <div className="min-w-[200px] max-w-[300px] flex-1">
              {isHydrated ? (
                <Combobox
                  options={[{ value: "all", label: "All Users" }, ...uploaderOptions]}
                  value={selectedUploaderId}
                  onChange={setSelectedUploaderId}
                  placeholder="Filter by user"
                  triggerClassName="h-9 text-xs"
                />
              ) : (
                <Button type="button" variant="outline" className="h-9 w-full justify-start text-xs text-muted-foreground" disabled>
                  Filter by user
                </Button>
              )}
            </div>

            <Button
              variant="ghost"
              onClick={() => {
                setDateRange(undefined);
                setSelectedUploaderId("all");
              }}
              className="h-9 px-2.5 text-xs hover:text-destructive"
            >
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              Clear
            </Button>

            {isHydrated ? (
              <Button
                type="button"
                variant={fullHoverPreview ? "secondary" : "outline"}
                className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-xs", isMobile && "min-w-[100px] flex-1")}
                disabled={pdfPrewarmLoading}
                onClick={() => setFullHoverPreview((v) => !v)}
                aria-pressed={fullHoverPreview}
                aria-busy={pdfPrewarmLoading}
                title={
                  pdfPrewarmLoading
                    ? "PDF preview load ho raha hai…"
                    : fullHoverPreview
                      ? "Hover preview on"
                      : "Hover preview off"
                }
              >
                {pdfPrewarmLoading ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                ) : fullHoverPreview ? (
                  <Eye className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 shrink-0" />
                )}
                Full preview
              </Button>
            ) : (
              <Skeleton className="h-9 w-[100px] shrink-0 rounded-md" />
            )}

            {filteredFiles.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                className="h-9 px-2.5 text-xs font-medium"
              >
                {selectedFileIds.size > 0 && selectedFileIds.size === filteredFiles.length ? (
                  <>
                    <CheckSquare className="mr-1.5 h-3.5 w-3.5 text-primary" />
                    Deselect All
                  </>
                ) : (
                  <>
                    <Square className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                    Select All
                  </>
                )}
              </Button>
            )}

            {selectedFileIds.size > 0 && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setBatchDeleteOpen(true)}
                className="h-9 px-3 text-xs font-semibold shadow-sm animate-in fade-in"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete Selected ({selectedFileIds.size})
              </Button>
            )}

            <div className="ml-auto flex h-9 items-center gap-2 rounded-md border-2 border-primary/20 bg-background px-2 shadow-sm">
              <Ruler className="h-3.5 w-3.5 text-primary" />
              <div className="flex items-center">
                <Input
                  type="text"
                  value={previewSize}
                  onChange={(e) => onSizeChange(e.target.value.replace(/[^0-9]/g, ""))}
                  className="h-9 w-14 border-0 p-0 text-center text-xs font-bold focus-visible:ring-0"
                />
                <span className="ml-0.5 text-[11px] font-bold text-muted-foreground">px</span>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>
      ) : (
        <GalleryCollapsedFooterBar
          page={unassignedPageClamped}
          totalPages={unassignedTotalPages}
          onPageChange={setUnassignedFilesPage}
          onExpand={() => setUnassignedFooterExpanded(true)}
          expandAriaLabel="Show unassigned panel"
          variant="unassigned"
        />
      )}

        <AlertDialog open={!!fileToDelete} onOpenChange={(open) => !open && setFileToDelete(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will permanently delete the file <span className="font-bold">{fileToDelete?.name}</span>. This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteFile} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
                        {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4"/>}
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={batchDeleteOpen} onOpenChange={(open) => !isBatchDeleting && setBatchDeleteOpen(open)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedFileIds.size} Selected Files?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will permanently delete <span className="font-bold">{selectedFileIds.size} selected file(s)</span> from storage and PocketBase. This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isBatchDeleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBatchDelete} disabled={isBatchDeleting} className="bg-destructive hover:bg-destructive/90">
                        {isBatchDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4"/>}
                        Delete {selectedFileIds.size} File(s)
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <Dialog open={!!fileToRename} onOpenChange={(open) => !open && setFileToRename(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Rename file</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="Enter new file name"
                onKeyDown={(e) => e.key === "Enter" && handleRenameFile()}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFileToRename(null)} disabled={isRenaming}>Cancel</Button>
              <Button onClick={handleRenameFile} disabled={isRenaming || !renameValue.trim()}>
                {isRenaming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}

function getCleanName(name: string) {
  if (name.includes('_')) {
    return name.split('_').slice(1).join('_');
  }
  return name;
}

const GALLERY_TABS = ['company-files', 'unassigned'] as const;
type GalleryTab = (typeof GALLERY_TABS)[number];

// Default unassigned when no tab in URL (app open, sidebar nav); refresh keeps current tab from URL
function getTabFromSearchParams(searchParams: URLSearchParams): GalleryTab {
  const tab = searchParams.get('tab');
  return tab === 'company-files' ? 'company-files' : 'unassigned';
}

export function GalleryPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<GalleryTab>(() => getTabFromSearchParams(searchParams));
  const [previewSize, setPreviewSize] = useState<string | number>(160);
  const [isVoucherOpen, setIsVoucherOpen] = useState(false);
  const [defaultVoucherData, setDefaultVoucherData] = useState<any>(null);

  const [voucherToEdit, setVoucherToEdit] = useState<any | null>(null);
  const [isEditVoucherOpen, setIsEditVoucherOpen] = useState(false);

  // Keep URL in sync with tab so refresh keeps same tab
  const setGalleryTab = useCallback(
    (tab: GalleryTab) => {
      setActiveTab(tab);
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set('tab', tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    const savedSize = localStorage.getItem('galleryPreviewSize');
    if (savedSize && !isNaN(Number(savedSize))) {
      setPreviewSize(Number(savedSize));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('galleryPreviewSize', String(previewSize));
  }, [previewSize]);

  // PDF hover: pehli load thodi jaldi — sirf `@/lib/pdfToImage` → `importPdfJsDist` se pdf.js load karo.
  // Alag `import("pdfjs-dist/build/pdf.mjs")` mat lagao: Webpack do chunk banata hai aur `__webpack_require__.r` par `Object.defineProperty` crash ho sakta hai.
  useEffect(() => {
    if (typeof window === "undefined") return;
    void import("@/lib/pdfToImage");
  }, []);

  // Sync tab from URL (e.g. browser back/forward or direct link)
  useEffect(() => {
    setActiveTab(getTabFromSearchParams(searchParams));
  }, [searchParams]);
  
  const handleAttachToVoucher = (type: string, file: any) => {
    setDefaultVoucherData({
      defaultTab: type,
      date: new Date(),
      unassignedFile: {
          id: file.id,
          url: file.url,
          path: file.path,
          name: file.name
      },
      fileUrls: [file.url],
    });
    setIsVoucherOpen(true);
  };
  
  const handleDialogClose = (open: boolean) => {
    setIsVoucherOpen(open);
    if (!open) {
      setDefaultVoucherData(null);
    }
  }

  const handleEditVoucherClick = useCallback((voucher: any) => {
    setVoucherToEdit(voucher);
    setIsEditVoucherOpen(true);
  }, []);

  const handleEditDialogClose = (open: boolean) => {
    setIsEditVoucherOpen(open);
    if (!open) {
      setVoucherToEdit(null);
      // Save/close must stay on Gallery. `history.back()` can jump to Dashboard if
      // Gallery was opened from there and the modal state is not the top entry.
      if (typeof window !== "undefined" && window.history.state?.galleryEditModal) {
        const nextState = { ...window.history.state };
        delete nextState.galleryEditModal;
        window.history.replaceState(nextState, "", window.location.href);
      }
    }
  };

  // When Edit Voucher dialog is open and user presses mobile back button: close dialog only, don't navigate
  useEffect(() => {
    if (!isEditVoucherOpen) return;
    const handlePopState = () => {
      setIsEditVoucherOpen(false);
      setVoucherToEdit(null);
    };
    window.history.pushState({ galleryEditModal: true }, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isEditVoucherOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-0.5 pt-4 pb-0 sm:p-6 md:p-8">
       <div className="mb-6 grid shrink-0 grid-cols-2 gap-4">
          <Button
            onClick={() => setGalleryTab('company-files')}
            className={cn(
              "h-12 text-sm",
              activeTab === 'company-files'
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-blue-100 text-blue-800 hover:bg-blue-200"
            )}
          >
            Company Files
          </Button>
          <Button
            onClick={() => setGalleryTab('unassigned')}
            className={cn(
              "h-12 text-sm",
              activeTab === 'unassigned'
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-blue-100 text-blue-800 hover:bg-blue-200"
            )}
          >
            Unassigned Documents
          </Button>
        </div>

        {/* min-h-0: dashboard main ke andar sirf yahan grid scroll, tab row + footer card fixed */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'company-files' && (
           <CompanyFilesTab previewSize={Number(previewSize)} onSizeChange={setPreviewSize} onEditVoucher={handleEditVoucherClick} />
        )}
        {activeTab === 'unassigned' && (
           <UnassignedDocumentsTab handleAttachToVoucher={handleAttachToVoucher} previewSize={Number(previewSize)} onSizeChange={setPreviewSize} />
        )}
        </div>

        {/* Dialog for creating new voucher from unassigned */}
        <AddVoucherDialog 
          isOpen={isVoucherOpen}
          onOpenChange={handleDialogClose}
          voucher={undefined} // Force "new" mode
          defaultVoucherData={defaultVoucherData}
          suppressDashboardRedirectGuard
          onVoucherAction={() => {}} 
        />
        {/* Dialog for editing existing voucher */}
        <AddVoucherDialog 
          isOpen={isEditVoucherOpen}
          onOpenChange={handleEditDialogClose}
          voucher={voucherToEdit}
          suppressDashboardRedirectGuard
          onVoucherAction={(status: string) => {
            if (status === "saved") {
              setIsEditVoucherOpen(false);
              setVoucherToEdit(null);
              if (typeof window !== "undefined") {
                const nextState = { ...(window.history.state || {}) };
                delete nextState.galleryEditModal;
                window.history.replaceState(nextState, "", window.location.href);
              }
            }
          }}
        />
    </div>
  );
}



