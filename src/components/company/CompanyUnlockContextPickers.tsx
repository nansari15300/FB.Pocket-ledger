"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { DoorOpen } from "lucide-react";
import type { Company } from "@/hooks/useCompany";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COMPANY_SELECTOR_TAB_LABELS,
  unlockTabCompanies,
} from "@/lib/companySelectorGateLabel";
import {
  partitionCompaniesForUnlockDialog,
  type CompanyListTab,
} from "@/lib/companyStorageKind";
import { useCachedFeatureConfig } from "@/hooks/useCachedFeatureConfig";
import {
  resolveVisibleCompanySelectorTab,
  visibleCompanySelectorTabs,
} from "@/lib/companySelectorTabFeatures";

export function CompanyUnlockContextPickers({
  companies,
  company,
  unlockTab,
  onUnlockTabChange,
  onCompanyChange,
  onOpenGatePage,
  pinCompanyId,
}: {
  companies: Company[];
  company: Company;
  unlockTab: CompanyListTab;
  onUnlockTabChange: (tab: CompanyListTab) => void;
  onCompanyChange: (company: Company) => void;
  /** Dialog band karke Gate page kholo (optional). */
  onOpenGatePage?: () => void;
  /** Gate page se khuli company — auto-switch mat karo. */
  pinCompanyId?: string | null;
}) {
  const { featureConfig } = useCachedFeatureConfig();
  const buckets = useMemo(() => partitionCompaniesForUnlockDialog(companies), [companies]);
  const tabs = useMemo(() => visibleCompanySelectorTabs(featureConfig), [featureConfig]);
  const tabCompanies = useMemo(
    () => unlockTabCompanies(buckets, unlockTab),
    [buckets, unlockTab]
  );

  useEffect(() => {
    if (!tabs.includes(unlockTab)) {
      onUnlockTabChange(resolveVisibleCompanySelectorTab(featureConfig, unlockTab));
    }
  }, [tabs, unlockTab, featureConfig, onUnlockTabChange]);

  // Gate tab aur company state sync — galat bucket ki company mat dikhao.
  useEffect(() => {
    if (tabCompanies.length === 0) return;
    const pinned = String(pinCompanyId || "").trim();
    if (pinned && company.id === pinned) return;
    if (!tabCompanies.some((c) => c.id === company.id)) {
      onCompanyChange(tabCompanies[0]!);
    }
  }, [unlockTab, tabCompanies, company.id, onCompanyChange, pinCompanyId]);

  const selectedCompanyId = tabCompanies.some((c) => c.id === company.id)
    ? company.id
    : (tabCompanies[0]?.id ?? "");

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="space-y-1.5">
        <Label htmlFor="unlock-gate-tab">Gate</Label>
        <Select value={unlockTab} onValueChange={(v) => onUnlockTabChange(v as CompanyListTab)}>
          <SelectTrigger id="unlock-gate-tab">
            <SelectValue placeholder="Select gate" />
          </SelectTrigger>
          <SelectContent>
            {tabs.map((tab) => (
              <SelectItem key={tab} value={tab}>
                {COMPANY_SELECTOR_TAB_LABELS[tab]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="unlock-company-id">Company</Label>
        {tabCompanies.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {unlockTab === "server"
              ? "No PL Server companies on this device yet. Connect your EXE/LAN gate below."
              : unlockTab === "pocketbase"
                ? "No PocketBase companies on this login yet."
              : unlockTab === "local"
                ? "No local companies on this gate."
                : "No Firebase companies on this gate."}
          </p>
        ) : (
          <Select
            value={selectedCompanyId}
            onValueChange={(id) => {
              const next = tabCompanies.find((c) => c.id === id);
              if (next) onCompanyChange(next);
            }}
          >
            <SelectTrigger id="unlock-company-id">
              <SelectValue placeholder="Select company" />
            </SelectTrigger>
            <SelectContent>
              {tabCompanies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name || c.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Button variant="outline" size="sm" className="w-full justify-start" asChild>
        <Link
          href="/gate"
          onClick={() => {
            onOpenGatePage?.();
          }}
        >
          <DoorOpen className="mr-2 h-4 w-4 shrink-0" />
          Manage gates / connect PL server
        </Link>
      </Button>
    </div>
  );
}
