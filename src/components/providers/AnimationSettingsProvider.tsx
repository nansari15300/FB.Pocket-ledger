"use client";

import "@/styles/animation-gate.css";
import * as React from "react";
import { MotionConfig } from "framer-motion";
import {
  AnimationSettingsContext,
  useAnimationSettingsSource,
  type AnimationSettingsState,
} from "@/hooks/useAnimationSettings";

/**
 * Global animation gate (Settings → Animation → Row Animation).
 * - Settings ek hi jagah load (users doc + localStorage + BroadcastChannel); `useAnimationSettings()` context se padhta hai.
 * - Row animation off (ya settings load ho rahi) → framer `MotionConfig reducedMotion="always"` (transform/layout animations off).
 * - `<html data-pl-animations="on|off">` → `src/styles/animation-gate.css` CSS animations/transitions band karta hai.
 * - On par `reducedMotion="never"` = pehle jaisa behaviour (OS reduced-motion default approve nahi hua).
 */
export function AnimationSettingsProvider({ children }: { children: React.ReactNode }) {
  const outer = React.useContext(AnimationSettingsContext);
  const own = useAnimationSettingsSource({ disabled: outer !== null });
  const source = outer ?? own;

  const value = React.useMemo<AnimationSettingsState>(
    () => ({
      settings: source.settings,
      loading: source.loading,
      useLocalAnimationOnly: source.useLocalAnimationOnly,
    }),
    [source.settings, source.loading, source.useLocalAnimationOnly]
  );

  const animationsOn = !value.loading && value.settings?.rows?.enabled === true;

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.plAnimations = animationsOn ? "on" : "off";
  }, [animationsOn]);

  React.useEffect(() => {
    return () => {
      if (typeof document === "undefined") return;
      delete document.documentElement.dataset.plAnimations;
    };
  }, []);

  return (
    <AnimationSettingsContext.Provider value={value}>
      <MotionConfig reducedMotion={animationsOn ? "never" : "always"}>{children}</MotionConfig>
    </AnimationSettingsContext.Provider>
  );
}