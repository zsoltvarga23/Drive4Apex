import { formatTime } from '../utils/math';
import type { RaceMode } from '../types';

/** Color status of a completed sector vs. the personal best. */
export type SectorStatus = 'pb' | 'even' | 'slow' | 'none';

/**
 * In-race heads-up display: position, lap/progress, speed, timers, sector
 * splits with PB color coding, lap delta, time-trial lap history, center
 * messages, wrong-way warning and the countdown numbers.
 * Pure DOM — cheap to update and naturally responsive.
 */
export class HUD {
  readonly root: HTMLElement;
  private posEl: HTMLElement;
  private lapEl: HTMLElement;
  private speedEl: HTMLElement;
  private timeEl: HTMLElement;
  private bestEl: HTMLElement;
  private msgEl: HTMLElement;
  private wrongWayEl: HTMLElement;
  private countdownEl: HTMLElement;
  private deltaEl: HTMLElement;
  private historyEl: HTMLElement;
  private sectorEls: HTMLElement[];

  private msgTimeout = 0;
  private deltaTimeout = 0;
  private sectorResetTimeout = 0;
  private sectorLabels = ['S1', 'S2', 'S3'];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-pos" id="hud-pos">8<span>th</span></div>
        <div class="hud-lap" id="hud-lap">LAP 1/3</div>
        <div class="hud-history" id="hud-history"></div>
      </div>
      <div class="hud-top-center">
        <div class="hud-time" id="hud-time">0:00.00</div>
        <div class="hud-best" id="hud-best">BEST --:--.--</div>
        <div class="hud-delta" id="hud-delta"></div>
      </div>
      <div class="hud-msg" id="hud-msg"></div>
      <div class="hud-wrongway" id="hud-wrongway">WRONG WAY!</div>
      <div class="hud-countdown" id="hud-countdown"></div>
      <div class="hud-sectors" id="hud-sectors">
        <span class="sector-chip" id="hud-sec0"></span>
        <span class="sector-chip" id="hud-sec1"></span>
        <span class="sector-chip" id="hud-sec2"></span>
      </div>
      <div class="hud-speed">
        <span class="hud-speed-value" id="hud-speed">0</span>
        <span class="hud-speed-unit">km/h</span>
      </div>`;
    parent.appendChild(this.root);

    const q = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
    this.posEl = q('hud-pos');
    this.lapEl = q('hud-lap');
    this.speedEl = q('hud-speed');
    this.timeEl = q('hud-time');
    this.bestEl = q('hud-best');
    this.msgEl = q('hud-msg');
    this.wrongWayEl = q('hud-wrongway');
    this.countdownEl = q('hud-countdown');
    this.deltaEl = q('hud-delta');
    this.historyEl = q('hud-history');
    this.sectorEls = [q('hud-sec0'), q('hud-sec1'), q('hud-sec2')];
    this.resetSectors();
  }

  show(): void {
    this.root.style.display = 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.countdownEl.textContent = '';
  }

  /** Adapt the HUD to the race mode (sector labels, position, history). */
  configureMode(mode: RaceMode): void {
    this.sectorLabels = mode === 'sprint' ? ['CP1', 'CP2', 'CP3'] : ['S1', 'S2', 'S3'];
    this.posEl.style.display = mode === 'timetrial' ? 'none' : '';
    this.historyEl.style.display = mode === 'timetrial' ? 'block' : 'none';
    this.deltaEl.textContent = '';
    this.historyEl.innerHTML = '';
    this.resetSectors();
  }

  setPosition(pos: number, total: number): void {
    const suffix = ['th', 'st', 'nd', 'rd'][pos % 100 > 10 && pos % 100 < 14 ? 0 : Math.min(pos % 10, 4) % 4] ?? 'th';
    this.posEl.innerHTML = `${pos}<span>${suffix}</span><em>/${total}</em>`;
  }

  setLap(mode: RaceMode, lap: number, total: number, sprintProgress: number): void {
    if (mode === 'timetrial') {
      this.lapEl.textContent = `TIME TRIAL · LAP ${lap + 1}`;
    } else if (mode === 'circuit') {
      this.lapEl.textContent = `LAP ${Math.min(lap + 1, total)}/${total}`;
    } else {
      this.lapEl.textContent = `${Math.floor(Math.min(sprintProgress, 1) * 100)}% COMPLETE`;
    }
  }

  setSpeed(metersPerSecond: number): void {
    this.speedEl.textContent = String(Math.round(Math.abs(metersPerSecond) * 3.6));
  }

  setTimes(raceTime: number, bestLap: number): void {
    this.timeEl.textContent = formatTime(raceTime);
    this.bestEl.textContent = `BEST ${isFinite(bestLap) ? formatTime(bestLap) : '--:--.--'}`;
  }

  // ----------------------------------------------------- Sector timing

  resetSectors(): void {
    clearTimeout(this.sectorResetTimeout);
    this.sectorEls.forEach((el, i) => {
      el.className = 'sector-chip';
      el.textContent = `${this.sectorLabels[i]} --.--`;
    });
  }

  /** Clear sector chips shortly after a lap so the final split stays readable. */
  resetSectorsSoon(): void {
    clearTimeout(this.sectorResetTimeout);
    this.sectorResetTimeout = window.setTimeout(() => this.resetSectors(), 2500);
  }

  setSector(index: number, time: number, status: SectorStatus): void {
    const el = this.sectorEls[index];
    if (!el) return;
    el.className = `sector-chip ${status}`;
    el.textContent = `${this.sectorLabels[index]} ${time.toFixed(2)}`;
  }

  /** Live delta vs. the personal-best lap, shown for a few seconds. */
  showDelta(delta: number): void {
    clearTimeout(this.deltaTimeout);
    const ahead = delta < -0.005;
    this.deltaEl.textContent = `${ahead ? '−' : '+'}${Math.abs(delta).toFixed(2)}`;
    this.deltaEl.className = `hud-delta ${ahead ? 'fast' : 'slow'}`;
    this.deltaTimeout = window.setTimeout(() => (this.deltaEl.textContent = ''), 4000);
  }

  /** Time-trial session history: the most recent laps, best highlighted. */
  setLapHistory(laps: number[]): void {
    if (laps.length === 0) return;
    const best = Math.min(...laps);
    const start = Math.max(0, laps.length - 5);
    this.historyEl.innerHTML = laps
      .slice(start)
      .map((t, i) => {
        const n = start + i + 1;
        return `<div class="lap-row${t === best ? ' best' : ''}">L${n} ${formatTime(t)}</div>`;
      })
      .join('');
  }

  // ------------------------------------------------------- Messages

  setWrongWay(visible: boolean): void {
    this.wrongWayEl.style.opacity = visible ? '1' : '0';
  }

  showMessage(text: string, ms = 1800): void {
    this.msgEl.textContent = text;
    this.msgEl.classList.remove('pop');
    void this.msgEl.offsetWidth; // restart CSS animation
    this.msgEl.classList.add('pop');
    clearTimeout(this.msgTimeout);
    this.msgTimeout = window.setTimeout(() => (this.msgEl.textContent = ''), ms);
  }

  showCountdown(text: string): void {
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove('pop');
    void this.countdownEl.offsetWidth;
    this.countdownEl.classList.add('pop');
    if (text === '') this.countdownEl.classList.remove('pop');
  }

  dispose(): void {
    this.root.remove();
  }
}
