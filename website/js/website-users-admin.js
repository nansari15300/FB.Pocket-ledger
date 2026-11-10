(function () {
  "use strict";

  /* Website users (admins) page. Moved here from release-admin.js; same server API. */
  var statusEl = document.getElementById("status");
  var authBox = document.getElementById("authBox");
  var adminBox = document.getElementById("adminBox");
  var whoEl = document.getElementById("who");
  var outBtn = document.getElementById("outBtn");
  var adminListEl = document.getElementById("adminList");
  var emptyEl = document.getElementById("adminListEmpty");
  var emailInput = document.getElementById("newAdminEmail");
  var addBtn = document.getElementById("addAdminBtn");
  var addRow = document.getElementById("addAdminRow");
  var adminState = { owners: [], emails: [], canEdit: false };

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "status " + (ok ? "ok" : "err");
  }

  function addRowEl(email, role, removable) {
    var tr = document.createElement("tr");
    var tdEmail = document.createElement("td");
    tdEmail.textContent = email;
    var tdRole = document.createElement("td");
    tdRole.textContent = role;
    var tdAction = document.createElement("td");
    tdAction.className = "col-action";
    if (removable) {
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn-outline btn-sm";
      rm.textContent = "Remove";
      rm.onclick = function () {
        void removeAdmin(email);
      };
      tdAction.appendChild(rm);
    }
    tr.appendChild(tdEmail);
    tr.appendChild(tdRole);
    tr.appendChild(tdAction);
    adminListEl.appendChild(tr);
  }

  function renderAdminList() {
    if (!adminListEl) return;
    adminListEl.innerHTML = "";
    adminState.owners.forEach(function (email) {
      addRowEl(email, "Owner", false);
    });
    adminState.emails.forEach(function (email) {
      addRowEl(email, "Admin", adminState.canEdit);
    });
    if (emptyEl) emptyEl.hidden = adminState.owners.length + adminState.emails.length > 0;
    if (addRow) addRow.hidden = !adminState.canEdit;
  }

  async function loadAdmins() {
    setStatus("Loading.", true);
    try {
      var data = await window.SiteData.adminGet("/admin/admins");
      adminState.owners = Array.isArray(data.owners) ? data.owners : [];
      adminState.emails = Array.isArray(data.emails) ? data.emails : [];
      adminState.canEdit = data.canEdit === true;
      setStatus("Ready.", true);
    } catch (err) {
      adminState.owners = [];
      adminState.emails = [];
      adminState.canEdit = false;
      setStatus("Load failed. " + ((err && err.message) || ""), false);
    }
    renderAdminList();
  }

  async function saveAdmins(nextEmails) {
    var res = await window.SiteData.adminPost("/admin/admins", { emails: nextEmails });
    adminState.emails = Array.isArray(res.emails) ? res.emails : [];
    renderAdminList();
  }

  async function addAdmin(email) {
    var e = String(email || "").trim().toLowerCase();
    if (!e) {
      setStatus("Enter an email.", false);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setStatus("Invalid email.", false);
      return;
    }
    try {
      await saveAdmins(adminState.emails.concat([e]));
      if (emailInput) emailInput.value = "";
      setStatus("Added " + e, true);
    } catch (err) {
      setStatus((err && err.message) || String(err), false);
    }
  }

  async function removeAdmin(email) {
    var e = String(email || "").trim().toLowerCase();
    try {
      await saveAdmins(adminState.emails.filter(function (x) { return x !== e; }));
      setStatus("Removed " + e, true);
    } catch (err) {
      setStatus((err && err.message) || String(err), false);
    }
  }

  if (addBtn) {
    addBtn.onclick = function () {
      void addAdmin(emailInput ? emailInput.value : "");
    };
  }
  if (emailInput) {
    emailInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") void addAdmin(emailInput.value);
    });
  }

  window.SiteData.gate({
    authBox: authBox,
    adminBox: adminBox,
    whoEl: whoEl,
    outBtn: outBtn,
    setStatus: setStatus,
    onReady: function () {
      void loadAdmins();
    },
  });
}());