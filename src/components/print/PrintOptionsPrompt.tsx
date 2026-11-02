"use client";

/**
 * openPrintDirect se pehle: print me logo / company lines on/off — Promise se pdf flow resume.
 */
import * as React from "react";
import { createRoot } from "react-dom/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import { registerImperativeDialogBack } from "@/contexts/DialogBackHandlerContext";
import type { PrintColorMode } from "@/lib/printColorPalette";
import type { MasterPrintKind } from "@/lib/printMastersTypes";
import {
  PrintMastersOptionsPanel,
  type PrintMastersSettings,
} from "@/components/print/PrintMastersOptionsDialog";
import {
  NESTED_LEDGER_CHILD_DIALOG_CONTENT_CN,
  NESTED_LEDGER_CHILD_DIALOG_OVERLAY_CN,
  NESTED_LEDGER_MASTER_EDIT_POPOVER_CN,
} from "@/lib/nestedLedgerMasterEditPresentation";
import { cn } from "@/lib/utils";

/** Ledger/table toggles — print dialog inhe default maane (warna Show Narration off + print par phir bhi narration). */
export type PrintOptionsInitial = {
  printIncludeNarration?: boolean;
  printIncludeNotes?: boolean;
  printIncludeUserColumn?: boolean;
  printIncludeFileColumn?: boolean;
  printLinkedVouchersMode?: "all" | "max2";
};

export type PrintOptionsResult = {
  printIncludeLogo: boolean;
  printIncludeCompanyDetails: boolean;
  printIncludeNarration?: boolean;
  printIncludeTitle?: boolean;
  printIncludeUserColumn?: boolean;
  printIncludeFileColumn?: boolean;
  printIncludeNotes?: boolean;
  printColorMode?: PrintColorMode;
  printDestination?: "internal" | "external";
  printReportKind?: "confirmation" | "statement" | "both";
  printMasterTypes?: MasterPrintKind[];
  printIncludeZeroBalanceMasters?: boolean;
  printMasterIncludeBalance?: boolean;
  printLinkedVouchersMode?: "all" | "max2";
};

export function promptPrintOptions({
  showConfirmationTabs = false,
  showLinkedVoucherOptions = false,
  initial,
}: {
  showConfirmationTabs?: boolean;
  showLinkedVoucherOptions?: boolean;
  initial?: PrintOptionsInitial;
} = {}): Promise<PrintOptionsResult | null> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    let settled = false;
    const finish = (result: PrintOptionsResult | null) => {
      if (settled) return;
      settled = true;
      root.unmount();
      container.remove();
      resolve(result);
    };

    function PrintOptionsDialog() {
      const [open, setOpen] = React.useState(true);
      const [view, setView] = React.useState<"report" | "masters">("report");
      const [printLogo, setPrintLogo] = React.useState(true);
      const [printCompany, setPrintCompany] = React.useState(true);
      const [printNarration, setPrintNarration] = React.useState(initial?.printIncludeNarration ?? true);
      const [printTitle, setPrintTitle] = React.useState(true);
      const [printUserColumn, setPrintUserColumn] = React.useState(initial?.printIncludeUserColumn === true);
      const [printFileColumn, setPrintFileColumn] = React.useState(initial?.printIncludeFileColumn === true);
      const [printNotes, setPrintNotes] = React.useState(initial?.printIncludeNotes === true);
      const [printColorMode, setPrintColorMode] = React.useState<PrintColorMode>("color");
      const [printLinkedVouchersMode, setPrintLinkedVouchersMode] = React.useState<"all" | "max2">(
        initial?.printLinkedVouchersMode ?? "all"
      );
      const [printReportKind, setPrintReportKind] = React.useState<"confirmation" | "statement" | "both">("confirmation");

      const finishReportPrint = (destination: "internal" | "external") => {
        finish({
          printIncludeLogo: printLogo,
          printIncludeCompanyDetails: printCompany,
          printIncludeNarration: printNarration,
          printIncludeTitle: printTitle,
          printIncludeUserColumn: printUserColumn,
          printIncludeFileColumn: printFileColumn,
          printIncludeNotes: printNotes,
          printColorMode,
          ...(showLinkedVoucherOptions ? { printLinkedVouchersMode } : {}),
          printDestination: destination,
          ...(showConfirmationTabs ? { printReportKind } : {}),
        });
      };

      const finishMastersPrint = (
        destination: "internal" | "external",
        settings: PrintMastersSettings
      ) => {
        finish({
          printIncludeLogo: settings.printIncludeLogo,
          printIncludeCompanyDetails: settings.printIncludeCompanyDetails,
          printColorMode: settings.printColorMode,
          printDestination: destination,
          printMasterTypes: settings.masterTypes,
          printIncludeZeroBalanceMasters: settings.printIncludeZeroBalanceMasters,
          printMasterIncludeBalance: settings.printMasterIncludeBalance,
        });
      };

      React.useEffect(() => {
        if (!open) return;
        return registerImperativeDialogBack(() => {
          if (view === "masters") {
            setView("report");
            return;
          }
          setOpen(false);
          finish(null);
        });
      }, [open, view]);

      return (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) finish(null);
          }}
        >
          <DialogContent
            overlayClassName={NESTED_LEDGER_CHILD_DIALOG_OVERLAY_CN}
            className={cn(
              NESTED_LEDGER_CHILD_DIALOG_CONTENT_CN,
              "!flex flex-col gap-0 overflow-hidden p-4 pb-3 max-sm:!w-[98%] max-sm:!max-w-[98%] max-sm:rounded-xl max-sm:left-[50%] max-sm:-translate-x-1/2 h-[min(92dvh,calc(100vh-1.5rem))] max-h-[min(92dvh,calc(100vh-1.5rem))] sm:h-auto sm:max-h-none sm:w-full sm:max-w-md max-sm:top-[max(0.75rem,env(safe-area-inset-top,0px))] max-sm:translate-y-0"
            )}
            aria-describedby={view === "report" ? "print-options-desc" : undefined}
          >
            {view === "masters" ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <PrintMastersOptionsPanel
                  onBack={() => setView("report")}
                  onPrint={finishMastersPrint}
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <DialogHeader className="shrink-0 pr-8">
                <div className="flex items-center gap-1.5">
                  <DialogTitle>Print options</DialogTitle>
                  <Popover>
                    <PopoverTrigger asChild>
                      <AppFreshInfoButton
                        size="xs"
                        aria-label="Print options help"
                        title="Print options help"
                      />
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      data-pl-intro=""
                      className={cn(
                        NESTED_LEDGER_MASTER_EDIT_POPOVER_CN,
                        "w-[min(360px,calc(100vw-2rem))] text-xs leading-relaxed"
                      )}
                    >
                      Choose what appears in the PDF header. Cancel stops printing. Internal opens in-app
                      preview; External opens your device PDF app. Use Print masters for a masters-only list.
                    </PopoverContent>
                  </Popover>
                </div>
                <DialogDescription id="print-options-desc">
                  Select the print options below.
                </DialogDescription>
              </DialogHeader>
              {showConfirmationTabs ? (
                <div className="mb-2 flex gap-1 rounded-lg border p-1" role="tablist" aria-label="Print report type">
                  {([
                    ["confirmation", "Confirmation"],
                    ["statement", "Statement"],
                    ["both", "Both"],
                  ] as const).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={printReportKind === value ? "default" : "outline"}
                      className="h-7 flex-1 px-2 text-xs"
                      role="tab"
                      aria-selected={printReportKind === value}
                      onClick={() => setPrintReportKind(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              ) : null}
              {/* APK/WebView: sirf beech scroll — footer buttons hamesha viewport ke andar */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain touch-pan-y [-webkit-overflow-scrolling:touch] pr-1">
              <div className="flex flex-col gap-4 py-2">
                <div className="flex items-start gap-3 space-y-0">
                  <Checkbox
                    id="print-logo"
                    checked={printLogo}
                    onCheckedChange={(c) => setPrintLogo(c === true)}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="print-logo" className="cursor-pointer font-medium">
                      Print logo
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Off: removes logo or placeholder from PDF header.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 space-y-0">
                  <Checkbox
                    id="print-company"
                    checked={printCompany}
                    onCheckedChange={(c) => setPrintCompany(c === true)}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="print-company" className="cursor-pointer font-medium">
                      Print company details
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Name, address, phone, PAN in header.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 space-y-0">
                  <Checkbox
                    id="print-title"
                    checked={printTitle}
                    onCheckedChange={(c) => setPrintTitle(c === true)}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="print-title" className="cursor-pointer font-medium">
                      Print report title
                    </Label>
                    <p className="text-xs text-muted-foreground">Shows title and total vouchers line.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 space-y-0">
                  <Checkbox
                    id="print-narration"
                    checked={printNarration}
                    onCheckedChange={(c) => setPrintNarration(c === true)}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="print-narration" className="cursor-pointer font-medium">
                      Print narration
                    </Label>
                    <p className="text-xs text-muted-foreground">Shows narration/details rows below entries.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 space-y-0">
                  <Checkbox
                    id="print-user-column"
                    checked={printUserColumn}
                    onCheckedChange={(c) => setPrintUserColumn(c === true)}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="print-user-column" className="cursor-pointer font-medium">
                      Include User column
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Adds User column to the PDF table when checked. Off by default.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 space-y-0">
                  <Checkbox
                    id="print-file-column"
                    checked={printFileColumn}
                    onCheckedChange={(c) => setPrintFileColumn(c === true)}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="print-file-column" className="cursor-pointer font-medium">
                      Include File column
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Adds File column to the PDF table when checked. Off by default.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 space-y-0">
                  <Checkbox
                    id="print-note-vouchers"
                    checked={printNotes}
                    onCheckedChange={(c) => setPrintNotes(c === true)}
                    className="mt-0.5"
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label htmlFor="print-note-vouchers" className="cursor-pointer font-medium">
                      Include Note vouchers
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Includes note-type vouchers in the printout when checked. Off by default.
                    </p>
                  </div>
                </div>
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">Print color</p>
                  <RadioGroup
                    value={printColorMode}
                    onValueChange={(v) => setPrintColorMode(v === "bw" ? "bw" : "color")}
                    className="flex flex-col gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <RadioGroupItem value="color" id="print-color-mode-color" className="mt-0.5" />
                      <div className="grid gap-1 leading-none">
                        <Label htmlFor="print-color-mode-color" className="cursor-pointer font-medium">
                          Color
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Green debit, red credit, and colored bill-wise voucher links.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <RadioGroupItem value="bw" id="print-color-mode-bw" className="mt-0.5" />
                      <div className="grid gap-1 leading-none">
                        <Label htmlFor="print-color-mode-bw" className="cursor-pointer font-medium">
                          Black &amp; white
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          All amounts print in black/gray — better for B&amp;W printers.
                        </p>
                      </div>
                    </div>
                  </RadioGroup>
                </div>
                {showLinkedVoucherOptions ? (
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-sm font-medium">Linked vouchers</p>
                    <RadioGroup
                      value={printLinkedVouchersMode}
                      onValueChange={(value) =>
                        setPrintLinkedVouchersMode(value === "max2" ? "max2" : "all")
                      }
                      className="flex flex-col gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <RadioGroupItem value="all" id="print-linked-vouchers-all" className="mt-0.5" />
                        <Label htmlFor="print-linked-vouchers-all" className="cursor-pointer font-medium">
                          Show all
                        </Label>
                      </div>
                      <div className="flex items-start gap-3">
                        <RadioGroupItem value="max2" id="print-linked-vouchers-max2" className="mt-0.5" />
                        <div className="grid gap-1 leading-none">
                          <Label htmlFor="print-linked-vouchers-max2" className="cursor-pointer font-medium">
                            Show maximum 2
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Remaining links print as More (+N).
                          </p>
                        </div>
                      </div>
                    </RadioGroup>
                  </div>
                ) : null}
              </div>
              </div>
              <DialogFooter className="shrink-0 !flex-row flex-nowrap items-center justify-end gap-2 w-full overflow-x-auto border-t bg-background pt-3 mt-2 sm:space-x-0 [&>*]:mt-0 [&>button]:shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border border-violet-600 px-4 sm:px-5 text-violet-700 hover:bg-violet-50"
                  onClick={() => setView("masters")}
                >
                  Print masters
                </Button>
                <Button
                  type="button"
                  className="rounded-full border border-blue-600 bg-blue-600 px-4 sm:px-5 text-white hover:bg-blue-700 hover:text-white"
                  onClick={() => finish(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border border-slate-500 px-4 sm:px-5"
                  onClick={() => finishReportPrint("external")}
                >
                  External
                </Button>
                <Button
                  type="button"
                  className="rounded-full border border-green-600 bg-green-600 px-4 sm:px-5 text-white hover:bg-green-700 hover:text-white"
                  onClick={() => finishReportPrint("internal")}
                >
                  Internal
                </Button>
              </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      );
    }

    root.render(<PrintOptionsDialog />);
  });
}
