// Per-post weight formula. Single source of truth — pulled out of src/index.ts,
// src/sentiment-rerun.ts, src/backfill-comment-lensids.ts, src/test.ts, and
// dashboard/src/utils.ts so a future tweak (time decay, multi-lens dilution,
// trimmed mean — see weightingPosts.md) lands in one place.
//
// Both terms are log-compressed so the 50/50 split is meaningful. Self-posts
// halve `upvote_ratio` because text discussions draw fewer upvotes than image
// posts but carry more intent — halving equalizes them.

interface WeightablePost {
  score: number;
  upvote_ratio: number;
  num_comments: number;
  is_self: boolean;
}

export function calcWeight(post: WeightablePost): number {
  const ratioFactor = post.is_self ? post.upvote_ratio * 0.5 : post.upvote_ratio;
  const engagementScore = Math.log(1 + post.score) * ratioFactor;
  const discussionScore = Math.log(1 + post.num_comments);
  return engagementScore * 0.5 + discussionScore * 0.5;
}
