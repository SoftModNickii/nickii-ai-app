// Turns one MediaPipe Face Landmarker result into one CSV row:
// t_ms, face_present, 52 blendshapes (fixed order), m00…m33 (row-major), fps_measured.

import { BLENDSHAPE_NAMES, FACE_CSV_HEADER } from '@nickii/shared';

/** The parts of FaceLandmarkerResult we use (kept structural so tests need no MediaPipe). */
export interface FaceResultLike {
  faceBlendshapes: Array<{ categories: Array<{ categoryName: string; score: number }> }>;
  facialTransformationMatrixes: Array<{ rows: number; columns: number; data: number[] }>;
}

const INDEX = new Map(BLENDSHAPE_NAMES.map((n, i) => [n as string, i]));
export const ROW_LENGTH = FACE_CSV_HEADER.length;

/**
 * MediaPipe's MatrixData defaults to column-major (mediapipe/framework/formats/matrix_data.proto).
 * We store row-major (m03, m13, m23 = head position). The layout is checked on the data itself:
 * a pose matrix has [0 0 0 1] as its last row, so we look for where those zeros are.
 */
export function toRowMajor(data: number[]): number[] {
  if (data.length !== 16) return new Array(16).fill(NaN);
  const near0 = (v: number) => Math.abs(v) < 1e-6;
  const lastRowIfRowMajor = [data[12]!, data[13]!, data[14]!];
  const lastRowIfColMajor = [data[3]!, data[7]!, data[11]!];
  const looksColumnMajor = lastRowIfColMajor.every(near0) && !lastRowIfRowMajor.every(near0);
  const looksRowMajor = lastRowIfRowMajor.every(near0) && !lastRowIfColMajor.every(near0);
  if (looksRowMajor && !looksColumnMajor) return [...data];
  // Column-major (the documented default), or ambiguous (no translation): transpose.
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r * 4 + c] = data[c * 4 + r]!;
  return out;
}

/** One frame → one row of numbers (NaN for missing values; written as empty CSV cells). */
export function faceRow(t_ms: number, result: FaceResultLike | null, fps: number): number[] {
  const row = new Array<number>(ROW_LENGTH).fill(NaN);
  row[0] = t_ms;
  const blend = result?.faceBlendshapes[0];
  const matrix = result?.facialTransformationMatrixes[0];
  const present = Boolean(blend || matrix);
  row[1] = present ? 1 : 0;
  if (blend) {
    for (const c of blend.categories) {
      const i = INDEX.get(c.categoryName);
      if (i !== undefined) row[2 + i] = c.score;
    }
  }
  if (matrix) {
    const m = toRowMajor(matrix.data);
    for (let k = 0; k < 16; k++) row[2 + BLENDSHAPE_NAMES.length + k] = m[k]!;
  }
  row[ROW_LENGTH - 1] = fps;
  return row;
}

/** CSV text for one row. Blendshapes 0..1 with 5 decimals, matrix with 6 significant digits. */
export function rowToCsv(row: number[]): string {
  const firstMatrix = 2 + BLENDSHAPE_NAMES.length;
  return row.map((v, i) => {
    if (Number.isNaN(v)) return '';
    if (i === 0 || i === 1) return String(Math.round(v));
    if (i === row.length - 1) return v.toFixed(1);
    if (i < firstMatrix) return v.toFixed(5);
    return String(Number(v.toPrecision(6)));
  }).join(',');
}

/** Rolling frames-per-second over the last second. */
export class FpsMeter {
  private times: number[] = [];

  tick(nowMs: number): number {
    this.times.push(nowMs);
    while (this.times.length && this.times[0]! < nowMs - 1000) this.times.shift();
    return this.times.length;
  }
}
