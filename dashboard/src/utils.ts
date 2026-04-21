import type { Lens, LensSentimentEntry, Post, SentimentWord } from './types';
import { BRAND_COLOR, BRAND_DISPLAY } from './constants';

export function brandOf(lensId: string, lensById: Record<string, Lens>): string {
  return lensById[lensId]?.brand ?? lensId.split('-')[0].replace(/^\w/, c => c.toUpperCase());
}

export function displayName(lensId: string, lensById: Record<string, Lens>): string {
  const lens = lensById[lensId];
  if (lens) return `${lens.brand} ${lens.name}`;
  const parts = lensId.split('-');
  parts[0] = BRAND_DISPLAY[parts[0]] ?? parts[0].replace(/^\w/, c => c.toUpperCase());
  return parts.join(' ');
}

export function brandColor(brand: string): string {
  return BRAND_COLOR[brand.toLowerCase().replace(/[^a-z]/g, '')] ?? '#9ca3af';
}

export function brandKey(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z]/g, '');
}

// Reddit comments page for a post. `post.url` is Reddit's own `url` field which
// for image/link submissions points at the media — we always want the discussion.
export function postCommentsUrl(post: Pick<Post, 'subreddit' | 'id'>): string {
  return `https://reddit.com/r/${post.subreddit}/comments/${post.id}/`;
}

// Deep link to a specific comment under a post.
export function commentPermalink(post: Pick<Post, 'subreddit' | 'id'>, commentId: string): string {
  return `https://reddit.com/r/${post.subreddit}/comments/${post.id}/_/${commentId}/`;
}

function isImagePost(post: Post): boolean {
  return !post.is_self;
}

export function calcWeight(post: Post): number {
  const eng = Math.log(1 + post.score) * (isImagePost(post) ? post.upvote_ratio : post.upvote_ratio * 0.5);
  const disc = Math.log(1 + post.num_comments);
  return eng * 0.5 + disc * 0.5;
}

export function parseAperture(s: string | undefined | null): number | null {
  const m = /f\/([\d.]+)/.exec(s ?? '');
  return m ? parseFloat(m[1]) : null;
}

export function parseFocalLength(s: string | undefined | null): [number, number] | null {
  const m = /([\d.]+)(?:-([\d.]+))?\s*mm/.exec(s ?? '');
  if (!m) return null;
  const lo = parseFloat(m[1]);
  return [lo, m[2] ? parseFloat(m[2]) : lo];
}

export interface CloudData {
  list: [string, number][];
  colorMap: Record<string, string>;
}

function tallyWord(merged: Map<string, { pos: number; neg: number; negated: number }>, w: SentimentWord, polarity: 1 | -1) {
  const prev = merged.get(w.word) ?? { pos: 0, neg: 0, negated: 0 };
  if (polarity === 1) prev.pos += w.count; else prev.neg += w.count;
  prev.negated += w.negatedCount;
  merged.set(w.word, prev);
}

export function buildCloudData(sources: LensSentimentEntry[]): CloudData {
  const merged = new Map<string, { pos: number; neg: number; negated: number }>();
  for (const s of sources) {
    for (const w of s.topPositiveWords) tallyWord(merged, w, 1);
    for (const w of s.topNegativeWords) tallyWord(merged, w, -1);
  }
  const list: [string, number][] = [];
  const colorMap: Record<string, string> = {};
  for (const [word, { pos, neg, negated }] of merged) {
    const count = pos + neg;
    list.push([word, count]);
    if (negated === count) colorMap[word] = '#fbbf24';
    else if (pos >= neg) colorMap[word] = '#4ade80';
    else colorMap[word] = '#f87171';
  }
  return { list, colorMap };
}
