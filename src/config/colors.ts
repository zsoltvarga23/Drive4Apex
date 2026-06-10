/** Car paint colors. Colors with a cost are unlocked with race credits. */
export interface ColorOption {
  id: string;
  name: string;
  hex: string;
  /** Credit cost; 0 = unlocked from the start. */
  cost: number;
}

export const COLORS: ColorOption[] = [
  { id: 'crimson', name: 'Crimson', hex: '#d62b2b', cost: 0 },
  { id: 'cobalt', name: 'Cobalt Blue', hex: '#2a6fdb', cost: 0 },
  { id: 'pearl', name: 'Pearl White', hex: '#eef0f2', cost: 0 },
  { id: 'graphite', name: 'Graphite', hex: '#3a3f47', cost: 0 },
  { id: 'sunburst', name: 'Sunburst Orange', hex: '#ff7b00', cost: 250 },
  { id: 'lime', name: 'Lime Surge', hex: '#8ee000', cost: 250 },
  { id: 'teal', name: 'Teal Wave', hex: '#00b4a0', cost: 400 },
  { id: 'violet', name: 'Violet Storm', hex: '#7b2cbf', cost: 400 },
  { id: 'gold', name: 'Gold Rush', hex: '#ffc400', cost: 600 },
  { id: 'midnight', name: 'Midnight Chrome', hex: '#1b2a4a', cost: 800 },
];

/** Pool of paints used to give AI cars some variety. */
export const AI_COLOR_POOL = [
  '#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad',
  '#16a085', '#d35400', '#7f8c8d', '#f1c40f', '#34495e',
];

export function getColor(id: string): ColorOption {
  return COLORS.find((c) => c.id === id) ?? COLORS[0];
}
