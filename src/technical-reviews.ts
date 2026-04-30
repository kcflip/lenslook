import { readFileSync, writeFileSync, mkdirSync } from "fs";
import type {
  TechnicalReview,
  TechnicalReviewsData,
  TechnicalSource,
} from "../shared/types.js";

const TECHNICAL_REVIEWS_FILE = "output/technical-reviews.json";

function load(): TechnicalReviewsData {
  try {
    return JSON.parse(readFileSync(TECHNICAL_REVIEWS_FILE, "utf8"));
  } catch {
    return {};
  }
}

// One review per (lensId, source). Re-running overwrites the slot for that
// source, leaving other sources untouched.
export function saveTechnicalReview(
  lensId: string,
  review: TechnicalReview,
): void {
  mkdirSync("output", { recursive: true });
  const data = load();
  const bucket = data[lensId] ?? {};
  bucket[review.source] = review;
  data[lensId] = bucket;
  writeFileSync(TECHNICAL_REVIEWS_FILE, JSON.stringify(data, null, 2));
}

export function loadTechnicalReviews(): TechnicalReviewsData {
  return load();
}

export function getTechnicalReview(
  lensId: string,
  source: TechnicalSource,
): TechnicalReview | undefined {
  return load()[lensId]?.[source];
}
