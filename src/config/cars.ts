import type { CarSpec } from '../types';

/**
 * The selectable car roster. Speeds are in m/s (multiply by 3.6 for km/h).
 * Stats are balanced so every car is viable: high top speed trades off
 * against handling and vice versa.
 */
export const CARS: CarSpec[] = [
  {
    id: 'comet',
    name: 'Comet GT',
    topSpeed: 46,
    accel: 9.2,
    handling: 0.72,
    braking: 13,
    body: 'sport',
  },
  {
    id: 'viper',
    name: 'Viper X',
    topSpeed: 52,
    accel: 10.6,
    handling: 0.6,
    braking: 11.5,
    body: 'super',
  },
  {
    id: 'roadboss',
    name: 'Road Boss',
    topSpeed: 48,
    accel: 9.6,
    handling: 0.55,
    braking: 11,
    body: 'muscle',
  },
  {
    id: 'pixie',
    name: 'Pixie Zip',
    topSpeed: 41,
    accel: 8.6,
    handling: 0.88,
    braking: 14,
    body: 'compact',
  },
  {
    id: 'classico',
    name: 'Classico 71',
    topSpeed: 44,
    accel: 8.2,
    handling: 0.7,
    braking: 12,
    body: 'classic',
  },
  {
    id: 'tarmac',
    name: 'Tarmac S',
    topSpeed: 47,
    accel: 9.9,
    handling: 0.66,
    braking: 12.5,
    body: 'sport',
  },
  {
    // Premium reward car: best stats in every column, but its razor-sharp
    // steering and severe off-road penalty punish sloppy lines. The price
    // targets ~35-45 races of earnings — a genuine long-term goal for this
    // economy (average payout is ~150-250 credits per race).
    id: 'ax1',
    name: 'AX-1 Formula',
    topSpeed: 56,
    accel: 13,
    handling: 0.98,
    braking: 16,
    body: 'formula',
    price: 7500,
  },
];

export function getCar(id: string): CarSpec {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

/** Free cars are always available; premium cars must be purchased. */
export function isCarUnlocked(car: CarSpec, unlockedCars: string[]): boolean {
  return !car.price || unlockedCars.includes(car.id);
}

/** Normalize a stat to 0..1 for UI bars. */
export const statBars = (c: CarSpec) => ({
  speed: (c.topSpeed - 38) / (54 - 38),
  accel: (c.accel - 7.5) / (11 - 7.5),
  handling: (c.handling - 0.5) / (0.9 - 0.5),
});
