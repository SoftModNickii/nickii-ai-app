import { describe, expect, it } from 'vitest';
import { FrameThrottle, supabaseMaskChannel } from './mask_channel';

describe('FrameThrottle', () => {
  it('sends at most 12 a second from a 30 fps camera', async () => {
    const t = new FrameThrottle(12);
    let sent = 0;
    for (let i = 0; i < 30; i++) {
      t.offer(i * 33.3, async () => { sent++; });
      await Promise.resolve();
    }
    expect(sent).toBeGreaterThanOrEqual(10);
    expect(sent).toBeLessThanOrEqual(12);
  });

  it('skips frames while a send is slow', () => {
    const t = new FrameThrottle(12);
    let calls = 0;
    const slow = () => { calls++; return new Promise<void>(() => {}); }; // never finishes
    t.offer(0, slow);
    t.offer(1000, slow);
    expect(calls).toBe(1);
  });
});

describe('supabaseMaskChannel', () => {
  function fakeClient() {
    const sent: unknown[] = [];
    let handler: ((p: { payload: unknown }) => void) | null = null;
    let onStatus: ((s: string) => void) | null = null;
    const ch = {
      on: (_t: string, _f: unknown, cb: (p: { payload: unknown }) => void) => { handler = cb; return ch; },
      subscribe: (cb?: (s: string) => void) => { onStatus = cb ?? null; return ch; },
      send: async (m: unknown) => { sent.push(m); },
    };
    return {
      client: { channel: () => ch, removeChannel: async () => {} },
      sent, deliver: (payload: unknown) => handler?.({ payload }), ready: () => onStatus?.('SUBSCRIBED'),
    };
  }

  it('drops frames before it is connected, then sends; delivers only well-formed frames', async () => {
    const f = fakeClient();
    const m = supabaseMaskChannel(f.client as never, 'p1');
    await m.send('A');
    expect(f.sent).toHaveLength(0);
    f.ready();
    await m.send('B');
    expect(f.sent).toEqual([{ type: 'broadcast', event: 'face', payload: { f: 'B' } }]);
    const got: string[] = [];
    m.onFrame((x) => got.push(x));
    f.deliver({ f: 'C' });
    f.deliver({ nope: 1 });
    f.deliver(null);
    expect(got).toEqual(['C']);
  });
});
