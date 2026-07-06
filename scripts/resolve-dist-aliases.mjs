import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");

async function listJavaScriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith(".js")) return [fullPath];
    return [];
  }));
  return files.flat();
}

function toRelativeSpecifier(fromFile, aliasSpecifier) {
  const targetPath = path.join(distDir, aliasSpecifier.slice(2));
  let relativePath = path.relative(path.dirname(fromFile), targetPath).replaceAll(path.sep, "/");
  if (!relativePath.startsWith(".")) relativePath = `./${relativePath}`;
  return relativePath;
}

const importPattern = /((?:from\s+|import\s*\(\s*)["'])@\/([^"']+)(["'])/g;

for (const file of await listJavaScriptFiles(distDir)) {
  const source = await readFile(file, "utf8");
  const rewritten = source.replace(importPattern, (_match, prefix, specifier, suffix) => {
    return `${prefix}${toRelativeSpecifier(file, `@/${specifier}`)}${suffix}`;
  });
  if (rewritten !== source) {
    await writeFile(file, rewritten);
  }
}
