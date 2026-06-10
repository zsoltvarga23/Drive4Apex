/** Shared type definitions used across the game. */

export type TrackId = 'gp' | 'endurance' | 'canyon';
export type RaceMode = 'circuit' | 'sprint' | 'timetrial';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type CarBody = 'sport' | 'super' | 'muscle' | 'compact' | 'classic' | 'formula';

/** Static performance/appearance data for a selectable car. */
export interface CarSpec {
  id: string;
  name: string;
  /** Top speed in m/s (1 m/s = 3.6 km/h). */
  topSpeed: number;
  /** Peak acceleration in m/s². */
  accel: number;
  /** Steering responsiveness, 0..1. */
  handling: number;
  /** Braking deceleration in m/s². */
  braking: number;
  body: CarBody;
  /** Credit cost to unlock; omitted/0 = available from the start. */
  price?: number;
}

/** Everything needed to start a race. */
export interface RaceConfig {
  trackId: TrackId;
  mode: RaceMode;
  laps: number; // 1 for sprint
  carId: string;
  colorHex: string;
  difficulty: Difficulty;
}

/** Normalized driving inputs produced by the player or an AI controller. */
export interface ControlState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
}

/** Graphics quality presets. */
export type Quality = 0 | 1 | 2; // low | medium | high

export interface Settings {
  quality: Quality;
  masterVolume: number; // 0..1
  musicVolume: number;
  sfxVolume: number;
  steeringSensitivity: number; // 0.5..1.5
  touchControls: 'auto' | 'on' | 'off';
}

/** Persistent player progression, stored in localStorage. */
export interface SaveData {
  credits: number;
  unlockedColors: string[];
  /** Ids of purchased premium cars (free cars are always available). */
  unlockedCars: string[];
  carId: string;
  colorId: string;
  settings: Settings;
  /** Best lap time per track id (circuit & time trial), in seconds. */
  bestLaps: Partial<Record<TrackId, number>>;
  /** Sector breakdown of the best lap — reference for live lap deltas. */
  bestLapSectors: Partial<Record<TrackId, number[]>>;
  /** Individual personal-best sector times (the "ideal lap"). */
  sectorPBs: Partial<Record<TrackId, number[]>>;
  /** Fastest sprint (point-to-point) total time per track. */
  bestSprints: Partial<Record<TrackId, number>>;
  racesPlayed: number;
  racesWon: number;
}
