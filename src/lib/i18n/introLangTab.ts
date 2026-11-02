export type IntroTabLang = "en" | "hi" | "ne";

/** Help (i) dialogs that already have en/hi/ne copy — open on Intro language. */
export function introTabLang(code?: string | null): IntroTabLang {
  if (code === "hi" || code === "ne") return code;
  return "en";
}
