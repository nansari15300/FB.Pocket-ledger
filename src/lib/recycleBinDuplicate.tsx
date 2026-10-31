"use client";

import * as React from "react";
import { createRoot } from "react-dom/client";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Timestamp, collection, query, serverTimestamp, where } from "@/lib/pbCompat/firestore";
import { getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isLocalOnlyMode } from "@/lib/localMode";
import { listCompanyDocsFromBrowserDb } from "@/lib/localCompanyDocMirror";
import { writeEntity } from "@/lib/writeGateway";
import { registerImperativeDialogBack } from "@/contexts/DialogBackHandlerContext";

type DuplicateDecision = "active_exists" | "restored" | "create_new";

type ResolveDuplicateParams = {
  companyId: string;
  collectionName: string;
  name: string;
  entityLabel: string;
  fieldName?: string;
};

async function askRestoreChoiceInApp(entityLabel: string, name: string): Promise<boolean> {
  // Render a temporary in-app modal so we avoid browser-native confirm dialogs.
  return await new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let resolved = false;

    const cleanup = () => {
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };

    const finish = (choice: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve(choice);
      cleanup();
    };

    function RestoreChoiceDialog() {
      const [open, setOpen] = React.useState(true);
      React.useEffect(() => {
        if (!open) return;
        // Device back pe pehle ye restore-choice dialog close ho; peeche ka page/navigation consume na ho.
        return registerImperativeDialogBack(() => {
          setOpen(false);
          finish(false);
        });
      }, [open]);
      return (
        <AlertDialogPrimitive.Root
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) finish(false);
          }}
        >
          <AlertDialogPrimitive.Portal>
            <AlertDialogPrimitive.Overlay
              className={cn(
                // Keep this duplicate-choice modal above all existing dialogs and blur whole page behind.
                "fixed inset-0 z-[2147483646] bg-black/45 backdrop-blur-sm"
              )}
            />
            <AlertDialogPrimitive.Content
              className={cn(
                "fixed left-1/2 top-1/2 z-[2147483647] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-2xl"
              )}
            >
              <AlertDialogPrimitive.Title className="text-lg font-semibold">
                {entityLabel} Found in Recycle Bin
              </AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">
                {entityLabel} "{name}" is in Recycle Bin. What would you like to do?
              </AlertDialogPrimitive.Description>
              <div className="mt-5 flex justify-end gap-2">
                <AlertDialogPrimitive.Cancel asChild>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setOpen(false);
                      finish(false);
                    }}
                  >
                    Create New
                  </Button>
                </AlertDialogPrimitive.Cancel>
                <AlertDialogPrimitive.Action asChild>
                  <Button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      finish(true);
                    }}
                  >
                    Restore
                  </Button>
                </AlertDialogPrimitive.Action>
              </div>
            </AlertDialogPrimitive.Content>
          </AlertDialogPrimitive.Portal>
        </AlertDialogPrimitive.Root>
      );
    }

    root.render(<RestoreChoiceDialog />);
  });
}

/**
 * Shared create-flow guard (sare masters):
 * - Active duplicate naam => block (`active_exists`) — naya duplicate create na ho
 * - Sirf recycle-bin me ho to Restore ya Create New
 */
export async function resolveRecycleBinDuplicate({
  companyId,
  collectionName,
  name,
  entityLabel,
  fieldName = "name",
}: ResolveDuplicateParams): Promise<{ decision: DuplicateDecision; restoredId?: string }> {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) return { decision: "create_new" };

  // APK / SQLite mirror: duplicate + restore bina Firestore `getDocs` wait (offline "Creating…" stall fix).
  if (isLocalOnlyMode()) {
    const rows = await listCompanyDocsFromBrowserDb(companyId, collectionName, { includeSoftDeleted: true });
    const active = rows.find((r: Record<string, unknown>) => {
      const nm = String(r[fieldName] ?? "").trim();
      return nm === trimmedName && r.isDeleted !== true;
    }) as Record<string, unknown> | undefined;
    if (active?.id != null && String(active.id).trim()) return { decision: "active_exists" };

    const recycled = rows.find((r: Record<string, unknown>) => {
      const nm = String(r[fieldName] ?? "").trim();
      return nm === trimmedName && r.isDeleted === true;
    }) as Record<string, unknown> | undefined;
    const rid = recycled?.id != null ? String(recycled.id).trim() : "";
    if (!rid) return { decision: "create_new" };

    const shouldRestore = await askRestoreChoiceInApp(entityLabel, trimmedName);
    if (!shouldRestore) return { decision: "create_new" };

    const merged = {
      ...recycled,
      id: rid,
      isDeleted: false,
      deletedAt: null,
      restoredAt: Timestamp.now(),
    } as Record<string, unknown>;
    // Ek hi entry: plan gate (vouchers) + SQLite + outbox — seedha components se duplicate upsert/enqueue avoid.
    const wr = await writeEntity({
      companyId,
      collectionName,
      docId: rid,
      operation: "update",
      data: merged,
    });
    if (!wr.ok) return { decision: "create_new" };
    return { decision: "restored", restoredId: rid };
  }

  const RECYCLE_QUERY_MS = 5000;

  const q = query(
    collection(firestore, `companies/${companyId}/${collectionName}`),
    where(fieldName, "==", trimmedName)
  );
  let docs: Array<{ id: string; data: () => Record<string, unknown> }>;
  try {
    const snap = await Promise.race([
      getDocs(q),
      new Promise<Awaited<ReturnType<typeof getDocs>>>((_, reject) =>
        setTimeout(() => reject(new Error("resolveRecycleBinDuplicate-timeout")), RECYCLE_QUERY_MS)
      ),
    ]);
    docs = snap.docs.map((d) => ({ id: d.id, data: () => d.data() as Record<string, unknown> }));
  } catch {
    // Network stall: dubara naam mat roko — SQLite mirror / flush baad me resolve karenge (master create unblock).
    return { decision: "create_new" };
  }

  const active = docs.find((d) => d.data()?.["isDeleted"] !== true);
  if (active) return { decision: "active_exists" };

  const recycled = docs.find((d) => d.data()?.["isDeleted"] === true);
  if (!recycled) return { decision: "create_new" };

  // Ask choice in app dialog instead of browser alert.
  const shouldRestore = await askRestoreChoiceInApp(entityLabel, trimmedName);

  if (!shouldRestore) return { decision: "create_new" };

  const wr = await writeEntity({
    companyId,
    collectionName,
    docId: recycled.id,
    operation: "update",
    data: {
      isDeleted: false,
      deletedAt: null,
      restoredAt: serverTimestamp(),
    },
  });
  if (!wr.ok) return { decision: "create_new" };

  return { decision: "restored", restoredId: recycled.id };
}

