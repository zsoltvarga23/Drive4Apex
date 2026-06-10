import * as THREE from 'three';
import { getCar } from '../config/cars';
import { getTrack } from '../config/tracks';
import { Track } from '../tracks/Track';
import { Vehicle } from '../vehicles/Vehicle';

/**
 * Dev-only regression test for steering polarity (the classic
 * "right-handed coordinates" trap): simulates one second of driving with
 * full RIGHT steer through the *real* Vehicle physics and asserts the car
 * ends up to the RIGHT of its starting direction, measured in chase-camera
 * screen space (screenRight = forward × up — exactly what the player sees).
 *
 * Throws if steering is inverted, so any future sign mistake in
 * Vehicle.update / Input / AI fails loudly on the next `yarn dev` reload.
 * The module is only imported in DEV builds and never ships to production.
 */
export function runSteeringValidation(): void {
  // Track constructor only computes spline samples — no meshes are built.
  const track = new Track(getTrack('coastal'), 0);
  const car = new Vehicle(getCar('comet'), '#ffffff', false, 'STEERING-TEST');
  car.spawn(track, 30, 0);

  const startPos = car.position.clone();
  const fwd = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
  const screenRight = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));

  // Full throttle + full right steer for 1s (60 fixed steps). Short enough
  // that the car can't loop around or reach the barriers and skew the result.
  car.controls = { throttle: 1, brake: 0, steer: 1, handbrake: false };
  for (let i = 0; i < 60; i++) car.update(1 / 60, track);

  const rightward = car.position.clone().sub(startPos).dot(screenRight);
  if (rightward <= 0.1) {
    throw new Error(
      `[Drive4Apex] STEERING INVERTED: full-right input displaced the car ` +
      `${rightward.toFixed(2)}m (expected clearly positive = rightward on screen). ` +
      `Check the heading sign in Vehicle.update().`,
    );
  }
  console.info(`[Drive4Apex] Steering polarity OK — right input moved car ${rightward.toFixed(2)}m right.`);
}
