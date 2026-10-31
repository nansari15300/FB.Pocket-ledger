"use client";

import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { PocketBaseSignInBox } from "@/components/settings/PocketBaseSignInBox";
import {
  ONLINE_DATA_SERVERS,
  getActiveOnlineDataServer,
  resolvePocketBaseServerUrl,
  type OnlineDataServerId,
  type OnlineDataServerSettings,
} from "@/lib/onlineDataServer";

type Props = {
  settings: OnlineDataServerSettings;
  /** When omitted (or `readOnly`), radios are disabled - user app view. */
  onSelect?: (id: OnlineDataServerId) => void;
  readOnly?: boolean;
  disabled?: boolean;
  /** Prefix for radio ids so two tables on one page do not clash. */
  idPrefix?: string;
  className?: string;
  /** Makes the active (selected) row clickable, e.g. to open the online gate. */
  onActiveRowClick?: () => void;
  /** Tooltip / aria label for the clickable active row. */
  activeRowTitle?: string;
  /** Stronger highlight on the active row (e.g. online gate is the current gate). */
  activeRowEmphasis?: boolean;
  /** Hide the Pocket Ledger Server sign-in box (shown when that server is active). */
  hidePocketBaseSignIn?: boolean;
};

/**
 * "Online data server" table rendered from the central registry (`ONLINE_DATA_SERVERS`).
 * Ticked row = server where online company data/files are saved (set by SuperAdmin).
 */
export function OnlineDataServerTable({
  settings,
  onSelect,
  readOnly = false,
  disabled = false,
  idPrefix = "online-data-server",
  className,
  onActiveRowClick,
  activeRowTitle = "Open",
  activeRowEmphasis = false,
  hidePocketBaseSignIn = false,
}: Props) {
  const active = getActiveOnlineDataServer(settings);
  const locked = readOnly || !onSelect || disabled;

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <RadioGroup
        value={active.id}
        onValueChange={(v) => {
          if (!locked && onSelect) onSelect(v as OnlineDataServerId);
        }}
        disabled={locked}
        aria-label="Online data server"
        className="block"
      >
        {/* Cells never wrap (single line); horizontal scroll only as a fallback when the card is too narrow. */}
        <div className="overflow-x-auto rounded-md border border-border bg-background">
          <table className="w-full whitespace-nowrap border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="w-7 py-1.5 pl-2 pr-1" />
                <th className="px-1.5 py-1.5 text-left font-medium text-muted-foreground">Server name</th>
                <th className="px-1.5 py-1.5 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-1.5 py-1.5 pr-2 text-left font-medium text-muted-foreground">Status / URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ONLINE_DATA_SERVERS.map((server) => {
                const selected = server.id === active.id;
                const radioId = `${idPrefix}-${server.id}`;
                const url = server.id === "pocketbase" ? resolvePocketBaseServerUrl(settings) || server.defaultUrl : server.defaultUrl;
                const clickable = selected && !!onActiveRowClick;
                return (
                  <tr
                    key={server.id}
                    className={cn(
                      selected && "bg-sky-50/70 dark:bg-sky-950/25",
                      selected && activeRowEmphasis && "bg-sky-100/80 dark:bg-sky-900/30",
                      clickable && "cursor-pointer hover:bg-sky-100 dark:hover:bg-sky-900/40"
                    )}
                    onClick={clickable ? onActiveRowClick : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onActiveRowClick?.();
                            }
                          }
                        : undefined
                    }
                    tabIndex={clickable ? 0 : undefined}
                    title={clickable ? activeRowTitle : undefined}
                    aria-label={clickable ? `${server.name}: ${activeRowTitle}` : undefined}
                  >
                    <td className="py-1.5 pl-2 pr-1 align-middle">
                      <RadioGroupItem value={server.id} id={radioId} aria-label={server.name} className="align-middle" />
                    </td>
                    <td className="px-1.5 py-1.5 align-middle">
                      <span className="inline-flex items-center gap-1.5">
                        <label
                          htmlFor={radioId}
                          className={cn("font-medium text-foreground", !locked && "cursor-pointer", clickable && "cursor-pointer")}
                        >
                          {server.name}
                        </label>
                        {selected ? <Badge className="h-4 bg-primary/90 px-1.5 text-[10px]">Active</Badge> : null}
                      </span>
                    </td>
                    <td className="px-1.5 py-1.5 align-middle text-muted-foreground" title={server.type}>
                      {server.type.replace(/\s*\(.*\)\s*$/, "")}
                    </td>
                    <td className="px-1.5 py-1.5 pr-2 align-middle">
                      <span
                        className={server.implemented ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}
                        title={server.implemented ? "Data sync available" : "Not available"}
                      >
                        {server.implemented ? "Available" : "Not available"}
                      </span>
                      {url ? (
                        <span className="ml-1.5 font-mono text-[10px] text-muted-foreground" translate="no">
                          {url}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </RadioGroup>
      {readOnly ? <p className="text-[11px] text-muted-foreground">Set by admin.</p> : null}
      {active.id === "pocketbase" && !hidePocketBaseSignIn ? (
        <PocketBaseSignInBox url={resolvePocketBaseServerUrl(settings) || active.defaultUrl} />
      ) : null}
    </div>
  );
}
