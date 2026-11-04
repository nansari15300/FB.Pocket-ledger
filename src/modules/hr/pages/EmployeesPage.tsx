"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Pencil, Plus, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TableBody, TableCell, TableFooter, TableHead, TableRow } from "@/components/ui/table";
import { CreateStaffDialog } from "@/components/staff/CreateStaffDialog";
import { useCompany } from "@/hooks/useCompany";
import { useVouchers } from "@/hooks/useVouchers";
import { useDate } from "@/hooks/useDate";
import { useHrModuleFeature } from "@/hooks/useHrModuleFeature";
import { STAFF_SYSTEM_GROUP_ID } from "@/lib/staffSystemGroups";
import { cn, masterDetailBalanceToneClass } from "@/lib/utils";
import { LOAN_LIABILITY_GROUP_ID } from "@/modules/loans/constants/loanConstants";
import { useFormatLoanIso } from "@/modules/loans/components/LoanSystemDateField";
import { useHrEmployees } from "../hooks/useHrEmployees";
import { HrGate } from "../components/HrGate";
import { HrEditStaffDialog } from "../components/HrEditStaffDialog";
import { HR_FIELD_SCOPE, HR_NARRATION_TEXT, HR_PAGE_BODY, HrHeaderCard, HrPill, HrSearchInput, hrRibbon } from "../components/HrChrome";
import {
  HR_TABLE_FOOTER,
  HR_FILL_COLUMN,
  HR_SNO_CELL,
  HR_SNO_HEAD,
  HR_TABLE_FRAME,
  HR_TABLE_FRAME_DATA,
  HR_TABLE_FRAME_FILL,
  HR_TABLE_ROW,
  HrTable,
  HrTableHeader,
  hrStripe,
} from "../components/HrTable";

/** `embedded`: shown inside the HR home tab panel (no back arrow / title; the tab card is the title). */
export function EmployeesPage({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <HrGate>
      <EmployeesPageBody embedded={embedded} />
    </HrGate>
  );
}

function EmployeesPageBody({ embedded }: { embedded: boolean }) {
  const router = useRouter();
  const { company } = useCompany();
  const { processedStaffGroups } = useVouchers();
  const { formatCurrency } = useDate();
  const formatIso = useFormatLoanIso();
  const { canManage } = useHrModuleFeature();
  const { employees, typeUnsure, staffById, loading, error, reload } = useHrEmployees();
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<"active" | "left" | "all">("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [editStaffId, setEditStaffId] = useState<string | null>(null);
  const [unsureOpen, setUnsureOpen] = useState(false);

  /** Department = HR department if set, else the staff Group/Department (not the system groups). */
  const departmentOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const g of (processedStaffGroups || []) as Array<{ id?: string; name?: string }>) {
      if (g?.id && g.name) names.set(g.id, g.name);
    }
    return (staffId: string, hrDepartment: string) => {
      if (hrDepartment) return hrDepartment;
      const gid = String(staffById.get(staffId)?.groupId || "");
      if (!gid || gid === STAFF_SYSTEM_GROUP_ID || gid === LOAN_LIABILITY_GROUP_ID) return "";
      return names.get(gid) || "";
    };
  }, [processedStaffGroups, staffById]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) =>
      (statusTab === "all" || (statusTab === "left" ? e.status === "left" : e.status !== "left")) &&
      (!q
        ? true
        : [e.name, e.designation, departmentOf(e.app_id, e.department)].some((v) =>
            String(v || "").toLowerCase().includes(q)
          ))
    );
  }, [employees, search, departmentOf, statusTab]);

  /** Footer total of the Balance column (same values the rows show). */
  const totalBalance = rows.reduce((sum, e) => sum + Number(staffById.get(e.app_id)?.balance ?? 0), 0);

  if (!company) {
    return <p className="p-4 text-sm text-muted-foreground">Select a company to use HR.</p>;
  }

  return (
    <div data-pl-hr-root="" className={cn("flex h-full min-h-0 flex-col overflow-hidden", HR_FIELD_SCOPE)}>
      <div className={cn(HR_PAGE_BODY, HR_FILL_COLUMN)}>
        <HrHeaderCard tone="sky">
          {embedded ? (
            <span className="text-sm text-muted-foreground">{rows.length} employees</span>
          ) : (
            <>
              <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/hr")} aria-label="Back to HR">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-lg font-semibold">Employees</h1>
              <span className="text-sm text-muted-foreground">({rows.length})</span>
            </>
          )}
          <div className="flex items-center gap-1" role="tablist" aria-label="Employee status filter">
            {(["active", "left", "all"] as const).map((t) => (
              <Button
                key={t}
                type="button"
                role="tab"
                aria-selected={statusTab === t}
                variant="chromePill"
                size="list"
                onClick={() => setStatusTab(t)}
                className={cn(statusTab === t && "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}
              >
                {t === "active" ? "Active" : t === "left" ? "Left" : "All"}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="chromePill" size="list" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className={loading ? "mr-1 h-3.5 w-3.5 animate-spin" : "mr-1 h-3.5 w-3.5"} />
              Refresh
            </Button>
            {canManage ? (
              <Button type="button" variant="chromePill" size="list" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Employee
              </Button>
            ) : null}
          </div>
        </HrHeaderCard>

        <p data-pl-intro="" className={HR_NARRATION_TEXT}>
          Employees are your staff ledgers. Loan and liability accounts are not shown. Double-click a row to edit.
        </p>

        <HrSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name, designation or department"
          ariaLabel="Search employees"
        />

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load employees</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className={cn(HR_TABLE_FRAME, HR_TABLE_FRAME_FILL)} {...HR_TABLE_FRAME_DATA}>
          <HrTable stickyHeaderFooter>
            <HrTableHeader>
              <TableRow className={HR_TABLE_ROW}>
                <TableHead className={HR_SNO_HEAD}>S.No.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Joining</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Salary</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </HrTableHeader>
            <TableBody>
              {loading && employees.length === 0 ? (
                <TableRow className={HR_TABLE_ROW}>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow className={HR_TABLE_ROW}>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    {employees.length === 0 ? "No employees yet. Use Add Employee to create a staff ledger." : "No match."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((e, i) => {
                  const balance = Number(staffById.get(e.app_id)?.balance ?? 0);
                  return (
                    <TableRow
                      key={e.app_id}
                      {...hrStripe(i)}
                      className={cn(HR_TABLE_ROW, "cursor-pointer select-none")}
                      title="Double-click to edit"
                      onDoubleClick={() => setEditStaffId(e.app_id)}
                    >
                      <TableCell className={HR_SNO_CELL}>{i + 1}</TableCell>
                      <TableCell className="font-medium">{e.name || "(no name)"}</TableCell>
                      <TableCell>{e.designation || "—"}</TableCell>
                      <TableCell>{departmentOf(e.app_id, e.department) || "—"}</TableCell>
                      <TableCell>{e.joining_date ? formatIso(e.joining_date) : "—"}</TableCell>
                      <TableCell>
                        {e.status === "left" ? (
                          <HrPill tone="muted" className="border border-destructive/30 bg-destructive/10 text-destructive">
                            {e.left_date ? `Left · ${formatIso(e.left_date)}` : "Left"}
                          </HrPill>
                        ) : (
                          <HrPill tone="good">Active</HrPill>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(e.base_salary || 0), { noSuffix: true })}
                        <span className="ml-1 text-xs text-muted-foreground">
                          /{e.salary_type === "daily" ? "day" : "month"}
                        </span>
                      </TableCell>
                      <TableCell className={cn("text-right font-medium", masterDetailBalanceToneClass(balance))}>
                        {formatCurrency(balance, { showDrCr: true, context: "list" })}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
            {rows.length > 0 ? (
              <TableFooter className={HR_TABLE_FOOTER}>
                <TableRow className={HR_TABLE_ROW}>
                  <TableCell className={HR_SNO_CELL} />
                  <TableCell colSpan={6}>Total ({rows.length})</TableCell>
                  <TableCell className={cn("text-right font-semibold", masterDetailBalanceToneClass(totalBalance))}>
                    {formatCurrency(totalBalance, { showDrCr: true, context: "list" })}
                  </TableCell>
                </TableRow>
              </TableFooter>
            ) : null}
          </HrTable>
        </div>

        {typeUnsure.length > 0 ? (
          <Collapsible open={unsureOpen} onOpenChange={setUnsureOpen}>
            <Card className={hrRibbon("amber")}>
              <CardHeader className="p-4">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-left"
                    aria-label="Show staff with type not set"
                  >
                    <ChevronDown
                      className={cn("h-4 w-4 text-muted-foreground transition-transform", unsureOpen ? "" : "-rotate-90")}
                    />
                    <CardTitle className="text-base">Type not set</CardTitle>
                    <HrPill tone="info">{typeUnsure.length}</HrPill>
                  </button>
                </CollapsibleTrigger>
                <CardDescription data-pl-intro="" className={HR_NARRATION_TEXT}>
                  These staff ledgers are not marked as Staff or Loan &amp; Liabilities. They are not used in
                  attendance or payroll. Edit each one and choose its account type.
                </CardDescription>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="p-4 pt-0">
                  <div className={HR_TABLE_FRAME} {...HR_TABLE_FRAME_DATA}>
                    <HrTable>
                      <HrTableHeader>
                        <TableRow className={HR_TABLE_ROW}>
                          <TableHead>Name</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </HrTableHeader>
                      <TableBody>
                        {typeUnsure.map((e, i) => (
                          <TableRow
                            key={e.app_id}
                            {...hrStripe(i)}
                            className={HR_TABLE_ROW}
                            onDoubleClick={() => setEditStaffId(e.app_id)}
                          >
                            <TableCell className="font-medium">{e.name || "(no name)"}</TableCell>
                            <TableCell>{e.phone || "—"}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                size="list"
                                variant="chromePill"
                                onClick={() => setEditStaffId(e.app_id)}
                                aria-label={`Edit staff ${e.name || ""}`.trim()}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                Edit staff
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </HrTable>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        ) : null}
      </div>

      <CreateStaffDialog
        isOpen={createOpen}
        onOpenChange={setCreateOpen}
        groups={processedStaffGroups}
        onStaffCreated={() => {
          setCreateOpen(false);
        }}
      />

      <HrEditStaffDialog
        staffId={editStaffId}
        open={!!editStaffId}
        onOpenChange={(open) => {
          if (!open) setEditStaffId(null);
        }}
      />
    </div>
  );
}
