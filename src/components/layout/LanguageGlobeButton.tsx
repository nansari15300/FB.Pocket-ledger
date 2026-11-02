"use client";

import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { cn } from "@/lib/utils";

export function LanguageGlobeButton({ className }: { className?: string }) {
  const i18n = usePlI18nOptional();
  if (!i18n) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn("h-9 w-9 flex-shrink-0", className)}
      title={i18n.tUi("s_language")}
      aria-label={i18n.tUi("s_language")}
      aria-expanded={i18n.dialogOpen}
      data-pl-lang-btn=""
      data-pl-no-translate=""
      translate="no"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.setTimeout(() => i18n.openLanguageDialog(), 0);
      }}
    >
      <Globe className="h-4 w-4" />
    </Button>
  );
}

export function AuthLangChrome() {
  return (
    <div className="fixed right-3 top-3 z-50" data-pl-lang-chrome="" translate="no">
      <LanguageGlobeButton />
    </div>
  );
}
