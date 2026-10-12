// Face chunks saved on the Mac first (IndexedDB), uploaded later. Survives internet drops,
// tab reloads and crashes: the unfinished chunk is saved every 30 seconds as 'partial'
// and finished on the next start.

import { gzip, type FinishedChunk } from './chunks';

export type ChunkStatus = 'partial' | 'ready' | 'uploaded';

export interface StoredChunk {
  name: string;
  day: string;
  start_t_ms: number;
  end_t_ms: number;
  rows: number;
  status: ChunkStatus;
  csv?: string;          // partial chunks only
  gz?: Uint8Array;       // ready and uploaded chunks
  uploaded_t_ms?: number;
  in_folder?: boolean;   // also written to the chosen folder on disk
}

const DB = 'nickii-face-capture';
const STORE = 'chunks';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class ChunkStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name = DB): Promise<ChunkStore> {
    const open = factory.open(name, 1);
    open.onupgradeneeded = () => {
      const s = open.result.createObjectStore(STORE, { keyPath: 'name' });
      s.createIndex('status', 'status');
    };
    return new ChunkStore(await req(open));
  }

  private tx(mode: IDBTransactionMode) {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async savePartial(c: FinishedChunk): Promise<void> {
    await req(this.tx('readwrite').put({ ...omitCsv(c), status: 'partial', csv: c.csv } satisfies StoredChunk));
  }

  async saveReady(c: FinishedChunk): Promise<StoredChunk> {
    const stored: StoredChunk = { ...omitCsv(c), status: 'ready', gz: await gzip(c.csv) };
    await req(this.tx('readwrite').put(stored));
    return stored;
  }

  /** Finishes chunks left 'partial' by a crash or reload. Returns how many. */
  async recoverPartials(): Promise<number> {
    const partials = await this.byStatus('partial');
    for (const p of partials) {
      await this.saveReady({ name: p.name, day: p.day, start_t_ms: p.start_t_ms, end_t_ms: p.end_t_ms, rows: p.rows, csv: p.csv ?? '' });
    }
    return partials.length;
  }

  byStatus(status: ChunkStatus): Promise<StoredChunk[]> {
    return req(this.tx('readonly').index('status').getAll(status)) as Promise<StoredChunk[]>;
  }

  async update(name: string, change: Partial<StoredChunk>): Promise<void> {
    const s = this.tx('readwrite');
    const cur = (await req(s.get(name))) as StoredChunk | undefined;
    if (cur) await req(s.put({ ...cur, ...change }));
  }

  get(name: string): Promise<StoredChunk | undefined> {
    return req(this.tx('readonly').get(name)) as Promise<StoredChunk | undefined>;
  }

  close(): void {
    this.db.close();
  }
}

function omitCsv(c: FinishedChunk): Omit<FinishedChunk, 'csv'> {
  const { csv: _csv, ...rest } = c;
  return rest;
}

/**
 * Uploads every 'ready' chunk. `upload` returns normally on success and throws on failure.
 * Stops at the first failure (no internet) and tries again next time.
 */
export async function uploadPending(
  store: ChunkStore,
  upload: (path: string, gz: Uint8Array) => Promise<void>,
  now: () => number,
): Promise<{ uploaded: number; pending: number; lastUploadT: number | null }> {
  const ready = (await store.byStatus('ready')).sort((a, b) => a.start_t_ms - b.start_t_ms);
  let uploaded = 0;
  let lastUploadT: number | null = null;
  for (const c of ready) {
    try {
      await upload(`${c.day}/${c.name}`, c.gz!);
    } catch {
      break;
    }
    lastUploadT = now();
    // Keep the data on the Mac only if it was not written to the chosen folder.
    await store.update(c.name, { status: 'uploaded', uploaded_t_ms: lastUploadT, ...(c.in_folder ? { gz: undefined } : {}) });
    uploaded++;
  }
  return { uploaded, pending: ready.length - uploaded, lastUploadT };
}
