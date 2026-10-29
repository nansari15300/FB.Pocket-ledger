# Pocket Ledger – PocketBase मल्टी-सर्वर प्लान
तारीख़: 19 अक्टूबर 2026 · स्थिति: सिर्फ़ प्लान (कोड शुरू नहीं हुआ) · शुरुआत: 2–4 दिन बाद, Ansari के कहने पर

## 0. ज़रूरी नियम (काम करते समय)
- किसी भी project file को छूने से पहले backup: `C:\Balgram\_backups\<timestamp>\<relative path>`
- web, EXE, APK तीनों पर एक साथ बदलाव; मौजूदा कोड को बदलना पसंद, नया कम
- `npx tsc --noEmit -p .` हर बदलाव के बाद; commit/build सिर्फ़ कहने पर
- AGENTS.md की frozen files का सम्मान
- हर नए page/feature पर भाषा नियम (भाग 11), कैलेंडर/तारीख़ नियम (भाग 12), Back बटन/Navigation नियम (भाग 13) और Popup/Dialog नियम (भाग 14) अपने-आप लागू
- PC: low-end Dell (3rd-gen Intel, Win10, 8GB) – performance ध्यान रखें
- PocketBase की zip `E:\Drive E\PC Files Softwares\pocketbase_0.40.4_windows_arm64.zip` ARM वाली है → PC के लिए `windows_amd64` डाउनलोड करनी है (अब sub-server में **v0.40.6** windows_amd64 चल रहा है; 23-10-2026 को upgrade, SHA256 `checksums.txt` से मिलाया)

## 1. गेट सिस्टम
- Firebase और PocketBase दोनों "गेट" होंगे; ऐप का sync एक साझा interface के पीछे।
- SuperAdmin/Admin पैनल में **डिफ़ॉल्ट गेट** चुनने की setting (Firebase या PocketBase) – सब users वही इस्तेमाल करेंगे।
- गेट बदलते समय admin चुने: **पुराना डेटा migrate** करें या **नए सिरे से** शुरू।
- SQLite offline cache और 10 दिन का role cache वैसे ही रहेंगे (offline-first)।

## 2. Domain और सर्वर
- `pocket-ledger.com` के subdomain: `admin.pocket-ledger.com` (main), `nepal.pocket-ledger.com`, `india.pocket-ledger.com` …
- Cloudflare Tunnel से HTTPS (domain का DNS Cloudflare पर होना चाहिए – पहले जाँचें domain कहाँ से लिया है)।
- PocketBase Windows service बनकर चलेगा; production के लिए हर देश का सस्ता VPS ($4–6/महीना) बेहतर, टेस्ट PC पर।

## 3. Main server (central control)
- सारे sub-servers की list: नाम, देश, URL, स्थिति।
- हर sub-server की **pricing** (plan, दाम, currency NPR/INR…)।
- हर sub-admin को: **role, user limit, plan limit**, कौन से permission – सब main तय करे।
- साझा नियम push: features, limits, app version, maintenance।
- License **main server की private key से signed**; ऐप सिर्फ़ signed limits मानेगा।
- Private key सिर्फ़ main पर, offline backup।

## 4. Sub-server (देश/contractor)
- खुद या contractor को दिया जा सकता है; **sub-admin** चलाएगा।
- सिर्फ़ sealed package चलेगा; main server हर कुछ मिनट file hash + heartbeat लेगा।
- Sub-server main से setting खींचे; main बंद हो तो आख़िरी setting पर चले।
- Heartbeat/license पुराना → ऐप चेतावनी, कुछ दिन बाद sync रोक।
- कोड छेड़छाड़/hash mismatch → main admin को **notification + action सुझाव** (read-only, license रोकें, संपर्क करें) बटन के साथ।
- Sub-admin क्या कर सके (main की अनुमति के अंदर): users जोड़ना/हटाना (limit तक), role देना (दिए गए में से), plan देना, backup, अपनी रिपोर्ट, support tickets।

## 5. Website / Admin Panel (pocket-ledger.com)
- Sub-admin email से login → सिर्फ़ अपना admin panel + analytics (users, devices, plans बिक्री, storage, backup, errors)।
- **देश के हिसाब से ऐप upload** – main admin per server चुने: "अनुमति नहीं" / "मंज़ूरी के बाद" / "सीधे"।
  - सलाह: contractor सिर्फ़ settings (नाम, logo, भाषा, currency, tax) upload करे; build main से बने।
  - build upload हो तो main hash जाँचे + approve; ऐप सिर्फ़ main-signed update माने।
  - उस देश का auto-update (`latest.json`) उसी देश की file से।
- Main admin के बटन: **upload block**, रुका update रद्द, **पुराने version पर rollback**, server **read-only/बंद**।
- बाएँ menu में **country/sub-server dropdown** ("🌐 सभी servers (Main)", 🇳🇵 Nepal, 🇮🇳 India …) – किसी भी server के पेज देखें (Release upload, Videos, Download analytics, Notice, Users, Plans)। Sub-admin को dropdown नहीं।
- **Main dashboard (default, सिर्फ़ main admin)**: हर server – देश, कुल users, free, paid, आज active, डेटा/storage (KB/MB/GB/TB auto), आख़िरी backup, स्थिति, महीने की कमाई; ऊपर कुल जोड़; alerts (कोड बदला, backup नहीं, offline, upload रुका) block/rollback बटन के साथ; 30 दिन का graph।
- **अपना admin panel = रोज़ का काम**: हमारा admin panel (Server settings, network, backup आदि) PocketBase के `/_/` dashboard की जगह रोज़ के इस्तेमाल के लिए है। `/_/` सिर्फ़ technical काम (collections, logs, debugging) के लिए; बाद में sub-admins के लिए `/_/` block किया जा सकता है।

## 6. बैकअप और restore
- हर server का रोज़ auto backup (`pb_data` + `pb_migrations` zip) → Drive/दूसरी जगह; setting admin panel में।
- हर user को अपना PL backup **अपने Gmail पर भेजने** का बटन।
- नए PC/VPS पर `setup.bat` → zip खोले, service बनाए, tunnel जोड़े → वही subdomain, ऐप में कुछ नहीं बदलना।

## 7. PocketBase में क्या-क्या
Login/Auth (email, OTP, Google, 2FA, session limit) · SQLite DB · Realtime sync · File storage (local/S3) · API rules · Hooks/custom logic · Cron jobs · SMTP email · Backup/restore · Audit log · Rate limit/सुरक्षा · Admin dashboard · Main-server link (license, heartbeat, integrity) · Presence · Payment webhook (Stripe/eSewa/Khalti – main पर)

## 8. Code ढाँचा (monorepo)
```
Online Project/
  src/                 ← user ऐप (web, EXE, APK)
  servers/shared/      ← license, signature, नियम, types
  servers/main-server/ ← central admin
  servers/sub-server/  ← देश server (PocketBase + hooks + migrations)
  scripts/             ← build/release
```
Build commands: `build:app`, `build:main-server`, `build:sub-server`। User EXE में server कोड नहीं; contractor को सिर्फ़ sub-server package।

## 9. पहले ध्यान देने वाली बातें
1. Firestore sync को साझा interface के पीछे लाना – सबसे बड़ा काम, छोटे हिस्सों में।
2. Nepal/India डेटा व accounting कानून; contractor के साथ लिखित agreement।
3. User को server बदलने/server बंद होने पर export/import रास्ता।
4. Sub-servers के updates main से एक बटन से।
5. हर server का monitoring (CPU, disk, backup, errors) main पैनल में।
6. Signing key की सुरक्षा।
7. हर server पर budget alert, rate limit, usage counter (Firebase spike से सीख)।
8. Offline-first बनाए रखना।
9. छोटे से शुरू: पहले main + Nepal sub-server, 1–2 महीने टेस्ट, फिर India/contractor।

## 10. चरण (Phases)
1. **Phase 1:** PocketBase server (PC पर) + backup/restore + `setup.bat` – टेस्ट।
2. **Phase 2:** Main server + एक sub-server, license/heartbeat/hash check।
3. **Phase 3:** Admin panel – dropdown, main dashboard, sub-admin login, upload permission/block/rollback।
4. **Phase 4:** ऐप में गेट सिस्टम (डिफ़ॉल्ट गेट setting, data migrate विकल्प)।
5. **Phase 5:** User Gmail backup, payments, दूसरे देश/contractor।

पहला कदम: एक छोटा design document (tables, roles, license format, API list) बनाकर Ansari से मंज़ूरी।

## 11. भाषा (Language) – नियम
- पहली बार login/setup पर user **दो भाषाएँ अलग-अलग** चुनेगा:
  - **UI भाषा** – labels, buttons, menus।
  - **Intro भाषा** – ऐप में सारे intro / help / जानकारी वाले वाक्य।
- हर जगह के सारे intro, चुनी गई Intro भाषा में; UI, चुनी गई UI भाषा में।
- दोनों बाद में settings से बदली जा सकती हैं; पसंद user के record में save (और local cache में)।
- डिफ़ॉल्ट दोनों **English** (पूरा पेज शुद्ध English, कोई मिलावट नहीं)। सूची में दुनिया की सारी भाषाएँ (ISO 639-1, "मूल नाम (English नाम)", search के साथ); पूरा अनुवाद अभी en, hi, ne का, बाक़ी भाषाएँ English text पर fallback (code वैसे ही save)। RTL भाषाएँ (ar, he, fa, ur, ps, sd, yi) UI भाषा होने पर dir=rtl।
- यह नियम अभी server UI (PocketLedger-Server) पर लागू है और आगे main ऐप (web, EXE, APK) पर भी।

## 12. कैलेंडर और तारीख़ (Calendar & Date) – नियम
- **Calendar UI जैसा का तैसा**: Server panel (और आगे हर admin panel) में date चुनने के लिए Pocket Ledger ऐप वाला calendar/date picker ही लगेगा – वही look, वही behaviour (BS महीना grid, AD calendar, महीना wheel, साल की "Show more" सूची, range presets, नीला 3D border, Date Converter बटन)। नया calendar नहीं बनाना; ऐप वाले को reuse/port करना है। ऐप के files (`Online Project/src`, सिर्फ़ पढ़ने के लिए – इन्हें edit नहीं करना):
  - `src/components/ui/BsDatePicker.tsx` – मुख्य date / date-range picker (popover; ~57 जगह इस्तेमाल)
  - `src/components/ui/nepali-calendar.tsx` – BS calendar panel
  - `src/components/ui/ad-calendar.tsx` – AD calendar panel (`DateRange` type भी यहीं)
  - `src/components/ui/calendar.tsx` + `src/components/ui/ad-calendar-years-dropdown.tsx` – react-day-picker वाला AD calendar
  - `src/components/ui/calendar-month-wheel.tsx`, `src/components/ui/year-select-show-more.tsx` – महीना wheel, साल सूची
  - `src/components/ui/CalendarPanelTopToolbar.tsx`, `src/components/ui/DateRangePresetRow.tsx`, `src/lib/bsDateRangePresets.ts` – ऊपर का toolbar और range presets
  - `src/components/layout/DateConverterDialog.tsx` – BS ⇄ AD converter
  - `src/components/admin/AdminPanelDateRangePicker.tsx` – ऐप के admin panel का date-range picker
  - `src/lib/calendarChrome.ts` – calendar की styling (border, shadow, साल की सीमा 1950–2100)
  - `src/lib/bs-date.ts` – BS ⇄ AD बदलना (`nepali-date-converter` + `datex-bs`), नेपाली महीने/अंक
  - `src/hooks/useDate.tsx` – `dateSystem` (AD / BS / Both) और date formatting; `src/lib/dateFormatOptions.ts` – AD/BS format सूची; `src/components/settings/DateFormatSettingsDialog.tsx` – format setting
  - ऐप React + Tailwind है, server panel सादा HTML/JS – इसलिए port करते समय दिखना और चलना 1:1 रखना है (BS डेटा/conversion के लिए वही libraries या उनका browser build)।
- **BS / AD / दोनों (Both) हर जगह**: हर date field, हर date दिखाने की जगह – dashboard, settings, reports, logs, backup सूची, restart status, सब – बिना कहे अपने-आप चुने गए system में। "दोनों" में BS और AD साथ दिखें। User की पसंद (BS / AD / Both) और date format setting में save होगी (admin के record में + local cache)।
- **Default ऐप जैसा**: ऐप में डिफ़ॉल्ट **BS** है; देश Nepal न हो तो **AD**; company setting (`displaySettings.calendarDateSystem`) हो तो वही। Format डिफ़ॉल्ट: AD `MM-dd-yyyy`, BS `MMM DD, YYYY` (ऐप जैसा)।
- अंदर (DB, API, logs की files) तारीख़ हमेशा AD/UTC ISO में रहे; BS/AD/Both सिर्फ़ दिखाने और चुनने के लिए।
- **Server panel में लागू (20261023-2130)**:
  - **Top bar pill**: भाषा वाले globe के बाईं ओर calendar icon + अभी का mode (BS / AD / Both)। Menu: BS, AD, Both, divider, gear "Setting"।
  - **Setting dialog**: "Date format settings" – ऐप जैसा (radio सूची, Cancel / Save)। AD वाला हिस्सा सिर्फ़ AD या Both में, BS वाला सिर्फ़ BS या Both में।
  - **Calendar**: ऐप का calendar सादे JS में port – `pb_public/date/` (`bs-data.js`, `bs-date.js`, `date-format.js`, `calendar.js`)। ऊपर "Date Converter" बटन, महीना/साल dropdown + आगे/पीछे तीर, Sun–Sat, आज पर गोल घेरा, चुनी तारीख़ नीली भरी, नीचे Today बटन। ऐप के files नहीं बदले।
  - **एक ही global formatter**: हर जगह `plDate.format(d)` और date चुनने के लिए `plDate.picker(...)` / `plDate.field(...)`। Both = `BS (AD)`, समय वाला हिस्सा बना रहता है। Dashboard का "Updated:" और "Started:" भी इसी से।
  - **हर admin की अपनी पसंद**: localStorage (`pl_server_date_system`, `pl_server_date_format_ad`, `pl_server_date_format_bs`) + server (`server_admins.date_prefs`, API `GET/POST /api/pl/me/date`) – भाषा की तरह; server वाला मान जीतता है। बदलते ही सारी तारीख़ें तुरंत दोबारा बनती हैं।
  - **Setup backup**: हर admin की date setting setup backup में जाती है (`date_prefs`) और restore पर सिर्फ़ उन्हीं admins पर लगती है जो target server पर पहले से हैं।
  - **ऐप से जानबूझकर फ़र्क़**: lines 1px (ऐप में 3px नीला border); आज = घेरा, चुनी तारीख़ = भरा नीला; 1943 से पहले और 2090 BS के बाद हमारी conversion सही table से (ऐप की library वहाँ एक दिन खिसक सकती है)। hi/ne में महीने और दिन के नाम देवनागरी में, अंक साधारण।
- **आगे से हर नया page/feature बनाते समय यह नियम अपने-आप मानना है** – अलग से कहने की ज़रूरत नहीं।
- यह नियम server UI (PocketLedger-Server) पर अभी से और main ऐप के हर नए हिस्से पर लागू है।

## 13. हर page पर Back बटन (Navigation नियम)
- **हर page पर Back बटन**: हमारे panel का हर page/screen (और आगे ऐप के server वाले pages भी) – ऊपर बाईं ओर (top-left) साफ़ दिखने वाला **Back** बटन ज़रूरी। RTL भाषा में यह ऊपर दाईं ओर, तीर उल्टा।
- Back दबाने पर: अगर पिछला page हमारा ही panel page था तो वहीं वापस (browser history); नहीं तो parent page पर। **Dashboard = home** (Dashboard पर Back बटन नहीं, बाकी हर page पर)।
- Browser का Back/Forward भी panel के pages के बीच काम करे (हर page बदलने पर history entry)।
- बटन का नाम हर भाषा में (en "Back", hi "वापस", ne "पछाडि"), बिना Latin मिलावट।
- PocketBase dashboard (`/_/`) या कोई बाहरी link हमेशा **नए tab** में खुले (`target="_blank" rel="noopener"`), ताकि panel वाला tab खुला रहे।
- **आगे से हर नया page/feature बनाते समय यह नियम अपने-आप मानना है** – अलग से कहने की ज़रूरत नहीं।

## 14. Browser popup नहीं – अपना dialog (Popup/Dialog नियम)
- **कहीं भी browser वाले popup नहीं**: `alert()`, `confirm()`, `prompt()` (या `window.alert/confirm/prompt`) का इस्तेमाल मना है – server panel में भी और आगे ऐप में भी।
- हमेशा अपना styled in-panel dialog: panel के design जैसा (dark/light theme, गोल कोने, **1px border**, panel के OK/Cancel बटन styles)।
- Server panel में: `plDialog.confirm(msg, opts)` → `Promise<boolean>`, `plDialog.alert(msg, opts)` → `Promise`; opts: `title`, `okText`, `cancelText`, `danger` (`pb_public/app.js`, markup `#pl-dialog` in `index.html`, CSS `.dlg-*` in `style.css`)।
- **Esc = Cancel**, **Enter = OK**, खुलते ही focus मुख्य (OK) बटन पर, focus dialog के अंदर ही रहे; बाहर click = Cancel; `translate="no"`।
- बटन/शीर्षक i18n से (en/hi/ne, hi/ne देवनागरी में): `dlg_ok`, `dlg_cancel`, `dlg_confirm_title`, `dlg_alert_title`।
- खतरनाक काम (server restart, delete आदि) पर `danger: true` → लाल OK बटन, और OK पर काम का नाम (जैसे "Restart server")।
- Text input चाहिए तो `prompt()` नहीं – dialog/form में अपना input field।
- **आगे से हर नया page/feature बनाते समय यह नियम अपने-आप मानना है** – अलग से कहने की ज़रूरत नहीं।
- **खोज वाली सूची (searchable dropdown)**: UI पर अलग से "खोजें…" box **कहीं नहीं** – न सूची के बाहर, न popup के अंदर। जो field चुना हुआ मान दिखाता है (जैसे "English"), **वही टाइप करने लायक** है: click करें और टाइप करें, नीचे की सूची filter होती है।
  - Server panel में reusable component: `plCombo(root, { items, value, onPick, labelledBy, placeholder, empty })` (`app.js`, CSS `.combo-*`)। भाषा चुनने की हर जगह यही है: first-run/login, Server settings → भाषा (UI और परिचय दोनों), top-bar भाषा बटन।
  - Keyboard: ↑/↓ से चलें, Enter या click से चुनें, Esc = पहले वाला मान वापस; बाहर click = बंद + पहले वाला मान वापस; चुना हुआ item highlight; English और मूल (native) दोनों नामों से खोज; `translate="no"`; 1px border; चारों theme; छोटी स्क्रीन पर फ़िट।
  - हल्का: कोई library नहीं, native `<select>` नहीं; सूची एक बार बनती है, खोजने पर items सिर्फ़ छुपते/दिखते हैं। Save पहले जैसा (वही values/API)।
- **Theme**: चार theme – हल्की | ग्रे | मध्यम | गहरी (`data-theme="light|gray|medium|dark"`, CSS variables)। ग्रे = हल्का neutral grey (गहरा text), मध्यम = बीच का neutral grey (हल्का text); दोनों में नीला रंग सिर्फ़ accent के लिए। Top-bar बटन इसी क्रम में घूमता है। हर नया page, dialog और dropdown चारों में ठीक दिखना चाहिए; रंग hard-code नहीं, सिर्फ़ CSS variables।
- **पुराना panel कभी न दिखे (self-update guard)**: `index.html` में `<meta name="pl-version">` और हर asset पर वही `?v=`; `app.js` का `APP_VERSION` इससे मेल न खाए, या खुले tab में नया version deploy हो जाए (focus / tab पर लौटने / हर 5 मिनट पर जाँच), तो panel **एक बार** अपने-आप reload होता है। हर बदलाव पर तीनों जगह version एक साथ बढ़ाना है।
