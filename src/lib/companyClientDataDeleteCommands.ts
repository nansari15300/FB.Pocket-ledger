"use client";

import { setDoc } from "@/lib/writeGateway/pbWrites";
import { doc, serverTimestamp } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/firebase";
import { clientRandomUUID } from "@/lib/clientRandomUUID";
import { getLocalCompanyById, removeLocalCompanyById, upsertLocalCompany, type LocalCompanyDoc } from "@/lib/localCompanyStore";
import { flushPendingBrowserDbSave } from "@/lib/localSqlite";

export type CompanyClientDataDeleteDelay = "now" | "1h" | "5h" | "8h" | "1d" | "1w" | "1mo";

export type CompanyClientDataDeleteCommand = {
  id: string;
  companyId: string;
  companyName?: string | null;
  targetEmail: string;
  requestedByEmail?: string | null;
  requestedAtMs: number;
  deleteAtMs: number;
  source: "pl_server" | "online";
  reason: "unshare";
};

export const COMPANY_CLIENT_DATA_DELETE_DELAYS: Array<{
  value: CompanyClientDataDeleteDelay;
  label: string;
  ms: number;
}> = [
  { value: "now", label: "Now", ms: 0 },
  { value: "1h", label: "1 hr", ms: 60 * 60 * 1000 },
  { value: "5h", label: "5 hr", ms: 5 * 60 * 60 * 1000 },
  { value: "8h", label: "8 hr", ms: 8 * 60 * 60 * 1000 },
  { value: "1d", label: "1 day", ms: 24 * 60 * 60 * 1000 },
  { value: "1w", label: "1 week", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: "1mo", label: "1 month", ms: 30 * 24 * 60 * 60 * 1000 },
];

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function delayMs(value: CompanyClientDataDeleteDelay): number {
  return COMPANY_CLIENT_DATA_DELETE_DELAYS.find((row) => row.value === value)?.ms ?? 0;
}

export function createCompanyClientDataDeleteCommand(params: {
  companyId: string;
  companyName?: string | null;
  targetEmail: string;
  requestedByEmail?: string | null;
  delay: CompanyClientDataDeleteDelay;
  source: CompanyClientDataDeleteCommand["source"];
}): CompanyClientDataDeleteCommand {
  const now = Date.now();
  return {
    id: `ccdd_${clientRandomUUID()}`,
    companyId: String(params.companyId || "").trim(),
    companyName: params.companyName ?? null,
    targetEmail: normalizeEmail(params.targetEmail),
    requestedByEmail: normalizeEmail(params.requestedByEmail) || null,
    requestedAtMs: now,
    deleteAtMs: now + delayMs(params.delay),
    source: params.source,
    reason: "unshare",
  };
}

export function parseCompanyClientDataDeleteCommands(value: unknown): CompanyClientDataDeleteCommand[] {
  if (!Array.isArray(value)) return [];
  const rows: Array<CompanyClientDataDeleteCommand | null> = value.map((row) => {
      const r = row as Partial<CompanyClientDataDeleteCommand>;
      const id = String(r.id || "").trim();
      const companyId = String(r.companyId || "").trim();
      const targetEmail = normalizeEmail(r.targetEmail);
      const deleteAtMs = Number(r.deleteAtMs);
      const requestedAtMs = Number(r.requestedAtMs);
      if (!id || !companyId || !targetEmail || !Number.isFinite(deleteAtMs)) return null;
      return {
        id,
        companyId,
        companyName: r.companyName ?? null,
        targetEmail,
        requestedByEmail: r.requestedByEmail ?? null,
        requestedAtMs: Number.isFinite(requestedAtMs) ? requestedAtMs : deleteAtMs,
        deleteAtMs,
        source: r.source === "online" ? "online" : "pl_server",
        reason: "unshare",
      } satisfies CompanyClientDataDeleteCommand;
    });
  return rows.filter((row): row is CompanyClientDataDeleteCommand => Boolean(row));
}

export async function appendLocalCompanyClientDataDeleteCommand(
  companyId: string,
  command: CompanyClientDataDeleteCommand
): Promise<void> {
  const row = await getLocalCompanyById(companyId, { includeDeleted: true });
  if (!row) return;
  const prev = parseCompanyClientDataDeleteCommands(
    (row as { clientDataDeleteCommands?: unknown }).clientDataDeleteCommands
  ).filter((cmd) => cmd.id !== command.id);
  await upsertLocalCompany({
    ...(row as LocalCompanyDoc),
    id: companyId,
    clientDataDeleteCommands: [...prev, command],
    updatedAt: Date.now(),
  });
  await flushPendingBrowserDbSave();
}

export async function enqueueOnlineCompanyClientDataDeleteCommand(params: {
  targetUid?: string | null;
  command: CompanyClientDataDeleteCommand;
}): Promise<void> {
  const uid = String(params.targetUid || "").trim();
  if (!uid) return;
  await setDoc(doc(firestore, "users", uid, "companyDataDeleteCommands", params.command.id), {
    ...params.command,
    createdAt: serverTimestamp(),
  });
}

export async function executeDueCompanyClientDataDeleteCommands(params: {
  commands: readonly CompanyClientDataDeleteCommand[];
  appEmail?: string | null;
  firebaseUid?: string | null;
}): Promise<string[]> {
  const appEmail = normalizeEmail(params.appEmail);
  const now = Date.now();
  const removed: string[] = [];
  for (const command of params.commands) {
    if (!command.companyId) continue;
    if (command.targetEmail && appEmail && command.targetEmail !== appEmail) continue;
    if (command.deleteAtMs > now) continue;
    await removeLocalCompanyById(command.companyId, { firebaseUid: params.firebaseUid ?? null });
    removed.push(command.companyId);
  }
  return Array.from(new Set(removed));
}
