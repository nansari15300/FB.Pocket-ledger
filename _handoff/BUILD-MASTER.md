# Build Master — handoff

अंतिम अपडेट: 2026-11-03 23:05 (Asia/Kathmandu, UTC+5:45)

> पहले `_handoff\NIYAM.md` और `TAURI-MIGRATION.md` पढ़ें। यह file सिर्फ़ paths और variable NAMES रखती है — कोई password, key, token या `.env` value यहाँ कभी नहीं लिखनी।

## नक्शा
- **Goal:** Pocket Ledger के सारे builds (Tauri EXE, Android APK/AAB, web/static) सिर्फ़ Build Master करती है — user की "हाँ" के बाद। दूसरा कोई bot build नहीं करता।
- **Repo (laptop DESKTOP-M4HAJE9):** `C:\Project ERP\Refference apps\Touri + React` (`C:\Project xxx\...` अब मौजूद नहीं है, वहाँ कभी न लिखें)
- **ServerWin10 repo:** `C:\Project Next.js Balgram\Online Project`
- **मेरी files:**
  - `scripts\build-android-signed.ps1` — signed APK/AAB script (नीचे देखें)
  - `_handoff\BUILD-MASTER.md` — यह file

## भूमिका
1. Tauri EXE, APK/AAB और web/static build चलाना — सिर्फ़ user की हाँ के बाद।
2. हर build से पहले सबसे पहला काम: key-security जाँच।
3. Keystore सिर्फ़ build के समय खोलना, password environment variable से देना, build के बाद खुली file मिटाना।
4. Build के बाद signer certificate का SHA-256 fingerprint (public) और output paths/version रिपोर्ट करना।

## नियम
1. **Build सिर्फ़ user की हाँ के बाद।** Upload (`release:upload:np`) और Firebase upload भी अलग-अलग हाँ के बाद।
2. **Key-security जाँच पहले** — Key Manager से, या अपने scan से (`build-android-signed.ps1` का Step 1)। कोई hit मिले तो build नहीं।
3. **Git auto-sync:** build से पहले Git Master (id `7c22c979-8b5d-4689-af60-963e277487f1`) को priority से कहना कि laptop का task `PocketLedger Git AutoSync` (हर 10 मिनट) pause करे; build के बाद resume करवाना। (Git Master के scripts: laptop `C:\PocketLedger-Sync\install-autosync.ps1 -Disable / -Enable / -Status`; server `D:\PocketLedger-Sync\`)
4. **Tauri EXE build/upload** — Tauri Master के तरीके से (np.pocket-ledger.com, `npm run release:upload:np`)। नीचे "Tauri" section देखें।
5. **APK/AAB** — APK Master के तरीके से (Capacitor `android\`), signing इस file के script से।
6. **दोनों PC पर build की अनुमति** (user, 2026-11-03 22:51): keystore encrypted रूप में git में है, इसलिए laptop और ServerWin10 दोनों एक ही signature वाला APK बनाएँगे।
   - Tauri Master का पुराना नोट: "ServerWin10 सिर्फ़ git pull करे, build नहीं"। user का नया निर्देश ऊपर है। **अभी के लिए: Tauri EXE build = सिर्फ़ laptop; APK/AAB = किसी भी PC पर।**
7. **Secrets कभी print/log/chat/git में नहीं** — password, keystore content, `.env` values, tokens। सिर्फ़ file names/paths और variable NAMES।
8. **`electron\` folder नहीं हटाना** (न कुछ और)।
9. **बदलाव से पहले backup:** laptop पर `C:\PocketLedger-Backups\`, ServerWin10 पर सिर्फ़ `D:\PocketLedger-Backups\` (C: पर कभी नहीं)।
10. Cloudflare/cloudflared files, PocketBase data (`pb_data`), `.env`/secrets को नहीं छूना। नया Firebase code नहीं (Firebase Master का काम)।
11. Build के बाद बदली version files (`src-tauri\tauri.conf.json`, `src-tauri\Cargo.toml`/`Cargo.lock`, `src\config\releaseVersion.ts`, `package.json` अगर बदला, `android\app\build.gradle`) सिर्फ़ Git Master user की हाँ के बाद commit करेगी। Build Master commit/push नहीं करती।

## मौजूदा versions (2026-11-03 को repo से पढ़े)
| चीज़ | जगह | मान |
|---|---|---|
| Tauri EXE | `src-tauri\tauri.conf.json`, `src-tauri\Cargo.toml` | 1.1.77 (2026-11-04) |
| App release version | `src\config\releaseVersion.ts` | `DESKTOP_APP_VERSION` = 1.1.77, `ANDROID_APP_VERSION` = 1.1.77 (अब Tauri से मेल) |
| Android | `android\app\build.gradle` | versionName `1.1.77`, versionCode `89` (APK अभी build नहीं हुआ) |
| root `package.json` | — | 0.1.0 (app version नहीं है) |
| Android SDK | `android\variables.gradle` | min 22, compile/target 34; applicationId `com.pocketledger.app` |

## Tauri EXE (Tauri Master से)
- **Version bump:** `npm run release:bump` (`scripts\bump-release-version.cjs`); `release:publish` भी bump करता है जब तक `--no-bump` न हो।
- **सिर्फ़ EXE:** `npm run tauri:build` = `build:static` → `scripts\assert-desktop-out.cjs` → `sidecar:build` (Go sidecar → `src-tauri\binaries\pl-sidecar-x86_64-pc-windows-msvc.exe`) → `cargo tauri build --config tauri.release.conf.json`
- **तेज़:** `npm run build:exe:fast` (`build:static:fast` वाला)
- **पूरा release:** `npm run release:publish:tauri` (laptop पर हमेशा `--tauri` के साथ)
- ⚠️ **सावधान:** `scripts\release-publish.cjs` आख़िर में अब भी Firebase Storage/Hosting पर upload करता है — user की हाँ के बिना वह हिस्सा कभी नहीं (Firebase हट रहा है, Firebase Master का काम)। `release-publish.cjs:277` पर एक भटकी हुई `electron:build:win:fast` line है।
- ⚠️ `out\` अगर `pack:pl-server` से बना हो (`/app/_next`) तो Tauri में नहीं चलेगा — `assert-desktop-out.cjs` इसे रोकता है।
- **Output:** `src-tauri\target\release\bundle\nsis\Pocket Ledger Tauri_<version>_x64-setup.exe`
- **Staging:** `releases\` + `releases\latest.json` — `npm run website:stage-releases`
- **Upload:** `npm run release:upload:np` (`scripts\upload-releases-to-pl-server.cjs`) staged EXE/APK/latest.json को **उसी PC** के `pb_public\releases\<date>\` में copy करता है; default path ServerWin10 का `C:\Project Next.js Balgram\PocketLedger-Server\sub-server\pb_public` है। इसलिए upload ServerWin10 पर चलाएँ (staged files वहाँ copy करके) या `PL_SERVER_PB_PUBLIC` set करें। **अभी untested — पहले user से पक्का करें।** `latest.json` के बिना fail होता है।
- **Env var NAMES:** `RELEASE_TAURI`, `WINDOWS_RELEASE_VERSION`, `ANDROID_RELEASE_VERSION`, `RELEASE_DATE`, `RELEASE_SKIP_AAB`, `FIREBASE_STORAGE_BUCKET`, `PL_SERVER_PB_PUBLIC`, `PL_RELEASES_ORIGIN` (default `https://np.pocket-ledger.com`)
- `scripts\serve-out-static.cjs` टूटा है (हटाई गई electron file चाहिए), build के लिए ज़रूरी नहीं।

## Android signing — अभी की स्थिति
- `android\app\build.gradle` का `signingConfigs.release` सिर्फ़ `android\keystore.properties` पढ़ता है (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`)। वह file न हो तो release **debug key** से sign होता है। Env vars नहीं पढ़ता।
- `android\keystore.properties` अभी laptop पर मौजूद नहीं; सिर्फ़ `android\keystore.properties.example` (tracked, placeholders) है।
- `.gitignore` (root): `android/keystore.properties`, `*.jks`, `*.keystore`, `*.pem`, `*.key`, `.env*` (`!.env.example`), `google-services.json`, `*.apk`, `*.aab`, `*.exe`। (`*.p12`, `*.pfx` अभी नहीं — Key Manager जोड़ सकती है।)
- **Laptop पर JDK + Android SDK लग गए (2026-11-04):** JDK Temurin 17.0.21+9 → `C:\Users\ASUS\AppData\Local\Programs\Java\jdk-17.0.21+9` (user `JAVA_HOME`; PATH में नहीं, gradlew JAVA_HOME से चलता है)। SDK → `C:\Users\ASUS\AppData\Local\Android\Sdk` (user `ANDROID_HOME`, `ANDROID_SDK_ROOT`): cmdline-tools 23.0.0, platform-tools 37.0.1, `platforms;android-34`, `build-tools;34.0.0` (apksigner/aapt2 यहीं)। `android\local.properties` (gitignored) का `sdk.dir` अब laptop SDK। Gradle wrapper 8.7 download हो गया। ⚠️ नए sdkmanager.bat में PowerShell से `;` वाले package नाम टूटते हैं — `cmd /c` में quote करके चलाएँ।

## Signing script: `scripts\build-android-signed.ps1`
Flow:
1. **Step 1 — key-security pre-check:** git-tracked + staged files में names (`*.jks *.keystore *.p12 *.pfx *.pem *.key .env*`, `keystore.properties`) और content (`storePassword=`, `BEGIN PRIVATE KEY`, `ghp_`/`github_pat_`/`AKIA`/`xox?-`/`sk-`/`AIza`/`glpat-`, `"private_key":`) खोजता है — encrypted keystore, `-AllowPaths` (Key Manager की मंज़ूर की हुई paths) और content scan में vendored `public/ocr/**` को छोड़कर। कोई hit = abort, सिर्फ़ file names दिखाता है।
2. **Step 2 — decrypt:** पहले ज़रूरी parameters जाँचता है (`-EncryptedKeystorePath`, `-Cipher`, `-KeystoreCredsFile`, alias) — कोई न हो तो साफ़ संदेश के साथ रुकता है। फिर `%TEMP%\pl-sign-<random>` (repo के बाहर, ACL सिर्फ़ current user) में keystore खोलता है। `Invoke-DecryptKeystore`: `-Cipher` न हो तो `cipher not configured, ask Key Manager`; विकल्प `openssl-aes256-pbkdf2` या `gpg-aes256` (दोनों password file से पढ़ते हैं, command line पर नहीं)। कोई cipher hardcode नहीं।
3. **Step 3 — env vars (सिर्फ़ इस process के लिए):** `build.gradle` बदले बिना AGP injected signing: `ORG_GRADLE_PROJECT_android.injected.signing.store.file`, `...store.password`, `...key.alias`, `...key.password`; साथ में भविष्य के लिए `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`। कभी file में नहीं, कभी Write-Host नहीं।
4. **Step 4 — Gradle:** `gradlew.bat --no-daemon assembleRelease` / `bundleRelease`, try/finally में; finally हमेशा temp keystore को random bytes से overwrite करके मिटाता है और env vars साफ़ करता है। `-DryRun` पर Gradle नहीं चलता।
5. **Step 5 — verify:** `apksigner verify --print-certs` (APK) या `keytool -printcert -jarfile` (AAB); सिर्फ़ signer SHA-256, output path, versionName/versionCode। Debug key से sign मिला तो FAIL; `-ExpectedCertSha256` दिया हो और मेल न खाए तो FAIL।
6. **Step 6 — package scan:** APK/AAB entries में `.env`/keystore/cert/`google-services.json` मिले तो warning।

Usage:
```powershell
cd "C:\Project ERP\Refference apps\Touri + React"
# जाँच + decrypt test (Gradle नहीं):
powershell -ExecutionPolicy Bypass -File scripts\build-android-signed.ps1 -BuildType both -DryRun `
  -EncryptedKeystorePath "<Key Manager से>" -Cipher "<openssl-aes256-pbkdf2|gpg-aes256>" `
  -KeystoreCredsFile "<repo के बाहर की properties file>" -KeyAlias "<alias>"
# असली build (user की हाँ + auto-sync pause के बाद): ऊपर जैसा, -DryRun के बिना, साथ में -ExpectedCertSha256 "<SHA-256>"
```
Parameters (default नहीं, ज़रूरी): `-EncryptedKeystorePath`, `-Cipher`, `-KeystoreCredsFile` (repo के बाहर; `storePassword=`, `keyPassword=`, वैकल्पिक `keyAlias=`), `-KeyAlias` (या creds file में `keyAlias`)।
बाकी: `-PasswordFilePath` (default `C:\PocketLedger-Secrets\keystore-password.txt` — **सिर्फ़ encrypted keystore file खोलने का password, keystore का store/key password नहीं**), `-BuildType apk|aab|both`, `-ExpectedCertSha256`, `-OpenSslPath`, `-GpgPath`, `-Pbkdf2Iterations`, `-AllowPaths` (खाली; कोई entry नहीं डाली), `-DryRun`।

**Gradle में सुझाया बदलाव (APK Master/user की हाँ के बाद, Build Master ख़ुद नहीं करेगी):** `signingConfigs.release` में `keystore.properties` न हो तो `System.getenv("ANDROID_KEYSTORE_PATH")`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` पढ़े, और release buildType इन env vars के होने पर `signingConfigs.release` ले (debug fallback नहीं)। तब injected-signing env vars की ज़रूरत नहीं रहेगी।

## Pending (दूसरी bots / user से)
- [ ] **Encrypted keystore अभी बना नहीं है** — Key Manager ServerWin10 पर keystore ढूँढ रही है। Path मिलने पर `-EncryptedKeystorePath` में देना (script में कोई default नहीं)।
- [ ] **Cipher तय नहीं (TBD)** — Key Manager तय करेगी (`openssl-aes256-pbkdf2` / `gpg-aes256` / और कुछ)। `-Cipher` का कोई default नहीं।
- [x] **Decryption password file** (Password Manager): `C:\PocketLedger-Secrets\keystore-password.txt` — laptop और ServerWin10 दोनों पर (48 chars, no trailing newline, ACL user+SYSTEM)। यह सिर्फ़ encrypted keystore file खोलने के लिए है। Value कभी नहीं लिखनी।
- [ ] **Keystore alias / store password / key password का अलग source (TBD)** — Key Manager / Password Manager से; `-KeystoreCredsFile` (repo के बाहर) + `-KeyAlias`।
- [ ] **Key-security नतीजा: FAIL** (user के फ़ैसले तक) — 6 tracked files में Firebase/Google API key (`AIza...`): `google-services.json`, `android/app/google-services.json`, `src/firebase/config.ts`, `src/lib/firebase.ts`, `website/js/firebase-config.js`, `website/dist/js/firebase-config.js`। Untrack करें या allow करें — **user का फ़ैसला बाकी**। तब तक `-AllowPaths` में कुछ नहीं डालना; Step 1 abort करेगा।
- [ ] **`.gitignore` में `*.p12` / `*.pfx`** — user का फ़ैसला बाकी (Key Manager / Git Master के ज़रिए)।
- [ ] **Tauri steps** (Tauri Master से) — ऊपर लिखे; upload flow अभी untested।
- [ ] **APK steps** (APK Master से) — `cap:sync` / `cap:sync:bundled` / `cap:sync:remote` में से कौन-सा, और laptop पर JDK + Android SDK setup।
- [ ] **SHA-256 cert fingerprint** — दोनों PC पर build के बाद मिलाना (`-ExpectedCertSha256`)। मान: _(पहले build के बाद भरना)_

## प्रगति लॉग
| Date/time (Asia/Kathmandu) | क्या किया | बदली files | Backup path |
|---|---|---|---|
| 2026-11-03 ~22:55 | repo docs/scripts/signing पढ़े; script और यह handoff नई files के रूप में बनाईं; कोई build नहीं चलाया | नई: `scripts\build-android-signed.ps1`, `_handoff\BUILD-MASTER.md` (कोई मौजूदा file नहीं बदली) | — (सिर्फ़ नई files) |
| 2026-11-03 ~23:05 | Key Manager के कहने पर: decryption password ≠ store/key password; `-KeystoreCredsFile`/`-KeyAlias`/`-Cipher`/`-EncryptedKeystorePath` बिना default, ज़रूरी; openssl hardcode हटाया (`gpg-aes256` विकल्प जोड़ा); pending अपडेट | `scripts\build-android-signed.ps1`, `_handoff\BUILD-MASTER.md` | `C:\PocketLedger-Backups\build-master-20261103-230204\` |
| 2026-11-04 ~19:00 | key-check PASS (AIza files working tree से हटे; firebaseAdmin.ts में सिर्फ़ error text); tsc PASS; bump 1.1.76→1.1.77 (Tauri 1.1.74→1.1.77, versionCode 88→89); `tauri:build` OK → `Pocket Ledger Tauri_1.1.77_x64-setup.exe` (16.0 MB); static `out\` बना; APK skip (laptop पर JDK/SDK नहीं); np.pocket-ledger.com पर EXE + latest.json (android पुरानी 1.1.75 entry रखी) ServerWin10 pb_public\releases\2026-11-04 में; `_bot-data\Build Master\2026-11-04` में copy। ⚠️ electron\package.json मौजूद होने से stage script Tauri EXE नहीं उठाती (RELEASE_TAURI=1 चाहिए) और पुराना debug APK नए version नाम से stage कर देती है | `src\config\releaseVersion.ts`, `android\app\build.gradle`, `src-tauri\Cargo.toml`, `src-tauri\tauri.conf.json`, `_handoff\BUILD-MASTER.md` | — (Git) |
| 2026-11-04 ~19:55 | ServerWin10 पर debug APK 1.1.77 की कोशिश: दोनों PC HEAD `a3d1945` एक ही; laptop से 12 files का patch (bump + Firebase key हटाना) बना, पर server पर `git apply --check` fail (`src-tauri/Cargo.toml`, `src/lib/firebase.ts`) — line endings अलग (server CRLF, laptop working copy LF/mixed, दोनों autocrlf=true)। नियम के अनुसार रुकी; server पर कुछ नहीं बदला, APK नहीं बना, upload नहीं हुआ | `_handoff\BUILD-MASTER.md` | — (Git) |
| 2026-11-04 ~20:05 | ServerWin10 पर patch दोबारा (`git diff --output`, ascii encoding की गड़बड़ी ठीक) — `git apply` clean; server key-check PASS; `build:static` + `cap sync android` + `assembleDebug` OK; aapt2: versionCode 89, versionName 1.1.77 (DEBUG-signed); upload `pb_public\releases\2026-11-04\app-release-1.1.77.apk` (38.0 MB), latest.json android → 1.1.77, windows 1.1.77, history intact; `_bot-data\Build Master\2026-11-04` में copy; temp patch सब जगह से हटाया | server (uncommitted): `android\app\build.gradle`, `android\build.gradle`, `src-tauri\Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, `src\config\releaseVersion.ts`, `src\firebase\config.ts`, `src\lib\firebase.ts`; deleted: दोनों `google-services.json`, दोनों `firebase-config.js`; laptop: `_handoff\BUILD-MASTER.md` | — (Git) |
| 2026-11-04 ~20:50 | Laptop पर Android build tools: JDK 17 (Temurin zip), Android SDK cmdline-tools + platform-tools + android-34 + build-tools 34.0.0, user env vars, `local.properties` sdk.dir; `java -version`, `gradlew --version` (Gradle 8.7, JVM 17) OK; कोई build नहीं, repo code नहीं छुआ | `android\local.properties` (gitignored), `_handoff\BUILD-MASTER.md` | — |

## अगला कदम
- Key Manager से encrypted keystore path + cipher; keystore alias/store/key password का source; Firebase key files पर user का फ़ैसला।
- user की हाँ के बाद पहले `-DryRun`, फिर असली build; fingerprint यहाँ दर्ज करना।
