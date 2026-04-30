import { readFileSync, writeFileSync, mkdirSync } from "fs";
import type { ReviewItem, ReviewsData, ReviewSource } from "../shared/types.js";

const REVIEWS_FILE = "output/reviews.json";

function load(): ReviewsData {
  try {
    return JSON.parse(readFileSync(REVIEWS_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveReviews(productId: string, sourceType: ReviewSource, reviews: ReviewItem[]): void {
  mkdirSync("output", { recursive: true });
  const data = load();
  const existing = data[productId] ?? [];
  data[productId] = [...existing.filter(r => r.sourceType !== sourceType), ...reviews];
  writeFileSync(REVIEWS_FILE, JSON.stringify(data, null, 2));
}

export function loadReviews(): ReviewsData {
  return load();
}

// Common English function words that rarely appear in Spanish/French/German/
// Italian. Presence of any of these in the tokenized text is a strong English
// signal — cheaper and dependency-free vs. a real language detector.
const ENGLISH_STOPWORDS = new Set([
  "the", "and", "is", "it", "was", "this", "that", "have", "with",
  "for", "but", "not", "you", "are", "my",
]);

export function isEnglish(text: string): boolean {
  const allLetters = text.match(/\p{L}/gu) ?? [];
  if (allLetters.length === 0) return false;
  // Non-Latin scripts (Cyrillic, CJK, Arabic, etc.) — reject if they dominate.
  const latinLetters = text.match(/[a-zA-Z]/g) ?? [];
  if (latinLetters.length / allLetters.length < 0.85) return false;
  const tokens = text.toLowerCase().match(/[a-z']+/g) ?? [];
  // Very short blurbs ("Great lens!") can't be discriminated — accept them.
  if (tokens.length <= 2) return true;
  for (const t of tokens) if (ENGLISH_STOPWORDS.has(t)) return true;
  return false;
}
