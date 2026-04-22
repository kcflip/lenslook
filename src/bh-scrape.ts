import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import type { Lens, BHEntry, ReviewItem } from "../shared/types.js";
import { recordPrice } from "./price-history.js";
import { saveReviews, isEnglish } from "./reviews.js";

chromium.use(StealthPlugin());

const LENSES_FILE = "lenses.json";
const DELAY_MS = [4000, 7000];
const BH_SEARCH_BASE = "https://www.bhphotovideo.com/c/search";

function randomDelay() {
  const ms = DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0]);
  console.log(` ======POCKET SAND!=====\n`)
  console.log(`  (•_•)`);
  console.log(`  ( •_•)>⌐■-■`);
  console.log(`  (⌐■_■)  I'm being sneaky ${(ms / 1000).toFixed(1)}s`);
  console.log(`\n ====== HUZZAH! ===== \n`)
  return new Promise((r) => setTimeout(r, ms));
}

function buildSearchUrl(lens: Lens): string {
  const q = `${lens.brand} ${lens.name}`;
  const filters = `fct_brand_name:${lens.brand.toLowerCase()}:REGULAR`;
  return `${BH_SEARCH_BASE}?q=${encodeURIComponent(q)}&filters=${encodeURIComponent(filters)}`;
}

async function scrapeBhNumber(page: import("playwright").Page): Promise<string | null> {
  try {
    const el = page.locator("xpath=.//div[@data-selenium='codeCrumb']").first();
    if (!await el.isVisible({ timeout: 5000 })) return null;
    console.log(`Scraping BH number...\n textcontent: ${await el.textContent()} \n innerText: ${await el.innerText()}`);
    const text = (await el.textContent() ?? "").replace(/\s+/g, " ").trim();
    const match = text.match(/BH\s*#\s*([A-Z0-9]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
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

async function scrapeOfficial(page: import("playwright").Page): Promise<boolean> {
  const authorizedText = await page.locator(`.//div[@data-selenium='authorizeDealerText']`).textContent().catch(() => "");
  return authorizedText != "";
}

// Pull average star rating and total review count out of the header-level
async function scrapeRatingAndCount(
  page: import("playwright").Page,
): Promise<{ starCount?: number; ratingCount?: number }> {
  try {
    const el = page.locator("xpath=.//div[contains(@class, 'metaShare')]//div[contains(@class, 'reviews')]").first();
    if (!(await el.count())) {
      console.log(`-- element count for product page rating is undefined or null`)
      return {};
    }
    const text = (await el.textContent() ?? "").replace(/\s+/g, " ").trim();
    console.log(`Found text for rating and count: ${text}`);
    if (!text) {
      console.log(`-- failed to parse text from product page rating`)
      return {};
    }

    // TODO: update this to hover on the "{} Reviews" element
    // Then capture the text from the hover element. "4.6 out of 5 stars"
    const ariaRating = await el.locator("xpath=.//div[contains(@class, 'starContainer')]//*[contains(@href, '#StarIcon')]").all().catch(() => null) ?? [];
    // this is the selctor for a half star
    const ariaPartialRating = await el.locator("xpath=.//div[contains(@class, 'starContainer')]//*[contains(@href, '#StarHalfIcon')]").all().catch(() => null) ?? [];
    let starCount = 0;
    if (ariaRating) {
      starCount += ariaRating.length;
    }
    console.log(`Star count before partial...${starCount}`);
    if (ariaPartialRating.length > 0) {
      starCount += 0.5
    }
    console.log(`Star count...${starCount}`);

    let ratingCount: number | undefined;
    const countMatch = text.match(/(\d[\d,]*)\s*reviews?/i) ?? text.match(/\((\d[\d,]*)\)/);
    if (countMatch) ratingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);

    return {
      starCount: starCount != null && !isNaN(starCount) && starCount > 0 ? starCount : undefined,
      ratingCount: ratingCount != null && !isNaN(ratingCount) && ratingCount > 0 ? ratingCount : undefined,
    };
  } catch (e: unknown) {
    if (e instanceof Error) console.log(`Caught some error...${e.message}`);
    return {};
  }
}

// Review section scraping
async function scrapeReviews(page: import("playwright").Page, lensId: string, productUrl: string): Promise<ReviewItem[]> {
  const reviews: ReviewItem[] = [];

  try {
    // B&H tucks reviews behind a tab button. Click it to load the reviews
    const reviewBtn = page.locator("xpath=.//a[contains(@class, 'itemBtn')][contains(@href, 'reviews')]").first();
    if (!(await reviewBtn.count())) {
      console.log(`  no review button — skipping reviews`);
      return reviews;
    }
    console.log(`  → clicking review button`);
    // this will click the review button at the bottom of the pane, and shift the window to the reviews
    await reviewBtn.click();
    await page.locator(`xpath=.//div[@data-selenium='reviewsReviewedByCustomers']`).waitFor({ state: "visible", timeout: 5000 });
    // locate sort by select
    console.log('  → sorting!!')
    const reviewSortBy = page.locator(`xpath=.//option[contains(text(), 'Highest rated')]/parent::select`);
    // select most help
    await reviewSortBy.selectOption('Most Helpful');
    console.log('  → selected Most Helpful option!');
    await page.waitForTimeout(2500);
    // locate the review containers
    const reviewContainers = page.locator(`xpath=.//div[@data-selenium='reviewsClientReview']`).all();

    // previous claude variables carrying over
    let skippedUnverified = 0;
    let skippedEmpty = 0;
    let skippedNonEnglish = 0;

    if ((await reviewContainers).length > 0) {
      // iterate over top 6 reviews
      let counter = 0;
      let max = 5;
      for (let review of await reviewContainers) {
        // locate verified buyer
        const isVerified = await review.locator(`xpath=.//span[@data-selenium='reviewsClientReviewVerifiedBuyerText']`).count();
        if (isVerified != 1) {
          console.log(`${lensId} review ${counter + 1} was not verified, moving along!`);
          skippedUnverified++;
          continue; // move on to next review
        }

        const title = await review.locator(`h4`).textContent().catch(() => "") ?? ""; // potential for title to be blank? probably not
        // check for english
        if (!isEnglish(title)) {
          skippedNonEnglish++;
          console.log(`${lensId} review ${counter + 1} skipped — non-English: "${title}"`);
          continue;
        }

        //capture the review content
        const content = (await review.locator(`//div[@data-selenium='reviewsClientReviewContent']`).textContent().catch(() => "") ?? "").trim();
        if (!content) {
          skippedEmpty++;
          console.log(`${lensId} review ${counter + 1} had empty content, adios!`);
          continue;
        }
        const date = await review.locator(`//span[@data-selenium='reviewsClientReviewDate']`).textContent().catch(() => "") ?? "";

        //capture the rating
        let starCount = 0;
        const rating = await review.locator(`//div[@data-selenium='ratingContainer']//*[@href='#StarIcon']`).all().catch(() => null);
        const halfStarRating = await review.locator(`xpath=.//div[contains(@class, 'starContainer')]//*[contains(@href, '#StarHalfIcon')]`).all().catch(() => null);
        if (rating) starCount += rating.length;
        if (halfStarRating) starCount += 0.5;

        // capture review specific images
        const images = await review.locator(`//div[@data-selenium='reviewsClientReviewImages']//img`).all().catch(() => null) ?? [];
        const reviewImagesUrl = [];
        for (let image of images) {
          const src = await image.getAttribute('src');
          if (src) reviewImagesUrl.push(src);
        }
        //capture the thumbs up
        const thumbsUpCount = await review.locator(`//div[@data-selenium='reviewsClientReviewHelpfulCounter']`).textContent().catch(() => "") ?? 0;
        console.log()
        reviews.push({
          sourceType: "bh",
          lensId,
          text: content,
          rating: starCount,
          verifiedPurchase: true,
          images: reviewImagesUrl,
          date,
          url: productUrl,
          upvoteScore: Number(thumbsUpCount),
        });

        // log results
        const preview = content.length > 45 ? content.slice(0, 45) + "…" : content;
        const bits = [starCount != null ? `${starCount}★` : "no rating", reviewImagesUrl.length > 0 ? `${reviewImagesUrl.length} image${reviewImagesUrl.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
        console.log(`${lensId} ✓ kept — ${bits} — "${preview}"`);

        // 6 reviews
        counter += 1;
        if (max > 5) {
          console.log('Read 6 reviews!')
          break;
        }
      }
    }

    // TODO: fetch images from side gallery. not per review but at a higher level than this
  } catch (err) {
    console.log(`  review scrape error: ${err instanceof Error ? err.message : err}`);
  }
  return reviews;
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

export interface BhScrapeResult {
  entry: BHEntry;
  reviews: ReviewItem[];
}

// Core per-lens scraper. Returns null when no matching product is found. No
// side-effects — callers decide what to persist. Shared by `main()` below and
// the smoke test in bh-scrape-test.ts.
export async function scrapeBhLens(
  page: import("playwright").Page,
  lens: Lens,
): Promise<BhScrapeResult | null> {
  const searchUrl = buildSearchUrl(lens);
  console.log(`  → searching: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

  await page.locator("[data-selenium='miniProductPage'], [data-selenium='productItem'], [class*='productItem']").first().waitFor({ state: "visible", timeout: 10000 });

  type Locator = import("playwright").Locator;
  let matchedEl: Locator | null = null;
  let matchedTitle = "";

  const xpath = `xpath=.//*[@data-selenium='miniProductPage']//*[contains(text(), '${lens.name}')]/parent::a`;
  const xpathEl = page.locator(xpath).first();
  if (await xpathEl.isVisible({ timeout: 3000 }).catch(() => false)) {
    const titleText = await xpathEl.textContent({ timeout: 1000 }).catch(() => "");
    if (titleText && titleMatches(titleText, lens)) {
      matchedEl = xpathEl;
      matchedTitle = titleText;
      console.log(`  → matched via xpath: "${titleText.slice(0, 70)}"`);
    } else {
      console.log(`  xpath found element but titleMatches failed: "${titleText?.slice(0, 60)}" — falling back`);
    }
  }

  if (!matchedEl) {
    const items = page.locator("[data-selenium='productItem'], [class*='productItem']");
    const count = await items.count();
    console.log(`  → ${count} results (1st fallback scan)`);
    for (let i = 0; i < Math.min(count, 8); i++) {
      const item = items.nth(i);
      const titleEl = item.locator("[data-selenium='productTitle'], [class*='title']").first();
      const titleText = await titleEl.textContent({ timeout: 1000 }).catch(() => "");
      if (!titleText || !titleMatches(titleText, lens)) {
        console.log(`  skipped: "${titleText?.slice(0, 60)}"`);
        continue;
      }
      matchedEl = titleEl;
      matchedTitle = titleText;
      console.log(`  → matched via 1st fallback: "${titleText.slice(0, 70)}"`);
      break;
    }
  }

  if (!matchedEl) {
    const items = await page.locator(`.xpath=.//h3[@data-selenium='miniProductPageName']`).all().catch(() => null) ?? [];
    console.log(`  → ${items.length} results (2nd fallback scan)`);
    for (let i = 0; i < Math.min(items.length, 8); i++) {
      const item = items[i];
      const titleText = await item.locator("span").textContent({ timeout: 1000 }).catch(() => "");
      // const titleText = await titleEl.textContent({ timeout: 1000 }).catch(() => "");
      if (!titleText || !titleMatches(titleText, lens)) {
        console.log(`  skipped: "${titleText?.slice(0, 60)}"`);
        continue;
      }
      matchedEl = item;
      matchedTitle = titleText;
      console.log(`  → matched via 2nd fallback: "${titleText.slice(0, 70)}"`);
      break;
    }
  }

  if (!matchedEl) {
    const items = await page.locator(`.xpath=.//*[contains(text(), '${lens.brand.trim()} ${lens.name.trim()}')]`).all().catch(() => null) ?? [];
    console.log(`  → search for xpath: .xpath=.//*[contains(text(), '${lens.brand.trim()} ${lens.name.trim()}')]`);
    console.log(`  → ${items.length} results (3rd fallback scan)`);
    if (items.length > 0) {
      console.log('Greedily clicking into a listing...');
      await items[0].click();
      matchedEl = items[0];
      matchedTitle = `${lens.brand.trim()} ${lens.name.trim()}`;
      console.log(`  → matched via 3rd fallback: "${matchedTitle}"`);
    }
  }

  if (!matchedEl) return null;

  // clicking into a lens
  await matchedEl.click();
  await page.locator(`xpath=.//div[@data-selenium='apertureModuleProductDetail']`).waitFor({ state: "visible", timeout: 15000 });
  await page.waitForLoadState("domcontentloaded");

  const productUrl = page.url();
  const bhNumber = await scrapeBhNumber(page);
  if (!bhNumber) {
    console.log(`  could not find BH# on ${productUrl}`);
    return null;
  }

  const [price, official, rating] = await Promise.all([
    scrapePrice(page),
    scrapeOfficial(page),
    scrapeRatingAndCount(page),
  ]);


  const ratingBits = rating.starCount != null
    ? `${rating.starCount}★ - ${rating.ratingCount != null ? ` (${rating.ratingCount})` : ""}`
    : "no rating";
  console.log(`  BH # ${bhNumber} — price: ${price != null ? `$${price}` : "not found"} — ${official ? "✓ official" : "not official"} — ${ratingBits}\n`);
  console.log(` checking reviews for ${lens.id}`);
  await scrapeReviews(page, lens.id, productUrl);

  // capturing images - they live in the reviews, so do it after clicking the reviews tab
  const images = await page.locator(`xpath=.//div[@data-selenium='reviewsCustomerPhotosSidebar']//img`).all().catch(() => null) ?? [];
  const bhEntryImages = [];
  for (let image of images) {
    const src = await image.getAttribute('src');
    if (src) bhEntryImages.push(src);
  }
  console.log(` found ${bhEntryImages.length} images in review section for ${lens.id} \n`);

  const entry: BHEntry = {
    bhNumber,
    url: productUrl,
    title: matchedTitle.trim(),
    official,
    images: bhEntryImages
  };

  if (price != null) {
    entry.price = price;
    entry.priceScrapedAt = new Date().toISOString();
  }
  if (rating.starCount != null) entry.starCount = rating.starCount;
  if (rating.ratingCount != null) entry.ratingCount = rating.ratingCount;

  const reviews: ReviewItem[] = [];
  return { entry, reviews };
}

export async function launchBhContext() {
  const PROFILE_DIR = ".browser-profile";
  mkdirSync(PROFILE_DIR, { recursive: true });
  console.log("Launching Chromium…");
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  console.log("Browser ready — putting on my trench coat and sunglasses 🕶️\n");
  return { context, page };
}

export { randomDelay };

async function main() {
  const lenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));
  const { context, page } = await launchBhContext();

  let succeeded = 0;
  let failed = 0;

  for (const lens of lenses) {
    console.log(`\n[${succeeded + failed + 1}/${lenses.length}] ${lens.brand} ${lens.name}`);

    try {
      const result = await scrapeBhLens(page, lens);
      if (!result) {
        console.log(`  no matching result found — skipping`);
        failed++;
      } else {
        const lensEntry = lenses.find((l) => l.id === lens.id)!;
        lensEntry.bh = result.entry;
        writeFileSync(LENSES_FILE, JSON.stringify(lenses, null, 2));
        if (result.entry.price != null) recordPrice(lens.id, "bh", result.entry.price, result.entry.priceScrapedAt!);
        console.log(`  ✓ saved to lenses.json`);

        if (result.reviews.length > 0) {
          saveReviews(lens.id, "bh", result.reviews);
          console.log(`  ✓ saved ${result.reviews.length} verified review${result.reviews.length === 1 ? "" : "s"} to reviews.json`);
        }

        succeeded++;
      }
    } catch (err) {
      console.log(`  error: ${err instanceof Error ? err.message : err}`);
      failed++;
    }

    await randomDelay();
  }

  await context.close();
  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
  console.log("Re-run anytime to fill in failures.");
}

// Only run main() when invoked as a CLI, not when imported by the smoke test.
import { fileURLToPath } from "url";
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
