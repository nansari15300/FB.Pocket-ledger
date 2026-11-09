/**
 * Final pass of the Firebase Admin removal: `getAdminDb()` -> `serverDb()` (Pocket Ledger Server)
 * and restore the `import type admin from "firebase-admin"` lines the previous script over-trimmed
 * (the types are still used in annotations, they cost nothing at runtime).
 */
const fs = require("fs");

const FILES = [
  "src/app/api/admin/company/ledger-snapshot/route.ts",
  "src/app/api/admin/company/settings/accounting/route.ts",
  "src/app/api/admin/company/vouchers/[voucherId]/route.ts",
  "src/app/api/admin/company/route.ts",
  "src/app/api/admin/company-plan-grant-mirror/route.ts",
  "src/app/api/admin/download-stats/route.ts",
  "src/app/api/admin/subscription-payments/route.ts",
  "src/app/api/company/dashboard-financial-summary/route.ts",
  "src/app/api/company/daybook-daily-summary/route.ts",
  "src/app/api/company/fy-closing-snapshot/route.ts",
  "src/app/api/company/opening-snapshots-invalidate/route.ts",
  "src/lib/adminPanelCompany/mirrorSubscriptionsPost.ts",
];

for (const f of FILES) {
  let t = fs.readFileSync(f, "utf8");

  if (t.includes("getAdminDb(")) {
    t = t.replace(/getAdminDb\(\)/g, "serverDb()");
    if (!t.includes('from "@/lib/server/appDb"')) {
      const stmt = 'import { serverDb } from "@/lib/server/appDb";';
      const importRe = /^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm;
      let lastEnd = -1;
      let m;
      while ((m = importRe.exec(t)) !== null) lastEnd = m.index + m[0].length;
      t = lastEnd >= 0 ? t.slice(0, lastEnd) + "\n" + stmt + t.slice(lastEnd) : stmt + "\n" + t;
    }
  }

  // Type annotations still say `admin.firestore.*` — put the (type-only) import back.
  const body = t.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");
  if (/(^|[^.\w$])admin\s*\./.test(body) && !/^import type admin from "firebase-admin";?$/m.test(t)) {
    const stmt = 'import type admin from "firebase-admin";';
    const importRe = /(^import\s+[^\n]*?from\s+["'][^"']+["'];?\s*\n)/gm;
    const m = importRe.exec(t);
    t = m ? t.slice(0, m.index + m[0].length) + stmt + "\n" + t.slice(m.index + m[0].length) : stmt + "\n" + t;
  }

  t = t.replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(f, t);
  console.log("fixed: " + f);
}
