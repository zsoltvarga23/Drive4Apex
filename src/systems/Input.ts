import type { ControlState } from '../types';
import { clamp } from '../utils/math';

/**
 * Unified player input: keyboard (WASD / arrows / space) and touch buttons.
 * Digital steering is smoothed into an analog value so keyboard driving
 * feels progressive rather than twitchy.
 */
export class Input {
  /** Fired on Escape/P — wired to pause by the Game. */
  onPause: (() => void) | null = null;
  /** Fired on the very first interaction — used to unlock audio. */
  onFirstInteraction: (() => void) | null = null;

  private keys = new Set<string>();
  private touch = { left: false, right: false, gas: false, brake: false, handbrake: false };
  private steerValue = 0;
  private interacted = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.firstInteraction();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.();
      // Stop arrows/space from scrolling the page.
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('pointerdown', () => this.firstInteraction(), { passive: true });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touch = { left: false, right: false, gas: false, brake: false, handbrake: false };
    });
  }

  private firstInteraction(): void {
    if (this.interacted) return;
    this.interacted = true;
    this.onFirstInteraction?.();
  }

  /** Bind a DOM element as a touch control button. */
  bindTouchButton(el: HTMLElement, control: keyof Input['touch']): void {
    const set = (v: boolean) => (e: Event) => {
      e.preventDefault();
      this.touch[control] = v;
    };
    el.addEventListener('pointerdown', set(true));
    el.addEventListener('pointerup', set(false));
    el.addEventListener('pointercancel', set(false));
    el.addEventListener('pointerleave', set(false));
  }

  /** Sample current controls; `dt` drives steering smoothing. */
  getControls(dt: number, sensitivity: number): ControlState {
    const k = this.keys;
    const left = k.has('KeyA') || k.has('ArrowLeft') || this.touch.left;
    const right = k.has('KeyD') || k.has('ArrowRight') || this.touch.right;
    const target = (right ? 1 : 0) - (left ? 1 : 0);

    // Ramp toward the target; return to center faster than steering in.
    const rate = (target !== 0 ? 5.5 : 9) * sensitivity;
    this.steerValue += clamp(target - this.steerValue, -rate * dt, rate * dt);
    if (target === 0 && Math.abs(this.steerValue) < 0.02) this.steerValue = 0;

    return {
      throttle: k.has('KeyW') || k.has('ArrowUp') || this.touch.gas ? 1 : 0,
      brake: k.has('KeyS') || k.has('ArrowDown') || this.touch.brake ? 1 : 0,
      steer: clamp(this.steerValue, -1, 1),
      handbrake: k.has('Space') || this.touch.handbrake,
    };
  }
}
