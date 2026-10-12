// Splits the face stream into 10-minute CSV chunks (docs/dataset.md). A chunk ends at every
// 10-minute mark of the server clock (UTC); the file is named after its first frame.

import { FACE_CSV_HEADER } from '@nickii/shared';
import { rowToCsv } from './face_row';

export const CHUNK_MS = 10 * 60_000;

export interface FinishedChunk {
  name: string;        // face_2026-10-12_10-00-00.csv.gz
  day: string;         // 2026-10-12 (UTC), folder in Storage
  start_t_ms: number;
  end_t_ms: number;
  rows: number;
  csv: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function chunkName(t_ms: number): { name: string; day: string } {
  const d = new Date(t_ms);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`;
  return { name: `face_${day}_${time}.csv.gz`, day };
}

export function windowOf(t_ms: number): number {
  return Math.floor(t_ms / CHUNK_MS);
}

export class ChunkWriter {
  private lines: string[] = [];
  private start = 0;
  private last = 0;
  private window = -1;

  /** Adds one row (row[0] = t_ms). Returns the previous chunk when this row starts a new one. */
  add(row: number[]): FinishedChunk | null {
    const t = row[0]!;
    let finished: FinishedChunk | null = null;
    if (this.lines.length > 0 && windowOf(t) !== this.window) finished = this.finish();
    if (this.lines.length === 0) {
      this.start = t;
      this.window = windowOf(t);
    }
    this.lines.push(rowToCsv(row));
    this.last = t;
    return finished;
  }

  /** Ends the current chunk now (stop button, page closing). */
  finish(): FinishedChunk | null {
    if (this.lines.length === 0) return null;
    const { name, day } = chunkName(this.start);
    const chunk: FinishedChunk = {
      name, day, start_t_ms: this.start, end_t_ms: this.last, rows: this.lines.length,
      csv: `${FACE_CSV_HEADER.join(',')}\n${this.lines.join('\n')}\n`,
    };
    this.lines = [];
    this.window = -1;
    return chunk;
  }

  /** The unfinished chunk so far, for crash safety (saved every 30 s). */
  snapshot(): FinishedChunk | null {
    if (this.lines.length === 0) return null;
    const { name, day } = chunkName(this.start);
    return {
      name, day, start_t_ms: this.start, end_t_ms: this.last, rows: this.lines.length,
      csv: `${FACE_CSV_HEADER.join(',')}\n${this.lines.join('\n')}\n`,
    };
  }
}

/** gzip with the browser's built-in CompressionStream (Chrome 80+, Safari 16.4+). */
export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
