import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import type { Lens, Body, RetailSubject, BHEntry, ReviewItem, BHProperty } from "../shared/types.js";
import { recordPrice } from "./price-history.js";
import { saveReviews, isEnglish } from "./reviews.js";
import { launchChromiumContext, randomDelay, readingDelay, baseTitleMatches, baseBodyTitleMatches, looksLikeKit, checkMpn, logMpnMismatch, humanClick, MAX_REVIEWS } from "./scraper-shared.js";

// TODO: add a sibling script (e.g. src/bh-specs.ts) that walks lenses.json,
// visits each lens's B&H page via its existing `bhNumber`/`url`, and parses
// the product spec table (weight, dimensions, AF type, aperture blades,
// filter size, switches, weather sealing, etc.) into a new `specs` field on
// the Lens. Specs are ~static so this runs on-demand, not per price scrape.
// Manufacturer-site scraping is a separate effort — each brand ships its
// own HTML schema, so B&H's uniform spec table is the pragmatic first pass.

const LENSES_FILE = "lenses.json";
const BH_SEARCH_BASE = "https://www.bhphotovideo.com/c/search";

function buildSearchUrls(subject: RetailSubject): string[] {
  const enc = encodeURIComponent;
  const fullQuery = `${subject.brand} ${subject.name}`;
  const brandFilter = `fct_brand_name:${subject.brand.toLowerCase()}:REGULAR`;

  const urls: string[] = [
    // Primary: brand+name with B&H brand filter
    `${BH_SEARCH_BASE}?q=${enc(fullQuery)}&filters=${enc(brandFilter)}`,
    // No filter — catches brand name spelling differences in B&H's taxonomy
    `${BH_SEARCH_BASE}?q=${enc(fullQuery)}`,
    // Model number — precise, unambiguous
    `${BH_SEARCH_BASE}?q=${enc(subject.model)}`,
  ];

  // Model-number style aliases (alphanumeric + dashes, no spaces) tend to be
  // the most precise and are worth trying before giving up.
  if (subject.aliases?.length) {
    for (const alias of subject.aliases) {
      if (/^[A-Z0-9][\w-]+$/i.test(alias)) {
        urls.push(`${BH_SEARCH_BASE}?q=${enc(alias)}`);
      }
    }
  }

  // Dedupe while preserving order
  return [...new Set(urls)];
}

// codeCrumb is a B&H DOM element for the product codes
async function scrapeCodeCrumb(page: import("playwright").Page): Promise<{ bhNumber: string | null; mpn: string | null }> {
  try {
    const el = page.locator("xpath=.//div[@data-selenium='codeCrumb']").first();
    if (!await el.isVisible({ timeout: 5000 })) return { bhNumber: null, mpn: null };
    const text = (await el.textContent() ?? "").replace(/\s+/g, " ").trim();
    const bhMatch = text.match(/BH\s*#\s*([A-Z0-9]+)/i);
    const mfrMatch = text.match(/MFR\s*#\s*([A-Z0-9][\w\-]*)/i);
    return {
      bhNumber: bhMatch?.[1] ?? null,
      mpn: mfrMatch?.[1] ?? null,
    };
  } catch {
    return { bhNumber: null, mpn: null };
  }
}

function titleMatches(title: string, subject: RetailSubject, isBodies: boolean): boolean {
  if (isBodies) {
    const base = baseBodyTitleMatches(title, subject as Body);
    if (!base.ok) return false;
    if (looksLikeKit(title)) return false;
    return true;
  }
  const base = baseTitleMatches(title, subject as Lens);
  if (!base.ok) return false;
  const t = title.toLowerCase();
  const junk = ["filter", "lens cap", "hood", "case", "bag", "strap", "bundle", "kit"];
  if (junk.some((j) => t.includes(j))) return false;
  return true;
}

async function scrapeOfficial(page: import("playwright").Page): Promise<boolean> {
  return await page.locator(`xpath=.//div[@data-selenium='authorizeDealerText']`).isVisible();
  // return authorizedText.;
}

// Pull average star rating and total review count out of the header-level
async function scrapeRatingAndCount(
  page: import("playwright").Page,
): Promise<{ starCount?: number; ratingCount?: number }> {
  try {
    const el = page.locator("xpath=.//div[contains(@class, 'metaShare')]//div[contains(@class, 'reviews')]").first();
    if (!(await el.count())) return {};
    const text = (await el.textContent() ?? "").replace(/\s+/g, " ").trim();
    if (!text) return {};

    // TODO: update this to hover on the "{} Reviews" element
    // Then capture the text from the hover element. "4.6 out of 5 stars"
    const ariaRating = await el.locator("xpath=.//div[contains(@class, 'starContainer')]//*[@href='#StarIcon']").all().catch(() => null) ?? [];
    const ariaPartialRating = await el.locator("xpath=.//div[contains(@class, 'starContainer')]//*[contains(@href, '#StarHalfIcon')]").all().catch(() => null) ?? [];
    let starCount = 0;
    if (ariaRating) starCount += ariaRating.length;
    if (ariaPartialRating.length > 0) starCount += 0.5;

    let ratingCount: number | undefined;
    const countMatch = text.match(/(\d[\d,]*)\s*reviews?/i) ?? text.match(/\((\d[\d,]*)\)/);
    if (countMatch) ratingCount = parseInt(countMatch[1].replace(/,/g, ""), 10);

    return {
      starCount: starCount != null && !isNaN(starCount) && starCount > 0 ? starCount : undefined,
      ratingCount: ratingCount != null && !isNaN(ratingCount) && ratingCount > 0 ? ratingCount : undefined,
    };
  } catch {
    return {};
  }
}

// Review section scraping
async function scrapeReviews(page: import("playwright").Page, productId: string, productUrl: string): Promise<ReviewItem[]> {
  const reviews: ReviewItem[] = [];

  try {
    // B&H tucks reviews behind a tab button. Click it to load the reviews
    const reviewBtn = page.locator("xpath=.//a[contains(@class, 'itemBtn')][contains(@href, 'reviews')]").first();
    if (!(await reviewBtn.count())) {
      console.log(`  🔇 no review button — skipping reviews`);
      return reviews;
    }
    await humanClick(page, reviewBtn);
    await page.locator(`xpath=.//div[@data-selenium='reviewsReviewedByCustomers']`).waitFor({ state: "visible", timeout: 5000 });
    const reviewSortBy = page.locator(`xpath=.//option[contains(text(), 'Highest rated')]/parent::select`);
    await reviewSortBy.selectOption('Most Helpful');
    // Jitter the post-sort wait — a fixed 2.5s beat every time is a
    // fingerprint. 2–4.5s random looks more like a human reading.
    const sortWait = 2000 + Math.random() * 2500;
    await page.waitForTimeout(sortWait);
    // locate the review containers
    let reviewContainers = page.locator(`xpath=.//div[@data-selenium='reviewsClientReview']`).all();

    let skippedUnverified = 0;
    let skippedEmpty = 0;
    let skippedNonEnglish = 0;

    if ((await reviewContainers).length > 0) {
      // iterate over top reviews
      let counter = 0;
      for (let review of await reviewContainers) {
        // locate verified buyer
        const isVerified = await review.locator(`xpath=.//span[@data-selenium='reviewsClientReviewVerifiedBuyerText']`).count();
        if (isVerified != 1) {
          console.log(`🚫 ${productId} review ${counter + 1} was not verified, moving along!`);
          skippedUnverified++;
          continue; // move on to next review
        }

        const title = await review.locator(`h4`).textContent().catch(() => "") ?? ""; // potential for title to be blank? probably not
        // check for english
        if (!isEnglish(title)) {
          skippedNonEnglish++;
          console.log(`🌍 ${productId} review ${counter + 1} skipped — non-English: "${title}"`);
          continue;
        }

        //capture the review content
        const content = (await review.locator(`//div[@data-selenium='reviewsClientReviewContent']`).textContent().catch(() => "") ?? "").trim();
        if (!content) {
          skippedEmpty++;
          console.log(`📭 ${productId} review ${counter + 1} had empty content, adios!`);
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
        reviews.push({
          sourceType: "bh",
          productId,
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
        console.log(`${productId} ✓ kept — ${bits} — "${preview}"`);

        counter += 1;
        if (counter >= MAX_REVIEWS) {
          console.log(`⏹️ reached review limit of ${MAX_REVIEWS}, moving on...`);
          break;
        };
      }
    }

    const loadMore = page.locator(`xpath=.//button[@data-selenium='reviewsLoadAll']`);
    if (reviews.length < MAX_REVIEWS && await loadMore.count()) {
      await humanClick(page, loadMore);
      await page.waitForTimeout(sortWait);
      // locate the review containers
      let reviewContainers = page.locator(`xpath=.//div[@data-selenium='reviewsClientReview']`).all();

      let skippedUnverified = 0;
      let skippedEmpty = 0;
      let skippedNonEnglish = 0;
      let counter = reviews.length;

      if ((await reviewContainers).length > 0) {
        // iterate over top reviews
        for (let review of await reviewContainers) {
          // locate verified buyer
          const isVerified = await review.locator(`xpath=.//span[@data-selenium='reviewsClientReviewVerifiedBuyerText']`).count();
          if (isVerified != 1) {
            console.log(`🚫 ${productId} review ${counter + 1} was not verified, moving along!`);
            skippedUnverified++;
            continue; // move on to next review
          }

          const title = await review.locator(`h4`).textContent().catch(() => "") ?? ""; // potential for title to be blank? probably not
          // check for english
          if (!isEnglish(title)) {
            skippedNonEnglish++;
            console.log(`🌍 ${productId} review ${counter + 1} skipped — non-English: "${title}"`);
            continue;
          }

          //capture the review content
          const content = (await review.locator(`//div[@data-selenium='reviewsClientReviewContent']`).textContent().catch(() => "") ?? "").trim();
          if (!content) {
            skippedEmpty++;
            console.log(`📭 ${productId} review ${counter + 1} had empty content, adios!`);
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
          reviews.push({
            sourceType: "bh",
            productId,
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
          console.log(`${productId} ✓ kept — ${bits} — "${preview}"`);

          counter += 1;
          if (counter >= MAX_REVIEWS) {
            console.log(`⏹️ reached review limit of ${MAX_REVIEWS}, moving on...`);
            break;
          };
        }
      }
    }
    // TODO: fetch images from side gallery. not per review but at a higher level than this
  } catch (err) {
    console.log(`  💥 review scrape error: ${err instanceof Error ? err.message : err}`);
  }
  return reviews;
}

// Maps B&H spec table label text to BHProperty keys.
const SPEC_LABEL_MAP: Array<[RegExp, keyof BHProperty]> = [
  [/focal length/i, "focalLength"],
  [/maximum aperture|max aperture/i, "maxAperture"],
  [/minimum aperture|min aperture/i, "minAperture"],
  [/lens mount|mount/i, "mount"],
  [/format compatibility|format/i, "format"],
  [/angle of view/i, "angleOfView"],
  [/minimum focus|close focus/i, "minimumFocusDistance"],
  [/magnification/i, "magnification"],
  [/optical design|lens construction/i, "opticalDesign"],
  [/diaphragm blades|aperture blades/i, "apertureBlades"],
  [/focus type|autofocus type/i, "focusType"],
  [/image stabilization/i, "imageStabilization"],
  [/filter thread|filter size/i, "filterSize"],
  [/dimensions/i, "dimensions"],
  [/weight/i, "weight"],
];

async function scrapeProperties(page: import("playwright").Page): Promise<BHProperty | null> {
  try {
    const specsBtn = page.locator("xpath=.//a[contains(@class, 'itemBtn')][contains(@href, 'specs')]").first();
    if (await specsBtn.count()) {
      await humanClick(page, specsBtn);
      await page.waitForTimeout(1000);
    }

    const pairs: Array<{ label: string; value: string }> = await page.evaluate(() =>
      Array.from(document.querySelectorAll("tr")).flatMap((tr) => {
        const tds = tr.querySelectorAll("td");
        if (tds.length < 2) return [];
        const label = (tds[0].textContent ?? "").trim();
        const value = (tds[1].textContent ?? "").trim();
        return label && value ? [{ label, value }] : [];
      })
    );

    if (!pairs.length) return null;

    const props: BHProperty = {};
    for (const { label, value } of pairs) {
      for (const [pattern, key] of SPEC_LABEL_MAP) {
        if (pattern.test(label)) {
          props[key] = value.trim();
          break;
        }
      }
    }

    return Object.keys(props).length ? props : null;
  } catch (err) {
    console.log(`  💥 spec scrape error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
// Lens product image — B&H renders the main product photo inside
// .mainImageContainer on the product page.
async function scrapeProductImage(page: import("playwright").Page): Promise<string | null> {
  try {
    const img = page.locator("xpath=.//div[contains(@class, 'mainImageContainer')]//img").first();
    if (await img.count() === 0) return null;
    const src = await img.getAttribute("src");
    return src || null;
  } catch {
    return null;
  }
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

// Scrape everything off a product page that's already loaded. Shared by the
// search-and-click path and the "we already know the URL" fast path.
async function scrapeBhProductPage(
  page: import("playwright").Page,
  subject: RetailSubject,
  matchedTitle: string,
): Promise<BhScrapeResult | null> {
  const productUrl = page.url();
  const { bhNumber, mpn: scrapedMpn } = await scrapeCodeCrumb(page);
  if (!bhNumber) {
    console.log(`  🤦 could not find BH# on ${productUrl}`);
    return null;
  }

  const mpnCheck = checkMpn(scrapedMpn, subject);
  if (mpnCheck.ok === true) console.log(`  ✓ MPN verified: ${mpnCheck.mpn}`);
  else if (mpnCheck.ok === "unverified") console.log(`  ~ MPN captured for backfill: ${mpnCheck.mpn}`);
  else if (mpnCheck.ok === false && mpnCheck.reason === "mismatch") logMpnMismatch(subject.id, "bh", mpnCheck.lensModel, mpnCheck.scrapedMpn);
  else console.log(`  ⚠ MPN not found in codeCrumb — relying on title match only`);
  const mpn = scrapedMpn ?? undefined;

  const [price, official, rating, productImage] = await Promise.all([
    scrapePrice(page),
    scrapeOfficial(page),
    scrapeRatingAndCount(page),
    scrapeProductImage(page),
  ]);

  const ratingBits = rating.starCount != null
    ? `${rating.starCount}★ - ${rating.ratingCount != null ? ` (${rating.ratingCount})` : ""}`
    : "no rating";
  console.log(`  💰 BH # ${bhNumber} — price: ${price != null ? `$${price}` : "not found"} — ${official ? "✓ official" : "not official"} — ${ratingBits} — image: ${productImage ? "✓" : "not found"}\n`);
  console.log(` 📖 checking reviews for ${subject.id}`);
  const reviews = await scrapeReviews(page, subject.id, productUrl);

  // Capturing images — they live in the reviews sidebar, so do it after the
  // reviews tab has been opened (scrapeReviews clicks it for us).
  const images = await page.locator(`xpath=.//div[@data-selenium='reviewsCustomerPhotosSidebar']//img`).all().catch(() => null) ?? [];
  const bhEntryImages: string[] = [];
  for (let image of images) {
    const src = await image.getAttribute('src');
    if (src) bhEntryImages.push(src);
  }
  console.log(` 🖼️  found ${bhEntryImages.length} images in review section for ${subject.id} \n`);

  const entry: BHEntry = {
    bhNumber,
    url: productUrl,
    title: matchedTitle.trim(),
    official,
    images: bhEntryImages,
  };
  if (productImage) entry.productImage = productImage;
  const bhProperties = await scrapeProperties(page);
  if (bhProperties) entry.properties = bhProperties;
  if (mpn) entry.mpn = mpn;

  if (price != null) {
    entry.price = price;
    entry.priceScrapedAt = new Date().toISOString();
  }
  if (rating.starCount != null) entry.starCount = rating.starCount;
  if (rating.ratingCount != null) entry.ratingCount = rating.ratingCount;

  return { entry, reviews };
}

async function saveScreenshot(page: import("playwright").Page, productId: string, label: string): Promise<void> {
  try {
    mkdirSync("output/screenshots", { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `output/screenshots/bh-${productId}-${label}-${ts}.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`  📸 screenshot → ${path}`);
  } catch (err) {
    console.log(`  ⚠ screenshot failed: ${err instanceof Error ? err.message : err}`);
  }
}

// Core per-subject scraper. Returns null when no matching product is found. No
// side-effects — callers decide what to persist. Shared by `main()` below and
// the smoke test in bh-scrape-test.ts.
export async function scrapeBhLens(
  page: import("playwright").Page,
  subject: RetailSubject,
  isBodies = false,
): Promise<BhScrapeResult | null> {
  // Fast path — known product URL, skip search entirely. If the page fails
  // to render (captcha, redirect, discontinued SKU, …), fall through to the
  // search flow instead of giving up on the subject.
  if (subject.bh?.url) {
    console.log(`  ⚡ product URL cached — skipping search 🚀`);
    console.log(`  🎯 → navigating direct to ${subject.bh.url}`);
    await page.goto(subject.bh.url, { waitUntil: "domcontentloaded" });
    await readingDelay();
    try {
      await page.locator(`xpath=.//div[@data-selenium='apertureModuleProductDetail']/div[contains(@class, 'container')]`).waitFor({ state: "visible", timeout: 25000 });
      await page.waitForLoadState("domcontentloaded");
      return await scrapeBhProductPage(page, subject, subject.bh.title ?? `${subject.brand} ${subject.name}`);
    } catch {
      await saveScreenshot(page, subject.id, "direct-nav-fail");
      console.log(`  ✗ product page did not render — 🔁 falling back to search`);
      // fall through to search path
    }
  }

  type Locator = import("playwright").Locator;

  // Scans the current search results page for a matching product link.
  // Returns [element, title] on match, null if nothing on this page fits.
  async function tryFindOnPage(): Promise<[Locator, string] | null> {
    const hasResults = await page
      .locator("[data-selenium='miniProductPage'], [data-selenium='productItem'], [class*='productItem']")
      .first()
      .waitFor({ state: "visible", timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!hasResults) return null;

    // Primary: miniProductPage anchor containing subject name
    const xpathEl = page.locator(`xpath=.//*[@data-selenium='miniProductPage']//*[contains(text(), '${subject.name}')]/parent::a`).first();
    if (await xpathEl.isVisible({ timeout: 3000 }).catch(() => false)) {
      const titleText = await xpathEl.textContent({ timeout: 1000 }).catch(() => "");
      if (titleText && titleMatches(titleText, subject, isBodies)) {
        console.log(`  🎯 → matched via miniProductPage anchor: "${titleText.slice(0, 70)}"`);
        return [xpathEl, titleText];
      }
      console.log(`  ⚠️  miniProductPage anchor found but titleMatches failed: "${titleText?.slice(0, 60)}"`);
    }

    // Scan productItem cards
    const items = page.locator("[data-selenium='productItem'], [class*='productItem']");
    const count = await items.count();
    console.log(`  🔎 → scanning ${count} product cards`);
    for (let i = 0; i < Math.min(count, 8); i++) {
      const item = items.nth(i);
      const titleEl = item.locator("[data-selenium='productTitle'], [class*='title']").first();
      const titleText = await titleEl.textContent({ timeout: 1000 }).catch(() => "");
      if (!titleText || !titleMatches(titleText, subject, isBodies)) {
        console.log(`  ⏭  skipped: "${titleText?.slice(0, 60)}"`);
        continue;
      }
      console.log(`  🎯 → matched via product card: "${titleText.slice(0, 70)}"`);
      return [titleEl, titleText];
    }

    // miniProductPageName h3 → span
    const h3Items = await page.locator(`.xpath=.//h3[@data-selenium='miniProductPageName']`).all().catch(() => null) ?? [];
    for (let i = 0; i < Math.min(h3Items.length, 8); i++) {
      const titleText = await h3Items[i].locator("span").textContent({ timeout: 1000 }).catch(() => "");
      if (!titleText || !titleMatches(titleText, subject, isBodies)) {
        console.log(`  ⏭  skipped: "${titleText?.slice(0, 60)}"`);
        continue;
      }
      console.log(`  🎯 → matched via h3 span: "${titleText.slice(0, 70)}"`);
      return [h3Items[i], titleText];
    }

    // Last resort: any element whose text contains brand + name
    const textItems = await page.locator(`.xpath=.//*[contains(text(), '${subject.brand.trim()} ${subject.name.trim()}')]`).all().catch(() => null) ?? [];
    if (textItems.length > 0) {
      const matchedTitle = `${subject.brand.trim()} ${subject.name.trim()}`;
      console.log(`  🎯 → matched via text search: "${matchedTitle}"`);
      return [textItems[0], matchedTitle];
    }

    return null;
  }

  const searchUrls = buildSearchUrls(subject);
  console.log(`  🔍 searching B&H (${searchUrls.length} queries)`);

  let matchedEl: Locator | null = null;
  let matchedTitle = "";

  for (let i = 0; i < searchUrls.length; i++) {
    const url = searchUrls[i];
    console.log(`  🌐 [${i + 1}/${searchUrls.length}] → ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await readingDelay();

    const found = await tryFindOnPage();
    if (found) {
      [matchedEl, matchedTitle] = found;
      break;
    }
    console.log(`  ✗ no match on this query`);
  }

  if (!matchedEl) return null;

  // clicking into a product
  await humanClick(page, matchedEl);
  const productPageContainer = page.locator(`xpath=.//div[@data-selenium='apertureModuleProductDetail']/div[contains(@class, 'container')]`);

  try {
    await productPageContainer.waitFor({ state: "visible", timeout: 15000 });
  } catch {
    await saveScreenshot(page, subject.id, "product-page-fail");
    console.log(`  ✗ product page did not render after search click`);
    return null;
  }
  await page.waitForLoadState("domcontentloaded");

  const result = await scrapeBhProductPage(page, subject, matchedTitle);
  if (!result) await saveScreenshot(page, subject.id, "scrape-fail");
  return result;
}

export async function launchBhContext() {
  const handle = await launchChromiumContext({
    stealth: true,
    profileDir: ".browser-profile-bh",
    headless: true,
  });
  return { context: handle.context, page: handle.page };
}

export { randomDelay, readingDelay };

async function main() {
  const isBodies = process.argv.includes("--bodies");
  const sourceFile = isBodies ? "bodies.json" : LENSES_FILE;
  const subjects: RetailSubject[] = JSON.parse(readFileSync(sourceFile, "utf8"));
  console.log(`Mode: ${isBodies ? "bodies" : "lenses"} — ${subjects.length} subjects from ${sourceFile}`);

  let succeeded = 0;
  let failed = 0;

  for (const subject of subjects) {
    console.log(`\n📸 [${succeeded + failed + 1}/${subjects.length}] ${subject.brand} ${subject.name}`);

    if (subject.discontinued) {
      console.log(`  ⏭ discontinued — skipping price/retailer scrape`);
      failed++;
      continue;
    }

    rmSync(".browser-profile-bh", { recursive: true, force: true });
    const { context, page } = await launchBhContext();
    try {
      const result = await scrapeBhLens(page, subject, isBodies);
      if (!result) {
        console.log(`  🤷 no matching result found — skipping`);
        failed++;
      } else {
        const subjectEntry = subjects.find((s) => s.id === subject.id)!;
        subjectEntry.bh = result.entry;
        writeFileSync(sourceFile, JSON.stringify(subjects, null, 2));
        if (result.entry.price != null) recordPrice(subject.id, "bh", result.entry.price, result.entry.priceScrapedAt!);
        console.log(`  ✓ saved to ${sourceFile}`);

        if (result.reviews.length > 0) {
          saveReviews(subject.id, "bh", result.reviews);
          console.log(`  ✓ saved ${result.reviews.length} verified review${result.reviews.length === 1 ? "" : "s"} to reviews.json`);
        }

        succeeded++;
      }
    } catch (err) {
      console.log(`  💥 error: ${err instanceof Error ? err.message : err}`);
      failed++;
    } finally {
      await context.close();
    }

    await randomDelay();
  }

  console.log(`\n🏁 Done. ${succeeded} succeeded, ${failed} failed.`);
  console.log("🔄 Re-run anytime to fill in failures.");
}

// Only run main() when invoked as a CLI, not when imported by the smoke test.
import { fileURLToPath } from "url";
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
