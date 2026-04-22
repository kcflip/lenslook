import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { scrapeBhLens, launchBhContext, randomDelay } from "./bh-scrape.js";
import type { Lens } from "../shared/types.js";

const LENSES_FILE = "lenses.json";
const OUTPUT = "output/scrape-test-bh.json";

// Pick the first lens per brand. No side-effects on lenses.json / reviews.json
// / price-history.json — everything lands in OUTPUT.
function pickOnePerBrand(lenses: Lens[]): Lens[] {
  const seen = new Set<string>();
  const picked: Lens[] = [];
  for (const lens of lenses) {
    if (seen.has(lens.brand)) continue;
    seen.add(lens.brand);
    picked.push(lens);
  }
  return picked;
}

async function main() {
  const lenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));
  const targets = pickOnePerBrand(lenses);
  console.log(`Smoke-testing B&H scraper against ${targets.length} lenses (one per brand):`);
  for (const l of targets) console.log(`  • ${l.brand} — ${l.name}`);
  console.log();

  const { context, page } = await launchBhContext();

  interface TestRecord {
    lensId: string;
    brand: string;
    name: string;
    ok: boolean;
    error?: string;
    result?: Awaited<ReturnType<typeof scrapeBhLens>>;
  }
  const records: TestRecord[] = [];

  for (const lens of targets) {
    console.log(`\n[${records.length + 1}/${targets.length}] ${lens.brand} ${lens.name}`);
    const record: TestRecord = { lensId: lens.id, brand: lens.brand, name: lens.name, ok: false };
    try {
      const result = await scrapeBhLens(page, lens);
      record.ok = result !== null;
      record.result = result;
      if (!result) console.log(`  no match`);
    } catch (err) {
      record.error = err instanceof Error ? err.message : String(err);
      console.log(`  error: ${record.error}`);
    }
    records.push(record);
    await randomDelay();
  }

  await context.close();

  mkdirSync("output", { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify({ ranAt: new Date().toISOString(), records }, null, 2));

  const succeeded = records.filter(r => r.ok).length;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${succeeded}/${targets.length} brands scraped successfully`);
  for (const r of records) {
    const reviews = r.result?.entry.ratingCount ?? 0;
    const starCount = r.result?.entry.starCount ?? 0;
    const price = r.result?.entry.price != null ? `$${r.result.entry.price}` : "—";
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.brand.padEnd(10)} ${r.name.padEnd(35)} price=${price.padEnd(8)} ${starCount}★ reviews=${reviews}`);
  }
  console.log(`  results written to ${OUTPUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
