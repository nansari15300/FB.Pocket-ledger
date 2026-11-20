"use client";

import { useEffect, useState } from "react";
import { Expand, Shrink } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Inline report-header control; keeps the shared page-expansion behavior without a floating overlay. */
export function ReportPageExpandButton() {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onExpandedChange = (event: Event) => {
      const detail = (event as CustomEvent<{ expanded?: boolean }>).detail;
      setExpanded(Boolean(detail?.expanded));
    };
    window.addEventListener("pl:dashboard:page-expanded-change", onExpandedChange);
    return () => window.removeEventListener("pl:dashboard:page-expanded-change", onExpandedChange);
  }, []);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-9 w-9 shrink-0 rounded-full sm:h-10 sm:w-10"
      data-pl-inline-report-expand=""
      aria-label={expanded ? "Exit expanded report view" : "Expand report"}
      aria-expanded={expanded}
      title={expanded ? "Exit expanded view" : "Expand report"}
      onClick={() => window.dispatchEvent(new CustomEvent("pl:dashboard:toggle-page-expanded"))}
    >
      {expanded ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
    </Button>
  );
}
