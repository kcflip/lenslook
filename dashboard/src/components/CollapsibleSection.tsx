import { useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, children }: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <button
        className={`section-title${collapsed ? ' is-collapsed' : ''}`}
        onClick={() => setCollapsed(c => !c)}
      >
        {title}
        <span className="collapse-icon">▼</span>
      </button>
      <div className="card full" style={collapsed ? { display: 'none' } : undefined}>
        {children}
      </div>
    </>
  );
}
