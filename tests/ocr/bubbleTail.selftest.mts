/** OCR bubble tail visibility helpers. Run: npx tsx tests/ocr/bubbleTail.selftest.mts */
import { MIN_VISIBLE_OCR_TAIL_PX, shouldDrawOcrBubbleTail, stretchOcrTailTip } from "../../src/modules/ocr/bubbleTail";

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want " + JSON.stringify(want)));
};
const ge = (label: string, got: number, min: number) => {
  const ok = got >= min;
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + label + ": got " + JSON.stringify(got) + (ok ? "" : " want >= " + JSON.stringify(min)));
};

eq("draw tail when the field is on screen", shouldDrawOcrBubbleTail(true), true);
eq("no tail when the field is not on screen (OCR-bar fallback)", shouldDrawOcrBubbleTail(false), false);

const far = stretchOcrTailTip({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 1, y: 0 });
eq("long tail left unchanged", far, { tip: { x: 40, y: 0 }, length: 40 });

const short = stretchOcrTailTip({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 1, y: 0 });
ge("short tail is stretched to min visible length", short.length, MIN_VISIBLE_OCR_TAIL_PX);
eq("short tail stretches along the same direction", short.tip, { x: MIN_VISIBLE_OCR_TAIL_PX, y: 0 });

const zero = stretchOcrTailTip({ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 0, y: 1 });
eq("zero-length tail uses fallback direction", zero, { tip: { x: 10, y: 10 + MIN_VISIBLE_OCR_TAIL_PX }, length: MIN_VISIBLE_OCR_TAIL_PX });

console.log(fail ? fail + " FAILURE(S)" : "ALL PASSED (0 failure(s))");
process.exit(fail ? 1 : 0);
