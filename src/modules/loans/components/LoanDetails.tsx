"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { CalendarIcon, FilePlus, Pencil, Printer } from "lucide-react";
import { LoanLiabilityEntityIcon } from "@/components/entity/LoanLiabilityEntityIcon";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import AdCalendar, { type DateRange } from "@/components/ui/ad-calendar";
import BsDatePicker from "@/components/ui/BsDatePicker";
import { DateRangePresetRow } from "@/components/ui/DateRangePresetRow";
import { LedgerHeaderPrintButton } from "@/components/vouchers/LedgerHeaderPrintButton";
import { LedgerHeaderReminderButton } from "@/components/vouchers/LedgerHeaderReminderButton";
import { LedgerReminderDialog } from "@/components/vouchers/LedgerReminderDialog";
import { LedgerUnapprovedFilterButton } from "@/components/vouchers/LedgerUnapprovedFilterButton";
import { AddVoucherDialog } from "@/components/vouchers/AddVoucherDialog";
import { HistoryDialog } from "@/components/vouchers/HistoryDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { mlc } from "@/lib/mobileListChrome";
import {
  LEDGER_HEADER_AVATAR_CN,
  LEDGER_HEADER_AVATAR_TRIGGER_CN,
  LEDGER_HEADER_AVATAR_IMAGE_CN,
  LEDGER_HEADER_AVATAR_PEN_CN,
  LEDGER_HEADER_BALANCE_CARD_CN,
  LEDGER_HEADER_BALANCE_CN,
  LEDGER_HEADER_BALANCE_LABEL_CN,
  LEDGER_HEADER_BALANCE_STACK_CN,
  LEDGER_HEADER_IDENTITY_CN,
  LEDGER_HEADER_NAME_CARD_CN,
  LEDGER_HEADER_OUTER_ROW_CN,
  LEDGER_HEADER_PILL_CN,
  LEDGER_HEADER_PILL_ICON_CN,
  LEDGER_HEADER_PILL_ICON_SIZE_CN,
  LEDGER_HEADER_PILL_ROW_CN,
  LEDGER_HEADER_RIBBON_WRAP_CN,
} from "@/lib/ledgerHeaderChrome";
import { ResolvedEntityAvatar } from "@/components/entity/ResolvedEntityAvatar";
import { EntityFileAttachmentHover } from "@/components/entity/EntityFileAttachmentHover";
import { useDate } from "@/hooks/useDate";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/hooks/useCompany";
import { resolveLoanAccountAvatarUrl } from "../utils/resolveLoanAccountAvatarUrl";
import { LoanTableDateCell, LoanTableDateHead } from "./LoanSystemDateField";
import { useVouchers } from "@/hooks/useVouchers";
import type { Loan } from "../types/loanTypes";
import type { LoanScheduleRow } from "../types/loanScheduleTypes";
import type { LoanAuditLog, LoanCharge, LoanDocument, LoanRateHistory, LoanTransaction } from "../types/loanTransactionTypes";
import { LoanSummary } from "./LoanSummary";
import { LoanReportsView } from "./LoanReportsView";
import { LoanScheduleTable } from "./LoanScheduleTable";
import { LoanAccounting, LoanTransactions, type LoanAccountingHandle } from "./LoanTransactions";
import { CreateNoteForm } from "@/components/vouchers/CreateNoteForm";
import { LoanPaymentDialog } from "./LoanPaymentDialog";
import { LoanPrepaymentDialog } from "./LoanPrepaymentDialog";
import { LoanRateChangeDialog } from "./LoanRateChangeDialog";
import { LoanChargeDialog } from "./LoanChargeDialog";
import { LoanCloseDialog } from "./LoanCloseDialog";
import { recordLoanDisbursementFromJournal } from "../services/loanDisbursementService";
import { buildLoanDisbursementJournalDraft } from "../utils/buildLoanDisbursementJournalDraft";
import { LoanForm, loanToDraftInput } from "./LoanForm";
import { LoanStatusBadge } from "./LoanStatusBadge";
import { BTN_SAVE_CLASS } from "@/components/vouchers/voucherButtonStyles";
import { normalizeFileUrlsField } from "@/lib/voucherAttachmentNormalize";
import { saveDocument } from "../db/loanRepository";
import { tryParseIsoDate } from "../utils/loanDateUtils";
import { newLoanDocId, nowIso } from "../db/loanIds";
import { Input } from "@/components/ui/input";
import { isEmiPayableNow } from "../utils/staffPayEmiState";
import { payEmiButtonClassName, payEmiButtonVariant } from "../utils/payEmiButtonStyle";
import { remainingUndisbursedAmount } from "../utils/loanUndisbursed";

export function LoanDetails({
  loan,
  schedule,
  transactions,
  charges,
  rateHistory,
  audit,
  documents,
  onPay,
  onPrepay,
  onRateChange,
  onCharge,
  onClose,
  onReopen,
  onReversePayment,
  onSaveEdit,
  onLoanUpdated,
}: {
  loan: Loan;
  schedule: LoanScheduleRow[];
  transactions: LoanTransaction[];
  charges: LoanCharge[];
  rateHistory: LoanRateHistory[];
  audit: LoanAuditLog[];
  documents: LoanDocument[];
  onPay: (input: import("../types/loanTransactionTypes").LoanPaymentInput) => Promise<void>;
  onPrepay: (input: import("../types/loanTransactionTypes").LoanPrepaymentInput) => Promise<void>;
  onRateChange: (input: import("../types/loanTransactionTypes").LoanRateChangeInput) => Promise<void>;
  onCharge: (input: import("../types/loanTransactionTypes").LoanChargeInput) => Promise<void>;
  onClose: (reason: string, force: boolean) => Promise<void>;
  onReopen?: (reason: string) => Promise<void>;
  onReversePayment?: (transactionId: string) => Promise<void>;
  onSaveEdit?: (input: import("../types/loanTypes").LoanDraftInput) => Promise<void>;
  onLoanUpdated?: () => void | Promise<void>;
}) {
  const [reminderOpen, setReminderOpen] = useState(false);
  const [payRow, setPayRow] = useState<LoanScheduleRow | null>(null);
  const [prepayOpen, setPrepayOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const accountingRef = useRef<LoanAccountingHandle>(null);
  const { formatCurrency, dateSystem } = useDate();
  const { user } = useAuth();
  const { company, companyId } = useCompany();
  const { processedStaff, processedAccounts, userNames } = useVouchers();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [unapprovedOnly, setUnapprovedOnly] = useState(false);
  const [isDesktopCalendarOpen, setIsDesktopCalendarOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<Record<string, unknown> | null>(null);
  const [historyVoucher, setHistoryVoucher] = useState<Record<string, unknown> | null>(null);
  const [isVoucherDialogOpen, setIsVoucherDialogOpen] = useState(false);
  const [voucherDialogMode, setVoucherDialogMode] = useState<"edit" | "disbursement" | null>(null);
  const disbursementJournalDraft = useMemo(() => buildLoanDisbursementJournalDraft(loan), [loan]);
  const resolveUserName = (uid?: string, saved?: string) =>
    String(saved || "").trim() || (uid ? userNames?.[uid] : "") || uid || "—";
  const postingAllowed = loan.status !== "closed" && loan.status !== "cancelled" && loan.status !== "draft" && !!loan.disbursementJournalId;
  const remainingUndisbursed = remainingUndisbursedAmount(loan);
  const nextPayEmiRow = useMemo(
    () => schedule.find((row) => row.status !== "paid" && !row.isHistorical) || null,
    [schedule]
  );
  const payEmiDue = !!(nextPayEmiRow && isEmiPayableNow(nextPayEmiRow.status));
  const latestEmi = transactions.find((t) => !t.isReversed && (t.kind === "emi" || t.kind === "partial_payment"));
  const liability = useMemo(
    () => (processedStaff || []).find((s) => s.id === loan.loanAccountId) || null,
    [processedStaff, loan.loanAccountId]
  );
  const headerBalance = Number(liability?.balance ?? -Number(loan.outstandingPrincipal || 0)) || 0;
  const headerName = String(liability?.name || loan.loanName || "").trim() || "Loan account";
  const headerAttachment = resolveLoanAccountAvatarUrl(liability, loan, processedAccounts);
  const liabilityDocumentUrls = useMemo(
    () => normalizeFileUrlsField(liability?.documentFileUrls),
    [liability?.documentFileUrls]
  );

  const reportsLoans = useMemo(() => [loan], [loan]);
  const reportsSchedules = useMemo(() => ({ [loan.id]: schedule }), [loan.id, schedule]);
  const reportsTransactions = useMemo(() => ({ [loan.id]: transactions }), [loan.id, transactions]);

  const transactionDates = useMemo(
    () =>
      transactions
        .map((t) => tryParseIsoDate(t.paymentDate))
        .filter((d): d is Date => d != null),
    [transactions]
  );

  const handleEditVoucher = useCallback((voucher: Record<string, unknown>) => {
    setSelectedVoucher(voucher);
    setVoucherDialogMode("edit");
    setIsVoucherDialogOpen(true);
  }, []);

  const openDisbursementJournal = useCallback(() => {
    setSelectedVoucher(null);
    setVoucherDialogMode("disbursement");
    setIsVoucherDialogOpen(true);
  }, []);

  const handleVoucherDialogAction = useCallback(
    async (status: "saved" | "cancelled", _isSaveAndNew?: boolean, newId?: string) => {
      if (status === "saved" && voucherDialogMode === "disbursement" && newId && companyId) {
        try {
          await recordLoanDisbursementFromJournal({
            companyId,
            userId: user?.uid || "user",
            userName: user?.displayName || user?.email || user?.uid || "user",
            loanId: loan.id,
            journalId: newId,
          });
          toast.success("Disbursement posted.");
          await onLoanUpdated?.();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Disbursement sync failed.");
        }
      } else if (status === "saved") {
        await onLoanUpdated?.();
      }
      if (status === "cancelled" || status === "saved") {
        setSelectedVoucher(null);
        setVoucherDialogMode(null);
      }
    },
    [voucherDialogMode, companyId, user, loan.id, onLoanUpdated]
  );

  const handleHistoryVoucher = useCallback((voucher: Record<string, unknown>) => {
    setHistoryVoucher(voucher);
  }, []);

  const pillBtn = (opts: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) => (
    <Button
      type="button"
      variant={opts.primary ? "default" : "outline"}
      size="sm"
      disabled={opts.disabled}
      onClick={opts.onClick}
      data-theme-detail={opts.primary ? "save" : "add-note"}
      className={cn(LEDGER_HEADER_PILL_CN, opts.primary && BTN_SAVE_CLASS)}
    >
      {opts.label}
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className={LEDGER_HEADER_RIBBON_WRAP_CN}>
        <div className={LEDGER_HEADER_OUTER_ROW_CN}>
          <div className={LEDGER_HEADER_IDENTITY_CN}>
            <div className={LEDGER_HEADER_AVATAR_CN}>
              <EntityFileAttachmentHover fileUrl={headerAttachment} triggerClassName={LEDGER_HEADER_AVATAR_TRIGGER_CN}>
                <ResolvedEntityAvatar
                  className={cn(LEDGER_HEADER_AVATAR_IMAGE_CN, "border")}
                  companyId={loan.companyId}
                  src={headerAttachment ?? undefined}
                  alt={headerName}
                  fallbackSlot={<LoanLiabilityEntityIcon size="detail" />}
                />
              </EntityFileAttachmentHover>
              {loan.status !== "cancelled" ? (
                <button
                  type="button"
                  className={LEDGER_HEADER_AVATAR_PEN_CN}
                  title="Edit loan"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              ) : null}
            </div>
            <div className={cn(LEDGER_HEADER_NAME_CARD_CN, "flex-col !flex-nowrap items-stretch justify-center gap-0.5 overflow-hidden")}>
              <h2 className="w-full min-w-0 truncate text-base font-semibold leading-tight" title={headerName}>
                {headerName}
              </h2>
              <div className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden">
                <span
                  className="min-w-0 flex-1 truncate text-[11px] leading-tight text-muted-foreground"
                  title={`${loan.loanNumber} · ${loan.lenderName}`}
                >
                  {loan.loanNumber} · {loan.lenderName}
                </span>
                <LoanStatusBadge status={loan.status} />
              </div>
            </div>
            <div className={LEDGER_HEADER_BALANCE_CARD_CN}>
              <div className={LEDGER_HEADER_BALANCE_STACK_CN}>
                <span className={LEDGER_HEADER_BALANCE_LABEL_CN}>Balance</span>
                <div
                  className={cn(
                    LEDGER_HEADER_BALANCE_CN,
                    "flex items-baseline justify-center gap-px",
                    headerBalance >= 0 ? "text-green-600" : "text-red-600"
                  )}
                >
                  {headerBalance === 0 ? (
                    "Settled"
                  ) : (
                    <>
                      <span>{formatCurrency(Math.abs(headerBalance), { showDrCr: false })}</span>
                      <span className="text-sm">{headerBalance >= 0 ? "Dr" : "Cr"}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className={LEDGER_HEADER_PILL_ROW_CN}>
            <LedgerHeaderPrintButton variant="outline" onClick={() => void accountingRef.current?.print()} />
            <LedgerHeaderReminderButton
              variant="outline"
              onClick={() => setReminderOpen(true)}
            />
            <LedgerReminderDialog
              open={reminderOpen}
              onOpenChange={setReminderOpen}
              context={liability ? "Staff" : null}
              entityId={liability?.id}
              title={headerName}
            />
              <LedgerUnapprovedFilterButton
              active={unapprovedOnly}
              onClick={() => setUnapprovedOnly((v) => !v)}
            />
            {(dateSystem === "BS" || dateSystem === "Both") && (
              <BsDatePicker
                isRange
                valueAD={dateRange}
                onChangeAD={(range) => setDateRange(range as DateRange | undefined)}
                transactionDates={transactionDates}
                className={cn("w-auto", LEDGER_HEADER_PILL_CN)}
              />
            )}
            {(dateSystem === "AD" || dateSystem === "Both") && (
              <Popover open={isDesktopCalendarOpen} onOpenChange={setIsDesktopCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn("justify-start px-2 text-left font-normal", LEDGER_HEADER_PILL_CN, !dateRange && "text-muted-foreground")}
                    data-theme-detail="date-range"
                  >
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}
                        </>
                      ) : (
                        format(dateRange.from, "LLL dd, y")
                      )
                    ) : (
                      <span>Pick a date range</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <AdCalendar
                    rangePresetSlot={
                      <DateRangePresetRow
                        country={company?.country}
                        onApply={(r) => {
                          setDateRange(r);
                          setIsDesktopCalendarOpen(false);
                        }}
                      />
                    }
                    valueAD={dateRange}
                    isRange
                    numberOfMonths={2}
                    transactionDates={transactionDates}
                    onSelect={(adDate) => {
                      const range = dateRange;
                      if (!range?.from || (range.from && range.to)) {
                        setDateRange({ from: adDate, to: undefined });
                      } else if (adDate < range.from) {
                        setDateRange({ from: adDate, to: range.from });
                        setIsDesktopCalendarOpen(false);
                      } else {
                        setDateRange({ from: range.from, to: adDate });
                        setIsDesktopCalendarOpen(false);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
            <Button
              type="button"
              variant={payEmiButtonVariant(payEmiDue)}
              size="sm"
              disabled={!postingAllowed}
              onClick={() => setPayRow(nextPayEmiRow)}
              className={payEmiButtonClassName(payEmiDue, LEDGER_HEADER_PILL_CN)}
            >
              Pay EMI
            </Button>
            {pillBtn({ label: "Prepayment", disabled: !postingAllowed, onClick: () => setPrepayOpen(true) })}
            {pillBtn({
              label: "Change Interest Rate",
              disabled: loan.status === "closed" || loan.status === "cancelled",
              onClick: () => setRateOpen(true),
            })}
            {pillBtn({ label: "Add Charge", disabled: !postingAllowed, onClick: () => setChargeOpen(true) })}
            {pillBtn({
              label: "Add Disbursement",
              disabled: !postingAllowed || remainingUndisbursed <= 0,
              onClick: openDisbursementJournal,
            })}
            {postingAllowed && latestEmi && onReversePayment
              ? pillBtn({ label: "Reverse last EMI", onClick: () => void onReversePayment(latestEmi.id) })
              : null}
            {loan.status === "closed"
              ? pillBtn({ label: "Reopen", onClick: () => void onReopen?.("Reopened from details") })
              : pillBtn({ label: "Close Loan", onClick: () => setCloseOpen(true) })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={LEDGER_HEADER_PILL_CN}
              data-theme-detail="add-note"
              onClick={() => setIsNoteOpen(true)}
            >
              <FilePlus className={cn("mr-2", LEDGER_HEADER_PILL_ICON_SIZE_CN)} />
              Add Note
            </Button>
            
          </div>
        </div>
      </div>

      {editing ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <LoanForm
            key={loan.id}
            mode="edit"
            lockPostedFields={false}
            initial={loanToDraftInput(loan)}
            saving={savingEdit}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              if (!onSaveEdit) return;
              setSavingEdit(true);
              try {
                await onSaveEdit(input);
                setEditing(false);
              } finally {
                setSavingEdit(false);
              }
            }}
          />
        </div>
      ) : (
      <Tabs defaultValue="accounting" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className={cn(mlc.tabsRow, mlc.detailTabsRow, "px-3")} data-pl-master-list-chrome>
          <TabsList listChrome className="w-full justify-start">
            <TabsTrigger listChrome className="flex-none px-3" value="accounting">Accounting</TabsTrigger>
            <TabsTrigger listChrome className="flex-none px-3" value="overview">Overview</TabsTrigger>
            <TabsTrigger listChrome className="flex-none px-3" value="schedule">Schedule</TabsTrigger>
            <TabsTrigger listChrome className="flex-none px-3" value="payments">Payments</TabsTrigger>
            <TabsTrigger listChrome className="flex-none px-3" value="interest">Interest</TabsTrigger>
            <TabsTrigger listChrome className="flex-none px-3" value="charges">Charges</TabsTrigger>
            <TabsTrigger listChrome className="flex-none px-3" value="documents">Documents</TabsTrigger>
            <TabsTrigger listChrome className="flex-none px-3" value="audit">Audit History</TabsTrigger>
            <TabsTrigger listChrome className="flex-none px-3" value="reports">Reports</TabsTrigger>
          </TabsList>
        </div>
        <div className="pl-ledger-detail-table-shell flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabsContent value="accounting" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden">
          <LoanAccounting
            ref={accountingRef}
            rows={transactions}
            loanAccountId={loan.loanAccountId}
            loanId={loan.id}
            loanName={loan.loanName}
            openingBalanceAttachmentUrls={liabilityDocumentUrls}
            openingBalanceDate={loan.disbursementDate}
            dateRange={dateRange}
            unapprovedOnly={unapprovedOnly}
            onEditVoucher={handleEditVoucher}
            onHistoryVoucher={handleHistoryVoucher}
          />
        </TabsContent>
        <TabsContent value="overview" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
          <LoanSummary loan={loan} schedule={schedule} />
        </TabsContent>
        <TabsContent value="schedule" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
          <LoanScheduleTable rows={schedule} onPay={postingAllowed ? setPayRow : undefined} />
        </TabsContent>
        <TabsContent value="payments" className="mt-0 min-h-0 flex-1 overflow-y-auto p-[2px] data-[state=inactive]:hidden">
          <LoanTransactions rows={transactions} />
        </TabsContent>
        <TabsContent value="interest" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <LoanTableDateHead label="Effective" />
                <TableHead>Old</TableHead>
                <TableHead>New</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>User</TableHead>
                <LoanTableDateHead label="Time" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rateHistory.map((r) => (
                <TableRow key={r.id}>
                  <LoanTableDateCell iso={r.effectiveDate} />
                  <TableCell>{r.oldRate}%</TableCell>
                  <TableCell>{r.newRate}%</TableCell>
                  <TableCell>{r.reason}</TableCell>
                  <TableCell className="text-xs">{resolveUserName(r.createdBy, r.userName)}</TableCell>
                  <LoanTableDateCell iso={r.createdAt} className="text-xs" />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="charges" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <LoanTableDateHead label="Date" />
                <TableHead>Name</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Journal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {charges.map((c) => (
                <TableRow key={c.id}>
                  <LoanTableDateCell iso={c.date} />
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.amount}</TableCell>
                  <TableCell className="font-mono text-xs">{c.journalEntryId}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="documents" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
          <div className="flex gap-2">
            <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Document title / reference" />
            <Button
              type="button"
              onClick={async () => {
                if (!docTitle.trim()) return;
                await saveDocument({
                  id: newLoanDocId("doc"),
                  companyId: loan.companyId,
                  loanId: loan.id,
                  title: docTitle.trim(),
                  reference: "",
                  notes: "",
                  createdAt: nowIso(),
                  createdBy: loan.updatedBy,
                });
                setDocTitle("");
              }}
            >
              Add
            </Button>
          </div>
          <ul className="mt-3 list-disc pl-5 text-sm">
            {documents.map((d) => (
              <li key={d.id}>{d.title}</li>
            ))}
          </ul>
        </TabsContent>
        <TabsContent value="audit" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <LoanTableDateHead label="Time" />
                <TableHead>Action</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Old</TableHead>
                <TableHead>New</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.map((a) => (
                <TableRow key={a.id}>
                  <LoanTableDateCell iso={a.timestamp} className="text-xs" />
                  <TableCell>{a.action.replace(/_/g, " ")}</TableCell>
                  <TableCell>{a.userName}</TableCell>
                  <TableCell className="max-w-[10rem] truncate text-xs">{a.oldValue == null ? "—" : JSON.stringify(a.oldValue)}</TableCell>
                  <TableCell className="max-w-[10rem] truncate text-xs">{a.newValue == null ? "—" : JSON.stringify(a.newValue)}</TableCell>
                  <TableCell>{a.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="reports" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden">
          <LoanReportsView loans={reportsLoans} schedules={reportsSchedules} transactions={reportsTransactions} />
        </TabsContent>
        </div>
      </Tabs>
      )}

      <LoanPaymentDialog
        open={!!payRow}
        onOpenChange={(v) => !v && setPayRow(null)}
        loan={loan}
        row={payRow}
        onSubmit={onPay}
        onLoanUpdated={onLoanUpdated}
      />
      <LoanPrepaymentDialog open={prepayOpen} onOpenChange={setPrepayOpen} loan={loan} onSubmit={onPrepay} />
      <LoanRateChangeDialog open={rateOpen} onOpenChange={setRateOpen} loan={loan} onSubmit={onRateChange} />
      <LoanChargeDialog open={chargeOpen} onOpenChange={setChargeOpen} loan={loan} onSubmit={onCharge} />
      <LoanCloseDialog open={closeOpen} onOpenChange={setCloseOpen} loan={loan} onSubmit={onClose} />
      <Dialog open={isNoteOpen} onOpenChange={setIsNoteOpen}>
        <DialogContent className="flex h-[95vh] w-full max-w-3xl flex-col">
          <DialogHeader>
            <DialogTitle>Add a New Note for {headerName}</DialogTitle>
            <DialogDescription>Record a note on this loan liability account.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <CreateNoteForm
              onVoucherAction={() => setIsNoteOpen(false)}
              initialContext="Staff"
              initialEntityId={loan.loanAccountId}
              compactFooter
            />
          </div>
        </DialogContent>
      </Dialog>
      <AddVoucherDialog
        isOpen={isVoucherDialogOpen}
        onOpenChange={(open) => {
          setIsVoucherDialogOpen(open);
          if (!open) {
            setSelectedVoucher(null);
            setVoucherDialogMode(null);
          }
        }}
        voucher={voucherDialogMode === "edit" ? selectedVoucher : undefined}
        defaultVoucherData={voucherDialogMode === "disbursement" ? disbursementJournalDraft : undefined}
        defaultTab={voucherDialogMode === "disbursement" ? "journal" : undefined}
        allowedTabs={voucherDialogMode === "disbursement" ? ["journal"] : undefined}
        onVoucherAction={handleVoucherDialogAction}
        ledgerEntityId={loan.loanAccountId}
      />
      <HistoryDialog
        voucher={historyVoucher}
        isOpen={!!historyVoucher}
        onOpenChange={(open) => !open && setHistoryVoucher(null)}
        onHistoryReset={() => setHistoryVoucher((prev) => (prev ? { ...prev, history: [] } : null))}
      />
    </div>
  );
}
