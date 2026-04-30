import lensData from "../lenses.json" with { type: "json" };
import type { Lens } from "../shared/types.js";

const lenses = lensData as Lens[];

// Re-export for callers that need the same lens list the matcher compiled
// against. Avoids a second `JSON.parse(readFileSync("lenses.json"))` at
// startup in src/index.ts and src/test.ts.
export const ALL_LENSES: readonly Lens[] = lenses;

// Minimal interface satisfied by both Lens and Body for product-pool matching.
export interface Matchable {
  id: string;
  name: string;
  aliases: string[];
}

// Token emitted at sentence boundaries — consumed by sentiment.ts to cap context windows
// at sentence edges. Must be a token that can't occur naturally in lens or sentiment text.
export const EOS = "__eos__";

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/'/g, "")                      // drop apostrophes: don't → dont
    .replace(/\bf\/?(?=\d{1,2}(?:\.\d+)?(?![0-9]))/g, "") // strip "f" only when followed by an aperture-like number (e.g. f/1.8, f2, f/0.95) — leaves model codes like F050 intact
    .replace(/[.!?]+(?=\s|$)/g, ` ${EOS} `) // sentence terminators (only before whitespace/EOL, so 1.8 is preserved)
    .replace(/\n+/g, ` ${EOS} `)            // paragraph breaks
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Proximity window (in words) around a brand mention within which we scan for
// focal length + aperture. Prevents cross-brand bleed in sentences that mention
// multiple brands (e.g. "Sony a7 and Tamron 28-200").
const BRAND_PROXIMITY_WORDS = 10;

// Brand words as they appear in normalized text → canonical brand in lenses.json.
// Includes sub-brands, rebrands (Rokinon = Samyang, Batis = Zeiss line, etc.),
// possessive/plural forms (sonys, sigmas, tamrons), and Sony lens-line
// qualifiers (FE) so that mentioning any of them anchors a match.
const BRAND_ALIASES: Record<string, string> = {
  sony: "Sony",
  sonys: "Sony",
  fe: "Sony",
  sigma: "Sigma",
  sigmas: "Sigma",
  tamron: "Tamron",
  tamrons: "Tamron",
  samyang: "Samyang",
  rokinon: "Samyang",
  viltrox: "Viltrox",
  ttartisan: "TTArtisan",
  laowa: "Laowa",
  zeiss: "Zeiss",
  batis: "Zeiss",
  loxia: "Zeiss",
  otus: "Zeiss",
  milvus: "Zeiss",
};

// Multi-word brand forms (less common spellings and qualifiers).
const BRAND_PHRASES: Array<[RegExp, string]> = [
  [/\btt\s+artisan\b/g, "TTArtisan"],
  [/\be\s+mount\b/g, "Sony"],
];

const BRAND_WORDS_RE_SOURCE = `\\b(${Object.keys(BRAND_ALIASES).map(escapeRegex).join("|")})\\b`;

function findBrandHits(sentence: string): Array<{ brand: string; pos: number; len: number }> {
  const hits: Array<{ brand: string; pos: number; len: number }> = [];
  const re = new RegExp(BRAND_WORDS_RE_SOURCE, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    const b = BRAND_ALIASES[m[1]];
    if (b) hits.push({ brand: b, pos: m.index, len: m[0].length });
  }
  for (const [phraseRe, brand] of BRAND_PHRASES) {
    phraseRe.lastIndex = 0;
    let pm: RegExpExecArray | null;
    while ((pm = phraseRe.exec(sentence))) {
      hits.push({ brand, pos: pm.index, len: pm[0].length });
    }
  }
  return hits;
}

// Focal-length regex, e.g. "28mm" → /\b28(?:\s*mm)?\b/; "24-70mm" → /\b24\s+70(?:\s*mm)?\b/
// (dashes are stripped by normalize() so zooms show up as two numbers separated by a space)
function buildFocalRegex(focalLength: string): RegExp {
  const cleaned = focalLength.toLowerCase().replace(/\s*mm$/i, "").trim();
  const parts = cleaned.split(/[-–]/);
  if (parts.length === 1) {
    // For primes: "24mm" always matches, but a bare "24" is rejected when
    // immediately followed by another 2+ digit number — that's a zoom range
    // (e.g. "24 70" after normalize), not a prime mention.
    const n = escapeRegex(parts[0]);
    return new RegExp(`\\b${n}\\s*mm\\b|\\b${n}\\b(?!\\s+\\d{2,})`);
  }
  return new RegExp(
    `\\b${escapeRegex(parts[0])}\\s+${escapeRegex(parts[1])}(?:\\s*mm)?\\b`,
  );
}

// Strict focal — used in the uniqueByFocal fallback where no aperture
// co-confirms the match. For single focals we require an explicit "mm" suffix
// (a bare "28" near "Sony" in "$28" or "28 photos" would otherwise false-match
// the Sony 28mm). Zoom ranges already look like "28 200" and that token pair
// almost never occurs in the wild outside focal-range contexts, so we leave
// "mm" optional there to keep catching "Tamron 28-200" with no aperture quoted.
function buildFocalRegexStrict(focalLength: string): RegExp {
  const cleaned = focalLength.toLowerCase().replace(/\s*mm$/i, "").trim();
  const parts = cleaned.split(/[-–]/);
  if (parts.length === 1) {
    return new RegExp(`\\b${escapeRegex(parts[0])}\\s*mm\\b`);
  }
  return new RegExp(
    `\\b${escapeRegex(parts[0])}\\s+${escapeRegex(parts[1])}(?:\\s*mm)?\\b`,
  );
}

// Aperture regex. The source aperture string is run through the same normalize()
// as the text being scanned, so "f/2.8-5.6" → "2 8 5 6" and /\b2\s+8\s+5\s+6\b/ matches.
// For variable-aperture zooms we also accept the wide aperture alone, since users
// commonly write "Tamron 28-200 f/2.8" without quoting the tele end.
function buildApertureRegex(aperture: string): RegExp {
  const rangeParts = aperture.split(/[-–]/);
  const wide = normalize(rangeParts[0] ?? "").split(/\s+/).filter(Boolean);
  const tele = rangeParts[1]
    ? normalize(rangeParts[1]).split(/\s+/).filter(Boolean)
    : [];
  if (wide.length === 0) return /(?!x)x/;
  const wideRe = wide.map(escapeRegex).join("\\s+");
  if (tele.length === 0) {
    return new RegExp(`\\b${wideRe}\\b`);
  }
  const fullRe = [...wide, ...tele].map(escapeRegex).join("\\s+");
  return new RegExp(`\\b(?:${fullRe}|${wideRe})\\b`);
}

// An alias is a "distinctive model code" if it has both letters (other than the
// "mm" focal suffix) and digits and no whitespace — e.g. "A046", "SEL14F18GM",
// "14GM". These are specific enough to match alone, without brand context.
function isDistinctiveCode(s: string): boolean {
  if (!s) return false;
  if (/\s/.test(s)) return false;
  if (!/\d/.test(s)) return false;
  const lettersOnly = s.replace(/mm/gi, "").replace(/[^a-z]/gi, "");
  return lettersOnly.length >= 1;
}

interface CompiledLens {
  lens: Lens;
  focalRe: RegExp;
  focalReStrict: RegExp;
  apertureRe: RegExp;
  codeRes: RegExp[];
  uniqueByFocal: boolean;
}

const focalCounts = new Map<string, number>();
for (const lens of lenses) {
  const k = `${lens.brand}|${lens.focalLength}`;
  focalCounts.set(k, (focalCounts.get(k) ?? 0) + 1);
}

const compiled: CompiledLens[] = lenses.map((lens) => {
  const codes = [lens.model, ...lens.aliases].filter(isDistinctiveCode);
  const codeRes = codes.map((c) => new RegExp(`\\b${escapeRegex(normalize(c))}\\b`));
  return {
    lens,
    focalRe: buildFocalRegex(lens.focalLength),
    focalReStrict: buildFocalRegexStrict(lens.focalLength),
    apertureRe: buildApertureRegex(lens.maxAperture),
    codeRes,
    uniqueByFocal: (focalCounts.get(`${lens.brand}|${lens.focalLength}`) ?? 0) === 1,
  };
});

function splitSentences(norm: string): Array<{ start: number; text: string }> {
  const sepRe = new RegExp(`\\s*${EOS}\\s*`, "g");
  const out: Array<{ start: number; text: string }> = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = sepRe.exec(norm))) {
    out.push({ start: cursor, text: norm.slice(cursor, m.index) });
    cursor = m.index + m[0].length;
  }
  out.push({ start: cursor, text: norm.slice(cursor) });
  return out.filter((s) => s.text.trim());
}

// Tokenize on whitespace, returning char offsets into `s`. Used to expand a
// word-count-based window around a brand hit — more forgiving than fixed chars
// since natural sentences run longer than 40 characters.
function tokensWithOffsets(s: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function collectSentenceMatches(
  norm: string,
  onMatch: (lensId: string, positionInNorm: number) => void,
): void {
  for (const { start: sentStart, text: sentence } of splitSentences(norm)) {
    const brandHits = findBrandHits(sentence);
    if (brandHits.length === 0) continue;

    const tokens = tokensWithOffsets(sentence);

    for (const c of compiled) {
      const hits = brandHits.filter((h) => h.brand === c.lens.brand);
      if (hits.length === 0) continue;

      for (const hit of hits) {
        const hitEnd = hit.pos + hit.len - 1;
        const startTi = tokens.findIndex((t) => hit.pos >= t.start && hit.pos < t.end);
        const endTi = tokens.findIndex((t) => hitEnd >= t.start && hitEnd < t.end);
        if (startTi < 0 || endTi < 0) continue;
        const winStartTok = Math.max(0, startTi - BRAND_PROXIMITY_WORDS);
        const winEndTok = Math.min(tokens.length - 1, endTi + BRAND_PROXIMITY_WORDS);
        const winStart = tokens[winStartTok].start;
        const winEnd = tokens[winEndTok].end;
        const window = sentence.slice(winStart, winEnd);

        const fm = c.focalRe.exec(window);
        if (!fm) continue;

        if (c.apertureRe.test(window)) {
          onMatch(c.lens.id, sentStart + winStart + fm.index);
          break;
        }
        if (c.uniqueByFocal) {
          const sm = c.focalReStrict.exec(window);
          if (sm) {
            onMatch(c.lens.id, sentStart + winStart + sm.index);
            break;
          }
        }
      }
    }
  }
}

function collectCodeMatches(
  norm: string,
  onMatch: (lensId: string, positionInNorm: number) => void,
): void {
  for (const c of compiled) {
    for (const re of c.codeRes) {
      const m = re.exec(norm);
      if (m) {
        onMatch(c.lens.id, m.index);
        break;
      }
    }
  }
}

export function matchLenses(title: string): string[] {
  const norm = normalize(title);
  const matched = new Set<string>();
  collectSentenceMatches(norm, (id) => matched.add(id));
  collectCodeMatches(norm, (id) => matched.add(id));
  return [...matched];
}

export interface PositionedMatch {
  id: string;
  index: number; // char offset into the normalized text
}

export function matchLensesWithPositions(text: string): {
  matches: PositionedMatch[];
  normalized: string;
} {
  const norm = normalize(text);
  const firstIdx = new Map<string, number>();
  const record = (id: string, idx: number) => {
    const prev = firstIdx.get(id);
    if (prev === undefined || idx < prev) firstIdx.set(id, idx);
  };
  collectSentenceMatches(norm, record);
  collectCodeMatches(norm, record);
  const matches = [...firstIdx.entries()].map(([id, index]) => ({ id, index }));
  return { matches, normalized: norm };
}

// ── Body / generic product matching ─────────────────────────────────────────
// Bodies don't have focal length or aperture, so we match by normalized
// name/alias patterns only. Two pattern types:
//   • Code: single token, len >= 3 (e.g. "a7iv", "a6700", "a7m4")
//   • Phrase: multi-word (e.g. "a7 iv", "ilce 7m4")
// For multi-word normalized aliases we also compile the concatenated form
// ("ilce7m4") to catch dash-free spellings.

export interface CompiledProduct {
  id: string;
  patterns: RegExp[];
}

function buildProductPatterns(subject: Matchable): RegExp[] {
  const seen = new Set<string>();
  const patterns: RegExp[] = [];

  // Use only aliases — the name field often has special chars (α, Ⅳ) that
  // normalize to generic fragments ("7 iv") and produce false positives.
  for (const raw of subject.aliases) {
    const norm = normalize(raw);
    const tokens = norm.split(/\s+/).filter(Boolean);

    if (tokens.length === 1) {
      if (tokens[0].length >= 3 && !seen.has(tokens[0])) {
        seen.add(tokens[0]);
        patterns.push(new RegExp(`\\b${escapeRegex(tokens[0])}\\b`));
      }
    } else if (tokens.length >= 2) {
      // Exact phrase
      const phraseKey = tokens.join(" ");
      if (!seen.has(phraseKey)) {
        seen.add(phraseKey);
        patterns.push(new RegExp(`\\b${tokens.map(escapeRegex).join("\\s+")}\\b`));
      }
      // Concatenated form handles e.g. "ilce7m4" written without the dash
      const concat = tokens.join("");
      if (concat.length >= 3 && !seen.has(concat)) {
        seen.add(concat);
        patterns.push(new RegExp(`\\b${escapeRegex(concat)}\\b`));
      }
    }
  }

  return patterns;
}

export function compileBodies(subjects: Matchable[]): CompiledProduct[] {
  return subjects.map((s) => ({ id: s.id, patterns: buildProductPatterns(s) }));
}

function collectProductMatches(
  norm: string,
  products: CompiledProduct[],
  onMatch: (id: string, pos: number) => void,
): void {
  for (const p of products) {
    for (const re of p.patterns) {
      const m = re.exec(norm);
      if (m) {
        onMatch(p.id, m.index);
        break; // first pattern match per product is enough
      }
    }
  }
}

// Combined lens + body match. bodyPool comes from compileBodies() called once
// at startup in index.ts. Falls back to lens-only when bodyPool is empty.
export function matchProductsWithPositions(
  text: string,
  bodyPool: CompiledProduct[],
): { matches: PositionedMatch[]; normalized: string } {
  const norm = normalize(text);
  const firstIdx = new Map<string, number>();
  const record = (id: string, idx: number) => {
    const prev = firstIdx.get(id);
    if (prev === undefined || idx < prev) firstIdx.set(id, idx);
  };
  collectSentenceMatches(norm, record);
  collectCodeMatches(norm, record);
  collectProductMatches(norm, bodyPool, record);
  const matches = [...firstIdx.entries()].map(([id, index]) => ({ id, index }));
  return { matches, normalized: norm };
}

// ── Post convenience wrappers ────────────────────────────────────────────────
// Post convenience wrappers. Every caller was concatenating title + selftext —
// centralize that so the join rule (including the `?? ""` guard for
// link/image posts) lives in one place.
type PostLike = { title: string; selftext?: string };
const postText = (p: PostLike) => p.title + " " + (p.selftext ?? "");

export function matchPost(post: PostLike): string[] {
  return matchLenses(postText(post));
}

export function matchPostWithPositions(post: PostLike): {
  matches: PositionedMatch[];
  normalized: string;
} {
  return matchLensesWithPositions(postText(post));
}
