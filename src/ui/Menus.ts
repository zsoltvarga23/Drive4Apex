import type { Difficulty, RaceConfig, RaceMode, SaveData, TrackId } from '../types';
import { CARS, getCar, statBars } from '../config/cars';
import { COLORS, getColor } from '../config/colors';
import { TRACKS, getTrack } from '../config/tracks';
import type { Standing } from '../systems/RaceManager';
import { formatTime } from '../utils/math';

/** The surface of Game that the menus drive (avoids a circular import). */
export interface GameAPI {
  save: SaveData;
  persist(): void;
  startRace(cfg: RaceConfig): void;
  restartRace(): void;
  resumeRace(): void;
  quitToMenu(): void;
  applySettings(): void;
  resetProgress(): void;
  previewCar(carId: string, colorHex: string): void;
  uiClick(): void;
}

type ScreenId = 'main' | 'garage' | 'color' | 'track' | 'setup' | 'settings';

/**
 * All menu screens and overlays, rendered as DOM over the 3D canvas.
 * Each screen is re-rendered from state when shown — simple and bug-resistant.
 */
export class Menus {
  private game: GameAPI;
  private root: HTMLElement;
  private overlay: HTMLElement;

  // Race setup selections (car/color persist via save; the rest is per-session).
  private trackId: TrackId = 'coastal';
  private mode: RaceMode = 'circuit';
  private laps = 3;
  private difficulty: Difficulty = 'medium';

  constructor(parent: HTMLElement, game: GameAPI) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.id = 'menu-root';
    parent.appendChild(this.root);
    this.overlay = document.createElement('div');
    this.overlay.id = 'overlay-root';
    parent.appendChild(this.overlay);
  }

  // ------------------------------------------------------------- Screens

  show(screen: ScreenId): void {
    this.root.style.display = 'flex';
    this.root.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'screen';
    switch (screen) {
      case 'main': this.renderMain(el); break;
      case 'garage': this.renderGarage(el); break;
      case 'color': this.renderColor(el); break;
      case 'track': this.renderTrack(el); break;
      case 'setup': this.renderSetup(el); break;
      case 'settings': this.renderSettings(el); break;
    }
    this.root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.innerHTML = '';
  }

  private button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', () => {
      this.game.uiClick();
      onClick();
    });
    return b;
  }

  private renderMain(el: HTMLElement): void {
    const save = this.game.save;
    el.innerHTML = `
      <svg class="logo-mark logo-mark-menu" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M12 48 C 23 20, 41 20, 52 48" fill="none" stroke="#00e5ff" stroke-width="6" stroke-linecap="round" />
        <circle cx="32" cy="27" r="5" fill="#ffd166" />
      </svg>
      <h1 class="title wordmark">DRIVE<i>4</i><span>APEX</span></h1>
      <p class="subtitle">HIT EVERY APEX · ARCADE RACING</p>
      <div class="menu-buttons"></div>
      <div class="main-stats">
        <span>💰 ${save.credits} cr</span>
        <span>🏁 ${save.racesPlayed} races</span>
        <span>🏆 ${save.racesWon} wins</span>
      </div>`;
    const buttons = el.querySelector('.menu-buttons')!;
    buttons.appendChild(this.button('RACE', 'btn btn-primary', () => this.show('garage')));
    buttons.appendChild(this.button('SETTINGS', 'btn', () => this.show('settings')));
  }

  private renderGarage(el: HTMLElement): void {
    const save = this.game.save;
    el.innerHTML = `
      <h2 class="heading">CHOOSE YOUR CAR</h2>
      <div class="card-row" id="car-cards"></div>
      <div class="nav-row"></div>`;
    const cards = el.querySelector('#car-cards')!;

    for (const car of CARS) {
      const bars = statBars(car);
      const card = document.createElement('div');
      card.className = 'card car-card' + (car.id === save.carId ? ' selected' : '');
      const bar = (label: string, v: number) => `
        <div class="stat"><span>${label}</span>
          <div class="stat-bar"><div style="width:${Math.round(Math.max(0.06, Math.min(1, v)) * 100)}%"></div></div>
        </div>`;
      card.innerHTML = `
        <div class="card-name">${car.name}</div>
        ${bar('SPEED', bars.speed)}${bar('ACCEL', bars.accel)}${bar('GRIP', bars.handling)}`;
      card.addEventListener('click', () => {
        this.game.uiClick();
        save.carId = car.id;
        this.game.persist();
        this.game.previewCar(car.id, getColor(save.colorId).hex);
        cards.querySelectorAll('.card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });
      cards.appendChild(card);
    }

    const nav = el.querySelector('.nav-row')!;
    nav.appendChild(this.button('← BACK', 'btn', () => this.show('main')));
    nav.appendChild(this.button('PAINT →', 'btn btn-primary', () => this.show('color')));
  }

  private renderColor(el: HTMLElement): void {
    const save = this.game.save;
    el.innerHTML = `
      <h2 class="heading">PAINT SHOP</h2>
      <p class="hint">Credits: <b id="credit-count">${save.credits}</b> — earn more by racing!</p>
      <div class="swatch-grid" id="swatches"></div>
      <div class="nav-row"></div>`;
    const grid = el.querySelector('#swatches')!;

    const render = () => {
      grid.innerHTML = '';
      for (const color of COLORS) {
        const unlocked = save.unlockedColors.includes(color.id);
        const sw = document.createElement('div');
        sw.className = 'swatch' + (color.id === save.colorId ? ' selected' : '') + (unlocked ? '' : ' locked');
        sw.innerHTML = `
          <div class="swatch-color" style="background:${color.hex}"></div>
          <div class="swatch-name">${color.name}</div>
          ${unlocked ? '' : `<div class="swatch-cost">🔒 ${color.cost} cr</div>`}`;
        sw.addEventListener('click', () => {
          if (unlocked) {
            this.game.uiClick();
            save.colorId = color.id;
            this.game.persist();
            this.game.previewCar(save.carId, color.hex);
            grid.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
            sw.classList.add('selected');
          } else if (save.credits >= color.cost) {
            this.game.uiClick();
            save.credits -= color.cost;
            save.unlockedColors.push(color.id);
            save.colorId = color.id;
            this.game.persist();
            this.game.previewCar(save.carId, color.hex);
            el.querySelector('#credit-count')!.textContent = String(save.credits);
            render();
          } else {
            sw.classList.remove('shake');
            void (sw as HTMLElement).offsetWidth;
            sw.classList.add('shake');
          }
        });
        grid.appendChild(sw);
      }
    };
    render();

    const nav = el.querySelector('.nav-row')!;
    nav.appendChild(this.button('← BACK', 'btn', () => this.show('garage')));
    nav.appendChild(this.button('TRACK →', 'btn btn-primary', () => this.show('track')));
  }

  private renderTrack(el: HTMLElement): void {
    el.innerHTML = `
      <h2 class="heading">SELECT TRACK</h2>
      <div class="card-row" id="track-cards"></div>
      <div class="nav-row"></div>`;
    const cards = el.querySelector('#track-cards')!;

    for (const track of TRACKS) {
      const card = document.createElement('div');
      card.className = 'card track-card' + (track.id === this.trackId ? ' selected' : '');
      const best = this.game.save.bestLaps[track.id];
      card.innerHTML = `
        <canvas class="track-preview" width="180" height="110"></canvas>
        <div class="card-name">${track.name}</div>
        <div class="card-sub">${track.difficultyLabel} · ${track.description}</div>
        <div class="card-sub best">${best ? `Best lap ${formatTime(best)}` : 'No record yet'}</div>`;
      drawTrackPreview(card.querySelector('canvas')!, track.points, track.theme.barrier);
      card.addEventListener('click', () => {
        this.game.uiClick();
        this.trackId = track.id;
        cards.querySelectorAll('.card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });
      cards.appendChild(card);
    }

    const nav = el.querySelector('.nav-row')!;
    nav.appendChild(this.button('← BACK', 'btn', () => this.show('color')));
    nav.appendChild(this.button('RACE SETUP →', 'btn btn-primary', () => this.show('setup')));
  }

  private renderSetup(el: HTMLElement): void {
    const track = getTrack(this.trackId);
    el.innerHTML = `
      <h2 class="heading">RACE SETUP</h2>
      <p class="hint">${track.name}</p>
      <div class="setup-group"><label>MODE</label><div class="seg" id="seg-mode"></div></div>
      <div class="setup-group" id="laps-group"><label>LAPS</label><div class="seg" id="seg-laps"></div></div>
      <div class="setup-group"><label>DIFFICULTY</label><div class="seg" id="seg-diff"></div></div>
      <div class="nav-row"></div>`;

    const seg = <T extends string | number>(
      host: Element, options: { value: T; label: string }[], current: T, onPick: (v: T) => void,
    ) => {
      host.innerHTML = '';
      for (const opt of options) {
        const b = document.createElement('button');
        b.className = 'seg-btn' + (opt.value === current ? ' active' : '');
        b.textContent = opt.label;
        b.addEventListener('click', () => {
          this.game.uiClick();
          onPick(opt.value);
          host.querySelectorAll('.seg-btn').forEach((s) => s.classList.remove('active'));
          b.classList.add('active');
        });
        host.appendChild(b);
      }
    };

    const lapsGroup = el.querySelector<HTMLElement>('#laps-group')!;
    const syncLapsVisibility = () => {
      lapsGroup.style.display = this.mode === 'circuit' ? '' : 'none';
    };
    seg(el.querySelector('#seg-mode')!, [
      { value: 'circuit' as RaceMode, label: 'CIRCUIT' },
      { value: 'sprint' as RaceMode, label: 'SPRINT' },
    ], this.mode, (v) => { this.mode = v; syncLapsVisibility(); });
    seg(el.querySelector('#seg-laps')!, [3, 4, 5].map((n) => ({ value: n, label: String(n) })),
      this.laps, (v) => { this.laps = v; });
    seg(el.querySelector('#seg-diff')!, [
      { value: 'easy' as Difficulty, label: 'EASY' },
      { value: 'medium' as Difficulty, label: 'MEDIUM' },
      { value: 'hard' as Difficulty, label: 'HARD' },
    ], this.difficulty, (v) => { this.difficulty = v; });
    syncLapsVisibility();

    const nav = el.querySelector('.nav-row')!;
    nav.appendChild(this.button('← BACK', 'btn', () => this.show('track')));
    nav.appendChild(this.button('START RACE', 'btn btn-go', () => {
      const save = this.game.save;
      this.game.startRace({
        trackId: this.trackId,
        mode: this.mode,
        laps: this.mode === 'sprint' ? 1 : this.laps,
        carId: save.carId,
        colorHex: getColor(save.colorId).hex,
        difficulty: this.difficulty,
      });
    }));
  }

  private renderSettings(el: HTMLElement): void {
    const s = this.game.save.settings;
    el.innerHTML = `
      <h2 class="heading">SETTINGS</h2>
      <div class="settings-panel">
        <div class="setup-group"><label>GRAPHICS QUALITY</label><div class="seg" id="seg-quality"></div></div>
        <div class="setup-group"><label>MASTER VOLUME <span id="v-master">${pct(s.masterVolume)}</span></label>
          <input type="range" id="sl-master" min="0" max="100" value="${s.masterVolume * 100}"></div>
        <div class="setup-group"><label>MUSIC VOLUME <span id="v-music">${pct(s.musicVolume)}</span></label>
          <input type="range" id="sl-music" min="0" max="100" value="${s.musicVolume * 100}"></div>
        <div class="setup-group"><label>EFFECTS VOLUME <span id="v-sfx">${pct(s.sfxVolume)}</span></label>
          <input type="range" id="sl-sfx" min="0" max="100" value="${s.sfxVolume * 100}"></div>
        <div class="setup-group"><label>STEERING SENSITIVITY <span id="v-sens">${s.steeringSensitivity.toFixed(1)}x</span></label>
          <input type="range" id="sl-sens" min="50" max="150" value="${s.steeringSensitivity * 100}"></div>
        <div class="setup-group"><label>TOUCH CONTROLS</label><div class="seg" id="seg-touch"></div></div>
        <div class="setup-group controls-help">
          <label>CONTROLS</label>
          <p>Drive: WASD / Arrow keys · Handbrake: Space · Pause: Esc or P</p>
        </div>
      </div>
      <div class="nav-row"></div>`;

    const segHost = el.querySelector('#seg-quality')!;
    const qualities = [{ value: 0, label: 'LOW' }, { value: 1, label: 'MEDIUM' }, { value: 2, label: 'HIGH' }];
    for (const q of qualities) {
      const b = document.createElement('button');
      b.className = 'seg-btn' + (q.value === s.quality ? ' active' : '');
      b.textContent = q.label;
      b.addEventListener('click', () => {
        this.game.uiClick();
        s.quality = q.value as 0 | 1 | 2;
        this.game.applySettings();
        segHost.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
      });
      segHost.appendChild(b);
    }

    const touchHost = el.querySelector('#seg-touch')!;
    for (const t of ['auto', 'on', 'off'] as const) {
      const b = document.createElement('button');
      b.className = 'seg-btn' + (t === s.touchControls ? ' active' : '');
      b.textContent = t.toUpperCase();
      b.addEventListener('click', () => {
        this.game.uiClick();
        s.touchControls = t;
        this.game.applySettings();
        touchHost.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
      });
      touchHost.appendChild(b);
    }

    const bindSlider = (id: string, labelId: string, apply: (v: number) => void, fmt: (v: number) => string) => {
      const slider = el.querySelector<HTMLInputElement>(`#${id}`)!;
      slider.addEventListener('input', () => {
        const v = Number(slider.value) / 100;
        apply(v);
        el.querySelector(`#${labelId}`)!.textContent = fmt(v);
        this.game.applySettings();
      });
    };
    bindSlider('sl-master', 'v-master', (v) => (s.masterVolume = v), pct);
    bindSlider('sl-music', 'v-music', (v) => (s.musicVolume = v), pct);
    bindSlider('sl-sfx', 'v-sfx', (v) => (s.sfxVolume = v), pct);
    bindSlider('sl-sens', 'v-sens', (v) => (s.steeringSensitivity = v), (v) => `${v.toFixed(1)}x`);

    const nav = el.querySelector('.nav-row')!;
    nav.appendChild(this.button('RESET PROGRESS', 'btn btn-danger', () => {
      if (confirm('Erase all progress, credits and unlocks?')) {
        this.game.resetProgress();
        this.show('settings');
      }
    }));
    nav.appendChild(this.button('← BACK', 'btn btn-primary', () => this.show('main')));
  }

  // ------------------------------------------------------------ Overlays

  showLoading(label: string, progress: number): void {
    let el = this.overlay.querySelector<HTMLElement>('#load-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'load-screen';
      el.innerHTML = `
        <div class="load-title wordmark">DRIVE<i>4</i><span>APEX</span></div>
        <div class="load-bar"><div class="load-fill"></div></div>
        <div class="load-label"></div>`;
      this.overlay.appendChild(el);
    }
    el.querySelector<HTMLElement>('.load-fill')!.style.width = `${Math.round(progress * 100)}%`;
    el.querySelector('.load-label')!.textContent = label;
  }

  hideLoading(): void {
    this.overlay.querySelector('#load-screen')?.remove();
  }

  showPause(): void {
    const el = document.createElement('div');
    el.id = 'pause-screen';
    el.className = 'modal';
    el.innerHTML = `<div class="modal-card"><h2>PAUSED</h2><div class="modal-buttons"></div></div>`;
    const buttons = el.querySelector('.modal-buttons')!;
    buttons.appendChild(this.button('RESUME', 'btn btn-primary', () => this.game.resumeRace()));
    buttons.appendChild(this.button('RESTART RACE', 'btn', () => this.game.restartRace()));
    buttons.appendChild(this.button('QUIT TO MENU', 'btn btn-danger', () => this.game.quitToMenu()));
    this.overlay.appendChild(el);
  }

  hidePause(): void {
    this.overlay.querySelector('#pause-screen')?.remove();
  }

  /** Brief full-screen flash + confetti when the player crosses the line. */
  showFinishBanner(position: number): void {
    const el = document.createElement('div');
    el.id = 'finish-banner';
    el.innerHTML = `<div class="finish-text">${position === 1 ? '🏆 VICTORY!' : 'FINISH!'}</div>`;
    for (let i = 0; i < 40; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = `${Math.random() * 100}%`;
      c.style.animationDelay = `${Math.random() * 0.8}s`;
      c.style.background = ['#00e5ff', '#ffd166', '#ff6b6b', '#8ee000'][i % 4];
      el.appendChild(c);
    }
    this.overlay.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  showResults(standings: Standing[], creditsEarned: number, totalCredits: number, newRecord: boolean): void {
    const el = document.createElement('div');
    el.id = 'results-screen';
    el.className = 'modal';
    const rows = standings
      .map((s) => `
        <tr class="${s.vehicle.isPlayer ? 'player-row' : ''}">
          <td>${s.position}</td>
          <td>${s.vehicle.name}</td>
          <td>${s.vehicle.spec.name}</td>
          <td>${formatTime(s.time)}${s.estimated ? '<i>*</i>' : ''}</td>
        </tr>`)
      .join('');
    el.innerHTML = `
      <div class="modal-card results-card">
        <h2>RACE RESULTS</h2>
        ${newRecord ? '<div class="record-badge">⚡ NEW BEST LAP RECORD!</div>' : ''}
        <table class="results-table">
          <thead><tr><th>#</th><th>DRIVER</th><th>CAR</th><th>TIME</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="reward">+${creditsEarned} credits <span>(total ${totalCredits})</span></div>
        <div class="modal-buttons"></div>
      </div>`;
    const buttons = el.querySelector('.modal-buttons')!;
    buttons.appendChild(this.button('RACE AGAIN', 'btn btn-primary', () => this.game.restartRace()));
    buttons.appendChild(this.button('MAIN MENU', 'btn', () => this.game.quitToMenu()));
    this.overlay.appendChild(el);
  }

  hideResults(): void {
    this.overlay.querySelector('#results-screen')?.remove();
  }

  clearOverlays(): void {
    this.overlay.innerHTML = '';
  }
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Draw a small 2D outline of a track onto a preview canvas. */
function drawTrackPreview(canvas: HTMLCanvasElement, points: [number, number, number][], accent: string): void {
  const ctx = canvas.getContext('2d')!;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, , z] of points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const pad = 12;
  const scale = Math.min((canvas.width - pad * 2) / (maxX - minX), (canvas.height - pad * 2) / (maxZ - minZ));
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const toCanvas = (x: number, z: number): [number, number] =>
    [canvas.width / 2 + (x - cx) * scale, canvas.height / 2 + (z - cz) * scale];

  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  // Smooth the polygon with quadratic midpoint curves.
  const mid = (i: number): [number, number] => {
    const a = points[i % points.length];
    const b = points[(i + 1) % points.length];
    return toCanvas((a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
  };
  ctx.moveTo(...mid(points.length - 1));
  for (let i = 0; i < points.length; i++) {
    const p = toCanvas(points[i][0], points[i][2]);
    const m = mid(i);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
  ctx.stroke();
}
