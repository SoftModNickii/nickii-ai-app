import { describe, expect, it } from 'vitest';
import { averageFaces, decodeFace, encodeFace, FACE_POINTS, faceDots, snapshotHead, type LandmarkLike } from './face_mask';
import { FACE_MESH_EDGES } from './face_mesh_edges';

/** A fake face in MediaPipe image coordinates: points on a half-ellipsoid, with forehead/chin/eyes/cheeks placed. */
function fakeLandmarks(opts: { roll?: number; shiftX?: number } = {}): LandmarkLike[] {
  const lm: LandmarkLike[] = [];
  for (let i = 0; i < 478; i++) {
    const u = ((i * 0.618) % 1) * 2 - 1, v = ((i * 0.377) % 1) * 2 - 1;
    lm.push({ x: 0.5 + 0.12 * u, y: 0.5 - 0.16 * v, z: -0.08 * Math.sqrt(Math.max(0, 1 - u * u - v * v * 0.5)) });
  }
  const set = (i: number, x: number, y: number, z: number) => { lm[i] = { x, y, z }; };
  set(10, 0.5, 0.33, -0.05); set(152, 0.5, 0.68, -0.05);   // forehead, chin
  set(33, 0.44, 0.45, -0.04); set(263, 0.56, 0.45, -0.04); // eyes
  set(234, 0.38, 0.5, 0.02); set(454, 0.62, 0.5, 0.02);    // cheeks
  set(1, 0.5, 0.52, -0.12);                                  // nose tip
  if (opts.roll || opts.shiftX) {
    const a = opts.roll ?? 0;
    return lm.map((p) => {
      const dx = p.x - 0.5, dy = p.y - 0.5;
      return { x: 0.5 + dx * Math.cos(a) - dy * Math.sin(a) + (opts.shiftX ?? 0), y: 0.5 + dx * Math.sin(a) + dy * Math.cos(a), z: p.z };
    });
  }
  return lm;
}

describe('face mesh edges', () => {
  it('connect the 468 mesh points', () => {
    expect(FACE_MESH_EDGES.length / 2).toBeGreaterThan(1000);
    expect(Math.max(...FACE_MESH_EDGES)).toBeLessThan(FACE_POINTS);
  });
});

describe('encodeFace / decodeFace', () => {
  it('round-trips 468 points in a few kB, y up and z towards the camera', () => {
    const s = encodeFace(fakeLandmarks(), 4 / 3);
    expect(s.length).toBeLessThan(4000);
    const f = decodeFace(s);
    expect(f.length).toBe(468 * 3);
    expect(f[10 * 3 + 1]!).toBeGreaterThan(f[152 * 3 + 1]!); // forehead above chin
    expect(f[1 * 3 + 2]!).toBeGreaterThan(0);                  // nose towards the camera
    expect(f[10 * 3 + 1]!).toBeCloseTo(0.17, 3);
  });
});

describe('faceDots', () => {
  const face = () => decodeFace(encodeFace(fakeLandmarks(), 4 / 3));

  it('makes about 3000 dots with two per edge, face 0.62 tall, nose at the front', () => {
    const d = faceDots(face(), { perEdge: 2 });
    expect(d.length).toBe(468 + (FACE_MESH_EDGES.length / 2) * 2);
    const ys = d.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.55);
    expect(Math.max(...d.map((p) => p.z))).toBeCloseTo(0.42, 3);
    expect(d.every((p) => p.a >= 0.35 && p.a <= 1)).toBe(true);
  });

  it('straightens a tilted face but keeps the tilt for the live mask', () => {
    const tilted = decodeFace(encodeFace(fakeLandmarks({ roll: 0.3 }), 4 / 3));
    const eyes = (d: { x: number; y: number }[]) => Math.abs(d[263]!.y - d[33]!.y);
    expect(eyes(faceDots(tilted, { perEdge: 0 }))).toBeLessThan(0.005);
    expect(eyes(faceDots(tilted, { perEdge: 0, keepPose: true }))).toBeGreaterThan(0.05);
  });

  it('centres the face even when it is off-centre in the camera', () => {
    const d = faceDots(decodeFace(encodeFace(fakeLandmarks({ shiftX: 0.2 }), 4 / 3)), { perEdge: 0 });
    expect(Math.abs((d[10]!.x + d[152]!.x) / 2)).toBeLessThan(0.01);
  });

  it('returns nothing for an incomplete frame', () => {
    expect(faceDots(new Float32Array(30))).toEqual([]);
  });
});

describe('snapshotHead', () => {
  it('averages frames and adds the back of the head', () => {
    const frames = [0, 1, 2].map((k) => decodeFace(encodeFace(fakeLandmarks({ shiftX: k * 0.001 }), 4 / 3)));
    expect(averageFaces(frames).length).toBe(468 * 3);
    const head = snapshotHead(frames);
    const front = head.filter((p) => p.z > 0.2).length;
    const back = head.filter((p) => p.z < -0.1).length;
    expect(front).toBeGreaterThan(1000);
    expect(back).toBeGreaterThan(300);
    const ys = head.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1.1);
  });

  it('is empty without frames', () => {
    expect(snapshotHead([])).toEqual([]);
  });
});
