import * as THREE from 'three';
import type { Quality, RaceConfig, SaveData } from '../types';
import { CARS, getCar } from '../config/cars';
import { persistSave } from '../utils/storage';
import { displayName, leaderboards, todayISO } from './Leaderboards';
import { AI_COLOR_POOL } from '../config/colors';
import { getTrack } from '../config/tracks';
import { generateRacerNames } from '../config/names';
import { Track } from '../tracks/Track';
import { Vehicle } from '../vehicles/Vehicle';
import { AIController } from './AIController';
import { RaceManager, type RaceEvents } from './RaceManager';
import { Particles } from './Particles';
import { Input } from './Input';
import { HUD } from '../ui/HUD';
import { Minimap } from '../ui/Minimap';
import type { AudioManager } from '../audio/AudioManager';
import { clamp, damp } from '../utils/math';

const AI_COUNT = 7;
const FOG_FAR: Record<Quality, number> = { 0: 350, 1: 600, 2: 900 };

/**
 * Everything that exists only while a race is running: the 3D scene,
 * the field of cars, AI drivers, chase camera, HUD/minimap and race rules.
 * Built in stages (see buildSteps) so the loading bar shows real progress.
 */
export class RaceSession {
  readonly config: RaceConfig;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly track: Track;
  readonly vehicles: Vehicle[] = [];
  player!: Vehicle;
  raceManager!: RaceManager;
  hud: HUD;

  /** While true (countdown), cars don't move but engines rev. */
  frozen = true;
  /** True when the player set a new all-time lap record this session. */
  newLapRecord = false;
  /** True when the whole grid is formula cars (player picked the AX-1). */
  isFormulaEvent = false;

  private ai: AIController[] = [];
  private particles: Particles;
  private minimap: Minimap | null = null;
  private hudParent: HTMLElement;
  private audio: AudioManager;
  private save: SaveData;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private wrongWayTime = 0;
  private particleAccum = 0;

  constructor(config: RaceConfig, quality: Quality, hudParent: HTMLElement, audio: AudioManager, save: SaveData) {
    this.config = config;
    this.audio = audio;
    this.save = save;
    this.hudParent = hudParent;
    this.hud = new HUD(hudParent);
    this.hud.hide();

    const def = getTrack(config.trackId);
    this.track = new Track(def, quality);

    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 2000);

    this.scene.background = new THREE.Color(def.theme.sky);
    this.scene.fog = new THREE.Fog(def.theme.fog, 60, FOG_FAR[quality]);

    const hemi = new THREE.HemisphereLight(def.theme.hemiSky, def.theme.hemiGround, 1.4);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff5e0', def.theme.sunIntensity);
    sun.position.set(120, 180, 80);
    this.scene.add(sun);

    this.particles = new Particles();
    this.particles.enabled = quality > 0;
    this.scene.add(this.particles.points);
  }

  /** Build stages executed one-per-frame by the loading screen. */
  buildSteps(): { label: string; run: () => void }[] {
    return [
      { label: 'Laying asphalt…', run: () => this.track.buildRoad() },
      { label: 'Bolting barriers…', run: () => this.track.buildBarriers() },
      { label: 'Planting scenery…', run: () => this.track.buildScenery() },
      { label: 'Raising landmarks…', run: () => this.track.buildLandmarks() },
      { label: 'Painting horizon…', run: () => this.track.buildEnvironment() },
      { label: 'Fueling the grid…', run: () => this.spawnField() },
      { label: 'Final checks…', run: () => this.finishSetup() },
    ];
  }

  private spawnField(): void {
    this.scene.add(this.track.group);
    const cfg = this.config;

    // Player starts at the back of the grid — earn that podium.
    const playerSpec = getCar(cfg.carId);
    this.player = new Vehicle(playerSpec, cfg.colorHex, true, displayName(this.save));

    // Time trial: an empty track, just the player versus the clock.
    const aiCount = cfg.mode === 'timetrial' ? 0 : AI_COUNT;
    // Formula races run a formula-only grid — a proper open-wheel series.
    this.isFormulaEvent = playerSpec.body === 'formula' && aiCount > 0;

    // AI opponents are race-local color: they never appear on leaderboards.
    const names = aiCount > 0 ? generateRacerNames(aiCount) : [];
    const formula = CARS.find((c) => c.body === 'formula');
    const aiVehicles: Vehicle[] = names.map((name, i) => {
      let spec: typeof playerSpec;
      if (this.isFormulaEvent && formula) {
        // No road cars in a formula event; liveries vary per driver.
        spec = formula;
      } else {
        // AI normally drive the free roster; on Medium/Hard the pole-sitter
        // occasionally shows up in a formula car to set the pace.
        const aiPool = CARS.filter((c) => !c.price);
        spec = aiPool[(i + 1) % aiPool.length];
        const formulaChance = { easy: 0, medium: 0.25, hard: 0.5 }[cfg.difficulty];
        if (i === 0 && formula && Math.random() < formulaChance) spec = formula;
      }
      const color = AI_COLOR_POOL[i % AI_COLOR_POOL.length];
      return new Vehicle(spec, color, false, name);
    });

    const grid = [...aiVehicles, this.player]; // index 0 = pole
    grid.forEach((v, i) => {
      const dist = this.track.length - 8 - i * 7;
      const lateral = (i % 2 === 0 ? 1 : -1) * 2.4;
      // Spawn just *behind* the line: lap counts from first crossing at GO.
      v.spawn(this.track, dist, lateral);
      v.lap = -1; // crossing the start line at GO brings everyone to lap 0
      this.scene.add(v.model.group);
    });

    this.vehicles.push(...grid);
    this.ai = aiVehicles.map((v, i) => new AIController(v, cfg.difficulty, i));
  }

  private finishSetup(): void {
    const save = this.save;
    const trackId = this.config.trackId;

    const events: RaceEvents = {
      onPlayerSector: (k, t) => {
        // Color the chip against the all-time personal-best sector.
        const pbs = save.sectorPBs[trackId] ?? [];
        const pb = pbs[k];
        let status: 'pb' | 'even' | 'slow' | 'none' = 'none';
        if (pb !== undefined) status = t < pb - 0.05 ? 'pb' : t <= pb + 0.15 ? 'even' : 'slow';
        this.hud.setSector(k, t, status);
        if (status === 'pb') this.hud.showMessage(`PB SECTOR ${k + 1}!`, 1100);

        // Record individual sector PBs (the "ideal lap").
        if (pb === undefined || t < pb) {
          const arr = save.sectorPBs[trackId] ?? (save.sectorPBs[trackId] = []);
          arr[k] = t;
          persistSave(save);
        }

        // Live delta vs. the sector breakdown of the personal-best lap.
        const ref = save.bestLapSectors[trackId];
        if (ref && ref.length === 3) {
          const cum = this.raceManager.currentSectors.reduce((a, b) => a + b, 0);
          const refCum = ref.slice(0, k + 1).reduce((a, b) => a + b, 0);
          this.hud.showDelta(cum - refCum);
        }
      },

      onPlayerLap: (lapNum, lapTime, sectors, isSessionBest) => {
        // Persistent lap records (laps exist in circuit and time trial).
        const prev = save.bestLaps[trackId];
        if (this.config.mode !== 'sprint' && (!prev || lapTime < prev)) {
          save.bestLaps[trackId] = lapTime;
          if (sectors.length === 3) save.bestLapSectors[trackId] = sectors;
          this.newLapRecord = true;
          persistSave(save);
          this.hud.showMessage('NEW BEST LAP!', 2200);
        } else {
          // After the final lap the finish banner takes over — no lap toast.
          if (lapNum <= this.raceManager.lapsTotal) {
            this.hud.showMessage(isSessionBest ? 'BEST LAP!' : `LAP ${lapNum}`);
          }
          // Legacy best laps predate sector tracking; seed the delta
          // reference from the best lap we *have* timed sector-by-sector.
          if (isSessionBest && sectors.length === 3 && !save.bestLapSectors[trackId]) {
            save.bestLapSectors[trackId] = sectors;
            persistSave(save);
          }
        }
        this.hud.setLapHistory(this.raceManager.sessionLaps);
        this.hud.resetSectorsSoon();

        // Post to the track-record board. Only laps with all three sectors
        // completed in order qualify (anti-cheat: restarts and reverse
        // line-crossings never reach this path with a full sector set).
        if (sectors.length === 3) {
          leaderboards.submitTime(
            trackId, 'lap',
            {
              pid: save.playerId,
              name: displayName(save),
              carId: this.config.carId,
              time: lapTime,
              date: todayISO(),
            },
            this.track.length / 70,
          );
        }
      },

      onPlayerFinish: () => {
        /* handled by Game via polling player.finished */
      },
    };
    this.raceManager = new RaceManager(
      this.track, this.vehicles, this.config.mode, this.config.laps, events,
    );
    this.hud.configureMode(this.config.mode);
    this.minimap = new Minimap(this.hudParent, this.track);
    this.snapCamera();
  }

  /** Put the camera straight behind the player (used at spawn / restart). */
  private snapCamera(): void {
    const p = this.player;
    const fwd = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    this.camPos.copy(p.position).addScaledVector(fwd, -8.5).add(new THREE.Vector3(0, 3.6, 0));
    this.camLook.copy(p.position).addScaledVector(fwd, 6);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  update(dt: number, input: Input, sensitivity: number): void {
    if (!this.frozen) {
      this.player.controls = input.getControls(dt, sensitivity);
      const playerProgress = this.player.totalProgress;
      for (const c of this.ai) c.update(dt, this.track, this.vehicles, playerProgress);
      for (const v of this.vehicles) v.update(dt, this.track);

      // Car-to-car contact.
      for (let i = 0; i < this.vehicles.length; i++) {
        for (let j = i + 1; j < this.vehicles.length; j++) {
          const rel = Vehicle.collide(this.vehicles[i], this.vehicles[j]);
          if (rel > 6 && (this.vehicles[i].isPlayer || this.vehicles[j].isPlayer)) {
            this.audio.collision(clamp(rel / 20, 0.2, 1));
          }
        }
      }

      this.raceManager.update(dt);
      this.updateEffects(dt);
      this.updateHud(dt);
    } else {
      // On the grid: let the player rev the engine.
      const c = input.getControls(dt, sensitivity);
      this.audio.setEngine(c.throttle * 0.5, c.throttle);
    }

    this.particles.update(dt);
    this.updateCamera(dt);
  }

  private updateEffects(dt: number): void {
    const p = this.player;
    const rpm = clamp(Math.abs(p.speed) / p.spec.topSpeed, 0, 1);
    this.audio.setEngine(rpm, p.controls.throttle);
    this.audio.setSkid(p.skidAmount);

    // Throttled particle emission (~30/s max) keeps fill-rate low.
    this.particleAccum += dt;
    if (this.particleAccum > 0.033) {
      this.particleAccum = 0;
      for (const v of this.vehicles) {
        if (v.skidAmount > 0.6) this.particles.spawnSmoke(v.position);
        else if (v.offRoad && Math.abs(v.speed) > 8) this.particles.spawnDust(v.position);
      }
    }
    if (p.wallHit > 0) {
      this.audio.collision(p.wallHit);
      this.particles.spawnSparks(p.position, 4);
    }
  }

  private updateHud(dt: number): void {
    const rm = this.raceManager;
    const p = this.player;
    if (rm.mode !== 'timetrial') this.hud.setPosition(rm.positionOf(p), this.vehicles.length);
    this.hud.setLap(rm.mode, Math.max(0, p.lap), rm.lapsTotal, p.trackDist / this.track.length);
    this.hud.setSpeed(p.speed);
    this.hud.setTimes(rm.raceTime, rm.playerBestLap);
    this.minimap?.update(this.vehicles);

    // Wrong-way: sustained driving against the track direction.
    const sample = this.track.samples[Math.max(0, p.trackIndexHint)];
    const dot = Math.sin(p.heading) * sample.tangent.x + Math.cos(p.heading) * sample.tangent.z;
    if (dot < -0.3 && p.speed > 3) this.wrongWayTime += dt;
    else this.wrongWayTime = 0;
    this.hud.setWrongWay(this.wrongWayTime > 0.8);
  }

  private updateCamera(dt: number): void {
    const p = this.player;
    const fwd = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    const speedT = clamp(Math.abs(p.speed) / p.spec.topSpeed, 0, 1);

    const targetPos = p.position.clone()
      .addScaledVector(fwd, -(8 + speedT * 2))
      .add(new THREE.Vector3(0, 3.4 + speedT * 0.6, 0));
    const targetLook = p.position.clone().addScaledVector(fwd, 6).add(new THREE.Vector3(0, 1.2, 0));

    const k = 1 - Math.exp(-5 * dt);
    this.camPos.lerp(targetPos, k);
    this.camLook.lerp(targetLook, k);

    // Never let the camera sink below the road on elevation changes.
    const ground = this.track.project(this.camPos, p.trackIndexHint);
    const groundY = this.track.samples[ground.index].pos.y;
    if (this.camPos.y < groundY + 1.6) this.camPos.y = groundY + 1.6;

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    // Subtle speed-FOV for a sense of velocity.
    this.camera.fov = damp(this.camera.fov, 70 + speedT * 12, 4, dt);
    this.camera.updateProjectionMatrix();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.hud.dispose();
    this.minimap?.dispose();
    this.particles.dispose();
    this.track.dispose();
    for (const v of this.vehicles) {
      v.model.bodyMaterial.dispose();
      v.model.brakeMaterial.dispose();
    }
    this.scene.clear();
  }
}
