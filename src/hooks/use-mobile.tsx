
"use client"

import * as React from "react"
import { isCapacitorNativeApp } from "@/lib/isCapacitorNative"

/** Electron shell (desktop app) — PDF external viewer policy ke liye. */
export function isElectronEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const w = window as unknown as { electron?: unknown; process?: { versions?: { electron?: string } } };
    if (w.electron != null) return true;
    if (w.process?.versions?.electron) return true;
  } catch {
    /* ignore */
  }
  return false;
}

// Check if device is actually a mobile device (phones + tablets)
export function isRealMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         ('ontouchstart' in window) ||
         (navigator.maxTouchPoints > 0);
}

// Check if device is a tablet (iPad, Android tablet). Tablets get PC mode in the header.
export function isTabletDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPad: explicit iPad UA, or iPadOS 13+ reports as Mac with touch
  if (/iPad/.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  // Android tablet: often no "Mobile" in UA, or width suggests tablet
  if (/Android/i.test(ua) && !/Mobile/.test(ua)) return true;
  if (/Android/i.test(ua) && window.innerWidth >= 768) return true;
  return false;
}

// Real mobile phone only (excludes tablets). Used to hide PC icons in header.
export function isRealMobilePhone(): boolean {
  return isRealMobileDevice() && !isTabletDevice();
}

// Portrait = height >= width. Used to hide PC icon on mobile in portrait only.
function getIsPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  // Soft keyboard open/close par `innerHeight` rapidly change hota hai (especially tablet),
  // jisse portrait/landscape galat flip ho kar view mode remount/back trigger kar sakta hai.
  // Prefer stable screen orientation APIs first.
  const orientationType = window.screen?.orientation?.type;
  if (typeof orientationType === "string" && orientationType.length > 0) {
    return orientationType.startsWith("portrait");
  }
  // iOS/Safari fallback: screen dimensions keyboard se usually stable rehte hain.
  if (typeof window.screen?.height === "number" && typeof window.screen?.width === "number") {
    return window.screen.height >= window.screen.width;
  }
  // Last fallback only.
  return window.innerHeight >= window.innerWidth;
}

// Context for mobile view state
const MobileViewContext = React.createContext<{
  isMobile: boolean;
  isRealMobile: boolean;
  isPortrait: boolean;
  /** Purana: mobile par PC icon chhupate the; ab hamesha false — PC/Mobile sirf icon se toggle */
  hidePcIcon: boolean;
  forcedViewMode: 'mobile' | 'pc' | null;
  setForcedMode: (mode: 'mobile' | 'pc' | null) => void;
  /** Provider ne pehla real `checkIsMobile` chala diya - tabhi `useIsMobileLayoutResolved` boolean de */
  layoutResolved?: boolean;
} | null>(null);

// Provider component
export function MobileViewProvider({
  children,
  /** Super Admin: PC viewport par ledger `forcedViewMode` ignore — sirf width < 768 = mobile. */
  lockDesktopLayout = false,
}: {
  children: React.ReactNode
  lockDesktopLayout?: boolean
}) {
  const [isMobile, setIsMobile] = React.useState(false)
  const [isPortrait, setIsPortrait] = React.useState(false)
  const [forcedViewMode, setForcedViewModeState] = React.useState<'mobile' | 'pc' | null>(null)
  const [isClient, setIsClient] = React.useState(false)
  const [layoutResolved, setLayoutResolved] = React.useState(false)

  React.useEffect(() => {
    setIsClient(true);
  }, []);

  // Debounce delay for resize/orientation to avoid "Page Unresponsive" when toggling mobile view on PC (e.g. items page)
  const RESIZE_DEBOUNCE_MS = 150;

  React.useEffect(() => {
    if (!isClient) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const scheduleCheck = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timeoutId = null;
        setIsPortrait(getIsPortrait());
      }, RESIZE_DEBOUNCE_MS);
    };
    scheduleCheck(); // run once on mount
    window.addEventListener('resize', scheduleCheck);
    window.addEventListener('orientationchange', scheduleCheck);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('resize', scheduleCheck);
      window.removeEventListener('orientationchange', scheduleCheck);
    };
  }, [isClient]);

  // Mount: saved PC/Mobile restore — web + APK dono (header icon PC Chrome jaisa 768 + toggle).
  React.useEffect(() => {
    if (!isClient || lockDesktopLayout) return;
    const savedMode = localStorage.getItem("forcedViewMode") as "mobile" | "pc" | null;
    if (savedMode === "mobile" || savedMode === "pc") {
      setForcedViewModeState(savedMode);
    }
  }, [isClient, lockDesktopLayout]);

  React.useEffect(() => {
    if (!isClient) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const checkIsMobile = () => {
      if (lockDesktopLayout) {
        setIsMobile(window.innerWidth < 768);
        return;
      }
      const portrait = getIsPortrait();
      const realMobile = isRealMobileDevice();

      // Capacitor APK: PC Chrome jaisa — default `innerWidth < 768`; icon se forced mobile/pc override
      if (isCapacitorNativeApp()) {
        if (forcedViewMode === "mobile") {
          setIsMobile(true);
        } else if (forcedViewMode === "pc") {
          setIsMobile(false);
        } else {
          setIsMobile(window.innerWidth < 768);
        }
        return;
      }

      // Web phone: default mobile; PC sirf icon / saved `forcedViewMode === 'pc'`
      if (isRealMobilePhone()) {
        if (forcedViewMode === "pc") {
          setIsMobile(false);
        } else {
          setIsMobile(true);
        }
        return;
      }

      // Chhote phone: portrait me mobile — **iPad / Android tablet yahan mat pakdo** warna portrait me hamesha
      // mobile rehta hai aur header ka PC toggle (`forcedViewMode === 'pc'`) asar nahi karta.
      if (realMobile && portrait && !isTabletDevice()) {
        setIsMobile(true);
        return;
      }

      // Desktop (not real mobile): tablet/PC – use width and forced view mode
      const isTablet = isTabletDevice();
      if (isTablet) {
        if (forcedViewMode === 'mobile') {
          setIsMobile(true);
        } else if (forcedViewMode === 'pc') {
          setIsMobile(false);
        } else {
          setIsMobile(window.innerWidth < 768);
        }
        return;
      }

      if (forcedViewMode === 'mobile') {
        setIsMobile(true);
      } else if (forcedViewMode === 'pc') {
        setIsMobile(false);
      } else {
        setIsMobile(window.innerWidth < 768);
      }
    };

    const scheduleCheck = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timeoutId = null;
        checkIsMobile();
      }, RESIZE_DEBOUNCE_MS);
    };

    checkIsMobile(); // run once on mount / when deps change
    setLayoutResolved(true);
    window.addEventListener("resize", scheduleCheck);
    window.addEventListener("orientationchange", scheduleCheck);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener("resize", scheduleCheck);
      window.removeEventListener("orientationchange", scheduleCheck);
    };
  }, [isClient, forcedViewMode, isPortrait, lockDesktopLayout])

  const setForcedMode = React.useCallback((mode: "mobile" | "pc" | null) => {
    if (lockDesktopLayout) {
      setIsMobile(typeof window !== "undefined" ? window.innerWidth < 768 : false);
      return;
    }
    setForcedViewModeState(mode);
    if (mode) {
      localStorage.setItem("forcedViewMode", mode);
    } else {
      localStorage.removeItem("forcedViewMode");
    }

    // APK pehle — web-phone branch na chhede (UA phone hone par bhi 768 + toggle chahiye)
    if (typeof window !== "undefined" && isCapacitorNativeApp()) {
      if (mode === "mobile") setIsMobile(true);
      else if (mode === "pc") setIsMobile(false);
      else setIsMobile(window.innerWidth < 768);
      return;
    }

    // Phone par bhi PC/Mobile toggle ka asar ho — pehle portrait me early return se icon kaam nahi karta tha
    if (isRealMobilePhone()) {
      if (mode === "pc") setIsMobile(false);
      else if (mode === "mobile") setIsMobile(true);
      else setIsMobile(true);
      return;
    }
    if (mode === "mobile") {
      setIsMobile(true);
    } else if (mode === "pc") {
      setIsMobile(false);
    } else {
      setIsMobile(window.innerWidth < 768);
    }
  }, [lockDesktopLayout]);

  // Wide PC + forced mobile: CSS `@media (max-width:767px)` gray bands miss — html flag drives the same slate chrome.
  React.useEffect(() => {
    if (!isClient || typeof document === "undefined") return;
    const root = document.documentElement;
    if (isMobile) root.dataset.plAppMobileUi = "1";
    else delete root.dataset.plAppMobileUi;
    return () => {
      delete root.dataset.plAppMobileUi;
    };
  }, [isClient, isMobile]);

  const value = React.useMemo(() => ({
    isMobile,
    // Keep SSR and first client render consistent; compute UA-dependent flags only after mount.
    isRealMobile: isClient ? isRealMobilePhone() : false,
    isPortrait,
    hidePcIcon: false,
    forcedViewMode,
    setForcedMode,
    layoutResolved
  }), [isMobile, isPortrait, forcedViewMode, setForcedMode, isClient, layoutResolved]);

  return (
    <MobileViewContext.Provider value={value}>
      {children}
    </MobileViewContext.Provider>
  );
}

// Shared logic for mobile detection (uses context)
function useMobileDetection() {
  const context = React.useContext(MobileViewContext);
  if (!context) {
    // Fallback for components outside provider (shouldn't happen in normal use)
    const [isMobile, setIsMobile] = React.useState(false)
    const [isPortrait, setIsPortrait] = React.useState(false)
    const [forcedViewMode, setForcedViewMode] = React.useState<'mobile' | 'pc' | null>(null)

    React.useEffect(() => {
      const isTablet = isTabletDevice();
      const isPhone = isRealMobilePhone();
      if (isPhone) {
        setIsMobile(true);
        return;
      }
      if (isTablet) {
        const savedMode = localStorage.getItem('forcedViewMode') as 'mobile' | 'pc' | null;
        if (savedMode) {
          setForcedViewMode(savedMode);
          setIsMobile(savedMode === 'mobile');
        } else {
          setIsMobile(window.innerWidth < 768);
        }
        return;
      }
      const savedMode = localStorage.getItem('forcedViewMode') as 'mobile' | 'pc' | null;
      if (savedMode) {
        setForcedViewMode(savedMode);
        setIsMobile(savedMode === 'mobile');
      } else {
        setIsMobile(window.innerWidth < 768);
      }
    }, []);

    React.useEffect(() => {
      const check = () => setIsPortrait(getIsPortrait());
      check();
      window.addEventListener('resize', check);
      window.addEventListener('orientationchange', check);
      return () => {
        window.removeEventListener('resize', check);
        window.removeEventListener('orientationchange', check);
      };
    }, []);

    const setForcedMode = React.useCallback((mode: 'mobile' | 'pc' | null) => {
      setForcedViewMode(mode);
      if (mode) {
        localStorage.setItem('forcedViewMode', mode);
      } else {
        localStorage.removeItem('forcedViewMode');
      }
    }, []);

    return {
      isMobile,
      isRealMobile: isRealMobilePhone(),
      isPortrait,
      hidePcIcon: false,
      forcedViewMode,
      setForcedMode
    };
  }
  return context;
}

/**
 * Mobile flag for layout / Radix branching. Until the client has mounted, always `false` so SSR and the
 * first client pass match — avoids hydration mismatches when `isMobile` swaps whole subtrees (e.g. Tabs vs
 * Select in AddVoucherDialog, Sheet vs aside in Sidebar). After mount, returns the real detection value.
 */
export function useIsMobile(): boolean {
  const { isMobile } = useMobileDetection();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return false;
  return isMobile;
}

/** Super Admin: viewport width only — touch laptop / ledger forced mobile apply mat karo. */
function resolveAdminPanelIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768;
}

export function useAdminPanelIsMobile(): boolean {
  const [mounted, setMounted] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    const check = () => setIsMobile(resolveAdminPanelIsMobile());
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  if (!mounted) return false;
  return isMobile;
}

/**
 * `usePageMemory` jaise hooks: SSR / pehle frame par `null` (layout abhi resolve nahi),
 * mount ke baad `true` = mobile layout, `false` = desktop — tabhi desktop auto-select chale.
 */
export function useIsMobileLayoutResolved(): boolean | null {
  const { isMobile, layoutResolved } = useMobileDetection();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);
  // Provider ka pehla check na hua ho to `false` (desktop) mat batao - mobile par galat auto-select
  if (!mounted || layoutResolved === false) return null;
  return isMobile;
}

// New hook - returns full object with view control
export function useMobileView() {
  return useMobileDetection();
}

/**
 * Date range calendar ke liye: mobile = 1 month, PC = 2 months.
 * Saari date range picker jaga par isko use karo taaki mobile/PC dono par consistent UX rahe.
 */
export function useCalendarMonths(): number {
  const { isMobile } = useMobileDetection();
  return isMobile ? 1 : 2;
}
