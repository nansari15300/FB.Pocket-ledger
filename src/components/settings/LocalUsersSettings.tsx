"use client";

import { updateDoc } from "@/lib/writeGateway/pbWrites";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/hooks/useCompany";
import { useDataSource } from "@/contexts/DataSourceContext";
import { getLocalApiBaseUrl, isLocalCompanyId } from "@/lib/localApiClient";
import { getLocalCompanyById } from "@/lib/localCompanyStore";
import {
  appendLocalCompanyUserClient,
  localCompanyUsersToPublicList,
  parseLocalCompanyUserRows,
} from "@/lib/localCompanyUsers";
import { Loader2, UserPlus } from "lucide-react";
import { useLivePlans, getPlanFromPlans } from "@/hooks/useLivePlans";
import { numericEntitlement, isAtOrOverEntitlementCap, formatEntitlementCapLabel, type PlanId } from "@/config/plans";
import { isCloudLinkedCompanyStorage } from "@/lib/companyUnlockGate";
import { doc } from "@/lib/pbCompat/firestore";
import { firestore } from "@/lib/plClientSession";
import { updateCompanyDocRoot } from "@/lib/companyDocsClient";

type LocalUser = { id: string; username: string; displayName?: string; role?: string; createdAt?: number };

export function LocalUsersSettings() {
  const { companyId, company } = useCompany();
  const { localApiBaseUrl } = useDataSource();
  const livePlans = useLivePlans();
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const plan = getPlanFromPlans(livePlans, (company?.planId as PlanId) || "basic");
  const maxUsersCap = numericEntitlement(
    plan.entitlements,
    "maxUsers",
    !isCloudLinkedCompanyStorage(company ?? {})
  );
  const ownerPlusShared = 1 + (company?.sharedWithEmails?.length ?? 0);
  const totalAfterAdd = users.length + 1 + ownerPlusShared;
  const atLimit = isAtOrOverEntitlementCap(totalAfterAdd, maxUsersCap);

  const baseUrl = localApiBaseUrl || getLocalApiBaseUrl();

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      try {
        if (isLocalCompanyId(companyId)) {
          // Offline company: users SQLite doc me — local API server optional.
          const doc = await getLocalCompanyById(companyId);
          const rows = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown } | null)?.localCompanyUsers);
          if (!cancelled) setUsers(localCompanyUsersToPublicList(rows));
        } else {
          const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/companies/${companyId}/users`);
          const data = await r.json();
          if (!cancelled) setUsers(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) setUsers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [companyId, baseUrl]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!companyId || !username.trim() || !password) {
      setError("Username aur password likhein.");
      return;
    }
    if (atLimit) {
      setError(`Plan limit: is plan me ${formatEntitlementCapLabel(maxUsersCap)} user tak allowed. Upgrade karein ya online shared users kam karein.`);
      return;
    }
    setAdding(true);
    try {
      if (isLocalCompanyId(companyId)) {
        await appendLocalCompanyUserClient(companyId, {
          username: username.trim(),
          password,
          displayName: displayName.trim() || username.trim(),
          role: "manager",
        });
        const doc = await getLocalCompanyById(companyId);
        const rows = parseLocalCompanyUserRows((doc as { localCompanyUsers?: unknown } | null)?.localCompanyUsers);
        setUsers(localCompanyUsersToPublicList(rows));
        setUsername("");
        setPassword("");
        setDisplayName("");
      } else {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/companies/${companyId}/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.trim(), password, displayName: displayName.trim() || undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error || "Add failed");
        setUsers((prev) => [...prev, { id: data.id, username: data.username, displayName: data.displayName, role: data.role }]);
        setUsername("");
        setPassword("");
        setDisplayName("");
        if (typeof data.localUserCount === "number") {
          try {
            const payload = { localUserCount: data.localUserCount };
            const done = await updateCompanyDocRoot(companyId, payload);
            if (!done && !isLocalCompanyId(companyId)) await updateDoc(doc(firestore, "companies", companyId), payload);
          } catch (_) {}
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setAdding(false);
    }
  };

  if (!companyId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Local users</CardTitle>
        <CardDescription>
          {/* Plan admin: "Max users" Online vs Local — yahan company `storageOption` ke hisaab se effective cap ({maxUsers}). */}
          Is company me kaam karne ke liye username/password se login. Is plan / storage type par max {formatEntitlementCapLabel(maxUsersCap)} user (shared + yahan ke users, owner mila kar). Naya user add karein.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <div>
            <p className="text-sm font-medium mb-2">Users ({users.length})</p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
              {users.length === 0 ? (
                <li>Abhi koi user nahi. Neeche se pehla user add karein.</li>
              ) : (
                users.map((u) => (
                  <li key={u.id}>
                    {u.displayName || u.username} ({u.username}) {u.role ? `· ${u.role}` : ""}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}

        <form onSubmit={handleAdd} className="space-y-4 border-t pt-4">
          <p className="text-sm font-medium flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Add user
          </p>
          <div className="grid gap-2">
            <Label htmlFor="local-username-add">Username</Label>
            <Input
              id="local-username-add"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              disabled={adding}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="local-password-add">Password</Label>
            <Input
              id="local-password-add"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              disabled={adding}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="local-display-add">Display name (optional)</Label>
            <Input
              id="local-display-add"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              disabled={adding}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {atLimit && !error && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Plan limit: is company ke liye max {formatEntitlementCapLabel(maxUsersCap)} user ho sakte hain. Ab add nahi kar sakte.
            </p>
          )}
          <Button type="submit" disabled={adding || atLimit}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Add user
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
