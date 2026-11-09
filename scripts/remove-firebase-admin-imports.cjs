/** Remove the last `firebaseAdmin` / `firebase-admin` imports (files deleted). */
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
  const before = t;
  t = t.replace(/^import\s*\{[^}]*\}\s*from\s*["']@\/lib\/firebaseAdmin["'];?\s*\n/m, "");
  t = t.replace(/^import\s+admin\s+from\s+["']firebase-admin["'];?\s*\n/m, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  if (t !== before) {
    fs.writeFileSync(f, t);
    console.log("fixed: " + f);
  }
}
