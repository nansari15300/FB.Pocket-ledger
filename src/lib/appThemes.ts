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
  {
    name: "Light",
    themeValue: "theme-pure-white",
    primaryValue: "primary-pure-white",
    color: "hsl(0, 0%, 100%)",
    group: "app",
  },
  {
    name: "Soft Green",
    themeValue: "theme-soft-green",
    primaryValue: "primary-soft-green",
    color: "hsl(95, 35%, 45%)",
    group: "app",
  },
  {
    name: "Dim Soft Green",
    themeValue: "theme-dim-soft-green",
    primaryValue: "primary-dim-soft-green",
    color: "hsl(140, 70%, 50%)",
    group: "app",
  },
  {
    name: "Soft Blue",
    themeValue: "theme-soft-blue",
    primaryValue: "primary-soft-blue",
    color: "hsl(210, 90%, 50%)",
    group: "app",
  },
  {
    name: "Sky Blue",
    themeValue: "theme-sky-blue",
    primaryValue: "primary-sky-blue",
    color: "hsl(199, 89%, 50%)",
    group: "app",
  },
  {
    name: "Soft Yellow",
    themeValue: "theme-soft-yellow",
    primaryValue: "primary-soft-yellow",
    color: "hsl(45, 95%, 55%)",
    group: "app",
  },
  {
    name: "Soft Pink",
    themeValue: "theme-soft-pink",
    primaryValue: "primary-soft-pink",
    color: "hsl(350, 80%, 60%)",
    group: "app",
  },
  {
    name: "Colorfull",
    themeValue: "theme-colorfull",
    primaryValue: "primary-colorfull",
    color: "hsl(270, 70%, 55%)",
    group: "app",
  },
  {
    name: "Light",
    themeValue: "theme-pl-light",
    primaryValue: "primary-pl-light",
    color: "#f4f6fa",
    group: "server",
  },
  {
    name: "Medium",
    themeValue: "theme-pl-medium",
    primaryValue: "primary-pl-medium",
    color: "#3a3a3a",
    group: "server",
  },
  {
    name: "Gray",
    themeValue: "theme-pl-gray",
    primaryValue: "primary-pl-gray",
    color: "#d9d9d9",
    group: "server",
  },
  {
    name: "Dark",
    themeValue: "theme-pl-dark",
    primaryValue: "primary-pl-dark",
    color: "#0f141c",
    dark: true,
    group: "server",
  },
];

export const APP_THEME_CLASS_NAMES = APP_THEME_OPTIONS.map((t) => t.themeValue);
export const APP_PRIMARY_CLASS_NAMES = APP_THEME_OPTIONS.map((t) => t.primaryValue);

export function isDarkAppTheme(theme: string): boolean {
  return APP_THEME_OPTIONS.some((t) => t.themeValue === theme && t.dark === true);
}

export const APP_THEME_OPTIONS_APP = APP_THEME_OPTIONS.filter((t) => t.group !== "server");
export const APP_THEME_OPTIONS_SERVER = APP_THEME_OPTIONS.filter((t) => t.group === "server");
