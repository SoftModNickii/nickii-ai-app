// Nickii's face as dots, from MediaPipe Face Landmarker running on her phone or Mac (front camera).
// 468 face-mesh points per frame (x, y, z). Used two ways:
//  - live mask: frames are sent to the phone in direct transmission, which draws them as dots;
//  - snapshot: a few seconds of frames, averaged and straightened, become the published head (with a
//    generated back of the head, since the camera only sees the face).
// Landmark model: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker

import { FACE_MESH_EDGES } from './face_mesh_edges';
import { headPoints, type HeadPoint } from './head_points';

export const FACE_POINTS = 468;
// Landmark indices (MediaPipe canonical face mesh).
const FOREHEAD = 10, CHIN = 152, EYE_R = 33, EYE_L = 263, CHEEK_R = 234, CHEEK_L = 454;

export interface LandmarkLike { x: number; y: number; z: number }

const Q = 20000; // int16 quantisation: ±1.6 units, 0.05 mm-ish steps; plenty for dots

/**
 * Image landmarks → compact string for sending (about 3.7 kB). Converts to a y-up, aspect-correct space
 * centred on the image: X right, Y up, Z towards the camera.
 */
export function encodeFace(landmarks: readonly LandmarkLike[], aspect: number): string {
  const n = Math.min(FACE_POINTS, landmarks.length);
  const q = new Int16Array(n * 3);
  const clamp = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * Q)));
  for (let i = 0; i < n; i++) {
    const l = landmarks[i]!;
    q[i * 3] = clamp((l.x - 0.5) * aspect);
    q[i * 3 + 1] = clamp(-(l.y - 0.5));
    q[i * 3 + 2] = clamp(-l.z * aspect);
  }
  const bytes = new Uint8Array(q.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function decodeFace(s: string): Float32Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const q = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  return Float32Array.from(q, (v) => v / Q);
}

/** Element-wise average of several frames (steadier snapshot). */
export function averageFaces(frames: readonly Float32Array[]): Float32Array {
  const len = Math.min(...frames.map((f) => f.length));
  const out = new Float32Array(len);
  for (const f of frames) for (let i = 0; i < len; i++) out[i]! += f[i]! / frames.length;
  return out;
}

type V3 = [number, number, number];
const get = (f: Float32Array, i: number): V3 => [f[i * 3]!, f[i * 3 + 1]!, f[i * 3 + 2]!];

function rotateY(p: V3, a: number): V3 { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
function rotateZ(p: V3, a: number): V3 { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }
function rotateX(p: V3, a: number): V3 { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }

export interface FaceDotsOptions {
  /** Extra dots along each mesh edge (0 = only the 468 points; 2 ≈ 3100 dots). */
  perEdge?: number;
  /** Keep the head's turn and tilt (live mask) or straighten it (snapshot). */
  keepPose?: boolean;
}

/**
 * One face frame → dots in head space: face about 0.62 tall (forehead to chin), centred like the face of
 * the 1-unit head, nose pointing to +z. Brighter towards the camera.
 */
export function faceDots(face: Float32Array, opts: FaceDotsOptions = {}): HeadPoint[] {
  const n = Math.min(FACE_POINTS, Math.floor(face.length / 3));
  if (n < FACE_POINTS) return [];
  const perEdge = Math.max(0, Math.min(6, opts.perEdge ?? 2));
  let pts: V3[] = [];
  for (let i = 0; i < n; i++) pts.push(get(face, i));

  // Centre between forehead and chin.
  const top = pts[FOREHEAD]!, chin = pts[CHIN]!;
  const c: V3 = [(top[0] + chin[0]) / 2, (top[1] + chin[1]) / 2, (top[2] + chin[2]) / 2];
  pts = pts.map((p) => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);

  if (!opts.keepPose) {
    // Roll: make the eye line level. Yaw: both cheeks equally deep. Pitch: forehead above chin.
    let [er, el] = [pts[EYE_R]!, pts[EYE_L]!];
    const roll = Math.atan2(el[1] - er[1], el[0] - er[0]);
    pts = pts.map((p) => rotateZ(p, -roll));
    const [cr, cl] = [pts[CHEEK_R]!, pts[CHEEK_L]!];
    const yaw = Math.atan2(cl[2] - cr[2], cl[0] - cr[0]);
    pts = pts.map((p) => rotateY(p, yaw));
    const [t2, c2] = [pts[FOREHEAD]!, pts[CHIN]!];
    const pitch = Math.atan2(t2[2] - c2[2], t2[1] - c2[1]);
    pts = pts.map((p) => rotateX(p, -pitch));
    [er, el] = [pts[EYE_R]!, pts[EYE_L]!];
  }

  // Scale: forehead-to-chin = 0.62; place the face where it sits on the 1-unit head.
  const height = Math.hypot(...(pts[FOREHEAD]!.map((v, k) => v - pts[CHIN]![k]!) as V3)) || 1;
  const s = 0.62 / height;
  let maxZ = -Infinity;
  for (const p of pts) maxZ = Math.max(maxZ, p[2] * s);
  const dz = 0.42 - maxZ; // nose tip at z = 0.42
  const place = (p: V3): V3 => [p[0] * s, p[1] * s - 0.06, p[2] * s + dz];
  const placed = pts.map(place);

  // Dots: the mesh points plus `perEdge` along every edge.
  const out: V3[] = [...placed];
  if (perEdge > 0) {
    for (let e = 0; e < FACE_MESH_EDGES.length; e += 2) {
      const a = placed[FACE_MESH_EDGES[e]!], b = placed[FACE_MESH_EDGES[e + 1]!];
      if (!a || !b) continue;
      for (let k = 1; k <= perEdge; k++) {
        const t = k / (perEdge + 1);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
  }
  let z0 = Infinity, z1 = -Infinity;
  for (const p of out) { z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
  const span = Math.max(1e-6, z1 - z0);
  return out.map((p) => ({ x: p[0], y: p[1], z: p[2], a: 0.35 + 0.65 * ((p[2] - z0) / span) }));
}

/**
 * Snapshot head: averaged face frames, straightened, with a generated back of the head around it.
 * Ask Nickii to look straight into the camera for the few seconds of frames.
 */
export function snapshotHead(frames: readonly Float32Array[], backDots = 1500): HeadPoint[] {
  if (frames.length === 0) return [];
  const face = faceDots(averageFaces(frames), { perEdge: 1, keepPose: false });
  if (face.length === 0) return [];
  // The camera sees only the face. Around it: the generated head's sides and back, narrowed to the
  // face's width so the two meet, and a little dimmer so the face reads first.
  let faceHalfWidth = 0, faceBackZ = Infinity;
  for (const p of face) { faceHalfWidth = Math.max(faceHalfWidth, Math.abs(p.x)); faceBackZ = Math.min(faceBackZ, p.z); }
  const gen = headPoints(Math.round(backDots / 0.6), 23);
  const genHalfWidth = Math.max(...gen.map((p) => Math.abs(p.x))) || 1;
  const sx = (faceHalfWidth * 1.08) / genHalfWidth;
  const back = gen
    .map((p) => ({ x: p.x * sx, y: p.y, z: p.z * sx, a: p.a * 0.7 }))
    .filter((p) => p.z < faceBackZ + 0.04 || p.y > 0.3); // behind the face, plus the top of the head
  return [...face.map((p) => ({ ...p, a: 0.25 + 0.75 * p.a })), ...back];
}
