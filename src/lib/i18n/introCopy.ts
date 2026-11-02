/** Pick the intro-language string. Hand hi/ne first (server jaisa); else English. */
export function pickIntroCopy(
  introLang: string,
  copies: { en: string; hi?: string; ne?: string }
): string {
  if (introLang === "ne" && copies.ne) return copies.ne;
  if (introLang === "hi" && copies.hi) return copies.hi;
  return copies.en;
}
