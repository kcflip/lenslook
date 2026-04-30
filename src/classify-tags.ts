import { readFileSync, writeFileSync } from "fs";
import type { Lens } from "../shared/types.js";

const LENSES_FILE = "lenses.json";

// Appends feature tags (prime/zoom/superzoom, focal bucket, macro, aps-c) to
// each lens's existing category[] in place. Idempotent — dedupes on write so
// re-running after adding new lenses only fills gaps.

function classify(lens: Lens): string[] {
  const tags: string[] = [];
  const m = lens.focalLength.match(/^(\d+)(?:-(\d+))?mm$/);
  if (!m) {
    console.warn(`  ! could not parse focalLength "${lens.focalLength}" on ${lens.id}`);
    return tags;
  }
  const short = parseInt(m[1], 10);
  const long = m[2] ? parseInt(m[2], 10) : short;
  const isZoom = short !== long;

  tags.push(isZoom ? "zoom" : "prime");
  if (isZoom && long / short >= 5) tags.push("superzoom");

  if (long > 300) {
    tags.push("super-telephoto");
  } else if (short <= 20) {
    tags.push("ultra-wide");
  } else if (short <= 35) {
    tags.push("wide");
  } else if (short <= 69) {
    tags.push("standard");
  } else {
    tags.push("telephoto");
  }

  if (/macro/i.test(lens.id) || /macro/i.test(lens.name)) tags.push("macro");

  // APS-C — flagged via the mount field (Sony's APS-C lenses use the E mount
  // while full-frame lenses use FE; the parenthetical is the stable signal).
  if (/APS-C/i.test(lens.mount)) tags.push("aps-c");

  return tags;
}

function main() {
  const lenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));
  const addedCounts: Record<string, number> = {};
  let modified = 0;

  for (const lens of lenses) {
    const before = new Set(lens.category ?? []);
    const feature = classify(lens);
    const after = new Set([...before, ...feature]);
    const added = feature.filter(t => !before.has(t));
    if (added.length === 0) continue;
    modified++;
    for (const t of added) addedCounts[t] = (addedCounts[t] ?? 0) + 1;
    lens.category = [...after];
  }

  writeFileSync(LENSES_FILE, JSON.stringify(lenses, null, 2) + "\n");

  console.log(`Modified ${modified}/${lenses.length} lenses.`);
  console.log("Tags added:");
  for (const [t, n] of Object.entries(addedCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${t}`);
  }
}

main();
