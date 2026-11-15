import { describe, expect, it } from 'vitest';
import { headPoints, seededRandom } from './head_points';

describe('headPoints', () => {
  it('gives about the asked number of points, the same every time', () => {
    const a = headPoints(500);
    const b = headPoints(500);
    expect(a.length).toBeGreaterThan(350);
    expect(a.length).toBeLessThan(700);
    expect(a).toEqual(b);
    expect(headPoints(500, 99)).not.toEqual(a);
  });

  it('has head proportions: about 1 tall, narrower than tall, face looking along +z', () => {
    const p = headPoints(3000);
    const span = (k: 'x' | 'y' | 'z') => Math.max(...p.map((q) => q[k])) - Math.min(...p.map((q) => q[k]));
    expect(span('y')).toBeGreaterThan(0.9);
    expect(span('y')).toBeLessThan(1.1);
    expect(span('x')).toBeLessThan(span('y'));
    const front = p.filter((q) => q.z > 0).length;
    expect(front / p.length).toBeGreaterThan(0.6); // more points on the face
    expect(front / p.length).toBeLessThan(0.85);
  });

  it('is brighter on the face than on the back', () => {
    const p = headPoints(2000);
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    expect(avg(p.filter((q) => q.z > 0.2).map((q) => q.a))).toBeGreaterThan(avg(p.filter((q) => q.z < -0.2).map((q) => q.a)));
  });

  it('seededRandom stays in [0, 1)', () => {
    const r = seededRandom(3);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
