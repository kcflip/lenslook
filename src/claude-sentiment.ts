import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import lensData from "../lenses.json" with { type: "json" };
import type { Lens, Body, ResultsData, ClaudeSentimentResult, ReviewItem, SentimentCitation } from "../shared/types.js";
import { loadReviews } from "./reviews.js";

const RESULTS_INPUT = "output/sonyResults.json";
const OUTPUT = "output/claude-sentiment.json";
const BATCH_SIZE = 6;
const REVIEW_CAP = 20;
const MODEL = "claude-haiku-4-5-20251001";

type Mode = "lenses" | "bodies";
const MODE: Mode = process.argv.includes("--bodies") ? "bodies" : "lenses";

const REDDIT_POST_CAP    = 30;
const REDDIT_COMMENT_CAP = 60;
const SELFTEXT_CAP  = MODE === "bodies" ? 4000 : 2000;

interface LensReviews {
  lensId: string;
  lensName: string;
  items: ReviewItem[];
}

const SHARED_OUTPUT_SCHEMA = `For each product, analyze only the qualifying items and return an object with:
- score: number from -1 (very negative) to 1 (very positive)
- label: "positive", "negative", "neutral", or "mixed"
- summary: 1-2 sentence summary of overall sentiment across all sources
- positives: array of citation objects (max 5), each with:
    - aspect: short phrase describing the positive ("sharp wide open", "fast autofocus")
    - quote: a DIRECT VERBATIM excerpt copied from one of the provided items' "text" field — character-for-character identical to the source. Do not paraphrase, rewrite, translate, fix typos, re-case, or stitch multiple excerpts together. You may trim surrounding context from either end, but the returned string must appear exactly as-is somewhere in the original "text".
    - source: the "source" value of the item the quote came from ("reddit_post", "reddit_comment", "amazon", "bh", or "adorama")
- negatives: array of citation objects (max 5), same shape as positives
- mentionCount: total number of items provided

Critical constraints:
- Every quote must be a verbatim copy from an input item. If no verbatim quote supports an aspect, omit that aspect entirely.
- Never invent aspects, quotes, or sources. Never emit a citation without textual evidence you can point at.
- Keep quotes tight — aim for 1–2 sentences, enough to justify the aspect without bloat.
- If the provided items for a product yield no qualifying opinion, return empty positives and negatives arrays rather than fabricating points.

Return a JSON object where each key is the product id and the value is the sentiment object. Return only valid JSON, no other text.`;

const LENS_SYSTEM_PROMPT = `You are a camera lens sentiment analyst. You will receive batches of opinion data for specific camera lenses and must return structured sentiment analysis as JSON.

Each lens includes a mix of sources — Reddit posts ("reddit_post"), Reddit comments ("reddit_comment"), Amazon verified-purchase reviews ("amazon"), B&H verified-buyer reviews ("bh"), and Adorama verified-buyer reviews ("adorama"). Amazon, B&H, and Adorama items include a 1–5 star rating and represent customer experience with an actual purchased product. Reddit items carry community discussion signal but may lack purchase context.

Only consider items that express an opinion about the lens's optical or build quality — sharpness, bokeh, autofocus, distortion, size, value, reliability, etc. Disregard items where the lens is merely named without judgment (gear lists, sale posts, "which lens should I buy" questions). Do not infer sentiment from neutral or off-topic mentions.

Weight structured reviews (amazon, bh, adorama) somewhat more heavily than Reddit mentions when they agree or disagree with Reddit sentiment, since they reflect actual ownership.

${SHARED_OUTPUT_SCHEMA}`;

const BODY_SYSTEM_PROMPT = `You are a camera body sentiment analyst. You will receive batches of opinion data for specific camera bodies and must return structured sentiment analysis as JSON.

Each body includes a mix of sources — Reddit posts ("reddit_post"), Reddit comments ("reddit_comment"), Amazon verified-purchase reviews ("amazon"), B&H verified-buyer reviews ("bh"), and Adorama verified-buyer reviews ("adorama"). Amazon, B&H, and Adorama items include a 1–5 star rating and represent customer experience with an actual purchased product. Reddit items carry community discussion signal but may lack purchase context.

Only consider items that express an opinion about the body's performance, usability, or build — autofocus tracking and acquisition speed, low-light AF capability, EVF resolution and lag, IBIS effectiveness, burst rate and buffer depth, video capabilities (rolling shutter, overheating, codec quality, log profiles), battery life, ergonomics, weather sealing, and value. Disregard items where the body is merely named without judgment (gear lists, sale posts). Do not infer sentiment from neutral or off-topic mentions.

Weight structured reviews (amazon, bh, adorama) somewhat more heavily than Reddit mentions when they agree or disagree with Reddit sentiment, since they reflect actual ownership.

${SHARED_OUTPUT_SCHEMA}`;

function redditItems(data: ResultsData, productById: Record<string, Lens | Body>): Map<string, ReviewItem[]> {
  const map = new Map<string, ReviewItem[]>();
  const push = (id: string, item: ReviewItem) => {
    if (!productById[id]) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push(item);
  };

  const postIdField   = MODE === "bodies" ? "postBodyIds"    : "postLensIds";
  const commentIdField = MODE === "bodies" ? "commentBodyIds" : "commentLensIds";
  const commentMatchField = MODE === "bodies" ? "bodyIds" : "lensIds";

  for (const post of data.posts) {
    const postText = post.title + (post.selftext && post.selftext !== "[removed]"
      ? ": " + post.selftext.slice(0, SELFTEXT_CAP)
      : "");

    for (const id of (post[postIdField] ?? []) as string[]) {
      push(id, {
        sourceType: "reddit_post",
        productId: id,
        text: postText,
        upvoteScore: post.score,
        images: [],
      });
    }

    for (const id of (post[commentIdField] ?? []) as string[]) {
      for (const comment of post.matchedComments ?? []) {
        const ids = comment[commentMatchField] as string[] | undefined;
        if (ids && !ids.includes(id)) continue;
        push(id, {
          sourceType: "reddit_comment",
          productId: id,
          text: comment.body,
          upvoteScore: comment.score,
          images: [],
        });
      }
    }
  }

  // Cap posts and comments independently per product, preferring higher-scored items
  for (const [id, items] of map) {
    const posts    = items.filter(i => i.sourceType === "reddit_post")
                         .sort((a, b) => (b.upvoteScore ?? 0) - (a.upvoteScore ?? 0))
                         .slice(0, REDDIT_POST_CAP);
    const comments = items.filter(i => i.sourceType === "reddit_comment")
                         .sort((a, b) => (b.upvoteScore ?? 0) - (a.upvoteScore ?? 0))
                         .slice(0, REDDIT_COMMENT_CAP);
    map.set(id, [...posts, ...comments]);
  }

  return map;
}

function mergeSources(
  redditMap: Map<string, ReviewItem[]>,
  reviewsByLens: Record<string, ReviewItem[]>,
  productById: Record<string, Lens | Body>,
): LensReviews[] {
  const allIds = new Set<string>([...redditMap.keys(), ...Object.keys(reviewsByLens)]);
  const out: LensReviews[] = [];

  for (const id of allIds) {
    if (!productById[id]) continue;
    const reddit = redditMap.get(id) ?? [];
    const reviews = (reviewsByLens[id] ?? []).filter(r => r.sourceType === "amazon" || r.sourceType === "bh" || r.sourceType === "adorama").slice(0, REVIEW_CAP);
    const items = [...reviews, ...reddit];
    if (items.length === 0) continue;
    const product = productById[id];
    out.push({ lensId: id, lensName: `${product.brand} ${product.model}`, items });
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
  systemPrompt: string,
): Promise<Record<string, ClaudeSentimentResult>> {
  const kind = MODE === "bodies" ? "bodies" : "lenses";
  const payload = batch.map(l => ({
    productId: l.lensId,
    productName: l.lensName,
    items: l.items.map(r => ({
      source: r.sourceType,
      rating: r.rating,
      text: r.text,
    })),
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16384,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Analyze sentiment for these ${batch.length} ${kind}:\n\n${JSON.stringify(payload, null, 2)}` }],
  });

  if (response.stop_reason === "max_tokens") {
    throw new Error(`Response truncated at max_tokens for batch [${batch.map(l => l.lensId).join(", ")}]`);
  }

  let text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  // strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${text.slice(0, 300)}`);
  let parsed: Record<string, ClaudeSentimentResult>;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`JSON parse failed for batch [${batch.map(l => l.lensId).join(", ")}]: ${(e as Error).message}\nRaw (first 500 chars): ${match[0].slice(0, 500)}`);
  }

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

  let products: (Lens | Body)[];
  if (MODE === "bodies") {
    if (!existsSync("bodies.json")) {
      console.error("bodies.json not found — run Phase 1 first");
      process.exit(1);
    }
    products = JSON.parse(readFileSync("bodies.json", "utf8")) as Body[];
  } else {
    products = lensData as Lens[];
  }

  const productById: Record<string, Lens | Body> = Object.fromEntries(products.map(p => [p.id, p]));

  const totalReviews = Object.values(reviewsByLens).reduce((n, items) => n + items.length, 0);
  console.log(`Mode: ${MODE} | Loaded ${data.posts.length} Reddit posts, ${totalReviews} retailer reviews`);

  const systemPrompt = MODE === "bodies" ? BODY_SYSTEM_PROMPT : LENS_SYSTEM_PROMPT;
  const lensEntries = mergeSources(redditItems(data, productById), reviewsByLens, productById);
  console.log(`${lensEntries.length} ${MODE} have opinion data — sending in batches of ${BATCH_SIZE}`);

  const results: Record<string, ClaudeSentimentResult> = {};
  const batches = [];
  for (let i = 0; i < lensEntries.length; i += BATCH_SIZE) {
    batches.push(lensEntries.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`  Batch ${i + 1}/${batches.length} (${batch.map((l) => l.lensId).join(", ")})... `);
    const batchResults = await analyzeBatch(client, batch, systemPrompt);
    Object.assign(results, batchResults);
    console.log("done");
  }

  mkdirSync("output", { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify({ fetchedAt: new Date().toISOString(), lenses: results }, null, 2));
  console.log(`\nWritten to ${OUTPUT} (${Object.keys(results).length} ${MODE})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
