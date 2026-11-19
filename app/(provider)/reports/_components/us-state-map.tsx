import map from './us-state-paths.json';

interface UsStateMapProps {
  activeStates: string[];
  width?: number;
}

/** Self-contained paths render when the report opens, including in the print window. */
export function UsStateMap({ activeStates, width = 800 }: UsStateMapProps) {
  const active = new Set(activeStates);
  return (
    <svg
      role="img"
      aria-label="States and the District of Columbia on provider and patient profiles"
      viewBox={map.viewBox}
      width={width}
      className="block h-auto max-w-full"
    >
      {map.states.map(({ name, d }) => (
        <path key={name} d={d} fill={active.has(name) ? '#1e40af' : '#e5e7eb'} stroke="#fff" strokeWidth={0.8}>
          <title>{[name, active.has(name) ? 'State recorded' : 'No profile state recorded'].join(' · ')}</title>
        </path>
      ))}
    </svg>
  );
}
