(function () {
  "use strict";

  var LABEL_COPY = {
    howto: "How to use",
    tutorial: "Tutorial",
    learning: "Learning",
    event: "Event",
    update: "Update",
  };
  var CATEGORY_COPY = {
    "getting-started": "Getting started",
    dashboard: "Dashboard",
    party: "Parties",
    "bank-cash": "Bank/Cash",
    staff: "Staff",
    tax: "Tax",
    incomes: "Income & Expense",
    items: "Items & Service",
    reports: "Reports",
    gallery: "Gallery",
    gate: "Gate",
    production: "Production",
    "sale-note": "Sale Note",
    "purchase-note": "Purchase Note",
    quotations: "Quotations",
    messages: "Messages",
    "drive-sync": "Google Drive sync",
    billing: "Billing & Plans",
    "distributor-signup": "Be a Distributor",
    backup: "Backup & Restore",
    "import-export": "Import/Export",
    "recycle-bin": "Recycle Bin",
    settings: "Settings",
  };
  var LEGACY_CATEGORY = {
    "sales-purchase": "sale-note",
    "accounts-reports": "reports",
    "settings-sync": "settings",
    "updates-events": "getting-started",
  };

  var statusEl = document.getElementById("status");
  var authBox = document.getElementById("authBox");
  var adminBox = document.getElementById("adminBox");
  var whoEl = document.getElementById("who");
  var outBtn = document.getElementById("outBtn");
  var groupsEl = document.getElementById("videoGroups");
  var videos = [];
  var engagement = {};
  var featureConfig = {};
  var activePlatform = "all";
  var searchQuery = "";
  var CATEGORY_ORDER = [
    "getting-started",
    "dashboard",
    "party",
    "bank-cash",
    "staff",
    "tax",
    "incomes",
    "items",
    "reports",
    "gallery",
    "gate",
    "production",
    "sale-note",
    "purchase-note",
    "quotations",
    "messages",
    "drive-sync",
    "billing",
    "distributor-signup",
    "backup",
    "import-export",
    "recycle-bin",
    "settings",
  ];

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "status " + (ok ? "ok" : "err");
  }

  function detectPlatform(url) {
    var raw = String(url || "").trim().toLowerCase();
    if (!raw) return null;
    if (raw.indexOf("youtu.be") !== -1 || raw.indexOf("youtube.com") !== -1) return "youtube";
    if (raw.indexOf("facebook.com") !== -1 || raw.indexOf("fb.watch") !== -1 || raw.indexOf("fb.com") !== -1) {
      return "facebook";
    }
    if (raw.indexOf("tiktok.com") !== -1) return "tiktok";
    return null;
  }

  function sanitize(raw) {
    var source =
      raw && typeof raw === "object" && Array.isArray(raw.videos)
        ? raw.videos
        : Array.isArray(raw)
          ? raw
          : [];
    var out = [];
    source.forEach(function (row, index) {
      if (!row || typeof row !== "object") return;
      var url = String(row.url || "").trim();
      var platform = detectPlatform(url);
      if (!url || !platform) return;
      out.push({
        id: String(row.id || "").trim() || "video-" + (index + 1),
        title: String(row.title || "").trim() || "Pocket Ledger video",
        url: url,
        platform: platform,
        label: LABEL_COPY[row.label] ? String(row.label) : "howto",
        category: (function () {
          var key = String(row.category || "").trim();
          if (CATEGORY_COPY[key]) return key;
          if (LEGACY_CATEGORY[key]) return LEGACY_CATEGORY[key];
          return "getting-started";
        })(),
        published: row.published !== false,
        sort: Number.isFinite(Number(row.sort)) ? Number(row.sort) : index,
      });
    });
    return out.sort(function (a, b) {
      return a.sort - b.sort || a.title.localeCompare(b.title);
    });
  }

  function youtubeId(url) {
    var match = String(url || "").match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{6,})/);
    return match ? match[1] : "";
  }

  function thumbUrl(video) {
    if (video.platform === "youtube") {
      var id = youtubeId(video.url);
      return id ? "https://img.youtube.com/vi/" + id + "/hqdefault.jpg" : "";
    }
    return "";
  }

  function formatEngage(videoId) {
    var e = engagement[videoId] || { views: 0, likes: 0, ratingAvg: 0, ratingCount: 0 };
    var avg = e.ratingCount ? Number(e.ratingAvg || 0).toFixed(1) : "-";
    return "Views " + (e.views || 0) + " \u00b7 Likes " + (e.likes || 0) + " \u00b7 Rating " + avg +
      (e.ratingCount ? " (" + e.ratingCount + ")" : "");
  }

  function platformCounts() {
    return {
      youtube: videos.filter(function (v) { return v.platform === "youtube"; }).length,
      facebook: videos.filter(function (v) { return v.platform === "facebook"; }).length,
      tiktok: videos.filter(function (v) { return v.platform === "tiktok"; }).length,
    };
  }

  function filteredList() {
    var q = searchQuery.trim().toLowerCase();
    return videos.filter(function (video) {
      if (activePlatform !== "all" && video.platform !== activePlatform) return false;
      if (!q) return true;
      return [
        video.title,
        video.url,
        CATEGORY_COPY[video.category] || video.category,
        LABEL_COPY[video.label] || video.label,
        video.platform,
      ].join(" ").toLowerCase().indexOf(q) !== -1;
    });
  }

  function updateTabs() {
    var counts = platformCounts();
    var map = {
      all: "tabCountAll",
      youtube: "tabCountYoutube",
      facebook: "tabCountFacebook",
      tiktok: "tabCountTiktok",
    };
    var allEl = document.getElementById("tabCountAll");
    if (allEl) allEl.textContent = String(videos.length);
    Object.keys(map).forEach(function (key) {
      if (key === "all") return;
      var el = document.getElementById(map[key]);
      if (el) el.textContent = String(counts[key] || 0);
    });
    document.querySelectorAll(".video-admin-tab").forEach(function (button) {
      var platform = button.getAttribute("data-platform") || "";
      var on = platform === activePlatform;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function render() {
    if (!groupsEl) return;
    updateTabs();
    var list = filteredList();
    var title =
      activePlatform === "all"
        ? "All"
        : activePlatform === "youtube"
          ? "YouTube"
          : activePlatform === "facebook"
            ? "Facebook"
            : "TikTok";
    groupsEl.innerHTML = "";
    var head = document.createElement("h3");
    head.style.cssText = "margin:0 0 0.35rem;font-size:1rem";
    head.textContent = title + " (" + list.length + ")";
    groupsEl.appendChild(head);
    if (!list.length) {
      var empty = document.createElement("p");
      empty.style.cssText = "margin:0;color:var(--muted);font-size:0.88rem";
      empty.textContent = searchQuery.trim()
        ? "No videos match this search."
        : activePlatform === "all"
          ? "No videos yet."
          : "No " + activePlatform + " videos yet.";
      groupsEl.appendChild(empty);
      return;
    }
    var ul = document.createElement("ul");
    ul.className = "video-list";
    list.forEach(function (video) {
      var li = document.createElement("li");
      var thumb = document.createElement("div");
      thumb.className = "video-admin-thumb video-admin-thumb-" + video.platform;
      var image = thumbUrl(video);
      if (image) {
        var img = document.createElement("img");
        img.src = image;
        img.alt = "";
        img.loading = "lazy";
        thumb.appendChild(img);
      } else {
        thumb.textContent = video.platform === "facebook" ? "FB" : video.platform === "tiktok" ? "TT" : "▶";
      }
      var meta = document.createElement("div");
      meta.className = "video-meta";
      meta.innerHTML = "<strong></strong><span></span><em></em>";
      meta.querySelector("strong").textContent = video.title;
      meta.querySelector("span").textContent =
        (CATEGORY_COPY[video.category] || video.category) + " · " +
        (LABEL_COPY[video.label] || video.label) + " · " + video.url;
      meta.querySelector("em").textContent = formatEngage(video.id);
      var actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:0.5rem;align-items:center";
      var live = document.createElement("label");
      live.style.cssText = "display:flex;gap:0.35rem;align-items:center;font-size:0.88rem";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = video.published;
      cb.onchange = function () {
        void persist(
          videos.map(function (v) {
            return v.id === video.id ? Object.assign({}, v, { published: cb.checked }) : v;
          })
        );
      };
      live.appendChild(cb);
      live.appendChild(document.createTextNode("Live"));
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn-outline btn-sm";
      rm.textContent = "Remove";
      rm.onclick = function () {
        var ok = window.confirm(
          'Remove "' + (video.title || "this video") + '"?\n\nThis will delete it from the website videos list.'
        );
        if (!ok) return;
        void persist(videos.filter(function (v) { return v.id !== video.id; }));
      };
      actions.appendChild(live);
      actions.appendChild(rm);
      li.appendChild(thumb);
      li.appendChild(meta);
      li.appendChild(actions);
      ul.appendChild(li);
    });
    groupsEl.appendChild(ul);
  }

  function bindListTools() {
    var search = document.getElementById("videoSearch");
    if (search) {
      search.addEventListener("input", function () {
        searchQuery = search.value || "";
        render();
      });
    }
    document.querySelectorAll(".video-admin-tab").forEach(function (button) {
      button.addEventListener("click", function () {
        activePlatform = button.getAttribute("data-platform") || "all";
        render();
      });
    });
  }

  function visibleCategories() {
    return CATEGORY_ORDER.filter(function (id) {
      if (id === "getting-started") return true;
      return featureConfig[id] !== false;
    });
  }

  function fillCategorySelect(preferred) {
    var select = document.getElementById("videoCategory");
    if (!select) return;
    var visible = visibleCategories();
    var current = preferred || select.value || "getting-started";
    if (visible.indexOf(current) === -1) current = "getting-started";
    select.innerHTML = "";
    visible.forEach(function (id) {
      var opt = document.createElement("option");
      opt.value = id;
      opt.textContent = CATEGORY_COPY[id] || id;
      select.appendChild(opt);
    });
    select.value = current;
  }

  async function loadFeatures() {
    // Every category is offered (the old per-feature hiding came from the retired Firebase settings).
    featureConfig = {};
    fillCategorySelect();
  }

  function applyEngagement(byVideo) {
    engagement = {};
    var src = byVideo && typeof byVideo === "object" ? byVideo : {};
    Object.keys(src).forEach(function (id) {
      var row = src[id] || {};
      var ratingSum = Math.max(0, Math.floor(Number(row.ratingSum) || 0));
      var ratingCount = Math.max(0, Math.floor(Number(row.ratingCount) || 0));
      engagement[id] = {
        views: Math.max(0, Math.floor(Number(row.views) || 0)),
        likes: Math.max(0, Math.floor(Number(row.likes) || 0)),
        ratingSum: ratingSum,
        ratingCount: ratingCount,
        ratingAvg: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0,
      };
    });
  }

  async function load() {
    setStatus("Loading.", true);
    try {
      var data = await window.SiteData.adminGet("/admin/videos");
      videos = sanitize(data);
      applyEngagement(data && data.stats && data.stats.byVideo);
      await loadFeatures();
      render();
      setStatus("Ready.", true);
    } catch (e) {
      videos = [];
      render();
      setStatus("Could not load videos. " + ((e && e.message) || ""), false);
    }
  }

  async function persist(next) {
    try {
      var res = await window.SiteData.adminPost("/admin/videos", { videos: next });
      videos = sanitize(res);
      render();
      setStatus("Saved.", true);
    } catch (err) {
      setStatus("Save failed. " + ((err && err.message) || ""), false);
    }
  }

  async function addVideo() {
    var title = String(document.getElementById("videoTitle").value || "").trim();
    var url = String(document.getElementById("videoUrl").value || "").trim();
    var label = String(document.getElementById("videoLabel").value || "howto");
    var category = String(document.getElementById("videoCategory").value || "getting-started");
    if (visibleCategories().indexOf(category) === -1) {
      setStatus("That category is hidden in Add/Remove Features.", false);
      return;
    }
    var published = Boolean(document.getElementById("videoPublished").checked);
    var platform = detectPlatform(url);
    if (!platform) {
      setStatus("Paste a YouTube, Facebook, or TikTok link.", false);
      return;
    }
    var next = videos.concat([
      {
        id: "vid-" + Date.now(),
        title: title || "Pocket Ledger video",
        url: url,
        platform: platform,
        label: label,
        category: CATEGORY_COPY[category] ? category : "getting-started",
        published: published,
        sort: videos.length,
      },
    ]);
    await persist(next);
    activePlatform = platform;
    document.getElementById("videoTitle").value = "";
    document.getElementById("videoUrl").value = "";
    document.getElementById("videoPublished").checked = true;
    document.getElementById("videoLabel").value = "howto";
    fillCategorySelect("getting-started");
  }

  function init() {
    document.getElementById("addVideoBtn").onclick = function () {
      void addVideo();
    };
    bindListTools();
    window.SiteData.gate({
      authBox: authBox,
      adminBox: adminBox,
      whoEl: whoEl,
      outBtn: outBtn,
      setStatus: setStatus,
      onReady: function () {
        void load();
      },
    });
  }

  init();
}());