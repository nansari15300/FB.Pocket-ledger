# Pocket Ledger — सभी bots के साझा नियम (NIYAM)

अंतिम अपडेट 2026-11-01 (Asia/Kathmandu)

यह file हर उस bot के लिए है जो Pocket Ledger पर काम करती है, ताकि किसी दूसरे account की bot भी यहीं से काम आगे बढ़ा सके।

## 1. भाषा
- user से हमेशा हिंदी देवनागरी में बात करनी है, स्त्रीलिंग में (जैसे "मैं कर रही हूँ")।
- अपवाद: Manish / Server master पुल्लिंग में बोलता है ("मैं करता हूँ")।

## 2. Project और PCs
| PC | भूमिका | Path |
|---|---|---|
| DESKTOP-M4HAJE9 | laptop, work PC | `C:\Project xxx\Refference apps\Touri + React` और `PocketLedger-Server` |
| ServerWin10 | server PC | `C:\Project Next.js Balgram\Online Project` |

Stack:
- Next.js/React + TypeScript (static export `out/`)
- PocketBase server (Go)
- Android: Capacitor
- Windows EXE: Electron -> Tauri v2 (migration चल रहा है)

## 3. बदलाव और backup
- कोई भी बदलाव करने से पहले user की हाँ और backup ज़रूरी है।
- ServerWin10 पर backup C: पर नहीं रखना; दूसरी drive (जैसे D:) पर: `D:\PocketLedger-Backups\`
- laptop (DESKTOP-M4HAJE9) पर: `C:\PocketLedger-Backups\`
- Folder names नहीं बदलने हैं।

## 4. Git
- दोनों PC का auto-sync Tauri काम पूरा होने तक hold पर है।
- user की हाँ के बिना commit/push नहीं करना।

## 5. Cloudflare
- Cloudflare/cloudflared files सिर्फ़ ServerWin10 पर हैं; इन्हें copy या बदलना नहीं है।

## 6. Firebase
- Firebase पूरी तरह हटाना है; सब कुछ सिर्फ़ PocketBase पर चलेगा।
- नया Firebase code नहीं लिखना।
- Firebase वाला काम सिर्फ़ Firebase Master का है।

## 7. अन्य नियम
- दूसरी bot की files छूने से पहले user से पूछना।
- Live PocketBase data (`pb_data`) को merge/overwrite नहीं करना।
- Secrets/`.env` की सामग्री chat में नहीं डालनी।
- Android Capacitor पर ही रहेगा।

## 8. Bots और उनकी भूमिकाएँ
भूमिकाएँ best-known जानकारी के अनुसार लिखी गई हैं; हर bot अपनी row ख़ुद सही करे।

| Bot | भूमिका |
|---|---|
| Bot Leader | सभी bots का समन्वय, user के फ़ैसले आगे पहुँचाना |
| Git Master | दोनों PC का GitHub sync |
| Tauri Master | Windows EXE Electron -> Tauri v2 migration (`TAURI-MIGRATION.md`); `src-tauri/` और `desktop-sidecar/` इसके हैं |
| EXE Master | Windows EXE build/release |
| APK Master | Android APK (Capacitor) |
| Server master / Manish | PocketBase server, ServerWin10 (पुल्लिंग) |
| Poject intity Master | project entities / data model |
| Account Details Master | Account Details और Group Details pages |
| App Report Master | सिर्फ़ Report section |
| Theme Master | theme और card design: `src\lib\appThemes.ts`, `proTheme.ts`, `src\hooks\useTheme.tsx`, `src\app\layout.tsx` का theme script, `ThemeSettings.tsx`, `globals.css` के theme/card हिस्से |
| Trxn Table Master | transaction table: `TransactionsTable.tsx`, `transactionTableShared.tsx`, `ledgerUnifiedContentWidth.ts`, `ledgerHeaderChrome.ts`, `globals.css` lines ~8891–8959 |
| Animation Master | animations |
| Firebase Master | Firebase हटाकर PocketBase पर लाना |
