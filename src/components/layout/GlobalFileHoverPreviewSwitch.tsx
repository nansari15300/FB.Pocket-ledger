"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { AppFreshInfoButton } from "@/components/ui/AppFreshInfoButton";
import {
  useFileHoverPreview,
  type FilePreviewMode,
} from "@/contexts/FileHoverPreviewContext";
import {
  SWITCH_ANIM_MS,
  SWITCH_KNOB_W_PX,
  SWITCH_KNOB_LEFT_OFF,
  SWITCH_KNOB_LEFT_MID,
  SWITCH_KNOB_LEFT_ON,
  HEADER_FILE_PREVIEW_SWITCH_TRACK_H_PX,
  filePreviewModeTransitionMotion,
  switchKnobMotionClass,
  type SwitchKnobMotion,
} from "@/lib/switchMotion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePlI18nOptional } from "@/contexts/PlI18nContext";
import { pickIntroCopy } from "@/lib/i18n/introCopy";

const MODES: FilePreviewMode[] = ["off", "hover", "click"];

const MODE_LABEL: Record<FilePreviewMode, string> = {
  off: "Off",
  hover: "Hover preview",
  click: "Click preview",
};

/** Header track — compact ke baad +30% (~104/116px); teen zone + i icon ke liye */
const TRACK_WIDTH_CLASS = "w-[6.5rem] min-w-[6.5rem] shrink-0 sm:w-[10.25rem] sm:min-w-[7.25rem]";

const MODE_TITLE: Record<FilePreviewMode, string> = {
  off: "Off",
  hover: "Hover preview",
  click: "Click preview",
};

const MODE_BODY: Record<FilePreviewMode, { en: string; hi: string; ne: string }> = {
  off: {
    en: "File preview is off. The profile plan menu opens only when you click the avatar — not on hover.",
    hi: "फ़ाइल पूर्वावलोकन बंद है। प्रोफ़ाइल योजना मेनू केवल अवतार पर क्लिक करने से खुलेगा — होवर पर नहीं।",
    ne: "फाइल पूर्वावलोकन बन्द छ। प्रोफाइल योजना मेनु अवतारमा क्लिक गर्दा मात्र खुल्छ — होभरमा होइन।",
  },
  hover: {
    en: "Hovering an attachment thumbnail opens the preview. Hovering the profile avatar also opens the plan menu.",
    hi: "संलग्नक थंबनेल पर होवर करने से पूर्वावलोकन खुलेगा। प्रोफ़ाइल अवतार पर होवर से योजना मेनू भी खुलेगा।",
    ne: "संलग्नक थम्बनेलमा होभर गर्दा पूर्वावलोकन खुल्छ। प्रोफाइल अवतारमा होभर गर्दा योजना मेनु पनि खुल्छ।",
  },
  click: {
    en: "Click or tap an attachment to open the preview. The profile plan menu opens only on avatar click, not on hover.",
    hi: "संलग्नक पर क्लिक/टैप से पूर्वावलोकन खुलेगा। प्रोफ़ाइल योजना मेनू केवल अवतार क्लिक से — होवर पर नहीं।",
    ne: "संलग्नकमा क्लिक वा ट्याप गर्दा पूर्वावलोकन खुल्छ। प्रोफाइल योजना मेनु अवतारमा क्लिक गर्दा मात्र खुल्छ, होभरमा होइन।",
  },
};

const MENU_INTRO = {
  heading: {
    en: "Preview & profile menu",
    hi: "पूर्वावलोकन और प्रोफ़ाइल मेनू",
    ne: "पूर्वावलोकन र प्रोफाइल मेनु",
  },
  current: {
    en: "Current:",
    hi: "अभी:",
    ne: "हाल:",
  },
  footer: {
    en: "Tap a zone on the switch: left Off, middle Hover preview, right Click preview.",
    hi: "स्विच के बाएँ Off, बीच Hover preview, दाएँ Click preview।",
    ne: "स्विचको बायाँ Off, बीच Hover preview, दायाँ Click preview।",
  },
  active: {
    en: "(active)",
    hi: "(सक्रिय)",
    ne: "(सक्रिय)",
  },
};

/** Resting knob position — motion ke baad */
function knobLeftForMode(mode: FilePreviewMode): string {
  if (mode === "off") return SWITCH_KNOB_LEFT_OFF;
  if (mode === "hover") return SWITCH_KNOB_LEFT_MID;
  return SWITCH_KNOB_LEFT_ON;
}

/** Toggle left/off/hover → i right; toggle right (click) → i left */
function infoIconOnRight(mode: FilePreviewMode): boolean {
  return mode !== "click";
}

/**
 * Header: 3-step file preview switch — chhota track, andar i icon (opposite side), popup me detail.
 */
export function GlobalFileHoverPreviewSwitch({ className }: { className?: string }) {
  const i18n = usePlI18nOptional();
  const intro = i18n?.intro || "en";
  const { mode, setMode } = useFileHoverPreview();
  const [knobMotion, setKnobMotion] = React.useState<SwitchKnobMotion | null>(null);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const motionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMotionTimer = React.useCallback(() => {
    if (motionTimerRef.current != null) {
      clearTimeout(motionTimerRef.current);
      motionTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => () => clearMotionTimer(), [clearMotionTimer]);

  const pickModeFromClick = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const idx = Math.min(2, Math.max(0, Math.floor(x / (rect.width / 3))));
      return MODES[idx]!;
    },
    []
  );

  const handleTrackClick = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const next = pickModeFromClick(e);
      if (next === mode) return;
      const fromIdx = MODES.indexOf(mode);
      const toIdx = MODES.indexOf(next);
      const motion = filePreviewModeTransitionMotion(fromIdx, toIdx);
      setKnobMotion(motion);
      setMode(next);
      clearMotionTimer();
      motionTimerRef.current = setTimeout(() => {
        setKnobMotion(null);
        motionTimerRef.current = null;
      }, SWITCH_ANIM_MS);
    },
    [mode, pickModeFromClick, setMode, clearMotionTimer]
  );

  const knobTowardActive =
    knobMotion !== null &&
    knobMotion !== "file-hover-switch-off" &&
    knobMotion !== "file-hover-switch-to-off-from-mid";

  const infoRight = infoIconOnRight(mode);

  return (
    <div
      className={cn("inline-flex shrink-0 items-center", className)}
      data-theme-header="global-file-preview"
    >
      <div
        className={cn("relative block leading-none", TRACK_WIDTH_CLASS)}
        style={{ height: HEADER_FILE_PREVIEW_SWITCH_TRACK_H_PX }}
      >
        <button
          type="button"
          role="radiogroup"
          aria-label="Preview & profile menu mode"
          title={`${MODE_LABEL[mode]} — tap a zone to change`}
          onClick={handleTrackClick}
          data-pl-header-preview-switch
          data-preview-mode={mode}
          className={cn(
            "relative block h-full w-full cursor-pointer rounded-full border shadow-sm outline-none transition-colors",
            "border-blue-300 bg-green-50",
            mode !== "off" && "border-blue-400 bg-green-100",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "dark:border-blue-500 dark:bg-green-950/35",
            mode !== "off" && "dark:border-blue-400 dark:bg-green-900/45"
          )}
        >
          {MODES.map((m) => (
            <span
              key={m}
              className="sr-only"
              role="radio"
              aria-checked={mode === m}
              aria-label={MODE_LABEL[m]}
            />
          ))}
          <span
            className={cn(
              "pointer-events-none absolute top-1/2 z-[1] h-[calc(100%-6px)] -translate-y-1/2 rounded-full shadow-sm",
              knobMotion === null && mode === "off" && "bg-neutral-500 dark:bg-neutral-400",
              knobMotion === null && mode !== "off" && "bg-green-400",
              knobMotion !== null &&
                (knobTowardActive ? "bg-green-400" : "bg-neutral-500 dark:bg-neutral-400"),
              switchKnobMotionClass(knobMotion)
            )}
            style={
              knobMotion === null
                ? {
                    left: knobLeftForMode(mode),
                    width: SWITCH_KNOB_W_PX,
                  }
                : undefined
            }
            aria-hidden
          />
          <span className="pointer-events-none absolute inset-y-1 left-1/3 w-px bg-black/10" aria-hidden />
          <span className="pointer-events-none absolute inset-y-1 left-2/3 w-px bg-black/10" aria-hidden />
        </button>

        {/* i icon — track height ke exact vertical center */}
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 z-[2] flex items-center",
            infoRight ? "right-[2px]" : "left-[2px]"
          )}
        >
          <Popover open={infoOpen} onOpenChange={setInfoOpen}>
            <PopoverTrigger asChild>
              <AppFreshInfoButton
                size="embedded"
                data-pl-header-preview-info=""
                className="pointer-events-auto shadow-none"
                aria-label="File preview modes — details"
                title="File preview help"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              />
            </PopoverTrigger>
          <PopoverContent
            align="end"
            side="bottom"
            sideOffset={8}
            className="z-[200] w-[min(20rem,calc(100vw-1.5rem))] p-0"
            data-pl-intro=""
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="border-b px-3 py-2">
              <p className="text-sm font-semibold leading-tight">{pickIntroCopy(intro, MENU_INTRO.heading)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground" data-pl-intro="">
                {pickIntroCopy(intro, MENU_INTRO.current)}{" "}
                <span className="font-medium text-foreground">{MODE_LABEL[mode]}</span>
              </p>
            </div>
            <ul className="space-y-0 divide-y text-sm">
              {MODES.map((m) => (
                <li
                  key={m}
                  className={cn(
                    "px-3 py-2.5",
                    mode === m && "bg-green-50/80 dark:bg-green-950/20"
                  )}
                >
                  <p
                    className={cn(
                      "font-semibold leading-tight",
                      mode === m ? "text-green-800 dark:text-green-300" : "text-foreground"
                    )}
                  >
                    {MODE_TITLE[m]}
                    {mode === m ? (
                      <span className="ml-1.5 text-[10px] font-normal text-green-700">
                        {pickIntroCopy(intro, MENU_INTRO.active)}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground" data-pl-intro="">
                    {pickIntroCopy(intro, MODE_BODY[m])}
                  </p>
                </li>
              ))}
            </ul>
            <p className="border-t px-3 py-2 text-[11px] leading-snug text-muted-foreground" data-pl-intro="">
              {pickIntroCopy(intro, MENU_INTRO.footer)}
            </p>
          </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}

