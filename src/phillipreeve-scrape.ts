// Phillip Reeve review scraper.
//
// Design notes:
// - Source is plain WordPress HTML (phillipreeve.net/blog), so we fetch with
//   Node's built-in fetch and parse with regex. No Playwright stealth needed
//   and no new deps. This makes it the simplest of the three technical-review
//   scrapers.
// - URL discovery is curated: we only visit lenses that have a
//   `reviews.phillipreeve` URL set in lenses.json. Auto-discovery is a
//   separate effort tracked for a later pass.
// - Multi-lens detection: we scan the title + first body heading for
//   mentions of more than one tracked lens. If we detect more than one, we
//   refuse to ingest content (but still persist a flagged stub with the URL
//   so the run log shows something happened).
// - Published date is in a bare <time> element with no datetime attribute;
//   we parse the text content ("November 27, 2023") into an ISO date string.
// - Author is an <a href="/blog/author/..."> link with no rel attribute.
// - Specs live in a <ul><li>Key: value</li></ul> block under <h2>Specifications</h2>
//   and are parsed into LensSpecs, which gets written back to lenses.json.
// - Sample images are scoped to sections whose heading matches "Sample Images";
//   this excludes sharpness crops, vignetting graphs, and other test charts.

import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import type {
  Lens,
  LensSpecs,
  TechnicalReview,
  TechnicalSource,
} from "../shared/types.js";
import { saveTechnicalReview } from "./technical-reviews.js";

const LENSES_FILE = "lenses.json";
const SOURCE: TechnicalSource = "phillipreeve";

// Editorial sites don't need the extreme retail-scraper delay distribution,
// but a 3–6s random gap keeps us from hammering.
const DELAY_MS: readonly [number, number] = [3000, 6000];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function delay(): Promise<void> {
  const ms = DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0]);
  return new Promise((r) => setTimeout(r, ms));
}

export interface ScrapeOptions {
  lensIds?: string[];     // limit to specific lenses
  limit?: number;         // max lenses to process
  force?: boolean;        // re-scrape even if a review is already cached
  isBodies?: boolean;     // no-op: phillipreeve only covers lenses
}

export interface ScrapeResult {
  lensId: string;
  status: "saved" | "flagged" | "skipped" | "error";
  reason?: string;
  review?: TechnicalReview;
  specs?: LensSpecs;
}

// ── HTML helpers ────────────────────────────────────────────────────────────
// We avoid a full DOM lib; WordPress output is predictable enough for regex.

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// Pull just the inside of the <article> element; other sections (comments,
// sidebars, footers) generate noise we don't want in fullText.
function extractArticle(html: string): string | null {
  const m = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/);
  return m ? m[1] : null;
}

function extractEntryContent(article: string): string | null {
  const m = article.match(
    /<div\s+class="entry-content">([\s\S]*?)<\/div>\s*<footer\b|<div\s+class="entry-content">([\s\S]*?)<div\s+class="entry-meta/,
  );
  if (m) return m[1] ?? m[2] ?? null;
  // Fallback — take everything after <div class="entry-content">.
  const m2 = article.match(/<div\s+class="entry-content">([\s\S]*)$/);
  return m2 ? m2[1] : null;
}

function extractTitle(html: string): string {
  const raw = firstMatch(
    html,
    /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/,
  );
  return raw ? stripTags(raw) : "";
}

function extractAuthor(html: string): string | undefined {
  const raw = firstMatch(html, /<a\b[^>]+href="[^"]*\/blog\/author\/[^"]*"[^>]*>([\s\S]*?)<\/a>/);
  return raw ? stripTags(raw) : undefined;
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

function extractPublishedDate(html: string): string | undefined {
  // Try ISO datetime attribute first (some posts may still have it).
  const iso = firstMatch(html, /<time[^>]*datetime="([^"]+)"/);
  if (iso) return iso;
  // Fall back to text content: "November 27, 2023"
  const text = firstMatch(html, /<time[^>]*>([^<]+)<\/time>/);
  if (text) {
    const m = text.trim().match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m) {
      const month = MONTHS[m[1].toLowerCase()];
      if (month) return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
    }
  }
  return undefined;
}

// Grab image URLs from a raw HTML string. Skips avatars, plugin assets, and
// inline data URIs. Called per-section so callers control scope.
function extractImages(rawHtml: string): string[] {
  const urls = new Set<string>();
  const re = /<img[^>]+src="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawHtml))) {
    const u = m[1];
    if (!u) continue;
    if (/gravatar\.com/i.test(u)) continue;
    if (/\/plugins\//i.test(u)) continue;
    if (/data:image/i.test(u)) continue;
    urls.add(u);
  }
  return [...urls];
}

// Split article body into sections keyed by h1–h4 heading text. Returns both
// stripped text and raw HTML per section so callers can run extractImages on
// a specific section without re-scanning the whole body.
const SKIP_HEADING_CLASSES = /(entry-title|widget-title|page-title|screen-reader)/i;

function extractSections(body: string): { heading: string; text: string; rawHtml: string }[] {
  const re = /<h([1-4])(\b[^>]*)>([\s\S]*?)<\/h\1>/g;
  const marks: { heading: string; tagStart: number; tagEnd: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const attrs = m[2] ?? "";
    if (SKIP_HEADING_CLASSES.test(attrs)) continue;
    marks.push({ heading: stripTags(m[3]), tagStart: m.index, tagEnd: m.index + m[0].length });
  }
  return marks.map((mark, i) => {
    const start = mark.tagEnd;
    const end = i + 1 < marks.length ? marks[i + 1].tagStart : body.length;
    const rawHtml = body.slice(start, end);
    return { heading: mark.heading, text: stripTags(rawHtml), rawHtml };
  });
}

// Only collect images from sections whose heading matches "Sample Images" or
// "More Sample Images". Excludes sharpness crops, vignetting graphs, etc.
const SAMPLE_HEADING = /^(more\s+)?sample\s+images?$/i;

function extractSampleImages(sections: { heading: string; rawHtml: string }[]): string[] {
  const urls = new Set<string>();
  for (const s of sections.filter(s => SAMPLE_HEADING.test(s.heading))) {
    for (const u of extractImages(s.rawHtml)) urls.add(u);
  }
  return [...urls];
}

// Parse <ul><li>Key: value</li></ul> under <h2>Specifications</h2> into LensSpecs.
function extractSpecs(sections: { heading: string; rawHtml: string }[]): LensSpecs | undefined {
  const sec = sections.find(s => /^specifications?$/i.test(s.heading));
  if (!sec) return undefined;

  const specs: LensSpecs = {};
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;

  while ((m = liRe.exec(sec.rawHtml))) {
    const text = stripTags(m[1]).trim();
    const colon = text.indexOf(":");
    if (colon === -1) continue;
    const key = text.slice(0, colon).trim().toLowerCase();
    const val = text.slice(colon + 1).trim();

    if (key === "diameter") {
      const n = parseFloat(val); if (!isNaN(n)) specs.diameterMm = n;
    } else if (key === "length") {
      const n = parseFloat(val); if (!isNaN(n)) specs.lengthMm = n;
    } else if (key === "weight") {
      const n = parseFloat(val); if (!isNaN(n)) specs.weightG = n;
    } else if (key === "filter diameter") {
      const n = parseFloat(val); if (!isNaN(n)) specs.filterDiameter = n;
    } else if (key === "number of aperture blades") {
      const n = parseInt(val, 10); if (!isNaN(n)) specs.apertureBlades = n;
    } else if (key === "elements/groups") {
      const eg = val.match(/(\d+)\/(\d+)/);
      if (eg) specs.opticalDesign = { elements: parseInt(eg[1], 10), groups: parseInt(eg[2], 10) };
    } else if (key === "close focusing distance") {
      const n = parseFloat(val); if (!isNaN(n)) specs.minimumFocusDistanceM = n;
    } else if (key === "maximum magnification") {
      const ratio = val.match(/1:([\d.]+)/);
      if (ratio) specs.maximumMagnification = parseFloat((1 / parseFloat(ratio[1])).toFixed(4));
    } else if (key === "mount") {
      specs.mount = val.split("(")[0].trim();
    }
  }

  return Object.keys(specs).length > 0 ? specs : undefined;
}

// ── Multi-lens detection ────────────────────────────────────────────────────
// A review that names multiple tracked lenses in its title/opening is a
// comparison/roundup; per the current policy we refuse to ingest so the
// editorial attribution stays clean.

// Whole-word focal-length check — "35" must NOT match inside "135".
function mentionsLens(haystack: string, lens: Lens): boolean {
  const hay = haystack.toLowerCase();
  if (!hay.includes(lens.brand.toLowerCase())) return false;
  const focal = lens.focalLength.replace(/mm/gi, "").toLowerCase();
  if (!focal) return false;
  // Accept "35mm", "35 mm", or "35 " but not "135".
  const re = new RegExp(`(^|[^\\d])${focal.replace(".", "\\.")}(mm|\\s|[^\\d])`, "i");
  return re.test(hay);
}

// Multi-lens detection scoped to the TITLE only. Comparison/roundup posts
// name all their subjects in the title ("Sony 35mm GM vs Zeiss 35mm f/1.4")
// — body prose routinely mentions other lenses in "Alternatives" sections
// without being a comparison, so scanning the body yields false positives.
function detectMultiLens(
  title: string,
  targetLens: Lens,
  allLenses: Lens[],
): { multi: true; mentionedLensIds: string[] } | { multi: false } {
  const others: string[] = [];
  for (const l of allLenses) {
    if (l.id === targetLens.id) continue;
    if (mentionsLens(title, l)) others.push(l.id);
  }
  if (others.length > 0) return { multi: true, mentionedLensIds: others };
  return { multi: false };
}

// ── Verdict extraction ──────────────────────────────────────────────────────
// Phillip Reeve doesn't publish a pros/cons block; the "Conclusion" section
// is the closest to a verdict. We grab the first paragraph of it.

function extractVerdict(sections: { heading: string; text: string }[]): string | undefined {
  const conclusion = sections.find((s) =>
    /^(conclusion|verdict|summary|tl;?\s*dr)/i.test(s.heading),
  );
  if (!conclusion) return undefined;
  // First ~2 sentences.
  const match = conclusion.text.match(/^(.{40,400}?[.?!])(?:\s|$)/);
  return match ? match[1] : conclusion.text.slice(0, 280);
}

// ── Core ────────────────────────────────────────────────────────────────────

export async function scrapeLens(
  lens: Lens,
  allLenses: Lens[],
): Promise<ScrapeResult> {
  const url = lens.reviews?.phillipreeve;
  if (!url) {
    return { lensId: lens.id, status: "skipped", reason: "no curated URL" };
  }

  console.log(`[${lens.id}] GET ${url}`);
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return {
        lensId: lens.id,
        status: "error",
        reason: `HTTP ${res.status}`,
      };
    }
    html = await res.text();
  } catch (err) {
    return {
      lensId: lens.id,
      status: "error",
      reason: `fetch failed: ${(err as Error).message}`,
    };
  }

  const title = extractTitle(html);
  // 404s on this site render a normal HTML page with title "Page Not Found".
  if (!title || /not\s*found/i.test(title)) {
    const stub: TechnicalReview = {
      source: SOURCE,
      url,
      title: title || "(not found)",
      flagged: { reason: "not-found", detail: "title looked like 404" },
      scrapedAt: new Date().toISOString(),
    };
    saveTechnicalReview(lens.id, stub);
    return { lensId: lens.id, status: "flagged", reason: "not-found", review: stub };
  }

  const article = extractArticle(html);
  if (!article) {
    return { lensId: lens.id, status: "error", reason: "no <article> element" };
  }

  const body = extractEntryContent(article) ?? article;
  const sections = extractSections(body);

  const multi = detectMultiLens(title, lens, allLenses);
  if (multi.multi) {
    console.log(`  ℹ also mentions ${multi.mentionedLensIds.join(", ")} — scraping anyway`);
  }

  const fullText = stripTags(body);
  const sampleImages = extractSampleImages(sections);
  const verdict = extractVerdict(sections);
  const specs = extractSpecs(sections);

  const review: TechnicalReview = {
    source: SOURCE,
    url,
    title,
    author: extractAuthor(html),
    publishedDate: extractPublishedDate(html),
    verdict,
    sampleImages,
    fullText,
    textLength: fullText.length,
    scrapedAt: new Date().toISOString(),
  };

  saveTechnicalReview(lens.id, review);
  console.log(
    `  ✓ ${title} — ${fullText.length} chars, ${sampleImages.length} sample images, specs ${
      specs ? "✓" : "—"
    }, verdict ${verdict ? "✓" : "—"}`,
  );
  return { lensId: lens.id, status: "saved", review, specs };
}

export async function scrapeAll(opts: ScrapeOptions = {}): Promise<ScrapeResult[]> {
  if (opts.isBodies) {
    console.log("Phillip Reeve covers lenses only — skipping bodies.");
    return [];
  }
  const lenses: Lens[] = JSON.parse(readFileSync(LENSES_FILE, "utf8"));
  let pool = lenses.filter((l) => !!l.reviews?.phillipreeve);
  if (opts.lensIds && opts.lensIds.length > 0) {
    const set = new Set(opts.lensIds);
    pool = pool.filter((l) => set.has(l.id));
  }
  if (opts.limit) pool = pool.slice(0, opts.limit);

  console.log(`Phillip Reeve: ${pool.length} lenses have curated URLs`);
  const results: ScrapeResult[] = [];
  for (let i = 0; i < pool.length; i++) {
    const lens = pool[i];
    if (i > 0) await delay();
    const r = await scrapeLens(lens, lenses);
    results.push(r);
  }

  const specsById = new Map(results.filter(r => r.specs).map(r => [r.lensId, r.specs!]));
  if (specsById.size > 0) {
    for (const lens of lenses) {
      const s = specsById.get(lens.id);
      if (s) lens.specs = s;
    }
    writeFileSync(LENSES_FILE, JSON.stringify(lenses, null, 2) + "\n");
    console.log(`Updated specs for ${specsById.size} lenses in ${LENSES_FILE}`);
  }

  const tally = {
    saved: results.filter((r) => r.status === "saved").length,
    flagged: results.filter((r) => r.status === "flagged").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    error: results.filter((r) => r.status === "error").length,
  };
  console.log(
    `\nDone. saved=${tally.saved}  flagged=${tally.flagged}  skipped=${tally.skipped}  errors=${tally.error}`,
  );
  return results;
}

// ── CLI entry ───────────────────────────────────────────────────────────────

function parseArgs(): ScrapeOptions {
  const args = process.argv.slice(2);
  const opts: ScrapeOptions = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--lens" && args[i + 1]) {
      opts.lensIds = (opts.lensIds ?? []).concat(args[++i].split(","));
    } else if (a === "--limit" && args[i + 1]) {
      opts.limit = parseInt(args[++i], 10);
    } else if (a === "--force") {
      opts.force = true;
    } else if (a === "--lenses") {
      opts.isBodies = false;
    } else if (a === "--bodies") {
      opts.isBodies = true;
    }
  }
  return opts;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("phillipreeve-scrape.ts");
if (invokedDirectly) {
  const baseOpts = parseArgs();
  const hasMode = process.argv.includes("--lenses") || process.argv.includes("--bodies");
  const run = hasMode
    ? scrapeAll(baseOpts)
    : scrapeAll({ ...baseOpts, isBodies: false }).then(() => scrapeAll({ ...baseOpts, isBodies: true }));
  run.catch((err) => { console.error(err); process.exit(1); });
}
