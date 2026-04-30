import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { fetchTranscript } from "youtube-transcript/dist/youtube-transcript.esm.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import lensData from "../lenses.json" with { type: "json" };
import type { Lens, ResultsData, VideoSentiment, YouTubeSentimentResult } from "../shared/types.js";

const OUTPUT = "output/youtube-sentiment.json";
const RESULTS_FILE = "output/sonyResults.json";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TRANSCRIPT_CHARS = 20000;
const TOP_LENSES_PER_BRAND = 15;
const VIEW_COUNT_THRESHOLD = 10_000;
const MAX_VIDEOS_PER_LENS = 6;
const MIN_DURATION_SECONDS = 180; // filter out Shorts and sub-3-minute clips
const YT_API_BASE = "https://youtube.googleapis.com/youtube/v3";

// ── Manual video overrides ────────────────────────────────────────────────────
// Entries here are always included, regardless of auto-search results.
// Useful for pinning a specific well-known review or adding lenses outside the top 10.
const MANUAL_VIDEOS: Array<{ lensId: string; videoId: string; reviewer?: string }> = [
  // { lensId: "sony-fe-85mm-f1.4-gm", videoId: "XXXXXXXXXXX", reviewer: "Christopher Frost" },
];

// ── System prompt ─────────────────────────────────────────────────────────────
// Instructions tailored to review transcripts rather than Reddit mentions.
// Key concerns:
//   - Auto-generated transcripts have no punctuation, run-on sentences — Claude
//     must infer sentence boundaries from context, not rely on punctuation.
//   - Reviewers often hedge ("it's not perfect but...") — capture nuance, don't
//     flatten to positive/negative too aggressively.
//   - Ignore: unboxing narration, price/availability commentary, sponsor reads,
//     "smash that like button" filler, and comparisons where the primary subject
//     is a different lens.
//   - Focus exclusively on: sharpness, bokeh, autofocus, distortion, chromatic
//     aberration, vignetting, build quality, size/weight, weather sealing, and
//     overall value for the optical performance delivered.
const SYSTEM_PROMPT = `You are a camera lens review analyst. You will receive a transcript from a YouTube lens review (likely auto-generated, so expect no punctuation and run-on sentences) and must return a structured sentiment analysis as JSON.

FIRST: Verify the transcript is primarily a review of the lens named in the user message. If the transcript is primarily about a different lens (e.g. a comparison video where the named lens is secondary, or the wrong lens entirely), return exactly: { "skip": true }

The transcript contains [M:SS] timestamp markers injected roughly every 15 seconds so you can locate quotes in the video.

Only consider statements that express an opinion about the lens's optical or build quality: sharpness, bokeh, autofocus speed and accuracy, distortion, chromatic aberration, vignetting, build quality, size, weight, weather sealing, and value relative to optical performance.

Ignore: unboxing narration, price and availability commentary, sponsor segments, channel promotion, and comparisons where the reviewer is primarily discussing a different lens.

Auto-generated transcripts have no punctuation — infer sentence boundaries from context. Capture nuanced opinions; do not flatten hedged statements like "it's not the sharpest wide open but stopped down it's excellent" into a simple positive or negative.

Return a JSON object with:
- score: number from -1 (very negative) to 1 (very positive)
- label: "positive", "negative", "neutral", or "mixed"
- summary: 2-3 sentence summary of the reviewer's overall verdict on optical and build quality
- positives: array of quote objects (max 6), each with:
    - quote: verbatim words from the transcript, stripped of any [M:SS] markers, trimmed to the most expressive clause (under 100 characters)
    - timestampSeconds: integer seconds of the nearest preceding [M:SS] marker before this quote
- negatives: same shape as positives (max 6)
- mentionCount: number of distinct opinion statements you identified (not total words)

Return only valid JSON, no other text.`;

// ── YouTube Data API helpers ──────────────────────────────────────────────────

interface VideoSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt?: string;
  viewCount: number;
}

// Parse ISO 8601 duration (e.g. "PT3M30S", "PT1H5M") to total seconds.
function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? "0") * 3600) + (parseInt(m[2] ?? "0") * 60) + parseInt(m[3] ?? "0");
}

async function searchVideos(query: string, apiKey: string): Promise<VideoSearchResult[]> {
  // Step 1 — search.list: get video IDs matching the query (costs 100 quota units)
  const searchUrl = `${YT_API_BASE}/search?part=snippet&q=${encodeURIComponent(query)}&type=video&order=viewCount&maxResults=10&key=${apiKey}`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json() as { items?: Array<{ id: { videoId: string } }>; error?: { message: string; code: number } };
  if (searchData.error) throw new Error(`search.list API error ${searchData.error.code}: ${searchData.error.message}`);
  if (!searchData.items?.length) {
    console.log(`  (search returned no items)`);
    return [];
  }

  const videoIds = searchData.items.map((item) => item.id.videoId).filter(Boolean).join(",");

  // Step 2 — videos.list: fetch statistics + contentDetails for those IDs (costs 1 quota unit per video)
  // viewCount is not returned by search.list — requires a separate videos.list call.
  // contentDetails gives us duration so we can filter out Shorts and sub-3-minute clips.
  const statsUrl = `${YT_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${apiKey}`;
  const statsRes = await fetch(statsUrl);
  const statsData = await statsRes.json() as {
    items?: Array<{
      id: string;
      snippet: { title: string; channelTitle: string; publishedAt?: string };
      statistics: { viewCount?: string };
      contentDetails: { duration: string };
    }>;
    error?: { message: string; code: number };
  };
  if (statsData.error) throw new Error(`videos.list API error ${statsData.error.code}: ${statsData.error.message}`);
  if (!statsData.items?.length) {
    console.log(`  (videos.list returned no items for IDs: ${videoIds})`);
    return [];
  }

  const all = statsData.items.map((v) => ({
    videoId: v.id,
    title: v.snippet.title,
    channelTitle: v.snippet.channelTitle,
    publishedAt: v.snippet.publishedAt,
    viewCount: parseInt(v.statistics.viewCount ?? "0", 10),
    durationSeconds: parseDuration(v.contentDetails.duration),
  }));

  const afterDuration = all.filter((v) => {
    if (v.durationSeconds >= MIN_DURATION_SECONDS) return true;
    console.log(`  ⏱ skipped short (${v.durationSeconds}s): "${v.title.slice(0, 60)}"`);
    return false;
  });

  const passing = afterDuration.filter((v) => v.viewCount >= VIEW_COUNT_THRESHOLD);
  if (passing.length === 0 && afterDuration.length > 0) {
    console.log(`  (${afterDuration.length} results found but all below ${(VIEW_COUNT_THRESHOLD / 1000).toFixed(0)}k view threshold — top was "${afterDuration[0].title.slice(0, 50)}" at ${(afterDuration[0].viewCount / 1000).toFixed(0)}k)`);
  }
  return passing.sort((a, b) => b.viewCount - a.viewCount);
}

function buildSearchQuery(lens: Lens): string {
  // e.g. "Sony 85mm f/1.4 GM review" — specific enough to surface dedicated reviews
  return `${lens.brand} ${lens.focalLength} ${lens.maxAperture} review`;
}

// Require the title to contain the brand and at least one of the focal length numbers
// so comparison/wrong-lens videos are filtered before we spend transcript quota on them.
function titleMatchesLens(title: string, lens: Lens): boolean {
  const t = title.toLowerCase();
  if (!t.includes(lens.brand.toLowerCase())) return false;
  const focalNums = lens.focalLength.match(/\d+/g) ?? [];
  return focalNums.some((n) => t.includes(n));
}

// ── Transcript + Claude helpers ───────────────────────────────────────────────

const TIMESTAMP_INTERVAL_SECONDS = 15;

function fmtTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `[${m}:${s.toString().padStart(2, "0")}]`;
}

async function ytFetchTranscript(videoId: string): Promise<string> {
  const segments = await fetchTranscript(videoId) as Array<{ text: string; start: number }>;
  let result = "";
  let lastMarkerAt = -TIMESTAMP_INTERVAL_SECONDS; // force a marker at the very start
  for (const seg of segments) {
    if (seg.start - lastMarkerAt >= TIMESTAMP_INTERVAL_SECONDS) {
      result += ` ${fmtTimestamp(seg.start)}`;
      lastMarkerAt = seg.start;
    }
    result += " " + seg.text;
  }
  const full = result.trim();
  return full.length > MAX_TRANSCRIPT_CHARS ? full.slice(0, MAX_TRANSCRIPT_CHARS) : full;
}

async function analyzeTranscript(
  client: Anthropic,
  lensName: string,
  transcript: string,
  reviewer?: string,
): Promise<Omit<VideoSentiment, "videoId" | "url" | "reviewer"> | null> {
  const header = reviewer ? `Reviewer: ${reviewer}\n\n` : "";
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Analyze this review transcript for the ${lensName}:\n\n${header}${transcript}`,
    }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]);
  if (parsed.skip === true) return null;
  return parsed;
}


// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error("Missing YOUTUBE_API_KEY in .env");
    process.exit(1);
  }

  if (!existsSync(RESULTS_FILE)) {
    console.error(`${RESULTS_FILE} not found — run npm start first`);
    process.exit(1);
  }

  const resultsData: ResultsData = JSON.parse(readFileSync(RESULTS_FILE, "utf8"));

  const lensById: Record<string, Lens> = Object.fromEntries(
    (lensData as Lens[]).map((l) => [l.id, l]),
  );

  // Top N per brand by scoreSentiment. stats is already sorted descending by
  // scoreSentiment, so grouping preserves that order — we just take the head
  // of each brand's group.
  const byBrand = new Map<string, string[]>();
  for (const s of resultsData.stats) {
    const lens = lensById[s.lensId];
    if (!lens) continue;
    if (!byBrand.has(lens.brand)) byBrand.set(lens.brand, []);
    const group = byBrand.get(lens.brand)!;
    if (group.length < TOP_LENSES_PER_BRAND) group.push(s.lensId);
  }
  const topLensIds = [...byBrand.values()].flat();

  console.log(`Top ${TOP_LENSES_PER_BRAND} per brand by score sentiment (${topLensIds.length} lenses across ${byBrand.size} brands):`);
  for (const [brand, ids] of byBrand) {
    console.log(`  ${brand} (${ids.length}):`);
    ids.forEach((id, i) => {
      const l = lensById[id];
      console.log(`    ${i + 1}. ${l ? l.model : id}`);
    });
  }
  console.log();

  // Build video map: start with manual overrides, then fill from API search
  interface VideoEntry {
    videoId: string;
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    viewCount?: number;
    reviewer?: string;
  }
  const videoMap = new Map<string, VideoEntry[]>();

  for (const v of MANUAL_VIDEOS) {
    if (!videoMap.has(v.lensId)) videoMap.set(v.lensId, []);
    videoMap.get(v.lensId)!.push({ videoId: v.videoId, reviewer: v.reviewer });
  }

  console.log("Searching YouTube for reviews...");
  for (const lensId of topLensIds) {
    const lens = lensById[lensId];
    if (!lens) continue;

    const query = buildSearchQuery(lens);
    process.stdout.write(`  → "${query}"... `);

    try {
      const found = await searchVideos(query, apiKey);
      const titleMatched = found.filter((v) => {
        if (titleMatchesLens(v.title, lens)) return true;
        console.log(`  ✗ title mismatch: "${v.title.slice(0, 70)}"`);
        return false;
      });
      const existing = new Set((videoMap.get(lensId) ?? []).map((v) => v.videoId));
      const newVideos = titleMatched
        .filter((v) => !existing.has(v.videoId))
        .slice(0, MAX_VIDEOS_PER_LENS - (videoMap.get(lensId)?.length ?? 0));

      if (newVideos.length > 0) {
        if (!videoMap.has(lensId)) videoMap.set(lensId, []);
        for (const v of newVideos) {
          videoMap.get(lensId)!.push({
            videoId: v.videoId,
            title: v.title,
            channelTitle: v.channelTitle,
            publishedAt: v.publishedAt,
            viewCount: v.viewCount,
          });
          console.log(`     ✓ "${v.title.slice(0, 70)}" — ${v.channelTitle} (${(v.viewCount / 1000).toFixed(0)}k views)`);
        }
      }

      console.log(`  ${found.length} above threshold, ${titleMatched.length} title-matched, using ${newVideos.length}`);
    } catch (err) {
      console.log(`failed — ${err instanceof Error ? err.message : err}`);
    }
  }

  const client = new Anthropic();
  const results: Record<string, YouTubeSentimentResult> = {};

  const lensesWithVideos = [...videoMap.entries()].filter(([, v]) => v.length > 0);
  const totalVideos = lensesWithVideos.reduce((s, [, v]) => s + v.length, 0);

  if (totalVideos === 0) {
    console.log("\nNo videos found — nothing to analyze.");
    return;
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Transcript + analysis phase`);
  console.log(`  ${lensesWithVideos.length} lenses · ${totalVideos} videos total`);
  console.log(`${"─".repeat(60)}`);

  let videosDone = 0;
  let lensesDone = 0;

  for (const [lensId, videos] of lensesWithVideos) {
    const lens = lensById[lensId];
    const lensName = lens ? `${lens.brand} ${lens.model}` : lensId;
    lensesDone++;
    console.log(`\n[${lensesDone}/${lensesWithVideos.length}] ${lensName}`);

    const videoSentiments: VideoSentiment[] = [];

    for (const video of videos) {
      videosDone++;
      const tag = `  [video ${videosDone}/${totalVideos}]`;
      process.stdout.write(`${tag} fetching transcript${video.reviewer ? ` (${video.reviewer})` : ""}... `);
      try {
        const transcript = await ytFetchTranscript(video.videoId);
        console.log(`${(transcript.length / 1000).toFixed(1)}k chars`);

        process.stdout.write(`${tag} sending to Claude... `);
        const result = await analyzeTranscript(client, lensName, transcript, video.reviewer);
        if (result === null) {
          console.log(`skipped (wrong lens per Claude)`);
          continue;
        }
        videoSentiments.push({
          videoId: video.videoId,
          url: `https://www.youtube.com/watch?v=${video.videoId}`,
          title: video.title,
          channelTitle: video.channelTitle,
          publishedAt: video.publishedAt,
          viewCount: video.viewCount,
          reviewer: video.reviewer,
          ...result,
        });
        console.log(`score ${result.score > 0 ? "+" : ""}${result.score} · ${result.label} · ${result.mentionCount} opinions`);
      } catch (err) {
        console.log(`FAILED — ${err instanceof Error ? err.message : err}`);
      }
    }

    if (videoSentiments.length > 0) {
      results[lensId] = { videos: videoSentiments };
      console.log(`  → ${videoSentiments.length} video(s) stored`);
    } else {
      console.log(`  → no usable results for this lens`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Done — ${Object.keys(results).length}/${lensesWithVideos.length} lenses analyzed`);
  console.log(`${"─".repeat(60)}`);

  mkdirSync("output", { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify({ fetchedAt: new Date().toISOString(), lenses: results }, null, 2));
  console.log(`\nWritten to ${OUTPUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
