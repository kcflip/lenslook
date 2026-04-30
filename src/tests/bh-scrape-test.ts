import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { scrapeBhLens, launchBhContext, randomDelay } from "../bh-scrape.js";
import { recordPrice } from "../price-history.js";
import { saveReviews } from "../reviews.js";
import type { Lens } from "../../shared/types.js";

const LENSES_FILE = "lenses.json";
const OUTPUT = "output/scrape-test-bh.json";

function pickFailed(lenses: Lens[]): Lens[] {
  return lenses.filter((l) => !l.discontinued && !l.bh?.bhNumber);
}

function nextSessionLimit(): number {
  return 10 + Math.floor(Math.random() * 6);
}

async function main() {
  const lenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));
  const targets = pickFailed(lenses);
  console.log(`Targeting ${targets.length} lenses with no B&H entry:`);
  for (const l of targets) console.log(`  • ${l.id}`);
  console.log();

  let { context, page } = await launchBhContext();

  interface TestRecord {
    productId: string;
    brand: string;
    name: string;
    ok: boolean;
    error?: string;
    result?: Awaited<ReturnType<typeof scrapeBhLens>>;
  }
  const records: TestRecord[] = [];
  let sessionCount = 0;
  let sessionLimit = nextSessionLimit();

  for (const lens of targets) {
    console.log(`\n[${records.length + 1}/${targets.length}] ${lens.brand} ${lens.name}`);

    if (sessionCount > 0 && sessionCount >= sessionLimit) {
      console.log(`\n🔄 restarting browser session after ${sessionCount} lenses (limit was ${sessionLimit})…`);
      await context.close();
      ({ context, page } = await launchBhContext());
      sessionCount = 0;
      sessionLimit = nextSessionLimit();
    }

    const record: TestRecord = { productId: lens.id, brand: lens.brand, name: lens.name, ok: false };
    try {
      const result = await scrapeBhLens(page, lens);
      record.ok = result !== null;
      record.result = result;
      if (!result) {
        console.log(`  no match`);
      } else {
        const lensEntry = lenses.find((l) => l.id === lens.id)!;
        lensEntry.bh = result.entry;
        writeFileSync(LENSES_FILE, JSON.stringify(lenses, null, 2));
        if (result.entry.price != null) recordPrice(lens.id, "bh", result.entry.price, result.entry.priceScrapedAt!);
        console.log(`  ✓ saved to lenses.json`);
        if (result.reviews.length > 0) {
          saveReviews(lens.id, "bh", result.reviews);
          console.log(`  ✓ saved ${result.reviews.length} review${result.reviews.length === 1 ? "" : "s"} to reviews.json`);
        }
      }
    } catch (err) {
      record.error = err instanceof Error ? err.message : String(err);
      console.log(`  error: ${record.error}`);
    }
    records.push(record);
    sessionCount++;
    await randomDelay();
  }

  await context.close();

  mkdirSync("output", { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify({ ranAt: new Date().toISOString(), records }, null, 2));

  const succeeded = records.filter(r => r.ok).length;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${succeeded}/${targets.length} lenses scraped successfully`);
  for (const r of records) {
    const reviews = r.result?.entry.ratingCount ?? 0;
    const starCount = r.result?.entry.starCount ?? 0;
    const price = r.result?.entry.price != null ? `$${r.result.entry.price}` : "—";
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.brand.padEnd(10)} ${r.name.padEnd(35)} price=${price.padEnd(8)} ${starCount}★ reviews=${reviews}`);
  }
  console.log(`  results written to ${OUTPUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
