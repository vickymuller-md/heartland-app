'use client';

/**
 * Track Badge -- Shows patient's monitoring track assignment.
 * Track A = Digital (blue), Track B = Analog (green), Hybrid = purple.
 */

interface TrackBadgeProps {
  trackAssignment: string;
}

const TRACK_CONFIG: Record<
  string,
  { label: string; color: string; description: string }
> = {
  track_a: {
    label: 'Digital Track',
    color: 'bg-blue-100 text-blue-800',
    description: 'You receive app-based guidance',
  },
  track_b: {
    label: 'Analog Track',
    color: 'bg-green-100 text-green-800',
    description: 'You receive paper diary guidance',
  },
  hybrid: {
    label: 'Hybrid Track',
    color: 'bg-purple-100 text-purple-800',
    description: 'You receive both app and paper guidance',
  },
};

export function TrackBadge({ trackAssignment }: TrackBadgeProps) {
  const config = TRACK_CONFIG[trackAssignment] ?? TRACK_CONFIG.track_b;

  return (
    <div className="mb-4">
      <span
        className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${config.color}`}
      >
        {config.label}
      </span>
      <p className="mt-1 text-sm text-gray-500">{config.description}</p>
    </div>
  );
}
