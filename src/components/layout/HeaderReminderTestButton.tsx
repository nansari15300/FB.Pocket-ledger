"use client";

import { AlarmClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chromeProPillCn } from "@/lib/chromePillButton";
import { cn } from "@/lib/utils";
import { openReminderPreview } from "@/lib/reminderPreviewEvents";

/** Header Test button: kisi bhi screen par reminder popup kholta hai (latest reminder, ya empty state). */
export function HeaderReminderTestButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title="Test reminder popup"
      aria-label="Test reminder popup"
      data-theme-header="reminder-test-button"
      className={cn(chromeProPillCn, "h-8 shrink-0 gap-1 rounded-full px-2.5 text-xs font-medium", className)}
      onClick={() => openReminderPreview()}
    >
      <AlarmClock className="h-4 w-4" />
      <span>Test</span>
    </Button>
  );
}