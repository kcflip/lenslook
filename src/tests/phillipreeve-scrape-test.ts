// Single-lens smoke test for the Phillip Reeve scraper. Mirrors the pattern
// used by amazon-scrape-test / bh-scrape-test / adorama-scrape-test — give it
// a lensId and a URL on the command line, run the full pipeline on just that
// lens, and dump the resulting TechnicalReview to output/ for inspection.
//
// Usage:
//   npx tsx src/phillipreeve-scrape-test.ts <lensId> <url>
//   npx tsx src/phillipreeve-scrape-test.ts sony-fe-135mm-f18-gm \
//     https://phillipreeve.net/blog/review-sony-fe-135mm-f1-8-gm/

import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import type { Lens } from "../../shared/types.js";
import { scrapeLens } from "../phillipreeve-scrape.js";

const OUT = "output/scrape-test-phillipreeve.json";

async function main(): Promise<void> {
  const [lensId, urlArg] = process.argv.slice(2);
  if (!lensId) {
    console.error("Usage: phillipreeve-scrape-test <lensId> [url]");
    process.exit(1);
  }

  const lenses: Lens[] = JSON.parse(readFileSync("lenses.json", "utf8"));
  const target = lenses.find((l) => l.id === lensId);
  if (!target) {
    console.error(`lensId "${lensId}" not found in lenses.json`);
    process.exit(1);
  }

  // Allow overriding the URL from the CLI without having to edit lenses.json.
  const lensForRun: Lens = urlArg
    ? { ...target, reviews: { ...(target.reviews ?? {}), phillipreeve: urlArg } }
    : target;

  if (!lensForRun.reviews?.phillipreeve) {
    console.error(
      `no curated phillipreeve URL for ${lensId}; pass one as the second argument`,
    );
    process.exit(1);
  }

  const result = await scrapeLens(lensForRun, lenses);

  mkdirSync("output", { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`\nWrote ${OUT}`);
  console.log(`status=${result.status}${result.reason ? ` reason=${result.reason}` : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
