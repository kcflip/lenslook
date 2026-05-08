import { useState, useMemo, useEffect } from 'react';
import type { DashboardData, Post, BodySpecs, SentimentCitation, ReviewItem } from '../types';
import {
  brandColor, FONT_DISPLAY, FONT_MONO,
  BG_TONES, ACCENTS,
  POSITIVE_COLOR, NEGATIVE_COLOR, STAR_COLOR, SOURCE_COLORS,
  TEXT_PRIMARY, TEXT_DIM, TEXT_DIMMER, TEXT_MUTED, TEXT_FAINT,
  BORDER, BORDER_MED,
  type BgTone, type Accent,
} from './tokens';
import { BrandDot, BrandMark } from './components/BrandMark';
import { Fold } from './components/Fold';
import { calcWeight, postCommentsUrl, commentPermalink } from '../utils';
import { lensHref, bodyHref } from '../hooks/useHashRoute';

const DEFAULT_BG: BgTone = 'charcoal';
const DEFAULT_ACCENT: Accent = 'white';

interface Props { data: DashboardData; bodyId: string; }

const SOURCE_LABEL: Record<string, string> = {
  reddit_post: 'Reddit', reddit_comment: 'Reddit',
  amazon: 'Amazon', bh: 'B&H', adorama: 'Adorama',
};

function normalizeImg(src: string): string {
  const stripped = src.replace(/\._[^.]+(\.\w+)$/, '$1');
  const m = stripped.match(/^\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)$/);
  return m ? m[1] : stripped;
}

function specsRows(specs: BodySpecs): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const s = specs;
  if (s.sensor) rows.push(['Sensor', `${s.sensor.megapixels}MP ${s.sensor.size} ${s.sensor.type}`]);
  if (s.iso) {
    const base = `ISO ${s.iso.nativeMin.toLocaleString()}–${s.iso.nativeMax.toLocaleString()}`;
    rows.push(['ISO', s.iso.extendedMax ? `${base} (ext. ${s.iso.extendedMax.toLocaleString()})` : base]);
  }
  if (s.af) {
    const parts: string[] = [];
    if (s.af.points != null) parts.push(`${s.af.points} points`);
    if (s.af.lowLightEv != null) parts.push(`${s.af.lowLightEv} EV`);
    if (s.af.subjects?.length) parts.push(s.af.subjects.join(', '));
    if (parts.length) rows.push(['Autofocus', parts.join(' · ')]);
  }
  if (s.ibis) rows.push(['IBIS', s.ibis.present ? (s.ibis.stops ? `${s.ibis.stops} stops` : 'Yes') : 'No']);
  if (s.burst) {
    const parts: string[] = [];
    if (s.burst.mechFps) parts.push(`${s.burst.mechFps}fps mech`);
    if (s.burst.elecFps) parts.push(`${s.burst.elecFps}fps elec`);
    if (s.burst.bufferRaw) parts.push(`${s.burst.bufferRaw} RAW`);
    if (parts.length) rows.push(['Burst', parts.join(' · ')]);
  }
  if (s.video) {
    const parts: string[] = [];
    if (s.video.maxResolution) parts.push(s.video.maxResolution);
    if (s.video.maxFrameRateAtMax) parts.push(`${s.video.maxFrameRateAtMax}fps`);
    if (s.video.bitDepth) parts.push(`${s.video.bitDepth}-bit`);
    if (s.video.sLog) parts.push('S-Log');
    if (parts.length) rows.push(['Video', parts.join(' · ')]);
    if (s.video.overheatingNotes) rows.push(['Overheating', s.video.overheatingNotes]);
  }
  if (s.evf) {
    const parts: string[] = [];
    if (s.evf.dots) parts.push(`${(s.evf.dots / 1e6).toFixed(2)}M dots`);
    if (s.evf.magnification) parts.push(`${s.evf.magnification}×`);
    if (s.evf.refreshHz) parts.push(`${s.evf.refreshHz}Hz`);
    if (parts.length) rows.push(['EVF', parts.join(' · ')]);
  }
  if (s.lcd) {
    const parts: string[] = [];
    if (s.lcd.sizeIn) parts.push(`${s.lcd.sizeIn}"`);
    if (s.lcd.dots) parts.push(`${(s.lcd.dots / 1e6).toFixed(2)}M dots`);
    if (s.lcd.articulation) parts.push(s.lcd.articulation);
    if (parts.length) rows.push(['LCD', parts.join(' · ')]);
  }
  if (s.storage) {
    const parts: string[] = [];
    if (s.storage.slots) parts.push(`${s.storage.slots} slot${s.storage.slots > 1 ? 's' : ''}`);
    if (s.storage.types?.length) parts.push(s.storage.types.join('/'));
    if (s.storage.dualRedundant) parts.push('dual redundant');
    if (parts.length) rows.push(['Storage', parts.join(' · ')]);
  }
  if (s.battery) {
    const parts: string[] = [];
    if (s.battery.model) parts.push(s.battery.model);
    if (s.battery.cipaShots) parts.push(`${s.battery.cipaShots} shots (CIPA)`);
    if (parts.length) rows.push(['Battery', parts.join(' · ')]);
  }
  if (s.connectivity) {
    const parts: string[] = [];
    if (s.connectivity.usb) parts.push(s.connectivity.usb);
    if (s.connectivity.hdmi) parts.push(`HDMI ${s.connectivity.hdmi}`);
    if (s.connectivity.wifi) parts.push('Wi-Fi');
    if (s.connectivity.bluetooth) parts.push('Bluetooth');
    if (parts.length) rows.push(['Connectivity', parts.join(' · ')]);
  }
  if (s.body) {
    const parts: string[] = [];
    if (s.body.weightG) parts.push(`${s.body.weightG}g`);
    if (s.body.weatherSealed != null) parts.push(s.body.weatherSealed ? 'Weather sealed' : 'Not sealed');
    if (parts.length) rows.push(['Build', parts.join(' · ')]);
  }
  if (s.shutter) {
    const parts: string[] = [];
    if (s.shutter.mechMaxS) parts.push(`mech ${s.shutter.mechMaxS}`);
    if (s.shutter.elecMaxS) parts.push(`elec ${s.shutter.elecMaxS}`);
    if (s.shutter.flashSyncS) parts.push(`sync ${s.shutter.flashSyncS}`);
    if (parts.length) rows.push(['Shutter', parts.join(' · ')]);
  }
  return rows;
}

function resolveCitationUrl(c: SentimentCitation, bodyId: string, revItems: ReviewItem[], posts: Post[]): string | null {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const needle = norm(c.quote);
  if (!needle) return null;
  if (['amazon', 'bh', 'adorama'].includes(c.source)) {
    for (const r of revItems) {
      if (r.sourceType !== c.source) continue;
      if (norm(r.text).includes(needle)) return r.url ?? null;
    }
    return null;
  }
  if (c.source === 'reddit_post') {
    for (const post of posts) {
      if (!post.postLensIds?.includes(bodyId)) continue;
      const text = post.title + (post.selftext && post.selftext !== '[removed]' ? ': ' + post.selftext.slice(0, 300) : '');
      if (norm(text).includes(needle)) return post.id && post.subreddit ? postCommentsUrl(post) : post.url;
    }
    return null;
  }
  if (c.source === 'reddit_comment') {
    for (const post of posts) {
      if (!post.commentLensIds?.includes(bodyId)) continue;
      for (const cm of post.matchedComments ?? []) {
        if (cm.lensIds && !cm.lensIds.includes(bodyId)) continue;
        if (norm(cm.body).includes(needle)) return cm.id && post.id && post.subreddit ? commentPermalink(post, cm.id) : postCommentsUrl(post);
      }
    }
    return null;
  }
  return null;
}

export function BodyDetailPage({ data, bodyId }: Props) {
  const { results, bodyById, bodies, lensById, claudeSentiment, reviews } = data;

  const [bgTone] = useState<BgTone>(() => (localStorage.getItem('lenslook:bg-tone') as BgTone) ?? DEFAULT_BG);
  const [accent] = useState<Accent>(() => (localStorage.getItem('lenslook:accent') as Accent) ?? DEFAULT_ACCENT);

  const bg = BG_TONES[bgTone];
  const accentColor = ACCENTS[accent];

  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = bg;
    return () => { document.body.style.backgroundColor = prev; };
  }, [bg]);

  const body = bodyById[bodyId];
  const claude = claudeSentiment[bodyId];

  const topPosts = useMemo(() => {
    return results.posts
      .filter(p => p.postLensIds.includes(bodyId))
      .map(p => ({ post: p, weight: calcWeight(p) }))
      .sort((a, b) => b.weight - a.weight).slice(0, 10);
  }, [results.posts, bodyId]);

  const topComments = useMemo(() => {
    const items: Array<{ body: string; score: number; subreddit: string; permalink?: string; created_utc?: number }> = [];
    for (const post of results.posts) {
      for (const c of post.matchedComments ?? []) {
        const attr = c.lensIds ? c.lensIds.includes(bodyId) : post.commentLensIds.includes(bodyId);
        if (!attr) continue;
        items.push({
          body: c.body, score: c.score, subreddit: post.subreddit,
          permalink: c.id && post.id && post.subreddit ? commentPermalink(post, c.id) : undefined,
          created_utc: c.created_utc,
        });
      }
    }
    return items.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [results.posts, bodyId]);

  const sourceCounts = useMemo(() => {
    const items = reviews[bodyId] ?? [];
    let amazon = 0, bh = 0, adorama = 0, reddit = 0;
    for (const item of items) {
      if (item.sourceType === 'amazon') amazon++;
      else if (item.sourceType === 'bh') bh++;
      else if (item.sourceType === 'adorama') adorama++;
    }
    for (const post of results.posts) {
      if (post.postLensIds.includes(bodyId)) reddit++;
      for (const c of post.matchedComments ?? []) {
        const attr = c.lensIds ? c.lensIds.includes(bodyId) : post.commentLensIds.includes(bodyId);
        if (attr) reddit++;
      }
    }
    return { amazon, bh, adorama, reddit };
  }, [reviews, bodyId, results.posts]);

  const pairedLenses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of results.posts) {
      if (!post.postLensIds.includes(bodyId) && !post.commentLensIds.includes(bodyId)) continue;
      for (const id of [...post.postLensIds, ...post.commentLensIds]) {
        if (!id.startsWith('body-')) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .flatMap(([id, count]) => lensById[id] ? [{ lens: lensById[id], count }] : []);
  }, [results.posts, bodyId, lensById]);

  const retailerRows = useMemo(() => [
    ...(body?.amazon?.asins?.map(a => ({ key: a.asin, name: 'Amazon', url: `https://www.amazon.com/dp/${a.asin}`, official: a.official, price: a.price ?? null, scraped: a.priceScrapedAt ?? null, rating: a.avgRating ?? null, ratingCount: a.ratingCount ?? null })) ?? []),
    ...(body?.bh ? [{ key: 'bh', name: 'B&H', url: body.bh.url, official: body.bh.official, price: body.bh.price ?? null, scraped: body.bh.priceScrapedAt ?? null, rating: body.bh.starCount ?? null, ratingCount: body.bh.ratingCount ?? null }] : []),
    ...(body?.adorama ? [{ key: 'adorama', name: 'Adorama', url: body.adorama.url, official: body.adorama.official, price: body.adorama.price ?? null, scraped: body.adorama.priceScrapedAt ?? null, rating: body.adorama.starCount ?? null, ratingCount: null }] : []),
    ...(body?.retailers ? Object.entries(body.retailers).map(([slug, r]) => ({ key: slug, name: r.title ?? slug, url: r.url, official: false, price: r.price ?? null, scraped: r.priceScrapedAt ?? null, rating: null, ratingCount: null })) : []),
  ], [body]);

  const specRows = useMemo(() => body ? specsRows(body.specs) : [], [body]);

  const renderCitation = (c: SentimentCitation, i: number) => {
    const url = resolveCitationUrl(c, bodyId, reviews[bodyId] ?? [], results.posts);
    const srcColor = SOURCE_COLORS[c.source.startsWith('reddit') ? 'reddit' : c.source] ?? TEXT_DIM;
    const srcLabel = SOURCE_LABEL[c.source] ?? c.source;
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    const starRating = (['amazon', 'bh', 'adorama'] as const).includes(c.source as 'amazon' | 'bh' | 'adorama')
      ? (reviews[bodyId] ?? []).find(r => r.sourceType === c.source && norm(r.text).includes(norm(c.quote)))?.rating ?? null
      : null;
    return (
      <div key={i} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY }}>{c.aspect}</div>
        {url
          ? <a href={url} target="_blank" rel="noopener" style={{ display: 'block', marginTop: 4, fontSize: 12, fontStyle: 'italic', color: TEXT_DIMMER, textDecoration: 'none', lineHeight: 1.5 }}>&ldquo;{c.quote}&rdquo;</a>
          : <div style={{ marginTop: 4, fontSize: 12, fontStyle: 'italic', color: TEXT_DIMMER, lineHeight: 1.5 }}>&ldquo;{c.quote}&rdquo;</div>}
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          {url
            ? <a href={url} target="_blank" rel="noopener" style={{ fontFamily: FONT_MONO, fontSize: 9, color: srcColor, textDecoration: 'none' }}>{srcLabel} ↗</a>
            : <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: srcColor }}>{srcLabel}</span>}
          {starRating != null && (
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: STAR_COLOR }}>{'★'.repeat(starRating)}{'☆'.repeat(5 - starRating)}</span>
          )}
        </div>
      </div>
    );
  };

  if (!body) {
    return (
      <div style={{ background: BG_TONES[bgTone], color: TEXT_PRIMARY, fontFamily: FONT_DISPLAY, minHeight: '100vh', padding: 24 }}>
        <a href="#/bodies" style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', letterSpacing: '0.1em' }}>← BODIES</a>
        <div style={{ marginTop: 32, color: TEXT_DIM }}>Body not found: {bodyId}</div>
      </div>
    );
  }

  const bColor = brandColor(body.brand);
  const mentions = topPosts.length + topComments.length;
  const cheapest = retailerRows.reduce<number | null>((min, r) => r.price != null && (min == null || r.price < min) ? r.price : min, null);

  return (
    <div style={{ background: bg, color: TEXT_PRIMARY, fontFamily: FONT_DISPLAY, minHeight: '100vh' }}>

      {/* ── Sticky Header ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, borderBottom: `1px solid ${BORDER}`, backgroundColor: bg }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 12, height: 52 }}>
          <a href="#/bodies" style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>← BODIES</a>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            {(body.predecessor && bodyById[body.predecessor]) && (
              <a href={bodyHref(body.predecessor)} style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', padding: '3px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 2 }}>← {bodyById[body.predecessor].name}</a>
            )}
            {(body.successor && bodyById[body.successor]) && (
              <a href={bodyHref(body.successor)} style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', padding: '3px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 2 }}>{bodyById[body.successor].name} →</a>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 64px' }}>

        {/* ── Hero ── */}
        <div style={{ padding: '20px 0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <BrandDot brand={body.brand} size={10} />
            <BrandMark brand={body.brand} size={10} />
            <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM }}>· {body.mount} · {body.sensorSize}</span>
            {body.releaseDate && <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT }}>· {new Date(body.releaseDate).getFullYear()}</span>}
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 48, fontWeight: 700, letterSpacing: '-0.04em', margin: '0 0 24px 0', lineHeight: 1.05 }}>
            <span style={{ color: bColor }}>{body.brand}</span> {body.name}
          </h1>
          <div style={{ display: 'inline-flex', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 2, overflow: 'hidden' }}>
            {[
              { label: 'Price', value: cheapest != null ? `$${Math.round(cheapest).toLocaleString()}` : '—', color: cheapest != null ? accentColor : TEXT_MUTED },
              { label: 'Claude Score', value: claude ? `${claude.score > 0 ? '+' : ''}${claude.score.toFixed(2)}` : '—', color: claude ? (claude.score >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR) : TEXT_MUTED },
              { label: 'Mentions', value: mentions.toLocaleString(), color: TEXT_PRIMARY },
            ].map((s, i, arr) => (
              <div key={i} style={{ padding: '16px 24px', borderRight: i < arr.length - 1 ? `1px solid rgba(255,255,255,0.08)` : 'none', minWidth: 100 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em', color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: TEXT_MUTED, marginTop: 6 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Specs ── */}
        {specRows.length > 0 && (
          <Fold title="Specifications" count={specRows.length} defaultOpen>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
              {specRows.map(([key, val], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textTransform: 'uppercase' as const, letterSpacing: '0.08em', flexShrink: 0 }}>{key}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: TEXT_PRIMARY, textAlign: 'right' as const }}>{val}</span>
                </div>
              ))}
            </div>
          </Fold>
        )}

        {/* ── Sentiment ── */}
        {claude && claude.mentionCount > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: TEXT_DIM }}>Sentiment</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: claude.score >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR }}>
                {claude.score > 0 ? '+' : ''}{claude.score.toFixed(2)}
              </span>
            </div>
            <div style={{ paddingTop: 16, animation: 'fadeUp 0.5s ease' }}>
              <p style={{ fontFamily: FONT_DISPLAY, fontSize: 14, color: TEXT_DIMMER, lineHeight: 1.7, margin: '0 0 10px 0' }}>{claude.summary}</p>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, marginBottom: 20 }}>
                Based on{' '}
                {[
                  sourceCounts.reddit && `${sourceCounts.reddit} Reddit`,
                  sourceCounts.amazon && `${sourceCounts.amazon} Amazon`,
                  sourceCounts.bh && `${sourceCounts.bh} B&H`,
                  sourceCounts.adorama && `${sourceCounts.adorama} Adorama`,
                ].filter(Boolean).join(' · ') || 'no source material'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
                <div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: POSITIVE_COLOR, marginBottom: 12 }}>Positives</div>
                  {claude.positives.length > 0 ? claude.positives.map(renderCitation) : <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT }}>None identified</div>}
                </div>
                <div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: NEGATIVE_COLOR, marginBottom: 12 }}>Negatives</div>
                  {claude.negatives.length > 0 ? claude.negatives.map(renderCitation) : <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT }}>None identified</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Retailers ── */}
        {retailerRows.length > 0 && (
          <Fold title="Retailers" count={retailerRows.length} defaultOpen>
            {retailerRows.map((r, i, arr) => (
              <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < arr.length - 1 ? `1px solid rgba(255,255,255,0.04)` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a href={r.url} target="_blank" rel="noopener" style={{ fontSize: 14, fontWeight: 500, color: TEXT_PRIMARY, textDecoration: 'none' }}>{r.name}</a>
                  {r.official && <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: POSITIVE_COLOR, letterSpacing: '0.06em' }}>✓ official</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {r.price != null && <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, color: accentColor }}>${Math.round(r.price).toLocaleString()}</span>}
                  {r.scraped && <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM }}>{new Date(r.scraped).toLocaleDateString()}</span>}
                  {r.rating != null && <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: STAR_COLOR }} title={r.ratingCount != null ? `${r.ratingCount.toLocaleString()} reviews` : undefined}>{r.rating.toFixed(1)} ★</span>}
                </div>
              </div>
            ))}
          </Fold>
        )}

        {/* ── Top Posts ── */}
        {topPosts.length > 0 && (
          <Fold title="Top Posts" count={topPosts.length}>
            {topPosts.map(({ post, weight: _w }, i, arr) => (
              <div key={post.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none', fontFamily: FONT_MONO, fontSize: 11 }}>
                <a href={postCommentsUrl(post)} target="_blank" rel="noopener" style={{ flex: 1, color: SOURCE_COLORS.reddit, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                  {post.title}
                </a>
                <span style={{ color: `${SOURCE_COLORS.reddit}99`, minWidth: 90, textAlign: 'right' as const, flexShrink: 0 }}>r/{post.subreddit}</span>
                <span style={{ color: TEXT_PRIMARY, minWidth: 50, textAlign: 'right' as const, flexShrink: 0 }}>{post.score.toLocaleString()}</span>
              </div>
            ))}
          </Fold>
        )}

        {/* ── Top Comments ── */}
        {topComments.length > 0 && (
          <Fold title="Top Comments" count={topComments.length}>
            {topComments.map((c, i, arr) => (
              <div key={i} style={{ padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                {c.permalink
                  ? <a href={c.permalink} target="_blank" rel="noopener" style={{ display: 'block', fontSize: 12, color: TEXT_DIMMER, lineHeight: 1.55, textDecoration: 'none' }}>{c.body.length > 280 ? c.body.slice(0, 277) + '…' : c.body}</a>
                  : <div style={{ fontSize: 12, color: TEXT_DIMMER, lineHeight: 1.55 }}>{c.body.length > 280 ? c.body.slice(0, 277) + '…' : c.body}</div>}
                <div style={{ marginTop: 6, display: 'flex', gap: 10, fontFamily: FONT_MONO, fontSize: 9, color: TEXT_DIM }}>
                  <span>{c.score.toLocaleString()} ↑</span>
                  {c.created_utc && <span>{new Date(c.created_utc * 1000).toLocaleDateString()}</span>}
                  <span style={{ color: SOURCE_COLORS.reddit }}>r/{c.subreddit}</span>
                </div>
              </div>
            ))}
          </Fold>
        )}

        {/* ── Paired Lenses ── */}
        {pairedLenses.length > 0 && (
          <Fold title="Lenses Discussed Alongside" count={pairedLenses.length}>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
              {pairedLenses.map(({ lens, count }) => (
                <a key={lens.id} href={lensHref(lens.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'rgba(255,255,255,0.06)', borderLeft: `2px solid ${brandColor(lens.brand)}`, borderRadius: 2, textDecoration: 'none', fontSize: 12, color: TEXT_PRIMARY }}>
                  {lens.brand} {lens.name}
                  <span style={{ opacity: 0.5, fontFamily: FONT_MONO, fontSize: 10 }}>{count}</span>
                </a>
              ))}
            </div>
          </Fold>
        )}

        {/* ── Other bodies ── */}
        {bodies.filter(b => b.id !== bodyId && b.sensorSize === body.sensorSize).length > 0 && (
          <Fold title={`More ${body.sensorSize} Bodies`}>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
              {bodies.filter(b => b.id !== bodyId && b.sensorSize === body.sensorSize).map(b => (
                <a key={b.id} href={bodyHref(b.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'rgba(255,255,255,0.06)', borderLeft: `2px solid ${brandColor(b.brand)}`, borderRadius: 2, textDecoration: 'none', fontSize: 12, color: TEXT_PRIMARY }}>
                  {b.brand} {b.name}
                  {b.releaseDate && <span style={{ opacity: 0.5, fontFamily: FONT_MONO, fontSize: 10 }}>{new Date(b.releaseDate).getFullYear()}</span>}
                </a>
              ))}
            </div>
          </Fold>
        )}

      </div>
    </div>
  );
}
