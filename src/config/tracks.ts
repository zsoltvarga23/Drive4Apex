import type { TrackId } from '../types';

/** Visual theme colors and prop set for a track environment. */
export interface TrackTheme {
  sky: string;
  fog: string;
  ground: string;
  /** Color of the distant backdrop shapes (mesas / peaks / hills). */
  backdrop: string;
  /** Barrier stripe accent color. */
  barrier: string;
  hemiSky: string;
  hemiGround: string;
  sunIntensity: number;
  props: 'palms' | 'cacti' | 'pines' | 'parkland' | 'boulders';
  /** Draw an ocean plane around the island. */
  ocean: boolean;
}

/**
 * Signature landmarks placed along the lap. Ranges/positions are fractions
 * of total track length (0..1) so they survive layout tweaks.
 */
export interface TrackFeatures {
  /** Red/white rumble strips on corner edges. */
  curbs?: boolean;
  /** Enclosed tunnel sections: [startFraction, endFraction]. */
  tunnels?: [number, number][];
  /** Bridge sections (railings + support pylons, no embankment). */
  bridges?: [number, number][];
  /** Grandstand positions. */
  grandstands?: number[];
}

export interface TrackDef {
  id: TrackId;
  name: string;
  description: string;
  difficultyLabel: 'Easy' | 'Medium' | 'Hard';
  /** Half of the drivable road width, in meters. */
  halfWidth: number;
  /** Catmull-Rom control points [x, elevation, z]. The loop is closed. */
  points: [number, number, number][];
  /** True if the road leaves ground level (adds embankment skirts). */
  elevated: boolean;
  theme: TrackTheme;
  features?: TrackFeatures;
}

/**
 * Three original circuits, each built around a real-motorsport archetype
 * (inspired by, never copying, the real venues):
 *
 * - Apex International: modern Grand Prix venue — Silverstone's fast
 *   sweepers, Suzuka's esses, Bahrain's stadium hairpin and a COTA-style
 *   heavy-braking chicane. Wide FIA-style runoff, grandstands, curbs.
 * - Greenwood Endurance: classic European endurance park (Spa/Le Mans/
 *   Monza DNA) — long forest straights, a flat-out uphill left-right sweep
 *   over a blind crest, and flowing technical combinations in the trees.
 *   (Theme hooks are in place for a future day-to-night variant.)
 * - Sierra Canyon: a point-to-point style sprint run through high desert —
 *   tunnel through the ridge, bridge across the gorge, overlook sweepers.
 */
export const TRACKS: TrackDef[] = [
  {
    id: 'gp',
    name: 'Apex International Circuit',
    description: 'GP venue: stadium hairpin, flowing esses and a heavy-braking chicane.',
    difficultyLabel: 'Easy',
    halfWidth: 8,
    elevated: false,
    points: [
      // Main straight (slight kink) into the heavy-braking stadium hairpin
      [0, 0, -260], [150, 0, -262], [240, 0, -240], [295, 0, -165],
      [250, 0, -95], [185, 0, -125], [150, 0, -60],
      // The esses — rhythm section, Suzuka-style
      [185, 0, 0], [150, 0, 55], [190, 0, 110],
      // Fast, open sweepers (carry speed, Silverstone-style)
      [140, 0, 175], [40, 0, 205], [-70, 0, 215], [-180, 0, 205],
      // Back straight into the bus-stop chicane
      [-255, 0, 150], [-272, 0, 75], [-235, 0, 45], [-268, 0, -10],
      // Final sector back onto the pit straight
      [-240, 0, -110], [-160, 0, -215], [-70, 0, -255],
    ],
    theme: {
      sky: '#9fd0f0', fog: '#cfe3f2', ground: '#cfc5a8', backdrop: '#8b9bb0',
      barrier: '#e10600', hemiSky: '#d4e8fa', hemiGround: '#c2b896',
      sunIntensity: 2.8, props: 'parkland', ocean: false,
    },
    features: {
      curbs: true,
      grandstands: [0.015, 0.16, 0.56],
    },
  },
  {
    id: 'endurance',
    name: 'Greenwood Endurance Raceway',
    description: 'Forest straights, a flat-out uphill sweep and a blind crest.',
    difficultyLabel: 'Hard',
    halfWidth: 7,
    elevated: true,
    points: [
      // Downhill start straight into a fast right
      [0, 2, -200], [110, 0, -212], [185, 1, -160],
      // The uphill left-right sweep over a blind crest (Eau Rouge DNA)
      [205, 5, -75], [165, 9, -25], [205, 14, 40],
      // Climbing straight to the highest point
      [195, 17, 115], [130, 18, 165],
      // Chicane flick at the crest
      [40, 16, 145], [-15, 15, 180],
      // Long forest arc descending
      [-110, 14, 195], [-195, 11, 145],
      // Technical downhill left-left combination
      [-175, 7, 60], [-225, 5, -25],
      // Back through the woods to the line
      [-180, 3, -110], [-90, 2, -175],
    ],
    theme: {
      sky: '#a9c8e8', fog: '#c2d6e4', ground: '#4e6e3f', backdrop: '#5e7290',
      barrier: '#2962ff', hemiSky: '#cfe0ee', hemiGround: '#54683f',
      sunIntensity: 2.2, props: 'pines', ocean: false,
    },
    features: {
      curbs: true,
      grandstands: [0.01],
    },
  },
  {
    id: 'canyon',
    name: 'Sierra Canyon Run',
    description: 'High-desert sprint: through the ridge tunnel, over the gorge bridge.',
    difficultyLabel: 'Medium',
    halfWidth: 6.5,
    elevated: true,
    points: [
      // Highway section — flat-out start
      [0, 4, -240], [140, 4, -252], [250, 6, -195],
      // Climbing sweepers into the ridge
      [295, 9, -90], [265, 13, 10],
      // Tunnel through the mountain
      [205, 17, 75], [150, 19, 130],
      // Scenic overlook at the summit
      [60, 20, 175], [-40, 18, 195],
      // Descent toward the gorge
      [-150, 14, 205], [-235, 11, 140],
      // The bridge across the gorge
      [-270, 10, 40], [-250, 9, -60],
      // Canyon floor run back to the line
      [-190, 7, -140], [-100, 5, -205],
    ],
    theme: {
      sky: '#ffd9a0', fog: '#ecc795', ground: '#c1713f', backdrop: '#a05a32',
      barrier: '#ff8f00', hemiSky: '#ffe6bb', hemiGround: '#b06a3e',
      sunIntensity: 2.9, props: 'boulders', ocean: false,
    },
    features: {
      tunnels: [[0.33, 0.43]],
      bridges: [[0.64, 0.78]],
    },
  },
];

export function getTrack(id: TrackId): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
