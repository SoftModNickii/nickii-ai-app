import type { InboxRow } from '@nickii/shared';
import { describe, expect, it } from 'vitest';
import { ComposeTiming, type ComposeEvent } from './compose_timing';
import { faceHealth } from './face_health';
import { formatWait, sortInbox, waitingCount } from './inbox_order';

const row = (id: string, over: Partial<InboxRow>): InboxRow => ({
  participant_id: id, pseudonym: `p_${id}`, last_in_t_ms: null, last_in_body: null, last_out_t_ms: null,
  waiting_since_t_ms: null, ...over,
});

describe('sortInbox', () => {
  it('longest waiting first, then the rest by latest activity', () => {
    const rows = [
      row('answered-old', { last_in_t_ms: 100, last_out_t_ms: 200 }),
      row('waiting-short', { waiting_since_t_ms: 900, last_in_t_ms: 900 }),
      row('answered-new', { last_in_t_ms: 500, last_out_t_ms: 600 }),
      row('waiting-long', { waiting_since_t_ms: 300, last_in_t_ms: 950 }),
      row('silent', {}),
    ];
    expect(sortInbox(rows).map((r) => r.participant_id))
      .toEqual(['waiting-long', 'waiting-short', 'answered-new', 'answered-old', 'silent']);
    expect(waitingCount(rows)).toBe(2);
  });

  it('does not change the input array', () => {
    const rows = [row('a', {}), row('b', { waiting_since_t_ms: 1 })];
    sortInbox(rows);
    expect(rows[0]!.participant_id).toBe('a');
  });
});

describe('formatWait', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatWait(45_000)).toBe('45 s');
    expect(formatWait(12 * 60_000 + 5_000)).toBe('12 min');
    expect(formatWait(3 * 3_600_000 + 5 * 60_000)).toBe('3 h 05');
    expect(formatWait(-5)).toBe('0 s');
  });
});

describe('ComposeTiming', () => {
  function setup() {
    const events: ComposeEvent[] = [];
    return { t: new ComposeTiming((e) => events.push(e)), events };
  }

  it('start, pause, delete run, send with totals', () => {
    const { t, events } = setup();
    t.input(1000, 'insertText', 0, 1);
    t.input(1100, 'insertText', 1, 2);
    t.input(4100, 'insertText', 2, 3);          // 3 s pause
    t.input(4200, 'deleteContentBackward', 3, 2);
    t.input(4300, 'deleteContentBackward', 2, 1); // same run
    t.input(4400, 'insertText', 1, 2);          // ends the run
    t.send(5000, 2);
    expect(events.map((e) => e.name)).toEqual(['compose_start', 'compose_pause', 'compose_delete', 'compose_send']);
    expect(events[1]).toEqual({ name: 'compose_pause', t_ms: 1100, data: { pause_ms: 3000 } });
    expect(events[2]).toEqual({ name: 'compose_delete', t_ms: 4200, data: { chars: 2 } });
    expect(events[3]).toEqual({
      name: 'compose_send', t_ms: 5000, data: { chars: 2, compose_ms: 4000, pauses: 1, deletes: 1, deleted_chars: 2 },
    });
    expect(t.active).toBe(false);
  });

  it('a select-all delete counts all removed characters', () => {
    const { t, events } = setup();
    t.input(0, 'insertText', 0, 10);
    t.input(100, 'deleteContentBackward', 10, 0);
    t.send(200, 0);
    expect(events.find((e) => e.name === 'compose_delete')!.data).toEqual({ chars: 10 });
  });

  it('abandon records nothing more and starts fresh', () => {
    const { t, events } = setup();
    t.input(0, 'insertText', 0, 3);
    t.abandon();
    t.input(10_000, 'insertText', 0, 1);
    expect(events.map((e) => e.name)).toEqual(['compose_start', 'compose_start']);
  });

  it('send without typing (e.g. pasted) still gets a send event', () => {
    const { t, events } = setup();
    t.send(500, 12);
    expect(events).toEqual([{ name: 'compose_send', t_ms: 500, data: { chars: 12, compose_ms: 0, pauses: 0, deletes: 0, deleted_chars: 0 } }]);
  });
});

describe('faceHealth', () => {
  const ok = { fps: 30, face_present: true, pending_chunks: 0, camera_ok: true };

  it('never started / ok / down after 30 s', () => {
    expect(faceHealth(null, 0).level).toBe('never');
    expect(faceHealth({ t_ms: 0, data: ok }, 10_000).level).toBe('ok');
    expect(faceHealth({ t_ms: 0, data: ok }, 31_000).level).toBe('down');
  });

  it('warns about camera, uploads, frame rate and missing face', () => {
    expect(faceHealth({ t_ms: 0, data: { ...ok, camera_ok: false } }, 1).level).toBe('down');
    expect(faceHealth({ t_ms: 0, data: { ...ok, pending_chunks: 5 } }, 1).message).toContain('5 chunks');
    expect(faceHealth({ t_ms: 0, data: { ...ok, fps: 9 } }, 1).message).toContain('9 fps');
    expect(faceHealth({ t_ms: 0, data: { ...ok, face_present: false } }, 1).message).toContain('no face');
  });
});
