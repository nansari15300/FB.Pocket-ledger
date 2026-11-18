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

/* ---------------------------------------------------------------------------------------------
 * Gallery runner rules (2026-11-18)
 * ------------------------------------------------------------------------------------------- */

type MissingRuleAction = "fail-and-continue" | "pause-and-hold" | "save-without";

/** Per-profile "When required information is missing" rules (moved out of Common Setting). */
export type RunnerMissingRules = {
  missingFieldRules: Record<string, MissingRuleAction | string>;
  itemRowMismatchAction: string;
  amountMismatchAction: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

/**
 * Full Auto Post has nobody watching: "Pause and review" is not allowed. Every pause rule becomes
 * "Move to Auto post failed"; "Save without the item" stays allowed for the item rule. Full always saves
 * directly (Auto Post forced on, no countdown). Other profiles are returned unchanged.
 */
export function enforceProfileRules<T extends Partial<RunnerMissingRules> & { autoSaveEnabled?: boolean }>(mode: AutoPostMode, profile: T): T {
  // Manual Runner has no automatic start (2026-11-18): file limit is always All and both triggers are off.
  if (mode === "manual") return { ...profile, maxVouchersPerRun: "all", runOnUpload: false, runOnSchedule: false };
  if (mode !== "full") return profile;
  const rules = asRecord(profile.missingFieldRules);
  const forced: Record<string, string> = {};
  for (const [key, action] of Object.entries(rules)) {
    forced[key] = key === "item" && action === "save-without" ? "save-without" : "fail-and-continue";
  }
  return {
    ...profile,
    ...(profile.missingFieldRules ? { missingFieldRules: forced as T["missingFieldRules"] } : {}),
    ...(profile.itemRowMismatchAction !== undefined ? { itemRowMismatchAction: "fail-and-continue" } : {}),
    ...(profile.amountMismatchAction !== undefined ? { amountMismatchAction: "fail-and-continue" } : {}),
    autoSaveEnabled: true,
  };
}

/**
 * Migration: a saved profile that already has its own missing-info rules keeps them; an older profile
 * (rules lived only in Common Setting / top level) takes the old common values so nothing is lost.
 */
export function pickProfileRules(rawProfile: unknown, normalizedProfile: RunnerMissingRules, legacy: RunnerMissingRules): RunnerMissingRules {
  const raw = asRecord(rawProfile);
  const hasRules = !!raw.missingFieldRules && typeof raw.missingFieldRules === "object";
  return {
    missingFieldRules: hasRules ? normalizedProfile.missingFieldRules : legacy.missingFieldRules,
    itemRowMismatchAction: typeof raw.itemRowMismatchAction === "string" ? normalizedProfile.itemRowMismatchAction : legacy.itemRowMismatchAction,
    amountMismatchAction: typeof raw.amountMismatchAction === "string" ? normalizedProfile.amountMismatchAction : legacy.amountMismatchAction,
  };
}

/** Fields "Copy settings from" may copy. The target keeps its own on/off flag, triggers, schedule and device. */
export const COPYABLE_PROFILE_KEYS = [
  "scanEngine",
  "autoSaveEnabled",
  "autoSaveSeconds",
  "overwriteEdited",
  "maxVouchersPerRun",
  "missingFieldRules",
  "itemRowMismatchAction",
  "amountMismatchAction",
] as const;

export function copyRunnerProfileFields<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>, targetMode: AutoPostMode): T {
  const next: Record<string, unknown> = { ...target };
  for (const key of COPYABLE_PROFILE_KEYS) {
    if (!(key in source)) continue;
    const value = source[key];
    next[key] = value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : value;
  }
  return enforceProfileRules(targetMode, next as T & Partial<RunnerMissingRules>) as T;
}

/**
 * Save / Apply in Voucher Post Setting: saves every profile, but the ACTIVE runner is the one chosen in
 * Select Runner (or the ribbon slider) — never the tab that is only being viewed. Top-level fields mirror
 * the active profile so `enabled` / `activeRunnerMode` / `processingMode` always agree with the flags.
 */
export function buildRunnerSettingsSave<P extends Record<string, unknown>>(
  profiles: Record<AutoPostMode, P>,
  active: AutoPostMode,
): Record<string, unknown> & { runnerProfiles: Record<AutoPostMode, P> } {
  const exclusive = withExclusiveRunnerProfiles(profiles, active) as Record<AutoPostMode, P>;
  const runnerProfiles = {} as Record<AutoPostMode, P>;
  for (const mode of AUTO_POST_MODES) {
    const profile = exclusive[mode];
    runnerProfiles[mode] = enforceProfileRules(mode, {
      ...profile,
      processingMode: mode === "full" ? "full" : "semi",
    } as P & Partial<RunnerMissingRules>) as P;
  }
  return {
    ...runnerProfiles[active],
    ...runnerModePersistFields(active),
    runnerProfiles,
  };
}
