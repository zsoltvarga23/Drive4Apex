import * as THREE from 'three';
import type { TrackDef } from '../config/tracks';
import { clamp, mod } from '../utils/math';

export interface TrackSample {
  pos: THREE.Vector3;
  /** Normalized direction of travel (includes slope). */
  tangent: THREE.Vector3;
  /** Horizontal unit vector pointing to the left of travel. */
  left: THREE.Vector3;
  /** Signed curvature (1/m); positive = left turn. */
  curvature: number;
  /** Distance from the start line along the track. */
  dist: number;
}

export interface Projection {
  index: number;
  dist: number;
  lateral: number;
}

const SAMPLE_COUNT = 512;

/**
 * A race track built procedurally from a closed Catmull-Rom spline.
 * Provides dense samples for physics/AI and builds all visual meshes.
 * Build is split into stages (road / barriers / scenery / environment)
 * so the loading screen can show real progress.
 */
export class Track {
  readonly def: TrackDef;
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly halfWidth: number;
  readonly group = new THREE.Group();
  /** 2D outline for the minimap and menu previews. */
  readonly outline: { x: number; z: number }[] = [];

  /** Density multiplier for props, from graphics quality. */
  private propScale: number;

  constructor(def: TrackDef, quality: number) {
    this.def = def;
    this.halfWidth = def.halfWidth;
    this.propScale = [0.5, 1, 1.3][quality] ?? 1;

    const pts = def.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

    // Arc-length parameterized samples.
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      positions.push(curve.getPointAt(i / SAMPLE_COUNT));
    }

    let dist = 0;
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const prev = positions[mod(i - 1, SAMPLE_COUNT)];
      const next = positions[mod(i + 1, SAMPLE_COUNT)];
      const tangent = next.clone().sub(prev).normalize();
      const left = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      if (i > 0) dist += positions[i].distanceTo(positions[i - 1]);
      this.samples.push({ pos: positions[i], tangent, left, curvature: 0, dist });
      this.outline.push({ x: positions[i].x, z: positions[i].z });
    }
    this.length = dist + positions[SAMPLE_COUNT - 1].distanceTo(positions[0]);

    // Signed curvature from tangent rotation between neighbors.
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const t0 = this.samples[mod(i - 1, SAMPLE_COUNT)].tangent;
      const t1 = this.samples[mod(i + 1, SAMPLE_COUNT)].tangent;
      const crossY = t0.z * t1.x - t0.x * t1.z; // positive = left turn
      const ds =
        this.samples[mod(i + 1, SAMPLE_COUNT)].pos.distanceTo(this.samples[mod(i - 1, SAMPLE_COUNT)].pos) || 1;
      this.samples[i].curvature = Math.asin(clamp(crossY, -1, 1)) / ds;
    }
  }

  // ------------------------------------------------------------- Queries

  /** Sample nearest to a distance along the track (wraps). */
  sampleAt(dist: number): TrackSample {
    const idx = mod(Math.round((mod(dist, this.length) / this.length) * SAMPLE_COUNT), SAMPLE_COUNT);
    return this.samples[idx];
  }

  /** Average signed curvature over [dist, dist+span]. Used by AI for the racing line. */
  curvatureAhead(dist: number, span: number): number {
    const steps = 6;
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      sum += this.sampleAt(dist + (span * i) / steps).curvature;
    }
    return sum / steps;
  }

  /**
   * Project a world position onto the track centerline.
   * `hint` is the last known sample index (-1 forces a full scan).
   */
  project(pos: THREE.Vector3, hint: number): Projection {
    let best = 0;
    let bestSq = Infinity;
    const scan = (from: number, to: number) => {
      for (let k = from; k < to; k++) {
        const i = mod(k, SAMPLE_COUNT);
        const s = this.samples[i];
        const dx = pos.x - s.pos.x;
        const dz = pos.z - s.pos.z;
        const d = dx * dx + dz * dz;
        if (d < bestSq) {
          bestSq = d;
          best = i;
        }
      }
    };
    if (hint < 0) scan(0, SAMPLE_COUNT);
    else scan(hint - 10, hint + 18);

    const s = this.samples[best];
    const dx = pos.x - s.pos.x;
    const dz = pos.z - s.pos.z;
    const lateral = dx * s.left.x + dz * s.left.z;
    const along = dx * s.tangent.x + dz * s.tangent.z;
    return { index: best, dist: mod(s.dist + along, this.length), lateral };
  }

  // ------------------------------------------------------- Build stages

  /** Stage 1: asphalt ribbon + start gate. */
  buildRoad(): void {
    const hw = this.halfWidth;
    const n = SAMPLE_COUNT;
    const positions = new Float32Array((n + 1) * 2 * 3);
    const uvs = new Float32Array((n + 1) * 2 * 2);
    const indices: number[] = [];

    for (let i = 0; i <= n; i++) {
      const s = this.samples[mod(i, n)];
      const yLift = 0.05;
      const lx = s.pos.x + s.left.x * hw;
      const lz = s.pos.z + s.left.z * hw;
      const rx = s.pos.x - s.left.x * hw;
      const rz = s.pos.z - s.left.z * hw;
      positions.set([lx, s.pos.y + yLift, lz, rx, s.pos.y + yLift, rz], i * 6);
      const v = (i === n ? this.length : s.dist) / 10;
      uvs.set([0, v, 1, v], i * 4);
      if (i < n) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ map: makeRoadTexture() });
    const road = new THREE.Mesh(geo, mat);
    road.name = 'road';
    this.group.add(road);

    // Shoulder ribbon (dirt strip between road edge and barrier).
    this.group.add(this.buildSideRibbon(hw, hw + 2.2, 0.02, new THREE.Color(this.def.theme.ground).multiplyScalar(0.85)));

    // Embankment skirts for elevated tracks so the road never floats.
    if (this.def.elevated) {
      this.group.add(this.buildSkirt(hw + 2.2));
      this.group.add(this.buildSkirt(-(hw + 2.2)));
    }

    this.buildStartGate();
  }

  /** Flat ribbon between two lateral offsets following the track. */
  private buildSideRibbon(innerOff: number, outerOff: number, yLift: number, color: THREE.Color): THREE.Mesh {
    const n = SAMPLE_COUNT;
    const positions = new Float32Array((n + 1) * 4 * 3);
    const indices: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = this.samples[mod(i, n)];
      const y = s.pos.y + yLift;
      positions.set(
        [
          s.pos.x + s.left.x * outerOff, y, s.pos.z + s.left.z * outerOff,
          s.pos.x + s.left.x * innerOff, y, s.pos.z + s.left.z * innerOff,
          s.pos.x - s.left.x * innerOff, y, s.pos.z - s.left.z * innerOff,
          s.pos.x - s.left.x * outerOff, y, s.pos.z - s.left.z * outerOff,
        ],
        i * 12,
      );
      if (i < n) {
        const a = i * 4;
        indices.push(a, a + 1, a + 4, a + 1, a + 5, a + 4); // left strip
        indices.push(a + 2, a + 3, a + 6, a + 3, a + 7, a + 6); // right strip
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  }

  /** Vertical wall from the road edge down to the ground (mountain embankments). */
  private buildSkirt(offset: number): THREE.Mesh {
    const n = SAMPLE_COUNT;
    const positions = new Float32Array((n + 1) * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = this.samples[mod(i, n)];
      const x = s.pos.x + s.left.x * offset;
      const z = s.pos.z + s.left.z * offset;
      positions.set([x, s.pos.y + 0.02, z, x, -0.4, z], i * 6);
      if (i < n) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // both windings (visible from either side)
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x55483a }));
  }

  private buildStartGate(): void {
    const s = this.samples[0];
    const hw = this.halfWidth;
    const postGeo = new THREE.BoxGeometry(0.4, 6, 0.4);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
    const gate = new THREE.Group();
    for (const side of [1, -1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(
        s.pos.x + s.left.x * (hw + 1.2) * side,
        s.pos.y + 3,
        s.pos.z + s.left.z * (hw + 1.2) * side,
      );
      gate.add(post);
    }
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry((hw + 1.2) * 2, 1.1, 0.15),
      new THREE.MeshBasicMaterial({ map: makeCheckerTexture() }),
    );
    banner.position.set(s.pos.x, s.pos.y + 5.4, s.pos.z);
    banner.rotation.y = Math.atan2(s.left.x, s.left.z) + Math.PI / 2;
    gate.add(banner);

    // Checkered start line painted on the road.
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, 2.4),
      new THREE.MeshBasicMaterial({ map: makeCheckerTexture() }),
    );
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(s.tangent.x, s.tangent.z);
    line.position.set(s.pos.x, s.pos.y + 0.07, s.pos.z);
    gate.add(line);
    this.group.add(gate);
  }

  /** Stage 2: striped safety barriers along both sides. */
  buildBarriers(): void {
    const offset = this.halfWidth + 1.8;
    const tex = makeBarrierTexture(this.def.theme.barrier);
    for (const side of [1, -1]) {
      const n = SAMPLE_COUNT;
      const positions = new Float32Array((n + 1) * 2 * 3);
      const uvs = new Float32Array((n + 1) * 2 * 2);
      const indices: number[] = [];
      for (let i = 0; i <= n; i++) {
        const s = this.samples[mod(i, n)];
        const x = s.pos.x + s.left.x * offset * side;
        const z = s.pos.z + s.left.z * offset * side;
        positions.set([x, s.pos.y, z, x, s.pos.y + 0.9, z], i * 6);
        const u = (i === n ? this.length : s.dist) / 4;
        uvs.set([u, 0, u, 1], i * 4);
        if (i < n) {
          const a = i * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const wall = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
      this.group.add(wall);
    }
  }

  /** Stage 3: instanced trees/cacti/rocks scattered around the track. */
  buildScenery(): void {
    const theme = this.def.theme;
    const treeCount = Math.round(110 * this.propScale);
    const rockCount = Math.round(50 * this.propScale);

    const trunkMatrices: THREE.Matrix4[] = [];
    const topMatrices: THREE.Matrix4[] = [];
    const rockMatrices: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const p = new THREE.Vector3();

    const place = (out: THREE.Matrix4[], minOff: number, maxOff: number, baseScale: number, scaleVar: number) => {
      const s = this.samples[Math.floor(Math.random() * SAMPLE_COUNT)];
      const side = Math.random() < 0.5 ? 1 : -1;
      const off = (this.halfWidth + minOff + Math.random() * (maxOff - minOff)) * side;
      p.copy(s.pos).addScaledVector(s.left, off);
      // Keep props near road height close-in; drop to ground level further out.
      const distFromRoad = Math.abs(off) - this.halfWidth;
      p.y = this.def.elevated ? Math.max(0, s.pos.y - distFromRoad * 0.35) : 0;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
      const sc = baseScale + Math.random() * scaleVar;
      scl.set(sc, sc, sc);
      m.compose(p, q, scl);
      out.push(m.clone());
    };

    for (let i = 0; i < treeCount; i++) place(trunkMatrices, 5, 45, 0.8, 0.7);
    topMatrices.push(...trunkMatrices); // tops share transforms with trunks
    for (let i = 0; i < rockCount; i++) place(rockMatrices, 4, 60, 0.5, 1.2);

    // Theme-specific tree shapes built from two instanced primitives.
    let trunkGeo: THREE.BufferGeometry;
    let topGeo: THREE.BufferGeometry;
    let trunkColor: number;
    let topColor: number;
    if (theme.props === 'palms') {
      trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 5, 6);
      trunkGeo.translate(0, 2.5, 0);
      topGeo = new THREE.ConeGeometry(2.2, 1.4, 7);
      topGeo.translate(0, 5.2, 0);
      trunkColor = 0x9a7148;
      topColor = 0x2f9e44;
    } else if (theme.props === 'cacti') {
      trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 3.2, 7);
      trunkGeo.translate(0, 1.6, 0);
      topGeo = new THREE.SphereGeometry(0.42, 7, 5);
      topGeo.translate(0, 3.3, 0);
      trunkColor = 0x3f8f3f;
      topColor = 0x4fa84f;
    } else {
      trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 6);
      trunkGeo.translate(0, 1, 0);
      topGeo = new THREE.ConeGeometry(1.6, 4.5, 7);
      topGeo.translate(0, 4, 0);
      trunkColor = 0x6b4a2f;
      topColor = 0x1e5e3a;
    }

    this.group.add(makeInstanced(trunkGeo, trunkColor, trunkMatrices));
    this.group.add(makeInstanced(topGeo, topColor, topMatrices));

    const rockGeo = new THREE.DodecahedronGeometry(1.2, 0);
    rockGeo.translate(0, 0.6, 0);
    this.group.add(makeInstanced(rockGeo, 0x8a8578, rockMatrices));
  }

  /** Stage 4: ground, ocean, distant backdrop. */
  buildEnvironment(): void {
    const theme = this.def.theme;

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1100, 40),
      new THREE.MeshLambertMaterial({ color: theme.ground }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    this.group.add(ground);

    if (theme.ocean) {
      const ocean = new THREE.Mesh(
        new THREE.PlaneGeometry(6000, 6000),
        new THREE.MeshLambertMaterial({ color: 0x1577b8 }),
      );
      ocean.rotation.x = -Math.PI / 2;
      ocean.position.y = -2;
      this.group.add(ocean);
      // Shrink the island so the water is visible from the track.
      ground.geometry.dispose();
      ground.geometry = new THREE.CircleGeometry(420, 40);
    }

    // Distant low-poly horizon shapes (mesas, peaks, islands).
    const backdropMat = new THREE.MeshLambertMaterial({ color: theme.backdrop });
    const matrices: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const r = 750 + Math.random() * 250;
      const h = 80 + Math.random() * 160;
      const w = 100 + Math.random() * 140;
      m.makeScale(w, h, w);
      m.setPosition(Math.cos(angle) * r, theme.ocean ? -2 : -0.5, Math.sin(angle) * r);
      matrices.push(m.clone());
    }
    const peakGeo = new THREE.ConeGeometry(1, 1, 6);
    peakGeo.translate(0, 0.5, 0);
    const peaks = new THREE.InstancedMesh(peakGeo, backdropMat, matrices.length);
    matrices.forEach((mat, i) => peaks.setMatrixAt(i, mat));
    peaks.instanceMatrix.needsUpdate = true;
    this.group.add(peaks);
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          const m = mat as THREE.MeshLambertMaterial;
          m.map?.dispose();
          mat.dispose();
        }
      }
    });
  }
}

// -------------------------------------------------------------- Helpers

function makeInstanced(geo: THREE.BufferGeometry, color: number, matrices: THREE.Matrix4[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Canvas-generated asphalt with edge lines and center dashes — no texture downloads. */
function makeRoadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(0, 0, 256, 256);
  // Speckle noise for asphalt grain.
  for (let i = 0; i < 900; i++) {
    const v = 50 + Math.random() * 30;
    ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // Edge lines
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(6, 0, 6, 256);
  ctx.fillRect(244, 0, 6, 256);
  // Center dashes
  ctx.fillStyle = '#d9b13b';
  ctx.fillRect(125, 10, 6, 80);
  ctx.fillRect(125, 138, 6, 80);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeBarrierTexture(accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = accent;
  for (let x = 0; x < 128; x += 32) ctx.fillRect(x, 0, 16, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCheckerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#111' : '#fff';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
