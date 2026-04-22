import "dotenv/config";
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
import type { Lens, AsinEntry, AmazonEntry, ReviewItem } from "../shared/types.js";
import { recordPrice } from "./price-history.js";
import { saveReviews, isEnglish } from "./reviews.js";

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
    console.log(`  rejected — brand "${lens.brand.toLowerCase()}" not in title`);
    return false;
  }
  const focal = lens.focalLength.replace("mm", "").toLowerCase();
  if (!t.includes(focal)) {
    console.log(`  rejected — focal "${focal}" not in title`);
    return false;
  }

  const aperture = lens.maxAperture.replace("f/", "").toLowerCase();
  if (!t.includes(aperture)) {
    console.log(`  rejected — aperture "${aperture}" not in title`);
    return false;
  }

  // Reject accessory/bundle listings. Each pattern anchors the accessory word
  // to a qualifier so lens specs don't trip it — e.g. "58mm filter thread"
  // (standard lens spec) stays, but "UV filter" / "filter kit" (accessory)
  // gets rejected.
  const junkPatterns: RegExp[] = [
    /\(renewed\)/,
    /\(refurbished\)/,
    // Competing mounts — this project tracks Sony-ecosystem lenses, so any
    // "for Nikon / Canon / Fujifilm / …" mention is a different product.
    /\bfor\s+(nikon|canon|fujifilm|fuji|pentax|olympus|panasonic|leica|m4\/3|mft)\b/,
    // Same intent, for titles that drop the "for" ("Samyang 50mm Nikon Z-Mount
    // Lens"). Covers brand-mount combos and the mount codename on its own.
    // Excludes E-mount so Sony E (our target) isn't caught.
    /\b(nikon\s+[zf]|canon\s+(ef|rf)|fujifilm\s+x|fuji\s+x|panasonic\s+l|pentax\s+k|olympus\s+om|[zfxlk]\-?mount)\b/,
    /\blens cap\b/,
    /\blens hood\b/,
    /\b(camera|carrying|gadget)\s+(bag|case|pouch)\b/,
    /\bcamera\s+strap\b/,
    /\bbundle\s+with\b/,
    /\bkit\s+with\b/,
    /\b(uv|nd|cpl|polariz(?:er|ing)|variable|protective|neutral\s+density)\s+filter\b/,
    /\bfilter\s+(kit|set|pack)\b/,
  ];
  const hit = junkPatterns.find((re) => re.test(t));
  if (hit) {
    console.log(`  rejected — looks like accessory/bundle (matched ${hit})`);
    return false;
  }

  return true;
}


// Official brand store badge on the product page — a "premium logo byline"
// block Amazon renders under the title for verified brand storefronts.
async function scrapeOfficial(page: import("playwright").Page): Promise<boolean> {
  try {
    return await page
      .locator(".premium-logoByLine-brand-logo, #premium-logoByLine-brand-logo, [class*='premium-logoByLine-brand-logo']")
      .first()
      .isVisible({ timeout: 2000 });
  } catch {
    return false;
  }
}


// Amazon image URLs carry a size suffix (e.g. ._SY88) before the extension.
// Stripping it gives the full-resolution original.
function fullSizeImageUrl(url: string): string {
  return url.replace(/\._[^.]+(\.\w+)$/, "$1");
}

// Scrape reviews in-place on the product page. Navigating to /product-reviews/
// triggers a sign-in wall, so we scroll to the embedded reviews widget instead
// (~8 top reviews per product — Amazon picks the sort). We filter to verified
// purchases via the avp-badge element.
async function scrapeReviews(page: import("playwright").Page, lensId: string): Promise<ReviewItem[]> {
  const reviews: ReviewItem[] = [];
  const productUrl = page.url();

  try {
    console.log(`  → scrolling to reviews section`);
    await page.evaluate(() => {
      const el = document.querySelector(
        "[data-hook='reviews-medley-widget'], #reviews-medley-footer, [data-hook='top-customer-reviews-widget'], #cm-cr-dp-review-list, [data-hook='review']",
      );
      if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
    });
    await page.waitForSelector("[data-hook='review']", { timeout: 10000 });

    const cards = page.locator("[data-hook='review']");
    const total = await cards.count().catch(() => 0);
    if (total === 0) {
      console.log(`  no review cards found`);
      return reviews;
    }

    console.log(`  found ${total} review cards, filtering to verified…`);

    let skippedUnverified = 0;
    let skippedEmpty = 0;
    let skippedNonEnglish = 0;

    for (let i = 0; i < total && reviews.length < 3; i++) {
      const card = cards.nth(i);
      const tag = `    [${i + 1}/${total}]`;

      const verifiedHits = await card.locator("[data-hook='avp-badge']").count().catch(() => 0);
      if (verifiedHits === 0) {
        skippedUnverified++;
        console.log(`${tag} skipped — no verified-purchase badge`);
        continue;
      }

      const ratingText = await card.locator("[data-hook='review-star-rating'], [data-hook='cmps-review-star-rating']")
        .first().getAttribute("class").catch(() => null);
      const ratingMatch = ratingText?.match(/a-star-(\d+)/);
      const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : undefined;

      const text = (await card.locator("[data-hook='review-body'] span").first().textContent().catch(() => "") ?? "").trim();
      if (!text) {
        skippedEmpty++;
        console.log(`${tag} skipped — empty review body`);
        continue;
      }

      if (!isEnglish(text)) {
        skippedNonEnglish++;
        const preview = text.length > 50 ? text.slice(0, 47) + "…" : text;
        console.log(`${tag} skipped — non-English: "${preview}"`);
        continue;
      }

      const date = (await card.locator("[data-hook='review-date']").first().textContent().catch(() => "") ?? "").trim() || undefined;

      const rawImages = await card.locator("[data-hook='review-image-tile'] img, img.review-image-tile")
        .evaluateAll(els => (els as HTMLImageElement[]).map(el => el.src).filter(Boolean))
        .catch(() => [] as string[]);
      const images = rawImages.map(fullSizeImageUrl);

      const helpfulText = await card.locator("[data-hook='helpful-vote-statement']").first().textContent().catch(() => null);
      const helpfulMatch = helpfulText?.match(/(\d+)/);
      const upvoteScore = helpfulMatch ? parseInt(helpfulMatch[1], 10) : undefined;

      reviews.push({
        sourceType: "amazon",
        lensId,
        text,
        rating,
        verifiedPurchase: true,
        images,
        date,
        url: productUrl,
        upvoteScore,
      });

      const preview = text.length > 60 ? text.slice(0, 57) + "…" : text;
      const bits = [
        rating != null ? `${rating}★` : "no rating",
        images.length > 0 ? `${images.length} image${images.length === 1 ? "" : "s"}` : null,
        upvoteScore != null ? `${upvoteScore} helpful` : null,
      ].filter(Boolean).join(" · ");
      console.log(`${tag} ✓ kept — ${bits} — "${preview}"`);
    }

    console.log(`  → kept ${reviews.length}, skipped ${skippedUnverified} unverified, ${skippedEmpty} empty, ${skippedNonEnglish} non-English`);
  } catch (err) {
    console.log(`  review scrape error: ${err instanceof Error ? err.message : err}`);
  }

  return reviews;
}

async function scrapeRating(page: import("playwright").Page): Promise<number | null> {
  try {
    // #acrPopover carries a title like "4.7 out of 5 stars"
    const primary = page.locator("#acrPopover").first();
    if (await primary.count()) {
      const title = await primary.getAttribute("title");
      const m = title?.match(/([\d.]+)\s*out of/);
      if (m) {
        const n = parseFloat(m[1]);
        if (!isNaN(n) && n > 0) return n;
      }
    }
    // Fallback — the visible rating text near the title bar
    const alt = page.locator("[data-hook='rating-out-of-text'], span.a-icon-alt").first();
    if (await alt.isVisible({ timeout: 1000 }).catch(() => false)) {
      const text = await alt.textContent();
      const m = text?.match(/([\d.]+)\s*out of/);
      if (m) {
        const n = parseFloat(m[1]);
        if (!isNaN(n) && n > 0) return n;
      }
    }
  } catch {
    // swallow and return null
  }
  return null;
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

export interface AmazonScrapeResult {
  asins: AsinEntry[];
  reviews: ReviewItem[];
}

// Scrape price + rating + official badge off the currently-loaded product
// page. Caller is responsible for having navigated there already. Also
// captures the live page URL so phase 2 can revisit without reconstructing.
async function scrapeProductData(
  page: import("playwright").Page,
  asin: string,
): Promise<AsinEntry> {
  const [price, avgRating, official] = await Promise.all([
    scrapePrice(page),
    scrapeRating(page),
    scrapeOfficial(page),
  ]);
  console.log(`  ASIN ${asin} — price: ${price != null ? `$${price}` : "not found"} — rating: ${avgRating != null ? `${avgRating}★` : "not found"} — ${official ? "✓ official" : "not official"}`);
  const entry: AsinEntry = { asin, official, url: page.url() };
  if (price != null) {
    entry.price = price;
    entry.priceScrapedAt = new Date().toISOString();
  }
  if (avgRating != null) entry.avgRating = avgRating;
  return entry;
}

// Amazon A/B-tests two different layouts for search result widgets. Either
// can be served on any given page load, so we race both on first render and
// use whichever one wins.
type WidgetStyle = "nested" | "flat";

function buildWidgetXpath(style: WidgetStyle, i: number): string {
  if (style === "nested") {
    // Newer layout: outer wrapper carries data-cel-widget, inner carries the class.
    return `.//div[@data-cel-widget='search_result_${i + 1}']//div[contains(@class, 'widgetId=search-results_${i}')]`;
  }
  // Legacy layout: both attributes on the same div.
  return `.//div[contains(@class, 'widgetId=search-results_${i}')][@data-cel-widget='MAIN-SEARCH_RESULTS-${i + 1}']`;
}

async function detectWidgetStyle(page: import("playwright").Page): Promise<WidgetStyle | null> {
  const timeout = 10000;
  try {
    return await Promise.any([
      page.waitForSelector(`xpath=${buildWidgetXpath("nested", 1)}`, { timeout }).then(() => "nested" as const),
      page.waitForSelector(`xpath=${buildWidgetXpath("flat", 1)}`, { timeout }).then(() => "flat" as const),
    ]);
  } catch {
    return null;
  }
}

// Core per-lens scraper. Returns null when no matching product is found. No
// side-effects — callers decide what to persist. Shared by `main()` below and
// the smoke test in amazon-scrape-test.ts.
export async function scrapeAmazonLens(
  page: import("playwright").Page,
  lens: Lens,
): Promise<AmazonScrapeResult | null> {
  if (!lens.amazon?.searchLink) return null;

  console.log(`  → navigating to search page`);
  await page.goto(lens.amazon.searchLink, { waitUntil: "domcontentloaded" });
  console.log(`  → waiting for results to render`);
  const style = await detectWidgetStyle(page);
  if (!style) {
    console.log(`  no recognizable search-result widgets on page — skipping`);
    return null;
  }
  console.log(`  → detected ${style} widget layout`);

  console.log(`  → scanning result widgets`);
  const asinEntries: AsinEntry[] = [];
  const MAX_INDEX = 20;

  for (let i = 1; i <= MAX_INDEX; i++) {
    const widgetXpath = buildWidgetXpath(style, i);
    const result = page.locator(`xpath=${widgetXpath}`);
    if (await result.count() === 0) break;

    // Scroll the widget into view so lazy-loaded content (titles, badges,
    // thumbnails) has a chance to render before we read it.
    await result.scrollIntoViewIfNeeded().catch(() => {});

    if (await isSponsored(result)) {
      console.log(`  skipped sponsored result at position ${i}`);
      continue;
    }

    const titleSpans = page.locator(`xpath=${widgetXpath}//h2/span`);
    const spanTexts = await titleSpans.allTextContents();
    const titleAriaLabel = spanTexts.join("").trim();
    if (!titleMatches(titleAriaLabel, lens)) continue;

    console.log(`  → clicking into "${titleAriaLabel.slice(0, 60)}"`);
    // Small settle pause before the click — gives the page a beat after the
    // scroll and looks a touch less robotic.
    await page.waitForTimeout(500 + Math.random() * 700);
    await titleSpans.nth(1).dblclick();
    await page.locator('#titleSection').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForLoadState("domcontentloaded");

    const asin = extractAsin(page.url());
    if (!asin) {
      console.log(`  could not extract ASIN from ${page.url()}`);
      break;
    }

    asinEntries.push(await scrapeProductData(page, asin));
    break;
  }

  if (asinEntries.length === 0) return null;

  const reviews = await scrapeReviews(page, lens.id);
  return { asins: asinEntries, reviews };
}

export interface AmazonRefreshResult {
  entry: AsinEntry;
  reviews: ReviewItem[];
}

// Re-scrape a product page by ASIN to pick up new fields and accumulate price
// history. Skips the search step entirely — we already know the exact product.
export async function refreshAmazonAsin(
  page: import("playwright").Page,
  lens: Lens,
  existing: AsinEntry,
): Promise<AmazonRefreshResult | null> {
  // Prefer the URL we captured during discovery — that's the exact URL Amazon
  // served us. Fall back to a constructed /dp/{asin} only for legacy entries
  // that predate URL storage (it'll get upgraded on this refresh).
  const productUrl = existing.url ?? `https://www.amazon.com/dp/${existing.asin}`;
  console.log(`  → navigating to ${productUrl}`);
  await page.goto(productUrl, { waitUntil: "domcontentloaded" });

  try {
    await page.locator("#titleSection").waitFor({ state: "visible", timeout: 15000 });
  } catch {
    console.log(`  product page did not render — skipping`);
    return null;
  }

  const entry = await scrapeProductData(page, existing.asin);
  const reviews = await scrapeReviews(page, lens.id);
  return { entry, reviews };
}

export async function launchAmazonContext() {
  console.log("Launching Chromium…");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  console.log("Browser ready — putting on my trench coat and sunglasses 🕶️\n");
  return { browser, context, page };
}

export { randomDelay };

async function main() {
  const lenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));
  // const discoverTargets = lenses.filter((l) => l.amazon?.searchLink && !l.amazon?.asins?.length);
  // const refreshTargets = lenses.filter((l) => (l.amazon?.asins?.length ?? 0) > 0);

    console.log(`Phase 0 (DO IT ALL): ${lenses.length} lenses to scan...`);
  // console.log(`Phase 1 (discover): ${discoverTargets.length} lens${discoverTargets.length === 1 ? "" : "es"} without ASINs`);
  // console.log(`Phase 2 (refresh):  ${refreshTargets.length} lens${refreshTargets.length === 1 ? "" : "es"} with existing ASINs`);

  // if (discoverTargets.length === 0 && refreshTargets.length === 0) {
  //   console.log("Nothing to do.");
  //   return;
  // }

  const { browser, page } = await launchAmazonContext();

  // let discoverSucceeded = 0;
  // let discoverFailed = 0;
  // let refreshSucceeded = 0;
  // let refreshFailed = 0;
  let lensesMatched = 0;
  let lensesFailed = 0;

  // ── Phase 1: discover ASINs for lenses that don't have one yet ────────────
  if (lenses.length > 0) {
    console.log(`\n=== Scanning the shit out of amazon listings ===`);
    for (const lens of lenses) {
      console.log(`\n[${lensesMatched}/${lenses.length}] ${lens.brand} ${lens.name}`);

      try {
        const result = await scrapeAmazonLens(page, lens);
        if (!result) {
          console.log(`  no matches found in top results — skipping (${lens.amazon!.searchLink})`);
          lensesFailed++;
        } else {
          const lensEntry = lenses.find((l) => l.id === lens.id)!;
          lensEntry.amazon = { searchLink: lens.amazon!.searchLink, asins: result.asins };
          writeFileSync(LENSES_FILE, JSON.stringify(lenses, null, 2));
          for (const a of result.asins) {
            if (a.price != null) recordPrice(lens.id, "amazon", a.price, a.priceScrapedAt!);
          }
          console.log(`  ✓ saved ${result.asins.length} ASIN${result.asins.length === 1 ? "" : "s"} to lenses.json`);

          if (result.reviews.length > 0) {
            saveReviews(lens.id, "amazon", result.reviews);
            console.log(`  ✓ saved ${result.reviews.length} verified review${result.reviews.length === 1 ? "" : "s"} to reviews.json`);
          }

          lensesMatched++;
        }
      } catch (err) {
        console.log(`  error: ${err instanceof Error ? err.message : err}`);
        lensesFailed++;
      }

      await randomDelay();
    }
  }

  // ── Phase 2: refresh existing ASINs to pick up new fields + price history ─
  // if (refreshTargets.length < 0) {
  //   console.log(`\n=== Phase 2: refreshing existing ASINs ===`);
  //   let lensIdx = 0;
  //   for (const lens of refreshTargets) {
  //     lensIdx++;
  //     console.log(`\n[${lensIdx}/${refreshTargets.length}] ${lens.brand} ${lens.name}`);

  //     const lensEntry = lenses.find((l) => l.id === lens.id)!;
  //     for (const existing of lensEntry.amazon!.asins) {
  //       try {
  //         const result = await refreshAmazonAsin(page, lens, existing);
  //         if (!result) {
  //           refreshFailed++;
  //           continue;
  //         }

  //         // Update in place. recordPrice always appends, so re-runs accumulate.
  //         existing.official = result.entry.official;
  //         if (result.entry.url) existing.url = result.entry.url;
  //         if (result.entry.price != null) {
  //           existing.price = result.entry.price;
  //           existing.priceScrapedAt = result.entry.priceScrapedAt;
  //         }
  //         if (result.entry.avgRating != null) existing.avgRating = result.entry.avgRating;
  //         writeFileSync(LENSES_FILE, JSON.stringify(lenses, null, 2));
  //         if (result.entry.price != null) recordPrice(lens.id, "amazon", result.entry.price, result.entry.priceScrapedAt!);

  //         if (result.reviews.length > 0) {
  //           saveReviews(lens.id, "amazon", result.reviews);
  //           console.log(`  ✓ refreshed ${result.reviews.length} review${result.reviews.length === 1 ? "" : "s"}`);
  //         }

  //         refreshSucceeded++;
  //       } catch (err) {
  //         console.log(`  refresh error for ${existing.asin}: ${err instanceof Error ? err.message : err}`);
  //         refreshFailed++;
  //       }

  //       await randomDelay();
  //     }
  //   }
  // }

  await browser.close();
  console.log(`\nDone.`);
  if (lensesMatched > 0) console.log(`  Scanned ${lenses.length} lenses - ${lensesMatched} succeeded, ${lensesFailed} failed.`);
  // if (refreshTargets.length > 0) console.log(`  Phase 2: ${refreshSucceeded} ASINs refreshed, ${refreshFailed} failed.`);
  console.log("Re-run anytime. Bye!");
}

// Only run main() when invoked as a CLI, not when imported by the smoke test.
import { fileURLToPath } from "url";
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
