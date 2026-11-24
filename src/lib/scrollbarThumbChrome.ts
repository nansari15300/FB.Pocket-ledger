/**
 * Native scrollbar thumb ka colour — **app ke saare themes** ka same look, jo Pocket Ledger
 * Server (sub server, dark admin UI) ke scrollbar se match karta hai.
 *
 * Server reference: https://0.0.0.0:8090 — dark slate track par light ash thumb; hover par
 * wahi thumb thoda roshan ("out"). App me purple / server-admin UI light hone par bhi thumb
 * wahi rehta hai, isliye yahan light thumb + halka dark edge + soft shadow hai — white bg par
 * bhi saaf dikhta hai, dark par bhi.
 *
 * `globals.css` me kai purane per-area rules `::-webkit-scrollbar-thumb` par `!important`
 * (black / slate / footer-blue) lagate hain, isliye ek hi runtime stylesheet body ke end me
 * inject karte hain — source order me wo sab ke baad aati hai aur same pseudo target karti hai.
 *
 * Touch devices par app pehle se apna thin custom bar dikhata hai, isliye custom rules sirf
 * `(hover: hover) and (pointer: fine)` par — `html` par `pl-sb-desktop` class (media query se)
 * lagti hai aur wo class hi rules ko scope karti hai (`html.pl-sb-desktop body …`).
 */
const STYLE_ID = "pl-scrollbar-thumb-chrome";

/** Media-gated class `html` par (`ensureScrollbarThumbChrome` lagata hai). */
const SCOPE = "html.pl-sb-desktop body";

/** Server dark admin ka thumb tone — light ash (thoda translucent, track ke saath blend). */
const THUMB_NORMAL = "rgba(203, 213, 225, 0.9)";
/** Hover / drag: wahi ash, thoda roshan + "out" shadow. */
const THUMB_HOVER = "rgba(241, 245, 249, 1)";
/** White surface par bhi dikhe: halka slate edge + soft drop shadow (server jaisa subtle). */
const RING_NORMAL =
  "inset 0 0 0 1px rgba(100, 116, 139, 0.4), 0 1px 2px rgba(15, 23, 42, 0.25)";
const RING_HOVER =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.95), 0 0 0 1px rgba(100, 116, 139, 0.55), 0 2px 6px rgba(15, 23, 42, 0.3)";

const RULES = `
${SCOPE} ::-webkit-scrollbar {
  background-color: transparent !important;
}
${SCOPE} ::-webkit-scrollbar-track,
${SCOPE} ::-webkit-scrollbar-corner {
  background-color: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
}
${SCOPE} ::-webkit-scrollbar-button {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
${SCOPE} ::-webkit-scrollbar-thumb {
  background-color: ${THUMB_NORMAL} !important;
  background-image: none !important;
  border: 0 !important;
  border-radius: 9999px !important;
  box-shadow: ${RING_NORMAL} !important;
  min-height: 40px !important;
}
/* Drag ke waqt bhi hover state hi lagti hai — dono par same "out" look. */
${SCOPE} ::-webkit-scrollbar-thumb:hover,
${SCOPE} ::-webkit-scrollbar-thumb:active {
  background-color: ${THUMB_HOVER} !important;
  box-shadow: ${RING_HOVER} !important;
}
/* Firefox (standard props, pseudo rules nahi). Specificity badhaye taaki globals.css ka
   html-body-star wala black scrollbar-color rule isse na jeete. */
html.pl-sb-desktop *,
${SCOPE} *,
${SCOPE} [data-pl-native-scroll],
${SCOPE} [data-pl-native-scroll]:hover {
  scrollbar-color: ${THUMB_NORMAL} transparent !important;
}

/* ---- Bada (right-side) page = DOUBLE width bar --------------------------------
   Lists / inner scrollers par patla bar hi rehta hai. Sirf page-level scroller
   (dashboard main, jo AppHeader ke niche ka overflow-y-auto hai) aur report detail
   pane (data-pl-report-detail-root, Reports page ka right side) ke andar ke page-level
   report scrollers ka bar 2x (16px) hai. Backtick yahan comment me mat likho —
   ye poora block ek JS template literal hai. */
html.pl-sb-desktop body main::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-report-detail-root]::-webkit-scrollbar {
  width: 16px !important;
  height: 16px !important;
}

/* 2) Report detail ke andar ke page-level scrollers bhi 2x: Balance Sheet ka frame,
   party statement ki txn page, ledger txn scroll host, aur dual-column reports ke
   apne column scrollers.
   Left master list (data-pl-master-list-chrome / pl-master-list-scroll /
   data-pl-native-scroll) yahan exclude hai — wo patla hi rehta hai.
   NOTE: globals.css ka html-body-star rule scrollbar-width thin lagata hai, aur Chromium
   thin mode me custom width ignore karta hai — isliye selectors desktop par already
   scrollbar-width auto wale targets (main, report panes) tk hi scoped hain. */
html.pl-sb-desktop body [data-pl-report-detail-root] [data-pl-balance-sheet-frame]::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-report-detail-root] [data-pl-ledger-txn-page]::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-report-detail-root] .pl-ledger-txn-scroll-host::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-report-detail-root] .pl-ledger-txn-scroll-native::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-detail-pane] .pl-ledger-txn-scroll-native::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-report-detail-root] [data-master-detail-layout] [data-pl-detail-pane] .scrollbar-slim-dim:not(.pl-master-list-scroll):not([data-pl-native-scroll])::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-report-detail-root] .flex-1.overflow-y-auto.min-h-0::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-detail-pane] .pl-master-list-scroll::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-detail-pane] [data-pl-native-scroll]::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-report-detail-scroll]::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-report-register-trxn]::-webkit-scrollbar,
html.pl-sb-desktop body [data-pl-balance-sheet-frame]::-webkit-scrollbar {
  width: 16px !important;
  height: 16px !important;
}
html.pl-sb-desktop body [data-pl-report-detail-root] [data-pl-balance-sheet-frame]::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-report-detail-root] [data-pl-ledger-txn-page]::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-report-detail-root] .pl-ledger-txn-scroll-host::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-report-detail-root] .pl-ledger-txn-scroll-native::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-detail-pane] .pl-ledger-txn-scroll-native::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-report-detail-root] [data-master-detail-layout] [data-pl-detail-pane] .scrollbar-slim-dim:not(.pl-master-list-scroll):not([data-pl-native-scroll])::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-report-detail-root] .flex-1.overflow-y-auto.min-h-0::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-detail-pane] .pl-master-list-scroll::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-detail-pane] [data-pl-native-scroll]::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-report-detail-scroll]::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-report-register-trxn]::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-balance-sheet-frame]::-webkit-scrollbar-thumb {
  border-radius: 9999px !important;
  box-shadow: ${RING_NORMAL} !important;
  min-height: 40px !important;
}

html.pl-sb-desktop body main::-webkit-scrollbar-thumb,
html.pl-sb-desktop body [data-pl-report-detail-root]::-webkit-scrollbar-thumb {
  border-radius: 9999px !important;
  box-shadow: ${RING_NORMAL} !important;
  min-height: 40px !important;
}
/* Standard prop (Chromium + Firefox dono isi par jaate hain): sirf bade panes par. */
html.pl-sb-desktop body main,
html.pl-sb-desktop body [data-pl-report-detail-root],
html.pl-sb-desktop body [data-pl-balance-sheet-frame],
html.pl-sb-desktop body [data-pl-report-register-trxn] {
  scrollbar-width: auto !important;
}
html.pl-sb-desktop body [data-pl-report-detail-root] [data-pl-balance-sheet-frame],
html.pl-sb-desktop body [data-pl-report-detail-root] [data-pl-ledger-txn-page],
html.pl-sb-desktop body [data-pl-report-detail-root] .pl-ledger-txn-scroll-host,
html.pl-sb-desktop body [data-pl-report-detail-root] .pl-ledger-txn-scroll-native,
html.pl-sb-desktop body [data-pl-detail-pane] .pl-ledger-txn-scroll-native,
html.pl-sb-desktop body [data-pl-report-detail-root] .flex-1.overflow-y-auto.min-h-0,
html.pl-sb-desktop body [data-pl-report-detail-scroll],
html.pl-sb-desktop body [data-pl-detail-pane] .pl-master-list-scroll,
html.pl-sb-desktop body [data-pl-detail-pane] [data-pl-native-scroll] {
  scrollbar-width: auto !important;
}
`;

const DESKTOP_CLASS = "pl-sb-desktop";
const DESKTOP_MQ = "(hover: hover) and (pointer: fine)";

function applyDesktopClass() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (window.matchMedia?.(DESKTOP_MQ)?.matches) root.classList.add(DESKTOP_CLASS);
  else root.classList.remove(DESKTOP_CLASS);
}

/** Ek baar inject; idempotent (route change / theme switch par dobara call safe). */
export function ensureScrollbarThumbChrome(): void {
  if (typeof document === "undefined") return;
  applyDesktopClass();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = RULES;
  (document.body ?? document.head).appendChild(style);
}
