import { getAccessToken } from "./auth.js";

export interface Post {
  id: string;
  title: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_utc: number;
  url: string;
  subreddit: string;
}

const USER_AGENT = "lenslook/1.0 by kyle.flippo@gmail.com";

export async function fetchPosts(
  subreddit: string,
  sort: "hot" | "new" | "top" = "hot",
  limit = 500
): Promise<Post[]> {
  const token = await getAccessToken();
  const posts: Post[] = [];
  let after: string | null = null;

  while (posts.length < limit) {
    const batchSize = Math.min(100, limit - posts.length);
    const url = new URL(`https://oauth.reddit.com/r/${subreddit}/${sort}`);
    url.searchParams.set("limit", String(batchSize));
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
    });

    if (!res.ok) throw new Error(`Reddit API error: ${res.status} ${await res.text()}`);

    const data = (await res.json()) as {
      data: { children: { data: Record<string, unknown> }[]; after: string | null };
    };

    for (const child of data.data.children) {
      const p = child.data;
      posts.push({
        id: p.id as string,
        title: p.title as string,
        score: p.score as number,
        upvote_ratio: p.upvote_ratio as number,
        num_comments: p.num_comments as number,
        created_utc: p.created_utc as number,
        url: p.url as string,
        subreddit: p.subreddit as string,
      });
    }

    after = data.data.after;
    if (!after) break;
  }

  return posts;
}
