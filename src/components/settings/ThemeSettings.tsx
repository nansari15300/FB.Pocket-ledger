"use client";

import type { CSSProperties } from "react";
import { useTheme } from "@/hooks/useTheme";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import {
  APP_THEME_OPTIONS,
  APP_THEME_OPTIONS_APP,
  APP_THEME_OPTIONS_SERVER,
  type AppThemeOption,
} from "@/lib/appThemes";

function themeSwatchStyle(color: string): CSSProperties {
  return color.startsWith("linear-gradient") ? { background: color } : { backgroundColor: color };
}

function ThemeTile({
  option,
  selected,
  onClick,
}: {
  option: AppThemeOption;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-lg border-2 p-2 flex items-center justify-between",
        selected ? "border-primary" : "border-transparent hover:border-border"
      )}
    >
      <div className="flex items-center gap-4">
        <div className="h-8 w-8 rounded-full border" style={themeSwatchStyle(option.color)} />
        <span className="font-medium">{option.name}</span>
      </div>
      {selected ? <Check className="w-6 h-6 text-primary" /> : null}
    </div>
  );
}

/** `localOnlyHint`: shared user — theme pehle se localStorage me; sirf is browser/device par. */
export function ThemeSettings({ localOnlyHint }: { localOnlyHint?: boolean }) {
  const { theme, setTheme, primaryColor, setPrimaryColor } = useTheme();

  const applyTheme = (option: AppThemeOption) => {
    setTheme(option.themeValue as Parameters<typeof setTheme>[0]);
    setPrimaryColor(option.primaryValue as Parameters<typeof setPrimaryColor>[0]);
  };

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Background Theme</CardTitle>
          <CardDescription>
            Choose a color theme for the application background.
            {localOnlyHint ? (
              <span className="mt-2 block text-amber-700 dark:text-amber-400">
                Company settings are managed by the owner — theme changes here stay only on this device for you.
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {APP_THEME_OPTIONS_APP.map((t) => (
              <ThemeTile
                key={t.themeValue}
                option={t}
                selected={theme === t.themeValue}
                onClick={() => applyTheme(t)}
              />
            ))}
          </div>
          <div>
            <p className="mb-3 text-sm font-medium text-muted-foreground">Server</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {APP_THEME_OPTIONS_SERVER.map((t) => (
                <ThemeTile
                  key={t.themeValue}
                  option={t}
                  selected={theme === t.themeValue}
                  onClick={() => applyTheme(t)}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Button & Accent Color</CardTitle>
          <CardDescription>
            Choose the primary color for buttons and highlights.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {APP_THEME_OPTIONS.map((t) => (
              <ThemeTile
                key={t.primaryValue}
                option={t}
                selected={primaryColor === t.primaryValue}
                onClick={() => setPrimaryColor(t.primaryValue as Parameters<typeof setPrimaryColor>[0])}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
