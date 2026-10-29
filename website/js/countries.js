/* ISO 3166-1 alpha-2 subdomains: np.pocket-ledger.com, in.pocket-ledger.com, …
 * iso3 (npl, ind, nzl) is search-only. Flip useSubdomains when DNS is live. */
(function (global) {
  "use strict";

  var FEATURED = ["np", "in", "us", "nz", "gb", "au", "ae", "bd", "pk", "lk", "my", "sg"];
  var LIVE = { np: 1 };

  var RESERVED = {
    www: 1, app: 1, admin: 1, api: 1, mail: 1, ftp: 1, cdn: 1, static: 1,
    staging: 1, login: 1, main: 1, m: 1, dev: 1, test: 1, beta: 1, docs: 1,
    blog: 1, shop: 1, store: 1, support: 1, help: 1, status: 1, ns1: 1, ns2: 1,
    smtp: 1, origin: 1, firebase: 1, hosting: 1, console: 1, www2: 1
  };

  /* [alpha-2, alpha-3, English name, extra search aliases…] */
  var RAW = [
    ["ad","and","Andorra"],["ae","are","United Arab Emirates", "uae"],["af","afg","Afghanistan"],
    ["ag","atg","Antigua and Barbuda"],["ai","aia","Anguilla"],["al","alb","Albania"],
    ["am","arm","Armenia"],["ao","ago","Angola"],["aq","ata","Antarctica"],["ar","arg","Argentina"],
    ["as","asm","American Samoa"],["at","aut","Austria"],["au","aus","Australia"],["aw","abw","Aruba"],
    ["ax","ala","Åland Islands","aland"],["az","aze","Azerbaijan"],
    ["ba","bih","Bosnia and Herzegovina"],["bb","brb","Barbados"],["bd","bgd","Bangladesh"],
    ["be","bel","Belgium"],["bf","bfa","Burkina Faso"],["bg","bgr","Bulgaria"],["bh","bhr","Bahrain"],
    ["bi","bdi","Burundi"],["bj","ben","Benin"],["bl","blm","Saint Barthélemy"],["bm","bmu","Bermuda"],
    ["bn","brn","Brunei"],["bo","bol","Bolivia"],["bq","bes","Caribbean Netherlands"],
    ["br","bra","Brazil"],["bs","bhs","Bahamas"],["bt","btn","Bhutan"],["bv","bvt","Bouvet Island"],
    ["bw","bwa","Botswana"],["by","blr","Belarus"],["bz","blz","Belize"],
    ["ca","can","Canada"],["cc","cck","Cocos Islands"],["cd","cod","DR Congo","congo"],
    ["cf","caf","Central African Republic"],["cg","cog","Republic of the Congo"],
    ["ch","che","Switzerland"],["ci","civ","Côte d'Ivoire","ivory coast","ivorycoast"],
    ["ck","cok","Cook Islands"],["cl","chl","Chile"],["cm","cmr","Cameroon"],["cn","chn","China"],
    ["co","col","Colombia"],["cr","cri","Costa Rica"],["cu","cub","Cuba"],["cv","cpv","Cabo Verde","cape verde"],
    ["cw","cuw","Curaçao","curacao"],["cx","cxr","Christmas Island"],["cy","cyp","Cyprus"],["cz","cze","Czechia","czech republic"],
    ["de","deu","Germany"],["dj","dji","Djibouti"],["dk","dnk","Denmark"],["dm","dma","Dominica"],
    ["do","dom","Dominican Republic"],["dz","dza","Algeria"],
    ["ec","ecu","Ecuador"],["ee","est","Estonia"],["eg","egy","Egypt"],["eh","esh","Western Sahara"],
    ["er","eri","Eritrea"],["es","esp","Spain"],["et","eth","Ethiopia"],
    ["fi","fin","Finland"],["fj","fji","Fiji"],["fk","flk","Falkland Islands"],
    ["fm","fsm","Micronesia"],["fo","fro","Faroe Islands"],["fr","fra","France"],
    ["ga","gab","Gabon"],["gb","gbr","United Kingdom","uk","great britain","britain"],
    ["gd","grd","Grenada"],["ge","geo","Georgia"],["gf","guf","French Guiana"],["gg","ggy","Guernsey"],
    ["gh","gha","Ghana"],["gi","gib","Gibraltar"],["gl","grl","Greenland"],["gm","gmb","Gambia"],
    ["gn","gin","Guinea"],["gp","glp","Guadeloupe"],["gq","gnq","Equatorial Guinea"],["gr","grc","Greece"],
    ["gs","sgs","South Georgia"],["gt","gtm","Guatemala"],["gu","gum","Guam"],["gw","gnb","Guinea-Bissau"],
    ["gy","guy","Guyana"],
    ["hk","hkg","Hong Kong"],["hm","hmd","Heard Island"],["hn","hnd","Honduras"],["hr","hrv","Croatia"],
    ["ht","hti","Haiti"],["hu","hun","Hungary"],
    ["id","idn","Indonesia"],["ie","irl","Ireland"],["il","isr","Israel"],["im","imn","Isle of Man"],
    ["in","ind","India"],["io","iot","British Indian Ocean Territory"],["iq","irq","Iraq"],
    ["ir","irn","Iran"],["is","isl","Iceland"],["it","ita","Italy"],
    ["je","jey","Jersey"],["jm","jam","Jamaica"],["jo","jor","Jordan"],["jp","jpn","Japan"],
    ["ke","ken","Kenya"],["kg","kgz","Kyrgyzstan"],["kh","khm","Cambodia"],["ki","kir","Kiribati"],
    ["km","com","Comoros"],["kn","kna","Saint Kitts and Nevis"],["kp","prk","North Korea"],
    ["kr","kor","South Korea","korea"],["kw","kwt","Kuwait"],["ky","cym","Cayman Islands"],["kz","kaz","Kazakhstan"],
    ["la","lao","Laos"],["lb","lbn","Lebanon"],["lc","lca","Saint Lucia"],["li","lie","Liechtenstein"],
    ["lk","lka","Sri Lanka"],["lr","lbr","Liberia"],["ls","lso","Lesotho"],["lt","ltu","Lithuania"],
    ["lu","lux","Luxembourg"],["lv","lva","Latvia"],["ly","lby","Libya"],
    ["ma","mar","Morocco"],["mc","mco","Monaco"],["md","mda","Moldova"],["me","mne","Montenegro"],
    ["mf","maf","Saint Martin"],["mg","mdg","Madagascar"],["mh","mhl","Marshall Islands"],
    ["mk","mkd","North Macedonia"],["ml","mli","Mali"],["mm","mmr","Myanmar","burma"],
    ["mn","mng","Mongolia"],["mo","mac","Macao"],["mp","mnp","Northern Mariana Islands"],
    ["mq","mtq","Martinique"],["mr","mrt","Mauritania"],["ms","msr","Montserrat"],["mt","mlt","Malta"],
    ["mu","mus","Mauritius"],["mv","mdv","Maldives"],["mw","mwi","Malawi"],["mx","mex","Mexico"],
    ["my","mys","Malaysia"],["mz","moz","Mozambique"],
    ["na","nam","Namibia"],["nc","ncl","New Caledonia"],["ne","ner","Niger"],["nf","nfk","Norfolk Island"],
    ["ng","nga","Nigeria"],["ni","nic","Nicaragua"],["nl","nld","Netherlands","holland"],
    ["no","nor","Norway"],["np","npl","Nepal"],["nr","nru","Nauru"],["nu","niu","Niue"],
    ["nz","nzl","New Zealand","newzealand","new zeeland"],
    ["om","omn","Oman"],
    ["pa","pan","Panama"],["pe","per","Peru"],["pf","pyf","French Polynesia"],["pg","png","Papua New Guinea"],
    ["ph","phl","Philippines"],["pk","pak","Pakistan"],["pl","pol","Poland"],["pm","spm","Saint Pierre and Miquelon"],
    ["pn","pcn","Pitcairn"],["pr","pri","Puerto Rico"],["ps","pse","Palestine"],["pt","prt","Portugal"],
    ["pw","plw","Palau"],["py","pry","Paraguay"],
    ["qa","qat","Qatar"],
    ["re","reu","Réunion","reunion"],["ro","rou","Romania"],["rs","srb","Serbia"],["ru","rus","Russia"],
    ["rw","rwa","Rwanda"],
    ["sa","sau","Saudi Arabia"],["sb","slb","Solomon Islands"],["sc","syc","Seychelles"],["sd","sdn","Sudan"],
    ["se","swe","Sweden"],["sg","sgp","Singapore"],["sh","shn","Saint Helena"],["si","svn","Slovenia"],
    ["sj","sjm","Svalbard and Jan Mayen"],["sk","svk","Slovakia"],["sl","sle","Sierra Leone"],
    ["sm","smr","San Marino"],["sn","sen","Senegal"],["so","som","Somalia"],["sr","sur","Suriname"],
    ["ss","ssd","South Sudan"],["st","stp","São Tomé and Príncipe","sao tome"],
    ["sv","slv","El Salvador"],["sx","sxm","Sint Maarten"],["sy","syr","Syria"],["sz","swz","Eswatini","swaziland"],
    ["tc","tca","Turks and Caicos Islands"],["td","tcd","Chad"],["tf","atf","French Southern Territories"],
    ["tg","tgo","Togo"],["th","tha","Thailand"],["tj","tjk","Tajikistan"],["tk","tkl","Tokelau"],
    ["tl","tls","Timor-Leste","east timor"],["tm","tkm","Turkmenistan"],["tn","tun","Tunisia"],
    ["to","ton","Tonga"],["tr","tur","Türkiye","turkey"],["tt","tto","Trinidad and Tobago"],
    ["tv","tuv","Tuvalu"],["tw","twn","Taiwan"],["tz","tza","Tanzania"],
    ["ua","ukr","Ukraine"],["ug","uga","Uganda"],["um","umi","US Outlying Islands"],
    ["us","usa","United States","usa","america","united states of america"],
    ["uy","ury","Uruguay"],["uz","uzb","Uzbekistan"],
    ["va","vat","Vatican City"],["vc","vct","Saint Vincent and the Grenadines"],["ve","ven","Venezuela"],
    ["vg","vgb","British Virgin Islands"],["vi","vir","US Virgin Islands"],["vn","vnm","Vietnam"],
    ["vu","vut","Vanuatu"],
    ["wf","wlf","Wallis and Futuna"],["ws","wsm","Samoa"],
    ["xk","xkx","Kosovo"],
    ["ye","yem","Yemen"],["yt","myt","Mayotte"],
    ["za","zaf","South Africa"],["zm","zmb","Zambia"],["zw","zwe","Zimbabwe"]
  ];

  var byCode = {};
  var list = [];

  RAW.forEach(function (row) {
    var cc = row[0];
    var rec = {
      cc: cc,
      iso3: row[1],
      name: row[2],
      aliases: row.slice(3),
      host: cc + ".pocket-ledger.com",
      live: !!LIVE[cc]
    };
    byCode[cc] = rec;
    list.push(rec);
  });

  function byLiveThenName(a, b) {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return a.name.localeCompare(b.name);
  }

  list.sort(byLiveThenName);

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function find(query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return list.slice();
    var compact = norm(q);
    function score(c) {
      var name = c.name.toLowerCase();
      if (c.cc === q) return 0;
      if (c.iso3 === q) return 1;
      if (c.aliases.indexOf(q) !== -1) return 2;
      if (name === q || norm(c.name) === compact) return 3;
      if (name.indexOf(q) === 0) return 4;
      if (c.host.indexOf(q) === 0) return 5;
      if (name.indexOf(q) !== -1 || norm(c.name).indexOf(compact) !== -1) return 6;
      for (var i = 0; i < c.aliases.length; i++) {
        if (norm(c.aliases[i]).indexOf(compact) === 0) return 7;
        if (norm(c.aliases[i]).indexOf(compact) !== -1) return 8;
      }
      return 9;
    }
    return list.filter(function (c) { return score(c) < 9; }).sort(function (a, b) {
      if (a.live !== b.live) return a.live ? -1 : 1;
      var d = score(a) - score(b);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  }

  function get(cc) {
    return byCode[String(cc || "").toLowerCase()] || null;
  }

  global.PLCountries = {
    FEATURED: FEATURED,
    LIVE: LIVE,
    RESERVED: RESERVED,
    list: list,
    get: get,
    find: find,
    /* Set true only after np.pocket-ledger.com (etc.) DNS + hosting are connected. */
    useSubdomains: false,
    apexHosts: ["pocket-ledger.com", "www.pocket-ledger.com"]
  };
})(window);
