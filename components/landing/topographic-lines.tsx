/**
 * Clinical chart graph paper — very faint horizontal rule lines used
 * behind the hero, echoing the ruled paper of a hospital chart.
 *
 * Exported names preserved for backwards compatibility with existing
 * imports; the old "ECG trace" concept has been retired.
 */
export function TopographicLines({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1440 800"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <pattern id="hp-chart-rule" width="40" height="32" patternUnits="userSpaceOnUse">
          <line x1="0" y1="31.5" x2="40" y2="31.5" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="1440" height="800" fill="url(#hp-chart-rule)" opacity="0.7" />
    </svg>
  );
}

/**
 * Retained export — now renders nothing, since the clinical-chart
 * direction doesn't need a persistent ECG waveform in the hero.
 */
export function EcgTrace() {
  return null;
}
