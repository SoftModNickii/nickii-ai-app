// @vitest-environment node
import 'fake-indexeddb/auto';
import { gunzipSync } from 'node:zlib';
import { BLENDSHAPE_NAMES, FACE_CSV_HEADER } from '@nickii/shared';
import { describe, expect, it } from 'vitest';
import { ChunkStore, uploadPending } from './chunk_store';
import { CHUNK_MS, ChunkWriter, chunkName, gzip } from './chunks';
import { faceRow, FpsMeter, ROW_LENGTH, rowToCsv, toRowMajor, type FaceResultLike } from './face_row';

const T0 = Date.UTC(2026, 9, 12, 10, 0, 0); // 2026-10-12 10:00:00 UTC

// Pose: identity rotation, head 40 cm in front of the camera.
const ROW_MAJOR = [1, 0, 0, 1.5, 0, 1, 0, -2, 0, 0, 1, -40, 0, 0, 0, 1];
const COL_MAJOR = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.5, -2, -40, 1];

function result(): FaceResultLike {
  return {
    faceBlendshapes: [{ categories: [
      { categoryName: 'jawOpen', score: 0.42 },
      { categoryName: 'eyeBlinkLeft', score: 0.9 },
      { categoryName: 'notARealName', score: 1 },
    ] }],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data: COL_MAJOR }],
  };
}

describe('toRowMajor', () => {
  it('transposes column-major (MediaPipe default) so the position lands in m03/m13/m23', () => {
    expect(toRowMajor(COL_MAJOR)).toEqual(ROW_MAJOR);
  });

  it('leaves row-major data as it is', () => {
    expect(toRowMajor(ROW_MAJOR)).toEqual(ROW_MAJOR);
  });

  it('wrong size gives NaN instead of garbage', () => {
    expect(toRowMajor([1, 2, 3]).every(Number.isNaN)).toBe(true);
  });
});

describe('faceRow', () => {
  it('puts every value in its fixed column', () => {
    const row = faceRow(T0, result(), 29.5);
    const col = (name: string) => row[FACE_CSV_HEADER.indexOf(name)];
    expect(row).toHaveLength(ROW_LENGTH);
    expect(ROW_LENGTH).toBe(2 + 52 + 16 + 1);
    expect(BLENDSHAPE_NAMES).toHaveLength(52);
    expect(col('t_ms')).toBe(T0);
    expect(col('face_present')).toBe(1);
    expect(col('jawOpen')).toBe(0.42);
    expect(col('eyeBlinkLeft')).toBe(0.9);
    expect(Number.isNaN(col('mouthSmileLeft')!)).toBe(true); // not in this result
    expect(col('m03')).toBe(1.5);
    expect(col('m23')).toBe(-40);
    expect(col('fps_measured')).toBe(29.5);
  });

  it('no face: face_present 0 and empty values', () => {
    const csv = rowToCsv(faceRow(T0, { faceBlendshapes: [], facialTransformationMatrixes: [] }, 30));
    const cells = csv.split(',');
    expect(cells).toHaveLength(ROW_LENGTH);
    expect(cells[1]).toBe('0');
    expect(cells.slice(2, -1).every((c) => c === '')).toBe(true);
    expect(cells.at(-1)).toBe('30.0');
  });

  it('formats blendshapes with 5 decimals and matrix compactly', () => {
    const cells = rowToCsv(faceRow(T0, result(), 30)).split(',');
    expect(cells[FACE_CSV_HEADER.indexOf('jawOpen')]).toBe('0.42000');
    expect(cells[FACE_CSV_HEADER.indexOf('m23')]).toBe('-40');
  });
});

describe('FpsMeter', () => {
  it('counts frames in the last second', () => {
    const m = new FpsMeter();
    let fps = 0;
    for (let i = 0; i < 60; i++) fps = m.tick(i * 33.3);
    expect(fps).toBeGreaterThanOrEqual(29);
    expect(fps).toBeLessThanOrEqual(31);
  });
});

describe('ChunkWriter', () => {
  it('names chunks after the first frame (UTC)', () => {
    expect(chunkName(T0 + 65_000)).toEqual({ name: 'face_2026-10-12_10-01-05.csv.gz', day: '2026-10-12' });
  });

  it('cuts at every 10-minute mark and keeps the header on each chunk', () => {
    const w = new ChunkWriter();
    const done = [];
    for (let t = T0 + 5 * 60_000; t < T0 + 25 * 60_000; t += 1000) {
      const f = w.add(faceRow(t, null, 30));
      if (f) done.push(f);
    }
    const last = w.finish()!;
    expect(done.map((c) => c.name)).toEqual(['face_2026-10-12_10-05-00.csv.gz', 'face_2026-10-12_10-10-00.csv.gz']);
    expect(done.map((c) => c.rows)).toEqual([300, 600]);
    expect(last.name).toBe('face_2026-10-12_10-20-00.csv.gz');
    expect(last.rows).toBe(300);
    for (const c of [...done, last]) {
      const lines = c.csv.trim().split('\n');
      expect(lines[0]).toBe(FACE_CSV_HEADER.join(','));
      expect(lines).toHaveLength(c.rows + 1);
      expect(c.end_t_ms - c.start_t_ms).toBeLessThan(CHUNK_MS);
    }
    expect(w.finish()).toBeNull();
  });

  it('snapshot does not end the chunk', () => {
    const w = new ChunkWriter();
    w.add(faceRow(T0, null, 30));
    expect(w.snapshot()!.rows).toBe(1);
    w.add(faceRow(T0 + 1, null, 30));
    expect(w.finish()!.rows).toBe(2);
  });
});

describe('gzip', () => {
  it('round-trips', async () => {
    const text = 'a,b\n1,2\n'.repeat(1000);
    const gz = await gzip(text);
    expect(gz.length).toBeLessThan(text.length / 10);
    expect(gunzipSync(gz).toString()).toBe(text);
  });
});

describe('ChunkStore and upload', () => {
  async function store() {
    return ChunkStore.open(indexedDB, `test-${Math.random()}`);
  }

  function chunkAt(t: number) {
    const w = new ChunkWriter();
    w.add(faceRow(t, result(), 30));
    w.add(faceRow(t + 33, result(), 30));
    return w.finish()!;
  }

  it('finishes partial chunks left by a crash', async () => {
    const s = await store();
    await s.savePartial(chunkAt(T0));
    expect(await s.recoverPartials()).toBe(1);
    const [ready] = await s.byStatus('ready');
    expect(gunzipSync(ready!.gz!).toString().split('\n')[0]).toBe(FACE_CSV_HEADER.join(','));
    expect(await s.byStatus('partial')).toHaveLength(0);
  });

  it('uploads oldest first to day/name, and keeps the rest when the internet drops', async () => {
    const s = await store();
    await s.saveReady(chunkAt(T0 + CHUNK_MS));
    await s.saveReady(chunkAt(T0));
    await s.saveReady(chunkAt(T0 + 2 * CHUNK_MS));
    const paths: string[] = [];
    let fail = false;
    const upload = async (path: string) => {
      if (fail) throw new Error('offline');
      paths.push(path);
      fail = paths.length === 2; // third upload fails
    };
    const r = await uploadPending(s, upload, () => 123);
    expect(paths).toEqual(['2026-10-12/face_2026-10-12_10-00-00.csv.gz', '2026-10-12/face_2026-10-12_10-10-00.csv.gz']);
    expect(r).toEqual({ uploaded: 2, pending: 1, lastUploadT: 123 });
    fail = false;
    expect((await uploadPending(s, upload, () => 456)).pending).toBe(0);
    expect(await s.byStatus('uploaded')).toHaveLength(3);
  });

  it('drops the local copy after upload only if it is in the chosen folder', async () => {
    const s = await store();
    const a = chunkAt(T0);
    const b = chunkAt(T0 + CHUNK_MS);
    await s.saveReady(a);
    await s.saveReady(b);
    await s.update(a.name, { in_folder: true });
    await uploadPending(s, async () => {}, () => 1);
    expect((await s.get(a.name))!.gz).toBeUndefined();
    expect((await s.get(b.name))!.gz).toBeDefined();
  });
});

describe('Recorder', () => {
  it('records frames into 10-minute chunks in the store and counts frames today', async () => {
    const { Recorder } = await import('./recorder');
    const s = await ChunkStore.open(indexedDB, `rec-${Math.random()}`);
    let t = T0 + 9 * 60_000 + 50_000; // 10:09:50
    const saved: string[] = [];
    const rec = new Recorder({ store: s, now: () => t, onChunkSaved: (c) => { saved.push(c.name); } });
    for (let i = 0; i < 600; i++) { // 20 s at 30 fps, crossing 10:10
      rec.frame(i % 2 ? result() : null);
      t += 33;
    }
    await rec.snapshot();
    expect((await s.byStatus('partial')).map((c) => c.name)).toEqual(['face_2026-10-12_10-10-00.csv.gz']);
    await rec.stop();
    expect(saved).toEqual(['face_2026-10-12_10-09-50.csv.gz', 'face_2026-10-12_10-10-00.csv.gz']);
    expect((await s.byStatus('ready')).map((c) => c.rows).reduce((a, b) => a + b, 0)).toBe(600);
    expect(rec.stats.frames_today).toBe(600);
    expect(rec.stats.fps).toBeGreaterThan(25);
  });
});
