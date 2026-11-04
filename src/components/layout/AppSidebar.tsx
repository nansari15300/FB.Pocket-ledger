
"use client";

import { onSnapshot, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import {
  BookText,
  Factory,
  FilePenLine,
  Flame,
  LayoutDashboard,
  LogOut,
  ArrowLeft,
  Landmark,
  Receipt,
  Settings,
  FileText,
  PanelLeft,
  FilePieChart,
  Trash2,
  DollarSign,
  Banknote,
  Loader2,
  ListTree,
  CreditCard,
  UserPlus,
  Building2,
  ImageIcon,
  DoorOpen,
  Database,
  Mail, // Added Mail icon
  Users,
  Table,
  Cloud,
  CalendarDays,
  Briefcase,
  ZoomIn,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { pruneRememberedLoginEmailIfDisabled } from "@/lib/loginRememberEmail";
import React, { useEffect, useState, useCallback, useMemo, startTransition } from 'react';
import { doc, collection, query, where } from "@/lib/pbCompat/firestore";
import { isSuppressibleNewTransactionAlert } from "@/lib/transactionAlerts";
import { IC_ALERTS_CHANGED } from "@/lib/interCompany/interCompanyAlerts";
import { interCompanySystemJoinAlertVisibleForCompany } from "@/lib/interCompany/interCompanySystemJoinRequest";
import { usePendingInterCompanySystemJoinCount } from "@/lib/interCompany/usePendingInterCompanySystemJoinCount";
import { isInterCompanySystemEnabled } from "@/lib/interCompany/interCompanyEnabled";
import { messagesSidebarNavBadgeClassName } from "@/lib/messagesChrome";
import {
  COMPANY_STORAGE_TAB_FEATURE,
  COMPANY_STORAGE_TAB_FEATURE_LABEL,
} from "@/lib/companySelectorTabFeatures";

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import usePermissions from "@/hooks/usePermissions";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { firestore, auth, signOutWithFirestoreTeardown } from "@/lib/firebase";
import { useEmbeddedLogout } from "@/contexts/EmbeddedLogoutContext";
import type { Permission } from "@/lib/permissions";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { appNavHref, settingsViewHref } from "@/lib/appNavHref";
import { publicAssetUrl } from "@/lib/webAppBasePath";
import { trimEntityFileUrlForPreview } from "@/lib/trimEntityFileUrlForPreview";
import { AttachmentHoverPortal } from "@/components/vouchers/AttachmentHoverPortal";
import { PublicStaticImagePreviewBody } from "@/components/vouchers/attachmentHoverPreviewBody";
import {
  markMasterDetailSidebarListNav,
  masterDetailRouteKeyFromPath,
} from "@/lib/masterDetailSidebarNav";
import { masterDetailListHref } from "@/lib/masterDetailListPath";
import { disableLocalGuest, isLocalGuestEnabled } from "@/lib/localGuestSession";
import { useCachedFeatureConfig } from "@/hooks/useCachedFeatureConfig";
import { collectPartyIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesPartyLedger";
import { collectBankAccountIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesBankLedger";
import { collectItemIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesItemLedger";
import { STAFF_ENTITY_LABEL } from "@/lib/staffEntityDisplayName";
import { StaffEntityNavIcon } from "@/components/entity/StaffEntityIcon";
import { collectStaffIdsTouchedByUnapprovedVoucher } from "@/lib/voucherTouchesStaffLedger";
import { collectInterCompanyIdsForPendingApproval } from "@/lib/interCompany/interCompanyVoucherHydrate";
import { isStaticAppBuild } from "@/lib/isStaticAppBuild";
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative";
import { isElectronDesktopApp } from "@/lib/isElectronDesktop";
import { disarmDashboardRedirectGuard } from "@/lib/protectFromUnwantedDashboardRedirect";
import { AdjustScreenDialog } from "@/components/layout/AdjustScreenDialog";
import { DateConverterDialog } from "@/components/layout/DateConverterDialog";
import { chromeProPillCn } from "@/lib/chromePillButton";
import {
  goBackToPlServer,
  plServerBackToServerHref,
} from "@/lib/adminData/plServerMyCompanyHandoff";
import { isServerManageOnlyScope } from "@/lib/plServerPackedApp";


type MenuItem = {
  id: string;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission;
  permissionAny?: Permission[];
  /** Sidebar button opens a dialog instead of navigating. */
  sidebarAction?: "date-converter" | "adjust-screen";
};

/** Sidebar primary nav — menu items yahan; EXE tab titles: `getDashboardDocumentTitle` */
const allMenuItems: MenuItem[] = [
  { id: 'dashboard', href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: 'party', href: "/party", label: "Parties", icon: Users },
  { id: 'bank-cash', href: "/bank-cash", label: "Bank/Cash", icon: Landmark },
  { id: 'staff', href: "/staff", label: STAFF_ENTITY_LABEL, icon: StaffEntityNavIcon },
  { id: 'hr', href: "/hr", label: "HR", icon: Briefcase, permission: "hr_view" },
  { id: 'tax', href: "/tax", label: "Tax", icon: Banknote },
  { id: 'incomes', href: "/incomes", label: "Income & Expense", icon: DollarSign },
  { id: 'items', href: "/items", label: "Items & Service", icon: BookText },
  { id: 'reports', href: "/reports", label: "Reports", icon: FilePieChart, permission: "export_data" },
  { id: 'gallery', href: "/gallery", label: "Gallery", icon: ImageIcon },
  { id: 'gate', href: "/gate", label: "Gate", icon: DoorOpen },
  { id: 'date-converter', href: "#date-converter", label: "Date Converter", icon: CalendarDays, sidebarAction: "date-converter" },
  { id: 'production', href: "/production", label: "Production", icon: Factory },
  { id: 'sale-note', href: "/sale-note", label: "Sale Note", icon: FileText },
  { id: 'purchase-note', href: "/purchase-note", label: "Purchase Note", icon: FileText },
  { id: 'quotations', href: "/quotations", label: "Quotations", icon: FilePenLine },
];

/** Adjust Screen — all platforms; opens the live UI-zoom popup (not in ALL_FEATURES / feature toggles). */
const adjustScreenMenuItem: MenuItem = {
  id: 'adjust-screen',
  href: "#adjust-screen",
  label: "Adjust Screen",
  icon: ZoomIn,
  sidebarAction: "adjust-screen",
};

const bottomMenuItems: MenuItem[] = [
    { id: 'messages', href: "/messages", label: "Messages", icon: Mail },
    { id: 'drive-sync', href: settingsViewHref("local_cloud_sync"), label: "Google Drive sync", icon: Cloud },
    { id: 'billing', href: "/billing", label: "Billing & Plans", icon: CreditCard },
    { id: 'distributor-signup', href: "/distributor-signup", label: "Be a Distributor", icon: UserPlus },
    { id: 'backup', href: "/backup", label: "Backup & Restore", icon: Database, permissionAny: ["export_data", "import_data"] },
    { id: 'import-export', href: "/import-export", label: "Import/Export", icon: Table, permissionAny: ["export_data", "import_data"] },
    { id: 'recycle-bin', href: "/recycle-bin", label: "Recycle Bin", icon: Trash2, permission: "delete_records" },
    { id: 'settings', href: "/settings", label: "Settings", icon: Settings },
];

export type Feature = {
    id: string;
    label: string;
}

export const ALL_FEATURES: Feature[] = [
  ...[...allMenuItems, ...bottomMenuItems].map((item) => ({ id: item.id, label: item.label })),
  { id: COMPANY_STORAGE_TAB_FEATURE.parent, label: COMPANY_STORAGE_TAB_FEATURE_LABEL },
];


function filterByPermission<T extends { permission?: Permission; permissionAny?: Permission[] }>(
  items: T[],
  can: (p: Permission) => boolean
): T[] {
  return items.filter((item) => {
    if (item.permissionAny?.length) {
      return item.permissionAny.some((p) => can(p));
    }
    if (item.permission) {
      return can(item.permission);
    }
    return true;
  });
}

const ENTITY_IDS = ['party', 'bank-cash', 'staff', 'tax', 'items', 'incomes'] as const;

/** Primary nav list ke andar order: pehle yeh ids (dashboard→incomes), phir baaki menu items */
const CORE_NAV_IDS = new Set<string>([
  "dashboard",
  "party",
  "bank-cash",
  "staff",
  "tax",
  "incomes",
]);
const SIDEBAR_PENDING_BADGE_HARD_CAP = 1200;

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, customUser } = useAuth();
  const { requestEmbeddedLogout } = useEmbeddedLogout();
  const { can } = usePermissions();
  const { company, companyId, effectiveNotificationSettings } = useCompany();
  const {
    vouchers,
    processedStaff,
    processedTaxes,
    processedExpenseAccounts,
    processedParties,
    processedAccounts,
    processedItems,
  } = useVouchers();
  const { isOpen, isMobile, setIsOpen } = useSidebar();
  const [dateConverterOpen, setDateConverterOpen] = useState(false);
  const [adjustScreenOpen, setAdjustScreenOpen] = useState(false);
  const adjustScreenTimerRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (adjustScreenTimerRef.current != null) window.clearTimeout(adjustScreenTimerRef.current);
    },
    []
  );
  /** Date Converter — BS calendar; sirf Nepal company (header date menu jaisa). */
  const isNepalCompany = !company?.country || company.country === "Nepal";
  /**
   * EXE / APK / iOS / static export: plain <Link> soft-nav kabhi fail / redirect-guard se undo.
   * Client `router.push|replace` + pehle guard disarm — DashboardStatCardTxnLink jaisa.
   */
  const useEmbeddedClientNav =
    isStaticAppBuild() || isCapacitorNativeApp() || isElectronDesktopApp();
  const navigateSidebarHref = useCallback(
    (href: string) => {
      // Voucher save / online-resume guard warna intentional /dashboard click ko wapas undo kar deta tha.
      disarmDashboardRedirectGuard();
      const pathnameOnly = href.split("?")[0]?.split("#")[0] ?? href;
      const routeKey = masterDetailRouteKeyFromPath(pathnameOnly);
      // startTransition: nav pehle paint; SQLite/aggregate background me — 2–4s freeze feel kam.
      startTransition(() => {
        if (routeKey) {
          // Entity sidebar: list-only + replace — push stack (bank→party) hardware back galat page khole
          markMasterDetailSidebarListNav(routeKey);
          router.replace(appNavHref(masterDetailListHref(routeKey)), { scroll: false });
        } else {
          router.push(appNavHref(href), { scroll: false });
        }
      });
      if (isMobile) setIsOpen(false);
    },
    [router, isMobile, setIsOpen]
  );
  const onNavLinkClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (useEmbeddedClientNav) {
        e.preventDefault();
        e.stopPropagation();
        navigateSidebarHref(href);
        return;
      }
      if (isMobile) setIsOpen(false);
    },
    [useEmbeddedClientNav, navigateSidebarHref, isMobile, setIsOpen]
  );
  const [featureConfig, setFeatureConfig] = useState<Record<string, boolean> | null>(null);
  const defaultFeatureConfig = useMemo(() => {
    // Offline fallback: basic profile ke hisaab se selected premium menus default off rakho.
    return {
      dashboard: true,
      party: true,
      "bank-cash": true,
      staff: true,
      tax: true,
      incomes: true,
      items: true,
      reports: true,
      gallery: true,
      production: false,
      "sale-note": false,
      "purchase-note": false,
      quotations: false,
      messages: true,
      "drive-sync": true,
      gate: true,
      billing: true,
      "distributor-signup": false,
      backup: true,
      "import-export": true,
      "recycle-bin": true,
      settings: true,
    } as Record<string, boolean>;
  }, []);
  const { featureConfig: cachedFeatureConfig, loading: loadingFeatures } = useCachedFeatureConfig(defaultFeatureConfig);
  const [pendingHandovers, setPendingHandovers] = useState(0);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const myUserIds = useMemo(() => {
    const ids = new Set<string>();
    if (user?.uid) ids.add(user.uid);
    if (customUser?.userDocId) ids.add(customUser.userDocId);
    return Array.from(ids);
  }, [user?.uid, customUser?.userDocId]);

  const showApproveInSidebar =
    can("approve_transactions") &&
    effectiveNotificationSettings?.approve?.on !== false &&
    effectiveNotificationSettings?.approve?.onEntity !== false;

  const partyIdSetForSidebar = useMemo(
    () => new Set((processedParties || []).map((p: { id: string }) => p.id).filter(Boolean)),
    [processedParties]
  );
  // Bank/items: list-page jaisa — sirf is company ke master ids jo voucher line me dikhte hain
  const bankAccountIdSetForSidebar = useMemo(
    () => new Set((processedAccounts || []).map((a: { id: string }) => a.id).filter(Boolean)),
    [processedAccounts]
  );
  const itemIdSetForSidebar = useMemo(
    () => new Set((processedItems || []).map((i: { id: string }) => i.id).filter(Boolean)),
    [processedItems]
  );

  const pendingCountByEntity = useMemo(() => {
    const out: Record<string, number> = {};
    if (!showApproveInSidebar || !vouchers?.length) return out;
    if (vouchers.length > SIDEBAR_PENDING_BADGE_HARD_CAP) {
      // Large ledgers: per-voucher entity badge walk can freeze nav clicks; skip expensive sidebar counts.
      return out;
    }
    const pending = vouchers.filter((v: any) => v.isApproved !== true);
    const staffIdSet = new Set((processedStaff || []).map((s: any) => s.id));
    const taxIdSet = new Set((processedTaxes || []).map((t: any) => t.id));
    const expenseAccountIdSet = new Set((processedExpenseAccounts || []).map((a: any) => a.id));
    out.party = 0;
    out["bank-cash"] = 0;
    out.staff = 0;
    out.tax = 0;
    out.items = 0;
    out.incomes = 0;

    pending.forEach((v: any) => {
      // Party ledger jaisa: journal `entries` bina `partyId` — list/header pe count hai, sidebar pe pehle miss ho raha tha
      const hasParty = partyIdSetForSidebar.size > 0 && collectPartyIdsTouchedByUnapprovedVoucher(v, partyIdSetForSidebar).size > 0;
      const hasBankCash =
        bankAccountIdSetForSidebar.size > 0 &&
        collectBankAccountIdsTouchedByUnapprovedVoucher(v, bankAccountIdSetForSidebar).size > 0;
      const hasStaff =
        staffIdSet.size > 0 && collectStaffIdsTouchedByUnapprovedVoucher(v, staffIdSet).size > 0;
      const hasTax =
        (String(v.type || "") === "inter_company"
          ? collectInterCompanyIdsForPendingApproval(v, taxIdSet, "tax").size > 0
          : (v.taxAccountId && taxIdSet.has(v.taxAccountId)) ||
            (Array.isArray(v.lineItems) &&
              v.lineItems.some((l: any) => l.taxAccountId && taxIdSet.has(l.taxAccountId))) ||
            (Array.isArray(v.entries) &&
              v.entries.some((e: any) => e.accountId && taxIdSet.has(e.accountId))));
      const hasItems =
        itemIdSetForSidebar.size > 0 && collectItemIdsTouchedByUnapprovedVoucher(v, itemIdSetForSidebar).size > 0;
      const hasIncomes =
        String(v.type || "") === "inter_company"
          ? collectInterCompanyIdsForPendingApproval(v, expenseAccountIdSet, "expense").size > 0
          : (v.incomeAccountId && expenseAccountIdSet.has(v.incomeAccountId)) ||
            (v.expenseAccountId && expenseAccountIdSet.has(v.expenseAccountId)) ||
            (v.accountId && expenseAccountIdSet.has(v.accountId)) ||
            (Array.isArray(v.entries) &&
              v.entries.some((e: any) => e.accountId && expenseAccountIdSet.has(e.accountId)));

      if (hasParty) out.party += 1;
      if (hasBankCash) out["bank-cash"] += 1;
      if (hasStaff) out.staff += 1;
      if (hasTax) out.tax += 1;
      if (hasItems) out.items += 1;
      if (hasIncomes) out.incomes += 1;
    });
    return out;
  }, [
    vouchers,
    processedStaff,
    processedTaxes,
    processedExpenseAccounts,
    showApproveInSidebar,
    partyIdSetForSidebar,
    bankAccountIdSetForSidebar,
    itemIdSetForSidebar,
  ]);

  useEffect(() => {
    // Centralized cached feature hook use karo so super-admin settings local mode me bhi apply ho.
    setFeatureConfig(cachedFeatureConfig || defaultFeatureConfig);
  }, [cachedFeatureConfig, defaultFeatureConfig]);

  useEffect(() => {
    if (!user?.email || !user?.uid) return;

    // Handover notifications
    const handoverQuery = query(
      collection(firestore, "companies"),
      where("handoverTo", "==", user.email),
      where("handoverStatus", "==", "pending")
    );
    const unsubHandovers = onSnapshot(handoverQuery, (snapshot) => setPendingHandovers(snapshot.size));

    // Admin/Alarm/transaction alerts — sirf abhi selected company (cross-company badge galat na ho).
    const unreadAlertsByRecipient: Record<string, Set<string>> = {};
    const unreadIcSystemJoinsByRecipient: Record<string, Set<string>> = {};
    const alertsUnsubscribers: (() => void)[] = [];
    const recomputeUnreadAlerts = () => {
      const regular = new Set<string>();
      const firestoreIcReqIds = new Set<string>();
      Object.values(unreadAlertsByRecipient).forEach((set) => {
        set.forEach((raw) => {
          const parts = raw.split("::");
          const idPart = parts[0] || "";
          const kindPart = parts[1] || "";
          const icReqId = parts[2] || "";
          regular.add(idPart);
          if (kindPart === "ic_reverse_pending" && icReqId) firestoreIcReqIds.add(icReqId);
        });
      });
      Object.values(unreadIcSystemJoinsByRecipient).forEach((set) => {
        set.forEach((id) => regular.add(id));
      });
      const icLocalOnly = 0; // IC reverse-request feature removed
      setUnreadAlerts(regular.size + icLocalOnly);
    };
    const cid = companyId?.trim() || "";
    if (!cid) {
      setUnreadAlerts(0);
    } else {
      myUserIds.forEach((id) => {
        const alertsQuery = query(
          collection(firestore, "admin_notifications"),
          where("recipientUserId", "==", id),
          where("companyId", "==", cid),
          where("isRead", "==", false)
        );
        const unsubAlerts = onSnapshot(alertsQuery, (snapshot) => {
          unreadAlertsByRecipient[id] = new Set(
            snapshot.docs
              .filter((d) => !isSuppressibleNewTransactionAlert(d.data() as Record<string, unknown>))
              .map((d) => {
                const data = d.data() as { kind?: string; interCompanyRequestId?: string };
                return `${d.id}::${String(data?.kind || "")}::${String(data?.interCompanyRequestId || "")}`;
              })
          );
          recomputeUnreadAlerts();
        });
        alertsUnsubscribers.push(unsubAlerts);

        if (isInterCompanySystemEnabled()) {
          const systemJoinAlertsQuery = query(
            collection(firestore, "admin_notifications"),
            where("recipientUserId", "==", id),
            where("kind", "==", "ic_system_join_pending"),
            where("isRead", "==", false)
          );
          const unsubIcSystemJoin = onSnapshot(systemJoinAlertsQuery, (snapshot) => {
            const next = new Set<string>();
            snapshot.docs.forEach((d) => {
              if (interCompanySystemJoinAlertVisibleForCompany(d.data() as Record<string, unknown>, cid)) {
                next.add(d.id);
              }
            });
            unreadIcSystemJoinsByRecipient[id] = next;
            recomputeUnreadAlerts();
          });
          alertsUnsubscribers.push(unsubIcSystemJoin);
        }
      });
    }

    const onIcAlerts = () => recomputeUnreadAlerts();
    window.addEventListener(IC_ALERTS_CHANGED, onIcAlerts);

    // Unread Chat Messages (supports both uid + legacy userDocId participants/receiverId)
    const conversationUnreadCounts = new Map<string, number>();
    let messageUnsubscribers: (() => void)[] = [];
    const conversationDocsById = new Map<string, any>();
    const conversationUnsubscribers: (() => void)[] = [];

    const attachMessageListeners = () => {
      messageUnsubscribers.forEach((unsub) => unsub());
      messageUnsubscribers = [];
      conversationUnreadCounts.clear();

      const convDocs = Array.from(conversationDocsById.values());
      if (convDocs.length === 0) {
        setUnreadMessages(0);
        return;
      }

      convDocs.forEach((convDoc: any) => {
        const messagesQuery = query(collection(firestore, "conversations", convDoc.id, "messages"));
        const messageUnsub = onSnapshot(messagesQuery, (messageSnap) => {
          const unreadVisibleCount = messageSnap.docs.filter((messageDoc) => {
            const messageData: any = messageDoc.data();
            const deletedFor = Array.isArray(messageData?.deletedFor) ? messageData.deletedFor : [];
            return myUserIds.includes(messageData?.receiverId) && messageData?.status !== "read" && !deletedFor.includes(user.uid);
          }).length;
          conversationUnreadCounts.set(convDoc.id, unreadVisibleCount);
          const totalUnread = Array.from(conversationUnreadCounts.values()).reduce((a, b) => a + b, 0);
          setUnreadMessages(totalUnread);
        });
        messageUnsubscribers.push(messageUnsub);
      });
    };

    myUserIds.forEach((id) => {
      const conversationsQuery = query(
        collection(firestore, "conversations"),
        where("participants", "array-contains", id)
      );
      const unsubConversations = onSnapshot(conversationsQuery, (convSnap) => {
        convSnap.docs.forEach((d) => {
          conversationDocsById.set(d.id, { id: d.id, ...d.data() });
        });
        attachMessageListeners();
      });
      conversationUnsubscribers.push(unsubConversations);
    });


    return () => {
      unsubHandovers();
      alertsUnsubscribers.forEach((unsub) => unsub());
      window.removeEventListener(IC_ALERTS_CHANGED, onIcAlerts);
      conversationUnsubscribers.forEach((unsub) => unsub());
      messageUnsubscribers.forEach((unsub) => unsub());
    };
  }, [user?.email, user?.uid, myUserIds, companyId, company?.isOwned]);
  
  const displayName = user?.displayName || user?.email?.split('@')[0] || "User";
  const [showBackToServer, setShowBackToServer] = useState(false);
  useEffect(() => {
    setShowBackToServer(isServerManageOnlyScope() && !!plServerBackToServerHref());
  }, []);

  const handleLogout = () => {
    requestEmbeddedLogout();
  };

  const getInitials = (name: string | null | undefined) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("");
  };

  // Default to showing when not explicitly off (so ticked/default = show without needing save). Alerts only for company owner.
  const transactionAlerts = effectiveNotificationSettings?.transactionAlerts;
  const includeAlertsInSidebar = transactionAlerts?.on !== false && transactionAlerts?.onEntity !== false && company?.isOwned === true;
  /** Selected company par pending system join — alert doc miss ho to bhi Messages badge */
  const pendingSystemJoinForCompany = usePendingInterCompanySystemJoinCount({
    ownerUserId: user?.uid,
    companyId: company?.isOwned === true ? companyId : null,
  });
  const alertCountForSidebar = includeAlertsInSidebar
    ? Math.max(unreadAlerts, pendingSystemJoinForCompany)
    : 0;
  const totalNotifications = unreadMessages + alertCountForSidebar;
  const messageSettings = effectiveNotificationSettings?.message;
  const showMessageBadgeInSidebar =
    (messageSettings?.on !== false && messageSettings?.onEntity !== false) || includeAlertsInSidebar;
  const messagesBadgeCount = showMessageBadgeInSidebar ? totalNotifications : 0;
  const isMenuItemActive = useCallback(
    (item: MenuItem) => {
      const base = item.href.replace(/\/$/, "");
      if (pathname.startsWith(base)) return true;
      // Loan Overview lives under /loans but belongs to Loan & Staff entity nav.
      if (item.id === "staff" && pathname.startsWith("/loans")) return true;
      return false;
    },
    [pathname]
  );

  const visibleMenuItems = React.useMemo(() => {
    const byFeature = !featureConfig
      ? allMenuItems
      : allMenuItems.filter((item) => item.id === "import-export" || featureConfig[item.id] !== false);
    const byCountry = isNepalCompany
      ? byFeature
      : byFeature.filter((item) => item.id !== "date-converter");
    return filterByPermission(byCountry, can);
  }, [featureConfig, can, isNepalCompany]);

  React.useEffect(() => {
    if (!isNepalCompany && dateConverterOpen) setDateConverterOpen(false);
  }, [isNepalCompany, dateConverterOpen]);

  // CORE_NAV_IDS pehle wale 'Main' block order; baaki items uske peeche — ab dono ek hi emerald card me
  const combinedDashboardNavItems = React.useMemo(() => {
    const core = visibleMenuItems.filter((i) => CORE_NAV_IDS.has(i.id));
    const catalog = visibleMenuItems.filter((i) => !CORE_NAV_IDS.has(i.id));
    // Adjust Screen: Gallery ke baad (Gallery/Gate ke beech); Gallery hidden ho to Gate se pehle, warna end me.
    let at = catalog.findIndex((i) => i.id === "gallery");
    if (at >= 0) at += 1;
    else at = catalog.findIndex((i) => i.id === "gate");
    if (at < 0) at = catalog.length;
    const withAdjust = [...catalog.slice(0, at), adjustScreenMenuItem, ...catalog.slice(at)];
    return [...core, ...withAdjust];
  }, [visibleMenuItems]);

  const visibleBottomMenuItems = React.useMemo(() => {
    const byFeature = (!featureConfig ? bottomMenuItems : bottomMenuItems.filter((item) => {
      if (item.id === "billing") return true;
      if (item.id === "distributor-signup" && customUser?.role === "Distributor") {
        return false;
      }
      if (item.id === "import-export") return true;
      return featureConfig[item.id] !== false;
    }));
    return byFeature.filter((item) => item.id === "billing" || filterByPermission([item], can).length > 0);
  }, [featureConfig, customUser, can]);

  const openDateConverter = useCallback(() => {
    setDateConverterOpen(true);
    if (isMobile) setIsOpen(false);
  }, [isMobile, setIsOpen]);

  const openAdjustScreen = useCallback(() => {
    if (adjustScreenTimerRef.current != null) {
      window.clearTimeout(adjustScreenTimerRef.current);
      adjustScreenTimerRef.current = null;
    }
    if (isMobile) {
      // Mobile: pehle drawer band, uske baad popup (drawer exit animation + focus return ke baad).
      setIsOpen(false);
      adjustScreenTimerRef.current = window.setTimeout(() => {
        adjustScreenTimerRef.current = null;
        setAdjustScreenOpen(true);
      }, 350);
    } else {
      setAdjustScreenOpen(true);
    }
  }, [isMobile, setIsOpen]);

  /** Ek nav row — merged primary list + pehle jaisa pending badge / Reports pill */
  function renderMainNavRow(item: MenuItem) {
    if (item.sidebarAction) {
      const isAdjustScreen = item.sidebarAction === "adjust-screen";
      const button = (
        <SidebarMenuButton
          isActive={isAdjustScreen ? adjustScreenOpen : dateConverterOpen}
          tooltip={item.label}
          data-theme-nav={item.id}
        >
          <span className="relative flex shrink-0 items-center justify-center overflow-visible [&_svg]:size-5 [&_img]:size-5">
            <item.icon />
          </span>
          {isOpen && <span className="flex min-w-0 flex-1 truncate">{item.label}</span>}
        </SidebarMenuButton>
      );
      return (
        <SidebarMenuItem key={item.id}>
          <button
            type="button"
            className="w-full text-left appearance-none bg-transparent p-0 border-0 cursor-pointer"
            onClick={isAdjustScreen ? openAdjustScreen : openDateConverter}
          >
            {button}
          </button>
        </SidebarMenuItem>
      );
    }

    const pendingCount = ENTITY_IDS.includes(item.id as (typeof ENTITY_IDS)[number])
      ? (pendingCountByEntity[item.id] ?? 0)
      : 0;
    const showPendingBadge = pendingCount > 0;
    const tooltipText =
      pendingCount > 0 ? `${item.label} (${pendingCount} pending approval)` : item.label;
    const navHref = appNavHref(item.href);
    const pendingBadgeEl = showPendingBadge ? (
      <span className="pointer-events-none absolute top-0 right-0 flex h-4 min-w-[1rem] translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-pink-500 px-1 text-[10px] font-medium text-white">
        {pendingCount}
      </span>
    ) : null;
    const iconEl = (
      <span className="relative flex shrink-0 items-center justify-center overflow-visible [&_svg]:size-5 [&_img]:size-5">
        <item.icon />
        {pendingBadgeEl}
      </span>
    );
    const button = (
      <SidebarMenuButton isActive={isMenuItemActive(item)} tooltip={tooltipText} data-theme-nav={item.id}>
        {iconEl}
        {isOpen && (
          <span className="truncate">{item.label}</span>
        )}
      </SidebarMenuButton>
    );
    return (
      <SidebarMenuItem key={item.href}>
        {useEmbeddedClientNav ? (
          <button
            type="button"
            className="w-full text-left appearance-none bg-transparent p-0 border-0 cursor-pointer"
            onClick={() => navigateSidebarHref(item.href)}
          >
            {button}
          </button>
        ) : (
          <Link prefetch={false} href={navHref} passHref onClick={(e) => onNavLinkClick(e, item.href)}>
            {button}
          </Link>
        )}
      </SidebarMenuItem>
    );
  }

  function renderBottomNavRow(item: MenuItem) {
    const badgeCount = item.id === "settings" ? pendingHandovers : item.id === "messages" ? messagesBadgeCount : 0;
    const showBadge = badgeCount > 0;
    const navHref = appNavHref(item.href);
    const button = (
      <SidebarMenuButton isActive={isMenuItemActive(item)} tooltip={item.label} data-theme-nav={item.id}>
        <span className="relative flex shrink-0 items-center justify-center overflow-visible [&_svg]:size-5 [&_img]:size-5">
          <item.icon />
          {showBadge && (
            <span className={messagesSidebarNavBadgeClassName}>
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          )}
        </span>
        {isOpen && <span className="flex-1 truncate">{item.label}</span>}
      </SidebarMenuButton>
    );
    return (
      <SidebarMenuItem key={item.href}>
        {useEmbeddedClientNav ? (
          <button
            type="button"
            className="w-full text-left appearance-none bg-transparent p-0 border-0 cursor-pointer"
            onClick={() => navigateSidebarHref(item.href)}
          >
            {button}
          </button>
        ) : (
          <Link prefetch={false} href={navHref} passHref onClick={(e) => onNavLinkClick(e, item.href)}>
            {button}
          </Link>
        )}
      </SidebarMenuItem>
    );
  }

  const userProfileSection = (
      <div className="flex flex-col">
      <div className={cn("flex items-center gap-3", "p-2")}>
          <Avatar className="h-10 w-10">
            <AvatarImage src={user?.photoURL ?? undefined} alt={displayName ?? "User"} />
            <AvatarFallback>{getInitials(displayName ?? user?.email)}</AvatarFallback>
          </Avatar>
          {isOpen && (
            <div className="flex min-w-0 flex-col overflow-hidden">
                <p className="truncate text-sm font-medium">
                {displayName}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                {user?.email}
                </p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={handleLogout}
            aria-label="Log out"
          >
            <LogOut />
          </Button>
        </div>
        {showBackToServer ? (
          <div className="px-2 pb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full gap-1.5"
              title="Back to server"
              onClick={() => goBackToPlServer()}
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              {isOpen ? <span className="truncate">Back to server</span> : null}
            </Button>
          </div>
        ) : null}
      </div>
  );

  const sidebarBrandPreviewUrl =
    trimEntityFileUrlForPreview(company?.logoUrl) || publicAssetUrl("/app-icon.png");
  const sidebarBrandAppIconUrl = publicAssetUrl("/app-icon.png");
  const sidebarBrandIconEl = (
    <div
      data-pl-sidebar-brand-icon
      className={cn(
        "flex h-11 w-11 shrink-0 overflow-hidden rounded-lg",
        chromeProPillCn
      )}
    >
      <AttachmentHoverPortal
        clickOpensPreview
        triggerClassName="flex h-full w-full cursor-pointer items-center justify-center overflow-hidden border-0 bg-transparent p-0 shadow-none hover:bg-transparent"
        preview={<PublicStaticImagePreviewBody url={sidebarBrandAppIconUrl} />}
      >
        <img
          src={sidebarBrandPreviewUrl}
          alt=""
          className="pointer-events-none h-full w-full object-contain"
          loading="eager"
          decoding="async"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = "flex";
          }}
        />
        <span className="hidden h-full w-full items-center justify-center text-primary [&_svg]:size-6">
          <Flame />
        </span>
      </AttachmentHoverPortal>
    </div>
  );

  return (
    <>
    <Sidebar>
      <DateConverterDialog open={dateConverterOpen} onOpenChange={setDateConverterOpen} />
      <SidebarHeader className="shrink-0">
        {/* Brand icon → portal preview; blue Company → /company only */}
        {useEmbeddedClientNav ? (
          <div className="pl-chrome-card app-chrome-top-ribbon pl-chrome-tone-emerald w-full flex items-center justify-start gap-2 py-2 pl-0 pr-2">
            {sidebarBrandIconEl}
            {isOpen ? (
              <div className="min-w-0 flex flex-col items-start justify-center leading-tight">
                <span className="font-headline w-full truncate text-left text-base font-semibold sm:text-lg">
                  Pocket Ledger
                </span>
                <button
                  type="button"
                  className={cn(
                    "mt-0.5 appearance-none bg-transparent p-0 border-0 cursor-pointer text-left text-sm font-medium text-blue-600 underline-offset-2 hover:underline hover:text-blue-700",
                    pathname.startsWith("/company") && "underline text-blue-700"
                  )}
                  title="Select company"
                  onClick={() => navigateSidebarHref("/company")}
                >
                  Company
                </button>
              </div>
            ) : (
              <span className="sr-only">Pocket Ledger — Company</span>
            )}
          </div>
        ) : (
          <div className="pl-chrome-card app-chrome-top-ribbon pl-chrome-tone-emerald w-full flex items-center justify-start gap-2 py-2 pl-0 pr-2">
            {sidebarBrandIconEl}
            {isOpen ? (
              <div className="min-w-0 flex flex-col items-start justify-center leading-tight">
                <span className="font-headline w-full truncate text-left text-base font-semibold sm:text-lg">
                  Pocket Ledger
                </span>
                <Link
                  prefetch={false}
                  href={appNavHref("/company")}
                  onClick={(e) => onNavLinkClick(e, "/company")}
                  className={cn(
                    "mt-0.5 text-sm font-medium text-blue-600 underline-offset-2 hover:underline hover:text-blue-700",
                    pathname.startsWith("/company") && "underline text-blue-700"
                  )}
                  title="Select company"
                >
                  Company
                </Link>
              </div>
            ) : (
              <span className="sr-only">Pocket Ledger — Company</span>
            )}
          </div>
        )}
      </SidebarHeader>

      {/* SidebarContent: flex-col + overflow-hidden — Account/Profile neeche pin; lambi nav upar scroll; default overflow-y-auto yahan suppressed */}
      <SidebarContent className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-hidden">
        {loadingFeatures ? (
          <div className="flex h-full flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            {/* flex-1: bachi hui sidebar height — mint nav yahi andar scroll (footer hamesha dikhayi de) */}
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col gap-[8px]",
                isMobile
                  ? "basis-0"
                  : "overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
              )}
            >
              {/* User request: Main + More ek hi mint/emerald chrome card — do alag pink/green boxes nahi */}
              {combinedDashboardNavItems.length > 0 && (
                <div
                  className={cn(
                    "pl-chrome-card app-chrome-top-ribbon pl-chrome-tone-emerald w-full p-2",
                    isMobile
                      ? "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
                      : "shrink-0"
                  )}
                >
                  <SidebarMenu className="gap-2 px-0 py-0">
                    {combinedDashboardNavItems.map((item) => (
                      <React.Fragment key={item.href}>
                        {renderMainNavRow(item)}
                      </React.Fragment>
                    ))}
                  </SidebarMenu>
                </div>
              )}
            </div>

            {/* User request: Account + profile ko viewport ke sidebar bottom par chipkana */}
            <div className={cn(isMobile ? "contents" : "mt-auto flex shrink-0 flex-col gap-[8px]")}>
              <div
                className={cn(
                  "pl-chrome-card app-chrome-top-ribbon pl-chrome-tone-amber w-full p-2",
                  isMobile
                    ? "min-h-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"
                    : "shrink-0"
                )}
              >
                {isOpen ? (
                  <>
                    <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Account</p>
                  </>
                ) : null}
                <SidebarMenu className="gap-2 px-0 py-0">{visibleBottomMenuItems.map(renderBottomNavRow)}</SidebarMenu>
              </div>
              {/* User request: profile/user card ko green tone me dikhana */}
              <div className="pl-chrome-card app-chrome-top-ribbon pl-chrome-tone-emerald w-full shrink-0 overflow-hidden p-0">{userProfileSection}</div>
            </div>
          </>
        )}
      </SidebarContent>
    </Sidebar>
    {/* Outside <Sidebar>: mobile drawer band hone par bhi popup unmount na ho. */}
    <AdjustScreenDialog open={adjustScreenOpen} onOpenChange={setAdjustScreenOpen} />
    </>
  );
}

