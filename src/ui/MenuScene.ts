import * as THREE from 'three';
import type { CarSpec } from '../types';
import { buildCarModel, type CarModelParts } from '../vehicles/CarModel';

/**
 * The 3D showroom rendered behind the menus: the currently selected car
 * rotating on a lit platform. Rebuilds the car when selection/color changes.
 */
export class MenuScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private car: CarModelParts | null = null;
  private platform: THREE.Mesh;
  private angle = 0;

  constructor() {
    this.scene.background = new THREE.Color('#0b0e14');
    this.scene.fog = new THREE.Fog('#0b0e14', 14, 40);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 3.4, 10.5);
    this.camera.lookAt(0, 0.5, 0);

    const hemi = new THREE.HemisphereLight('#9fc4ff', '#283042', 1.6);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(4, 6, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#00e5ff', 1.2);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);

    this.platform = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.7, 0.25, 36),
      new THREE.MeshPhongMaterial({ color: '#1a2030', shininess: 60 }),
    );
    this.platform.position.y = -0.13;
    this.scene.add(this.platform);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(40, 24),
      new THREE.MeshLambertMaterial({ color: '#0e1320' }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.26;
    this.scene.add(floor);
  }

  /** Swap the displayed car (called when the player changes car or paint). */
  setCar(spec: CarSpec, colorHex: string): void {
    if (this.car) {
      this.scene.remove(this.car.group);
      // Geometry/materials are shared between cars; only the body paint is per-car.
      this.car.bodyMaterial.dispose();
    }
    this.car = buildCarModel(spec, colorHex);
    this.car.group.rotation.y = this.angle;
    this.scene.add(this.car.group);
  }

  update(dt: number): void {
    this.angle += dt * 0.45;
    if (this.car) this.car.group.rotation.y = this.angle;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
