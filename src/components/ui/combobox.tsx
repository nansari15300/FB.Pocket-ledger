
"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus, Crown, X, Pencil } from "lucide-react";
import { useComboboxEditOption } from "@/components/ui/comboboxEditOption";
import { cn } from "@/lib/utils";
import { getMasterAlias, normalizeComboboxSearch, skeletonQueryMatches } from "@/lib/masterAliasIndex";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";

type ComboboxProps = {
  // Option-level disabled is used by voucher account dropdowns to block non-selectable accounts.
  options: {
    value: string;
    label: string;
    triggerLabel?: string;
    isSpecial?: boolean;
    disabled?: boolean;
    /** Tree picker: left indent in dropdown rows (×15px). */
    depth?: number;
    /** Extra haystack for filter search (breadcrumb path). */
    searchText?: string;
  /** Alias Name: matched by search and shown as small secondary text (never as the label). */
  aliasText?: string;
  }[];
  value?: string | string[];
  onChange?: (value: string, newName?: string) => void;
  onMultiChange?: (values: string[]) => void;
  placeholder?: string;
  /** CommandInput placeholder (filter list by typing). */
  searchPlaceholder?: string;
  addNewLabel?: string;
  addNewLabels?: { value: string; label: string }[];
  disabled?: boolean;
  isMultiSelect?: boolean;
  triggerClassName?: string;
  // Optional UI flag: highlight trailing "Balance: ..." text in option rows.
  highlightBalanceInOptions?: boolean;
  // Optional UI flag: force option labels to stay in a single row.
  noWrapOptions?: boolean;
  // Optional UI flag: when single-row is enabled, show full text (no ellipsis truncation).
  showFullOptionText?: boolean;
  // Optional popover sizing mode: "auto" allows dropdown to grow wider than trigger.
  contentWidthMode?: "trigger" | "auto";
  /** Dialog ke andar: modal=false + focus search — nested focus trap se search dikhe/kaam kare */
  popoverModal?: boolean;
  /** Khulte hi filter input par focus (Note form / lambe lists). */
  autoFocusSearchOnOpen?: boolean;
  /** Lamba selected label: truncate ke bajay trigger me horizontal scroll (voucher line grid). */
  triggerLabelScrollable?: boolean;
  /**
   * Trigger text ka minimum width (`ch`): grid/flex me `min-w-0` se Unit jaise fields 2 letter tak squeeze ho rahe the —
   * yahan ~N character worth width + `truncate` se uske baad ellipsis.
   */
  triggerLabelMinCh?: number;
  /** Trigger pill naam ki width jitni — w-full stretch nahi. */
  fitTrigger?: boolean;
  /** Pill column bhar de, aur naam column se lamba ho to column uske saath badhe. */
  fillColumn?: boolean;
  /** Optional: cap visible filtered options (useful for mobile dropdown performance/clarity). */
  maxVisibleOptions?: number;
  /** Popover panel extra classes; agar set ho to default trigger-width inline style skip (mobile width jaise). */
  popoverContentClassName?: string;
  /** CommandList max-height / scroll — default `max-h-[300px]`. */
  commandListClassName?: string;
  /**
   * Mobile par default 80vw list + ek-line option — band karo jahan wrap chahiye (`mobileWideOptionList={false}`).
   * Web + APK/Capacitor dono: `useIsMobile()` breakpoint.
   */
  mobileWideOptionList?: boolean;
  /** Native tooltip on trigger (e.g. disabled picker hint). */
  title?: string;
  /** Pencil icon on each option row → opens that master's Edit dialog (does NOT select). Falls back to ComboboxEditOptionContext. */
  onEditOption?: (value: string) => void;
  /** Multi-select only: caller ka custom trigger text (e.g. "A, B" / "3 users" / "All"). Na diya ho to purana behaviour. */
  multiTriggerLabel?: string;
  /** Optional: typed search se ek custom 'Add' row banaye (null = row nahi). Default off; set ho to addNewLabel/addNewLabels ki jagah. */
  customAddForSearch?: (search: string) => { value: string; label: string } | null;
};

export function Combobox({
  options,
  value,
  onChange,
  onMultiChange,
  placeholder = "Select an option",
  searchPlaceholder = "Search...",
  addNewLabel,
  addNewLabels,
  customAddForSearch,
  disabled = false,
  isMultiSelect = false,
  triggerClassName,
  highlightBalanceInOptions = false,
  noWrapOptions = false,
  showFullOptionText = false,
  contentWidthMode = "trigger",
  popoverModal = true,
  autoFocusSearchOnOpen = true,
  triggerLabelScrollable = false,
  triggerLabelMinCh,
  fitTrigger = false,
  fillColumn = false,
  maxVisibleOptions,
  popoverContentClassName,
  commandListClassName,
  mobileWideOptionList = true,
  title,
  onEditOption,
  multiTriggerLabel,
}: ComboboxProps) {
  const editResolver = useComboboxEditOption();
  const editHandlerFor = React.useCallback(
    (v: string): (() => void) | null => {
      if (!v || v === "all") return null;
      if (onEditOption) return () => onEditOption(v);
      return editResolver ? editResolver(v) : null;
    },
    [onEditOption, editResolver]
  );
  const isMobile = useIsMobile();
  /** Voucher / sab combo: mobile par list ~80vw jab tak caller ne `popoverContentClassName` na di ho. */
  const useMobileWideList =
    mobileWideOptionList !== false && isMobile && !popoverContentClassName;
  /** Mobile: naam ek row + horizontal scroll; `noWrapOptions={false}` se purana wrap behaviour. */
  const effectiveNoWrap = isMobile ? noWrapOptions !== false : noWrapOptions;
  const effectiveShowFull = isMobile ? showFullOptionText !== false : showFullOptionText;
  const skipPopoverInlineWidth = Boolean(popoverContentClassName) || useMobileWideList;
  const mergedPopoverContentClassName = cn(
    useMobileWideList &&
      "w-[80vw] max-w-[80vw] sm:min-w-[var(--radix-popover-trigger-width)] sm:w-auto sm:max-w-md",
    // Desktop list: the trigger often sits in a narrow column (Other Charge / Pay from), but the panel has the
    // whole screen to use — a 350px list turned "Party: Pratik Trade Center Pvt.Ltd" into "Party: Pra…".
    !useMobileWideList && "sm:min-w-[min(32rem,90vw)] sm:w-auto sm:max-w-[min(46rem,92vw)]",
    popoverContentClassName
  );

  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  /** cmdk highlighted row = form `value` jab dropdown khule — pehla item galat “selected” na dikhe. */
  const [cmdkListValue, setCmdkListValue] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  /** List scroll / drag: accidental onSelect rokne (mobile touch scroll). */
  const listGestureStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const blockSelectFromGestureRef = React.useRef(false);
  /** Khulte hi programmatic scroll se `onScroll` pehli tap block na kare. */
  const ignoreListScrollRef = React.useRef(false);

  // Dialog + Popover: default preventDefault se search input focus nahi milta — optional rAF se focus
  React.useEffect(() => {
    if (!open || !autoFocusSearchOnOpen) return;
    const id = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, autoFocusSearchOnOpen]);

  React.useEffect(() => {
    if (!open || isMultiSelect) return;
    const v = Array.isArray(value) ? "" : (value ?? "");
    setCmdkListValue(typeof v === "string" ? v : "");
  }, [open, value, isMultiSelect]);

  React.useEffect(() => {
    if (!open) return;
    ignoreListScrollRef.current = true;
    const t = window.setTimeout(() => {
      ignoreListScrollRef.current = false;
    }, 220);
    return () => window.clearTimeout(t);
  }, [open]);

  const runIfNotScrollGesture = (fn: () => void) => {
    if (blockSelectFromGestureRef.current) {
      blockSelectFromGestureRef.current = false;
      return;
    }
    fn();
  };

  const focusSearchSoon = React.useCallback(() => {
    requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (!input) return;
      if (typeof document !== "undefined" && document.activeElement === input) return;
      input.focus({ preventScroll: true });
    });
  }, []);

  const handleSingleSelect = (val: string) => {
    onChange?.(val);
    setOpen(false);
    setSearch("");
    requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
    });
  };
  
  const handleMultiSelect = (val: string) => {
    if (!Array.isArray(value) || !onMultiChange) return;

    if (val === 'all') {
        const isAllSelected = value.includes('all') || value.length === options.length;
        onMultiChange(isAllSelected ? [] : ['all']);
        return;
    }
    
    let newSelection = value.includes('all') ? [] : [...value];
    
    if (newSelection.includes(val)) {
        newSelection = newSelection.filter(item => item !== val);
    } else {
        newSelection.push(val);
    }

    if (newSelection.length === options.length) {
        onMultiChange(['all']);
    } else {
        onMultiChange(newSelection);
    }
    focusSearchSoon();
  };

  const handleAddNew = (val: string, newName: string) => {
    onChange?.(val, newName);
    setOpen(false);
    setSearch("");
    requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
    });
  };
  
  const displayValue = () => {
    if (isMultiSelect) {
      if (multiTriggerLabel) return multiTriggerLabel;
      if (!Array.isArray(value) || value.length === 0 || value.includes('all')) return placeholder;
      if (value.length === 1) {
        return options.find(opt => opt.value === value[0])?.label || placeholder;
      }
      return `${value.length} selected`;
    }
    const selectedOption = options.find((option) => option.value === value);
    // Allow caller to show a cleaner selected value than dropdown list row text.
    return selectedOption?.triggerLabel || selectedOption?.label || placeholder;
  };

  const customAddItem = customAddForSearch ? customAddForSearch(search.trim()) : null;
  const addNewItems = customAddForSearch
    ? (customAddItem ? [customAddItem] : [])
    : addNewLabels || (addNewLabel ? [{value: "add-new", label: addNewLabel}] : []);
  const q = search.trim().toLowerCase();
  const qn = normalizeComboboxSearch(search);
  // Alias Name: from option.aliasText or the master alias index (by option value = entity id); searched, not shown as label.
  const aliasOf = (opt: { value: string; aliasText?: string }) => opt.aliasText || getMasterAlias(opt.value);
  /** Hover tooltip: full label + alias, since the row truncates to fit one line. */
  const optionTitle = (opt: { value: string; label: string; aliasText?: string }) => {
    const al = aliasOf(opt);
    return al && normalizeComboboxSearch(al) !== normalizeComboboxSearch(opt.label) ? `${opt.label} — ${al}` : opt.label;
  };
  const filteredOptions = q.length === 0
    ? options
    : options.filter((opt) => {
        const hay = normalizeComboboxSearch(opt.searchText || opt.label);
        const alias = aliasOf(opt);
        if (hay.includes(qn) || normalizeComboboxSearch(opt.label).includes(qn) || (!!alias && normalizeComboboxSearch(alias).includes(qn))) return true;
        // Roman <-> Devanagari (sound skeleton), alias first
        return (!!alias && skeletonQueryMatches(search, alias)) || skeletonQueryMatches(search, opt.label);
      });
  // Keep dropdown manageable on dense lists by capping rendered rows when requested.
  const visibleOptions = React.useMemo(() => {
    if (typeof maxVisibleOptions !== "number" || maxVisibleOptions <= 0) return filteredOptions;
    const capped = filteredOptions.slice(0, maxVisibleOptions);
    // Keep special action options visible at list bottom even when capped.
    const specialTail = filteredOptions.filter((opt) => opt.isSpecial && !capped.some((c) => c.value === opt.value));
    return [...capped, ...specialTail];
  }, [filteredOptions, maxVisibleOptions]);
  const hasNoResults = filteredOptions.length === 0;
  const showAddNew = addNewItems.length > 0 && (search.trim().length > 0 || hasNoResults);
  const renderHighlightedText = (text: string, segmentClassName?: string) => {
    if (!q) return <span className={segmentClassName}>{text}</span>;
    const lowerText = text.toLowerCase();
    const pieces: React.ReactNode[] = [];
    let cursor = 0;
    let matchIndex = lowerText.indexOf(q);

    while (matchIndex >= 0) {
      if (matchIndex > cursor) {
        pieces.push(
          <span key={`${cursor}-plain`} className={segmentClassName}>
            {text.slice(cursor, matchIndex)}
          </span>
        );
      }
      const end = matchIndex + q.length;
      pieces.push(
        <span key={`${matchIndex}-match`} className="rounded bg-pink-200 px-0.5 text-pink-900">
          {text.slice(matchIndex, end)}
        </span>
      );
      cursor = end;
      matchIndex = lowerText.indexOf(q, cursor);
    }

    if (cursor < text.length) {
      pieces.push(
        <span key={`${cursor}-tail`} className={segmentClassName}>
          {text.slice(cursor)}
        </span>
      );
    }

    return <>{pieces}</>;
  };

  const renderOptionLabel = (label: string) => {
    // Keep list row text single-line when caller requests no-wrap options.
    const labelClassName = cn(
      "flex-1 min-w-0",
      effectiveNoWrap && "whitespace-nowrap",
      effectiveNoWrap && effectiveShowFull && "overflow-x-auto [scrollbar-width:thin]",
      effectiveNoWrap && !effectiveShowFull && "truncate"
    );
    if (!highlightBalanceInOptions) return <span className={labelClassName}>{renderHighlightedText(label)}</span>;
    const balanceIdx = label.indexOf("Balance:");
    if (balanceIdx < 0) return <span className={labelClassName}>{renderHighlightedText(label)}</span>;
    const prefix = label.slice(0, balanceIdx);
    const balanceText = label.slice(balanceIdx);
    return (
      <span className={labelClassName}>
        {renderHighlightedText(prefix)}
        {renderHighlightedText(balanceText, "text-green-600 font-medium")}
      </span>
    );
  };

  const hasLabelMinCh = typeof triggerLabelMinCh === "number" && triggerLabelMinCh > 0;
  const labelMinCh = hasLabelMinCh ? triggerLabelMinCh! : null;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={popoverModal}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          title={title}
          className={cn(
            // overflow label wrapper par; button par nahi — warna ChevronsUpDown clip (Unit = lamba minWidth).
            fillColumn
              ? "w-full min-w-max max-w-none justify-between gap-0.5 h-9 px-2"
              : fitTrigger
                ? "w-fit max-w-full justify-between gap-0.5 h-9 px-2"
                : "w-full max-w-full justify-between gap-0.5 h-9 px-2",
            !fillColumn && !fitTrigger && labelMinCh == null ? "min-w-0" : "",
            triggerLabelScrollable ? "overflow-x-auto" : "overflow-visible",
            triggerClassName
          )}
          style={
            labelMinCh != null
              ? { minWidth: `calc(${labelMinCh}ch + 1.75rem)` }
              : undefined
          }
          disabled={disabled}
        >
          <span
            className={cn(
              "flex items-center gap-1",
              fillColumn || fitTrigger
                ? "w-auto shrink-0 whitespace-nowrap"
                : triggerLabelScrollable
                  ? "min-w-0 flex-1 max-w-full overflow-x-auto"
                  : "min-w-0 flex-1 max-w-[calc(100%-1.75rem)] overflow-hidden"
            )}
            style={
              labelMinCh != null
                ? { minWidth: `${labelMinCh}ch` }
                : undefined
            }
          >
            {!isMultiSelect && (options.find((o) => o.value === value))?.isSpecial && <Crown className="h-4 w-4 shrink-0 text-amber-500" />}
            <span
              className={cn(
                "block text-left",
                fillColumn || fitTrigger
                  ? "w-auto whitespace-nowrap"
                  : cn(
                      "flex-1 max-w-full",
                      labelMinCh == null ? "min-w-0" : "",
                      triggerLabelScrollable ? "overflow-x-auto whitespace-nowrap" : "truncate"
                    )
              )}
              style={
                labelMinCh != null
                  ? { minWidth: `${labelMinCh}ch` }
                  : undefined
              }
            >
              {displayValue()}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 mr-0.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        // Custom / mobile-80vw: inline width mat lagao — radix trigger var list ko patla kar deta tha.
        style={
          skipPopoverInlineWidth
            ? undefined
            : contentWidthMode === "auto"
              ? { minWidth: `var(--radix-popover-trigger-width)` }
              : { width: `var(--radix-popover-trigger-width)` }
        }
        className={cn(
          "p-0 z-[9999]",
          !skipPopoverInlineWidth && contentWidthMode === "auto" && "w-auto max-w-[calc(100vw-2rem)]",
          mergedPopoverContentClassName
        )}
        sideOffset={4}
        onOpenAutoFocus={(e) => {
          // Dialog ke andar popover: radix default focus search ko block karta hai — manual focus
          e.preventDefault();
          if (autoFocusSearchOnOpen) {
            requestAnimationFrame(() => searchInputRef.current?.focus());
          }
        }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command
          shouldFilter={false}
          {...(!isMultiSelect
            ? {
                value: cmdkListValue,
                onValueChange: setCmdkListValue,
              }
            : {})}
        >
          <CommandInput
            ref={searchInputRef}
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <CommandList
            className={cn(
              // Desktop: a proper picker panel (≈15 rows) — the dialog has the screen to spare, and scrolling
              // two rows at a time made finding a party tedious. Mobile keeps the roomier default.
              !isMobile && "md:max-h-[min(60vh,34rem)]",
              commandListClassName
            )}
            onPointerDownCapture={(e) => {
              listGestureStartRef.current = { x: e.clientX, y: e.clientY };
              blockSelectFromGestureRef.current = false;
            }}
            onPointerMoveCapture={(e) => {
              const s = listGestureStartRef.current;
              if (!s) return;
              if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) {
                blockSelectFromGestureRef.current = true;
              }
            }}
            onPointerUpCapture={() => {
              listGestureStartRef.current = null;
              focusSearchSoon();
            }}
            onClickCapture={() => {
              focusSearchSoon();
            }}
            onScroll={() => {
              if (ignoreListScrollRef.current) return;
              blockSelectFromGestureRef.current = true;
            }}
          >
            <CommandEmpty>{showAddNew ? null : "No results found."}</CommandEmpty>
            <CommandGroup>
              {isMultiSelect && (
                  <CommandItem
                    key="all"
                    value="all"
                    onSelect={() => runIfNotScrollGesture(() => handleMultiSelect("all"))}
                    className="w-full"
                  >
                    {/* pointer-events-none: hit cmdk-item root — full row select (child text svg pe narrow hit fix) */}
                    <span className="pointer-events-none flex w-full min-w-0 items-center">
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", (value as string[]).includes("all") ? "opacity-100" : "opacity-0")} />
                      All
                    </span>
                  </CommandItem>
              )}
              {visibleOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  // Use option.value (id) so cmdk passes correct value; option.label can break selection.
                  disabled={option.disabled}
                  // Truncated rows still need the full text: native tooltip on hover (desktop only, no-op touch).
                  title={isMobile ? undefined : optionTitle(option)}
                  onSelect={() => {
                    if (option.disabled) return;
                    runIfNotScrollGesture(() => {
                      if (isMultiSelect) handleMultiSelect(option.value);
                      else handleSingleSelect(option.value);
                    });
                  }}
                  className={cn(
                    "group/cbopt flex w-full min-w-0 items-center",
                    // Patla trigger: dropdown row wrap na ho — ek line + andar scroll
                    effectiveNoWrap && "whitespace-nowrap",
                    // Sirf Check = form selection; aria-selected sirf halka hover (scroll pe galat “selected” na lage).
                    "[&[aria-selected=true]]:!bg-muted/25 [&[aria-selected=true]]:!text-foreground",
                    option.isSpecial && "text-amber-600 font-medium",
                    option.disabled && "opacity-70 cursor-default font-medium text-muted-foreground"
                  )}
                >
                  <span
                    className="pointer-events-none flex w-full min-w-0 items-center"
                    style={
                      option.depth != null && option.depth > 0
                        ? { paddingLeft: `${option.depth * 15}px` }
                        : undefined
                    }
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        isMultiSelect
                          ? (value as string[]).includes(option.value) || (value as string[]).includes("all")
                            ? "opacity-100"
                            : "opacity-0"
                          : value === option.value
                            ? "opacity-100"
                            : "opacity-0"
                      )}
                    />
                    {option.isSpecial && <Crown className="mr-2 h-4 w-4 shrink-0 text-amber-500" />}
                    {(() => {
                      const al = aliasOf(option);
                      const hasAlias = !!al && normalizeComboboxSearch(al) !== normalizeComboboxSearch(option.label);
                      return (
                        <>
                          <span className={cn("min-w-0", hasAlias ? "flex-1 truncate" : "flex-1")}>{renderOptionLabel(option.label)}</span>
                          {hasAlias ? (
                            <span className="ml-1.5 max-w-[45%] shrink-0 truncate whitespace-nowrap text-[11px] text-muted-foreground" data-combobox-alias="">{al}</span>
                          ) : null}
                        </>
                      );
                    })()}
                  </span>
                  {(() => {
                    const edit = option.isSpecial ? null : editHandlerFor(option.value);
                    if (!edit) return null;
                    const stop = (e: React.SyntheticEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                    };
                    return (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Edit"
                        title="Edit"
                        data-combobox-edit-option=""
                        className="ml-1 shrink-0 rounded p-1 text-muted-foreground opacity-100 hover:bg-muted hover:text-foreground md:opacity-0 md:group-hover/cbopt:opacity-100"
                        onPointerDown={stop}
                        onMouseDown={stop}
                        onTouchStart={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          stop(e);
                          setOpen(false);
                          window.setTimeout(edit, 0);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    );
                  })()}
                </CommandItem>
              ))}
            </CommandGroup>
            
            {showAddNew && (
                <>
                    <CommandSeparator />
                    <CommandGroup>
                         {addNewItems.map((item) => (
                            <CommandItem
                                key={item.value}
                                value={item.value}
                                onSelect={() =>
                                  runIfNotScrollGesture(() => handleAddNew(item.value, search.trim()))
                                }
                                className="w-full min-w-0 text-green-600 font-medium focus:text-green-700 focus:bg-green-50 dark:focus:bg-green-950/30"
                            >
                                <span className="pointer-events-none flex w-full min-w-0 items-center">
                                  <Plus className="mr-2 h-4 w-4 shrink-0 text-green-600" />
                                  {customAddForSearch ? item.label : search.trim() ? `${item.label}: "${search.trim()}"` : item.label}
                                </span>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                </>
            )}

          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
