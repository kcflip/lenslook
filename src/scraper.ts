export interface Comment {
  id: string;
  body: string;
  score: number;
  parent_id: string;
}

export interface Post {
  id: string;
  title: string;
  selftext: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_utc: number;
  url: string;
  subreddit: string;
  sort: string;
  timeframe: string | null;
}

type Sort = "hot" | "new" | "top" | "rising" | "controversial";
type Timeframe = "hour" | "day" | "week" | "month" | "year" | "all";

const USER_AGENT = "lenslook/1.0 by kyle.flippo@gmail.com";
const MAX_RETRIES = 5;

async function redditFetch(url: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "60", 10);
      console.log(`  Rate limited by Reddit. Waiting ${retryAfter}s before retrying... (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
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

export async function fetchBatch(
  subreddit: string,
  sort: Sort = "hot",
  after: string | null = null,
  batchSize = 25,
  timeframe?: Timeframe
): Promise<{ posts: Post[]; after: string | null }> {
  const url = new URL(`https://www.reddit.com/r/${subreddit}/${sort}.json`);
  url.searchParams.set("limit", String(batchSize));
  if (after) url.searchParams.set("after", after);
  if (timeframe && (sort === "top" || sort === "controversial")) {
    url.searchParams.set("t", timeframe);
  }

  const res = await redditFetch(url.toString());
  if (!res.ok) throw new Error(`Reddit error: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as {
    data: { children: { data: Record<string, unknown> }[]; after: string | null };
  };

  const posts: Post[] = data.data.children.map((child) => {
    const p = child.data;
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
    };
  });

  return { posts, after: data.data.after };
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

    const res = await redditFetch(url.toString());
    if (!res.ok) throw new Error(`Reddit error: ${res.status} ${await res.text()}`);

    const data = (await res.json()) as {
      data: { children: { data: Record<string, unknown> }[]; after: string | null };
    };

    for (const child of data.data.children) {
      const p = child.data;
      posts.push({
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
      });
    }

    after = data.data.after;
    if (!after) break;
  }

  return posts;
}
