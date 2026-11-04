# Account Details Master

अंतिम अपडेट: 2026-11-04 08:06 (Asia/Kathmandu)

## नक्शा
- लक्ष्य: Pocket Ledger के Account Details पेज और Group Details पेज का UI, डेटा, बग और नए फ़ीचर संभालना।
- Project path: `C:\Project ERP\Refference apps\Touri + React` (3 नवंबर 2026 को user ने `C:\Project xxx` का नाम बदलकर `C:\Project ERP` किया)।
- मुख्य files: `src\components\account\AccountDetails.tsx`, `src\components\account\AccountGroupDetails.tsx`।
- Ledger header strip की shared class `.pl-ledger-header-ribbon-wrap` (`src\app\globals.css`, `src\lib\ledgerHeaderChrome.ts`) से आती है।
- नियम: बदलाव से पहले user की हाँ और backup (`C:\PocketLedger-Backups\`); commit/push नहीं; Firebase code नहीं (सिर्फ़ PocketBase)।

## Checklist
- [x] Header strip (white/blue) को theme से मिलाने की जाँच और plan (विकल्प 1/2/3)
- [x] Header strip बदलाव (`globals.css:277`, विकल्प 1): **REJECTED** — user ने खुद manually कर दिया; मैंने कोई code नहीं बदला
- [x] Reminder फ़ेज़ 1: UI में "Alarm" → "Reminder" (सिर्फ़ दिखने वाले शब्द), EntityAlarmPopup में सिर्फ़ due reminders (हर 30 सेकंड जाँच), नया `LedgerHeaderReminderButton` (15 detail पेजों पर Print के दाईं ओर), `/messages?tab=alarms` से form prefill, समय field (खाली होने पर 10:00)
- [ ] Reminder फ़ेज़ 2: shared store, Outstanding popup, localStorage import, `(dashboard)/layout.tsx` scheduler, Extend/snooze

## प्रगति लॉग
| Date/time (Asia/Kathmandu) | क्या किया | बदली files | Backup path |
|---|---|---|---|
| 2026-11-01 18:40 | Header strip का कारण खोजा, 3 विकल्पों वाला plan बनाया (read-only) | कोई नहीं | — |
| 2026-11-02 14:02 | User के कहने पर header strip का काम रद्द (user ने manually किया) | कोई नहीं | — |
| 2026-11-03 17:25 | यह handoff फ़ाइल बनाई, नया project path दर्ज किया | `_handoff\Account Details Master.md` | — (नई फ़ाइल) |
| 2026-11-04 08:06 | Reminder फ़ेज़ 1 लागू किया (commit/push नहीं); `npx tsc --noEmit` में 0 errors | `src\app\(dashboard)\messages\page.tsx`, `src\components\messages\{AlarmsTab,AlertsTab,AlarmPopup,EntityAlarmPopup}.tsx`, नई `src\components\vouchers\LedgerHeaderReminderButton.tsx`, detail पेज: `party\{PartyDetails,GroupDetails}`, `account\AccountDetails`, `bank-cash\{AccountDetails,AccountGroupDetails}`, `expenses\{ExpenseAccountDetails,ExpenseGroupDetails}`, `items\{ItemDetails,ItemGroupDetails}`, `payee\PayeeDetails`, `staff\{StaffDetails,StaffGroupDetails}`, `tax\{TaxDetails,TaxGroupDetails}`, `modules\loans\components\LoanDetails` | `C:\PocketLedger-Backups\reminder-phase1-20261104-0757\` |

## अगला कदम
- Reminder फ़ेज़ 2 (user की हाँ के बाद): Firebase Master से `src\lib\pocketbaseData\reminders.ts` लेना, shared reminder store, Outstanding popup को नए store से जोड़ना, पुराने localStorage reminders का import, `(dashboard)/layout.tsx` में scheduler, Extend/snooze।