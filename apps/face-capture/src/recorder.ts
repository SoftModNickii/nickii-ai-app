// Frame → row → chunk → local store. No camera or MediaPipe in here, so it can be tested.

import type { ChunkStore, StoredChunk } from './chunk_store';
import { ChunkWriter } from './chunks';
import { faceRow, FpsMeter, type FaceResultLike } from './face_row';

export interface RecorderOptions {
  store: ChunkStore;
  /** Server-clock time in ms. */
  now: () => number;
  /** Called with each finished chunk after it is saved (e.g. to also write it to a folder). */
  onChunkSaved?: (c: StoredChunk) => Promise<void> | void;
}

export interface RecorderStats {
  frames_today: number;
  face_present: boolean;
  fps: number;
  rows_in_chunk: number;
  last_frame_t_ms: number | null;
}

export class Recorder {
  private writer = new ChunkWriter();
  private fpsMeter = new FpsMeter();
  private day = '';
  private s: RecorderStats = { frames_today: 0, face_present: false, fps: 0, rows_in_chunk: 0, last_frame_t_ms: null };
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly o: RecorderOptions) {}

  /** Records one frame. `result` is MediaPipe's output for it (null = detection failed). */
  frame(result: FaceResultLike | null): void {
    const t = this.o.now();
    const fps = this.fpsMeter.tick(t);
    const row = faceRow(t, result, fps);
    const finished = this.writer.add(row);
    if (finished) this.saving = this.saving.then(() => this.save(finished));

    const day = new Date(t).toDateString(); // "today" in Nickii's local time
    if (day !== this.day) {
      this.day = day;
      this.s.frames_today = 0;
    }
    this.s.frames_today++;
    this.s.face_present = row[1] === 1;
    this.s.fps = fps;
    this.s.rows_in_chunk = finished ? 1 : this.s.rows_in_chunk + 1;
    this.s.last_frame_t_ms = t;
  }

  get stats(): RecorderStats {
    return { ...this.s };
  }

  /** Saves the unfinished chunk (every 30 s and when the page closes). */
  async snapshot(): Promise<void> {
    const snap = this.writer.snapshot();
    if (snap) await this.o.store.savePartial(snap);
  }

  /** Ends the current chunk and waits until everything is saved. */
  async stop(): Promise<void> {
    const last = this.writer.finish();
    if (last) this.saving = this.saving.then(() => this.save(last));
    this.s.rows_in_chunk = 0;
    await this.saving;
  }

  private async save(c: Parameters<ChunkStore['saveReady']>[0]) {
    try {
      const stored = await this.o.store.saveReady(c);
      await this.o.onChunkSaved?.(stored);
    } catch (err) {
      console.error('saving chunk failed', c.name, err);
    }
  }
}
