import { useState } from 'react';
import { useDashboardData } from './hooks/useDashboardData';
import { useHashRoute } from './hooks/useHashRoute';
import { OverviewTab } from './tabs/OverviewTab';
import { TablesTab } from './tabs/TablesTab';
import { ClaudeSentimentTab } from './tabs/ClaudeSentimentTab';
import { LensDetailPage } from './tabs/LensDetailPage';
import { BrandDetailPage } from './tabs/BrandDetailPage';

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'tables',     label: 'Tables' },
  { id: 'claude',     label: 'Claude Sentiment' },
] as const;

type TabId = typeof TABS[number]['id'];

export function App() {
  const { data, error } = useDashboardData();
  const route = useHashRoute();
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  if (error) {
    return (
      <div>
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
        <h1>Lenslook — Lens Popularity</h1>
        <p className="meta">Loading…</p>
      </div>
    );
  }

  if (route.type === 'lens') {
    return (
      <div>
        <h1>Lenslook — Lens Popularity</h1>
        <LensDetailPage data={data} lensId={route.lensId} />
      </div>
    );
  }

  if (route.type === 'brand') {
    return (
      <div>
        <h1>Lenslook — Lens Popularity</h1>
        <BrandDetailPage data={data} brand={route.brand} />
      </div>
    );
  }

  return (
    <div>
      <h1>Lenslook — Lens Popularity</h1>

      <div className="tab-bar">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab-btn${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview'   && <OverviewTab        data={data} />}
      {activeTab === 'tables'     && <TablesTab          data={data} />}
      {activeTab === 'claude'     && <ClaudeSentimentTab data={data} />}
    </div>
  );
}
