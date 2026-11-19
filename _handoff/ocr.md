# OCR handoff

यह फाइल Pocket Ledger के OCR काम का साझा प्लान है। कोई भी bot यही तरीका अपनाए।

## Google Cloud Vision online OCR (server side)

आखिरी अपडेट: 2026-11-10 22:51 (Asia/Kathmandu)

यह सेक्शन **server side** का पूरा प्लान है: PocketBase collections, migrations, JS hooks, और `/api/ocr-cloud/*` endpoints। Client के local OCR folders (`src/modules/ocr`, `src/lib/ocr`, `tests/ocr`) यहाँ के मालिक नहीं हैं। कोई भी secret value इस फाइल में नहीं लिखी गई है।

### मालिक और तालमेल

| Bot | जिम्मेदारी |
|---|---|
| **OCR Master** | Client OCR folders का मालिक: `src/modules/ocr/**`, `src/lib/ocr/**`, `tests/ocr/**`। दूसरे bot ये फाइलें न बदलें। |
| **Allrounder 1** | Server side: PocketBase collections, migrations, JS hooks, पाँच `/api/ocr-cloud/*` endpoints। ऊपर वाले OCR folders न छुए। |
| **Allrounder 2** | Client wrapper `src/lib/ocrCloudApi.ts`। ये wrapper इन्हीं endpoint नामों पर बना है — नाम न बदलें। |
| **Key Manager** | Vision key का encryption डिज़ाइन (नीचे वही डिज़ाइन है; बदलना हो तो Key Manager से मिलाकर अपडेट करें)। |
| **Git Master** | अकेला commit / push करता है। दूसरे bot commit, push, stash या reset न करें। |
| **Build Master** | Build करता है। |

रास्ते (laptop **DESKTOP-M4HAJE9**):

- App repo: `C:\Project ERP\Refference apps\Touri + React`
- असली PocketBase server: `C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\`
- PocketBase version: **0.40.6** (windows_amd64)
- App repo के अंदर खाली `PocketLedger-Server` folder एक पुराना gitignored stub है। काम sibling folder में करें।

### फाइलों की जगह

Server पर नया काम (Allrounder 1):

- Migration: `pb_migrations/1763200000_ocr_cloud.js` (मौजूदा latest `1763100000_logs_retention.js` के बाद)
- Hooks: `pb_hooks/ocr_cloud.pb.js` और `pb_hooks/lib/ocr_cloud.js` (मौजूदा शैली: `routerAdd`, `$apis.requireAuth("pl_users")`, `require(__hooks + '/lib/...')`, `e.app` / `e.json`)
- Launcher (env सेट करने के लिए; key की value कभी print/echo न करें): `start-server.bat`, `server-helper.ps1`
- Live data: `pb_data/` — Git में नहीं जाती

Client (Allrounder 2, पहले से मौजूद):

- `src/lib/ocrCloudApi.ts`

Company id हमेशा `pl_companies.app_id` से resolve करें — `data_api.js` जैसा तरीका। App `company` के रूप में app id भेजता है, PocketBase record id नहीं।

### Collections और fields

तीनों collections की **सारी पाँच API rules null** रहें (`listRule`, `viewRule`, `createRule`, `updateRule`, `deleteRule`)। सिर्फ superuser / hooks पढ़ें-लिखें। Client सीधे इन collections को न छुए।

#### `user_vision_keys`

- `user` — relation `pl_users`, required, unique index
- `key_enc` — text, Hidden (encrypted key)
- `key_last4` — text
- `enc_version` — number, शुरू में `1`
- `created` / `updated` — autodate

अलग `iv` field नहीं चाहिए। `$security.encrypt` खुद AES-256-GCM करता है। हर save पर नई ciphertext बननी चाहिए।

#### `company_ocr_access`

- `company` — relation `pl_companies`, unique
- `keyOwner` — relation `pl_users` — **सिर्फ server सेट करे**। Client का भेजा हुआ admin / keyOwner id कभी trust न करें।
- `enabled` — bool (उस company पर Google OCR चालू/बंद)
- `allowedUsers` — relation `pl_users`, multi (जिन shared users को OCR चलाने की इजाजत है)
- `created` / `updated`

#### Optional: `pl_ocr_usage_daily` (daily cap के लिए)

- `day`, `company`, `user`, `count`
- Unique index: `day` + `company` + `user`
- Daily cap **default बंद (off)** रहे।

मौजूदा role model (इसी का इस्तेमाल करें, नया मत बनाएँ):

- `pl_users` (auth)
- `pl_companies` — `app_id`, `owner` (relation), `owner_email`, `members` / `editors` (hooks से derived)
- `pl_company_members` — `company`, `user`, `email`, `display_name`, `role`, `status` (`active` / `invited` / `revoked`), `permissions`, `app_id`
- Roles: `owner`, `SuperAdmin`, `CompanyAdmin`, `manager`, `accountant`, `editor`, `data-entry`, `User`, `Viewer`, `Distributor`
- **Admin** इस फीचर में: `owner`, `SuperAdmin`, `CompanyAdmin` (`data_api.js` के `MANAGE_ROLES`)। App का role `"admin"` DB में `CompanyAdmin` के रूप में लिखा जाता है।
- **Shared user**: उसी company का `status = active` member, पर `MANAGE_ROLES` में नहीं।

### पाँच endpoints

Auth सब पर: `$apis.requireAuth("pl_users")`।

Error body: `{ code, message }`। Client `code` या `data.code` पढ़ता है, और `message` भी। Boolean fields असली `true` हों (client `v === true` चेक करता है)।

Server के error codes:

- `disabled`
- `no_key`
- `forbidden`
- `quota`
- `network`

Client खुद यह भी मैप करता है: HTTP 401 → `not_signed_in`, 403 → `forbidden`, 429 → `quota`, 0 या 502+ → `network`।

नाम न बदलें (client इन्हीं पर बना है)।

#### 1. POST `/api/ocr-cloud/key`

- Request body: `{ key }`
- सिर्फ admin (owner / SuperAdmin / CompanyAdmin), और active member
- Shared user: **403**, कोई key जानकारी नहीं
- Key: trim करो; लगभग 39 अक्षर; `AIza` से शुरू हो; key को response या log में कभी न दोहराओ
- छोटा Vision validate call; header `X-Goog-Api-Key` (कभी URL में `?key=` न लगाओ)
- Success: `{ saved: true, last4 }` (client अभी body ignore कर सकता है, फिर भी यही shape रखें)

#### 2. DELETE `/api/ocr-cloud/key`

- Body नहीं
- वही admin check
- उस signed-in admin की `user_vision_keys` row मिटाओ
- Shared user: **403**

#### 3. GET `/api/ocr-cloud/status?company=<app_id>`

Success:

```json
{
  "serverOcrEnabled": true,
  "isAdmin": true,
  "hasKey": true,
  "keyLast4": "xxxx",
  "companyEnabled": true,
  "canUse": true,
  "sharedUsers": [
    { "userId": "...", "name": "...", "email": "...", "allowed": true }
  ]
}
```

- `keyLast4` और `sharedUsers` **सिर्फ admin** को। `sharedUsers` में `userId` या `id` दोनों चलेंगे; `name` / `email` optional; `allowed` boolean।
- Shared user को सिर्फ यह दिखे कि फीचर on है या off: `serverOcrEnabled`, `companyEnabled`, `canUse`, `isAdmin: false`। **कोई key जानकारी लीक न हो** — `keyLast4` न भेजें, `sharedUsers` न भेजें, और `hasKey` से यह न पता चले कि key है या नहीं। असल द्वार `canUse` है।

#### 4. POST `/api/ocr-cloud/company`

- Request body: `{ company, enabled?, sharedUserId?, allowed? }`
- सिर्फ admin
- Company पर OCR on/off, और/या एक shared user को allow/deny
- `keyOwner` server खुद सेट करे (जिस admin/owner की key लगेगी) — client से कभी नहीं

#### 5. POST `/api/ocr-cloud/vision`

- Request body: `{ company, imageBase64, languageHints? }` (client `data:` prefix हटा देता है; raw base64 आती है)
- Success: `{ text, pages?: [{ text, ... }] }` — Vision `DOCUMENT_TEXT_DETECTION` के `fullTextAnnotation` से
- Client timeout: 60 सेकंड
- **Client का भेजा हुआ admin / keyOwner id कभी trust न करें** (भेजना ज़रूरी भी नहीं)
- पहले चेक: `e.auth.id` उस company का **active member** है, या `pl_companies.owner` है? नहीं तो generic **403**
- फिर server खुद key owner निकाले (`company_ocr_access.keyOwner` / role model) और उनकी `user_vision_keys` पढ़े
- Shared users की OCR **उसी company admin/owner की key** से चले। Key सिर्फ server पर decrypt हो; client को कभी न जाए
- अगर admin के पास key नहीं: shared user को generic **"not available"** दो (code `disabled` या `forbidden`; कभी `no_key` नहीं; last4 नहीं)
- Admin को `no_key` मिल सकता है
- Permission: server OCR चालू, company `enabled`, और (caller admin हो या `allowedUsers` में हो)
- Server या company बंद हो तो `{ code: "disabled" }`
- Request size limit रखो। Per-user और per-company rate limit। Optional daily cap पार हो तो HTTP 429 `{ code: "quota" }`
- Vision call: header `X-Goog-Api-Key`; कभी `?key=` नहीं
- Google का raw error body / headers आगे न भेजो। नेटवर्क फेल → `{ code: "network" }`

### Encryption (Key Manager का डिज़ाइन)

- Master key env का नाम: `PL_VISION_MASTER_KEY`
- लंबाई ठीक **32 characters**
- हर handler के अंदर `$os.getenv` से पढ़ो; **cache न करो**
- Missing हो या length 32 न हो: generic HTTP **500** `"OCR service not configured"` (fail closed)
- Encrypt / decrypt सिर्फ `$security.encrypt(...)` और `$security.decrypt(...)` (AES-256-GCM)। अपना crypto न लिखो
- हर save पर नई ciphertext
- कभी log न करो: key, ciphertext, request body, headers, पूरा exception object

### Master key फाइल और per-server नियम

- फाइल का path: `C:\PocketLedger-Secrets\vision-master-key.txt`
- इस फाइल की **value कभी न पढ़कर इस प्लान या log में लिखें**
- Launcher (`start-server.bat` / `server-helper.ps1`) इस फाइल से `PL_VISION_MASTER_KEY` सेट करे; value echo/print न हो
- **हर server की अपनी अलग key file** होती है (उदाहरण: laptop और ServerWin10 अलग)
- जब server को `pb_data` के साथ दूसरी मशीन पर ले जाएँ, **key file भी साथ कॉपी करें** — नहीं तो पुरानी encrypted keys खुल नहीं पाएँगी
- इस फाइल को **कभी बदलें या मिटाएँ नहीं** (जब तक user या Key Manager साफ आदेश न दें)
- **Git में कभी न डालें**

`pb_data/` Git में नहीं जाती (`**/pb_data/` gitignore में है) और दो PC के बीच अपने आप sync नहीं होती। हर मशीन का अपना data है, जब तक कोई बाहरी copy न की जाए।

### Server switch (OCR बंद)

कोई अलग app-setting doc इस नाम से नहीं मिला: `"OCR off"`। मौजूदा server switch यह है:

- Plan entitlement: `ocrVoucherAutofillEnabled` (`app_settings/plans`)
- Company override: `company.settings.ocrVoucherAutofillEnabled`
- Field गायब हो तो **चालू (enabled)** माना जाए
- यह **false** हो तो पूरा online OCR बंद रहे: हर संबंधित endpoint `{ code: "disabled" }`; status में `serverOcrEnabled` / `canUse` false
- Client header का लेबल "OCR Off" एक local UI toggle है, यह server switch नहीं है

### Daily cap

- Optional collection: `pl_ocr_usage_daily` (ऊपर fields देखें)
- **Default: बंद (off)**
- बाद में चालू हो तो दिन की limit पार होने पर HTTP 429 `{ code: "quota" }`

### Rate limits

Vision (और ज़रूरत हो तो key validate) पर दोनों लगाएँ:

- per-user rate limit
- per-company rate limit

मौजूदा पैटर्न दोहराएँ: `pb_hooks/lib/site_data.js` का `app.store()` limiter, या signup जैसा `rateLimitedKey`। पार होने पर HTTP 429 `{ code: "quota" }`। बड़ी `imageBase64` रोकने के लिए request size limit भी रखें।

### Logging नियम

इन चीज़ों को कभी log, console, या error response में न लिखें:

- Vision API key, master key, ciphertext
- request body, headers
- पूरा exception object
- Google का raw error body

Generic message काफी है।

### Frontend key-input नियम (Allrounder 2 / UI)

- Input: `type="password"`, `autocomplete="off"`
- Key को device, `localStorage`, या memory cache में **न रखें**। सिर्फ submit के समय server को भेजें
- Submit के बाद field **साफ** कर दें
- Key वापस पढ़ने का कोई GET नहीं। Client को पूरी key लौटती नहीं। सिर्फ admin को status में `keyLast4` दिखे

### टेस्ट का तरीका

- सिर्फ नकली keys: `AIzaTEST...`। असली key टेस्ट में न लगाएँ
- PocketBase hook test runner अभी प्रोजेक्ट में नहीं है। Local PocketBase पर छोटा HTTP script चलाएँ, या helpers के unit test लिखें
- कम से कम ये केस कवर करें:
  - Admin: save, status, company, vision
  - Shared user: key save/delete पर 403; status में कोई key जानकारी नहीं
  - Vision admin/owner की key इस्तेमाल करे, भले client owner id न भेजे
  - Non-member: generic 403
  - Key न हो: shared user को generic "not available"; admin को `no_key`
  - `disabled` और `quota`
  - Master key missing: generic 500, कोई secret नहीं
- `npm run test:ocr` OCR Master के client selftests हैं — उन्हें न तोड़ें, उन folders को न छुएँ

### आम नियम

- **Backup न बनाएँ** (user का नियम)
- **Firebase इस्तेमाल न करें** — सिर्फ PocketBase
- **Commit / push सिर्फ Git Master** करे। दूसरे bot न करें
- **Secrets** कभी print, log, chat, या Git में न जाएँ
- Endpoint नाम `/api/ocr-cloud/*` न बदलें
- Allrounder 1 ये न छुए: `src/modules/ocr/**`, `src/lib/ocr/**`, `tests/ocr/**`
- Server endpoints तैयार होने पर OCR Master और Bot Leader को file list और टेस्ट का नतीजा बताएँ

## Azure Computer Vision (Image Analysis 4.0 Read) — 2026-11-11

कंपनी एडमिन OCR सेटिंग्स में **Google** या **Azure** चुन सकता है। एक समय पर एक ही प्रोवाइडर की कुंजी सहेजी जाती है (नया सेव दूसरी कुंजी को बदल देता है)।

### सर्वर

- नया migration: `sub-server/pb_migrations/1763700000_ocr_azure.js` — `user_vision_keys` पर वैकल्पिक फ़ील्ड `provider` (text, max 16) और `endpoint` (text, max 300)। Idempotent (फ़ील्ड पहले से हो तो छोड़ देता है)। पुरानी पंक्तियाँ बिना `provider` के Google मानी जाती हैं। `1763200000` न छुएँ।
- Hook: `pb_hooks/lib/ocr_cloud.js` — Azure Image Analysis 4.0 `POST {origin}/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read`, हेडर `Ocp-Apim-Subscription-Key`, बॉडी `application/octet-stream` (JSVM में `$filesystem.fileFromBytes(...).reader.open()` को `$http.send` io.Reader के रूप में)। जवाब `readResult.blocks[].lines[].text` को मौजूदा `{ text, pages }` आकार में बदला जाता है।
- Endpoint SSRF जाँच: सिर्फ़ `https` और होस्ट `*.cognitiveservices.azure.com` या `*.api.cognitive.microsoft.com` (कोई IP, localhost, credentials, या नकली होस्ट नहीं)। स्टोर में सिर्फ़ origin; status में सिर्फ़ `endpointHost`।
- Azure कुंजी प्रारूप: 32-अंकीय hex। Google `AIza…` वैसा ही।
- त्रुटि मैपिंग: Azure 401 / अवैध कुंजी → `no_key`; 429 → `quota`; क्षेत्र/feature-not-supported → `region_unsupported` (साफ़ संदेश, raw Azure बॉडी नहीं)।
- Azure दर: लगभग 20 कॉल/मिनट (`PL_OCR_AZURE_RATE` / `PL_OCR_AZURE_COMPANY_RATE`, डिफ़ॉल्ट 20)। F0 सीमा: 20/मिनट, 5000/महीना।
- टेस्ट ओवरराइड: `PL_OCR_AZURE_URL` (उत्पादन में सेट न करें)। `getMasterKey` और Google व्यवहार अपरिवर्तित।

### क्लाइंट

- OCR सेटिंग्स: प्रोवाइडर रेडियो (Google / Azure), Azure पर endpoint फ़ील्ड, मौजूदा Save / Test, F0 संकेत, और चेतावनी कि सेव दूसरी कुंजी बदल देता है।
- `src/lib/ocrCloudApi.ts` (Allrounder 2): केवल additive — `saveOcrCloudKey` पर वैकल्पिक `provider`/`endpoint`; status में वैकल्पिक `provider`/`endpointHost`; त्रुटि कोड `region_unsupported`। पुराने Google-only कॉल वैसे ही काम करते हैं।

### डिप्लॉय (Server master)

एक साथ कॉपी करें, फिर PocketBase restart: migration `1763700000_ocr_azure.js` + `pb_hooks/lib/ocr_cloud.js`। Router `ocr_cloud.pb.js` नहीं बदला। Migration के बिना Azure सेव 500 देगा।

### खुला / सावधानी

Microsoft दस्तावेज़ के अनुसार कुछ क्षेत्रों (जैसे Central India) में Image Analysis 4.0 Read उपलब्ध नहीं हो सकता। लाइव कुंजी से जाँचें; अगर क्षेत्र असमर्थित हो तो UI `region_unsupported` दिखाएगा। Nepali / Devanagari मुद्रित पाठ Read में समर्थित है।

## Online only + Read by ? 2026-11-11

Ansari Ji ?? ??? ?? (?? ??? ??? server `ocr_cloud.js` ?? `src/lib/ocrCloudApi.ts` ???? ???; commit/push ????):

### Online only

- `src/modules/ocr/prefs.ts`: `OcrEnginePref` ??? `"online"`; `normalize()` ??? ???? ??? ?????? device-local `localStorage` key `pl.ocr.prefs.v1` ??? ???? ???
- ?????? ?????? (`VoucherOcrHeaderToggles.tsx`): Auto / Offline only / **Online only** ("Always online OCR, no offline fallback")? Hint ?? ???? ?? ?? Auto offline ?? ??? ???? ??, Online only ????? Server OCR ??? ???? ??, ?? shared user ?? ???? ?????? ?? ??, ???? ?????? ????? ????
- `src/modules/ocr/engine.ts` `runOcrOnFile`: pref `"online"` ?? tesseract ???? ????; `cloud.note` ?? `"Online OCR failed"` ?? ??? Error ?????? ??? `useVoucherOcr` ???? ?? `toast.error("OCR failed", { description })` ?????? ???

### Read by

- ????? OCR ??? (`VoucherOcrRefreshBar.tsx`, Refresh OCR ?? ???) ?? ???: **Read by: Local** (tesseract), **Read by: Google**, ?? **Read by: Azure**? ??? cloud fail ???? Local ?? ???? ?? ?? `engineNote` ??? ?? `title` (tooltip) ??? ????? ???
- ?????????: ??? vision response ??? `provider` ?? ?? ???; ???? `getOcrCloudStatus` ?? `status.provider`? ??? `ocrCloudApi.ts` (`ocrCloudVision`) vision JSON ?? `provider` ???? ?????, ????? ??? status.provider ?? ?????? ??? Vision response ??? server ?? `provider` ?????? ?????? ??????? ???? ???? (Allrounder 2 / server hook) ? ?? ??? ??? ?? ?????? ???? ???? ????

## Azure table layout (line items / totals) ? 2026-11-11

Azure Read ?? ???? ??? ?? ??? line ???? ??, ?? ???? hook ?????? `{ text }` ?????? ?? (??? bounding box ????)? Client `cloudRaw` ???? y ???? ???? `words` ????? ??, ????? debug dump `L0 y=40:` ???? ????? ?? (dump `line.text` ????, `words` ????? ??) ?? parser ?? header / qty?rate=amount ?? ?????? ??? ???? ????? ???

Fix (Ansari Ji: plan ?ahi, ???? fix; server PC ?? deploy ????; commit ????):
- Server `sub-server/pb_hooks/lib/ocr_cloud.js` `parseAzureResult`: `readResult` lines + `boundingPolygon` / words ?? Google-???? `pages[].blocks[].paragraphs[].words` + `width`/`height` (metadata) ??? ??? ???? ??? `ocrCloudApi.ts` ???? ??? ? `pages` ?? extra fields ???? ?? pass-through ????
- Client `cloudRaw.ts` + `engine.ts`: boxes ?? visual row group; parser `ALT QTY` ?? qty ???? ???? ?????; `39,800` ? 39.800 ?? rate?qty=amount ????; `3,097 20` ? 3097.20?
- Tests: `tools/ocr-cloud-test.mjs` polygon mapping; `tests/ocr/pratikAzureLayout.selftest.mts` 14 lines + totals? Deploy Server master + Ansari Ji ?? ??? ???

## Azure text-only (बिना word boxes) — line items / totals — 2026-11-12

समस्या: live server का `ocr_cloud.js` (40884 B) Azure का सिर्फ़ `pages: [{ text }]` देता है, कोई box नहीं। Client हर text line को अलग line बनाता था, `words` खाली रहते थे। Parser का header / qty×rate=amount / totals वाला हिस्सा `words` और एक ही line पर label+amount माँगता है, इसलिए Pratik बिल में items और total नहीं भरे (dump में `L0 y=40:` खाली दिखता था)।

Fix (OCR build `2026-11-12.1`, सिर्फ़ client, server deploy ज़रूरी नहीं; commit नहीं हुआ):
- नई `src/modules/ocr/cellTable.ts`: एक-cell-प्रति-line वाला table पहचानती है (S.N / HS CODE / PARTICULARS / ALT QTY / QTY / UOM / RATE / AMOUNT), cells को qty×rate=amount से item row में जोड़ती है (S.N न हो या "12 8311" जुड़ा हो तब भी), QTY लेती है ALT QTY नहीं। Totals: "SUB TOTAL" / "DISCOUNT" / "TAXABLE AMOUNT" / "VAT 13%" / "GRAND TOTAL" को आगे वाली amount line से जोड़ती है।
- `parser.ts` `prepareOcrRawForParse`: जब किसी line में box नहीं, तब `cellTable` चलता है; rows को header column के x पर रखा जाता है ताकि मौजूदा header parser वैसे ही चले।
- `cloud/cloudRaw.ts`: geometry rows में raw text के 50% से कम अक्षर हों (या words में text न हो) तो text lines पर fallback; खाली rows नहीं बनतीं।
- `useVoucherOcr.tsx`: dev dump में box न हो तो `(no boxes) <text>` दिखता है।
- Test: `tests/ocr/pratikAzureText.selftest.mts` (असली raw text, 4 हालात: `[{text}]`, pages नहीं, खाली-text words, कम geometry) → 12 items + 84,343.30 / 10,964.63 / 95,307.93। सारे `tests/ocr/*.selftest.mts` pass, `npm run typecheck` pass, `tools/ocr-cloud-test.mjs` 55/55।
- 43595 B geometry वाला lib deploy होने पर भी यह fallback नुकसान नहीं करता (geometry सही हो तो वही चलती है)।

## AI (Gemini) OCR engine — server handoff — 2026-11-12

> **Deployed:** Server Master ने 2026-11-12 को 10:19 NPT पर तीनों files deploy कीं (lib `ocr_cloud.js` 65278 B, router `ocr_cloud.pb.js` 1580 B, migration `1763800000_ocr_ai_keys.js` लागू, `user_ai_keys` collection मौजूद, health 200)। **बाकी:** अंसारी जी OCR settings → «AI (Gemini)» में key डालें और Pratik बिल पर test करें। नीचे का «deploy नहीं हुआ» वाला वाक्य deploy से पहले का है।

अंसारी जी ने 2026-11-12 को OCR settings में «AI (Gemini)» engine जोड़ने की हाँ दी। Laptop पर code और tests तैयार हैं (OCR build `2026-11-12.2`)। **Commit नहीं हुआ; Server PC पर कुछ deploy नहीं हुआ।** Server Master deploy तभी करें जब अंसारी जी उनकी chat में हाँ कहें।

### Server Master के लिए: कौन-सी फाइलें deploy करनी हैं

Laptop: `C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\`। तीनों फाइलें एक साथ copy करें, फिर PocketBase restart:

1. `pb_hooks/lib/ocr_cloud.js` — final size **65278 bytes** (पहले 43595 B)। Google Vision और Azure वैसे ही हैं; नया Gemini हिस्सा जुड़ा है।
2. `pb_hooks/ocr_cloud.pb.js` — 4 नए routes: `POST/DELETE /api/ocr-cloud/ai-key`, `GET /api/ocr-cloud/ai-status`, `POST /api/ocr-cloud/ai-read`। पुराने 5 routes नहीं बदले।
3. **नया migration** `pb_migrations/1763800000_ocr_ai_keys.js` — collection `user_ai_keys` (user, provider, key_enc [hidden], key_last4, model, enc_version; unique index user+provider; सारे API rules null)। Idempotent है। पुराने `1763200000` / `1763700000` नहीं बदले।

Migration के बिना AI वाले endpoints साफ़ संदेश देंगे («AI OCR is not set up on the server (migration missing)»), और app Azure / Google पर चला जाएगा; online OCR पर कोई असर नहीं।

### Gemini API key कहाँ रहती है

- **कोई नई env या setting file नहीं चाहिए।** Key app से ही डाली जाती है और server पर collection `user_ai_keys` में encrypted रहती है, उसी master key से जिससे Vision / Azure key (`C:\PocketLedger-Secrets\vision-master-key.txt` या `PL_VISION_MASTER_KEY`)। Master key file का backup पहले की तरह ज़रूरी है; अब `user_ai_keys` में row हो तब भी master key दोबारा नहीं बनती।
- User कैसे डालें: app → voucher → OCR settings (gear) → **«AI (Gemini)»** खंड → Gemini API key paste → **Save** (सिर्फ़ company admin/owner)। Save से पहले server key को Google पर जाँचता है (`GET models/{model}`, key सिर्फ़ `x-goog-api-key` header में)। Key format: `AIza…` (39 अक्षर) या नया AI Studio `AQ.…`; दूसरे साफ़ token भी live test से तय होते हैं। Key की value कभी app को वापस नहीं जाती, सिर्फ़ आख़िरी 4 अक्षर।
- उसी खंड में वैकल्पिक **Model** field। Default `gemini-3.5-flash-lite` (`gemini-2.5-flash` deprecated है और नए users को नहीं मिलता)।
- Company on/off और shared users वही हैं जो Online OCR के हैं (`company_ocr_access`)। «Enable online OCR for this company» अब सिर्फ़ Gemini key होने पर भी चालू हो सकता है।
- फिर OCR engine में **«AI (Gemini)»** चुनें। AI fail हो (key नहीं, quota, timeout, server पुराना) तो app Azure / Google, फिर local OCR चलाता है; वजह «Read by» badge के tooltip में दिखती है।

### वैकल्पिक env (ज़रूरी नहीं)

- `PL_OCR_AI_ENABLED=0` — सिर्फ़ AI बंद (online OCR चालू रहे)। `PL_OCR_CLOUD_ENABLED=0` पहले की तरह सब बंद करता है।
- `PL_OCR_GEMINI_MODEL` — server-wide default model (admin का saved model इससे ऊपर)।
- `PL_OCR_GEMINI_RATE` (default 10/min/user), `PL_OCR_GEMINI_COMPANY_RATE` (default 15/min/company) — online OCR से अलग buckets।
- `PL_OCR_GEMINI_TIMEOUT` (seconds, default 80)।
- `PL_OCR_GEMINI_URL` — **सिर्फ़ tests के लिए**, production में सेट न करें।

### कैसे test करें

1. Laptop या Server PC पर: `node tools/ocr-cloud-test.mjs` (temp PocketBase 8099 + mock; असली keys नहीं) → **82/82 pass** (पहले के 55 + 27 Gemini cases: दोनों key formats, header key, Content-Length, schema, quota, गलत key, MAX_TOKENS, non-JSON, company off, kill switch, no leak)।
2. Deploy के बाद app में: OCR settings → «AI (Gemini)» → key Save → «Ready» दिखे → engine «AI (Gemini)» → Pratik SI-00780 बिल पर Refresh OCR। Badge «Read by: AI (Gemini)», debug में `OCR build 2026-11-12.2` और `OCR pass: ai (gemini) | model …, tokens in … / out … / total …`; 12 items, 84,343.30 / 10,964.63 / 95,307.93।

### Client (laptop, OCR Master)

- `prefs.ts`: engine `"ai"`; settings radio «AI (Gemini)»।
- नई `src/modules/ocr/ai/aiClient.ts` (server calls `pbRequest` से; `src/lib/ocrCloudApi.ts` नहीं छुआ) और `ai/aiVoucher.ts` (Gemini JSON → bill + जाँच: qty×rate=amount, sum=Sub Total, Sub Total−Discount=Taxable, VAT 13%, Taxable+VAT=Grand, PAN 9 अंक, AD↔BS मिति; null fields पर raw_text parser का cross-check; party/item मिलान मौजूदा helpers से)।
- `engine.ts`: AI → online → local fallback; `parser.ts` अंत में AI answer लगाता है; badge «AI (Gemini)» + tokens tooltip; `OCR_BUILD = 2026-11-12.2`।
- Tests: नया `tests/ocr/aiGeminiPratik.selftest.mts` (mock Pratik JSON सही; row 2 की गलत amount flag होती है; गलत VAT; 8-अंक PAN; null fields; unsure field; own company)। सारे `tests/ocr/*.selftest.mts` pass, `npm run typecheck` pass।

## AI chat / सिखाना (2026-11-12, OCR_BUILD 2026-11-12.4)

- OCR bar «AI chat» + OCR settings AI card «Open AI chat / teaching» → `src/modules/ocr/ai/AiChatDialog.tsx` (model `aiChatModel.ts`, labels `aiChatStrings.ts`, API `aiClient.ts`)।
- Stacking: chat dialog का z-index **inline** (2147483002) है — `tailwind.config` `src/modules/**` scan नहीं करता, इसलिए वहाँ लिखी arbitrary class (`z-[...]`, `w-[...]`) बनती ही नहीं। OCR module में ऐसी class न लिखें; inline style या `src/lib/dialogShellChrome.ts` वाली constants इस्तेमाल करें।
- AI scan अब voucher प्रकार (`aiDocTypeForVoucher`) भेजता है, server उस प्रकार के सिखाए नियम जोड़ता है; «Read by» tooltip में «taught rules N»।
- Settings: «AI (Gemini)» key box अब «Online OCR» section के अंदर (Azure box के नीचे, company switch के ऊपर)। Switch बंद हो तो hint।
- Server: `lib/ocr_ai_training.js` + ai-chat / ai-rules routes; नियम `C:\PocketLedger-AI-Training` में। पूरा विवरण: `_handoff/ai-plan.md` खंड 12।

## Gallery runner rules (2026-11-18, OCR_BUILD 2026-11-18.1)

Ansari Ji ने 11 audit fixes approve किए; सब OCR Master ने किए (Gallery Master को बताया गया)।

- **Active runner** = Select Runner / ribbon slider का चुनाव। Voucher Post Setting में जो tab सिर्फ़ खुला है वह कभी active नहीं बनता। Save / Apply `buildRunnerSettingsSave` (`autoPostMode.ts`) से सारे profiles + top-level `enabled / activeRunnerMode / processingMode` एक साथ लिखता है।
- **Draft**: Select Runner switches और embedded Voucher OCR panel अब draft हैं (Save / Apply पर लागू, Cancel पर revert)। Key Setting add/delete instant save ही है।
- **Manual voucher** (हाथ से खोला गया): engine, Auto Post, countdown, Overwrite edited, item rule → `runnerProfiles.manual` (`src/modules/ocr/manualProfile.ts`, pure part `manualProfileCore.ts`)। Device prefs (`pl.ocr.prefs.v1`) में अब सिर्फ़ display prefs (popup style, narration, auto voucher change, translate, AI chat)। Header का «Overwrite edited» pill Manual profile दिखाता है और click पर Voucher Post Setting खोलता है। Switch Engine card वापस नहीं लाया गया।
- **Engine**: runner हमेशा profile का engine explicit भेजता है। `engine.ts` में `getOcrPrefs().onlineProvider` fallback हटाया। `auto` = पहला engine जिसकी key है (Gemini → Google → Azure, `engineKeys.ts`); कोई key नहीं तो `OcrRunError` code `no_key`। Settings में Auto भी तभी selectable जब कम से कम एक key हो। Fail popup पहले से सिर्फ़ keyed engines दिखाता है।
- **Slider**: Semi / Full पर जाने से पहले उस profile के engine की key check (`scanEngineHasKey`); नहीं तो «इस engine की key नहीं है, settings में दूसरा engine चुनें» (en/ne भी) और mode नहीं बदलता।
- **Missing-info rules** अब हर runner profile में (Manual, Semi, Full): debit/credit master, item, date, tax, other, row count mismatch, amount mismatch। पुराने Common values migration में हर profile में default बने (`pickProfileRules`)। Full में «Pause and review» disabled, हमेशा «Move to Auto post failed» (`enforceProfileRules`); «Save without the item» allowed। Duplicate check + default due days Common में ही।
- **Semi** = voucher window + countdown, unapproved save। **Full** = कोई window / countdown नहीं (`autoPostImmediate`), Auto Post forced on, unapproved save। दोनों auto-approve नहीं करते। Auto-create masters नहीं।
- **Copy settings from**: सिर्फ़ engine, Auto Post, countdown, Overwrite edited, file limit, missing-info rules (`COPYABLE_PROFILE_KEYS`)। Target का on/off, triggers, schedule, device वही रहते हैं।
- **Queue खाली** (Start-only mode): runner held/stopped state में जाता है (localStorage `pl.gallery.auto-post.runner-hold.v1:*` = held); page reload पर Start-only खुद start नहीं होता। On-arrival / schedule पहले की तरह auto चलते हैं।
- **Reset** = सिर्फ़ file counter refill; processing start नहीं करता (Start दबाएँ)।
- **Voucher type हाथ से बदला** (runner job): सारी runner settings साथ जाती हैं (`runnerJob` flag handoff में), Auto Post ON हो या OFF।
- Tests: `tests/ocr/galleryRunnerRules.selftest.mts` (decisions 1, 2, 4, 5, 6/7, 10, 11)।
- Open: Common का duplicate «Pause and open for review» Full में अभी भी रोकता है; voucher-type-switch pending Full में भी pause करता है; auto voucher-type change countdown अभी device pref है।

## Gallery OCR History dates + party ledger FY widen (2026-11-18, OCR Master)
- OCR History table: `Voucher Date` (saved voucher's own date, '—' if unknown) + `Posted Date` (old Date/Time). Out-of-scope vouchers are read by id via `src/modules/ocr/useVouchersByIds.ts` (local store, PB fallback). Recent OCR Trxn uses the same hook, so runner vouchers dated outside the loaded FY scope still show.
- `src/lib/fyPagination/entityMinTxnScope.ts`: party/entity ledger widen jumps straight to the month of the entity's oldest local voucher (`entityWidenPlan.ts`); the old month walk (stops after 6 empty months) is kept only when there are no local rows.
- `src/lib/fyPagination/scopeGeneration.ts`: date-range / default scope loads bump a per-company counter; background widens stop when it changes (they could overwrite the user's date range).
- `voucherQueries.countVouchersInDateRange` ignores soft-deleted tombstones (the default min-10 scope stopped too early).
- Selftest: `npx tsx tests/fyPagination/entityWiden.selftest.mts`.
## Gallery Recent OCR Trxn fixes (2026-11-18, OCR Master)

- **Date column = voucher's own date.** The `date: recentMode ? addedAt : row.date` override in `RecentOcrTransactionsTab.tableTransactions` (GalleryPageClient) was removed; it showed the posted/created date. Posted time now rides as `_dateSubline` ("Posted: <BS/AD date> h:mm a", copy key `AUTO_POST_UI.postedPrefix`) and `transactionTableShared.tsx` renders it as an opt-in small second line under the date (single and "Both" date modes). No other table sets `_dateSubline`.
- **Not a data bug:** PUR-80-81-001 is stored with date 2023-08-04 (Shr-19-2080), so its 80-81 number is correct; runner vouchers keep the Gemini-read date.
- **Accounts column names.** `/gallery` loads only `vouchers` into the voucher provider (`ledgerActiveMasterCollections`), so From/To showed "-". New `src/modules/ocr/useLocalMasterNames.ts` reads id -> name from the local browser store (parties, bank_accounts, staff, taxes, expense_accounts, items; refreshes on `BROWSER_DB_COLLECTION_BUMP`) and is merged under `journalAccountNames` for the table and its filter.
- **User column** still shows "OCR <engine>" by design.
- **3-dot + amount width (Recent OCR only).** Wrapper has `data-pl-recent-ocr-table`; `RECENT_OCR_TABLE_CSS` (GalleryPageClient) moves `[data-pl-txn-row-menu-trigger]` 10px right, forces `col[data-pl-col=debit|credit]` to 150px and makes Dr/Cr cells nowrap with 4px right padding so "Rs. 1,23,45,678.90" shows without hover.- **User column by runner mode (Ansari Ji).** Pure helper `src/modules/ocr/recentOcrUserLabel.ts` (selftest `tests/ocr/recentOcrUserLabel.selftest.mts`): Full -> "OCR Gemini"; Semi -> "nansari15300, OCR Gemini" (no "OCR " before the user; rendered as user on line 1 + smaller "OCR Gemini" line 2 via opt-in `_userSubline` in transactionTableShared); Manual -> "nansari15300" (the voucher's `userDisplayName || userName`, same as Dashboard Recent). The runner now stores `autoOcrRunnerMode` (manual/semi/full, from `activeRunnerFromSettings` at claim time) on the `unassigned_documents` row; no pl_vouchers change. Rows posted before this have no stored mode and fall back to **Semi** (every row in this table is a runner job). The User column filter uses the same label. Recent OCR CSS fixes the User col at 150px (`col[data-pl-col=user]`), clips the cell (`td[data-pl-txn-user-cell]`, overflow hidden) and keeps 10px right padding before File. Missing user name -> engine label only.
- **Recent OCR date filter = posted date (Ansari Ji, 2026-11-18).** The date pill, Today button, calendar dots, and Total Vouchers count now filter/highlight by posted date (`createdAt`), not the voucher date. The Date column is unchanged (voucher date with a "Posted:" subline). A small (i) icon sits next to the Today pill; hover or click shows a short note in the app Intro language (en / hi / ne). Helper: `src/modules/ocr/recentOcrPostedDate.ts` (selftest `tests/ocr/recentOcrPostedDate.selftest.mts`). Left uncommitted for Git Master.

- **Recent OCR sort (Ansari Ji, 2026-11-18).** Footer sort did not work in Recent mode because `filteredTransactions` always re-sorted by posted date descending and ignored `sortBy`/`sortOrder`. Date-filter mode used `sortTransactions`, which sorts by voucher date. Both modes now use `src/modules/ocr/recentOcrTransactionSort.ts`: default = posted date+time (`createdAt`, same helper as the date filter), newest first; By Amount and By Voucher No. keep asc/desc. Sort runs on the full list before pagination. The menu's Default mark is posted-date descending for this table only (`defaultSortOrder` on the shared dropdown; other ledgers stay date ascending). Selftest: `tests/ocr/recentOcrTransactionSort.selftest.mts`. Left uncommitted for Git Master.

## Recent OCR server list + Company Doc server count + wrong-PC Start dialog (2026-11-18, OCR Master)

Ansari Ji approved: Recent OCR must show only OCR-created vouchers and be the same on every PC (fetch from PocketBase when the local copy is missing). Company Doc must count every file attached to an alive company voucher (manual + OCR, all FYs), with the count computed on the server. Also: the "wrong PC" Start toast should be a centered dialog that stays until OK, in the Intro language.

### Recent OCR
- Source of truth is now GET `/api/pl/recent-ocr-links?company=...`. The hook reads `pl_unassigned_documents` (and `duplicate_documents` in `pl_docs`) including hard-deleted tombstones, where `autoOcrStatus=complete` and `autoOcrVoucherId` is set. Server delete keeps those fields in `data`, so a voucher still appears after the gallery file is hard-deleted.
- If that route is not deployed yet, the client falls back to the previous local `unassigned_documents` snapshot.
- Missing vouchers are loaded by `useVouchersByIds`: local store first, then POST `/api/pl/vouchers-by-ids` (app id or PocketBase record id), then a direct `getDoc` fallback. Deleted vouchers are excluded. FY scope on other pages is unchanged.

### Company Doc badge
- GET `/api/pl/company-file-count?company=...` counts attachment URLs on **alive** vouchers of the company across **all FYs**, with the same rule as `getVoucherAttachmentUrlsForUi` (`fileUrls`, else legacy `unassignedFile.url` when `fileUrls` is not an explicit empty array).
- **Unassigned / Duplicate gallery files that are not attached to a voucher are not included.** They already have their own badges. "Company me jitne v file hai" is applied as every file on an alive voucher (manual or OCR).
- The client caches the number and refreshes on voucher store changes and window focus, not on every render. If the route is unavailable, it falls back to the previous local (FY-scoped `useVouchers()`) count so the badge still works before server deploy.

### Wrong-PC Start dialog
- Replaced the auto-dismiss toast `Start the runner on the selected Local PC admin device.` (`AUTO_POST_UI.startBlockedDeviceMismatch`) with a centered `RunnerWrongPcDialog` that stays until OK.
- Call sites: `GalleryRunnerHoldButton` process-state handler and the 500ms Start fallback in `GalleryPageClient.tsx`. The runner now also publishes `localRunnerDeviceId` so the selected PC name can be filled in (device label from `devices`, else the device id).
- Intro-language text (en / hi / ne) in `src/modules/ocr/runnerWrongPcIntro.ts`.

### Server deploy (Server master — not deployed from this change)
Laptop sources (do not copy from Server PC):
`C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\pb_hooks\company_file_count.pb.js`
`C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\pb_hooks\lib\company_file_count.js`
Copy those two files onto ServerWin10 at:
`C:\Project Next.js Balgram\PocketLedger-Server\sub-server\pb_hooks\company_file_count.pb.js`
`C:\Project Next.js Balgram\PocketLedger-Server\sub-server\pb_hooks\lib\company_file_count.js`
Then **restart PocketBase** (hooks load at process start). No migration needed. Auth: signed-in `pl_users` + active company member/owner (same generic 403 as other hooks).

### Client files
- New: `companyFileCountCore.ts`, `useCompanyFileCount.ts`, `recentOcrLinks.ts`, `useRecentOcrLinks.ts`, `plGalleryServerApi.ts`, `runnerWrongPcIntro.ts`, `RunnerWrongPcDialog.tsx`
- Changed: `useVouchersByIds.ts`, `GalleryPageClient.tsx`, `GalleryLocalAutoPostRunner.tsx`
- Selftests: `tests/ocr/companyFileCount.selftest.mts`, `recentOcrLinks.selftest.mts`, `runnerWrongPcIntro.selftest.mts`
- Left uncommitted (and the server hook undeployed) for Git Master / Server master.

### Gallery server counts + offline Unassigned mark (19 Nov 2026, undeployed)

Ansari Ji approved: all four Gallery badges from the server, and a file that has not reached the server must show in that PC's Unassigned list, dimmed, with an offline mark, then auto-upload when internet returns.

**Server (same hook files, still undeployed):**
- New route `GET /api/pl/gallery-counts?company=<app company id>`
- Response: `{ ok, company, unassigned, duplicate, autoPostFailed, companyFiles }`
- Visibility matches the Gallery client: not deleted / `_pbHardDeleted`, `status !== 'ASSIGNED'`, skip stub rows with no `uploadedAt`. Unassigned = `autoOcrStatus !== 'failed'`; Auto post failed = `autoOcrStatus === 'failed'`; Duplicate from `pl_docs` `coll = 'duplicate_documents'`. Company Files reuses the existing all-FY voucher file count.
- Auth unchanged: signed-in `pl_users` + active member/owner, generic 403.

**Client:**
- `useGalleryServerCounts` loads all four badges (cache + refresh on voucher/unassigned/duplicate mirror bumps and window focus). If the route is missing or offline, current local counts are used.
- Unassigned badge on that PC = server (or local fallback) + this-PC pending files not yet on the server (no double count after upload).
- New unassigned adds that cannot reach the server are stored only on that PC (`local:` blob + pending list). The tile is dimmed and shows an Offline mark (en/hi/ne). On `online`, every 30s while Gallery is open, and via the existing pending-sync retry, the file uploads and the unassigned row is written to the server; the mark goes away and the badge corrects.
- Device-only companies still use the existing localStorage path.

**Offline mark text:**
- en: "This file is saved only on this PC because there was no internet; it will upload automatically when online."
- hi / ne: same meaning in intro language (`galleryOfflinePendingIntro.ts`). Short label: Offline / ऑफलाइन / अफलाइन.

**CNTR Out-001 / voucher `local:` gap (fixed 19 Nov 2026, uncommitted):**
Voucher attachments such as CNTR Out-001 (`local:<uuid>`) on PocketBase/server-gate companies were not retried after a reload. `syncPendingFiles` skipped them twice: the per-company Firebase upload pref is false for PocketBase companies, and `syncOnePendingFile` returned "file uploads with its data sync". The in-memory `/__pl_attachment` queue also does not survive reload and is not the `pbatt:` writer. The retry now uses the normal outbox path (`pushOutboxRowToPocketBase` / `convertLocalRefsForPocketBase`): when this PC still has the IndexedDB/native blob and the local doc still has that `local:` ref, the voucher/doc is enqueued and flushed so the file becomes `pbatt:` and other PCs can see it. The blob is removed only after the doc no longer has the `local:` ref. Missing blobs (created on another PC) are left alone. Helpers: `src/lib/pendingPocketBaseAttachmentSyncLogic.ts`, `src/lib/pendingPocketBaseAttachmentSync.ts`. Selftest: `tests/sync/pendingPocketBaseAttachmentSync.selftest.mts`. Five vouchers also store `http://127.0.0.1:8090/api/files/pl_stored_files/...` URLs (open only on the Server PC); data was not rewritten. A display-only mapper exists in the logic helper (`rewriteLoopbackPocketBaseFileUrlForDisplay`) but is not wired into the preview UI because https file URLs are fetched from several places.

**Deploy (Server master — do not copy from Server PC, do not restart from this change):**
Laptop sources:
`C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\pb_hooks\company_file_count.pb.js`
`C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\pb_hooks\lib\company_file_count.js`
Copy onto ServerWin10 at:
`C:\Project Next.js Balgram\PocketLedger-Server\sub-server\pb_hooks\company_file_count.pb.js`
`C:\Project Next.js Balgram\PocketLedger-Server\sub-server\pb_hooks\lib\company_file_count.js`
Then **restart PocketBase**. No migration. Left uncommitted.

**Client files:** `galleryDocVisibility.ts`, `galleryOfflinePending.ts`, `galleryOfflinePendingIntro.ts`, `galleryOfflinePendingStore.ts`, `useGalleryServerCounts.ts`, `useGalleryOfflinePending.ts`, `plGalleryServerApi.ts`, `GalleryPageClient.tsx`, `savePhotoToUnassigned.ts`, `usePendingVoucherSync.ts`. Selftest: `tests/ocr/galleryCounts.selftest.mts`.
### Gallery badge counts showing 0 (19 Nov 2026, uncommitted, hook not redeployed)

After the first gallery-counts deploy, laptopdev Gallery for New parsa Engineering WorkShop Demo Compnany showed Unassigned 0, Duplicate 0, Auto post failed 0, Company Doc 0, while the Company Doc grid listed 12 files.

**Cause:** Authenticated `GET /api/pl/gallery-counts?company=demo-compnany_f21b7bb6` returned 200 (65 times; last around 08:42 Asia/Kathmandu). The client treated those numbers as truth, including 0, and never fell back to the local voucher file count. Read-only SQLite on live `data.db` (same hook SQL, PocketBase company id `h353ic0cdqa2qof`) gives Unassigned 9, Duplicate 4, Auto post failed 1, Company Doc 16. Rows use the PB id in the `company` column and the app id in `data.companyId`. The hook looked up the company by app_id correctly, then `sqlAll` swallowed query errors and returned an empty list, so the hook answered `{ ok: true, ...: 0 }`. Likely trigger: `json_extract` of arrays / ints (fileUrls, isDeleted, uploadedAt objects) scanned into DynamicModel string fields. `pb_data/logs.db` does not exist; `auxiliary.db` `_logs` was empty; stdout after the 08:13 restart was not captured in `pocketbase.out.log`.

**Fix (laptop only, left uncommitted):**
- Hook: resolve company by app id or PocketBase id; count rows stored under either id (`company` column or `data.companyId`); `CAST(... AS TEXT)` on extracted JSON; SQL errors now return 500 (not ok:true zeros).
- Client: trust server numbers only when `ok === true` and every field is a real non-negative integer (reject null / "" / missing `ok`). 401/403/500 fall back to local counts.

**Deploy (Server master — copy from the laptop sources below, then restart PocketBase; do not edit live files from Server PC, no migration, no Cloudflared change):**
Laptop sources:
`C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\pb_hooks\company_file_count.pb.js`
`C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\pb_hooks\lib\company_file_count.js`
Live destinations:
`C:\Project Next.js Balgram\PocketLedger-Server\sub-server\pb_hooks\company_file_count.pb.js`
`C:\Project Next.js Balgram\PocketLedger-Server\sub-server\pb_hooks\lib\company_file_count.js`
Then **restart PocketBase**.

**Client files:** `src/modules/ocr/galleryServerCountParse.ts` (new), `plGalleryServerApi.ts`, `tests/ocr/galleryCounts.selftest.mts`.

### Loopback file URL preview + pbatt: save path (19 Nov 2026, uncommitted)

Ansari Ji approved (t161u): wire the display-only loopback URL rewrite so a file stored as `http://127.0.0.1:8090/api/files/...` previews on any PC, and hand pending OCR changes to Git Master.

**Display (no stored-data rewrite):** `rewriteLoopbackPocketBaseFileUrlForDisplay` is now called from `normalizeAttachmentUrlForDevicePreview`, which already feeds gallery tiles (`GalleryTilePreview` → `fetchAttachmentRefBlob`), voucher `FilePreview` / hover thumbnails, and `openAttachmentInApp`. Stored `127.0.0.1` / `localhost` PocketBase file URLs are mapped to the current PocketBase base (LAN host or same-origin `/pb` proxy via `getPocketBaseServerUrl()`). Clipboard paste still keeps the original stored ref (`unwrapAttachmentHoldClipboardRef`) so a preview rewrite is never written back. OCR `loadFirstFile` also uses the display normalizer before fetching.

**Save path:** Gallery add/edit (`GalleryPageClient`) and `savePhotoToUnassigned` (server companies) could still fall back to `uploadFileClient` / `getDownloadURL`, which stores `${auth.url}/api/files/pl_stored_files/...`. On the Server PC that `auth.url` is often `http://127.0.0.1:8090`, so a new file was invisible on the other PC. Those paths now persist only a `pbatt:` ref (`decideUnassignedUploadPersist`). If the server upload fails, the file stays offline-pending on that PC (edit shows an error) instead of writing a loopback URL. `GalleryLocalAutoPostRunner` does not upload; it copies the unassigned row's existing URL onto the voucher.

**Tests:** `tests/ocr/loopbackFileUrlDisplay.selftest.mts`.

**Note:** The 19 Nov gallery-count parse client files (`galleryServerCountParse.ts`, `plGalleryServerApi.ts`, `tests/ocr/galleryCounts.selftest.mts`, this handoff) were already committed in `79e05c54` (auto-sync DESKTOP-M4HAJE9 2026-11-19 08:55 Asia/Kathmandu). Server hook sources on the laptop are still uncommitted: `PocketLedger-Server/sub-server/pb_hooks/company_file_count.pb.js` and `lib/company_file_count.js`.

### Company Doc badge still 12, server has 16 (19 Nov 2026 09:38 Asia/Kathmandu, hook undeployed)

Ansari Ji reported (t162u) after Git Master synced app commits `3c7ea7f4` + `79e05c54` and server repo `005f5b1`: grey previews work, but Gallery Company Doc still shows 12 (expected 16) for New parsa Engineering WorkShop Demo Compnany. Other badges: Unassigned 10, Duplicate 4, Auto post failed 1. Company Doc tab showed 1 file because of the date filter.

**Company:** PocketBase id `h353ic0cdqa2qof`, app id `demo-compnany_f21b7bb6`. Live `data.db` (read-only, same hook SQL) confirms Company Doc **16 is the correct all-FY total**: 16 alive vouchers, one attachment each, all via `fileUrls`. Kinds: 10 `pbatt:`, 5 `http://127.0.0.1:8090/api/files/...`, 1 `local:`. Unassigned 10, Auto post failed 1, Duplicate 4 match the screenshot. No extra unassigned/duplicate files belong in Company Doc (those badges stay separate). The 4 files that local FY-scoped `useVouchers()` does not include are:

- PUR-80-81-001
- Sale Inv-80-81-002
- Sale Inv-80-81-003
- PUR-81-82-001

The other 12 are current-FY / unscoped numbers such as PUR-83-84-*, Sale Inv-83-84-*, DEXP-83-84-002, PYMT-83-84-001, and CNTR Out-001.

**Cause:** Deployed hook `005f5b1` (live files hash-matched the laptop copy; PocketBase restarted 19 Nov 2026 08:55:39 Asia/Kathmandu) still used `CAST(json_extract(...) AS TEXT)` into DynamicModel string fields. `CAST(NULL AS TEXT)` is still NULL when `isDeleted`, `_pbHardDeleted`, or `unassignedFile.url` is missing. Live `pocketbase.out.log` (08:52-08:55, before that restart) already showed `sql: Scan error ... converting NULL to string is unsupported` on `is_deleted`, `hard_deleted`, `uf_url`, and `mode`. `sqlAll` throws, `GET /api/pl/gallery-counts` returns 500, and the client correctly falls back to local counts: unassigned/duplicate/auto-failed happen to match the server, but Company Doc uses FY-scoped local vouchers (12), not the server all-FY 16.

**Fix (laptop only, left uncommitted, do not deploy from this change):** Every hook SQL value scanned into a DynamicModel string now uses `COALESCE(CAST(json_extract/json_type(...) AS TEXT), '')`. Route file unchanged. Client already prefers `companyFiles` from gallery-counts when the hook returns `ok: true`; no badge-wiring change required. Comment added in `companyFileCountCore.ts`. Selftest: `tests/ocr/galleryCountSqlNull.selftest.mts`.

**Deploy (Server master — copy from the laptop sources below, then restart PocketBase; do not edit live files from Server PC, no migration, no Cloudflared change):**

Laptop sources:

- `C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\pb_hooks\lib\company_file_count.js`
  SHA256 `B5393285679CCF21450595D6C0D6EB3C0807668100A204B50187ABAB1B643C92` (17123 bytes)
- `C:\Project ERP\Refference apps\PocketLedger-Server\sub-server\pb_hooks\company_file_count.pb.js`
  SHA256 `08CD494726251611BBBB9DFBBD65ACFCDE17AF2AE4A627A33E2C47E0831D2900` (1391 bytes, unchanged from `005f5b1`)

Live destinations:

- `C:\Project Next.js Balgram\PocketLedger-Server\sub-server\pb_hooks\lib\company_file_count.js`
- `C:\Project Next.js Balgram\PocketLedger-Server\sub-server\pb_hooks\company_file_count.pb.js`

Then **restart PocketBase**. After restart, Company Doc should show 16.

**Client files:** `src/modules/ocr/companyFileCountCore.ts` (comment only), `tests/ocr/galleryCountSqlNull.selftest.mts` (new), this handoff. Left uncommitted for Git Master.
## Company Doc default date window: this month, minimum 20 files (2026-11-19, OCR Master)

Ansari Ji: date filter should show at least 20 files. If this month already has 20 or more, show all of this month only. If this month has fewer than 20, add earlier-dated files (newest first, including other FYs) until 20, or show every file when the company has fewer than 20 in total.

**Default / this-month view**
- The Company Doc date pill default is now this calendar month (not the last 30 days).
- BS and Both date systems use the current Bikram Sambat month; AD uses the Gregorian month.
- File-level rule lives in the pure helper `src/modules/ocr/companyDocDateWindow.ts` (`selectCompanyDocFilesByDateRule`).
- Existing newest-first grid order still applies after selection (top left to right).
- The previous "empty default window falls back to all dates" behaviour is replaced by this rule.
- If earlier files were added to reach 20, the footer shows " · + earlier to 20".
- An intro (i) next to the date pill explains the rule in en / hi / ne (`COMPANY_DOC_DATE_FILTER_INTRO`).

**Custom range**
- If the user picks a date range themselves, that range is kept exactly: no min-20 backfill, no cap when the month has more than 20 files, and an empty range stays empty.
- Voucher-number search still skips the date window (all matching files).
- Avatars view uses the date range only (no min-20 fill).
- Clear All still clears the date pill (all dates), as before.

**Other-FY files**
- Company Doc files are attachments on alive vouchers, all FYs.
- `useCompanyDocExtraVouchers` lists older vouchers with files from the local all-FY store (`listOlderCompanyDocVoucherIds`) and loads any that are missing from the FY-scoped `useVouchers()` list via `useVouchersByIds` / `POST /api/pl/vouchers-by-ids`.
- No new server list endpoint was added. Files that are not in the local store and have no known id cannot be listed yet.

**Files (laptop, uncommitted, no commit/push/build)**
- `src/modules/ocr/companyDocDateWindow.ts` (new)
- `src/modules/ocr/listCompanyDocOlderVouchers.ts` (new)
- `src/modules/ocr/useCompanyDocExtraVouchers.ts` (new)
- `tests/ocr/companyDocDateWindow.selftest.mts` (new)
- `src/components/gallery/GalleryPageClient.tsx` (Company Files tab default window, helper wiring, intro, footer note)
- this handoff

**Tests:** `npx tsx tests/ocr/companyDocDateWindow.selftest.mts` and `npm run typecheck`.

## Company Doc date pill: shown-file range + (i) inside the pill (2026-11-19 10:19 Asia/Kathmandu, OCR Master)

Ansari Ji (t165u): when the min-20 rule adds earlier-dated files, the date pill must show the date range of the files in the grid, not this month. Also move the (i) intro icon inside the date pill.

**Date pill range (display only)**
- Default view, this month already has 20 or more files: the pill still shows this month (1st through last day), as before.
- Default view, earlier files were added to reach 20: the pill shows the oldest shown file date through the newest shown file date (start of the oldest day to end of the newest day). It does not use the month end if the newest file is earlier than that, and it does not stay on this month only.
- A date range the user picks themselves is unchanged: the pill still shows that custom range.
- This displayed range is not written into `dateRange` and does not set `dateRangeUserTouchedRef`. Refresh keeps the min-20 default rule.
- Clicking the pill to edit opens the calendar on the range currently shown on the pill (the shown-file span when backfilled, otherwise this month or the custom range). The default rule stays active until the user actually picks or applies a range.

**(i) icon**
- The intro (i) is now inside the date pill, on the right, in PC and mobile footers.
- It is not part of the calendar trigger: clicking the icon opens the intro popover and does not open the date picker.
- Intro text stays in en / hi / ne and now also mentions the pill range rule.

**Files (laptop, uncommitted, no commit/push/build)**
- `src/modules/ocr/companyDocDateWindow.ts` (`companyDocDatePillRange`, intro text)
- `tests/ocr/companyDocDateWindow.selftest.mts`
- `src/components/ui/BsDatePicker.tsx` (optional `trailing` slot inside the pill)
- `src/components/gallery/GalleryPageClient.tsx` (display range + icon placement)
- this handoff

**Tests:** `npx tsx tests/ocr/companyDocDateWindow.selftest.mts` and `npm run typecheck`. Both passed on the laptop (2026-11-19 10:22 Asia/Kathmandu).

## OCR suggestion bubble direction: Direct Expense From Bank/Cash (2026-11-19 12:30 Asia/Kathmandu, OCR Master)

Ansari Ji (t166u): in New Trxn, Direct Expense, Gemini OCR showed "Create bank account (From)? (field not on screen)" floating near Attach Files, with no arrow pointing at the visible From Bank/Cash field. He asked whether pointing is missing for all voucher types.

**Root cause**
- Pointing already exists for every voucher type that marks its fields with `data-ocr-field` / `data-ocr-anchor`. The bubble tail is drawn only when that field is found; otherwise the bubble falls back to the OCR bar (`data-pl-ocr-refresh-bar`, near Attach Files) and shows "(field not on screen)".
- `ocrFieldForSuggestion("create-account-from")` did not map that id. The old rule was `id === "account" || id.startsWith("account-")`, and `create-account-from` matches neither, so it fell through to `"lines"`. Direct Expense has no item-lines field, so the bubble treated the field as missing even though From Bank/Cash was on screen (`data-ocr-field="account"`).
- The same gap affected `create-account-to` (Contra To) and `choose-vat` (fell through to lines). `account-payee-*` was incorrectly mapped to Bank/Cash (`account`) instead of `party`.
- Contra From/To account comboboxes had no `data-ocr-field` at all, so even a correct mapping could not point at them.

**Fix (laptop, uncommitted, no commit/push/build)**
- New pure helper `src/modules/ocr/ocrFieldAnchors.ts`: `create-account-from` -> `account` (anchor `account-from`); `create-account-to` / `account-to-*` -> `account-to`; `account-payee-*` -> `party`; `choose-vat` -> `tax`.
- `OcrFieldBubbles.tsx` now imports / re-exports that helper. "(field not on screen)" still appears only when the target field is truly not found (absent or zero-size / not rendered). If the field is present, the tail points at it.
- `useVoucherOcr.tsx` sets `b.anchor` to `account-from` / `account-to`, and Contra To candidate ids are now `account-to-${id}` so they do not collide with From candidates.
- Direct Expense "To (Expense)" was already `data-ocr-field="party"` + `data-ocr-anchor="expense-account"` (no form change needed for that side).

**Minimal form attribute adds (other bots' voucher forms; only data attributes)**
- `CreatePaymentOutForm.tsx` (Payment + Direct Expense): `data-ocr-anchor="account-from"` on existing From Bank/Cash `data-ocr-field="account"` (mobile + desktop).
- `CreatePaymentInForm.tsx` and `CreateDirectIncomeForm.tsx`: same `data-ocr-anchor="account-from"` on the Bank/Cash field.
- `CreateContraForm.tsx`: added `data-ocr-field="account"` + `data-ocr-anchor="account-from"` on From, and `data-ocr-field="account-to"` + `data-ocr-anchor="account-to"` on To (mobile + desktop). This form previously had no account anchors.

**Already had field anchors (no form edit)**
- Sale / Purchase: party, ledger, lines, tax, discount, total, date, bill-no, due-date.
- Payment Out / Direct Expense: party (To / To Expense), date, amount, other-charge, bill-no. From Bank/Cash already had `data-ocr-field="account"`.
- Payment In / Direct Income: party, account, date, amount, bill-no.
- Journal / Adjustment / Note / Add Salary / Production: date (and bill-no / amount / tax where those forms have them). They have no Bank/Cash From/To fields, so this suggestion type does not apply.

**Tests:** `npx tsx tests/ocr/fieldBubbleAnchors.selftest.mts` and `npx tsx tests/ocr/bubbleTail.selftest.mts` and `npm run typecheck`. All passed on the laptop (2026-11-19 12:31 Asia/Kathmandu).
