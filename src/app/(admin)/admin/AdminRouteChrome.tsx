"use client";

import { useEffect } from "react";

/** Admin routes par `html` class — portaled Select/Dialog bhi `--border`/`--input` inherit karein (sirf is segment mount/unmount). */
const ADMIN_HTML_CLASS = "pl-admin-route";

export function AdminRouteChrome() {
  useEffect(() => {
    document.documentElement.classList.add(ADMIN_HTML_CLASS);
    return () => {
      document.documentElement.classList.remove(ADMIN_HTML_CLASS);
    };
  }, []);
  return null;
}
