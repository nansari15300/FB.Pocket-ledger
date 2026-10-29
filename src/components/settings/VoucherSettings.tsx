
"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { resolveCompanyVoucherPrefixList } from "@/lib/nextVoucherNumber";
import { repairAutoVoucherNumbers } from "@/lib/repairAutoVoucherNumbers";
import { FY_OPENING_PILL_FORMAT_OPTIONS } from "@/lib/fyOpeningPillFormat";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RECON_SHARE_HEADER_LABEL } from "@/lib/reconciliation/labels";
import { Loader2, PlusCircle, RefreshCw, Scale, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompany } from "@/hooks/useCompany";
import { getPlanVoucherHistoryLimit, normalizeVoucherHistoryFullBehavior } from "@/lib/voucherHistoryUtils";
import { useAuth } from "@/hooks/useAuth";
import usePermissions from "@/hooks/usePermissions";
import { useState, useEffect, useMemo } from "react";
import { isCompanyNotFoundError, COMPANY_NOT_SYNCED_MESSAGE } from "@/lib/companyUpdateGuard";
import { persistCompanyRootSettingsPatch } from "@/lib/persistCompanyRootSettings";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { PRO_THEME_CLASS, proDashboardRibbonClass } from "@/lib/proTheme";
import {
  DEFAULT_SALE_PURCHASE_LINE_COLUMN_LABELS,
  resolveSalePurchaseLineColumnLabels,
} from "@/lib/salePurchaseLineColumnLabels";
import {
  SETTINGS_LEDGER_CARD as VS_CARD_BORDER,
  SETTINGS_LEDGER_PANEL as VS_LEDGER_PANEL,
  SETTINGS_LEDGER_ADD_PREFIX_BTN as VS_ADD_PREFIX_BTN,
  SETTINGS_LEDGER_BORDER_B as VS_BORDER_B,
  SETTINGS_LEDGER_BORDER_T as VS_BORDER_T,
  SETTINGS_LEDGER_BORDER_L as VS_BORDER_L,
  SETTINGS_LEDGER_SEPARATOR as VS_SEPARATOR_LEDGER,
  SETTINGS_LEDGER_DASHED as VS_DASHED_BOX,
  SETTINGS_LEDGER_FIELD as VS_FIELD_OUTLINE,
} from "@/lib/settingsLedgerStyle";

const voucherPrefixSchema = z.object({
  sale: z.array(z.string()),
  sale_service: z.array(z.string()),
  purchase: z.array(z.string()),
  purchase_service: z.array(z.string()),
  payment_in: z.array(z.string()),
  payment_out: z.array(z.string()),
  contra: z.array(z.string()),
  direct_income: z.array(z.string()),
  direct_expense: z.array(z.string()),
  journal: z.array(z.string()),
  adjustment: z.array(z.string()),
  note: z.array(z.string()),
  add_salary: z.array(z.string()),
  pay_salary: z.array(z.string()),
  pay_emi: z.array(z.string()),
});

type VoucherPrefixValues = z.infer<typeof voucherPrefixSchema>;

const defaultPrefixes: VoucherPrefixValues = {
  sale: ["Sale Inv"],
  sale_service: ["SER-"],
  purchase: ["PUR-"],
  purchase_service: ["SER-"],
  payment_in: ["RCPT-"],
  payment_out: ["PYMT-"],
  contra: ["CNTR-"],
  direct_income: ["DINC-"],
  direct_expense: ["DEXP-"],
  journal: ["JRNL-"],
  adjustment: ["ADJ-"],
  note: ["NOTE-"],
  add_salary: ["ADD-SAL-"],
  pay_salary: ["PAY-SAL-"],
  pay_emi: ["EMI-"],
};

const prefixLabels: Record<keyof VoucherPrefixValues, string> = {
    sale: "Sale Invoice (Items)",
    sale_service: "Sale Invoice (Services)",
    purchase: "Purchase Bill (Items)",
    purchase_service: "Purchase Bill (Services)",
    payment_in: "Receipt",
    payment_out: "Payment",
    contra: "Contra Entry",
    direct_income: "Direct Income",
    direct_expense: "Direct Expense",
    journal: "Journal Voucher",
    adjustment: "Adjustment Voucher",
    note: "Note",
    add_salary: "Add Salary (Journal)",
    pay_salary: "Pay Salary (Payment)",
    pay_emi: "Pay EMI (Loan)",
}

const voucherNumberingSettingsSchema = z.object({
  sale: z.boolean(),
  sale_service: z.boolean(),
  purchase: z.boolean(),
  purchase_service: z.boolean(),
  payment_in: z.boolean(),
  payment_out: z.boolean(),
  contra: z.boolean(),
  direct_income: z.boolean(),
  direct_expense: z.boolean(),
  journal: z.boolean(),
  adjustment: z.boolean(),
  note: z.boolean(),
  add_salary: z.boolean(),
  pay_salary: z.boolean(),
  pay_emi: z.boolean(),
});

const voucherEditableSettingsSchema = z.object({
  sale: z.boolean(),
  sale_service: z.boolean(),
  purchase: z.boolean(),
  purchase_service: z.boolean(),
  payment_in: z.boolean(),
  payment_out: z.boolean(),
  contra: z.boolean(),
  direct_income: z.boolean(),
  direct_expense: z.boolean(),
  journal: z.boolean(),
  adjustment: z.boolean(),
  note: z.boolean(),
  add_salary: z.boolean(),
  pay_salary: z.boolean(),
  pay_emi: z.boolean(),
});

const rateEditableSettingsSchema = z.object({
  sale: z.boolean(),
  purchase: z.boolean(),
});

const voucherPrefixSelectionSchema = voucherEditableSettingsSchema.partial();

const ROLES_WITH_VOUCHER_CREATE = ["data-entry", "accountant", "editor", "manager", "owner"] as const;

/** Mukh spend-wise opposite voucher OFF hone par sab roles ke require-link bite false hon (Firestore + UI mismatch se bachaa). */
function requirePaymentLinkAllRolesOff(): Record<string, { payment_out: boolean; contra: boolean; direct_expense: boolean }> {
  return ROLES_WITH_VOUCHER_CREATE.reduce(
    (acc, r) => ({ ...acc, [r]: { payment_out: false, contra: false, direct_expense: false } }),
    {} as Record<string, { payment_out: boolean; contra: boolean; direct_expense: boolean }>
  );
}

const ROLE_LABELS: Record<string, string> = {
  "data-entry": "Data Entry",
  accountant: "Accountant",
  editor: "Editor",
  manager: "Manager",
  owner: "Owner",
};

export const REQUIRE_LINK_VOUCHER_KEYS = ["payment_out", "contra", "direct_expense"] as const;
export const REQUIRE_LINK_VOUCHER_LABELS: Record<(typeof REQUIRE_LINK_VOUCHER_KEYS)[number], string> = {
  payment_out: "Payment",
  contra: "Contra",
  direct_expense: "Direct Expense",
};

const requireLinkByRoleSchema = z.record(
  z.string(),
  z.union([
    z.boolean(),
    z.object({
      payment_out: z.boolean(),
      contra: z.boolean(),
      direct_expense: z.boolean(),
    }),
  ])
);

const voucherSettingsSchema = z.object({
  autoVoucherNumbering: voucherNumberingSettingsSchema,
  allowVoucherNumberEditing: voucherEditableSettingsSchema,
  allowRateEditing: rateEditableSettingsSchema,
  voucherPrefixes: voucherPrefixSchema,
  enableVoucherPrefixSelection: voucherPrefixSelectionSchema,
  enableLinkPaymentToTxns: z.boolean(),
  /** Company-level: header Copy ledger + cross-company copy (permission `copy_ledger_cross_company` alag). */
  enableCrossCompanyLedgerCopy: z.boolean(),
  /** Company-level: header Share for Reconciliation (plan + role permissions alag). */
  enableShareForReconciliation: z.boolean(),
  spendWiseEnabled: z.boolean(),
  /** Role + voucher-type: when Spend Wise is on, require Payment In link to save. */
  requirePaymentLinkByRole: requireLinkByRoleSchema.optional(),
  /** On opposite vouchers (Payment In, Contra in, Direct Income): when true, "Link for spend wise" is editable; when false, read-only. */
  spendWiseOppositeVoucherEditable: z.boolean(),
  voucherHistoryEnabled: z.boolean(),
  voucherHistoryLimit: z.number().min(1).max(100),
  /** Sirf `block_edit` / `allow_edit_delete_last` allowed; preprocess invalid ko normalize karta hai — "Invalid option" error avoid */
  voucherHistoryFullBehavior: z.preprocess(
    (raw) => normalizeVoucherHistoryFullBehavior(raw),
    z.enum(["block_edit", "allow_edit_delete_last"]),
  ),
  // Recurring: company master toggle + app-open run scope (per-user rights → Manage Sharing).
  recurringVoucherSettingsEnabled: z.boolean(),
  recurringVoucherRunScope: z.enum(["owner_only", "all_users"]),
  /** Default ON — auto nos include FY span (e.g. PUR-82-83-002) even when ledger FY split is off. */
  autoVoucherIncludeFy: z.boolean(),
  voucherNumberFyFormat: z.enum(["short", "mixed", "full"]),
  salePurchaseLineColumnLabels: z.object({
    tax: z.string().max(32),
    tds: z.string().max(32),
    taxAmount: z.string().max(32),
    taxable: z.string().max(32),
    tdsAmount: z.string().max(32),
    amount: z.string().max(32),
  }),
});

type VoucherSettingsValues = z.infer<typeof voucherSettingsSchema>;

export function VoucherSettings() {
  // triggerSync / reloadLocalCompanyRegistry: save ke baad header `CopyLedgerHeaderButton` + SQLite mirror jaldi align
  const { company, companyId, loading: companyLoading, triggerSync, reloadLocalCompanyRegistry } = useCompany();
  const { user } = useAuth();
  const { toast } = useToast();
  const { theme } = useTheme();
  const isProTheme = theme === PRO_THEME_CLASS;
  const isCompanyOwner = !!company && (company.ownerId === user?.uid || (user?.email && company.ownerEmail === user.email));
  const { can } = usePermissions();
  // Company recurring master — sirf `configure_recurring_auto_company` (owner ko role se sab true).
  const canConfigureRecurringCompany = can("configure_recurring_auto_company");
  const [isLoading, setIsLoading] = useState(false);
  const [repairRunning, setRepairRunning] = useState(false);
  const [planHistoryLimit, setPlanHistoryLimit] = useState<number>(10);
   const [newPrefixValues, setNewPrefixValues] = useState<Record<keyof VoucherPrefixValues, string>>(
      Object.keys(defaultPrefixes).reduce((acc, key) => ({ ...acc, [key]: "" }), {} as any)
    );
  const form = useForm<VoucherSettingsValues>({
    // zod preprocess + RHF Resolver generic mismatch — runtime OK
    resolver: zodResolver(voucherSettingsSchema) as any,
    defaultValues: {
      autoVoucherNumbering: {
        sale: true, sale_service: true, purchase: true, purchase_service: true, payment_in: true, payment_out: true,
        contra: true, direct_income: true, direct_expense: true, journal: true, adjustment: true, note: true,
        add_salary: true, pay_salary: true, pay_emi: true,
      },
      allowVoucherNumberEditing: {
        sale: false, sale_service: false, purchase: false, purchase_service: false, payment_in: false, payment_out: false,
        contra: false, direct_income: false, direct_expense: false, journal: false, adjustment: false, note: false,
        add_salary: false, pay_salary: false, pay_emi: false,
      },
        allowRateEditing: {
          sale: true, purchase: true,
        },
        voucherPrefixes: defaultPrefixes,
        enableVoucherPrefixSelection: {
          sale: false, sale_service: false, purchase: false, purchase_service: false, payment_in: false, payment_out: false,
          contra: false, direct_income: false, direct_expense: false, journal: false, adjustment: false, note: false,
          add_salary: false, pay_salary: false, pay_emi: false,
        },
        enableLinkPaymentToTxns: false,
        enableCrossCompanyLedgerCopy: false,
        enableShareForReconciliation: false,
        spendWiseEnabled: false,
        spendWiseOppositeVoucherEditable: false,
        // Spend-wise opposite voucher default OFF ⇒ role matrix bhi sab OFF — user ne bola by default sab band
        requirePaymentLinkByRole: requirePaymentLinkAllRolesOff(),
        voucherHistoryEnabled: true,
        voucherHistoryLimit: 10,
        voucherHistoryFullBehavior: 'allow_edit_delete_last' as const,
        recurringVoucherSettingsEnabled: true, // naya form: recurring generation default ON
        recurringVoucherRunScope: "owner_only",
        autoVoucherIncludeFy: true,
        voucherNumberFyFormat: "short",
        salePurchaseLineColumnLabels: { ...DEFAULT_SALE_PURCHASE_LINE_COLUMN_LABELS },
    },
  });

  useEffect(() => {
    if (!companyId) return;
    getPlanVoucherHistoryLimit(companyId).then(setPlanHistoryLimit);
  }, [companyId]);

  useEffect(() => {
    if (company) {
      const prefixes = company.voucherPrefixes as any || {};
      const validPrefixes: Partial<VoucherPrefixValues> = {};
        for (const key in defaultPrefixes) {
            if (Array.isArray(prefixes[key]) && prefixes[key].length > 0) {
                validPrefixes[key as keyof VoucherPrefixValues] = resolveCompanyVoucherPrefixList(
                  key,
                  prefixes[key]
                );
            } else if (typeof prefixes[key] === "string") {
                validPrefixes[key as keyof VoucherPrefixValues] = resolveCompanyVoucherPrefixList(key, [
                  prefixes[key],
                ]);
            }
        }

      form.reset({
        autoVoucherNumbering: {
          ...form.getValues('autoVoucherNumbering'),
          ...company.autoVoucherNumbering,
        },
        allowVoucherNumberEditing: {
          ...form.getValues('allowVoucherNumberEditing'),
          ...company.allowVoucherNumberEditing,
        },
         allowRateEditing: {
          ...form.getValues('allowRateEditing'),
          ...company.allowRateEditing as any,
        },
        voucherPrefixes: { ...defaultPrefixes, ...validPrefixes },
        enableVoucherPrefixSelection: {
            ...form.getValues('enableVoucherPrefixSelection'),
            ...(company as any).enableVoucherPrefixSelection,
        },
        enableLinkPaymentToTxns: (company as any).enableLinkPaymentToTxns === true,
        // `reset` me zaroor ho — warna RHF default `false` pe wapas, company Firestore se `true` ho to header switch mismatch
        enableCrossCompanyLedgerCopy: (company as any).enableCrossCompanyLedgerCopy === true,
        enableShareForReconciliation: (company as any).enableShareForReconciliation === true,
        spendWiseEnabled: (company as any).spendWiseEnabled === true,
        spendWiseOppositeVoucherEditable: (company as any).spendWiseOppositeVoucherEditable === true,
        // Matrix Firestore se hamesha lao — main OFF sirf voucher par enforce band (Create* forms me); Save se granular choices na mitaao
        requirePaymentLinkByRole: (() => {
          const raw = (company as any).requirePaymentLinkByRole || {};
          const defaultPerRoleFalse = { payment_out: false, contra: false, direct_expense: false };
          return ROLES_WITH_VOUCHER_CREATE.reduce((acc, r) => {
            const v = raw[r];
            if (typeof v === "boolean") acc[r] = { payment_out: v, contra: v, direct_expense: v };
            else if (v && typeof v === "object") acc[r] = { ...defaultPerRoleFalse, ...v };
            else acc[r] = { ...defaultPerRoleFalse };
            return acc;
          }, {} as Record<string, { payment_out: boolean; contra: boolean; direct_expense: boolean }>);
        })(),
        voucherHistoryEnabled: (company as any).voucherHistoryEnabled !== false,
        voucherHistoryLimit: Math.max(1, Math.min(planHistoryLimit, Number((company as any).voucherHistoryLimit) || 10)),
        // Company se aayi value ko enum + Select ke saath align karo (invalid string → default)
        voucherHistoryFullBehavior: normalizeVoucherHistoryFullBehavior((company as any).voucherHistoryFullBehavior),
        // Missing field = ON; sirf explicit `enabled: false` se band
        recurringVoucherSettingsEnabled: (company as any)?.recurringVoucherSettings?.enabled !== false,
        recurringVoucherRunScope: (() => {
          const raw = String((company as any)?.recurringVoucherSettings?.runScope || "owner_only");
          if (raw === "all_users") return "all_users";
          return "owner_only";
        })(),
        autoVoucherIncludeFy: (company as any).autoVoucherIncludeFy !== false,
        voucherNumberFyFormat:
          (company as any).voucherNumberFyFormat === "mixed" || (company as any).voucherNumberFyFormat === "full"
            ? (company as any).voucherNumberFyFormat
            : "short",
        salePurchaseLineColumnLabels: resolveSalePurchaseLineColumnLabels(company),
    });
    }
  }, [company, form, planHistoryLimit]);
  
  const handleAddPrefix = (key: keyof VoucherPrefixValues) => {
        const newValue = newPrefixValues[key]?.trim();
        if (newValue) {
            const currentPrefixes = form.getValues(`voucherPrefixes.${key}`);
            if (!currentPrefixes.includes(newValue)) {
                form.setValue(`voucherPrefixes.${key}`, [...currentPrefixes, newValue]);
                setNewPrefixValues(prev => ({...prev, [key]: ""}));
            }
        }
    };
    
    const handleRemovePrefix = (key: keyof VoucherPrefixValues, prefixToRemove: string) => {
        const currentPrefixes = form.getValues(`voucherPrefixes.${key}`);
        if (currentPrefixes.length > 1) { // Prevent removing the last prefix
            form.setValue(`voucherPrefixes.${key}`, currentPrefixes.filter(p => p !== prefixToRemove));
        } else {
            toast({ variant: 'destructive', title: "Cannot remove last prefix."})
        }
    };


  async function onSubmit(data: VoucherSettingsValues): Promise<void> {
    if (!companyId) {
      toast({ variant: "destructive", title: "No company selected." });
      return;
    }
    setIsLoading(true);
    try {
      const cappedHistoryLimit = Math.min(data.voucherHistoryLimit, planHistoryLimit);
      if (data.voucherHistoryLimit > planHistoryLimit) {
        toast({ title: "Plan limit applied", description: `Max history entries capped to ${planHistoryLimit} (your plan's limit).` });
      }
      const voucherSettingsPatch = {
        autoVoucherNumbering: data.autoVoucherNumbering,
        allowVoucherNumberEditing: data.allowVoucherNumberEditing,
        allowRateEditing: data.allowRateEditing,
        voucherPrefixes: data.voucherPrefixes,
        enableVoucherPrefixSelection: data.enableVoucherPrefixSelection,
        enableLinkPaymentToTxns: data.enableLinkPaymentToTxns,
        enableCrossCompanyLedgerCopy: data.enableCrossCompanyLedgerCopy,
        enableShareForReconciliation: data.enableShareForReconciliation,
        spendWiseEnabled: data.spendWiseEnabled,
        spendWiseOppositeVoucherEditable: data.spendWiseOppositeVoucherEditable,
        requirePaymentLinkByRole: data.requirePaymentLinkByRole,
        voucherHistoryEnabled: data.voucherHistoryEnabled,
        voucherHistoryLimit: cappedHistoryLimit,
        voucherHistoryFullBehavior: data.voucherHistoryFullBehavior,
        recurringVoucherSettings: {
          enabled: data.recurringVoucherSettingsEnabled,
          runScope: data.recurringVoucherRunScope,
        },
        autoVoucherIncludeFy: data.autoVoucherIncludeFy,
        voucherNumberFyFormat: data.voucherNumberFyFormat,
        salePurchaseLineColumnLabels: {
          tax: data.salePurchaseLineColumnLabels.tax.trim(),
          tds: data.salePurchaseLineColumnLabels.tds.trim(),
          taxAmount: data.salePurchaseLineColumnLabels.taxAmount.trim(),
          taxable: data.salePurchaseLineColumnLabels.taxable.trim(),
          tdsAmount: data.salePurchaseLineColumnLabels.tdsAmount.trim(),
          amount: data.salePurchaseLineColumnLabels.amount.trim(),
        },
      };
      await persistCompanyRootSettingsPatch({
        companyId,
        company,
        patch: voucherSettingsPatch,
        reloadLocalCompanyRegistry,
        triggerSync,
      });
      toast({ title: "Success", description: "Voucher settings have been updated." });
    } catch (error) {
      console.error("Error updating voucher settings:", error);
      toast({ variant: "destructive", title: "Error", description: isCompanyNotFoundError(error) ? COMPANY_NOT_SYNCED_MESSAGE : "Failed to save voucher settings." });
    } finally {
      setIsLoading(false);
    }
  }

  if (companyLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card className={cn(VS_CARD_BORDER, isProTheme && proDashboardRibbonClass(0))}>
      {/* Title block ke neeche patli black rule — content se visual split (ledger section lines jaisa). */}
      <CardHeader className={cn(VS_BORDER_B)}>
        <CardTitle>Voucher Settings</CardTitle>
        <CardDescription>Manage automatic numbering, prefixes, and editing rules for your vouchers.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-8">
            {/* Save Button at Top — blue so user spots save action */}
            <div className={cn("flex justify-end pb-4", VS_BORDER_B)}>
              <Button type="submit" disabled={isLoading} className="bg-blue-600 hover:bg-blue-700 text-white">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Voucher Settings
              </Button>
            </div>

             {/* Prefixes */}
             <div className="space-y-4">
                 <h3 className={cn("text-lg font-medium pb-2", VS_BORDER_B)}>Voucher Prefixes</h3>
                 <CardDescription>
                    Customize the prefixes for your voucher numbers. You can add multiple prefixes for each type.
                </CardDescription>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {Object.keys(defaultPrefixes).map((keyStr, prefixIndex) => {
                        const key = keyStr as keyof VoucherPrefixValues;
                        return (
                        <div key={key} className={cn("space-y-2", VS_LEDGER_PANEL, isProTheme && proDashboardRibbonClass(prefixIndex))}>
                                <FormLabel>{prefixLabels[key]}</FormLabel>
                                {key === "contra" && (
                                  <FormDescription className="text-xs mt-0.5">Used for both Contra Out (from account) and Contra In (to account). e.g. CNTR → CNTR Out - 001, CNTR In - 001.</FormDescription>
                                )}
                            <div className="flex gap-2">
                                <Input
                                    className={cn(VS_FIELD_OUTLINE, "min-w-0 flex-1")}
                                    value={newPrefixValues[key]}
                                    onChange={(e) => setNewPrefixValues(prev => ({...prev, [key]: e.target.value}))}
                                    placeholder="Add new prefix"
                                />
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className={VS_ADD_PREFIX_BTN}
                                    onClick={() => handleAddPrefix(key)}
                                >
                                    <PlusCircle className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="flex flex-wrap gap-2 pt-2 min-h-[40px]">
                                {form.watch(`voucherPrefixes.${key}`).map(prefix => (
                                    <Badge key={prefix} variant="secondary" className="text-base">
                                        {prefix}
                                        <button type="button" onClick={() => handleRemovePrefix(key, prefix)} className="ml-2 rounded-full hover:bg-destructive/20 p-0.5">
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )})}
                </div>
            </div>

            {/* Transaction Settings */}
            <div className="space-y-4">
              <h3 className={cn("text-lg font-medium pb-2", VS_BORDER_B)}>Transaction Settings</h3>
              <div className="space-y-4">
                <Card className={cn("p-4", VS_CARD_BORDER)}>
                  <FormField
                    control={form.control}
                    name="enableLinkPaymentToTxns"
                    render={({ field }: any) => (
                      <FormItem className="flex flex-row items-center justify-between">
                        <div>
                          <FormLabel>Link for Bill Wise</FormLabel>
                          <FormDescription className="sr-only">
                            When ON, bill-wise link section is available; when required by role, user must link to save voucher.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </Card>
                <Card className={cn("p-4", VS_CARD_BORDER)}>
                  <FormField
                    control={form.control}
                    name="enableCrossCompanyLedgerCopy"
                    render={({ field }: any) => (
                      <FormItem className="flex flex-row items-center justify-between gap-4">
                        <div>
                          {/* Header jaisa sync icon + label — cross-company ledger sync toggle */}
                          <FormLabel className="flex items-center gap-2">
                            <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            Sync ledger (cross-company)
                          </FormLabel>
                          <FormDescription>
                            When ON, header shows &quot;Sync ledger&quot; with the sync icon. User role needs permission &quot;Copy Ledger to Another Company&quot;.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </Card>
                <Card className={cn("p-4", VS_CARD_BORDER)}>
                  <FormField
                    control={form.control}
                    name="enableShareForReconciliation"
                    render={({ field }: any) => (
                      <FormItem className="flex flex-row items-center justify-between gap-4">
                        <div>
                          <FormLabel className="flex items-center gap-2">
                            <Scale className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            {RECON_SHARE_HEADER_LABEL}
                          </FormLabel>
                          <FormDescription>
                            When ON, header shows &quot;{RECON_SHARE_HEADER_LABEL}&quot;. Roles need Share / Link / View reconciling permissions.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </Card>
                {isCompanyOwner && (
                  <>
                    <Card className={cn("p-4", VS_CARD_BORDER)}>
                      <FormField
                        control={form.control}
                        name="spendWiseOppositeVoucherEditable"
                        render={({ field }: any) => (
                          <FormItem className="flex flex-row items-center justify-between">
                            <div>
                              <FormLabel>Link for spend wise on opposite voucher (Receipt, Contra in, Direct Income)</FormLabel>
                              <FormDescription>
                                Off: linking is inactive for users (saved per-role toggles stay stored). On: linking active per role vouchers below.
                              </FormDescription>
                            </div>
                            <FormControl>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Off</span>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                                <span className="text-sm text-muted-foreground">On</span>
                              </div>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </Card>
                    <Card className={cn("p-4", VS_CARD_BORDER)}>
                    {/* Nested role grid — left rail bhi same ledger line weight. */}
                    <div className={cn("space-y-4 pl-4", VS_BORDER_L)}>
                      <p className="text-sm font-medium">Require Receipt link (role + voucher type)</p>
                      <FormDescription className="!mt-0">
                        When ON, that role must link to a Receipt to save. When OFF, they can save without linking. Set per voucher: Payment, Contra, Direct Expense.
                      </FormDescription>
                      {/* Master OFF: stored matrix form me rakho, Switch UI pe OFF dikhao (sirf disabled nahi lagna chahiye "ON"); master ON ⇒ asli checkbox */}
                      {ROLES_WITH_VOUCHER_CREATE.map((role) => {
                        const oppoOn = form.watch("spendWiseOppositeVoucherEditable");
                        const byRole = form.watch("requirePaymentLinkByRole") || {} as Record<string, { payment_out: boolean; contra: boolean; direct_expense: boolean }>;
                        const row = byRole[role];
                        const payment_out = typeof row === "object" && row !== null ? row.payment_out === true : false;
                        const contra = typeof row === "object" && row !== null ? row.contra === true : false;
                        const direct_expense = typeof row === "object" && row !== null ? row.direct_expense === true : false;
                        const update = (key: "payment_out" | "contra" | "direct_expense", v: boolean) => {
                          const current = form.getValues("requirePaymentLinkByRole") || {};
                          const prev = (current[role] && typeof current[role] === "object") ? (current[role] as { payment_out: boolean; contra: boolean; direct_expense: boolean }) : { payment_out: false, contra: false, direct_expense: false };
                          const nextRow: { payment_out: boolean; contra: boolean; direct_expense: boolean } = {
                            payment_out: key === "payment_out" ? v : prev.payment_out,
                            contra: key === "contra" ? v : prev.contra,
                            direct_expense: key === "direct_expense" ? v : prev.direct_expense,
                          };
                          form.setValue("requirePaymentLinkByRole", { ...current, [role]: nextRow });
                        };
                        return (
                          <div key={role} className="space-y-2">
                            <p className="text-sm font-medium text-muted-foreground">{ROLE_LABELS[role] ?? role}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <FormItem className={cn("flex flex-row items-center justify-between rounded-lg px-3 py-2", VS_CARD_BORDER)}>
                                <FormLabel className="font-normal text-sm cursor-pointer">Payment</FormLabel>
                                <FormControl>
                                  <Switch checked={oppoOn && payment_out} disabled={!oppoOn} onCheckedChange={(v) => update("payment_out", v)} />
                                </FormControl>
                              </FormItem>
                              <FormItem className={cn("flex flex-row items-center justify-between rounded-lg px-3 py-2", VS_CARD_BORDER)}>
                                <FormLabel className="font-normal text-sm cursor-pointer">Contra</FormLabel>
                                <FormControl>
                                  <Switch checked={oppoOn && contra} disabled={!oppoOn} onCheckedChange={(v) => update("contra", v)} />
                                </FormControl>
                              </FormItem>
                              <FormItem className={cn("flex flex-row items-center justify-between rounded-lg px-3 py-2", VS_CARD_BORDER)}>
                                <FormLabel className="font-normal text-sm cursor-pointer">Direct Expense</FormLabel>
                                <FormControl>
                                  <Switch checked={oppoOn && direct_expense} disabled={!oppoOn} onCheckedChange={(v) => update("direct_expense", v)} />
                                </FormControl>
                              </FormItem>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    </Card>
                  </>
                )}
              </div>
            </div>

            {isCompanyOwner && (
              <div className="space-y-4">
                <h3 className={cn("text-lg font-medium pb-2", VS_BORDER_B)}>Sale &amp; Purchase line columns</h3>
                <CardDescription>
                  Rename Tax / TDS column labels on sale and purchase item lines for your country (e.g. VAT, WHT). Saved for all users in this company.
                </CardDescription>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(
                    [
                      ["tax", "Tax column"],
                      ["tds", "TDS column"],
                      ["taxAmount", "Tax amount column"],
                      ["taxable", "Taxable column"],
                      ["tdsAmount", "TDS amount column"],
                      ["amount", "Amount column"],
                    ] as const
                  ).map(([key, label]) => (
                    <FormField
                      key={key}
                      control={form.control}
                      name={`salePurchaseLineColumnLabels.${key}`}
                      render={({ field }: any) => (
                        <FormItem>
                          <FormLabel>{label}</FormLabel>
                          <FormControl>
                            <Input className={VS_FIELD_OUTLINE} {...field} placeholder={DEFAULT_SALE_PURCHASE_LINE_COLUMN_LABELS[key]} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Voucher Edit History — company setting */}
            {isCompanyOwner && (
              <div className="space-y-4">
                <h3 className={cn("text-lg font-medium pb-2", VS_BORDER_B)}>Voucher Edit History</h3>
                <CardDescription>
                  Track changes to vouchers. When history is full, choose to block edits or allow edit by overwriting oldest history.
                </CardDescription>
                <div className="flex justify-end">
                  <Button type="submit" disabled={isLoading} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Voucher Settings
                  </Button>
                </div>
                <Card className={cn("p-4 space-y-4", VS_CARD_BORDER)}>
                  <FormField
                    control={form.control}
                    name="voucherHistoryEnabled"
                    render={({ field }: any) => (
                      <FormItem className="flex flex-row items-center justify-between">
                        <div>
                          <FormLabel>Enable voucher edit history</FormLabel>
                          <FormDescription className="sr-only">When ON, edits are tracked; when OFF, no history is stored.</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  {form.watch("voucherHistoryEnabled") && (
                    <>
                      <FormField
                        control={form.control}
                        name="voucherHistoryLimit"
                        render={({ field }: any) => (
                          <FormItem>
                            <FormLabel>Max history entries per voucher</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={1}
                                max={planHistoryLimit}
                                {...field}
                                onChange={(e) => field.onChange(Math.max(1, Math.min(planHistoryLimit, parseInt(e.target.value, 10) || 10)))}
                                className={cn(VS_FIELD_OUTLINE)}
                              />
                            </FormControl>
                            <FormDescription>1–{planHistoryLimit}. Plan cap from subscription.</FormDescription>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="voucherHistoryFullBehavior"
                        render={({ field }: any) => (
                          <FormItem>
                            <FormLabel>When history is full</FormLabel>
                            <Select
                              // Controlled value hamesha valid item ho — warna Radix placeholder + zod error
                              value={normalizeVoucherHistoryFullBehavior(field.value)}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger className={VS_FIELD_OUTLINE}>
                                  <SelectValue placeholder="Select behavior" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="block_edit">Block edit (user cannot edit until admin clears history)</SelectItem>
                                <SelectItem value="allow_edit_delete_last">Allow edit over writing oldest History</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                </Card>
              </div>
            )}

            {canConfigureRecurringCompany && (
              <div className="space-y-4">
                <h3 className={cn("text-lg font-medium pb-2", VS_BORDER_B)}>Recurring Auto Voucher</h3>
                <Card className={cn("p-4 space-y-4", VS_CARD_BORDER)}>
                  <FormField
                    control={form.control}
                    name="recurringVoucherSettingsEnabled"
                    render={({ field }: any) => (
                      <FormItem className="flex flex-row items-center justify-between">
                        <div>
                          <FormLabel>Enable recurring voucher generation</FormLabel>
                          <FormDescription>
                            When ON, vouchers marked as &quot;Auto Monthly&quot; generate on month-end app open.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="recurringVoucherRunScope"
                    render={({ field }: any) => (
                      <FormItem>
                        <FormLabel>Run trigger user scope</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className={VS_FIELD_OUTLINE}>
                              <SelectValue placeholder="Select scope" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="owner_only">Owner/Admin only</SelectItem>
                            <SelectItem value="all_users">Users with “Trigger month-end…” permission</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          When not owner-only, only roles with trigger permission in Manage Sharing → Recurring Auto Voucher
                          run generation on app open. Auto Monthly on vouchers uses the same permission group.
                        </FormDescription>
                      </FormItem>
                    )}
                  />
                  <p className={cn("text-sm leading-snug text-muted-foreground rounded-md bg-muted/40 p-3", VS_DASHED_BOX)}>
                    Month-end recurring runs on app open when company recurring is ON and this scope allows the user.
                  </p>
                </Card>
              </div>
            )}

            <Card className={cn("p-4", VS_CARD_BORDER, isProTheme && proDashboardRibbonClass(0))}>
              <CardTitle className="text-base mb-2">Fiscal year in auto voucher numbers</CardTitle>
              <CardDescription className="mb-4 text-xs">
                When auto numbering is on, new numbers can include the FY span from the voucher date (e.g. PUR-82-83-002).
                This is independent of ledger FY split / divider settings.
              </CardDescription>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="autoVoucherIncludeFy"
                  render={({ field }: any) => (
                    <FormItem className="flex flex-row items-center justify-between rounded border p-3">
                      <div>
                        <FormLabel>Include FY in auto numbers</FormLabel>
                        <FormDescription className="text-xs">Default on for all voucher types with auto number enabled.</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="voucherNumberFyFormat"
                  render={({ field }: any) => (
                    <FormItem>
                      <FormLabel>FY span style</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange} disabled={!form.watch("autoVoucherIncludeFy")}>
                        <FormControl>
                          <SelectTrigger className={VS_FIELD_OUTLINE}>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {FY_OPENING_PILL_FORMAT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label} (e.g. {opt.sampleAd.replace("fy ", "").replace(" opening", "")})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t">
                <p className="text-xs text-muted-foreground max-w-xl">
                  Repair renumbers existing vouchers (auto types only) by date within each prefix and FY bucket.
                  Save settings first if you changed FY options.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={repairRunning || !companyId || !company}
                  onClick={() => {
                    if (!companyId || !company) return;
                    const ok = window.confirm(
                      "Repair all auto voucher numbers for this company? Numbers will be reassigned by voucher date within each FY and prefix. This cannot be undone automatically."
                    );
                    if (!ok) return;
                    setRepairRunning(true);
                    void repairAutoVoucherNumbers({
                      companyId,
                      companyDoc: company as Record<string, unknown>,
                      onProgress: ({ done, total }) => {
                        if (total > 0 && done === total) {
                          toast({ title: "Repair complete", description: `Updated ${done} voucher(s).` });
                        }
                      },
                    })
                      .then(({ updated }) => {
                        toast({
                          title: "Voucher numbers repaired",
                          description: updated > 0 ? `${updated} voucher(s) updated.` : "No changes were needed.",
                        });
                        void triggerSync?.();
                      })
                      .catch((e) => {
                        console.error(e);
                        toast({
                          variant: "destructive",
                          title: "Repair failed",
                          description: "Could not repair voucher numbers. Try again after sync.",
                        });
                      })
                      .finally(() => setRepairRunning(false));
                  }}
                >
                  {repairRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Repair all auto voucher numbers
                </Button>
              </div>
            </Card>

            {/* Auto Numbering */}
             <div className="space-y-4">
              <div className={cn("flex items-center justify-between pb-2", VS_BORDER_B)}>
                <h3 className="text-lg font-medium">Voucher Number & Rate Settings</h3>
              </div>
              {/* Middle Button — blue to match other save buttons */}
              <div className="flex justify-end">
                <Button type="submit" disabled={isLoading} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white border-0">
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Voucher Settings
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.keys(prefixLabels).map((key, voucherIndex) => {
                   const voucherKey = key as keyof VoucherPrefixValues;
                   const canEditRate = voucherKey === 'sale' || voucherKey === 'purchase';
                   if (voucherKey === 'contra') {
                     return (
                       <Card key={voucherKey} className={cn("p-4 md:col-span-2", VS_CARD_BORDER, isProTheme && proDashboardRibbonClass(voucherIndex))}>
                         <CardTitle className="text-base mb-1">Contra Entry (In & Out)</CardTitle>
                         <CardDescription className="mb-4 text-xs">One set of settings for both Contra In and Contra Out. Changing any switch applies to both.</CardDescription>
                         {/* PC: Contra In left, Contra Out right; mobile: stacked */}
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <div className={cn("rounded bg-muted/20 p-3 space-y-3", VS_CARD_BORDER)}>
                             <p className="text-sm font-medium text-muted-foreground">Contra In</p>
                             <FormField control={form.control} name="autoVoucherNumbering.contra" render={({ field }: any) => (
                               <FormItem className="flex flex-row items-center justify-between">
                                 <FormLabel>Auto Number</FormLabel>
                                 <FormControl>
                                   <Switch checked={field.value} onCheckedChange={(checked) => { field.onChange(checked); if (!checked) form.setValue("allowVoucherNumberEditing.contra", true); }} />
                                 </FormControl>
                               </FormItem>
                             )} />
                             <FormField control={form.control} name="allowVoucherNumberEditing.contra" render={({ field }: any) => (
                               <FormItem className="flex flex-row items-center justify-between">
                                 <FormLabel>Allow Editing No.</FormLabel>
                                 <FormControl>
                                   <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!form.watch("autoVoucherNumbering.contra")} />
                                 </FormControl>
                               </FormItem>
                             )} />
                             <FormField control={form.control} name="enableVoucherPrefixSelection.contra" render={({ field }: any) => (
                               <FormItem className="flex flex-row items-center justify-between">
                                 <FormLabel>Enable Prefix Selection</FormLabel>
                                 <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                               </FormItem>
                             )} />
                           </div>
                           <div className={cn("rounded bg-muted/20 p-3 space-y-3", VS_CARD_BORDER)}>
                             <p className="text-sm font-medium text-muted-foreground">Contra Out</p>
                             <FormField control={form.control} name="autoVoucherNumbering.contra" render={({ field }: any) => (
                               <FormItem className="flex flex-row items-center justify-between">
                                 <FormLabel>Auto Number</FormLabel>
                                 <FormControl>
                                   <Switch checked={field.value} onCheckedChange={(checked) => { field.onChange(checked); if (!checked) form.setValue("allowVoucherNumberEditing.contra", true); }} />
                                 </FormControl>
                               </FormItem>
                             )} />
                             <FormField control={form.control} name="allowVoucherNumberEditing.contra" render={({ field }: any) => (
                               <FormItem className="flex flex-row items-center justify-between">
                                 <FormLabel>Allow Editing No.</FormLabel>
                                 <FormControl>
                                   <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!form.watch("autoVoucherNumbering.contra")} />
                                 </FormControl>
                               </FormItem>
                             )} />
                             <FormField control={form.control} name="enableVoucherPrefixSelection.contra" render={({ field }: any) => (
                               <FormItem className="flex flex-row items-center justify-between">
                                 <FormLabel>Enable Prefix Selection</FormLabel>
                                 <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                               </FormItem>
                             )} />
                           </div>
                         </div>
                       </Card>
                     );
                   }
                   return (
                      <Card key={voucherKey} className={cn("p-4", VS_CARD_BORDER, isProTheme && proDashboardRibbonClass(voucherIndex))}>
                         <CardTitle className="text-base mb-4">{prefixLabels[voucherKey]}</CardTitle>
                         <div className="space-y-4">
                           <FormField
                              control={form.control}
                              name={`autoVoucherNumbering.${voucherKey}`}
                              render={({ field }: any) => (
                                 <FormItem className="flex flex-row items-center justify-between">
                                    <FormLabel>Auto Number</FormLabel>
                                    <FormControl>
                                       <Switch
                                          checked={field.value}
                                          onCheckedChange={(checked) => {
                                            field.onChange(checked);
                                            if (!checked) {
                                              form.setValue(`allowVoucherNumberEditing.${voucherKey}`, true);
                                            }
                                          }}
                                        />
                                    </FormControl>
                                 </FormItem>
                              )}
                           />
                           <FormField
                              control={form.control}
                              name={`allowVoucherNumberEditing.${voucherKey}`}
                              render={({ field }: any) => (
                                 <FormItem className="flex flex-row items-center justify-between">
                                    <FormLabel>Allow Editing No.</FormLabel>
                                    <FormControl>
                                       <Switch 
                                            checked={field.value} 
                                            onCheckedChange={field.onChange} 
                                            disabled={!form.watch(`autoVoucherNumbering.${voucherKey}`)}
                                        />
                                    </FormControl>
                                 </FormItem>
                              )}
                           />
                            <FormField
                              control={form.control}
                              name={`enableVoucherPrefixSelection.${voucherKey}`}
                              render={({ field }: any) => (
                                 <FormItem className="flex flex-row items-center justify-between">
                                    <FormLabel>Enable Prefix Selection</FormLabel>
                                    <FormControl>
                                       <Switch 
                                            checked={field.value} 
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                 </FormItem>
                              )}
                           />
                           {canEditRate && (
                                <FormField
                                    control={form.control}
                                    name={`allowRateEditing.${voucherKey as 'sale' | 'purchase'}`}
                                    render={({ field }: any) => (
                                        <FormItem className="flex flex-row items-center justify-between">
                                        <FormLabel>Allow Rate Editing</FormLabel>
                                        <FormControl>
                                            <Switch 
                                                checked={field.value} 
                                                onCheckedChange={field.onChange} 
                                            />
                                        </FormControl>
                                        </FormItem>
                                    )}
                                />
                            )}
                         </div>
                      </Card>
                   )
                })}
              </div>
            </div>

            {/* Bottom Button — blue to match other save buttons */}
            <div className={cn("flex justify-end pt-4", VS_BORDER_T)}>
              <Button type="submit" disabled={isLoading} className="bg-blue-600 hover:bg-blue-700 text-white">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Voucher Settings
              </Button>
            </div>

          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
