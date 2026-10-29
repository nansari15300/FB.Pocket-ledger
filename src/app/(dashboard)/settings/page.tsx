
"use client";

import { Suspense, useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { isEmbeddedDeviceLockShell } from "@/lib/embeddedDeviceLock";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Share2, Loader2, Hash, Palette, FileDigit, Zap, Building, ShieldAlert, Bell, Smartphone, ChevronLeft, PanelLeft, PanelRight, CalendarRange, LockKeyhole, Cloud, Server, Link2, Activity, Globe } from "lucide-react";
import { ManageShare } from "@/components/company/ManageShare";
import usePermissions from "@/hooks/usePermissions";
import { useCompany } from "@/hooks/useCompany";
import { useAuth } from "@/hooks/useAuth";
import { PermissionRouteGuard } from "@/components/permission/PermissionRouteGuard";
import { VoucherSettings } from "@/components/settings/VoucherSettings";
import { ThemeSettings } from "@/components/settings/ThemeSettings";
import { AnimationSettings } from "@/components/settings/AnimationSettings";
import { HandoverManager } from "@/components/settings/HandoverManager";
import { CompanySettings } from "@/components/settings/CompanySettings";
import { DangerZone } from "@/components/settings/DangerZone";
import { CurrencySettings } from "@/components/settings/CurrencySettings";
import { LinkAllocationSettings } from "@/components/settings/LinkAllocationSettings";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { FiscalSplitSettings } from "@/components/settings/FiscalSplitSettings";
import { AppLockSettings } from "@/components/settings/AppLockSettings";
import { ManageDevices } from "@/components/settings/ManageDevices";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSettingsList } from "@/contexts/SettingsListContext";
import {
    useEdgeSwipeDocumentCapture,
    type EdgeSwipeDocumentOptions,
} from "@/hooks/useMobileEdgeSwipe";
import { readSelectedCompanyId } from "@/lib/selectedCompanyStorage";
import { LocalCloudSyncSettingsPage } from "@/components/settings/LocalCloudSyncSettingsPage";
import { LocalAppServerSettings } from "@/components/settings/LocalAppServerSettings";
import { MyRoleButton } from "@/components/settings/MyRoleButton";
import { CheckForUpdateSettingsRow } from "@/components/settings/CheckForUpdateSettingsRow";
import { CountryAppSettings } from "@/components/settings/CountryAppSettings";
import { OnlineTriggerLogSettings } from "@/components/settings/OnlineTriggerLogSettings";
import { isLocalAppServerSettingsNavVisible } from "@/lib/localAppServerDevPreview";
import { settingsViewHref } from "@/lib/appNavHref";
import type { UserRole } from "@/hooks/usePermissions";
import { masterListSelectedCn, masterListUnselectedCn } from "@/lib/listSelectionChrome";

/** Settings list horizontal inset — scroll shell par ek hi layer taake left/right dono 4px barabar (ul par duble na ho) */
const SETTINGS_NAV_INSET_X = "px-[4px]";

/** Settings nav column — dashboard-jaisa halka sky fill + baen ribbon; device cards se grid gap 5px (page grid). */
/** Settings nav shell — normal 1px black border (pehle `border-2` moti dikhti thi) */
const SETTINGS_LIST_SHELL =
  "app-chrome-sidebar-ribbon pl-settings-list-shell pl-dashboard-tone-card pl-dashboard-ribbon-emerald w-full min-w-0 rounded-lg border bg-card overflow-hidden shadow-none";
/** Header ↔ items split — 1px divider */
const SETTINGS_LIST_HEADER_RULE =
  "border-b border-emerald-400/55";
/** Mobile detail: footer bar — 1px divider */
const SETTINGS_MOBILE_DETAIL_FOOTER_RULE =
  "border-t border-black bg-background dark:border-black";

/** Daen kinara ~10mm — document capture; company/share/voucher… sab detail par list sheet swipe */
const SETTINGS_LIST_SHEET_RIGHT_EDGE_OPTS: EdgeSwipeDocumentOptions = { edgeWidthMm: 10 };

/**
 * Ek nav row — `PartyList.tsx` `cardClassName` ke saath align (selected = primary border + secondary fill).
 * Native `button` taake ghost/outline variant se border fight na ho.
 */
function settingsNavRowClass(isActive: boolean, isDanger?: boolean, collapsed?: boolean) {
  return cn(
    "pl-settings-nav-row pl-dashboard-tone-card pl-dashboard-ribbon-emerald",
    "min-w-0 max-w-full w-full overflow-hidden rounded-lg py-2",
    collapsed ? "justify-center px-1" : "px-3 gap-3 text-left",
    "cursor-pointer transition-all duration-200",
    "flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    isActive ? cn("font-bold", masterListSelectedCn) : cn(masterListUnselectedCn, "bg-card"),
    isDanger && !isActive && "text-destructive hover:text-destructive",
    isDanger && isActive && "text-destructive"
  );
}

const settingsNavItems = [
    { id: "local_cloud_sync", title: "Google Drive sync", icon: Cloud, permission: "configure_company_settings" as const, href: null },
    { id: "local_app_server", title: "Server", icon: Server, permission: "configure_company_settings" as const, href: null },
    { id: "company", title: "Company Profile", icon: Building, permission: "configure_company_settings" as const, href: null },
    { id: "sharing", title: "Manage Sharing", icon: Share2, permission: "manage_users_roles" as const, href: null },
    // Device sync settings (synced devices management).
    { id: "devices", title: "Device sync", icon: Smartphone, permission: "configure_company_settings" as const, href: null },
    { id: "online_trigger_log", title: "Log of online trigger", icon: Activity, permission: "configure_company_settings" as const, href: null },
    // EXE/APK: 6-digit PIN + optional biometric — nav mein sirf native shell par (neeche `shellLockEligible` filter).
    { id: "app_lock", title: "App Lock", icon: LockKeyhole, permission: "configure_company_settings" as const, href: null },
    { id: "voucher", title: "Voucher Settings", icon: FileDigit, permission: "configure_company_settings" as const, href: null },
    { id: "link_allocation", title: "Link allocation", icon: Link2, permission: "configure_company_settings" as const, href: null },
    { id: "country", title: "Country", icon: Globe, permission: "configure_company_settings" as const, href: null },
    { id: "theme", title: "Theme Settings", icon: Palette, permission: "configure_company_settings" as const, href: null },
    { id: "animation", title: "Animation Settings", icon: Zap, permission: "configure_company_settings" as const, href: null },
    { id: "decimals", title: "Decimal Settings", icon: Hash, permission: "configure_company_settings" as const, href: null },
    { id: "fiscal_split", title: "Fiscal year & split", icon: CalendarRange, permission: "configure_company_settings" as const, href: null },
    { id: "notification", title: "Notification", icon: Bell, permission: "configure_company_settings" as const, href: null },
    { id: "danger-zone", title: "Danger Zone", icon: ShieldAlert, permission: "configure_company_settings" as const, href: null, isDanger: true },
];

const SETTINGS_TAB_SESSION_KEY = "pl_settings_active_tab";

/** Purana LS key — usePageMemory hata kar hataya; NAVIGATION_MEMORY_KEYS me abhi naam reh sakta hai */
const LEGACY_SETTINGS_LS_KEY = "settingsPageState";

/** Tab memory company-scoped taake switch par galat voucher/sharing restore na ho; key company ke bina sirf transient */
function settingsTabSessionStorageKey(companyIdForTab: string | null): string {
    return companyIdForTab ? `${SETTINGS_TAB_SESSION_KEY}::${companyIdForTab}` : `${SETTINGS_TAB_SESSION_KEY}::pending`;
}

/** Session se tab: pehle nayi key, phir purani global (migrate) — stale sharing overwrite kam */
function readPersistedSettingsTab(companyIdForTab: string | null): string | null {
    try {
        if (typeof sessionStorage === "undefined") return null;
        const k = settingsTabSessionStorageKey(companyIdForTab);
        let v = sessionStorage.getItem(k);
        // Purani single-key entries (pre company-scope) ek daf’a fallback — phir migrate write se nayi key par shift
        if (!v) v = sessionStorage.getItem(SETTINGS_TAB_SESSION_KEY);
        return v;
    } catch {
        return null;
    }
}

/**
 * APK/static: Next router.replace kabhi turant browser address bar sync nahi karta; refresh par ?view gum ho sakta hai.
 * replaceState se current pathname + query lock karo (trailing slash wala path preserve).
 */
function syncSettingsViewQueryToBrowser(viewId: string) {
    if (process.env.NEXT_PUBLIC_STATIC_BUILD !== "1" || typeof window === "undefined") return;
    try {
        const u = new URL(window.location.href);
        u.searchParams.set("view", viewId);
        window.history.replaceState(window.history.state ?? null, "", u.pathname + u.search + u.hash);
    } catch {
        /* ignore */
    }
}

/** Narrow viewport — must match SSR (false) on first client paint or hydration breaks (grid+aside vs mobile chrome). */
function useLayoutNarrow767(): boolean {
    const [narrow, setNarrow] = useState(false);
    useLayoutEffect(() => {
        const mq = window.matchMedia("(max-width: 767px)");
        const fn = () => setNarrow(mq.matches);
        fn();
        mq.addEventListener("change", fn);
        return () => mq.removeEventListener("change", fn);
    }, []);
    return narrow;
}

function SettingsPageContent() {
    const { can } = usePermissions();
    const { user, loading: authLoading } = useAuth();
    /** `loading`: company list / selection hydrate — isse pehle permissions+nav partial ho sakta hai */
    const { company, companyId, loading: companiesLoading } = useCompany();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const isMobile = useIsMobile();
    const layoutNarrow = useLayoutNarrow767();
    /** Mobile-style settings: `use-mobile` + narrow (APK ab bhi width se isMobile — Chrome jaisa) */
    const mobileSettingsUx = isMobile || layoutNarrow;
    const { settingsListOpen, setSettingsListOpen } = useSettingsList();

    const [activeView, setActiveView] = useState<string>("");
    const SETTINGS_LIST_COLLAPSE_KEY = "pl-settings-list-collapsed";
    const [desktopSettingsListOpen, setDesktopSettingsListOpen] = useState(true);
    useLayoutEffect(() => {
        try {
            setDesktopSettingsListOpen(localStorage.getItem(SETTINGS_LIST_COLLAPSE_KEY) !== "1");
        } catch {
            /* ignore */
        }
    }, []);
    const toggleDesktopSettingsList = useCallback(() => {
        setDesktopSettingsListOpen((prev) => {
            const next = !prev;
            try {
                localStorage.setItem(SETTINGS_LIST_COLLAPSE_KEY, next ? "0" : "1");
            } catch {
                /* ignore */
            }
            return next;
        });
    }, []);
    const settingsListToggleBtnClass =
        "h-7 w-7 shrink-0 rounded-full border-blue-300/90 bg-blue-100 text-blue-900 shadow-sm hover:bg-blue-200 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100 dark:hover:bg-blue-900/50";

    const canConfigureCompany = can("configure_company_settings");
    const devServerNav = process.env.NODE_ENV === "development";
    /** EXE/APK par App Lock nav dikhao — `window` SSR par missing ho sakta hai; layout effect se client par sync. */
    const [shellLockEligible, setShellLockEligible] = useState(false);
    const [shellServerNavEligible, setShellServerNavEligible] = useState(
        () => devServerNav || (typeof window !== "undefined" ? isLocalAppServerSettingsNavVisible() : false)
    );
    useLayoutEffect(() => {
        setShellLockEligible(isEmbeddedDeviceLockShell());
        setShellServerNavEligible(isLocalAppServerSettingsNavVisible());
    }, []);
    /** Owner ne company settings band kiya ho — shared user ko theme/animation phir bhi (local-only). */
    const sharedLocalAppearanceOnly = Boolean(
        companyId && company && company.isOwned === false && !canConfigureCompany
    );
    const availableNavItems = useMemo(() => {
        const allowed = settingsNavItems.filter((item) => {
            if (item.id === "local_cloud_sync") return true;
            if (item.id === "country") return true;
            if (item.id === "app_lock") return shellLockEligible;
            if (item.id === "local_app_server") return devServerNav || shellServerNavEligible;
            if (item.id === "company") return Boolean(companyId && company);
            return can(item.permission);
        });
        if (!allowed.some((i) => i.id === "local_cloud_sync")) {
            const driveItem = settingsNavItems.find((i) => i.id === "local_cloud_sync");
            if (driveItem) allowed.unshift(driveItem);
        }
        if (
            (devServerNav || shellServerNavEligible) &&
            !allowed.some((i) => i.id === "local_app_server")
        ) {
            const serverItem = settingsNavItems.find((i) => i.id === "local_app_server");
            if (serverItem) allowed.splice(1, 0, serverItem);
        }
        if (!sharedLocalAppearanceOnly) return allowed;
        const extra = settingsNavItems.filter(
            (item) =>
                (item.id === "theme" || item.id === "animation") && !allowed.some((a) => a.id === item.id)
        );
        return [...allowed, ...extra];
    }, [can, sharedLocalAppearanceOnly, shellLockEligible, shellServerNavEligible, devServerNav, companyId, company]);
    const navItemsForUi = useMemo(() => {
        if (availableNavItems.length > 0) return availableNavItems;
        const driveOnly = settingsNavItems.filter((i) => i.id === "local_cloud_sync");
        return driveOnly.length > 0 ? driveOnly : availableNavItems;
    }, [availableNavItems]);
    const canOpenThemeOrAnimation = canConfigureCompany || sharedLocalAppearanceOnly;

    /** URL ya session me non-sharing tab maanga ho lekin nav abhi sirf Sharing (permissions hydrate race) — tab redirect / highlight mat lagao */
    const wantsNonSharingTab = useMemo(() => {
        const rawView = searchParams.get("view");
        const persisted = readPersistedSettingsTab(companyId);
        const viewNonSharing = Boolean(rawView && rawView !== "" && rawView !== "sharing");
        const persistedNonSharing = Boolean(persisted && persisted !== "sharing");
        return viewNonSharing || persistedNonSharing;
    }, [searchParams, companyId]);

    /** Owner / apni company: refresh par kabhi pehla frame sirf Sharing (customUser/role hydrate) — default Sharing sticky na ho */
    const isLikelyOwnerOrOwnedCompany = useMemo(() => {
        if (!company || !user?.uid) return false;
        if (company.isOwned === true) return true;
        if (company.ownerId && company.ownerId === user.uid) return true;
        const oe = String(company.ownerEmail || "").toLowerCase().trim();
        const ue = String(user.email || "").toLowerCase().trim();
        return Boolean(oe && ue && oe === ue);
    }, [company, user]);

    /** Nav + tab init tab tak roko jab tak auth/company list ready na ho, ya sirf-Sharing transient (viewer staff par stall infinite nahi — owner match ke bina nahi) */
    const settingsNavTransientStall = Boolean(
        authLoading ||
            companiesLoading ||
            (company &&
                user &&
                availableNavItems.length === 1 &&
                availableNavItems[0]?.id === "sharing" &&
                (wantsNonSharingTab || isLikelyOwnerOrOwnedCompany))
    );

    /** Stall ke baad bhi list galat rahe to menu dikhado (infinite spinner na ho) */
    const [settingsNavStallBypass, setSettingsNavStallBypass] = useState(false);
    const stallBypassTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (stallBypassTimerRef.current != null) {
            clearTimeout(stallBypassTimerRef.current);
            stallBypassTimerRef.current = null;
        }
        if (!settingsNavTransientStall) {
            setSettingsNavStallBypass(false);
            return;
        }
        setSettingsNavStallBypass(false);
        stallBypassTimerRef.current = setTimeout(() => {
            stallBypassTimerRef.current = null;
            setSettingsNavStallBypass(true);
        }, 700);
        return () => {
            if (stallBypassTimerRef.current != null) {
                clearTimeout(stallBypassTimerRef.current);
                stallBypassTimerRef.current = null;
            }
        };
    }, [settingsNavTransientStall]);

    const settingsNavStall = settingsNavTransientStall && !settingsNavStallBypass;

    /** Ek daf'a purani `settingsPageState` LS hata — usePageMemory ab settings me nahi — stale "sharing" override band */
    useEffect(() => {
        try {
            localStorage.removeItem(LEGACY_SETTINGS_LS_KEY);
        } catch {
            /* ignore */
        }
    }, []);

    /** Valid tab ko company-scoped sessionStorage me rakho — company load se pehle galat nav list se overwrite na ho */
    useEffect(() => {
        if (settingsNavStall) return;
        if (!activeView || !navItemsForUi.some((i) => i.id === activeView)) return;
        try {
            const k = settingsTabSessionStorageKey(companyId);
            sessionStorage.setItem(k, activeView);
            // Purani global key hata do taake fallback sharing purane session se na aaye (company-scoped source of truth)
            if (k !== SETTINGS_TAB_SESSION_KEY) sessionStorage.removeItem(SETTINGS_TAB_SESSION_KEY);
        } catch {
            /* ignore */
        }
    }, [activeView, navItemsForUi, companyId, settingsNavStall]);

    // Paint se pehle: ?view= (React + window) → valid tab; phir session fallback; invalidate URL mat rakho Manage Sharing tak
    useLayoutEffect(() => {
        if (settingsNavStall) return;
        if (navItemsForUi.length === 0) return;
        if (companyId && !company) {
            const pendingView =
                searchParams.get("view") ??
                (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null);
            if (pendingView !== "local_cloud_sync") return;
        }

        const fromReact = searchParams.get("view");
        const fromWindow =
            typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null;
        const rawView = fromReact ?? fromWindow;
        const viewAllowed =
            rawView != null &&
            rawView !== "" &&
            navItemsForUi.some((item) => item.id === rawView);
        const viewOk = viewAllowed ? rawView : null;

        if (viewOk) {
            setActiveView(viewOk);
            syncSettingsViewQueryToBrowser(viewOk);
            if (!fromReact && fromWindow && !mobileSettingsUx) {
                router.replace(`${pathname}?view=${encodeURIComponent(fromWindow)}`, { scroll: false });
            }
            return;
        }

        /* Mobile narrow: khali rawView ⇒ list-first; ghair-valid ?view ⇒ bhi list */
        if (mobileSettingsUx && !rawView) {
            setActiveView("");
            return;
        }
        if (mobileSettingsUx && rawView && !viewOk) {
            setActiveView("");
            router.replace(pathname, { scroll: false });
            return;
        }

        if (!mobileSettingsUx) {
            const persisted = readPersistedSettingsTab(companyId);
            if (persisted && navItemsForUi.some((i) => i.id === persisted)) {
                setActiveView(persisted);
                router.replace(`${pathname}?view=${encodeURIComponent(persisted)}`, { scroll: false });
                syncSettingsViewQueryToBrowser(persisted);
                return;
            }

            /* Ghair-valid ?view= hata kar pehla allowed tab — sharing pe sticky na rah jaye */
            if (rawView && !viewOk) {
                const firstId = navItemsForUi[0]?.id ?? "local_cloud_sync";
                setActiveView(firstId);
                router.replace(`${pathname}?view=${encodeURIComponent(firstId)}`, { scroll: false });
                syncSettingsViewQueryToBrowser(firstId);
                return;
            }

            const first = navItemsForUi[0]?.id ?? "local_cloud_sync";
            setActiveView((prev) => (prev === "" ? first : prev));
        }
    }, [searchParams, navItemsForUi, mobileSettingsUx, pathname, router, companyId, company, settingsNavStall]);

    // Shared user: URL / memory me `company` ho sakta hai jab wo ab nav me nahi — pehli allowed tab par le aao.
    useEffect(() => {
        if (settingsNavStall) return;
        if (companyId && !company) return;
        if (navItemsForUi.length === 0) return;
        /** Mobile list-first: khali activeView valid — yahan first tab mat thopo */
        if (mobileSettingsUx && activeView === "") return;
        /** Layout init abhi nahi hua / wait */
        if (!activeView) return;
        if (navItemsForUi.some((i) => i.id === activeView)) return;
        const next = navItemsForUi[0].id;
        setActiveView(next);
        if (!mobileSettingsUx) {
            router.replace(`${pathname}?view=${encodeURIComponent(next)}`, { scroll: false });
            syncSettingsViewQueryToBrowser(next);
        }
    }, [company, companyId, navItemsForUi, activeView, mobileSettingsUx, pathname, router, settingsNavStall]);

    const setActiveViewWithUrl = useCallback(
        (id: string) => {
            setActiveView(id);
            const next = `${pathname}?view=${encodeURIComponent(id)}`;
            if (searchParams.get("view") !== id) {
                router.replace(next, { scroll: false });
            }
            // Static/APK me address bar turant pakka karo — warna voucher par bhi F5 baad Sharing restore ho sakti thi
            syncSettingsViewQueryToBrowser(id);
        },
        [pathname, router, searchParams]
    );

    const jumpMyRoleToEditor = useCallback(
        (role: UserRole) => {
            try {
                localStorage.setItem("selectedRoleForPermissions", role);
            } catch {
                /* ignore */
            }
            if (can("manage_users_roles")) {
                setActiveViewWithUrl("sharing");
                setSettingsListOpen(false);
            }
        },
        [can, setActiveViewWithUrl, setSettingsListOpen]
    );

    const renderSettingsListCollapseBtn = () =>
        mobileSettingsUx ? null : (
            <Button
                type="button"
                variant="outline"
                size="icon"
                className={settingsListToggleBtnClass}
                onClick={toggleDesktopSettingsList}
                title={desktopSettingsListOpen ? "Collapse settings list" : "Expand settings list"}
                aria-label={desktopSettingsListOpen ? "Collapse settings list" : "Expand settings list"}
            >
                <PanelLeft className="h-3.5 w-3.5" />
            </Button>
        );

    const renderSettingsListHeader = () =>
        desktopSettingsListOpen ? (
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
                    <p className="text-sm text-muted-foreground">Manage your app preferences.</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <MyRoleButton onJumpToEditor={jumpMyRoleToEditor} />
                    {renderSettingsListCollapseBtn()}
                </div>
            </div>
        ) : (
            <div className="flex justify-center">{renderSettingsListCollapseBtn()}</div>
        );

    const backToSettingsListOnly = useCallback(() => {
        setActiveView("");
        setSettingsListOpen(false);
        router.replace(pathname, { scroll: false });
    }, [pathname, router, setSettingsListOpen]);

    // Desktop: URL me default ?view= taaki share/refresh — mobile par mat inject karo (sirf list)
    useEffect(() => {
        if (settingsNavStall) return;
        if (companyId && !company) return;
        if (mobileSettingsUx) return;
        const viewParam = searchParams.get("view");
        if (!viewParam && activeView && navItemsForUi.some((item) => item.id === activeView)) {
            router.replace(`${pathname}?view=${encodeURIComponent(activeView)}`, { scroll: false });
            syncSettingsViewQueryToBrowser(activeView);
        }
    }, [company, companyId, mobileSettingsUx, activeView, pathname, searchParams, router, navItemsForUi, settingsNavStall]);

    const selectedSetting = useMemo(() => {
        return navItemsForUi.find(item => item.id === activeView) || null;
    }, [activeView, navItemsForUi]);

    const openSettingsListSheet = useCallback(() => setSettingsListOpen(true), [setSettingsListOpen]);

    // Daen kinare se swipe → list sheet: `div` par pehle forms/scroll ne edge kha liya; `document` capture = har tab
    useEdgeSwipeDocumentCapture(
        mobileSettingsUx && Boolean(activeView) && !settingsListOpen,
        "right",
        openSettingsListSheet,
        SETTINGS_LIST_SHEET_RIGHT_EDGE_OPTS
    );

    /** History `pushState` + cleanup `history.back()` yahan mat: list item click → sheet band + `router.replace` ke turant `back()` naya `?view=` undo kar deta tha */
    /** Footer: touch daen ⅓ se shuru + LEFT swipe → list sheet (alag screen-edge swipe se) */
    const settingsFooterSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
    const onSettingsFooterTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length !== 1) {
            settingsFooterSwipeStartRef.current = null;
            return;
        }
        const t = e.touches[0];
        const el = e.currentTarget as HTMLElement;
        const r = el.getBoundingClientRect();
        if (t.clientX < r.left + (r.width * 2) / 3) {
            settingsFooterSwipeStartRef.current = null;
            return;
        }
        settingsFooterSwipeStartRef.current = { x: t.clientX, y: t.clientY };
    }, []);
    const onSettingsFooterTouchEnd = useCallback(
        (e: React.TouchEvent) => {
            if (!settingsFooterSwipeStartRef.current || e.changedTouches.length !== 1) {
                settingsFooterSwipeStartRef.current = null;
                return;
            }
            const t = e.changedTouches[0];
            const dx = t.clientX - settingsFooterSwipeStartRef.current.x;
            const dy = Math.abs(t.clientY - settingsFooterSwipeStartRef.current.y);
            settingsFooterSwipeStartRef.current = null;
            if (dy > Math.abs(dx) * 0.65) return;
            if (dx <= -44) openSettingsListSheet();
        },
        [openSettingsListSheet]
    );

    const renderNavList = (onPick?: () => void) => {
        const collapsed = !mobileSettingsUx && !desktopSettingsListOpen;
        return (
        <ul className="list-none space-y-1 py-1 w-full min-w-0" data-theme-list="account-list">
            {navItemsForUi.map((item) => {
                const isActive = activeView === item.id;
                return (
                    <li key={item.id}>
                        <button
                            type="button"
                            data-pl-settings-nav-row=""
                            data-pl-settings-nav-selected={isActive ? "" : undefined}
                            aria-current={isActive ? "page" : undefined}
                            title={collapsed ? item.title : undefined}
                            aria-label={item.title}
                            className={settingsNavRowClass(isActive, item.isDanger, collapsed)}
                            onClick={() => {
                                setActiveViewWithUrl(item.id);
                                onPick?.();
                            }}
                        >
                            <item.icon className="h-5 w-5 shrink-0" />
                            {collapsed ? null : <span className="truncate">{item.title}</span>}
                        </button>
                    </li>
                );
            })}
        </ul>
        );
    };

    const renderFixedUpdateRow = () => (
        <div
            className={cn(
                "flex-shrink-0 border-t border-black/15 pt-2 pb-1 dark:border-white/15",
                SETTINGS_NAV_INSET_X
            )}
        >
            <CheckForUpdateSettingsRow />
        </div>
    );

    /** Nav list scrolls; Check for update stays pinned at bottom (EXE + APK). */
    const renderSettingsNavColumn = (onPick?: () => void) =>
        settingsNavStall ? (
            <div className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground", SETTINGS_NAV_INSET_X)}>
                <Loader2 className="h-6 w-6 shrink-0 animate-spin" aria-hidden />
                <span>Loading settings menu…</span>
            </div>
        ) : (
            <>
                <div className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden", SETTINGS_NAV_INSET_X)}>
                    {renderNavList(onPick)}
                </div>
                {mobileSettingsUx || desktopSettingsListOpen ? renderFixedUpdateRow() : null}
            </>
        );

    if (companyId && !company) {
        const pendingView =
            searchParams.get("view") ??
            (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null);
        if (pendingView !== "local_cloud_sync") {
            return (
                <div className="flex min-h-[40vh] items-center justify-center p-4">
                    <p className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                        Loading company…
                    </p>
                </div>
            );
        }
    }

    const renderActiveView = () => {
        switch (activeView) {
            case "company":
                return <CompanySettings readOnly={!canConfigureCompany} />;
            case "sharing":
                return can('manage_users_roles') ? (
                    <PermissionRouteGuard permission="manage_users_roles">
                        <ManageShare />
                    </PermissionRouteGuard>
                ) : null;
            case "devices":
                return can('configure_company_settings') ? <ManageDevices /> : null;
            case "online_trigger_log":
                return can("configure_company_settings") ? (
                    <div className="flex h-full min-h-0 flex-col">
                        <OnlineTriggerLogSettings />
                    </div>
                ) : null;
            case "local_cloud_sync":
                return <LocalCloudSyncSettingsPage />;
            case "local_app_server":
                return <LocalAppServerSettings />;
            case "app_lock":
                return <AppLockSettings />;
            case "voucher":
                return can('configure_company_settings') ? <VoucherSettings /> : null;
            case "link_allocation":
                return can("configure_company_settings") ? <LinkAllocationSettings /> : null;
            case "country":
                return <CountryAppSettings />;
            case "theme":
                return canOpenThemeOrAnimation ? (
                    <ThemeSettings localOnlyHint={sharedLocalAppearanceOnly} />
                ) : null;
            case "animation":
                return canOpenThemeOrAnimation ? (
                    <AnimationSettings localPersistenceOnly={sharedLocalAppearanceOnly} />
                ) : null;
            case "decimals":
                 return can('configure_company_settings') ? <CurrencySettings /> : null;
            case "fiscal_split":
                return can("configure_company_settings") ? <FiscalSplitSettings /> : null;
            case "notification":
                return can('configure_company_settings') ? <NotificationSettings /> : null;
            case "danger-zone":
                return can('configure_company_settings') ? <DangerZone /> : null;
            default:
                return null;
        }
    };

    if (navItemsForUi.length === 0) {
      let storedCompanyIdPending = false;
      try {
        // Multi-tab refresh: settings loading guard should respect this tab's company override.
        const s = typeof window !== "undefined" ? readSelectedCompanyId() : "";
        storedCompanyIdPending = Boolean(s && !companyId && user);
      } catch {
        /* ignore */
      }
      const resolvingCompany =
        authLoading ||
        companiesLoading ||
        (Boolean(companyId) && !company) ||
        storedCompanyIdPending;
      return (
        <div className="p-8 text-center">
          <Card className="w-full max-w-lg mx-auto">
            <CardHeader>
              <CardTitle>
                {resolvingCompany ? "Loading…" : company ? "Permission Denied" : "Select a Company"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {resolvingCompany ? (
                <p className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                  Loading company and permissions…
                </p>
              ) : company ? (
                <p>You do not have permission to access any settings. Please contact your company owner or an administrator.</p>
              ) : (
                <>
                  <p>Please select a company from the header dropdown to manage settings.</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button variant="outline" onClick={() => router.push("/company")}>
                      Go to Company
                    </Button>
                    <Button onClick={() => router.push(settingsViewHref("local_cloud_sync"))}>
                      Google Drive sync
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )
    }

    // Mobile / narrow: pehle sirf list; item → detail full + Sheet se list
    if (mobileSettingsUx) {
        if (!activeView) {
            return (
                // Ek hi shell — pehle baahar grey `px-2` tha; ab poora mobile list sky card jaisa desktop aside
                <div
                  className={cn("flex h-full min-h-0 flex-1 flex-col overflow-hidden", SETTINGS_LIST_SHELL)}
                  data-pl-settings-list=""
                >
                    <div className={cn("flex-shrink-0 py-3", SETTINGS_LIST_HEADER_RULE, SETTINGS_NAV_INSET_X)}>
                        {renderSettingsListHeader()}
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        {renderSettingsNavColumn()}
                    </div>
                </div>
            );
        }

        return (
            <>
                <div className={cn("flex h-full min-h-0 flex-col overflow-hidden touch-pan-y")}>
                    {/* Content pehle scroll; top bar hata kar neeche footer (user mobile UX) */}
                    {/* Drive sync — andar scroll + fixed action bar; baaki tabs yahi scroll */}
                    <div
                        className={cn(
                            "min-h-0 flex-1 overflow-x-hidden [scrollbar-gutter:stable]",
                            activeView === "local_cloud_sync"
                              ? "flex flex-col overflow-hidden"
                              : "overflow-y-auto"
                        )}
                    >
                        {settingsNavStall ? (
                            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                                <Loader2 className="h-8 w-8 shrink-0 animate-spin" aria-hidden />
                                <span>Loading settings…</span>
                            </div>
                        ) : (
                            renderActiveView()
                        )}
                    </div>
                    {/* Drive sync — andar hi Back + settings list; duplicate niche footer mat dikhao */}
                    <div
                        className={cn(
                            "flex shrink-0 items-center gap-1.5 px-2 py-1 pb-[max(0.125rem,env(safe-area-inset-bottom))]",
                            SETTINGS_MOBILE_DETAIL_FOOTER_RULE
                        )}
                        onTouchStart={onSettingsFooterTouchStart}
                        onTouchEnd={onSettingsFooterTouchEnd}
                    >
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={backToSettingsListOnly}
                            title="Back to settings list"
                            aria-label="Back to settings list"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {selectedSetting?.title ?? "Settings"}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => setSettingsListOpen(true)}
                            title="Open settings list"
                            aria-label="Open settings list"
                        >
                            <PanelRight className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
                <Sheet open={settingsListOpen} onOpenChange={setSettingsListOpen}>
                    {/* `SETTINGS_LIST_SHELL` me `w-full` hai — seedha SheetContent par mat (viewport = 100% width); andar wrapper par */}
                    <SheetContent
                        side="right"
                        className={cn(
                            "flex h-full max-h-[100dvh] min-h-0 w-[60vw] max-w-[60vw] min-w-0 flex-col gap-0 overflow-hidden p-0",
                            "[&>button]:hidden"
                        )}
                    >
                        <div
                          className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", SETTINGS_LIST_SHELL)}
                          data-pl-settings-list=""
                        >
                            <SheetHeader className={cn("flex-shrink-0 space-y-1 py-3", SETTINGS_LIST_HEADER_RULE, SETTINGS_NAV_INSET_X)}>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <SheetTitle className="text-left text-lg font-semibold tracking-tight">Settings</SheetTitle>
                                        <p className="text-left text-sm text-muted-foreground">Manage your app preferences.</p>
                                    </div>
                                    <MyRoleButton onJumpToEditor={jumpMyRoleToEditor} />
                                </div>
                            </SheetHeader>
                            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden pointer-events-auto touch-manipulation">
                                {renderSettingsNavColumn(() => setSettingsListOpen(false))}
                            </div>
                        </div>
                    </SheetContent>
                </Sheet>
            </>
        );
    }

    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Baen list column ~30% patla (0.4fr→0.28fr, 300px→210px min); daen content zyada; nav scroll par L/R 4px same */}
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-1 gap-[5px] overflow-hidden p-2 sm:p-3 md:p-3",
            desktopSettingsListOpen
              ? "md:grid-cols-[minmax(210px,0.28fr)_minmax(0,1fr)]"
              : "md:grid-cols-[4rem_minmax(0,1fr)]"
          )}
        >
          <aside className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden">
            <div
              className={cn("flex min-h-0 h-full min-w-0 flex-1 flex-col overflow-hidden", SETTINGS_LIST_SHELL)}
              data-pl-settings-list=""
            >
              <div className={cn("flex-shrink-0 pb-3 pt-1", SETTINGS_LIST_HEADER_RULE, SETTINGS_NAV_INSET_X)}>
                {renderSettingsListHeader()}
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {renderSettingsNavColumn()}
              </div>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 w-full flex-col overflow-hidden">
            {/* `scrollbar-gutter:stable` — toggle/toast se scrollbar on/off par poora layout shift na ho (multi-device switch shake). */}
            <div
              className={cn(
                "min-h-0 min-w-0 flex-1 overflow-x-hidden [scrollbar-gutter:stable]",
                activeView === "local_cloud_sync" || activeView === "online_trigger_log"
                  ? "flex flex-col overflow-hidden"
                  : "overflow-y-auto"
              )}
            >
              {settingsNavStall ? (
                <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-8 w-8 shrink-0 animate-spin" aria-hidden />
                  <span>Loading settings…</span>
                </div>
              ) : (
                renderActiveView()
              )}
            </div>
          </main>
        </div>
      </div>
  );
}

function SettingsPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center text-muted-foreground">Loading settings...</div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsPageLoading />}>
      <SettingsPageContent />
    </Suspense>
  );
}
