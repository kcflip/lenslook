import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import type { ReviewItem, ReviewsData, ReviewSource } from "../shared/types.js";

const REVIEWS_FILE = "output/reviews.json";

function load(): ReviewsData {
  try {
    return JSON.parse(readFileSync(REVIEWS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function reviewFingerprint(r: ReviewItem): string {
  const key = `${r.author ?? ""}|${r.date ?? ""}|${r.text.trim()}`;
  return createHash("md5").update(key).digest("hex");
}

export function saveReviews(productId: string, sourceType: ReviewSource, reviews: ReviewItem[]): { added: number; skipped: number } {
  mkdirSync("output", { recursive: true });
  const data = load();
  const existing = data[productId] ?? [];
  const seen = new Set(existing.filter(r => r.sourceType === sourceType).map(reviewFingerprint));
  const toAdd = reviews.filter(r => !seen.has(reviewFingerprint(r)));
  data[productId] = [...existing, ...toAdd];
  writeFileSync(REVIEWS_FILE, JSON.stringify(data, null, 2));
  return { added: toAdd.length, skipped: reviews.length - toAdd.length };
}

export function loadReviews(): ReviewsData {
  return load();
}

// Rejects reviews in non-Latin scripts (Cyrillic, CJK, Arabic, etc.).
// US retailers (Amazon, B&H, Adorama) are overwhelmingly English — checking
// Latin dominance is enough. A stopword approach false-positives too often on
// adjective-heavy review titles that contain no function words.
export function isEnglish(text: string): boolean {
  const allLetters = text.match(/\p{L}/gu) ?? [];
  if (allLetters.length === 0) return false;
  const latinLetters = text.match(/[a-zA-Z]/g) ?? [];
  return latinLetters.length / allLetters.length >= 0.85;
}
