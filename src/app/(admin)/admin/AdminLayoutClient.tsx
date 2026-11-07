"use client";

import AdminShell from "@/components/admin/AdminShell";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MobileViewProvider } from "@/hooks/use-mobile";
import { AdminRouteChrome } from "./AdminRouteChrome";

/** Admin routes: ledger forced-mobile / touch heuristics se alag — PC par desktop layout lock. */
export function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <MobileViewProvider lockDesktopLayout>
      <SidebarProvider desktopSidebarOnPc>
        <AdminRouteChrome />
        <AdminShell>{children}</AdminShell>
      </SidebarProvider>
    </MobileViewProvider>
  );
}
