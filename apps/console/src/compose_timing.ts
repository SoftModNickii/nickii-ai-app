// Records how Nickii writes a reply (docs/dataset.md "reply_typing"): when she starts, pauses,
// deletes, and sends. Never shown to participants. Emits operator events; the caller stamps
// them with the server clock and the open thread.

export type ComposeEventName = 'compose_start' | 'compose_pause' | 'compose_delete' | 'compose_send';

export interface ComposeEvent {
  name: ComposeEventName;
  t_ms: number;
  data: Record<string, number>;
}

export const PAUSE_MS = 2000;

export class ComposeTiming {
  private startedAt: number | null = null;
  private lastInputAt = 0;
  private deleteRun = 0;
  private deleteRunAt = 0;
  private stats = { pauses: 0, deletes: 0, deleted_chars: 0 };

  constructor(private readonly emit: (e: ComposeEvent) => void) {}

  /**
   * Call on every input event. `before`/`after` are the text lengths; inputType is from InputEvent.
   */
  input(now: number, inputType: string, before: number, after: number): void {
    if (this.startedAt === null) {
      if (after === 0) return;
      this.startedAt = now;
      this.lastInputAt = now;
      this.emit({ name: 'compose_start', t_ms: now, data: {} });
    }
    const gap = now - this.lastInputAt;
    if (gap >= PAUSE_MS) {
      this.stats.pauses++;
      // Logged when typing resumes, stamped at the start of the pause.
      this.emit({ name: 'compose_pause', t_ms: this.lastInputAt, data: { pause_ms: gap } });
    }
    if (inputType.startsWith('delete') || after < before) {
      this.flushDeleteIfOld(now);
      if (this.deleteRun === 0) this.deleteRunAt = now;
      this.deleteRun += Math.max(0, before - after);
    } else {
      this.flushDelete();
    }
    this.lastInputAt = now;
  }

  /** Call when the reply is sent. */
  send(now: number, chars: number): void {
    this.flushDelete();
    if (this.startedAt === null) this.startedAt = now;
    this.emit({
      name: 'compose_send',
      t_ms: now,
      data: { chars, compose_ms: now - this.startedAt, ...this.stats },
    });
    this.reset();
  }

  /** Call when the thread is closed without sending: nothing more is recorded for it. */
  abandon(): void {
    this.flushDelete();
    this.reset();
  }

  get active(): boolean {
    return this.startedAt !== null;
  }

  private flushDeleteIfOld(now: number) {
    if (this.deleteRun > 0 && now - this.lastInputAt >= PAUSE_MS) this.flushDelete();
  }

  /** A run of deletions (backspace held or repeated) is one compose_delete event. */
  private flushDelete() {
    if (this.deleteRun === 0) return;
    this.stats.deletes++;
    this.stats.deleted_chars += this.deleteRun;
    this.emit({ name: 'compose_delete', t_ms: this.deleteRunAt, data: { chars: this.deleteRun } });
    this.deleteRun = 0;
  }

  private reset() {
    this.startedAt = null;
    this.deleteRun = 0;
    this.stats = { pauses: 0, deletes: 0, deleted_chars: 0 };
  }
}
