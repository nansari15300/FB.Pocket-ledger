# OCR Voucher Autofill — Archived Local OCR Proposal

> Status: Obsolete historical proposal. The local Tesseract engine described here has been removed. Current OCR runs through Gemini or configured online providers. This document is retained as an archive only; do not use it as implementation guidance. Project: Pocket-ledger (Next.js 16 + Tailwind + Firebase + Capacitor Android + Electron).
> Context: नेपाल — BS dates (जैसे `2083-06-25`), `Rs.`, PAN (9 अंक), VAT 13%, TDS।

---

## 1. लक्ष्य (Goal) और दायरा (Scope)

**लक्ष्य:** किसी भी voucher form में जब **पहला attachment** (image या PDF) जोड़ा जाए, तब उसे device पर ही (fully local, कोई cloud OCR / server call नहीं) OCR करके voucher के fields **सुझाव/autofill** किए जाएँ।

**मूल सिद्धांत (Strict Principle):**
> **गलत भरा हुआ field, खाली field से ज़्यादा खराब है।**
> कोई field तभी autofill होगा जब वह format validation **और** cross-check दोनों पास करे; वरना खाली छोड़ा जाएगा और "OCR: पुष्टि करें" के रूप में flag होगा।

**In scope:**
- Voucher forms (`src/components/vouchers/`): `CreatePurchaseForm.tsx`, `CreateSaleForm.tsx`, `CreatePaymentInForm.tsx`, `CreatePaymentOutForm.tsx`, `CreateDirectIncomeForm.tsx`, `CreateJournalForm.tsx`, `CreateNoteForm.tsx` (purchase/sale note), `CreateContraForm.tsx`, `SalaryForm.tsx` (सिर्फ date/amount/voucher no)।
- Expense: इस app में अलग expense voucher form नहीं है — expense भुगतान `CreatePaymentOutForm` (`payeeType: "expense"`, `expenseAccountId`) से होता है, इसलिए वही cover होगा।
- Platforms: Web (browser), Electron (Windows EXE), Android (Capacitor APK)।
- Languages: English, नेपाली (Devanagari), हिन्दी।

**Out of scope (v1):**
- Handwritten bills की भरोसेमंद पहचान (केवल best-effort, लगभग सब flag होगा)।
- Cloud/LLM OCR। Auto-save — OCR कभी voucher को save/approve नहीं करेगा; `isApproved` को कभी नहीं छुएगा।
- Attachment preview / backup-restore code में कोई बदलाव (AGENTS.md freeze — नीचे §13 देखें)।

---

## 2. Architecture / Pipeline

```
[First attachment added]
   │  (handleFileChange / VoucherAttachmentPcDropRow drop / AttachmentHoldPasteSurface paste)
   ▼
useVoucherOcrAutofill(formType, form)  ── trigger only if files.length 0 → 1 and OCR enabled
   ▼
ocrWorkerClient.postMessage({ blob, mime })          (Web Worker; UI thread block नहीं)
   ▼
[Worker]
 1. Source → Raster
    - PDF: pdfjs-dist (पहले से dependency 5.6.205) से page 1 (max 2) को 300 DPI पर render
    - Image: createImageBitmap → OffscreenCanvas
 2. Preprocessing
    - EXIF orientation fix
    - Grayscale (luma = 0.299R+0.587G+0.114B)
    - Upscale: यदि छोटा side < 1500px तो 2x (bicubic) — छोटे thermal receipts के लिए
    - Deskew: projection-profile / Hough से ±15° तक angle खोजें, rotate
    - Contrast normalize + Adaptive threshold (Sauvola/Otsu; दोनों चला कर ज़्यादा mean-confidence वाला लें)
    - Denoise (median 3x3), border crop
 3. OCR — tesseract.js (bundled, offline)
    - traineddata: eng + nep (+ hin optional) — app bundle में shipped, CDN नहीं
    - Pass A: `eng` (numbers/PAN/amount के लिए best), Pass B: `nep+hin` (labels/party name)
    - output: words + bbox + per-word confidence (TSV/hOCR level)
 4. Layout → lines/blocks (y-clustering), key–value pairs, table region detection
 5. Extractors (प्रति field rules, §4) → candidates[]
 6. Validators + Cross-checks (§4, §5) → confidence score (§7)
 7. Party/Item matching (§5, §6) — master data main thread से snapshot रूप में worker को
   ▼
OcrResult { fields: {name, value, confidence, status: "fill"|"flag"|"none", evidence bbox} }
   ▼
Main thread: केवल status=="fill" वाले fields `form.setValue(..., {shouldDirty:true})`;
user ने पहले से जो field भरा है उसे कभी overwrite नहीं करना।
```

**Platform नोट्स:**
- **Web:** `new Worker(new URL("./ocr.worker.ts", import.meta.url))`; traineddata `public/ocr/tessdata/*.traineddata.gz`, wasm core `public/ocr/`। Service worker cache से offline।
- **Electron:** वही renderer worker; assets `app.asar.unpacked` या `extraResources` से `file://` पर। कोई native binary नहीं।
- **Android (Capacitor WebView):** वही worker; assets APK के `public/` में। Low-RAM devices पर max raster 2500px, एक समय में एक job।
- Lazy load: OCR bundle (~ tesseract core + eng ≈ 5MB, nep ≈ 1–2MB) केवल पहले उपयोग पर load हो। Settings में "OCR language pack" toggle।
- Timeout: 25s (Android 40s); timeout पर कुछ भी fill नहीं, सिर्फ toast।

---

## 3. Field List — App के असली voucher fields से mapping

Fields `react-hook-form` + `zod` schemas से लिए गए हैं।

### 3.1 Purchase / Sale (`CreatePurchaseForm.tsx`, `CreateSaleForm.tsx`)
| App field | Type | OCR source | Autofill? |
|---|---|---|---|
| `partyId` | string | Seller (purchase) / Buyer (sale) PAN → name | हाँ (strict match) |
| `date` | `Date` | Bill/Invoice date (BS/AD) | हाँ |
| `voucherNumber` | string | Bill No / Invoice No | **Default: नहीं** — app auto-number (`VoucherNumberInputWithRefresh`, `syncAutoVoucherNumberToDate`) रखता है; supplier bill no `narration` में `Bill No: …` के रूप में जाएगा (Open Q1) |
| `lineItems[].type` | `"item"\|"service"` | matched item का `Item.type` | हाँ (match पर) |
| `lineItems[].itemId` | string (optional) | item name/alias match | हाँ (strict) |
| `lineItems[].quantity` | number | Qty column | हाँ (math check पर) |
| `lineItems[].unit` | string | Unit column (pcs, kg, ltr, बोरा…) | हाँ (unit map में हो तो) |
| `lineItems[].rate` | number | Rate column | हाँ (math check पर) |
| `lineItems[].amount` | number | Amount column | हाँ |
| `lineItems[].isTaxInclusive` | boolean | "VAT included"/"मू.अ.क. सहित" | default false |
| `lineItems[].taxAccountId` / `taxAmount` | string / number | VAT 13% line | हाँ (केवल जब company का 13% VAT tax account एक ही हो) |
| `lineItems[].tdsAccountId` / `tdsAmount` | string / number | TDS line | flag-only (default) |
| `subTotal` | number | Sub Total / Taxable Amount | computed + compared |
| `discount`, `discountSign` | number, `"+"\|"-"` | Discount / छुट | हाँ (`"-"`) |
| `tax` | number | VAT amount | हाँ (13% check पर) |
| `tds` | number | TDS amount | flag-only |
| `total` | number | Grand Total / जम्मा / कुल | हाँ (reconcile पर) |
| `dueDate` | `Date\|null` | Due date / भुक्तानी मिति | हाँ (date rules) |
| `narration` | string | Bill no + supplier name + OCR tag | हाँ (append, overwrite नहीं) |
| `purchaseAccountId` / `salesAccountId`, `discountExpenseAccountId`, `isTdsVerified`, `isApproved`, `overdueImportant` | — | — | **कभी नहीं** |

### 3.2 Payment In / Direct Income / Payment Out
(`CreatePaymentInForm.tsx`, `CreateDirectIncomeForm.tsx`, `CreatePaymentOutForm.tsx`)
| App field | Type | Autofill? |
|---|---|---|
| `payeeType` | enum (`party`,`staff`,`tax`,`income`/`expense`,`other`) | केवल `party` जब PAN match हो; बाकी नहीं |
| `partyId` | string | हाँ (strict) |
| `accountId` (bank/cash) | string | **नहीं** (receipt से तय नहीं होता); cheque/bank name मिला तो सिर्फ hint |
| `date` | Date | हाँ |
| `voucherNumber` | string | नहीं (auto-number); receipt no → narration |
| `amount` | number (≥0.01) | हाँ — "Received Rs." / "अक्षरेपी" (amount in words) से cross-check |
| `payeeAmount`, `otherChargeAccountId`, `otherChargeAmount` (Payment Out) | number/string | नहीं |
| `expenseAccountId` | string | नहीं (v1); supplier template से default (Phase 3) |
| `narration` | string | हाँ (append) |

### 3.3 Journal (`CreateJournalForm.tsx`)
`date`, `narration` केवल। `lines[]` (`accountId`, `type`, `amount`) — **autofill नहीं** (debit/credit तय करना OCR से जोखिम भरा)। Total को hint के रूप में दिखाएँ।

### 3.4 Notes / Contra / Salary
- `CreateNoteForm.tsx` (purchase-note / sale-note — debit/credit note): Purchase/Sale जैसे ही rules, साथ में "Ref Bill No" → narration।
- Contra, Salary: केवल `date`, `amount` hint (flag), autofill नहीं।

### 3.5 Master models (matching के लिए)
- `Party` (`src/components/party/types.ts`): `id`, `name`, `pan?`, `phone?`, `address?`, `email?`, `isDeleted?`, `isFrozen?`। Frozen/deleted party कभी auto-select नहीं।
- `Item` (`src/components/items/types.ts`): `id`, `name`, `type`, `salePrice`, `purchasePrice`, `salePriceUnit?`, `purchasePriceUnit?`, `unitConversions?`, `saleTaxId?`, `purchaseTaxId?`।

---

## 4. STRICT Rule Set (प्रति field)

सभी text पर पहले normalization: Devanagari अंक `०१२३४५६७८९` → `0-9`; `O/o→0`, `l/I→1`, `S→5`, `B→8` **केवल numeric context में**; multiple spaces collapse; `Rs`, `रु`, `रू`, `NPR`, `₹` → currency token।

### 4.1 Date (`date`, `dueDate`)
- **Label keywords:** EN `Date`, `Invoice Date`, `Bill Date`, `Dated`; NE `मिति`, `बिल मिति`, `कारोबार मिति`; HI `दिनांक`, `तारीख`। dueDate: `Due Date`, `भुक्तानी मिति`, `अन्तिम मिति`।
- **Regex:**
  - BS: `\b(20[6-9]\d)[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[0-2])\b`
  - AD (YYYY-MM-DD): `\b(19|20)\d{2}[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b`
  - AD (DD-MM-YYYY / DD/MM/YYYY): `\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((19|20)\d{2})\b`
  - Month names: `Jan…Dec`, `बैशाख…चैत्र`।
- **BS vs AD निर्णय:** year 2070–2099 → BS; 2010–2045 → AD। Ambiguous (DD/MM vs MM/DD) → **flag, fill नहीं**।
- **Validation:** BS day का month-length `src/lib/bs-date.ts` / `nepali-date-converter` से check (BS months 29–32 दिन)। Converted AD date range: आज −400 दिन से आज +7 दिन (और active FY के भीतर, नहीं तो flag "FY बाहर")। dueDate ≥ date।
- **Position:** label के उसी line के दाएँ या ठीक नीचे वाली line; top 35% page में preference। कई candidate dates में label-wala जीतता है; label बिना एक से ज़्यादा अलग dates → flag।
- **Output:** form `Date` object (AD) — `voucherDateNormalize.ts` के अनुसार।

### 4.2 PAN / VAT No (party matching के लिए)
- **Labels:** `PAN`, `PAN No`, `VAT No`, `VAT Reg. No`, `स्थायी लेखा नम्बर`, `स्था.ले.नं.`, `प्यान`, `भ्याट नं`।
- **Regex:** `\b\d{9}\b` (spaces/hyphens हटाकर)। ठीक 9 अंक; 10+ अंक → reject।
- **Position:** seller PAN = header block (top 30%) / "Seller"/"विक्रेता"; buyer PAN = "Buyer"/"Customer"/"क्रेता"/"ग्राहक" के पास। अपनी company का PAN मिले तो उसे counter-party नहीं मानें (purchase में वह buyer है)।
- दोनों PAN तय न हों → party flag।

### 4.3 Bill / Invoice No
- **Labels:** `Bill No`, `Invoice No`, `Inv No`, `Receipt No`, `Ref No`, `बिल नं`, `बिल नम्बर`, `रसिद नं`, `बीजक सं`।
- **Regex:** `[A-Z0-9][A-Z0-9\-/]{0,19}` (label के बाद), उदाहरण `INV-2083/123`, `00456`, `A/1234`। Pure date-जैसा pattern reject।
- **Validation:** length 1–20; per-supplier template में regex (जैसे `^SI-\d{5}$`) हो तो अनिवार्य match। Duplicate check: उसी party के लिए पहले से वही bill no हो → **hard warning "Duplicate bill?"**।

### 4.4 Amounts
- **Parsing:** `Rs.`/`रु.` हटाएँ; commas हटाएँ — Western (`1,234,567.00`) और lakh (`12,34,567.00`) दोनों मान्य; regex `^\d{1,3}(,\d{2})*(,\d{3})?(\.\d{1,2})?$|^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$`। Decimal 2 अंक तक। `/-` suffix (`500/-`) मान्य। Negative/parentheses → discount context में ही।
- **Labels:** Total: `Grand Total`, `Net Amount`, `Total Amount`, `कुल जम्मा`, `जम्मा`, `कुल रकम`, `कुल योग`। SubTotal: `Sub Total`, `Taxable Amount`, `करयोग्य रकम`। VAT: `VAT 13%`, `मू.अ.क.`, `मूल्य अभिवृद्धि कर`। Discount: `Discount`, `छुट`, `छूट`। TDS: `TDS`, `अग्रिम कर कट्टी`, `स्रोतमा कर कट्टी`।
- **Amount in words:** `In Words`, `अक्षरेपी`, `अक्षरमा`, `शब्दों में` — parse (Rupees … Lakh … Thousand / लाख, हजार, सय) और total से तुलना; match → confidence boost; mismatch → total flag।

### 4.5 Line items
- Table detection: header row में ≥3 keywords — `S.N./क्र.सं.`, `Particulars/Description/विवरण`, `Qty/परिमाण/मात्रा`, `Unit/इकाई`, `Rate/दर`, `Amount/रकम/राशि`। Column x-ranges header से।
- **प्रति row check:** `|qty × rate − amount| ≤ max(0.5, 0.005×amount)`। Fail → row के qty/rate/amount fill नहीं, row flag। (Discount-per-line column हो तो `qty×rate − lineDisc = amount`)।
- qty > 0, rate > 0, unit known-unit list में या खाली।

### 4.6 Totals reconciliation (हर purchase/sale पर अनिवार्य)
```
S = Σ lineItems.amount
check1: |S − subTotal_ocr| ≤ 1                      (subTotal छपा हो तो)
taxable = S − discount
check2: |tax_ocr − round(taxable × 0.13, 2)| ≤ 1    (VAT bill हो तो)
check3: |taxable + tax − tds? − total_ocr| ≤ 1     (Rs 1 tolerance; round-off line हो तो उसे जोड़ें)
```
- सभी checks पास → items + totals fill। check3 fail → **कोई amount field fill नहीं** (केवल total को flag के साथ hint दिखाएँ)।
- VAT-exempt / PAN bill (VAT line नहीं) → tax=0 मानकर check3।
- VAT कर-समावेशी bills: `isTaxInclusive` तभी जब label मिले; तब `tax = total × 13/113` check।

### 4.7 TDS
- मान्य दरें (Nepal, rule file से configurable): 1.5% (VAT bill पर supply/contract), 15% (service non-VAT), 10% (rent), 5% (rent—some cases), 0.15%, 1%, 2.5%। ये दरें rule file में रहेंगी — Finance Act बदलने पर update (Open Q)।
- `|tds_ocr − taxable × r| ≤ 1` किसी मान्य r के लिए → `tds` **hint/flag** (default auto-fill नहीं, क्योंकि `tdsAccountId` और `isTdsVerified` user decision है)।

### 4.8 Narration
- Template: `Bill No: {billNo} | {supplierName} | OCR` — existing narration के बाद append; कभी replace नहीं।

---

## 5. Party Matching
1. **PAN first:** OCR PAN (validated 9 digits) → `Party.pan` exact match (non-deleted, non-frozen)। एक match → confidence 0.99, fill। एक से ज़्यादा → flag (duplicate PAN parties)।
2. **Fuzzy name (केवल PAN न मिले/न हो):** normalize (lowercase, `Pvt. Ltd./प्रा.लि./Traders/Suppliers/उद्योग/ट्रेडर्स` जैसे suffix हटाएँ, Devanagari↔Roman transliteration key)। Score = max(Jaro-Winkler, token-set ratio)।
   - ≥ 0.95 **और** second-best से ≥ 0.10 gap → fill
   - 0.80–0.95 → dropdown में top-3 suggestion, fill नहीं
   - < 0.80 → कुछ नहीं; "नयी party बनाएँ?" suggestion (PAN/name/address/phone prefilled dialog, auto-create नहीं)
3. Phone match (`Party.phone`) secondary signal: name 0.90+ और phone exact → fill।
4. Supplier template (PAN keyed) मिला तो उसका `partyId` direct।

## 6. Item Matching
- Order: (a) supplier template का `itemMap` (supplier's printed name → `itemId`) → (b) global alias table → (c) exact normalized name → (d) fuzzy ≥ 0.92 with gap ≥ 0.08।
- Rate sanity: matched item के `purchasePrice`/`salePrice` से ±40% बाहर → itemId fill, rate flag।
- Unit: `purchasePriceUnit`/`unitConversions` से compatible न हो → unit flag।
- Match न हो → line free-form रहे (schema `itemId` optional allow करता है) पर row flag "item चुनें"।

## 7. Confidence Scoring
```
fieldConf = w1·ocrWordConf + w2·labelMatch + w3·formatValid + w4·crossCheck + w5·templateHit
```
- `formatValid` और (जहाँ लागू) `crossCheck` **hard gates** हैं: fail → status "flag", score चाहे जितना हो।
- Fill threshold: default 0.90 (settings से change)। 0.60–0.90 → flag (value दिखे, field में नहीं)। <0.60 → none।
- Document-level guard: पूरे page की mean OCR conf < 55% या blur (Laplacian variance) low → **कुछ भी fill नहीं**, "Image साफ़ नहीं है" message।

### 99.9% के बारे में ईमानदार बात
- Raw OCR सभी bills पर 99.9% accuracy **guarantee नहीं** कर सकता — खासकर handwritten, धुंधले, मुड़े, thermal-faded या low-light photos पर।
- हमारा लक्ष्य **filled fields की precision ~99.9%** है (जो भरा गया वह सही हो), न कि सभी fields भरना। यह हासिल होगा: (1) अनिश्चित field भरने से इनकार, (2) cross-checks (math, VAT, amount-in-words, PAN), (3) per-supplier templates। इसका मूल्य: recall (कितने fields भरे) कम हो सकता है, विशेषकर नए suppliers पर।

---

## 8. Training / Learning (local)
- **Per-supplier template (key = PAN):** `{ pan, partyId, billNoRegex, dateFormat ("BS"|"AD", order), fieldRegions (normalized bbox per field), itemMap, defaultExpenseAccountId?, vatInclusive, tdsRate?, sampleCount, version }`। तीसरी सही confirmation के बाद region-based extraction चालू।
- **Stored corrections:** user ने save से पहले OCR value बदली → `{pan, field, ocrValue, finalValue, bbox, ts}` log; इनसे alias और template update।
- **Alias tables:** `itemAliases` (printed name → itemId), `partyAliases` (name variant → partyId), `unitAliases` (`pcs/nos/गोटा` → `pcs`)।
- **Versioning:** हर template/rule file में `version` + `updatedAt`; पुराने 5 versions रखें, settings से rollback।
- **Storage location:** company-scoped local store — SQLite (Electron/Android, मौजूदा local DB layer) / IndexedDB (web), collection `ocrTemplates`, `ocrCorrections`, `ocrAliases`। Raw OCR text केवल 30 दिन (privacy)।
- **Backup:** इन collections को backup में शामिल करना **frozen** `companyBackupCollections.ts` बदलेगा — AGENTS.md के अनुसार user की explicit permission चाहिए (Open Q)।

## 9. Review UI व्यवहार
- Autofilled field: हल्का background + छोटा "OCR" badge; hover पर source snippet (crop) और confidence।
- Colors: हरा (≥0.90, filled), पीला (0.60–0.90, suggestion — click से apply), लाल outline (cross-check fail / duplicate bill)।
- Form top पर banner: "OCR ने 7 fields भरे, 3 की पुष्टि करें" + "सभी OCR values हटाएँ" (undo)।
- User के edit करते ही उस field से OCR badge हटे; save पर correction log।
- OCR चलते समय attachment row पर छोटा spinner + "Cancel"। Preview components (frozen) में कोई बदलाव नहीं — badge/banner form में ही।
- Manual trigger: attachment row में "OCR से भरें" button (बाद के attachments या re-run के लिए)।

## 10. Settings Page (`Settings → OCR Autofill`)
- Enable/disable (global और per voucher type); language packs (eng/nep/hin) download/status।
- Fill threshold slider; "केवल suggest करें, कभी fill नहीं" mode।
- Rule file editor (JSON, schema validated) + reset to default।
- Supplier templates list (PAN, party, sampleCount, version) — edit/delete/rollback/export/import JSON।
- Alias tables editor। Corrections log viewer + clear।

## 11. JSON Rule File Format (उदाहरण)
```json
{
  "version": 3,
  "updatedAt": "2083-06-25",
  "fillThreshold": 0.9,
  "suggestThreshold": 0.6,
  "amountTolerance": 1.0,
  "vatRate": 0.13,
  "tdsRates": [0.0015, 0.01, 0.015, 0.025, 0.05, 0.10, 0.15],
  "dateWindowDays": { "past": 400, "future": 7 },
  "fields": {
    "date": {
      "labels": ["Date", "Invoice Date", "Bill Date", "मिति", "बिल मिति", "दिनांक", "तारीख"],
      "patterns": [
        { "name": "bs_ymd", "regex": "\\b(20[6-9]\\d)[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\\d|3[0-2])\\b", "calendar": "BS" },
        { "name": "ad_dmy", "regex": "\\b(0?[1-9]|[12]\\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((19|20)\\d{2})\\b", "calendar": "AD" }
      ],
      "position": { "sameLineRight": true, "below": 1, "pageTopRatio": 0.35 },
      "ambiguous": "flag"
    },
    "pan": {
      "labels": ["PAN", "PAN No", "VAT No", "स्थायी लेखा नम्बर", "स्था.ले.नं.", "प्यान"],
      "regex": "\\b\\d{9}\\b",
      "exclude": ["$companyPan"]
    },
    "billNo": {
      "labels": ["Bill No", "Invoice No", "Inv No", "बिल नं", "बिल नम्बर", "बीजक सं"],
      "regex": "[A-Z0-9][A-Z0-9\\-/]{0,19}",
      "target": "narration"
    },
    "total": {
      "labels": ["Grand Total", "Net Amount", "Total", "कुल जम्मा", "जम्मा", "कुल रकम"],
      "amountFormat": ["western", "lakh"],
      "crossChecks": ["itemsSum", "vat13", "amountInWords"]
    }
  },
  "partyMatch": { "fuzzyFill": 0.95, "fuzzySuggest": 0.80, "minGap": 0.10 },
  "itemMatch": { "fuzzyFill": 0.92, "minGap": 0.08, "rateDeviation": 0.40 },
  "neverFill": ["accountId", "purchaseAccountId", "salesAccountId", "isApproved", "isTdsVerified", "tdsAccountId", "voucherNumber"]
}
```

## 12. Test Plan
- **Sample set (`docs/ocr-samples/`, git में नहीं — private):** ≥ 300 bills, ground-truth JSON के साथ:
  - 120 printed VAT invoices (computer bill), 60 PAN/non-VAT bills, 40 thermal receipts, 30 Nepali-only, 20 Hindi/Indian bills, 30 mobile photos (skewed/low light), 20 handwritten (केवल "कोई गलत fill नहीं" test)।
  - हर format में PDF और image दोनों।
- **Metrics (प्रति field):** Precision = सही filled / कुल filled; Recall = सही filled / ground-truth मौजूद; Flag rate; Wrong-fill count।
- **Target thresholds (release gate):**
  | Field | Precision | Recall (printed) |
  |---|---|---|
  | party (PAN) | ≥ 99.9% | ≥ 90% |
  | date | ≥ 99.9% | ≥ 85% |
  | total / tax | ≥ 99.9% | ≥ 80% |
  | line items (row) | ≥ 99.5% | ≥ 60% |
  | handwritten | wrong-fill = 0 | — |
- Regression: rule/template version बदलने पर पूरा set चलाना; CLI `npm run ocr:eval` (Node + tesseract.js) report HTML/CSV।
- Unit tests: amount parser (lakh/western/`/-`), BS date validator, PAN, amount-in-words parser, totals reconciler।
- Platform smoke: Web Chrome, Electron Win10/11, Android 8+ low-RAM (2GB) device — time & memory।

## 13. Phased Implementation Plan (files)

> AGENTS.md freeze: `src/lib/pdfToImage.ts`, `pdfToImageExport.ts`, attachment hover/preview files, और backup files **नहीं बदलेंगे**। OCR के लिए PDF rendering अलग module में (`pdfjs-dist` direct)।

**Phase 0 — Spike (1 हफ्ता):** tesseract.js + nep traineddata Web/Electron/Android पर offline चलना; size/time माप।
**Phase 1 — Core engine (नई files):**
- `src/lib/ocr/ocr.worker.ts` — preprocessing + tesseract + extraction
- `src/lib/ocr/ocrWorkerClient.ts` — worker lifecycle, cancel, timeout
- `src/lib/ocr/preprocess.ts`, `src/lib/ocr/pdfRasterForOcr.ts`
- `src/lib/ocr/normalize.ts` (digits, currency), `amountParse.ts`, `amountInWords.ts`, `dateExtract.ts` (uses `src/lib/bs-date.ts`), `panExtract.ts`
- `src/lib/ocr/extractors/*.ts`, `src/lib/ocr/reconcile.ts`, `src/lib/ocr/confidence.ts`
- `src/lib/ocr/defaultRules.json`, `src/lib/ocr/rulesSchema.ts` (zod)
- `public/ocr/tessdata/eng.traineddata.gz`, `nep.traineddata.gz`, `hin.traineddata.gz`, tesseract core wasm
**Phase 2 — Purchase form integration:**
- नया `src/hooks/useVoucherOcrAutofill.ts`
- नया `src/components/vouchers/ocr/OcrAutofillBanner.tsx`, `OcrFieldBadge.tsx`
- बदलाव: `CreatePurchaseForm.tsx` (`handleFileChange` / drop / paste path पर hook call; files 0→1)
- `src/lib/ocr/partyMatch.ts`, `itemMatch.ts`
**Phase 3 — बाकी forms:** `CreateSaleForm.tsx`, `CreateNoteForm.tsx`, `CreatePaymentOutForm.tsx`, `CreatePaymentInForm.tsx`, `CreateDirectIncomeForm.tsx`, `CreateJournalForm.tsx` (date/narration)।
**Phase 4 — Learning:** `src/lib/ocr/templateStore.ts`, `correctionLog.ts`, `aliasStore.ts`; local SQLite/IndexedDB tables।
**Phase 5 — Settings:** `src/components/settings/OcrAutofillSettings.tsx` + settings route entry।
**Phase 6 — Eval & hardening:** `scripts/ocr-eval.ts`, sample set, threshold tuning; Electron packaging (`extraResources`) व Capacitor asset check।

## 14. Open Questions (user के लिए)
1. Supplier का Bill No `voucherNumber` में जाए या app का auto-number रहे और bill no `narration` (या कोई नया `supplierBillNo` field) में? नया field चाहिए तो schema change होगा।
2. OCR सिर्फ पहले attachment पर auto-चले, या हर नए attachment पर "OCR से भरें" button भी चाहिए?
3. Line items autofill v1 में चाहिए, या पहले केवल header fields (party, date, total, VAT)?
4. Hindi (`hin`) pack ज़रूरी है (Indian bills आते हैं?) — APK size ~1–2MB बढ़ेगा।
5. TDS: केवल hint रहे, या template में TDS rate सेट होने पर auto-fill (`tdsAccountId` सहित)?
6. Unmatched PAN पर नयी party auto-create dialog दिखाएँ?
7. Templates/corrections को backup (`.plbp`) में शामिल करना है? (frozen backup files बदलेंगे — explicit मंज़ूरी चाहिए)
8. Templates company-wise रहें या सभी companies में share (उसी PAN के लिए)?
9. Firebase/online mode में templates cloud-sync हों या पूरी तरह device-local?
10. TDS rate list और VAT 13% — current FY (2083/84) के अनुसार कोई बदलाव?
11. Minimum Android version / RAM target क्या है?
12. Sample bills (≥300) कौन देगा और ground truth कौन बनाएगा?
