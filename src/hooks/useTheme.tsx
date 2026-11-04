
"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import {
  DEFAULT_PRIMARY_CLASS,
  DEFAULT_THEME_CLASS,
  REMOVED_PRIMARY_CLASSES,
  REMOVED_THEME_CLASSES,
  resolveStoredThemePreference,
  THEME_DEFAULT_REV,
  THEME_DEFAULT_REV_KEY,
  THEME_STORAGE_KEY,
  PRIMARY_STORAGE_KEY,
} from "@/lib/proTheme";
import {
  APP_PRIMARY_CLASS_NAMES,
  APP_THEME_CLASS_NAMES,
  isDarkAppTheme,
} from "@/lib/appThemes";

type Theme = (typeof APP_THEME_CLASS_NAMES)[number] | "theme-vagawa";
type PrimaryColor = (typeof APP_PRIMARY_CLASS_NAMES)[number] | "primary-vagawa";


type ThemeContextType = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  primaryColor: PrimaryColor;
  setPrimaryColor: (primaryColor: PrimaryColor) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
// Theme swap par body ka pura className wipe na ho; sirf known theme/primary classes replace karo.
const THEME_CLASS_NAMES: Theme[] = [...APP_THEME_CLASS_NAMES, "theme-vagawa"];
const PRIMARY_CLASS_NAMES: PrimaryColor[] = [...APP_PRIMARY_CLASS_NAMES, "primary-vagawa"];

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  // SSR + first paint: Pro default (layout.tsx body class + boot script ke saath same).
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME_CLASS);
  const [primaryColor, setPrimaryColorState] = useState<PrimaryColor>(DEFAULT_PRIMARY_CLASS);
  const [themeHydrated, setThemeHydrated] = useState(false);

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const storedPrimary = localStorage.getItem(PRIMARY_STORAGE_KEY);
    const rev = localStorage.getItem(THEME_DEFAULT_REV_KEY);
    const resolved = resolveStoredThemePreference(storedTheme, storedPrimary, rev);
    setThemeState(resolved.theme as Theme);
    setPrimaryColorState(resolved.primary as PrimaryColor);
    if (resolved.migrated || rev !== THEME_DEFAULT_REV) {
      localStorage.setItem(THEME_DEFAULT_REV_KEY, THEME_DEFAULT_REV);
      localStorage.setItem(THEME_STORAGE_KEY, resolved.theme);
      localStorage.setItem(PRIMARY_STORAGE_KEY, resolved.primary);
    }
    setThemeHydrated(true);
  }, []);

  useEffect(() => {
    if (!themeHydrated) return;
    // Startup flicker fix: static dashboard load par body reset (blank frame) ki jagah targeted class replace karo.
    document.body.classList.remove(
      ...THEME_CLASS_NAMES,
      ...PRIMARY_CLASS_NAMES,
      ...REMOVED_THEME_CLASSES,
      ...REMOVED_PRIMARY_CLASSES,
      "dark",
    );
    // Root layout jaisa typography + theme; base classes stable rakhkar sirf active theme apply karo.
    document.body.classList.add("font-body", "antialiased", theme, primaryColor);
    if (isDarkAppTheme(theme)) document.body.classList.add("dark");
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(PRIMARY_STORAGE_KEY, primaryColor);
  }, [theme, primaryColor, themeHydrated]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };
  
  const setPrimaryColor = (newPrimaryColor: PrimaryColor) => {
    setPrimaryColorState(newPrimaryColor);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, primaryColor, setPrimaryColor }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
