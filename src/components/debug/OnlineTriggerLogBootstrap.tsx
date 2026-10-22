"use client";

import { useEffect } from "react";
import { installOnlineTriggerLog } from "@/lib/onlineTriggerLog";

if (typeof window !== "undefined") {
  installOnlineTriggerLog();
}

export function OnlineTriggerLogBootstrap() {
  useEffect(() => {
    installOnlineTriggerLog();
  }, []);
  return null;
}
