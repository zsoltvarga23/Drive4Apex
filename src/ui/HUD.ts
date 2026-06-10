import { formatTime } from '../utils/math';
import type { RaceMode } from '../types';

/**
 * In-race heads-up display: position, lap/progress, speed, timers,
 * center messages, wrong-way warning and the countdown numbers.
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
  private msgTimeout = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-pos" id="hud-pos">8<span>th</span></div>
        <div class="hud-lap" id="hud-lap">LAP 1/3</div>
      </div>
      <div class="hud-top-center">
        <div class="hud-time" id="hud-time">0:00.00</div>
        <div class="hud-best" id="hud-best">BEST --:--.--</div>
      </div>
      <div class="hud-msg" id="hud-msg"></div>
      <div class="hud-wrongway" id="hud-wrongway">WRONG WAY!</div>
      <div class="hud-countdown" id="hud-countdown"></div>
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
  }

  show(): void {
    this.root.style.display = 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.countdownEl.textContent = '';
  }

  setPosition(pos: number, total: number): void {
    const suffix = ['th', 'st', 'nd', 'rd'][pos % 100 > 10 && pos % 100 < 14 ? 0 : Math.min(pos % 10, 4) % 4] ?? 'th';
    this.posEl.innerHTML = `${pos}<span>${suffix}</span><em>/${total}</em>`;
  }

  setLap(mode: RaceMode, lap: number, total: number, sprintProgress: number): void {
    this.lapEl.textContent =
      mode === 'circuit'
        ? `LAP ${Math.min(lap + 1, total)}/${total}`
        : `${Math.floor(Math.min(sprintProgress, 1) * 100)}% COMPLETE`;
  }

  setSpeed(metersPerSecond: number): void {
    this.speedEl.textContent = String(Math.round(Math.abs(metersPerSecond) * 3.6));
  }

  setTimes(raceTime: number, bestLap: number): void {
    this.timeEl.textContent = formatTime(raceTime);
    this.bestEl.textContent = `BEST ${isFinite(bestLap) ? formatTime(bestLap) : '--:--.--'}`;
  }

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
