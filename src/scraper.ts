export type { Comment, RedditPost as Post } from "../shared/types.js";
import type { Comment, RedditPost as Post, PostImage } from "../shared/types.js";

type Sort = "hot" | "new" | "top" | "rising" | "controversial";
type Timeframe = "hour" | "day" | "week" | "month" | "year" | "all";

const USER_AGENT = "lenslook/1.0 by kyle.flippo@gmail.com";
const MAX_RETRIES = 5;

// File cabinet frames — a stick figure walks between two cabinets.
const CAB_TOP = "+-----+";
const CAB_DR  = "| [_] |";
const CAB_SEP = "|-----|";
const CAB_BOT = "+-----+";

const FIGURE_POSITIONS: [string, string, string][] = [
  [" O            ", "/|\\           ", "/ \\           "],
  ["    O         ", "   /|\\        ", "   / \\        "],
  ["      O       ", "     /|\\      ", "     / \\      "],
  ["        O     ", "       /|\\    ", "       / \\    "],
  ["          O   ", "         /|\\  ", "         / \\  "],
  ["            O ", "           /|\\", "           / \\"],
];
const BOUNCE_SEQUENCE = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1];

function buildCabinetFrame(posIdx: number): string[] {
  const [head, body, legs] = FIGURE_POSITIONS[posIdx];
  return [
    `${CAB_TOP}              ${CAB_TOP}`,
    `${CAB_DR}${head}${CAB_DR}`,
    `${CAB_SEP}${body}${CAB_SEP}`,
    `${CAB_DR}${legs}${CAB_DR}`,
    `${CAB_BOT}              ${CAB_BOT}`,
  ];
}

// ── Animation slot (mutex) ──
// When an inner animation starts, it suspends the outer one (clears its drawn
// region) and becomes the active slot. On exit, the outer is restored and
// resumed. This prevents nested animations from fighting for the same cursor.
interface AnimSlot { suspend: () => void; resume: () => void; }
let _activeAnim: AnimSlot | null = null;

// Runs an animation loop. `getRows` returns the full rendered block (frame rows
// plus the status line) for the current tick — length is fixed for the lifetime
// of the animation. Returns a controller that can be torn down.
function startAnimator(getRows: () => string[], rowCount: number): {
  tick: () => void;
  stop: () => void;
} {
  let firstRender = true;
  let suspended = false;
  let stopped = false;

  const clearRegion = () => {
    if (firstRender || stopped) { firstRender = true; return; }
    process.stdout.write(`\x1b[${rowCount}A`);
    for (let i = 0; i < rowCount; i++) process.stdout.write(`\r\x1b[K\n`);
    process.stdout.write(`\x1b[${rowCount}A`);
    firstRender = true;
  };

  const tick = () => {
    if (suspended || stopped) return;
    const rows = getRows();
    if (!firstRender) process.stdout.write(`\x1b[${rowCount}A`);
    firstRender = false;
    for (const row of rows) process.stdout.write(`\r${row}\x1b[K\n`);
  };

  const prev = _activeAnim;
  if (prev) prev.suspend();
  _activeAnim = {
    suspend: () => { suspended = true; clearRegion(); },
    resume: () => { suspended = false; /* firstRender already true */ },
  };

  const stop = () => {
    stopped = true;
    suspended = true;
    clearRegion();
    _activeAnim = prev;
    if (prev) prev.resume();
  };

  return { tick, stop };
}

export async function withCabinetAnimation<T>(label: string, work: Promise<T>): Promise<T> {
  if (!process.stdout.isTTY) return work;
  const start = Date.now();
  const getRows = () => {
    const elapsed = Date.now() - start;
    const posIdx = BOUNCE_SEQUENCE[Math.floor(elapsed / 250) % BOUNCE_SEQUENCE.length];
    return [...buildCabinetFrame(posIdx), `  ${label}`];
  };
  const anim = startAnimator(getRows, 6);
  const interval = setInterval(anim.tick, 150);
  anim.tick();
  try {
    return await work;
  } finally {
    clearInterval(interval);
    anim.stop();
  }
}

async function waitWithSpinner(seconds: number, label: string): Promise<void> {
  console.log(`  (•_•)`);
  console.log(`  ( •_•)>⌐■-■`);
  console.log(`  (⌐■_■)  ${label} — waiting ${seconds}s`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
}

async function redditFetch(url: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "0", 10);
      const backoff = 90 + attempt * 90;
      const wait = retryAfter + backoff;
      const label = `Rate limited — retry ${attempt + 1}/${MAX_RETRIES} (Retry-After ${retryAfter}s + ${backoff}s backoff)`;
      await waitWithSpinner(wait, label);
      continue;
    }
    return res;
  }
  throw new Error(`Reddit rate limit exceeded after ${MAX_RETRIES} retries`);
}

export async function fetchComments(
  subreddit: string,
  postId: string
): Promise<Comment[]> {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json?limit=500`;
  const res = await redditFetch(url);
  if (!res.ok) throw new Error(`Reddit error: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as unknown[];
  const comments: Comment[] = [];

  function walk(children: { data: Record<string, unknown> }[]) {
    for (const child of children) {
      const d = child.data;
      if (typeof d.body === "string" && d.body !== "[deleted]" && d.body !== "[removed]") {
        comments.push({
          id: d.id as string,
          body: d.body,
          score: d.score as number,
          parent_id: d.parent_id as string,
          author: (d.author as string | undefined) ?? "[deleted]",
          created_utc: d.created_utc as number | undefined,
        });
      }
      if (d.replies && typeof d.replies === "object") {
        const replies = d.replies as { data: { children: { data: Record<string, unknown> }[] } };
        walk(replies.data.children);
      }
    }
  }

  const commentListing = data[1] as { data: { children: { data: Record<string, unknown> }[] } };
  walk(commentListing.data.children);

  return comments;
}

// Reddit returns preview URLs with HTML-entity-encoded ampersands (e.g.
// "...&amp;s=..."), because the JSON field mirrors the HTML attribute. Browsers
// won't resolve the signed URL unless we decode first.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

// Pulls image URLs from Reddit's listing JSON in priority order:
//   1. Gallery posts — walk media_metadata in the order gallery_data.items gives.
//   2. Preview payload — single-image posts include a signed i.redd.it mirror.
//   3. Direct image url — fallback for naked i.imgur/i.redd.it links.
function extractImages(p: Record<string, unknown>): PostImage[] {
  const images: PostImage[] = [];

  if (p.is_gallery && p.media_metadata && p.gallery_data) {
    const metadata = p.media_metadata as Record<string, {
      status?: string;
      s?: { u?: string; x?: number; y?: number };
    }>;
    const items = (p.gallery_data as { items?: { media_id: string }[] }).items ?? [];
    for (const item of items) {
      const m = metadata[item.media_id];
      if (m?.status === "valid" && m.s?.u) {
        images.push({ url: decodeHtmlEntities(m.s.u), width: m.s.x, height: m.s.y });
      }
    }
    if (images.length > 0) return images;
  }

  const preview = p.preview as
    | { images?: { source?: { url?: string; width?: number; height?: number } }[] }
    | undefined;
  const src = preview?.images?.[0]?.source;
  if (src?.url) {
    images.push({ url: decodeHtmlEntities(src.url), width: src.width, height: src.height });
    return images;
  }

  const url = p.url as string | undefined;
  if (url && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url)) {
    images.push({ url });
  }
  return images;
}

function mapListingChild(p: Record<string, unknown>, sort: Sort | SearchSort, timeframe?: Timeframe): Post {
  const images = extractImages(p);
  return {
    id: p.id as string,
    title: p.title as string,
    selftext: p.selftext as string,
    score: p.score as number,
    upvote_ratio: p.upvote_ratio as number,
    num_comments: p.num_comments as number,
    created_utc: p.created_utc as number,
    url: p.url as string,
    subreddit: p.subreddit as string,
    sort,
    timeframe: timeframe ?? null,
    is_self: p.is_self as boolean,
    ...(images.length > 0 && { images }),
  };
}

export async function fetchPosts(
  subreddit: string,
  sort: Sort = "hot",
  limit = 500,
  timeframe?: Timeframe
): Promise<Post[]> {
  const posts: Post[] = [];
  let after: string | null = null;

  while (posts.length < limit) {
    const batchSize = Math.min(100, limit - posts.length);
    const url = new URL(`https://www.reddit.com/r/${subreddit}/${sort}.json`);
    url.searchParams.set("limit", String(batchSize));
    if (after) url.searchParams.set("after", after);
    if (timeframe && (sort === "top" || sort === "controversial")) {
      url.searchParams.set("t", timeframe);
    }

    let res: Response;
    try {
      res = await redditFetch(url.toString());
    } catch (e) {
      console.warn(`  ⚠ Rate limit retries exhausted for r/${subreddit}/${sort} — returning ${posts.length} posts collected so far.`);
      break;
    }
    if (!res.ok) throw new Error(`Reddit error: ${res.status} ${await res.text()}`);

    const data = (await res.json()) as {
      data: { children: { data: Record<string, unknown> }[]; after: string | null };
    };

    for (const child of data.data.children) {
      posts.push(mapListingChild(child.data, sort, timeframe));
    }

    after = data.data.after;
    if (!after) break;
  }

  return posts;
}

// Reddit's search-endpoint sort values. `rising` and `controversial` don't
// apply — callers must pass one of these.
export type SearchSort = "relevance" | "hot" | "top" | "new" | "comments";

// Search within a single subreddit. Mirrors fetchPosts but targets the
// `/r/{sub}/search.json` endpoint with a query filter. Useful for niche subs
// where the top listing is mostly off-topic and we want to narrow to posts
// that actually mention our brands.
export async function fetchSearch(
  subreddit: string,
  query: string,
  sort: SearchSort = "relevance",
  limit = 500,
  timeframe?: Timeframe,
): Promise<Post[]> {
  const posts: Post[] = [];
  let after: string | null = null;

  while (posts.length < limit) {
    const batchSize = Math.min(100, limit - posts.length);
    const url = new URL(`https://www.reddit.com/r/${subreddit}/search.json`);
    url.searchParams.set("q", query);
    url.searchParams.set("restrict_sr", "1");
    url.searchParams.set("sort", sort);
    url.searchParams.set("limit", String(batchSize));
    if (after) url.searchParams.set("after", after);
    // `t` only meaningful for `top`; harmless otherwise, but keep it scoped.
    if (timeframe && sort === "top") url.searchParams.set("t", timeframe);

    let res: Response;
    try {
      res = await redditFetch(url.toString());
    } catch {
      console.warn(`  ⚠ Rate limit retries exhausted for r/${subreddit}/search — returning ${posts.length} posts collected so far.`);
      break;
    }
    if (!res.ok) throw new Error(`Reddit error: ${res.status} ${await res.text()}`);

    const data = (await res.json()) as {
      data: { children: { data: Record<string, unknown> }[]; after: string | null };
    };

    for (const child of data.data.children) {
      posts.push(mapListingChild(child.data, sort, timeframe));
    }

    after = data.data.after;
    if (!after) break;
  }

  return posts;
}
