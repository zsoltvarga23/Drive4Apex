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
let formulaWheelGeo: THREE.CylinderGeometry | null = null;
let wheelMat: THREE.MeshLambertMaterial | null = null;
let glassMat: THREE.MeshPhongMaterial | null = null;
let shadowGeo: THREE.CircleGeometry | null = null;
let shadowMat: THREE.MeshBasicMaterial | null = null;

function shared() {
  if (!wheelGeo) {
    wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    // Fat exposed racing slicks for the open-wheel formula body.
    formulaWheelGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.4, 12);
    formulaWheelGeo.rotateZ(Math.PI / 2);
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
  return {
    wheelGeo: wheelGeo!,
    formulaWheelGeo: formulaWheelGeo!,
    wheelMat: wheelMat!,
    glassMat: glassMat!,
    shadowGeo: shadowGeo!,
    shadowMat: shadowMat!,
  };
}

/** Per-body-type proportions: [length, width, bodyHeight, cabinLength, cabinHeight, cabinZ, spoiler]. */
const BODY_SHAPES: Record<CarBody, { len: number; wid: number; h: number; cabLen: number; cabH: number; cabZ: number; spoiler: boolean }> = {
  sport:   { len: 4.3, wid: 1.9, h: 0.52, cabLen: 1.9, cabH: 0.42, cabZ: -0.2, spoiler: true },
  super:   { len: 4.5, wid: 2.0, h: 0.46, cabLen: 1.7, cabH: 0.38, cabZ: -0.3, spoiler: true },
  muscle:  { len: 4.7, wid: 1.95, h: 0.6, cabLen: 1.8, cabH: 0.46, cabZ: -0.5, spoiler: false },
  compact: { len: 3.6, wid: 1.75, h: 0.58, cabLen: 1.9, cabH: 0.5, cabZ: 0.0, spoiler: false },
  classic: { len: 4.4, wid: 1.85, h: 0.62, cabLen: 2.0, cabH: 0.48, cabZ: -0.1, spoiler: false },
  // Placeholder for type completeness; the formula body has its own builder.
  formula: { len: 4.6, wid: 1.9, h: 0.4, cabLen: 0.9, cabH: 0.3, cabZ: 0, spoiler: false },
};

/**
 * Builds a low-poly arcade car (~300 triangles) from primitives.
 * The car faces +Z; the group origin sits at ground level.
 */
export function buildCarModel(spec: CarSpec, colorHex: string): CarModelParts {
  if (spec.body === 'formula') return buildFormulaModel(colorHex);
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

/**
 * Original open-wheel formula car (~450 triangles): exposed slick tires,
 * front/rear wings with endplates, sidepods, shark-fin engine cover and a
 * halo over the cockpit. Inspired by modern single-seaters without copying
 * any real team's machine. Faces +Z; origin at ground level.
 */
function buildFormulaModel(colorHex: string): CarModelParts {
  const s = shared();
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshPhongMaterial({
    color: new THREE.Color(colorHex),
    shininess: 110,
    specular: 0x777777,
  });
  const carbon = s.wheelMat; // dark structural parts read as carbon fiber

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    group.add(mesh);
  };

  // Monocoque, nose cone and sidepods
  add(new THREE.BoxGeometry(0.78, 0.42, 2.6), bodyMaterial, 0, 0.45, -0.1);
  add(new THREE.BoxGeometry(0.4, 0.24, 1.4), bodyMaterial, 0, 0.42, 1.5, 0.05);
  add(new THREE.BoxGeometry(0.42, 0.34, 1.5), bodyMaterial, 0.58, 0.46, -0.45);
  add(new THREE.BoxGeometry(0.42, 0.34, 1.5), bodyMaterial, -0.58, 0.46, -0.45);
  add(new THREE.BoxGeometry(0.12, 0.34, 1.1), bodyMaterial, 0, 0.83, -0.85); // shark fin

  // Front wing + endplates
  add(new THREE.BoxGeometry(1.85, 0.06, 0.55), bodyMaterial, 0, 0.2, 2.15);
  add(new THREE.BoxGeometry(0.06, 0.14, 0.55), carbon, 0.92, 0.26, 2.15);
  add(new THREE.BoxGeometry(0.06, 0.14, 0.55), carbon, -0.92, 0.26, 2.15);

  // Cockpit opening + halo protection
  add(new THREE.BoxGeometry(0.5, 0.16, 0.85), s.glassMat, 0, 0.7, 0.1);
  add(new THREE.TorusGeometry(0.33, 0.045, 6, 10, Math.PI), carbon, 0, 0.72, 0.18);
  add(new THREE.BoxGeometry(0.06, 0.3, 0.06), carbon, 0, 0.82, 0.48);

  // Rear wing on a central pylon
  add(new THREE.BoxGeometry(1.5, 0.07, 0.45), bodyMaterial, 0, 1.02, -2.0);
  add(new THREE.BoxGeometry(0.06, 0.34, 0.5), carbon, 0.75, 0.88, -2.0);
  add(new THREE.BoxGeometry(0.06, 0.34, 0.5), carbon, -0.75, 0.88, -2.0);
  add(new THREE.BoxGeometry(0.09, 0.5, 0.12), carbon, 0, 0.75, -2.05);

  // FIA-style rear rain light doubles as the brake light.
  const brakeMaterial = new THREE.MeshBasicMaterial({ color: 0x550e0e });
  add(new THREE.BoxGeometry(0.12, 0.18, 0.06), brakeMaterial, 0, 0.6, -2.24);

  // Exposed slicks — fronts in steering pivots, like the road cars.
  const wheels: THREE.Mesh[] = [];
  const frontPivots: THREE.Object3D[] = [];
  for (const [x, z, front] of [
    [0.84, 1.45, true], [-0.84, 1.45, true], [0.84, -1.5, false], [-0.84, -1.5, false],
  ] as [number, number, boolean][]) {
    const wheel = new THREE.Mesh(s.formulaWheelGeo, s.wheelMat);
    wheels.push(wheel);
    if (front) {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, 0.43, z);
      pivot.add(wheel);
      group.add(pivot);
      frontPivots.push(pivot);
    } else {
      wheel.position.set(x, 0.43, z);
      group.add(wheel);
    }
  }

  const blob = new THREE.Mesh(s.shadowGeo, s.shadowMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.04;
  blob.scale.set(0.85, 1.55, 1);
  group.add(blob);

  return { group, wheels, frontPivots, bodyMaterial, brakeMaterial };
}
