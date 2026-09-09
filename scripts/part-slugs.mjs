// Print every part in data/parts.json with the image filename the app will
// look for under `imageBase`.  Run:  npm run parts:slugs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "../js/catalog.js";

const file = path.join(import.meta.dirname, "..", "data", "parts.json");
const raw = JSON.parse(await readFile(file, "utf8"));
const ext = raw.imageExt || ".png";

let n = 0;
for (const [group, type] of [["blades", "Blade"], ["ratchets", "Ratchet"], ["bits", "Bit"]]) {
  console.log(`\n# ${type}s`);
  for (const p of raw[group] || []) {
    const explicit = p.image ? "  (explicit image set)" : "";
    console.log(`${p.name.padEnd(24)} ${slugify(p.name) + ext}${explicit}`);
    n++;
  }
}
console.log(`\n${n} parts. Put files at: ${raw.imageBase || "<set imageBase in data/parts.json>"}<slug>${ext}`);
