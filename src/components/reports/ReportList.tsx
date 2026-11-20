
"use client";

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Report } from "./report-data";
import { reportCategoryDisplayName } from "@/lib/staffEntityDisplayName";
import { FileText, Users, ReceiptText, TrendingUp } from "lucide-react";
import Link from "next/link";
import { HighlightText } from "@/lib/highlightQueryInText";
import { MasterListRow } from "@/components/ui/master-list-row";
import { masterListSelectedCn, masterListUnselectedCn } from "@/lib/listSelectionChrome";
import { MASTER_LIST_GROUP_ICON_CN, masterListShellCn } from "@/lib/masterListChrome";
import { MasterListPendingBadge } from "@/components/entity/MasterListPendingBadge";

interface ReportListProps {
  reports: Report[];
  onSelectReport: (report: Report) => void;
  selectedReport?: Report | null;
  /** Report id -> unapproved voucher count (pink badge, master list rows jaisa). */
  pendingByReportId?: Record<string, number>;
  /** Search box text - matching part of report name highlight. */
  searchTerm?: string;
  /**
   * Icon rail (main sidebar `w-16` jaisa): sirf report icons, koi label/category heading nahi.
   * Selected/hover row par `title` tooltip se naam dikhta hai.
   */
  collapsed?: boolean;
}

export function ReportList({
  reports,
  onSelectReport,
  selectedReport,
  pendingByReportId,
  searchTerm,
  collapsed = false,
}: ReportListProps) {
  // Report-specific icon mapping keeps Party/Bill/Income P&L entries visually distinct in list.
  const getReportIcon = (reportId: string) => {
    if (reportId === "profitandloss") return TrendingUp;
    if (reportId === "profitandloss-party-wise") return Users;
    if (reportId === "profitandloss-bill-wise") return ReceiptText;
    return FileText;
  };
  const CATEGORY_ORDER: Report["category"][] = [
    "Financial",
    "Party",
    "Staff",
    "Bank/Cash",
    "Sales/Purchase",
    "Payments",
    "Inventory",
    "Accounting",
    "Tax/GST",
  ];

  // Category grouping: easier scan for Party/Staff/Bank etc in long report menus.
  const groupedReports = CATEGORY_ORDER.map((category) => ({
    category,
    items: reports.filter((report) => report.category === category),
  })).filter((group) => group.items.length > 0);

  const reportRowClassName = (isSelected: boolean) =>
    cn(masterListUnselectedCn, isSelected && masterListSelectedCn);

  /* ---- Collapsed icon rail (main sidebar `w-16` jaisa) -------------------------------------
   * Sirf icons, category headings nahi. Har row par `title`/`aria-label` se poora naam milta
   * hai (main nav ke icon-only state jaisa). Pending badge icon par hi chipka rehta hai. */
  if (collapsed) {
    return (
      <div className="flex-1 min-h-0" data-pl-master-list-chrome="">
        <ScrollArea listChrome className="flex-1 min-h-0 h-full">
          <ul className="flex flex-col items-center gap-1 p-1" data-pl-reports-list="">
            {reports.map((report) => {
              const isSelected = selectedReport?.id === report.id;
              const ReportIcon = getReportIcon(report.id);
              const iconTile = (
                <div className="relative shrink-0">
                  <div className={MASTER_LIST_GROUP_ICON_CN}>
                    <ReportIcon className="h-4 w-4 shrink-0" />
                  </div>
                  <MasterListPendingBadge count={pendingByReportId?.[report.id] ?? 0} />
                </div>
              );
              return (
                <li key={report.id} className="flex w-full justify-center">
                  {report.href ? (
                    <Link
                      href={report.href}
                      className="block"
                      title={report.name}
                      aria-label={report.name}
                    >
                      <MasterListRow selected={isSelected} className={reportRowClassName(isSelected)}>
                        {iconTile}
                      </MasterListRow>
                    </Link>
                  ) : (
                    <MasterListRow
                      selected={isSelected}
                      className={reportRowClassName(isSelected)}
                      onClick={() => onSelectReport(report)}
                      title={report.name}
                      aria-label={report.name}
                    >
                      {iconTile}
                    </MasterListRow>
                  )}
                </li>
              );
            })}
            {reports.length === 0 && (
              <li className="px-1 py-4 text-center text-[10px] text-muted-foreground">—</li>
            )}
          </ul>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className={cn(masterListShellCn, "flex-1 min-h-0")} data-pl-master-list-chrome="">
     <ScrollArea listChrome className="flex-1 min-h-0">
        <ul className="pl-master-list-ul" data-pl-reports-list="">
            {groupedReports.map((group) => (
              <li key={group.category} className="space-y-1">
                <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {reportCategoryDisplayName(group.category)}
                </p>
                {group.items.map((report) => {
                const isSelected = selectedReport?.id === report.id;
                const ReportIcon = getReportIcon(report.id);
                const cardContent = (
                  <div className="pl-master-list-row grid-cols-1">
                    <div className="pl-master-list-row-leading">
                      <div className="relative shrink-0">
                        <div className={MASTER_LIST_GROUP_ICON_CN}>
                          <ReportIcon className="h-4 w-4 shrink-0" />
                        </div>
                        <MasterListPendingBadge count={pendingByReportId?.[report.id] ?? 0} />
                      </div>
                      <p
                        className={cn(
                          "pl-master-list-row-name truncate",
                          isSelected ? "font-bold" : "font-medium"
                        )}
                      >
                        <HighlightText text={report.name} query={searchTerm} />
                      </p>
                    </div>
                  </div>
                );
                return (
                    <div key={report.id}>
                        {report.href ? (
                          <Link href={report.href} className="block">
                            <MasterListRow selected={isSelected} className={reportRowClassName(isSelected)}>
                              {cardContent}
                            </MasterListRow>
                          </Link>
                        ) : (
                          <MasterListRow
                            selected={isSelected}
                            className={reportRowClassName(isSelected)}
                            onClick={() => onSelectReport(report)}
                          >
                            {cardContent}
                          </MasterListRow>
                        )}
                    </div>
                )
            })}
              </li>
            ))}
             {reports.length === 0 && (
                <div className="col-span-full text-center text-muted-foreground p-8">
                    No reports found.
                </div>
            )}
        </ul>
      </ScrollArea>
    </div>
  );
}
