// Quiet background artwork behind the whole app: a blueprint grid that fades out, topographic contour lines and the
// rings of an instrument gauge, on pure black. Static SVG only (no images, no network); the tick ring turns very slowly
// and stops when the user prefers reduced motion.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

const CONTOURS = [
  'M -80 210 C 160 120, 330 260, 560 190 S 900 60, 1120 150',
  'M -80 260 C 170 170, 340 310, 570 240 S 910 110, 1130 200',
  'M -80 312 C 180 222, 352 362, 582 292 S 922 162, 1142 252',
  'M -80 366 C 190 276, 366 416, 596 346 S 936 216, 1156 306',
  'M -80 422 C 200 332, 380 472, 610 402 S 950 272, 1170 362',
  'M -80 480 C 210 390, 396 530, 626 460 S 966 330, 1186 420',
];

export function Backdrop() {
  const cx = 1330;
  const cy = 830;
  return (
    <div className="backdrop-art" aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="yk-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#EDEAE4" strokeOpacity="0.045" strokeWidth="1" />
          </pattern>
          <radialGradient id="yk-grid-fade" cx="38%" cy="22%" r="70%">
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="yk-grid-mask"><rect width="1600" height="1000" fill="url(#yk-grid-fade)" /></mask>
          <radialGradient id="yk-glow" cx="50%" cy="0%" r="60%">
            <stop offset="0%" stopColor="#C9A96E" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#C9A96E" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="yk-gauge-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#C9A96E" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#C9A96E" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="yk-contour" x1="0" x2="1">
            <stop offset="0%" stopColor="#EDEAE4" stopOpacity="0" />
            <stop offset="35%" stopColor="#EDEAE4" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#EDEAE4" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect width="1600" height="1000" fill="#000" />
        <rect width="1600" height="1000" fill="url(#yk-glow)" />
        <rect width="1600" height="1000" fill="url(#yk-grid)" mask="url(#yk-grid-mask)" />

        {/* topographic contours */}
        <g fill="none" stroke="url(#yk-contour)" strokeWidth="1">
          {CONTOURS.map((d) => <path key={d} d={d} />)}
        </g>

        {/* instrument gauge */}
        <circle cx={cx} cy={cy} r="470" fill="url(#yk-gauge-glow)" />
        <g fill="none" stroke="#C9A96E">
          <circle cx={cx} cy={cy} r="460" strokeOpacity="0.07" />
          <circle cx={cx} cy={cy} r="380" strokeOpacity="0.09" />
          <circle cx={cx} cy={cy} r="300" strokeOpacity="0.11" />
          <circle cx={cx} cy={cy} r="220" strokeOpacity="0.08" strokeDasharray="2 6" />
          <circle cx={cx} cy={cy} r="140" strokeOpacity="0.10" />
          <g className="slow-turn">
            <circle cx={cx} cy={cy} r="340" strokeOpacity="0.18" strokeWidth="6" strokeDasharray="1 17.8" />
          </g>
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            return (
              <line key={i} x1={cx + Math.cos(a) * 150} y1={cy + Math.sin(a) * 150} x2={cx + Math.cos(a) * 455} y2={cy + Math.sin(a) * 455}
                strokeOpacity={i % 3 === 0 ? 0.08 : 0.035} />
            );
          })}
          {/* the needle */}
          <line x1={cx} y1={cy} x2={cx - 250} y2={cy - 205} strokeOpacity="0.22" strokeWidth="1.2" />
          <circle cx={cx} cy={cy} r="5" fill="#C9A96E" fillOpacity="0.25" stroke="none" />
        </g>

        {/* a single hairline horizon */}
        <line x1="0" y1="640" x2="1600" y2="640" stroke="#EDEAE4" strokeOpacity="0.03" />
      </svg>
      <div className="absolute inset-0" style={{ backgroundImage: GRAIN, opacity: 0.05, mixBlendMode: 'overlay' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(130% 100% at 50% 40%, transparent 55%, rgba(0,0,0,.75) 100%)' }} />
    </div>
  );
}
