/**
 * HeartLineMark — soft hand-drawn heart silhouette with a subtle ECG line.
 * Used as a small wordmark accent. Replaces the literal Red Cross icon.
 */
export function HeartLineMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 36 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 28 C 6 20 3 12 8 7 C 12 3 16 5 18 8 C 20 5 24 3 28 7 C 33 12 30 20 18 28 Z" />
      <path d="M5 17 H 12 L 14 12 L 16 22 L 18 17 H 24" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * HeroIllustration — large soft-line illustration that anchors the hero.
 * Hand-drawn stethoscope arching across an organic landscape with a small
 * heart-rate trace. No real photography, but warm and human.
 */
export function HeroIllustration({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 520 520"
      fill="none"
      aria-hidden="true"
    >
      {/* Cream blob backdrop */}
      <ellipse
        cx="270"
        cy="270"
        rx="240"
        ry="232"
        fill="currentColor"
        opacity="0.55"
        className="text-panel-hi"
      />

      {/* Rolling-hill horizon */}
      <path
        d="M 20 360 Q 130 320 260 350 T 510 340"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-cool/35"
      />
      <path
        d="M 20 405 Q 150 370 280 395 T 510 388"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        className="text-cool/20"
      />

      {/* Stethoscope tubing */}
      <g
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        className="text-cool"
      >
        {/* binaural ear pieces */}
        <path d="M 150 110 q -30 -20 -55 0" />
        <path d="M 370 110 q 30 -20 55 0" />
        {/* twin tubes converging */}
        <path d="M 150 110 C 150 200 200 230 250 240" />
        <path d="M 370 110 C 370 200 320 230 270 240" />
        {/* main tube */}
        <path d="M 260 240 C 250 280 230 300 230 340" />
      </g>

      {/* Chestpiece */}
      <circle
        cx="220"
        cy="365"
        r="36"
        fill="currentColor"
        className="text-alert"
      />
      <circle
        cx="220"
        cy="365"
        r="22"
        fill="currentColor"
        className="text-panel"
      />
      <circle
        cx="220"
        cy="365"
        r="14"
        fill="currentColor"
        className="text-alert/35"
      />

      {/* ECG ribbon — subtle, in a chip */}
      <g transform="translate(305 320)">
        <rect
          width="180"
          height="80"
          rx="14"
          fill="currentColor"
          className="text-panel"
          stroke="currentColor"
          strokeWidth="1"
        />
        <path
          d="M 12 40 H 48 L 56 32 L 62 50 L 68 18 L 76 64 L 82 40 H 124 L 132 32 L 138 50 L 144 18 L 152 64 L 158 40 H 170"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          className="text-alert"
        />
      </g>

      {/* Rural-sun arc */}
      <path
        d="M 380 130 a 38 38 0 1 1 -76 0"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
        className="text-signal"
      />
    </svg>
  );
}

/**
 * Backwards-compatible exports for files that imported the old icons.
 * MedicalCross now renders as the softer HeartLineMark; FormField is
 * retained as a generic key/value field with no chart styling.
 */
export const MedicalCross = HeartLineMark;

export function FormField({
  label,
  value,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={"flex items-baseline justify-between gap-6 " + className}>
      <span className="font-editorial text-[12.5px] uppercase tracking-[0.14em] text-stone">
        {label}
      </span>
      <span className="text-right font-editorial text-[14px] text-cool">
        {value}
      </span>
    </div>
  );
}
