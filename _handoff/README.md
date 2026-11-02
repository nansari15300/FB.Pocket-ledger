# `_handoff` — bots के लिए handoff folder

अंतिम अपडेट 2026-11-01 (Asia/Kathmandu)

## यह folder क्यों है
ताकि कोई भी bot (किसी भी account पर) किसी दूसरी bot का काम बिना जानकारी खोए आगे बढ़ा सके।

## नियम
1. हर bot अपनी अलग file रखेगी: `_handoff\<BotName>.md` (जैसे `_handoff\Theme Master.md`)।
2. उस file में ये हिस्से होंगे:
   - **नक्शा** — goal, files/paths, architecture
   - **checklist** — `[ ]` बाक़ी, `[x]` पूरा
   - **प्रगति लॉग** — date/time (Asia/Kathmandu), बदली गई files, backup path
   - **अगला कदम**
3. हर बदलाव के बाद अपनी file update करनी है।
4. नई bot पहले `NIYAM.md` पढ़े, फिर अपनी file पढ़े, और वहीं से काम आगे बढ़ाए।
5. दूसरी bot की file बदलने से पहले user से पूछना (देखें `NIYAM.md`)।

## Template
```markdown
# <BotName> — handoff

अंतिम अपडेट: YYYY-MM-DD HH:MM (Asia/Kathmandu)

## नक्शा
- Goal:
- Files/paths:
  - `...`
- Architecture:

## Checklist
- [ ] ...
- [x] ...

## प्रगति लॉग
| Date/time (Asia/Kathmandu) | क्या किया | बदली files | Backup path |
|---|---|---|---|
| YYYY-MM-DD HH:MM | ... | `...` | `C:\PocketLedger-Backups\...` |

## अगला कदम
- ...
```

## Links
- [`NIYAM.md`](NIYAM.md) — सभी bots के साझा नियम
- [Tauri Master: `../TAURI-MIGRATION.md`](../TAURI-MIGRATION.md) — यह file अपनी जगह पर ही रहेगी: `Touri + React\TAURI-MIGRATION.md`
