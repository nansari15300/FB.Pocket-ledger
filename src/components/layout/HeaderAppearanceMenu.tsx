"use client";

import type { CSSProperties } from "react";
import { Check, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/useTheme";
import { APP_THEME_OPTIONS, type AppThemeOption } from "@/lib/appThemes";
import { cn } from "@/lib/utils";

function themeSwatchStyle(color: string): CSSProperties {
  return color.startsWith("linear-gradient") ? { background: color } : { backgroundColor: color };
}

function ThemeRow({
  option,
  active,
  onPick,
}: {
  option: AppThemeOption;
  active: boolean;
  onPick: (option: AppThemeOption) => void;
}) {
  return (
    <DropdownMenuItem
      className="flex cursor-pointer items-center gap-2"
      onSelect={() => onPick(option)}
    >
      <span
        className="h-4 w-4 shrink-0 rounded-full border border-border"
        style={themeSwatchStyle(option.color)}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{option.name}</span>
      {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
    </DropdownMenuItem>
  );
}

export function HeaderAppearanceMenu({ className }: { className?: string }) {
  const { theme, setTheme, setPrimaryColor } = useTheme();

  const pickTheme = (option: AppThemeOption) => {
    setTheme(option.themeValue as Parameters<typeof setTheme>[0]);
    setPrimaryColor(option.primaryValue as Parameters<typeof setPrimaryColor>[0]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn("h-9 w-9 flex-shrink-0", className)}
          title="Appearance"
          aria-label="Appearance"
        >
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Background Theme</DropdownMenuLabel>
        {APP_THEME_OPTIONS.map((option) => (
          <ThemeRow
            key={option.themeValue}
            option={option}
            active={theme === option.themeValue}
            onPick={pickTheme}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
