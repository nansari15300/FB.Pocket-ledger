/** English / Hindi / Nepali copy for the "wrong PC" runner Start dialog. */

export const RUNNER_WRONG_PC_INTRO = {
  en: "You are on the wrong PC. The runner only runs on the selected PC, and the PC {name} is selected now. If you want to run the runner on this PC, go to Settings and set this PC as the admin runner, then press Start.",
  hi: "आप गलत PC पर हैं। Runner सिर्फ़ चुने हुए PC पर चलता है, और अभी PC {name} चुना हुआ है। इस PC पर runner चलाना है तो Settings में जाकर इस PC को admin runner बनाइए, फिर Start दबाइए।",
  ne: "तपाईं गलत PC मा हुनुहुन्छ। Runner चयन गरिएको PC मा मात्र चल्छ, र अहिले PC {name} चयन गरिएको छ। यो PC मा runner चलाउन चाहनुहुन्छ भने Settings मा गई यो PC लाई admin runner बनाउनुहोस्, अनि Start थिच्नुहोस्।",
} as const;

export const RUNNER_WRONG_PC_TITLE = {
  en: "Wrong PC",
  hi: "गलत PC",
  ne: "गलत PC",
} as const;

export const RUNNER_WRONG_PC_OK = {
  en: "OK",
  hi: "ठीक है",
  ne: "ठिक छ",
} as const;

export const RUNNER_WRONG_PC_UNNAMED = {
  en: "selected PC",
  hi: "चुना हुआ PC",
  ne: "चयन गरिएको PC",
} as const;

function langOf(introLang?: string | null): "en" | "hi" | "ne" {
  if (introLang === "hi" || introLang === "ne") return introLang;
  return "en";
}

export function runnerWrongPcDeviceLabel(deviceLabel?: string | null, deviceId?: string | null): string {
  const label = String(deviceLabel || "").trim();
  if (label) return label;
  return String(deviceId || "").trim();
}

export function runnerWrongPcIntro(introLang?: string | null, deviceName?: string | null): string {
  const lang = langOf(introLang);
  const name = String(deviceName || "").trim() || RUNNER_WRONG_PC_UNNAMED[lang];
  return RUNNER_WRONG_PC_INTRO[lang].split("{name}").join(name);
}

export function runnerWrongPcTitle(introLang?: string | null): string {
  return RUNNER_WRONG_PC_TITLE[langOf(introLang)];
}

export function runnerWrongPcOk(introLang?: string | null): string {
  return RUNNER_WRONG_PC_OK[langOf(introLang)];
}
