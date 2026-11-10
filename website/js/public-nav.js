(function () {
  "use strict";

  /**
   * Public website: Videos / Pricing used to be sections on /home/ (Features is part of Home again).
   * Old links like /home/#pricing now open their own page (keeps ?c=.. country query).
   * Loaded in the <head> of /home/ so the jump happens before the page paints.
   */
  var PAGES = { videos: "/videos/", pricing: "/pricing/" };
  var hash = String(window.location.hash || "").replace(/^#/, "").toLowerCase();
  var path = window.location.pathname || "/";
  if (PAGES[hash] && /^\/home(\/|\/index\.html)?$/.test(path)) {
    window.location.replace(PAGES[hash] + (window.location.search || ""));
  }
}());
