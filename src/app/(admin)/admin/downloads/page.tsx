"use client";

import { ADMIN_SERVER_VIEW_UNAVAILABLE_MESSAGE, isAdminServerMode } from "@/lib/adminData/adminServerMode";
import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useAuth } from "@/hooks/useAuth";
import { auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  emptyDownloadStats,
  type WebsiteDownloadEvent,
  type WebsiteDownloadStats,
} from "@/lib/websiteDownloadStats";
import { appApiUrl } from "@/lib/webAppBasePath";

function countryLabel(code: string): string {
  const c = String(code || "ZZ").toUpperCase();
  if (c === "ZZ") return "Unknown";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(c) || c;
  } catch {
    return c;
  }
}

function formatWhen(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

export default function WebsiteDownloadsAdminPage() {
  useAdminAccess(["SuperAdmin"]);
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<WebsiteDownloadStats>(emptyDownloadStats());
  const [byCountry, setByCountry] = useState<Array<{ country: string; count: number }>>([]);
  const [recent, setRecent] = useState<WebsiteDownloadEvent[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isAdminServerMode()) throw new Error(ADMIN_SERVER_VIEW_UNAVAILABLE_MESSAGE);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetch(appApiUrl("/api/admin/download-stats"), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = (await res.json()) as {
        error?: string;
        stats?: WebsiteDownloadStats;
        byCountry?: Array<{ country: string; count: number }>;
        recent?: WebsiteDownloadEvent[];
      };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setStats(json.stats || emptyDownloadStats());
      setByCountry(Array.isArray(json.byCountry) ? json.byCountry : []);
      setRecent(Array.isArray(json.recent) ? json.recent : []);
    } catch (e: unknown) {
      toast({
        title: "Could not load download stats",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Website downloads
            </CardTitle>
            <CardDescription>
              Counts EXE / APK / Play Store clicks from the public Downloads page, with country when the host provides it.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Total downloads</div>
            <div className="text-2xl font-semibold tabular-nums">{loading ? "…" : stats.total}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Windows EXE</div>
            <div className="text-2xl font-semibold tabular-nums">{loading ? "…" : stats.byPlatform.windows}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Android APK</div>
            <div className="text-2xl font-semibold tabular-nums">{loading ? "…" : stats.byPlatform.android}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Play Store</div>
            <div className="text-2xl font-semibold tabular-nums">{loading ? "…" : stats.byPlatform.play}</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By country</CardTitle>
            <CardDescription>Where download clicks came from.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Downloads</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={2}>Loading…</TableCell>
                  </TableRow>
                ) : byCountry.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground">
                      No downloads recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  byCountry.map((row) => (
                    <TableRow key={row.country}>
                      <TableCell>
                        {countryLabel(row.country)}{" "}
                        <span className="text-muted-foreground">({row.country})</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent clicks</CardTitle>
            <CardDescription>Latest 100 website download clicks.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4}>Loading…</TableCell>
                  </TableRow>
                ) : recent.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No recent events.
                    </TableCell>
                  </TableRow>
                ) : (
                  recent.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatWhen(row.createdAtMs)}</TableCell>
                      <TableCell className="capitalize">{row.platform}</TableCell>
                      <TableCell>{countryLabel(row.country)}</TableCell>
                      <TableCell className="text-muted-foreground">{row.version || "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
