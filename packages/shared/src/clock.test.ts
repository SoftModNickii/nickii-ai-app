import { describe, expect, it } from 'vitest';
import { ServerClock, bestOffset, offsetFromSample } from './clock';

describe('offsetFromSample', () => {
  it('assumes the server answered halfway through the round trip', () => {
    // Local clock is 1000 ms behind the server; 200 ms round trip.
    const r = offsetFromSample({ clientSendMs: 10_000, serverMs: 11_100, clientReceiveMs: 10_200 });
    expect(r).toEqual({ offsetMs: 1000, roundTripMs: 200 });
  });

  it('gives a negative offset when the local clock is ahead', () => {
    const r = offsetFromSample({ clientSendMs: 5_000, serverMs: 4_550, clientReceiveMs: 5_100 });
    expect(r.offsetMs).toBe(-500);
  });
});

describe('bestOffset', () => {
  it('returns null without samples', () => {
    expect(bestOffset([])).toBeNull();
  });

  it('picks the sample with the shortest round trip', () => {
    const r = bestOffset([
      { clientSendMs: 0, serverMs: 900, clientReceiveMs: 600 },   // rtt 600, offset 600
      { clientSendMs: 1000, serverMs: 2020, clientReceiveMs: 1040 }, // rtt 40, offset 1000
      { clientSendMs: 2000, serverMs: 3100, clientReceiveMs: 2200 }, // rtt 200, offset 1000
    ]);
    expect(r).toEqual({ offsetMs: 1000, roundTripMs: 40 });
  });
});

describe('ServerClock', () => {
  it('starts unsynced with zero offset', () => {
    const c = new ServerClock();
    expect(c.isSynced).toBe(false);
    expect(c.now(1234)).toBe(1234);
  });

  it('adds the offset and rounds to whole ms', () => {
    const c = new ServerClock();
    c.setOffset(250.6);
    expect(c.isSynced).toBe(true);
    expect(c.offset).toBe(250.6);
    expect(c.now(1000)).toBe(1251);
  });
});
