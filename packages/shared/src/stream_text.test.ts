import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { splitForStreaming, streamText, wordDelays } from './stream_text';

describe('splitForStreaming', () => {
  it('joins back to exactly the original text (minus trailing whitespace)', () => {
    const text = 'Hello there.\nHow are  you?  Gut,\tdanke!';
    expect(splitForStreaming(text).join('')).toBe(text);
  });

  it('keeps leading whitespace attached to the next word', () => {
    expect(splitForStreaming('a  b\nc')).toEqual(['a', '  b', '\nc']);
  });

  it('returns nothing for empty or blank text', () => {
    expect(splitForStreaming('')).toEqual([]);
    expect(splitForStreaming('   \n ')).toEqual([]);
  });
});

describe('wordDelays', () => {
  const mid = () => 0.5; // no variation

  it('uses the base delay when there is no jitter', () => {
    expect(wordDelays(['a', ' b'], { baseMs: 50, random: mid })).toEqual([50, 50]);
  });

  it('pauses longer after sentence ends than after commas', () => {
    const [plain, comma, stop] = wordDelays(['word', ' word,', ' word.'], { baseMs: 40, random: mid });
    expect(comma).toBeGreaterThan(plain!);
    expect(stop).toBeGreaterThan(comma!);
  });

  it('never goes below 10 ms', () => {
    expect(wordDelays(['a'], { baseMs: 5, jitter: 1, random: () => 0 })).toEqual([10]);
  });

  it('stays within base ± jitter for plain words', () => {
    const base = 100;
    for (const r of [0, 0.25, 0.75, 0.999]) {
      const [d] = wordDelays(['x'], { baseMs: base, jitter: 0.5, random: () => r });
      expect(d).toBeGreaterThanOrEqual(50);
      expect(d).toBeLessThanOrEqual(150);
    }
  });
});

describe('streamText', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the text growing word by word and marks the last update done', async () => {
    const updates: [string, boolean][] = [];
    const p = streamText('one two three', (s, d) => updates.push([s, d]), { random: () => 0.5 });
    await vi.runAllTimersAsync();
    await p;
    expect(updates).toEqual([['one', false], ['one two', false], ['one two three', true]]);
  });

  it('reports done once for empty text', async () => {
    const updates: [string, boolean][] = [];
    await streamText('', (s, d) => updates.push([s, d]));
    expect(updates).toEqual([['', true]]);
  });

  it('stops when aborted', async () => {
    const updates: string[] = [];
    const ctrl = new AbortController();
    const p = streamText('a b c d', (s) => { updates.push(s); if (updates.length === 2) ctrl.abort(); }, {
      signal: ctrl.signal, random: () => 0.5,
    });
    await vi.runAllTimersAsync();
    await p;
    expect(updates).toEqual(['a', 'a b']);
  });
});
