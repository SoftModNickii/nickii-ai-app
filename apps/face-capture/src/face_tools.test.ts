import type { LandmarkLike, MaskChannel } from '@nickii/shared';
import { describe, expect, it } from 'vitest';
import { headVersion, MaskSender, SnapshotCollector } from './face_tools';

const face = (shift = 0): LandmarkLike[] => Array.from({ length: 478 }, (_, i) => ({
  x: 0.5 + 0.1 * Math.cos(i) + shift, y: 0.5 + 0.15 * Math.sin(i * 1.3), z: -0.05 * Math.abs(Math.sin(i)),
}));

function fakeChannels() {
  const opened: string[] = [];
  const closed: string[] = [];
  const frames: Array<[string, string]> = [];
  const open = (pid: string): MaskChannel => {
    opened.push(pid);
    return { send: async (f) => { frames.push([pid, f]); }, onFrame: () => () => {}, close: async () => { closed.push(pid); } };
  };
  return { open, opened, closed, frames };
}

describe('MaskSender', () => {
  it('sends nothing while nobody is live, then about 12 frames a second to the live participant', async () => {
    const c = fakeChannels();
    const m = new MaskSender(c.open);
    m.frame(0, face(), 4 / 3);
    expect(c.frames).toHaveLength(0);
    m.setTarget('p1');
    for (let i = 0; i < 30; i++) { m.frame(i * 33.3, face(), 4 / 3); await Promise.resolve(); }
    expect(c.frames.length).toBeGreaterThanOrEqual(10);
    expect(c.frames.length).toBeLessThanOrEqual(12);
    expect(c.frames.every(([pid]) => pid === 'p1')).toBe(true);
  });

  it('switches channel when the live participant changes, and stops when switched off', async () => {
    const c = fakeChannels();
    const m = new MaskSender(c.open);
    m.setTarget('p1');
    m.setTarget('p2');
    expect(c.opened).toEqual(['p1', 'p2']);
    expect(c.closed).toEqual(['p1']);
    m.enabled = false;
    m.frame(0, face(), 1);
    await Promise.resolve();
    expect(c.frames).toHaveLength(0);
    m.close();
    expect(c.closed).toEqual(['p1', 'p2']);
  });

  it('ignores frames without a full face', () => {
    const c = fakeChannels();
    const m = new MaskSender(c.open);
    m.setTarget('p1');
    m.frame(0, face().slice(0, 100), 1);
    expect(c.frames).toHaveLength(0);
  });
});

describe('SnapshotCollector', () => {
  it('collects the asked number of face frames and makes a head', async () => {
    const s = new SnapshotCollector(5);
    const done = s.start();
    expect(s.collecting).toBe(true);
    for (let i = 0; i < 5; i++) s.frame(face(i * 0.001), 4 / 3);
    const head = await done;
    expect(s.collecting).toBe(false);
    expect(head.length).toBeGreaterThan(2000);
  });

  it('frames without a face do not count; cancel stops it', () => {
    const s = new SnapshotCollector(3);
    void s.start();
    s.frame([], 1);
    expect(s.progress).toBe(0);
    s.cancel();
    s.frame(face(), 1);
    expect(s.collecting).toBe(false);
  });
});

describe('headVersion', () => {
  it('makes a file-safe name from the time', () => {
    expect(headVersion('snapshot', new Date(2026, 10, 15, 9, 5, 3))).toBe('snapshot_20261115_090503');
  });
});
