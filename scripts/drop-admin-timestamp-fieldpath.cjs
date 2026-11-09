/**
 * Rewrite the remaining `admin.firestore.Timestamp` / `admin.firestore.FieldPath` value uses to the
 * local Firebase-free equivalents and fix their imports.
 *
 * Usage: node scripts/drop-admin-timestamp-fieldpath.cjs [--dry]
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
for (const file of walk(ROOT, [])) {
  const rel = path.relative(path.join(ROOT, ".."), file);
  if (rel.includes("pbBilling\\fieldValue")) continue;
  let text = fs.readFileSync(file, "utf8");
  if (!/admin\.firestore\.(Timestamp|FieldPath)/.test(text)) continue;

  const used = new Set();
  let next = text
    .replace(/admin\.firestore\.Timestamp\.fromMillis\(/g, () => {
      used.add("Timestamp");
      return "Timestamp.fromMillis(";
    })
    .replace(/admin\.firestore\.Timestamp\.fromDate\(/g, () => {
      used.add("Timestamp");
      return "Timestamp.fromDate(";
    })
    .replace(/admin\.firestore\.Timestamp\.now\(\)/g, () => {
      used.add("Timestamp");
      return "Timestamp.now()";
    })
    .replace(/new\s+admin\.firestore\.Timestamp\(/g, () => {
      used.add("Timestamp");
      return "new Timestamp(";
    })
    .replace(/admin\.firestore\.FieldPath\.documentId\(\)/g, () => {
      used.add("FieldPath");
      return "FieldPath.documentId()";
    });

  if (!used.size) continue;

  // Merge into an existing import from the same module, or add a new one after the last import.
  const existing = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${FIELD_VALUE_IMPORT.replace(/\//g, "\\/")}["'];?`
  );
  const m = next.match(existing);
  if (m) {
    const names = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const n of used) if (!names.includes(n)) names.push(n);
    names.sort((a, b) => a.localeCompare(b));
    next = next.replace(existing, `import { ${names.join(", ")} } from "${FIELD_VALUE_IMPORT}";`);
  } else {
    const names = [...used].sort((a, b) => a.localeCompare(b)).join(", ");
    const stmt = `import { ${names} } from "${FIELD_VALUE_IMPORT}";`;
    const importRe = /^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm;
    let lastEnd = -1;
    let im;
    while ((im = importRe.exec(next)) !== null) lastEnd = im.index + im[0].length;
    next = lastEnd >= 0 ? next.slice(0, lastEnd) + "\n" + stmt + next.slice(lastEnd) : stmt + "\n" + next;
  }

  // Drop a now-unused value import of `admin`.
  const code = next
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  if (!/(^|[^.\w$])admin\s*\./.test(code)) {
    next = next.replace(/^import (type )?admin from "firebase-admin";?\s*$/m, "");
    next = next.replace(/\n{3,}/g, "\n\n");
  }

  if (dry) {
    console.log(`would fix: ${rel} (${[...used].join(", ")})`);
  } else {
    fs.writeFileSync(file, next);
    console.log(`fixed: ${rel} (${[...used].join(", ")})`);
  }
  changed++;
}
console.log(`${dry ? "files needing fix" : "files fixed"}: ${changed}`);
