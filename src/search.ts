import { mkdirSync } from "fs";
import type { Page } from "playwright";

export interface SearchOptions {
  domain: string;
  engine?: "google" | "duckduckgo";
  // Auto-retry with DuckDuckGo if Google returns a CAPTCHA/block page.
  fallback?: boolean;
  // Optional predicate to reject URLs that match the domain but aren't product
  // pages (e.g. retailer search SPAs, category pages). Applied after domain
  // filtering on SERP results.
  urlFilter?: (url: string) => boolean;
}

const SCREENSHOTS_DIR = "output/screenshots";

export async function saveSearchScreenshot(page: Page, label: string): Promise<void> {
  try {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `${SCREENSHOTS_DIR}/search-${label}-${ts}.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`  📸 screenshot → ${path}`);
  } catch (err) {
    console.log(`  ⚠ screenshot failed: ${err instanceof Error ? err.message : err}`);
  }
}

function buildSearchUrl(query: string, engine: "google" | "duckduckgo"): string {
  const q = encodeURIComponent(query);
  return engine === "google"
    ? `https://www.google.com/search?q=${q}&hl=en&gl=us`
    : `https://duckduckgo.com/?q=${q}&ia=web`;
}

async function isBlocked(page: Page, engine: "google" | "duckduckgo"): Promise<boolean> {
  const url = page.url();
  // Google redirects to /sorry/... for unusual traffic
  if (engine === "google" && url.includes("google.com/sorry")) return true;
  const title = await page.title().catch(() => "");
  if (engine === "google") return /unusual traffic|captcha|robot/i.test(title);
  return /blocked|access denied|captcha/i.test(title);
}

async function extractFirstResult(
  page: Page,
  engine: "google" | "duckduckgo",
  domain: string,
  urlFilter?: (url: string) => boolean,
): Promise<string | null> {
  // Wait for the results container before scanning
  const waitSel = engine === "google" ? "#search" : '[data-testid="result"], .result';
  try {
    await page.waitForSelector(waitSel, { timeout: 10000 });
  } catch {
    return null;
  }

  const hrefs: string[] = await page.evaluate(
    ({ engine, domain }: { engine: string; domain: string }) => {
      if (engine === "google") {
        return Array.from(document.querySelectorAll("#search a[href]"))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter(
            (h) => h.startsWith("https://") && h.includes(domain) && !h.includes("/search?"),
          );
      }
      // DDG has rearranged their selectors across multiple redesigns — try in order
      for (const sel of ['[data-testid="result-title-a"]', ".result__a", "#links a[href]"]) {
        const matches = Array.from(document.querySelectorAll(sel))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => h.startsWith("https://") && h.includes(domain));
        if (matches.length) return matches;
      }
      return [];
    },
    { engine, domain },
  );

  const candidates = urlFilter ? hrefs.filter(urlFilter) : hrefs;
  return candidates[0] ?? null;
}

// Searches for a product on Google (or DuckDuckGo) using a `site:` operator,
// navigates to the first matching result with the search page as Referer, and
// returns the final URL. Returns null on CAPTCHA, no results, or nav failure.
// On Google CAPTCHA with fallback=true, retries once with DuckDuckGo.
export async function searchAndNavigate(
  page: Page,
  query: string,
  opts: SearchOptions,
): Promise<string | null> {
  const { domain, engine = "google", fallback = false, urlFilter } = opts;
  const fullQuery = `${query} site:${domain}`;

  async function attempt(eng: "google" | "duckduckgo"): Promise<string | null> {
    const searchUrl = buildSearchUrl(fullQuery, eng);
    const label = `${eng}-${domain.replace(/\./g, "-")}`;
    console.log(`  🔍 ${eng}: ${fullQuery}`);
    console.log(`  → ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Brief pause — search engine SPAs need a beat to render results
      await page.waitForTimeout(2000);
    } catch (err) {
      console.log(`  ✗ ${eng} navigation failed: ${err instanceof Error ? err.message : err}`);
      await saveSearchScreenshot(page, `${label}-nav-fail`);
      return null;
    }

    if (await isBlocked(page, eng)) {
      console.log(`  🛑 ${eng} captcha/block`);
      await saveSearchScreenshot(page, `${label}-captcha`);
      return null;
    }

    const targetUrl = await extractFirstResult(page, eng, domain, urlFilter);
    if (!targetUrl) {
      console.log(`  ✗ no ${domain} result on ${eng} SERP`);
      await saveSearchScreenshot(page, `${label}-no-results`);
      return null;
    }

    console.log(`  🎯 result: ${targetUrl}`);

    // Navigate with the search page as Referer — a genuine organic signal for
    // bot detection. page.goto's referer option sets the header for this
    // navigation only, so it doesn't bleed into subsequent page requests.
    try {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
        referer: searchUrl,
      });
    } catch (err) {
      console.log(`  ✗ result navigation failed: ${err instanceof Error ? err.message : err}`);
      await saveSearchScreenshot(page, `${label}-result-nav-fail`);
      return null;
    }

    const finalUrl = page.url();
    console.log(`  ✓ landed on ${finalUrl}`);
    return finalUrl;
  }

  let result = await attempt(engine);
  if (!result && fallback && engine === "google") {
    console.log(`  ↩ falling back to DuckDuckGo`);
    result = await attempt("duckduckgo");
  }
  return result;
}
