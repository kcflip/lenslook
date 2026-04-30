// Transforms the existing DashboardData into the shape the Spectrum page expects.
// Keep this pure so components can stay presentational.

import type { DashboardData, Post } from '../../types';
import { calcWeight, brandOf, displayName, postCommentsUrl } from '../../utils';
import { lensOfTheDayIndex } from './lensOfTheDay';

export const SPARK_WEEKS = 14;
const WEEK_SECONDS = 7 * 24 * 60 * 60;

export interface SpectrumMeta {
  fetchedAt: string;
  lensesTracked: number;
  matchedPosts: number;
  matchedComments: number;
  subreddits: string[];
  // Sparklines are computed from real post.created_utc. If that ever becomes
  // unavailable we'd synthesize and flip this true. Kept as a flag so the UI
  // can render a warning instead of silently lying.
  syntheticSparks: boolean;
}

export interface SpectrumKpi {
  label: string;
  value: string;
  delta?: string;
  brand?: string;
  lensId?: string;
}

export interface BrandAggregate {
  brand: string;
  posts: number;
  comments: number;
  avgScore: number;
  trend: number[]; // length SPARK_WEEKS
  totalScore: number;
}

export interface HighlightPost {
  brand: string;
  lensId: string;
  lensLabel: string;
  title: string;
  url: string;
  subreddit: string;
  score: number;
  weight: number;
  claudeScore: number | null;
}

export interface LensRow {
  lensId: string;
  lensLabel: string;
  brand: string;
  posts: number;
  comments: number;
  avgScore: number;
  avgRatio: number;
  avgComments: number;
  sentiment: number;       // scoreSentiment
  claudeScore: number | null;
  spark: number[];         // length SPARK_WEEKS
}

export interface SpectrumData {
  meta: SpectrumMeta;
  kpis: SpectrumKpi[];
  brands: BrandAggregate[];
  highlightPosts: HighlightPost[];
  lenses: LensRow[];
  // Column maxes pre-computed so LensTable can heatmap without recalculating
  maxes: { posts: number; avgScore: number; sentiment: number };
}

// Bucket a Unix timestamp into 0..SPARK_WEEKS-1 relative to `nowSec`.
// Returns -1 if the post is older than the window.
function weekBucket(createdSec: number, nowSec: number): number {
  const age = nowSec - createdSec;
  if (age < 0) return SPARK_WEEKS - 1; // future timestamps clamp to current week
  const weeksAgo = Math.floor(age / WEEK_SECONDS);
  if (weeksAgo >= SPARK_WEEKS) return -1;
  return SPARK_WEEKS - 1 - weeksAgo; // bucket 0 is oldest, last is current
}

function makeSpark(): number[] {
  return new Array(SPARK_WEEKS).fill(0);
}

export function aggregate(data: DashboardData): SpectrumData {
  const { results, lenses, lensById, claudeSentiment } = data;
  const { posts, stats, fetchedAt, subreddits } = results;

  const nowSec = Math.floor(Date.now() / 1000);

  // --- meta ---
  const totalComments = posts.reduce(
    (sum, p) => sum + (p.matchedComments?.length ?? 0),
    0,
  );

  const meta: SpectrumMeta = {
    fetchedAt,
    lensesTracked: stats.length,
    matchedPosts: posts.length,
    matchedComments: totalComments,
    subreddits,
    syntheticSparks: false,
  };

  // --- per-brand aggregates + sparks ---
  const brandAgg = new Map<string, BrandAggregate>();
  // --- per-lens sparks ---
  const lensSparks = new Map<string, number[]>();

  for (const post of posts) {
    const bucket = weekBucket(post.created_utc, nowSec);

    // Brand sparks: once per unique brand mentioned by this post
    const seenBrandsThisPost = new Set<string>();
    // Lens sparks: once per unique lens in this post's matches
    const seenLensesThisPost = new Set<string>();

    for (const lensId of post.lensIds) {
      const brand = brandOf(lensId, lensById);

      if (!brandAgg.has(brand)) {
        brandAgg.set(brand, {
          brand,
          posts: 0,
          comments: 0,
          avgScore: 0,
          trend: makeSpark(),
          totalScore: 0,
        });
      }
      const agg = brandAgg.get(brand)!;

      if (!seenBrandsThisPost.has(brand)) {
        agg.posts += 1;
        agg.totalScore += post.score;
        if (bucket >= 0) agg.trend[bucket] += 1;
        seenBrandsThisPost.add(brand);
      }

      if (!lensSparks.has(lensId)) lensSparks.set(lensId, makeSpark());
      if (!seenLensesThisPost.has(lensId)) {
        if (bucket >= 0) lensSparks.get(lensId)![bucket] += 1;
        seenLensesThisPost.add(lensId);
      }
    }
  }

  // Average scores per brand
  for (const agg of brandAgg.values()) {
    agg.avgScore = agg.posts > 0 ? agg.totalScore / agg.posts : 0;
  }

  const brandsArr = Array.from(brandAgg.values()).sort((a, b) => b.posts - a.posts);

  // --- highlight post per brand: highest-weight post ---
  const bestPerBrand = new Map<string, HighlightPost>();
  for (const post of posts) {
    const w = calcWeight(post);
    for (const lensId of post.lensIds) {
      const brand = brandOf(lensId, lensById);
      const current = bestPerBrand.get(brand);
      if (!current || w > current.weight) {
        bestPerBrand.set(brand, {
          brand,
          lensId,
          lensLabel: displayName(lensId, lensById),
          title: post.title,
          url: post.id && post.subreddit ? postCommentsUrl(post) : post.url,
          subreddit: `r/${post.subreddit}`,
          score: post.score,
          weight: Number(w.toFixed(3)),
          claudeScore: claudeSentiment[lensId]?.score ?? null,
        });
      }
    }
  }
  const highlightPosts = Array.from(bestPerBrand.values()).sort(
    (a, b) => b.weight - a.weight,
  );

  // --- lens rows ---
  const statsById = new Map(stats.map((s) => [s.lensId, s]));
  const lensRows: LensRow[] = lenses
    .map((lens) => {
      const stat = statsById.get(lens.id);
      if (!stat) return null;
      return {
        lensId: lens.id,
        lensLabel: displayName(lens.id, lensById),
        brand: lens.brand,
        posts: stat.postCount,
        comments: stat.commentCount,
        avgScore: stat.avgScore,
        avgRatio: stat.avgUpvoteRatio,
        avgComments: stat.avgComments,
        sentiment: stat.scoreSentiment,
        claudeScore: claudeSentiment[lens.id]?.score ?? null,
        spark: lensSparks.get(lens.id) ?? makeSpark(),
      } as LensRow;
    })
    .filter((r): r is LensRow => r !== null)
    .sort((a, b) => b.posts - a.posts);

  // --- KPIs ---
  const brandCounts: Record<string, number> = {};
  for (const s of stats) {
    const b = brandOf(s.lensId, lensById);
    brandCounts[b] = (brandCounts[b] ?? 0) + s.postCount + s.commentCount;
  }
  const topBrand = Object.entries(brandCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  const topLens = stats[0];

  // Lens of the day — deterministic daily rotation
  const dailyIdx = lensOfTheDayIndex(lensRows.length);
  const dailyLens = lensRows[dailyIdx];

  const kpis: SpectrumKpi[] = [
    {
      label: 'Distinct lenses',
      value: String(stats.length),
      delta: `${posts.length} posts tracked`,
    },
    topLens
      ? {
          label: 'Most popular lens',
          value: displayName(topLens.lensId, lensById),
          delta: `${topLens.postCount} posts · ${topLens.commentCount} cmts`,
          brand: brandOf(topLens.lensId, lensById),
          lensId: topLens.lensId,
        }
      : { label: 'Most popular lens', value: '—' },
    dailyLens
      ? {
          label: 'Lens of the day',
          value: dailyLens.lensLabel,
          delta: `${dailyLens.posts} posts`,
          brand: dailyLens.brand,
          lensId: dailyLens.lensId,
        }
      : { label: 'Lens of the day', value: '—' },
    {
      label: 'Most popular brand',
      value: topBrand,
      delta: `${brandCounts[topBrand] ?? 0} mentions`,
      brand: topBrand,
    },
  ];

  // --- column maxes for heatmap normalization ---
  const maxes = {
    posts: Math.max(1, ...lensRows.map((r) => r.posts)),
    avgScore: Math.max(1, ...lensRows.map((r) => r.avgScore)),
    sentiment: Math.max(0.0001, ...lensRows.map((r) => r.sentiment)),
  };

  return { meta, kpis, brands: brandsArr, highlightPosts, lenses: lensRows, maxes };
}

// TODO(spectrum): once we have per-post view counts or retail price history,
// enrich the LensRow spark with a second series so the drawer can show both
// engagement and discussion over time.

export function formatFetched(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })} · ${d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })}`;
  } catch {
    return iso;
  }
}
