import type { Difficulty } from '../types';
import type { Track } from '../tracks/Track';
import type { Vehicle } from '../vehicles/Vehicle';
import { clamp, wrapAngle } from '../utils/math';

interface DifficultyParams {
  /** Fraction of car top speed the AI is willing to use. */
  speedFactor: number;
  /** Max lateral acceleration in corners (m/s²) — higher = faster cornering. */
  latAccel: number;
  /** Average seconds between driving mistakes. */
  mistakeEvery: number;
  /** Braking deceleration used for corner-entry planning. */
  decel: number;
}

const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: { speedFactor: 0.85, latAccel: 6.5, mistakeEvery: 8, decel: 9 },
  medium: { speedFactor: 0.93, latAccel: 8.5, mistakeEvery: 16, decel: 11 },
  hard: { speedFactor: 0.995, latAccel: 10.5, mistakeEvery: 30, decel: 13 },
};

/**
 * AI driver: follows a curvature-cutting racing line, plans braking for
 * upcoming corners, shifts laterally to overtake, and occasionally makes
 * human-style mistakes (a twitch of steering or an early lift).
 */
export class AIController {
  private readonly vehicle: Vehicle;
  private readonly params: DifficultyParams;
  /** Static lane preference so AI cars don't stack on one line. */
  private readonly laneBias: number;
  /** Small per-driver skill variation. */
  private readonly skill: number;

  private currentLateralTarget = 0;
  private mistakeTimer: number;
  private mistakeActive = 0;
  private mistakeSteer = 0;
  private stuckTime = 0;
  private reversing = 0;

  constructor(vehicle: Vehicle, difficulty: Difficulty, index: number) {
    this.vehicle = vehicle;
    this.params = DIFFICULTY[difficulty];
    this.laneBias = ((index % 5) - 2) * 0.9;
    this.skill = 0.96 + Math.random() * 0.08;
    this.mistakeTimer = this.params.mistakeEvery * (0.5 + Math.random());
  }

  update(dt: number, track: Track, vehicles: Vehicle[], playerProgress: number): void {
    const v = this.vehicle;
    const c = v.controls;

    // --- Unstick: if pinned against a wall, briefly reverse ---
    if (Math.abs(v.speed) < 1.5 && !v.finished) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 2.5) {
      this.reversing = 1.3;
      this.stuckTime = 0;
    }
    if (this.reversing > 0) {
      this.reversing -= dt;
      c.throttle = 0;
      c.brake = 1;
      c.steer = Math.sign(v.lateral);
      c.handbrake = false;
      return;
    }

    // --- Racing line: aim at a look-ahead point, cutting toward corner inside ---
    const lookDist = 7 + Math.abs(v.speed) * 0.45;
    const aheadCurv = track.curvatureAhead(v.trackDist, 35);
    const maxLat = track.halfWidth - 2.0;
    let targetLateral = clamp(aheadCurv * 220, -maxLat, maxLat) + this.laneBias;

    // --- Overtaking: if someone is just ahead on our line, move around them ---
    for (const other of vehicles) {
      if (other === v) continue;
      let gap = other.trackDist - v.trackDist;
      if (gap < -track.length / 2) gap += track.length;
      if (gap > 0 && gap < 14 && Math.abs(other.lateral - v.lateral) < 2.4) {
        targetLateral = clamp(
          other.lateral + (other.lateral > 0 ? -3.2 : 3.2),
          -maxLat, maxLat,
        );
        break;
      }
    }
    targetLateral = clamp(targetLateral, -maxLat, maxLat);
    this.currentLateralTarget += clamp(targetLateral - this.currentLateralTarget, -4 * dt, 4 * dt);

    const aim = track.sampleAt(v.trackDist + lookDist);
    const aimX = aim.pos.x + aim.left.x * this.currentLateralTarget;
    const aimZ = aim.pos.z + aim.left.z * this.currentLateralTarget;
    const desiredHeading = Math.atan2(aimX - v.position.x, aimZ - v.position.z);
    // steer +1 = right = decreasing heading, so a target at a HIGHER heading
    // (to the left) needs negative steer — hence heading minus desired.
    let steer = clamp(wrapAngle(v.heading - desiredHeading) * 2.2, -1, 1);

    // --- Speed planning: scan ahead, respect corner speeds + braking distance ---
    let targetSpeed = v.spec.topSpeed * this.params.speedFactor * this.skill;
    const scanStep = 8;
    for (let d = scanStep; d <= 80; d += scanStep) {
      const curv = Math.abs(track.sampleAt(v.trackDist + d).curvature);
      if (curv < 1e-4) continue;
      const cornerSpeed = Math.sqrt(this.params.latAccel / curv) * (0.8 + v.spec.handling * 0.35);
      const allowedNow = Math.sqrt(cornerSpeed * cornerSpeed + 2 * this.params.decel * d);
      targetSpeed = Math.min(targetSpeed, allowedNow);
    }

    // --- Gentle rubber-banding to keep races close ---
    const gapToPlayer = playerProgress - v.totalProgress;
    if (gapToPlayer > 90) targetSpeed *= 1.07;
    else if (gapToPlayer < -90) targetSpeed *= 0.95;

    // --- Mistakes: periodic steering twitch + throttle lift ---
    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0) {
      this.mistakeActive = 0.5 + Math.random() * 0.4;
      this.mistakeSteer = (Math.random() - 0.5) * 1.2;
      this.mistakeTimer = this.params.mistakeEvery * (0.6 + Math.random() * 0.8);
    }
    let throttleScale = 1;
    if (this.mistakeActive > 0) {
      this.mistakeActive -= dt;
      steer = clamp(steer + this.mistakeSteer, -1, 1);
      throttleScale = 0.45;
    }

    c.steer = steer;
    c.handbrake = false;
    if (v.speed < targetSpeed - 0.5) {
      c.throttle = throttleScale;
      c.brake = 0;
    } else if (v.speed > targetSpeed + 2.5) {
      c.throttle = 0;
      c.brake = 1;
    } else {
      c.throttle = 0.3 * throttleScale;
      c.brake = 0;
    }
  }
}
