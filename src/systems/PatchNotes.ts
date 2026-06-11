import notesJson from '../data/patch-notes.json';

/**
 * File-based patch notes: the single source of truth is
 * src/data/patch-notes.json (bundled at build time — loads instantly,
 * works fully offline, no server or database involved).
 *
 * Shipping a new update = add an entry at the TOP of that file and deploy.
 * The newest entry's version doubles as the game version, so the update
 * popup triggers automatically for returning players — no code changes.
 */
export interface PatchNote {
  version: string;
  releaseDate: string;
  title: string;
  newFeatures: string[];
  improvements: string[];
  bugFixes: string[];
}

/** All patch notes, newest first (the order they appear in the JSON file). */
export const PATCH_NOTES: PatchNote[] = notesJson as PatchNote[];

/** The game version = the newest patch note's version. */
export const CURRENT_VERSION: string = PATCH_NOTES[0]?.version ?? '0.0.0';

const LAST_SEEN_KEY = 'drive4apex_last_seen_version';

export function getLastSeenVersion(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function markVersionSeen(): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, CURRENT_VERSION);
  } catch {
    /* storage unavailable — popup may repeat, nothing breaks */
  }
}

/** True for brand-new players (nothing to announce — everything is new). */
export function isFirstRun(): boolean {
  return getLastSeenVersion() === null;
}

/** Show the update popup only to returning players on a new version. */
export function shouldShowUpdatePopup(): boolean {
  const seen = getLastSeenVersion();
  return seen !== null && seen !== CURRENT_VERSION;
}

/** Case-insensitive search across version, title and all note lines. */
export function searchPatchNotes(query: string): PatchNote[] {
  const q = query.trim().toLowerCase();
  if (!q) return PATCH_NOTES;
  return PATCH_NOTES.filter((n) =>
    [n.version, n.title, n.releaseDate, ...n.newFeatures, ...n.improvements, ...n.bugFixes]
      .some((s) => s.toLowerCase().includes(q)),
  );
}
