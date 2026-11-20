import type { SandboxVitalPoint } from '@/lib/sandbox/types';

export function WeightTrend({ data }: { data: SandboxVitalPoint[] }) {
  if (data.length < 2) return <p className="text-sm text-muted-foreground">Insufficient trend data.</p>;
  const weights = data.map((point) => point.weight);
  const min = Math.min(...weights) - 0.5;
  const max = Math.max(...weights) + 0.5;
  const points = data.map(({ weight }, index) => ({
    x: ((index + 0.5) / data.length) * 350,
    y: 92 - ((weight - min) / (max - min)) * 78,
  }));

  return (
    <div className="w-full min-w-0">
      <svg viewBox="0 0 350 105" className="block h-auto w-full" role="img"
        aria-label={`Weight trend from ${weights[0]} to ${weights.at(-1)} pounds`}>
        {[16, 54, 92].map((y) => <line key={y} x1="0" x2="350" y1={y} y2={y} stroke="var(--border)" vectorEffect="non-scaling-stroke" />)}
        <polyline points={points.map(({ x, y }) => `${x},${y}`).join(' ')}
          stroke="var(--primary)" strokeWidth="2" fill="none" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.map(({ x, y }, index) => (
          <circle key={data[index].label} cx={x} cy={y} r="3.5" stroke="var(--primary)" strokeWidth="2"
            fill={index === points.length - 1 ? 'var(--primary)' : 'var(--card)'} vectorEffect="non-scaling-stroke">
            <title>{`${data[index].label}: ${data[index].weight} lb`}</title>
          </circle>
        ))}
      </svg>
      <ol aria-label="Weight measurements" className="flex text-center text-xs leading-5 text-muted-foreground">
        {data.map(({ label, weight }) => (
          <li className="min-w-0 flex-1 [overflow-wrap:anywhere]" key={label}>
            <span className="block">{label}</span>
            <span className="block font-semibold text-foreground tabular-nums">{weight} lb</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
