import type { CarBody, Difficulty, RaceConfig, RaceMode, SaveData, TrackId } from '../types';
import { CARS, getCar, isCarUnlocked, statBars } from '../config/cars';
import { COLORS, getColor } from '../config/colors';
import { TRACKS, getTrack } from '../config/tracks';
import type { Standing } from '../systems/RaceManager';
import {
  BODY_CLASS_LABELS, leaderboards, sanitizeName, vehicleLabel, type BoardMode,
} from '../systems/Leaderboards';
import {
  CURRENT_VERSION, markVersionSeen, searchPatchNotes, type PatchNote,
} from '../systems/PatchNotes';
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

type ScreenId =
  | 'main' | 'garage' | 'color' | 'track' | 'setup' | 'settings' | 'leaderboard' | 'patchnotes';

/**
 * All menu screens and overlays, rendered as DOM over the 3D canvas.
 * Each screen is re-rendered from state when shown — simple and bug-resistant.
 */
export class Menus {
  private game: GameAPI;
  private root: HTMLElement;
  private overlay: HTMLElement;

  // Race setup selections (car/color persist via save; the rest is per-session).
  private trackId: TrackId = 'gp';
  private mode: RaceMode = 'circuit';
  private laps = 3;
  private difficulty: Difficulty = 'medium';

  // Leaderboard view state (kept across visits within a session).
  private lbTab: 'career' | 'records' | 'sprint' | 'personal' = 'career';
  private lbTrack: TrackId = 'gp';
  private lbClass: 'all' | CarBody = 'all';

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
      case 'leaderboard': this.renderLeaderboard(el); break;
      case 'patchnotes': this.renderPatchNotes(el); break;
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
      </div>
      <div class="version-tag">v${CURRENT_VERSION}</div>`;
    const buttons = el.querySelector('.menu-buttons')!;
    buttons.appendChild(this.button('RACE', 'btn btn-primary', () => this.show('garage')));
    buttons.appendChild(this.button('LEADERBOARDS', 'btn', () => this.show('leaderboard')));
    buttons.appendChild(this.button('PATCH NOTES', 'btn', () => this.show('patchnotes')));
    buttons.appendChild(this.button('SETTINGS', 'btn', () => this.show('settings')));
  }

  private renderGarage(el: HTMLElement): void {
    const save = this.game.save;
    el.innerHTML = `
      <h2 class="heading">CHOOSE YOUR CAR</h2>
      <p class="hint">Credits: <b id="garage-credits">${save.credits}</b></p>
      <div class="card-row" id="car-cards"></div>
      <div class="nav-row"></div>`;
    const cards = el.querySelector('#car-cards')!;

    const render = () => {
      cards.innerHTML = '';
      for (const car of CARS) {
        const unlocked = isCarUnlocked(car, save.unlockedCars);
        const bars = statBars(car);
        const card = document.createElement('div');
        card.className =
          'card car-card' +
          (car.id === save.carId ? ' selected' : '') +
          (car.price ? ' premium' : '') +
          (unlocked ? '' : ' locked');
        const bar = (label: string, v: number) => `
          <div class="stat"><span>${label}</span>
            <div class="stat-bar"><div style="width:${Math.round(Math.max(0.06, Math.min(1, v)) * 100)}%"></div></div>
          </div>`;
        card.innerHTML = `
          <div class="card-name">${car.name}${car.price ? '<em class="premium-tag">PREMIUM</em>' : ''}</div>
          ${bar('SPEED', bars.speed)}${bar('ACCEL', bars.accel)}${bar('GRIP', bars.handling)}
          ${unlocked ? '' : `<div class="price-tag">🔒 ${car.price} cr</div>`}`;
        card.addEventListener('click', () => {
          // Always preview in the showroom — even locked cars can be admired.
          this.game.previewCar(car.id, getColor(save.colorId).hex);
          if (unlocked) {
            this.game.uiClick();
            save.carId = car.id;
            this.game.persist();
            render();
          } else if (save.credits >= (car.price ?? 0)) {
            this.game.uiClick();
            save.credits -= car.price ?? 0;
            save.creditsSpent += car.price ?? 0;
            save.unlockedCars.push(car.id);
            save.carId = car.id;
            this.game.persist();
            el.querySelector('#garage-credits')!.textContent = String(save.credits);
            this.showUnlockBanner(`New Vehicle Unlocked: ${car.name}`);
            render();
          } else {
            card.classList.remove('shake');
            void card.offsetWidth;
            card.classList.add('shake');
          }
        });
        cards.appendChild(card);
      }
    };
    render();

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
            save.creditsSpent += color.cost;
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
      // Canyon is a sprint run, so its headline record is the route time.
      const bestLap = this.game.save.bestLaps[track.id];
      const bestSprint = this.game.save.bestSprints[track.id];
      const record =
        track.id === 'canyon'
          ? bestSprint ? `Best run ${formatTime(bestSprint)}` : 'No record yet'
          : bestLap ? `Best lap ${formatTime(bestLap)}` : 'No record yet';
      card.innerHTML = `
        <canvas class="track-preview" width="180" height="110"></canvas>
        <div class="card-name">${track.name}</div>
        <div class="card-sub">${track.difficultyLabel} · ${track.description}</div>
        <div class="card-sub best">${record}</div>`;
      drawTrackPreview(card.querySelector('canvas')!, track.points, track.theme.barrier);
      card.addEventListener('click', () => {
        this.game.uiClick();
        this.trackId = track.id;
        // Sierra Canyon is designed as a point-to-point run — suggest Sprint.
        this.mode = track.id === 'canyon' ? 'sprint' : 'circuit';
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
      <div class="setup-group" id="diff-group"><label>DIFFICULTY</label><div class="seg" id="seg-diff"></div></div>
      <p class="hint" id="tt-hint" style="display:none">Solo against the clock — sector splits, live deltas, instant restart with R.</p>
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
    const diffGroup = el.querySelector<HTMLElement>('#diff-group')!;
    const ttHint = el.querySelector<HTMLElement>('#tt-hint')!;
    const syncLapsVisibility = () => {
      lapsGroup.style.display = this.mode === 'circuit' ? '' : 'none';
      // No opponents in time trial, so difficulty is meaningless there.
      diffGroup.style.display = this.mode === 'timetrial' ? 'none' : '';
      ttHint.style.display = this.mode === 'timetrial' ? '' : 'none';
    };
    seg(el.querySelector('#seg-mode')!, [
      { value: 'circuit' as RaceMode, label: 'CIRCUIT' },
      { value: 'sprint' as RaceMode, label: 'SPRINT' },
      { value: 'timetrial' as RaceMode, label: 'TIME TRIAL' },
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
        laps: this.mode === 'circuit' ? this.laps : 1,
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
        <div class="setup-group"><label>DRIVER NAME (LEADERBOARDS)</label>
          <input type="text" id="in-name" class="lb-name-input" maxlength="16" placeholder="Enter nickname" value="${esc(this.game.save.playerName)}"></div>
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

    const nameInput = el.querySelector<HTMLInputElement>('#in-name')!;
    nameInput.addEventListener('change', () => {
      this.game.save.playerName = sanitizeName(nameInput.value);
      this.game.persist();
      leaderboards.pushCareer(this.game.save);
    });

    const nav = el.querySelector('.nav-row')!;
    nav.appendChild(this.button('RESET PROGRESS', 'btn btn-danger', () => {
      if (confirm('Erase all progress, credits and unlocks?')) {
        this.game.resetProgress();
        this.show('settings');
      }
    }));
    nav.appendChild(this.button('← BACK', 'btn btn-primary', () => this.show('main')));
  }

  // --------------------------------------------------------- Leaderboards

  private renderLeaderboard(el: HTMLElement): void {
    el.innerHTML = `<h2 class="heading">LEADERBOARDS</h2>`;
    el.appendChild(this.buildLeaderboardPanel());
    const nav = document.createElement('div');
    nav.className = 'nav-row';
    nav.appendChild(this.button('← BACK', 'btn btn-primary', () => this.show('main')));
    el.appendChild(nav);
  }

  /** Tabbed leaderboard panel, shared by the menu screen and the in-race modal. */
  private buildLeaderboardPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'lb-panel';
    // Guards stale async refreshes from overwriting a newer view.
    let renderSeq = 0;

    const render = () => {
      const seq = ++renderSeq;
      panel.innerHTML = `
        <div class="lb-name-row">
          <span>RACING AS</span>
          <input id="lb-name" maxlength="16" placeholder="Enter nickname" value="${esc(this.game.save.playerName)}">
          <button class="seg-btn" id="lb-name-save">SAVE</button>
        </div>
        <div class="lb-tabs"></div>
        <div class="lb-filters"></div>
        <div class="lb-status">⟳ Syncing with shared leaderboard…</div>
        <div class="lb-content"></div>`;

      const nameInput = panel.querySelector<HTMLInputElement>('#lb-name')!;
      panel.querySelector('#lb-name-save')!.addEventListener('click', () => {
        this.game.uiClick();
        this.game.save.playerName = sanitizeName(nameInput.value);
        this.game.persist();
        leaderboards.pushCareer(this.game.save);
        render();
      });

      const status = panel.querySelector<HTMLElement>('.lb-status')!;
      const setStatus = (online: boolean) => {
        if (seq !== renderSeq || !panel.isConnected) return;
        status.textContent = online
          ? '● Online — shared global leaderboard'
          : '○ Offline — showing local records only';
        status.className = 'lb-status ' + (online ? 'online' : 'offline');
      };

      const tabHost = panel.querySelector<HTMLElement>('.lb-tabs')!;
      const tabs: [typeof this.lbTab, string][] = [
        ['career', 'CAREER'],
        ['records', 'TRACK RECORDS'],
        ['sprint', 'SPRINT RECORDS'],
        ['personal', 'PERSONAL BESTS'],
      ];
      for (const [id, label] of tabs) {
        const b = document.createElement('button');
        b.className = 'seg-btn' + (this.lbTab === id ? ' active' : '');
        b.textContent = label;
        b.addEventListener('click', () => {
          this.game.uiClick();
          this.lbTab = id;
          render();
        });
        tabHost.appendChild(b);
      }

      const filters = panel.querySelector<HTMLElement>('.lb-filters')!;
      const content = panel.querySelector<HTMLElement>('.lb-content')!;

      if (this.lbTab === 'career') {
        filters.style.display = 'none';
        content.innerHTML = this.careerTable();
        void leaderboards.refreshCareers().then((online) => {
          setStatus(online);
          if (seq === renderSeq && panel.isConnected) content.innerHTML = this.careerTable();
        });
      } else if (this.lbTab === 'personal') {
        filters.style.display = 'none';
        status.textContent = '';
        content.innerHTML = this.personalBests();
      } else {
        // Track + vehicle-class filters for the record boards.
        for (const t of TRACKS) {
          const b = document.createElement('button');
          b.className = 'seg-btn' + (this.lbTrack === t.id ? ' active' : '');
          b.textContent = t.name.split(' ')[0].toUpperCase();
          b.title = t.name;
          b.addEventListener('click', () => {
            this.game.uiClick();
            this.lbTrack = t.id;
            render();
          });
          filters.appendChild(b);
        }
        const sel = document.createElement('select');
        sel.className = 'lb-select';
        sel.innerHTML =
          `<option value="all">ALL CLASSES</option>` +
          (Object.entries(BODY_CLASS_LABELS) as [CarBody, string][])
            .map(([body, label]) => `<option value="${body}">${label.toUpperCase()}</option>`)
            .join('');
        sel.value = this.lbClass;
        sel.addEventListener('change', () => {
          this.lbClass = sel.value as 'all' | CarBody;
          render();
        });
        filters.appendChild(sel);
        const mode: BoardMode = this.lbTab === 'sprint' ? 'sprint' : 'lap';
        content.innerHTML = this.recordsTable(this.lbTrack, mode);
        void leaderboards.refreshRecords(this.lbTrack, mode).then((online) => {
          setStatus(online);
          if (seq === renderSeq && panel.isConnected) {
            content.innerHTML = this.recordsTable(this.lbTrack, mode);
          }
        });
      }
    };

    render();
    return panel;
  }

  /** Career rankings: rivals + player, ranked by wins → level → earnings. */
  private careerTable(): string {
    const save = this.game.save;
    const rows = leaderboards.careerRows(save);
    const winRate = save.racesPlayed ? Math.round((save.racesWon / save.racesPlayed) * 100) : 0;
    const avgFinish = save.racesPlayed ? (save.positionsSum / save.racesPlayed).toFixed(1) : '—';

    const body = rows
      .map(
        (r, i) => `
        <tr class="${r.pid === save.playerId ? 'player-row' : ''}">
          <td>${i + 1}</td>
          <td>${esc(r.name)}</td>
          <td>${r.wins}</td>
          <td>${r.level}</td>
          <td>${r.creditsEarned.toLocaleString()}</td>
          <td>${r.credits.toLocaleString()}</td>
        </tr>`,
      )
      .join('');
    return `
      <table class="results-table lb-table">
        <thead><tr><th>#</th><th>DRIVER</th><th>WINS</th><th>LVL</th><th>EARNED</th><th>CREDITS</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="lb-stats">
        <span>Podiums <b>${save.podiums}</b></span>
        <span>Win rate <b>${winRate}%</b></span>
        <span>Avg finish <b>${avgFinish}</b></span>
        <span>Races <b>${save.racesPlayed}</b></span>
        <span>Spent <b>${save.creditsSpent.toLocaleString()} cr</b></span>
      </div>
      ${rows.length <= 1 ? '<p class="hint">You are the first driver here — other players join the board as they race.</p>' : ''}`;
  }

  /** Motorsport-style timing board: top 10 + the player's row if outside it. */
  private recordsTable(trackId: TrackId, mode: BoardMode): string {
    let entries = leaderboards.records(trackId, mode);
    if (this.lbClass !== 'all') entries = entries.filter((e) => getCar(e.carId).body === this.lbClass);
    if (entries.length === 0) {
      return `<p class="hint">No ${mode === 'sprint' ? 'sprint runs' : 'lap times'} recorded here yet — set the pace!</p>`;
    }

    const myPid = this.game.save.playerId;
    const leader = entries[0].time;
    const row = (e: (typeof entries)[0], rank: number) => `
      <tr class="${e.pid === myPid ? 'player-row' : ''}">
        <td>${rank}</td>
        <td>${esc(e.name)}</td>
        <td>${vehicleLabel(e.carId)}</td>
        <td>${formatTime(e.time)}</td>
        <td>${rank === 1 ? '—' : `+${(e.time - leader).toFixed(2)}`}</td>
        <td>${e.date}</td>
      </tr>`;

    const top = entries.slice(0, 10).map((e, i) => row(e, i + 1)).join('');
    const playerIdx = entries.findIndex((e) => e.pid === myPid);
    const playerOutside =
      playerIdx >= 10
        ? `<tr class="lb-gap-row"><td colspan="6">···</td></tr>${row(entries[playerIdx], playerIdx + 1)}`
        : '';
    return `
      <table class="results-table lb-table">
        <thead><tr><th>#</th><th>DRIVER</th><th>VEHICLE</th><th>${mode === 'sprint' ? 'SPRINT TIME' : 'LAP TIME'}</th><th>GAP</th><th>DATE</th></tr></thead>
        <tbody>${top}${playerOutside}</tbody>
      </table>`;
  }

  /** The player's own records: best lap & sprint per track, plus formula-only bests. */
  private personalBests(): string {
    const cell = (e?: { time: number; carId: string; date: string }) =>
      e ? `<b>${formatTime(e.time)}</b><br><small>${vehicleLabel(e.carId)} · ${e.date}</small>` : '<span class="dim">—</span>';

    const myPid = this.game.save.playerId;
    const playerBest = (trackId: TrackId, mode: BoardMode, formulaOnly: boolean) => {
      const mine = leaderboards
        .records(trackId, mode)
        .filter((e) => e.pid === myPid && (!formulaOnly || getCar(e.carId).body === 'formula'));
      return mine.length ? mine.reduce((a, b) => (a.time <= b.time ? a : b)) : undefined;
    };

    const rows = TRACKS.map(
      (t) => `
      <tr>
        <td>${t.name}</td>
        <td>${cell(playerBest(t.id, 'lap', false))}</td>
        <td>${cell(playerBest(t.id, 'sprint', false))}</td>
      </tr>`,
    ).join('');

    const formulaRows = TRACKS.map(
      (t) => `
      <tr>
        <td>${t.name}</td>
        <td>${cell(playerBest(t.id, 'lap', true))}</td>
        <td>${cell(playerBest(t.id, 'sprint', true))}</td>
      </tr>`,
    ).join('');

    return `
      <table class="results-table lb-table">
        <thead><tr><th>TRACK</th><th>BEST LAP</th><th>BEST SPRINT</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h3 class="lb-subhead">FORMULA RECORDS</h3>
      <table class="results-table lb-table">
        <thead><tr><th>TRACK</th><th>FORMULA LAP</th><th>FORMULA SPRINT</th></tr></thead>
        <tbody>${formulaRows}</tbody>
      </table>`;
  }

  /** In-race leaderboard access (e.g. from the time-trial pause menu). */
  showLeaderboardModal(): void {
    const el = document.createElement('div');
    el.className = 'modal';
    el.id = 'lb-modal';
    const card = document.createElement('div');
    card.className = 'modal-card lb-modal-card';
    card.innerHTML = '<h2>LEADERBOARDS</h2>';
    card.appendChild(this.buildLeaderboardPanel());
    card.appendChild(this.button('CLOSE', 'btn btn-primary', () => el.remove()));
    el.appendChild(card);
    this.overlay.appendChild(el);
  }

  // --------------------------------------------------------- Patch notes

  private renderPatchNotes(el: HTMLElement): void {
    el.innerHTML = `
      <h2 class="heading">PATCH NOTES</h2>
      <p class="hint">Current version: <b>v${CURRENT_VERSION}</b></p>
      <input type="text" id="pn-search" class="lb-name-input pn-search" maxlength="40"
        placeholder="Search versions, features, fixes…">
      <div class="pn-list" id="pn-list"></div>
      <div class="nav-row"></div>`;

    const list = el.querySelector<HTMLElement>('#pn-list')!;
    const renderList = (query: string) => {
      const notes = searchPatchNotes(query);
      list.innerHTML = notes.length
        ? notes.map((n, i) => patchNoteHtml(n, i === 0 && !query)).join('')
        : '<p class="hint">No patch notes match that search.</p>';
    };
    renderList('');

    const search = el.querySelector<HTMLInputElement>('#pn-search')!;
    search.addEventListener('input', () => renderList(search.value));

    const nav = el.querySelector('.nav-row')!;
    nav.appendChild(this.button('← BACK', 'btn btn-primary', () => this.show('main')));
  }

  /** "Game updated" popup shown once per new version for returning players. */
  showUpdatePopup(note: PatchNote): void {
    const el = document.createElement('div');
    el.className = 'modal';
    el.id = 'update-popup';
    const card = document.createElement('div');
    card.className = 'modal-card pn-popup';
    card.innerHTML = `
      <div class="pn-updated">🔔 DRIVE4APEX UPDATED</div>
      <h2>v${esc(note.version)} — ${esc(note.title)}</h2>
      <div class="pn-popup-body">${patchNoteSections(note)}</div>
      <div class="modal-buttons"></div>`;
    const dismiss = (thenShowAll: boolean) => {
      markVersionSeen();
      el.remove();
      if (thenShowAll) this.show('patchnotes');
    };
    const buttons = card.querySelector('.modal-buttons')!;
    buttons.appendChild(this.button('READ FULL PATCH NOTES', 'btn btn-primary', () => dismiss(true)));
    buttons.appendChild(this.button('CONTINUE', 'btn', () => dismiss(false)));
    el.appendChild(card);
    this.overlay.appendChild(el);
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
    buttons.appendChild(this.button('LEADERBOARDS', 'btn', () => this.showLeaderboardModal()));
    buttons.appendChild(this.button('QUIT TO MENU', 'btn btn-danger', () => this.game.quitToMenu()));
    this.overlay.appendChild(el);
  }

  hidePause(): void {
    this.overlay.querySelector('#pause-screen')?.remove();
  }

  /** Celebration toast shown when a premium vehicle is purchased. */
  showUnlockBanner(text: string): void {
    const el = document.createElement('div');
    el.className = 'unlock-banner';
    el.textContent = `🏆 ${text}`;
    this.overlay.appendChild(el);
    setTimeout(() => el.remove(), 3200);
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
          <td>${esc(s.vehicle.name)}</td>
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
    buttons.appendChild(this.button('LEADERBOARDS', 'btn', () => {
      this.game.quitToMenu();
      this.show('leaderboard');
    }));
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

/** Escape user-provided strings before inserting into innerHTML. */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The three patch-note sections, headers omitted when a section is empty. */
function patchNoteSections(n: PatchNote): string {
  const section = (label: string, cls: string, items: string[]) =>
    items.length
      ? `<div class="pn-section ${cls}"><h4>${label}</h4><ul>${items
          .map((i) => `<li>${esc(i)}</li>`)
          .join('')}</ul></div>`
      : '';
  return (
    section('New Features', 'pn-new', n.newFeatures) +
    section('Improvements', 'pn-improved', n.improvements) +
    section('Bug Fixes', 'pn-fixed', n.bugFixes)
  );
}

/** One expandable version entry for the patch notes screen. */
function patchNoteHtml(n: PatchNote, expanded: boolean): string {
  return `
    <details class="pn-entry"${expanded ? ' open' : ''}>
      <summary>
        <span class="pn-version">v${esc(n.version)}</span>
        <span class="pn-title">${esc(n.title)}</span>
        <span class="pn-date">${esc(n.releaseDate)}</span>
      </summary>
      <div class="pn-body">${patchNoteSections(n)}</div>
    </details>`;
}

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
