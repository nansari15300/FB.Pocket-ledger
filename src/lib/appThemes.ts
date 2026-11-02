/** App background themes — Settings picker + header Appearance menu. */

export type AppThemeOption = {
  name: string;
  themeValue: string;
  primaryValue: string;
  color: string;
  dark?: boolean;
  group?: "app" | "server";
};

export const APP_THEME_OPTIONS: AppThemeOption[] = [
  {
    name: "Pro",
    themeValue: "theme-pro",
    primaryValue: "primary-pro",
    color: "linear-gradient(90deg, #ecfdf5, #e0f2fe, #ede9fe, #fffbeb, #ffe4e6)",
    group: "app",
  },
  // Nov 2026 rev 5: Light, Dark, Gray, Blue, Green. Dark is the theme-pl-medium surfaces. Old Dark and Pink values migrate to Server Gray.
  {
    name: "Light",
    themeValue: "theme-pl-light",
    primaryValue: "primary-pl-light",
    color: "#f4f6fa",
    group: "server",
  },
  {
    name: "Dark",
    themeValue: "theme-pl-medium",
    primaryValue: "primary-pl-medium",
    color: "#3a3a3a",
    // Dark surfaces (#3a3a3a): needs body.dark so Tailwind `dark:` variants stay readable.
    dark: true,
    group: "server",
  },
  {
    name: "Gray",
    themeValue: "theme-pl-gray",
    primaryValue: "primary-pl-gray",
    color: "#f4f5f6",
    group: "server",
  },
  {
    name: "Blue",
    themeValue: "theme-soft-blue",
    primaryValue: "primary-soft-blue",
    color: "hsl(210, 90%, 50%)",
    group: "app",
  },
  {
    name: "Green",
    themeValue: "theme-soft-green",
    primaryValue: "primary-soft-green",
    color: "hsl(95, 35%, 45%)",
    group: "app",
  },
];

export const APP_THEME_CLASS_NAMES = APP_THEME_OPTIONS.map((t) => t.themeValue);
export const APP_PRIMARY_CLASS_NAMES = APP_THEME_OPTIONS.map((t) => t.primaryValue);

export function isDarkAppTheme(theme: string): boolean {
  return APP_THEME_OPTIONS.some((t) => t.themeValue === theme && t.dark === true);
}

export const APP_THEME_OPTIONS_APP = APP_THEME_OPTIONS.filter((t) => t.group !== "server");
export const APP_THEME_OPTIONS_SERVER = APP_THEME_OPTIONS.filter((t) => t.group === "server");
