"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyPlLangToDocument,
  PL_LANGUAGES,
  readPlLangs,
  writePlLangs,
  type PlLangs,
} from "@/lib/i18n/plLangStorage";
import {
  chromeText,
  ensureChromeTable,
  type ChromeKey,
} from "@/lib/i18n/chromeStrings";
import { ensureServerLangLookup } from "@/lib/i18n/serverLangLookup";

type PlI18nValue = {
  ui: string;
  intro: string;
  dialogOpen: boolean;
  openLanguageDialog: () => void;
  closeLanguageDialog: () => void;
  saveLangs: (ui: string, intro: string) => void;
  tUi: (key: ChromeKey) => string;
  tIntro: (key: ChromeKey) => string;
  langs: typeof PL_LANGUAGES;
};

const PlI18nContext = createContext<PlI18nValue | null>(null);

export function PlI18nProvider({ children }: { children: ReactNode }) {
  const [langs, setLangs] = useState<PlLangs>({ ui: "en", intro: "en" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [chromeTick, setChromeTick] = useState(0);

  useEffect(() => {
    const next = readPlLangs();
    setLangs(next);
    applyPlLangToDocument(next.ui);
    void Promise.all([
      ensureChromeTable(next.ui),
      ensureChromeTable(next.intro),
      ensureServerLangLookup(next.ui),
      ensureServerLangLookup(next.intro),
    ]).then(() => {
      setChromeTick((n) => n + 1);
    });
  }, []);

  const saveLangs = useCallback((ui: string, intro: string) => {
    const next = writePlLangs(ui, intro);
    setLangs(next);
    setDialogOpen(false);
    void Promise.all([
      ensureChromeTable(next.ui),
      ensureChromeTable(next.intro),
      ensureServerLangLookup(next.ui),
      ensureServerLangLookup(next.intro),
    ]).then(() => {
      setChromeTick((n) => n + 1);
    });
  }, []);

  const value = useMemo<PlI18nValue>(() => {
    void chromeTick;
    return {
      ui: langs.ui,
      intro: langs.intro,
      dialogOpen,
      openLanguageDialog: () => setDialogOpen(true),
      closeLanguageDialog: () => setDialogOpen(false),
      saveLangs,
      tUi: (key) => chromeText(langs.ui, key),
      tIntro: (key) => chromeText(langs.intro, key),
      langs: PL_LANGUAGES,
    };
  }, [langs, dialogOpen, saveLangs, chromeTick]);

  return (
    <PlI18nContext.Provider value={value}>{children}</PlI18nContext.Provider>
  );
}

export function usePlI18n() {
  const ctx = useContext(PlI18nContext);
  if (!ctx) throw new Error("usePlI18n must be used inside PlI18nProvider");
  return ctx;
}

export function usePlI18nOptional() {
  return useContext(PlI18nContext);
}
