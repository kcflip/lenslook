import { useEffect, useRef } from 'react';
import WordCloud from 'wordcloud';
import { PALETTE } from '../constants';

const ASPECT = 500 / 1100;

interface WordCloudCanvasProps {
  list: [string, number][];
  colorMap?: Record<string, string>;
  randomColors?: boolean;
  weightScale?: number;
  rotateRatio?: number;
  emptyMessage?: string;
  palette?: string[];
}

export function WordCloudCanvas({
  list,
  colorMap,
  randomColors = false,
  weightScale = 28,
  rotateRatio = 0.2,
  emptyMessage = 'No data',
  palette: paletteProp,
}: WordCloudCanvasProps) {
  const activePalette = paletteProp ?? PALETTE;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let resizeTimer: number;

    const render = () => {
      if (cancelled) return;
      const parent = canvas.parentElement!;
      const styles = getComputedStyle(parent);
      const pad = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const width = Math.max(320, Math.floor(parent.clientWidth - pad));
      const height = Math.max(240, Math.round(width * ASPECT));
      canvas.width = width;
      canvas.height = height;
      const scale = width / 1100;

      if (list.length === 0) {
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#666';
        ctx.font = `${Math.round(16 * scale)}px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(emptyMessage, width / 2, height / 2);
        return;
      }

      WordCloud(canvas, {
        list,
        gridSize: Math.max(6, Math.round(10 * scale)),
        weightFactor: (size: number) => Math.log(size + 1) * weightScale * scale,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: randomColors
          ? () => activePalette[Math.floor(Math.random() * activePalette.length)]
          : (word: string) => colorMap?.[word] ?? '#888',
        backgroundColor: '#1a1a1a',
        rotateRatio,
        rotationSteps: 2,
        minSize: Math.max(8, Math.round(12 * scale)),
        shuffle: false,
      });
    };

    render();

    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(render, 180);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', handleResize);
    };
  }, [list, colorMap, randomColors, weightScale, rotateRatio, emptyMessage]);

  return <canvas ref={canvasRef} className="cloud-canvas" />;
}
