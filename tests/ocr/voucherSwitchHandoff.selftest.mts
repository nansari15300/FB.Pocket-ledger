/** Voucher-type switch hand-off (ACR): the bill + OCR result survive the switch, a slow lazy form load and a remount. */
import { cancelOcrHandoff, clearOcrSession, OCR_HANDOFF_TTL_MS, OCR_REMOUNT_RESUME_MS, OCR_SWITCH_EVENT, parkOcrSession, requestOcrVoucherSwitch, resumeOcrSession, takeOcrHandoff } from "../../src/modules/ocr/handoff";

// node: minimal window for the switch event
const events: string[] = [];
(globalThis as { window?: unknown }).window = { dispatchEvent: (e: { type: string; detail?: { type?: string } }) => { events.push(`${e.type}:${e.detail?.type}`); return true; } };
if (typeof (globalThis as { CustomEvent?: unknown }).CustomEvent === "undefined") {
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class { type: string; detail: unknown; constructor(t: string, o?: { detail?: unknown }) { this.type = t; this.detail = o?.detail; } };
}

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(c ? "PASS" : "FAIL", m); if (!c) fail++; };
const raw = { text: "TAX INVOICE", lines: [], meanConfidence: 90, pageHeight: 100 };
const files = ["pbatt:bill-1.jpg"];

/* 1. Payment -> Purchase: only the Purchase form takes it */
{
  requestOcrVoucherSwitch("purchase", files, { raw, selectedIds: ["create-party"] });
  ok(events.at(-1) === `${OCR_SWITCH_EVENT}:purchase`, "switch event dispatched for purchase");
  ok(takeOcrHandoff("payment_out") === null, "a Payment form (wrong type) does not take the purchase hand-off");
  const h = takeOcrHandoff("purchase");
  ok(!!h && h.files[0] === files[0] && h.raw === raw, "Purchase form gets the files + OCR text (no 2nd OCR)");
  ok(JSON.stringify(h?.selectedIds) === JSON.stringify(["create-party"]), "ticked suggestions carried");
  ok(takeOcrHandoff("purchase") === null, "one shot: taken once");
}

/* 2. Slow lazy chunk: still there after 20 s (old window was 15 s), gone after the TTL */
{
  requestOcrVoucherSwitch("purchase", files, { raw });
  const t0 = Date.now();
  ok(!!takeOcrHandoff("purchase", t0 + 20_000), "hand-off survives a 20 s form load");
  requestOcrVoucherSwitch("purchase", files, { raw });
  ok(takeOcrHandoff("purchase", Date.now() + OCR_HANDOFF_TTL_MS + 1) === null, "expired after the TTL");
}

/* 3. Bucket: Payment form serving Direct Expense */
{
  requestOcrVoucherSwitch("direct_expense", files, { raw });
  ok(!!takeOcrHandoff("payment_out"), "Direct Expense hand-off taken by the Payment/Direct Expense form");
}

/* 4. Refused switch: requester cancels, nothing left for a later form */
{
  const tk = requestOcrVoucherSwitch("sale", files, { raw });
  cancelOcrHandoff(tk);
  ok(takeOcrHandoff("sale") === null, "cancelled hand-off is not delivered later");
  const a = requestOcrVoucherSwitch("sale", files, { raw });
  const b = requestOcrVoucherSwitch("purchase", files, { raw });
  cancelOcrHandoff(a);
  ok(!!takeOcrHandoff("purchase") && a !== b, "cancelling an old token keeps the newer hand-off");
}

/* 5. Remount of the same form type keeps the session (once, only right after unmount) */
{
  const t = Date.now();
  parkOcrSession("purchase", { files, raw }, t);
  ok(resumeOcrSession("sale", t + 50) === null, "another type does not resume it");
  const r = resumeOcrSession("purchase", t + 100);
  ok(!!r && r.raw === raw && r.files[0] === files[0], "remount within the window gets bill + OCR result back");
  ok(resumeOcrSession("purchase", t + 150) === null, "resume is one shot");
  parkOcrSession("purchase", { files, raw }, t);
  ok(resumeOcrSession("purchase", t + OCR_REMOUNT_RESUME_MS + 1) === null, "a later new voucher does not get a stale bill");
  parkOcrSession("purchase", { files: [], raw }, t);
  ok(resumeOcrSession("purchase", t + 10) === null, "no files -> nothing parked");
  parkOcrSession("purchase", { files, raw }, t);
  clearOcrSession();
  ok(resumeOcrSession("purchase", t + 10) === null, "clearOcrSession drops it");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
