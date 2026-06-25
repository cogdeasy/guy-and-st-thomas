interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  max?: number;
}

/** Minimal dependency-free trend line for NEWS2 scores over time. */
export function Sparkline({ values, width = 160, height = 40, max }: SparklineProps) {
  const points = values.filter((v) => Number.isFinite(v));
  if (points.length < 2) {
    return <span className="text-xs text-slate-400">Not enough data</span>;
  }
  const top = Math.max(max ?? 0, ...points, 1);
  const stepX = width / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = i * stepX;
    const y = height - (v / top) * (height - 4) - 2;
    return [x, y] as const;
  });
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1]!;

  return (
    <svg width={width} height={height} className="overflow-visible" role="img" aria-label="NEWS2 trend">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill="currentColor" />
    </svg>
  );
}
