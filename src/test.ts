import { writeFileSync } from "fs";
import { fetchBatch, type Post } from "./scraper.js";
import { matchLenses } from "./matcher.js";

const SUBREDDITS = ["sonyalpha", "photography"];
const SORT = "top" as const;
const TIMEFRAME = "year" as const;
const TARGETS: Record<string, number> = {
  sonyalpha: 10,
  photography: 4,
};

interface MatchedPost extends Post {
  lensIds: string[];
  formula: {
    score: number;
    upvoteRatio: number;
    numComments: number;
    engagementScore: number;
    discussionScore: number;
    weight: number;
  };
}

async function findMatches(subreddit: string): Promise<MatchedPost[]> {
  const matched: MatchedPost[] = [];
  const target = TARGETS[subreddit] ?? 10;
  let after: string | null = null;

  while (matched.length < target) {
    const result = await fetchBatch(subreddit, SORT, after, 25, TIMEFRAME);
    console.log(`  r/${subreddit}: fetched ${result.posts.length} posts, ${matched.length} matches so far`);

    for (const post of result.posts) {
      const lensIds = matchLenses(post.title + " " + post.selftext);
      if (lensIds.length > 0) {
        const engagementScore = post.score * post.upvote_ratio;
        const discussionScore = Math.log(1 + post.num_comments);
        const weight = engagementScore * 0.8 + discussionScore * 0.2;
        matched.push({
          ...post,
          lensIds,
          formula: {
            score: post.score,
            upvoteRatio: post.upvote_ratio,
            numComments: post.num_comments,
            engagementScore: Math.round(engagementScore),
            discussionScore: parseFloat(discussionScore.toFixed(3)),
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

  for (const sub of SUBREDDITS) {
    console.log(`\nSearching r/${sub}...`);
    const matches = await findMatches(sub);
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
