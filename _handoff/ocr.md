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
