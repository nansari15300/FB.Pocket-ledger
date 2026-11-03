"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";
import { useHrEmployees } from "../hooks/useHrEmployees";
import { HrGate } from "../components/HrGate";

export function EmployeesPage() {
  return (
    <HrGate>
      <EmployeesPageBody />
    </HrGate>
  );
}

function EmployeesPageBody() {
  const router = useRouter();
  const { company } = useCompany();
  const { processedStaff } = useVouchers();
  const { formatCurrency } = useDate();
  const { canManage } = useHrModuleFeature();
  const { employees, loading, error, disabled, reload } = useHrEmployees();
  const [search, setSearch] = useState("");

  const staffNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of processedStaff || []) m.set(s.id, String(s.name || ""));
    return m;
  }, [processedStaff]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees
      .map((e) => ({ ...e, staffName: staffNameById.get(e.staff_app_id) || "(staff missing)" }))
      .filter((e) =>
        !q
          ? true
          : [e.staffName, e.designation, e.department].some((v) => String(v || "").toLowerCase().includes(q))
      )
      .sort((a, b) => a.staffName.localeCompare(b.staffName));
  }, [employees, staffNameById, search]);

  if (!company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="h-full min-h-0 space-y-3 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/hr")} aria-label="Back to HR">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">Employees</h1>
          <span className="text-sm text-muted-foreground">({employees.length})</span>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className={loading ? "mr-1 h-4 w-4 animate-spin" : "mr-1 h-4 w-4"} />
              Refresh
            </Button>
            {canManage ? (
              <Button type="button" size="sm" onClick={() => router.push("/hr/employees/new")}>
                <Plus className="mr-1 h-4 w-4" />
                Add Employee
              </Button>
            ) : null}
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / designation / department"
            className="pl-8"
          />
        </div>

        {disabled ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Server: HR आपके plan में उपलब्ध नहीं है (hr_disabled).
          </p>
        ) : error ? (
          <p className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">
            Employees load nahi ho paye: {error}
          </p>
        ) : null}

        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Joining</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Salary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && employees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    {employees.length === 0 ? "No employees yet. Add Employee से staff चुनें।" : "No match."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((e) => (
                  <TableRow
                    key={e.app_id}
                    className="cursor-pointer hover:bg-muted/60"
                    onClick={() => router.push(`/hr/employees/${encodeURIComponent(e.app_id)}`)}
                  >
                    <TableCell className="font-medium">{e.staffName}</TableCell>
                    <TableCell>{e.designation || "—"}</TableCell>
                    <TableCell>{e.department || "—"}</TableCell>
                    <TableCell>{e.joining_date || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={e.status === "active" ? "default" : "secondary"}>
                        {e.status === "active" ? "Active" : "Left"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(e.base_salary || 0))}
                      <span className="ml-1 text-xs text-muted-foreground">
                        /{e.salary_type === "daily" ? "day" : "month"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
