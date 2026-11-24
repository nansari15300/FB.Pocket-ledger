"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Expand, Shrink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LEDGER_HEADER_PILL_ICON_CN,
  LEDGER_HEADER_PILL_ICON_SIZE_CN,
} from "@/lib/ledgerHeaderChrome";

function isReportsPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return /(?:^|\/)reports(?:\/|$)/.test(pathname);
}

/** Report txn ribbon — fill the browser window (not OS fullscreen). Always top-right. */
export function LedgerHeaderFullscreenButton({ className }: { className?: string }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const sync = (event?: Event) => {
      const detail = (event as CustomEvent<{ expanded?: boolean }> | undefined)?.detail;
      if (detail && typeof detail.expanded === "boolean") {
        setExpanded(detail.expanded);
        return;
      }
      setExpanded(document.querySelector("main")?.hasAttribute("data-page-expanded") ?? false);
    };
    sync();
    window.addEventListener("pl:dashboard:page-expanded-change", sync);
    return () => window.removeEventListener("pl:dashboard:page-expanded-change", sync);
  }, []);

  if (!isReportsPath(pathname)) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      data-pl-ledger-header-fullscreen=""
      aria-pressed={expanded}
      className={cn(LEDGER_HEADER_PILL_ICON_CN, className)}
      title={expanded ? "Exit expanded view" : "Expand in browser window"}
      aria-label={expanded ? "Exit expanded view" : "Expand in browser window"}
      onClick={() => window.dispatchEvent(new CustomEvent("pl:dashboard:toggle-page-expanded"))}
    >
      {expanded ? (
        <Shrink className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
      ) : (
        <Expand className={LEDGER_HEADER_PILL_ICON_SIZE_CN} />
      )}
    </Button>
  );
}
