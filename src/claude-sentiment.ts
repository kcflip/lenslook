import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import lensData from "../lenses.json" with { type: "json" };
import type { Lens, ResultsData, ClaudeSentimentResult, ReviewItem, SentimentCitation } from "../shared/types.js";
import { loadReviews } from "./reviews.js";

const RESULTS_INPUT = "output/results.json";
const OUTPUT = "output/claude-sentiment.json";
const BATCH_SIZE = 10;
const REDDIT_CAP = 30;
const REVIEW_CAP = 20;
const MODEL = "claude-sonnet-4-6";

interface LensReviews {
  lensId: string;
  lensName: string;
  items: ReviewItem[];
}

const SYSTEM_PROMPT = `You are a camera lens sentiment analyst. You will receive batches of opinion data for specific camera lenses and must return structured sentiment analysis as JSON.

Each lens includes a mix of sources — Reddit posts ("reddit_post"), Reddit comments ("reddit_comment"), Amazon verified-purchase reviews ("amazon"), and B&H verified-buyer reviews ("bh"). Amazon and B&H items include a 1–5 star rating and represent customer experience with an actual purchased product. Reddit items carry community discussion signal but may lack purchase context.

Only consider items that express an opinion about the lens's optical or build quality — sharpness, bokeh, autofocus, distortion, size, value, reliability, etc. Disregard items where the lens is merely named without judgment (gear lists, sale posts, "which lens should I buy" questions). Do not infer sentiment from neutral or off-topic mentions.

Weight structured reviews (amazon, bh) somewhat more heavily than Reddit mentions when they agree or disagree with Reddit sentiment, since they reflect actual ownership.

For each lens, analyze only the qualifying items and return an object with:
- score: number from -1 (very negative) to 1 (very positive)
- label: "positive", "negative", "neutral", or "mixed"
- summary: 1-2 sentence summary of overall sentiment across all sources
- positives: array of citation objects (max 5), each with:
    - aspect: short phrase describing the positive ("sharp wide open", "fast autofocus")
    - quote: a DIRECT VERBATIM excerpt copied from one of the provided items' "text" field — character-for-character identical to the source. Do not paraphrase, rewrite, translate, fix typos, re-case, or stitch multiple excerpts together. You may trim surrounding context from either end, but the returned string must appear exactly as-is somewhere in the original "text".
    - source: the "source" value of the item the quote came from ("reddit_post", "reddit_comment", "amazon", or "bh")
- negatives: array of citation objects (max 5), same shape as positives
- mentionCount: total number of items provided

Critical constraints:
- Every quote must be a verbatim copy from an input item. If no verbatim quote supports an aspect, omit that aspect entirely.
- Never invent aspects, quotes, or sources. Never emit a citation without textual evidence you can point at.
- Keep quotes tight — aim for 1–2 sentences, enough to justify the aspect without bloat.
- If the provided items for a lens yield no qualifying opinion, return empty positives and negatives arrays rather than fabricating points.

Return a JSON object where each key is a lensId and the value is the sentiment object. Return only valid JSON, no other text.`;

function redditItems(data: ResultsData, lensById: Record<string, Lens>): Map<string, ReviewItem[]> {
  const map = new Map<string, ReviewItem[]>();
  const push = (lensId: string, item: ReviewItem) => {
    if (!map.has(lensId)) map.set(lensId, []);
    map.get(lensId)!.push(item);
  };

  for (const post of data.posts) {
    const postText = post.title + (post.selftext && post.selftext !== "[removed]"
      ? ": " + post.selftext.slice(0, 300)
      : "");

    for (const lensId of post.postLensIds ?? []) {
      push(lensId, {
        sourceType: "reddit_post",
        lensId,
        text: postText,
        upvoteScore: post.score,
        images: [],
      });
    }

    for (const lensId of post.commentLensIds ?? []) {
      for (const comment of post.matchedComments ?? []) {
        if (comment.lensIds && !comment.lensIds.includes(lensId)) continue;
        push(lensId, {
          sourceType: "reddit_comment",
          lensId,
          text: comment.body,
          upvoteScore: comment.score,
          images: [],
        });
      }
    }
  }

  // Cap Reddit per lens, preferring higher-scored items
  for (const [lensId, items] of map) {
    items.sort((a, b) => (b.upvoteScore ?? 0) - (a.upvoteScore ?? 0));
    map.set(lensId, items.slice(0, REDDIT_CAP));
  }

  return map;
}

function mergeSources(
  redditMap: Map<string, ReviewItem[]>,
  reviewsByLens: Record<string, ReviewItem[]>,
  lensById: Record<string, Lens>,
): LensReviews[] {
  const allLensIds = new Set<string>([...redditMap.keys(), ...Object.keys(reviewsByLens)]);
  const out: LensReviews[] = [];

  for (const lensId of allLensIds) {
    const reddit = redditMap.get(lensId) ?? [];
    const reviews = (reviewsByLens[lensId] ?? []).filter(r => r.sourceType === "amazon" || r.sourceType === "bh").slice(0, REVIEW_CAP);
    const items = [...reviews, ...reddit];
    if (items.length === 0) continue;
    const lens = lensById[lensId];
    out.push({ lensId, lensName: lens ? `${lens.brand} ${lens.model}` : lensId, items });
  }

  return out;
}

// Verifies that each citation's quote appears verbatim somewhere in the items
// we actually sent for this lens. Drops anything that doesn't match — our
// defense against a model paraphrase or hallucination slipping into the UI.
// Whitespace is normalized before comparison so minor formatting drift (e.g.
// a literal newline Claude replaces with a space) still counts as a match.
function verifyCitations(citations: SentimentCitation[], items: ReviewItem[]): SentimentCitation[] {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const haystack = items.map(i => norm(i.text)).join("  ");
  const kept: SentimentCitation[] = [];
  for (const c of citations) {
    if (!c.quote || !c.aspect) continue;
    if (haystack.includes(norm(c.quote))) kept.push(c);
  }
  return kept;
}

async function analyzeBatch(
  client: Anthropic,
  batch: LensReviews[],
): Promise<Record<string, ClaudeSentimentResult>> {
  const payload = batch.map(l => ({
    lensId: l.lensId,
    lensName: l.lensName,
    items: l.items.map(r => ({
      source: r.sourceType,
      rating: r.rating,
      text: r.text,
    })),
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Analyze sentiment for these ${batch.length} lenses:\n\n${JSON.stringify(payload, null, 2)}` }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
  const parsed: Record<string, ClaudeSentimentResult> = JSON.parse(match[0]);

  const itemsByLens = new Map(batch.map(b => [b.lensId, b.items]));
  let droppedPos = 0, droppedNeg = 0;
  for (const [lensId, result] of Object.entries(parsed)) {
    const items = itemsByLens.get(lensId) ?? [];
    const verifiedPos = verifyCitations(result.positives ?? [], items);
    const verifiedNeg = verifyCitations(result.negatives ?? [], items);
    droppedPos += (result.positives?.length ?? 0) - verifiedPos.length;
    droppedNeg += (result.negatives?.length ?? 0) - verifiedNeg.length;
    result.positives = verifiedPos;
    result.negatives = verifiedNeg;
  }
  if (droppedPos || droppedNeg) {
    console.warn(`    (dropped ${droppedPos} positive + ${droppedNeg} negative unverifiable citations)`);
  }
  return parsed;
}

async function main() {
  const client = new Anthropic();
  const data: ResultsData = JSON.parse(readFileSync(RESULTS_INPUT, "utf8"));
  const reviewsByLens = loadReviews();
  const lensById: Record<string, Lens> = Object.fromEntries(
    (lensData as Lens[]).map((l) => [l.id, l]),
  );

  const totalReviews = Object.values(reviewsByLens).reduce((n, items) => n + items.length, 0);
  console.log(`Loaded ${data.posts.length} Reddit posts, ${totalReviews} retailer reviews across ${Object.keys(reviewsByLens).length} lenses`);

  const lensEntries = mergeSources(redditItems(data, lensById), reviewsByLens, lensById);
  console.log(`${lensEntries.length} lenses have opinion data — sending in batches of ${BATCH_SIZE}`);

  const results: Record<string, ClaudeSentimentResult> = {};
  const batches = [];
  for (let i = 0; i < lensEntries.length; i += BATCH_SIZE) {
    batches.push(lensEntries.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`  Batch ${i + 1}/${batches.length} (${batch.map((l) => l.lensId).join(", ")})... `);
    const batchResults = await analyzeBatch(client, batch);
    Object.assign(results, batchResults);
    console.log("done");
  }

  mkdirSync("output", { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify({ fetchedAt: new Date().toISOString(), lenses: results }, null, 2));
  console.log(`\nWritten to ${OUTPUT} (${Object.keys(results).length} lenses)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
