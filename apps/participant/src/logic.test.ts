import { memoryStorage, type ParticipantEvent } from '@nickii/shared';
import { describe, expect, it } from 'vitest';
import { pickLang } from './copy';
import { EventLog } from './event_log';
import { InputMethodTracker } from './input_method';
import { availableModes, modeAfterLineChange, requestedMode } from './mode';
import { statusLine, type StatusInput } from './status_line';

describe('pickLang', () => {
  it('uses German for any German locale, English otherwise', () => {
    expect(pickLang(['de-AT', 'en'])).toBe('de');
    expect(pickLang(['en-GB', 'de-DE'])).toBe('de');
    expect(pickLang(['fr-FR'])).toBe('en');
    expect(pickLang([])).toBe('en');
  });
});

describe('statusLine', () => {
  const base: StatusInput = {
    mode: 'chat', operatorState: 'live', operatorWord: null, awaitingReply: false, lineStatus: null, online: true,
  };

  it('LISTENING when nothing is pending', () => {
    expect(statusLine(base)).toEqual({ word: 'LISTENING', sentence: 'chatIdle' });
  });

  it("shows Nickii's chosen word while she is live", () => {
    expect(statusLine({ ...base, operatorWord: 'DREAMING' }).word).toBe('DREAMING');
    expect(statusLine({ ...base, operatorWord: 'DREAMING', operatorState: 'away' }).word).toBe('LISTENING');
  });

  it('THINKING while waiting for an answer, with a slower promise when away', () => {
    expect(statusLine({ ...base, awaitingReply: true })).toEqual({ word: 'THINKING', sentence: 'chatThinking' });
    expect(statusLine({ ...base, awaitingReply: true, operatorState: 'away' }).sentence).toBe('chatAway');
  });

  it('DIRECT TRANSMISSION in LIVE, WAITING in LINE', () => {
    expect(statusLine({ ...base, mode: 'live', lineStatus: 'live' }).word).toBe('DIRECT TRANSMISSION');
    expect(statusLine({ ...base, mode: 'line', lineStatus: 'waiting' }).word).toBe('WAITING');
  });

  it('OFFLINE beats everything', () => {
    expect(statusLine({ ...base, mode: 'live', online: false }).word).toBe('OFFLINE');
  });
});

describe('modes', () => {
  it('opens LINE only when invited/waiting and LIVE only when live', () => {
    expect(availableModes(null)).toEqual({ chat: true, line: false, live: false });
    expect(availableModes('waiting')).toEqual({ chat: true, line: true, live: false });
    expect(availableModes('live')).toEqual({ chat: false, line: false, live: true });
    expect(availableModes('done')).toEqual({ chat: true, line: false, live: false });
  });

  it('moves the participant when Nickii acts', () => {
    expect(modeAfterLineChange('chat', null, 'invited')).toBe('line');
    expect(modeAfterLineChange('line', 'waiting', 'live')).toBe('live');
    expect(modeAfterLineChange('live', 'live', 'done')).toBe('chat');
    expect(modeAfterLineChange('line', 'waiting', 'left')).toBe('chat');
  });

  it('lets them stay in CHAT while waiting in the line', () => {
    expect(modeAfterLineChange('chat', 'invited', 'waiting')).toBe('chat');
  });

  it('reads ?mode= only if that mode is open', () => {
    expect(requestedMode('?mode=line', 'invited')).toBe('line');
    expect(requestedMode('?mode=line', null)).toBeNull();
    expect(requestedMode('?mode=nonsense', null)).toBeNull();
    expect(requestedMode('', null)).toBeNull();
  });
});

describe('EventLog', () => {
  function setup(opts: { participant?: string | null; fail?: boolean } = {}) {
    const sent: ParticipantEvent[][] = [];
    const store = memoryStorage();
    let fail = opts.fail ?? false;
    let t = 1000;
    const log = new EventLog({
      store,
      insert: async (events) => {
        if (fail) throw new Error('offline');
        sent.push(events);
      },
      now: () => t++,
      participantId: () => (opts.participant === undefined ? 'p1' : opts.participant),
      batchSize: 2,
    });
    return { log, sent, store, setFail: (v: boolean) => { fail = v; } };
  }

  it('records nothing before the agreement', async () => {
    const { log, sent } = setup({ participant: null });
    log.log('app_open');
    await log.flush();
    expect(sent).toEqual([]);
    expect(log.pending).toBe(0);
  });

  it('keeps events while sending fails', async () => {
    const { log, sent } = setup({ fail: true });
    log.log('app_open');
    log.log('mode_changed', { to: 'line' });
    log.log('message_sent');
    await log.flush();
    expect(log.pending).toBe(3);
    expect(sent).toHaveLength(0);
  });

  it('keeps events across restarts while offline and sends them later', async () => {
    const a = setup({ fail: true });
    a.log.log('app_open');
    await a.log.flush();
    const later = new EventLog({
      store: a.store, insert: async (e) => { a.sent.push(e); }, now: () => 0, participantId: () => 'p1',
    });
    expect(later.pending).toBe(1);
    expect(await later.flush()).toBe(true);
    expect(a.sent[0]![0]).toMatchObject({ name: 'app_open', participant_id: 'p1', t_ms: 1000 });
  });

  it('splits into batches', async () => {
    const { log, sent, setFail } = setup({ fail: true });
    for (let i = 0; i < 5; i++) log.log('app_visible');
    await log.flush();
    setFail(false);
    expect(await log.flush()).toBe(true);
    expect(sent.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it('survives a corrupted stored queue', () => {
    const store = memoryStorage();
    store.set('nickii.event_queue', '{not json');
    const log = new EventLog({ store, insert: async () => {}, now: () => 0, participantId: () => 'p1' });
    expect(log.pending).toBe(0);
  });
});

describe('InputMethodTracker', () => {
  it('typed: about one key per character', () => {
    const t = new InputMethodTracker();
    for (let i = 0; i < 11; i++) t.keyDown();
    expect(t.guess('hello there')).toBe('typed');
  });

  it('dictated: text without key presses', () => {
    const t = new InputMethodTracker();
    t.keyDown(); // e.g. one correction
    expect(t.guess('this sentence came from the microphone')).toBe('dictated');
  });

  it('pasted text is unknown, and reset starts over', () => {
    const t = new InputMethodTracker();
    t.input('insertFromPaste');
    expect(t.guess('pasted')).toBe('unknown');
    t.reset();
    for (let i = 0; i < 6; i++) t.keyDown();
    expect(t.guess('typed!')).toBe('typed');
  });
});

describe('EventLog timing', () => {
  it('an event logged while a batch is being sent is sent too', async () => {
    const sent: string[] = [];
    let release: () => void = () => {};
    const log = new EventLog({
      store: memoryStorage(),
      insert: (events) => new Promise<void>((r) => { release = () => { sent.push(...events.map((e) => e.name)); r(); }; }),
      now: () => 0,
      participantId: () => 'p1',
    });
    log.log('app_open');
    log.log('app_visible'); // queued while the first insert is in flight
    release();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['app_open', 'app_visible']);
    expect(log.pending).toBe(0);
  });
});
