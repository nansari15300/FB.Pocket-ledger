(function () {
  "use strict";

  /**
   * Public website: Features / Videos / Pricing used to be sections on /home/.
   * Old links like /home/#pricing now open their own page (keeps ?c=.. country query).
   * Loaded in the <head> of /home/ so the jump happens before the page paints.
   */
  var PAGES = { features: "/features/", videos: "/videos/", pricing: "/pricing/" };
  var hash = String(window.location.hash || "").replace(/^#/, "").toLowerCase();
  var path = window.location.pathname || "/";
  if (PAGES[hash] && /^\/home(\/|\/index\.html)?$/.test(path)) {
    window.location.replace(PAGES[hash] + (window.location.search || ""));
  }
}());
