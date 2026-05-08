# TODO

## Timestamp YouTube quotes

Make each positive/negative quote in the YouTube reviews section jump to its moment in the video.

### Context

`youtube-transcript`'s `fetchTranscript` returns segments shaped like `{ text, offset, duration }` (offset in seconds). Today `ytFetchTranscript` in `src/youtube-sentiment.ts:109` flattens them with `.map(s => s.text).join(" ")`, so all timing is discarded before Claude ever sees the transcript.

### Plan

1. **Preserve segment timings.** Change `ytFetchTranscript` to return both the flattened string (what Claude analyzes) and a `segments` array or cumulative offset→time map so we can look up "at what second does character index N appear?"

2. **Match quotes back to timestamps.** After Claude returns verbatim `positives` / `negatives`, search each quote substring against the transcript and resolve the containing segment's `offset`. Expect ~5–10% of quotes to miss due to paraphrasing — fall back to no timestamp when there's no match (don't guess).

3. **Persist the timestamp.** Extend `VideoSentiment.positives` / `negatives` in `shared/types.ts` from `string[]` to `{ quote: string; t?: number }[]` (or a parallel array if we want to avoid breaking the JSON shape). Tradeoff: object-per-quote is cleaner; parallel arrays are backward-compatible with existing `output/youtube-sentiment.json`.

4. **Link on the dashboard.** In `dashboard/src/tabs/LensDetailPage.tsx:297` and `:305`, wrap each quote in an anchor to `https://www.youtube.com/watch?v=${videoId}&t=${t}s` when `t` is present. Keep the plain italic for quotes without a timestamp.

### Open questions

- Is the `youtube-transcript` segment `offset` in seconds or milliseconds? Verify before shipping — library versions have differed on this.
- When a quote spans two segments, use the earlier segment's offset, or nudge forward by the quote's position within the concat'd text? Probably the former — simpler, and the user sees the context anyway.
- Fuzzy-match fallback for paraphrased quotes (Levenshtein over the transcript words)? Start without it; see how many quotes land first.

---

## `callClaudeJson` helper

`src/claude-sentiment.ts`, `src/youtube-sentiment.ts`, and `src/audit-lexicon.ts` all duplicate the same pattern: build a system prompt with `cache_control: ephemeral`, call `client.messages.create`, find the text block, regex-slice `{...}`, `JSON.parse` with try/catch, throw on `stop_reason === "max_tokens"`. Pull this into `src/claude/jsonCall.ts`:

```ts
export async function callClaudeJson<T>(opts: {
  client: Anthropic;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  cache?: boolean;
}): Promise<T>
```

Three-line caller becomes one. New pipelines drop into the same shape. Centralizes the markdown-fence stripping (`text.replace(/^```(?:json)?\s*/m, "")`) currently only in `claude-sentiment.ts`.

---

## `Lens.discontinued` — finish or remove

The `discontinued?: boolean` field exists on `Lens` in `shared/types.ts:163` but nothing reads it: the matcher matches discontinued lenses, retailer scrapers scrape them, and the dashboard shows them. Either:

- Wire it up: filter from the matcher pool, gate retailer scraping, badge the dashboard card.
- Or remove the field and stop tracking it on lens entries.

Was added speculatively; deciding either direction is fine, but the half-state invites confusion.
