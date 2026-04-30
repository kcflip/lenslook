import { appendFileSync, mkdirSync } from "fs";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import type { Lens, Body, RetailSubject } from "../shared/types.js";

// Playwright-extra keeps a global plugin registry. Importing multiple scrapers
// in the same process would re-register stealth without this flag.
let stealthRegistered = false;
function ensureStealth(): void {
  if (stealthRegistered) return;
  chromium.use(StealthPlugin());
  stealthRegistered = true;
}

// Tri-modal delay distribution. Bumped from 4–7s flat after captchas — retail
// sites appear to fingerprint cadence, so we mix a base range with rare long
// pauses and even rarer "coffee breaks" to blur the timing signature.
export const DELAY_MS: readonly [number, number] = [10000, 22000];
export const LONG_PAUSE_CHANCE = 0.15;
export const LONG_PAUSE_MS: readonly [number, number] = [30000, 60000];
export const COFFEE_BREAK_CHANCE = 0.04;
export const COFFEE_BREAK_MS: readonly [number, number] = [90000, 180000];

export const MAX_REVIEWS = 25;

export function pickMs(range: readonly [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}

// Short pause after page load before interacting — simulates a human scanning
// the page before their eyes settle on what to click.
export const READING_DELAY_MS: readonly [number, number] = [1500, 4000];

export function readingDelay(): Promise<void> {
  const ms = pickMs(READING_DELAY_MS);
  return new Promise((r) => setTimeout(r, ms));
}

export function randomDelay(): Promise<void> {
  const coffee = Math.random() < COFFEE_BREAK_CHANCE;
  const longPause = !coffee && Math.random() < LONG_PAUSE_CHANCE;
  const ms = coffee
    ? pickMs(COFFEE_BREAK_MS)
    : longPause
      ? pickMs(DELAY_MS) + pickMs(LONG_PAUSE_MS)
      : pickMs(DELAY_MS);
  const flavor = coffee ? " ☕ (coffee break)" : longPause ? " 🐢 (long pause)" : "";
  console.log(` ======POCKET SAND!=====\n`);
  console.log(`  (•_•)`);
  console.log(`  ( •_•)>⌐■-■`);
  console.log(`  (⌐■_■)  I'm being sneaky ${(ms / 1000).toFixed(1)}s${flavor}`);
  console.log(`\n ====== HUZZAH! ===== \n`);
  return new Promise((r) => setTimeout(r, ms));
}

const VIEWPORT_POOL = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
] as const;

function randomViewport() {
  return VIEWPORT_POOL[Math.floor(Math.random() * VIEWPORT_POOL.length)];
}

export interface LaunchOptions {
  stealth?: boolean;
  // When set, uses a persistent context (cookies/storage survive runs). No
  // standalone Browser handle is returned in this mode.
  profileDir?: string;
  headless?: boolean;
  userAgent?: string;
  viewport?: { width: number; height: number };
  channel?: "chrome" | "msedge";
}

export interface LaunchHandle {
  page: Page;
  context: BrowserContext;
  // Only present when launched without profileDir (ephemeral mode).
  browser?: Browser;
  cleanup: () => Promise<void>;
}

export async function launchChromiumContext(
  opts: LaunchOptions = {},
): Promise<LaunchHandle> {
  const {
    stealth = false,
    profileDir,
    headless = true,
    userAgent,
    viewport = randomViewport(),
    channel = "chrome",
  } = opts;
  if (stealth) ensureStealth();

  console.log("🚀 Launching Chrome…");

  if (profileDir) {
    mkdirSync(profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(profileDir, {
      headless,
      channel,
      ...(userAgent ? { userAgent } : {}),
      viewport,
      screen: viewport,
    });
    const page = await context.newPage();
    console.log("Browser ready — putting on my trench coat and sunglasses 🕶️\n");
    return {
      page,
      context,
      cleanup: async () => {
        await context.close();
      },
    };
  }

  const browser = await chromium.launch({ headless, channel });
  const context = await browser.newContext({
    ...(userAgent ? { userAgent } : {}),
    viewport,
    screen: viewport,
  });
  const page = await context.newPage();
  console.log("Browser ready — putting on my trench coat and sunglasses 🕶️\n");
  return {
    page,
    context,
    browser,
    cleanup: async () => {
      await browser.close();
    },
  };
}

// Move mouse to element center (with small jitter) before clicking — closes the
// "click with no prior mouse movement" bot signal.
export async function humanClick(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) { await locator.click(); return; }
  const x = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
  const y = box.y + box.height / 2 + (Math.random() - 0.5) * 10;
  await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
  await page.waitForTimeout(Math.floor(Math.random() * 150) + 50);
  await page.mouse.click(x, y);
}

export async function humanDblClick(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) { await locator.dblclick(); return; }
  const x = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
  const y = box.y + box.height / 2 + (Math.random() - 0.5) * 10;
  await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
  await page.waitForTimeout(Math.floor(Math.random() * 150) + 50);
  await page.mouse.dblclick(x, y);
}

// Scroll distance in stepped increments instead of one instant jump.
export async function humanScroll(page: Page, distance: number): Promise<void> {
  let scrolled = 0;
  while (scrolled < distance) {
    const step = Math.floor(Math.random() * 100) + 50;
    await page.mouse.wheel(0, step);
    scrolled += step;
    await page.waitForTimeout(Math.floor(Math.random() * 100) + 50);
  }
}

const MPN_LOG = "output/mpn-mismatches.log";

export function logMpnMismatch(lensId: string, source: string, stored: string, scraped: string): void {
  mkdirSync("output", { recursive: true });
  const line = `${new Date().toISOString()}  ${lensId}  ${source}  stored="${stored}"  scraped="${scraped}"\n`;
  appendFileSync(MPN_LOG, line);
  console.log(`  🔄 MPN differs — stored: "${stored}"  scraped: "${scraped}" (logged)`);
}

export type BaseTitleCheck = { ok: true } | { ok: false; reason: string };

// Normalize a manufacturer part number for comparison. Strips dashes, spaces,
// and lowercases so "SEL-50F14GM", "SEL50F14GM", "sel50f14gm" all match.
export function normalizeMpn(mpn: string): string {
  return mpn.replace(/[-\s]/g, "").toLowerCase();
}

// True when subject.model is just the display name restated — meaning we don't
// have a real model number and can't use it for hard MPN verification.
export function modelIsJustName(subject: RetailSubject): boolean {
  const normModel = normalizeMpn(subject.model);
  const normName = normalizeMpn(subject.name);
  return normModel === normName || normModel.includes(normName) || normName.includes(normModel);
}

export type MpnCheckResult =
  | { ok: true; mpn: string }
  | { ok: false; reason: "mismatch"; scrapedMpn: string; lensModel: string }
  | { ok: false; reason: "no-mpn" }
  | { ok: "unverified"; mpn: string }; // model is just the name — capture but don't hard-reject

// Compares the scraped MPN against subject.model. Returns a structured result
// so callers can decide whether to hard-reject (mismatch on a known model
// number) or just capture the value for future backfilling (model is just the
// display name).
export function checkMpn(scrapedMpn: string | undefined | null, subject: RetailSubject): MpnCheckResult {
  if (!scrapedMpn) return { ok: false, reason: "no-mpn" };
  if (modelIsJustName(subject)) return { ok: "unverified", mpn: scrapedMpn };
  if (normalizeMpn(scrapedMpn) === normalizeMpn(subject.model)) return { ok: true, mpn: scrapedMpn };
  return { ok: false, reason: "mismatch", scrapedMpn, lensModel: subject.model };
}

// Brand + model number (MPN) or display name must appear in the title.
// Used by body scrapers; callers must also pass looksLikeKit before accepting.
export function baseBodyTitleMatches(title: string, body: Body): BaseTitleCheck {
  const t = title.toLowerCase();
  if (!t.includes(body.brand.toLowerCase())) {
    return { ok: false, reason: `brand "${body.brand.toLowerCase()}" not in title` };
  }
  const tNorm = normalizeMpn(t);
  const modelNorm = normalizeMpn(body.model);
  const nameToken = body.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (!tNorm.includes(modelNorm) && !t.includes(nameToken)) {
    return { ok: false, reason: `model "${body.model}" / name "${body.name}" not in title` };
  }
  return { ok: true };
}

const KIT_PATTERNS: readonly RegExp[] = [
  /\bkit\b/i,
  /\bwith\s+lens\b/i,
  /\bbundle\b/i,
  /\b\d+(?:-\d+)?\s*mm\b/i, // focal length in title is a strong kit/lens signal
];

// Rejects camera+lens bundle listings that would otherwise match a body search.
export function looksLikeKit(title: string): boolean {
  return KIT_PATTERNS.some((re) => re.test(title));
}

// Brand + focal length + aperture must all appear in the title. Callers layer
// their own junk/bundle filtering on top (different retailers surface
// different noise patterns).
export function baseTitleMatches(title: string, lens: Lens): BaseTitleCheck {
  const t = title.toLowerCase();
  if (!t.includes(lens.brand.toLowerCase())) {
    return { ok: false, reason: `brand "${lens.brand.toLowerCase()}" not in title` };
  }
  const focal = lens.focalLength.replace("mm", "").toLowerCase();
  if (!t.includes(focal)) {
    return { ok: false, reason: `focal "${focal}" not in title` };
  }
  const aperture = lens.maxAperture.replace("f/", "").toLowerCase();
  if (!t.includes(aperture)) {
    return { ok: false, reason: `aperture "${aperture}" not in title` };
  }
  return { ok: true };
}
