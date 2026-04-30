import { useState, useEffect } from 'react';
import type {
  DashboardData,
  Lens,
  Body,
  ResultsData,
  LensSentimentEntry,
  ClaudeSentimentResult,
  YouTubeSentimentResult,
  ReviewsData,
} from '../types';

// Hide a lens when it has zero Reddit mentions AND no retail URL on file.
// Keeps noisy/untracked catalog entries out of the dashboard and the aggregates.
// TODO: include lens.adorama?.url in the retail check once the Adorama scraper
// has populated data.
function hasRetailUrl(lens: Lens): boolean {
  if (lens.amazon?.asins?.some((a) => !!a.url)) return true;
  if (lens.bh?.url) return true;
  return false;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function fetchResults(url: string): Promise<ResultsData> {
  try {
    const r = await fetch(url);
    if (!r.ok) return { fetchedAt: '', subreddits: [], sorts: [], stats: [], posts: [] };
    return r.json();
  } catch {
    return { fetchedAt: '', subreddits: [], sorts: [], stats: [], posts: [] };
  }
}

// Optional `{ lenses: { [lensId]: T } }` files — missing file or parse failure
// falls back to an empty map so the dashboard still renders the required data.
async function fetchLensesMap<T>(url: string): Promise<Record<string, T>> {
  try {
    const r = await fetch(url);
    if (!r.ok) return {};
    const data = (await r.json()) as { lenses?: Record<string, T> };
    return data.lenses ?? {};
  } catch {
    return {};
  }
}

// reviews.json is a flat `{ [lensId]: ReviewItem[] }` — no `lenses` wrapper.
async function fetchReviews(url: string): Promise<ReviewsData> {
  try {
    const r = await fetch(url);
    if (!r.ok) return {};
    return (await r.json()) as ReviewsData;
  } catch {
    return {};
  }
}

export function useDashboardData(system: string = 'Sony') {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    const resultsUrl = `/output/${system.toLowerCase()}Results.json`;
    Promise.all([
      fetchResults(resultsUrl),
      fetchJson<Lens[]>('/lenses.json'),
      fetchLensesMap<LensSentimentEntry>('/output/lens-sentiment.json'),
      fetchLensesMap<ClaudeSentimentResult>('/output/claude-sentiment.json'),
      fetchLensesMap<YouTubeSentimentResult>('/output/youtube-sentiment.json'),
      fetchReviews('/output/reviews.json'),
      fetchJson<Body[]>('/bodies.json').catch(() => [] as Body[]),
    ])
      .then(([results, allLenses, sentiment, claudeSentiment, youtubeSentiment, reviews, allBodies]) => {
        const systemLenses = allLenses.filter((l) => l.system === system);
        const statsById = new Map(results.stats.map((s) => [s.lensId, s]));
        const keep = new Set(
          systemLenses
            .filter((l) => {
              const stat = statsById.get(l.id);
              const hasMentions = !!stat && (stat.postCount > 0 || stat.commentCount > 0);
              return hasMentions || hasRetailUrl(l);
            })
            .map((l) => l.id),
        );

        const filteredLenses = systemLenses.filter((l) => keep.has(l.id));
        const lensById: Record<string, Lens> = {};
        for (const l of filteredLenses) lensById[l.id] = l;

        const filteredResults: ResultsData = {
          ...results,
          stats: results.stats.filter((s) => keep.has(s.lensId)),
        };

        const bodies = allBodies.filter((b) => b.system === system);
        const bodyById: Record<string, Body> = {};
        for (const b of bodies) bodyById[b.id] = b;

        setData({
          results: filteredResults,
          lenses: filteredLenses,
          sentiment,
          claudeSentiment,
          youtubeSentiment,
          reviews,
          lensById,
          bodies,
          bodyById,
        });
      })
      .catch(err => setError((err as Error).message));
  }, [system]);

  return { data, error };
}
