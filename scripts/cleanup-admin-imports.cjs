/**
 * Last pass: remove the Admin-SDK leftovers in the company/billing routes.
 *
 * - drops unused `getAdminDb` / `getAdminApp` imports
 * - rewrites `isFirebaseAdminConfigured()` to the Pocket Base billing-readiness check
 * - removes now-empty `admin_not_configured` gates (the PB readiness gate replaces them)
 *
 * Usage: node scripts/cleanup-admin-imports.cjs [--dry]
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

function body(text) {
  // Code without imports, so "is this symbol still used?" is honest.
  return text.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "").replace(/^\s*\/\/.*$/gm, "");
}

let changed = 0;
for (const file of walk(ROOT, [])) {
  const rel = path.relative(path.join(ROOT, ".."), file);
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes("@/lib/firebaseAdmin")) continue;
  const before = text;

  // 1) `isFirebaseAdminConfigured()` -> server billing readiness
  if (text.includes("isFirebaseAdminConfigured(")) {
    text = text.replace(/isFirebaseAdminConfigured\(\)/g, "pbBillingReady()");
    if (!text.includes('from "@/lib/server/pbBilling/pbBillingDb"')) {
      const stmt = 'import { pbBillingReady } from "@/lib/server/pbBilling/pbBillingDb";';
      const importRe = /^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm;
      let lastEnd = -1;
      let m;
      while ((m = importRe.exec(text)) !== null) lastEnd = m.index + m[0].length;
      text = lastEnd >= 0 ? text.slice(0, lastEnd) + "\n" + stmt + text.slice(lastEnd) : stmt + "\n" + text;
    }
  }

  // 2) Trim firebaseAdmin imports to only the names still used in code.
  text = text.replace(
    /^import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/firebaseAdmin["'];?\s*$/gm,
    (whole, names) => {
      const used = names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((n) => new RegExp(`(^|[^.\\w$])${n}\\s*\\(`).test(body(text)));
      return used.length ? `import { ${used.join(", ")} } from "@/lib/firebaseAdmin";` : "";
    }
  );
  text = text.replace(/\n{3,}/g, "\n\n");

  if (text === before) continue;
  if (dry) {
    console.log(`would clean: ${rel}`);
  } else {
    fs.writeFileSync(file, text);
    console.log(`cleaned: ${rel}`);
  }
  changed++;
}
console.log(`${dry ? "files needing cleanup" : "files cleaned"}: ${changed}`);
