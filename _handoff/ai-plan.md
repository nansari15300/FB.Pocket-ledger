# AI से वाउचर भरना और Chat — चर्चा का प्लान

**स्थिति:** Draft v3, 2026-11-12. Phase 2 का पहला हिस्सा (OCR settings में «AI (Gemini)» engine) बन गया है और Server PC पर deploy हो गया (2026-11-12, 10:19 NPT)। अब अंसारी जी का key डालना और Pratik बिल पर test बाकी है; बाकी चरण अभी चर्चा में हैं

अंसारी जी, यह फाइल चर्चा के लिए है। 2026-11-12 को आपने OCR settings में AI (Gemini) को engine के रूप में जोड़ने की हाँ दी; बाकी हर चरण के लिए अलग से आपकी हाँ चाहिए। आप जो नए नियम बताएँगे, वे नीचे खंड 3 «अंसारी जी के नियम» में अगले नंबर के साथ जुड़ते रहेंगे।

## 1. आज की समस्या

Pocket Ledger में बिल की फोटो से वाउचर भरने का काम अभी तीन रास्तों से होता है: local Tesseract, Google Cloud Vision, और Azure Image Analysis (Read)। ये तीनों मुख्य रूप से कच्चा text (raw OCR) निकालते हैं। उसके बाद हमारा parser (`src/modules/ocr`) regex और नियमों से party, date, items और total निकालता है।

तकनीकी बात यह है कि Cloud Vision या Azure अक्षर तो पढ़ लेते हैं, पर यह नहीं समझते कि कौन-सा नंबर Bill Number है, कौन-सा Taxable Amount है, और टेबल में कौन-सा column असली Qty है। टेढ़े-मेढ़े या कई columns वाले इनवॉइस में कॉलम अक्सर मिल जाते हैं। Pratik Trade Center वाले बिल में यही दिखा: Azure ने text सही पढ़ा, पर items और total तब तक नहीं भरे जब तक parser को उसी text से टेबल पहचानना नहीं सिखाया गया।

## 2. सुझाव क्या है

एक Multimodal LLM API (जैसे Gemini, GPT, Claude) को बिल की image दी जाए। वह बिल को इंसान की तरह देखकर एक तय JSON schema में जवाब दे: voucher type, party, PAN, bill no, date, items, totals। यह जवाब draft वाउचर में भरने लायक होगा।

दो बातें इस सुझाव के साथ ज़रूरी हैं:

1. **AI हमेशा सही नहीं होता।** धुंधला अंक हो तो वह गलत, पर भरोसेमंद लगने वाली, संख्या लिख सकता है। इसलिए हमारी जाँच रहेगी: `qty × rate = amount`, और totals का मेल (जैसे Sub Total − Discount + VAT = Grand Total, बिल के हिसाब से)। जो मेल न खाए, वह field highlight होगी, और वाउचर अपने आप save नहीं होगा।
2. **AI ख़ुद हमेशा के लिए नहीं सीखता।** हर scan पर वह नया शुरू होता है, पिछली बात याद नहीं रखता। सीखने वाला हिस्सा हमारे app और server पर होगा: आप chat में एक बार समझाएँगे, बातें हमारे server पर save होंगी, अगली बार उसी तरह के कागज़ पर वे बातें AI को context में भेज दी जाएँगी।

उदाहरण, जो हम पहले ही चर्चा कर चुके हैं:

- **connectIPS Payment Transaction Details:** «Customer Account Details» भेजने वाला (payer) है; «Beneficiary Details» पाने वाला (receiver) है। Beneficiary हमारी company हो (जैसे New parsa Engineering workshop) तो यह Receipt है। भेजने वाले का नाम «Reference Id» में `ACCOUNTFT:` के बाद होता है (जैसे Nabiullah Ansari)। Transaction Amount असली रकम है, Charge Amount bank का शुल्क है।
- **Pratik Trade Center का इनवॉइस:** असली मात्रा `QTY` column की है, `ALT QTY` की नहीं।

## 3. अंसारी जी के नियम

ये नियम आपने इस चर्चा में दिए हैं। नए नियम इसी सूची में अगले नंबर से जुड़ेंगे।

1. पहले chat window बनेगी (Phase 1)।
2. API सिर्फ़ एक Gemini के लिए नहीं होगी। ज़रूरत हो तो और AI भी जुड़ सकें: ChatGPT (OpenAI), Grok (xAI), Claude (Anthropic), DeepSeek आदि।
3. अगर हर AI के लिए अलग window बनानी पड़े, तो सब एक साथ नहीं बनेंगी। अगर एक ही window से हो सके, तो उसी में सबका option रहेगा (provider चुनने का dropdown)।
4. Training वाला data server पर एक अलग folder में रहेगा, ताकि गलती से delete न हो, और folder खोलकर देखा जा सके।
5. AI को OCR settings में ही एक engine के रूप में जोड़ना है (2026-11-12)। Server Master को भी बताना है।
6. DeepSeek को plan में अगले AI के रूप में जोड़ो, पर अंसारी जी की इजाज़त के बिना app में नहीं लगेगा। आम नियम: कोई भी नया AI provider अंसारी जी की इजाज़त के बिना app या server में नहीं जुड़ेगा।
7. OCR-AI का बाकी काम अब अंसारी जी से हर बार पूछे बिना आगे बढ़ सकता है (अंसारी जी, 2026-11-12)। नियम 6 वैसा ही रहेगा: नया AI provider जोड़ने से पहले इजाज़त ज़रूरी है।

### इस काम पर लागू साझा नियम

ये पहले से मान्य नियम हैं, इस प्लान पर भी लागू रहेंगे:

- API keys सिर्फ़ server पर रहेंगी। App, Git, या chat में key की value नहीं लिखी जाएगी, और कभी print नहीं होगी।
- Firebase का कोई code नहीं आएगा।
- PocketBase एक ही है, Server PC (ServerWin10) पर, port 8090।
- Development laptop पर होगी; dev server port 2000 पर चलता है।
- Commit और push सिर्फ़ Git Master करेंगी, आपकी हाँ के बाद।
- Server पर deploy Server Master करेंगी, उनकी chat में आपकी हाँ के बाद।
- कोई code बदलने से पहले प्लान और आपकी हाँ ज़रूरी है।
- किसी फाइल की अलग backup copy नहीं बनेगी (कोई `.bak`, कोई backup folder नहीं)। Git ही backup है।
- Cloudflared की फाइलें नहीं छुएँगे।
- Folder के नाम नहीं बदलेंगे।
- हर फाइल या data की एक copy अंसारी जी के PC (laptop) पर भी रहे। (Training folder को Git में डालें या सिर्फ़ copy करें, यह खंड 9 में खुला सवाल है।)

## 4. एक window और कई AI — सुझाव

सुझाव यह है कि **एक ही chat window** बने, और **एक ही server gateway** हो। हर AI के लिए एक छोटा adapter होगा। Window में provider चुनने का dropdown रहेगा।

तकनीकी कारण: ज़्यादातर providers OpenAI-जैसी chat API देते हैं, इसलिए एक ही window और एक जैसा request-response चल सकता है। Gemini और Anthropic (Claude) की API थोड़ी अलग है, उनके अपने adapter बनेंगे।

**जाँचना है (अभी तथ्य नहीं):** हर provider और हर model पर image / vision (बिल की फोटो भेजना) एक जैसा नहीं होता। Scan के लिए किसी provider को चालू करने से पहले यह जाँचना ज़रूरी है कि वह model image लेता है या नहीं, और जवाब तय JSON schema में दे सकता है या नहीं। कीमतें और क्षमताएँ इस प्लान में तयशुदा तथ्य नहीं हैं; चुनते समय जाँच करके लिखी जाएँगी।

Phase 4 में नए providers एक-एक करके जुड़ेंगे, सब एक साथ नहीं।

## 5. काम के चरण

### Phase 1 — Chat window

सबसे पहले app में एक chat window। उसमें provider चुनने का dropdown, server पर एक endpoint, और keys server पर। यह window पहले एक AI से बात कर सके; बाकी providers बाद में उसी window में option के रूप में जुड़ेंगे।

इस चरण का मकसद: आप AI से बात कर सकें, और आगे चलकर उसी chat में कागज़ की समझ बता सकें। हिसाब का निजी data बिना आपके फैसले के AI को नहीं जाएगा।

### Phase 2 — AI से बिल scan

बिल की image चुने हुए AI को जाएगी, और जवाब एक तय JSON schema में आएगा, मसलन:

- `voucher_type` (Purchase, Receipt, आदि)
- `party_name`, `pan_vat_no`
- `invoice_no` / bill no
- `date` (AD और, जहाँ मिलें, BS / Miti)
- `items` (name, qty, unit, rate, amount)
- `subtotal`, `discount`, `taxable`, `vat`, `grand_total`

हमारे code की जाँच:

- `qty × rate = amount`
- totals का मेल (बिल के हिसाब से, जैसे Sub Total − Discount + VAT = Grand Total)
- मेल न हो तो वही field highlight होगी; वाउचर अपने आप save नहीं होगा

**ये बातें नहीं बदलेंगी:**

- मौजूदा Azure, Google Vision और local Tesseract fallback रहेंगे। AI fail हो या key न हो तो पुराना रास्ता चले।
- Party, account और item का मिलान हमारा code ही करेगा। AI सिर्फ़ बिल पढ़ेगा।

### Phase 3 — हर तरह के कागज़ को सिखाना

हर कागज़ की एक पहचान बनेगी (शीर्षक, logo वाला text, PAN, लेआउट की खास बातें)। उस पहचान के साथ आपके नियम और एक सही भरा उदाहरण server पर save होंगे। अगली बार ऐसा कागज़ आने पर ये बातें AI को context में मिलेंगी।

आप नियम देख, बदल या मिटा सकेंगे। मिटाना सिर्फ़ app की UI से, confirm के बाद। सूची में 100, 200 या 500 तरह के कागज़ रह सकते हैं। जब तक कोई कागज़ पहचाना न जाए, वह आम तरीके से पढ़ा जाएगा; एक बार समझा देने पर वह सूची में जुड़ जाएगा।

### Phase 4 — और providers, एक-एक करके

ChatGPT, Grok, Claude, DeepSeek आदि उसी window में, जाँच के बाद, एक-एक करके जुड़ेंगे।

## 6. Training data कहाँ रहेगा

सुझाव: Server PC पर `pb_data` के बाहर एक साफ़, पढ़ने लायक folder, उदाहरण के लिए:

`C:\PocketLedger-AI-Training\`

इसमें हर document type की एक JSON फाइल हो, और एक index फाइल हो। फाइलें खोलकर पढ़ी और जाँची जा सकें। PocketBase में सिर्फ़ pointer / cache रहे; असली प्रशिक्षण-डेटा उस folder में रहे।

किसी प्रकार को मिटाना सिर्फ़ app की UI से, confirm के बाद। गलती से `pb_data` साफ़ होने पर यह data साथ न जाए, इसलिए यह folder `pb_data` के बाहर है।

एक प्रकार की बात बदलने पर **उसी फाइल के अंदर** थोड़ा इतिहास रहे (कौन-सी बात कब बदली)। अलग `.bak` या backup folder नहीं बनेगा — आपका नियम है कि अलग backup फाइलें नहीं, Git ही backup है।

**खुला सवाल:** इस folder को Git में रखना है, या Git के बाहर रखकर नियम के अनुसार laptop (अंसारी जी के PC) पर copy रखना है? Exact path भी आप तय करें; ऊपर वाला सिर्फ़ सुझाव है।

### Storage का अंदाज़ा

ये नापे हुए आँकड़े नहीं, चर्चा के लिए अनुमान हैं:

- सिर्फ़ नियम और पहचान वाला text: लगभग 2 से 5 KB प्रति कागज़-प्रकार
- सही भरा उदाहरण (JSON) साथ हो तो लगभग 5 से 10 KB प्रति कागज़-प्रकार
- 500 प्रकार, बिना photo: लगभग 10 MB से कम
- हर प्रकार की एक वैकल्पिक नमूना photo (100–300 KB): 500 प्रकार पर लगभग 50 से 150 MB
- Photo ज़रूरी नहीं; पहचान text से भी हो सकती है
- यह हर scan की photo नहीं है। Scan वाली photos वाउचर के साथ पहले से save होती हैं। हर *प्रकार* की, ज़्यादा से ज़्यादा, एक नमूना photo

GB तक जाने का अनुमान नहीं है। 100–200 MB बड़ी बात नहीं है; GB में होता तो दिक्कत होती।

## 7. मालिक कौन

- **OCR / scan वाला हिस्सा:** OCR Master — `src/modules/ocr`, `src/lib/ocr`, और server की `ocr_cloud.js` में OCR से जुड़ा भाग।
- **Chat window का मालिक:** अभी तय नहीं; अंसारी जी तय करेंगे।
- **Server पर नए endpoint, keys, training folder:** Server Master लगाएँगी, अपनी chat में आपकी हाँ के बाद।
- **Commit / push:** Git Master, आपकी हाँ के बाद।

मौजूदा `ocr_cloud.js` आज Google Vision और Azure Read चलाती है, और keys server पर रखती है। नया AI gateway इसी सोच पर बने: keys server पर, app में नहीं। इसे पुरानी फाइल में मिलाना है या पास में नई फाइल बनानी है, यह काम शुरू करते समय तय होगा।

## 8. Privacy और खर्च

- बिल की image चुने हुए AI वाली कंपनी के सर्वर पर जाएगी (Google, OpenAI, xAI, Anthropic, DeepSeek — जो उस समय चुना हो)। यह बात settings में साफ़ दिखनी चाहिए।
- Training के नियम और उदाहरण हमारे server पर रहेंगे; किसी AI कंपनी के पास «हमेशा के लिए सीखने» के लिए नहीं जाएँगे। फिर भी, जो image या text हम API पर भेजेंगे, वह उस कंपनी की नीति के अधीन होगा।
- हर scan और हर chat message पर खर्च लगेगा। Chat में ज़्यादा text हो तो खर्च एक scan जितना, या उससे कुछ ज़्यादा, हो सकता है। Gemini और DeepSeek की कीमतें 2026-11-12 को official pages से जाँचकर खंड 10 में लिखी हैं; बाकी providers की कीमतें चुनते समय जाँची जाएँगी।

## 9. खुले सवाल

1. Training folder का exact path क्या रहे? सुझाव: Server PC पर `C:\PocketLedger-AI-Training\`
2. यह folder Git में जाए, या Git के बाहर रहे और laptop पर copy रखी जाए?
3. Chat window का मालिक कौन होगा — OCR Master, कोई और bot, या बाद में तय?
4. ~~Phase 1 के बाद scan के लिए सबसे पहले कौन-सा AI जाँचें?~~ तय: Gemini, OCR settings में engine के रूप में (2026-11-12)। अगला उम्मीदवार DeepSeek, अंसारी जी की इजाज़त के बाद।
5. Chat पहले सिर्फ़ कागज़ सिखाने के लिए रहे, या बाद में हिसाब के सवाल (जैसे «इस महीने Pratik से कितनी purchase हुई») भी पूछे जा सकें? दूसरे मामले में company का data AI को भेजने के नियम अलग से तय करने होंगे।
6. हर कागज़-प्रकार की एक नमूना photo शुरू से रखें, या पहले सिर्फ़ text और उदाहरण?

## 10. आज की चर्चा से तय बातें (2026-11-12)

### 10.1 खर्च कैसे गिना जाता है

- AI कंपनी न chat गिनती है न file, वह **tokens** गिनती है (text के छोटे टुकड़े, लगभग 3–4 अंग्रेज़ी अक्षर का एक token)।
- एक voucher भरवाने में तीन चीज़ें गिनी जाती हैं: **input text** (हमारा निर्देश, JSON schema, उस कागज़ के सिखाए नियम), **बिल की photo** (photo भी tokens में बदलकर गिनी जाती है), और **output** (AI का लौटाया JSON)। Output की कीमत input से ज़्यादा होती है।
- हर scan और chat का हर message **1 request** गिना जाता है। 10 सवाल = 10 requests।
- Free plan में प्रति मिनट और प्रति दिन requests की सीमा होती है, और यह सीमा **chat और scan दोनों में साझा** होती है। Paid plan में सीमा काफ़ी ऊँची होती है।
- हमारा app हर AI scan पर tokens दिखाता है: «Read by: AI (Gemini)» badge के tooltip और debug rule log में (`OCR pass: ai (gemini) | … tokens in / out / total`)।

### 10.2 Chat का इतिहास (history)

- Chat हमारे server पर save होगी, इसलिए app या phone को पुरानी बातें दोबारा नहीं भेजनी पड़ेंगी; app सिर्फ़ नया message भेजेगा।
- पर AI (Gemini आदि) पिछली बात याद नहीं रखता (stateless)। हर नए message के साथ हमारे server को पूरी बातचीत (context) AI को दोबारा भेजनी पड़ती है: पहला message «hello»; दूसरे में «hello» + जवाब + नया सवाल; और आगे इसी तरह। इसलिए लंबी chat में हर message महँगा होता जाता है।
- बचाव के तरीके: पुरानी बातों का छोटा सार (summary) भेजना; सिर्फ़ आख़िरी N (जैसे 10–20) messages भेजना; नए विषय के लिए «New chat» button; और provider की **context caching** सुविधा (बार-बार जाने वाला हिस्सा सस्ते दाम पर गिना जाता है, पर गिना ज़रूर जाता है)।

### 10.3 Photo दोबारा न जाए

- अगर photo chat के इतिहास में रहे, तो हर नए message के साथ वह भी दोबारा जाती है और उसके tokens फिर गिने जाते हैं।
- नियम: photo सिर्फ़ उसी message में जाए जिसमें उसे पढ़वाना है। पढ़ने के बाद इतिहास में photo की जगह उससे निकला JSON रहे, जो बहुत हल्का है। «party बदल दो», «VAT हटाओ» जैसे आगे के messages में सिर्फ़ text जाएगा।
- OCR scan में हर scan अलग request है; उसमें पुरानी chat नहीं जाती।

### 10.4 Chat से voucher

- आप chat में photo डालकर कहेंगे «यह voucher entry कर दो»। AI photo पढ़कर JSON लौटाएगा, और हमारा app उसी से New Trxn का form भरेगा।
- AI ख़ुद app में कुछ save नहीं करेगा; form हमारा code भरेगा। Form भरने से पहले हमारी जाँच चलेगी (नीचे 10.6), और जो मेल न खाए वह highlight होगा।
- आप form देखकर ख़ुद **Save** दबाएँगे। बिना देखे कभी auto-save नहीं होगा।
- बाद में (वैकल्पिक, आपकी हाँ के बाद): जो voucher सारी जाँच में पूरी तरह पास हों, वे अपने आप **Draft** में जा सकें।

### 10.5 Gallery से कई voucher एक साथ

- Chat में: «Gallery की unassigned files पढ़कर voucher बना दो»। App हर file को **अलग request** के रूप में AI को भेजेगा (पुरानी chat साथ नहीं जाएगी)।
- Free plan की प्रति मिनट सीमा के कारण files **कतार (queue)** में धीरे-धीरे जाएँगी।
- नतीजे एक सूची में आएँगे; हर voucher के आगे लिखा होगा कि वह जाँच में **पास** हुआ या किस field में **शक** है। सही वालों को एक साथ **Save** या **Draft** किया जा सकेगा; शक वालों को खोलकर ठीक किया जाएगा।
- Gallery वाला हिस्सा Gallery Master का है। Unassigned files की सूची लेने और voucher से जोड़ने के लिए उनसे तालमेल ज़रूरी है।

### 10.6 JSON schema: ढाँचा पक्का, value नहीं

- Request के साथ JSON schema भेजने पर जवाब हमेशा उसी ढाँचे में आता है (वही field नाम, number की जगह number)। यह हिस्सा भरोसेमंद है।
- पर value के 100% सही होने की गारंटी नहीं (धुंधले बिल में 98.00 की जगह 96.00 पढ़ा जा सकता है)। इसलिए हमारी जाँच हमेशा रहेगी: `qty × rate = amount`; items का जोड़ = Sub Total; Sub Total − Discount = Taxable; Taxable × 13% = VAT; Taxable + VAT = Grand Total; PAN 9 अंक का (और हमारी company का PAN कभी party नहीं); AD date और BS मिति का मेल; party, account, item हमारी सूची में। जो मेल न खाए वह flag होगा और form में नहीं लिखा जाएगा।

### 10.7 नियम अपने आप साथ जाएँगे

AI को हर बार नियम चाहिए (उसे पिछली बात याद नहीं)। पर आपको हर message में नियम नहीं लिखने होंगे। हमारा server हर request के साथ अपने आप जोड़ेगा:

- **हमेशा वाले नियम:** JSON schema, «QTY column लो, ALT QTY नहीं», «PAN 9 अंक», «VAT 13%», «date AD और BS दोनों», «पढ़ न सको तो null छोड़ो, अंदाज़ा मत लगाओ»।
- **उस कागज़-प्रकार के सिखाए नियम** (Phase 3): सिर्फ़ तब, जब वही कागज़ पहचाना जाए।
- **हमारी company की जानकारी:** नाम और PAN, ताकि AI समझे कि buyer हम हैं या seller।

### 10.8 Gemini के तथ्य (ai.google.dev, 2026-11-12 को जाँचे)

- `gemini-2.5-flash` अब deprecated है: AI Studio में नए users के लिए उपलब्ध नहीं, और 1 दिसंबर 2026 से उसकी requests `gemini-3.5-flash-lite` पर, उसी की कीमतों पर, जाएँगी। अलग से सादा `gemini-3.5-flash` नाम का model नहीं है। इसलिए हमारा default model **`gemini-3.5-flash-lite`** है; admin OCR settings में model का नाम बदल सकता है।
- `gemini-3.5-flash-lite` कीमत (official pricing page ai.google.dev/gemini-api/docs/pricing, 2026-11-12 को जाँचा):
  - **Free tier:** input और output मुफ़्त, पर हर Google project पर rate limit। Data «used to improve our products: Yes», यानी Google भेजा गया data अपने products सुधारने में इस्तेमाल कर सकता है।
  - **Paid tier (प्रति 1M tokens):** input (text / image) $0.30, output $2.50 (thinking tokens मिलाकर)। Data products सुधारने में इस्तेमाल नहीं होता।
- अनुमान (नापा नहीं): लगभग **$0.002–0.003 प्रति बिल** (paid tier)। असली खर्च «Read by» tooltip और debug के tokens से देखा जा सकेगा।
- **सुझाव:** test free tier पर करें। असली ग्राहकों के बिलों (PAN, रकम) के लिए billing चालू करें, ताकि data Google के product सुधार में न जाए।
- Request: `POST /v1beta/models/{model}:generateContent`, key सिर्फ़ `x-goog-api-key` header में (URL में कभी नहीं), photo `inlineData` (base64 + mime type), `generationConfig.responseMimeType = application/json` + `responseJsonSchema`।

### 10.9 DeepSeek (अगला उम्मीदवार; app में अभी नहीं)

नियम 6 के अनुसार: plan में है, पर अंसारी जी की इजाज़त के बिना app या server में कोई code नहीं लगेगा। Official pricing page (api-docs.deepseek.com/quick_start/pricing, 2026-11-12 को जाँचा) के अनुसार:

- Model `deepseek-flash` (DeepSeek-V4.1-Flash)। API OpenAI-format में है, base URL `https://api.deepseek.com`।
- Vision (photo) और JSON output support करता है; 1M tokens का context।
- कीमत प्रति 1M tokens: input (cache-miss) $0.15 off-peak / $0.30 peak; output $0.60 off-peak / $1.20 peak।
- Peak समय: सोम–शुक्र 01:00–04:00 और 06:00–10:00 UTC, यानी नेपाल समय 06:45–09:45 और 11:45–15:45। बाकी समय (off-peak) आधी कीमत।
- Free tier नहीं है: पहले पैसे top-up (prepaid) करने होते हैं; कभी-कभी «granted balance» मिलता है।
- मोटा अनुमान (नापा नहीं): लगभग $0.001–0.002 प्रति बिल।

### 10.10 कई keys के बारे में

- एक ही Google project की कई keys उसी project का quota साझा करती हैं; इससे ज़्यादा usage नहीं मिलता।
- सिर्फ़ free quota के लिए कई accounts बनाना provider की शर्तों (terms) के ख़िलाफ़ हो सकता है। **सुझाव नहीं।**
- सुझाया तरीका: **अलग-अलग AI providers** की keys रखें, और एक की सीमा भर जाए तो app अपने आप दूसरे पर चला जाए (automatic failover)। आज भी AI fail हो तो app Azure / Google, फिर local OCR पर जाता है। ज़्यादा usage के लिए provider पर billing चालू करें।

## 11. चरणों की स्थिति

| चरण | स्थिति |
|---|---|
| Phase 1 — Chat window | **MVP पूरा, 2026-11-12 (server 16:37 NPT deploy)।** OCR bar में «AI chat» बटन और OCR settings → Online OCR → AI (Gemini) card में «Open AI chat / teaching»। खंड 12 देखें। |
| Phase 2 — AI से बिल scan (Gemini OCR engine) | **Code पूरा और Server PC पर deploy, 2026-11-12, 10:19 NPT।** OCR settings में «AI (Gemini)» engine, server `ocr_cloud.js` में Gemini, migration `1763800000_ocr_ai_keys.js` (collection `user_ai_keys` बनी), हमारी जाँच, fallback (Azure / Google, फिर local)। **बाकी:** अंसारी जी OCR settings में Gemini key डालें और Pratik बिल पर test करें। |
| Phase 3 — हर कागज़-प्रकार को सिखाना | **MVP पूरा, 2026-11-12।** Chat में Gemini नियम सुझाता है → «Save rule» → server folder `C:\PocketLedger-AI-Training\<companyId>\<docType>.json`; हर AI scan में general + उस प्रकार के नियम (3000 अक्षर तक) जाते हैं। खंड 12 देखें। |
| Phase 4 — और providers | DeepSeek अगला उम्मीदवार (खंड 10.9); अंसारी जी की इजाज़त के बिना कोई code नहीं। |


## 12. AI chat / सिखाना (MVP, 2026-11-12)

- **कहाँ:** Add / Edit voucher में OCR bar पर «AI chat»; OCR settings → Online OCR → «AI (Gemini)» card (Azure box के नीचे, company switch के ऊपर) में «Open AI chat / teaching»। Company switch बंद हो तो card में साफ़ hint दिखता है।
- **Chat:** history सिर्फ़ इसी browser session में (sessionStorage); हर संदेश पर आख़िरी 12 text संदेश जाते हैं; बिल फ़ोटो / AI JSON सिर्फ़ उसी संदेश के साथ जिसमें «Attach this bill» / «Send AI result» चुना हो। Gemini उसी भाषा में जवाब देता है जिसमें आप लिखते हैं (भाषा ज़बरदस्ती नहीं)। Dialog और card के labels app की language setting (UI / Intro) के हिसाब से (en / hi / ne, बाकी भाषाओं में English) — OCR-local table `src/modules/ocr/ai/aiChatStrings.ts`।
- **नियम:** Gemini एक छोटा general नियम (`proposed_rule`) सुझाता है; admin बदल कर «Save rule» दबाते हैं। «Saved rules» tab: प्रकार-वार list, हाथ से नया नियम, Remove (soft: फाइल में `_removed` में रहता है, history भी)। सिर्फ़ company admin नियम बदल सकते हैं; allowed users पढ़ सकते हैं।
- **Folder:** `C:\PocketLedger-AI-Training` (env `PL_OCR_AI_TRAINING_DIR` से बदल सकते हैं), pb_data से बाहर, पहले save पर बनता है: `README.txt`, `<companyId>\company.json`, `<companyId>\general|purchase|sale|receipt|payment|expense|other.json`। Code कभी कुछ delete नहीं करता; खराब (invalid JSON) फाइल को कभी overwrite नहीं करता और scan नहीं रुकता। प्रति प्रकार 60 नियम, प्रति नियम 600 अक्षर।
- **Server (OCR-owned):** नई `pb_hooks/lib/ocr_ai_training.js`; `lib/ocr_cloud.js` में `aiChat`, `aiRulesList`, `aiRuleSave`, `aiRuleRemove` और ai-read में नियम जोड़ना; routes `POST /api/ocr-cloud/ai-chat`, `GET|POST|DELETE /api/ocr-cloud/ai-rules`। ai-read जैसा ही gate (company switch, allowed users, admin की key) और वही rate limit / daily cap। Chat: temperature 0.3, max output 2048 tokens।
- **Tests:** `tools/ocr-cloud-test.mjs` 107/107 (27 नए AI chat / rules cases); `tests/ocr/aiChat.selftest.mts` 37/37; बाकी OCR selftests pass; tsc pass।
- **खुले सवाल:** नियमों की संख्या बढ़ने पर prompt cap (3000 अक्षर) काफ़ी है या नहीं; chat history server पर रखनी है या नहीं (अभी नहीं)।

---

अंसारी जी, यह Draft v3 है। नियम या चरण बदलने हों तो बताइए, इसी फाइल में जुड़ते या सुधरते रहेंगे। OCR-AI का बाकी काम नियम 7 के अनुसार आगे बढ़ेगा; नया AI provider (नियम 6) आपकी इजाज़त से ही जुड़ेगा।
