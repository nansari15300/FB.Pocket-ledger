/**
 * "Pro" background theme — dashboard jaisa har container alag ribbon fill;
 * saare themes par line 1px black (`globals.css`); Default = white containers, Pro = ribbon colors.
 */

import { cn } from "@/lib/utils";

export const PRO_THEME_CLASS = "theme-pro" as const;
export const PRO_PRIMARY_CLASS = "primary-pro" as const;

/** Purana "Default Light" — Settings se choose kar sakte hain; app default Pro hai. */
export const LIGHT_THEME_CLASS = "theme-pure-white" as const;
export const LIGHT_PRIMARY_CLASS = "primary-pure-white" as const;

/** Colorfull - Nov 2026 se pickers me nahi (saved value Server Gray par migrate). */
export const COLORFULL_THEME_CLASS = "theme-colorfull" as const;
export const COLORFULL_PRIMARY_CLASS = "primary-colorfull" as const;

/** Server "Gray" (pb_public style.css) - Nov 2026 app default. */
export const SERVER_GRAY_THEME_CLASS = "theme-pl-gray" as const;
export const SERVER_GRAY_PRIMARY_CLASS = "primary-pl-gray" as const;

/** Naya install / khali storage - Pro default (Nov 4 2026; rev same, saved choice nahi badalti). */
export const DEFAULT_THEME_CLASS = PRO_THEME_CLASS;
export const DEFAULT_PRIMARY_CLASS = PRO_PRIMARY_CLASS;

/** Removed themes: saved value -> Server Gray. Pro is available again. */
export const REMOVED_THEME_CLASSES: readonly string[] = [
  LIGHT_THEME_CLASS,
  COLORFULL_THEME_CLASS,
  // Nov 2026 rev 4: removed from the single theme list -> Server Gray.
  "theme-dim-soft-green",
  "theme-sky-blue",
  "theme-soft-yellow",
  "theme-pl-dark",
  "theme-soft-pink",
];
/** Removed accents -> `primary-pl-gray`. Pro accent stays. */
export const REMOVED_PRIMARY_CLASSES: readonly string[] = [
  LIGHT_PRIMARY_CLASS,
  COLORFULL_PRIMARY_CLASS,
  "primary-dim-soft-green",
  "primary-sky-blue",
  "primary-soft-yellow",
  "primary-pl-dark",
  "primary-soft-pink",
];

export const THEME_STORAGE_KEY = "theme" as const;
export const PRIMARY_STORAGE_KEY = "primaryColor" as const;
/** Default light → pro one-time migrate (`useTheme` + layout boot script). */
export const THEME_DEFAULT_REV_KEY = "pl-theme-default-rev" as const;
export const THEME_DEFAULT_REV = "5" as const;

/**
 * localStorage se theme (rev 5): khali / Light / Colorfull theme -> Server Gray;
 * khali / removed accent -> `primary-pl-gray`. Pro saved value rehti hai. Same logic: layout.tsx boot script.
 */
export function resolveStoredThemePreference(
  storedTheme: string | null,
  storedPrimary: string | null,
  rev: string | null
): { theme: string; primary: string; migrated: boolean } {
  let migrated = rev !== THEME_DEFAULT_REV;
  let theme = storedTheme;
  let primary = storedPrimary;
  if (!theme || REMOVED_THEME_CLASSES.includes(theme)) {
    theme = DEFAULT_THEME_CLASS;
    migrated = true;
  }
  if (!primary || REMOVED_PRIMARY_CLASSES.includes(primary)) {
    primary = DEFAULT_PRIMARY_CLASS;
    migrated = true;
  }
  return { theme, primary, migrated };
}

/** Settings → Theme picker — pehli row */
export const PRO_THEME_DISPLAY_NAME = "Default";

/** Pro: containers ke baahar page/shell — gray (cards andar colorful) */
export const PRO_PAGE_SURFACE_BG = "hsl(220 14% 96%)";


/** Purana "Default Light" — sirf white + 1px black lines */
export const LIGHT_THEME_DISPLAY_NAME = "Light";

/** Dashboard summary cards — theme CSS me colored border (black outline se alag). */
export const PL_DASHBOARD_TONE_CARD = "pl-dashboard-tone-card" as const;

/** Dashboard `FinancialSummaryCards` / Device sync — same rotate order */
export const PRO_DASHBOARD_RIBBON_CYCLE = [
  "pl-dashboard-ribbon-emerald",
  "pl-dashboard-ribbon-sky",
  "pl-dashboard-ribbon-violet",
  "pl-dashboard-ribbon-amber",
  "pl-dashboard-ribbon-rose",
  "pl-dashboard-ribbon-teal",
  "pl-dashboard-ribbon-indigo",
] as const;

const PRO_DASHBOARD_TONE_KEYS = [
  "emerald",
  "sky",
  "violet",
  "amber",
  "rose",
  "teal",
  "indigo",
] as const;

/** Tailwind border hint — asli rang `globals.css` `.pl-dashboard-tone-*` se. */
export const PRO_DASHBOARD_RIBBON_BORDER_CYCLE = [
  "border-emerald-500/85",
  "border-sky-500/85",
  "border-violet-500/85",
  "border-amber-500/85",
  "border-rose-500/85",
  "border-teal-500/85",
  "border-indigo-500/85",
] as const;

/** Card / section index se dashboard ribbon + card-color border (recon share jaisa bold hue). */
export function proDashboardRibbonClass(index: number): string {
  const i =
    ((index % PRO_DASHBOARD_RIBBON_CYCLE.length) + PRO_DASHBOARD_RIBBON_CYCLE.length) %
    PRO_DASHBOARD_RIBBON_CYCLE.length;
  return cn(
    PL_DASHBOARD_TONE_CARD,
    "border",
    PRO_DASHBOARD_RIBBON_BORDER_CYCLE[i],
    PRO_DASHBOARD_RIBBON_CYCLE[i],
    `pl-dashboard-tone-${PRO_DASHBOARD_TONE_KEYS[i]}`,
  );
}
