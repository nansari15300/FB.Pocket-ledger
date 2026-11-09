/**
 * Replace `admin.firestore.FieldValue.*` sentinels with the local, Firebase-free helpers.
 *
 * - rewrites `admin.firestore.FieldValue.serverTimestamp()` -> `serverTimestamp()`
 * - rewrites `admin.firestore.FieldValue.delete()`          -> `deleteField()`
 * - rewrites `admin.firestore.FieldValue.increment(x)`      -> `increment(x)`
 * - adds `import { ... } from "@/lib/server/pbBilling/fieldValue";` when not already imported
 * - leaves `import type admin from "firebase-admin"` alone when still needed for types
 * - drops `import admin from "firebase-admin"` when `admin.` no longer appears as a value
 *
 * Usage: node scripts/drop-admin-fieldvalue.cjs [--dry]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const dry = process.argv.includes("--dry");
const FIELD_VALUE_IMPORT = "@/lib/server/pbBilling/fieldValue";

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

let changed = 0;
const report = [];

for (const file of walk(ROOT, [])) {
  const rel = path.relative(path.join(ROOT, ".."), file);
  if (rel.includes("pbBilling\\fieldValue")) continue;
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes("admin.firestore.FieldValue")) continue;

  const used = new Set();
  let next = text
    .replace(/admin\.firestore\.FieldValue\.serverTimestamp\(\s*\)/g, () => {
      used.add("serverTimestamp");
      return "serverTimestamp()";
    })
    .replace(/admin\.firestore\.FieldValue\.delete\(\s*\)/g, () => {
      used.add("deleteField");
      return "deleteField()";
    })
    .replace(/admin\.firestore\.FieldValue\.increment\(/g, () => {
      used.add("increment");
      return "increment(";
    })
    .replace(/admin\.firestore\.FieldValue\.arrayUnion\(/g, () => {
      used.add("arrayUnion");
      return "arrayUnion(";
    })
    .replace(/admin\.firestore\.FieldValue\.arrayRemove\(/g, () => {
      used.add("arrayRemove");
      return "arrayRemove(";
    });

  if (!next.includes(FIELD_VALUE_IMPORT)) {
    const names = [...used].sort().join(", ");
    const stmt = `import { ${names} } from "${FIELD_VALUE_IMPORT}";\n`;
    // Insert after the last top-level import so relative grouping stays readable.
    const importRe = /^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm;
    let lastEnd = -1;
    let m;
    while ((m = importRe.exec(next)) !== null) lastEnd = m.index + m[0].length;
    next = lastEnd >= 0 ? next.slice(0, lastEnd) + "\n" + stmt + next.slice(lastEnd) : stmt + next;
  }

  // `import admin from "firebase-admin"` only survives if `admin.` is still used as a value.
  const usesAdminValue = /(^|[^.\w])admin\s*\./.test(next.replace(/^\s*\/\/.*$/gm, ""));
  if (!usesAdminValue && /^import admin from "firebase-admin";?\s*$/m.test(next)) {
    next = next.replace(/^import admin from "firebase-admin";?\s*$/m, "");
    // Collapse the blank line left behind.
    next = next.replace(/\n{3,}/g, "\n\n");
  }

  text = next;
  if (dry) {
    report.push(`would fix: ${rel} (${[...used].join(", ")})`);
  } else {
    fs.writeFileSync(file, text);
    report.push(`fixed: ${rel} (${[...used].join(", ")})`);
  }
  changed++;
}

report.sort().forEach((l) => console.log(l));
console.log(`${dry ? "files needing fix" : "files fixed"}: ${changed}`);
