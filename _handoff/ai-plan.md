# AI से वाउचर भरना और Chat — चर्चा का प्लान

**स्थिति:** Draft v1, 2026-11-12, discussion के लिए; अभी कोई code नहीं

अंसारी जी, यह फाइल चर्चा के लिए है। जब तक आप हाँ न कहें, कोई code नहीं बदलेगा। आप जो नए नियम बताएँगे, वे नीचे खंड 3 «अंसारी जी के नियम» में अगले नंबर के साथ जुड़ते रहेंगे।

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
- हर scan और हर chat message पर खर्च लगेगा। Chat में ज़्यादा text हो तो खर्च एक scan जितना, या उससे कुछ ज़्यादा, हो सकता है। **कीमतें इस प्लान में नहीं लिखी गईं;** provider चुनते समय जाँच करके बताई जाएँगी।

## 9. खुले सवाल

1. Training folder का exact path क्या रहे? सुझाव: Server PC पर `C:\PocketLedger-AI-Training\`
2. यह folder Git में जाए, या Git के बाहर रहे और laptop पर copy रखी जाए?
3. Chat window का मालिक कौन होगा — OCR Master, कोई और bot, या बाद में तय?
4. Phase 1 के बाद scan के लिए सबसे पहले कौन-सा AI जाँचें? (सुझाव: Gemini, पर क्षमता और कीमत जाँच के बाद ही तय।)
5. Chat पहले सिर्फ़ कागज़ सिखाने के लिए रहे, या बाद में हिसाब के सवाल (जैसे «इस महीने Pratik से कितनी purchase हुई») भी पूछे जा सकें? दूसरे मामले में company का data AI को भेजने के नियम अलग से तय करने होंगे।
6. हर कागज़-प्रकार की एक नमूना photo शुरू से रखें, या पहले सिर्फ़ text और उदाहरण?

---

अंसारी जी, यह Draft v1 है। नियम या चरण बदलने हों तो बताइए, इसी फाइल में जुड़ते या सुधरते रहेंगे। आपकी हाँ के बिना कोई code नहीं बदलेगा।
