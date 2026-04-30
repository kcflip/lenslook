// Targeted Adorama scrape: only lenses with no adorama entry, or ones where
// the previous match was title-only (adorama.guessed === true).
// Sorted by post-mention popularity so high-value lenses get filled first
// before captcha pressure builds.
//
// Usage: npx tsx src/adorama-scrape-missing.ts

import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import type { Lens } from "../shared/types.js";
import type { ResultsData } from "../shared/types.js";
import { runAdoramaRun } from "./adorama-scrape.js";

const LENSES_FILE = "lenses.json";
const RESULTS_FILE = "output/sonyResults.json";

function loadPostCounts(): Map<string, number> {
  if (!existsSync(RESULTS_FILE)) return new Map();
  try {
    const data: ResultsData = JSON.parse(readFileSync(RESULTS_FILE, "utf8"));
    return new Map(data.stats.map(s => [s.lensId, s.postCount]));
  } catch {
    return new Map();
  }
}

function main() {
  const allLenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));
  const postCounts = loadPostCounts();

  const targets = allLenses
    .filter(l => !l.adorama || l.adorama.guessed === true)
    .sort((a, b) => (postCounts.get(b.id) ?? 0) - (postCounts.get(a.id) ?? 0));

  if (targets.length === 0) {
    console.log("\n✅  All lenses have confirmed Adorama entries. Nothing to do.\n");
    return;
  }

  const guessedCount = targets.filter(l => l.adorama?.guessed).length;
  const missingCount = targets.filter(l => !l.adorama).length;

  console.log(`\n🎯  Adorama targeted scrape`);
  console.log(`    ${targets.length} lenses to attempt`);
  console.log(`    ${missingCount} missing · ${guessedCount} guessed (title-only match)\n`);
  console.log(`    Sorted by post mentions (most popular first):\n`);

  const padRank = String(targets.length).length;
  for (let i = 0; i < targets.length; i++) {
    const l = targets[i];
    const posts = postCounts.get(l.id) ?? 0;
    const flag = l.adorama?.guessed ? " [guessed]" : "";
    const rank = String(i + 1).padStart(padRank, " ");
    console.log(`    ${rank}. ${l.brand} ${l.name}${flag}  (${posts} posts)`);
  }

  console.log("");

  runAdoramaRun(targets);
}

import { fileURLToPath } from "url";
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
