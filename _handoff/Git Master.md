# Git Master — हैंडऑफ़ (दो PC का GitHub sync)

अंतिम अपडेट: 2026-11-02 14:47 (UTC+5:45, नेपाल समय)

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
1. **Sync अभी HOLD पर है।** Tauri migration पूरा होने तक, और यूज़र के खुद बताने तक, कोई commit, push, pull, init या overwrite नहीं करना है। यूज़र की हाँ के बिना कुछ भी push नहीं करना है। (2026-11-02 को यूज़र ने ऐप repo के sync, push और 10 मिनट auto-sync की इजाज़त दी; नीचे 14:47 वाली एंट्री देखें। Tauri फ़ोल्डर अब भी commit नहीं होंगे।)
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

## 10 मिनट auto-sync योजना (2026-11-02 14:45 से दोनों PC पर ऐप repo के लिए चालू है)
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

## 2026-11-02 ~14:47 (नेपाल समय): sync पूरा, auto-sync चालू
- **तीनों एक ही commit पर हैं:** laptop HEAD, server HEAD और `origin/main` तीनों `8dbb355c` पर हैं। दोनों PC के working tree में कोई अनचाहा tracked बदलाव नहीं है।
- **Laptop** ने `42fbbf7f` push किया (14:38 पर origin तब भी `aaef002e` पर था, इसलिए rebase की ज़रूरत नहीं पड़ी)। फिर auto-sync test का commit `8dbb355c` push हुआ। Laptop के 26 `electron/` फ़ाइलों पर skip-worktree बना हुआ है।
- **Server** ने सिर्फ़ fast-forward pull किया (`aaef002e` → `42fbbf7f` → `8dbb355c`)। Server पर कोई commit या push नहीं हुआ, और बिना commit के बदलाव नहीं थे, इसलिए बैकअप की ज़रूरत नहीं पड़ी।
- **package.json:** सिर्फ़ scripts बदले (`electron:*` हटे; `sidecar:build`, `tauri:dev`, `tauri:build`, `release:publish:tauri` जुड़े)। Dependencies और `package-lock.json` नहीं बदले, इसलिए npm install नहीं चलाया। `scripts/dev-web-gateway.cjs` भी बदला (Next के लिए retry, 8 GB memory)।
- **Server का dev server एक बार restart हुआ**, ताकि नया gateway code चले। पुराने PID जाँचकर ही रोके गए, और cloudflared (PID 132) को छुआ नहीं गया। नए PID: cmd 4428, npm 2536, gateway 13124 (:3000), Next 12412 (127.0.0.1:3001)। Log: `D:\PocketLedger-Sync\dev-server.log`। `127.0.0.1:3000/`, `/app` और `https://dev.pocket-ledger.com` तीनों 200 दे रहे हैं।
- **Laptop का dev server छुआ नहीं गया।** `localhost:3000/` और `/app` दोनों 200 दे रहे हैं।
- **Scheduled task `\PocketLedger Git AutoSync`** दोनों PC पर लगा है: हर 10 मिनट, बिना अंत, hidden (conhost --headless), सिर्फ़ user के login रहने पर, Limited। Laptop पर user ASUS, server पर newpa। Last result 0।
  - Scripts: laptop पर `C:\PocketLedger-Sync\`, server पर `D:\PocketLedger-Sync\` (`git-autosync.ps1`, `install-autosync.ps1`)।
  - Logs: laptop पर `C:\Project xxx\git-sync.log`, server पर `D:\PocketLedger-Backups\git-sync.log` (ATTENTION फ़ाइल उसी फ़ोल्डर में बनती है)।
  - रोकना या देखना हो तो: `install-autosync.ps1 -Disable`, `-Enable` या `-Status`।
- **End-to-end test पास हुआ:** laptop पर `_handoff/sync-test.md` बनाई गई। Quiet period में auto-sync ने उसे छोड़ दिया, फिर commit और push किया (`8dbb355c`)। उसके बाद server task ने उसे pull किया, फ़ाइल server पर मौजूद है और HEAD बराबर है।
- **Log फ़ाइलें बाहर रखी गईं:** दोनों PC के `.git/info/exclude` में `*.log` जोड़ा गया (सिर्फ़ local)। Script के secret guard में भी नई `*.log` फ़ाइलें रोकने का नियम जुड़ा। पहले laptop पर लगभग 47 log फ़ाइलें और server पर `dev-server.log` auto-commit हो सकती थीं।
- **बाकी काम:**
  1. Auto-sync के अंदर की `tsc` जाँच अभी test नहीं हुई है (test में सिर्फ़ `.md` फ़ाइल बदली थी)।
  2. `.gitignore` में `*.log` जोड़ना है या नहीं, यह अभी तय नहीं हुआ है।
  3. `pocket-ledger-server` repo अभी भी नहीं बना है।
  4. Tauri फ़ोल्डर (`src-tauri/`, `desktop-sidecar/`, `TAURI-MIGRATION.md`) अब भी laptop के `.git/info/exclude` में हैं और commit नहीं होंगे।

## 2026-11-02 ~15:02 (नेपाल समय): laptop dev server port 2000 पर, PB के लिए pb-proxy
- **क्यों:** port 3000 अब Tauri EXE के लिए है (EXE का app UI 3000–3099 में पहला खाली port लेता है, sharing का default 3001 है)। Laptop पर `127.0.0.1:8090` PocketBase नहीं है, वहाँ Hikvision iVMS-4200 का nginx चलता है। इसी वजह से localhost पर sign-in fail हो रहा था।
- **कोई tracked फ़ाइल नहीं बदली।** सब कुछ repo के बाहर `C:\PocketLedger-Sync\` में है:
  - `start-dev-2000.cmd`: एक ही command दोनों चीज़ें चलाता है। पहले pb-proxy (hidden) चलाता है, अगर 18090 पहले से चालू न हो। फिर `PORT=2000`, `NEXT_INTERNAL_PORT=2001`, `PL_PB_PROXY_TARGET=http://127.0.0.1:18090` और `NEXT_PUBLIC_POCKETBASE_URL=http://localhost:2000/pb` के साथ `npm run dev` चलाता है। Log `dev-server.log` में जाता है और पुराना log `dev-server.prev.log` बन जाता है। अगर 2000 पहले से चालू है तो दूसरा dev server शुरू नहीं होता। पुराना launcher `start-dev-2000.cmd.bak` में रखा है।
  - `pb-proxy.cjs`: सिर्फ़ Node built-ins इस्तेमाल करता है। `127.0.0.1:18090` से `https://np.pocket-ledger.com` (ServerWin10 का PB, Cloudflare tunnel से) पर सब कुछ stream करता है, realtime SSE भी। Log `pb-proxy.log` में सिर्फ़ method, path और status लिखता है। दूसरा instance चलाने पर exit 3 देता है।
- **रास्ता:** browser → `http://localhost:2000/pb` → gateway → `127.0.0.1:18090` → HTTPS → np.pocket-ledger.com → ServerWin10 PB। LAN (`192.168.1.64:8090`) इसलिए नहीं चला, क्योंकि ServerWin10 के firewall में 8090 का कोई inbound rule नहीं है।
- **जाँच:** proxy और `/pb` health दोनों 200 देते हैं और server जैसा ही जवाब देते हैं। `/pb/api/collections` server का 401 देता है। Realtime पर `PB_CONNECT` मिला। `/app` और `/app/dashboard` 200 देते हैं। 3000 और 3001 पर इस dev server का कुछ नहीं है, और git status साफ़ है।
- **Reboot के बाद:** सिर्फ़ `C:\PocketLedger-Sync\start-dev-2000.cmd` चलाएँ। अगर sign-in screen पर अब भी `127.0.0.1:8090` दिखे, तो browser के localStorage से `pl_online_data_server_settings_v1` हटाकर reload करें, या "Server address" में `http://localhost:2000/pb` लिखें।

## 2026-11-02 ~15:25 (नेपाल समय): HR module के लिए अलग worktree (सिर्फ़ laptop)
- फ़ोल्डर: `C:\Project xxx\Refference apps\Touri-HR`. यह `git worktree` है, यानी main repo वाला ही `.git` इस्तेमाल होता है।
- Branch: `feature/hr-module`, main के commit `5181a7c8` से बनी। इसका कोई upstream नहीं है और यह push नहीं हुई है।
- Launcher: `C:\PocketLedger-Sync\start-dev-hr-2100.cmd` (repo से बाहर)।
  - Gateway `:2100` पर और Next `:2101` पर चलते हैं। PB है `http://localhost:2100/pb`, जो pb-proxy `127.0.0.1:18090` से होकर ServerWin10 का PB है।
  - Log: `C:\PocketLedger-Sync\dev-server-hr.log`; पिछला log `dev-server-hr.prev.log` में रहता है।
  - pb-proxy पहले से चल रहा हो तो वही इस्तेमाल होता है। 2100 पर कुछ पहले से चल रहा हो तो launcher नया server शुरू नहीं करता।
- `.env.local` main से copy किया गया है। `node_modules` के लिए `npm ci` सिर्फ़ Touri-HR में चलाया गया।
- main के 26 electron files skip-worktree हैं, लेकिन यह setting हर worktree की अलग होती है, इसलिए HR worktree में वे सामान्य रूप से checkout हैं। Excludes (`src-tauri/`, `desktop-sidecar/`, `TAURI-MIGRATION.md`, `*.log`) दोनों worktree में लागू हैं।
- नियम:
  - auto-sync सिर्फ़ main फ़ोल्डर (`Touri + React`) को sync करता है, Touri-HR को कभी नहीं।
  - `feature/hr-module` तभी push होगी जब user खुद कहे।
  - force push कभी नहीं करना है।
  - main में merge सिर्फ़ user के "हाँ" कहने के बाद होगा।
  - PB schema दोनों का साझा है (एक ही server PB), इसलिए HR के लिए collection या field बदलने से main ऐप पर भी असर पड़ेगा। ऐसा बदलाव user से पूछकर ही करें।

## 2026-11-03 ~16:15 (नेपाल समय): फ़ोल्डर rename, path fix, HR branch push, server worktree
- **Rename:** user ने `C:\Project xxx` का नाम `C:\Project ERP` कर दिया। अब main repo `C:\Project ERP\Refference apps\Touri + React` और HR worktree `C:\Project ERP\Refference apps\Touri-HR` है।
- **Backup (fix से पहले):** `C:\PocketLedger-Backups\pre-path-fix-20261103-1605\` में main का `git bundle --all`, दोनों launcher, task XML और worktree metadata रखे गए हैं।
- **Path fix:**
  - `git worktree repair` चलाया। अब `gitdir` और `Touri-HR\.git` दोनों नए path पर हैं।
  - `start-dev-2000.cmd` और `start-dev-hr-2100.cmd` में नया path डाला गया।
  - Auto-sync task को installer (`-Headless`) से फिर register किया गया, अब `-Repos "C:\Project ERP\Refference apps\Touri + React" -LogPath "C:\Project ERP\git-sync.log"` के साथ। Rename के बाद task ने पुराने path पर एक खाली `C:\Project xxx\git-sync.log` बना दिया था, जो अब इस्तेमाल नहीं होता।
- **Dev server शुरू करने का तरीका:** launcher को `Start-Process cmd.exe -WindowStyle Hidden` से चलाएँ। WMI से चलाने पर शुरू करने वाला shell बंद होते ही server बंद हो गया था।
- **HR push:** `feature/hr-module` पर commit `09fa15b5` ("HR module: employees + attendance") बना और `origin/feature/hr-module` पर push हुआ। उससे पहले `tsc` में 0 errors थे। इस commit में leaves वाली फ़ाइलें भी हैं। Main पर कुछ merge नहीं हुआ।
- **Server worktree:** ServerWin10 पर `D:\Touri-HR` बना, branch `feature/hr-module` (track `origin/feature/hr-module`, HEAD `09fa15b5`)। `.env.local` Online Project से copy किया गया और `npm ci` चलाया गया। Server का auto-sync अब भी सिर्फ़ `Online Project` को sync करता है।
- **HR के नियम:**
  - HR branch को auto-sync कभी sync नहीं करेगा। इसका sync सिर्फ़ हाथ से, Git Master के ज़रिए होगा (commit/pull/push, force कभी नहीं)।
  - Payroll (d)+(e) का काम सिर्फ़ server (`D:\Touri-HR`) पर होगा, `src/modules/hr/payroll/**` और `src/app/(dashboard)/hr/payroll/**` में।
  - Leaves (c) का काम सिर्फ़ laptop (`C:\Project ERP\Refference apps\Touri-HR`) पर होगा।
  - इस बँटवारे से दोनों PC एक ही फ़ाइल नहीं छूते। Main में merge सिर्फ़ user के "हाँ" कहने के बाद होगा।

## अगला कदम
1. यूज़र `pocket-ledger-server` repo बनाए, फिर उसके लिए भी auto-sync लगाया जाए (Cloudflare और डेटा नियम 3–4 के साथ)।
2. यूज़र बताए कि Tauri का काम पूरा हो गया है। तब `.git/info/exclude` से Tauri फ़ोल्डर हटाकर उन्हें commit किया जाए।
3. यूज़र तय करे कि `.gitignore` में `*.log` जोड़ना है या नहीं।
4. किसी `.ts` बदलाव पर auto-sync की `tsc` जाँच देखी जाए।
