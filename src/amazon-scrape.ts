import "dotenv/config";
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
import type { Lens, AsinEntry } from "../shared/types.js";

const LENSES_FILE = "lenses.json";
const DELAY_MS = [4000, 7000]; // random range between requests
const MAX_RESULTS_PER_LENS = 5; // max ASINs to collect per lens

function randomDelay() {
  const ms = DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0]);
  console.log(`  (•_•)`);
  console.log(`  ( •_•)>⌐■-■`);
  console.log(`  (⌐■_■)  I'm being sneaky ${(ms / 1000).toFixed(1)}s`);
  return new Promise((r) => setTimeout(r, ms));
}

function extractAsin(url: string): string | null {
  const match = url.match(/\/dp\/([A-Z0-9]{10})/);
  return match ? match[1] : null;
}

// Detect sponsored/ad search result cards
async function isSponsored(result: import("playwright").Locator): Promise<boolean> {
  try {
    const sponsoredMarkers = [
      "[aria-label='View Sponsored information' i]",
      "[aria-label*='Sponsored' i]",
      ".puis-sponsored-label-text",
      ".s-sponsored-label-text",
      "span.puis-label-popover-default",
    ];
    for (const sel of sponsoredMarkers) {
      if (await result.locator(sel).count() > 0) return true;
    }
    const text = (await result.locator(".a-color-secondary").allTextContents()).join(" ").toLowerCase();
    if (text.includes("sponsored")) return true;
  } catch {
    // default to not sponsored if detection fails
  }
  return false;
}

// Check if a result title plausibly matches this lens
function titleMatches(title: string, lens: Lens): boolean {
  const t = title.toLowerCase();
  console.log(`\n TITLE: ${t}`);
  if (!t.includes(lens.brand.toLowerCase())) {
    console.log(`\n BRAND DID NOT MATCH: ${lens.brand.toLowerCase()}`);
    return false;
  }
  const focal = lens.focalLength.replace("mm", "").toLowerCase();
  if (!t.includes(focal)) return false;

  const aperture = lens.maxAperture.replace("f/", "").toLowerCase();
  if (!t.includes(aperture)) return false;

  const junk = ["filter", "lens cap", "hood", "case", "bag", "strap", "bundle with", "kit with"];
  if (junk.some((j) => t.includes(j))) return false;

  return true;
}

// Extract seller name from a search result card
async function extractSeller(result: import("playwright").Locator, brand: string): Promise<string> {
  try {
    const storeLink = result.locator(`a[href*='/stores/']`);
    if (await storeLink.count() > 0) {
      const linkText = await storeLink.first().textContent({ timeout: 1000 });
      if (linkText) return linkText.trim();
    }

    const sellerSpan = result.locator(".a-row.a-size-base.a-color-secondary span").first();
    const sellerText = await sellerSpan.textContent({ timeout: 1000 });
    if (sellerText && !sellerText.toLowerCase().includes("no featured offers")) return sellerText.trim();
  } catch {
    // not found
  }
  return "Unknown";
}

// Check if a result is sold by the official brand store
async function isOfficialStore(result: import("playwright").Locator, brand: string): Promise<boolean> {
  try {
    const storeText = await result.locator(".s-item__detail, .a-row.a-size-base.a-color-secondary span, .a-row a[href*='/stores/']").first().textContent({ timeout: 1000 });
    if (storeText && storeText.toLowerCase().includes(brand.toLowerCase())) return true;

    const storeLink = result.locator(`a[href*='/stores/']`);
    if (await storeLink.count() > 0) {
      const linkText = await storeLink.first().textContent({ timeout: 1000 });
      if (linkText && linkText.toLowerCase().includes(brand.toLowerCase())) return true;
    }
  } catch {
    // element not present
  }
  return false;
}


async function scrapePrice(page: import("playwright").Page): Promise<number | null> {
  const selectors = [
    ".a-price .a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    ".priceToPay .a-offscreen",
    "#corePrice_desktop .a-offscreen",
    "#apex_desktop_newAccordionRow .a-offscreen",
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
      // selector not found, try next
    }
  }
  return null;
}

async function main() {
  const lenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));
  const targets = lenses.filter((l) => l.shoppingLink && !l.asins?.length);

  console.log(`${targets.length} lenses to scrape (${lenses.length - targets.length} already have ASINs)`);
  if (targets.length === 0) {
    console.log("Nothing to do. To re-scrape, remove the asins field from a lens entry.");
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
      // Step 1 — search
      console.log(`  → navigating to search page`);
      await page.goto(lens.shoppingLink!, { waitUntil: "domcontentloaded" });
      console.log(`  → waiting for results to render`);
      await page.waitForSelector(
        "xpath=.//div[contains(@class, 'widgetId=search-results_1')][@data-cel-widget='MAIN-SEARCH_RESULTS-2']",
        { timeout: 10000 },
      );

      // Step 2 — find the first official result, grab its ASIN, and move on.
      console.log(`  → scanning result widgets`);
      const asinEntries: AsinEntry[] = [];
      const MAX_INDEX = 20;

      for (let i = 1; i <= MAX_INDEX; i++) {
        const widgetXpath = `.//div[contains(@class, 'widgetId=search-results_${i}')][@data-cel-widget='MAIN-SEARCH_RESULTS-${i + 1}']`;
        const result = page.locator(`xpath=${widgetXpath}`);
        if (await result.count() === 0) {
          console.log('BREAKING!');
          break;
        }
        if (await isSponsored(result)) {
          console.log(`  skipped sponsored result at position ${i}`);
          continue;
        }

        const titleSpans = page.locator(`xpath=${widgetXpath}//h2/span`);
        console.log('found title link...');
        const spanTexts = await titleSpans.allTextContents();
        const titleAriaLabel = spanTexts.join("").trim();

        if (!titleMatches(titleAriaLabel, lens)) {
          continue;
        }

        // const official = await isOfficialStore(result, lens.brand);
        // if (!official) {
        //   console.log(`  skipped non-official result at position ${i}`);
        //   continue;
        // }

        const seller = await extractSeller(result, lens.brand);
        console.log(`  → clicking into "${titleAriaLabel.slice(0, 60)}"`);
        await titleSpans.nth(1).dblclick();
        await page.locator('#titleSection').waitFor({ state: "visible", timeout: 15000 });
        await page.waitForLoadState("domcontentloaded");

        const asin = extractAsin(page.url());
        if (!asin) {
          console.log(`  could not extract ASIN from ${page.url()} — skipping`);
          break;
        }

        const price = await scrapePrice(page);
        console.log(`  [official] ${seller} — ASIN ${asin} — price: ${price != null ? `$${price}` : "not found"}`);
        const entry: AsinEntry = { asin, seller, official: true };
        if (price != null) {
          entry.price = price;
          entry.priceScrapedAt = new Date().toISOString();
        }
        asinEntries.push(entry);
        break;
      }

      if (asinEntries.length === 0) {
        console.log(`  no matches found in top results — skipping (${lens.shoppingLink})`);
        failed++;
        await randomDelay();
        continue;
      }

      // Step 4 — persist back to lenses.json immediately
      const lensEntry = lenses.find((l) => l.id === lens.id)!;
      lensEntry.asins = asinEntries;
      writeFileSync(LENSES_FILE, JSON.stringify(lenses, null, 2));
      console.log(`  ✓ saved ${asinEntries.length} ASIN${asinEntries.length === 1 ? "" : "s"} to lenses.json`);

      succeeded++;
    } catch (err) {
      console.log(`  error: ${err instanceof Error ? err.message : err}`);
      failed++;
    }

    await randomDelay();
  }

  await browser.close();
  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
  console.log("Re-run anytime to fill in failures. To re-scrape a lens, remove its asins field.");
}

main().catch((err) => { console.error(err); process.exit(1); });
