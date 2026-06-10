import type { RaceMode } from '../types';
import type { Track } from '../tracks/Track';
import type { Vehicle } from '../vehicles/Vehicle';

export interface RaceEvents {
  /** Fired when the player completes a timing sector (0, 1 or 2). */
  onPlayerSector: (sectorIndex: number, time: number) => void;
  onPlayerLap: (lapNumber: number, lapTime: number, sectors: number[], isSessionBest: boolean) => void;
  onPlayerFinish: () => void;
}

/** A row in the live standings / final results. */
export interface Standing {
  vehicle: Vehicle;
  position: number;
  /** Finish time, or an estimate for cars still on track when results show. */
  time: number;
  estimated: boolean;
}

/**
 * Owns race rules: lap counting (with anti-cheat reverse detection),
 * timing, live positions, finish detection, and motorsport-style sector
 * timing. Tracks are split into three equal sectors (S1/S2/S3 — shown as
 * checkpoints in sprint mode); the player's crossings fire events that the
 * session uses for PB highlights and lap deltas.
 *
 * Time trial mode sets lapsTotal to Infinity: the player laps forever and
 * the race only ends when they quit.
 */
export class RaceManager {
  readonly mode: RaceMode;
  readonly lapsTotal: number;
  raceTime = 0;
  started = false;

  playerLapStart = 0;
  playerBestLap = Infinity;
  playerLastLap = 0;
  /** Completed sector times in the player's current lap. */
  currentSectors: number[] = [];
  /** Every lap time the player has set this session (for time trial history). */
  readonly sessionLaps: number[] = [];

  private track: Track;
  private vehicles: Vehicle[];
  private events: RaceEvents;
  /** Track distances of the S1→S2 and S2→S3 boundaries. */
  private boundaries: [number, number];
  private sectorStart = 0;

  constructor(track: Track, vehicles: Vehicle[], mode: RaceMode, laps: number, events: RaceEvents) {
    this.track = track;
    this.vehicles = vehicles;
    this.mode = mode;
    this.lapsTotal = mode === 'sprint' ? 1 : mode === 'timetrial' ? Number.POSITIVE_INFINITY : laps;
    this.events = events;
    this.boundaries = [track.length / 3, (track.length * 2) / 3];
  }

  start(): void {
    this.started = true;
    this.raceTime = 0;
    this.playerLapStart = 0;
    this.sectorStart = 0;
  }

  update(dt: number): void {
    if (!this.started) return;
    this.raceTime += dt;
    const L = this.track.length;

    for (const v of this.vehicles) {
      // Start-line crossing detection via distance wrap-around.
      const wrappedForward = v.prevDist > L * 0.75 && v.trackDist < L * 0.25;
      const wrappedBackward = v.prevDist < L * 0.25 && v.trackDist > L * 0.75;
      if (wrappedBackward) v.lap = Math.max(0, v.lap - 1); // no cutting backwards over the line

      if (wrappedForward && !v.finished) {
        // The grid spawns just behind the line at lap -1, so the first
        // crossing (lap -1 → 0) only starts the clock — it isn't a lap.
        const completedFullLap = v.lap >= 0;
        v.lap++;
        if (v.isPlayer) {
          if (completedFullLap) {
            // The start line closes sector 3.
            const s3 = this.raceTime - this.sectorStart;
            this.currentSectors.push(s3);
            this.events.onPlayerSector(this.currentSectors.length - 1, s3);

            const lapTime = this.raceTime - this.playerLapStart;
            this.playerLastLap = lapTime;
            this.sessionLaps.push(lapTime);
            const isSessionBest = lapTime < this.playerBestLap;
            if (isSessionBest) this.playerBestLap = lapTime;
            if (v.lap < this.lapsTotal) {
              this.events.onPlayerLap(v.lap + 1, lapTime, [...this.currentSectors], isSessionBest);
            }
          }
          this.playerLapStart = this.raceTime;
          this.sectorStart = this.raceTime;
          this.currentSectors = [];
        }
        if (v.lap >= this.lapsTotal) {
          v.finished = true;
          v.finishTime = this.raceTime;
          if (v.isPlayer) this.events.onPlayerFinish();
        }
      }

      if (v.isPlayer && !v.finished) this.checkSectorCrossings(v);

      v.totalProgress = v.lap * L + v.trackDist;
    }
  }

  /** Detect forward crossings of the two mid-lap sector boundaries. */
  private checkSectorCrossings(v: Vehicle): void {
    const L = this.track.length;
    for (let k = 0; k < 2; k++) {
      const b = this.boundaries[k];
      const crossed = v.prevDist < b && v.trackDist >= b && v.trackDist - v.prevDist < L / 2;
      // Sectors only count in order, on a lap that started at the line.
      if (crossed && this.currentSectors.length === k && v.lap >= 0) {
        const t = this.raceTime - this.sectorStart;
        this.currentSectors.push(t);
        this.sectorStart = this.raceTime;
        this.events.onPlayerSector(k, t);
      }
    }
  }

  /** Live race position of a vehicle (1-based). */
  positionOf(vehicle: Vehicle): number {
    let pos = 1;
    for (const v of this.vehicles) {
      if (v === vehicle) continue;
      if (v.finished && vehicle.finished) {
        if (v.finishTime < vehicle.finishTime) pos++;
      } else if (v.finished !== vehicle.finished) {
        if (v.finished) pos++;
      } else if (v.totalProgress > vehicle.totalProgress) {
        pos++;
      }
    }
    return pos;
  }

  /**
   * Final standings. Cars still racing get an estimated finish time from
   * their remaining distance and current pace.
   */
  finalStandings(): Standing[] {
    const L = this.track.length;
    const rows: Standing[] = this.vehicles.map((v) => {
      if (v.finished) return { vehicle: v, position: 0, time: v.finishTime, estimated: false };
      const remaining = this.lapsTotal * L - v.totalProgress;
      const pace = Math.max(Math.abs(v.speed), 10);
      return { vehicle: v, position: 0, time: this.raceTime + remaining / pace, estimated: true };
    });
    rows.sort((a, b) => a.time - b.time);
    rows.forEach((r, i) => (r.position = i + 1));
    return rows;
  }
}
