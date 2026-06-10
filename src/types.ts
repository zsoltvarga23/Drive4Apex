/** Shared type definitions used across the game. */

export type TrackId = 'coastal' | 'desert' | 'mountain';
export type RaceMode = 'circuit' | 'sprint';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type CarBody = 'sport' | 'super' | 'muscle' | 'compact' | 'classic';

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
  carId: string;
  colorId: string;
  settings: Settings;
  /** Best circuit lap time per track id, in seconds. */
  bestLaps: Partial<Record<TrackId, number>>;
  racesPlayed: number;
  racesWon: number;
}
