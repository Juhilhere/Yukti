// Shared chart styling (neutral dark theme).
export const CYAN = '#22D3EE';
export const AMBER = '#F5A524';
export const GRID = '#2A2A2E';
export const AXIS = '#9A9AA3';
export const SURFACE = '#161618';
export const OTHER = '#6B6B73';
/** Categorical order — validated (dark surface #161618) with the dataviz validator. */
export const SERIES = ['#0891B2', '#D97706', '#8B5CF6', '#EC4899', '#3B82F6', '#65A30D'];
export const tooltipStyle = { background: '#1E1E21', border: '1px solid #2A2A2E', borderRadius: 6, fontSize: 12, color: '#ECECEE' };
export const axisProps = { stroke: AXIS, tick: { fontSize: 11, fill: AXIS }, tickLine: false } as const;
