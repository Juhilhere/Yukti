// Shared chart styling (neutral dark theme).
export const CYAN = '#A7BCC7';
export const AMBER = '#C9A96E';
export const GRID = '#1F1E1C';
export const AXIS = '#9C978E';
export const SURFACE = '#0B0B0C';
export const OTHER = '#67635C';
/** Categorical order on the near-black surface: muted, distinct hues (steel, gold, mauve, rose, sage, sand). */
export const SERIES = ['#7FA7BF', '#C9A96E', '#A98BC0', '#C9857F', '#8DB38E', '#B9A37E'];
export const tooltipStyle = { background: '#131314', border: '1px solid #33302B', borderRadius: 6, fontSize: 12, color: '#EDEAE4' };
export const axisProps = { stroke: AXIS, tick: { fontSize: 11, fill: AXIS }, tickLine: false } as const;
