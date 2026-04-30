import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { scrapeAmazonLens, launchAmazonContext, randomDelay } from "../amazon-scrape.js";
import type { Lens } from "../../shared/types.js";

const LENSES_FILE = "lenses.json";
const OUTPUT = "output/scrape-test-amazon.json";

// Pick the first lens per brand that has an Amazon search link (required to
// run the scraper). No side-effects on lenses.json / reviews.json /
// price-history.json — everything lands in OUTPUT.
function pickOnePerBrand(lenses: Lens[]): Lens[] {
  const seen = new Set<string>();
  const picked: Lens[] = [];
  for (const lens of lenses) {
    if (!lens.amazon?.searchLink) continue;
    if (seen.has(lens.brand)) continue;
    seen.add(lens.brand);
    picked.push(lens);
  }
  return picked;
}

async function main() {
  const lenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));
  const targets = pickOnePerBrand(lenses);
  console.log(`Smoke-testing Amazon scraper against ${targets.length} lenses (one per brand):`);
  for (const l of targets) console.log(`  • ${l.brand} — ${l.name}`);
  console.log();

  const { browser, page } = await launchAmazonContext();

  interface TestRecord {
    productId: string;
    brand: string;
    name: string;
    ok: boolean;
    error?: string;
    result?: Awaited<ReturnType<typeof scrapeAmazonLens>>;
  }
  const records: TestRecord[] = [];

  for (const lens of targets) {
    console.log(`\n[${records.length + 1}/${targets.length}] ${lens.brand} ${lens.name}`);
    const record: TestRecord = { productId: lens.id, brand: lens.brand, name: lens.name, ok: false };
    try {
      const result = await scrapeAmazonLens(page, lens);
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

  await browser.close();

  mkdirSync("output", { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify({ ranAt: new Date().toISOString(), records }, null, 2));

  const succeeded = records.filter(r => r.ok).length;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${succeeded}/${targets.length} brands scraped successfully`);
  for (const r of records) {
    const reviews = r.result?.reviews.length ?? 0;
    const price = r.result?.asins[0]?.price != null ? `$${r.result.asins[0].price}` : "—";
    const asin = r.result?.asins[0]?.asin ?? "—";
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.brand.padEnd(10)} ${r.name.padEnd(35)} asin=${asin.padEnd(12)} price=${price.padEnd(8)} reviews=${reviews}`);
  }
  console.log(`  results written to ${OUTPUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
