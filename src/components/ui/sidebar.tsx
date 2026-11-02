
"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { PanelLeft } from "lucide-react"

import { useAdminPanelIsMobile, useIsMobile, useMobileView } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Button, type ButtonProps } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ResizeWidthHandle, useResizablePixelWidth } from "@/components/layout/ResizablePaneWidth"

interface SidebarContextProps {
  isOpen: boolean
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

export function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}

export function SidebarProvider({
  children,
  /** Admin panel: PC browser par ledger forced-mobile ignore — desktop sidebar + layout. */
  desktopSidebarOnPc = false,
}: {
  children: React.ReactNode
  desktopSidebarOnPc?: boolean
}) {
  const globalIsMobile = useIsMobile()
  const adminIsMobile = useAdminPanelIsMobile()
  const isMobile = desktopSidebarOnPc ? adminIsMobile : globalIsMobile
  const { forcedViewMode } = useMobileView()
  const [isOpen, setIsOpen] = React.useState(true)
  const [isClient, setIsClient] = React.useState(false);

  React.useEffect(() => {
    setIsClient(true);
  }, []);

  // Check if sidebar should be hidden (mobile view - real or forced)
  const shouldHideSidebar = desktopSidebarOnPc
    ? adminIsMobile
    : globalIsMobile || forcedViewMode === "mobile";

  React.useEffect(() => {
    if (!isClient) return;
    if (shouldHideSidebar) {
      setIsOpen(false);
      return;
    }
    // Admin PC: main app ka collapsed sidebar inherit mat karo — hamesha expanded.
    if (desktopSidebarOnPc) {
      setIsOpen(true);
      return;
    }
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    if (path.startsWith("/reconciliation")) {
      setIsOpen(false);
      try {
        localStorage.setItem("sidebar-isOpen", JSON.stringify(false));
      } catch {
        /* ignore */
      }
      return;
    }
    const storedState = localStorage.getItem("sidebar-isOpen");
    if (storedState !== null) {
      setIsOpen(JSON.parse(storedState));
    } else {
      setIsOpen(true);
    }
  }, [isClient, shouldHideSidebar, desktopSidebarOnPc]);

  const toggleSidebar = React.useCallback(() => {
    setIsOpen((prev) => {
      const newState = !prev;
      if (isClient && !shouldHideSidebar) {
        // Only save state for PC view
        localStorage.setItem("sidebar-isOpen", JSON.stringify(newState));
      }
      return newState;
    });
  }, [isClient, shouldHideSidebar]);

  // Direct setIsOpen function for mobile view (allows opening)
  const handleSetIsOpen = React.useCallback((open: boolean | ((prev: boolean) => boolean)) => {
    if (typeof open === 'function') {
      setIsOpen(open);
    } else {
      setIsOpen(open);
    }
  }, []);
  
  return (
    <SidebarContext.Provider value={{ isOpen, setIsOpen: handleSetIsOpen, isMobile: shouldHideSidebar, toggleSidebar }}>
      <TooltipProvider delayDuration={0}>
        {children}
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

export const SidebarTrigger = React.forwardRef<
  HTMLButtonElement,
  ButtonProps
>(({ className, ...props }, ref) => {
  const { toggleSidebar, isMobile, setIsOpen } = useSidebar()
  
  const handleClick = () => {
    // Mobile sheet: swipe se open + header button se show/hide dono — pehle sirf `true` tha, doosri tap no-op lagti thi.
    if (isMobile) {
      setIsOpen((prev) => !prev);
    } else {
      toggleSidebar();
    }
  }

  return (
    <Button
      ref={ref}
      variant="outline"
      size="icon"
      className={cn("h-9 w-9 flex-shrink-0", className)}
      data-theme-header="sidebar-toggle"
      onClick={handleClick}
      {...props}
    >
      <PanelLeft className="h-5 w-5" />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
})
SidebarTrigger.displayName = "SidebarTrigger"

const sidebarVariants = cva(
  // Section cards (brand, nav, Account, profile): 8px on every side, same as list/ledger row cards
  "flex min-h-0 flex-col gap-[8px] bg-sidebar p-[8px] text-sidebar-foreground transition-all duration-300 ease-in-out",
  {
    variants: {
      isOpen: {
        true: "",
        false: "w-16",
      },
    },
    defaultVariants: {
      isOpen: true,
    },
  }
)

export const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }
>(({ className, asChild, children, ...props }, ref) => {
  const { isOpen, isMobile, setIsOpen } = useSidebar()
  const Comp = asChild ? Slot : "aside"
  const { widthPx, beginResize } = useResizablePixelWidth({
    storageKey: "pl-app-sidebar-width-px",
    defaultPx: 256,
    minPx: Math.round(256 * 0.7),
    maxPx: Math.round(256 * 1.3),
  })

  // History `pushState` yahan hata diya: LTR edge swipe + React Strict cleanup par `history.back()` galat “page back” / menu taps toot rahe the

  if (isMobile) {
    // In mobile view, sidebar is completely hidden and only shows in Sheet overlay
    // Return null to not render anything in the layout, Sheet will handle overlay
    return (
      <>
        <Sheet open={isOpen} onOpenChange={(open) => {
          // Allow opening, but auto-close when clicking outside
          setIsOpen(open);
        }}>
          {/* User request: sidebar top-right cross icon hide (SheetContent close button). */}
          {/* Mobile: menu ~65% screen — poora full-width na le; swipe har page se `GlobalLeftEdgeOpenAppMenuSwipe` */}
          <SheetContent side="left" className="w-[65vw] max-w-sm p-0 [&>button]:hidden">
            <SheetHeader>
              <SheetTitle className="sr-only">Main Menu</SheetTitle>
            </SheetHeader>
            {/* `relative z-10` + `pointer-events-auto` — Sheet chrome ke neeche nav links ka tap pakka rahe */}
            <div
              ref={ref}
              className="relative z-10 flex h-full min-h-0 flex-col gap-[8px] overflow-y-auto bg-sidebar p-[8px] text-sidebar-foreground pointer-events-auto touch-manipulation"
              {...props}
              data-pl-main-sidebar="1"
            >
               {children}
            </div>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  // data-pl-main-sidebar {...props} ke baad — parent spread null/undefined se hydration mismatch na ho
  return (
    <Comp
      ref={ref}
      className={cn("relative shrink-0", sidebarVariants({ isOpen }), className)}
      style={isOpen ? { width: `${widthPx}px` } : undefined}
      {...props}
      data-pl-main-sidebar="1"
    >
      {children}
      {isOpen ? <ResizeWidthHandle onPointerDown={beginResize} title="Resize app sidebar" /> : null}
    </Comp>
  )
})
Sidebar.displayName = "Sidebar"

export const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
    const { isOpen } = useSidebar();
    return (
        <div
            ref={ref}
            className={cn(
                /* Height content se; AppSidebar apna chrome-card wrap karta hai */
                "flex min-h-0 shrink-0 items-center border-0",
                isOpen ? "justify-start" : "justify-center",
                className
            )}
            {...props}
        />
    )
})
SidebarHeader.displayName = "SidebarHeader"

export const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("flex-1 overflow-y-auto overflow-x-hidden", className)}
      {...props}
    />
  )
})
SidebarContent.displayName = "SidebarContent"

export const SidebarMenu = React.forwardRef<
  HTMLUListElement,
  React.HTMLAttributes<HTMLUListElement>
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn("flex flex-col gap-1 px-2 py-4", className)}
    {...props}
  />
))
SidebarMenu.displayName = "SidebarMenu"

export const SidebarMenuItem = React.forwardRef<
  HTMLLIElement,
  React.HTMLAttributes<HTMLLIElement>
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    className={cn("group/menu-item relative", className)}
    {...props}
  />
))
SidebarMenuItem.displayName = "SidebarMenuItem"

const sidebarMenuButtonVariants = cva(
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      isActive: {
        true: "bg-sidebar-accent text-sidebar-accent-foreground",
      },
      isOpen: {
        false: "justify-center",
      },
    },
    defaultVariants: {
      isActive: false,
    },
  }
)

export const SidebarMenuButton = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    isActive?: boolean
    tooltip?: string
  }
>(({ isActive, tooltip, className, ...props }, ref) => {
  const { isOpen } = useSidebar()

  const button = (
    <div
      ref={ref}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ isActive, isOpen }), className)}
      {...props}
    />
  )

  if (!isOpen && tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" align="center">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return button
})
SidebarMenuButton.displayName = "SidebarMenuButton"

export const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
    const { isOpen } = useSidebar();
    return (
        <div
            ref={ref}
            className={cn("mt-auto flex min-h-0 shrink-0 flex-col gap-2 border-0 p-0", className)}
            {...props}
        />
    )
})
SidebarFooter.displayName = "SidebarFooter"
