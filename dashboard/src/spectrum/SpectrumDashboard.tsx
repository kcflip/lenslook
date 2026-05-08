import { useState, useMemo, useEffect } from 'react';
import type { DashboardData, Post } from '../types';
import {
  brandColor, FONT_DISPLAY, FONT_MONO,
  BG_TONES, ACCENTS,
  POSITIVE_COLOR, NEGATIVE_COLOR,
  TEXT_PRIMARY, TEXT_DIM, TEXT_DIMMER, TEXT_MUTED, TEXT_FAINT,
  BORDER, BORDER_MED,
  type BgTone, type Accent,
} from './tokens';
import { BrandDot, BrandMark } from './components/BrandMark';
import { Fold } from './components/Fold';
import { ClaudePill } from './components/ClaudePill';
import { brandOf, calcWeight, postCommentsUrl } from '../utils';
import { lensHref, brandHref } from '../hooks/useHashRoute';

const DEFAULT_BG: BgTone = 'charcoal';
const DEFAULT_ACCENT: Accent = 'white';

type System = 'Sony' | 'Nikon';

interface Props {
  data: DashboardData;
  system: System;
  onSystemChange: (s: System) => void;
}

interface LensRow {
  lensId: string;
  name: string;
  brand: string;
  postCount: number;
  commentCount: number;
  avgScore: number;
  avgUpvoteRatio: number;
  avgComments: number;
  scoreSentiment: number;
  claudeScore: number | null;
  claudeSummary: string | null;
}

interface BrandAgg {
  brand: string;
  mentions: number;
  lensCount: number;
  avgClaude: number | null;
}

interface HighlightPost {
  brand: string;
  lensId: string;
  lensName: string;
  title: string;
  url: string;
  subreddit: string;
  score: number;
  weight: number;
  claudeScore: number | null;
}

type SortKey = 'brand' | 'name' | 'postCount' | 'commentCount' | 'claudeScore';

const SORT_COLS: Array<{ key: SortKey; label: string }> = [
  { key: 'brand', label: 'Brand' },
  { key: 'name', label: 'Lens' },
  { key: 'postCount', label: 'Posts' },
  { key: 'commentCount', label: 'Cmts' },
  { key: 'claudeScore', label: 'Claude' },
];

export function SpectrumDashboard({ data, system, onSystemChange }: Props) {
  const { results, lenses, lensById, claudeSentiment } = data;
  const { stats, posts, fetchedAt, subreddits } = results;

  const [bgTone, setBgTone] = useState<BgTone>(() => (localStorage.getItem('lenslook:bg-tone') as BgTone) ?? DEFAULT_BG);
  const [accent, setAccent] = useState<Accent>(() => (localStorage.getItem('lenslook:accent') as Accent) ?? DEFAULT_ACCENT);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('postCount');
  const [sortAsc, setSortAsc] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem('lenslook:bg-tone', bgTone); }, [bgTone]);
  useEffect(() => { localStorage.setItem('lenslook:accent', accent); }, [accent]);

  const bg = BG_TONES[bgTone];
  const accentColor = ACCENTS[accent];

  useEffect(() => {
    const prev = document.body.style.backgroundColor;
    document.body.style.backgroundColor = bg;
    return () => { document.body.style.backgroundColor = prev; };
  }, [bg]);

  const lensRows = useMemo((): LensRow[] => stats.map(s => {
    const lens = lensById[s.lensId];
    const cs = claudeSentiment[s.lensId];
    return {
      lensId: s.lensId,
      name: lens ? lens.name : s.lensId,
      brand: lens?.brand ?? brandOf(s.lensId, lensById),
      postCount: s.postCount,
      commentCount: s.commentCount,
      avgScore: s.avgScore,
      avgUpvoteRatio: s.avgUpvoteRatio,
      avgComments: s.avgComments,
      scoreSentiment: s.scoreSentiment,
      claudeScore: cs?.score ?? null,
      claudeSummary: cs?.summary ?? null,
    };
  }), [stats, lensById, claudeSentiment]);

  const filteredRows = useMemo((): LensRow[] => {
    let rows = lensRows;
    if (brandFilter) rows = rows.filter(r => r.brand === brandFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => {
      const av = a[sortKey] as string | number | null;
      const bv = b[sortKey] as string | number | null;
      if (av == null) return 1;
      if (bv == null) return -1;
      const diff = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortAsc ? diff : -diff;
    });
  }, [lensRows, brandFilter, search, sortKey, sortAsc]);

  const maxPosts = useMemo(() => Math.max(1, ...lensRows.map(r => r.postCount)), [lensRows]);

  const brandAggs = useMemo((): BrandAgg[] => {
    const map: Record<string, { mentions: number; lensCount: number; scores: number[] }> = {};
    for (const r of lensRows) {
      if (!map[r.brand]) map[r.brand] = { mentions: 0, lensCount: 0, scores: [] };
      map[r.brand].mentions += r.postCount + r.commentCount;
      map[r.brand].lensCount++;
      if (r.claudeScore != null) map[r.brand].scores.push(r.claudeScore);
    }
    return Object.entries(map)
      .map(([brand, v]) => ({
        brand, mentions: v.mentions, lensCount: v.lensCount,
        avgClaude: v.scores.length ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length : null,
      }))
      .sort((a, b) => b.mentions - a.mentions);
  }, [lensRows]);

  const highlightPosts = useMemo((): HighlightPost[] => {
    const map: Record<string, { post: Post; weight: number; lensId: string }> = {};
    for (const post of posts) {
      const w = calcWeight(post);
      for (const lensId of post.lensIds) {
        const brand = brandOf(lensId, lensById);
        if (!map[brand] || w > map[brand].weight) map[brand] = { post, weight: w, lensId };
      }
    }
    return Object.entries(map)
      .map(([brand, { post, weight, lensId }]) => {
        const lens = lensById[lensId];
        return {
          brand, lensId,
          lensName: lens ? `${lens.brand} ${lens.name}` : lensId,
          title: post.title,
          url: post.id && post.subreddit ? postCommentsUrl(post) : post.url,
          subreddit: post.subreddit, score: post.score,
          weight: parseFloat(weight.toFixed(3)),
          claudeScore: claudeSentiment[lensId]?.score ?? null,
        };
      })
      .sort((a, b) => b.weight - a.weight);
  }, [posts, lensById, claudeSentiment]);

  const kpi = useMemo(() => {
    const mostPopular = [...lensRows].sort((a, b) => b.scoreSentiment - a.scoreSentiment)[0];
    const topBrand = [...brandAggs].sort((a, b) => b.mentions - a.mentions)[0];
    const now = new Date();
    const seed = now.getFullYear() * 1000 + (now.getMonth() + 1) * 31 + now.getDate();
    const lotd = lenses.length ? lenses[seed % lenses.length] : null;
    const totalPosts = stats.reduce((a, s) => a + s.postCount, 0);
    const totalComments = stats.reduce((a, s) => a + s.commentCount, 0);
    return {
      distinctLenses: stats.length, mostPopular, topBrand, lotd,
      totalPosts, totalComments,
      fetchedDate: fetchedAt ? new Date(fetchedAt).toLocaleString() : null,
      subreddits: subreddits.map(s => `r/${s}`),
    };
  }, [lensRows, brandAggs, lenses, stats, fetchedAt, subreddits]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const toggleBrand = (brand: string) => setBrandFilter(prev => prev === brand ? null : brand);

  return (
    <div style={{ background: bg, color: TEXT_PRIMARY, fontFamily: FONT_DISPLAY, minHeight: '100vh' }}>

      {/* ── Sticky Header ── */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, borderBottom: `1px solid ${BORDER}`, backgroundColor: bg }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 12, height: 52 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700, color: TEXT_PRIMARY, letterSpacing: '0.1em' }}>LENSLOOK</span>
          <a href="#/bodies" style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', letterSpacing: '0.08em', padding: '3px 8px', borderRadius: 2, background: 'rgba(255,255,255,0.04)', transition: 'background 0.15s' }}>BODIES</a>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <input
              type="text" placeholder="search lenses…" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', maxWidth: 320, background: 'rgba(255,255,255,0.04)', border: `1px solid ${search ? accentColor + '66' : 'rgba(255,255,255,0.08)'}`, borderRadius: 999, padding: '6px 20px', fontFamily: FONT_MONO, fontSize: 11, color: TEXT_PRIMARY, outline: 'none', transition: 'border-color 0.15s ease' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['Sony', 'Nikon'] as System[]).map(s => (
              <button key={s} onClick={() => s !== 'Nikon' && onSystemChange(s)} disabled={s === 'Nikon'}
                style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.08em', padding: '3px 10px', borderRadius: 2, border: 'none', cursor: s === 'Nikon' ? 'default' : 'pointer', background: system === s ? accentColor : 'rgba(255,255,255,0.06)', color: system === s ? '#000' : s === 'Nikon' ? TEXT_FAINT : TEXT_DIM, opacity: s === 'Nikon' ? 0.4 : 1, transition: 'background 0.15s ease' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 64px' }}>

        {/* ── Title ── */}
        <div style={{ padding: '28px 0 24px' }}>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 42, fontWeight: 700, letterSpacing: '-0.04em', margin: '0 0 6px 0', lineHeight: 1.05 }}>Lens popularity</h1>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: TEXT_DIMMER }}>
            {kpi.distinctLenses} lenses · {kpi.totalPosts.toLocaleString()} posts · {kpi.totalComments.toLocaleString()} comments
            {kpi.subreddits.length > 0 && ` · ${kpi.subreddits.join(', ')}`}
          </div>
          {kpi.fetchedDate && <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT, marginTop: 4 }}>Updated {kpi.fetchedDate}</div>}
        </div>

        {/* ── KPI Tiles ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 28 }}>
          <KpiTile label="Distinct Lenses" value={kpi.distinctLenses.toString()} borderColor={accentColor} valueColor={accentColor} />
          {kpi.mostPopular && (
            <KpiTile label="Most Popular" value={kpi.mostPopular.name} href={lensHref(kpi.mostPopular.lensId)}
              borderColor={brandColor(kpi.mostPopular.brand)} valueColor={brandColor(kpi.mostPopular.brand)}
              sub={`${kpi.mostPopular.scoreSentiment.toFixed(2)} sentiment`} />
          )}
          {kpi.lotd && (
            <KpiTile label="Lens of the Day" value={`${kpi.lotd.brand} ${kpi.lotd.name}`} href={lensHref(kpi.lotd.id)}
              borderColor={brandColor(kpi.lotd.brand)} valueColor={brandColor(kpi.lotd.brand)} />
          )}
          {kpi.topBrand && (
            <KpiTile label="Top Brand" value={kpi.topBrand.brand} href={brandHref(kpi.topBrand.brand)}
              borderColor={brandColor(kpi.topBrand.brand)} valueColor={brandColor(kpi.topBrand.brand)}
              sub={`${kpi.topBrand.mentions.toLocaleString()} mentions`} />
          )}
        </div>

        {/* ── Brand Pulse ── */}
        <Fold title="Brand Pulse" count={brandAggs.length} defaultOpen>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {brandAggs.map(agg => (
              <BrandCard key={agg.brand} agg={agg} active={brandFilter === agg.brand} accentColor={accentColor} onClick={() => toggleBrand(agg.brand)} />
            ))}
          </div>
        </Fold>

        {/* ── Highlight Posts ── */}
        {highlightPosts.length > 0 && (
          <Fold title="Top Post per Brand" count={highlightPosts.length} defaultOpen>
            {highlightPosts.map((hp, i, arr) => (
              <HighlightRow key={hp.brand} hp={hp} isLast={i === arr.length - 1} />
            ))}
          </Fold>
        )}

        {/* ── All Lenses ── */}
        <Fold title="All Lenses" count={filteredRows.length} defaultOpen alwaysOpen>
          {/* Filter chips */}
          {brandAggs.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              <button
                onClick={() => setBrandFilter(null)}
                style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.08em', padding: '3px 10px', borderRadius: 999, border: `1px solid ${!brandFilter ? accentColor : 'rgba(255,255,255,0.1)'}`, background: !brandFilter ? accentColor + '18' : 'transparent', color: !brandFilter ? accentColor : TEXT_DIM, cursor: 'pointer', transition: 'all 0.15s ease' }}>
                all
              </button>
              {brandAggs.map(agg => (
                <button key={agg.brand} onClick={() => toggleBrand(agg.brand)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.06em', padding: '3px 10px', borderRadius: 999, border: `1px solid ${brandFilter === agg.brand ? brandColor(agg.brand) : 'rgba(255,255,255,0.1)'}`, background: brandFilter === agg.brand ? brandColor(agg.brand) + '20' : 'transparent', color: brandFilter === agg.brand ? brandColor(agg.brand) : TEXT_DIM, cursor: 'pointer', transition: 'all 0.15s ease' }}>
                  <BrandDot brand={agg.brand} size={6} />
                  {agg.brand}
                </button>
              ))}
            </div>
          )}
          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER_MED}` }}>
                  {SORT_COLS.map(col => (
                    <th key={col.key}
                      onClick={() => onSort(col.key)}
                      style={{ fontFamily: FONT_MONO, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: sortKey === col.key ? accentColor : TEXT_MUTED, textAlign: col.key === 'name' || col.key === 'brand' ? 'left' : 'right', padding: '8px 10px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', fontWeight: sortKey === col.key ? 700 : 400 }}>
                      {col.label}{sortKey === col.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <TableRow key={row.lensId} row={row} maxPosts={maxPosts} accentColor={accentColor}
                    isOpen={openRow === row.lensId}
                    onToggle={() => setOpenRow(prev => prev === row.lensId ? null : row.lensId)} />
                ))}
              </tbody>
            </table>
            {filteredRows.length === 0 && (
              <div style={{ padding: '24px 10px', fontFamily: FONT_MONO, fontSize: 11, color: TEXT_FAINT, textAlign: 'center' }}>
                No lenses match the current filter.
              </div>
            )}
          </div>
        </Fold>

      </div>

      {/* ── Tweaks Panel ── */}
      {tweaksOpen && (
        <div style={{ position: 'fixed', bottom: 64, right: 16, background: '#1a1a1a', border: `1px solid ${BORDER}`, borderRadius: 4, padding: 16, zIndex: 100, minWidth: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: TEXT_MUTED, marginBottom: 14 }}>Tweaks</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: TEXT_DIM, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Accent</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(Object.entries(ACCENTS) as [Accent, string][]).map(([key, hex]) => (
                <button key={key} onClick={() => setAccent(key)} title={key}
                  style={{ width: 20, height: 20, borderRadius: '50%', background: hex, border: accent === key ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: TEXT_DIM, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Background</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(Object.entries(BG_TONES) as [BgTone, string][]).map(([key, hex]) => (
                <button key={key} onClick={() => setBgTone(key)} title={key}
                  style={{ width: 20, height: 20, borderRadius: 2, background: hex, border: bgTone === key ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', padding: 0 }} />
              ))}
            </div>
          </div>
        </div>
      )}
      <button onClick={() => setTweaksOpen(v => !v)}
        style={{ position: 'fixed', bottom: 16, right: 16, width: 40, height: 40, borderRadius: '50%', background: tweaksOpen ? accentColor : 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', zIndex: 101, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s ease' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tweaksOpen ? '#000' : 'rgba(255,255,255,0.7)'} strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiTile({ label, value, href, borderColor, valueColor, sub }: {
  label: string; value: string; href?: string;
  borderColor: string; valueColor: string; sub?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const inner = (
    <div
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER_MED}`, borderTop: `3px solid ${borderColor}`, borderRadius: 4, padding: '14px 18px', transition: 'box-shadow 0.15s ease', boxShadow: hovered ? '0 4px 20px rgba(0,0,0,0.4)' : 'none', height: '100%', boxSizing: 'border-box' as const }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 9, textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: TEXT_MUTED, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: valueColor, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{value}</div>
      {sub && <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, marginTop: 4 }}>{sub}</div>}
    </div>
  );
  return href
    ? <a href={href} style={{ textDecoration: 'none', display: 'block' }}>{inner}</a>
    : inner;
}

function BrandCard({ agg, active, accentColor, onClick }: {
  agg: BrandAgg; active: boolean; accentColor: string; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const bColor = brandColor(agg.brand);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ background: active ? bColor + '14' : hovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${active ? bColor + '40' : BORDER}`, borderLeft: `3px solid ${bColor}`, borderRadius: 4, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.15s ease', transform: hovered && !active ? 'translateY(-1px)' : 'none', boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.3)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <BrandMark brand={agg.brand} size={12} />
        {agg.avgClaude != null && <ClaudePill score={agg.avgClaude} />}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: TEXT_DIM }}>
        {agg.mentions.toLocaleString()} mentions
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT, marginTop: 2 }}>
        {agg.lensCount} {agg.lensCount === 1 ? 'lens' : 'lenses'}
      </div>
    </div>
  );
}

function HighlightRow({ hp, isLast }: { hp: HighlightPost; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);
  const bColor = brandColor(hp.brand);
  return (
    <div
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ display: 'grid', gridTemplateColumns: '90px 160px 1fr 70px 72px', gap: '0 12px', alignItems: 'center', padding: '7px 10px', borderBottom: isLast ? 'none' : `1px solid ${BORDER}`, borderLeft: `3px solid ${bColor}`, background: hovered ? 'rgba(255,255,255,0.025)' : 'transparent', transition: 'background 0.15s ease', fontSize: 12 }}>
      <a href={brandHref(hp.brand)} style={{ textDecoration: 'none' }}>
        <BrandMark brand={hp.brand} size={10} />
      </a>
      <a href={lensHref(hp.lensId)} style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_DIM, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {hp.lensName}
      </a>
      <a href={hp.url} target="_blank" rel="noopener"
        style={{ color: TEXT_DIMMER, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: FONT_DISPLAY, fontSize: 12 }}>
        &ldquo;{hp.title.length > 80 ? hp.title.slice(0, 77) + '…' : hp.title}&rdquo;
      </a>
      <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT, textAlign: 'right' as const }}>
        {hp.score.toLocaleString()} ↑
      </span>
<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {hp.claudeScore != null ? <ClaudePill score={hp.claudeScore} /> : <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT }}>—</span>}
      </div>
    </div>
  );
}

function TableRow({ row, maxPosts, accentColor, isOpen, onToggle }: {
  row: LensRow; maxPosts: number; accentColor: string; isOpen: boolean; onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const bColor = brandColor(row.brand);
  const barWidth = Math.max(4, (row.postCount / maxPosts) * 56);

  return (
    <>
      <tr
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ borderBottom: `1px solid ${BORDER}`, background: isOpen ? bColor + '0c' : hovered ? 'rgba(255,255,255,0.025)' : 'transparent', cursor: 'pointer', transition: 'background 0.12s ease' }}>
        <td style={{ padding: '6px 10px', borderLeft: `3px solid ${isOpen || hovered ? bColor : 'transparent'}`, transition: 'border-color 0.12s ease', whiteSpace: 'nowrap' as const }}>
          <a href={brandHref(row.brand)} onClick={e => e.stopPropagation()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 999, border: `1px solid ${bColor}55`, background: bColor + '18', color: bColor, textDecoration: 'none' }}>
            <BrandDot brand={row.brand} size={5} />
            {row.brand}
          </a>
        </td>
        <td style={{ padding: '6px 10px' }}>
          <a href={lensHref(row.lensId)} onClick={e => e.stopPropagation()}
            style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 500, color: TEXT_PRIMARY, textDecoration: 'none' }}>
            {row.name}
          </a>
        </td>
        <td style={{ padding: '6px 10px', textAlign: 'right' as const }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: barWidth, height: 5, background: bColor, borderRadius: 2, opacity: 0.7 }} />
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: TEXT_PRIMARY }}>{row.postCount.toLocaleString()}</span>
          </div>
        </td>
        <td style={{ padding: '6px 10px', textAlign: 'right' as const, fontFamily: FONT_MONO, fontSize: 11, color: TEXT_DIM }}>{row.commentCount.toLocaleString()}</td>
        <td style={{ padding: '6px 10px', textAlign: 'right' as const }}>
          {row.claudeScore != null ? <ClaudePill score={row.claudeScore} /> : <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT }}>—</span>}
        </td>
      </tr>
      {isOpen && (
        <tr style={{ background: bColor + '08' }}>
          <td colSpan={5} style={{ padding: '12px 16px 16px', borderBottom: `1px solid ${BORDER}`, borderLeft: `3px solid ${bColor}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <div>
                {row.claudeSummary
                  ? <p style={{ fontFamily: FONT_DISPLAY, fontSize: 13, color: TEXT_DIMMER, lineHeight: 1.65, margin: 0 }}>{row.claudeSummary}</p>
                  : <p style={{ fontFamily: FONT_MONO, fontSize: 10, color: TEXT_FAINT, margin: 0 }}>No Claude summary available.</p>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                {[
                  ['Avg Score', row.avgScore.toLocaleString()],
                  ['Avg Ratio', (row.avgUpvoteRatio * 100).toFixed(1) + '%'],
                  ['Avg Comments', row.avgComments.toFixed(0)],
                  ['Sentiment', row.scoreSentiment.toFixed(3)],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT_MONO, fontSize: 10, padding: '3px 0', borderBottom: `1px solid ${BORDER}` }}>
                    <span style={{ color: TEXT_DIM, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>{k}</span>
                    <span style={{ color: TEXT_PRIMARY }}>{v}</span>
                  </div>
                ))}
                <a href={lensHref(row.lensId)} style={{ marginTop: 4, fontFamily: FONT_MONO, fontSize: 10, color: accentColor, textDecoration: 'none', letterSpacing: '0.06em' }}>
                  Full detail page →
                </a>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
