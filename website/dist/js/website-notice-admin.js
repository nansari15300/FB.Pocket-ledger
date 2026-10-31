(function () {
  "use strict";

  var statusEl = document.getElementById("status");
  var authBox = document.getElementById("authBox");
  var adminBox = document.getElementById("adminBox");
  var whoEl = document.getElementById("who");
  var outBtn = document.getElementById("outBtn");
  var messageEl = document.getElementById("noticeMessage");
  var enabledEl = document.getElementById("noticeEnabled");
  var saveBtn = document.getElementById("saveNoticeBtn");

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "status " + (ok ? "ok" : "err");
  }

  async function load() {
    setStatus("Loading.", true);
    try {
      var notice = await window.SiteData.adminGet("/admin/notice");
      if (messageEl) messageEl.value = String(notice.message || "");
      if (enabledEl) enabledEl.checked = Boolean(notice.enabled);
      setStatus("Ready.", true);
    } catch (err) {
      setStatus("Load failed. " + (err.message || ""), false);
    }
  }

  async function save() {
    if (!messageEl || !enabledEl) return;
    var message = String(messageEl.value || "").trim();
    var enabled = Boolean(enabledEl.checked);
    if (enabled && !message) {
      setStatus("Type a message or turn off \u201cShow on website\u201d.", false);
      return;
    }
    setStatus("Saving.", true);
    try {
      await window.SiteData.adminPost("/admin/notice", { message: message, enabled: enabled });
      setStatus("Saved. Visitors will see this on the marketing homepage.", true);
    } catch (err) {
      setStatus("Save failed. " + (err.message || ""), false);
    }
  }

  if (saveBtn) {
    saveBtn.onclick = function () {
      void save();
    };
  }

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
}());