import { useEffect, useState } from 'react';
import { useDashboardData } from './hooks/useDashboardData';
import { useHashRoute } from './hooks/useHashRoute';
import { LensDetailPage } from './spectrum/LensDetailPage';
import { BodyDetailPage } from './spectrum/BodyDetailPage';
import { BrandDetailPage } from './spectrum/BrandDetailPage';
import { BodiesPage } from './spectrum/BodiesPage';
import { SpectrumDashboard } from './spectrum/SpectrumDashboard';

type System = 'Sony' | 'Nikon';

const SYSTEM_STORAGE_KEY = 'lenslook:system';

function readStoredSystem(): System {
  try {
    const raw = localStorage.getItem(SYSTEM_STORAGE_KEY);
    return raw === 'Nikon' ? 'Nikon' : 'Sony';
  } catch {
    return 'Sony';
  }
}

export function App() {
  const [system, setSystem] = useState<System>(readStoredSystem);
  const { data, error } = useDashboardData(system);
  const route = useHashRoute();

  useEffect(() => {
    try { localStorage.setItem(SYSTEM_STORAGE_KEY, system); } catch { /* ignore */ }
  }, [system]);

  const bg = localStorage.getItem('lenslook:bg-tone') === 'black' ? '#0a0a0a'
    : localStorage.getItem('lenslook:bg-tone') === 'midnight' ? '#111111'
    : localStorage.getItem('lenslook:bg-tone') === 'graphite' ? '#222222'
    : localStorage.getItem('lenslook:bg-tone') === 'slate' ? '#2a2a2a'
    : '#1a1a1a';

  if (error) {
    return (
      <div style={{ background: bg, color: '#e8e8e8', fontFamily: "'DM Sans', sans-serif", minHeight: '100vh', padding: '48px 24px' }}>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', marginBottom: 24 }}>LENSLOOK</div>
        <div style={{ color: '#f87171', fontFamily: "'Space Mono', monospace", fontSize: 12 }}>
          Error loading data: {error}
          <br /><br />
          Open this file via a local server (e.g. <code>npm run dashboard</code>).
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ background: bg, color: '#e8e8e8', fontFamily: "'DM Sans', sans-serif", minHeight: '100vh', padding: '48px 24px' }}>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em', marginBottom: 24 }}>LENSLOOK</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Loading…</div>
      </div>
    );
  }

  if (route.type === 'lens') return <LensDetailPage data={data} lensId={route.lensId} />;
  if (route.type === 'body') return <BodyDetailPage data={data} bodyId={route.bodyId} />;
  if (route.type === 'brand') return <BrandDetailPage data={data} brand={route.brand} />;
  if (route.type === 'bodies') return <BodiesPage data={data} system={system} onSystemChange={setSystem} />;
  return <SpectrumDashboard data={data} system={system} onSystemChange={setSystem} />;
}
