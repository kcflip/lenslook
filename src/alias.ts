import { writeFileSync, mkdirSync } from "fs";
import { fetchPosts, fetchComments } from "./scraper.js";
import { matchLenses } from "./matcher.js";
import lensData from "../lenses.json" with { type: "json" };
import brandsData from "../brands.json" with { type: "json" };

const SUBREDDITS = ["sonyalpha", "photography"];
const SORT = "top" as const;
const TIMEFRAME = "year" as const;
const LIMIT = 500;
const CONTEXT_WORDS = 5;

interface Lens {
  id: string;
  brand: string;
  name: string;
  model: string;
  focalLength: string;
  maxAperture: string;
  aliases: string[];
}

interface AliasCandidate {
  candidate: string;
  pattern: string;
  surroundingText: string;
  commentId: string;
  commentScore: number;
  lensId: string;
  lensName: string;
  postId: string;
  postTitle: string;
  subreddit: string;
}

const lenses = lensData as Lens[];
const brands = brandsData as string[];

const brandPattern = new RegExp(`\\b(${brands.map(escapeRegex).join("|")})\\b`, "i");

const PATTERNS: { name: string; regex: RegExp }[] = [
  // Combined focal range + aperture
  { name: "focal_range_aperture", regex: /\b\d{2,3}-\d{2,3}mm?\s+f[/]?\d+\.?\d*/i },
  // Combined single focal + aperture
  { name: "focal_single_aperture", regex: /\b\d{2,3}mm\s+f[/]?\d+\.?\d*/i },
  // Aperture before focal
  { name: "aperture_focal", regex: /\bf[/]?\d+\.?\d*\s+\d{2,3}mm/i },
  // Focal range only
  { name: "focal_range", regex: /\b\d{2,3}-\d{2,3}mm?\b/i },
  // Single focal only
  { name: "focal_single", regex: /\b\d{2,3}mm\b/i },
  // Aperture only
  { name: "aperture", regex: /\bf[/]?\d+\.?\d*\b/i },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractContext(text: string, matchIndex: number, matchLength: number): string {
  const words = text.split(/\s+/);
  let charCount = 0;
  let matchWordIndex = -1;

  for (let i = 0; i < words.length; i++) {
    if (charCount >= matchIndex && matchWordIndex === -1) matchWordIndex = i;
    charCount += words[i].length + 1;
  }

  if (matchWordIndex === -1) matchWordIndex = 0;
  const start = Math.max(0, matchWordIndex - CONTEXT_WORDS);
  const end = Math.min(words.length, matchWordIndex + CONTEXT_WORDS + Math.ceil(matchLength / 5) + 1);
  return words.slice(start, end).join(" ");
}

function analyzeComment(
  body: string,
  commentId: string,
  commentScore: number,
  lensId: string,
  lensName: string,
  postId: string,
  postTitle: string,
  subreddit: string
): AliasCandidate | null {
  // Step 1: skip if already matches a known lens
  if (matchLenses(body).length > 0) return null;

  // Step 2a: try brand name first
  const brandMatch = brandPattern.exec(body);
  if (brandMatch) {
    const candidate = extractContext(body, brandMatch.index, brandMatch[0].length);
    return {
      candidate,
      pattern: "brand",
      surroundingText: body.slice(Math.max(0, brandMatch.index - 80), brandMatch.index + 160).trim(),
      commentId,
      commentScore,
      lensId,
      lensName,
      postId,
      postTitle,
      subreddit,
    };
  }

  // Step 2b: try combined and individual focal/aperture patterns
  for (const { name, regex } of PATTERNS) {
    const match = regex.exec(body);
    if (match) {
      const candidate = extractContext(body, match.index, match[0].length);
      return {
        candidate,
        pattern: name,
        surroundingText: body.slice(Math.max(0, match.index - 80), match.index + 160).trim(),
        commentId,
        commentScore,
        lensId,
        lensName,
        postId,
        postTitle,
        subreddit,
      };
    }
  }

  return null;
}

async function main() {
  const candidates: AliasCandidate[] = [];

  for (const sub of SUBREDDITS) {
    console.log(`Fetching r/${sub}...`);
    const posts = await fetchPosts(sub, SORT, LIMIT, TIMEFRAME);
    console.log(`  ${posts.length} posts fetched`);

    for (const post of posts) {
      const lensIds = matchLenses(post.title + " " + post.selftext);
      if (lensIds.length === 0) continue;

      const lens = lenses.find((l) => l.id === lensIds[0])!;
      let comments;
      try {
        comments = await fetchComments(sub, post.id);
      } catch (e) {
        console.warn(`  Failed to fetch comments for ${post.id}: ${e}`);
        continue;
      }

      console.log(`  ${post.id} (${lensIds.length} lens match, ${comments.length} comments)`);

      for (const comment of comments) {
        const result = analyzeComment(
          comment.body,
          comment.id,
          comment.score,
          lens.id,
          lens.name,
          post.id,
          post.title,
          sub
        );
        if (result) candidates.push(result);
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.lensId < b.lensId) return -1;
    if (a.lensId > b.lensId) return 1;
    return b.commentScore - a.commentScore;
  });

  mkdirSync("output", { recursive: true });
  writeFileSync("output/aliases.json", JSON.stringify(candidates, null, 2));
  console.log(`\nWritten ${candidates.length} candidates to output/aliases.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
