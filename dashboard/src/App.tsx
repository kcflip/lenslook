import { useEffect, useState } from 'react';
import { useDashboardData } from './hooks/useDashboardData';
import { useHashRoute } from './hooks/useHashRoute';
import { OverviewTab } from './tabs/OverviewTab';
// import { TablesTab } from './tabs/TablesTab';
// import { ClaudeSentimentTab } from './tabs/ClaudeSentimentTab';
import { LensDetailPage } from './tabs/LensDetailPage';
import { LensDetailPageV2 } from './spectrum/LensDetailPageV2';
import { BrandDetailPage } from './tabs/BrandDetailPage';
import { BodiesTab } from './tabs/BodiesTab';
import { BodyDetailPage } from './tabs/BodyDetailPage';
import { SpectrumTab } from './spectrum/SpectrumTab';

type View = 'v1' | 'v2';
type System = 'Sony' | 'Nikon';

const VIEW_STORAGE_KEY   = 'lenslook:view';
const SYSTEM_STORAGE_KEY = 'lenslook:system';

function readStoredView(): View {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    return raw === 'v2' ? 'v2' : 'v1';
  } catch {
    return 'v1';
  }
}

function readStoredSystem(): System {
  try {
    const raw = localStorage.getItem(SYSTEM_STORAGE_KEY);
    return raw === 'Nikon' ? 'Nikon' : 'Sony';
  } catch {
    return 'Sony';
  }
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="v1-view-toggle-host" role="tablist" aria-label="Dashboard version">
      <button
        role="tab"
        aria-selected={view === 'v1'}
        className={view === 'v1' ? 'is-active' : ''}
        onClick={() => onChange('v1')}
      >
        Dashboard v1
      </button>
      <button
        role="tab"
        aria-selected={view === 'v2'}
        className={view === 'v2' ? 'is-active' : ''}
        onClick={() => onChange('v2')}
      >
        Dashboard v2 (Spectrum)
      </button>
    </div>
  );
}

// Nikon is wired through the data-loading hook but no Nikon catalog or
// scraped output exists yet. Disable the button until that lands so users
// don't pick it and see a silently-empty dashboard.
const NIKON_ENABLED = false;

function SystemToggle({ system, onChange }: { system: System; onChange: (s: System) => void }) {
  return (
    <div className="v1-view-toggle-host" role="tablist" aria-label="Camera system">
      <button
        role="tab"
        aria-selected={system === 'Sony'}
        className={system === 'Sony' ? 'is-active' : ''}
        onClick={() => onChange('Sony')}
      >
        Sony
      </button>
      <button
        role="tab"
        aria-selected={system === 'Nikon'}
        className={system === 'Nikon' ? 'is-active' : ''}
        onClick={() => NIKON_ENABLED && onChange('Nikon')}
        disabled={!NIKON_ENABLED}
        title={NIKON_ENABLED ? undefined : 'Nikon support not yet wired — no catalog or scraped data'}
      >
        Nikon
      </button>
    </div>
  );
}

export function App() {
  const [system, setSystem] = useState<System>(readStoredSystem);
  const { data, error } = useDashboardData(system);
  const route = useHashRoute();
  const [view, setView] = useState<View>(readStoredView);

  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* ignore */ }
  }, [view]);

  useEffect(() => {
    try { localStorage.setItem(SYSTEM_STORAGE_KEY, system); } catch { /* ignore */ }
  }, [system]);

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <SystemToggle system={system} onChange={setSystem} />
      <ViewToggle view={view} onChange={setView} />
    </div>
  );

  if (error) {
    return (
      <div>
        {header}
        <h1>Lenslook — Lens Popularity</h1>
        <p style={{ color: '#f87171', marginTop: '2rem' }}>
          Error loading data: {error}. Open this file via a local server (e.g.{' '}
          <code>npx serve .</code>).
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        {header}
        <h1>Lenslook — Lens Popularity</h1>
        <p className="meta">Loading…</p>
      </div>
    );
  }

  if (route.type === 'lens') {
    if (view === 'v2') {
      return (
        <>
          <div style={{ padding: '16px 36px 0' }}>{header}</div>
          <LensDetailPageV2 data={data} lensId={route.lensId} />
        </>
      );
    }
    return (
      <div>
        {header}
        <h1>Lenslook — Lens Popularity</h1>
        <LensDetailPage data={data} lensId={route.lensId} />
      </div>
    );
  }

  if (route.type === 'brand') {
    return (
      <div>
        {header}
        <h1>Lenslook — Lens Popularity</h1>
        <BrandDetailPage data={data} brand={route.brand} />
      </div>
    );
  }

  if (route.type === 'body') {
    return (
      <div>
        {header}
        <h1>Lenslook — Lens Popularity</h1>
        <BodyDetailPage data={data} bodyId={route.bodyId} />
      </div>
    );
  }

  if (view === 'v2') {
    return (
      <>
        <div style={{ padding: '16px 36px 0' }}>{header}</div>
        <SpectrumTab data={data} />
      </>
    );
  }

  const tabBar = (
    <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.5rem' }}>
      <a href="#" className={`tab-pill${route.type === 'home' ? ' active' : ''}`}>Overview</a>
      <a href="#/bodies" className={`tab-pill${route.type === 'bodies' ? ' active' : ''}`}>
        Bodies
        {data.bodies.length > 0 && (
          <span style={{ color: '#666', marginLeft: '0.3rem' }}>{data.bodies.length}</span>
        )}
      </a>
    </div>
  );

  if (route.type === 'bodies') {
    return (
      <div>
        {header}
        <h1>Lenslook — Lens Popularity</h1>
        {tabBar}
        <BodiesTab data={data} />
      </div>
    );
  }

  return (
    <div>
      {header}
      <h1>Lenslook — Lens Popularity</h1>
      {tabBar}
      <OverviewTab data={data} />
      {/* {activeTab === 'tables'     && <TablesTab          data={data} />} */}
      {/* {activeTab === 'claude'     && <ClaudeSentimentTab data={data} />} */}
    </div>
  );
}
