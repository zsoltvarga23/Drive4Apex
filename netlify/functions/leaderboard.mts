import { getStore } from '@netlify/blobs';

/**
 * Shared leaderboard backend for Drive4Apex — a Netlify Function backed by
 * Netlify Blobs, deployed automatically with the site (no external service).
 *
 * API (same-origin, routed to /api/leaderboard):
 *   GET  ?board=careers                     -> CareerRow[]
 *   GET  ?board=records&track=gp&mode=lap   -> TimeEntry[]
 *   POST { type: 'time', track, mode, entry }   submit a lap/sprint time
 *   POST { type: 'career', row }                upsert a player's career row
 *
 * Server-side validation re-checks everything the client checks: times must
 * be physically plausible per track, names are sanitized (they are rendered
 * on other players' machines), car ids must exist, career stats must be
 * internally consistent. This is honest-player protection, not cryptographic
 * anti-cheat — there is no account system by design.
 */

interface TimeEntry {
  pid: string;
  name: string;
  carId: string;
  time: number;
  date: string;
}

interface CareerRow {
  pid: string;
  name: string;
  wins: number;
  level: number;
  creditsEarned: number;
  credits: number;
  races: number;
  podiums: number;
}

const TRACKS = ['gp', 'endurance', 'canyon'];
const MODES = ['lap', 'sprint'];

/** Fastest physically possible lap/run per track (seconds), with margin. */
const MIN_TIME: Record<string, number> = { gp: 27, endurance: 21, canyon: 19 };

/** Mirror of the client roster (keep in sync with src/config/cars.ts). */
const CAR_CLASS: Record<string, string> = {
  comet: 'sport',
  viper: 'super',
  roadboss: 'muscle',
  pixie: 'compact',
  classico: 'classic',
  tarmac: 'sport',
  ax1: 'formula',
};

const RECORDS_CAP = 200;
const CAREERS_CAP = 500;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const cleanName = (raw: unknown): string =>
  String(raw ?? '').replace(/[<>&"'`]/g, '').trim().slice(0, 16) || 'Anonymous';

const validPid = (pid: unknown): pid is string =>
  typeof pid === 'string' && pid.length >= 8 && pid.length <= 64;

export default async (req: Request): Promise<Response> => {
  const store = getStore('leaderboards');
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (url.searchParams.get('board') === 'careers') {
      return json((await store.get('careers', { type: 'json' })) ?? []);
    }
    const track = url.searchParams.get('track') ?? '';
    const mode = url.searchParams.get('mode') ?? '';
    if (!TRACKS.includes(track) || !MODES.includes(mode)) return json({ error: 'bad params' }, 400);
    return json((await store.get(`records:${track}:${mode}`, { type: 'json' })) ?? []);
  }

  if (req.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'bad json' }, 400);
    }

    if (body.type === 'time') {
      const track = String(body.track ?? '');
      const mode = String(body.mode ?? '');
      if (!TRACKS.includes(track) || !MODES.includes(mode)) return json({ error: 'bad params' }, 400);
      const e = (body.entry ?? {}) as Partial<TimeEntry>;
      const time = Number(e.time);
      if (!isFinite(time) || time < (MIN_TIME[track] ?? 20) || time > 1800) {
        return json({ error: 'implausible time' }, 422);
      }
      if (!validPid(e.pid)) return json({ error: 'bad pid' }, 400);
      const carId = String(e.carId ?? '');
      if (!(carId in CAR_CLASS)) return json({ error: 'unknown car' }, 400);

      const entry: TimeEntry = {
        pid: e.pid,
        name: cleanName(e.name),
        carId,
        time: Math.round(time * 1000) / 1000,
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) ? String(e.date) : new Date().toISOString().slice(0, 10),
      };

      const key = `records:${track}:${mode}`;
      const board: TimeEntry[] = ((await store.get(key, { type: 'json' })) as TimeEntry[]) ?? [];

      // One entry per player per vehicle class.
      const cls = CAR_CLASS[carId];
      const existing = board.findIndex((x) => x.pid === entry.pid && CAR_CLASS[x.carId] === cls);
      if (existing >= 0) {
        if (board[existing].time <= entry.time) {
          // Not an improvement — still refresh the nickname.
          board[existing].name = entry.name;
          await store.setJSON(key, board);
          return json({ ok: true, improved: false });
        }
        board.splice(existing, 1);
      }
      // Keep this player's nickname consistent across their entries.
      for (const x of board) if (x.pid === entry.pid) x.name = entry.name;
      board.push(entry);
      board.sort((a, b) => a.time - b.time);
      if (board.length > RECORDS_CAP) board.length = RECORDS_CAP;
      await store.setJSON(key, board);
      return json({ ok: true, improved: true });
    }

    if (body.type === 'career') {
      const r = (body.row ?? {}) as Partial<CareerRow>;
      if (!validPid(r.pid)) return json({ error: 'bad pid' }, 400);
      const num = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
      const row: CareerRow = {
        pid: r.pid,
        name: cleanName(r.name),
        wins: num(r.wins, 1e6),
        podiums: num(r.podiums, 1e6),
        races: num(r.races, 1e7),
        level: num(r.level, 10000),
        creditsEarned: num(r.creditsEarned, 1e9),
        credits: num(r.credits, 1e9),
      };
      if (row.wins > row.races || row.podiums > row.races) return json({ error: 'inconsistent stats' }, 422);

      const careers: CareerRow[] = ((await store.get('careers', { type: 'json' })) as CareerRow[]) ?? [];
      const i = careers.findIndex((x) => x.pid === row.pid);
      if (i >= 0) careers[i] = row;
      else careers.push(row);
      careers.sort((a, b) => b.wins - a.wins || b.level - a.level || b.creditsEarned - a.creditsEarned);
      if (careers.length > CAREERS_CAP) careers.length = CAREERS_CAP;
      await store.setJSON('careers', careers);
      return json({ ok: true });
    }

    return json({ error: 'unknown type' }, 400);
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/leaderboard' };
