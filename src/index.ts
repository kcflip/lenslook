import { writeFileSync } from "fs";
import { fetchPosts, type Post } from "./scraper.js";
import { matchLenses } from "./matcher.js";

const SUBREDDITS = ["sonyalpha", "photography"];
const SORT = "hot" as const;
const LIMIT = 500;

interface MatchedPost extends Post {
  lensIds: string[];
}

interface LensStats {
  lensId: string;
  postCount: number;
  avgScore: number;
  avgUpvoteRatio: number;
  avgComments: number;
}

async function main() {
  const allMatched: MatchedPost[] = [];

  for (const sub of SUBREDDITS) {
    console.log(`Fetching r/${sub}...`);
    const posts = await fetchPosts(sub, SORT, LIMIT);
    console.log(`  ${posts.length} posts fetched`);

    for (const post of posts) {
      const lensIds = matchLenses(post.title);
      if (lensIds.length > 0) allMatched.push({ ...post, lensIds });
    }
  }

  console.log(`\nMatched ${allMatched.length} posts mentioning at least one lens.`);

  // Aggregate stats per lens
  const statsMap = new Map<string, { scores: number[]; ratios: number[]; comments: number[] }>();

  for (const post of allMatched) {
    for (const id of post.lensIds) {
      if (!statsMap.has(id)) statsMap.set(id, { scores: [], ratios: [], comments: [] });
      const s = statsMap.get(id)!;
      s.scores.push(post.score);
      s.ratios.push(post.upvote_ratio);
      s.comments.push(post.num_comments);
    }
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  const stats: LensStats[] = [...statsMap.entries()]
    .map(([lensId, s]) => ({
      lensId,
      postCount: s.scores.length,
      avgScore: Math.round(avg(s.scores)),
      avgUpvoteRatio: parseFloat(avg(s.ratios).toFixed(3)),
      avgComments: Math.round(avg(s.comments)),
    }))
    .sort((a, b) => b.postCount - a.postCount);

  const output = { fetchedAt: new Date().toISOString(), subreddits: SUBREDDITS, stats, posts: allMatched };
  writeFileSync("output/results.json", JSON.stringify(output, null, 2));
  console.log("Written to output/results.json");

  console.log("\nTop 10 lenses by post count:");
  for (const s of stats.slice(0, 10)) {
    console.log(`  ${s.lensId.padEnd(40)} ${s.postCount} posts  avg score: ${s.avgScore}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
