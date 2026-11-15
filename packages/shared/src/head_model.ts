// Nickii's head as a point cloud, from a 3D scan made on iPhone/iPad (LiDAR or the front TrueDepth camera)
// with a scanning app, exported as PLY or OBJ. Pure functions: parse → orient/crop → sample → encode.
// Used by the console (import + preview + publish) and the participant app (decode + show).
// PLY format: http://paulbourke.net/dataformats/ply/   OBJ format: http://paulbourke.net/dataformats/obj/

import { seededRandom, type HeadPoint } from './head_points';

/** Raw scan: positions (x,y,z per vertex), optional colours (r,g,b 0..1), optional triangles (vertex indices). */
export interface ScanMesh {
  positions: Float32Array;
  colors: Float32Array | null;
  triangles: Uint32Array | null;
}

export class ScanFormatError extends Error {}

// ---------------------------------------------------------------- PLY

const PLY_TYPES: Record<string, [size: number, read: (v: DataView, o: number, le: boolean) => number]> = {
  char: [1, (v, o) => v.getInt8(o)], int8: [1, (v, o) => v.getInt8(o)],
  uchar: [1, (v, o) => v.getUint8(o)], uint8: [1, (v, o) => v.getUint8(o)],
  short: [2, (v, o, le) => v.getInt16(o, le)], int16: [2, (v, o, le) => v.getInt16(o, le)],
  ushort: [2, (v, o, le) => v.getUint16(o, le)], uint16: [2, (v, o, le) => v.getUint16(o, le)],
  int: [4, (v, o, le) => v.getInt32(o, le)], int32: [4, (v, o, le) => v.getInt32(o, le)],
  uint: [4, (v, o, le) => v.getUint32(o, le)], uint32: [4, (v, o, le) => v.getUint32(o, le)],
  float: [4, (v, o, le) => v.getFloat32(o, le)], float32: [4, (v, o, le) => v.getFloat32(o, le)],
  double: [8, (v, o, le) => v.getFloat64(o, le)], float64: [8, (v, o, le) => v.getFloat64(o, le)],
};

interface PlyProperty { name: string; type: string; listCount?: string }
interface PlyElement { name: string; count: number; props: PlyProperty[] }

export function parsePly(buf: ArrayBuffer): ScanMesh {
  const bytes = new Uint8Array(buf);
  // Header is ASCII and ends with "end_header\n".
  const marker = 'end_header';
  let headerEnd = -1;
  for (let i = 0; i < Math.min(bytes.length, 65536) - marker.length; i++) {
    if (bytes[i] === 0x65 && String.fromCharCode(...bytes.subarray(i, i + marker.length)) === marker) {
      headerEnd = i + marker.length;
      while (headerEnd < bytes.length && bytes[headerEnd] !== 0x0a) headerEnd++;
      headerEnd++;
      break;
    }
  }
  if (headerEnd < 0) throw new ScanFormatError('Not a PLY file (no end_header).');
  const header = new TextDecoder().decode(bytes.subarray(0, headerEnd)).split(/\r?\n/);
  if (header[0]?.trim() !== 'ply') throw new ScanFormatError('Not a PLY file.');
  let format = '';
  const elements: PlyElement[] = [];
  for (const line of header) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'format') format = w[1] ?? '';
    else if (w[0] === 'element') elements.push({ name: w[1]!, count: Number(w[2]), props: [] });
    else if (w[0] === 'property' && elements.length) {
      const el = elements[elements.length - 1]!;
      if (w[1] === 'list') el.props.push({ name: w[4]!, type: w[3]!, listCount: w[2]! });
      else el.props.push({ name: w[2]!, type: w[1]! });
    }
  }
  const vertexEl = elements.find((e) => e.name === 'vertex');
  if (!vertexEl || vertexEl.count === 0) throw new ScanFormatError('The PLY file has no points.');
  const idx = (n: string) => vertexEl.props.findIndex((p) => p.name === n);
  const [ix, iy, iz] = [idx('x'), idx('y'), idx('z')];
  if (ix < 0 || iy < 0 || iz < 0) throw new ScanFormatError('The PLY file has no x/y/z.');
  const ir = Math.max(idx('red'), idx('r')), ig = Math.max(idx('green'), idx('g')), ib = Math.max(idx('blue'), idx('b'));
  const hasColor = ir >= 0 && ig >= 0 && ib >= 0;
  const colorScale = hasColor && /float|double/.test(vertexEl.props[ir]!.type) ? 1 : 1 / 255;

  const positions = new Float32Array(vertexEl.count * 3);
  const colors = hasColor ? new Float32Array(vertexEl.count * 3) : null;
  const tris: number[] = [];

  const takeVertex = (i: number, vals: number[]) => {
    positions[i * 3] = vals[ix]!; positions[i * 3 + 1] = vals[iy]!; positions[i * 3 + 2] = vals[iz]!;
    if (colors) {
      colors[i * 3] = vals[ir]! * colorScale; colors[i * 3 + 1] = vals[ig]! * colorScale; colors[i * 3 + 2] = vals[ib]! * colorScale;
    }
  };
  const takeFace = (ids: number[]) => {
    for (let k = 1; k + 1 < ids.length; k++) tris.push(ids[0]!, ids[k]!, ids[k + 1]!); // fan
  };

  if (format === 'ascii') {
    const lines = new TextDecoder().decode(bytes.subarray(headerEnd)).split(/\r?\n/);
    let li = 0;
    for (const el of elements) {
      for (let i = 0; i < el.count; i++) {
        const w = (lines[li++] ?? '').trim().split(/\s+/).map(Number);
        if (el === vertexEl) takeVertex(i, w);
        else if (el.name === 'face' && el.props[0]?.listCount) takeFace(w.slice(1, 1 + w[0]!));
      }
    }
  } else if (format === 'binary_little_endian' || format === 'binary_big_endian') {
    const le = format === 'binary_little_endian';
    const view = new DataView(buf, headerEnd);
    let o = 0;
    const read = (type: string) => {
      const t = PLY_TYPES[type];
      if (!t) throw new ScanFormatError(`Unknown PLY type ${type}.`);
      const v = t[1](view, o, le);
      o += t[0];
      return v;
    };
    for (const el of elements) {
      for (let i = 0; i < el.count; i++) {
        const vals: number[] = [];
        let list: number[] | null = null;
        for (const p of el.props) {
          if (p.listCount) {
            const n = read(p.listCount);
            const l: number[] = [];
            for (let k = 0; k < n; k++) l.push(read(p.type));
            if (!list) list = l;
          } else vals.push(read(p.type));
        }
        if (el === vertexEl) takeVertex(i, vals);
        else if (el.name === 'face' && list) takeFace(list);
      }
    }
  } else {
    throw new ScanFormatError(`PLY format "${format}" is not supported.`);
  }
  return { positions, colors, triangles: tris.length ? Uint32Array.from(tris) : null };
}

// ---------------------------------------------------------------- OBJ

export function parseObj(text: string): ScanMesh {
  const pos: number[] = [];
  const col: number[] = [];
  const tris: number[] = [];
  let colored = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const w = line.split(/\s+/).slice(1).map(Number);
      pos.push(w[0]!, w[1]!, w[2]!);
      if (w.length >= 6) col.push(w[3]!, w[4]!, w[5]!); else colored = false;
    } else if (line.startsWith('f ')) {
      const count = pos.length / 3;
      const ids = line.split(/\s+/).slice(1).map((t) => {
        const n = parseInt(t.split('/')[0]!, 10);
        return n < 0 ? count + n : n - 1;
      });
      for (let k = 1; k + 1 < ids.length; k++) tris.push(ids[0]!, ids[k]!, ids[k + 1]!);
    }
  }
  if (pos.length === 0) throw new ScanFormatError('The OBJ file has no points.');
  const max = colored && col.length ? Math.max(...col.slice(0, 300)) : 1;
  return {
    positions: Float32Array.from(pos),
    colors: colored && col.length ? Float32Array.from(col, (c) => (max > 1 ? c / 255 : c)) : null,
    triangles: tris.length ? Uint32Array.from(tris) : null,
  };
}

/** Picks the parser from the file name. */
export function parseScan(fileName: string, data: ArrayBuffer): ScanMesh {
  const name = fileName.toLowerCase();
  if (name.endsWith('.ply')) return parsePly(data);
  if (name.endsWith('.obj')) return parseObj(new TextDecoder().decode(data));
  throw new ScanFormatError('Please export the scan as PLY or OBJ.');
}

// ---------------------------------------------------------------- orient, crop, sample

export interface HeadOptions {
  /** Turn around the vertical axis, in quarter turns (so the face looks at the viewer). */
  turn: 0 | 1 | 2 | 3;
  /** Which way the scan's "up" was: most iPhone apps export Y-up, some Z-up. */
  up: 'y' | 'z' | '-z';
  /** Cut away this fraction of the height from the bottom (neck, shoulders, table). 0..0.8 */
  cropBottom: number;
  /** Keep only points within this fraction of the largest distance from the head's centre (removes room). 0.2..1 */
  keepRadius: number;
  /** How many dots. */
  points: number;
  /** Mirror left/right (front-camera scans are often mirrored). */
  mirror: boolean;
}

export const DEFAULT_HEAD_OPTIONS: HeadOptions = { turn: 0, up: 'y', cropBottom: 0, keepRadius: 1, points: 4000, mirror: false };

function orient(x: number, y: number, z: number, o: HeadOptions): [number, number, number] {
  // Up axis to Y.
  if (o.up === 'z') [y, z] = [z, -y];
  else if (o.up === '-z') [y, z] = [-z, y];
  // Quarter turns around Y.
  for (let t = 0; t < o.turn; t++) [x, z] = [z, -x];
  if (o.mirror) x = -x;
  return [x, y, z];
}

/**
 * Turns a raw scan into the dots participants see: oriented, cropped, centred, 1 unit tall
 * (y from -0.5 to 0.5), face towards +z, `points` dots spread evenly over the surface.
 */
export function scanToHead(mesh: ScanMesh, opts: Partial<HeadOptions> = {}, seed = 11): HeadPoint[] {
  const o = { ...DEFAULT_HEAD_OPTIONS, ...opts };
  const rnd = seededRandom(seed);
  const n = mesh.positions.length / 3;

  // 1. Candidate samples: on the triangle surface when there is one (even spacing), else the raw points.
  const want = Math.max(200, Math.min(20000, Math.round(o.points)));
  const oversample = want * 3; // cropping removes some
  const raw: number[] = []; // x,y,z,lum
  const lum = (i: number) => mesh.colors ? 0.2126 * mesh.colors[i * 3]! + 0.7152 * mesh.colors[i * 3 + 1]! + 0.0722 * mesh.colors[i * 3 + 2]! : 0.7;
  if (mesh.triangles && mesh.triangles.length >= 3) {
    const t = mesh.triangles;
    const p = mesh.positions;
    const areas = new Float64Array(t.length / 3);
    let total = 0;
    for (let k = 0; k < areas.length; k++) {
      const a = t[k * 3]! * 3, b = t[k * 3 + 1]! * 3, c = t[k * 3 + 2]! * 3;
      const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
      const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      total += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
      areas[k] = total;
    }
    for (let s = 0; s < oversample && total > 0; s++) {
      const target = rnd() * total;
      let lo = 0, hi = areas.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid]! < target) lo = mid + 1; else hi = mid; }
      let u = rnd(), v = rnd();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const ia = t[lo * 3]!, ib = t[lo * 3 + 1]!, ic = t[lo * 3 + 2]!;
      for (let d = 0; d < 3; d++) raw.push(p[ia * 3 + d]! + u * (p[ib * 3 + d]! - p[ia * 3 + d]!) + v * (p[ic * 3 + d]! - p[ia * 3 + d]!));
      raw.push(lum(ia) * (1 - u - v) + lum(ib) * u + lum(ic) * v);
    }
  } else {
    const step = Math.max(1, n / oversample);
    for (let f = 0; f < n; f += step) {
      const i = Math.floor(f);
      raw.push(mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!, lum(i));
    }
  }

  // 2. Orient.
  const pts: Array<[number, number, number, number]> = [];
  for (let i = 0; i < raw.length; i += 4) {
    const [x, y, z] = orient(raw[i]!, raw[i + 1]!, raw[i + 2]!, o);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) pts.push([x, y, z, raw[i + 3]!]);
  }
  if (pts.length === 0) return [];

  // 3. Crop: bottom part, then everything far from the head's centre (median of the top half: robust to room scans).
  let minY = Infinity, maxY = -Infinity;
  for (const q of pts) { minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
  const cutY = minY + (maxY - minY) * Math.min(0.8, Math.max(0, o.cropBottom));
  let kept = pts.filter((q) => q[1] >= cutY);
  const median = (vals: number[]) => { const s = [...vals].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
  if (o.keepRadius < 1 && kept.length) {
    // Centre = median of the upper half (the head), so shoulders and room do not pull it down.
    const ys = kept.map((q) => q[1]);
    const midY = median(ys);
    const top = kept.filter((q) => q[1] >= midY);
    const cx = median(top.map((q) => q[0])), cy = median(top.map((q) => q[1])), cz = median(top.map((q) => q[2]));
    const dist = kept.map((q) => Math.hypot(q[0] - cx, q[1] - cy, q[2] - cz));
    const maxD = Math.max(...dist);
    const r = maxD * Math.max(0.05, o.keepRadius);
    kept = kept.filter((_, i) => dist[i]! <= r);
  }
  if (kept.length === 0) return [];

  // 4. Centre and scale to 1 unit tall.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of kept) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]);
    y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
    z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
  }
  const scale = 1 / Math.max(1e-9, y1 - y0);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2;

  // 5. Pick `want` of them, evenly spread over the list (already in random surface order for meshes).
  const out: HeadPoint[] = [];
  const stride = kept.length / Math.min(want, kept.length);
  const halfDepth = Math.max(1e-9, (z1 - z0) * scale / 2);
  for (let f = 0; f < kept.length && out.length < want; f += stride) {
    const q = kept[Math.floor(f)]!;
    const x = (q[0] - mx) * scale, y = (q[1] - my) * scale, z = (q[2] - mz) * scale;
    const facing = Math.max(0, z / halfDepth);            // 0 at the back, 1 at the nose
    const a = Math.min(1, 0.25 + 0.45 * facing + 0.3 * q[3]);
    out.push({ x, y, z, a });
  }
  return out;
}

// ---------------------------------------------------------------- storage format

const MAGIC = 0x314b484e; // "NHK1" little-endian

/** Compact binary: magic, count, then x,y,z,a as float32 per dot (16 bytes per dot). */
export function encodeHead(points: HeadPoint[]): ArrayBuffer {
  const buf = new ArrayBuffer(8 + points.length * 16);
  const v = new DataView(buf);
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, points.length, true);
  const f = new Float32Array(buf, 8);
  points.forEach((p, i) => { f[i * 4] = p.x; f[i * 4 + 1] = p.y; f[i * 4 + 2] = p.z; f[i * 4 + 3] = p.a; });
  return buf;
}

export function decodeHead(buf: ArrayBuffer): HeadPoint[] {
  const v = new DataView(buf);
  if (buf.byteLength < 8 || v.getUint32(0, true) !== MAGIC) throw new ScanFormatError('Not a head file.');
  const n = v.getUint32(4, true);
  if (buf.byteLength !== 8 + n * 16) throw new ScanFormatError('Head file is incomplete.');
  const f = new Float32Array(buf, 8, n * 4);
  const out: HeadPoint[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = { x: f[i * 4]!, y: f[i * 4 + 1]!, z: f[i * 4 + 2]!, a: f[i * 4 + 3]! };
  return out;
}
