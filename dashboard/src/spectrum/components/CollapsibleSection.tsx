import { useState, useRef, useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, meta, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<string>(defaultOpen ? 'none' : '0px');

  useEffect(() => {
    if (!contentRef.current) return;
    if (open) {
      // measure, set to measured px, then release to none after transition
      const h = contentRef.current.scrollHeight;
      setMaxHeight(h + 'px');
      const t = setTimeout(() => setMaxHeight('none'), 260);
      return () => clearTimeout(t);
    } else {
      // snap to current height then to 0 on next frame
      const h = contentRef.current.scrollHeight;
      setMaxHeight(h + 'px');
      requestAnimationFrame(() => setMaxHeight('0px'));
    }
  }, [open]);

  return (
    <section className="spectrum-section">
      <div
        className="spectrum-section-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className="spectrum-section-arrow">▼</span>
        <span className="spectrum-section-title">{title}</span>
        {meta && <span className="spectrum-section-meta">{meta}</span>}
      </div>
      <div
        className="spectrum-section-content"
        aria-hidden={!open}
        style={{ maxHeight, opacity: open ? 1 : 0 }}
        ref={contentRef}
      >
        {children}
      </div>
    </section>
  );
}
