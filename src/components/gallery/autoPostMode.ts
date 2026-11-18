/**
 * Shared Auto post runner mode: ribbon slider and Select Runner use the
 * same source of truth (`activeRunnerMode`, kept in sync with exclusive
 * `runnerProfiles` flags and top-level `enabled` / `processingMode`).
 *
 * Position / list order (left-to-right and top-to-bottom):
 *   0 manual — Manual Runner
 *   1 semi   — Semi Automatic
 *   2 full   — Full Auto Post
 */
export const AUTO_POST_MODES = ["manual", "semi", "full"] as const;
export type AutoPostMode = (typeof AUTO_POST_MODES)[number];

export const AUTO_POST_MODE_INDEX: Record<AutoPostMode, 0 | 1 | 2> = {
  manual: 0,
  semi: 1,
  full: 2,
};

export function isAutoPostMode(value: unknown): value is AutoPostMode {
  return value === "manual" || value === "semi" || value === "full";
}

/** When exactly one Select Runner flag is on, return that mode. */
export function runnerProfileSelectedMode(profiles: unknown): AutoPostMode | null {
  const value = profiles && typeof profiles === "object" ? profiles as Record<string, unknown> : {};
  const selected: AutoPostMode[] = [];
  const manual = value.manual && typeof value.manual === "object" ? value.manual as Record<string, unknown> : {};
  const semi = value.semi && typeof value.semi === "object" ? value.semi as Record<string, unknown> : {};
  const full = value.full && typeof value.full === "object" ? value.full as Record<string, unknown> : {};
  if (manual.manualScan === true) selected.push("manual");
  if (semi.enabled === true) selected.push("semi");
  if (full.enabled === true) selected.push("full");
  return selected.length === 1 ? selected[0] : null;
}

/**
 * Resolve the active runner for the ribbon slider and Select Runner.
 * Prefer a unique `runnerProfiles` selection (what Select Runner shows),
 * then saved `activeRunnerMode`, then legacy `enabled` + `processingMode`.
 */
export function activeRunnerFromSettings(raw: unknown): AutoPostMode {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const fromProfiles = runnerProfileSelectedMode(value.runnerProfiles);
  if (fromProfiles) return fromProfiles;
  if (isAutoPostMode(value.activeRunnerMode)) return value.activeRunnerMode;
  if (value.enabled === true) return value.processingMode === "full" ? "full" : "semi";
  return "manual";
}

/** Top-level fields written with every runner-mode change. */
export function runnerModePersistFields(mode: AutoPostMode): {
  enabled: boolean;
  processingMode: "semi" | "full";
  activeRunnerMode: AutoPostMode;
} {
  return {
    enabled: mode !== "manual",
    processingMode: mode === "full" ? "full" : "semi",
    activeRunnerMode: mode,
  };
}

/** Exclusive Select Runner flags for one active mode. */
export function withExclusiveRunnerProfiles(
  profiles: unknown,
  mode: AutoPostMode,
): Record<string, unknown> {
  const value = profiles && typeof profiles === "object" ? profiles as Record<string, unknown> : {};
  const full = value.full && typeof value.full === "object" ? value.full as Record<string, unknown> : {};
  const semi = value.semi && typeof value.semi === "object" ? value.semi as Record<string, unknown> : {};
  const manual = value.manual && typeof value.manual === "object" ? value.manual as Record<string, unknown> : {};
  return {
    ...value,
    full: { ...full, enabled: mode === "full", manualScan: false },
    semi: { ...semi, enabled: mode === "semi", manualScan: false },
    manual: { ...manual, enabled: false, manualScan: mode === "manual" },
  };
}
