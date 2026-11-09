/**
 * The billing helpers keep their `admin.firestore.*` types (the store is a Firestore-shaped PB
 * adapter), but the values are now the local Firebase-free `Timestamp` / `FieldPath`. Add the
 * explicit casts right at those call sites.
 *
 * Usage: node scripts/cast-admin-firestore-types.cjs [--dry]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const dry = process.argv.includes("--dry");

const EDITS = [
  // orderBy(FieldPath.documentId()) on a variable typed as admin.firestore.Query
  {
    files: [
      "src/app/api/company/daybook-daily-summary/route.ts",
      "src/lib/fyPagination/server/paginateCompanyVouchersAdmin.ts",
      "src/lib/server/adminRecycleBinDeleteCompany.ts",
    ],
    find: "FieldPath.documentId()",
    replace: "FieldPath.documentId() as unknown as admin.firestore.FieldPath",
  },
  // Timestamp assigned to a variable typed as admin.firestore.Timestamp | null
  {
    files: ["src/lib/payments/stripeCheckoutFulfill.ts"],
    find: "Timestamp.fromMillis(planExpiryMs)",
    replace: "Timestamp.fromMillis(planExpiryMs) as unknown as admin.firestore.Timestamp",
  },
];

let changed = 0;
for (const edit of EDITS) {
  for (const rel of edit.files) {
    const file = path.join(ROOT, "..", rel);
    if (!fs.existsSync(file)) {
      console.log(`missing: ${rel}`);
      continue;
    }
    let text = fs.readFileSync(file, "utf8");
    if (!text.includes(edit.find)) {
      console.log(`skip (pattern absent): ${rel}`);
      continue;
    }
    if (text.includes(edit.replace)) {
      console.log(`skip (already cast): ${rel}`);
      continue;
    }
    if (dry) {
      console.log(`would cast: ${rel}`);
    } else {
      text = text.split(edit.find).join(edit.replace);
      fs.writeFileSync(file, text);
      console.log(`cast: ${rel}`);
    }
    changed++;
  }
}
console.log(`${dry ? "files needing fix" : "files fixed"}: ${changed}`);
