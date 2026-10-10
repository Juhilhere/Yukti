export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Yukti">
      <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="#0B0B0C" stroke="#C9A96E" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 10 L16 17 L22 10 M16 17 V24" fill="none" stroke="#EDEAE4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
