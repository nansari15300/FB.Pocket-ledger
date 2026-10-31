(function () {
  "use strict";

  var statusEl = document.getElementById("status");
  var authBox = document.getElementById("authBox");
  var adminBox = document.getElementById("adminBox");
  var whoEl = document.getElementById("who");
  var outBtn = document.getElementById("outBtn");
  var cachedRecent = [];
  var cachedRecentAll = [];
  var cachedStatsNew = { total: 0, byPlatform: {} };
  var cachedStatsUpdate = { total: 0, byPlatform: {} };
  var currentReleaseVersion = "";
  var activeAnalyticsTab = "new";
  var updateVersionFilter = "all";
  var cachedEmailProfiles = {};
  var emailAnchorByEmail = {};
  var recentPage = 1;
  var expandedCompanyRowId = null;
  var expandedCompanyKind = null;
  var RECENT_SCROLL_ROW_THRESHOLD = 20;
  var PLATFORM_ROWS = [
    { key: "windows", className: "exe" },
    { key: "android", className: "apk" },
    { key: "play", className: "play" },
  ];

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "status " + (ok ? "ok" : "err");
  }

  function countryLabel(code) {
    var c = String(code || "ZZ").toUpperCase();
    if (c === "ZZ") return "Unknown";
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(c) || c;
    } catch (_) {
      return c;
    }
  }

  function formatWhen(ms) {
    if (!ms) return "—";
    try {
      return new Date(ms).toLocaleString();
    } catch (_) {
      return "—";
    }
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function compareVersions(a, b) {
    var left = String(a || "0")
      .split(/[.-]/)
      .map(function (part) {
        return Number(part) || 0;
      });
    var right = String(b || "0")
      .split(/[.-]/)
      .map(function (part) {
        return Number(part) || 0;
      });
    var size = Math.max(left.length, right.length);
    for (var i = 0; i < size; i += 1) {
      var delta = (left[i] || 0) - (right[i] || 0);
      if (delta !== 0) return delta;
    }
    return 0;
  }

  function eventKindOf(row) {
    return row && row.eventKind === "update" ? "update" : "new";
  }

  function eventsForActiveTab() {
    return cachedRecentAll.filter(function (row) {
      if (eventKindOf(row) !== activeAnalyticsTab) return false;
      if (activeAnalyticsTab === "update" && updateVersionFilter !== "all") {
        return String(row.version || "") === updateVersionFilter;
      }
      return true;
    });
  }

  function byCountryFromEvents(rows) {
    var map = {};
    (rows || []).forEach(function (row) {
      var c = String(row.country || "ZZ");
      map[c] = (map[c] || 0) + 1;
    });
    return Object.keys(map)
      .map(function (country) {
        return { country: country, count: map[country] };
      })
      .sort(function (a, b) {
        return b.count - a.count || a.country.localeCompare(b.country);
      });
  }

  function populateUpdateVersionSelect() {
    var sel = document.getElementById("updateVersionFilter");
    if (!sel) return;
    var versions = {};
    cachedRecentAll.forEach(function (row) {
      if (eventKindOf(row) !== "update") return;
      var v = String(row.version || "").trim();
      if (v) versions[v] = true;
    });
    if (currentReleaseVersion) versions[currentReleaseVersion] = true;
    var list = Object.keys(versions).sort(function (a, b) {
      return compareVersions(b, a);
    });
    var prev = updateVersionFilter;
    sel.innerHTML = "";
    var allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All versions";
    sel.appendChild(allOpt);
    list.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = "v" + v;
      sel.appendChild(opt);
    });
    if (prev && (prev === "all" || versions[prev])) {
      updateVersionFilter = prev;
    } else if (currentReleaseVersion && versions[currentReleaseVersion]) {
      updateVersionFilter = currentReleaseVersion;
    } else {
      updateVersionFilter = "all";
    }
    sel.value = updateVersionFilter;
  }

  function statsFromEvents(rows) {
    var byPlatform = { windows: 0, android: 0, play: 0 };
    (rows || []).forEach(function (row) {
      var p = String(row.platform || "");
      if (p === "windows" || p === "android" || p === "play") {
        byPlatform[p] += 1;
      }
    });
    var total = byPlatform.windows + byPlatform.android + byPlatform.play;
    return { total: total, byPlatform: byPlatform };
  }

  function applyAnalyticsView() {
    cachedRecent = eventsForActiveTab();
    var stats;
    if (activeAnalyticsTab === "update" && updateVersionFilter !== "all") {
      stats = statsFromEvents(cachedRecent);
    } else {
      stats = activeAnalyticsTab === "update" ? cachedStatsUpdate : cachedStatsNew;
    }
    var byPlatform = stats.byPlatform || {};
    setText("statTotal", String(stats.total || 0));
    setText("statWindows", String(byPlatform.windows || 0));
    setText("statAndroid", String(byPlatform.android || 0));
    setText("statPlay", String(byPlatform.play || 0));
    renderPlatformChart(byPlatform);
    rebuildEmailAnchors();
    recentPage = 1;
    renderTimelineChart(cachedRecent);

    var countryBody = document.getElementById("countryBody");
    var byCountry = byCountryFromEvents(cachedRecent);
    if (countryBody) {
      countryBody.innerHTML = "";
      if (!byCountry.length) {
        countryBody.innerHTML = '<tr><td colspan="2">No downloads recorded yet.</td></tr>';
      } else {
        byCountry.forEach(function (row) {
          var tr = document.createElement("tr");
          tr.innerHTML = "<td></td><td></td>";
          tr.children[0].textContent = countryLabel(row.country) + " (" + row.country + ")";
          tr.children[1].textContent = String(row.count || 0);
          countryBody.appendChild(tr);
        });
      }
    }
    renderRecentTable();
  }

  function setAnalyticsTab(tab) {
    activeAnalyticsTab = tab === "update" ? "update" : "new";
    var wrap = document.getElementById("updateVersionFilterWrap");
    if (wrap) wrap.hidden = activeAnalyticsTab !== "update";
    document.querySelectorAll("[data-dl-analytics-tab]").forEach(function (btn) {
      var isActive = btn.getAttribute("data-dl-analytics-tab") === activeAnalyticsTab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    if (activeAnalyticsTab === "update") populateUpdateVersionSelect();
    applyAnalyticsView();
  }

  function dayKey(ms) {
    var d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function shortDayLabel(key) {
    if (!key) return "—";
    var parts = key.split("-");
    if (parts.length !== 3) return key;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    try {
      var month = d.toLocaleDateString(undefined, { month: "short" });
      return month + " " + d.getDate();
    } catch (_) {
      return parts[2] + "/" + parts[1];
    }
  }

  function renderPlatformChart(byPlatform) {
    var root = document.getElementById("platformChart");
    if (!root) return;
    var rows = [
      { label: "EXE", key: "windows", className: "exe" },
      { label: "APK", key: "android", className: "apk" },
      { label: "Play", key: "play", className: "play" },
    ];
    var max = 1;
    rows.forEach(function (row) {
      var n = Number(byPlatform && byPlatform[row.key]) || 0;
      if (n > max) max = n;
    });
    var total = rows.reduce(function (sum, row) {
      return sum + (Number(byPlatform && byPlatform[row.key]) || 0);
    }, 0);
    root.innerHTML = "";
    if (!total) {
      root.innerHTML = '<p class="chart-empty">No downloads recorded yet.</p>';
      return;
    }
    var wrap = document.createElement("div");
    wrap.className = "dl-platform-chart";
    rows.forEach(function (row) {
      var count = Number(byPlatform && byPlatform[row.key]) || 0;
      var pct = Math.round((count / max) * 100);
      var col = document.createElement("div");
      col.className = "dl-platform-col";
      var countEl = document.createElement("div");
      countEl.className = "dl-platform-count";
      countEl.textContent = String(count);
      var barWrap = document.createElement("div");
      barWrap.className = "dl-platform-bar-wrap";
      var bar = document.createElement("div");
      bar.className = "dl-platform-bar " + row.className;
      bar.style.height = count ? Math.max(12, pct) + "%" : "2px";
      bar.style.opacity = count ? "1" : "0.3";
      barWrap.appendChild(bar);
      var labelEl = document.createElement("div");
      labelEl.className = "dl-platform-label";
      labelEl.textContent = row.label;
      col.appendChild(countEl);
      col.appendChild(barWrap);
      col.appendChild(labelEl);
      wrap.appendChild(col);
    });
    root.appendChild(wrap);
  }

  function monthKey(ms) {
    var d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function yearKey(ms) {
    var d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    return String(d.getFullYear());
  }

  function monthLabelFromKey(key) {
    if (!key) return "—";
    var parts = key.split("-");
    if (parts.length !== 2) return key;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    try {
      return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    } catch (_) {
      return key;
    }
  }

  function emptyBucket() {
    return { windows: 0, android: 0, play: 0, total: 0 };
  }

  function parseTimelineRange() {
    var sel = document.getElementById("timelineRange");
    var raw = sel && sel.value ? sel.value : "days-30";
    var parts = raw.split("-");
    var mode = parts[0] || "days";
    var count = Math.max(1, Number(parts[1]) || 30);
    return { mode: mode, count: count };
  }

  function rangeEmptyMessage(range) {
    if (range.mode === "months") return "No downloads in the last " + range.count + " months.";
    if (range.mode === "years") return "No downloads in the last " + range.count + " years.";
    return "No downloads in the last " + range.count + " days.";
  }

  function buildTimelineBuckets(range) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var buckets = [];
    var counts = {};
    var slant = true;

    if (range.mode === "months") {
      var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      for (var mi = range.count - 1; mi >= 0; mi--) {
        var m = new Date(monthStart.getFullYear(), monthStart.getMonth() - mi, 1);
        var mKey = monthKey(m.getTime());
        buckets.push({ key: mKey, label: monthLabelFromKey(mKey) });
        counts[mKey] = emptyBucket();
      }
    } else if (range.mode === "years") {
      var yearNow = today.getFullYear();
      for (var yi = range.count - 1; yi >= 0; yi--) {
        var yKey = String(yearNow - yi);
        buckets.push({ key: yKey, label: yKey });
        counts[yKey] = emptyBucket();
      }
    } else {
      for (var di = range.count - 1; di >= 0; di--) {
        var d = new Date(today);
        d.setDate(today.getDate() - di);
        var dKey = dayKey(d.getTime());
        buckets.push({ key: dKey, label: shortDayLabel(dKey) });
        counts[dKey] = emptyBucket();
      }
    }

    return { buckets: buckets, counts: counts, slant: slant };
  }

  function bucketKeyForEvent(row, range) {
    if (range.mode === "months") return monthKey(row.createdAtMs);
    if (range.mode === "years") return yearKey(row.createdAtMs);
    return dayKey(row.createdAtMs);
  }

  function renderTimelineChart(recent) {
    var root = document.getElementById("timelineChart");
    var legend = document.getElementById("timelineLegend");
    if (!root) return;
    root.innerHTML = "";
    if (legend) legend.hidden = true;

    var range = parseTimelineRange();
    var built = buildTimelineBuckets(range);
    var buckets = built.buckets;
    var counts = built.counts;
    var slant = built.slant;

    (Array.isArray(recent) ? recent : []).forEach(function (row) {
      var platform = String(row.platform || "windows");
      if (platform !== "windows" && platform !== "android" && platform !== "play") {
        platform = "windows";
      }
      var key = bucketKeyForEvent(row, range);
      if (!Object.prototype.hasOwnProperty.call(counts, key)) return;
      counts[key][platform] += 1;
      counts[key].total += 1;
    });

    var max = 1;
    buckets.forEach(function (bucket) {
      var total = counts[bucket.key].total;
      if (total > max) max = total;
    });

    var hasAny = buckets.some(function (bucket) {
      return counts[bucket.key].total > 0;
    });
    if (!hasAny) {
      root.innerHTML = '<p class="chart-empty">' + rangeEmptyMessage(range) + "</p>";
      return;
    }

    if (legend) legend.hidden = false;

    var scroll = document.createElement("div");
    scroll.className = "dl-timeline-scroll" + (slant ? " has-slant" : "");
    var wrap = document.createElement("div");
    wrap.className = "dl-timeline" + (slant ? " has-slant" : "") + (buckets.length > 20 ? " dense" : "");
    wrap.style.setProperty("--dl-cols", String(buckets.length));

    buckets.forEach(function (bucket) {
      var bucketCounts = counts[bucket.key];
      var total = bucketCounts.total || 0;
      var col = document.createElement("div");
      col.className = "dl-timeline-col";
      var barWrap = document.createElement("div");
      barWrap.className = "dl-timeline-bar-wrap";
      var bar = document.createElement("div");
      bar.className = "dl-timeline-bar";
      bar.style.height = total ? Math.max(12, Math.round((total / max) * 100)) + "%" : "2px";
      bar.style.opacity = total ? "1" : "0.35";
      PLATFORM_ROWS.forEach(function (row) {
        var n = bucketCounts[row.key] || 0;
        if (!n) return;
        var seg = document.createElement("div");
        seg.className = "dl-timeline-seg " + row.className;
        seg.style.flex = n + " 1 0";
        seg.title = row.label + ": " + n;
        var segNo = document.createElement("span");
        segNo.className = "dl-timeline-seg-no";
        segNo.textContent = String(n);
        seg.appendChild(segNo);
        bar.appendChild(seg);
      });
      barWrap.appendChild(bar);
      var countEl = document.createElement("div");
      countEl.className = "dl-timeline-count";
      countEl.textContent = String(total);
      var labelSlot = document.createElement("div");
      labelSlot.className = "dl-timeline-label-slot" + (slant ? " is-slant" : "");
      var labelEl = document.createElement("div");
      labelEl.className = "dl-timeline-label" + (slant ? " slant" : "");
      labelEl.textContent = bucket.label;
      labelSlot.appendChild(labelEl);
      var foot = document.createElement("div");
      foot.className = "dl-timeline-foot";
      foot.appendChild(countEl);
      foot.appendChild(labelSlot);
      col.appendChild(barWrap);
      col.appendChild(foot);
      wrap.appendChild(col);
    });

    scroll.appendChild(wrap);
    root.appendChild(scroll);
  }

  function normalizedEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function rebuildEmailAnchors() {
    emailAnchorByEmail = {};
    cachedRecent.forEach(function (row) {
      var key = normalizedEmail(row.userEmail);
      if (!key || emailAnchorByEmail[key]) return;
      emailAnchorByEmail[key] = row.id;
    });
  }

  function emailProfileFor(row) {
    var key = normalizedEmail(row && row.userEmail);
    if (!key) return null;
    return cachedEmailProfiles[key] || null;
  }

  function ownedCompanies(profile) {
    if (!profile) return [];
    if (Array.isArray(profile.ownedCompanies)) return profile.ownedCompanies;
    return ownedNames(profile).map(function (name) {
      return { name: name, createdAtMs: null };
    });
  }

  function sharedCompanies(profile) {
    if (!profile) return [];
    if (Array.isArray(profile.sharedCompanies)) return profile.sharedCompanies;
    return sharedNames(profile).map(function (name) {
      return { name: name, createdAtMs: null };
    });
  }

  function ownedNames(profile) {
    if (!profile) return [];
    if (Array.isArray(profile.ownedCompanyNames)) return profile.ownedCompanyNames;
    return Array.isArray(profile.companyNames) ? profile.companyNames : [];
  }

  function sharedNames(profile) {
    if (!profile) return [];
    return Array.isArray(profile.sharedCompanyNames) ? profile.sharedCompanyNames : [];
  }

  function collapsedProfileDate(profile, owned, shared) {
    if (!profile) return "—";
    if (owned.length === 1 && !shared.length) {
      return formatProfileDate(owned[0].createdAtMs);
    }
    if (shared.length === 1 && !owned.length) {
      return formatProfileDate(shared[0].createdAtMs);
    }
    if (owned.length === 1 && shared.length === 1) {
      var times = [owned[0].createdAtMs, shared[0].createdAtMs].filter(function (ms) {
        return typeof ms === "number" && Number.isFinite(ms);
      });
      if (times.length) return formatProfileDate(Math.min.apply(null, times));
    }
    return formatProfileDate(profile.firstCreatedAtMs);
  }

  function setCompanyExpand(rowId, kind) {
    if (expandedCompanyRowId === rowId && expandedCompanyKind === kind) {
      expandedCompanyRowId = null;
      expandedCompanyKind = null;
    } else {
      expandedCompanyRowId = rowId;
      expandedCompanyKind = kind;
    }
    renderRecentTable();
  }

  function renderCollapsedCompanyCell(td, companies, kind, rowId) {
    td.innerHTML = "";
    td.className = "dl-company-cell-wrap";
    var list = Array.isArray(companies)
      ? companies.filter(function (c) {
          return c && c.name;
        })
      : [];
    if (!list.length) {
      td.textContent = "—";
      return;
    }
    if (list.length === 1) {
      td.textContent = list[0].name;
      return;
    }

    var line = document.createElement("div");
    line.className = "dl-company-main";
    var preview = document.createElement("span");
    preview.className = "dl-company-names";
    preview.textContent = list[0].name + " (+" + (list.length - 1) + ")";
    line.appendChild(preview);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dl-company-expand";
    btn.textContent = "▸";
    btn.setAttribute("aria-label", "Show all companies");
    btn.setAttribute("aria-expanded", "false");
    btn.onclick = function () {
      setCompanyExpand(rowId, kind);
    };
    line.appendChild(btn);
    td.appendChild(line);
  }

  function appendCompanyNameLine(container, name, showCollapse, rowId, kind) {
    container.innerHTML = "";
    var line = document.createElement("div");
    line.className = "dl-company-main";
    if (showCollapse) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dl-company-expand";
      btn.textContent = "▾";
      btn.setAttribute("aria-label", "Hide companies");
      btn.setAttribute("aria-expanded", "true");
      btn.onclick = function () {
        setCompanyExpand(rowId, kind);
      };
      line.appendChild(btn);
    }
    var label = document.createElement("span");
    label.className = "dl-company-names";
    label.textContent = name;
    line.appendChild(label);
    container.appendChild(line);
  }

  function renderExpandedCompanyBlock(tr, kind, companies, rowId) {
    tr.dataset.expandKind = kind;
    var ownedTd = tr.children[5];
    var sharedTd = tr.children[6];
    var dateTd = tr.children[7];
    if (sharedTd) sharedTd.parentNode.removeChild(sharedTd);
    if (dateTd) dateTd.parentNode.removeChild(dateTd);

    ownedTd.colSpan = 3;
    ownedTd.className = "dl-company-expand-wrap";
    ownedTd.innerHTML = "";

    var innerTable = document.createElement("table");
    innerTable.className = "dl-company-inner-table";
    innerTable.setAttribute("role", "presentation");

    var colgroup = document.createElement("colgroup");
    ["col-owned", "col-shared", "col-date"].forEach(function (className) {
      var col = document.createElement("col");
      col.className = className;
      colgroup.appendChild(col);
    });
    innerTable.appendChild(colgroup);

    var tbody = document.createElement("tbody");
    companies.forEach(function (company, index) {
      var innerTr = document.createElement("tr");
      var ownedCell = document.createElement("td");
      var sharedCell = document.createElement("td");
      var dateCell = document.createElement("td");
      dateCell.className = "col-date";

      if (kind === "owned") {
        sharedCell.textContent = "—";
        appendCompanyNameLine(ownedCell, company.name, index === 0, rowId, kind);
      } else {
        ownedCell.textContent = "—";
        appendCompanyNameLine(sharedCell, company.name, index === 0, rowId, kind);
      }
      dateCell.textContent = formatProfileDate(company.createdAtMs);

      innerTr.appendChild(ownedCell);
      innerTr.appendChild(sharedCell);
      innerTr.appendChild(dateCell);
      tbody.appendChild(innerTr);
    });
    innerTable.appendChild(tbody);
    ownedTd.appendChild(innerTable);
  }

  function renderCompanyDetailCells(tr, profile, rowId) {
    var owned = ownedCompanies(profile);
    var shared = sharedCompanies(profile);
    var isExpanded = expandedCompanyRowId === rowId && expandedCompanyKind;
    var kind = expandedCompanyKind;

    if (isExpanded && kind === "owned" && owned.length > 1) {
      renderExpandedCompanyBlock(tr, "owned", owned, rowId);
      return;
    }
    if (isExpanded && kind === "shared" && shared.length > 1) {
      renderExpandedCompanyBlock(tr, "shared", shared, rowId);
      return;
    }

    renderCollapsedCompanyCell(tr.children[5], owned, "owned", rowId);
    renderCollapsedCompanyCell(tr.children[6], shared, "shared", rowId);
    tr.children[7].className = "dl-company-date-wrap";
    tr.children[7].textContent = collapsedProfileDate(profile, owned, shared);
  }

  function formatProfileDate(ms) {
    if (!ms) return "—";
    try {
      return new Date(ms).toLocaleDateString();
    } catch (_) {
      return "—";
    }
  }

  function recentRowIndexById(eventId) {
    for (var i = 0; i < cachedRecent.length; i++) {
      if (cachedRecent[i].id === eventId) return i;
    }
    return -1;
  }

  function scrollToRecentAnchor(anchorId) {
    if (!anchorId) return;
    var rowIndex = recentRowIndexById(anchorId);
    if (rowIndex < 0) return;
    var pageSize = parseRecentPageSize();
    var targetPage = Math.floor(rowIndex / pageSize) + 1;

    function highlightAnchor() {
      var el = document.getElementById("recent-row-" + anchorId);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      el.classList.add("recent-row-anchor-highlight");
      window.setTimeout(function () {
        el.classList.remove("recent-row-anchor-highlight");
      }, 1400);
    }

    if (targetPage !== recentPage) {
      recentPage = targetPage;
      renderRecentTable();
      requestAnimationFrame(function () {
        requestAnimationFrame(highlightAnchor);
      });
      return;
    }
    requestAnimationFrame(highlightAnchor);
  }

  function isDuplicateEmailRow(row) {
    var key = normalizedEmail(row && row.userEmail);
    if (!key) return false;
    return emailAnchorByEmail[key] && emailAnchorByEmail[key] !== row.id;
  }

  function fillRecentDetailCells(tr, row) {
    if (!row.userEmail || isDuplicateEmailRow(row)) {
      tr.children[3].textContent = "—";
      tr.children[5].textContent = "—";
      tr.children[6].textContent = "—";
      tr.children[7].textContent = "—";
      return;
    }
    var profile = emailProfileFor(row);
    tr.children[3].textContent = row.userEmail;
    renderCompanyDetailCells(tr, profile, row.id);
  }

  function parseRecentPageSize() {
    var el = document.getElementById("recentPageSize");
    var n = Number(el && el.value);
    if (n === 15 || n === 25 || n === 50 || n === 75 || n === 100) return n;
    return 15;
  }

  function updateRecentScrollArea(rowCount) {
    var scroll = document.querySelector(".dl-recent-scroll");
    if (!scroll) return;
    if (rowCount >= RECENT_SCROLL_ROW_THRESHOLD) {
      var table = scroll.querySelector(".dl-recent-table");
      var head = table && table.querySelector("thead");
      var firstRow = table && table.querySelector("tbody tr");
      var headH = head ? head.offsetHeight : 36;
      var rowH = firstRow ? firstRow.offsetHeight : 34;
      scroll.classList.add("is-scrollable");
      scroll.style.maxHeight = Math.ceil(headH + rowH * RECENT_SCROLL_ROW_THRESHOLD) + "px";
      return;
    }
    scroll.classList.remove("is-scrollable");
    scroll.style.maxHeight = "";
  }

  function renderRecentTable() {
    var recentBody = document.getElementById("recentBody");
    var pageInfo = document.getElementById("recentPageInfo");
    var prevBtn = document.getElementById("recentPrevBtn");
    var nextBtn = document.getElementById("recentNextBtn");
    if (!recentBody) return;

    var pageSize = parseRecentPageSize();
    var total = cachedRecent.length;
    var totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    if (recentPage > totalPages) recentPage = totalPages;
    if (recentPage < 1) recentPage = 1;

    var start = total ? (recentPage - 1) * pageSize : 0;
    var pageRows = cachedRecent.slice(start, start + pageSize);

    recentBody.innerHTML = "";
    if (!total) {
      recentBody.innerHTML = '<tr><td colspan="8">No recent events.</td></tr>';
    } else {
      pageRows.forEach(function (row) {
        var tr = document.createElement("tr");
        tr.id = "recent-row-" + row.id;
        tr.innerHTML = "<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>";
        tr.children[0].textContent = formatWhen(row.createdAtMs);
        tr.children[1].textContent = String(row.platform || "");
        tr.children[2].textContent = countryLabel(row.country);
        tr.children[4].textContent = row.version || "—";

        if (isDuplicateEmailRow(row)) {
          tr.className = "recent-row-duplicate";
          var dupBtn = document.createElement("button");
          dupBtn.type = "button";
          dupBtn.className = "dl-duplicate-email-btn";
          dupBtn.textContent = "Duplicate email";
          dupBtn.onclick = function () {
            scrollToRecentAnchor(emailAnchorByEmail[normalizedEmail(row.userEmail)]);
          };
          tr.children[3].appendChild(dupBtn);
          tr.children[5].textContent = "—";
          tr.children[6].textContent = "—";
          tr.children[7].textContent = "—";
        } else {
          fillRecentDetailCells(tr, row);
        }

        recentBody.appendChild(tr);
      });
    }

    if (pageInfo) {
      if (!total) pageInfo.textContent = "0 events";
      else {
        pageInfo.textContent =
          String(start + 1) +
          "–" +
          String(Math.min(start + pageSize, total)) +
          " of " +
          String(total);
      }
    }
    if (prevBtn) prevBtn.disabled = recentPage <= 1;
    if (nextBtn) nextBtn.disabled = recentPage >= totalPages || !total;

    var visibleRows = total ? pageRows.length : 0;
    requestAnimationFrame(function () {
      updateRecentScrollArea(visibleRows);
    });
  }

  async function load() {
    setStatus("Loading.", true);
    try {
      var json = await window.SiteData.adminGet("/admin/download-stats");
      cachedStatsNew = json.stats || { total: 0, byPlatform: {} };
      cachedStatsUpdate = json.statsUpdate || { total: 0, byPlatform: {} };
      currentReleaseVersion = String(json.currentReleaseVersion || "").trim();
      cachedRecentAll = Array.isArray(json.recent) ? json.recent : [];
      cachedEmailProfiles =
        json.emailProfiles && typeof json.emailProfiles === "object" ? json.emailProfiles : {};
      if (activeAnalyticsTab === "update") populateUpdateVersionSelect();
      applyAnalyticsView();
      setStatus("Ready.", true);
    } catch (e) {
      setStatus(e && e.message ? e.message : "Could not load download stats.", false);
    }
  }

  function init() {
    document.getElementById("refreshBtn").onclick = function () { void load(); };
    document.querySelectorAll("[data-dl-analytics-tab]").forEach(function (btn) {
      btn.onclick = function () {
        setAnalyticsTab(btn.getAttribute("data-dl-analytics-tab"));
      };
    });
    var updateVersionFilterEl = document.getElementById("updateVersionFilter");
    if (updateVersionFilterEl) {
      updateVersionFilterEl.onchange = function () {
        updateVersionFilter = updateVersionFilterEl.value || "all";
        applyAnalyticsView();
      };
    }
    var timelineRangeEl = document.getElementById("timelineRange");
    if (timelineRangeEl) {
      timelineRangeEl.onchange = function () {
        renderTimelineChart(cachedRecent);
      };
    }
    var recentPageSizeEl = document.getElementById("recentPageSize");
    if (recentPageSizeEl) {
      recentPageSizeEl.onchange = function () {
        recentPage = 1;
        renderRecentTable();
      };
    }
    var recentPrevBtn = document.getElementById("recentPrevBtn");
    if (recentPrevBtn) {
      recentPrevBtn.onclick = function () {
        if (recentPage > 1) {
          recentPage -= 1;
          renderRecentTable();
        }
      };
    }
    var recentNextBtn = document.getElementById("recentNextBtn");
    if (recentNextBtn) {
      recentNextBtn.onclick = function () {
        recentPage += 1;
        renderRecentTable();
      };
    }

    window.SiteData.gate({
      authBox: authBox,
      adminBox: adminBox,
      whoEl: whoEl,
      outBtn: outBtn,
      setStatus: setStatus,
      onReady: function () {
        setAnalyticsTab("new");
        void load();
      },
    });
  }

  init();
}());