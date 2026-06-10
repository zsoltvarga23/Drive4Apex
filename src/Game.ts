import * as THREE from 'three';
import type { Quality, RaceConfig, SaveData } from './types';
import { getCar } from './config/cars';
import { getColor } from './config/colors';
import { loadSave, persistSave, resetSave } from './utils/storage';
import { AudioManager } from './audio/AudioManager';
import { Input } from './systems/Input';
import { RaceSession } from './systems/RaceSession';
import { MenuScene } from './ui/MenuScene';
import { Menus, type GameAPI } from './ui/Menus';

type GameState = 'menu' | 'loading' | 'countdown' | 'racing' | 'paused' | 'finished' | 'results';

const PIXEL_RATIO: Record<Quality, number> = {
  0: 0.75,
  1: Math.min(devicePixelRatio || 1, 1.5),
  2: Math.min(devicePixelRatio || 1, 2),
};

/** Credits for finishing positions 1..8, before difficulty/length multipliers. */
const CREDIT_TABLE = [250, 180, 140, 110, 90, 75, 60, 50];

/**
 * Top-level orchestrator: owns the renderer, the save file, audio, input,
 * menu flow and the running race session. A small state machine drives
 * the per-frame update.
 */
export class Game implements GameAPI {
  save: SaveData;

  private renderer: THREE.WebGLRenderer;
  private state: GameState = 'menu';
  private audio: AudioManager;
  private input: Input;
  private menus: Menus;
  private menuScene: MenuScene;
  private session: RaceSession | null = null;
  private lastConfig: RaceConfig | null = null;
  private hudParent: HTMLElement;
  private touchEl: HTMLElement;

  private clock = new THREE.Clock();
  private buildQueue: { label: string; run: () => void }[] = [];
  private buildTotal = 0;
  private countdownTime = 0;
  private countdownStep = -1;
  private finishedTime = 0;

  constructor(root: HTMLElement) {
    this.save = loadSave();
    this.audio = new AudioManager(this.save.settings);
    this.input = new Input();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(PIXEL_RATIO[this.save.settings.quality]);
    this.renderer.domElement.id = 'game-canvas';
    root.appendChild(this.renderer.domElement);

    this.hudParent = document.createElement('div');
    this.hudParent.id = 'hud-root';
    root.appendChild(this.hudParent);

    this.touchEl = this.buildTouchControls(root);

    this.menuScene = new MenuScene();
    this.menus = new Menus(root, this);

    this.input.onPause = () => {
      if (this.state === 'racing' || this.state === 'countdown') this.pauseRace();
      else if (this.state === 'paused') this.resumeRace();
    };
    // Instant restart is a time-trial staple: R resets the session at once.
    this.input.onRestart = () => {
      if (this.session?.config.mode !== 'timetrial') return;
      if (this.state === 'racing' || this.state === 'paused' || this.state === 'countdown') {
        this.menus.hidePause();
        this.restartRace();
      }
    };
    this.input.onFirstInteraction = () => {
      this.audio.unlock();
      this.audio.startMusic();
    };

    addEventListener('resize', () => this.onResize());
    addEventListener('blur', () => {
      if (this.state === 'racing') this.pauseRace();
    });

    this.previewCar(this.save.carId, getColor(this.save.colorId).hex);
    this.menus.show('main');
    document.getElementById('boot-loader')?.remove();

    this.renderer.setAnimationLoop(() => this.tick());

    // Dev-only: debugging handle + steering-polarity regression check.
    // The dynamic import keeps the test module out of production builds.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__game = this;
      void import('./utils/steeringCheck').then((m) => m.runSteeringValidation());
    }
  }

  /** Dev helper: current race session (null outside races). */
  get currentSession(): RaceSession | null {
    return this.session;
  }

  // -------------------------------------------------------------- GameAPI

  persist(): void {
    persistSave(this.save);
  }

  uiClick(): void {
    this.audio.uiClick();
  }

  previewCar(carId: string, colorHex: string): void {
    this.menuScene.setCar(getCar(carId), colorHex);
  }

  applySettings(): void {
    const s = this.save.settings;
    this.renderer.setPixelRatio(PIXEL_RATIO[s.quality]);
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    this.updateTouchVisibility();
    this.persist();
  }

  resetProgress(): void {
    this.save = resetSave();
    this.applySettings();
    this.previewCar(this.save.carId, getColor(this.save.colorId).hex);
  }

  startRace(cfg: RaceConfig): void {
    this.disposeSession();
    this.menus.hide();
    this.menus.clearOverlays();
    this.lastConfig = cfg;

    this.session = new RaceSession(cfg, this.save.settings.quality, this.hudParent, this.audio, this.save);
    this.buildQueue = this.session.buildSteps();
    this.buildTotal = this.buildQueue.length;
    this.menus.showLoading(this.buildQueue[0].label, 0);
    this.state = 'loading';
  }

  restartRace(): void {
    if (this.lastConfig) this.startRace(this.lastConfig);
  }

  resumeRace(): void {
    if (this.state !== 'paused') return;
    this.menus.hidePause();
    this.state = this.countdownStep >= 4 ? 'racing' : 'countdown';
    this.clock.getDelta(); // swallow the time spent paused
  }

  quitToMenu(): void {
    this.disposeSession();
    this.menus.clearOverlays();
    this.menus.show('main');
    this.state = 'menu';
  }

  // ----------------------------------------------------------- Internals

  private pauseRace(): void {
    if (this.state !== 'racing' && this.state !== 'countdown') return;
    this.state = 'paused';
    this.audio.setEngine(0, 0);
    this.audio.setSkid(0);
    this.menus.showPause();
  }

  private disposeSession(): void {
    if (this.session) {
      this.audio.stopEngine();
      this.audio.setSkid(0);
      this.session.dispose();
      this.session = null;
    }
    this.updateTouchVisibility();
  }

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    switch (this.state) {
      case 'menu':
        this.menuScene.update(dt);
        this.renderer.render(this.menuScene.scene, this.menuScene.camera);
        break;

      case 'loading': {
        // One build stage per frame keeps the loading bar honest and the UI alive.
        const step = this.buildQueue.shift();
        if (step) {
          step.run();
          const done = this.buildTotal - this.buildQueue.length;
          this.menus.showLoading(
            this.buildQueue[0]?.label ?? 'Ready!',
            done / this.buildTotal,
          );
        } else {
          this.menus.hideLoading();
          this.beginCountdown();
        }
        break;
      }

      case 'countdown': {
        const s = this.session!;
        this.countdownTime += dt;
        const step = Math.floor(this.countdownTime);
        if (step !== this.countdownStep && step <= 3) {
          this.countdownStep = step;
          const label = ['3', '2', '1', 'GO!'][step];
          s.hud.showCountdown(label);
          this.audio.countdownBeep(step === 3);
          if (step === 3) {
            s.frozen = false;
            s.raceManager.start();
            this.countdownStep = 4;
            this.state = 'racing';
            setTimeout(() => s.hud.showCountdown(''), 700);
          }
        }
        s.update(dt, this.input, this.save.settings.steeringSensitivity);
        this.renderer.render(s.scene, s.camera);
        break;
      }

      case 'racing': {
        const s = this.session!;
        s.update(dt, this.input, this.save.settings.steeringSensitivity);
        if (s.player.finished) this.onPlayerFinished();
        this.renderer.render(s.scene, s.camera);
        break;
      }

      case 'finished': {
        const s = this.session!;
        s.update(dt, this.input, this.save.settings.steeringSensitivity);
        this.renderer.render(s.scene, s.camera);
        if (performance.now() - this.finishedTime > 2600) this.showResults();
        break;
      }

      case 'paused':
      case 'results': {
        // Static frame; nothing simulates while paused or on the results screen.
        const s = this.session;
        if (s) this.renderer.render(s.scene, s.camera);
        break;
      }
    }
  }

  private beginCountdown(): void {
    const s = this.session!;
    this.countdownTime = -0.5; // brief beat before "3"
    this.countdownStep = -1;
    s.hud.show();
    if (s.isFormulaEvent) s.hud.showMessage('★ FORMULA SERIES · GRAND PRIX WEEKEND ★', 3200);
    else if (s.config.mode === 'timetrial') s.hud.showMessage('TIME TRIAL — PRESS R TO RESTART', 2600);
    this.audio.startEngine();
    this.state = 'countdown';
    this.updateTouchVisibility();
    this.onResize();
  }

  private onPlayerFinished(): void {
    const s = this.session!;
    this.state = 'finished';
    this.finishedTime = performance.now();
    const position = s.raceManager.positionOf(s.player);
    this.menus.showFinishBanner(position);
    this.audio.finishFanfare(position === 1);
    this.audio.setSkid(0);
  }

  private showResults(): void {
    const s = this.session!;
    this.state = 'results';
    this.audio.setEngine(0, 0);

    const standings = s.raceManager.finalStandings();
    const playerRow = standings.find((r) => r.vehicle.isPlayer)!;

    // Credits: position payout scaled by difficulty and race length.
    const diffMult = { easy: 0.7, medium: 1, hard: 1.4 }[s.config.difficulty];
    const lengthMult = s.config.mode === 'sprint' ? 0.8 : s.config.laps / 3;
    const earned = Math.round((CREDIT_TABLE[playerRow.position - 1] ?? 50) * diffMult * lengthMult / 5) * 5;

    this.save.credits += earned;
    this.save.racesPlayed++;
    if (playerRow.position === 1) this.save.racesWon++;

    // Lap records are written live by the session as laps complete;
    // sprints additionally record the fastest total route time here.
    let newRecord = s.newLapRecord;
    if (s.config.mode === 'sprint' && !playerRow.estimated) {
      const prev = this.save.bestSprints[s.config.trackId];
      if (!prev || playerRow.time < prev) {
        this.save.bestSprints[s.config.trackId] = playerRow.time;
        newRecord = true;
      }
    }
    this.persist();
    this.menus.showResults(standings, earned, this.save.credits, newRecord);
  }

  // ------------------------------------------------------ Touch controls

  private buildTouchControls(root: HTMLElement): HTMLElement {
    const el = document.createElement('div');
    el.id = 'touch-controls';
    el.innerHTML = `
      <div class="touch-cluster touch-left">
        <button class="touch-btn" id="t-left">◀</button>
        <button class="touch-btn" id="t-right">▶</button>
      </div>
      <div class="touch-cluster touch-right">
        <button class="touch-btn touch-small" id="t-hand">⏸︎</button>
        <button class="touch-btn touch-brake" id="t-brake">▼</button>
        <button class="touch-btn touch-gas" id="t-gas">▲</button>
      </div>`;
    root.appendChild(el);
    const q = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;
    this.input.bindTouchButton(q('t-left'), 'left');
    this.input.bindTouchButton(q('t-right'), 'right');
    this.input.bindTouchButton(q('t-gas'), 'gas');
    this.input.bindTouchButton(q('t-brake'), 'brake');
    this.input.bindTouchButton(q('t-hand'), 'handbrake');
    q('t-hand').textContent = '🅿';
    return el;
  }

  private updateTouchVisibility(): void {
    const mode = this.save.settings.touchControls;
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const inRace = this.session !== null && this.state !== 'menu';
    const show = inRace && (mode === 'on' || (mode === 'auto' && hasTouch));
    this.touchEl.style.display = show ? 'flex' : 'none';
  }

  private onResize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    const aspect = innerWidth / innerHeight;
    this.menuScene.resize(aspect);
    this.session?.resize(aspect);
  }
}
