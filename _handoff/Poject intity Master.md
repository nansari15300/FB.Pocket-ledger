# Poject intity Master — handoff

अंतिम अपडेट: 2026-11-01 18:50 (Asia/Kathmandu)

## नक्शा
- Goal: (Bot Leader से मिला, Theme Master से लिया गया) (7) सभी account lists (Parties, Bank/Cash, Loan & Staff, Tax, Income & Expense, Items & Service...) की rows card जैसी, rows के बीच 8px gap; (8) उन lists की नीली lines theme के रंग से मिलें।
- Files/paths:
  - `src\app\globals.css` — Theme Master block, section 14c (~line 14882) और 14d (~line 14896)
- Architecture: account lists `.pl-master-list-ul` / `[data-pl-master-list-chrome]` पर चलती हैं।

## Checklist
- [x] NIYAM.md, README.md, Theme Master.md, Animation Master.md पढ़े (read-only)
- [x] जाँच: Theme Master की file में (7) और (8) पहले से `[x]` हैं, और globals.css में section 14c और 14d मौजूद हैं
- [ ] User/Bot Leader से पुष्टि: क्या किसी list में अब भी कमी दिखती है (कौन सी list, कौन सा theme)?
- [ ] ज़रूरत हो तो plan दिखाकर हाँ, backup, फिर बदलाव

## प्रगति लॉग
| Date/time (Asia/Kathmandu) | क्या किया | बदली files | Backup path |
|---|---|---|---|
| 2026-11-01 18:40 | सिर्फ़ जाँच (read-only), यह file बनाई | `_handoff\Poject intity Master.md` (नई) | — (कोई code नहीं बदला) |
| 2026-11-01 18:50 | Theme Master का फ़ैसला: 14c/14d नहीं छूना; मेरा अलग section `/* === Poject intity Master: account lists === */` Theme Master के END marker के बाद। Static audit (read-only): 14d सिर्फ़ `border-blue-*` पकड़ता है, `bg-blue-*` नहीं। संभावित बचे नीले हिस्से: `MasterListViewShell.tsx` L75/L96 (`bg-blue-100/80` desktop strip + mobile dock panel; 14482 dock panel सिर्फ़ Medium/Dark में), `EntityListQuickFilterBar.tsx` L73, `ReceivablesPayablesDialogEntityList.tsx` L50/51/756। App चलाकर visual जाँच नहीं हुई (dev server नियम)। | — | — |

## अगला कदम
- Bot Leader के ज़रिए user से पूछना कि 14c/14d के बाद भी कौन सी list या कौन सी नीली line ठीक नहीं दिख रही; उसके बाद ही plan और बदलाव।