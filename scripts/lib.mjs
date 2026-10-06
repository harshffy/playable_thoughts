// Shared helpers. IDs must stay stable forever: progress is keyed by id.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = path.join(ROOT, "data");

export function hash36(s) {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
  return x.toString(16).slice(-5);
}
export function makeId(prefix, title) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${prefix}${slug || "x"}-${hash36(title)}`;
}
export const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch { return fallback; }
};
export const writeJson = (f, v, pretty = false) =>
  fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, pretty ? 1 : 0) + "\n");

// One item per line keeps git diffs readable.
export const readLibrary = () => readJson("library.json", []);
export const writeLibrary = (items) =>
  fs.writeFileSync(path.join(DATA, "library.json"), "[\n" + items.map((i) => JSON.stringify(i)).join(",\n") + "\n]\n");
