/* Pocket Ledger Server – all ISO 639-1 languages for the UI / Intro language dropdowns.
 * Format: [code, native name, English name], sorted by English name.
 * Hand translations: en, hi, ne. Other ISO codes are filled on first pick by
 * i18n-translate.js (cached). Shared by the browser (window.PL_LANGUAGES) and
 * the server hooks (require → module.exports) so validation uses the same list.
 */
(function () {
  var list = [
    ["ab", "Аԥсшәа", "Abkhazian"],
    ["aa", "Qafar", "Afar"],
    ["af", "Afrikaans", "Afrikaans"],
    ["ak", "Akan", "Akan"],
    ["sq", "Shqip", "Albanian"],
    ["am", "አማርኛ", "Amharic"],
    ["ar", "العربية", "Arabic"],
    ["an", "Aragonés", "Aragonese"],
    ["hy", "Հայերեն", "Armenian"],
    ["as", "অসমীয়া", "Assamese"],
    ["av", "Авар мацӀ", "Avaric"],
    ["ae", "Avesta", "Avestan"],
    ["ay", "Aymar aru", "Aymara"],
    ["az", "Azərbaycan", "Azerbaijani"],
    ["bm", "Bamanakan", "Bambara"],
    ["bn", "বাংলা", "Bangla"],
    ["ba", "Башҡорт теле", "Bashkir"],
    ["eu", "Euskara", "Basque"],
    ["be", "Беларуская", "Belarusian"],
    ["bi", "Bislama", "Bislama"],
    ["bs", "Bosanski", "Bosnian"],
    ["br", "Brezhoneg", "Breton"],
    ["bg", "Български", "Bulgarian"],
    ["my", "မြန်မာ", "Burmese"],
    ["ca", "Català", "Catalan"],
    ["ch", "Chamoru", "Chamorro"],
    ["ce", "Нохчийн", "Chechen"],
    ["zh", "中文", "Chinese"],
    ["cu", "Церковнослове́нскїй", "Church Slavic"],
    ["cv", "Чӑваш", "Chuvash"],
    ["kw", "Kernewek", "Cornish"],
    ["co", "Corsu", "Corsican"],
    ["cr", "ᓀᐦᐃᔭᐍᐏᐣ", "Cree"],
    ["hr", "Hrvatski", "Croatian"],
    ["cs", "Čeština", "Czech"],
    ["da", "Dansk", "Danish"],
    ["dv", "ދިވެހިބަސް", "Divehi"],
    ["nl", "Nederlands", "Dutch"],
    ["dz", "རྫོང་ཁ", "Dzongkha"],
    ["en", "English", "English"],
    ["eo", "Esperanto", "Esperanto"],
    ["et", "Eesti", "Estonian"],
    ["ee", "Eʋegbe", "Ewe"],
    ["fo", "Føroyskt", "Faroese"],
    ["fj", "Vosa Vakaviti", "Fijian"],
    ["fi", "Suomi", "Finnish"],
    ["fr", "Français", "French"],
    ["ff", "Pulaar", "Fula"],
    ["gl", "Galego", "Galician"],
    ["lg", "Luganda", "Ganda"],
    ["ka", "Ქართული", "Georgian"],
    ["de", "Deutsch", "German"],
    ["el", "Ελληνικά", "Greek"],
    ["gn", "Avañe’ẽ", "Guarani"],
    ["gu", "ગુજરાતી", "Gujarati"],
    ["ht", "Kreyòl Ayisyen", "Haitian Creole"],
    ["ha", "Hausa", "Hausa"],
    ["he", "עברית", "Hebrew"],
    ["hz", "Otjiherero", "Herero"],
    ["hi", "हिन्दी", "Hindi"],
    ["ho", "Hiri Motu", "Hiri Motu"],
    ["hu", "Magyar", "Hungarian"],
    ["is", "Íslenska", "Icelandic"],
    ["io", "Ido", "Ido"],
    ["ig", "Igbo", "Igbo"],
    ["id", "Indonesia", "Indonesian"],
    ["ia", "Interlingua", "Interlingua"],
    ["ie", "Interlingue", "Interlingue"],
    ["iu", "ᐃᓄᒃᑎᑐᑦ", "Inuktitut"],
    ["ik", "Iñupiaq", "Inupiaq"],
    ["ga", "Gaeilge", "Irish"],
    ["it", "Italiano", "Italian"],
    ["ja", "日本語", "Japanese"],
    ["jv", "Jawa", "Javanese"],
    ["kl", "Kalaallisut", "Kalaallisut"],
    ["kn", "ಕನ್ನಡ", "Kannada"],
    ["kr", "Kanuri", "Kanuri"],
    ["ks", "کٲشُر", "Kashmiri"],
    ["kk", "Қазақ тілі", "Kazakh"],
    ["km", "ខ្មែរ", "Khmer"],
    ["ki", "Gikuyu", "Kikuyu"],
    ["rw", "Ikinyarwanda", "Kinyarwanda"],
    ["kv", "Коми кыв", "Komi"],
    ["kg", "Kikongo", "Kongo"],
    ["ko", "한국어", "Korean"],
    ["kj", "Kuanyama", "Kuanyama"],
    ["ku", "Kurdî (kurmancî)", "Kurdish"],
    ["ky", "Кыргызча", "Kyrgyz"],
    ["lo", "ລາວ", "Lao"],
    ["la", "Latina", "Latin"],
    ["lv", "Latviešu", "Latvian"],
    ["li", "Limburgs", "Limburgish"],
    ["ln", "Lingála", "Lingala"],
    ["lt", "Lietuvių", "Lithuanian"],
    ["lu", "Tshiluba", "Luba-Katanga"],
    ["lb", "Lëtzebuergesch", "Luxembourgish"],
    ["mk", "Македонски", "Macedonian"],
    ["mg", "Malagasy", "Malagasy"],
    ["ms", "Melayu", "Malay"],
    ["ml", "മലയാളം", "Malayalam"],
    ["mt", "Malti", "Maltese"],
    ["gv", "Gaelg", "Manx"],
    ["mr", "मराठी", "Marathi"],
    ["mh", "Kajin M̧ajeļ", "Marshallese"],
    ["mn", "Монгол", "Mongolian"],
    ["mi", "Māori", "M\u0101ori"],
    ["na", "Dorerin Naoero", "Nauru"],
    ["nv", "Diné Bizaad", "Navajo"],
    ["ng", "Owambo", "Ndonga"],
    ["ne", "नेपाली", "Nepali"],
    ["nd", "IsiNdebele", "North Ndebele"],
    ["se", "Davvisámegiella", "Northern Sami"],
    ["no", "Norsk", "Norwegian"],
    ["nb", "Norsk bokmål", "Norwegian Bokm\u00e5l"],
    ["nn", "Norsk nynorsk", "Norwegian Nynorsk"],
    ["ny", "Nyanja", "Nyanja"],
    ["oc", "Occitan", "Occitan"],
    ["or", "ଓଡ଼ିଆ", "Odia"],
    ["oj", "ᐊᓂᔑᓈᐯᒧᐎᓐ", "Ojibwe"],
    ["om", "Oromoo", "Oromo"],
    ["os", "Ирон", "Ossetic"],
    ["pi", "पाऴि", "Pali"],
    ["ps", "پښتو", "Pashto"],
    ["fa", "فارسی", "Persian"],
    ["pl", "Polski", "Polish"],
    ["pt", "Português", "Portuguese"],
    ["pa", "ਪੰਜਾਬੀ", "Punjabi"],
    ["qu", "Runasimi", "Quechua"],
    ["ro", "Română", "Romanian"],
    ["rm", "Rumantsch", "Romansh"],
    ["rn", "Ikirundi", "Rundi"],
    ["ru", "Русский", "Russian"],
    ["sm", "Gagana fa'a Samoa", "Samoan"],
    ["sg", "Sängö", "Sango"],
    ["sa", "संस्कृत भाषा", "Sanskrit"],
    ["sc", "Sardu", "Sardinian"],
    ["gd", "Gàidhlig", "Scottish Gaelic"],
    ["sr", "Српски", "Serbian"],
    ["sn", "ChiShona", "Shona"],
    ["ii", "ꆈꌠꉙ", "Sichuan Yi"],
    ["sd", "سنڌي", "Sindhi"],
    ["si", "සිංහල", "Sinhala"],
    ["sk", "Slovenčina", "Slovak"],
    ["sl", "Slovenščina", "Slovenian"],
    ["so", "Soomaali", "Somali"],
    ["nr", "IsiNdebele", "South Ndebele"],
    ["st", "Sesotho", "Southern Sotho"],
    ["es", "Español", "Spanish"],
    ["su", "Basa Sunda", "Sundanese"],
    ["sw", "Kiswahili", "Swahili"],
    ["ss", "SiSwati", "Swati"],
    ["sv", "Svenska", "Swedish"],
    ["tl", "Filipino (Pilipinas)", "Tagalog"],
    ["ty", "Reo Tahiti", "Tahitian"],
    ["tg", "Тоҷикӣ", "Tajik"],
    ["ta", "தமிழ்", "Tamil"],
    ["tt", "Татар", "Tatar"],
    ["te", "తెలుగు", "Telugu"],
    ["th", "ไทย", "Thai"],
    ["bo", "བོད་སྐད་", "Tibetan"],
    ["ti", "ትግርኛ", "Tigrinya"],
    ["to", "Lea fakatonga", "Tongan"],
    ["ts", "Xitsonga", "Tsonga"],
    ["tn", "Setswana", "Tswana"],
    ["tr", "Türkçe", "Turkish"],
    ["tk", "Türkmen dili", "Turkmen"],
    ["tw", "Akan (Gaana)", "Twi"],
    ["uk", "Українська", "Ukrainian"],
    ["ur", "اردو", "Urdu"],
    ["ug", "ئۇيغۇرچە", "Uyghur"],
    ["uz", "O‘zbek", "Uzbek"],
    ["ve", "Tshivenḓa", "Venda"],
    ["vi", "Tiếng Việt", "Vietnamese"],
    ["vo", "Volapük", "Volap\u00fck"],
    ["wa", "Walon", "Walloon"],
    ["cy", "Cymraeg", "Welsh"],
    ["fy", "Frysk", "Western Frisian"],
    ["wo", "Wolof", "Wolof"],
    ["xh", "IsiXhosa", "Xhosa"],
    ["yi", "ייִדיש", "Yiddish"],
    ["yo", "Èdè Yorùbá", "Yoruba"],
    ["za", "Vahcuengh", "Zhuang"],
    ["zu", "IsiZulu", "Zulu"]
  ];
  // Language names in the chosen UI language (CLDR data), so the dropdown
  // reads e.g. "Français (फ्रान्सेली)" when the UI is Nepali. Only the fully
  // translated UI languages have this; others show the English name.
  var names = {
    hi: {ab: "अब्ख़ाज़ियन", aa: "अफ़ार", af: "अफ़्रीकी", ak: "अकन", sq: "अल्बानियाई", am: "अम्हेरी", ar: "अरबी", an: "अरागोनी", hy: "आर्मेनियाई", as: "असमिया", av: "अवेरिक", ae: "अवस्ताई", ay: "आयमारा", az: "अज़रबैजानी", bm: "बाम्बारा", bn: "बंगाली", ba: "बशख़िर", eu: "बास्क", be: "बेलारूसी", bi: "बिस्लामा", bs: "बोस्नियाई", br: "ब्रेटन", bg: "बुल्गारियाई", my: "बर्मीज़", ca: "कातालान", ch: "कमोरो", ce: "चेचन", zh: "चीनी", cu: "चर्च साल्विक", cv: "चूवाश", kw: "कोर्निश", co: "कोर्सीकन", cr: "क्री", hr: "क्रोएशियाई", cs: "चेक", da: "डेनिश", dv: "दिवेही", nl: "डच", dz: "ज़ोन्गखा", en: "अंग्रेज़ी", eo: "एस्पेरेंतो", et: "एस्टोनियाई", ee: "ईवे", fo: "फ़ैरोइज़", fj: "फिजियन", fi: "फ़िनिश", fr: "फ़्रेंच", ff: "फुलाह", gl: "गैलिशियन", lg: "गांडा", ka: "जॉर्जियाई", de: "जर्मन", el: "यूनानी", gn: "गुआरानी", gu: "गुजराती", ht: "हैतियाई", ha: "हौसा", he: "हिब्रू", hz: "हरैरो", hi: "हिन्दी", ho: "हिरी मोटू", hu: "हंगेरियाई", is: "आइसलैंडिक", io: "इडौ", ig: "ईग्बो", id: "इंडोनेशियाई", ia: "इंटरलिंगुआ", ie: "ईन्टरलिंगुइ", iu: "इनुक्टिटुट", ik: "इनुपियाक्", ga: "आयरिश", it: "इतालवी", ja: "जापानी", jv: "जावानीज़", kl: "कलालीसुत", kn: "कन्नड़", kr: "कनुरी", ks: "कश्मीरी", kk: "कज़ाख़", km: "खमेर", ki: "किकुयू", rw: "किन्यारवांडा", kv: "कोमी", kg: "कोंगो", ko: "कोरियाई", kj: "क्वान्यामा", ku: "कुर्दिश", ky: "किर्गीज़", lo: "लाओ", la: "लैटिन", lv: "लातवियाई", li: "लिंबर्गिश", ln: "लिंगाला", lt: "लिथुआनियाई", lu: "ल्यूबा-कटांगा", lb: "लग्ज़मबर्गी", mk: "मकदूनियाई", mg: "मालागासी", ms: "मलय", ml: "मलयालम", mt: "माल्टीज़", gv: "मैंक्स", mr: "मराठी", mh: "मार्शलीज़", mn: "मंगोलियाई", mi: "माओरी", na: "नाउरू", nv: "नवाहो", ng: "डोन्गा", ne: "नेपाली", nd: "उत्तरी देबेल", se: "नॉर्दन सामी", no: "नॉर्वेजियाई", nb: "नॉर्वेजियाई बोकमाल", nn: "नॉर्वेजियाई नॉयनॉर्स्क", ny: "न्यानजा", oc: "ओसीटान", or: "ओड़िया", oj: "ओजिब्वा", om: "ओरोमो", os: "ओस्सेटिक", pi: "पाली", ps: "पश्तो", fa: "फ़ारसी", pl: "पोलिश", pt: "पुर्तगाली", pa: "पंजाबी", qu: "क्वेचुआ", ro: "रोमानियाई", rm: "रोमान्श", rn: "रुन्दी", ru: "रूसी", sm: "सामोन", sg: "सांगो", sa: "संस्कृत", sc: "सार्दिनियन", gd: "स्कॉटिश गाएलिक", sr: "सर्बियाई", sn: "शोणा", ii: "सिचुआन यी", sd: "सिंधी", si: "सिंहली", sk: "स्लोवाक", sl: "स्लोवेनियाई", so: "सोमाली", nr: "दक्षिण देबेल", st: "दक्षिणी सेसेथो", es: "स्पेनिश", su: "सुंडानी", sw: "स्वाहिली", ss: "स्वाती", sv: "स्वीडिश", tl: "टैगलॉग", ty: "ताहितियन", tg: "ताजिक", ta: "तमिल", tt: "तातार", te: "तेलुगू", th: "थाई", bo: "तिब्बती", ti: "तिग्रीन्या", to: "टोंगन", ts: "सोंगा", tn: "सेत्स्वाना", tr: "तुर्की", tk: "तुर्कमेन", tw: "ट्वी", uk: "यूक्रेनियाई", ur: "उर्दू", ug: "उइगर", uz: "उज़्बेक", ve: "वेन्दा", vi: "वियतनामी", vo: "वोलापुक", wa: "वाल्लून", cy: "वेल्श", fy: "पश्चिमी फ़्रिसियाई", wo: "वोलोफ़", xh: "ख़ोसा", yi: "यहूदी", yo: "योरूबा", za: "ज़ुआंग", zu: "ज़ुलू"},
    ne: {ab: "अब्खाजियाली", aa: "अफार", af: "अफ्रिकान्स", ak: "आकान", sq: "अल्बानियाली", am: "अम्हारिक", ar: "अरबी", an: "अरागोनी", hy: "आर्मेनियाली", as: "आसामी", av: "अवारिक", ae: "अवेस्तान", ay: "ऐमारा", az: "अजरबैजानी", bm: "बाम्बारा", bn: "बंगाली", ba: "बास्किर", eu: "बास्क", be: "बेलारुसी", bi: "बिस्लाम", bs: "बोस्नियाली", br: "ब्रेटन", bg: "बुल्गेरियाली", my: "बर्मेली", ca: "क्याटालन", ch: "चामोर्रो", ce: "चेचेन", zh: "चिनियाँ", cu: "चर्च स्लाभिक", cv: "चुभास", kw: "कोर्निस", co: "कोर्सिकन", cr: "क्री", hr: "क्रोयसियाली", cs: "चेक", da: "डेनिस", dv: "दिबेही", nl: "डच", dz: "जोङ्खा", en: "अङ्ग्रेजी", eo: "एस्पेरान्तो", et: "इस्टोनियन", ee: "इवी", fo: "फारोज", fj: "फिजियन", fi: "फिनिस", fr: "फ्रान्सेली", ff: "फुलाह", gl: "गलिसियाली", lg: "गान्डा", ka: "जर्जियाली", de: "जर्मन", el: "ग्रीक", gn: "गुवारानी", gu: "गुजराती", ht: "हैटियाली क्रियोल", ha: "हाउसा", he: "हिब्रु", hz: "हेरेरो", hi: "हिन्दी", ho: "हिरी मोटु", hu: "हङ्गेरियाली", is: "आइसल्यान्डियाली", io: "इडो", ig: "इग्बो", id: "इन्डोनेसियाली", ia: "इन्टर्लिङ्गुआ", ie: "इन्टरलिङ्ग्वे", iu: "इनुक्टिटुट", ik: "इनुपिआक्", ga: "आइरिस", it: "इटालेली", ja: "जापानी", jv: "जाभानी", kl: "कालालिसुट", kn: "कन्नाडा", kr: "कानुरी", ks: "कास्मिरी", kk: "काजाख", km: "खमेर", ki: "किकुयु", rw: "किन्यारवान्डा", kv: "कोमी", kg: "कोङ्गो", ko: "कोरियाली", kj: "कुआन्यामा", ku: "कुर्दी", ky: "किर्गिज", lo: "लाओ", la: "ल्याटिन", lv: "लात्भियाली", li: "लिम्बुर्गी", ln: "लिङ्गाला", lt: "लिथुआनियाली", lu: "लुबा-काताङ्गा", lb: "लक्जेम्बर्गी", mk: "म्यासेडोनियन", mg: "मलागासी", ms: "मलाय", ml: "मलयालम", mt: "माल्टिज", gv: "मान्क्स", mr: "मराठी", mh: "मार्साली", mn: "मङ्गोलियाली", mi: "माओरी", na: "नाउरू", nv: "नाभाजो", ng: "न्दोन्गा", ne: "नेपाली", nd: "उत्तरी न्डेबेले", se: "उत्तरी सामी", no: "नर्वेली", nb: "नर्वेली बोकमाल", nn: "नर्वेली नाइनोर्स्क", ny: "न्यान्जा", oc: "अक्सिटन", or: "उडिया", oj: "ओजिब्वा", om: "ओरोमो", os: "ओस्सेटिक", pi: "पाली", ps: "पास्तो", fa: "फारसी", pl: "पोलिस", pt: "पोर्तुगी", pa: "पंजाबी", qu: "क्वेचुवा", ro: "रोमानियाली", rm: "रोमानिस", rn: "रुन्डी", ru: "रसियाली", sm: "सामोआ", sg: "साङ्गो", sa: "संस्कृत", sc: "सार्डिनियाली", gd: "स्कटिस गाएलिक", sr: "सर्बियाली", sn: "शोना", ii: "सिचुआन यि", sd: "सिन्धी", si: "सिन्हाली", sk: "स्लोभाकियाली", sl: "स्लोभेनियाली", so: "सोमाली", nr: "दक्षिण न्देबेले", st: "दक्षिणी सोथो", es: "स्पेनी", su: "सुडानी", sw: "स्वाहिली", ss: "स्वाती", sv: "स्विडिस", tl: "टागालोग", ty: "टाहिटियन", tg: "ताजिक", ta: "तामिल", tt: "तातार", te: "तेलुगु", th: "थाई", bo: "तिब्बती", ti: "टिग्रिन्या", to: "टोङ्गन", ts: "ट्सोङ्गा", tn: "ट्स्वाना", tr: "टर्किश", tk: "टर्कमेन", tw: "ट्वि", uk: "युक्रेनी", ur: "उर्दु", ug: "उइघुर", uz: "उज्बेकी", ve: "भेन्डा", vi: "भियतनामी", vo: "भोलापिक", wa: "वाल्लुन", cy: "वेल्श", fy: "पश्चिमी फ्रिसियन", wo: "वुलुफ", xh: "खोसा", yi: "यिद्दिस", yo: "योरूवा", za: "झुुआङ्ग", zu: "जुलु"}
  };
  var intlCache = {};
  function intlNames(ui) {
    if (ui === "en" || typeof window === "undefined" || !window.PL_I18N || !window.PL_I18N.ui[ui]) return null;
    if (typeof Intl === "undefined" || !Intl.DisplayNames) return null;
    if (!(ui in intlCache)) {
      try { intlCache[ui] = new Intl.DisplayNames([ui], { type: "language", fallback: "none" }); } catch (_) { intlCache[ui] = null; }
    }
    return intlCache[ui];
  }
  // Right-to-left scripts: page gets dir="rtl" when one of these is the UI language.
  var rtl = ["ar", "he", "fa", "ur", "ps", "sd", "yi"];
  var api = {
    list: list,
    rtl: rtl,
    codes: list.map(function (l) { return l[0]; }),
    has: function (code) {
      for (var i = 0; i < list.length; i++) if (list[i][0] === code) return true;
      return false;
    },
    isRtl: function (code) { return rtl.indexOf(code) !== -1; },
    // name of a language in UI language `ui` (English when not available).
    // hi / ne use the table above; other UI languages that have a translation
    // (i18n/<code>.js loaded) use the browser's own CLDR names (Intl.DisplayNames).
    // On the server (pb_hooks) there is no window / Intl, so English is used.
    name: function (code, ui) {
      if (ui && names[ui] && names[ui][code]) return names[ui][code];
      var dn = ui ? intlNames(ui) : null;
      if (dn) {
        try { var n = dn.of(code); if (n && n !== code) return n; } catch (_) { /* unknown code */ }
      }
      for (var i = 0; i < list.length; i++) if (list[i][0] === code) return list[i][2];
      return code;
    },
    // dropdown label: "native (name in UI language)", or one name when both are equal
    label: function (code, ui) {
      for (var i = 0; i < list.length; i++) {
        var l = list[i];
        if (l[0] === code) {
          var n = api.name(code, ui);
          return l[1].toLowerCase() === n.toLowerCase() ? n : l[1] + " (" + n + ")";
        }
      }
      return code;
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.PL_LANGUAGES = api;
})();
