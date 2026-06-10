import type { SaveData, Settings } from '../types';

const KEY = 'drive4apex-save-v1';
/** Save key from before the Drive4Apex rebrand; migrated on first load. */
const LEGACY_KEY = 'apex-rush-save-v1';

const DEFAULT_SETTINGS: Settings = {
  quality: 1,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  steeringSensitivity: 1.0,
  touchControls: 'auto',
};

const DEFAULT_SAVE: SaveData = {
  credits: 0,
  unlockedColors: ['crimson', 'cobalt', 'pearl', 'graphite'],
  carId: 'comet',
  colorId: 'crimson',
  settings: DEFAULT_SETTINGS,
  bestLaps: {},
  racesPlayed: 0,
  racesWon: 0,
};

/** Load progression from localStorage, merging over defaults so new fields are safe. */
export function loadSave(): SaveData {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      // Carry progress over from the pre-rebrand save key.
      raw = localStorage.getItem(LEGACY_KEY);
      if (raw) {
        localStorage.setItem(KEY, raw);
        localStorage.removeItem(LEGACY_KEY);
      }
    }
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      ...structuredClone(DEFAULT_SAVE),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      bestLaps: { ...(parsed.bestLaps ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

export function persistSave(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Storage may be unavailable (private mode); the game still works.
  }
}

export function resetSave(): SaveData {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return structuredClone(DEFAULT_SAVE);
}
