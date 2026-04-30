import { useMemo, useState } from 'react';
import type { DashboardData } from '../types';
import { aggregate, formatFetched } from './utils/aggregate';
import { brandColor } from './utils/colors';
import { BRAND_ORDER } from './brands';
import { CollapsibleSection } from './components/CollapsibleSection';
import { KPITile } from './components/KPITile';
import { BrandPulseCard } from './components/BrandPulseCard';
import { HighlightPosts } from './components/HighlightPosts';
import { FilterChips } from './components/FilterChips';
import { LensTable } from './components/LensTable';
import { HeatLegend } from './components/HeatLegend';
import { lensHref, brandHref } from '../hooks/useHashRoute';
import './spectrum.css';

interface Props {
  data: DashboardData;
}

export function SpectrumTab({ data }: Props) {
  const spec = useMemo(() => aggregate(data), [data]);
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const brandsInData = useMemo(() => {
    const present = new Set(spec.brands.map((b) => b.brand));
    // Render in spec order if known, otherwise alphabetical for the rest.
    const known = BRAND_ORDER.filter((b) => present.has(b));
    const other = [...present].filter((b) => !BRAND_ORDER.includes(b as never)).sort();
    return [...known, ...other];
  }, [spec.brands]);

  const filteredLenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return spec.lenses.filter((r) => {
      if (brandFilter && r.brand !== brandFilter) return false;
      if (q && !r.lensLabel.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [spec.lenses, brandFilter, search]);

  const filteredHighlights = useMemo(
    () => (brandFilter ? spec.highlightPosts.filter((h) => h.brand === brandFilter) : spec.highlightPosts),
    [spec.highlightPosts, brandFilter],
  );

  return (
    <div className="spectrum">
      {/* Topbar */}
      <div className="spectrum-topbar">
        <div className="spectrum-topbar-left">
          <div className="spectrum-logo-dots">
            {brandsInData.slice(0, 4).map((b) => (
              <span key={b} style={{ background: brandColor(b) }} />
            ))}
          </div>
          <span className="spectrum-logo-text">LENSLOOK</span>
          <span className="spectrum-breadcrumb">/ lens-popularity</span>
        </div>
        <span className="spectrum-meta">
          {formatFetched(spec.meta.fetchedAt)} · {spec.meta.lensesTracked} lenses
        </span>
      </div>

      <h1 className="spectrum-title">Lens popularity</h1>
      <div className="spectrum-subtitle">
        {spec.meta.matchedPosts.toLocaleString()} posts · {spec.meta.matchedComments.toLocaleString()} comments ·{' '}
        {spec.meta.subreddits.map((s) => `r/${s}`).join(', ')}
      </div>

      {spec.meta.syntheticSparks && (
        <div className="spectrum-synthetic-note" style={{ marginTop: 16 }}>
          ⚠ Weekly trend data is synthesized — real timestamps are not available on these posts.
        </div>
      )}

      {/* KPI row */}
      <div className="spectrum-kpi-grid">
        {spec.kpis.map((k) => (
          <KPITile
            key={k.label}
            label={k.label}
            value={k.value}
            delta={k.delta}
            brand={k.brand}
            href={k.lensId ? lensHref(k.lensId) : k.brand ? brandHref(k.brand) : undefined}
          />
        ))}
      </div>

      {/* Brand Pulse */}
      <CollapsibleSection
        title="Brand pulse"
        meta={<span>{spec.brands.length} brands · 14-week window</span>}
      >
        <div className="spectrum-pulse-grid">
          {spec.brands.map((b) => (
            <BrandPulseCard
              key={b.brand}
              brand={b.brand}
              posts={b.posts}
              avgScore={b.avgScore}
              trend={b.trend}
              active={brandFilter === b.brand}
              onClick={() => setBrandFilter((cur) => (cur === b.brand ? null : b.brand))}
            />
          ))}
        </div>
      </CollapsibleSection>

      {/* Highlight posts */}
      <CollapsibleSection
        title="Highest-weighted post per brand"
        meta={<span>{filteredHighlights.length} rows</span>}
      >
        <HighlightPosts rows={filteredHighlights} />
      </CollapsibleSection>

      {/* All lenses */}
      <CollapsibleSection
        title="All lenses"
        meta={<span>{filteredLenses.length} / {spec.lenses.length}</span>}
      >
        <FilterChips
          brands={brandsInData}
          activeBrand={brandFilter}
          onBrand={setBrandFilter}
          search={search}
          onSearch={setSearch}
        />
        <LensTable rows={filteredLenses} maxes={spec.maxes} />
        <HeatLegend brands={brandsInData} />
      </CollapsibleSection>
    </div>
  );
}
