import * as THREE from 'three';
import type { CarBody, CarSpec } from '../types';

/** Handles to the animatable parts of a built car model. */
export interface CarModelParts {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  /** Pivots for the two front wheels (rotated for visual steering). */
  frontPivots: THREE.Object3D[];
  bodyMaterial: THREE.MeshPhongMaterial;
  brakeMaterial: THREE.MeshBasicMaterial;
}

// Shared geometries/materials — created once, reused by every car instance.
let wheelGeo: THREE.CylinderGeometry | null = null;
let wheelMat: THREE.MeshLambertMaterial | null = null;
let glassMat: THREE.MeshPhongMaterial | null = null;
let shadowGeo: THREE.CircleGeometry | null = null;
let shadowMat: THREE.MeshBasicMaterial | null = null;

function shared() {
  if (!wheelGeo) {
    wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    wheelMat = new THREE.MeshLambertMaterial({ color: 0x1c1d20 });
    glassMat = new THREE.MeshPhongMaterial({ color: 0x10141c, shininess: 120, specular: 0x99bbdd });
    shadowGeo = new THREE.CircleGeometry(1.45, 16);
    shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
  }
  return { wheelGeo: wheelGeo!, wheelMat: wheelMat!, glassMat: glassMat!, shadowGeo: shadowGeo!, shadowMat: shadowMat! };
}

/** Per-body-type proportions: [length, width, bodyHeight, cabinLength, cabinHeight, cabinZ, spoiler]. */
const BODY_SHAPES: Record<CarBody, { len: number; wid: number; h: number; cabLen: number; cabH: number; cabZ: number; spoiler: boolean }> = {
  sport:   { len: 4.3, wid: 1.9, h: 0.52, cabLen: 1.9, cabH: 0.42, cabZ: -0.2, spoiler: true },
  super:   { len: 4.5, wid: 2.0, h: 0.46, cabLen: 1.7, cabH: 0.38, cabZ: -0.3, spoiler: true },
  muscle:  { len: 4.7, wid: 1.95, h: 0.6, cabLen: 1.8, cabH: 0.46, cabZ: -0.5, spoiler: false },
  compact: { len: 3.6, wid: 1.75, h: 0.58, cabLen: 1.9, cabH: 0.5, cabZ: 0.0, spoiler: false },
  classic: { len: 4.4, wid: 1.85, h: 0.62, cabLen: 2.0, cabH: 0.48, cabZ: -0.1, spoiler: false },
};

/**
 * Builds a low-poly arcade car (~300 triangles) from primitives.
 * The car faces +Z; the group origin sits at ground level.
 */
export function buildCarModel(spec: CarSpec, colorHex: string): CarModelParts {
  const s = shared();
  const shape = BODY_SHAPES[spec.body];
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshPhongMaterial({
    color: new THREE.Color(colorHex),
    shininess: 90,
    specular: 0x666666,
  });

  // Main body slab
  const body = new THREE.Mesh(new THREE.BoxGeometry(shape.wid, shape.h, shape.len), bodyMaterial);
  body.position.y = 0.34 + shape.h / 2;
  group.add(body);

  // Cabin / greenhouse
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(shape.wid * 0.78, shape.cabH, shape.cabLen),
    s.glassMat,
  );
  cabin.position.set(0, 0.34 + shape.h + shape.cabH / 2 - 0.04, shape.cabZ);
  group.add(cabin);

  // Nose wedge for a sleeker silhouette
  const nose = new THREE.Mesh(new THREE.BoxGeometry(shape.wid * 0.92, shape.h * 0.55, 0.7), bodyMaterial);
  nose.position.set(0, 0.34 + shape.h * 0.28, shape.len / 2 - 0.1);
  nose.rotation.x = 0.12;
  group.add(nose);

  if (shape.spoiler) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(shape.wid * 0.95, 0.07, 0.42), bodyMaterial);
    wing.position.set(0, 0.34 + shape.h + 0.32, -shape.len / 2 + 0.18);
    group.add(wing);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.12), s.wheelMat);
    strut.position.set(0, 0.34 + shape.h + 0.16, -shape.len / 2 + 0.18);
    group.add(strut);
  }

  // Wheels: front pair sits in pivots so they can visually steer.
  const wheels: THREE.Mesh[] = [];
  const frontPivots: THREE.Object3D[] = [];
  const wx = shape.wid / 2 - 0.08;
  const wzF = shape.len / 2 - 0.78;
  const wzR = -shape.len / 2 + 0.78;
  for (const [x, z, front] of [
    [wx, wzF, true], [-wx, wzF, true], [wx, wzR, false], [-wx, wzR, false],
  ] as [number, number, boolean][]) {
    const wheel = new THREE.Mesh(s.wheelGeo, s.wheelMat);
    wheels.push(wheel);
    if (front) {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, 0.34, z);
      pivot.add(wheel);
      group.add(pivot);
      frontPivots.push(pivot);
    } else {
      wheel.position.set(x, 0.34, z);
      group.add(wheel);
    }
  }

  // Headlights (emissive so they read at distance without real lights)
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  const headGeo = new THREE.BoxGeometry(0.3, 0.12, 0.06);
  for (const x of [shape.wid / 2 - 0.36, -shape.wid / 2 + 0.36]) {
    const hl = new THREE.Mesh(headGeo, lightMat);
    hl.position.set(x, 0.34 + shape.h * 0.6, shape.len / 2 + 0.02);
    group.add(hl);
  }

  // Brake lights — material color is brightened while braking.
  const brakeMaterial = new THREE.MeshBasicMaterial({ color: 0x550e0e });
  for (const x of [shape.wid / 2 - 0.36, -shape.wid / 2 + 0.36]) {
    const bl = new THREE.Mesh(headGeo, brakeMaterial);
    bl.position.set(x, 0.34 + shape.h * 0.6, -shape.len / 2 - 0.02);
    group.add(bl);
  }

  // Cheap blob shadow instead of expensive shadow maps.
  const blob = new THREE.Mesh(s.shadowGeo, s.shadowMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.04;
  blob.scale.set(shape.wid / 2.4, shape.len / 2.9, 1);
  group.add(blob);

  group.matrixAutoUpdate = true;
  return { group, wheels, frontPivots, bodyMaterial, brakeMaterial };
}
