import { Doughnut } from 'react-chartjs-2';
import { PALETTE } from '../constants';

interface DoughnutChartProps {
  labels: string[];
  values: number[];
}

const OPTIONS = {
  responsive: true,
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: { color: '#ccc', font: { size: 11 }, padding: 10 },
    },
  },
};

export function DoughnutChart({ labels, values }: DoughnutChartProps) {
  const data = {
    labels,
    datasets: [{ data: values, backgroundColor: PALETTE, borderWidth: 0 }],
  };
  return <Doughnut data={data} options={OPTIONS} />;
}
