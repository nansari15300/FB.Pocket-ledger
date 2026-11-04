# Theme Master — Handoff (Pocket Ledger / Touri + React)

> आखिरी अपडेट: 1 Nov 2026, 6:35 PM (Asia/Kathmandu, UTC+5:45)
> Project: `C:\Project xxx\Refference apps\Touri + React`
> यह file दूसरे bot/agent के लिए है ताकि वह यहीं से काम आगे बढ़ा सके।

---

## 1. काम / Role
- Theme Master = Pocket Ledger की **themes, theme colours, card style, scrollbars और dashboard spacing** का owner।
- App logic (data, calculations, Firebase, sync, routing) **नहीं** छूता। सिर्फ look & feel।
- जहाँ CSS से काम न हो, वहाँ सिर्फ **minimal tsx बदलाव** (data attribute / class) — logic नहीं।

## 2. नियम (Rules)
1. हर बदलाव से **पहले backup**: `C:\Project xxx\backup-theme-<YYYYMMDD>-<HHmm>\` (नया folder, relative path same रखें, जैसे `src\app\globals.css`)।
2. **No git** commit / push / stash / checkout — sync **Git Master** करता है।
3. `electron\` और `src-tauri\` को मत छुएँ — owner **Tauri Master**।
4. `globals.css` का **table-layout region** edit मत करें — owner **Trxn Table Master**। Region content से खोजें:
   `[data-pl-ledger-txn-unified-scroll].pl-ledger-txn-scroll-host {` से लेकर
   `[data-pl-ledger-txn-unified-scroll] [data-theme-table="transactions"] tbody tr.transaction-main-row > td {…}` rule के अंत तक।
   हर write के बाद इसे `backup-theme-20261101-1612\src\app\globals.css` से **byte-identical** verify करें।
5. **Firebase code नहीं** — Firebase removal **Firebase Master** का काम है।
6. CSS सिर्फ `globals.css` के अंत वाले **Theme Master block** में जोड़ें (`=== Theme Master: ...` से `/* === end Theme Master === */` तक)। नया section END marker से ठीक पहले।
7. हर write से पहले file **fresh पढ़ें** (दूसरे agents भी काम कर रहे हैं)।
8. Encoding: **UTF-8 बिना BOM**; line endings वैसी ही रखें — `globals.css` = **CRLF**; हर tsx की अपनी (जैसे `DashboardPageContentImpl.tsx` = LF)।
9. Verify: `postcss.parse` (globals.css) और tsx बदला हो तो `tsc --noEmit`:
   - `& 'C:\Program Files\nodejs\node.exe' 'node_modules\typescript\bin\tsc' --noEmit -p .`
   - postcss: `require(process.cwd()+'/node_modules/postcss')` (project dir से चलाएँ)।
10. No `npm install`, dev server start/stop नहीं। कोई externally visible action नहीं।
11. `_handoff\NIYAM.md` दूसरे agent का है — edit नहीं।

## 3. User के फैसले (अब तक)
- **7 themes, एक ही list**: Green / Blue / Pink / Light / Medium / Gray / Dark।
- हटाए गए: Pro, Light (pure-white), Colorfull, Dim Soft Green, Sky Blue, Soft Yellow (CSS classes अभी भी हैं ताकि पुराने users टूटें नहीं; list में नहीं दिखते)।
- **Default + migration = Server Gray** (`theme-pl-gray`), `THEME_DEFAULT_REV = "4"` (`src\lib\proTheme.ts:51`)।
- Server जैसा look: **borderless raised cards** (soft shadow, कोई hard border/ribbon/gradient नहीं)।
- कोई dedicated/hard-coded colours नहीं — सब **theme variables** से (`--card`, `--foreground`, `--primary`, `--pl-pill-bg`, `--pl-raise-shadow` आदि)।
- Scrollbars: desktop (mouse) पर **native OS**; touch पर **3px dim**।
- Dashboard: card gap **16px**; ऊपर / बाएँ-दाएँ / footer से पहले भी **16px**।
- Ledger: हर transaction (main row + narration) = **एक card**, cards के बीच **8px gap**, कोई divider line नहीं, कोई corner curve line नहीं।
- Colour themes (Green / Blue / Pink) **साफ़ दिखने वाला tint** रखें।
- Dashboard footer: theme surface, tabs = neutral pills, active = accent fill + सफ़ेद text, hover = lift।
- Header company name pill = theme primary text; sidebar "Company" link = secondary text (active हो तो accent)।
- App sidebar: हर section (brand, nav, Account, profile) अलग raised card; **हर card के चारों तरफ 4px** ("one side 4px mean 4x4 gap") — window के top/left/bottom से, cards के बीच और sidebar↔main column के बीच 4px (collapsed 64px में भी 4px)। पहले 16px था, 6:27 PM पर 4px किया।
- Ledger header text/चौड़ाई (14a) — **handed to Trxn Table Master** (6:33 PM)।
- Ledger kebab 4px (14b) — **handed to Trxn Table Master**।
- Account list row cards + 8px gap (14c) — **handed to Poject intity Master**।
- Account lists के blue lines (14d) — **handed to Poject intity Master**।
- App header: **हर pill / company area के चारों तरफ 4px** — pills के बीच, rows के बीच, header card के किनारों से 4px; outer `<header>` top/right/bottom 4px और sidebar↔header 4px (desktop पर header का left padding 0, sidebar का 4px right padding ही gap)। outer header का border-b line रखा।

## 4. बदली गई files (sections / lines)
### `src\app\globals.css` — Theme Master block (लगभग line 13966 → 14931, CRLF)
| Section | Line (approx) | क्या |
|---|---|---|
| 1 | 13974 | Server themes Light / Gray / Medium / Dark tokens |
| 2 | 14109 | Soft themes: card page से थोड़ा हल्का |
| 3 | 14117 | Cards = server `.card` (14px radius, shadow) |
| 4 / 4b | 14138 / 14183 | Scrollbars (touch 3px dim) / desktop native |
| 5 | 14159 | Dashboard 16px gap + 16px left/right |
| 6a–6g | 14237–14456 | Borderless raised UI: tokens, cards, pills/tabs, company selector cards, list rows, txn tables, semantic colours |
| 7a–7d | 14457–14551 | Medium/Dark server clean-up |
| 8a–8d | 14552–14611 | Leftover hard-coded blue हटाया |
| 9 / 9b | 14612 / 14656 | Green/Blue/Pink tint + ledger txn = one card |
| 10 | 14702 | Ledger row divider lines हटाईं |
| 11 | 14722 | Ledger 8px gap, seamless card, corner curve हटाया |
| 12 | 14753–14816 | Dashboard footer theme, edge spacing 16px, header company pill, sidebar Company link |
| 13 | 14817–14848 | App sidebar **4px** (`--pl-sb-gap`/`--pl-sb-pad-x` 4px line 14823, collapsed `.w-16` 4px line 14828, nav scroller margin -4px/padding 4px 14838–14839), sidebar cards = raised 14px radius, main column border-left transparent |
| 14a | 14850–14860 | Ledger header: thead/tr bg transparent (पुराना line ~7793 `thead tr` muted bg 8px inset से बाहर दिखता था), header text foreground, filter icon muted  — **handed to Trxn Table Master** (applied, left in place) |
| 14b | 14861–14881 | Kebab 4px/4px: 12px menu td `overflow:visible` (protected region के `overflow:hidden` को override — region edit नहीं), button absolute right 0 + vertical center, glyph right 4px/width 4px, balance td padding-right 8px; dashboard recent-shell (24px column) excluded  — **handed to Trxn Table Master** (applied, left in place) |
| 14c | 14882–14895 | Account list `.pl-master-list-ul` gap 8px + padding 8px (admin route छोड़कर), li border/margin 0, selected = accent-soft only  — **handed to Poject intity Master** (applied, left in place) |
| 14d | 14896–14909 | List blue lines → `--border`/`--primary`: page header/tabs/search/action/section-label separators, footer-stack, IC group/sub-group outlines, avatar borders, `border-blue-*` classes, tabs, inputs, R/P dialog rows  — **handed to Poject intity Master** (applied, left in place) |
| 15 | 14910–14922 | App header: card padding 4px, flex row + inner clusters gap 4px, mobile `ml-2`/`mr-1` margin 0 (gap से 4px), spacer div `margin-left:-4px` |
| 16 | 14923–14929 | 4px each side: `.app-main-border` border-left-width 0 (1px transparent border हटाया), outer `header:has(> .app-chrome-top-ribbon)` padding 4px, desktop (`.app-main-border header`) padding-left 0 → sidebar↔header 4px |

पुराने (block के बाहर) rules जो section 12 override करता है: line ~8651–8657 (`#dbeafe` / `#172554` greeting bar), ~10532–10569 (footer tab coloured borders) — इन्हें edit नहीं किया, सिर्फ Theme Master में higher specificity (`:not(#pl-theme-master-none)`) से override।

### TS / TSX files
- `src\lib\appThemes.ts` — `APP_THEME_OPTIONS` (line 12) = 7 themes की list।
- `src\lib\proTheme.ts` — `SERVER_GRAY_THEME_CLASS` (20), `THEME_DEFAULT_REV_KEY/REV` (50–51), migration (62)।
- `src\hooks\useTheme.tsx` — default/migration rev use करता है।
- `src\app\layout.tsx` — `<html>`/`<body>` पर `suppressHydrationWarning` (42, 48), body default `theme-pl-gray primary-pl-gray`, inline boot script (51) rev "4" migration।
- `src\components\settings\ThemeSettings.tsx` — `APP_THEME_OPTIONS` से list (65, 86)।
- `src\components\layout\HeaderAppearanceMenu.tsx` — वही list (68)।
- `src\components\company\CompanySelector.tsx` — `data-pl-company-select-card` (1561) ताकि company rows raised cards बनें।
- `src\components\dashboard\DashboardPageContentImpl.tsx` — **(इस run)** line 2737: `data-pl-footer-tab-active={footerTabActive ? "" : undefined}` (active footer tab CSS के लिए)।

## 5. Backup folders (1 Nov 2026, समय Asia/Kathmandu)
- `backup-theme-20261101-1612` (4:12 PM) — **baseline**: globals.css, app\layout.tsx, (dashboard)\layout.tsx, DashboardPageContentImpl.tsx, HeaderAppearanceMenu.tsx, ThemeSettings.tsx, ui\card.tsx, useTheme.tsx, appThemes.ts, proTheme.ts
- `backup-theme-20261101-1638` (4:38 PM) — globals.css
- `backup-theme-20261101-1717` (5:17 PM) — globals.css, CompanySelector.tsx
- `backup-theme-20261101-1729` (5:29 PM) — globals.css
- `backup-theme-20261101-1732` (5:32 PM) — app\layout.tsx
- `backup-theme-20261101-1743` (5:43 PM) — globals.css, app\layout.tsx, HeaderAppearanceMenu.tsx, ThemeSettings.tsx, appThemes.ts, proTheme.ts
- `backup-theme-20261101-1753` (5:53 PM) — globals.css
- `backup-theme-20261101-1756` (5:56 PM) — globals.css
- `backup-theme-20261101-1804` (6:04 PM) — globals.css
- `backup-theme-20261101-1811` (6:11 PM) — globals.css, DashboardPageContentImpl.tsx
- `backup-theme-20261101-1817` (6:17 PM) — globals.css (section 13 से पहले)
- `backup-theme-20261101-1823` (6:23 PM) — globals.css (section 14 से पहले)
- `backup-theme-20261101-1826` (6:26 PM) — globals.css (section 15 से पहले)
- `backup-theme-20261101-1829` (6:29 PM) — globals.css (section 13 16px→4px edit से पहले)
- `backup-theme-20261101-1833` (6:33 PM) — globals.css (section 16 से पहले)

सब `C:\Project xxx\` के अंदर हैं।

## 6. Checklist
### हो गया ✅
- [x] Server themes + soft themes tokens, cards = server style
- [x] Scrollbars: desktop native, touch 3px dim
- [x] Borderless raised UI (cards, pills, tabs, company selector, list rows)
- [x] Medium/Dark server clean-up, leftover blue हटाया (list panel, footers, balance card)
- [x] 7-theme single list, default Server Gray, rev 4 migration, hydration warning fix
- [x] Green/Blue/Pink visible tint
- [x] Ledger: one card per txn, 8px gap, divider lines + corner curve हटाए
- [x] Dashboard footer theme-following (greeting bar, tab row, pills, active/hover), mobile footers
- [x] Dashboard edge spacing 16px (top/left/right/bottom), header company pill text, sidebar Company link
- [x] App sidebar 4px each side + raised cards (section 13, 6:29 PM पर 16px→4px)
- [x] Ledger header text + चौड़ाई row card जितनी (14a) — **handed to Trxn Table Master**
- [x] Kebab 4px/4px (14b) — **handed to Trxn Table Master**
- [x] Account list rows = cards, 8px gap; selected accent-soft only (14c) — **handed to Poject intity Master**
- [x] Account lists के blue lines theme से (14d) — **handed to Poject intity Master**
- [x] App header toolbar 4px spacing (15)
- [x] Header 4px each side + sidebar↔header 4px (section 16)

### बाकी ⏳
- [ ] **User से visual verification** (सभी 7 themes, desktop + mobile) — कोई भी बदलाव screen पर verify नहीं हुआ
- [ ] `TransactionsTable.tsx:5230` — blue total row
- [ ] `OverdueAccountView.tsx:1284` — blue
- [ ] Form dialogs के blue boxes
- [ ] Report / register tables: rows-as-cards
- [ ] Radix `ScrollArea` scrollbars (native/dim नियम से match नहीं)
- [ ] Green theme button contrast option `#15803d` (user से पूछना)
- [ ] Ledger narration-line (seam) fix — unverified
- [ ] Sidebar 4px: collapsed (64px) और mobile drawer visually verify; nav scroller की -4px/4px shadow trick (card shadow clip तो नहीं) verify
- [ ] Dashboard mobile bottom gap (CSS में 10px + root का 6px = 16px मान कर) — verify
- [ ] कोई और leftover hard-coded colour
- [ ] Kebab: dashboard Recent shell (24px menu column) — **handed to Trxn Table Master**
- [ ] Ledger header Balance alignment — **handed to Trxn Table Master**
- [ ] Account list visual checks — **handed to Poject intity Master**
- [ ] App header: outer `<header>` अब 4px (desktop left 0); border-b line रखा — user से confirm कि line रहे या हटे
- [ ] Handed over (शुरू नहीं किए, Theme Master में कुछ नहीं लिखा): selected/hover orange ring gap के center में + blue left "C" border हटाना → **Trxn Table Master**; Dashboard Daybook + Bank/Cash Summary row cards 8px → **Trxn Table Master**

## 7. Progress log (1 Nov 2026, Asia/Kathmandu)
- **4:12 PM** — शुरुआत, baseline backup `-1612`; Theme Master block (sections 1–5): server themes, cards, scrollbars, dashboard 16px।
- **4:38 PM** — Scrollbars phase 2 (desktop native, section 4b)।
- **5:17 PM** — Borderless raised UI (section 6), company selector cards (`CompanySelector.tsx`)।
- **5:29 PM** — Medium/Dark clean-up (section 7)।
- **5:32 PM** — `layout.tsx` `suppressHydrationWarning`।
- **5:43 PM** — 7-theme single list, default Server Gray, rev 4 (appThemes/proTheme/useTheme/ThemeSettings/HeaderAppearanceMenu/layout) + leftover blue (section 8)।
- **5:53 PM** — Colour theme tint + ledger txn = one card 5px (section 9)।
- **5:56 PM** — Ledger row divider lines हटाईं (section 10)।
- **6:04 PM** — Right-bottom black curve हटाया, narration seam, 5px→8px (section 11)।
- **6:11 PM** — Dashboard footer theme, spacing 16px, header company pill, sidebar Company link (section 12 + `data-pl-footer-tab-active`); postcss ok, protected region identical, tsc ok।
- **6:17 PM** — App sidebar gap 16px + raised cards (section 13, CSS only); postcss ok, protected region identical, tsc ok।
- **6:20 PM** — यह handoff file बनाई।
- **6:23 PM** — Section 14: ledger header, kebab 4px/4px, account list 8px cards, list blue lines; postcss ok, protected region identical, tsc ok।
- **6:26 PM** — Section 15: app header 4px spacing; postcss ok, protected region identical, tsc ok।
- **6:29 PM** — Section 13 sidebar 16px→4px (in-place, `theme-work-tmp\sb-4px.js`); postcss ok, protected region identical।
- **6:33 PM** — Scope change: ledger header/kebab/ring/blue C/daybook+bank cards → Trxn Table Master; account list cards + blue lines → Poject intity Master (14a–14d जैसे थे वैसे छोड़े)। Section 16: header 4px each side + sidebar↔header 4px; postcss ok, protected region identical, tsc ok।
- **6:35 PM** — यह handoff update।

## 8. अगला कदम
1. User से सभी 7 themes में screenshots/visual check लें (dashboard, ledger, footer, header)।
2. ऊपर "बाकी" list एक-एक करके (हर बार नया backup + नया section 17, 18…)।
3. नया section जोड़ने का तरीका: `theme-work-tmp\gc-phase14.js` copy करें → `gc-phase15.js`, उसमें `section16.css` को `section17.css` से replace करें; section file LF + UTF-8 no BOM में लिखें; पहले `--dry` चलाएँ, फिर बिना `--dry`।
4. Verify: postcss parse, protected region == `-1612`, BOM नहीं, bare LF = 0, tsx बदला हो तो tsc।

## Helper scripts — `C:\Project xxx\theme-work-tmp\`
- `gc-phase3.js`, `gc-phase5.js` … `gc-phase10.js` — section CSS को Theme Master END marker से पहले append करते हैं (BOM / bare-LF / brace balance / protected region / concurrent-change checks, `--dry` support)। `gc-phase12.js` (section14.css), latest = `gc-phase13.js` (section15.css)।
- `section6.css` … `section15.css`, `theme-master.css` — हर phase का CSS source।
- `sb-phase2.js` — scrollbar phase 2 edit script।
- `cs-phase3.js` — CompanySelector edit script।
- `ts-phase6.js` — theme list (ts/tsx) edits।
- `build11.js` — section 11 builder।
- `edit.js` — generic targeted edit helper।
- `scan.js`, `scan2.js` — colour/selector scan helpers।

CSS selector shorthand (Theme Master में):
- **S** = `:is(body.theme-pl-light, body.theme-pl-gray, body.theme-pl-medium, body.theme-pl-dark, body.theme-soft-green, body.theme-dim-soft-green, body.theme-soft-blue, body.theme-sky-blue, body.theme-soft-yellow, body.theme-soft-pink)`
- **D** = `:is(body.theme-pl-medium, body.theme-pl-dark)`
- ID weight के लिए `:not(#pl-theme-master-none)` (ज़रूरत हो तो `:not(#pl-theme-master-none-2)` भी)।


## REJECTED (2 Nov 2026, 2:05 PM Asia/Kathmandu)
User ne kaha: 'kaam jo ruka hua hai uske sab ko reject karwa do maine sab manually kardiye hai'. Rejected, user ne khud kiya. Saare baaki/queued kaam rad: header ki bottom line wala sawal, aur handover hue items (Trxn Table Master: header length, orange ring, blue C bar, Daybook/Bank summary cards; Poject intity Master: account list ke bache neele hisse). Code me koi naya badlav nahi kiya gaya. User ke manual badlav overwrite NA karein; aage koi bhi edit karne se pehle file ki current state dobara padhein.


## 2026-11-02 15:39 (Asia/Kathmandu, UTC+5:45) - List hover card above scrollbar fix (app-wide)
- Task: hovered/lifted row cards painted over the list scrollbar. Root cause: shared Radix ScrollArea (`src/components/ui/scroll-area.tsx`) renders its scrollbar as an absolute overlay with z-index:auto; root/viewport were not stacking contexts, so hover-lift rows (`position:relative; z-index:1; transform`, pending-badge rows z-index:2) painted above it.
- Change: `src/app/globals.css` new section appended after `/* === end Theme Master === */` (lines 15724-15741): `:has(> [data-radix-scroll-area-viewport])` + `[data-radix-scroll-area-viewport]` get `isolation: isolate`; `[data-orientation]:has(> .pl-uniform-scroll-thumb)` gets `z-index: 5`. All themes incl. Pro; hover lift unchanged. No TS/TSX changed.
- Backup: `C:\Project xxx\backup-theme-20261102-1532\` (src\app\globals.css, _handoff\Theme Master.md).
- Checks: postcss parse OK; `npx tsc --noEmit -p .` exit 0; lines 1-15722 (incl. Trxn Table Master region) byte-identical to backup; CRLF, no BOM.
- Txn row gap 8px->1px task: cancelled by user, nothing changed. Pro theme v-line 1px: read-only investigation only, nothing changed.
- Status: not visually verified.

## 2026-11-02 15:49 Asia/Kathmandu - Pro list-panel right line: removed resize-handle duplicate hairline
- Task: user said Pro account-list side v-lines look thick black. Both are already 1px, black via Pro token --border: 0 0% 0% (globals.css 1098). Left = (dashboard)/layout.tsx:976 main wrapper border-l app-main-border; right = ResponsiveMasterDetail.tsx:322 panel border-r plus ResizeWidthHandle (ResizablePaneWidth.tsx) w-px bg-border line doubling it. User chose option (c): keep lines black, only hide the duplicate handle line.
- Change: src/app/globals.css appended lines 15742-15748: body.theme-pro [data-pl-master-list-chrome] > [role="separator"]:not(:hover):not(:active) > div { background-color: transparent !important; } (hover on whole handle + drag :active still highlight). Lines 1-15741 byte-identical.
- Backup: C:\Project xxx\backup-theme-20261102-1548\ (src/app/globals.css, _handoff/Theme Master.md)
- Checks: postcss OK, tsc exit 0, CRLF/no BOM, Trxn Table region unchanged. Status: done, NOT visually verified.

## 2026-11-02 15:52 Asia/Kathmandu - Pro left edge: removed app-sidebar resize-handle duplicate hairline
- Task: user: left v-line (sidebar | list) still double after right fix. Cause: AppSidebar (sidebar.tsx:223) ResizeWidthHandle w-px bg-border (black in Pro) line beside main wrapper border-l app-main-border ((dashboard)/layout.tsx:976). Screenshot pixels: left 2px (grey+black), right now 1px.
- Change: src/app/globals.css appended lines 15749-15755: body.theme-pro [data-pl-main-sidebar] > [role="separator"]:not(:hover):not(:active) > div { background-color: transparent !important; }. Lines 1-15748 byte-identical.
- Backup: C:\Project xxx\backup-theme-20261102-1551\ (src/app/globals.css, _handoff/Theme Master.md)
- Checks: postcss OK, tsc exit 0, CRLF/no BOM, Trxn Table region unchanged. Status: done, NOT visually verified.

## PATH BADLAV (3 Nov 2026, 4:03 PM Asia/Kathmandu)
User ne laptop par folder 'C:\Project xxx' ka naam badalkar 'C:\Project ERP' kar diya. Main app ab: C:\Project ERP\Refference apps\Touri + React. Purane backups (backup-theme-2026110x-*) aur theme-work-tmp ab C:\Project ERP\ ke andar hain. Is file me upar jahan bhi 'C:\Project xxx' likha hai, use 'C:\Project ERP' samjhein. Folder ka naam wapas mat badlein.
Account list ki dono lines (Pro theme): right edge 2 Nov 3:49 PM aur left edge 3:52 PM par ho chuki hain (handle ki duplicate line chhipayi, globals.css lines 15742-15755). Is kaam me kuch baaki nahi.


## 2026-11-03 18:22 Asia/Kathmandu - Table border: #000 -> theme token; 4K table border 3px -> 1px
- Approved by user 6:19 PM NPT Nov 3, 2026. File: src/app/globals.css (only 2 lines changed, CRLF/no BOM kept).
- Line 7460 (rule at 7453-7461, selectors: body[class*="theme-"] main table:not([data-pl-manage-sharing-users-table]):not([data-pl-manage-sharing-limits-table]):not(.pl-special-account-usage-table):not([data-pl-online-trigger-log-inner]) + th/td/tr, and body[class*="theme-"] [data-theme-table="transactions"] table/th/td): before `  border-color: #000 !important;` after `  border-color: hsl(var(--border)) !important;`. Global (all themes), not Pro-scoped; Pro --border = 0 0% 0% so Pro stays black.
- Line 3153 (inside @media (min-width: 3840px) and (hover: hover) and (pointer: fine), line 3142; selectors 3146-3152: table:not([data-pl-subscription-payments-table]):not(.pl-special-account-usage-table):not([data-pl-company-profile-table]):not([data-pl-online-trigger-log-inner]) + td/th/tr/thead th/tbody td/tfoot td): before `    border-width: 3px !important;` after `    border-width: 1px !important;`. Global 4K-only; Pro on 4K also gets 1px (was 3px). Line 3154 border-color #000000 left untouched (not in approved scope).
- Backup: C:\Project ERP\backup-theme-20261103-1820\ (src\app\globals.css, _handoff\Theme Master.md).
- Checks: postcss parse OK; npx tsc --noEmit exit 0; diff vs backup = only lines 3153 and 7460; CRLF, no BOM; Trxn Table Master region, electron\, src-tauri\ untouched.
- Pending: visual check on localhost:2000 (transaction tables e.g. Party/Bank-Cash account detail, Dashboard, Reports > Accounts Statement; 4K check needs >=3840px desktop). Notify HR Module Master.

## 2026-11-04 08:33 Asia/Kathmandu - Pro = default theme for new users; Pro label renamed to "Default"
- User request 8:28 AM NPT Nov 4, 2026: "them ko default me pro kardo, and pro ko rename karke default kardo".
- Internal id/class unchanged: theme-pro / primary-pro (saved settings + all CSS keep working). Only the display label changed. No other theme was labelled "Default" before this change. There is no separate accent list; both pickers (Settings > Background Theme, header Appearance menu) read APP_THEME_OPTIONS.
- src/lib/appThemes.ts line 14: `name: "Pro",` -> `name: "Default",`.
- src/lib/proTheme.ts line 23 comment updated; line 24 `DEFAULT_THEME_CLASS = SERVER_GRAY_THEME_CLASS` -> `= PRO_THEME_CLASS`; line 25 `DEFAULT_PRIMARY_CLASS = SERVER_GRAY_PRIMARY_CLASS` -> `= PRO_PRIMARY_CLASS`; line 79 `PRO_THEME_DISPLAY_NAME = "Pro"` -> `"Default"` (constant is not used anywhere yet).
- src/app/layout.tsx line 49: body SSR class `theme-pl-gray primary-pl-gray` -> `theme-pro primary-pro`; line 57 boot script `DT="theme-pl-gray",DP="primary-pl-gray"` -> `DT="theme-pro",DP="primary-pro"`. V="5" unchanged.
- src/hooks/useTheme.tsx line 39: comment only (Server Gray default -> Pro default).
- THEME_DEFAULT_REV stays "5" (no bump), no new migration: anyone with a saved valid theme keeps it. Only an empty theme key, or a theme/accent from REMOVED_* lists, falls back to Pro now (before: Server Gray).
- globals.css, theme colours, electron\, src-tauri\ untouched. CRLF/no BOM kept.
- Backup: C:\Project ERP\backup-theme-20261104-0831\ (src\lib\proTheme.ts, src\lib\appThemes.ts, src\app\layout.tsx, src\hooks\useTheme.tsx, _handoff\Theme Master.md).
- Checks: npx tsc --noEmit exit 0.
- Pending: visual check on localhost:2000 - fresh browser profile (or delete localStorage keys "theme" and "primaryColor") should open in Pro, labelled "Default" in Settings > Background Theme and the header Appearance menu; an existing user who picked e.g. Gray should stay on Gray.

## 2026-11-04 15:40 Asia/Kathmandu - Reminder form pill-blue fields (Pro) + Messages Reminder "Deleted" tab
- User approved B + C (layout A not done).
- B: src/components/messages/AlarmsTab.tsx line 618 form wrapper + src/components/vouchers/LedgerReminderDialog.tsx line 454 field wrapper got `data-pl-reminder-form`. src/app/globals.css lines 15756-15768 (after "end Theme Master: Pro sidebar handle line"): `body.theme-pro [data-pl-reminder-form] :is(input, textarea, button[role="combobox"], button[aria-haspopup="dialog"]):not(.bg-primary):not([data-pl-reminder-skip])` = 1px solid rgb(147 197 253) (blue-300 = Pro chromePill border), radius calc(var(--radius) - 2px); hover/focus-visible rgb(96 165 250). Date triggers (BsDatePicker + AD Calendar) are outline Buttons via Radix PopoverTrigger (aria-haspopup="dialog"). Set Reminder (.bg-primary) and Cancel Edit excluded. Pro only.
- C: AlarmsTab.tsx - new `deletedAlarms` state (320) + separate useEffect with subscribeCompanyReminders filtered by isReminderDeleted, sorted deletedAt desc, unsubscribe cleanup (401-413); handleRestore -> restoreReminderAlarm (513-525); AlarmList `isDeletedList` (no Select All/checkbox/edit/delete; "Deleted: date" + Restore with RotateCcw); TabsTrigger "Deleted (n)" (713) + TabsContent (743-745); delete dialog text -> "restore it from the Deleted tab" (753). Main alarms query (393-398) and data helpers (142-310) unchanged.
- Encoding: tsx UTF-8 no BOM, LF kept (as before); globals.css CRLF no BOM kept. No backup (Git), no commit.
- Checks: postcss parse OK; tsc --noEmit exit 0; git diff --stat = only these 3 files.
- Pending: visual check on localhost:2000 (Pro: Messages > Reminder form + Ledger Reminder popup borders; Deleted tab list + Restore).