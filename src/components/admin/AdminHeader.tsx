
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  CalendarDays,
  Loader2,
  Check,
  ChevronDown,
  ArrowLeft,
  Expand,
  Minimize,
  Building2,
  Settings,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useDate } from "@/hooks/useDate";
import { useCompany } from "@/hooks/useCompany";
import { DateFormatSettingsDialog } from "@/components/settings/DateFormatSettingsDialog";
import { useRouter } from "next/navigation";
import { SidebarTrigger } from "../ui/sidebar";
import { LanguageGlobeButton } from "@/components/layout/LanguageGlobeButton";
import dynamic from "next/dynamic";

/** Voucher forms are heavy — do not block first /admin compile/render. */
const AddVoucherDialog = dynamic(
  () => import("../vouchers/AddVoucherDialog").then((m) => m.AddVoucherDialog),
  { ssr: false }
);


function ScreenControls() {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  
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
        console.error(`Error attempting to enable full-screen mode: ${'${err.message}'} (${'${err.name}'})`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
      >
        {isFullscreen ? <Minimize className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
      </Button>
    </div>
  );
}


function DateSystemSwitcher() {
  const { dateSystem, setDateSystem } = useDate();
  const [dateFormatDialogOpen, setDateFormatDialogOpen] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <CalendarDays className="mr-2 h-4 w-4" />
            <span>{dateSystem}</span>
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setDateSystem("BS")}>Bikram Samvat (BS)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDateSystem("AD")}>Anno Domini (AD)</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDateSystem("Both")}>Both</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDateFormatDialogOpen(true)}>
            <Settings className="mr-2 h-4 w-4" />
            Setting
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DateFormatSettingsDialog open={dateFormatDialogOpen} onOpenChange={setDateFormatDialogOpen} />
    </>
  );
}

export function AdminHeader() {
  const { triggerSync, reloadLocalCompanyRegistry } = useCompany();
  const router = useRouter();
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'synced'>('idle');
  /** Radix Dropdown/Dialog: SSR vs client par alag random id → hydration mismatch; mount ke baad hi render */
  const [radixMounted, setRadixMounted] = useState(false);
  useEffect(() => {
    setRadixMounted(true);
  }, []);

  const handleSyncClick = () => {
    // Manual sync: local registry + online listeners — user expect karta hai poora list dubara
    reloadLocalCompanyRegistry();
    triggerSync();
  };

   useEffect(() => {
    // This is a simplified visual sync indicator.
    // A more robust solution would listen to the actual sync status.
    if (syncState === 'syncing') {
      const timer = setTimeout(() => {
        setSyncState('synced');
        const idleTimer = setTimeout(() => setSyncState('idle'), 1000);
        return () => clearTimeout(idleTimer);
      }, 1000); 
      return () => clearTimeout(timer);
    }
  }, [syncState]);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b bg-background px-6">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
         <Button variant="outline">
            <Building2 className="mr-2 h-4 w-4" />
            <span>Pocket Ledger</span>
        </Button>
        {radixMounted ? (
          <DateSystemSwitcher />
        ) : (
          <Button variant="outline" size="sm" type="button" disabled className="pointer-events-none opacity-90" aria-hidden>
            <CalendarDays className="mr-2 h-4 w-4" />
            <span className="inline-block min-w-[2rem]">…</span>
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => setSyncState('syncing')} disabled={syncState !== 'idle'}>
            {syncState === 'syncing' && <Loader2 className="h-5 w-5 animate-spin" />}
            {syncState === 'synced' && <Check className="h-5 w-5 text-green-600" />}
            {syncState === 'idle' && <RefreshCw className="h-5 w-5" />}
            <span className="sr-only">Sync Data</span>
          </Button>
      </div>
       <div className="flex items-center gap-2">
          {radixMounted ? (
            <AddVoucherDialog defaultTab="payment_out">
              <Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Payment</Button>
            </AddVoucherDialog>
          ) : (
            <Button variant="outline" type="button" disabled className="pointer-events-none opacity-90" aria-hidden>
              <ArrowLeft className="mr-2 h-4 w-4" /> Payment
            </Button>
          )}
          <LanguageGlobeButton />
          <ScreenControls />
      </div>
    </header>
  );
}
