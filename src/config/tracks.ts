import type { TrackId } from '../types';

/** Visual theme colors and prop set for a track environment. */
export interface TrackTheme {
  sky: string;
  fog: string;
  ground: string;
  /** Color of the distant backdrop shapes (mesas / peaks / islands). */
  backdrop: string;
  /** Barrier stripe accent color. */
  barrier: string;
  hemiSky: string;
  hemiGround: string;
  sunIntensity: number;
  props: 'palms' | 'cacti' | 'pines';
  /** Draw an ocean plane around the island. */
  ocean: boolean;
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
}

export const TRACKS: TrackDef[] = [
  {
    id: 'coastal',
    name: 'Coastal Circuit',
    description: 'Flowing ocean-side curves with palm-lined straights.',
    difficultyLabel: 'Medium',
    halfWidth: 7,
    elevated: false,
    points: [
      [0, 0, -170], [120, 0, -160], [205, 0, -95], [215, 0, 0],
      [165, 0, 75], [185, 0, 150], [105, 0, 205], [0, 0, 185],
      [-85, 0, 215], [-175, 0, 165], [-205, 0, 60], [-150, 0, -25],
      [-185, 0, -105], [-100, 0, -165],
    ],
    theme: {
      sky: '#8ed4f5', fog: '#bfe6f7', ground: '#dcc592', backdrop: '#5fae8e',
      barrier: '#e74c3c', hemiSky: '#bfe3ff', hemiGround: '#d8c79a',
      sunIntensity: 2.6, props: 'palms', ocean: true,
    },
  },
  {
    id: 'desert',
    name: 'Desert Speedway',
    description: 'Wide open straights and sweeping high-speed bends.',
    difficultyLabel: 'Easy',
    halfWidth: 9,
    elevated: false,
    points: [
      [-240, 0, -210], [40, 0, -225], [180, 0, -215], [255, 0, -120],
      [262, 0, 40], [185, 0, 130], [55, 0, 120], [-50, 0, 175],
      [-180, 0, 190], [-262, 0, 95], [-258, 0, -70],
    ],
    theme: {
      sky: '#f7c873', fog: '#f3d9a8', ground: '#d8a455', backdrop: '#b06a3b',
      barrier: '#e67e22', hemiSky: '#ffe3b0', hemiGround: '#c89a5a',
      sunIntensity: 3.0, props: 'cacti', ocean: false,
    },
  },
  {
    id: 'mountain',
    name: 'Mountain Pass',
    description: 'Tight technical switchbacks with serious elevation.',
    difficultyLabel: 'Hard',
    halfWidth: 6,
    elevated: true,
    points: [
      [0, 0, -150], [95, 1, -140], [150, 4, -75], [115, 7, 0],
      [160, 9, 75], [85, 12, 130], [0, 14, 95], [-75, 12, 140],
      [-150, 9, 85], [-115, 6, 10], [-160, 3, -65], [-85, 1, -120],
    ],
    theme: {
      sky: '#a8c6dd', fog: '#c3d5e2', ground: '#5d7a4e', backdrop: '#7d8da0',
      barrier: '#95a5a6', hemiSky: '#cfe0ee', hemiGround: '#6b7d5c',
      sunIntensity: 2.2, props: 'pines', ocean: false,
    },
  },
];

export function getTrack(id: TrackId): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
