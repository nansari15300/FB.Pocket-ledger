/**
 * Turn `import admin from "firebase-admin"` into a type-only import when `admin` is only used in
 * type positions (`admin.firestore.Firestore`, `admin.firestore.DocumentReference`, ...).
 *
 * `pbBillingDb()` returns a Firestore-shaped object, so the billing helpers keep their types; they
 * just must not pull the Admin SDK into the server bundle.
 *
 * Usage: node scripts/admin-import-type-only.cjs [--dry]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const dry = process.argv.includes("--dry");

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments/strings so only real code is inspected. */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

let changed = 0;
for (const file of walk(ROOT, [])) {
  const rel = path.relative(path.join(ROOT, ".."), file);
  let text = fs.readFileSync(file, "utf8");
  const importRe = /^import admin from "firebase-admin";?\s*$/m;
  if (!importRe.test(text)) continue;
  if (/^import type admin from "firebase-admin";?\s*$/m.test(text)) continue;

  const code = codeOnly(text);
  // Any `admin.x` occurrence is a type position only if every one sits in a `: type` / `as type`
  // or a generic argument. Simpler and safe: `admin.` never appears inside a call/assignment.
  const valueUse = /(^|[^.\w$])admin\s*\.\s*(firestore|auth|storage|initializeApp|credential)\s*\.?\s*(?!Firestore|Timestamp|DocumentReference|FieldValue|Query|CollectionReference|FieldPath|DocumentSnapshot|QuerySnapshot|WriteBatch|Transaction)/.test(
    code
  );
  if (valueUse) continue;

  if (dry) {
    console.log(`would convert: ${rel}`);
  } else {
    text = text.replace(importRe, 'import type admin from "firebase-admin";\n');
    fs.writeFileSync(file, text);
    console.log(`converted: ${rel}`);
  }
  changed++;
}
console.log(`${dry ? "files needing fix" : "files fixed"}: ${changed}`);
