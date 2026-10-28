// @vitest-environment node
// Runs supabase/migrations against PGlite (Postgres compiled to WebAssembly) with a small stand-in
// for Supabase's auth/storage schemas, then checks row-level security as participants and as Nickii.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { OPERATOR_EVENTS, PARTICIPANT_EVENTS } from '@nickii/shared';

const here = import.meta.dirname;
const NICKII = '00000000-0000-0000-0000-00000000000a';
const ALICE = '00000000-0000-0000-0000-0000000000a1';
const BOB = '00000000-0000-0000-0000-0000000000b0';
const STRANGER = '00000000-0000-0000-0000-0000000000cc'; // signed in, never agreed

let db: PGlite;

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(user
    ? `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`
    : `set role anon; select set_config('request.jwt.claim.sub', '', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;

async function fails(sql: string, params: unknown[] = []) {
  await expect(db.query(sql, params)).rejects.toThrow();
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(here, 'supabase_stub.sql'), 'utf8'));
  const dir = join(here, '..', 'migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  await db.exec(`
    insert into auth.users (id) values ('${NICKII}'), ('${ALICE}'), ('${BOB}'), ('${STRANGER}');
    insert into public.operators (user_id) values ('${NICKII}');
  `);
  for (const u of [ALICE, BOB]) {
    await as(u, () => db.query(`select * from public.accept_agreement('v1', 'ios')`));
  }
}, 60_000);

describe('clock', () => {
  it('server_time_ms is callable signed out and close to now', async () => {
    const [r] = await as(null, () => rows<{ t: number }>('select public.server_time_ms() as t'));
    expect(Math.abs(Number(r!.t) - Date.now())).toBeLessThan(5_000);
  });
});

describe('participants', () => {
  it('accept_agreement gives a pseudonym and records consent', async () => {
    const [me] = await as(ALICE, () => rows<{ pseudonym: string; agreed_at: string }>('select * from public.participants'));
    expect(me!.pseudonym).toMatch(/^p_[0-9a-f]{8}$/);
    expect(me!.agreed_at).toBeTruthy();
  });

  it('a participant sees only their own row', async () => {
    const r = await as(ALICE, () => rows<{ id: string }>('select id from public.participants'));
    expect(r.map((x) => x.id)).toEqual([ALICE]);
  });

  it('Nickii sees everyone', async () => {
    const r = await as(NICKII, () => rows('select id from public.participants'));
    expect(r).toHaveLength(2);
  });

  it('participants cannot edit their row directly', async () => {
    await as(ALICE, () => fails(`update public.participants set pseudonym = 'p_me' where id = $1`, [ALICE]));
  });

  it('signed out users read nothing and cannot accept the agreement', async () => {
    await as(null, () => fails('select * from public.participants'));
    await as(null, () => fails(`select public.accept_agreement('v1', 'ios')`));
  });
});

describe('messages', () => {
  it('a participant writes into their own thread, with server time', async () => {
    await as(ALICE, () => db.query(
      `insert into public.messages (participant_id, sender, body, input_method, t_ms) values ($1, 'participant', 'hello', 'typed', 1)`,
      [ALICE]));
    const [m] = await as(ALICE, () => rows<{ t_ms: number }>('select t_ms from public.messages'));
    expect(Math.abs(Number(m!.t_ms) - Date.now())).toBeLessThan(5_000); // backdating to 1 was ignored
  });

  it('a participant cannot write into another thread or as Nickii', async () => {
    await as(ALICE, () => fails(`insert into public.messages (participant_id, sender, body) values ($1, 'participant', 'x')`, [BOB]));
    await as(ALICE, () => fails(`insert into public.messages (participant_id, sender, body) values ($1, 'nickii', 'x')`, [ALICE]));
  });

  it('someone who has not agreed cannot write', async () => {
    await as(STRANGER, () => fails(`insert into public.messages (participant_id, sender, body) values ($1, 'participant', 'x')`, [STRANGER]));
  });

  it('Nickii replies; each participant reads only their own thread', async () => {
    await as(NICKII, () => db.query(`insert into public.messages (participant_id, sender, body) values ($1, 'nickii', 'hi alice')`, [ALICE]));
    await as(NICKII, () => db.query(`insert into public.messages (participant_id, sender, body) values ($1, 'nickii', 'hi bob')`, [BOB]));
    const alice = await as(ALICE, () => rows<{ body: string }>('select body from public.messages order by t_ms'));
    const bob = await as(BOB, () => rows<{ body: string }>('select body from public.messages order by t_ms'));
    expect(alice.map((m) => m.body)).toEqual(['hello', 'hi alice']);
    expect(bob.map((m) => m.body)).toEqual(['hi bob']);
  });

  it('nobody can edit or delete messages', async () => {
    await as(NICKII, () => fails(`update public.messages set body = 'changed'`));
    await as(ALICE, () => fails(`delete from public.messages`));
  });

  it('rejects empty and overlong messages', async () => {
    await as(ALICE, () => fails(`insert into public.messages (participant_id, sender, body) values ($1, 'participant', '')`, [ALICE]));
    await as(ALICE, () => fails(`insert into public.messages (participant_id, sender, body) values ($1, 'participant', repeat('a', 4001))`, [ALICE]));
  });
});

describe('inbox view', () => {
  it('shows who is waiting since when, only to Nickii', async () => {
    await as(BOB, () => db.query(`insert into public.messages (participant_id, sender, body) values ($1, 'participant', 'are you there?')`, [BOB]));
    const inbox = await as(NICKII, () => rows<{ participant_id: string; waiting_since_t_ms: number | null; last_in_body: string | null }>(
      'select participant_id, waiting_since_t_ms, last_in_body from public.inbox'));
    const alice = inbox.find((r) => r.participant_id === ALICE)!;
    const bob = inbox.find((r) => r.participant_id === BOB)!;
    expect(alice.waiting_since_t_ms).toBeNull(); // Nickii answered last
    expect(bob.waiting_since_t_ms).not.toBeNull();
    expect(bob.last_in_body).toBe('are you there?');
    const own = await as(ALICE, () => rows<{ participant_id: string }>('select participant_id from public.inbox'));
    expect(own.map((r) => r.participant_id)).toEqual([ALICE]);
  });
});

describe('push subscriptions', () => {
  it('a participant stores and sees only their own', async () => {
    await as(ALICE, () => db.query(
      `insert into public.push_subscriptions (participant_id, endpoint, p256dh, auth) values ($1, 'https://push.example/a', 'k', 'a')`, [ALICE]));
    await as(BOB, () => fails(
      `insert into public.push_subscriptions (participant_id, endpoint, p256dh, auth) values ($1, 'https://push.example/x', 'k', 'a')`, [ALICE]));
    expect(await as(BOB, () => rows('select * from public.push_subscriptions'))).toHaveLength(0);
    expect(await as(ALICE, () => rows('select * from public.push_subscriptions'))).toHaveLength(1);
  });

  it('web push needs its keys', async () => {
    await as(ALICE, () => fails(
      `insert into public.push_subscriptions (participant_id, endpoint) values ($1, 'https://push.example/nokeys')`, [ALICE]));
  });
});

describe('operator status', () => {
  it('participants read it but cannot change it; Nickii can', async () => {
    const [s] = await as(ALICE, () => rows<{ state: string }>('select state from public.operator_status'));
    expect(s!.state).toBe('away');
    await as(ALICE, () => db.query(`update public.operator_status set state = 'live'`));
    expect((await rows<{ state: string }>('select state from public.operator_status'))[0]!.state).toBe('away');
    await as(NICKII, () => db.query(`update public.operator_status set state = 'live'`));
    expect((await rows<{ state: string }>('select state from public.operator_status'))[0]!.state).toBe('live');
  });

  it('there is only ever one status row', async () => {
    await fails(`insert into public.operator_status (id) values (2)`);
  });
});

describe('holding line', () => {
  it('only Nickii invites; participants arrive, see their position, and leave', async () => {
    await as(ALICE, () => fails(`insert into public.line_entries (participant_id) values ($1)`, [ALICE]));
    await as(NICKII, () => db.query(`insert into public.line_entries (participant_id, invited_t_ms) values ($1, 1000), ($2, 2000)`, [ALICE, BOB]));

    await as(BOB, () => db.query('select public.line_arrive()'));
    const [bobPos] = await as(BOB, () => rows<{ status: string; line_position: number; estimated_wait_ms: number }>(
      'select * from public.my_line_position()'));
    expect(bobPos).toMatchObject({ status: 'waiting', line_position: 2 });
    expect(Number(bobPos!.estimated_wait_ms)).toBe(300_000);

    // Bob only sees his own entry.
    expect(await as(BOB, () => rows('select * from public.line_entries'))).toHaveLength(1);
    // Bob cannot make himself live.
    await as(BOB, () => db.query(`update public.line_entries set status = 'live'`));
    expect((await rows<{ status: string }>(`select status from public.line_entries where participant_id = $1`, [BOB]))[0]!.status).toBe('waiting');

    await as(BOB, () => db.query('select public.line_leave()'));
    expect(await as(BOB, () => rows('select * from public.my_line_position()'))).toHaveLength(0);
  });

  it('allows only one direct transmission at a time and one open entry per participant', async () => {
    await as(NICKII, () => db.query(`update public.line_entries set status = 'live' where participant_id = $1 and status = 'invited'`, [ALICE]));
    await as(NICKII, () => db.query(`insert into public.line_entries (participant_id) values ($1)`, [BOB]));
    await as(NICKII, () => fails(`update public.line_entries set status = 'live' where participant_id = $1 and status = 'invited'`, [BOB]));
    await as(NICKII, () => fails(`insert into public.line_entries (participant_id) values ($1)`, [ALICE]));
  });
});

describe('events', () => {
  it('accepts every event name from types.ts and rejects others', async () => {
    for (const name of PARTICIPANT_EVENTS) {
      await as(ALICE, () => db.query(`insert into public.participant_events (participant_id, name, t_ms) values ($1, $2, 1)`, [ALICE, name]));
    }
    for (const name of OPERATOR_EVENTS) {
      await as(NICKII, () => db.query(`insert into public.operator_events (name, t_ms) values ($1, 1)`, [name]));
    }
    await as(ALICE, () => fails(`insert into public.participant_events (participant_id, name, t_ms) values ($1, 'made_up', 1)`, [ALICE]));
    await as(NICKII, () => fails(`insert into public.operator_events (name, t_ms) values ('made_up', 1)`));
  });

  it('participants cannot read events or write operator events', async () => {
    expect(await as(ALICE, () => rows('select * from public.participant_events'))).toHaveLength(0);
    await as(ALICE, () => fails(`insert into public.operator_events (name, t_ms) values ('state_live', 1)`));
    await as(ALICE, () => fails(`insert into public.participant_events (participant_id, name, t_ms) values ($1, 'app_open', 1)`, [BOB]));
    expect(await as(NICKII, () => rows('select * from public.participant_events'))).toHaveLength(PARTICIPANT_EVENTS.length);
  });

  it('clock sync is operator only', async () => {
    await as(NICKII, () => db.query(`insert into public.clock_sync (device, offset_ms, round_trip_ms) values ('face-capture', 12.5, 40)`));
    await as(ALICE, () => fails(`insert into public.clock_sync (device, offset_ms, round_trip_ms) values ('x', 0, 0)`));
  });
});

describe('face_chunks storage', () => {
  it('bucket exists, is private, and only Nickii can upload or read', async () => {
    const [b] = await rows<{ public: boolean }>(`select public from storage.buckets where id = 'face_chunks'`);
    expect(b!.public).toBe(false);
    await as(NICKII, () => db.query(`insert into storage.objects (bucket_id, name) values ('face_chunks', '2026-10-12/face_2026-10-12_10-00.csv.gz')`));
    await as(ALICE, () => fails(`insert into storage.objects (bucket_id, name) values ('face_chunks', 'x')`));
    expect(await as(ALICE, () => rows(`select * from storage.objects`))).toHaveLength(0);
    expect(await as(NICKII, () => rows(`select * from storage.objects`))).toHaveLength(1);
  });
});

describe('presence and console stats (0002)', () => {
  it('participants report presence; only Nickii sees it; a non-consented user is ignored', async () => {
    await as(ALICE, () => db.query(`select public.report_presence(true, 'chat', 'ios')`));
    await as(BOB, () => db.query(`select public.report_presence(false, 'line', 'android')`));
    await as(STRANGER, () => db.query(`select public.report_presence(true, 'chat', 'ios')`));
    expect(await as(ALICE, () => rows('select * from public.participant_presence'))).toHaveLength(0);
    const seen = await as(NICKII, () => rows<{ participant_id: string; visible: boolean }>('select participant_id, visible from public.participant_presence order by participant_id'));
    expect(seen).toEqual([{ participant_id: ALICE, visible: true }, { participant_id: BOB, visible: false }]);
  });

  it('console_stats counts installed, online, waiting, line and today; participants get nothing', async () => {
    const [s] = await as(NICKII, () => rows<Record<string, number>>(`select * from public.console_stats('Europe/Vienna')`));
    expect(s).toMatchObject({ installed: 2, with_push: 1, online_now: 1, open_now: 2, live_now: 1 });
    expect(Number(s!.messages_in_today)).toBeGreaterThanOrEqual(2);
    expect(Number(s!.messages_out_today)).toBeGreaterThanOrEqual(2);
    expect(Number(s!.installed_today)).toBe(2);
    expect(await as(ALICE, () => rows(`select * from public.console_stats()`))).toHaveLength(0);
  });

  it('someone not seen for 90 s is no longer online', async () => {
    await db.query(`update public.participant_presence set last_seen_t_ms = last_seen_t_ms - 100000 where participant_id = $1`, [ALICE]);
    const [s] = await as(NICKII, () => rows<{ online_now: number }>(`select online_now from public.console_stats()`));
    expect(s!.online_now).toBe(0);
  });
});
