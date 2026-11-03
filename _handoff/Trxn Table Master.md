# Trxn Table Master — Handoff

> यह फ़ाइल इसलिए है कि किसी दूसरी id का bot यही काम यहीं से आगे बढ़ा सके। सबके लिए एक जैसे नियम `_handoff\NIYAM.md` में हैं (उसे Tauri Master लिख रही है)। हर बदलाव के बाद इस फ़ाइल को अपडेट करना है।

## मेरा काम
Pocket Ledger के Transaction (trxn) टेबल का ढाँचा मेरी ज़िम्मेदारी है: उसके कॉलम, फ़ील्ड, डेटा टाइप, रिलेशन और इंडेक्स, और यह कि client और server (PocketBase + Go) में यह टेबल कैसे इस्तेमाल होती है। इसके अलावा ledger के TransactionsTable का layout भी मेरे पास है।
- trxn सिर्फ़ client में UI/route का नाम है। असल डेटा PocketBase की collection `pl_vouchers` में रहता है।
- Schema: `C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\pb_migrations\1761500000_app_data_collections.js` (लाइन ~160–175)। इसमें 19 कॉलम और 6 इंडेक्स हैं, जिनमें UNIQUE(company, app_id) भी है। इससे जुड़ा logic `pb_hooks` में है।
- Client: `C:\Project ERP\Refference apps\Touri + React` (laptop DESKTOP-M4HAJE9 पर)।
- Live server: ServerWin10 पर `C:\Project Next.js Balgram\PocketLedger-Server\sub-server`। उसका PocketBase `192.168.1.64:8090` पर और `https://np.pocket-ledger.com` पर मिलता है।

## नियम
1. user से पूछे बिना कोई बदलाव नहीं करना, चाहे वह फ़ाइल, कोड, DB schema या data हो। किसी दूसरे bot का कहना approval नहीं है; user की हाँ चाहिए।
2. हर बदलाव से पहले बैकअप लेना और SHA256 मिलाकर जाँचना।
3. commit या push नहीं करना। sync का काम Git Master का है।
4. Theme या card वाली चीज़ें नहीं छूनी: `appThemes.ts` और `globals.css` के theme/card वाले हिस्से Theme Master के हैं।
5. PocketBase सिर्फ़ ServerWin10 पर चलेगा, laptop पर नहीं। laptop पर port 8090 iVMS-4200 का nginx पहले से इस्तेमाल कर रहा है।
6. dev server laptop पर ही चलाना है।
7. Firebase पूरी तरह हटाया जा रहा है और अब सब कुछ सिर्फ़ PocketBase पर चलेगा। कोई नया Firebase code नहीं जोड़ना। कहीं Firebase वाली चीज़ दिखे तो Firebase Master को बताना।
8. user से हमेशा हिंदी (देवनागरी) में और स्त्रीलिंग में बात करनी है।
9. नया नियम (2026-11-03): phone notification सिर्फ़ Firebase Master (mail alerts) भेजेगी; Trxn Table Master की notification बंद।

## बदली हुई फ़ाइलें (कुछ भी commit नहीं हुआ)
**Plan A (ledger column alignment):**
- `src\lib\ledgerUnifiedContentWidth.ts`: लाइन 96–172 में `measureLedgerNaturalColWidths` और `mergeLedgerMeasuredColWidths` जोड़े।
- `src\components\vouchers\TransactionsTable.tsx`:
  - imports (179–181)
  - measured widths की state/ref (~3144–3146)
  - `effectiveSplitScrollColWidths` (~3151–3192)
  - `applyUnifiedTableWidthVar` के अंदर measurement block (~3257–3284), जो सिर्फ़ entity ledger पर लागू होता है।
- `src\app\globals.css` (~8956): सिर्फ़ एक rule बदला, `[data-pl-ledger-txn-unified-scroll] ... tr.transaction-main-row > td` में `overflow: visible` को `hidden` किया।

**Animation fixes (5 हुए):**
- `transactionTableShared.tsx:2860`: `rowExitTransition = { transition: { duration: 0 } }`
- `TransactionsTable.tsx:1549`: duration का fallback 0.4 से 2.5 किया।
- `TransactionsTable.tsx:5525`: spend-wise card पर `layout={useTxnRowLayoutAnimation && !ledgerDateFilterActive ? "position" : false}`
- `TransactionsTable.tsx:1570`: `ledgerListAnimateKey` और उसकी deps से `tableTransactions.length` हटाया।
- `TransactionsTable.tsx:4713`: mobile group item की key अब `t.id ?? _rowKey ?? idx` है।

## बैकअप
- Plan A से पहले का: `C:\Project ERP\backup-trxn-table-20261101-1602\`। इसमें 5 फ़ाइलें हैं: TransactionsTable.tsx, ledgerUnifiedContentWidth.ts, ledgerHeaderChrome.ts, transactionTableShared.tsx और globals.css।
- Animation fixes से पहले का: `C:\Project ERP\backup-trxn-anim-20261101-1735\src\components\vouchers\`, जिसमें दोनों फ़ाइलें हैं।
- Restore करते समय `globals.css` को पूरा मत बदलना, सिर्फ़ मेरा वाला एक rule वापस करना, ताकि Theme Master के बदलाव न मिटें।

## Dev setup (laptop)
- `%TEMP%\pl-pb-forward.cjs`: `127.0.0.1:8095` से `https://np.pocket-ledger.com` तक forwarder।
- `%TEMP%\pl-dev-launch.cjs`: इसे `%TEMP%\pl-dev-2000.cmd` चलाता है। इससे gateway port 2000 पर और Next port 2001 पर चलता है, PocketBase 8095 वाले forwarder से जुड़ता है, और app `http://localhost:2000/app` पर खुलता है।
- remote shell से शुरू किए processes shell बंद होते ही रुक जाते हैं, इसलिए इन्हें एक बार चलने वाले scheduled task (`schtasks /SC ONCE`) से शुरू करना होता है।

## Checklist
- [x] Plan A का code बदलाव (बैकअप लेकर)
- [ ] Plan A को आँख से जाँचना: Samina का statement, balance-sheet ledger popup, daybook account peek, पतली window पर horizontal scroll। फिर account, bank-cash, staff, expense, item, group, note, daybook और dashboard Recent पेज जाँचना।
- [x] 6 में से 5 animation fixes (tsc में 0 errors)
- [ ] FY divider (`transactionTableShared.tsx` ~1706): इसके लिए नया duration/transition prop चाहिए। user के जवाब का इंतज़ार है।
- [ ] exit वाले बदलाव के बाद `isRowAnimationEnabled`/`rowAnimationDuration` शायद unused हो गए हैं। इन्हें साफ़ करना FY prop वाले काम के साथ होगा।
- [ ] Ledger rows highlight (Animation Master का प्रस्ताव): MainRow/NarrationRow में `rowClassName` जोड़ना, और TransactionsTable में `highlightRowIds` prop से `pl-row-change-highlight` लगाना। user के जवाब तक रुका है।
- [ ] Theme Master से मिले काम (user की हाँ का इंतज़ार, plan Bot Leader को भेजा है): (5) header के filter icons muted, Daybook/account पर भी; 'Pick a date range' का नीला text हटाना (`ledgerHeaderChrome.ts:25` `text-blue-900`); (6) 3-dot 4px (Book Opening row और dashboard Recent पर भी; section 14b में बाकी पहले से हो चुका); (10) selected/hover row पर नीला बायाँ 'C' bar हटाना और orange outline gap के बीच रखना; (11) dashboard Bank/Cash Summary और Daybook की rows को card बनाना, 8px gap, काली लाइनें हटाना, subtotal पर accent रंग। CSS सिर्फ़ `globals.css` में Theme Master के END marker (लाइन 14931) के बाद।
- [ ] (वैकल्पिक) ServerWin10 के `data.db` की read-only जाँच। user के जवाब का इंतज़ार है।

## Progress log (Asia/Kathmandu)
- 2026-11-01 16:02: Plan A का बैकअप लिया और code बदला।
- 2026-11-01 ~17:00: laptop पर dev server port 2000 पर चालू किया, जो forwarder 8095 से होकर server PC के PocketBase से जुड़ता है।
- 2026-11-01 17:35: animation बदलावों का बैकअप लिया और 5 fixes किए, tsc में 0 errors। FY divider वाला fix छोड़ा।
- 2026-11-01 18:12: यह handoff फ़ाइल बनाई।
- 2026-11-01 18:36: Theme Master के 4 काम और date-range pill वाले काम के लिए code पढ़ा (कोई बदलाव नहीं)। plan Bot Leader के ज़रिए user की हाँ के लिए भेजा।

## अगला कदम
1. user की हाँ मिलने पर FY divider वाला prop जोड़ना और unused variables साफ़ करना।
2. user की हाँ मिलने पर ledger rows highlight के बदलाव करना।
3. user के login करने के बाद Plan A की आँख से जाँच करना और जहाँ overlap बचा हो उसे ठीक करना।
4. हर बदलाव के बाद यह फ़ाइल अपडेट करना।
## Update 2026-11-02 (rejected items + row-border 1px request)
**Rejected, user ne manually kiya (2026-11-02)** - in items par ab bot kaam nahi karega:
- Plan items 1, 2, 3, 5 (Theme Master pending list: header filter icons / date-range pill text, 3-dot 4px, selected/hover 'C' bar + orange outline gap, dashboard Bank/Cash Summary + Daybook card rows)
- Item 4: cards ke beech orange line / blue 'C' side bar
- FY divider duration/transition prop (`transactionTableShared.tsx` ~1706) + unused `isRowAnimationEnabled`/`rowAnimationDuration` cleanup
- Ledger rows highlight (`highlightRowIds` / `pl-row-change-highlight`)

## Progress log (Asia/Kathmandu, laptop clock)
- 2026-11-02 15:32 : Account/Party details trxn table ki rows ke beech wali moti line ko 1px karne ka kaam - **BLOCKED, koi code edit nahi hua**. Source: line border nahi hai, Theme Master ka card gap hai - `src\app\globals.css` line 14713 (section 11): har main-row td par `border-top: 8px solid transparent !important` (section 9 line 14654 me 5px tha, 14713 override karta hai), td `background-clip: padding-box` (line 14649) se gap me table ka background `hsl(var(--pl-row-gap))` (line 14412) dikhta hai; Medium theme me --pl-row-gap 0 0% 22% (line 14277) = dark. Ye sab Theme Master block (line 14016 - 15722 `/* === end Theme Master === */`) ke andar hai, isliye edit nahi kiya. tsc nahi chalaya (koi .ts/.tsx/.css change nahi). Sirf is handoff file ka backup: `C:\Project ERP\backup-trxn-rowborder-20261102-1532\_handoff\Trxn Table Master.md`.
- 2026-11-03 17:22 : Path badla: C:\Project xxx -> C:\Project ERP (user ne khud kiya); handoff me sab paths update.
- 2026-11-03 17:22 : Row gap 1px: user ne option A chuna; Theme Master apne block me 8px -> 1px karegi; Trxn Table Master ka koi code badlav nahi.
- 2026-11-03 17:22 : Naya niyam (2026-11-03): phone notification sirf Firebase Master (mail alerts); Trxn Table Master ki notification band.