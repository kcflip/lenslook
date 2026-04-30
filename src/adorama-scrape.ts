// Adorama scraper. Design notes:
// - Product pages embed a full schema.org Product JSON-LD with sku, mpn,
//   name, image, description, aggregateRating, offers[].price, and review[]
//   (top 5). We parse that block instead of scraping DOM selectors — much
//   less fragile than BH/Amazon.
// - Search is SPA-rendered at /l/?searchinfo=…. Tiles are [data-sku] wrappers
//   with <div class="Products_title__*"><a …></a></div> inside.
// - Adorama sits behind PerimeterX. The /l/ search page is guarded more
//   aggressively than product pages. Empty HTML (~4kb) + title "Access to
//   this page has been denied" → captcha wall; we detect and bail.
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "fs";
import type { Lens, Body, RetailSubject, AdoramaEntry, ReviewItem } from "../shared/types.js";
import { recordPrice } from "./price-history.js";
import { saveReviews, isEnglish } from "./reviews.js";
import { launchChromiumContext, randomDelay, baseTitleMatches, baseBodyTitleMatches, looksLikeKit, checkMpn, logMpnMismatch, humanScroll, MAX_REVIEWS } from "./scraper-shared.js";
import { searchAndNavigate } from "./search.js";

const LENSES_FILE = "lenses.json";
// Drop your exported browser cookies here. Chrome DevTools: Application →
// Cookies → right-click domain → "Copy all as JSON" (or use a cookie export
// extension). The file must be a JSON array of cookie objects with at least
// { name, value, domain, path, expires } fields.
const ADORAMA_COOKIES_FILE = "adorama-cookies.json";
// Searchsite URL redirects to the SPA at /l/?searchinfo=... — we start here
// because it's the only shape we saw render product tiles reliably. The
// `sel=Item-Condition_New-Items` filter drops used inventory from results.
const ADORAMA_SEARCH_BASE = "https://www.adorama.com/searchsite/default.aspx";

function buildSearchUrl(subject: RetailSubject): string {
  const q = `${subject.brand} ${subject.name}`;
  const params = new URLSearchParams({
    searchinfo: q,
    sel: "Item-Condition_New-Items",
  });
  return `${ADORAMA_SEARCH_BASE}?${params.toString()}`;
}

// Reject used/open-box/refurbished listings even though the New-Items filter
// should exclude them — search result dedupe is imperfect and we've seen
// `sola*` SKUs (Sony used) slip through.
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
  const junk = ["used ", "open box", "open-box", "refurbished", "renewed", "bundle", "kit"];
  if (junk.some((j) => t.includes(j))) return false;
  return true;
}

// Schema.org Product JSON-LD shape. Adorama embeds the full product record
// (including rating + top reviews + offer price) in one block — our whole
// scraper hinges on parsing this.
interface ProductLd {
  "@type": string;
  sku?: string;
  mpn?: string;
  name?: string;
  image?: string | string[];
  description?: string;
  aggregateRating?: { ratingValue?: string | number; reviewCount?: string | number };
  offers?: Array<{ price?: string | number; priceCurrency?: string; url?: string; availability?: string }> | {
    price?: string | number; priceCurrency?: string; url?: string; availability?: string;
  };
  review?: Array<{
    name?: string;
    description?: string;
    datePublished?: string;
    author?: { name?: string };
    reviewRating?: { ratingValue?: string | number };
  }>;
}

// Heuristic check for PerimeterX's "Access Denied" bot challenge page. Cheaper
// than scanning the full body and more specific than just checking for empty
// content (which could also be a hydration lag).
async function isPxCaptcha(page: import("playwright").Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  if (/access to this page has been denied/i.test(title)) return true;
  const metaDesc = await page.locator("meta[name='description']").first()
    .getAttribute("content")
    .catch(() => null);
  return metaDesc === "px-captcha";
}

async function extractProductLd(page: import("playwright").Page): Promise<ProductLd | null> {
  const blocks = await page.locator("script[type='application/ld+json']").allTextContents();
  for (const raw of blocks) {
    try {
      const parsed = JSON.parse(raw) as ProductLd | ProductLd[];
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && item["@type"] === "Product") return item;
      }
    } catch {
      // Some blocks aren't well-formed JSON (Adorama occasionally emits
      // single-object-per-line variants). Skip and keep scanning.
    }
  }
  return null;
}

function toNumber(v: string | number | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return isNaN(n) ? null : n;
}

function firstOffer(ld: ProductLd): { price?: number; url?: string } {
  const offers = ld.offers;
  if (!offers) return {};
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (!first) return {};
  const price = toNumber(first.price ?? undefined);
  return {
    price: price != null && price > 0 ? price : undefined,
    url: first.url,
  };
}

export interface AdoramaScrapeResult {
  entry: AdoramaEntry;
  reviews: ReviewItem[];
}

// Turn a ProductLd block + loaded page into an AdoramaEntry + reviews. The
// JSON-LD carries everything we need except image gallery — main image is in
// `image`, rest stay in the DOM (out of scope for the stub).
async function scrapeAdoramaProductPage(
  page: import("playwright").Page,
  subject: RetailSubject,
  matchedTitle: string,
): Promise<AdoramaScrapeResult | null> {
  const productUrl = page.url();
  const ld = await extractProductLd(page);
  if (!ld) {
    console.log(`  ✗ no Product JSON-LD on ${productUrl}`);
    return null;
  }

  const sku = ld.sku ?? "";
  if (!sku) {
    console.log(`  ✗ Product JSON-LD missing sku`);
    return null;
  }

  const scrapedMpn = (ld.mpn ?? "").trim() || null;
  const mpnCheck = checkMpn(scrapedMpn, subject);
  if (mpnCheck.ok === true) console.log(`  ✓ MPN verified: ${mpnCheck.mpn}`);
  else if (mpnCheck.ok === "unverified") console.log(`  ~ MPN captured for backfill: ${mpnCheck.mpn}`);
  else if (mpnCheck.ok === false && mpnCheck.reason === "mismatch") logMpnMismatch(subject.id, "adorama", mpnCheck.lensModel, mpnCheck.scrapedMpn);
  else console.log(`  ⚠ no MPN in JSON-LD — relying on title match only`);
  const mpn = scrapedMpn ?? undefined;

  const { price, url: offerUrl } = firstOffer(ld);
  const starCount = toNumber(ld.aggregateRating?.ratingValue ?? undefined) ?? undefined;
  const ratingCount = toNumber(ld.aggregateRating?.reviewCount ?? undefined) ?? undefined;

  const mainImage = Array.isArray(ld.image) ? ld.image[0] : ld.image;
  const images: string[] = mainImage ? [mainImage] : [];

  const ratingBits = starCount != null
    ? `${starCount}★${ratingCount != null ? ` (${ratingCount})` : ""}`
    : "no rating";
  console.log(`  💰 SKU ${sku} — price: ${price != null ? `$${price}` : "not found"} — ${ratingBits}\n`);

  const entry: AdoramaEntry = {
    sku,
    url: offerUrl ?? productUrl,
    title: (ld.name ?? matchedTitle).trim(),
    official: true,
    images,
  };
  if (mpn) entry.mpn = mpn;
  if (price != null) {
    entry.price = price;
    entry.priceScrapedAt = new Date().toISOString();
  }
  if (starCount != null) entry.starCount = starCount;
  if (ratingCount != null) entry.ratingCount = ratingCount;

  // Scrape per-review ratings from TurnTo DOM widget — one element per review
  // container in DOM order, matching the JSON-LD review array positionally.
  const domRatings = await page.evaluate((): (number | null)[] => {
    return Array.from(document.querySelectorAll('div[class*="tt-c-review__rating"]'))
      .map(el => {
        const m = (el.textContent ?? '').match(/Rated\s+(\d+(?:\.\d+)?)\s+out\s+of/i);
        return m ? parseFloat(m[1]) : null;
      });
  }).catch((): (number | null)[] => []);

  const reviews: ReviewItem[] = [];
  for (const [i, r] of (ld.review ?? []).entries()) {
    if (reviews.length >= MAX_REVIEWS) {
      console.log(`  ⏹️ reached review limit of ${MAX_REVIEWS}, moving on...`);
      break;
    }
    const text = (r.description ?? "").trim();
    if (!text) continue;
    if (!isEnglish(text)) {
      console.log(`  🌍 skipped non-English review by ${r.author?.name ?? "anon"}`);
      continue;
    }
    const review: ReviewItem = {
      sourceType: "adorama",
      productId: subject.id,
      text,
      images: [],
      date: r.datePublished,
      url: productUrl,
    };
    const rating = toNumber(r.reviewRating?.ratingValue ?? undefined) ?? domRatings[i] ?? null;
    if (rating != null) review.rating = rating;
    reviews.push(review);

    const preview = text.length > 60 ? text.slice(0, 57) + "…" : text;
    console.log(`  ✓ review — ${r.author?.name ?? "anon"}: "${preview}"`);
  }

  return { entry, reviews };
}

// Core per-subject scraper. Mirrors scrapeBhLens / scrapeAmazonLens semantics —
// returns null on no match, "captcha" when PX blocks the final fallback search
// (so main() can restart the session and retry), otherwise the entry + reviews.
export async function scrapeAdoramaLens(
  page: import("playwright").Page,
  subject: RetailSubject,
  isBodies = false,
): Promise<AdoramaScrapeResult | null | "captcha"> {
  // Fast path — known product URL, skip search entirely.
  // Skip guessed entries (title-match only) so we re-run the search and get a chance at MPN confirmation.
  if (subject.adorama?.url && !subject.adorama.guessed) {
    console.log(`  ⚡ product URL cached — skipping search 🚀`);
    console.log(`  🎯 → navigating direct to ${subject.adorama.url}`);
    try {
      await page.goto(subject.adorama.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (await isPxCaptcha(page)) {
        console.log(`  🛑 PerimeterX captcha on product page — 🔁 falling back to search`);
      } else {
        // JSON-LD lands with the HTML — no need to wait for SPA hydration.
        const ld = await extractProductLd(page);
        if (ld) {
          return await scrapeAdoramaProductPage(page, subject, subject.adorama.title ?? `${subject.brand} ${subject.name}`);
        }
        console.log(`  ✗ no Product JSON-LD on cached URL — 🔁 falling back to search`);
      }
    } catch (e) {
      console.log(`  ✗ cached URL failed (${e instanceof Error ? e.message : e}) — 🔁 falling back to search`);
    }
  }

  // Organic search — Google first, DDG fallback. Bypasses Adorama's /l/ SPA
  // which is more aggressively captcha-guarded, and lands with a genuine
  // search referer.
  const organicUrl = await searchAndNavigate(
    page,
    `${subject.brand} ${subject.name}`,
    {
      domain: "adorama.com",
      fallback: true,
      urlFilter: (url) => !url.includes("/l/") && !url.includes("searchsite"),
    },
  );
  if (organicUrl) {
    await page.waitForTimeout(1500);
    if (await isPxCaptcha(page)) {
      console.log(`  🛑 PerimeterX captcha after organic nav — 🔁 falling back to Adorama search`);
    } else {
      const result = await scrapeAdoramaProductPage(page, subject, `${subject.brand} ${subject.name}`);
      if (result) return result;
      console.log(`  ✗ organic result didn't scrape — 🔁 falling back to Adorama search`);
    }
  }

  // Final fallback — Adorama's own SPA search.
  const searchUrl = buildSearchUrl(subject);
  console.log(`  🔍 searching Adorama`);
  console.log(`  → ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Retail SPA needs a beat before it flips from skeleton to real content.
  // Known failure modes:
  //   1. Brief hydration lag — tiles appear within ~6s.
  //   2. PerimeterX "Press & Hold" captcha — Adorama guards /l/ more
  //      aggressively than product pages. Detected via the meta description
  //      `px-captcha` or `<title>Access to this page has been denied</title>`.
  //      No bypass implemented; we flag and bail so main() keeps going.
  if (await isPxCaptcha(page)) {
    console.log(`  🛑 PerimeterX captcha on search — 🔁 reload`);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    if (await isPxCaptcha(page)) {
      console.log(`  ✗ captcha persisted — signalling for session restart`);
      return "captcha";
    }
  }
  let hydrated = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.locator("[data-sku] [class*='Products_title'] a").first()
        .waitFor({ state: "attached", timeout: 12000 });
      hydrated = true;
      break;
    } catch {
      console.log(`  ↺ tiles not hydrated on attempt ${attempt + 1} — reloading`);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      if (await isPxCaptcha(page)) {
        console.log(`  ✗ captcha after reload — signalling for session restart`);
        return "captcha";
      }
    }
  }
  if (!hydrated) {
    console.log(`  ✗ search page never hydrated any [data-sku] tiles`);
    return null;
  }
  await humanScroll(page, 600);
  await page.waitForTimeout(1500);

  // Each tile is a [data-sku] wrapper. Inside it, a <div class="Products_title__*">
  // wraps the title anchor. Link goes to /.../p/{lower-sku}. Pull the first
  // match that passes titleMatches.
  const cards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("[data-sku]")).slice(0, 12).map((card) => {
      const titleAnchor = card.querySelector(
        "[class*='Products_title'] a",
      ) as HTMLAnchorElement | null;
      return {
        sku: card.getAttribute("data-sku") ?? "",
        href: titleAnchor?.href ?? "",
        title: (titleAnchor?.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    });
  });
  console.log(`  🃏 → ${cards.length} candidate tiles`);

  let matchedHref = "";
  let matchedTitle = "";
  for (const card of cards) {
    if (!card.title || !card.href) continue;
    if (!titleMatches(card.title, subject, isBodies)) {
      console.log(`  ⏭  skipped: "${card.title.slice(0, 60)}"`);
      continue;
    }
    matchedHref = card.href;
    matchedTitle = card.title;
    console.log(`  🎯 → matched: "${card.title.slice(0, 70)}" (sku=${card.sku})`);
    break;
  }

  if (!matchedHref) return null;

  await page.goto(matchedHref, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500);
  return await scrapeAdoramaProductPage(page, subject, matchedTitle);
}

export async function launchAdoramaContext() {
  const handle = await launchChromiumContext({
    stealth: true,
    profileDir: ".browser-profile-adorama",
    headless: true,
  });
  return { context: handle.context, page: handle.page };
}

export { randomDelay };

async function injectCookies(context: import("playwright").BrowserContext): Promise<void> {
  if (!existsSync(ADORAMA_COOKIES_FILE)) {
    console.log(`  ℹ  no ${ADORAMA_COOKIES_FILE} found — running without injected cookies`);
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(ADORAMA_COOKIES_FILE, "utf8"));
  } catch (e) {
    console.log(`  ⚠  failed to parse ${ADORAMA_COOKIES_FILE}: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    console.log(`  ⚠  ${ADORAMA_COOKIES_FILE} must be a non-empty JSON array`);
    return;
  }

  const nowSec = Date.now() / 1000;
  const WARN_WITHIN_SEC = 24 * 60 * 60;
  let anyExpired = false;
  let anySoon = false;

  const cookies: import("playwright").Cookie[] = raw.map((c: Record<string, unknown>) => {
    const expires = typeof c.expires === "number" ? c.expires : -1;
    const name = String(c.name ?? "");

    if (expires === -1) {
      console.log(`  🍪 ${name} — session cookie`);
    } else {
      const d = new Date(expires * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
      if (expires < nowSec) {
        console.log(`  🔴 ${name} — EXPIRED ${d}`);
        anyExpired = true;
      } else if (expires - nowSec < WARN_WITHIN_SEC) {
        console.log(`  🟡 ${name} — expires soon ${d}`);
        anySoon = true;
      } else {
        console.log(`  🍪 ${name} — valid until ${d}`);
      }
    }

    return {
      name,
      value: String(c.value ?? ""),
      domain: String(c.domain ?? ""),
      path: String(c.path ?? "/"),
      expires,
      httpOnly: Boolean(c.httpOnly ?? false),
      secure: Boolean(c.secure ?? false),
      sameSite: (["Strict", "Lax", "None"].includes(String(c.sameSite)) ? c.sameSite : "None") as "Strict" | "Lax" | "None",
    };
  });

  if (anyExpired) {
    console.log(`\n  ⚠️  WARNING: Expired cookies detected — Adorama will likely captcha. Export fresh cookies and replace ${ADORAMA_COOKIES_FILE}.\n`);
  } else if (anySoon) {
    console.log(`\n  🟡  Some cookies expire within 24 h — consider refreshing ${ADORAMA_COOKIES_FILE} soon.\n`);
  }

  await context.addCookies(cookies);
  console.log(`  ✓ injected ${cookies.length} cookie${cookies.length === 1 ? "" : "s"} from ${ADORAMA_COOKIES_FILE}\n`);
}

async function launchSession() {
  const handle = await launchAdoramaContext();
  await injectCookies(handle.context);
  return handle;
}

// Pause the run and ask the user to drop fresh cookies into adorama-cookies.json.
// Called when we've seen CAPTCHA_STREAK_LIMIT consecutive captcha signals —
// a reliable sign that the current session cookies are dead.
async function promptForCookieRefresh(): Promise<void> {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<void>((resolve) => {
    rl.question(
      `\n🚨  4 consecutive captchas — Adorama cookies are likely expired.\n` +
      `    Update ${ADORAMA_COOKIES_FILE} with fresh cookies, then press Enter to retry…\n> `,
      () => { rl.close(); resolve(); },
    );
  });
}

const CAPTCHA_STREAK_LIMIT = 4;

// Shared run loop — takes any slice of the subjects array and scrapes each one,
// writing results back to sourceFile incrementally. Exported so targeted scripts
// (e.g. adorama-scrape-missing.ts) can reuse the same captcha-handling and
// session-restart logic without duplicating it. Defaults keep existing callers
// unchanged (lens mode, lenses.json).
export async function runAdoramaRun(subjects: RetailSubject[], sourceFile = LENSES_FILE, isBodies = false): Promise<void> {
  // Reload the full subject list so we can write back by id — the caller may
  // have passed a filtered subset, but we always persist against the complete file.
  const allSubjects: RetailSubject[] = JSON.parse(readFileSync(sourceFile, "utf8"));

  let { context, page } = await launchSession();

  let succeeded = 0;
  let failed = 0;
  let consecutiveCaptchas = 0;
  let streakStartIndex = 0;

  const startTime = Date.now();
  try {
    let i = 0;
    while (i < subjects.length) {
      const subject = subjects[i];
      console.log(`\n📸 [${succeeded + failed + 1}/${subjects.length}] ${subject.brand} ${subject.name}`);

      if (subject.discontinued) {
        console.log(`  ⏭ discontinued — skipping price/retailer scrape`);
        failed++;
        i++;
        continue;
      }

      try {
        let result = await scrapeAdoramaLens(page, subject, isBodies);

        if (result === "captcha") {
          if (consecutiveCaptchas === 0) streakStartIndex = i;
          consecutiveCaptchas++;
          console.log(`  ⚠ captcha streak: ${consecutiveCaptchas}/${CAPTCHA_STREAK_LIMIT}`);

          if (consecutiveCaptchas >= CAPTCHA_STREAK_LIMIT) {
            await promptForCookieRefresh();
            consecutiveCaptchas = 0;
            await context.close();
            ({ context, page } = await launchSession());
            i = streakStartIndex;
            continue;
          }

          console.log(`  🔄 restarting browser session and retrying…`);
          await context.close();
          ({ context, page } = await launchSession());
          result = await scrapeAdoramaLens(page, subject, isBodies);

          if (result === "captcha") {
            consecutiveCaptchas++;
            console.log(`  ⚠ captcha streak: ${consecutiveCaptchas}/${CAPTCHA_STREAK_LIMIT}`);

            if (consecutiveCaptchas >= CAPTCHA_STREAK_LIMIT) {
              await promptForCookieRefresh();
              consecutiveCaptchas = 0;
              await context.close();
              ({ context, page } = await launchSession());
              i = streakStartIndex;
              continue;
            }

            console.log(`  ✗ captcha again after restart — giving up on this subject`);
            result = null;
          } else {
            consecutiveCaptchas = 0;
          }
        } else {
          consecutiveCaptchas = 0;
        }

        if (!result) {
          console.log(`  🤷 no matching result found — skipping`);
          failed++;
        } else {
          const subjectEntry = allSubjects.find((s) => s.id === subject.id)!;
          subjectEntry.adorama = result.entry;
          writeFileSync(sourceFile, JSON.stringify(allSubjects, null, 2));
          if (result.entry.price != null) recordPrice(subject.id, "adorama", result.entry.price, result.entry.priceScrapedAt!);
          console.log(`  ✓ saved to ${sourceFile}`);

          if (result.reviews.length > 0) {
            saveReviews(subject.id, "adorama", result.reviews);
            console.log(`  ✓ saved ${result.reviews.length} review${result.reviews.length === 1 ? "" : "s"} to reviews.json`);
          }

          succeeded++;
        }
      } catch (err) {
        console.log(`  💥 error: ${err instanceof Error ? err.message : err}`);
        failed++;
      }

      await randomDelay();
      i++;
    }
  } finally {
    await context.close();
  }

  const elapsed = Date.now() - startTime;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  console.log(`\n🏁 Done. ${succeeded} succeeded, ${failed} failed. ⏱ ${mins}m ${secs}s`);
  console.log("🔄 Re-run anytime to fill in failures.");
}

async function main(isBodies: boolean) {
  const sourceFile = isBodies ? "bodies.json" : LENSES_FILE;
  const subjects: RetailSubject[] = JSON.parse(readFileSync(sourceFile, "utf8"));
  console.log(`Mode: ${isBodies ? "bodies" : "lenses"} — ${subjects.length} subjects from ${sourceFile}`);
  await runAdoramaRun(subjects, sourceFile, isBodies);
}

import { fileURLToPath } from "url";
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const hasLenses = process.argv.includes("--lenses");
  const hasBodies = process.argv.includes("--bodies");
  const run = hasLenses ? main(false)
    : hasBodies ? main(true)
    : main(false).then(() => main(true));
  run.catch((err) => { console.error(err); process.exit(1); });
}
