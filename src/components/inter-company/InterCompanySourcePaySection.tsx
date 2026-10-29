"use client";

/**
 * Source column — Source company + Company bank + Source account (must).
 * Edit / rematch: company combobox (My companies / joined partners).
 */
import { InterCompanySectionTitle } from "@/components/inter-company/InterCompanySectionTitle";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { InterCompanyAccountLookupSection } from "@/components/inter-company/InterCompanyAccountLookupSection";
import {
  INTER_COMPANY_ENTITY_LABELS,
  type InterCompanyEntityKind,
  type InterCompanyEntityKindFilter,
} from "@/components/inter-company/InterCompanyEntitySide";
import type { InterCompanyEntityDetail } from "@/lib/interCompany/interCompanyEntityTypes";
import { readCompanyInterCompanyAcNo } from "@/lib/interCompany/interCompanyAccountNo";
import { normalizeInterCompanyPhone } from "@/lib/interCompany/interCompanyPhone";
import type { Company } from "@/hooks/useCompany";
import {
  interCompanyComboboxTriggerClass,
  interCompanyCompanyFieldsRowClass,
  interCompanyCompanyFieldsRowSimpleClass,
  interCompanyDropdownContentClass,
  interCompanyAccountFieldsRowClass,
  interCompanyAccountFieldsRowSimpleClass,
  interCompanyAccountNameFieldColSimpleClass,
  interCompanyAccountTypeFieldColClass,
  interCompanyFieldColClass,
  interCompanyIcReadonlyFieldClass,
  interCompanyInputClass,
  interCompanyReadOnlyCopyInputClass,
  interCompanyViewOnlyAllowCopyClass,
  interCompanyVoucherRowAccountClass,
  interCompanyVoucherRowBankClass,
  interCompanyVoucherRowCompanyClass,
  interCompanyVoucherSideRowsClass,
} from "@/lib/interCompany/interCompanyVoucherChrome";
import { filterInterCompanyClearingBankEntities } from "@/lib/interCompany/interCompanyEntityLookup";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { useStickyInterCompanyCompanyCode } from "@/components/inter-company/useStickyInterCompanyCompanyCode";

type Props = {
  company: Company | null;
  /** Selected source company id (live) — combobox value */
  sourceCompanyId?: string;
  onSourceCompanyChange?: (id: string) => void;
  /** Joined / My companies options */
  companyComboboxOptions?: { value: string; label: string }[];
  companySelectDisabled?: boolean;
  entities: InterCompanyEntityDetail[];
  entitiesLoading?: boolean;
  payeeKind: InterCompanyEntityKindFilter;
  onPayeeKindChange: (k: InterCompanyEntityKindFilter) => void;
  payeeId: string;
  onPayeeIdChange: (id: string) => void;
  /** Edit view — account pickers read-only */
  fieldsDisabled?: boolean;
  /** Target-copy edit: source company current login nahi — peer company ka real row */
  isPeerSourceCompany?: boolean;
  /** Edit: is copy role=source — sender ne khola → Payment badge */
  showPaymentOutBadge?: boolean;
  /** Revert accept — header par blue Reverted pill (Payment ke left) */
  showRevertedBadge?: boolean;
  companyBankAccountId?: string;
  onCompanyBankAccountIdChange?: (id: string) => void;
  /** Simple view — company row: naam only; account rows: type + naam */
  simpleView?: boolean;
  /** Simple view + other charge — transfer + other charge bank out total */
  simpleViewBankOutTotal?: number | null;
  formatCurrencyForPrint?: (amount: number, options?: { noSuffix?: boolean }) => string;
  /** Connect user — master list hidden; type suggested account name */
  sourceAccountListRestricted?: boolean;
  /** Connect user — kuch masters allowed; type dropdown + filtered list */
  connectPartialMasters?: boolean;
  allowedSourceEntityKinds?: InterCompanyEntityKind[];
  accountNameHint?: string;
  suggestedSourceAccountLabel?: string;
  onSuggestedSourceAccountLabelChange?: (label: string) => void;
};

export function InterCompanySourcePaySection({
  company,
  sourceCompanyId = "",
  onSourceCompanyChange,
  companyComboboxOptions = [],
  companySelectDisabled = true,
  entities,
  entitiesLoading = false,
  payeeKind,
  onPayeeKindChange,
  payeeId,
  onPayeeIdChange,
  fieldsDisabled = false,
  isPeerSourceCompany = false,
  showPaymentOutBadge = false,
  showRevertedBadge = false,
  companyBankAccountId = "",
  onCompanyBankAccountIdChange,
  simpleView = false,
  simpleViewBankOutTotal = null,
  formatCurrencyForPrint,
  sourceAccountListRestricted = false,
  connectPartialMasters = false,
  allowedSourceEntityKinds = [],
  accountNameHint,
  suggestedSourceAccountLabel = "",
  onSuggestedSourceAccountLabelChange,
}: Props) {
  const companyAc = readCompanyInterCompanyAcNo(company);
  const companyCode = useStickyInterCompanyCompanyCode(company);
  const companyMob = normalizeInterCompanyPhone(company?.phone);
  const bankEntities = useMemo(
    () => filterInterCompanyClearingBankEntities(entities, companyBankAccountId),
    [entities, companyBankAccountId]
  );
  const optionalSourceEntities = useMemo(
    () => entities.filter((e) => !(e.kind === "bank" && e.isClearing === true)),
    [entities]
  );
  const showReadOnlyAccounts = fieldsDisabled && !entitiesLoading;
  const selectedCompanyId = String(sourceCompanyId || company?.id || "").trim();
  const selectedCompanyLabel =
    company?.name ||
    companyComboboxOptions.find((o) => o.value === selectedCompanyId)?.label ||
    "—";
  const canPickCompany = Boolean(onSourceCompanyChange) && !companySelectDisabled;
  const sourceCompanyInfoHint = canPickCompany
    ? "Select source company (My companies / joined)"
    : isPeerSourceCompany
      ? "Linked source company"
      : "Auto — current logged-in company";

  return (
    <div
      className={cn(
        interCompanyVoucherSideRowsClass,
        fieldsDisabled && interCompanyViewOnlyAllowCopyClass
      )}
    >
      <div className={cn(interCompanyVoucherRowCompanyClass, "space-y-2")}>
        <InterCompanySectionTitle
          title="Source company"
          flowBadge={showPaymentOutBadge ? "payment_out" : null}
          showRevertedBadge={showRevertedBadge}
          trailingAction={null}
          infoHint={sourceCompanyInfoHint}
        />
        <div
          className={cn(
            simpleView ? interCompanyCompanyFieldsRowSimpleClass : interCompanyCompanyFieldsRowClass
          )}
        >
          <div className={cn(interCompanyFieldColClass, "min-w-[8.5rem]")}>
            <Label className="whitespace-nowrap text-xs text-muted-foreground sm:sr-only">
              Company name
            </Label>
            {canPickCompany ? (
              <Combobox
                options={companyComboboxOptions}
                value={selectedCompanyId}
                onChange={(id) => onSourceCompanyChange?.(String(id || "").trim())}
                placeholder="Select company"
                searchPlaceholder="Search company…"
                triggerClassName={interCompanyComboboxTriggerClass}
                popoverContentClassName={interCompanyDropdownContentClass}
              />
            ) : (
              <Input
                readOnly
                value={selectedCompanyLabel}
                className={cn(
                  interCompanyInputClass,
                  interCompanyIcReadonlyFieldClass,
                  interCompanyReadOnlyCopyInputClass
                )}
              />
            )}
          </div>
          {!simpleView ? (
            <div className="ic-company-extra-fields contents">
          <div className={interCompanyFieldColClass}>
            <Label className="whitespace-nowrap text-xs text-muted-foreground">Company Code</Label>
            <Input
              readOnly
              value={companyCode || "—"}
              placeholder="SWIFT-style code"
              className={cn(
                interCompanyInputClass,
                interCompanyIcReadonlyFieldClass,
                interCompanyReadOnlyCopyInputClass,
                "font-mono text-xs uppercase"
              )}
            />
          </div>
          <div className={interCompanyFieldColClass}>
            <Label className="whitespace-nowrap text-xs text-muted-foreground">Mobile No.</Label>
            <Input
              readOnly
              value={companyMob}
              className={cn(
                interCompanyInputClass,
                interCompanyIcReadonlyFieldClass,
                interCompanyReadOnlyCopyInputClass
              )}
            />
          </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={interCompanyVoucherRowBankClass}>
        <InterCompanyAccountLookupSection
          sectionTitle="Clearing account"
          entities={bankEntities}
          entitiesLoading={entitiesLoading}
          activeCompanyId={company?.id ?? selectedCompanyId}
          autoEnsureInterCoAcNo
          lockEntityKind="bank"
          entityKind="bank"
          onEntityKindChange={() => {}}
          entityId={companyBankAccountId}
          onEntityIdChange={onCompanyBankAccountIdChange ?? (() => {})}
          companyAcNo={companyAc}
          companyMobile={companyMob}
          disabled={fieldsDisabled || !onCompanyBankAccountIdChange}
          allowLookupWithoutCompany={showReadOnlyAccounts}
          showDetails={false}
          simpleView={simpleView}
          disabledHint={
            entitiesLoading
              ? "Loading bank accounts…"
              : "Saved voucher — bank account is read-only"
          }
        />
      </div>

      <div className={interCompanyVoucherRowAccountClass}>
        {sourceAccountListRestricted && !fieldsDisabled ? (
          <div className="space-y-2">
            <InterCompanySectionTitle
              title="Source account"
              infoHint="Master list hidden — type suggested account name; target company will map the real account."
              trailingAction={null}
            />
            <div
              className={cn(
                simpleView ? interCompanyAccountFieldsRowSimpleClass : interCompanyAccountFieldsRowClass
              )}
            >
              <div className={interCompanyAccountTypeFieldColClass}>
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Input
                  readOnly
                  value={INTER_COMPANY_ENTITY_LABELS[payeeKind] || "Party"}
                  className={cn(interCompanyInputClass, interCompanyIcReadonlyFieldClass, "text-muted-foreground")}
                />
              </div>
              <div className={interCompanyAccountNameFieldColSimpleClass}>
                <Label className="text-xs text-muted-foreground">Account name</Label>
                {accountNameHint ? (
                  <p className="text-[11px] leading-snug text-amber-800 dark:text-amber-200">{accountNameHint}</p>
                ) : null}
                <Input
                  value={suggestedSourceAccountLabel}
                  onChange={(e) => onSuggestedSourceAccountLabelChange?.(e.target.value)}
                  placeholder="Type suggested account name…"
                  className={interCompanyInputClass}
                  disabled={fieldsDisabled}
                />
              </div>
            </div>
          </div>
        ) : sourceAccountListRestricted && fieldsDisabled ? (
          <div className="space-y-2">
            <Label className="text-xs font-medium">Source account</Label>
            <Input
              readOnly
              value={
                payeeId
                  ? optionalSourceEntities.find((e) => e.id === payeeId)?.label ||
                    suggestedSourceAccountLabel ||
                    "—"
                  : suggestedSourceAccountLabel || "Suggested — pending mapping"
              }
              className={cn(interCompanyInputClass, interCompanyReadOnlyCopyInputClass)}
            />
          </div>
        ) : connectPartialMasters && !fieldsDisabled ? (
          <InterCompanyAccountLookupSection
            sectionTitle="Source account"
            entities={optionalSourceEntities}
            entitiesLoading={entitiesLoading}
            activeCompanyId={company?.id ?? selectedCompanyId}
            autoEnsureInterCoAcNo
            showClosingBalance
            entityKind={payeeKind}
            onEntityKindChange={onPayeeKindChange}
            entityId={payeeId}
            onEntityIdChange={onPayeeIdChange}
            companyAcNo={companyAc}
            companyMobile={companyMob}
            disabled={fieldsDisabled}
            allowLookupWithoutCompany={showReadOnlyAccounts}
            allowedEntityKinds={allowedSourceEntityKinds}
            accountNameHint={accountNameHint}
            disabledHint={
              entitiesLoading
                ? "Loading source accounts…"
                : "Saved voucher — accounts are read-only"
            }
            simpleView={simpleView}
            showDetails={!simpleView}
            simpleViewBankOutTotal={simpleViewBankOutTotal}
            formatCurrencyForPrint={formatCurrencyForPrint}
          />
        ) : (
          <InterCompanyAccountLookupSection
            sectionTitle="Source account"
            entities={optionalSourceEntities}
            entitiesLoading={entitiesLoading}
            activeCompanyId={company?.id ?? selectedCompanyId}
            autoEnsureInterCoAcNo
            showClosingBalance
            entityKind={payeeKind}
            onEntityKindChange={onPayeeKindChange}
            entityId={payeeId}
            onEntityIdChange={onPayeeIdChange}
            companyAcNo={companyAc}
            companyMobile={companyMob}
            disabled={fieldsDisabled}
            allowLookupWithoutCompany={showReadOnlyAccounts}
            disabledHint={
              entitiesLoading
                ? "Loading source accounts…"
                : "Saved voucher — accounts are read-only"
            }
            simpleView={simpleView}
            showDetails={!simpleView}
            simpleViewBankOutTotal={simpleViewBankOutTotal}
            formatCurrencyForPrint={formatCurrencyForPrint}
          />
        )}
      </div>
    </div>
  );
}
