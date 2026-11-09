/**
 * One-shot repair: move the "use client" directive back to the very first line for every file in
 * `src/` where an import was placed above it (Next build refuses to compile those files).
 *
 * Usage: node scripts/fix-use-client-directive.cjs [--dry]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const EXT = new Set([".ts", ".tsx"]);
const DIR_RE = /^\s*["']use client["'];?\s*$/;
const dry = process.argv.includes("--dry");

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

let fixed = 0;
for (const file of walk(ROOT, [])) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  // Look only in the header (directive must be first or near-first).
  const headerLimit = Math.min(lines.length, 15);
  const idx = lines.slice(0, headerLimit).findIndex((l) => DIR_RE.test(l));
  if (idx < 0) continue;
  const before = lines.slice(0, idx);
  // Only blank lines (or comments) above the directive are harmless; a real import breaks the build.
  const hasExpressionAbove = before.some((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*");
  });
  if (!hasExpressionAbove) continue;
  const directive = lines[idx].trim();
  const after = lines.slice(idx + 1);
  while (before.length && before[before.length - 1].trim() === "") before.pop();
  while (after.length && after[0].trim() === "") after.shift();
  const rel = path.relative(path.join(ROOT, ".."), file);
  if (dry) {
    console.log(`would fix: ${rel} (directive at line ${idx + 1})`);
  } else {
    fs.writeFileSync(file, [directive, "", ...before, ...after].join("\n"));
    console.log(`fixed: ${rel} (line ${idx + 1} -> 1)`);
  }
  fixed++;
}
console.log(`${dry ? "files needing fix" : "files fixed"}: ${fixed}`);
