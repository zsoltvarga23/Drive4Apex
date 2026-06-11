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
  playerName: '',
  playerId: '',
  credits: 0,
  unlockedColors: ['crimson', 'cobalt', 'pearl', 'graphite'],
  unlockedCars: [],
  carId: 'comet',
  colorId: 'crimson',
  settings: DEFAULT_SETTINGS,
  bestLaps: {},
  bestLapSectors: {},
  sectorPBs: {},
  bestSprints: {},
  racesPlayed: 0,
  racesWon: 0,
  podiums: 0,
  positionsSum: 0,
  totalCreditsEarned: 0,
  creditsSpent: 0,
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
    const parsed = raw ? (JSON.parse(raw) as Partial<SaveData>) : {};
    const save: SaveData = {
      ...structuredClone(DEFAULT_SAVE),
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      bestLaps: { ...(parsed.bestLaps ?? {}) },
    };
    ensurePlayerId(save);
    return save;
  } catch {
    const save = structuredClone(DEFAULT_SAVE);
    ensurePlayerId(save);
    return save;
  }
}

/** Generate the anonymous player id once and persist it immediately. */
function ensurePlayerId(save: SaveData): void {
  if (save.playerId) return;
  save.playerId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  persistSave(save);
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
  const save = structuredClone(DEFAULT_SAVE);
  ensurePlayerId(save);
  return save;
}
