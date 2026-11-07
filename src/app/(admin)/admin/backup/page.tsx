"use client";

import { Suspense } from "react";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { BackupRestore } from "@/components/settings/BackupRestore";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function BackupPage() {
  useAdminAccess(["SuperAdmin"]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Backup & Restore (Admin)</CardTitle>
          <CardDescription>
            Manage global backups or restore to a new company for any user.
          </CardDescription>
        </CardHeader>
      </Card>
      {/* Next.js: `BackupRestore` → `useSearchParams` — build/prerender ke liye Suspense boundary zaroori */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading backup tools…
          </div>
        }
      >
        <BackupRestore />
      </Suspense>
    </div>
  );
}
