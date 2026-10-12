import type { InboxRow, LineEntry, Message, OperatorStatus } from '@nickii/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleApp } from './console_app';
import type { ConsoleBackend, OperatorEventInput } from './console_backend';
import type { HeartbeatData } from './face_health';

/** In-memory stand-in for Supabase, enough to drive the console. */
function fakeBackend() {
  const state = {
    loggedIn: false,
    messages: [] as Message[],
    participants: [{ id: 'a', pseudonym: 'p_aaaa' }, { id: 'b', pseudonym: 'p_bbbb' }],
    status: { state: 'away', status_word: 'LISTENING', updated_t_ms: 0 } as OperatorStatus,
    line: [] as LineEntry[],
    events: [] as OperatorEventInput[],
    pushes: [] as Array<{ to: string[] | 'all'; kind: string; body: string }>,
    clockSyncs: 0,
    heartbeat: null as { t_ms: number; data: HeartbeatData } | null,
  };
  let n = 0;
  const msgCbs: Array<(m: Message) => void> = [];
  const add = (participant_id: string, sender: Message['sender'], body: string, t_ms: number) => {
    const m: Message = { id: `m${++n}`, participant_id, sender, body, input_method: null, t_ms, created_at: '' };
    state.messages.push(m);
    msgCbs.forEach((cb) => cb(m));
    return m;
  };
  const inbox = (): InboxRow[] => state.participants.map((p) => {
    const mine = state.messages.filter((m) => m.participant_id === p.id);
    const ins = mine.filter((m) => m.sender === 'participant');
    const outs = mine.filter((m) => m.sender === 'nickii');
    const lastOut = outs.at(-1)?.t_ms ?? null;
    const waiting = ins.filter((m) => m.t_ms > (lastOut ?? 0));
    return {
      participant_id: p.id, pseudonym: p.pseudonym, last_in_t_ms: ins.at(-1)?.t_ms ?? null, last_in_body: ins.at(-1)?.body ?? null,
      last_out_t_ms: lastOut, waiting_since_t_ms: waiting[0]?.t_ms ?? null,
    };
  });
  const backend: ConsoleBackend = {
    restore: async () => state.loggedIn,
    login: async (email, pw) => {
      if (pw !== 'right') return 'wrong';
      if (email !== 'nickii@example.com') return 'not_operator';
      state.loggedIn = true;
      return 'ok';
    },
    logout: async () => { state.loggedIn = false; },
    measureClockOffset: async () => ({ offsetMs: 0, roundTripMs: 20 }),
    saveClockSync: async () => { state.clockSyncs++; },
    loadInbox: async () => inbox(),
    loadThread: async (id) => state.messages.filter((m) => m.participant_id === id),
    onMessage: (cb) => { msgCbs.push(cb); return () => {}; },
    reply: async (id, body) => add(id, 'nickii', body, Date.now() + n),
    broadcast: async (ids, body) => { ids.forEach((id) => add(id, 'nickii', body, Date.now() + n)); },
    push: async (to, kind, body) => { state.pushes.push({ to, kind, body }); return { sent: 1, removed: 0, failed: 0 }; },
    loadStatus: async () => state.status,
    setStatus: async (s) => { state.status = { ...state.status, ...s }; },
    loadLine: async () => state.line.filter((e) => ['invited', 'waiting', 'live'].includes(e.status)),
    onLineChange: () => () => {},
    invite: async (id) => {
      state.line.push({ id: `l${state.line.length}`, participant_id: id, status: 'invited', invited_t_ms: 0, arrived_t_ms: null, started_t_ms: null, ended_t_ms: null });
    },
    updateLine: async (id, change) => { Object.assign(state.line.find((e) => e.id === id)!, change); },
    logEvent: async (e) => { state.events.push(e); },
    lastHeartbeat: async () => state.heartbeat,
    onHeartbeat: () => () => {},
  };
  return { backend, state, participantWrites: (id: string, body: string, t: number) => add(id, 'participant', body, t) };
}

let root: HTMLElement;
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const btn = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
const names = (s: ReturnType<typeof fakeBackend>['state']) => s.events.map((e) => e.name);

async function start(fake = fakeBackend(), loggedIn = true) {
  fake.state.loggedIn = loggedIn;
  root = document.createElement('main');
  document.body.replaceChildren(root);
  const app = new ConsoleApp({ root, backend: fake.backend });
  await app.start();
  await settle();
  return app;
}

beforeEach(() => { vi.stubGlobal('confirm', () => true); });

describe('login', () => {
  it('rejects wrong passwords and non-operators, then lets Nickii in', async () => {
    const fake = fakeBackend();
    const app = await start(fake, false);
    expect(app.screen).toBe('login');
    const [email, pw] = [...root.querySelectorAll('input')];
    const submit = () => root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    email!.value = 'nickii@example.com'; pw!.value = 'nope'; submit(); await settle();
    expect(root.textContent).toContain('Wrong email or password');
    email!.value = 'someone@example.com'; pw!.value = 'right'; submit(); await settle();
    expect(root.textContent).toContain('not an operator');
    email!.value = 'nickii@example.com'; pw!.value = 'right'; submit(); await settle();
    expect(app.screen).toBe('main');
    expect(fake.state.clockSyncs).toBe(1);
    app.stop();
  });

  it('without a server: says so', async () => {
    root = document.createElement('main');
    const app = new ConsoleApp({ root, backend: null });
    await app.start();
    expect(app.screen).toBe('not_configured');
  });
});

describe('inbox and reply', () => {
  it('longest waiting first; reply sends push and compose timing; inbox updates', async () => {
    const fake = fakeBackend();
    const t0 = Date.now();
    fake.participantWrites('b', 'first question', t0 - 60_000);
    fake.participantWrites('a', 'later question', t0 - 5_000);
    const app = await start(fake);

    const items = [...root.querySelectorAll('.inbox li')];
    expect(items.map((li) => li.querySelector('.who')!.textContent)).toEqual(['p_bbbb', 'p_aaaa']);
    expect(items[0]!.querySelector('.when')!.textContent).toBe('1 min');
    expect(root.textContent).toContain('2 waiting');

    (items[0] as HTMLElement).click();
    await settle();
    expect(app.selected).toBe('b');
    const box = root.querySelector<HTMLTextAreaElement>('.composer textarea')!;
    box.value = 'H';
    box.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    box.value = 'Hello';
    box.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }));
    btn('Send').click();
    await settle();

    expect(fake.state.messages.at(-1)).toMatchObject({ participant_id: 'b', sender: 'nickii', body: 'Hello' });
    expect(fake.state.pushes).toEqual([{ to: ['b'], kind: 'reply', body: 'Hello' }]);
    expect(names(fake.state)).toEqual(['thread_opened', 'compose_start', 'compose_send']);
    expect(fake.state.events.every((e) => e.participant_id === 'b')).toBe(true);
    expect(root.querySelector('.inbox li .who')!.textContent).toBe('p_aaaa'); // b answered, a still waits
    expect(box.value).toBe('');
    app.stop();
  });

  it('new participant message appears in the open thread', async () => {
    const fake = fakeBackend();
    const app = await start(fake);
    (root.querySelector('.inbox li') as HTMLElement).click();
    await settle();
    fake.participantWrites(app.selected!, 'are you there', Date.now());
    await settle();
    expect(root.querySelector('.messages')!.textContent).toContain('are you there');
    app.stop();
  });

  it('switching threads logs thread_closed', async () => {
    const fake = fakeBackend();
    const app = await start(fake);
    const items = [...root.querySelectorAll<HTMLElement>('.inbox li')];
    items[0]!.click(); await settle();
    items[1]!.click(); await settle();
    expect(names(fake.state)).toEqual(['thread_opened', 'thread_closed', 'thread_opened']);
    app.stop();
  });
});

describe('controls', () => {
  it('Live/Away switch updates status and logs it', async () => {
    const fake = fakeBackend();
    const app = await start(fake);
    const sw = root.querySelector<HTMLButtonElement>('.switch')!;
    expect(sw.textContent).toContain('AWAY');
    sw.click(); await settle();
    expect(fake.state.status.state).toBe('live');
    expect(sw.textContent).toContain('LIVE');
    sw.click(); await settle();
    expect(names(fake.state)).toEqual(['state_live', 'state_away']);
    app.stop();
  });

  it('push to all writes into every thread and sends one broadcast push', async () => {
    const fake = fakeBackend();
    const app = await start(fake);
    const box = root.querySelector<HTMLTextAreaElement>('.col-control textarea')!;
    box.value = 'Good night, everyone.';
    btn('Send to all').click(); await settle();
    expect(fake.state.messages.filter((m) => m.body === 'Good night, everyone.')).toHaveLength(2);
    expect(fake.state.pushes).toEqual([{ to: 'all', kind: 'broadcast', body: 'Good night, everyone.' }]);
    app.stop();
  });

  it('invite → start → end a direct transmission', async () => {
    const fake = fakeBackend();
    const app = await start(fake);
    (root.querySelector('.inbox li') as HTMLElement).click(); await settle();
    btn('Invite to line').click(); await settle();
    expect(fake.state.line).toHaveLength(1);
    expect(fake.state.pushes.at(-1)!.kind).toBe('line_invite');
    btn('Start').click(); await settle();
    expect(fake.state.line[0]!.status).toBe('live');
    btn('End').click(); await settle();
    expect(fake.state.line[0]!.status).toBe('done');
    expect(names(fake.state)).toEqual(expect.arrayContaining(['line_invite', 'transmission_start', 'transmission_end']));
    app.stop();
  });

  it('face capture: red when there is no heartbeat, green when fresh', async () => {
    const fake = fakeBackend();
    let app = await start(fake);
    expect(root.querySelector('.pill.health-never')).not.toBeNull();
    app.stop();
    fake.state.heartbeat = { t_ms: Date.now(), data: { fps: 30, face_present: true, frames_today: 1200, pending_chunks: 0 } };
    app = await start(fake);
    expect(root.querySelector('.pill.health-ok')!.textContent).toBe('FACE OK');
    expect(root.textContent).toContain('Frames today: 1200');
    app.stop();
  });

  it('keeps operator events that failed to save and sends them later', async () => {
    const fake = fakeBackend();
    const app = await start(fake);
    const real = fake.backend.logEvent;
    fake.backend.logEvent = async () => { throw new Error('offline'); };
    root.querySelector<HTMLButtonElement>('.switch')!.click(); await settle();
    expect(app.pendingEvents).toBe(1);
    fake.backend.logEvent = real;
    root.querySelector<HTMLButtonElement>('.switch')!.click(); await settle();
    expect(app.pendingEvents).toBe(0);
    expect(names(fake.state)).toEqual(['state_live', 'state_away']);
    app.stop();
  });
});
