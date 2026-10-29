/* Website UI + intro language. Same keys as Pocket Ledger Server: pl_server_ui_lang / pl_server_intro_lang. */
(function (global) {
  "use strict";
  var UI_KEY = "pl_server_ui_lang";
  var INTRO_KEY = "pl_server_intro_lang";
  var DEF = "en";

  var UI = {
    en: {
      signin: "Sign in",
      signout: "Sign out",
      goto_app: "Go to App",
      open_app: "Open App",
      admin_panel: "Admin Panel",
      theme: "Appearance",
      theme_light: "Light",
      theme_gray: "Gray",
      theme_medium: "Medium",
      theme_dark: "Dark",
      s_language: "Language",
      lang_ui: "UI language",
      lang_intro: "Intro language",
      search_lang: "Search language…",
      intro_hide: "Hide",
      intro_show_aria: "Show info texts (all pages)",
      intro_hide_aria: "Hide info texts (all pages)",
      nav_home: "Home",
      nav_features: "Features",
      nav_videos: "Videos",
      nav_pricing: "Pricing",
      nav_downloads: "Downloads",
      nav_company: "Company",
      gate_choose: "Choose your country",
      gate_h1: "Where do you keep the books?",
      find_country: "Find Your Country",
      demo: "Demo",
      demo_desc: "See Pocket Ledger on desktop, tablet and phone.",
      about: "About Us",
      about_desc: "The software company behind Pocket Ledger.",
      downloads: "Downloads",
      downloads_desc: "Windows EXE and Android APK.",
      features: "Features",
      features_desc: "Vouchers, ledgers, backup and more.",
      coming_soon: "Coming soon",
      continue_google: "Continue with Google",
      or: "or",
      email: "Email",
      password: "Password",
      close: "Close",
      data_settings_firebase: "Books show and save from Settings: Firebase. Email or Google is only your login.",
      data_settings_pocketbase: "Books show and save from Settings: Pocket Ledger Server. Email or Google is only your login.",
      version: "Version"
    },
    hi: {
      signin: "साइन इन",
      signout: "साइन आउट",
      goto_app: "ऐप खोलें",
      open_app: "ऐप खोलें",
      admin_panel: "एडमिन पैनल",
      theme: "दिखावट",
      theme_light: "हल्की",
      theme_gray: "धूसर",
      theme_medium: "मध्यम",
      theme_dark: "गहरी",
      s_language: "भाषा",
      lang_ui: "इंटरफ़ेस भाषा",
      lang_intro: "जानकारी भाषा",
      search_lang: "भाषा खोजें…",
      intro_hide: "छिपाएँ",
      intro_show_aria: "जानकारी दिखाएँ (सभी पेज)",
      intro_hide_aria: "जानकारी छिपाएँ (सभी पेज)",
      nav_home: "होम",
      nav_features: "सुविधाएँ",
      nav_videos: "वीडियो",
      nav_pricing: "कीमत",
      nav_downloads: "डाउनलोड",
      nav_company: "कंपनी",
      gate_choose: "अपना देश चुनें",
      gate_h1: "किताबें कहाँ रखती हैं?",
      find_country: "अपना देश खोजें",
      demo: "डेमो",
      demo_desc: "डेस्कटॉप, टैबलेट और फ़ोन पर Pocket Ledger देखें।",
      about: "हमारे बारे में",
      about_desc: "Pocket Ledger के पीछे की सॉफ़्टवेयर कंपनी।",
      downloads: "डाउनलोड",
      downloads_desc: "Windows EXE और Android APK।",
      features: "सुविधाएँ",
      features_desc: "वाउचर, लेजर, बैकअप और और भी।",
      coming_soon: "जल्द आ रहा है",
      continue_google: "Google से जारी रखें",
      or: "या",
      email: "ईमेल",
      password: "पासवर्ड",
      close: "बंद करें",
      data_settings_firebase: "किताबें Settings से दिखेंगी/सेव होंगी: Firebase. ईमेल या Google केवल लॉगिन है।",
      data_settings_pocketbase: "किताबें Settings से दिखेंगी/सेव होंगी: Pocket Ledger Server. ईमेल या Google केवल लॉगिन है।",
      version: "वर्शन"
    },
    ne: {
      signin: "साइन इन",
      signout: "साइन आउट",
      goto_app: "एप खोल्नुहोस्",
      open_app: "एप खोल्नुहोस्",
      admin_panel: "एडमिन प्यानल",
      theme: "देखावट",
      theme_light: "उज्यालो",
      theme_gray: "खरानी",
      theme_medium: "मध्यम",
      theme_dark: "गाढा",
      s_language: "भाषा",
      lang_ui: "इन्टरफेस भाषा",
      lang_intro: "जानकारी भाषा",
      search_lang: "भाषा खोज्नुहोस्…",
      intro_hide: "लुकाउनुहोस्",
      intro_show_aria: "जानकारी देखाउनुहोस् (सबै पेज)",
      intro_hide_aria: "जानकारी लुकाउनुहोस् (सबै पेज)",
      nav_home: "गृह",
      nav_features: "सुविधा",
      nav_videos: "भिडियो",
      nav_pricing: "मूल्य",
      nav_downloads: "डाउनलोड",
      nav_company: "कम्पनी",
      gate_choose: "आफ्नो देश छान्नुहोस्",
      gate_h1: "खाता कहाँ राख्नुहुन्छ?",
      find_country: "आफ्नो देश खोज्नुहोस्",
      demo: "डेमो",
      demo_desc: "डेस्कटप, ट्याब्लेट र फोनमा Pocket Ledger हेर्नुहोस्।",
      about: "हाम्रोबारे",
      about_desc: "Pocket Ledger पछाडिको सफ्टवेयर कम्पनी।",
      downloads: "डाउनलोड",
      downloads_desc: "Windows EXE र Android APK।",
      features: "सुविधा",
      features_desc: "भाउचर, लेजर, ब्याकअप र थप।",
      coming_soon: "चाँडै आउँदै",
      continue_google: "Google बाट जारी राख्नुहोस्",
      or: "वा",
      email: "इमेल",
      password: "पासवर्ड",
      close: "बन्द गर्नुहोस्",
      data_settings_firebase: "खाता Settings बाट देखिन्छ/सेभ हुन्छ: Firebase. इमेल वा Google केवल लगइन हो।",
      data_settings_pocketbase: "खाता Settings बाट देखिन्छ/सेभ हुन्छ: Pocket Ledger Server. इमेल वा Google केवल लगइन हो।",
      version: "संस्करण"
    }
  };

  var INTRO = {
    en: {
      gate_lead: "Open your country’s Pocket Ledger site. That country web runs on its own — including plans and payment. Main also takes subscriptions for people who stay on pocket-ledger.com. Each subdomain has its own terms; main is not responsible for a country site.",
      gate_features_lead: "Same books on desktop, tablet and phone, and the web app.",
      feature_list_lead: "What you get inside Pocket Ledger (web, Windows EXE, and Android APK).",
      home_hero: "Same books on Windows EXE, Android APK, and the web app. This site is for visitors — your accounts open only from Go to App.",
      home_hero_note: "pocket-ledger.com = choose country · this page = your country site · /app = application",
      home_features_lead: "Use the marketing site here. Open books only under /app.",
      gate_foot: "Each country site (np, in, us, nz) has its own terms and billing. pocket-ledger.com is not responsible for a country subdomain."
    },
    hi: {
      gate_lead: "अपने देश की Pocket Ledger साइट खोलें। वह देश अपनी योजना और भुगतान खुद चलाता है। जो लोग pocket-ledger.com पर रहते हैं उनके लिए मेन भी सदस्यता लेता है। हर सबडोमेन की अपनी शर्तें हैं; मेन देश साइट का ज़िम्मेदार नहीं है।",
      gate_features_lead: "एक ही किताबें डेस्कटॉप, टैबलेट, फ़ोन और वेब ऐप पर।",
      feature_list_lead: "Pocket Ledger के अंदर क्या मिलता है (वेब, Windows EXE और Android APK)।",
      home_hero: "Windows EXE, Android APK और वेब ऐप पर वही किताबें। यह साइट आगंतुकों के लिए है — खाते केवल Go to App से खुलते हैं।",
      home_hero_note: "pocket-ledger.com = देश चुनें · यह पेज = आपके देश की साइट · /app = ऐप",
      home_features_lead: "यहाँ मार्केटिंग साइट है। किताबें केवल /app पर खोलें।",
      gate_foot: "हर देश साइट (np, in, us, nz) की अपनी शर्तें और बिलिंग हैं। pocket-ledger.com किसी देश सबडोमेन का ज़िम्मेदार नहीं है।"
    },
    ne: {
      gate_lead: "आफ्नो देशको Pocket Ledger साइट खोल्नुहोस्। त्यो देश आफ्नै योजना र भुक्तानी चलाउँछ। pocket-ledger.com मा बस्नेका लागि मेनले पनि सदस्यता लिन्छ। प्रत्येक सबडोमेनका आफ्नै सर्त छन्; मेन देश साइटको जिम्मेवार होइन।",
      gate_features_lead: "एउटै खाता डेस्कटप, ट्याब्लेट, फोन र वेब एपमा।",
      feature_list_lead: "Pocket Ledger भित्र के पाइन्छ (वेब, Windows EXE र Android APK)।",
      home_hero: "Windows EXE, Android APK र वेब एपमा उही खाता। यो साइट आगन्तुकका लागि हो — खाता Go to App बाट मात्र खुल्छ।",
      home_hero_note: "pocket-ledger.com = देश छान्नुहोस् · यो पेज = तपाईंको देशको साइट · /app = एप",
      home_features_lead: "यहाँ मार्केटिङ साइट हो। खाता /app मा मात्र खोल्नुहोस्।",
      gate_foot: "प्रत्येक देश साइट (np, in, us, nz) का आफ्नै सर्त र बिलिङ छन्। pocket-ledger.com देश सबडोमेनको जिम्मेवार होइन।"
    }
  };

  function langs() { return global.PL_LANGUAGES; }
  function valid(code) {
    var L = langs();
    if (L && L.has) return L.has(code) ? code : "";
    return code === "en" || code === "hi" || code === "ne" ? code : "";
  }
  function read(key) {
    try { return valid(localStorage.getItem(key)) || DEF; } catch (e) { return DEF; }
  }
  var uiLang = read(UI_KEY);
  var introLang = read(INTRO_KEY);

  function table(kind, code) {
    var pack = kind === "intro" ? INTRO : UI;
    return pack[code] || pack[DEF];
  }
  function t(key, params) {
    var s = table("ui", uiLang)[key];
    if (s == null) s = table("ui", DEF)[key];
    if (s == null) s = key;
    if (params) Object.keys(params).forEach(function (k) { s = String(s).replace("{" + k + "}", params[k]); });
    return s;
  }
  function ti(key) {
    var s = table("intro", introLang)[key];
    if (s == null) s = table("intro", DEF)[key];
    return s == null ? "" : s;
  }
  function apply() {
    var L = langs();
    document.documentElement.lang = uiLang;
    if (L && L.isRtl) document.documentElement.dir = L.isRtl(uiLang) ? "rtl" : "ltr";
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (el) {
      var attr = el.getAttribute("data-i18n-attr");
      var val = t(el.getAttribute("data-i18n"));
      if (attr) el.setAttribute(attr, val);
      else el.textContent = val;
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-intro]"), function (el) {
      var val = ti(el.getAttribute("data-intro"));
      if (val) el.textContent = val;
    });
    if (global.PLColorMode && typeof global.PLColorMode.sync === "function") global.PLColorMode.sync();
    if (global.plIntro && typeof global.plIntro.relabel === "function") global.plIntro.relabel();
    document.dispatchEvent(new Event("pl-lang-applied"));
  }
  function set(ui, intro) {
    uiLang = valid(ui) || uiLang;
    introLang = valid(intro) || introLang;
    try {
      localStorage.setItem(UI_KEY, uiLang);
      localStorage.setItem(INTRO_KEY, introLang);
    } catch (e) { /* still apply */ }
    apply();
  }

  function hasTable(code) {
    return !!(UI[code] && INTRO[code]);
  }
  function install(code, tables) {
    if (!code || !tables) return;
    if (tables.ui) UI[code] = tables.ui;
    if (tables.intro) INTRO[code] = tables.intro;
  }
  function english() {
    return { ui: UI.en, intro: INTRO.en };
  }

  global.PLt = t;
  global.PLti = ti;
  global.PLi18n = {
    t: t,
    ti: ti,
    apply: apply,
    set: set,
    ui: function () { return uiLang; },
    intro: function () { return introLang; },
    hasTable: hasTable,
    install: install,
    english: english
  };
})(window);
