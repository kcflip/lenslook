import "dotenv/config";
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
import type { Lens, BHEntry } from "../shared/types.js";

const LENSES_FILE = "lenses.json";
const DELAY_MS = [4000, 7000];
const BH_SEARCH_BASE = "https://www.bhphotovideo.com/c/search/results";

function randomDelay() {
  const ms = DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0]);
  console.log(`  (•_•)`);
  console.log(`  ( •_•)>⌐■-■`);
  console.log(`  (⌐■_■)  I'm being sneaky ${(ms / 1000).toFixed(1)}s`);
  return new Promise((r) => setTimeout(r, ms));
}

function buildSearchUrl(lens: Lens): string {
  const q = `${lens.brand} ${lens.focalLength} ${lens.maxAperture}`;
  return `${BH_SEARCH_BASE}?q=${encodeURIComponent(q)}&sto=1`;
}

function extractSku(url: string): string | null {
  const match = url.match(/\/p\/(\d+)/);
  return match ? match[1] : null;
}

function titleMatches(title: string, lens: Lens): boolean {
  const t = title.toLowerCase();
  if (!t.includes(lens.brand.toLowerCase())) return false;

  const focal = lens.focalLength.replace("mm", "").toLowerCase();
  if (!t.includes(focal)) return false;

  const aperture = lens.maxAperture.replace("f/", "").toLowerCase();
  if (!t.includes(aperture)) return false;

  const junk = ["filter", "lens cap", "hood", "case", "bag", "strap", "bundle", "kit"];
  if (junk.some((j) => t.includes(j))) return false;

  return true;
}

async function scrapePrice(page: import("playwright").Page): Promise<number | null> {
  const selectors = [
    "[data-selenium='pricingPrice']",
    ".price-value",
    "[class*='price_price']",
    "[data-selenium='salePriceValue']",
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        const text = await el.textContent();
        if (text) {
          const num = parseFloat(text.replace(/[^0-9.]/g, ""));
          if (!isNaN(num) && num > 0) return num;
        }
      }
    } catch {
      // try next selector
    }
  }
  return null;
}

async function main() {
  const lenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));
  const targets = lenses.filter((l) => !l.bh);

  console.log(`${targets.length} lenses to scrape (${lenses.length - targets.length} already have B&H data)`);
  if (targets.length === 0) {
    console.log("Nothing to do. To re-scrape, remove the bh field from a lens entry.");
    return;
  }

  console.log("Launching Chromium…");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  console.log("Browser ready — putting on my trench coat and sunglasses 🕶️\n");

  let succeeded = 0;
  let failed = 0;

  for (const lens of targets) {
    console.log(`\n[${succeeded + failed + 1}/${targets.length}] ${lens.brand} ${lens.name}`);

    try {
      const searchUrl = buildSearchUrl(lens);
      console.log(`  → searching: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

      // Wait for product grid to render
      await page.locator("[data-selenium='productItem'], [class*='productItem']").first().waitFor({ state: "visible", timeout: 10000 });

      // Scan first few results for a title match
      const items = page.locator("[data-selenium='productItem'], [class*='productItem']");
      const count = await items.count();
      console.log(`  → ${count} results found`);

      let matched = false;
      for (let i = 0; i < Math.min(count, 8); i++) {
        const item = items.nth(i);
        const titleEl = item.locator("[data-selenium='productTitle'], [class*='title']").first();
        const titleText = await titleEl.textContent({ timeout: 1000 }).catch(() => "");
        if (!titleText || !titleMatches(titleText, lens)) {
          console.log(`  skipped: "${titleText?.slice(0, 60)}"`);
          continue;
        }

        console.log(`  → matched: "${titleText.slice(0, 70)}"`);

        // Click through to product page to get SKU from URL and scrape price
        await titleEl.click();
        await page.waitForLoadState("domcontentloaded");

        const productUrl = page.url();
        const sku = extractSku(productUrl);
        if (!sku) {
          console.log(`  could not extract SKU from ${productUrl} — skipping`);
          break;
        }

        const price = await scrapePrice(page);
        console.log(`  SKU ${sku} — price: ${price != null ? `$${price}` : "not found"}`);

        const entry: BHEntry = {
          sku,
          url: productUrl,
          title: titleText.trim(),
        };
        if (price != null) {
          entry.price = price;
          entry.priceScrapedAt = new Date().toISOString();
        }

        const lensEntry = lenses.find((l) => l.id === lens.id)!;
        lensEntry.bh = entry;
        writeFileSync(LENSES_FILE, JSON.stringify(lenses, null, 2));
        console.log(`  ✓ saved to lenses.json`);

        succeeded++;
        matched = true;
        break;
      }

      if (!matched) {
        console.log(`  no matching result found — skipping (${searchUrl})`);
        failed++;
      }
    } catch (err) {
      console.log(`  error: ${err instanceof Error ? err.message : err}`);
      failed++;
    }

    await randomDelay();
  }

  await browser.close();
  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
  console.log("Re-run anytime to fill in failures. To re-scrape a lens, remove its bh field.");
}

main().catch((err) => { console.error(err); process.exit(1); });
