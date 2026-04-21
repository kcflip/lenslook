import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';

interface BarChartProps {
  labels: string[];
  values: number[];
  colors: string | string[];
  height?: number;
}

const BASE_OPTIONS: ChartOptions<'bar'> = {
  indexAxis: 'y',
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: '#888' }, grid: { color: '#222' } },
    y: { ticks: { color: '#ccc', font: { size: 11 } }, grid: { color: '#222' } },
  },
};

export function BarChart({ labels, values, colors, height = 340 }: BarChartProps) {
  const data = {
    labels,
    datasets: [{
      data: values,
      backgroundColor: colors,
      borderRadius: 3,
      borderWidth: 0,
    }],
  };
  return <Bar data={data} options={BASE_OPTIONS} height={height} />;
}
