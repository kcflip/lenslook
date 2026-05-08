import { useState, useMemo, useEffect } from 'react';
import type { DashboardData, Post } from '../types';
import {
  brandColor, FONT_DISPLAY, FONT_MONO,
  BG_TONES, ACCENTS,
  POSITIVE_COLOR, NEGATIVE_COLOR,
  TEXT_PRIMARY, TEXT_DIM, TEXT_DIMMER, TEXT_MUTED, TEXT_FAINT,
  BORDER, BORDER_MED, SOURCE_COLORS,
  type BgTone, type Accent,
} from './tokens';
import { BrandMark } from './components/BrandMark';
import { Fold } from './components/Fold';
import { ClaudePill } from './components/ClaudePill';
import { brandOf, calcWeight, postCommentsUrl, commentPermalink, brandKey } from '../utils';
import { lensHref } from '../hooks/useHashRoute';

interface Props { data: DashboardData; brand: string; }

export function BrandDetailPage({ data, brand }: Props) {
  const { results, lensById, lenses, claudeSentiment } = data;

  const [bgTone] = useState<BgTone>(() => (localStorage.getItem('lenslook:bg-tone') as BgTone) ?? 'charcoal');
  const [accent] = useState<Accent>(() => (localStorage.getItem('lenslook:accent') as Accent) ?? 'white');

  const bg = BG_TONES[bgTone];
  const accentColor = ACCENTS[accent];

  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = bg;
    return () => { document.body.style.backgroundColor = prev; };
  }, [bg]);

  const targetKey = brandKey(brand);
  const displayBrand = lenses.find(l => brandKey(l.brand) === targetKey)?.brand ?? brand;
  const bColor = brandColor(displayBrand);

  const brandLenses = useMemo(() => lenses.filter(l => brandKey(l.brand) === targetKey), [lenses, targetKey]);
  const brandLensIds = useMemo(() => new Set(brandLenses.map(l => l.id)), [brandLenses]);
  const brandStats = useMemo(() => results.stats.filter(s => brandLensIds.has(s.lensId)), [results.stats, brandLensIds]);

  const kpi = useMemo(() => {
    const totalPosts = brandStats.reduce((a, s) => a + s.postCount, 0);
    const totalComments = brandStats.reduce((a, s) => a + s.commentCount, 0);
    const mentioned = brandStats.filter(s => s.postCount + s.commentCount > 0).length;
    const avgSentiment = brandStats.length
      ? brandStats.reduce((a, s) => a + s.scoreSentiment, 0) / brandStats.length
      : null;
    const top = [...brandStats].sort((a, b) => b.scoreSentiment - a.scoreSentiment)[0];
    return { totalPosts, totalComments, mentioned, avgSentiment, top };
  }, [brandStats]);

  const lensRows = useMemo(() => brandLenses.map(l => {
    const s = results.stats.find(x => x.lensId === l.id);
    const cs = claudeSentiment[l.id];
    return {
      lens: l,
      postCount: s?.postCount ?? 0,
      commentCount: s?.commentCount ?? 0,
      scoreSentiment: s?.scoreSentiment ?? 0,
      claudeScore: cs?.score ?? null,
    };
  }).sort((a, b) => b.scoreSentiment - a.scoreSentiment), [brandLenses, results.stats, claudeSentiment]);

  const topPosts = useMemo(() => {
    const matched: Array<{ post: Post; weight: number; lensIds: string[] }> = [];
    for (const post of results.posts) {
      const hits = post.lensIds.filter(id => brandLensIds.has(id));
      if (!hits.length) continue;
      matched.push({ post, weight: calcWeight(post), lensIds: hits });
    }
    return matched.sort((a, b) => b.weight - a.weight).slice(0, 10);
  }, [results.posts, brandLensIds]);

  const topComments = useMemo(() => {
    const items: Array<{ body: string; score: number; subreddit: string; permalink?: string; created_utc?: number; lensIds: string[] }> = [];
    for (const post of results.posts) {
      for (const c of post.matchedComments ?? []) {
        const ids = (c.lensIds ?? post.commentLensIds).filter(id => brandLensIds.has(id));
        if (!ids.length) continue;
        items.push({
          body: c.body, score: c.score, subreddit: post.subreddit,
          permalink: c.id && post.id && post.subreddit ? commentPermalink(post, c.id) : undefined,
          created_utc: c.created_utc, lensIds: ids,
        });
      }
    }
    return items.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [results.posts, brandLensIds]);

  if (brandLenses.length === 0) {
    return (
      <div style={{ background: bg, color: TEXT_PRIMARY, fontFamily: FONT_DISPLAY, minHeight: '100vh', padding: 24 }}>
        <a href="#" style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', letterSpacing: '0.1em' }}>← LENSLOOK</a>
        <div style={{ marginTop: 32, color: TEXT_DIM }}>Brand not found: {brand}</div>
      </div>
    );
  }

  return (
    <div style={{ background: bg, color: TEXT_PRIMARY, fontFamily: FONT_DISPLAY, minHeight: '100vh' }}>

      {/* ── Sticky Header ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, borderBottom: `1px solid ${BORDER}`, backgroundColor: bg }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 12, height: 52 }}>
          <a href="#" style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', letterSpacing: '0.1em' }}>← LENSLOOK</a>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 64px' }}>

        {/* ── Hero ── */}
        <div style={{ padding: '28px 0 24px' }}>
          <h1 style={{ fontFamily: FONT_MONO, fontSize: 52, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 20px 0', lineHeight: 1, color: bColor }}>
            {displayBrand}
          </h1>
          <div style={{ display: 'inline-flex', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 2, overflow: 'hidden' }}>
            {[
              { label: 'Lenses Tracked', value: brandLenses.length.toString(), color: accentColor },
              { label: 'Post Mentions', value: kpi.totalPosts.toLocaleString(), color: TEXT_PRIMARY },
              { label: 'Comment Mentions', value: kpi.totalComments.toLocaleString(), color: TEXT_PRIMARY },
              { label: 'Avg Sentiment', value: kpi.avgSentiment != null ? (kpi.avgSentiment >= 0 ? '+' : '') + kpi.avgSentiment.toFixed(2) : '—', color: kpi.avgSentiment != null ? (kpi.avgSentiment >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR) : TEXT_MUTED },
            ].map((s, i, arr) => (
              <div key={i} style={{ padding: '14px 20px', borderRight: i < arr.length - 1 ? `1px solid rgba(255,255,255,0.08)` : 'none', minWidth: 90 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: TEXT_MUTED, marginTop: 5 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Lenses ── */}
        <Fold title="Lenses" count={lensRows.length} defaultOpen alwaysOpen>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER_MED}` }}>
                  {[['left', 'Lens'], ['right', 'Posts'], ['right', 'Comments'], ['right', 'Sentiment'], ['right', 'Claude']].map(([align, label]) => (
                    <th key={label} style={{ fontFamily: FONT_MONO, fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: TEXT_MUTED, textAlign: align as 'left' | 'right', padding: '8px 10px' }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lensRows.map((r, i) => (
                  <LensRow key={r.lens.id} row={r} bColor={bColor} accentColor={accentColor} isLast={i === lensRows.length - 1} />
                ))}
              </tbody>
            </table>
          </div>
        </Fold>

        {/* ── Top Posts ── */}
        {topPosts.length > 0 && (
          <Fold title="Top Posts" count={topPosts.length}>
            {topPosts.map(({ post, weight: _w, lensIds: ids }, i, arr) => (
              <div key={post.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: i < arr.length - 1 ? `1px solid ${BORDER}` : 'none', borderLeft: `3px solid ${bColor}`, paddingLeft: 10 }}>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <a href={postCommentsUrl(post)} target="_blank" rel="noopener" style={{ fontFamily: FONT_DISPLAY, fontSize: 13, color: TEXT_PRIMARY, textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    {post.title}
                  </a>
                  <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                    {ids.map(id => (
                      <a key={id} href={lensHref(id)} onClick={e => e.stopPropagation()} style={{ fontFamily: FONT_MONO, fontSize: 9, color: bColor, textDecoration: 'none' }}>
                        {lensById[id] ? lensById[id].name : id}
                      </a>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM }}>{post.score.toLocaleString()} ↑</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: SOURCE_COLORS.reddit }}>r/{post.subreddit}</span>
                </div>
              </div>
            ))}
          </Fold>
        )}

        {/* ── Top Comments ── */}
        {topComments.length > 0 && (
          <Fold title="Top Comments" count={topComments.length}>
            {topComments.map((c, i, arr) => (
              <div key={i} style={{ padding: '10px 0', borderBottom: i < arr.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                {c.permalink
                  ? <a href={c.permalink} target="_blank" rel="noopener" style={{ display: 'block', fontSize: 12, color: TEXT_DIMMER, lineHeight: 1.55, textDecoration: 'none' }}>{c.body.length > 280 ? c.body.slice(0, 277) + '…' : c.body}</a>
                  : <div style={{ fontSize: 12, color: TEXT_DIMMER, lineHeight: 1.55 }}>{c.body.length > 280 ? c.body.slice(0, 277) + '…' : c.body}</div>}
                <div style={{ marginTop: 6, display: 'flex', gap: 10, fontFamily: FONT_MONO, fontSize: 9, color: TEXT_DIM }}>
                  <span>{c.score.toLocaleString()} ↑</span>
                  {c.created_utc && <span>{new Date(c.created_utc * 1000).toLocaleDateString()}</span>}
                  <span style={{ color: SOURCE_COLORS.reddit }}>r/{c.subreddit}</span>
                  {c.lensIds.map(id => (
                    <a key={id} href={lensHref(id)} style={{ color: bColor, textDecoration: 'none' }}>
                      {lensById[id] ? lensById[id].name : id}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </Fold>
        )}

      </div>
    </div>
  );
}

function LensRow({ row, bColor, accentColor, isLast }: {
  row: { lens: { id: string; name: string; brand: string }; postCount: number; commentCount: number; scoreSentiment: number; claudeScore: number | null };
  bColor: string; accentColor: string; isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ borderBottom: isLast ? 'none' : `1px solid ${BORDER}`, background: hovered ? 'rgba(255,255,255,0.025)' : 'transparent', cursor: 'pointer', transition: 'background 0.12s ease' }}
      onClick={() => { window.location.hash = lensHref(row.lens.id).slice(1); }}>
      <td style={{ padding: '7px 10px', borderLeft: `3px solid ${hovered ? bColor : 'transparent'}`, transition: 'border-color 0.12s ease' }}>
        <a href={lensHref(row.lens.id)} onClick={e => e.stopPropagation()} style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 500, color: TEXT_PRIMARY, textDecoration: 'none' }}>
          {row.lens.name}
        </a>
      </td>
      <td style={{ padding: '7px 10px', textAlign: 'right' as const, fontFamily: FONT_MONO, fontSize: 11, color: TEXT_DIM }}>{row.postCount}</td>
      <td style={{ padding: '7px 10px', textAlign: 'right' as const, fontFamily: FONT_MONO, fontSize: 11, color: TEXT_DIM }}>{row.commentCount}</td>
      <td style={{ padding: '7px 10px', textAlign: 'right' as const, fontFamily: FONT_MONO, fontSize: 11, color: row.scoreSentiment >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR }}>{row.scoreSentiment.toFixed(2)}</td>
      <td style={{ padding: '7px 10px', textAlign: 'right' as const }}>
        {row.claudeScore != null ? <ClaudePill score={row.claudeScore} /> : <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT }}>—</span>}
      </td>
    </tr>
  );
}
