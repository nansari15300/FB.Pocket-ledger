/**
 * Guards the detector used before PocketBase outbox file upload.
 * "local:<uuid>" must match; the exact value "local:" is not how refs are stored.
 */
function payloadHasLocalRef(data: Record<string, unknown>): boolean {
  try {
    if (JSON.stringify(data).includes('"local:')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  payloadHasLocalRef({ fileUrls: ["local:9fed3910-74c0-4357-be15-b38092090b58"] }),
  "must detect local:<uuid> in fileUrls"
);
assert(
  payloadHasLocalRef({ fileUrl: "local:abc" }),
  "must detect local: on a string field"
);
assert(
  !payloadHasLocalRef({ fileUrls: ["pbatt:rid/file.jpg"], narration: "local office" }),
  "must not treat narration 'local office' as a ref"
);
assert(
  !payloadHasLocalRef({ fileUrls: [] }),
  "empty fileUrls is not a local ref"
);

// The historical bug: looking for the exact JSON token "local:" (quote after colon).
const real = JSON.stringify({ fileUrls: ["local:9fed3910-74c0-4357-be15-b38092090b58"] });
assert(real.includes('"local:'), 'stringify contains "local:');
assert(!real.includes('"local:"'), 'stringify does NOT contain "local:" — that old check was always false');

console.log("voucherLocalRefDetect.selftest: ok");
