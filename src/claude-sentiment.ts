import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import lensData from "../lenses.json" with { type: "json" };
import type { Lens, Post, ResultsData, ClaudeSentimentResult } from "../shared/types.js";

const INPUT = "output/results.json";
const OUTPUT = "output/claude-sentiment.json";
const BATCH_SIZE = 10;
const MAX_MENTIONS_PER_LENS = 50;
const MODEL = "claude-sonnet-4-6";

interface LensMentions {
  lensId: string;
  lensName: string;
  mentions: Array<{ type: "post" | "comment"; text: string; score?: number }>;
}

const SYSTEM_PROMPT = `You are a camera lens sentiment analyst. You will receive batches of Reddit mentions for specific camera lenses and must return structured sentiment analysis as JSON.

Only consider mentions that express an opinion about the lens's optical or build quality — sharpness, bokeh, autofocus, distortion, size, value, reliability, etc. Disregard mentions where the lens is simply named without judgment (e.g. "I used the 35mm f/1.4 today", gear lists, sale posts, "which lens should I buy" questions). Do not infer sentiment from neutral or off-topic mentions.

For each lens, analyze only the qualifying mentions and return an object with:
- score: number from -1 (very negative) to 1 (very positive)
- label: "positive", "negative", "neutral", or "mixed"
- summary: 1-2 sentence summary of overall community sentiment, based only on qualifying mentions
- positives: array of positive aspects mentioned (max 5, concise phrases)
- negatives: array of negative aspects mentioned (max 5, concise phrases)
- mentionCount: total number of mentions provided

Return a JSON object where each key is a lensId and the value is the sentiment object. Return only valid JSON, no other text.`;

async function analyzeBatch(
  client: Anthropic,
  batch: LensMentions[],
): Promise<Record<string, ClaudeSentimentResult>> {
  const userContent = JSON.stringify(
    batch.map((l) => ({ lensId: l.lensId, lensName: l.lensName, mentions: l.mentions })),
    null,
    2,
  );

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Analyze sentiment for these ${batch.length} lenses:\n\n${userContent}` }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

function buildMentionsMap(data: ResultsData, lensById: Record<string, Lens>): Map<string, LensMentions> {
  const map = new Map<string, LensMentions>();

  for (const post of data.posts) {
    const postText = post.title + (post.selftext && post.selftext !== "[removed]"
      ? ": " + post.selftext.slice(0, 300)
      : "");

    for (const lensId of post.postLensIds ?? []) {
      if (!map.has(lensId)) {
        const lens = lensById[lensId];
        map.set(lensId, { lensId, lensName: lens ? `${lens.brand} ${lens.model}` : lensId, mentions: [] });
      }
      const entry = map.get(lensId)!;
      if (entry.mentions.length < MAX_MENTIONS_PER_LENS) {
        entry.mentions.push({ type: "post", text: postText });
      }
    }

    for (const lensId of post.commentLensIds ?? []) {
      if (!map.has(lensId)) {
        const lens = lensById[lensId];
        map.set(lensId, { lensId, lensName: lens ? `${lens.brand} ${lens.model}` : lensId, mentions: [] });
      }
      const entry = map.get(lensId)!;
      for (const comment of post.matchedComments ?? []) {
        if (entry.mentions.length >= MAX_MENTIONS_PER_LENS) break;
        // Only feed comments that actually mention this lens; older data without
        // per-comment lensIds falls back to the post-level attribution above.
        if (comment.lensIds && !comment.lensIds.includes(lensId)) continue;
        entry.mentions.push({ type: "comment", text: comment.body, score: comment.score });
      }
    }
  }

  return map;
}

async function main() {
  const client = new Anthropic();
  const data: ResultsData = JSON.parse(readFileSync(INPUT, "utf8"));
  const lensById: Record<string, Lens> = Object.fromEntries(
    (lensData as Lens[]).map((l) => [l.id, l]),
  );

  console.log(`Loaded ${data.posts.length} posts and ${data.stats.length} lenses`);

  const mentionsMap = buildMentionsMap(data, lensById);
  const lensEntries = [...mentionsMap.values()].filter((l) => l.mentions.length > 0);
  console.log(`${lensEntries.length} lenses have mentions — sending in batches of ${BATCH_SIZE}`);

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
