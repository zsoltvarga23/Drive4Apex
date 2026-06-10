import * as THREE from 'three';

const MAX = 200;
const HIDDEN_Y = -1000;

/**
 * A fixed-size particle pool rendered as a single THREE.Points object —
 * one draw call for all smoke, dust and sparks. Dead particles are parked
 * far below the world instead of reallocating buffers.
 */
export class Particles {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private velocities = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private cursor = 0;
  private geometry: THREE.BufferGeometry;
  enabled = true;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    for (let i = 0; i < MAX; i++) this.positions[i * 3 + 1] = HIDDEN_Y;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.55,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
  }

  private emit(x: number, y: number, z: number, color: THREE.Color, spread: number, up: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.velocities[i * 3] = (Math.random() - 0.5) * spread;
    this.velocities[i * 3 + 1] = Math.random() * up + 0.5;
    this.velocities[i * 3 + 2] = (Math.random() - 0.5) * spread;
    this.colors[i * 3] = color.r;
    this.colors[i * 3 + 1] = color.g;
    this.colors[i * 3 + 2] = color.b;
    this.life[i] = 0.5 + Math.random() * 0.4;
  }

  private static smoke = new THREE.Color(0.75, 0.75, 0.78);
  private static spark = new THREE.Color(1.0, 0.65, 0.2);
  private static dust = new THREE.Color(0.8, 0.7, 0.5);

  spawnSmoke(pos: THREE.Vector3): void {
    if (!this.enabled) return;
    this.emit(pos.x, pos.y + 0.2, pos.z, Particles.smoke, 1.5, 1.2);
  }

  spawnDust(pos: THREE.Vector3): void {
    if (!this.enabled) return;
    this.emit(pos.x, pos.y + 0.2, pos.z, Particles.dust, 2, 0.8);
  }

  spawnSparks(pos: THREE.Vector3, count: number): void {
    if (!this.enabled) return;
    for (let n = 0; n < count; n++) {
      this.emit(pos.x, pos.y + 0.5, pos.z, Particles.spark, 4, 2);
    }
  }

  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      changed = true;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = HIDDEN_Y;
        continue;
      }
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      this.velocities[i * 3 + 1] -= 3 * dt; // light gravity
    }
    if (changed) {
      (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
