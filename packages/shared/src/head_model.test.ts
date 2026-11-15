import { describe, expect, it } from 'vitest';
import {
  decodeHead, encodeHead, parseObj, parsePly, parseScan, scanToHead, ScanFormatError, type ScanMesh,
} from './head_model';

/** A fake head scan: an egg (taller than wide) with a nose bump at +z, standing on a "neck" cylinder, plus a far-away wall. */
function fakeScan(opts: { withWall?: boolean; up?: 'y' | 'z' } = {}): ScanMesh {
  const pos: number[] = [];
  const col: number[] = [];
  const add = (x: number, y: number, z: number, c = 0.8) => {
    if (opts.up === 'z') pos.push(x, -z, y); else pos.push(x, y, z);
    col.push(c, c, c);
  };
  for (let i = 0; i < 4000; i++) {
    const u = (i / 4000) * 2 - 1, t = i * 2.399963;
    const s = Math.sqrt(1 - u * u);
    const nose = Math.sin(t) > 0.95 && Math.abs(u) < 0.2 ? 0.02 : 0;
    add(0.075 * s * Math.cos(t), 1.6 + 0.12 * u, (0.09 + nose) * s * Math.sin(t)); // metres, head centre 1.6 m up
  }
  for (let i = 0; i < 600; i++) add(0.05 * Math.cos(i), 1.42 - (i % 30) * 0.004, 0.05 * Math.sin(i), 0.3); // neck
  if (opts.withWall) for (let i = 0; i < 2000; i++) add(-1 + (i % 50) * 0.04, 0.8 + Math.floor(i / 50) * 0.04, -1.5, 0.5);
  return { positions: Float32Array.from(pos), colors: Float32Array.from(col), triangles: null };
}

describe('parsePly', () => {
  const ascii = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 1
property list uchar int vertex_indices
end_header
0 0 0 255 0 0
1 0 0 0 255 0
1 1 0 0 0 255
0 1 0 255 255 255
4 0 1 2 3
`;

  it('reads ASCII PLY with colours and turns a quad into two triangles', () => {
    const m = parsePly(new TextEncoder().encode(ascii).buffer);
    expect(Array.from(m.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(Array.from(m.colors!.slice(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(m.triangles!)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('reads binary little-endian PLY (what iPhone scanning apps usually export)', () => {
    const header = 'ply\nformat binary_little_endian 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n';
    const h = new TextEncoder().encode(header);
    const buf = new ArrayBuffer(h.length + 2 * 15);
    new Uint8Array(buf).set(h);
    const v = new DataView(buf, h.length);
    [[1.5, -2, 3, 10, 20, 30], [4, 5, 6.25, 255, 0, 128]].forEach((r, i) => {
      const o = i * 15;
      v.setFloat32(o, r[0]!, true); v.setFloat32(o + 4, r[1]!, true); v.setFloat32(o + 8, r[2]!, true);
      v.setUint8(o + 12, r[3]!); v.setUint8(o + 13, r[4]!); v.setUint8(o + 14, r[5]!);
    });
    const m = parsePly(buf);
    expect(Array.from(m.positions)).toEqual([1.5, -2, 3, 4, 5, 6.25]);
    expect(m.colors![3]).toBeCloseTo(1);
    expect(m.triangles).toBeNull();
  });

  it('explains what is wrong with a bad file', () => {
    expect(() => parsePly(new TextEncoder().encode('hello').buffer)).toThrow(ScanFormatError);
    expect(() => parseScan('head.usdz', new ArrayBuffer(4))).toThrow(/PLY or OBJ/);
  });
});

describe('parseObj', () => {
  it('reads vertices, vertex colours and faces (with negative and slashed indices)', () => {
    const m = parseObj('# scan\nv 0 0 0 1 0 0\nv 1 0 0 0 1 0\nv 1 1 0 0 0 1\nv 0 1 0 1 1 1\nf 1/1/1 2/2/2 3/3/3\nf -4 -2 -1\n');
    expect(m.positions.length).toBe(12);
    expect(Array.from(m.triangles!)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(m.colors![0]).toBe(1);
  });

  it('works without colours', () => {
    expect(parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n').colors).toBeNull();
  });
});

describe('scanToHead', () => {
  const span = (p: { x: number; y: number; z: number }[], k: 'x' | 'y' | 'z') =>
    Math.max(...p.map((q) => q[k])) - Math.min(...p.map((q) => q[k]));

  it('centres the head and makes it 1 unit tall, with the asked number of dots', () => {
    const head = scanToHead(fakeScan(), { points: 1500 });
    expect(head).toHaveLength(1500);
    expect(span(head, 'y')).toBeCloseTo(1, 2);
    expect(Math.abs(head.reduce((s, p) => s + p.x, 0) / head.length)).toBeLessThan(0.05);
    expect(head.every((p) => p.a >= 0 && p.a <= 1)).toBe(true);
  });

  it('cropping the bottom removes the neck', () => {
    const full = scanToHead(fakeScan(), { points: 2000 });
    const cropped = scanToHead(fakeScan(), { points: 2000, cropBottom: 0.25 });
    // The neck makes the full version taller relative to its width.
    expect(span(cropped, 'x') / span(cropped, 'y')).toBeGreaterThan(span(full, 'x') / span(full, 'y'));
  });

  it('keep-radius removes a wall scanned behind the head', () => {
    const withWall = scanToHead(fakeScan({ withWall: true }), { points: 2000, keepRadius: 0.3 });
    expect(span(withWall, 'x')).toBeLessThan(1); // without cropping the 2 m wall would dominate
  });

  it('fixes a Z-up scan with the up option', () => {
    const head = scanToHead(fakeScan({ up: 'z' }), { points: 1500, up: 'z', cropBottom: 0.2 });
    expect(span(head, 'y')).toBeCloseTo(1, 2);
    expect(span(head, 'x')).toBeLessThan(span(head, 'y')); // taller than wide again
  });

  it('a quarter turn swaps width and depth', () => {
    const a = scanToHead(fakeScan(), { points: 1500, cropBottom: 0.25 });
    const b = scanToHead(fakeScan(), { points: 1500, cropBottom: 0.25, turn: 1 });
    expect(span(b, 'x')).toBeCloseTo(span(a, 'z'), 1);
  });

  it('samples evenly over a mesh surface, not only at the corners', () => {
    const quad = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n');
    const head = scanToHead(quad, { points: 500 });
    expect(head).toHaveLength(500);
    const inside = head.filter((p) => Math.abs(p.x) < 0.3 && Math.abs(p.y) < 0.3).length;
    expect(inside / head.length).toBeGreaterThan(0.2); // ~36% of the area
  });

  it('is the same every time for the same scan and settings', () => {
    expect(scanToHead(fakeScan(), { points: 300 })).toEqual(scanToHead(fakeScan(), { points: 300 }));
  });
});

describe('encodeHead / decodeHead', () => {
  it('round-trips and is 16 bytes per dot', () => {
    const head = scanToHead(fakeScan(), { points: 1000 });
    const buf = encodeHead(head);
    expect(buf.byteLength).toBe(8 + 1000 * 16);
    const back = decodeHead(buf);
    expect(back).toHaveLength(1000);
    expect(back[7]!.x).toBeCloseTo(head[7]!.x, 5);
    expect(back[7]!.a).toBeCloseTo(head[7]!.a, 5);
  });

  it('refuses other files', () => {
    expect(() => decodeHead(new ArrayBuffer(16))).toThrow(ScanFormatError);
    expect(() => decodeHead(encodeHead([{ x: 0, y: 0, z: 0, a: 1 }]).slice(0, 12))).toThrow(/incomplete/);
  });
});
