import type { Track } from '../tracks/Track';
import type { Vehicle } from '../vehicles/Vehicle';

const SIZE = 132;

/**
 * Lightweight 2D minimap: the track outline is rendered once to an
 * offscreen canvas; each frame only blits that image and draws car dots.
 */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private scale = 1;
  private offsetX = 0;
  private offsetZ = 0;
  private dpr: number;

  constructor(parent: HTMLElement, track: Track) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    this.canvas.width = SIZE * this.dpr;
    this.canvas.height = SIZE * this.dpr;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Fit the outline into the canvas with padding.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.outline) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const pad = 14 * this.dpr;
    const span = Math.max(maxX - minX, maxZ - minZ);
    this.scale = (SIZE * this.dpr - pad * 2) / span;
    this.offsetX = (minX + maxX) / 2;
    this.offsetZ = (minZ + maxZ) / 2;

    this.base = document.createElement('canvas');
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    const b = this.base.getContext('2d')!;
    b.strokeStyle = 'rgba(255,255,255,0.85)';
    b.lineWidth = 3.5 * this.dpr;
    b.lineJoin = 'round';
    b.beginPath();
    track.outline.forEach((p, i) => {
      const [x, y] = this.toCanvas(p.x, p.z);
      if (i === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    });
    b.closePath();
    b.stroke();
    // Start line marker
    const s = track.outline[0];
    const [sx, sy] = this.toCanvas(s.x, s.z);
    b.fillStyle = '#ffd166';
    b.fillRect(sx - 3 * this.dpr, sy - 3 * this.dpr, 6 * this.dpr, 6 * this.dpr);
  }

  private toCanvas(x: number, z: number): [number, number] {
    const half = (SIZE * this.dpr) / 2;
    return [half + (x - this.offsetX) * this.scale, half + (z - this.offsetZ) * this.scale];
  }

  update(vehicles: Vehicle[]): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    for (const v of vehicles) {
      const [x, y] = this.toCanvas(v.position.x, v.position.z);
      ctx.beginPath();
      ctx.arc(x, y, (v.isPlayer ? 4.5 : 3) * this.dpr, 0, Math.PI * 2);
      ctx.fillStyle = v.isPlayer ? '#00e5ff' : '#ff6b6b';
      ctx.fill();
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}
