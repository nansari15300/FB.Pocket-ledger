(function () {
  "use strict";

  var PLAN_ORDER = ["basic", "advance", "pro", "pro-plus"];
  var PLAN_CATALOG_URL = "/app/api/payments/plan-catalog";
  var PLAN_CACHE_KEY = "pocket-ledger:public-plan-catalog:v2";
  var state = { plans: [], term: "monthly" };

  var ONLINE_FEATURES = [
    ["maxCompanies", "Max Companies (online)"],
    ["maxUsers", "Max Users (online)"],
    ["maxDevices", "Max devices (online)"],
    ["hasMultiDeviceSync", "Multi device sync"],
    ["dailyVoucherLimit", "Daily Vouchers (online)"],
    ["monthlyVoucherLimit", "Monthly Vouchers (online)"],
    ["maxAttachmentsGB", "Attachments GB (online)"],
    ["maxStorageGB", "Storage GB (online)"],
    ["maxLocalToOnlineAttachmentMB", "Local→cloud attachments (MB)"],
  ];
  var LOCAL_FEATURES = [
    ["maxCompaniesLocal", "Max Companies (local)"],
    ["maxUsersLocal", "Max Users (local)"],
    ["maxDevicesLocal", "Max devices (local)"],
    ["dailyVoucherLimitLocal", "Daily Vouchers (local)"],
    ["monthlyVoucherLimitLocal", "Monthly Vouchers (local)"],
    ["maxAttachmentsGBLocal", "Attachments GB (local)"],
    ["maxStorageGBLocal", "Storage GB (local)"],
  ];
  var SHARED_FEATURES = [
    ["googleDriveSyncEnabled", "Google Drive sync"],
    ["maxGoogleDriveSyncCompanies", "Google Drive sync companies"],
    ["maxGoogleDriveSyncUsers", "Google Drive users"],
    ["maxAttachmentBackupPerMonth", "Attachment backups / month"],
    ["maxAttachmentRestorePerMonth", "Attachment restores / month"],
    ["hasRoleBasedAccess", "Role-based access"],
    ["hasAuditLogs", "Audit logs"],
    ["hasPrioritySupport", "Priority support"],
  ];
  var BOOLEAN_FEATURES = {
    hasMultiDeviceSync: true,
    googleDriveSyncEnabled: true,
    hasRoleBasedAccess: true,
    hasAuditLogs: true,
    hasPrioritySupport: true,
  };

  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function asFiniteNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  function formatAmount(amount, currency) {
    if (amount <= 0) return "Free";
    try {
      return new Intl.NumberFormat("en-NP", {
        style: "currency", currency: currency || "NPR", maximumFractionDigits: 0,
      }).format(amount);
    } catch (_) {
      return (currency || "NPR") + " " + amount.toLocaleString("en-NP");
    }
  }
  function formatCap(raw) {
    var value = asFiniteNumber(raw);
    if (value === -1) return { text: "Unlimited", enabled: true };
    if (value <= 0) return { text: "None", enabled: false };
    return { text: String(value), enabled: true };
  }
  function planListFromCatalog(plans) {
    if (!Array.isArray(plans)) return [];
    var byId = {};
    plans.forEach(function (plan) { if (plan && plan.id) byId[String(plan.id)] = plan; });
    return PLAN_ORDER.map(function (id) { return byId[id] || null; }).filter(Boolean);
  }
  function featureValue(plan, key) {
    var entitlements = plan.entitlements || {};
    var onlineOn = entitlements.allowFirebaseOnlineCompanies === true;
    var driveOn = entitlements.googleDriveSyncEnabled === true;
    var raw = entitlements[key];
    if (!onlineOn && [
      "maxCompanies", "maxUsers", "maxDevices", "hasMultiDeviceSync",
      "dailyVoucherLimit", "monthlyVoucherLimit", "maxAttachmentsGB",
      "maxStorageGB", "maxLocalToOnlineAttachmentMB",
    ].indexOf(key) !== -1) return { text: "None", enabled: false, boolean: false };
    if (!driveOn && ["maxGoogleDriveSyncCompanies", "maxGoogleDriveSyncUsers"].indexOf(key) !== -1) {
      return { text: "None", enabled: false, boolean: false };
    }
    if (BOOLEAN_FEATURES[key]) {
      return { text: entitlements[key] === true ? "✓" : "×", enabled: entitlements[key] === true, boolean: true };
    }
    if (key === "maxDevices" || key === "maxDevicesLocal") {
      if (entitlements.hasMultiDeviceSync !== true) {
        return { text: "1", enabled: true, boolean: false };
      }
      if (key === "maxDevicesLocal" && entitlements.maxDevicesLocal == null) {
        raw = entitlements.maxDevices;
      }
    }
    return Object.assign(formatCap(raw), { boolean: false });
  }
  function planColumnClass(plan) {
    return "pricing-plan-" + String(plan.id || "").replace(/[^a-z0-9-]/gi, "");
  }
  function renderFeatureRow(feature, plans, isFirstLocal, block) {
    var key = feature[0];
    var cells = plans.map(function (plan) {
      var value = featureValue(plan, key);
      var onlineOn = featureValue(plan, "maxCompanies").enabled;
      var localOn = featureValue(plan, "maxCompaniesLocal").enabled;
      var deactivated = (block === "online" && !onlineOn) || (block === "local" && !localOn);
      return '<td class="' + planColumnClass(plan) +
        (value.enabled && !deactivated ? "" : " is-off") + '">' +
        (value.boolean
          ? '<span class="pricing-bool ' + (value.enabled ? "is-yes" : "is-no") + '">' + value.text + "</span>"
          : escapeHtml(value.text)) +
        "</td>";
    }).join("");
    return '<tr' + (isFirstLocal ? ' class="pricing-local-start"' : "") + '><th scope="row">' +
      escapeHtml(feature[1]) + "</th>" + cells + "</tr>";
  }
  function render() {
    var grid = $("pricingGrid");
    var status = $("pricingStatus");
    if (!grid || !state.plans.length) {
      if (status) status.textContent = "Plans are unavailable right now. Please check again shortly.";
      return;
    }
    var plans = state.plans;
    var header = plans.map(function (plan) {
      return '<th class="' + planColumnClass(plan) + (plan.highlight ? " is-highlighted" : "") + '">' +
        '<strong>' + escapeHtml(plan.name || plan.id) + "</strong>" +
        '<small>' + escapeHtml(plan.tagline || "") + "</small>" +
        (plan.highlight ? '<span class="pricing-popular">Most Popular</span>' : "") +
      "</th>";
    }).join("");
    var prices = ["monthly", "yearly"].map(function (term) {
      return '<tr class="pricing-price-row"><th scope="row">' + (term === "monthly" ? "Monthly" : "Yearly") + "</th>" +
        plans.map(function (plan) {
          var amount = asFiniteNumber((plan.price || {})[term]);
          return '<td class="' + planColumnClass(plan) + '">' +
            escapeHtml(plan.isFree === true ? "—" : formatAmount(amount, plan.currency)) + "</td>";
        }).join("") + "</tr>";
    }).join("");
    var savings = '<tr class="pricing-save-row"><th scope="row">Save</th>' + plans.map(function (plan) {
      var monthly = asFiniteNumber((plan.price || {}).monthly);
      var yearly = asFiniteNumber((plan.price || {}).yearly);
      var saving = Math.max(0, monthly * 12 - yearly);
      var saveLabel = plan.isFree === true
        ? '<span class="pricing-free">Free</span>'
        : saving > 0
          ? "Save " + escapeHtml(formatAmount(saving, plan.currency))
          : "—";
      return '<td class="' + planColumnClass(plan) + '">' + saveLabel + "</td>";
    }).join("") + "</tr>";
    var rows = ONLINE_FEATURES.map(function (feature) { return renderFeatureRow(feature, plans, false, "online"); }).join("") +
      LOCAL_FEATURES.map(function (feature, index) { return renderFeatureRow(feature, plans, index === 0, "local"); }).join("") +
      SHARED_FEATURES.map(function (feature) { return renderFeatureRow(feature, plans, false, "shared"); }).join("");
    var subscribe = '<tr class="pricing-subscribe-row"><th scope="row">Subscribe</th>' + plans.map(function (plan) {
      return '<td class="' + planColumnClass(plan) + '">' +
        '<a class="btn ' + (plan.highlight ? "btn-primary" : "btn-outline") +
        ' pricing-subscribe" href="/app/billing" title="Subscribe on this Pocket Ledger site">Subscribe</a>' +
      "</td>";
    }).join("") + "</tr>";
    grid.innerHTML =
      '<table class="pricing-table"><thead><tr><th class="pricing-feature-head">Features' +
      '<small>Per company: users, vouchers, attachments, storage and registered devices. Per owner account: company slots.</small>' +
      "</th>" + header + "</tr></thead><tbody>" + prices + savings + rows + subscribe + "</tbody></table>";
    if (status) {
      var rec = window.PLCountry && PLCountry.get && PLCountry.get();
      status.textContent = rec
        ? (rec.name + " runs its own plans and payment on this country site. pocket-ledger.com is not responsible for this subdomain.")
        : "Plans and payment on this site. Country sites bill separately under their own terms — main is not responsible for those subdomains.";
    }
  }
  function setTerm(term) {
    state.term = term === "yearly" ? "yearly" : "monthly";
    document.querySelectorAll("[data-pricing-term]").forEach(function (button) {
      var active = button.getAttribute("data-pricing-term") === state.term;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    render();
  }
  function readCachedPlans() {
    try {
      var cached = JSON.parse(window.localStorage.getItem(PLAN_CACHE_KEY) || "null");
      if (cached && Array.isArray(cached.plans)) return cached.plans;
    } catch (_) { /* cache is optional */ }
    return [];
  }
  function cachePlans(plans) {
    try { window.localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify({ plans: plans })); } catch (_) { /* optional */ }
  }
  function loadPlansOnce() {
    var cachedPlans = planListFromCatalog(readCachedPlans());
    if (cachedPlans.length) {
      state.plans = cachedPlans;
      render();
    }
    return fetch(PLAN_CATALOG_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("catalog " + res.status);
        return res.json();
      })
      .then(function (data) {
        var plans = planListFromCatalog(data && data.plans);
        if (plans.length) {
          state.plans = plans;
          cachePlans(plans);
          render();
        }
      })
      .catch(function () {
        if (!state.plans.length && $("pricingStatus")) {
          $("pricingStatus").textContent = "Could not load live plans. Please try again shortly.";
        }
      });
  }
  document.querySelectorAll("[data-pricing-term]").forEach(function (button) {
    button.addEventListener("click", function () { setTerm(button.getAttribute("data-pricing-term")); });
  });
  void loadPlansOnce();
}());
