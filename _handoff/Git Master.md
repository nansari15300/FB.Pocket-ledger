# Git Master — हैंडऑफ़ (दो PC का GitHub sync)

अंतिम अपडेट: 2026-11-02 14:15 (UTC+5:45, नेपाल समय)

## लक्ष्य
दोनों Windows PC का प्रोजेक्ट GitHub से हमेशा up to date रहे। Windows Task Scheduler से हर 10 मिनट में auto-sync चले और अधूरा या टूटा कोड कभी push न हो।

## PC और फ़ोल्डर
| PC | machineId | ऐप फ़ोल्डर | सर्वर फ़ोल्डर |
|-|-|-|-|
| DESKTOP-M4HAJE9 (लैपटॉप) | 87099f47-479e-481c-afa5-031d443c15b8 | `C:\Project xxx\Refference apps\Touri + React` | `C:\Project xxx\Refference apps\PocketLedger-Server` |
| ServerWin10 | 8fbef226-7949-44a9-ba98-ad7e2d552e16 | `C:\Project Next.js Balgram\Online Project` | `C:\Project Next.js Balgram\PocketLedger-Server` |

ऐप फ़ोल्डर के नाम अलग हैं और यूज़र ने नाम बदलने से मना किया है। इसलिए **दो अलग repo** हैं, और हर repo का root वही फ़ोल्डर है।

## Repos
- ऐप: `https://github.com/nansari15300/Pocket-ledger` (branch `main`)। दोनों PC के ऐप फ़ोल्डर में `.git` पहले से है। Local HEAD `cfdc1ed8` है, जबकि GitHub HEAD `232d05c` नया है, इसलिए sync से पहले इन्हें मिलाना होगा।
- सर्वर: `https://github.com/nansari15300/pocket-ledger-server` (private)। **यूज़र को यह repo बनाना है** (खाली, बिना README)। अभी किसी PC पर इसका `.git` नहीं है।

## Commit identity (दोनों PC पर global सेट है)
- `user.name` = `nansari15300`
- `user.email` = `234381883+nansari15300@users.noreply.github.com` (GitHub noreply; यूज़र का निजी email नहीं डालना है)
- `credential.helper` = `manager`, `pull.rebase` = `true`, `core.longpaths` = `true`
- दोनों PC पर Git Credential Manager से `nansari15300` का login हो चुका है।
- लैपटॉप पर git, node और go PATH में नहीं हैं, इसलिए पूरा path इस्तेमाल करें: `C:\Program Files\Git\cmd\git.exe`, `C:\Program Files\nodejs`, `C:\Program Files\Go\bin`।

## नियम (यूज़र के फ़ैसले)
1. **Sync अभी HOLD पर है।** Tauri migration पूरा होने तक, और यूज़र के खुद बताने तक, कोई commit, push, pull, init या overwrite नहीं करना है। यूज़र की हाँ के बिना कुछ भी push नहीं करना है।
2. अधूरा कोड push नहीं करना है। पिछले लगभग 3 मिनट में कोई फ़ाइल बदली हो तो उस round को छोड़ दें। बदली हुई TS फ़ाइल हो तो ऐप में `npx tsc --noEmit --incremental false` चलाएँ, बदली हुई Go फ़ाइल हो तो उस module में `go vet ./...` या `go build ./...` चलाएँ। जाँच fail हो तो commit न करें।
3. Cloudflare की फ़ाइलें **सिर्फ़ ServerWin10 पर** रहेंगी और कभी git में नहीं जाएँगी: `start-server-and-tunnel.bat`, `stop-server-and-tunnel.bat`, `server-helper.ps1`, `server-helper.sh`, `cloudflared*`, `config.yml`, `cert.pem` और `.cloudflared/`।
4. डेटा फ़ोल्डर sync नहीं होंगे, हर PC का अपना रहेगा: `pb_data/`, `pb_data_backups/`, `pb_public/`, `hosting_deploys/`, `logs/`, `backups/`, `main-server/data/`।
5. Secrets कभी commit नहीं करने हैं: `.env*`, `*.key`, `*.pem`, `google-services.json`, `pl-*-token*.json`, `*access-tokens*.json`। हर commit से पहले यह जाँच करें।
6. Conflict होने पर सर्वर वाला वर्ज़न जीतेगा। 25 अलग सोर्स फ़ाइलों में यूज़र ने सर्वर का नया वर्ज़न चुना है, और लैपटॉप वाला वर्ज़न बैकअप में है।
7. कभी force push नहीं करना है और कुछ delete नहीं करना है। Rebase में conflict आए तो `git rebase --abort` करें, log में लिखें और यूज़र को बताएँ।
8. ServerWin10 के C: पर कोई बैकअप या बड़ी फ़ाइल नहीं रखनी है, D: इस्तेमाल करें।
9. यूज़र से हमेशा हिंदी (देवनागरी) में और स्त्रीलिंग में बात करनी है।

## .gitignore ड्राफ़्ट
दोनों ड्राफ़्ट बॉट के कंप्यूटर पर `/workspace/sync-setup/app.gitignore` और `server.gitignore` में हैं। ये अभी किसी PC पर लगाए नहीं गए हैं। मुख्य नियम: `node_modules/ .next/ out/ dist/ dist-build/ build/ .build-logs/ .data/ android/app/build/ .gradle/ android/app/src/main/assets/public/ src-tauri/target/ src-tauri/gen/ *.apk *.aab *.exe *.log *.tsbuildinfo`, ऊपर के secrets, और सर्वर repo में डेटा और Cloudflare वाले नियम।

## 10 मिनट auto-sync योजना (अभी बना नहीं है)
हर PC पर Task Scheduler में एक PowerShell script लगेगी, ताकि बॉट offline हो तब भी sync चले। Log: लैपटॉप पर `C:\Project xxx\git-sync.log`, ServerWin10 पर D: पर।
1. `git fetch`। अगर न local बदलाव है न remote बदलाव, तो कुछ न करें।
2. Local बदलाव हो तो नियम 2 की जाँच करें, फिर commit करें (message में PC का नाम और समय)।
3. `git pull --rebase`, फिर `git push`।
4. Conflict आए तो rebase abort करें, log में लिखें और यूज़र को बताएँ। Force push कभी नहीं।
यह दोनों repo के लिए चलेगा।

## अब तक क्या हुआ
- दोनों PC का पूरा बैकअप (node_modules, dist, build, .gradle छोड़कर): लैपटॉप पर `C:\Project xxx\backup-20261101-1428`, ServerWin10 पर `D:\PocketLedger-Backups\backup-20261101-1428`।
- दोनों फ़ोल्डरों की तुलना हो गई। सोर्स की 25 फ़ाइलें अलग थीं और हर फ़ाइल में सर्वर वाला वर्ज़न नया था।
- Cloudflare फ़ाइलों की खोज हुई। कोई tunnel credential नहीं मिली, सिर्फ़ scripts और logs मिले।
- लैपटॉप पर Git 2.56, Node v24.13.1 और Go 1.27.0 इंस्टॉल हो गए।
- ServerWin10 पर `tsc` और दोनों Go module की जाँच पास हुई।
- दोनों PC पर git identity सेट हुई और GitHub login हुआ।

## दूसरे बॉट के ध्यान में रखने लायक
- लैपटॉप पर कई बॉट बिना commit किए बदलाव कर रहे हैं: Theme Master, Trxn Table Master, Server master (`pb_public`), Tauri Master और Firebase Master (Firebase पूरी तरह हटाकर सिर्फ़ PocketBase)। Sync शुरू करते समय इन्हें ध्यान में रखें।
- साझा नियम `_handoff\NIYAM.md` में हैं।

## 2026-11-02 की जाँच (सिर्फ़ पढ़ा, कुछ बदला नहीं; सिर्फ़ `git fetch` चलाया)
- यूज़र ने कहा: "git का server file PC पर update करवाना है"।
- GitHub `Pocket-ledger` का latest commit `232d05c` (22 अक्टूबर) है। ServerWin10 का ऐप उससे **7 commit आगे** है (latest `cfdc1ed8`, 31 अक्टूबर) और उसमें 130 बदलाव ऐसे हैं जो commit नहीं हुए। GitHub पर server से नया कुछ नहीं है।
- `pocket-ledger-server` repo अभी भी नहीं बना है।
- यूज़र से Bot Leader के ज़रिए पूछा गया है कि उनका मतलब (a) laptop का नया कोड server पर लाना है, (b) server का कोड GitHub पर डालना है, या (c) कुछ और। जवाब आने तक कोई बदलाव नहीं होगा।

## 2026-11-02 sync की प्रगति
- यूज़र का फ़ैसला: (a) laptop का नया कोड GitHub के ज़रिए server पर लाना है, 10 मिनट वाला auto-sync चालू करना है, और push की इजाज़त है।
- Repo का नाम GitHub पर बदलकर `nansari15300/FB.Pocket-ledger` हो गया है। पुराना URL redirect करता है।
- **Server:** बैकअप `D:\PocketLedger-Backups\pre-sync-20261102-1404` में है (फ़ाइलें और bundle)। Commit `aaef002e` (130 फ़ाइलें) GitHub पर push हो गया है।
- **Laptop:** बैकअप `C:\PocketLedger-Backups\pre-sync-20261102-1405` में है। Local commit `83188cb5` (295 फ़ाइलें) अभी push नहीं हुआ है।
- Tauri का काम अधूरा है: `src-tauri/`, `desktop-sidecar/` और `TAURI-MIGRATION.md` laptop के `.git/info/exclude` में डाले गए हैं (यह सिर्फ़ local है), ताकि यूज़र के कहने तक ये commit न हों।
- Rebase से पहले यूज़र के फ़ैसले चाहिए (Bot Leader के ज़रिए पूछा है): `electron-build.log` हटाना, 4 एक जैसी untracked फ़ाइलें हटाकर अलग रखना, version 1.1.74 या 1.1.73, `CheckForUpdateSettingsRow.tsx` और `pbReadSeam.ts` में किसका बदलाव रखें, और `electron/` फ़ोल्डर को हटाना push करें या नहीं।

## अगला कदम
1. यूज़र `pocket-ledger-server` repo बनाए।
2. यूज़र बताए कि Tauri का काम पूरा हो गया है।
3. फिर नया बैकअप लें, GitHub `232d05c` और local का अंतर देखें, `.gitignore` लगाएँ और secrets की जाँच करें। उसके बाद यूज़र की हाँ लेकर पहला push करें, फिर sync script और scheduled task लगाएँ, और जाँचें कि एक test बदलाव 10 मिनट में दूसरे PC तक पहुँचता है।
