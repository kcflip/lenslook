import { readFileSync, writeFileSync, existsSync } from "fs";
import { type Post } from "./scraper.js";
import { matchProductsWithPositions, compileBodies, ALL_LENSES, type CompiledProduct } from "./matcher.js";
import { calcWeight } from "../shared/weight.js";
import type { Body } from "../shared/types.js";

const USER_AGENT = "lenslook/1.0 by kyle.flippo@gmail.com";

function buildBrandQuery(): string {
  const brands = new Set<string>();
  for (const l of ALL_LENSES) brands.add(l.brand.toLowerCase());
  brands.add("rokinon");
  return [...brands].join(" OR ");
}

async function fetchPage(
  subreddit: string,
  sort: string,
  after: string | null,
  timeframe: string,
  query: string | null,
): Promise<{ posts: Post[]; after: string | null }> {
  const url = query
    ? new URL(`https://www.reddit.com/r/${subreddit}/search.json`)
    : new URL(`https://www.reddit.com/r/${subreddit}/${sort}.json`);
  url.searchParams.set("limit", "25");
  url.searchParams.set("t", timeframe);
  if (query) {
    url.searchParams.set("q", query);
    url.searchParams.set("restrict_sr", "1");
    url.searchParams.set("sort", sort);
  }
  if (after) url.searchParams.set("after", after);

  const res = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Reddit error: ${res.status}`);

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
      timeframe,
      is_self: p.is_self as boolean,
    };
  });

  return { posts, after: data.data.after };
}

const LISTING_SUBREDDITS = ["sonyalpha"];
const SEARCH_SUBREDDITS = ["photography", "astrophotography", "macro"];
const SUBREDDITS = [...LISTING_SUBREDDITS, ...SEARCH_SUBREDDITS];
const SORT = "top" as const;
const TIMEFRAME = "year" as const;
const TARGETS: Record<string, number> = {
  sonyalpha: 10,
  photography: 4,
  astrophotography: 4,
  macro: 4,
};

interface MatchedPost extends Post {
  lensIds: string[];
  formula: {
    score: number;
    upvoteRatio: number;
    numComments: number;
    weight: number;
  };
}

async function findMatches(
  subreddit: string,
  query: string | null,
  bodyPool: CompiledProduct[],
): Promise<MatchedPost[]> {
  const matched: MatchedPost[] = [];
  const target = TARGETS[subreddit] ?? 10;
  let after: string | null = null;

  while (matched.length < target) {
    const result = await fetchPage(subreddit, SORT, after, TIMEFRAME, query);
    console.log(`  r/${subreddit}: fetched ${result.posts.length} posts, ${matched.length} matches so far`);

    for (const post of result.posts) {
      const { matches } = matchProductsWithPositions(
        post.title + " " + (post.selftext ?? ""),
        bodyPool,
      );
      const lensIds = [...new Set(matches.map((m) => m.id))];
      if (lensIds.length > 0) {
        const weight = calcWeight(post);
        matched.push({
          ...post,
          lensIds,
          formula: {
            score: post.score,
            upvoteRatio: post.upvote_ratio,
            numComments: post.num_comments,
            weight: parseFloat(weight.toFixed(3)),
          },
        });
      }
    }

    after = result.after;
    if (!after) {
      console.log(`  r/${subreddit}: no more posts available`);
      break;
    }
  }

  return matched.slice(0, target);
}

async function main() {
  const allPosts: MatchedPost[] = [];
  const brandQuery = buildBrandQuery();

  const bodies: Body[] = existsSync("bodies.json")
    ? JSON.parse(readFileSync("bodies.json", "utf8"))
    : [];
  const bodyPool: CompiledProduct[] = compileBodies(bodies);

  for (const sub of SUBREDDITS) {
    const query = SEARCH_SUBREDDITS.includes(sub) ? brandQuery : null;
    console.log(`\nSearching r/${sub}${query ? " (search)" : " (listing)"}...`);
    const matches = await findMatches(sub, query, bodyPool);
    console.log(`  found ${matches.length} matches`);
    allPosts.push(...matches);
  }

  const lensCounts: Record<string, number> = {};
  for (const post of allPosts) {
    for (const id of post.lensIds) {
      lensCounts[id] = (lensCounts[id] ?? 0) + 1;
    }
  }

  const output = { posts: allPosts, lensCounts };
  writeFileSync("output/test.json", JSON.stringify(output, null, 2));
  console.log(`\nWritten ${allPosts.length} posts to output/test.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
