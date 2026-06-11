import * as THREE from 'three';
import type { CarSpec, ControlState } from '../types';
import { buildCarModel, type CarModelParts } from './CarModel';
import type { Track } from '../tracks/Track';
import { clamp, lerp } from '../utils/math';

/**
 * Arcade vehicle: a kinematic model (speed + heading) that feels responsive
 * and is cheap to simulate. Both the player and AI cars use this class —
 * only the source of `controls` differs.
 */
export class Vehicle {
  readonly spec: CarSpec;
  readonly model: CarModelParts;
  readonly isPlayer: boolean;
  readonly name: string;

  position = new THREE.Vector3();
  heading = 0; // radians; 0 faces +Z, fwd = (sin h, 0, cos h)
  speed = 0; // m/s, signed (negative = reversing)

  controls: ControlState = { throttle: 0, brake: 0, steer: 0, handbrake: false };

  // Track-relative state (kept fresh by update()).
  trackIndexHint = -1;
  trackDist = 0;
  lateral = 0;
  prevDist = 0;

  // Race bookkeeping (managed by RaceManager).
  lap = 0;
  finished = false;
  finishTime = 0;
  totalProgress = 0;
  /** Race-time stamp when this car last crossed the start line. */
  lapStartAt = 0;
  /** Fastest full lap this race (0 = none yet) — feeds the leaderboards. */
  bestLapTime = 0;

  // Per-frame event flags consumed by RaceSession (sound + particles).
  wallHit = 0; // impact intensity 0..1, reset each frame
  skidAmount = 0;
  offRoad = false;

  private wallCooldown = 0;

  constructor(spec: CarSpec, colorHex: string, isPlayer: boolean, name: string) {
    this.spec = spec;
    this.isPlayer = isPlayer;
    this.name = name;
    this.model = buildCarModel(spec, colorHex);
  }

  /** Place the car on the track at a given distance/lateral offset. */
  spawn(track: Track, dist: number, lateral: number): void {
    const sample = track.sampleAt(dist);
    this.position.copy(sample.pos).addScaledVector(sample.left, lateral);
    this.heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    this.speed = 0;
    this.trackIndexHint = -1; // force full projection scan on first update
    const proj = track.project(this.position, -1);
    this.trackIndexHint = proj.index;
    this.trackDist = proj.dist;
    this.prevDist = proj.dist;
    this.lateral = proj.lateral;
    this.lap = 0;
    this.finished = false;
    this.syncModel(track, 0);
  }

  update(dt: number, track: Track): void {
    const c = this.controls;
    this.wallHit = 0;

    // Formula slicks barely work off the asphalt — precision is the deal.
    const offRoadGrip = this.spec.body === 'formula' ? 0.35 : 0.55;
    const surface = this.offRoad ? offRoadGrip : 1;
    const topSpeed = this.spec.topSpeed * surface;

    // --- Longitudinal ---
    if (c.throttle > 0 && this.speed >= 0) {
      this.speed += c.throttle * this.spec.accel * Math.max(0, 1 - this.speed / topSpeed) * dt;
    }
    if (c.brake > 0) {
      if (this.speed > 0.5) {
        this.speed = Math.max(0, this.speed - c.brake * this.spec.braking * dt);
      } else {
        // Reverse gear
        this.speed = Math.max(-8, this.speed - c.brake * this.spec.accel * 0.6 * dt);
      }
    }
    // Rolling resistance + aero drag
    this.speed -= this.speed * 0.06 * dt + Math.sign(this.speed) * 0.25 * dt;
    if (Math.abs(this.speed) < 0.05 && c.throttle === 0 && c.brake === 0) this.speed = 0;
    if (this.offRoad) this.speed -= this.speed * 0.5 * dt;
    if (c.handbrake) this.speed -= this.speed * 1.6 * dt;

    // --- Steering ---
    // Turn authority ramps up from standstill, then tapers at high speed.
    const absSpeed = Math.abs(this.speed);
    // Downforce keeps formula steering sharp at speed (smaller taper) —
    // more cornering authority, and more rope to hang yourself with.
    const taper = this.spec.body === 'formula' ? 0.012 : 0.022;
    const speedFactor = clamp(absSpeed / 7, 0, 1) / (1 + Math.max(0, absSpeed - 22) * taper);
    const handbrakeBoost = c.handbrake ? 1.6 : 1;
    // Steering convention: steer +1 = turn RIGHT. In three.js right-handed
    // space a positive Y-rotation is a LEFT turn, so right steer must
    // DECREASE heading. Validated at startup by runSteeringValidation().
    const turnRate = -c.steer * (1.4 + this.spec.handling * 1.5) * speedFactor * handbrakeBoost;
    this.heading += turnRate * dt * (this.speed >= 0 ? 1 : -1);

    // --- Integrate position ---
    const fwdX = Math.sin(this.heading);
    const fwdZ = Math.cos(this.heading);
    this.position.x += fwdX * this.speed * dt;
    this.position.z += fwdZ * this.speed * dt;

    // --- Track projection: distance along track, lateral offset, elevation ---
    const proj = track.project(this.position, this.trackIndexHint);
    this.trackIndexHint = proj.index;
    this.prevDist = this.trackDist;
    this.trackDist = proj.dist;
    this.lateral = proj.lateral;
    const sample = track.samples[proj.index];

    // Follow road elevation smoothly.
    this.position.y = lerp(this.position.y, sample.pos.y, Math.min(1, dt * 12));

    // Shoulder (off the painted road but inside the barriers): less grip.
    this.offRoad = Math.abs(this.lateral) > track.halfWidth + 0.4;

    // --- Barrier collision: clamp lateral position, scrub speed ---
    this.wallCooldown -= dt;
    const wallAt = track.halfWidth + 1.6;
    if (Math.abs(this.lateral) > wallAt) {
      const overshoot = Math.abs(this.lateral) - wallAt;
      this.position.addScaledVector(sample.left, -Math.sign(this.lateral) * overshoot);
      this.lateral = Math.sign(this.lateral) * wallAt;
      // Steer the car back toward the track direction.
      const trackHeading = Math.atan2(sample.tangent.x, sample.tangent.z);
      let diff = trackHeading - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, dt * 4);
      const impact = clamp(Math.abs(diff) * Math.abs(this.speed) * 0.08, 0.05, 1);
      this.speed *= 1 - clamp(impact * 0.5, 0.02, 0.4) * Math.min(1, dt * 30);
      if (this.wallCooldown <= 0 && absSpeed > 4) {
        this.wallHit = impact;
        this.wallCooldown = 0.25;
      }
    }

    // --- Skid state for audio/particles ---
    this.skidAmount =
      c.handbrake && absSpeed > 6
        ? 1
        : Math.abs(c.steer) > 0.85 && absSpeed > this.spec.topSpeed * 0.55
          ? 0.5
          : 0;

    this.syncModel(track, dt);
  }

  /** Apply physics state to the Three.js model (position, tilt, wheels, lights). */
  private syncModel(track: Track, dt: number): void {
    const g = this.model.group;
    g.position.copy(this.position);

    const sample = track.samples[Math.max(0, this.trackIndexHint)];
    const pitch = sample ? -Math.asin(clamp(sample.tangent.y, -0.5, 0.5)) : 0;
    const roll = -this.controls.steer * Math.min(1, Math.abs(this.speed) / 20) * 0.05;
    g.rotation.order = 'YXZ';
    g.rotation.set(pitch, this.heading, roll);

    const wheelSpin = (this.speed * dt) / 0.34;
    for (const wheel of this.model.wheels) wheel.rotation.x += wheelSpin;
    // Negated for the same reason as the heading update: -Y rotation = visually right.
    for (const pivot of this.model.frontPivots) pivot.rotation.y = -this.controls.steer * 0.42;

    this.model.brakeMaterial.color.setHex(this.controls.brake > 0 ? 0xff2222 : 0x550e0e);
  }

  /** Resolve simple sphere-vs-sphere collision against another vehicle. */
  static collide(a: Vehicle, b: Vehicle): number {
    const dx = b.position.x - a.position.x;
    const dz = b.position.z - a.position.z;
    const distSq = dx * dx + dz * dz;
    const minDist = 2.5;
    if (distSq >= minDist * minDist || distSq < 1e-6) return 0;
    const dist = Math.sqrt(distSq);
    const overlap = (minDist - dist) / 2;
    const nx = dx / dist;
    const nz = dz / dist;
    a.position.x -= nx * overlap;
    a.position.z -= nz * overlap;
    b.position.x += nx * overlap;
    b.position.z += nz * overlap;
    // Mild speed exchange — enough to feel contact without chaos.
    const relSpeed = Math.abs(a.speed - b.speed);
    a.speed *= 0.985;
    b.speed *= 0.985;
    return relSpeed;
  }
}
