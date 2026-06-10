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
    // Bridge spans get open air + pylons instead of a solid embankment.
    const bridges = this.def.features?.bridges ?? [];
    const onBridge = (i: number) => bridges.some(([a, b]) => i / n >= a && i / n <= b);
    const positions = new Float32Array((n + 1) * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = this.samples[mod(i, n)];
      const x = s.pos.x + s.left.x * offset;
      const z = s.pos.z + s.left.z * offset;
      positions.set([x, s.pos.y + 0.02, z, x, -0.4, z], i * 6);
      if (i < n && !onBridge(i)) {
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

    // Canyon spires hug the road to form a corridor; other props spread wide.
    const near = theme.props === 'boulders';
    for (let i = 0; i < treeCount; i++) {
      place(trunkMatrices, near ? 3 : 5, near ? 30 : 45, near ? 1.1 : 0.8, near ? 1.3 : 0.7);
    }
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
    } else if (theme.props === 'parkland') {
      // Round broadleaf trees for the GP venue infield.
      trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6);
      trunkGeo.translate(0, 1.2, 0);
      topGeo = new THREE.SphereGeometry(1.7, 8, 6);
      topGeo.translate(0, 3.3, 0);
      trunkColor = 0x7a5a3a;
      topColor = 0x4d8f43;
    } else if (theme.props === 'boulders') {
      // Sandstone spires + boulders forming a canyon corridor.
      trunkGeo = new THREE.ConeGeometry(2.8, 9, 5);
      trunkGeo.translate(0, 4.5, 0);
      topGeo = new THREE.DodecahedronGeometry(1.7, 0);
      topGeo.translate(0, 1, 0);
      trunkColor = 0xa3592f;
      topColor = 0xb56a3c;
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

  /** Stage 5: signature landmarks — curbs, tunnels, bridges, grandstands. */
  buildLandmarks(): void {
    const f = this.def.features;
    if (!f) return;
    if (f.curbs) this.buildCurbs();
    for (const [a, b] of f.tunnels ?? []) this.buildTunnel(a, b);
    for (const [a, b] of f.bridges ?? []) this.buildBridge(a, b);
    for (const at of f.grandstands ?? []) this.buildGrandstand(at);
  }

  /** Convert a [fraction, fraction] lap range to sample indices. */
  private fracRange(a: number, b: number): [number, number] {
    return [Math.floor(a * SAMPLE_COUNT), Math.ceil(b * SAMPLE_COUNT)];
  }

  /**
   * Generic quad strip between two rails over a sample index range.
   * railA/railB map a sample to a world-space [x, y, z].
   */
  private rangeStrip(
    i0: number,
    i1: number,
    railA: (s: TrackSample) => [number, number, number],
    railB: (s: TrackSample) => [number, number, number],
    material: THREE.Material,
    doubleSided = false,
  ): THREE.Mesh {
    const count = i1 - i0 + 1;
    const positions = new Float32Array(count * 2 * 3);
    const uvs = new Float32Array(count * 2 * 2);
    const indices: number[] = [];
    for (let k = 0; k < count; k++) {
      const s = this.samples[mod(i0 + k, SAMPLE_COUNT)];
      const a = railA(s);
      const b = railB(s);
      positions.set([a[0], a[1], a[2], b[0], b[1], b[2]], k * 6);
      const v = s.dist / 4;
      uvs.set([0, v, 1, v], k * 4);
      if (k < count - 1) {
        const q = k * 2;
        indices.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
        if (doubleSided) indices.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
  }

  /** Red/white rumble strips along every corner edge (GP signature). */
  private buildCurbs(): void {
    const hw = this.halfWidth;
    const mat = new THREE.MeshLambertMaterial({ map: makeCurbTexture() });
    const minCurv = 0.008;

    // Find runs of consecutive corner samples, pad slightly, build strips.
    const spans: [number, number][] = [];
    let runStart = -1;
    for (let i = 0; i <= SAMPLE_COUNT; i++) {
      const corner = i < SAMPLE_COUNT && Math.abs(this.samples[i].curvature) > minCurv;
      if (corner && runStart < 0) runStart = i;
      if (!corner && runStart >= 0) {
        if (i - runStart > 4) {
          spans.push([Math.max(0, runStart - 3), Math.min(SAMPLE_COUNT - 1, i + 2)]);
        }
        runStart = -1;
      }
    }

    for (const [a, b] of spans) {
      for (const side of [1, -1]) {
        this.group.add(
          this.rangeStrip(
            a, b,
            (s) => [s.pos.x + s.left.x * hw * side, s.pos.y + 0.08, s.pos.z + s.left.z * hw * side],
            (s) => [s.pos.x + s.left.x * (hw + 1.3) * side, s.pos.y + 0.03, s.pos.z + s.left.z * (hw + 1.3) * side],
            mat,
          ),
        );
      }
    }
  }

  /** Enclosed tunnel: side walls, roof, ceiling lights and portal frames. */
  private buildTunnel(fa: number, fb: number): void {
    const [i0, i1] = this.fracRange(fa, fb);
    const wallOff = this.halfWidth + 2.0;
    const height = 5.5;
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x4a4642 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x38352f });

    for (const side of [1, -1]) {
      this.group.add(
        this.rangeStrip(
          i0, i1,
          (s) => [s.pos.x + s.left.x * wallOff * side, s.pos.y, s.pos.z + s.left.z * wallOff * side],
          (s) => [s.pos.x + s.left.x * wallOff * side, s.pos.y + height, s.pos.z + s.left.z * wallOff * side],
          wallMat, true,
        ),
      );
    }
    this.group.add(
      this.rangeStrip(
        i0, i1,
        (s) => [s.pos.x + s.left.x * wallOff, s.pos.y + height, s.pos.z + s.left.z * wallOff],
        (s) => [s.pos.x - s.left.x * wallOff, s.pos.y + height, s.pos.z - s.left.z * wallOff],
        roofMat, true,
      ),
    );

    // Warm ceiling light strips so the tunnel reads at speed.
    const lightGeo = new THREE.BoxGeometry(1.6, 0.12, 0.5);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    for (let i = i0 + 2; i < i1; i += 5) {
      const s = this.samples[mod(i, SAMPLE_COUNT)];
      const lamp = new THREE.Mesh(lightGeo, lightMat);
      lamp.position.set(s.pos.x, s.pos.y + height - 0.25, s.pos.z);
      lamp.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);
      this.group.add(lamp);
    }

    // Portal frames at both ends.
    const portalMat = new THREE.MeshLambertMaterial({ color: 0x5d5046 });
    const pillarGeo = new THREE.BoxGeometry(1.4, height + 1.6, 1.4);
    for (const i of [i0, i1]) {
      const s = this.samples[mod(i, SAMPLE_COUNT)];
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(wallOff * 2 + 2.6, 1.6, 1.4), portalMat);
      lintel.position.set(s.pos.x, s.pos.y + height + 0.7, s.pos.z);
      lintel.rotation.y = Math.atan2(s.left.x, s.left.z) + Math.PI / 2;
      this.group.add(lintel);
      for (const side of [1, -1]) {
        const pillar = new THREE.Mesh(pillarGeo, portalMat);
        pillar.position.set(
          s.pos.x + s.left.x * (wallOff + 0.5) * side,
          s.pos.y + (height + 1.6) / 2,
          s.pos.z + s.left.z * (wallOff + 0.5) * side,
        );
        this.group.add(pillar);
      }
    }
  }

  /** Bridge: railings, a deck-thickness band and support pylons to the ground. */
  private buildBridge(fa: number, fb: number): void {
    const [i0, i1] = this.fracRange(fa, fb);
    const hw = this.halfWidth;
    const edge = hw + 2.0;
    const railMat = new THREE.MeshLambertMaterial({ color: 0x9aa3ad });
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x6e6259 });

    for (const side of [1, -1]) {
      this.group.add(
        this.rangeStrip(
          i0, i1,
          (s) => [s.pos.x + s.left.x * edge * side, s.pos.y + 0.02, s.pos.z + s.left.z * edge * side],
          (s) => [s.pos.x + s.left.x * edge * side, s.pos.y + 1.3, s.pos.z + s.left.z * edge * side],
          railMat, true,
        ),
      );
      this.group.add(
        this.rangeStrip(
          i0, i1,
          (s) => [s.pos.x + s.left.x * edge * side, s.pos.y, s.pos.z + s.left.z * edge * side],
          (s) => [s.pos.x + s.left.x * edge * side, s.pos.y - 1.7, s.pos.z + s.left.z * edge * side],
          deckMat, true,
        ),
      );
    }

    // Support pylons from the deck down to the gorge floor.
    const matrices: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    for (let i = i0 + 4; i < i1 - 2; i += 9) {
      const s = this.samples[mod(i, SAMPLE_COUNT)];
      for (const side of [1, -1]) {
        const x = s.pos.x + s.left.x * hw * 0.55 * side;
        const z = s.pos.z + s.left.z * hw * 0.55 * side;
        const h = Math.max(1.5, s.pos.y + 0.5);
        m.makeScale(1.6, h, 1.6);
        m.setPosition(x, h / 2 - 0.5, z);
        matrices.push(m.clone());
      }
    }
    this.group.add(makeInstanced(new THREE.BoxGeometry(1, 1, 1), 0x7d7166, matrices));
  }

  /** Covered grandstand beside the track (GP paddock atmosphere). */
  private buildGrandstand(at: number): void {
    const s = this.samples[mod(Math.floor(at * SAMPLE_COUNT), SAMPLE_COUNT)];
    const off = this.halfWidth + 8;
    const g = new THREE.Group();
    const tier1 = new THREE.Mesh(
      new THREE.BoxGeometry(36, 3, 7),
      new THREE.MeshLambertMaterial({ color: 0x8c97a3 }),
    );
    tier1.position.set(0, 1.5, 0);
    const tier2 = new THREE.Mesh(
      new THREE.BoxGeometry(36, 3, 4.5),
      new THREE.MeshLambertMaterial({ color: 0x2f3a47 }),
    );
    tier2.position.set(0, 4, 1.4);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(38, 0.5, 9),
      new THREE.MeshLambertMaterial({ color: 0x00b8cc }),
    );
    roof.position.set(0, 6.8, 0.6);
    g.add(tier1, tier2, roof);

    // Long side parallel to the road, on the driver's left.
    g.position.set(s.pos.x + s.left.x * off, Math.max(0, s.pos.y - 0.5), s.pos.z + s.left.z * off);
    g.rotation.y = Math.atan2(s.tangent.x, s.tangent.z) + Math.PI / 2;
    this.group.add(g);
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

/** Red/white striped rumble-strip texture. */
function makeCurbTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, 16, 64);
  ctx.fillStyle = '#d32f2f';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillRect(0, 32, 16, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
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
