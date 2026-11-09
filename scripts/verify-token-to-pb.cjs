/**
 * Replace Firebase ID-token verification with Pocket Ledger Server session verification.
 *
 * Every route here follows one of two shapes:
 *   A) `getAdminDb(); const decoded = await admin.auth().verifyIdToken(token);`
 *   B) `let decoded: admin.auth.DecodedIdToken; ... decoded = await admin.auth().verifyIdToken(token);`
 *
 * The replacement keeps the variable name `decoded` (routes read `decoded.uid` / `decoded.email`)
 * and verifies the `plpb.` bearer against the server instead.
 *
 * Usage: node scripts/verify-token-to-pb.cjs [--dry]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");const dry = process.argv.includes("--dry");

const FILES = [
  "app/api/admin/company/ledger-snapshot/route.ts",
  "app/api/admin/company/settings/accounting/route.ts",
  "app/api/admin/company/vouchers/[voucherId]/route.ts",
  "app/api/admin/company/route.ts",
  "app/api/admin/company-plan-grant-mirror/route.ts",
  "app/api/admin/download-stats/route.ts",
  "app/api/admin/recycle-bin/delete-company/route.ts",
  "app/api/admin/subscription-payments/route.ts",
  "app/api/company/dashboard-financial-summary/route.ts",
  "app/api/company/daybook-daily-summary/route.ts",
  "app/api/company/fy-closing-snapshot/route.ts",
  "app/api/company/opening-snapshots-invalidate/route.ts",
  "app/api/company/recycle-bin-finalize/route.ts",
  "lib/adminPanelCompany/mirrorSubscriptionsPost.ts",
];

let changed = 0;
let missed = [];

for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    missed.push(`${rel} (missing)`);
    continue;
  }
  let text = fs.readFileSync(file, "utf8");
  const before = text;

  // 1) `admin.auth().verifyIdToken(...)` -> PB verification (+ keep the `decoded` name).
  text = text.replace(
    /const decoded = await admin\.auth\(\)\.verifyIdToken\(([^)]*)\);/g,
    (_, arg) =>
      `const decoded = await verifyCompanyApiCallerByToken(${arg});`
  );
  text = text.replace(
    /decoded = await admin\.auth\(\)\.verifyIdToken\(([^)]*)\);/g,
    (_, arg) => `decoded = await verifyCompanyApiCallerByToken(${arg});`
  );

  // 2) A stray `getAdminDb();` call (admin-configured gate) goes away with the Admin SDK.
  text = text.replace(/^\s*getAdminDb\(\);\s*$/gm, "");

  // 3) Type annotation `let decoded: admin.auth.DecodedIdToken;` -> local caller type.
  text = text.replace(/admin\.auth\.DecodedIdToken/g, "CompanyApiCaller");

  // 4) Import the helper when the replacement was used.
  if (text.includes("verifyCompanyApiCallerByToken(") || text.includes("CompanyApiCaller")) {
    if (!text.includes('from "@/lib/server/companyApiCaller"')) {
      const stmt = 'import { verifyCompanyApiCallerByToken, type CompanyApiCaller } from "@/lib/server/companyApiCaller";';
      const importRe = /^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm;
      let lastEnd = -1;
      let m;
      while ((m = importRe.exec(text)) !== null) lastEnd = m.index + m[0].length;
      text = lastEnd >= 0 ? text.slice(0, lastEnd) + "\n" + stmt + text.slice(lastEnd) : stmt + "\n" + text;
    }
  }

  // 5) Drop imports that no longer resolve.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const stillUsesAdmin = /(^|[^.\w$])admin\s*[.(]/.test(code.replace(/^import[^\n]*\n/gm, ""));
  if (!stillUsesAdmin) {
    text = text.replace(/^import (type )?admin from "firebase-admin";?\s*$/m, "");
  }
  if (!/getAdminDb\s*\(/.test(code.replace(/^import[^\n]*\n/gm, ""))) {
    text = text.replace(
      /^import\s*\{[^}]*getAdminDb[^}]*\}\s*from\s*["'][^"']*firebaseAdmin["'];?\s*$/m,
      ""
    );
  }
  text = text.replace(/^\s*import\s*\{\s*\}\s*from\s*["'][^"']*firebaseAdmin["'];?\s*$/m, "");

  if (text === before) {
    missed.push(`${rel} (no change)`);
    continue;
  }
  if (dry) {
    console.log(`would fix: ${rel}`);
  } else {
    fs.writeFileSync(file, text);
    console.log(`fixed: ${rel}`);
  }
  changed++;
}

missed.forEach((m) => console.log(`skip: ${m}`));
console.log(`${dry ? "files needing fix" : "files fixed"}: ${changed}`);
