"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { PL_LANGUAGES } from "@/lib/i18n/plLangStorage";
import { cn } from "@/lib/utils";

function LanguageCombo({
  id,
  label,
  value,
  uiLang,
  placeholder,
  empty,
  onPick,
}: {
  id: string;
  label: string;
  value: string;
  uiLang: string;
  placeholder: string;
  empty: string;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = PL_LANGUAGES.label(value, uiLang);
  const display = typed ? query : selectedLabel;

  const items = useMemo(() => {
    return PL_LANGUAGES.list.map(([code, native, english]) => ({
      code,
      label: PL_LANGUAGES.label(code, uiLang),
      keys: `${code} ${native} ${english} ${PL_LANGUAGES.name(code, uiLang)}`.toLowerCase(),
    }));
  }, [uiLang]);

  const filtered = useMemo(() => {
    const needle = typed ? query.trim().toLowerCase() : "";
    if (!needle) return items;
    return items.filter((it) => it.keys.includes(needle) || it.label.toLowerCase().includes(needle));
  }, [items, typed, query]);

  useEffect(() => {
    if (!typed) setQuery(selectedLabel);
  }, [selectedLabel, typed]);

  useEffect(() => {
    const onPtr = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setTyped(false);
        setQuery(selectedLabel);
      }
    };
    document.addEventListener("pointerdown", onPtr, true);
    return () => document.removeEventListener("pointerdown", onPtr, true);
  }, [selectedLabel]);

  return (
    <div className="space-y-1.5" translate="no">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div ref={rootRef} className="relative">
        <input
          id={id}
          ref={inputRef}
          className="pl-lang-combo-input"
          value={display}
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          role="combobox"
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.select());
          }}
          onChange={(e) => {
            setTyped(true);
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              setTyped(false);
              setQuery(selectedLabel);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const first = filtered[0];
              if (first) {
                onPick(first.code);
                setTyped(false);
                setOpen(false);
              }
            }
          }}
        />
        {open ? (
          <ul className="pl-lang-combo-list" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-2 py-2 text-sm text-muted-foreground">{empty}</li>
            ) : (
              filtered.map((it) => (
                <li key={it.code}>
                  <button
                    type="button"
                    className={cn("pl-lang-combo-option", it.code === value && "is-active")}
                    role="option"
                    aria-selected={it.code === value}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onPick(it.code);
                      setTyped(false);
                      setOpen(false);
                    }}
                  >
                    {it.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function LanguageDialog() {
  const i18n = usePlI18nOptional();
  const [draftUi, setDraftUi] = useState("en");
  const [draftIntro, setDraftIntro] = useState("en");

  useEffect(() => {
    if (!i18n?.dialogOpen) return;
    setDraftUi(i18n.ui);
    setDraftIntro(i18n.intro);
  }, [i18n?.dialogOpen, i18n?.ui, i18n?.intro]);

  if (!i18n) return null;

  const dirty = draftUi !== i18n.ui || draftIntro !== i18n.intro;

  const close = () => {
    setDraftUi(i18n.ui);
    setDraftIntro(i18n.intro);
    i18n.closeLanguageDialog();
  };

  return (
    <Dialog
      open={i18n.dialogOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        hideCloseButton
        className="pl-lang-dialog max-w-[min(26rem,calc(100vw-1.5rem))] gap-3 overflow-visible p-4"
        translate="no"
        data-pl-lang-dialog=""
        aria-describedby="pl-lang-help"
      >
        <DialogHeader className="space-y-2 text-left">
          <div className="flex items-center gap-2 pr-8">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted/40">
              <Globe className="h-4 w-4" />
            </span>
            <DialogTitle className="text-base">{i18n.tUi("s_language")}</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 h-8 w-8"
              aria-label={i18n.tUi("close")}
              title={i18n.tUi("close")}
              onClick={close}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <DialogDescription id="pl-lang-help" className="text-sm" data-pl-intro="">
            {i18n.tIntro("lang_help")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <LanguageCombo
            id="pl-ui-lang"
            label={i18n.tUi("ui_lang")}
            value={draftUi}
            uiLang={draftUi}
            placeholder={i18n.tUi("search_lang")}
            empty={i18n.tUi("combo_no_match")}
            onPick={setDraftUi}
          />
          <LanguageCombo
            id="pl-intro-lang"
            label={i18n.tUi("intro_lang")}
            value={draftIntro}
            uiLang={draftUi}
            placeholder={i18n.tUi("search_lang")}
            empty={i18n.tUi("combo_no_match")}
            onPick={setDraftIntro}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={close}>
            {i18n.tUi("dlg_cancel")}
          </Button>
          <Button
            type="button"
            disabled={!dirty}
            onClick={() => i18n.saveLangs(draftUi, draftIntro)}
          >
            {i18n.tUi("btn_save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
