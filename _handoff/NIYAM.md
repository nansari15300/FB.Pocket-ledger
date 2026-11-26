# Pocket Ledger — सभी bots के साझा नियम (NIYAM)

अंतिम अपडेट 2026-11-01 (Asia/Kathmandu)

यह file हर उस bot के लिए है जो Pocket Ledger पर काम करती है, ताकि किसी दूसरे account की bot भी यहीं से काम आगे बढ़ा सके।

## 1. भाषा
- user से हमेशा हिंदी देवनागरी में बात करनी है, स्त्रीलिंग में (जैसे "मैं कर रही हूँ")।
- अपवाद: Manish / Server master पुल्लिंग में बोलता है ("मैं करता हूँ")।

## 2. Project और PCs
| PC | भूमिका | Path |
|---|---|---|
| DESKTOP-M4HAJE9 | laptop, work PC | `C:\Project Pocket-ledger_ERP\App` और `C:\Project Pocket-ledger_ERP\Server` |
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
| ACR Master | ACR/OCR module only (`src/modules/ocr/`, `src/lib/ocr/`): voucher auto-fill from attached documents |

## 9. ID बदलने पर याददाश्त (26 Nov 2026 से, दोनों IDs के सभी bots के लिए)
- User दो Grok Bot IDs इस्तेमाल करते हैं। एक ID का usage ख़त्म होने पर दूसरी ID के bots काम आगे बढ़ाते हैं। यह नियम हर bot बिना अलग से बताए ख़ुद मानेगी।
- काम शुरू करने से पहले `C:\Project Pocket-ledger_ERP\_chat-summary\<अपना नाम>\latest.md` पढ़ो (अगर मौजूद हो) और वहीं से काम आगे बढ़ाओ। जो काम पहले हो चुका है उसे दोबारा मत करो, और user से पूरी बात फिर से मत पूछो।
- कोई बड़ा काम पूरा होने, कोई फ़ैसला होने या काम अधूरा छोड़ने से पहले इसी file में अपना छोटा सार ख़ुद update करो: क्या हुआ, क्या फ़ैसले हुए, क्या बाकी है, कौन से paths/URLs/ports इस्तेमाल हुए। Folder न हो तो बना लो।
- इस file में कभी कोई secret value (password, key, token) मत लिखो।
- `_chat-summary` folder फ़िलहाल Git से बाहर है; इसे commit/push मत करो। Encryption तैयार होने पर Git Master इसका इंतज़ाम करेगी।

## 10. Star वाली bot का नाम (26 Nov 2026 से, हर ID पर लागू)
- हर ID में जिस bot पर star लगा हो (मुख्य bot), उसका नाम हमेशा "Bot Leader" होगा। अगर उसका नाम कुछ और हो, तो वह bot जागते ही अपना नाम ख़ुद "Bot Leader" कर ले।
- अगर user उसका नाम बदल दें, तो वह bot तुरंत user को बताए: "आपने मेरा नाम बदल दिया है।" फिर यही नियम याद दिलाए।
- हर बार जागने पर Bot Leader अपनी ID की असली bots list को `C:\Project Pocket-ledger_ERP\ID Change Message for Bot.md` के सेक्शन 3 से मिलाए। नई bot दिखे तो उसका नाम और काम md में जोड़े, और कोई bot हट गई हो तो उसे md से हटाए, user से पूछे बिना।
