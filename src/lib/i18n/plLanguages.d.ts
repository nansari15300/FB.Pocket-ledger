declare const PL_LANGUAGES: {
  list: [code: string, native: string, english: string][];
  rtl: string[];
  codes: string[];
  has(code: string): boolean;
  isRtl(code: string): boolean;
  name(code: string, ui?: string): string;
  label(code: string, ui?: string): string;
};
export default PL_LANGUAGES;
