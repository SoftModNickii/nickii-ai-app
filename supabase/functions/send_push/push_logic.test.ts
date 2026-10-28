import { describe, expect, it } from 'vitest';
import {
  buildPayload, outcomeForStatus, parsePushRequest, sendToAll, truncateBody,
  type SubscriptionTarget,
} from './push_logic';

describe('parsePushRequest', () => {
  it('accepts a reply to one participant', () => {
    expect(parsePushRequest({ to: ['p1'], kind: 'reply', body: 'hi' })).toEqual({
      to: ['p1'], kind: 'reply', body: 'hi', title: undefined, path: undefined,
    });
  });

  it('accepts a broadcast to all', () => {
    expect(parsePushRequest({ to: 'all', kind: 'broadcast', body: 'hello everyone' }).to).toBe('all');
  });

  it.each([
    [null],
    [{ to: [], kind: 'reply', body: 'x' }],
    [{ to: 'everyone', kind: 'reply', body: 'x' }],
    [{ to: ['p1'], kind: 'spam', body: 'x' }],
    [{ to: ['p1'], kind: 'reply', body: '   ' }],
    [{ to: ['p1'], kind: 'reply', body: 'x', path: 'https://evil.example' }],
  ])('rejects %j', (input) => {
    expect(() => parsePushRequest(input)).toThrow();
  });
});

describe('truncateBody', () => {
  it('leaves short text alone but tidies whitespace', () => {
    expect(truncateBody('  hello\n\nthere ')).toBe('hello there');
  });

  it('cuts long text at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(100);
    const out = truncateBody(long, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('word…')).toBe(true);
  });

  it('cuts a single very long word hard', () => {
    expect(truncateBody('x'.repeat(300), 20)).toBe('x'.repeat(19) + '…');
  });
});

describe('buildPayload', () => {
  const app = 'https://nickii.example';

  it('builds a Declarative Web Push payload', () => {
    const p = buildPayload({ to: ['p1'], kind: 'reply', body: 'Hello you' }, app);
    expect(p.web_push).toBe(8030);
    expect(p.notification).toMatchObject({ title: 'Nickii AI', body: 'Hello you', navigate: 'https://nickii.example/?from=push&kind=reply' });
    expect(p.mutable).toBe(true);
  });

  it('keeps the folder when the app lives under a path (GitHub Pages)', () => {
    const p = buildPayload({ to: ['p1'], kind: 'line_invite', body: 'x' }, 'https://softmodnickii.github.io/nickii-ai-app');
    expect(p.notification.navigate).toBe('https://softmodnickii.github.io/nickii-ai-app/?mode=line&from=push&kind=line_invite');
  });

  it('line invites open the app in the holding line', () => {
    const p = buildPayload({ to: ['p1'], kind: 'line_invite', body: 'Come in' }, app);
    expect(p.notification.navigate).toBe('https://nickii.example/?mode=line&from=push&kind=line_invite');
  });

  it('stays below the 4 kB web push limit with a long reply', () => {
    const p = buildPayload({ to: ['p1'], kind: 'reply', body: 'ä'.repeat(5000) }, app);
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(3000);
  });
});

describe('outcomeForStatus', () => {
  it('maps push service answers', () => {
    expect(outcomeForStatus(201)).toBe('ok');
    expect(outcomeForStatus(404)).toBe('gone');
    expect(outcomeForStatus(410)).toBe('gone');
    expect(outcomeForStatus(429)).toBe('retry');
    expect(outcomeForStatus(503)).toBe('retry');
    expect(outcomeForStatus(400)).toBe('error');
    expect(outcomeForStatus(413)).toBe('error');
  });
});

describe('sendToAll', () => {
  const sub = (id: string): SubscriptionTarget => ({ id, participant_id: 'p', endpoint: `https://push/${id}`, p256dh: 'k', auth: 'a' });
  const noSleep = async () => {};

  it('sorts results into sent, gone and failed', async () => {
    const status: Record<string, number> = { a: 201, b: 410, c: 404, d: 400 };
    const s = await sendToAll([sub('a'), sub('b'), sub('c'), sub('d')], '{}', async (x) => status[x.id]!, { sleep: noSleep });
    expect(s.sent).toEqual(['a']);
    expect(s.gone.sort()).toEqual(['b', 'c']);
    expect(s.failed).toEqual([{ id: 'd', status: 400 }]);
  });

  it('retries once on 5xx, 429 and network errors', async () => {
    const calls: Record<string, number> = {};
    const s = await sendToAll([sub('a'), sub('b'), sub('c')], '{}', async (x) => {
      calls[x.id] = (calls[x.id] ?? 0) + 1;
      if (x.id === 'a') return calls.a === 1 ? 503 : 201;
      if (x.id === 'b') throw new Error('network');
      return 429;
    }, { sleep: noSleep });
    expect(s.sent).toEqual(['a']);
    expect(s.failed).toEqual(expect.arrayContaining([{ id: 'b', status: 0 }, { id: 'c', status: 429 }]));
    expect(calls).toEqual({ a: 2, b: 2, c: 2 });
  });

  it('never runs more than the concurrency limit at once', async () => {
    let running = 0;
    let peak = 0;
    const subs = Array.from({ length: 25 }, (_, i) => sub(String(i)));
    await sendToAll(subs, '{}', async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return 201;
    }, { concurrency: 4 });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles no subscriptions', async () => {
    expect(await sendToAll([], '{}', async () => 201)).toEqual({ sent: [], gone: [], failed: [] });
  });
});
