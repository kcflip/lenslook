import { useState, useEffect } from 'react';
import type {
  DashboardData,
  Lens,
  ResultsData,
  LensSentimentEntry,
  ClaudeSentimentResult,
  YouTubeSentimentResult,
  ReviewsData,
} from '../types';

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
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

export function useDashboardData() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchJson<ResultsData>('/output/results.json'),
      fetchJson<Lens[]>('/lenses.json'),
      fetchLensesMap<LensSentimentEntry>('/output/lens-sentiment.json'),
      fetchLensesMap<ClaudeSentimentResult>('/output/claude-sentiment.json'),
      fetchLensesMap<YouTubeSentimentResult>('/output/youtube-sentiment.json'),
      fetchReviews('/output/reviews.json'),
    ])
      .then(([results, lenses, sentiment, claudeSentiment, youtubeSentiment, reviews]) => {
        const lensById: Record<string, Lens> = {};
        for (const l of lenses) lensById[l.id] = l;
        setData({ results, lenses, sentiment, claudeSentiment, youtubeSentiment, reviews, lensById });
      })
      .catch(err => setError((err as Error).message));
  }, []);

  return { data, error };
}
