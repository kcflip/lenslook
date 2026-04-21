import { writeFileSync, mkdirSync } from "fs";
import { fetchPosts, fetchComments } from "./scraper.js";
import { matchLenses, matchPost } from "./matcher.js";
import lensData from "../lenses.json" with { type: "json" };
import brandsData from "../brands.json" with { type: "json" };
import type { Lens } from "../shared/types.js";

const SUBREDDITS = ["sonyalpha", "photography"];
const SORT = "top" as const;
const TIMEFRAME = "year" as const;
const LIMIT = 500;
const CONTEXT_WORDS = 5;
const CANDIDATE_LIMIT = 100;

interface AliasCandidate {
  candidate: string;
  pattern: string;
  surroundingText: string;
  source: "post" | "comment";
  commentId: string | null;
  commentScore: number | null;
  lensId: string | null;
  lensName: string | null;
  matchedLensIds: string[];
  postId: string;
  postTitle: string;
  subreddit: string;
}

const lenses = lensData as Lens[];
const brands = brandsData as string[];

const brandPattern = new RegExp(`\\b(${brands.map(escapeRegex).join("|")})\\b`, "i");

const COMMENT_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "focal_range_aperture", regex: /\b\d{2,3}-\d{2,3}mm?\s+f[/]?\d+\.?\d*/i },
  { name: "focal_single_aperture", regex: /\b\d{2,3}mm\s+f[/]?\d+\.?\d*/i },
  { name: "aperture_focal", regex: /\bf[/]?\d+\.?\d*\s+\d{2,3}mm/i },
];

const POST_PATTERNS: { name: string; regex: RegExp }[] = [
  ...COMMENT_PATTERNS,
  { name: "focal_range", regex: /\b\d{2,3}-\d{2,3}mm?\b/i },
  { name: "focal_single", regex: /\b\d{2,3}mm\b/i },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractContext(text: string, matchIndex: number, matchLength: number, wordsBefore = CONTEXT_WORDS, wordsAfter = CONTEXT_WORDS): string {
  const words = text.split(/\s+/);
  let charCount = 0;
  let matchWordIndex = -1;

  for (let i = 0; i < words.length; i++) {
    if (charCount >= matchIndex && matchWordIndex === -1) matchWordIndex = i;
    charCount += words[i].length + 1;
  }

  if (matchWordIndex === -1) matchWordIndex = 0;
  const start = Math.max(0, matchWordIndex - wordsBefore);
  const end = Math.min(words.length, matchWordIndex + wordsAfter + Math.ceil(matchLength / 5) + 1);
  return words.slice(start, end).join(" ");
}

export function analyzeText(
  body: string,
  source: "post" | "comment",
  commentId: string | null,
  commentScore: number | null,
  lensId: string | null,
  lensName: string | null,
  postId: string,
  postTitle: string,
  subreddit: string
): AliasCandidate | null {
  if (matchLenses(body).length > 0) return null;

  const brandMatch = brandPattern.exec(body);
  if (brandMatch) {
    const afterBrand = body.slice(brandMatch.index + brandMatch[0].length);
    const patterns = source === "post" ? POST_PATTERNS : COMMENT_PATTERNS;
    let focalMatch: RegExpExecArray | null = null;
    for (const { regex } of patterns) {
      focalMatch = regex.exec(afterBrand);
      if (focalMatch && focalMatch.index < 60) break;
      focalMatch = null;
    }
    if (!focalMatch) return null;

    const candidate = `${brandMatch[0]} ${focalMatch[0]}`;
    return {
      candidate,
      pattern: "brand_focal",
      surroundingText: body.slice(Math.max(0, brandMatch.index - 40), brandMatch.index + 160).trim(),
      source,
      commentId,
      commentScore,
      lensId,
      lensName,
      matchedLensIds: matchLenses(candidate),
      postId,
      postTitle,
      subreddit,
    };
  }

  const TRAILING_APERTURE = /^\s+\d+\.?\d*/;

  const patterns = source === "post" ? POST_PATTERNS : COMMENT_PATTERNS;
  for (const { name, regex } of patterns) {
    const match = regex.exec(body);
    if (match) {
      const afterMatch = body.slice(match.index + match[0].length);
      const trailingAperture = TRAILING_APERTURE.exec(afterMatch);
      const fullMatch = trailingAperture ? match[0] + trailingAperture[0].trimEnd() : match[0];
      const candidate = fullMatch.trim();
      return {
        candidate,
        pattern: name,
        surroundingText: body.slice(Math.max(0, match.index - 80), match.index + 160).trim(),
        source,
        commentId,
        commentScore,
        lensId,
        lensName,
        matchedLensIds: matchLenses(candidate),
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

    const unmatched = posts.filter((p) => matchPost(p).length === 0);
    const matched = posts.filter((p) => matchPost(p).length > 0);
    console.log(`  ${unmatched.length} unmatched, ${matched.length} matched`);

    // Primary: unmatched posts — scan post text then comments
    for (const post of unmatched) {
      const postText = post.title + " " + post.selftext;
      const postResult = analyzeText(postText, "post", null, null, null, null, post.id, post.title, sub);
      if (postResult) {
        candidates.push(postResult);
        if (candidates.length >= CANDIDATE_LIMIT) break;
      }

      let comments;
      try {
        comments = await fetchComments(sub, post.id);
      } catch (e) {
        console.warn(`  Failed to fetch comments for ${post.id}: ${e}`);
        continue;
      }

      console.log(`  [unmatched] ${post.id} (${comments.length} comments)`);

      for (const comment of comments) {
        const result = analyzeText(comment.body, "comment", comment.id, comment.score, null, null, post.id, post.title, sub);
        if (result) {
          candidates.push(result);
          if (candidates.length >= CANDIDATE_LIMIT) break;
        }
      }
      if (candidates.length >= CANDIDATE_LIMIT) break;
    }

    if (candidates.length >= CANDIDATE_LIMIT) break;

    // Secondary: matched posts — scan comments for unknown aliases
    for (const post of matched) {
      const lensIds = matchPost(post);
      const lens = lenses.find((l) => l.id === lensIds[0])!;

      let comments;
      try {
        comments = await fetchComments(sub, post.id);
      } catch (e) {
        console.warn(`  Failed to fetch comments for ${post.id}: ${e}`);
        continue;
      }

      console.log(`  [matched: ${lens.id}] ${post.id} (${comments.length} comments)`);

      for (const comment of comments) {
        const result = analyzeText(comment.body, "comment", comment.id, comment.score, lens.id, lens.name, post.id, post.title, sub);
        if (result) {
          candidates.push(result);
          if (candidates.length >= CANDIDATE_LIMIT) break;
        }
      }
      if (candidates.length >= CANDIDATE_LIMIT) break;
    }

    if (candidates.length >= CANDIDATE_LIMIT) break;
  }

  candidates.sort((a, b) => {
    // Unmatched (lensId null) first
    if (a.lensId === null && b.lensId !== null) return -1;
    if (a.lensId !== null && b.lensId === null) return 1;
    if ((a.lensId ?? "") < (b.lensId ?? "")) return -1;
    if ((a.lensId ?? "") > (b.lensId ?? "")) return 1;
    return (b.commentScore ?? 0) - (a.commentScore ?? 0);
  });

  mkdirSync("output", { recursive: true });
  writeFileSync("output/aliases.json", JSON.stringify(candidates, null, 2));
  console.log(`\nWritten ${candidates.length} candidates to output/aliases.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
