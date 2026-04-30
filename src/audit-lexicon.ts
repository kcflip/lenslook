/**
 * Feeds a sample of real Reddit posts/comments and retailer reviews to Claude,
 * alongside the current phrase-sentiment lexicon, and asks for gaps.
 *
 * Usage:
 *   npx tsx src/audit-lexicon.ts           # lenses (default)
 *   npx tsx src/audit-lexicon.ts --bodies  # camera bodies
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

import {
  POSITIVE_WORDS,
  NEGATIVE_WORDS,
  POSITIVE_PHRASES,
  NEGATIVE_PHRASES,
} from "./sentiment.js";

const MODE = process.argv.includes("--bodies") ? "bodies" : "lenses";
const RESULTS_FILE = "output/sonyResults.json";
const REVIEWS_FILE = "output/reviews.json";
const OUT_FILE = `output/lexicon-audit-${MODE}.json`;

// How many posts and reviews to sample
const POST_SAMPLE = 80;
const REVIEW_SAMPLE = 50;
// Max chars per text snippet
const POST_SNIPPET = 600;
const COMMENT_SNIPPET = 300;
const REVIEW_SNIPPET = 400;

interface Post {
  id: string;
  title: string;
  selftext?: string;
  score: number;
  postLensIds: string[];
  commentLensIds: string[];
  matchedComments?: { id: string; body: string; score: number; lensIds: string[] }[];
}

interface SonyResults {
  posts: Post[];
}

interface Review {
  sourceType: string;
  lensId?: string;
  bodyId?: string;
  text: string;
}

function isBodyId(id: string): boolean {
  return id.startsWith("body-");
}

function isLensId(id: string): boolean {
  return !id.startsWith("body-");
}

function relevantPost(post: Post): boolean {
  const ids = [...(post.postLensIds ?? []), ...(post.commentLensIds ?? [])];
  if (MODE === "bodies") return ids.some(isBodyId);
  return ids.some(isLensId);
}

function snippetOf(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, max) + "…";
}

function buildTextSamples(results: SonyResults, reviews: Record<string, Review[]>): string[] {
  const samples: string[] = [];

  // Posts sorted by score descending
  const posts = results.posts
    .filter(relevantPost)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, POST_SAMPLE);

  for (const post of posts) {
    const parts: string[] = [];
    if (post.title) parts.push(post.title);
    if (post.selftext && post.selftext !== "[removed]" && post.selftext.trim()) {
      parts.push(snippetOf(post.selftext, POST_SNIPPET));
    }
    if (parts.length) samples.push(`[POST] ${parts.join(" | ")}`);

    for (const c of post.matchedComments ?? []) {
      if (c.body?.trim()) {
        samples.push(`[COMMENT] ${snippetOf(c.body, COMMENT_SNIPPET)}`);
      }
    }
  }

  // Retailer reviews
  const allReviews = Object.values(reviews).flat();
  const relevant = allReviews.filter((r) => {
    if (MODE === "bodies") return r.bodyId != null || r.sourceType?.includes("body");
    return true; // reviews are all lens reviews unless bodyId present
  });

  const reviewSample = relevant
    .sort(() => Math.random() - 0.5)
    .slice(0, REVIEW_SAMPLE);

  for (const r of reviewSample) {
    if (r.text?.trim()) {
      samples.push(`[REVIEW:${r.sourceType}] ${snippetOf(r.text, REVIEW_SNIPPET)}`);
    }
  }

  return samples;
}

function formatLexicon(): string {
  return [
    `Positive words: ${POSITIVE_WORDS.join(", ")}`,
    `Negative words: ${NEGATIVE_WORDS.join(", ")}`,
    `Positive phrases: ${POSITIVE_PHRASES.join(", ")}`,
    `Negative phrases: ${NEGATIVE_PHRASES.join(", ")}`,
  ].join("\n");
}

const SYSTEM_PROMPT = `You are a sentiment analysis expert auditing a lexicon used to score ${MODE === "bodies" ? "camera body" : "camera lens"} opinions on Reddit and retail review sites.

You will be given:
1. The current sentiment lexicon (positive/negative words and phrases).
2. A sample of real user text from Reddit posts, comments, and retailer reviews.

Your task: identify vocabulary that appears frequently in the samples and expresses clear positive or negative sentiment, but is NOT already in the lexicon.

Focus on:
- ${MODE === "bodies" ? "Camera body" : "Camera lens"} specific terminology
- Opinion words commonly used in photography communities
- Phrases that carry sentiment but might be missed by single-word matching
- Negated forms that are commonly missed (e.g. "not the sharpest" → already covered by negation logic, skip these)

Do NOT suggest:
- Words already in the lexicon
- Generic English sentiment words with no photography context (good, nice, great — too vague)
- Brand names or model numbers
- Words that are ambiguous without context

Return a JSON object with this exact shape:
{
  "suggestedPositive": ["word or phrase", ...],
  "suggestedNegative": ["word or phrase", ...],
  "suggestedPositivePhrases": ["multi word phrase", ...],
  "suggestedNegativePhrases": ["multi word phrase", ...],
  "notes": "brief commentary on patterns you noticed"
}`;

async function main() {
  console.log(`Mode: ${MODE}`);

  const client = new Anthropic();

  if (!fs.existsSync(RESULTS_FILE)) {
    console.error(`Missing ${RESULTS_FILE} — run 'npm start' first.`);
    process.exit(1);
  }

  const results: SonyResults = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
  const reviews: Record<string, Review[]> = fs.existsSync(REVIEWS_FILE)
    ? JSON.parse(fs.readFileSync(REVIEWS_FILE, "utf8"))
    : {};

  const samples = buildTextSamples(results, reviews);
  console.log(`Sampled ${samples.length} text snippets`);

  const userContent = [
    "## Current lexicon\n",
    formatLexicon(),
    "\n## Text samples\n",
    samples.join("\n"),
    "\n\nPlease audit the lexicon and return your JSON response.",
  ].join("\n");

  console.log("Sending to Claude…");
  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  const raw = response.content.find((b) => b.type === "text")?.text ?? "";

  // Extract JSON from response (Claude may wrap it in markdown)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Could not extract JSON from Claude response:");
    console.error(raw);
    process.exit(1);
  }

  const audit = JSON.parse(jsonMatch[0]);

  const output = {
    mode: MODE,
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    audit,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Written to ${OUT_FILE}`);

  console.log("\n=== Claude's suggestions ===");
  console.log("Positive words:", audit.suggestedPositive?.join(", ") || "(none)");
  console.log("Negative words:", audit.suggestedNegative?.join(", ") || "(none)");
  console.log("Positive phrases:", audit.suggestedPositivePhrases?.join(", ") || "(none)");
  console.log("Negative phrases:", audit.suggestedNegativePhrases?.join(", ") || "(none)");
  if (audit.notes) console.log("\nNotes:", audit.notes);
}

main().catch((err) => { console.error(err); process.exit(1); });
