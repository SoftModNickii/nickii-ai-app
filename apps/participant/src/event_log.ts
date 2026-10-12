// Participant events for the dataset (docs/dataset.md). Queued on the phone and sent in batches,
// so nothing is lost on a bad connection. Nothing is recorded before the participant has agreed.

import type { KeyValueStore, ParticipantEvent, ParticipantEventName } from '@nickii/shared';

const KEY = 'nickii.event_queue';

export interface EventLogOptions {
  store: KeyValueStore;
  insert: (events: ParticipantEvent[]) => Promise<void>;
  /** Server-clock time in ms. */
  now: () => number;
  /** null until the participant has agreed. */
  participantId: () => string | null;
  maxQueue?: number;
  batchSize?: number;
}

export class EventLog {
  private queue: ParticipantEvent[];
  private flushing: Promise<boolean> | null = null;

  constructor(private readonly o: EventLogOptions) {
    this.queue = EventLog.load(o.store);
  }

  private static load(store: KeyValueStore): ParticipantEvent[] {
    try {
      const v = JSON.parse(store.get(KEY) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  log(name: ParticipantEventName, data?: Record<string, unknown>): void {
    const participant_id = this.o.participantId();
    if (!participant_id) return; // no consent yet: record nothing
    this.queue.push({ participant_id, name, data: data ?? {}, t_ms: this.o.now() });
    const max = this.o.maxQueue ?? 2000;
    if (this.queue.length > max) this.queue.splice(0, this.queue.length - max); // keep the newest
    this.save();
    void this.flush();
  }

  /** Sends everything queued. Resolves true when the queue is empty. Safe to call often. */
  flush(): Promise<boolean> {
    if (this.flushing) return this.flushing;
    if (this.queue.length === 0) return Promise.resolve(true);
    this.flushing = this.run();
    return this.flushing;
  }

  // `flushing` is cleared in the same step the loop sees an empty queue, so an event logged
  // right after a batch is never left waiting for the next flush.
  private async run(): Promise<boolean> {
    const size = this.o.batchSize ?? 50;
    try {
      while (this.queue.length) {
        const batch = this.queue.slice(0, size);
        try {
          await this.o.insert(batch);
        } catch {
          return false; // keep for the next try (app_visible, online, next event)
        }
        this.queue.splice(0, batch.length);
        this.save();
      }
      return true;
    } finally {
      this.flushing = null;
    }
  }

  private save() {
    this.o.store.set(KEY, JSON.stringify(this.queue));
  }
}
