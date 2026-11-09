/**
 * Force `import admin from "firebase-admin"` to `import type admin from "firebase-admin"` in files
 * that never call `admin.auth()` / `admin.firestore()` / `admin.initializeApp()` / `admin.storage()`.
 *
 * Usage: node scripts/admin-import-type-only-force.cjs [--dry]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const dry = process.argv.includes("--dry");
const VALUE_CALL = /admin\s*\.\s*(auth|firestore|initializeApp|storage|credential|messaging)\s*\(/;

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
for (const file of walk(ROOT, [])) {
  const rel = path.relative(path.join(ROOT, ".."), file);
  let text = fs.readFileSync(file, "utf8");
  const importRe = /^import admin from "firebase-admin";?\s*$/m;
  if (!importRe.test(text)) continue;
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  if (VALUE_CALL.test(code)) continue;

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
