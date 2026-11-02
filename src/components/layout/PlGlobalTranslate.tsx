"use client";

import { useEffect, useRef, useState } from "react";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { looksEnglishSource, peekCachedTranslation, translateEnglishStrings } from "@/lib/i18n/gtxTranslate";

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "CODE",
  "PRE",
  "SVG",
  "MATH",
  "KBD",
  "SAMP",
]);
const SKIP_ATTR_SEL =
  "[data-pl-lang-dialog],[data-pl-lang-chrome],[data-pl-no-translate],input,textarea,select,[contenteditable=true]";
/** Tabs, table headers, buttons = UI language. Intro sirf [data-pl-intro] help sentences. */
const UI_CHROME_SEL =
  "button, a, [role='tab'], [role='columnheader'], [role='menuitem'], th, thead, nav, [data-sidebar], label";
const ATTRS = ["placeholder", "title", "aria-label"] as const;
const NUMBERISH = /^[\d.,₹$€£¥%\s+\-:/()]+$/;
const EMAILISH = /@/;
const URLISH = /https?:\/\//i;
const CR_DR_ONLY = /^(Cr|Dr)$/i;
const VOUCHER_CODE = /^[A-Z]{2,5}[-/][\w./-]+$/;
const SCROLL_HOST_SEL = [
  "[data-pl-ledger-txn-unified-scroll]",
  "[data-pl-daybook-unified-scroll]",
  "[data-pl-ledger-txn-hscroll]",
  ".pl-ledger-txn-scroll-host",
  ".pl-ledger-header-ribbon-wrap",
  ".pl-ledger-header-card",
  ".pl-master-list-scroll",
  "[data-pl-master-list-chrome]",
].join(",");

const originalText = new WeakMap<Text, string>();
const appliedText = new WeakMap<Text, string>();
const originalAttr = new WeakMap<Element, Partial<Record<(typeof ATTRS)[number], string>>>();
const appliedAttr = new WeakMap<Element, Partial<Record<(typeof ATTRS)[number], string>>>();

type ScrollSnap = { el: HTMLElement; left: number; top: number };
type PatchResult = { wrote: boolean; needFull: boolean };

function shouldSkipElement(el: Element | null): boolean {
  if (!el) return true;
  if (el.closest(SKIP_ATTR_SEL)) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  return false;
}

const INFO_ICON_SEL =
  "[data-pl-fresh-info],[data-pl-footer-fresh-info],[data-pl-header-preview-info]";

function isIntroNode(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest(INFO_ICON_SEL)) return true;
  if (el.closest("[data-pl-intro]")) {
    if (el.closest(UI_CHROME_SEL)) return false;
    return true;
  }
  return false;
}

function skipTextValue(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length < 2) return true;
  if (CR_DR_ONLY.test(t)) return true;
  if (NUMBERISH.test(t)) return true;
  if (VOUCHER_CODE.test(t)) return true;
  if (EMAILISH.test(t)) return true;
  if (URLISH.test(t)) return true;
  return false;
}

function langFor(el: Element | null, ui: string, intro: string) {
  return isIntroNode(el) ? intro : ui;
}

function snapshotScroll(): ScrollSnap[] {
  const out: ScrollSnap[] = [];
  const seen = new Set<HTMLElement>();
  const add = (el: HTMLElement | null | undefined) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    if (el.scrollLeft === 0 && el.scrollTop === 0) {
      if (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1) return;
    }
    out.push({ el, left: el.scrollLeft, top: el.scrollTop });
  };
  document.querySelectorAll(SCROLL_HOST_SEL).forEach((n) => add(n as HTMLElement));
  add(document.scrollingElement as HTMLElement | null);
  add(document.documentElement);
  add(document.body);
  return out;
}

function restoreScroll(snaps: ScrollSnap[]) {
  snaps.forEach(({ el, left, top }) => {
    if (left > 0 && el.scrollLeft !== left) {
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      el.scrollLeft = Math.min(left, max);
    }
    if (top > 0 && el.scrollTop !== top) {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(top, max);
    }
  });
}

function instantPatchText(node: Text, ui: string, intro: string): PatchResult {
  const parent = node.parentElement;
  if (shouldSkipElement(parent)) return { wrote: false, needFull: false };
  const current = node.nodeValue ?? "";
  const orig = originalText.get(node);
  const applied = appliedText.get(node);
  const lang = langFor(parent, ui, intro);

  if (applied != null && orig != null) {
    if (current === applied) return { wrote: false, needFull: false };
    if (current === orig) {
      if (current === applied) return { wrote: false, needFull: false };
      node.nodeValue = applied;
      return { wrote: true, needFull: false };
    }
    if (!looksEnglishSource(current)) {
      node.nodeValue = applied;
      return { wrote: true, needFull: false };
    }
    originalText.set(node, current);
    if (skipTextValue(current) || lang === "en") {
      appliedText.set(node, current);
      return { wrote: false, needFull: false };
    }
    const hit = peekCachedTranslation(current, lang);
    if (hit != null) {
      if (node.nodeValue !== hit) node.nodeValue = hit;
      appliedText.set(node, hit);
      return { wrote: hit !== current, needFull: false };
    }
    return { wrote: false, needFull: true };
  }

  if (!looksEnglishSource(current) || skipTextValue(current)) return { wrote: false, needFull: false };
  originalText.set(node, current);
  if (lang === "en") {
    appliedText.set(node, current);
    return { wrote: false, needFull: false };
  }
  const hit = peekCachedTranslation(current, lang);
  if (hit != null) {
    if (node.nodeValue !== hit) node.nodeValue = hit;
    appliedText.set(node, hit);
    return { wrote: hit !== current, needFull: false };
  }
  return { wrote: false, needFull: true };
}

function instantPatchAttr(el: Element, ui: string, intro: string): PatchResult {
  if (shouldSkipElement(el)) return { wrote: false, needFull: false };
  let wrote = false;
  let needFull = false;
  const lang = langFor(el, ui, intro);
  const bag = originalAttr.get(el) ?? {};
  const applied = appliedAttr.get(el) ?? {};
  ATTRS.forEach((attr) => {
    if (!el.hasAttribute(attr)) return;
    const current = el.getAttribute(attr) || "";
    const orig = bag[attr];
    const prev = applied[attr];
    if (prev != null && orig != null) {
      if (current === prev) return;
      if (current === orig || !looksEnglishSource(current)) {
        if (current !== prev) {
          el.setAttribute(attr, prev);
          wrote = true;
        }
        return;
      }
      bag[attr] = current;
      originalAttr.set(el, bag);
      if (skipTextValue(current) || lang === "en") {
        applied[attr] = current;
        appliedAttr.set(el, applied);
        return;
      }
      const hit = peekCachedTranslation(current, lang);
      if (hit != null) {
        if (current !== hit) {
          el.setAttribute(attr, hit);
          wrote = true;
        }
        applied[attr] = hit;
        appliedAttr.set(el, applied);
        return;
      }
      needFull = true;
      return;
    }
    if (!looksEnglishSource(current) || skipTextValue(current)) return;
    bag[attr] = current;
    originalAttr.set(el, bag);
    if (lang === "en") {
      applied[attr] = current;
      appliedAttr.set(el, applied);
      return;
    }
    const hit = peekCachedTranslation(current, lang);
    if (hit != null) {
      if (current !== hit) {
        el.setAttribute(attr, hit);
        wrote = true;
      }
      applied[attr] = hit;
      appliedAttr.set(el, applied);
      return;
    }
    needFull = true;
  });
  return { wrote, needFull };
}

function walkAdded(root: Node, ui: string, intro: string): PatchResult {
  let wrote = false;
  let needFull = false;
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const r = instantPatchText(node as Text, ui, intro);
      if (r.wrote) wrote = true;
      if (r.needFull) needFull = true;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (shouldSkipElement(el)) return;
    const ar = instantPatchAttr(el, ui, intro);
    if (ar.wrote) wrote = true;
    if (ar.needFull) needFull = true;
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) visit(kids[i]);
  };
  visit(root);
  return { wrote, needFull };
}

function collect(root: ParentNode, ui: string, intro: string) {
  const uiNeed = new Set<string>();
  const introNeed = new Set<string>();
  const textNodes: Text[] = [];
  const attrNodes: { el: Element; attr: (typeof ATTRS)[number]; intro: boolean }[] = [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const node = n as Text;
    const parent = node.parentElement;
    if (shouldSkipElement(parent)) continue;
    const current = node.nodeValue ?? "";
    const prevOrig = originalText.get(node);
    const prevApplied = appliedText.get(node);
    let raw = prevOrig ?? current;
    if (prevOrig == null || (current !== prevOrig && current !== prevApplied)) {
      if (looksEnglishSource(current)) raw = current;
      else if (prevOrig) raw = prevOrig;
      else continue;
    }
    if (!looksEnglishSource(raw)) {
      originalText.delete(node);
      appliedText.delete(node);
      continue;
    }
    originalText.set(node, raw);
    if (skipTextValue(raw)) {
      if (node.nodeValue !== raw) node.nodeValue = raw;
      continue;
    }
    textNodes.push(node);
    (isIntroNode(parent) ? introNeed : uiNeed).add(raw);
  }

  root.querySelectorAll("*").forEach((el) => {
    if (shouldSkipElement(el)) return;
    const introish = isIntroNode(el);
    ATTRS.forEach((attr) => {
      if (!el.hasAttribute(attr)) return;
      const bag = originalAttr.get(el) ?? {};
      const applied = appliedAttr.get(el) ?? {};
      const current = el.getAttribute(attr) || "";
      if (bag[attr] == null || (current !== bag[attr] && current !== applied[attr])) {
        bag[attr] = current;
      }
      originalAttr.set(el, bag);
      const raw = bag[attr] || "";
      if (skipTextValue(raw)) return;
      attrNodes.push({ el, attr, intro: introish });
      (introish ? introNeed : uiNeed).add(raw);
    });
  });

  return { uiNeed, introNeed, textNodes, attrNodes, ui, intro };
}

export function PlGlobalTranslate() {
  const i18n = usePlI18nOptional();
  const timer = useRef<number | null>(null);
  const applying = useRef(false);
  const runId = useRef(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!i18n) return;
    const { ui, intro } = i18n;

    const run = async () => {
      const my = ++runId.current;
      if (ui === "en" && intro === "en") {
        applying.current = true;
        const snaps = snapshotScroll();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n: Node | null;
        while ((n = walker.nextNode())) {
          const node = n as Text;
          const orig = originalText.get(node);
          if (orig != null && node.nodeValue !== orig) node.nodeValue = orig;
        }
        document.body.querySelectorAll("*").forEach((el) => {
          const bag = originalAttr.get(el);
          if (!bag) return;
          ATTRS.forEach((attr) => {
            if (bag[attr] != null) el.setAttribute(attr, bag[attr]!);
          });
        });
        restoreScroll(snaps);
        applying.current = false;
        setBusy(false);
        return;
      }

      const snap = collect(document.body, ui, intro);
      if (my !== runId.current) return;
      const missingUi = [...snap.uiNeed].filter((t) => ui !== "en" && peekCachedTranslation(t, ui) == null);
      const missingIntro =
        intro !== "en" && intro !== ui
          ? [...snap.introNeed].filter((t) => peekCachedTranslation(t, intro) == null)
          : [];
      const fetching = missingUi.length > 0 || missingIntro.length > 0;
      if (fetching) setBusy(true);
      const [uiMap, introMap] = await Promise.all([
        translateEnglishStrings([...snap.uiNeed], ui),
        intro === ui
          ? Promise.resolve(null)
          : translateEnglishStrings([...snap.introNeed], intro),
      ]);
      if (my !== runId.current) return;
      const pick = (text: string, introish: boolean) => {
        if (introish) {
          if (intro === "en") return text;
          if (introMap) return introMap.get(text) ?? text;
        }
        if (ui === "en") return text;
        return uiMap.get(text) ?? text;
      };
      applying.current = true;
      const scrolls = snapshotScroll();
      snap.textNodes.forEach((node) => {
        const orig = originalText.get(node);
        if (orig == null) return;
        const next = pick(orig, isIntroNode(node.parentElement));
        if (node.nodeValue !== next) node.nodeValue = next;
        appliedText.set(node, next);
      });
      snap.attrNodes.forEach(({ el, attr, intro: introish }) => {
        const bag = originalAttr.get(el);
        const orig = bag?.[attr];
        if (orig == null) return;
        const next = pick(orig, introish);
        if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
        const applied = appliedAttr.get(el) ?? {};
        applied[attr] = next;
        appliedAttr.set(el, applied);
      });
      restoreScroll(scrolls);
      requestAnimationFrame(() => restoreScroll(scrolls));
      applying.current = false;
      if (fetching) setBusy(false);
    };

    const schedule = () => {
      if (applying.current) return;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void run();
      }, 280);
    };

    const onMutations = (records: MutationRecord[]) => {
      if (applying.current) return;
      if (ui === "en" && intro === "en") return;
      applying.current = true;
      const scrolls = snapshotScroll();
      let wrote = false;
      let needFull = false;
      try {
        for (let i = 0; i < records.length; i++) {
          const rec = records[i];
          if (rec.type === "characterData") {
            if (rec.target.nodeType !== Node.TEXT_NODE) continue;
            const r = instantPatchText(rec.target as Text, ui, intro);
            if (r.wrote) wrote = true;
            if (r.needFull) needFull = true;
          } else if (rec.type === "attributes" && rec.target.nodeType === Node.ELEMENT_NODE) {
            const r = instantPatchAttr(rec.target as Element, ui, intro);
            if (r.wrote) wrote = true;
            if (r.needFull) needFull = true;
          } else if (rec.type === "childList") {
            rec.addedNodes.forEach((node) => {
              const r = walkAdded(node, ui, intro);
              if (r.wrote) wrote = true;
              if (r.needFull) needFull = true;
            });
          }
        }
      } finally {
        if (wrote) {
          restoreScroll(scrolls);
          requestAnimationFrame(() => restoreScroll(scrolls));
        }
        applying.current = false;
      }
      if (needFull) schedule();
    };

    schedule();
    const obs = new MutationObserver(onMutations);
    obs.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"],
    });
    return () => {
      obs.disconnect();
      if (timer.current) window.clearTimeout(timer.current);
      runId.current += 1;
    };
  }, [i18n?.ui, i18n?.intro]);

  if (!busy || !i18n) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-md border bg-background/95 px-3 py-1.5 text-xs shadow-md"
      translate="no"
      data-pl-no-translate=""
    >
      {i18n.tUi("translating")}
    </div>
  );
}
