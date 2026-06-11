import type { CarBody, SaveData, TrackId } from '../types';
import { getCar } from '../config/cars';

/** Which clock a record board tracks. */
export type BoardMode = 'lap' | 'sprint';

/** One row on a track-record board. Entries belong to human players only. */
export interface TimeEntry {
  /** Anonymous persistent player id — identifies "you" across renames. */
  pid: string;
  name: string;
  carId: string;
  /** Seconds. */
  time: number;
  /** ISO date (yyyy-mm-dd) the record was set. */
  date: string;
}

/** A row on the career rankings board (one per player). */
export interface CareerRow {
  pid: string;
  name: string;
  wins: number;
  level: number;
  creditsEarned: number;
  credits: number;
  races: number;
  podiums: number;
}

/**
 * Leaderboard service abstraction. The game only talks to this interface;
 * the hybrid implementation below caches locally and syncs with the
 * Netlify Function backend when reachable. Swapping in Firebase/Supabase/
 * PlayFab later means re-implementing this interface only.
 */
export interface LeaderboardService {
  /** Must be called once with the loaded save (provides identity). */
  init(save: SaveData): void;
  /** Validate + store locally, then push to the shared board (async, silent). */
  submitTime(trackId: TrackId, mode: BoardMode, entry: TimeEntry, minPlausible: number): boolean;
  /** Last known board (instant, from cache). */
  records(trackId: TrackId, mode: BoardMode): TimeEntry[];
  /** Pull the shared board; returns true when the server was reachable. */
  refreshRecords(trackId: TrackId, mode: BoardMode): Promise<boolean>;
  /** Career table: other players from cache + the local player, ranked. */
  careerRows(save: SaveData): CareerRow[];
  /** Push the player's career snapshot to the shared board (async, silent). */
  pushCareer(save: SaveData): void;
  /** Pull shared careers; returns true when the server was reachable. */
  refreshCareers(): Promise<boolean>;
}

/** Driver level grows with lifetime credits earned. */
export function levelFromXP(xp: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp)) / 15);
}

/** Strip markup-relevant characters; boards render names from strangers. */
export function sanitizeName(raw: string): string {
  return raw.replace(/[<>&"'`]/g, '').trim().slice(0, 16);
}

/** Nickname, or a stable placeholder until the player picks one. */
export function displayName(save: SaveData): string {
  return sanitizeName(save.playerName) || `Driver ${save.playerId.slice(0, 4).toUpperCase()}`;
}

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

const API = '/api/leaderboard';
const STORE_KEY = 'drive4apex-leaderboards-v2';
/** v1 stored AI rivals on the boards — dropped per design change. */
const LEGACY_KEY = 'drive4apex-leaderboards-v1';
const BOARD_CAP = 100;

interface StoredData {
  boards: Record<string, TimeEntry[]>;
  /** Cached career rows of *other* players (self is computed fresh). */
  careers: CareerRow[];
}

/**
 * Local cache + Netlify Function backend.
 *
 * Offline-first: every read renders instantly from localStorage; refresh
 * calls hit `/api/leaderboard` (a Netlify Function backed by Netlify Blobs)
 * and update the cache when the game is deployed. On a dev server or
 * without network the game silently stays in local-only mode.
 *
 * Anti-cheat validation (client *and* server re-check independently):
 * - times must be physically plausible for the track;
 * - player laps reach submitTime only after all three sectors were crossed
 *   in order from a clean start-line pass;
 * - the server additionally bounds names, car ids and career stats.
 */
export class HybridLeaderboards implements LeaderboardService {
  private data: StoredData;
  private myPid = '';

  constructor() {
    this.data = this.load();
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
  }

  init(save: SaveData): void {
    this.myPid = save.playerId;
  }

  private load(): StoredData {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredData>;
        return { boards: parsed.boards ?? {}, careers: parsed.careers ?? [] };
      }
    } catch {
      /* fall through */
    }
    return { boards: {}, careers: [] };
  }

  private persist(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable — cache becomes session-only */
    }
  }

  private async fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------- Track records

  /** One entry per player per vehicle class — formula records stay separate. */
  private static merge(board: TimeEntry[], entry: TimeEntry): boolean {
    const cls = getCar(entry.carId).body;
    const i = board.findIndex((e) => e.pid === entry.pid && getCar(e.carId).body === cls);
    if (i >= 0) {
      if (board[i].time <= entry.time) return false;
      board.splice(i, 1);
    }
    board.push(entry);
    board.sort((a, b) => a.time - b.time);
    if (board.length > BOARD_CAP) board.length = BOARD_CAP;
    return true;
  }

  submitTime(trackId: TrackId, mode: BoardMode, entry: TimeEntry, minPlausible: number): boolean {
    if (!isFinite(entry.time) || entry.time < minPlausible || entry.time > 1800) return false;
    const key = `${trackId}:${mode}`;
    const board = this.data.boards[key] ?? (this.data.boards[key] = []);
    const improved = HybridLeaderboards.merge(board, entry);
    if (improved) {
      this.persist();
      // Share with the world; silently ignored when offline / not deployed.
      void this.fetchJson(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'time', track: trackId, mode, entry }),
      }).catch(() => {});
    }
    return improved;
  }

  records(trackId: TrackId, mode: BoardMode): TimeEntry[] {
    return [...(this.data.boards[`${trackId}:${mode}`] ?? [])];
  }

  async refreshRecords(trackId: TrackId, mode: BoardMode): Promise<boolean> {
    try {
      const res = await this.fetchJson(`${API}?board=records&track=${trackId}&mode=${mode}`);
      const server = Array.isArray(res) ? (res as TimeEntry[]) : [];
      const key = `${trackId}:${mode}`;
      const local = this.data.boards[key] ?? [];

      // Re-submit personal bests the server doesn't know yet (set offline).
      for (const mine of local.filter((e) => e.pid === this.myPid)) {
        const cls = getCar(mine.carId).body;
        const remote = server.find((e) => e.pid === this.myPid && getCar(e.carId).body === cls);
        if (!remote || remote.time > mine.time) {
          HybridLeaderboards.merge(server, mine);
          void this.fetchJson(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'time', track: trackId, mode, entry: mine }),
          }).catch(() => {});
        }
      }

      this.data.boards[key] = server;
      this.persist();
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------- Careers

  private selfRow(save: SaveData): CareerRow {
    return {
      pid: save.playerId,
      name: displayName(save),
      wins: save.racesWon,
      level: levelFromXP(save.totalCreditsEarned),
      creditsEarned: save.totalCreditsEarned,
      credits: save.credits,
      races: save.racesPlayed,
      podiums: save.podiums,
    };
  }

  careerRows(save: SaveData): CareerRow[] {
    const rows = this.data.careers.filter((r) => r.pid !== save.playerId);
    rows.push(this.selfRow(save));
    rows.sort((a, b) => b.wins - a.wins || b.level - a.level || b.creditsEarned - a.creditsEarned);
    return rows;
  }

  pushCareer(save: SaveData): void {
    void this.fetchJson(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'career', row: this.selfRow(save) }),
    }).catch(() => {});
  }

  async refreshCareers(): Promise<boolean> {
    try {
      const res = await this.fetchJson(`${API}?board=careers`);
      this.data.careers = Array.isArray(res) ? (res as CareerRow[]) : [];
      this.persist();
      return true;
    } catch {
      return false;
    }
  }
}

/** Vehicle class labels shown on record boards. */
export const BODY_CLASS_LABELS: Record<CarBody, string> = {
  compact: 'Street Compact',
  sport: 'Sports Coupe',
  classic: 'Classic GT',
  muscle: 'Muscle Car',
  super: 'GT Racer',
  formula: 'Formula Car',
};

/** "Comet GT · Sports Coupe" — vehicle cell for record tables. */
export function vehicleLabel(carId: string): string {
  const car = getCar(carId);
  return `${car.name} · ${BODY_CLASS_LABELS[car.body]}`;
}

/** The active service. Swap this assignment to migrate to another backend. */
export const leaderboards: LeaderboardService = new HybridLeaderboards();
