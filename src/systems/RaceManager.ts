import type { RaceMode } from '../types';
import type { Track } from '../tracks/Track';
import type { Vehicle } from '../vehicles/Vehicle';

export interface RaceEvents {
  onPlayerLap: (lapNumber: number, lapTime: number, isBest: boolean) => void;
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
 * timing, live positions, and finish detection for circuit and sprint modes.
 */
export class RaceManager {
  readonly mode: RaceMode;
  readonly lapsTotal: number;
  raceTime = 0;
  started = false;

  playerLapStart = 0;
  playerBestLap = Infinity;
  playerLastLap = 0;

  private track: Track;
  private vehicles: Vehicle[];
  private events: RaceEvents;
  private finishCounter = 0;

  constructor(track: Track, vehicles: Vehicle[], mode: RaceMode, laps: number, events: RaceEvents) {
    this.track = track;
    this.vehicles = vehicles;
    this.mode = mode;
    this.lapsTotal = mode === 'sprint' ? 1 : laps;
    this.events = events;
  }

  start(): void {
    this.started = true;
    this.raceTime = 0;
    this.playerLapStart = 0;
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
            const lapTime = this.raceTime - this.playerLapStart;
            this.playerLapStart = this.raceTime;
            this.playerLastLap = lapTime;
            const isBest = lapTime < this.playerBestLap;
            if (isBest) this.playerBestLap = lapTime;
            if (v.lap < this.lapsTotal) this.events.onPlayerLap(v.lap + 1, lapTime, isBest);
          } else {
            this.playerLapStart = this.raceTime;
          }
        }
        if (v.lap >= this.lapsTotal) {
          v.finished = true;
          v.finishTime = this.raceTime;
          this.finishCounter++;
          if (v.isPlayer) this.events.onPlayerFinish();
        }
      }

      v.totalProgress = v.lap * L + v.trackDist;
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
