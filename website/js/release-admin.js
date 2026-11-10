(function () {

  var statusEl = document.getElementById("status");
  var authBox = document.getElementById("authBox");
  var uploadBox = document.getElementById("uploadBox");
  var whoEl = document.getElementById("who");
  var progressEl = document.getElementById("progress");
  var outBtn = document.getElementById("outBtn");
  var deleteAllOutdatedBtn = document.getElementById("deleteAllOutdatedBtn");
  var visibleReleaseTableExe = document.getElementById("visibleReleaseTableExe");
  var visibleReleaseTableApk = document.getElementById("visibleReleaseTableApk");
  var visibleReleaseEmptyExe = document.getElementById("visibleReleaseEmptyExe");
  var visibleReleaseEmptyApk = document.getElementById("visibleReleaseEmptyApk");
  var outdatedTableExe = document.getElementById("outdatedTableExe");
  var outdatedTableApk = document.getElementById("outdatedTableApk");
  var outdatedEmptyExe = document.getElementById("outdatedEmptyExe");
  var outdatedEmptyApk = document.getElementById("outdatedEmptyApk");
  var downloadsMaxOldExeInput = document.getElementById("downloadsMaxOldExe");
  var downloadsMaxOldApkInput = document.getElementById("downloadsMaxOldApk");
  var outdatedPolicySelect = document.getElementById("outdatedPolicy");
  var outdatedMaxKeepInput = document.getElementById("outdatedMaxKeep");
  var saveSettingsBtn = document.getElementById("saveSettingsBtn");
  var saveDownloadsSettingsBtn = document.getElementById("saveDownloadsSettingsBtn");
  var visibleListHintExe = document.getElementById("visibleListHintExe");
  var visibleListHintApk = document.getElementById("visibleListHintApk");
  var outdatedListHintExe = document.getElementById("outdatedListHintExe");
  var outdatedListHintApk = document.getElementById("outdatedListHintApk");
  var cachedManifest = null;
  var cachedSettings = normalizeReleaseSettings(null);
  var settingsFileCorrupt = false;

  function normalizeReleaseSettings(raw) {
    return typeof window.normalizeReleaseSettings === "function"
      ? window.normalizeReleaseSettings(raw)
      : { downloadsMaxOldExe: 5, downloadsMaxOldApk: 5, outdatedPolicy: "keep", outdatedMaxKeep: 20 };
  }

  function cloneReleaseEntry(entry) {
    return typeof window.cloneReleaseEntry === "function"
      ? window.cloneReleaseEntry(entry)
      : entry;
  }

  function buildRotation(prev, next) {
    return typeof window.buildReleaseRotation === "function"
      ? window.buildReleaseRotation(prev, next, cachedSettings)
      : { history: [], outdated: [], deleteEntries: [] };
  }

  function reconcileManifest(manifest, settings, mode) {
    if (mode === "hidden") {
      return typeof window.reconcileHiddenSettings === "function"
        ? window.reconcileHiddenSettings(manifest, settings)
        : { history: [], outdated: [], deleteEntries: [], spilledCount: 0, promotedCount: 0 };
    }
    return typeof window.reconcileDownloadsSettings === "function"
      ? window.reconcileDownloadsSettings(manifest, settings)
      : typeof window.reconcileManifestWithSettings === "function"
        ? window.reconcileManifestWithSettings(manifest, settings)
        : { history: [], outdated: [], deleteEntries: [], spilledCount: 0, promotedCount: 0 };
  }

  function readSettingsFromForm() {
    return normalizeReleaseSettings({
      downloadsMaxOldExe: downloadsMaxOldExeInput && downloadsMaxOldExeInput.value,
      downloadsMaxOldApk: downloadsMaxOldApkInput && downloadsMaxOldApkInput.value,
      outdatedPolicy: outdatedPolicySelect && outdatedPolicySelect.value,
      outdatedMaxKeep: outdatedMaxKeepInput && outdatedMaxKeepInput.value,
    });
  }

  async function applySettingsSave(mode) {
    var nextSettings = readSettingsFromForm();
    try {
      setStatus("Saving release settings.", true);
      var dry = await window.SiteData.adminPost("/admin/releases/settings", {
        mode: mode,
        settings: nextSettings,
        dryRun: true,
      });
      var deleteList = Array.isArray(dry.deleteEntries) ? dry.deleteEntries : [];
      if (deleteList.length > 0) {
        var okDelete = await confirmDialog({
          title: "Delete builds?",
          message: "Delete " + deleteList.length + " build(s) from the server permanently?",
          items: deleteList.map(entrySummaryLabel),
          confirmLabel: "Delete permanently",
          danger: true,
        });
        if (!okDelete) {
          applySettingsToForm();
          setStatus("Settings not saved - delete cancelled.", false);
          return;
        }
      }
      var res = await window.SiteData.adminPost("/admin/releases/settings", {
        mode: mode,
        settings: nextSettings,
      });
      cachedManifest = res.manifest || cachedManifest;
      cachedSettings = normalizeReleaseSettings(res.settings || nextSettings);
      applySettingsToForm();
      renderVisibleReleaseList();
      renderOutdatedList();
      if (mode === "downloads" && res.spilledCount > 0 && nextSettings.outdatedPolicy === "keep") {
        setStatus("Settings saved. Moved " + res.spilledCount + " build(s) to Hidden / outdated.", true);
      } else if (mode === "downloads" && res.promotedCount > 0) {
        setStatus("Settings saved. Moved " + res.promotedCount + " build(s) to Downloads dropdown.", true);
      } else if (deleteList.length > 0) {
        setStatus("Settings saved. Deleted " + deleteList.length + " build(s) from the server.", true);
      } else {
        setStatus("Release settings saved.", true);
      }
    } catch (err) {
      applySettingsToForm();
      setStatus(err.message || String(err), false);
    }
  }

  async function saveDownloadsSettings() {
    await applySettingsSave("downloads");
  }

  async function saveHiddenSettings() {
    await applySettingsSave("hidden");
  }

  async function saveSettings() {
    await saveHiddenSettings();
  }

  function entrySummaryLabel(entry) {
    var bits = [entry.date || "unknown"];
    if (entry.windows && entry.windows.version) bits.push("EXE v" + entry.windows.version);
    if (entry.windows && entry.windows.file) bits.push(entry.windows.file);
    var apk = entry.android && isApkAndroid(entry.android) ? entry.android : null;
    if (apk && apk.version) bits.push("APK v" + apk.version);
    if (apk && apk.file) bits.push(apk.file);
    return bits.join(" · ");
  }

  function confirmDialog(options) {
    options = options || {};
    var modal = document.getElementById("releaseConfirmModal");
    var titleEl = document.getElementById("releaseConfirmTitle");
    var messageEl = document.getElementById("releaseConfirmMessage");
    var listEl = document.getElementById("releaseConfirmList");
    var okBtn = document.getElementById("releaseConfirmOk");
    var cancelBtn = document.getElementById("releaseConfirmCancel");
    var backdrop = modal && modal.querySelector("[data-confirm-cancel]");

    return new Promise(function (resolve) {
      if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
        resolve(
          window.confirm(
            String(options.title || "Confirm") + "\n\n" + String(options.message || "")
          )
        );
        return;
      }

      titleEl.textContent = options.title || "Confirm";
      messageEl.textContent = options.message || "";
      var items = Array.isArray(options.items) ? options.items : [];
      listEl.innerHTML = "";
      if (items.length) {
        listEl.hidden = false;
        items.forEach(function (text) {
          var li = document.createElement("li");
          li.textContent = text;
          listEl.appendChild(li);
        });
      } else {
        listEl.hidden = true;
      }

      okBtn.textContent = options.confirmLabel || "Confirm";
      cancelBtn.textContent = options.cancelLabel || "Cancel";
      okBtn.className = options.danger
        ? "btn btn-outline btn-sm btn-danger"
        : "btn btn-primary btn-sm";

      function finish(value) {
        modal.hidden = true;
        document.body.classList.remove("release-confirm-open");
        document.removeEventListener("keydown", onKey);
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        if (backdrop) backdrop.onclick = null;
        resolve(value);
      }

      function onKey(event) {
        if (event.key === "Escape") finish(false);
      }

      okBtn.onclick = function () {
        finish(true);
      };
      cancelBtn.onclick = function () {
        finish(false);
      };
      if (backdrop) {
        backdrop.onclick = function () {
          finish(false);
        };
      }

      document.addEventListener("keydown", onKey);
      modal.hidden = false;
      document.body.classList.add("release-confirm-open");
      cancelBtn.focus();
    });
  }

  function isApkAndroid(item) {
    return typeof window.isApkAndroidRelease === "function"
      ? window.isApkAndroidRelease(item)
      : Boolean(item && item.url);
  }

  function entryLabelExe(entry) {
    var bits = [entry.date || "unknown"];
    if (entry.windows && entry.windows.version) bits.push("EXE v" + entry.windows.version);
    else bits.push("No EXE");
    return bits.join(" · ");
  }

  function entryLabelApk(entry) {
    var bits = [entry.date || "unknown"];
    var apk = entry.android && isApkAndroid(entry.android) ? entry.android : null;
    if (apk && apk.version) bits.push("APK v" + apk.version);
    else bits.push("No APK");
    return bits.join(" · ");
  }

  function entryFilesLineExe(entry) {
    return (entry.windows && entry.windows.file) || "No EXE file";
  }

  function entryFilesLineApk(entry) {
    var apk = entry.android && isApkAndroid(entry.android) ? entry.android : null;
    return (apk && apk.file) || "No APK file";
  }

  function entryVersion(entry, platform) {
    if (platform === "apk") {
      var apk = entry && entry.android && isApkAndroid(entry.android) ? entry.android : null;
      return (apk && apk.version) || "—";
    }
    return (entry && entry.windows && entry.windows.version) || "—";
  }

  function entryLabel(entry, platform) {
    return platform === "apk" ? entryLabelApk(entry) : entryLabelExe(entry);
  }

  function entryFilesLine(entry, platform) {
    return platform === "apk" ? entryFilesLineApk(entry) : entryFilesLineExe(entry);
  }

  function entryHasPlatform(entry, platform) {
    if (platform === "apk") {
      return Boolean(entry.android && isApkAndroid(entry.android));
    }
    return Boolean(entry.windows && entry.windows.url);
  }

  function updateSettingsHint() {
    var maxExe = cachedSettings.downloadsMaxOldExe;
    var maxApk = cachedSettings.downloadsMaxOldApk;
    var exeHint =
      "Users see latest + " +
      maxExe +
      " older EXE (" +
      (maxExe + 1) +
      " max) in the Downloads dropdown.";
    var apkHint =
      "Users see latest + " +
      maxApk +
      " older APK (" +
      (maxApk + 1) +
      " max) in the Downloads dropdown.";
    if (visibleListHintExe) visibleListHintExe.textContent = exeHint;
    if (visibleListHintApk) visibleListHintApk.textContent = apkHint;

    var hiddenHint =
      cachedSettings.outdatedPolicy === "auto_delete"
        ? "Hidden builds are auto-deleted from the server when they leave the downloads list."
        : cachedSettings.outdatedMaxKeep <= 0
          ? "Hidden builds are kept here (no limit). Delete removes files permanently."
          : "Hidden builds are kept here (max " +
            cachedSettings.outdatedMaxKeep +
            "). Delete removes files permanently.";
    if (outdatedListHintExe) outdatedListHintExe.textContent = hiddenHint;
    if (outdatedListHintApk) outdatedListHintApk.textContent = hiddenHint;
  }

  function applySettingsToForm() {
    if (downloadsMaxOldExeInput) {
      downloadsMaxOldExeInput.value = String(cachedSettings.downloadsMaxOldExe);
    }
    if (downloadsMaxOldApkInput) {
      downloadsMaxOldApkInput.value = String(cachedSettings.downloadsMaxOldApk);
    }
    if (outdatedPolicySelect) outdatedPolicySelect.value = cachedSettings.outdatedPolicy;
    if (outdatedMaxKeepInput) outdatedMaxKeepInput.value = String(cachedSettings.outdatedMaxKeep);
    updateSettingsHint();
  }

  function findHistoryIndex(entry, platform) {
    if (!cachedManifest || !Array.isArray(cachedManifest.history)) return null;
    for (var i = 0; i < cachedManifest.history.length; i++) {
      var hist = cachedManifest.history[i];
      if (platform === "apk") {
        var apk = entry.android && isApkAndroid(entry.android) ? entry.android : null;
        var histApk = hist.android && isApkAndroid(hist.android) ? hist.android : null;
        if (apk && histApk && String(apk.url || "") === String(histApk.url || "")) return i;
        if (
          apk &&
          histApk &&
          String(entry.date || "") === String(hist.date || "") &&
          String(apk.version || "") === String(histApk.version || "")
        ) {
          return i;
        }
      } else if (entry.windows && hist.windows) {
        if (String(entry.windows.url || "") === String(hist.windows.url || "")) return i;
        if (
          String(entry.date || "") === String(hist.date || "") &&
          String(entry.windows.version || "") === String(hist.windows.version || "")
        ) {
          return i;
        }
      }
    }
    return null;
  }

  function visibleEntriesForPlatform(platform) {
    if (typeof window.buildPublicDownloadEntries !== "function" || !cachedManifest) return [];
    var kind = platform === "apk" ? "android" : "windows";
    return window.buildPublicDownloadEntries(cachedManifest, cachedSettings, kind);
  }

  function setStatus(msg, ok) {
    statusEl.textContent = msg || "";
    statusEl.className = "status " + (ok ? "ok" : "err");
  }

  function todayStamp() {
    var d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function bytesLabel(n) {
    if (!n) return "";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function optionalText(id) {
    return String(document.getElementById(id).value || "").trim();
  }

  function renderVisibleReleaseList() {
    renderVisiblePlatformTable("exe", visibleReleaseTableExe, visibleReleaseEmptyExe);
    renderVisiblePlatformTable("apk", visibleReleaseTableApk, visibleReleaseEmptyApk);
  }

  function renderVisiblePlatformTable(platform, tbodyEl, emptyEl) {
    if (!tbodyEl) return;
    tbodyEl.innerHTML = "";
    if (!cachedManifest || (!cachedManifest.windows && !cachedManifest.android)) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    var entries = visibleEntriesForPlatform(platform);
    if (!entries.length) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    var olderNum = 0;
    entries.forEach(function (entry) {
      var roleLabel;
      var historyIndex;
      if (entry.latest) {
        roleLabel = "Latest";
        historyIndex = null;
      } else {
        olderNum += 1;
        roleLabel = "Older #" + olderNum;
        historyIndex = findHistoryIndex(entry, platform);
      }
      appendVisibleReleaseTableRow(tbodyEl, entry, roleLabel, historyIndex, platform);
    });
  }

  function appendVisibleReleaseTableRow(tbodyEl, entry, roleLabel, historyIndex, platform) {
    var tr = document.createElement("tr");
    var roleTd = document.createElement("td");
    roleTd.textContent = roleLabel;
    var versionTd = document.createElement("td");
    versionTd.textContent = "v" + entryVersion(entry, platform);
    var dateTd = document.createElement("td");
    dateTd.textContent = entry.date || "—";
    var fileTd = document.createElement("td");
    fileTd.textContent = entryFilesLine(entry, platform);
    var actionTd = document.createElement("td");
    actionTd.className = "col-action";
    var del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-outline btn-sm btn-danger";
    del.textContent = historyIndex === null ? "Latest" : "Delete";
    del.disabled = historyIndex === null;
    if (historyIndex !== null) {
      del.onclick = function () {
        void deleteHistoryRelease(historyIndex);
      };
    }
    actionTd.appendChild(del);
    tr.appendChild(roleTd);
    tr.appendChild(versionTd);
    tr.appendChild(dateTd);
    tr.appendChild(fileTd);
    tr.appendChild(actionTd);
    tbodyEl.appendChild(tr);
  }

  function renderOutdatedList() {
    renderOutdatedPlatformTable("exe", outdatedTableExe, outdatedEmptyExe);
    renderOutdatedPlatformTable("apk", outdatedTableApk, outdatedEmptyApk);
  }

  function renderOutdatedPlatformTable(platform, tbodyEl, emptyEl) {
    if (!tbodyEl) return;
    var list = (cachedManifest && Array.isArray(cachedManifest.outdated) ? cachedManifest.outdated : [])
      .filter(function (entry) {
        return entryHasPlatform(entry, platform);
      })
      .map(function (entry, filteredIdx) {
        var realIdx = cachedManifest.outdated.indexOf(entry);
        return { entry: entry, index: realIdx >= 0 ? realIdx : filteredIdx };
      });
    tbodyEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = list.length > 0;
    list.forEach(function (row) {
      appendOutdatedTableRow(tbodyEl, row.entry, row.index, platform);
    });
  }

  function appendOutdatedTableRow(tbodyEl, entry, index, platform) {
    var tr = document.createElement("tr");
    var versionTd = document.createElement("td");
    versionTd.textContent = "v" + entryVersion(entry, platform);
    var dateTd = document.createElement("td");
    dateTd.textContent = entry.date || "—";
    var fileTd = document.createElement("td");
    fileTd.textContent = entryFilesLine(entry, platform);
    var actionTd = document.createElement("td");
    actionTd.className = "col-action";
    var del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-outline btn-sm btn-danger";
    del.textContent = "Delete";
    del.onclick = function () {
      void hardDeleteOutdated(index);
    };
    actionTd.appendChild(del);
    tr.appendChild(versionTd);
    tr.appendChild(dateTd);
    tr.appendChild(fileTd);
    tr.appendChild(actionTd);
    tbodyEl.appendChild(tr);
  }

  async function loadManifest() {
    try {
      var res = await window.SiteData.adminGet("/admin/releases");
      cachedManifest = res.manifest || { history: [], outdated: [] };
      cachedSettings = normalizeReleaseSettings(res.settings);
      settingsFileCorrupt = false;
    } catch (err) {
      cachedManifest = { history: [], outdated: [] };
      setStatus("Could not load releases. " + (err.message || ""), false);
    }
    applySettingsToForm();
    renderVisibleReleaseList();
    renderOutdatedList();
  }

  async function deleteBuild(body, title, message, items, okStatus) {
    if (
      !(await confirmDialog({
        title: title,
        message: message,
        items: items,
        confirmLabel: "Delete",
        danger: true,
      }))
    ) {
      return;
    }
    try {
      setStatus("Deleting release files.", true);
      var res = await window.SiteData.adminPost("/admin/releases/delete", body);
      cachedManifest = res.manifest || cachedManifest;
      renderVisibleReleaseList();
      renderOutdatedList();
      setStatus(okStatus, true);
    } catch (err) {
      setStatus(err.message || String(err), false);
    }
  }

  async function deleteHistoryRelease(index) {
    if (!cachedManifest || !Array.isArray(cachedManifest.history)) return;
    var entry = cachedManifest.history[index];
    if (!entry) return;
    await deleteBuild(
      { list: "history", index: index, date: entry.date },
      "Remove from Downloads?",
      "Remove this build from the public Downloads list and delete its files from the server?",
      [entrySummaryLabel(entry)],
      "Deleted older release " + entrySummaryLabel(entry)
    );
  }

  async function deleteAllOutdated() {
    var list = (cachedManifest && Array.isArray(cachedManifest.outdated) ? cachedManifest.outdated : []).slice();
    if (!list.length) {
      setStatus("No outdated builds to delete.", true);
      return;
    }
    await deleteBuild(
      { list: "outdatedAll" },
      "Delete all outdated?",
      "Delete ALL " + list.length + " outdated build(s) from the server permanently?",
      null,
      "Deleted all outdated builds (" + list.length + ")."
    );
  }

  async function hardDeleteOutdated(index) {
    if (!cachedManifest || !Array.isArray(cachedManifest.outdated)) return;
    var entry = cachedManifest.outdated[index];
    if (!entry) return;
    await deleteBuild(
      { list: "outdated", index: index, date: entry.date },
      "Hard delete?",
      "Hard delete this outdated release from the server?",
      [entrySummaryLabel(entry)],
      "Hard-deleted outdated release " + entrySummaryLabel(entry)
    );
  }

  function showAuthedUi() {
    void loadManifest();
  }

  if (deleteAllOutdatedBtn) {
    deleteAllOutdatedBtn.onclick = function () {
      void deleteAllOutdated();
    };
  }
  if (saveSettingsBtn) {
    saveSettingsBtn.onclick = function () {
      void saveSettings();
    };
  }
  if (saveDownloadsSettingsBtn) {
    saveDownloadsSettingsBtn.onclick = function () {
      void saveDownloadsSettings();
    };
  }

  window.SiteData.gate({
    authBox: authBox,
    adminBox: uploadBox,
    whoEl: whoEl,
    outBtn: outBtn,
    setStatus: setStatus,
    onReady: function () {
      showAuthedUi();
    },
  });

  document.getElementById("publishBtn").onclick = async function () {
    var exe = document.getElementById("exeFile").files[0];
    var apk = document.getElementById("apkFile").files[0];
    var windowsVersion = optionalText("windowsVersion");
    var androidVersion = optionalText("androidVersion");
    var playStoreUrl = optionalText("playStoreUrl");
    if (!exe && !apk && !playStoreUrl) {
      setStatus("Pick at least one file (EXE or APK).", false);
      return;
    }
    if (exe && !windowsVersion) {
      setStatus("Enter the Windows version for the EXE.", false);
      return;
    }
    if (apk && !androidVersion) {
      setStatus("Enter the Android version for the APK.", false);
      return;
    }
    if (playStoreUrl) {
      try {
        new URL(playStoreUrl);
      } catch (_) {
        setStatus("Play Store link must be a full https URL.", false);
        return;
      }
    }
    var date = document.getElementById("dateField").value || todayStamp();
    var btn = document.getElementById("publishBtn");
    btn.disabled = true;
    progressEl.hidden = false;
    progressEl.value = 0;
    try {
      var body = { date: date };
      var share = exe && apk ? 50 : 100;
      var base = 0;
      if (exe) {
        setStatus("Uploading EXE to the server.", true);
        var exeBase = base;
        var up1 = await window.SiteData.uploadFile(exe, date, function (p) {
          progressEl.value = exeBase + Math.round((p * share) / 100);
        });
        body.windows = { file: up1.file, version: windowsVersion };
        base += share;
      }
      if (apk) {
        setStatus("Uploading APK to the server.", true);
        var apkBase = base;
        var up2 = await window.SiteData.uploadFile(apk, date, function (p) {
          progressEl.value = apkBase + Math.round((p * share) / 100);
        });
        body.android = { file: up2.file, version: androidVersion };
      }
      if (playStoreUrl) body.playStoreUrl = playStoreUrl;
      setStatus("Publishing.", true);
      var res = await window.SiteData.adminPost("/admin/releases/publish", body);
      cachedManifest = res.manifest || cachedManifest;
      renderVisibleReleaseList();
      renderOutdatedList();
      progressEl.value = 100;
      var man = cachedManifest || {};
      setStatus(
        "Published " + date + " - kept " + (1 + (man.history || []).length) + ", outdated " + (man.outdated || []).length,
        true
      );
    } catch (err) {
      setStatus(err.message || String(err), false);
    } finally {
      btn.disabled = false;
    }
  };

  document.getElementById("dateField").value = todayStamp();
  document.getElementById("windowsVersion").value = "1.0.0";
  document.getElementById("androidVersion").value = "1.0.0";
})();