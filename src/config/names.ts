/** American-style racer names for AI opponents. */
const FIRST = [
  'Jake', 'Ryan', 'Tyler', 'Ethan', 'Mason', 'Logan', 'Cole', 'Brandon',
  'Austin', 'Dylan', 'Hunter', 'Chase', 'Trevor', 'Wyatt', 'Blake', 'Carter',
];

const LAST = [
  'Miller', 'Cooper', 'Brooks', 'Walker', 'Reed', 'Hayes', 'Sullivan',
  'Bennett', 'Parker', 'Turner', 'Foster', 'Murphy', 'Dawson', 'Griffin',
];

/** Returns `count` unique random "First Last" names. */
export function generateRacerNames(count: number): string[] {
  const names = new Set<string>();
  while (names.size < count) {
    const f = FIRST[Math.floor(Math.random() * FIRST.length)];
    const l = LAST[Math.floor(Math.random() * LAST.length)];
    names.add(`${f} ${l}`);
  }
  return [...names];
}
