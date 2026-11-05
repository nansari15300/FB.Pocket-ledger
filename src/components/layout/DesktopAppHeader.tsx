
"use client";

import { STAFF_ENTITY_ADD_LABEL } from "@/lib/staffEntityDisplayName";
import { StaffEntityNavIcon } from "@/components/entity/StaffEntityIcon";
import * as React from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useApkPhoneFormFactor } from "@/hooks/useApkPhoneFormFactor";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  Landmark,
  BookText,
  Users,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  Expand,
  Minimize,
  ShoppingBag,
  ShoppingCart,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  FileDigit,
  Smartphone,
  LogOut,
  Monitor,
  FileText,
  Settings,
  RefreshCw,
  Server,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getSuperAdminEmails } from "@/lib/superAdminEmails";
import { filterSharedOnlyCompaniesForSuperAdminInMainApp } from "@/lib/companySuperAdminFilter";
import { useEmbeddedLogout } from "@/contexts/EmbeddedLogoutContext";
import { format } from "date-fns";
import { CompanyActions } from "@/components/company/CompanySelector";
import { useRouter, usePathname, useParams } from "next/navigation";
import { useLocationSearchParams } from "@/hooks/useLocationSearchParams";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { createPortal } from "react-dom";
import { useDate } from "@/hooks/useDate";
import { useToast } from "@/hooks/use-toast";
import { DateFormatSettingsDialog } from "@/components/settings/DateFormatSettingsDialog";
import { CreatePartyDialog } from "../party/CreatePartyDialog";
import { CreateItemDialog } from "../items/CreateItemDialog";
import { CreateBankAccountDialog } from "../bank-cash/CreateBankAccountDialog";
import { CreateStaffDialog } from "../staff/CreateStaffDialog";
import { useIsMobile, useMobileView } from "@/hooks/use-mobile";
import { useCompany } from "@/hooks/useCompany";
import { estimateUserFirestoreBytes } from "@/lib/storageUsageClient";
import { AddVoucherDialog } from "../vouchers/AddVoucherDialog";
import { PermissionButton } from "@/components/permission";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import type { Company } from "@/hooks/useCompany";
import {
  DEFAULT_PLANS,
  getNextPaidUpgrade,
  normalizePlanIdForClient,
  numericEntitlement,
  companyStorageIsLocal,
  formatEntitlementCapLabel,
  isUnlimitedEntitlementCap,
  maxEntitlementCap,
  type PlanId,
} from "@/config/plans";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { planSyncFailureUserMessage } from "@/lib/companyPlanServerSync";
import { cn } from "@/lib/utils";
import { chromeProPillCn } from "@/lib/chromePillButton";
import { isInterCompanyVoucherFeatureDisabled } from "@/lib/interCompany/interCompanyVoucherAccess";
import usePermissions from "@/hooks/usePermissions";
import { DriveCloudSyncHeaderIndicator } from "@/components/layout/DriveCloudSyncHeaderIndicator";
import { HeaderSyncButton } from "@/components/layout/HeaderSyncButton";
import { HeaderFirebaseToPbButton } from "@/components/layout/HeaderFirebaseToPbButton";
import { usePendingInterCompanySystemJoinCount } from "@/lib/interCompany/usePendingInterCompanySystemJoinCount";
import { useMasterDetailHeaderIdSnapshot } from "@/hooks/useMasterDetailHeaderIdSnapshot";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { resolveCompanyIsOwnedForUser } from "@/lib/companyOnlineIntegrity";
import { isDeviceLocalCompany, isServerGateCompany, stampPureLocalDeviceCompanyRow } from "@/lib/companyStorageKind";
import { filterPackedMyCompanyRows } from "@/lib/plServerPackedApp";
import { listLocalCompanies } from "@/lib/localCompanyStore";
import { highestPlanIdAmongOwnedCompanies, resolveEffectiveAccountPlanId, resolvePlanIdForActiveCompany } from "@/lib/accountPlanForOwner";
import {
  getElectronLocalServerApi,
  resolveLocalAppServerSharingPort,
  type LocalAppServerClientStats,
  type LocalAppServerStatus,
} from "@/lib/electronLocalServer";
import {
  countLocalCompanySlotsForOwner,
  countOnlineCompanySlotsForOwner,
  maxOnlineCompaniesForPlan,
} from "@/lib/companyOnlineSlots";
import {
  EMPTY_PURCHASED_PLAN_ADDONS,
  parsePurchasedPlanAddOns,
  planDeviceCapWithAddOns,
  planUserCapWithAddOns,
  type PurchasedPlanAddOns,
} from "@/lib/planAddOns";
import { doc } from "@/lib/pbCompat/firestore";
import { onSnapshot } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { GlobalFileHoverPreviewSwitch } from "@/components/layout/GlobalFileHoverPreviewSwitch";
import { HeaderAppearanceMenu } from "@/components/layout/HeaderAppearanceMenu";
import { LanguageGlobeButton } from "@/components/layout/LanguageGlobeButton";
import { useFileHoverPreview } from "@/contexts/FileHoverPreviewContext";
import { CopyLedgerHeaderButton } from "@/components/ledger/CopyLedgerHeaderButton";
import { ShareForReconciliationHeaderButton } from "@/components/reconciliation/ShareForReconciliationHeaderButton";
import { RenewProrationPills } from "@/components/billing/RenewProrationPills";
import { useDisplayCurrency } from "@/hooks/useDisplayCurrency";
import { getCompanyPlanExpiryMsFromDoc } from "@/lib/companyPlanExpiryMs";
import { HeaderAttachmentPrefetchStrip } from "@/components/layout/HeaderAttachmentPrefetchStrip";
import { HeaderBackupActivityStrip } from "@/components/layout/HeaderBackupActivityStrip";
import { gateHttpGet } from "@/lib/gates/gateServerFetch";
import { updateCompanyRootFirestore } from "@/lib/writeGateway/companyRootFirestore";

/** Electron desktop: header quick-action buttons strip collapsed — `main.js` View menu se bhi toggle */
const PL_DESKTOP_QUICK_ACTIONS_KEY = "pl-desktop-header-quick-actions-collapsed";

/** Static export trailingSlash: URL /party/ vs /party — normalize for route checks */
function pathRoot(pathname: string | null, segment: string): boolean {
  const p = (pathname ?? "").replace(/\/$/, "") || "/";
  return p === `/${segment}`;
}

/** Header company dropdown guard: admin-hidden/deleted company normal app header me hide rahe. */
function isCompanyVisibleInHeader(c: Company & { movedToAdminRecycleAt?: unknown }): boolean {
  return c.isDeleted !== true && c.movedToAdminRecycleAt == null;
}


function ScreenControls() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  // Capacitor / static APK: app already near-fullscreen — header se expand icon hata
  if (isStaticAppBuild()) return null;

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleFullscreen}
      title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
      className="bg-background shadow-sm flex-shrink-0 h-9 w-9"
    >
      {isFullscreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
    </Button>
  );
}


function AddNewButtonOnReportPage() {
  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useIsMobile();
  const isReportPage = pathname != null && (pathname.includes("/reports/party-statement") || pathname.includes("/reports/tax-statement") || pathname.includes("/reports/item-statement"));
  if (!isReportPage || isMobile) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="bg-background shadow-sm flex-shrink-0 h-9 gap-1.5"
      onClick={() => router.push("/sale")}
      title="Add new"
    >
      <Plus className="h-4 w-4" />
      <span>Add New</span>
    </Button>
  );
}

function ReportButtonForPartyOrGroup() {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useLocationSearchParams();
  const router = useRouter();
  const idFromStore = useMasterDetailHeaderIdSnapshot("party");
  // Path-based: /party/[id] or /party/group/[id]; Query-based (mobile/APK): /party?selected=id or /party?view=groups&selected=id
  const idFromPath = params?.id as string | undefined;
  const idFromQuery = searchParams?.get("selected") ?? undefined;
  const viewFromQuery = searchParams?.get("view");
  const isGroupFromPath = pathname != null && /^\/party\/group\/[^/]+$/.test(pathname);
  const isPartyFromPath = pathname != null && /^\/party\/[^/]+$/.test(pathname) && !pathname.includes("/group");
  const isPartyPage = pathRoot(pathname, "party");
  const isGroupDetails = isGroupFromPath || (isPartyPage && viewFromQuery === "groups");
  const isPartyDetails = isPartyFromPath || (isPartyPage && viewFromQuery !== "groups");
  // sessionStorage fallback: router.replace / searchParams race se ~20ms flicker hatane
  const id = idFromPath || (isPartyPage ? (idFromQuery ?? idFromStore) : undefined);

  if (!id || (!isPartyDetails && !isGroupDetails)) return null;

  const href = isGroupDetails
    ? `/reports/party-statement?groupId=${encodeURIComponent(id)}`
    : `/reports/party-statement?partyId=${encodeURIComponent(id)}`;

  return (
    <Button
      variant="outline"
      size="sm"
      className="bg-background shadow-sm flex-shrink-0 h-9 gap-1.5"
      onClick={() => router.push(href)}
      title="Open report"
    >
      <FileText className="h-4 w-4" />
      <span>Report</span>
    </Button>
  );
}

function ReportButtonForBankAccountOrGroup() {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useLocationSearchParams();
  const router = useRouter();
  const idFromStore = useMasterDetailHeaderIdSnapshot("bank-cash");
  const idFromPath = params?.id as string | undefined;
  const idFromQuery = searchParams?.get("selected") ?? undefined;
  const viewFromQuery = searchParams?.get("view");
  const isGroupFromPath = pathname != null && /^\/bank-cash\/group\/[^/]+$/.test(pathname);
  const isAccountFromPath = pathname != null && /^\/bank-cash\/[^/]+$/.test(pathname) && !pathname.includes("/group");
  const isBankPage = pathRoot(pathname, "bank-cash");
  const isGroupDetails = isGroupFromPath || (isBankPage && viewFromQuery === "groups");
  const isAccountDetails = isAccountFromPath || (isBankPage && viewFromQuery !== "groups");
  const id = idFromPath || (isBankPage ? (idFromQuery ?? idFromStore) : undefined);

  if (!id || (!isAccountDetails && !isGroupDetails)) return null;

  const href = isGroupDetails
    ? `/reports/bank-statement?groupId=${encodeURIComponent(id)}`
    : `/reports/bank-statement?accountId=${encodeURIComponent(id)}`;

  return (
    <Button
      variant="outline"
      size="sm"
      className="bg-background shadow-sm flex-shrink-0 h-9 gap-1.5"
      onClick={() => router.push(href)}
      title="Open report"
    >
      <FileText className="h-4 w-4" />
      <span>Report</span>
    </Button>
  );
}

function ReportButtonForStaffOrGroup() {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useLocationSearchParams();
  const router = useRouter();
  const idFromStore = useMasterDetailHeaderIdSnapshot("staff");
  const idFromPath = params?.id as string | undefined;
  const idFromQuery = searchParams?.get("selected") ?? undefined;
  const viewFromQuery = searchParams?.get("view");
  const isGroupFromPath = pathname != null && /^\/staff\/group\/[^/]+$/.test(pathname);
  const isStaffFromPath = pathname != null && /^\/staff\/[^/]+$/.test(pathname) && !pathname.includes("/group");
  const isStaffPage = pathRoot(pathname, "staff");
  const isGroupDetails = isGroupFromPath || (isStaffPage && viewFromQuery === "groups");
  const isStaffDetails = isStaffFromPath || (isStaffPage && viewFromQuery !== "groups");
  const id = idFromPath || (isStaffPage ? (idFromQuery ?? idFromStore) : undefined);

  if (!id || (!isStaffDetails && !isGroupDetails)) return null;

  const href = isGroupDetails
    ? `/reports/staff-statement?groupId=${encodeURIComponent(id)}`
    : `/reports/staff-statement?staffId=${encodeURIComponent(id)}`;

  return (
    <Button
      variant="outline"
      size="sm"
      className="bg-background shadow-sm flex-shrink-0 h-9 gap-1.5"
      onClick={() => router.push(href)}
      title="Open report"
    >
      <FileText className="h-4 w-4" />
      <span>Report</span>
    </Button>
  );
}

function ReportButtonForItemOrGroup() {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useLocationSearchParams();
  const router = useRouter();
  const idFromStore = useMasterDetailHeaderIdSnapshot("items");
  const idFromPath = params?.id as string | undefined;
  const idFromQuery = searchParams?.get("selected") ?? undefined;
  const viewFromQuery = searchParams?.get("view");
  const isGroupFromPath = pathname != null && /^\/items\/group\/[^/]+$/.test(pathname);
  const isItemFromPath = pathname != null && /^\/items\/[^/]+$/.test(pathname) && !pathname.includes("/group");
  const isItemsPage = pathRoot(pathname, "items");
  const isGroupDetails = isGroupFromPath || (isItemsPage && viewFromQuery === "groups");
  const isItemDetails = isItemFromPath || (isItemsPage && viewFromQuery !== "groups");
  const id = idFromPath || (isItemsPage ? (idFromQuery ?? idFromStore) : undefined);

  if (!id || (!isItemDetails && !isGroupDetails)) return null;

  const href = isGroupDetails
    ? `/reports/item-statement?groupId=${encodeURIComponent(id)}`
    : `/reports/item-statement?itemId=${encodeURIComponent(id)}`;

  return (
    <Button
      variant="outline"
      size="sm"
      className="bg-background shadow-sm flex-shrink-0 h-9 gap-1.5"
      onClick={() => router.push(href)}
      title="Open report"
    >
      <FileText className="h-4 w-4" />
      <span>Report</span>
    </Button>
  );
}

function ReportButtonForTaxOrGroup() {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useLocationSearchParams();
  const router = useRouter();
  const idFromStore = useMasterDetailHeaderIdSnapshot("tax");
  const idFromPath = params?.id as string | undefined;
  const idFromQuery = searchParams?.get("selected") ?? undefined;
  const viewFromQuery = searchParams?.get("view");
  const isGroupFromPath = pathname != null && /^\/tax\/group\/[^/]+$/.test(pathname);
  const isTaxFromPath = pathname != null && /^\/tax\/[^/]+$/.test(pathname) && !pathname.includes("/group");
  const isTaxPage = pathRoot(pathname, "tax");
  const isGroupDetails = isGroupFromPath || (isTaxPage && viewFromQuery === "groups");
  const isTaxDetails = isTaxFromPath || (isTaxPage && viewFromQuery !== "groups");
  const id = idFromPath || (isTaxPage ? (idFromQuery ?? idFromStore) : undefined);

  if (!id || (!isTaxDetails && !isGroupDetails)) return null;

  const href = isGroupDetails
    ? `/reports/tax-statement?groupId=${encodeURIComponent(id)}`
    : `/reports/tax-statement?taxId=${encodeURIComponent(id)}`;

  return (
    <Button
      variant="outline"
      size="sm"
      className="bg-background shadow-sm flex-shrink-0 h-9 gap-1.5"
      onClick={() => router.push(href)}
      title="Open report"
    >
      <FileText className="h-4 w-4" />
      <span>Report</span>
    </Button>
  );
}

function ReportButtonForExpenseAccountOrGroup() {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useLocationSearchParams();
  const router = useRouter();
  const idFromStore = useMasterDetailHeaderIdSnapshot("incomes");
  const idFromPath = params?.id as string | undefined;
  const idFromQuery = searchParams?.get("selected") ?? undefined;
  const viewFromQuery = searchParams?.get("view");
  const isGroupFromPath = pathname != null && /^\/incomes\/group\/[^/]+$/.test(pathname);
  const isAccountFromPath = pathname != null && /^\/incomes\/[^/]+$/.test(pathname) && !pathname.includes("/group");
  const isIncomesPage = pathRoot(pathname, "incomes");
  const isGroupDetails = isGroupFromPath || (isIncomesPage && viewFromQuery === "groups");
  const isAccountDetails = isAccountFromPath || (isIncomesPage && viewFromQuery !== "groups");
  const id = idFromPath || (isIncomesPage ? (idFromQuery ?? idFromStore) : undefined);

  if (!id || (!isAccountDetails && !isGroupDetails)) return null;

  const href = isGroupDetails
    ? `/reports/expense-statement?groupId=${encodeURIComponent(id)}`
    : `/reports/expense-statement?accountId=${encodeURIComponent(id)}`;

  return (
    <Button
      variant="outline"
      size="sm"
      className="bg-background shadow-sm flex-shrink-0 h-9 gap-1.5"
      onClick={() => router.push(href)}
      title="Open report"
    >
      <FileText className="h-4 w-4" />
      <span>Report</span>
    </Button>
  );
}

function MobileReportButtonsOnly() {
  const isMobile = useIsMobile();
  // User request: report shortcut buttons should be visible only on mobile layout, not desktop web/EXE header.
  if (!isMobile) return null;
  return (
    <>
      <ReportButtonForPartyOrGroup />
      <ReportButtonForBankAccountOrGroup />
      <ReportButtonForStaffOrGroup />
      <ReportButtonForTaxOrGroup />
      <ReportButtonForExpenseAccountOrGroup />
      <ReportButtonForItemOrGroup />
    </>
  );
}

function HeaderActions() {
  const { isMobile } = useMobileView();
  const pathname = usePathname();
  const { user, customUser } = useAuth();
  const { company, allCompanies } = useCompany();
  const livePlans = useLivePlans();
  const companyPlanId = resolvePlanIdForActiveCompany(
    company,
    allCompanies,
    customUser?.uid ?? user?.uid,
    customUser?.email ?? user?.email
  );
  const companyPlanLive = getPlanFromPlans(livePlans, companyPlanId);
  const { can } = usePermissions();
  const interCompanyDisabled = isInterCompanyVoucherFeatureDisabled({
    company,
    planId: companyPlanId,
    livePlan: companyPlanLive,
    can,
  });
  const pendingSystemJoinCount = usePendingInterCompanySystemJoinCount({
    ownerUserId: user?.uid,
    companyId: company?.id,
  });
  const [isCreatePartyOpen, setIsCreatePartyOpen] = useState(false);
  const [isCreateItemOpen, setIsCreateItemOpen] = useState(false);
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [isCreateStaffOpen, setIsCreateStaffOpen] = useState(false);

  // ✅ voucher dialogs controlled open states
  const [openSale, setOpenSale] = useState(false);
  const [openPurchase, setOpenPurchase] = useState(false);
  const [openPaymentIn, setOpenPaymentIn] = useState(false);
  const [openInterCompany, setOpenInterCompany] = useState(false);
  const [openPaymentOut, setOpenPaymentOut] = useState(false);
  const [openJournal, setOpenJournal] = useState(false);
  const [openSalary, setOpenSalary] = useState(false);

  const buttonClass = "whitespace-nowrap flex-grow min-w-fit";

  // Hide quick actions whenever mobile view is selected (including on PC)
  if (isMobile || pathRoot(pathname, "gate")) {
    return null;
  }

  return (
    <>
      {/* ✅ Sale — global preview switch ab fullscreen icon ke paas (right cluster) */}
      <AddVoucherDialog defaultTab="sale" voucher={undefined} isOpen={openSale} onOpenChange={setOpenSale}>
        <PermissionButton permission="create_records" variant="chromePill" size="sm" className={buttonClass} onClick={() => setOpenSale(true)} data-theme-btn="add-sale">
          <ShoppingBag className="mr-1 h-4 w-4" /> Add Sale
        </PermissionButton>
      </AddVoucherDialog>

      {/* ✅ Purchase */}
      <AddVoucherDialog defaultTab="purchase" voucher={undefined} isOpen={openPurchase} onOpenChange={setOpenPurchase}>
        <PermissionButton permission="create_records" variant="chromePill" size="sm" className={buttonClass} onClick={() => setOpenPurchase(true)} data-theme-btn="add-purchase">
          <ShoppingCart className="mr-1 h-4 w-4" /> Add Purchase
        </PermissionButton>
      </AddVoucherDialog>

      {/* ✅ Payment In */}
      <AddVoucherDialog defaultTab="payment_in" voucher={undefined} isOpen={openPaymentIn} onOpenChange={setOpenPaymentIn}>
        <PermissionButton permission="create_records" variant="chromePill" size="sm" className={buttonClass} onClick={() => setOpenPaymentIn(true)} data-theme-btn="payment-in">
          <ArrowRight className="mr-1 h-4 w-4" /> Receipt
        </PermissionButton>
      </AddVoucherDialog>

      {/* Inter Company — Payment In / Out ke beech; voucher dialog inter_company tab */}
      {!interCompanyDisabled && <AddVoucherDialog
        defaultTab="inter_company"
        voucher={undefined}
        isOpen={openInterCompany}
        onOpenChange={setOpenInterCompany}
      >
        <PermissionButton
          permission="create_records"
          variant="chromePill"
          size="sm"
          className={cn(buttonClass, "relative")}
          onClick={() => setOpenInterCompany(true)}
          data-theme-btn="inter-company"
        >
          <ArrowLeftRight className="mr-1 h-4 w-4" /> Inter Company
          {pendingSystemJoinCount > 0 ? (
            <span className="ml-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {pendingSystemJoinCount > 99 ? "99+" : pendingSystemJoinCount}
            </span>
          ) : null}
        </PermissionButton>
      </AddVoucherDialog>}

      {/* ✅ Payment */}
      <AddVoucherDialog defaultTab="payment_out" voucher={undefined} isOpen={openPaymentOut} onOpenChange={setOpenPaymentOut}>
        <PermissionButton permission="create_records" variant="chromePill" size="sm" className={buttonClass} onClick={() => setOpenPaymentOut(true)} data-theme-btn="payment-out">
          <ArrowLeft className="mr-1 h-4 w-4" /> Payment
        </PermissionButton>
      </AddVoucherDialog>

      {/* Journal – opens AddVoucherDialog with journal tab */}
      <AddVoucherDialog defaultTab="journal" voucher={undefined} isOpen={openJournal} onOpenChange={setOpenJournal}>
        <PermissionButton permission="create_records" variant="chromePill" size="sm" className={buttonClass} onClick={() => setOpenJournal(true)}>
          <FileText className="mr-1 h-4 w-4" /> Journal
        </PermissionButton>
      </AddVoucherDialog>

      {/* ✅ Salary */}
      <AddVoucherDialog defaultTab="add_salary" voucher={undefined} isOpen={openSalary} onOpenChange={setOpenSalary}>
        <PermissionButton permission="create_records" variant="chromePill" size="sm" className={buttonClass} onClick={() => setOpenSalary(true)} data-theme-btn="add-salary">
          <FileDigit className="mr-1 h-4 w-4" /> Add Salary
        </PermissionButton>
      </AddVoucherDialog>

      <CreatePartyDialog onPartyCreated={() => {}} isOpen={isCreatePartyOpen} onOpenChange={setIsCreatePartyOpen}>
        <PermissionButton permission="create_records" variant="chromePill" size="sm" className={buttonClass} onClick={() => setIsCreatePartyOpen(true)} data-theme-btn="add-party">
          <Users className="mr-1 h-4 w-4" /> Add Party
        </PermissionButton>
      </CreatePartyDialog>

      <CreateItemDialog onItemCreated={() => {}} isOpen={isCreateItemOpen} onOpenChange={setIsCreateItemOpen}>
        <PermissionButton permission="create_records" variant="chromePill" size="sm" className={buttonClass} onClick={() => setIsCreateItemOpen(true)} data-theme-btn="add-item">
          <BookText className="mr-1 h-4 w-4" /> Add Item
        </PermissionButton>
      </CreateItemDialog>

      <CreateBankAccountDialog onAccountCreated={() => {}} isOpen={isCreateAccountOpen} onOpenChange={setIsCreateAccountOpen}>
        <PermissionButton permission="create_records" variant="chromePill" size="sm" className={buttonClass} onClick={() => setIsCreateAccountOpen(true)} data-theme-btn="add-bank">
          <Landmark className="mr-1 h-4 w-4" /> Add Bank
        </PermissionButton>
      </CreateBankAccountDialog>

      <CreateStaffDialog onStaffCreated={() => {}} groups={[]} isOpen={isCreateStaffOpen} onOpenChange={setIsCreateStaffOpen}>
        <PermissionButton permission="create_records" variant="chromePill" size="sm" className={buttonClass} onClick={() => setIsCreateStaffOpen(true)} data-theme-btn="add-staff">
          <StaffEntityNavIcon className="mr-1 h-4 w-4" /> {STAFF_ENTITY_ADD_LABEL}
        </PermissionButton>
      </CreateStaffDialog>
    </>
  );
}

/** Opaque “stucco-like” surface in code only — no image, no translucent stacks (clear HD read). */
function ProfileDropdownPlanCard({
  borderClassName,
  tone,
  roundedClassName = "rounded-lg",
  children,
}: {
  borderClassName: string;
  tone: "emerald" | "sky";
  /** Stack cards flush: e.g. `rounded-t-lg rounded-b-none` */
  roundedClassName?: string;
  children: React.ReactNode;
}) {
  const fill =
    tone === "emerald"
      ? {
          backgroundColor: "#f6faf7",
          backgroundImage: `
            linear-gradient(165deg, #ffffff 0%, #f2fbf6 38%, #e8f0ec 100%),
            repeating-linear-gradient(
              -11deg,
              transparent,
              transparent 4px,
              rgba(15, 23, 42, 0.028) 4px,
              rgba(15, 23, 42, 0.028) 8px
            )
          `,
        } as const
      : {
          backgroundColor: "#f5f8fc",
          backgroundImage: `
            linear-gradient(165deg, #ffffff 0%, #f0f7ff 38%, #e8edf5 100%),
            repeating-linear-gradient(
              -11deg,
              transparent,
              transparent 4px,
              rgba(15, 23, 42, 0.028) 4px,
              rgba(15, 23, 42, 0.028) 8px
            )
          `,
        } as const;

  return (
    <div
      className={cn(
        "relative w-full max-w-full box-border overflow-hidden border-4 px-3 py-3 sm:px-4 shadow-sm",
        roundedClassName,
        borderClassName
      )}
      style={fill}
    >
      <div className="relative z-[1] w-full min-w-0">{children}</div>
    </div>
  );
}

/**
 * White fill + colored border; text hamesha black / normal weight (layout me `font-normal`).
 */
const PROFILE_STAT_TONE_CLASSES = {
  expiry: "border-cyan-300 bg-white dark:border-cyan-400 dark:bg-white",
  companyStorage: "border-violet-300 bg-white dark:border-violet-400 dark:bg-white",
  dailyVoucher: "border-amber-300 bg-white dark:border-amber-400 dark:bg-white",
  monthlyVoucher: "border-orange-300 bg-white dark:border-orange-400 dark:bg-white",
  onlineSlots: "border-teal-300 bg-white dark:border-teal-400 dark:bg-white",
  offlineSlots: "border-indigo-300 bg-white dark:border-indigo-400 dark:bg-white",
  usersDevices: "border-rose-300 bg-white dark:border-rose-400 dark:bg-white",
  attachments: "border-lime-300 bg-white dark:border-lime-400 dark:bg-white",
  storage: "border-fuchsia-300 bg-white dark:border-fuchsia-400 dark:bg-white",
} as const;

type ProfileStatTone = keyof typeof PROFILE_STAT_TONE_CLASSES;

/** Shared layout — normal weight, black text (`tone` sirf border color). */
const PROFILE_PLAN_STAT_PILL_LAYOUT =
  "flex w-full max-w-full min-w-0 flex-wrap items-center gap-x-1 rounded-full border-2 px-2.5 py-0.5 text-left text-xs font-normal tabular-nums leading-tight text-black shadow-sm dark:text-black";

function ProfilePlanStatPill({
  tone,
  children,
  end,
}: {
  tone: ProfileStatTone;
  children: React.ReactNode;
  end?: React.ReactNode;
}) {
  return (
    <div className={cn(PROFILE_PLAN_STAT_PILL_LAYOUT, PROFILE_STAT_TONE_CLASSES[tone])}>
      {/* Lambi label/value dropdown width ke andar wrap */}
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {end ? <span className="ml-auto shrink-0">{end}</span> : null}
    </div>
  );
}

function UserProfileButton() {
  const router = useRouter();
  const { user, customUser } = useAuth();
  const { requestEmbeddedLogout } = useEmbeddedLogout();
  const { company, allCompanies, refreshAuthoritativePlan, triggerSync } = useCompany();
  const { displaySymbol } = useDisplayCurrency();
  const { toast } = useToast();
  const { isOnline } = useOnlineStatus();
  const livePlans = useLivePlans();
  const { mode: filePreviewMode } = useFileHoverPreview();
  const profileHoverOpenEnabled = filePreviewMode === "hover";
  const [profileOpen, setProfileOpen] = useState(false);
  const [userStorageUsedBytes, setUserStorageUsedBytes] = useState<number | null>(null);
  const [profileNowMs, setProfileNowMs] = useState(() => Date.now());
  /** Avatar menu: manual Firestore → local plan sync (SQLite/cache align). */
  const [planManualSyncing, setPlanManualSyncing] = useState(false);
  const [selfAddons, setSelfAddons] = useState<PurchasedPlanAddOns>(EMPTY_PURCHASED_PLAN_ADDONS);
  const [companyOwnerAddons, setCompanyOwnerAddons] =
    useState<PurchasedPlanAddOns>(EMPTY_PURCHASED_PLAN_ADDONS);
  const [profileRowsSaving, setProfileRowsSaving] = useState(false);
  /** Delayed close so mouse can move from avatar to portaled menu without flashing shut. */
  const profileHoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearProfileHoverClose = useCallback(() => {
    if (profileHoverCloseTimerRef.current != null) {
      clearTimeout(profileHoverCloseTimerRef.current);
      profileHoverCloseTimerRef.current = null;
    }
  }, []);

  const scheduleProfileHoverClose = useCallback(() => {
    clearProfileHoverClose();
    profileHoverCloseTimerRef.current = setTimeout(() => {
      profileHoverCloseTimerRef.current = null;
      setProfileOpen(false);
    }, 220);
  }, [clearProfileHoverClose]);

  const openProfileFromHover = useCallback(() => {
    clearProfileHoverClose();
    setProfileOpen(true);
  }, [clearProfileHoverClose]);

  const handleProfileOpenChange = useCallback(
    (open: boolean) => {
      if (!open) clearProfileHoverClose();
      setProfileOpen(open);
    },
    [clearProfileHoverClose]
  );

  useEffect(() => () => clearProfileHoverClose(), [clearProfileHoverClose]);

  useEffect(() => {
    const uid = String(user?.uid || "").trim();
    if (!uid) {
      setSelfAddons(EMPTY_PURCHASED_PLAN_ADDONS);
      return;
    }
    const unsub = onSnapshot(
      doc(firestore, "users", uid),
      (snap) => {
        setSelfAddons(parsePurchasedPlanAddOns(snap.exists() ? (snap.data() as Record<string, unknown>) : null));
      },
      () => setSelfAddons(EMPTY_PURCHASED_PLAN_ADDONS)
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    const ownerUid = String(company?.ownerId || "").trim();
    const selfUid = String(user?.uid || "").trim();
    if (!ownerUid || ownerUid === selfUid) {
      setCompanyOwnerAddons(EMPTY_PURCHASED_PLAN_ADDONS);
      return;
    }
    const unsub = onSnapshot(
      doc(firestore, "users", ownerUid),
      (snap) => {
        setCompanyOwnerAddons(
          parsePurchasedPlanAddOns(snap.exists() ? (snap.data() as Record<string, unknown>) : null)
        );
      },
      () => setCompanyOwnerAddons(EMPTY_PURCHASED_PLAN_ADDONS)
    );
    return () => unsub();
  }, [company?.ownerId, user?.uid]);

  const getInitials = (name: string | null | undefined) => {
    if (!name) return "U";
    return name.split(" ").map((n) => n[0]).slice(0, 2).join("");
  };

  const handleLogout = () => {
    requestEmbeddedLogout();
  };

  /** Avatar menu: hosted sync-plan ya PL Server host owner plan → SQLite align. */
  const handleManualPlanSync = async (scope: "account" | "sharedOwner" = "account") => {
    if (!company || planManualSyncing || !isOnline) return;
    clearProfileHoverClose();
    setPlanManualSyncing(true);
    try {
      const r = await refreshAuthoritativePlan();
      if (r.ok && r.applied) {
        toast({
          title: "Plan synced",
          description:
            scope === "sharedOwner"
              ? "Owner plan updated from the shared company server."
              : "Local row updated from the server for this company.",
        });
      } else if (r.ok && !r.applied) {
        toast({
          title: "Already aligned",
          description:
            r.reason === "no_local_sqlite_row"
              ? "No offline copy of this company to patch."
              : r.reason === "no_shared_summary"
                ? "Could not reach the shared company on the server."
                : r.reason === "no_plan_fields"
                  ? "Server responded; no owner plan details to apply."
                  : "Server responded; nothing to change locally.",
        });
      } else {
        // Offline / flight mode: sirf short copy — raw `network` machine reason mat dikhao (APK profile toast).
        const navOff = typeof navigator !== "undefined" && !navigator.onLine;
        const offlineUi =
          r.reason === "offline" || (navOff && (r.reason === "network" || r.reason === "timeout"));
        if (offlineUi) {
          toast({ title: "You are offline" });
        } else {
          toast({
            variant: "destructive",
            title: "Could not sync plan",
            description: planSyncFailureUserMessage(r.reason),
          });
        }
      }
    } finally {
      setPlanManualSyncing(false);
    }
  };

  const allCompanyIds = useMemo(() => allCompanies.map((c) => c.id), [allCompanies]);

  useEffect(() => {
    if (!profileOpen) return;
    const timer = window.setTimeout(() => setProfileNowMs(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, [profileOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!profileOpen || allCompanyIds.length === 0) {
      window.queueMicrotask(() => {
        if (!cancelled) setUserStorageUsedBytes(null);
      });
      return () => {
        cancelled = true;
      };
    }
    estimateUserFirestoreBytes(allCompanyIds)
      .then((value) => {
        if (!cancelled) setUserStorageUsedBytes(value);
      })
      .catch(() => {
        if (!cancelled) setUserStorageUsedBytes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profileOpen, allCompanyIds]);

  // Shared / no-owned fallback ke liye aggregate; **owner + apni company** par badge & caps = `selectedCompanyPlan*` (Billing page jaisa — doosri owned row ka pro-plus yahan mix na ho).
  const userUid = user?.uid ?? "";
  const userEmail = user?.email ?? "";
  const accountPlanId: PlanId = normalizePlanIdForClient(
    customUser?.accountCanonicalPlanId ||
      (userUid ? resolveEffectiveAccountPlanId(allCompanies, userUid, company?.planId) : null) ||
      "basic"
  );
  const selectedCompanyPlanId: PlanId = company && userUid
    ? resolvePlanIdForActiveCompany(company, allCompanies, userUid, userEmail)
    : normalizePlanIdForClient(company?.planId);
  const selectedCompanyPlanName = DEFAULT_PLANS[selectedCompanyPlanId]?.name ?? String(selectedCompanyPlanId);
  // Profile dropdown: selected company local ho to uske liye *Local caps dikhao (admin Plans).
  const storageIsLocal = companyStorageIsLocal(company?.storageOption);
  const ownedForUsage = React.useMemo(
    () =>
      allCompanies.filter(
        (c) =>
          c.isOwned === true && !!userUid && String(c.ownerId || "").trim() === String(userUid).trim()
      ),
    [allCompanies, userUid]
  );
  const hasOwnedCompanies = ownedForUsage.length > 0;
  const isSelectedCompanyOwned =
    !!company &&
    (company.ownerId === userUid || (!!userEmail && company.ownerEmail === userEmail));
  const sharedUserProfileRows = company?.sharedUserProfilePlanRows ?? {};
  const isSharedUserProfileRowVisible = useCallback(
    (
      row:
        | "allStorage"
        | "dailyVoucher"
        | "monthlyVoucher"
        | "onlineSlots"
        | "localSlots"
        | "usersDevices"
        | "attachments"
        | "storage"
        | "expiry"
    ) => sharedUserProfileRows[row] !== false,
    [sharedUserProfileRows]
  );
  const setSharedUserProfileRowVisible = useCallback(
    async (
      row:
        | "allStorage"
        | "dailyVoucher"
        | "monthlyVoucher"
        | "onlineSlots"
        | "localSlots"
        | "usersDevices"
        | "attachments"
        | "storage"
        | "expiry",
      visible: boolean
    ) => {
      if (!company || !isSelectedCompanyOwned || profileRowsSaving) return;
      const companyFirestoreId = String(company.authoritativeCompanyId || company.id || "").trim();
      if (!companyFirestoreId) return;
      const nextRows = { ...sharedUserProfileRows, [row]: visible };
      setProfileRowsSaving(true);
      try {
        await updateCompanyRootFirestore(companyFirestoreId, {
          sharedUserProfilePlanRows: nextRows,
        });
        triggerSync();
      } catch {
        toast({
          title: "Could not save shared-user profile setting",
          description: "Please check your connection and try again.",
          variant: "destructive",
        });
      } finally {
        setProfileRowsSaving(false);
      }
    },
    [
      company,
      isSelectedCompanyOwned,
      profileRowsSaving,
      sharedUserProfileRows,
      toast,
      triggerSync,
    ]
  );
  const sharedUserRowToggle = (
    row:
      | "allStorage"
      | "dailyVoucher"
      | "monthlyVoucher"
      | "onlineSlots"
      | "localSlots"
      | "usersDevices"
      | "attachments"
      | "storage"
      | "expiry"
  ) => (
    <Checkbox
      aria-label={`Show ${row} on Users`}
      checked={isSharedUserProfileRowVisible(row)}
      disabled={profileRowsSaving}
      onCheckedChange={(checked) => void setSharedUserProfileRowVisible(row, checked === true)}
    />
  );

  /** No owned company → account SKU (or Basic). Owned → best owned SKU. */
  const ownedOnlyPlanId: PlanId = (() => {
    if (!userUid) return "basic";
    const best = highestPlanIdAmongOwnedCompanies(allCompanies, userUid);
    if (best) return best;
    return accountPlanId;
  })();

  /** Shared company: aapke account ka best owned SKU; **khud ki company** open ho to isi row ka `planId` (Firestore/Billing ke saath match). */
  const limitsPlanId: PlanId =
    !isSelectedCompanyOwned && hasOwnedCompanies ? ownedOnlyPlanId : selectedCompanyPlanId;
  const limitsPlan = getPlanFromPlans(livePlans, limitsPlanId);
  const limitsUseLocalForSelected =
    isSelectedCompanyOwned ? storageIsLocal : hasOwnedCompanies ? false : storageIsLocal;

  const maxAttGB =
    !isSelectedCompanyOwned && hasOwnedCompanies
      ? maxEntitlementCap(
          numericEntitlement(limitsPlan?.entitlements, "maxAttachmentsGB", false),
          numericEntitlement(limitsPlan?.entitlements, "maxAttachmentsGB", true)
        )
      : numericEntitlement(limitsPlan?.entitlements, "maxAttachmentsGB", limitsUseLocalForSelected);
  const attUsedGB =
    ownedForUsage.reduce((s, c) => s + Number((c as Company).attachmentsUsedBytes ?? 0), 0) / 1e9;
  const attFreeGB = isUnlimitedEntitlementCap(maxAttGB)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, maxAttGB - attUsedGB);
  const GB_TO_MB = 1024;
  const attUsedMB = attUsedGB * GB_TO_MB;
  const attFreeMB = isUnlimitedEntitlementCap(maxAttGB) ? Number.POSITIVE_INFINITY : attFreeGB * GB_TO_MB;
  const userStorUsedMB = userStorageUsedBytes != null ? userStorageUsedBytes / (1024 * 1024) : 0;
  const accountMaxStorGB =
    !isSelectedCompanyOwned && hasOwnedCompanies
      ? maxEntitlementCap(
          numericEntitlement(limitsPlan?.entitlements, "maxStorageGB", false),
          numericEntitlement(limitsPlan?.entitlements, "maxStorageGB", true)
        )
      : numericEntitlement(limitsPlan?.entitlements, "maxStorageGB", limitsUseLocalForSelected);
  const totalMaxStorMB = isUnlimitedEntitlementCap(accountMaxStorGB)
    ? Number.POSITIVE_INFINITY
    : accountMaxStorGB * GB_TO_MB;
  const storFreeMB = isUnlimitedEntitlementCap(accountMaxStorGB)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, totalMaxStorMB - userStorUsedMB);
  const maxStorGB = accountMaxStorGB;
  const onlineSlotMax = maxOnlineCompaniesForPlan(
    selectedCompanyPlanId,
    getPlanFromPlans(livePlans, selectedCompanyPlanId),
    isSelectedCompanyOwned ? selfAddons : companyOwnerAddons
  );
  const onlineSlotUsed =
    user?.uid != null && user.uid !== "" ? countOnlineCompanySlotsForOwner(allCompanies, user.uid) : 0;
  /** Owner apni company dekh raha ho to upgrade ladder isi SKU se — aggregate `accountPlanId` se mat bandho. */
  const selectedCompanyCanUpgradeToPaidTier = getNextPaidUpgrade(selectedCompanyPlanId) != null;

  const ownedPlanLive = getPlanFromPlans(livePlans, ownedOnlyPlanId);
  const ownedOnlineSlotMax = maxOnlineCompaniesForPlan(ownedOnlyPlanId, ownedPlanLive, selfAddons);

  /** Shared / no-company: always show user's own account plan (Basic when nothing purchased). */
  const sharedProfilePlanId: PlanId = hasOwnedCompanies ? ownedOnlyPlanId : accountPlanId;
  const sharedProfilePlanLive = getPlanFromPlans(livePlans, sharedProfilePlanId);
  const sharedProfilePlanName =
    DEFAULT_PLANS[sharedProfilePlanId]?.name ?? String(sharedProfilePlanId);
  const sharedProfileCanUpgrade = getNextPaidUpgrade(sharedProfilePlanId) != null;
  const myAccountUsersOnlineRaw = planUserCapWithAddOns(sharedProfilePlanLive, false, selfAddons);
  const myAccountUsersLocalRaw = planUserCapWithAddOns(sharedProfilePlanLive, true, selfAddons);
  const myAccountDevicesOnlineRaw = planDeviceCapWithAddOns(sharedProfilePlanLive, false, selfAddons);
  const myAccountDevicesLocalRaw = planDeviceCapWithAddOns(sharedProfilePlanLive, true, selfAddons);
  const myAccountMaxUsersOnline = isUnlimitedEntitlementCap(myAccountUsersOnlineRaw)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, myAccountUsersOnlineRaw);
  const myAccountMaxUsersLocal = isUnlimitedEntitlementCap(myAccountUsersLocalRaw)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, myAccountUsersLocalRaw);
  const myAccountMaxDevicesOnline = isUnlimitedEntitlementCap(myAccountDevicesOnlineRaw)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, myAccountDevicesOnlineRaw);
  const myAccountMaxDevicesLocal = isUnlimitedEntitlementCap(myAccountDevicesLocalRaw)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, myAccountDevicesLocalRaw);
  const myAccountAttGBOnline = numericEntitlement(
    sharedProfilePlanLive.entitlements,
    "maxAttachmentsGB",
    false
  );
  const myAccountAttGBLocal = numericEntitlement(
    sharedProfilePlanLive.entitlements,
    "maxAttachmentsGB",
    true
  );
  const myAccountStorGBOnline = numericEntitlement(
    sharedProfilePlanLive.entitlements,
    "maxStorageGB",
    false
  );
  const myAccountStorGBLocal = numericEntitlement(
    sharedProfilePlanLive.entitlements,
    "maxStorageGB",
    true
  );
  const myAccountAttGB = maxEntitlementCap(myAccountAttGBOnline, myAccountAttGBLocal);
  const myAccountStorGB = maxEntitlementCap(myAccountStorGBOnline, myAccountStorGBLocal);

  const selectedCompanyPlanLive = getPlanFromPlans(livePlans, selectedCompanyPlanId);
  const selectedCompanyAddons = isSelectedCompanyOwned ? selfAddons : companyOwnerAddons;
  const thisCompanyStorageLocal = company ? companyStorageIsLocal(company.storageOption) : false;
  const selectedCompanyMaxDevicesRaw = planDeviceCapWithAddOns(
    selectedCompanyPlanLive,
    thisCompanyStorageLocal,
    selectedCompanyAddons
  );
  const selectedCompanyMaxDevices = isUnlimitedEntitlementCap(selectedCompanyMaxDevicesRaw)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, selectedCompanyMaxDevicesRaw);
  const thisCompanyMaxUsersRaw = planUserCapWithAddOns(
    selectedCompanyPlanLive,
    thisCompanyStorageLocal,
    selectedCompanyAddons
  );
  const thisCompanyMaxUsers = isUnlimitedEntitlementCap(thisCompanyMaxUsersRaw)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, thisCompanyMaxUsersRaw);
  const ownerPlanOnlineSlotMax = maxOnlineCompaniesForPlan(
    selectedCompanyPlanId,
    selectedCompanyPlanLive,
    selectedCompanyAddons
  );
  const ownerPlanLocalSlotMax = numericEntitlement(
    selectedCompanyPlanLive.entitlements,
    "maxCompanies",
    true
  );
  const ownerPlanHasAddOns =
    selectedCompanyAddons.extraUsersOnline > 0 ||
    selectedCompanyAddons.extraUsersLocal > 0 ||
    selectedCompanyAddons.extraDevicesOnline > 0 ||
    selectedCompanyAddons.extraDevicesLocal > 0 ||
    selectedCompanyAddons.extraCompaniesOnline > 0 ||
    selectedCompanyAddons.extraCompaniesLocal > 0;

  /** Profile card: plan voucher caps — `numericEntitlement` + company local flag (Billing matrix jaisa). */
  const dailyVoucherPlanCap = numericEntitlement(
    selectedCompanyPlanLive.entitlements,
    "dailyVoucherLimit",
    storageIsLocal
  );
  const monthlyVoucherPlanCap = numericEntitlement(
    selectedCompanyPlanLive.entitlements,
    "monthlyVoucherLimit",
    storageIsLocal
  );
  const ownerPlanDailyVoucherCap = numericEntitlement(
    selectedCompanyPlanLive.entitlements,
    "dailyVoucherLimit",
    thisCompanyStorageLocal
  );
  const ownerPlanMonthlyVoucherCap = numericEntitlement(
    selectedCompanyPlanLive.entitlements,
    "monthlyVoucherLimit",
    thisCompanyStorageLocal
  );
  /** Offline SQLite-first companies count vs `maxCompaniesLocal` (online slot ke parallel). */
  const localCompanySlotMax = numericEntitlement(selectedCompanyPlanLive.entitlements, "maxCompanies", true);
  const localCompanySlotUsed =
    user?.uid != null && user.uid !== ""
      ? countLocalCompanySlotsForOwner(allCompanies, user.uid)
      : 0;

  const ownedPlanExpiryCompany = React.useMemo(() => {
    const withExpiry = ownedForUsage.filter((c) => c.planExpiry);
    if (withExpiry.length === 0) return null;
    return (
      withExpiry.find((c) => String(c.planId || "basic").trim() === ownedOnlyPlanId) ?? withExpiry[0]
    );
  }, [ownedForUsage, ownedOnlyPlanId]);

  /** Owner profile: billing jaisa proration quote — `planExpiry` / `planExpiryMs` se ms (shared user branch me pills nahi). */
  const profileProrationExpiryMs = React.useMemo(
    () => (company ? getCompanyPlanExpiryMsFromDoc(company) : null),
    [company]
  );

  if (!user) return null;

  const formatGbOnlineLocal = (onlineGB: number, localGB: number) => {
    const onlineLabel = isUnlimitedEntitlementCap(onlineGB)
      ? "Unlimited"
      : `${formatEntitlementCapLabel(onlineGB)} GB`;
    const localLabel = isUnlimitedEntitlementCap(localGB)
      ? "Unlimited"
      : `${formatEntitlementCapLabel(localGB)} GB`;
    return `${onlineLabel} online · ${localLabel} local`;
  };

  const renderMyAccountPlanStats = () => (
    <div className="mt-1.5 flex w-full min-w-0 flex-col gap-[5px]">
      <ProfilePlanStatPill tone="attachments">
        Attachments: {formatGbOnlineLocal(myAccountAttGBOnline, myAccountAttGBLocal)}
        {hasOwnedCompanies ? (
          <>
            {" "}
            · {attUsedMB.toFixed(0)} MB used
            {!isUnlimitedEntitlementCap(maxAttGB) ? ` / ${attFreeMB.toFixed(0)} MB free` : ""}
          </>
        ) : null}
      </ProfilePlanStatPill>
      <ProfilePlanStatPill tone="storage">
        Storage: {formatGbOnlineLocal(myAccountStorGBOnline, myAccountStorGBLocal)}
        {userStorageUsedBytes != null ? (
          <>
            {" "}
            · {userStorUsedMB.toFixed(0)} MB used
            {!isUnlimitedEntitlementCap(myAccountStorGB) && hasOwnedCompanies
              ? ` / ${storFreeMB.toFixed(0)} MB free`
              : ""}
          </>
        ) : null}
      </ProfilePlanStatPill>
      <ProfilePlanStatPill tone="usersDevices">
        Sync devices: {formatEntitlementCapLabel(myAccountMaxDevicesOnline)} online
        {myAccountMaxDevicesLocal !== myAccountMaxDevicesOnline
          ? ` · ${formatEntitlementCapLabel(myAccountMaxDevicesLocal)} local`
          : ""}
      </ProfilePlanStatPill>
      <ProfilePlanStatPill tone="usersDevices">
        Max users: {formatEntitlementCapLabel(myAccountMaxUsersOnline)} online
        {myAccountMaxUsersLocal !== myAccountMaxUsersOnline
          ? ` · ${formatEntitlementCapLabel(myAccountMaxUsersLocal)} local`
          : ""}
      </ProfilePlanStatPill>
    </div>
  );

  /**
   * Same plan rows for company owner + shared users.
   * Owner: all rows + "Show on Users" toggles.
   * Shared: only rows owner left ticked (same labels/format).
   */
  const renderSelectedCompanyPlanRows = (opts: {
    withToggles: boolean;
    forSharedUser: boolean;
  }) => {
    const { withToggles, forSharedUser } = opts;
    const allow = (row: Parameters<typeof isSharedUserProfileRowVisible>[0]) =>
      !forSharedUser || isSharedUserProfileRowVisible(row);
    const end = (row: Parameters<typeof isSharedUserProfileRowVisible>[0]) =>
      withToggles ? sharedUserRowToggle(row) : undefined;

    const companyAttUsedBytes = Number((company as Company | null)?.attachmentsUsedBytes ?? 0);
    const companyStorUsedBytes = Number((company as Company | null)?.storageUsedBytes ?? 0);
    const rowAttUsedMB = forSharedUser
      ? (companyAttUsedBytes / 1e9) * GB_TO_MB
      : attUsedMB;
    const rowAttCapGB = forSharedUser
      ? numericEntitlement(
          selectedCompanyPlanLive.entitlements,
          "maxAttachmentsGB",
          thisCompanyStorageLocal
        )
      : maxAttGB;
    const rowAttFreeMB = isUnlimitedEntitlementCap(rowAttCapGB)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, rowAttCapGB * GB_TO_MB - rowAttUsedMB);
    const rowStorUsedMB = forSharedUser
      ? companyStorUsedBytes / (1024 * 1024)
      : userStorUsedMB;
    const rowStorCapGB = forSharedUser
      ? numericEntitlement(
          selectedCompanyPlanLive.entitlements,
          "maxStorageGB",
          thisCompanyStorageLocal
        )
      : maxStorGB;
    const rowStorFreeMB = isUnlimitedEntitlementCap(rowStorCapGB)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, rowStorCapGB * GB_TO_MB - rowStorUsedMB);
    const rowShowAtt = rowAttCapGB > 0 || isUnlimitedEntitlementCap(rowAttCapGB);
    const rowShowStor = rowStorCapGB > 0 || isUnlimitedEntitlementCap(rowStorCapGB);
    const rowStorageLocal = forSharedUser ? thisCompanyStorageLocal : storageIsLocal;
    const rowDailyCap = forSharedUser ? ownerPlanDailyVoucherCap : dailyVoucherPlanCap;
    const rowMonthlyCap = forSharedUser ? ownerPlanMonthlyVoucherCap : monthlyVoucherPlanCap;
    const rowOnlineSlotMax = forSharedUser ? ownerPlanOnlineSlotMax : onlineSlotMax;
    const rowLocalSlotMax = forSharedUser ? ownerPlanLocalSlotMax : localCompanySlotMax;
    const rowHasAddOns = forSharedUser
      ? ownerPlanHasAddOns
      : selfAddons.extraUsersOnline > 0 ||
        selfAddons.extraUsersLocal > 0 ||
        selfAddons.extraDevicesOnline > 0 ||
        selfAddons.extraDevicesLocal > 0;

    return (
      <div className="mt-1.5 flex w-full min-w-0 flex-col gap-[5px]">
        {allow("allStorage") ? (
          <ProfilePlanStatPill tone="companyStorage" end={end("allStorage")}>
            All storage:{" "}
            {rowStorageLocal ? "Device local (offline-first)" : "Online (cloud-linked)"}
            {rowShowStor ? (
              <>
                <span aria-hidden className="mx-0.5 opacity-90">
                  ·
                </span>
                {forSharedUser || userStorageUsedBytes != null ? (
                  <>
                    {isUnlimitedEntitlementCap(rowStorCapGB)
                      ? "Unlimited"
                      : `${rowStorFreeMB.toFixed(0)} MB left`}
                  </>
                ) : (
                  <>… MB left</>
                )}
              </>
            ) : null}
          </ProfilePlanStatPill>
        ) : null}
        {allow("dailyVoucher") ? (
          <ProfilePlanStatPill tone="dailyVoucher" end={end("dailyVoucher")}>
            Daily vouchers (plan cap): {formatEntitlementCapLabel(rowDailyCap)} /day
          </ProfilePlanStatPill>
        ) : null}
        {allow("monthlyVoucher") ? (
          <ProfilePlanStatPill tone="monthlyVoucher" end={end("monthlyVoucher")}>
            Monthly vouchers (plan cap): {formatEntitlementCapLabel(rowMonthlyCap)} /month
          </ProfilePlanStatPill>
        ) : null}
        {allow("onlineSlots") && rowOnlineSlotMax > 0 ? (
          <ProfilePlanStatPill tone="onlineSlots" end={end("onlineSlots")}>
            Online company slots (cloud-linked):{" "}
            {forSharedUser ? (
              formatEntitlementCapLabel(rowOnlineSlotMax)
            ) : (
              <>
                {onlineSlotUsed} / {formatEntitlementCapLabel(rowOnlineSlotMax)}
              </>
            )}
          </ProfilePlanStatPill>
        ) : null}
        {allow("localSlots") &&
        (forSharedUser
          ? rowLocalSlotMax > 0 || isUnlimitedEntitlementCap(rowLocalSlotMax)
          : !!user?.uid) ? (
          <ProfilePlanStatPill tone="offlineSlots" end={end("localSlots")}>
            Offline / local company slots:{" "}
            {forSharedUser ? (
              formatEntitlementCapLabel(rowLocalSlotMax)
            ) : (
              <>
                {localCompanySlotUsed} / {formatEntitlementCapLabel(rowLocalSlotMax)}
              </>
            )}
          </ProfilePlanStatPill>
        ) : null}
        {allow("usersDevices") ? (
          <ProfilePlanStatPill tone="usersDevices" end={end("usersDevices")}>
            Max users / devices (this company): {formatEntitlementCapLabel(thisCompanyMaxUsers)}{" "}
            users · {formatEntitlementCapLabel(selectedCompanyMaxDevices)} devices
            {rowHasAddOns ? <span className="opacity-80"> (plan + add-ons)</span> : null}
          </ProfilePlanStatPill>
        ) : null}
        {allow("attachments") && rowShowAtt ? (
          <ProfilePlanStatPill tone="attachments" end={end("attachments")}>
            Attachments: {rowAttUsedMB.toFixed(0)} MB used /{" "}
            {isUnlimitedEntitlementCap(rowAttCapGB)
              ? "Unlimited"
              : `${rowAttFreeMB.toFixed(0)} MB free`}
          </ProfilePlanStatPill>
        ) : null}
        {allow("storage") && rowShowStor ? (
          <ProfilePlanStatPill tone="storage" end={end("storage")}>
            Storage:{" "}
            {forSharedUser || userStorageUsedBytes != null ? rowStorUsedMB.toFixed(0) : "…"} MB
            used /{" "}
            {forSharedUser || userStorageUsedBytes != null
              ? isUnlimitedEntitlementCap(rowStorCapGB)
                ? "Unlimited"
                : `${rowStorFreeMB.toFixed(0)} MB free`
              : "… MB free"}
          </ProfilePlanStatPill>
        ) : null}
        {allow("expiry") &&
          company?.planExpiry &&
          (() => {
            const raw = company.planExpiry;
            const expiryDate =
              typeof raw?.toDate === "function"
                ? raw.toDate()
                : raw?.seconds
                  ? new Date(raw.seconds * 1000)
                  : null;
            if (!expiryDate) return null;
            const expiryMs =
              profileProrationExpiryMs ??
              (Number.isFinite(expiryDate.getTime()) ? expiryDate.getTime() : null);
            const expiredPlan = expiryMs != null && expiryMs <= profileNowMs;
            return (
              <ProfilePlanStatPill tone="expiry" end={end("expiry")}>
                Expires on: {format(expiryDate, "MMM d, yyyy")}
                {expiredPlan ? (
                  <>
                    <span aria-hidden className="mx-0.5 opacity-90">
                      ·
                    </span>
                    <span>Expired</span>
                  </>
                ) : null}
              </ProfilePlanStatPill>
            );
          })()}
      </div>
    );
  };

  return (
    <>
      <DropdownMenu open={profileOpen} onOpenChange={handleProfileOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="relative h-9 w-9 rounded-full p-0 touch-manipulation"
            onMouseEnter={profileHoverOpenEnabled ? openProfileFromHover : undefined}
            onMouseLeave={profileHoverOpenEnabled ? scheduleProfileHoverClose : undefined}
          >
            {/* Sirf plan dropdown — avatar par `EntityFileAttachmentHover` mat lagao warna hover pe Preview modal + dropdown dono fight karte hain. */}
            <div
              className={cn(
                "relative h-9 w-9 rounded-full inline-flex [&:focus-visible]:outline-none",
                isOnline ? "ring-2 ring-green-500 ring-offset-0" : "ring-2 ring-black ring-offset-0"
              )}
            >
              <Avatar className="h-full w-full">
                <AvatarImage src={user.photoURL?.trim() ? user.photoURL : undefined} alt={user.displayName ?? "User"} />
                <AvatarFallback>{getInitials(user.displayName ?? user.email)}</AvatarFallback>
              </Avatar>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className={cn(
            "p-0 min-w-0 w-[min(96vw,440px)] sm:w-[min(92vw,520px)] rounded-xl shadow-lg border bg-popover text-popover-foreground",
            /* Lamba profile card: mobile par viewport ke andar scroll — overflow clip na ho */
            "max-h-[85dvh] overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
          align="end"
          sideOffset={8}
          forceMount
          onMouseEnter={profileHoverOpenEnabled ? openProfileFromHover : undefined}
          onMouseLeave={profileHoverOpenEnabled ? scheduleProfileHoverClose : undefined}
        >
          {!company ? (
            <div className="w-full max-w-full px-0 py-0 space-y-0">
              <ProfileDropdownPlanCard
                borderClassName="border-green-500"
                tone="emerald"
                roundedClassName="rounded-t-lg rounded-b-lg"
              >
                <div>
                  {user.displayName ? (
                    <p className="text-sm font-medium text-foreground break-words leading-snug mb-1">
                      {user.displayName}
                    </p>
                  ) : null}
                  {user.email ? (
                    <p className="text-xs text-muted-foreground break-words leading-snug mb-3">{user.email}</p>
                  ) : null}
                  <div className="text-xs text-muted-foreground mb-1">Your plan</div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary" className="shrink-0">{sharedProfilePlanName}</Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs shrink-0"
                      onClick={() => {
                        clearProfileHoverClose();
                        setProfileOpen(false);
                        router.push("/billing");
                      }}
                    >
                      {sharedProfileCanUpgrade ? "Upgrade" : "Billing"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    No company selected yet. Account defaults to Basic until you create or buy a plan.
                  </p>
                  {renderMyAccountPlanStats()}
                  <DropdownMenuSeparator className="my-2" />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="py-2.5 px-2 mx-0 rounded-md cursor-pointer w-full focus:bg-accent/80"
                  >
                    <LogOut className="mr-2 h-4 w-4 shrink-0" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </div>
              </ProfileDropdownPlanCard>
            </div>
          ) : null}

          {company ? (
              <div className="w-full max-w-full px-0 py-0 space-y-0">
                {/* Plan: owned company = single block; shared company = one card (your plan top, shared company below). */}
                {isSelectedCompanyOwned ? (
                <ProfileDropdownPlanCard
                  borderClassName="border-green-500"
                  tone="emerald"
                  roundedClassName="rounded-t-lg rounded-b-lg"
                >
                <div>
                  {user.displayName ? (
                    <p className="text-sm font-medium text-foreground break-words leading-snug mb-1">{user.displayName}</p>
                  ) : null}
                  {user.email ? (
                    <p className="text-xs text-muted-foreground break-words leading-snug mb-3">{user.email}</p>
                  ) : null}
                  <div className="text-xs text-muted-foreground mb-1">Current Plan</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Badge variant="secondary" className="shrink-0">{selectedCompanyPlanName}</Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title="Sync plan from server"
                        aria-label="Sync plan from server"
                        disabled={!isOnline || planManualSyncing || !company}
                        onClick={(e) => {
                          e.preventDefault();
                          void handleManualPlanSync();
                        }}
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", planManualSyncing && "animate-spin")} />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs shrink-0"
                      onClick={() => {
                        clearProfileHoverClose();
                        setProfileOpen(false);
                        router.push("/billing");
                      }}
                    >
                      {selectedCompanyCanUpgradeToPaidTier ? "Upgrade" : "Billing"}
                    </Button>
                  </div>
                  {/* Sab stats vertical pills — expiry sabse niche; Balance / Usage upar */}
                  {/* Pills ke beech fixed 5px vertical gap */}
                  <div className="mt-2 pr-0.5 text-right text-[11px] text-muted-foreground">Show on Users</div>
                  {/* Balance / Usage owner-only; baaki rows shared renderer se (same as shared user). */}
                  {!selectedCompanyPlanLive.isFree ? (
                    <div className="mt-1.5 flex w-full min-w-0 flex-col gap-[5px]">
                      <RenewProrationPills
                        plan={selectedCompanyPlanLive}
                        currentExpiryMs={profileProrationExpiryMs}
                        currencySymbol={displaySymbol}
                      />
                    </div>
                  ) : null}
                  {renderSelectedCompanyPlanRows({ withToggles: true, forSharedUser: false })}
                  <DropdownMenuSeparator className="my-2" />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="py-2.5 px-2 mx-0 rounded-md cursor-pointer w-full focus:bg-accent/80"
                  >
                    <LogOut className="mr-2 h-4 w-4 shrink-0" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </div>
                </ProfileDropdownPlanCard>
                ) : (
                <div className="w-full max-w-full space-y-0">
                  <ProfileDropdownPlanCard
                    borderClassName="border-green-500"
                    tone="emerald"
                    roundedClassName="rounded-t-lg rounded-b-lg"
                  >
                  <div>
                    {user.displayName ? (
                      <p className="text-sm font-medium text-foreground break-words leading-snug mb-1">{user.displayName}</p>
                    ) : null}
                    {user.email ? (
                      <p className="text-xs text-muted-foreground break-words leading-snug mb-3">{user.email}</p>
                    ) : null}
                    <div className="text-xs text-muted-foreground mb-1">Your plan</div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Badge variant="secondary" className="shrink-0">{sharedProfilePlanName}</Badge>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          title="Sync plan from server"
                          aria-label="Sync plan from server"
                          disabled={!isOnline || planManualSyncing}
                          onClick={(e) => {
                            e.preventDefault();
                            void handleManualPlanSync();
                          }}
                        >
                          <RefreshCw className={cn("h-3.5 w-3.5", planManualSyncing && "animate-spin")} />
                        </Button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs shrink-0"
                        onClick={() => {
                          clearProfileHoverClose();
                          setProfileOpen(false);
                          router.push("/billing");
                        }}
                      >
                        {sharedProfileCanUpgrade ? "Upgrade" : "Billing"}
                      </Button>
                    </div>
                    {!hasOwnedCompanies ? (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        No owned company yet — account stays on Basic until you create one or buy a plan.
                      </p>
                    ) : null}
                    {ownedPlanExpiryCompany?.planExpiry && (() => {
                      const raw = ownedPlanExpiryCompany.planExpiry;
                      const expiryDate = typeof raw?.toDate === "function" ? raw.toDate() : (raw?.seconds ? new Date(raw.seconds * 1000) : null);
                      if (!expiryDate) return null;
                      const expiryMsOwned =
                        getCompanyPlanExpiryMsFromDoc(ownedPlanExpiryCompany) ??
                        (Number.isFinite(expiryDate.getTime()) ? expiryDate.getTime() : null);
                      const nowMsOwn = profileNowMs;
                      const expiredOwned = expiryMsOwned != null && expiryMsOwned <= nowMsOwn;
                      return (
                        <div className="text-xs text-muted-foreground mt-1.5">
                          Your plan renews / expires:{" "}
                          <span className="font-medium text-foreground">{format(expiryDate, "MMM d, yyyy")}</span>
                          {expiredOwned ? (
                            <>
                              {" "}
                              · <span className="font-medium text-destructive">Expired</span>
                            </>
                          ) : null}
                        </div>
                      );
                    })()}
                    {hasOwnedCompanies && ownedOnlineSlotMax > 0 && user?.uid ? (
                      <div className="text-xs text-muted-foreground mt-1.5">
                        Your online company slots:{" "}
                        <span className="font-medium text-foreground">{onlineSlotUsed}</span> /{" "}
                        <span className="font-medium text-foreground">
                          {formatEntitlementCapLabel(ownedOnlineSlotMax)}
                        </span>
                      </div>
                    ) : null}
                    {renderMyAccountPlanStats()}
                    <DropdownMenuSeparator className="my-2" />
                    <div className="space-y-1.5">
                      <div className="text-xs text-muted-foreground">Shared company</div>
                      <div className="text-xs font-medium text-foreground break-words" title={company.name}>
                        {company.name}
                      </div>
                      {(company.ownerEmail || company.ownerId) ? (
                        <div className="text-xs text-muted-foreground break-words">
                          Shared id:{" "}
                          <span className="font-medium text-foreground">
                            {company.ownerEmail || company.ownerId}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">Owner plan</span>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Badge variant="outline" className="shrink-0 text-xs">{selectedCompanyPlanName}</Badge>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            title="Sync owner plan from server"
                            aria-label="Sync owner plan from server"
                            disabled={!isOnline || planManualSyncing || !company}
                            onClick={(e) => {
                              e.preventDefault();
                              void handleManualPlanSync("sharedOwner");
                            }}
                          >
                            <RefreshCw className={cn("h-3.5 w-3.5", planManualSyncing && "animate-spin")} />
                          </Button>
                        </div>
                      </div>
                      {renderSelectedCompanyPlanRows({ withToggles: false, forSharedUser: true })}
                    </div>
                    <DropdownMenuSeparator className="my-2" />
                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="py-2.5 px-2 mx-0 rounded-md cursor-pointer w-full focus:bg-accent/80"
                    >
                      <LogOut className="mr-2 h-4 w-4 shrink-0" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </div>
                  </ProfileDropdownPlanCard>
                </div>
                )}
              </div>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {profileOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-40 backdrop-blur-[2px] bg-black/15 pointer-events-none"
          aria-hidden
        />,
        document.body
      )}
    </>
  );
}


/** Date header: Nepal = BS/AD/Both + format settings; other countries = format settings only. */
function DateSystemSwitcher() {
  const { dateSystem, setDateSystem } = useDate();
  const { isMobile } = useMobileView();
  const { company } = useCompany();
  const [dateFormatDialogOpen, setDateFormatDialogOpen] = React.useState(false);

  const isNepal = !company?.country || company.country === "Nepal";
  const triggerLabel = isNepal ? dateSystem : "Date";

  const dateMenuContent = isNepal ? (
    <>
      <DropdownMenuItem onSelect={() => setDateSystem("BS")}>Bikram Samvat (BS)</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setDateSystem("AD")}>Anno Domini (AD)</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setDateSystem("Both")}>Both</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => setDateFormatDialogOpen(true)}>
        <Settings className="mr-2 h-4 w-4" />
        Setting
      </DropdownMenuItem>
    </>
  ) : (
    <DropdownMenuItem onSelect={() => setDateFormatDialogOpen(true)}>
      <Settings className="mr-2 h-4 w-4" />
      Date format settings
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={cn("whitespace-nowrap h-9", isMobile && "px-3")} data-theme-header="date-selector">
            {!isMobile && <CalendarDays className="mr-2 h-4 w-4" />}
            <span>{triggerLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>{dateMenuContent}</DropdownMenuContent>
      </DropdownMenu>
      <DateFormatSettingsDialog open={dateFormatDialogOpen} onOpenChange={setDateFormatDialogOpen} />
    </>
  );
}

/** PC/Mobile view toggle — har country; date switcher se alag. */
function HeaderViewModeToggle() {
  const { forcedViewMode, setForcedMode } = useMobileView();

  return forcedViewMode === "mobile" ? (
    <Button
      variant="outline"
      size="icon"
      title="Switch to PC View"
      onClick={() => setForcedMode("pc")}
      className="h-9 w-9 flex-shrink-0"
      data-theme-header="view-toggle"
    >
      <Monitor className="h-4 w-4" />
    </Button>
  ) : (
    <Button
      variant="outline"
      size="icon"
      title="Switch to Mobile View"
      onClick={() => setForcedMode("mobile")}
      className="h-9 w-9 flex-shrink-0"
      data-theme-header="view-toggle"
    >
      <Smartphone className="h-4 w-4" />
    </Button>
  );
}


/**
 * Company dropdown: sirf yahi usePathname + route-based list filter — sidebar navigate par parent header strip unnecessary re-render na ho.
 */
function HeaderCompanyPickerIsland({
  unfilteredHeaderCompanies,
  contextCompanies,
  allCompaniesRegistry,
  loading,
  user,
  isSuperAdminUser,
  onCompanyCreated,
  mobileStrip,
}: {
  unfilteredHeaderCompanies: Company[];
  contextCompanies: Company[];
  allCompaniesRegistry: Company[];
  loading: boolean;
  user: { uid: string; email: string | null } | null | undefined;
  isSuperAdminUser: boolean;
  onCompanyCreated: () => void;
  // Mobile header row: pulse skeleton par shrink-0 (layout)
  mobileStrip?: boolean;
}) {
  const pathname = usePathname();
  const companies = useMemo(() => {
    const shareUser = { uid: user?.uid || "", email: user?.email ?? null };
    const registryRows = allCompaniesRegistry?.length ? allCompaniesRegistry : contextCompanies || [];
    const byId = new Map<string, Company>();
    const addRows = (rows: Company[]) => {
      for (const c of rows) {
        if (!c?.id) continue;
        byId.set(c.id, {
          ...c,
          isOwned: user?.uid ? resolveCompanyIsOwnedForUser(c, shareUser) : Boolean(c.isOwned),
        });
      }
    };
    addRows(unfilteredHeaderCompanies);
    addRows(registryRows);
    return filterPackedMyCompanyRows(
      filterSharedOnlyCompaniesForSuperAdminInMainApp(
        Array.from(byId.values()),
        user,
        isSuperAdminUser,
        pathname
      )
    );
  }, [unfilteredHeaderCompanies, allCompaniesRegistry, contextCompanies, user, isSuperAdminUser, pathname]);
  const showLoadingSkeleton =
    loading &&
    unfilteredHeaderCompanies.length === 0 &&
    (allCompaniesRegistry?.length ?? 0) === 0 &&
    (contextCompanies?.length ?? 0) === 0;
  // Pehli load: skeleton; data aane ke baad loading dubara true ho to bhi purana box dikhate raho (sidebar navigate flash band).
  if (showLoadingSkeleton) {
    return (
      <div
        className={cn(
          "h-8 animate-pulse rounded-md bg-background/60",
          // Mobile: company slot poori width — skeleton bhi stretch.
          mobileStrip ? "w-full min-w-0" : "w-32 shrink-0"
        )}
      />
    );
  }
  return (
    <CompanyActions
      companies={companies}
      onCompanyCreated={onCompanyCreated}
      triggerLayout={mobileStrip ? "mobile" : "desktop"}
    />
  );
}

function HeaderServerSwitch() {
  const { toast } = useToast();
  const { allCompanies } = useCompany();
  const { isMobile } = useMobileView();
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<LocalAppServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!isElectronDesktopApp()) return;
    const api = getElectronLocalServerApi();
    if (!api) return;
    try {
      const [config, nextStatus] = await Promise.all([api.getConfig(), api.getStatus()]);
      setVisible(config.showServerSwitchInHeader === true);
      setStatus(nextStatus);
    } catch {
      /* Header control is optional. */
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const onConfigChanged = () => void refresh();
    window.addEventListener("pl-server-header-switch-config-changed", onConfigChanged);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("pl-server-header-switch-config-changed", onConfigChanged);
    };
  }, [refresh]);

  useEffect(() => {
    if (!visible) return;
    const api = getElectronLocalServerApi();
    if (!api) return;
    let cancelled = false;
    let timer: number | null = null;
    const check = async () => {
      if (cancelled) return;
      let nextMs = 15_000;
      try {
        const nextStatus = await api.getStatus();
        if (cancelled) return;
        setStatus(nextStatus);
        const port = resolveLocalAppServerSharingPort(nextStatus);
        if (!port) {
          setPingMs(null);
        } else {
          nextMs = 2_000;
          const started = performance.now();
          const response = await fetch(`http://127.0.0.1:${port}/__pl_server_ping`, {
            cache: "no-store",
          });
          if (!cancelled) {
            setPingMs(response.ok ? Math.max(1, Math.round(performance.now() - started)) : null);
          }
        }
      } catch {
        if (!cancelled) setPingMs(null);
      }
      if (!cancelled) timer = window.setTimeout(() => void check(), nextMs);
    };
    void check();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [visible]);

  const sharing = status?.sharingActive ?? status?.running ?? false;
  if (isMobile || !visible) return null;

  return (
    <div className="flex h-9 min-w-[150px] shrink-0 items-center gap-2 rounded-md border bg-background px-2" title="Server sharing">
      <Server className="h-4 w-4" aria-hidden />
      <button
        type="button"
        className="shrink-0 text-xs font-semibold text-emerald-700 underline-offset-2 hover:underline"
        onClick={() => setDetailsOpen(true)}
      >
        Details
      </button>
      <Switch
        checked={sharing}
        disabled={busy}
        aria-label={sharing ? "Stop server sharing" : "Start server sharing"}
        onCheckedChange={(checked) => {
          const api = getElectronLocalServerApi();
          if (!api) return;
          setBusy(true);
          void (checked ? api.start() : api.stop())
            .then((result) => {
              if (result.status) setStatus(result.status);
              if (!checked) setPingMs(null);
              toast({ title: checked ? "Server started" : "Server stopped" });
            })
            .catch((error) => {
              toast({
                variant: "destructive",
                title: "Server switch failed",
                description: error instanceof Error ? error.message : "Try again.",
              });
              void refresh();
            })
            .finally(() => setBusy(false));
        }}
      />
      {detailsOpen ? (
        <ServerDetailsPopup
          status={status}
          sharing={sharing}
          busy={busy}
          pingMs={pingMs}
          companies={allCompanies}
          onClose={() => setDetailsOpen(false)}
          onToggle={(checked) => {
            const api = getElectronLocalServerApi();
            if (!api) return;
            setBusy(true);
            void (checked ? api.start() : api.stop())
              .then((result) => {
                if (result.status) setStatus(result.status);
                if (!checked) setPingMs(null);
                toast({ title: checked ? "Server started" : "Server stopped" });
              })
              .catch((error) => {
                toast({
                  variant: "destructive",
                  title: "Server switch failed",
                  description: error instanceof Error ? error.message : "Try again.",
                });
                void refresh();
              })
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
    </div>
  );
}

function ServerDetailsPopup({
  status,
  sharing,
  busy,
  pingMs,
  companies,
  onClose,
  onToggle,
}: {
  status: LocalAppServerStatus | null;
  sharing: boolean;
  busy: boolean;
  pingMs: number | null;
  companies: Company[];
  onClose: () => void;
  onToggle: (checked: boolean) => void;
}) {
  const [companyFilter, setCompanyFilter] = useState("all");
  const rawClients = useMemo(() => (Array.isArray(status?.clients) ? status.clients : []), [status]);
  const companyOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const company of companies || []) {
      if (company?.id) byId.set(company.id, company.name || company.id);
    }
    for (const client of rawClients) {
      const ids = Array.isArray(client.companyIds) ? client.companyIds : [];
      const names = Array.isArray(client.companyNames) ? client.companyNames : [];
      ids.forEach((id, index) => {
        const cleanId = String(id || "").trim();
        if (cleanId && !byId.has(cleanId)) byId.set(cleanId, String(names[index] || cleanId));
      });
    }
    return Array.from(byId.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [companies, rawClients]);
  const clients = useMemo(() => {
    return expandServerDetailClientRows(rawClients)
      .filter((client) => {
        if (companyFilter === "all") return true;
        return Array.isArray(client.companyIds) && client.companyIds.includes(companyFilter);
      })
      .slice()
      .sort((a, b) => {
        const aLabel = `${a.email || ""}|${a.user || ""}|${a.ip || ""}|${a.key || ""}`;
        const bLabel = `${b.email || ""}|${b.user || ""}|${b.ip || ""}|${b.key || ""}`;
        return aLabel.localeCompare(bLabel);
      });
  }, [companyFilter, rawClients]);
  const showCompanyColumn = companyFilter === "all";
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-start justify-end bg-black/25 p-4 pt-20" onClick={onClose}>
      <div
        className="w-[90vw] max-w-[1100px] rounded-lg border border-emerald-400 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Users details</h2>
            <p className="text-xs text-muted-foreground">
              {sharing ? `Server online - ${pingMs != null ? formatServerPing(pingMs) : "ping pending"}` : "Server offline"}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
            <div className="flex max-w-[min(520px,100%)] flex-wrap items-center gap-1 rounded-md border bg-white/70 p-1">
              <button
                type="button"
                className={cn(
                  "h-7 shrink-0 rounded px-2 text-xs font-semibold",
                  companyFilter === "all" ? "bg-emerald-500 text-white" : "text-slate-700 hover:bg-emerald-100"
                )}
                onClick={() => setCompanyFilter("all")}
              >
                All
              </button>
              {companyOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    "h-7 max-w-32 shrink-0 truncate rounded px-2 text-xs font-semibold",
                    companyFilter === option.id ? "bg-emerald-500 text-white" : "text-slate-700 hover:bg-emerald-100"
                  )}
                  title={option.name}
                  onClick={() => setCompanyFilter(option.id)}
                >
                  {option.name}
                </button>
              ))}
            </div>
            <span className="text-sm font-medium">{sharing ? "Server on" : "Server off"}</span>
            <Switch
              checked={sharing}
              disabled={busy}
              aria-label={sharing ? "Stop server sharing" : "Start server sharing"}
              onCheckedChange={onToggle}
            />
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border bg-white/70">
          <table className="w-full min-w-[760px] table-fixed text-sm">
            <thead className="bg-emerald-100/80">
              <tr>
                <th className="w-[210px] px-3 py-2 text-left">Email</th>
                <th className="w-[140px] px-3 py-2 text-left">User</th>
                <th className="w-[105px] px-3 py-2 text-left">Device</th>
                <th className="w-[125px] px-3 py-2 text-left">IP</th>
                {showCompanyColumn ? <th className="w-[130px] px-3 py-2 text-left">Company</th> : null}
                <th className="w-[80px] px-3 py-2 text-left">Ping</th>
                <th className="w-[105px] px-3 py-2 text-left">Download</th>
                <th className="w-[105px] px-3 py-2 text-left">Upload</th>
              </tr>
            </thead>
            <tbody>
              {clients.length > 0 ? (
                clients.map((client) => (
                  <ServerDetailsRow key={client.key} client={client} showCompanyColumn={showCompanyColumn} />
                ))
              ) : (
                <tr>
                  <td className="px-3 py-5 text-center text-muted-foreground" colSpan={showCompanyColumn ? 8 : 7}>
                    No shared user traffic yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ServerDetailsRow({
  client,
  showCompanyColumn,
}: {
  client: LocalAppServerClientStats;
  showCompanyColumn: boolean;
}) {
  const companyLabel = formatClientCompanies(client);
  return (
    <tr className="h-10 border-t">
      <td className="max-w-56 truncate px-3 py-2 align-middle" title={client.email || "-"}>
        {client.email || "-"}
      </td>
      <td className="max-w-40 truncate px-3 py-2 align-middle" title={client.user || "-"}>
        {client.user || "-"}
      </td>
      <td className="truncate px-3 py-2 align-middle" title={client.device || "-"}>
        {client.device || "-"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 align-middle">{client.ip || "-"}</td>
      {showCompanyColumn ? (
        <td className="truncate px-3 py-2 align-middle" title={companyLabel}>
          {companyLabel}
        </td>
      ) : null}
      <td className="whitespace-nowrap px-3 py-2 align-middle tabular-nums">
        {client.pingMs != null ? formatServerPing(client.pingMs) : "-"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 align-middle tabular-nums">{formatBytes3(client.downloadBytes)}</td>
      <td className="whitespace-nowrap px-3 py-2 align-middle tabular-nums">{formatBytes3(client.uploadBytes)}</td>
    </tr>
  );
}

function expandServerDetailClientRows(clients: LocalAppServerClientStats[]): LocalAppServerClientStats[] {
  const expanded: LocalAppServerClientStats[] = [];
  for (const client of clients) {
    const ids = Array.isArray(client.companyIds) ? client.companyIds.filter(Boolean) : [];
    const names = Array.isArray(client.companyNames) ? client.companyNames.filter(Boolean) : [];
    if (ids.length <= 1) {
      expanded.push(client);
      continue;
    }
    ids.forEach((id, index) => {
      expanded.push({
        ...client,
        key: `${client.key}:${id}`,
        companyKey: id,
        companyIds: [id],
        companyNames: [names[index] || id],
      });
    });
  }
  return expanded;
}

function formatClientCompanies(client: LocalAppServerClientStats): string {
  const names = Array.isArray(client.companyNames) ? client.companyNames.filter(Boolean) : [];
  const ids = Array.isArray(client.companyIds) ? client.companyIds.filter(Boolean) : [];
  const values = names.length ? names : ids;
  if (!values.length) return "-";
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

function formatBytes3(bytes: number): string {
  const b = Math.max(0, Number(bytes || 0));
  if (b < 1024) return `${b.toFixed(3)} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(3)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(3)} MB`;
  return `${(mb / 1024).toFixed(3)} GB`;
}

function formatServerPing(ms: number): string {
  const rounded = Math.max(0, Math.round(ms));
  return rounded < 1_000 ? `${String(rounded).padStart(3, "0")} ms` : `${(rounded / 1_000).toFixed(2)} s`;
}

function serverHostLabel(serverUrl: string): string {
  try {
    return new URL(serverUrl).hostname || serverUrl;
  } catch {
    return serverUrl.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
  }
}

function PlServerCompanyConnectionStatus() {
  const { company } = useCompany();
  const isMobile = useIsMobile();
  const pathname = usePathname();
  // APK/mobile: ping chip sirf Dashboard. Desktop/EXE/web PC: PL company pe always.
  const onDashboard = pathRoot(pathname, "dashboard");
  const serverUrl = String(
    (company as (Company & { plServerGateServerUrl?: string }) | null | undefined)?.plServerGateServerUrl || ""
  )
    .trim()
    .replace(/\/$/, "");
  const show = Boolean(
    company && serverUrl && isServerGateCompany(company) && (!isMobile || onDashboard)
  );
  const hostLabel = serverHostLabel(serverUrl);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const lastPingMsRef = useRef<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    const check = async () => {
      try {
        // APK WebView is https://localhost — raw fetch to http://LAN is mixed-content blocked.
        // Gate sync uses CapacitorHttp via gateHttpGet; ping must use the same path.
        const pingUrl = new URL(`${serverUrl}/__pl_server_ping`);
        if (company?.id) pingUrl.searchParams.set("companyId", company.id);
        if (lastPingMsRef.current != null) {
          pingUrl.searchParams.set("clientPingMs", String(lastPingMsRef.current));
        }
        const started = performance.now();
        const { status } = await gateHttpGet(pingUrl.toString(), "", { timeoutMs: 12_000 });
        const measuredMs = status === 200 ? Math.max(1, Math.round(performance.now() - started)) : null;
        if (!cancelled) {
          lastPingMsRef.current = measuredMs;
          setPingMs((prev) => (prev === measuredMs ? prev : measuredMs));
        }
      } catch {
        if (!cancelled) {
          lastPingMsRef.current = null;
          setPingMs(null);
        }
      }
    };
    void check();
    const timer = window.setInterval(() => {
      if (!document.hidden) void check();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [company?.id, show, serverUrl]);

  if (!show) return null;
  const pingLabel = pingMs != null ? formatServerPing(pingMs) : "Offline";
  return (
    <>
      <button
        type="button"
        className={cn(
          chromeProPillCn,
          "flex h-9 min-w-0 shrink items-center gap-2 rounded-full px-3 text-left text-sm font-medium",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isMobile ? "max-w-[58px] justify-center px-2" : "max-w-[240px]"
        )}
        title={`PLServer: ${serverUrl}`}
        onClick={() => setDetailsOpen(true)}
      >
        {isMobile ? null : <Server className="h-4 w-4 shrink-0 text-blue-900" aria-hidden />}
        {isMobile ? null : <span className="max-w-44 truncate text-xs text-blue-900/80">{hostLabel}</span>}
        <span className={cn("shrink-0 text-xs font-semibold tabular-nums", pingMs != null ? "text-emerald-600" : "text-destructive")}>
          {pingLabel}
        </span>
      </button>
      {detailsOpen
        ? createPortal(
            <div className="fixed inset-0 z-[1000] flex items-start justify-end bg-black/20 p-2 pt-14" onClick={() => setDetailsOpen(false)}>
              <div
                className="w-[min(92vw,360px)] rounded-md border border-blue-300 bg-white p-3 text-xs shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">PL server ping</span>
                  <button type="button" className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" onClick={() => setDetailsOpen(false)}>
                    Close
                  </button>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Ping</span>
                    <span className={cn("font-semibold tabular-nums", pingMs != null ? "text-emerald-600" : "text-destructive")}>{pingLabel}</span>
                  </div>
                  <div>
                    <div className="mb-0.5 text-slate-500">URL</div>
                    <div className="break-all rounded border bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-800">{serverUrl}</div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export function DesktopAppHeader() {
  const { user, customUser } = useAuth();
  const {
    companyId,
    allCompanies: contextCompanies,
    allCompaniesRegistry,
    loading: companyContextLoading,
    localCompanyRegistryEpoch,
  } = useCompany();
  // Firestore merge alag; pathname sirf HeaderCompanyPickerIsland — sidebar navigate par parent header strip unnecessary re-render na ho.
  const [unfilteredHeaderCompanies, setUnfilteredHeaderCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const isSuperAdmin = customUser?.role === "SuperAdmin";
  const isSuperAdminByEmail = useMemo(() => {
    const e = (user?.email || "").toLowerCase().trim();
    if (!e) return false;
    return getSuperAdminEmails().some((x) => (x || "").toLowerCase().trim() === e);
  }, [user?.email]);
  const isSuperAdminUser = isSuperAdmin || isSuperAdminByEmail;

  // Header company list: context + SQLite local rows (naya offline create Firestore snapshot ke bina bhi dikhe).
  useEffect(() => {
    let cancelled = false;
    if (!user?.uid) {
      window.queueMicrotask(() => {
        if (cancelled) return;
        setLoading(Boolean(companyContextLoading));
        setUnfilteredHeaderCompanies([]);
        if (!companyContextLoading) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }
    const shareUser = { uid: user.uid, email: user.email ?? null };
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(Boolean(companyContextLoading));
      const mappedBase = (contextCompanies || [])
        .filter((c) => isCompanyVisibleInHeader(c as Company & { movedToAdminRecycleAt?: unknown }))
        .map((c) => ({
          ...c,
          isOwned: resolveCompanyIsOwnedForUser(c, shareUser),
        })) as Company[];
      let localRows: Company[] = [];
      try {
        localRows = (await listLocalCompanies())
          .filter(
            (r: { isDeleted?: boolean; movedToAdminRecycleAt?: unknown }) =>
              !r?.isDeleted && r?.movedToAdminRecycleAt == null
          )
          .map((r) => {
            const c = { ...(r as unknown as Company) };
            return {
              ...c,
              isOwned: resolveCompanyIsOwnedForUser(c, shareUser),
            } as Company;
          });
      } catch {
        /* SQLite unavailable */
      }
      if (cancelled) return;
      const byId = new Map<string, Company>();
      for (const c of mappedBase) {
        if (c?.id) byId.set(c.id, c);
      }
      for (const c of localRows) {
        if (!c?.id) continue;
        const stamped = stampPureLocalDeviceCompanyRow(c);
        if (byId.has(c.id)) {
          const existing = byId.get(c.id)!;
          if (isDeviceLocalCompany(stamped) && !isServerGateCompany(stamped)) {
            byId.set(c.id, {
              ...existing,
              ...stamped,
              isOwned: stamped.isOwned ?? existing.isOwned,
            });
          }
          continue;
        }
        byId.set(c.id, stamped);
      }
      setUnfilteredHeaderCompanies(Array.from(byId.values()));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, contextCompanies, companyContextLoading, localCompanyRegistryEpoch]);

  const onCompanyCreated = () => {
    // useCompany context listeners / registry mirror se list auto-update hoti hai.
    // The prop is still required by CompanyActions but can be a no-op.
  };

  /** Mobile: lambi toolbar — expand/chevron hata kar horizontal swipe scroll (footer toggle bhi hataya user ne) */
  const headerIsMobile = useIsMobile();
  const isApkPhoneFormFactor = useApkPhoneFormFactor();

  /** Mobile header row only ([data-pl-header-row="mobile"]; desktop row wraps, no scroll): mouse wheel (vertical) -> horizontal scroll jab content overflow ho. */
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const row = (e.target as Element | null)?.closest?.('[data-pl-header-row="mobile"]') as HTMLElement | null;
      if (!row || row.scrollWidth <= row.clientWidth + 1) return;
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!delta) return;
      const max = row.scrollWidth - row.clientWidth;
      if ((delta < 0 && row.scrollLeft <= 0) || (delta > 0 && row.scrollLeft >= max - 1)) return;
      e.preventDefault();
      row.scrollLeft += delta;
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    /** Mouse click-drag -> horizontal scroll (5px threshold); drag ke baad agla click suppress. */
    let drag: { row: HTMLElement; startX: number; startScroll: number; moved: boolean } | null = null;
    let suppressClick = false;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const row = (e.target as Element | null)?.closest?.('[data-pl-header-row="mobile"]') as HTMLElement | null;
      if (!row || row.scrollWidth <= row.clientWidth + 1) return;
      drag = { row, startX: e.clientX, startScroll: row.scrollLeft, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        drag.row.setAttribute("data-pl-header-dragging", "");
      }
      e.preventDefault();
      drag.row.scrollLeft = drag.startScroll - dx;
    };
    const onUp = () => {
      if (!drag) return;
      if (drag.moved) {
        suppressClick = true;
        drag.row.removeAttribute("data-pl-header-dragging");
        window.setTimeout(() => { suppressClick = false; }, 0);
      }
      drag = null;
    };
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("click", onClickCapture, true);
    };
  }, []);

  /** Electron `.exe`: pink header ki quick-action strip (Add Sale…) hide/show — localStorage + View menu sync */
  const isElectronDesk = isElectronDesktopApp();
  const [quickActionsCollapsed, setQuickActionsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(PL_DESKTOP_QUICK_ACTIONS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const sync = () => {
      try {
        setQuickActionsCollapsed(localStorage.getItem(PL_DESKTOP_QUICK_ACTIONS_KEY) === "1");
      } catch {
        setQuickActionsCollapsed(false);
      }
    };
    window.addEventListener("pl-desktop-quick-actions-toggle", sync);
    return () => window.removeEventListener("pl-desktop-quick-actions-toggle", sync);
  }, []);

  const toggleElectronQuickActionsRibbon = useCallback(() => {
    try {
      const nextHidden = localStorage.getItem(PL_DESKTOP_QUICK_ACTIONS_KEY) !== "1";
      if (nextHidden) localStorage.setItem(PL_DESKTOP_QUICK_ACTIONS_KEY, "1");
      else localStorage.removeItem(PL_DESKTOP_QUICK_ACTIONS_KEY);
      setQuickActionsCollapsed(nextHidden);
      window.dispatchEvent(new Event("pl-desktop-quick-actions-toggle"));
    } catch {
      setQuickActionsCollapsed((v) => !v);
    }
  }, []);

  return (
    <header className="relative sticky top-0 z-30 border-b border-sidebar-border bg-background px-[2px] py-0.5">
      {/* Static/Electron: icon sirf sidebar green brand card me — yahan extra black strip nahi (tab strip + duplicate lagta tha). */}
      {/* User request: single header card, but control alignment purane header flow jaisa rakho */}
      {/* User request: header container — Auto recurring card jaisa green (emerald) tone */}
      {/* User request: dono taraf ~2px — sidebar kinaare, avatar daen; beech me company truncate. */}
      {/* Mobile: yahan horizontal padding 0 — sirf outer header `px-[2px]` se sidebar kinaare 2px; desktop par andar +2px. */}
      <div
        className={cn(
          "pl-chrome-card app-chrome-top-ribbon pl-chrome-tone-emerald w-full min-w-0 py-1",
          headerIsMobile ? "px-0" : "px-[2px]"
        )}
      >
        {headerIsMobile ? (
          <div data-pl-header-row="mobile" className="flex w-full min-w-0 items-center">
            {/* Sidebar ↔ company: exactly 4px (`mr-1`); outer header se sidebar ~2px. */}
            {/* `data-pl-no-edge-swipe-capture`: document capture `preventDefault` edge strip is touch se header button na mare */}
            {isApkPhoneFormFactor ? null : (
              <div className="mr-1 flex shrink-0 items-center" data-pl-no-edge-swipe-capture>
                <SidebarTrigger className="touch-manipulation" />
              </div>
            )}
            <div data-pl-header-row-inner="" className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <div data-pl-header-company-slot="" className="min-w-0 flex-1">
                <HeaderCompanyPickerIsland
                  unfilteredHeaderCompanies={unfilteredHeaderCompanies}
                  contextCompanies={contextCompanies}
                  allCompaniesRegistry={allCompaniesRegistry}
                  loading={loading}
                  user={user}
                  isSuperAdminUser={isSuperAdminUser}
                  onCompanyCreated={onCompanyCreated}
                  mobileStrip
                />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <DateSystemSwitcher />
                {isApkPhoneFormFactor ? null : <HeaderViewModeToggle />}
                <AddNewButtonOnReportPage />
              </div>
            </div>
              <div className="ml-2 flex shrink-0 items-center gap-1">
                <HeaderSyncButton />
                <HeaderFirebaseToPbButton />
                <PlServerCompanyConnectionStatus />
                <DriveCloudSyncHeaderIndicator />
                <LanguageGlobeButton />
                <HeaderAppearanceMenu />
                <UserProfileButton />
              </div>
          </div>
        ) : (
          <div data-pl-header-row="desktop" className="flex w-full min-w-0 flex-wrap items-center gap-2">
            {/* `min-w-0` ta company `truncate` narrow window par kaam kare — sidebar↔company 4px (`gap-1`). */}
            <div className="flex min-w-0 items-center gap-1">
              {isApkPhoneFormFactor ? null : <SidebarTrigger />}
              {isElectronDesk ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 flex-shrink-0"
                  onClick={toggleElectronQuickActionsRibbon}
                  title={
                    quickActionsCollapsed
                      ? "Show quick actions (Add Sale, Payment…)"
                      : "Hide quick actions ribbon"
                  }
                  aria-label={
                    quickActionsCollapsed ? "Show quick actions ribbon" : "Hide quick actions ribbon"
                  }
                >
                  {quickActionsCollapsed ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronUp className="h-4 w-4" />
                  )}
                </Button>
              ) : null}
              <HeaderCompanyPickerIsland
                unfilteredHeaderCompanies={unfilteredHeaderCompanies}
                contextCompanies={contextCompanies}
                allCompaniesRegistry={allCompaniesRegistry}
                loading={loading}
                user={user}
                isSuperAdminUser={isSuperAdminUser}
                onCompanyCreated={onCompanyCreated}
              />
              <DateSystemSwitcher />
              {isApkPhoneFormFactor ? null : <HeaderViewModeToggle />}
            </div>

            {!(isElectronDesk && quickActionsCollapsed) ? <HeaderActions /> : null}

            <div className="h-0 w-0 grow-[9999] shrink-0 basis-0" />

            <div className="flex min-w-0 flex-shrink-0 items-center gap-2">
              {/* Desktop: pehle Add New (mobile pe stripe me profile ke pehle) — purani daen-cluster order */}
              <AddNewButtonOnReportPage />
              <HeaderSyncButton />
              <HeaderFirebaseToPbButton />
              <DriveCloudSyncHeaderIndicator />
              <PlServerCompanyConnectionStatus />
              <HeaderServerSwitch />
              <UserProfileButton />
              <CopyLedgerHeaderButton />
              <ShareForReconciliationHeaderButton />
              <LanguageGlobeButton />
              <HeaderAppearanceMenu />
              <GlobalFileHoverPreviewSwitch />
              <ScreenControls />
            </div>
          </div>
        )}
      </div>
      <HeaderAttachmentPrefetchStrip companyId={companyId} />
      <HeaderBackupActivityStrip />
    </header>
  );
}
