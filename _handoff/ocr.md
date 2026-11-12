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
