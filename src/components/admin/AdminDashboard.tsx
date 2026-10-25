
"use client";

import { voucherTypeDisplayText } from "@/lib/voucherTypeDisplay";
import React, { useMemo, useState, useEffect, useCallback, useRef, startTransition } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import {
  Users,
  Building2,
  Ticket,
  CreditCard,
  ShieldAlert,
  Activity,
  Database,
  RefreshCw,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  BarChart2,
  Trash2,
  FileClock,
  Globe,
} from "lucide-react";
import { collection, query, where, Timestamp, orderBy } from "firebase/firestore";
import { onSnapshot, getDocs } from "@/lib/pocketbaseData/pbReadSeam";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { ensureAdminSync } from "@/lib/adminSync";
import { useDate } from "@/hooks/useDate";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DateRange } from "@/components/ui/ad-calendar";
import { startOfDay, endOfDay } from 'date-fns';
import { AdminPanelDateRangePicker } from "@/components/admin/AdminPanelDateRangePicker";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";


// --- TYPES ---
type RangeKey = "today" | "7d" | "30d";

// --- HELPER FUNCTIONS ---
const safeToDate = (date: any): Date | null => {
  if (!date) return null;
  if (date instanceof Date) return date;
  if (date.toDate instanceof Function) return date.toDate();
  if (date.seconds) return new Timestamp(date.seconds, date.nanoseconds).toDate();
  const parsed = new Date(date);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Admin dashboard date filter: BS range → AD kabhi mismatch se 0 match aata hai.
 * Agar range me koi voucher nahi par DB me hain to **saare** vouchers dikhao (purana “data gayab” wala bug avoid).
 */
function getVouchersInRangeForAdmin(
  allVouchers: any[],
  dateRange: DateRange | undefined
): { vouchers: any[]; ignoredBrokenRange: boolean } {
  if (!dateRange?.from) return { vouchers: allVouchers, ignoredBrokenRange: false };
  const from = startOfDay(dateRange.from);
  const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
  const filtered = allVouchers.filter((v) => {
    const vDate = safeToDate(v.date);
    return vDate && vDate >= from && vDate <= to;
  });
  if (filtered.length === 0 && allVouchers.length > 0) {
    return { vouchers: allVouchers, ignoredBrokenRange: true };
  }
  return { vouchers: filtered, ignoredBrokenRange: false };
}

// --- UI COMPONENTS ---
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border bg-background p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col space-y-1">
            <span className="text-[0.70rem] uppercase text-muted-foreground">Type</span>
            <span className="font-bold text-muted-foreground">{label}</span>
          </div>
          {payload.map((p: any) => (
            <div key={p.dataKey} className="flex flex-col space-y-1">
              <span className="text-[0.70rem] uppercase text-muted-foreground">{p.name}</span>
              <span className="font-bold" style={{ color: p.color }}>{p.value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

// --- DATA-FETCHING SUB-COMPONENTS ---

const UserStatsCard = ({ users, loading }: { users: any[], loading: boolean}) => {
    const stats = useMemo(() => {
        const total = users.length;
        const active = users.filter(u => u.isActive !== false).length;
        const inactive = total - active;
        const online = users.filter(u => {
            const lastSeen = safeToDate(u.lastSeen);
            return u.online && lastSeen && (new Date().getTime() - lastSeen.getTime() < 60000); // 1 minute threshold
        }).length;
        const offline = total - online;
        return { total, active, inactive, online, offline };
    }, [users]);
    
    if (loading) return <Skeleton className="h-44"/>;

    return (
        <Card>
            <CardHeader><CardTitle>Users Status</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
                <div className="text-center p-2 border rounded-lg"><p className="text-xs text-muted-foreground">Total Users</p><p className="text-2xl font-bold">{stats.total}</p></div>
                <div className="text-center p-2 border rounded-lg"><p className="text-xs text-muted-foreground">Active</p><p className="text-2xl font-bold text-green-600">{stats.active}</p></div>
                <div className="text-center p-2 border rounded-lg"><p className="text-xs text-muted-foreground">Inactive</p><p className="text-2xl font-bold text-red-600">{stats.inactive}</p></div>
                <div className="text-center p-2 border rounded-lg col-span-3 grid grid-cols-2 gap-4">
                    <div><p className="text-xs text-muted-foreground">Online</p><p className="text-2xl font-bold text-blue-600">{stats.online}</p></div>
                    <div><p className="text-xs text-muted-foreground">Offline</p><p className="text-2xl font-bold text-gray-500">{stats.offline}</p></div>
                </div>
            </CardContent>
        </Card>
    );
}

/** User by country: users categorized by country set from IP at signup */
const ActivityByCountryCard = ({ allUsers, allCompanies, allVouchers, loading, dateRange }: { allUsers: any[], allCompanies: any[], allVouchers: any[], loading: boolean, dateRange: DateRange | undefined }) => {
    const [selectedCountry, setSelectedCountry] = useState<string>('all');
    
    const countries = useMemo(() => {
        const countrySet = new Set<string>();
        allUsers.forEach(u => { if (u.country) countrySet.add(u.country) });
        return ['all', ...Array.from(countrySet).sort()];
    }, [allUsers]);

    const countryStats = useMemo(() => {
        const usersInCountry = selectedCountry === 'all' 
            ? allUsers 
            : allUsers.filter(u => u.country === selectedCountry);

        const userIdsInCountry = new Set(usersInCountry.map(u => u.id));
        
        const companiesInCountry = selectedCountry === 'all'
            ? allCompanies
            : allCompanies.filter(c => userIdsInCountry.has(c.ownerId));

        const { vouchers: vouchersInRange } = getVouchersInRangeForAdmin(allVouchers, dateRange);
            
        const vouchersInCountry = selectedCountry === 'all'
            ? vouchersInRange
            : vouchersInRange.filter(v => v.userId && userIdsInCountry.has(v.userId));
            
        const now = new Date().getTime();
        const onlineUsers = usersInCountry.filter(u => {
            const lastSeen = safeToDate(u.lastSeen);
            return u.online && lastSeen && (now - lastSeen.getTime() < 60000);
        }).length;

        return {
            totalUsers: usersInCountry.length,
            onlineUsers,
            offlineUsers: usersInCountry.length - onlineUsers,
            activeUsers: usersInCountry.filter(u => u.isActive !== false).length,
            inactiveUsers: usersInCountry.filter(u => u.isActive === false).length,
            totalCompanies: companiesInCountry.length,
            totalVouchers: vouchersInCountry.length,
        };
    }, [selectedCountry, allUsers, allCompanies, allVouchers, dateRange]);
    
     if (loading) return <Skeleton className="h-44"/>;
    
    const StatItem = ({ label, value }: { label: string, value: number }) => (
        <div className="text-center p-2 border rounded-lg">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold">{value}</p>
        </div>
    );

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                    <CardTitle>User by Country {countries.length > 1 && <span className="text-muted-foreground font-normal">({countries.length - 1})</span>}</CardTitle>
                    <CardDescription className="text-xs">By user&apos;s country (from IP at signup)</CardDescription>
                </div>
                <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select Country" />
                    </SelectTrigger>
                    <SelectContent>
                        {countries.map(c => <SelectItem key={c} value={c}>{c === 'all' ? 'All Countries' : c}</SelectItem>)}
                    </SelectContent>
                </Select>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2">
                <StatItem label="Users" value={countryStats.totalUsers} />
                <StatItem label="Companies" value={countryStats.totalCompanies} />
                <StatItem label="Vouchers" value={countryStats.totalVouchers} />
                <StatItem label="Active" value={countryStats.activeUsers} />
                <StatItem label="Inactive" value={countryStats.inactiveUsers} />
                <div className="grid grid-cols-2 gap-2 col-span-3">
                    <StatItem label="Online" value={countryStats.onlineUsers} />
                    <StatItem label="Offline" value={countryStats.offlineUsers} />
                </div>
            </CardContent>
        </Card>
    );
};

/** Company by country: companies categorized by country selected in company profile */
const CompanyByCountryCard = ({ allUsers, allCompanies, allVouchers, loading, dateRange }: { allUsers: any[], allCompanies: any[], allVouchers: any[], loading: boolean, dateRange: DateRange | undefined }) => {
    const [selectedCountry, setSelectedCountry] = useState<string>('all');

    const countries = useMemo(() => {
        const set = new Set<string>();
        allCompanies.forEach((c: { country?: string }) => { if (c.country) set.add(c.country); });
        return ['all', ...Array.from(set).sort()];
    }, [allCompanies]);

    const stats = useMemo(() => {
        const companiesInCountry = selectedCountry === 'all'
            ? allCompanies
            : allCompanies.filter((c: { country?: string }) => c.country === selectedCountry);
        const ownerIds = new Set(companiesInCountry.map((c: { ownerId?: string }) => c.ownerId).filter(Boolean));
        const usersInCountry = allUsers.filter((u: { id: string }) => ownerIds.has(u.id));
        const companyIds = new Set(companiesInCountry.map((c: { id: string }) => c.id));
        const { vouchers: vouchersInRange } = getVouchersInRangeForAdmin(allVouchers, dateRange);
        const vouchersInCountry = selectedCountry === 'all'
            ? vouchersInRange
            : vouchersInRange.filter((v: { companyId?: string }) => v.companyId && companyIds.has(v.companyId));
        const now = new Date().getTime();
        const onlineUsers = usersInCountry.filter((u: { online?: boolean; lastSeen?: unknown }) => {
            const lastSeen = safeToDate(u.lastSeen);
            return u.online && lastSeen && (now - lastSeen.getTime() < 60000);
        }).length;
        return {
            totalUsers: usersInCountry.length,
            companies: companiesInCountry.length,
            vouchers: vouchersInCountry.length,
            activeUsers: usersInCountry.filter((u: { isActive?: boolean }) => u.isActive !== false).length,
            inactiveUsers: usersInCountry.filter((u: { isActive?: boolean }) => u.isActive === false).length,
            onlineUsers,
            offlineUsers: usersInCountry.length - onlineUsers,
        };
    }, [selectedCountry, allUsers, allCompanies, allVouchers, dateRange]);

    if (loading) return <Skeleton className="h-44" />;

    const StatItem = ({ label, value }: { label: string; value: number }) => (
        <div className="text-center p-2 border rounded-lg">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold">{value}</p>
        </div>
    );

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                    <CardTitle>Company by Country {countries.length > 1 && <span className="text-muted-foreground font-normal">({countries.length - 1})</span>}</CardTitle>
                    <CardDescription className="text-xs">By company profile country</CardDescription>
                </div>
                <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select Country" />
                    </SelectTrigger>
                    <SelectContent>
                        {countries.map(c => <SelectItem key={c} value={c}>{c === 'all' ? 'All Countries' : c}</SelectItem>)}
                    </SelectContent>
                </Select>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2">
                <StatItem label="Users" value={stats.totalUsers} />
                <StatItem label="Companies" value={stats.companies} />
                <StatItem label="Vouchers" value={stats.vouchers} />
                <StatItem label="Active" value={stats.activeUsers} />
                <StatItem label="Inactive" value={stats.inactiveUsers} />
                <div className="grid grid-cols-2 gap-2 col-span-3">
                    <StatItem label="Online" value={stats.onlineUsers} />
                    <StatItem label="Offline" value={stats.offlineUsers} />
                </div>
            </CardContent>
        </Card>
    );
};

/** Admin dashboard — har voucher type ka card (AddVoucher + recycle/print me jo types milte hain). */
const ADMIN_VOUCHER_SUMMARY_TYPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "sale", label: "Sale" },
  { id: "purchase", label: "Purchase" },
  { id: "payment_in", label: "Receipt" },
  { id: "payment_out", label: "Payment Out" },
  { id: "pay_salary", label: "Pay Salary" },
  { id: "contra", label: "Contra" },
  { id: "journal", label: "Journal" },
  { id: "adjustment", label: "Adjustment" },
  { id: "add_salary", label: "Add Salary" },
  { id: "note", label: "Note" },
  { id: "direct_income", label: "Direct Income" },
  { id: "direct_expense", label: "Direct Expense" },
  { id: "production", label: "Production" },
  { id: "inter_company", label: "Inter Company" },
  { id: "quotation", label: "Quotation" },
  { id: "sales_return", label: "Sale Return" },
  { id: "purchase_return", label: "Purchase Return" },
  { id: "credit_note", label: "Credit Note" },
  { id: "debit_note", label: "Debit Note" },
  { id: "stock_in", label: "Stock In" },
  { id: "stock_out", label: "Stock Out" },
];

const ADMIN_VOUCHER_SUMMARY_TYPE_IDS = new Set(ADMIN_VOUCHER_SUMMARY_TYPES.map((row) => row.id));

/** Journal add_salary / payment_out pay_salary subType buckets — baaki `type`. */
function adminVoucherSummaryKey(voucher: { type?: string; subType?: string }): string | null {
  const sub = String(voucher.subType || "").trim();
  if (sub === "add_salary" || sub === "pay_salary") return sub;
  const type = String(voucher.type || "").trim();
  return type || null;
}

const EntitySummaryCard = ({ companies, vouchers, dateRange, loading, vouchersError, currentUserEmail }: { companies: any[], vouchers: any[], dateRange: DateRange | undefined, loading: boolean; vouchersError?: string | null; currentUserEmail?: string | null }) => {
    const { vouchers: filteredVouchers, ignoredBrokenRange } = useMemo(
        () => getVouchersInRangeForAdmin(vouchers, dateRange),
        [vouchers, dateRange]
    );

    const voucherStats = useMemo(() => {
        const stats: Record<string, number> = {};
        ADMIN_VOUCHER_SUMMARY_TYPES.forEach((row) => {
            stats[row.id] = 0;
        });
        filteredVouchers.forEach((voucher) => {
            const key = adminVoucherSummaryKey(voucher);
            if (key && ADMIN_VOUCHER_SUMMARY_TYPE_IDS.has(key)) {
                stats[key] = (stats[key] || 0) + 1;
            }
        });
        stats.total = filteredVouchers.length;
        return stats;
    }, [filteredVouchers]);

    if (loading) return <Skeleton className="h-44"/>;

    return (
        <Card>
            <CardHeader><CardTitle>Entity &amp; Voucher Summary</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                {ignoredBrokenRange && (
                    <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-100">
                        Date range me koi voucher match nahi hua (BS/AD mismatch ho sakta hai) — totals ke liye <strong>saare</strong> vouchers dikhaye ja rahe hain. Range clear karke dubara chunein.
                    </p>
                )}
                 <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 border rounded-lg bg-muted/30">
                        <p className="text-sm font-medium text-muted-foreground">Total Companies</p>
                        <p className="text-3xl font-bold">{companies.length}</p>
                    </div>
                    <div className="text-center p-4 border rounded-lg bg-muted/30">
                        <p className="text-sm font-medium text-muted-foreground">Total Vouchers</p>
                        <p className="text-3xl font-bold">{voucherStats.total || 0}</p>
                        {vouchersError && (
                            <span className="block text-xs text-destructive mt-1 space-y-0.5">
                                <span className="block">{vouchersError}</span>
                                <span className="block text-muted-foreground font-mono text-[10px] mt-0.5">
                                    Query: companies/&#123;companyId&#125;/vouchers (per company, same as user dashboard)
                                </span>
                                {currentUserEmail && (
                                    <span className="block text-muted-foreground font-mono text-[10px] mt-0.5">
                                        Login: {currentUserEmail} — add in firestore.rules isSuperAdminEmail(), then: firebase deploy --only firestore:rules
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                </div>
                <div className="pt-4 border-t">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                        {ADMIN_VOUCHER_SUMMARY_TYPES.map((row) => (
                            <div key={row.id} className="text-center p-2 rounded-lg bg-muted/50 border">
                                <p className="text-[10px] font-semibold text-muted-foreground truncate">{row.label}</p>
                                <p className="text-lg font-bold">{voucherStats[row.id] || 0}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const VoucherChartCard = ({ vouchers, dateRange, loading }: { vouchers: any[], dateRange: DateRange | undefined, loading: boolean}) => {
    const { vouchers: filteredVouchers, ignoredBrokenRange } = useMemo(
        () => getVouchersInRangeForAdmin(vouchers, dateRange),
        [vouchers, dateRange]
    );

    const chartData = useMemo(() => {
        const counts: Record<string, number> = {};
        filteredVouchers.forEach(v => {
            const type = v.subType || v.type;
            if (type) counts[type] = (counts[type] || 0) + 1;
        });
        return Object.entries(counts).map(([name, count]) => ({ name: voucherTypeDisplayText(name).replace(/\b\w/g, l => l.toUpperCase()), count }));
    }, [filteredVouchers]);

    const BAR_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1", "#14b8a6", "#a855f7"];

    return (
        <Card className="col-span-1 lg:col-span-3">
            <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>Voucher Activity</CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                        {ignoredBrokenRange && (
                            <Badge variant="outline" className="text-amber-700 border-amber-500/50">Range ignored — showing all</Badge>
                        )}
                    <Badge variant="secondary">Total: {filteredVouchers.length} vouchers</Badge>
                    </div>
                </div>
            </CardHeader>
            {/* Fixed height: ResponsiveContainer height="100%" flex parent me kabhi -1 deta hai (recharts warning) */}
            <CardContent className="flex flex-col p-4 pb-[4px]">
                 {loading ? <Skeleton className="h-[400px] w-full"/> : (
                 <div className="h-[400px] w-full min-h-[340px] min-w-0">
                 <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap="10%">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" interval={0} height={1} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} tick={(props: { x?: number | string; y?: number | string; payload?: { value?: string } }) => {
                          const { x = 0, y = 0, payload } = props;
                          const tx = Number(x) || 0;
                          const ty = (Number(y) || 0) - 88;
                          return payload?.value ? (
                            <text x={tx} y={ty} textAnchor="middle" fill="black" fontSize={24} fontWeight={500} transform={`rotate(-90, ${tx}, ${ty})`} style={{ overflow: 'visible' }}>{payload.value}</text>
                          ) : <text x={tx} y={ty} />;
                        }} />
                        <YAxis />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="count" name="Count">
                            {chartData.map((_, index) => (
                                <Cell key={index} fill={BAR_COLORS[index % BAR_COLORS.length]} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
                 </div>
                 )}
            </CardContent>
        </Card>
    )
};

const DeletedCompaniesCard = ({ deletedCompanies, loading, dateRange, userMap }: { deletedCompanies: any[], loading: boolean, dateRange: DateRange | undefined, userMap: Map<string, any> }) => {
    
    const filteredCompanies = useMemo(() => {
        if (!dateRange?.from) return deletedCompanies.slice(0, 15);
        const from = startOfDay(dateRange.from);
        const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(from);
        return deletedCompanies.filter(c => {
            const deletedAt = safeToDate(c.deletedAt);
            return deletedAt && deletedAt >= from && deletedAt <= to;
        });
    }, [deletedCompanies, dateRange]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Trash2 className="text-red-500"/> Deleted Companies</CardTitle>
                <CardDescription>Recently deleted companies in user recycle bins.</CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? <Skeleton className="h-24"/> : filteredCompanies.length > 0 ? (
                    <ul className="space-y-3 text-sm">
                        {filteredCompanies.map(c => {
                            const owner = userMap.get(c.ownerId);
                            return (
                                <li key={c.id} className="flex justify-between items-center p-2 border rounded-lg">
                                    <div className="flex items-center gap-3 flex-shrink min-w-0">
                                        <Avatar>
                                            <AvatarImage src={owner?.photoURL} />
                                            <AvatarFallback>{owner?.displayName?.[0] || 'U'}</AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0">
                                            <p className="font-semibold truncate">{owner?.displayName || 'Unknown User'}</p>
                                            <p className="text-xs text-muted-foreground truncate">{owner?.email}</p>
                                        </div>
                                    </div>
                                    <p className="font-semibold text-sm px-4 truncate">{c.name}</p>
                                    <Badge variant="secondary" className="font-mono text-xs whitespace-nowrap">
                                        {safeToDate(c.deletedAt)?.toLocaleDateString()}
                                    </Badge>
                                </li>
                            )
                        })}
                    </ul>
                ) : <p className="text-sm text-center text-muted-foreground py-4">No companies deleted in this period.</p>}
            </CardContent>
        </Card>
    );
}

const RecentActivityCard = ({ activities, userMap, loading, dateRange }: { activities: any[], userMap: Map<string, any>, loading: boolean, dateRange: DateRange | undefined}) => {
    
    const filteredActivities = useMemo(() => {
        if (!dateRange?.from) return activities.slice(0, 15);
        const from = startOfDay(dateRange.from);
        const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(from);
        return activities.filter(a => {
            const activityAt = safeToDate(a.at);
            return activityAt && activityAt >= from && activityAt <= to;
        });
    }, [activities, dateRange]);
    
    return (
        <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileClock/> Recent Admin Activity</CardTitle></CardHeader>
            <CardContent>
                {loading ? <Skeleton className="h-24"/> : filteredActivities.length > 0 ? (
                    <ul className="space-y-4">
                       {filteredActivities.map(a => {
                           const actor = userMap.get(a.byUserId);
                           const actorName = actor?.displayName || actor?.email || 'Unknown User';
                           const targetUser = a.meta?.targetUserId ? userMap.get(a.meta.targetUserId) : null;
                           const entitySubjectId = a.meta?.uid || a.meta?.targetUserId || a.companyId;
                           const entityUser = userMap.get(entitySubjectId);
                           const entityDisplay = entityUser?.email || entityUser?.displayName || entitySubjectId;

                           return (
                               <li key={a.id} className="text-sm">
                                   <div className="flex justify-between items-start">
                                       <p className="font-semibold">{a.action.replace(/_/g, ' ')}</p>
                                       <p className="text-xs text-muted-foreground whitespace-nowrap">{safeToDate(a.at)?.toLocaleTimeString()}</p>
                                   </div>
                                   <div className="text-xs text-muted-foreground mt-1 space-y-1">
                                       <p>By: {actorName} ({actor?.email || '...'})</p>
                                       {a.action === 'USER_ROLE_UPDATE' && targetUser ? (
                                           <div className="pl-2 border-l-2 ml-1 mt-1 pt-1 space-y-1">
                                               <p>Target User: {targetUser.displayName || 'Unknown'} ({targetUser.email || '...'})</p>
                                               <div className="mt-0.5">Role changed from <Badge variant="secondary">{a.meta.oldRole}</Badge> to <Badge>{a.meta.newRole}</Badge></div>
                                           </div>
                                       ) : (
                                            <p>On Entity: {entityDisplay}</p>
                                       )}
                                   </div>
                               </li>
                           )
                       })}
                    </ul>
                ) : <p className="text-sm text-center text-muted-foreground py-4">No recent activity in this period.</p>}
            </CardContent>
        </Card>
    )
}

const AlertsCard = () => {
    return (
        <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="text-amber-500"/> System Alerts</CardTitle></CardHeader>
            <CardContent>
                 <p className="text-sm text-center text-muted-foreground py-4">No system alerts.</p>
            </CardContent>
        </Card>
    )
};


// --- MAIN DASHBOARD COMPONENT ---
export default function AdminDashboard() {
  const { user, customUser, loading: authLoading } = useAuth();
  useAdminAccess(['SuperAdmin', 'CompanyAdmin']);
  // Default: koi date filter nahi — saare vouchers/counts (BS range mismatch se 0 na ho jayein)
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  useDate();

  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [allVouchers, setAllVouchers] = useState<any[]>([]);
  const [deletedCompanies, setDeletedCompanies] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [vouchersError, setVouchersError] = useState<string | null>(null);
  /** BsDatePicker + Popover (Radix): SSR/client par alag id → hydration warning; mount ke baad hi real pickers */
  const [dateRadixReady, setDateRadixReady] = useState(false);
  useEffect(() => {
    setDateRadixReady(true);
  }, []);

  // 1) Sync admin + subscribe to users, companies, deleted, activities
  useEffect(() => {
    // customUser ke aane tak wait — warna early return se setLoading(false) kabhi nahi chalta aur UI hamesha skeleton par atki rahti hai
    if (!user) {
      setLoading(false);
      return;
    }
    if (authLoading) return;
    if (!customUser) {
      setLoading(false);
      return;
    }
    if (customUser.role !== 'SuperAdmin' && customUser.role !== 'CompanyAdmin') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setVouchersError(null);
    let unsubs: (() => void)[] = [];
    let cancelled = false;

    (async () => {
      try {
        await ensureAdminSync(user, customUser.role);
      } catch (_) { /* ignore */ }
      if (cancelled) return;

      const queries = [
        { q: query(collection(firestore, "users")), setter: setAllUsers },
        { q: query(collection(firestore, "companies")), setter: setAllCompanies },
        { q: query(collection(firestore, "companies"), where("isDeleted", "==", true)), setter: setDeletedCompanies },
        { q: query(collection(firestore, 'activity_logs'), orderBy('at', 'desc')), setter: setActivities },
      ];

      unsubs = queries.map(({ q, setter }) =>
        onSnapshot(q, (snap) => {
          if (cancelled) return;
          setter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, (error) => console.error("Error fetching data for admin dashboard:", error))
      );

      try {
        await Promise.all(queries.map(({ q }) => getDocs(q)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubs.forEach(unsub => unsub());
    };
  }, [user, customUser, authLoading]);

  // 2) Live vouchers: subscribe per company (companies/{companyId}/vouchers) so count updates in real time
  const vouchersByCompanyRef = React.useRef<Record<string, { id: string; [key: string]: any }[]>>({});
  useEffect(() => {
    if (allCompanies.length === 0) {
      vouchersByCompanyRef.current = {};
      setAllVouchers([]);
      return;
    }
    setVouchersError(null);
    const unsubs: (() => void)[] = [];
    let mergeTimer: ReturnType<typeof setTimeout> | null = null;
    const mergeAndSet = () => {
      if (mergeTimer) clearTimeout(mergeTimer);
      mergeTimer = setTimeout(() => {
        const combined = Object.values(vouchersByCompanyRef.current).flat();
        startTransition(() => setAllVouchers(combined));
      }, 120);
    };
    allCompanies.forEach((c: { id: string }) => {
      const ref = collection(firestore, 'companies', c.id, 'vouchers');
      const unsub = onSnapshot(
        ref,
        (snap) => {
          vouchersByCompanyRef.current[c.id] = snap.docs.map(d => ({ id: d.id, companyId: c.id, ...d.data() }));
          mergeAndSet();
        },
        (err: any) => {
          if (err?.message?.includes('permission') || err?.code === 'permission-denied') {
            setVouchersError('Permission denied for vouchers.');
          } else {
            console.error("Error fetching admin vouchers:", err);
          }
          vouchersByCompanyRef.current[c.id] = [];
          mergeAndSet();
        }
      );
      unsubs.push(unsub);
    });
    return () => {
      if (mergeTimer) clearTimeout(mergeTimer);
      unsubs.forEach(u => u());
      vouchersByCompanyRef.current = {};
    };
  }, [allCompanies]);

  const userMap = useMemo(() => {
    const map = new Map<string, any>();
    allUsers.forEach(u => map.set(u.id, u));
    return map;
  }, [allUsers]);
  
  return (
    <div className="p-4 md:p-6 space-y-6 h-full overflow-y-auto">
        <div className="flex flex-wrap justify-end items-center gap-2">
            <AdminPanelDateRangePicker
              value={dateRange}
              onChange={setDateRange}
              ready={dateRadixReady}
            />
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-[35fr_65fr]">
            <UserStatsCard users={allUsers} loading={loading} />
            <EntitySummaryCard companies={allCompanies} vouchers={allVouchers} dateRange={dateRange} loading={loading} vouchersError={vouchersError} currentUserEmail={user?.email ?? customUser?.email ?? null} />
        </div>
        <div className="grid gap-4">
            <VoucherChartCard vouchers={allVouchers} dateRange={dateRange} loading={loading}/>
        </div>
         <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
             <ActivityByCountryCard allUsers={allUsers} allCompanies={allCompanies} allVouchers={allVouchers} loading={loading} dateRange={dateRange} />
             <CompanyByCountryCard allUsers={allUsers} allCompanies={allCompanies} allVouchers={allVouchers} loading={loading} dateRange={dateRange} />
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            <DeletedCompaniesCard deletedCompanies={deletedCompanies} loading={loading} dateRange={dateRange} userMap={userMap} />
            <RecentActivityCard activities={activities} userMap={userMap} loading={loading} dateRange={dateRange} />
        </div>
        <div className="grid gap-4">
            <AlertsCard />
        </div>
    </div>
  )
}
