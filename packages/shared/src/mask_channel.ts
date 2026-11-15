// Live mask: face frames from face capture (Nickii's phone or Mac) to the one phone in direct transmission.
// Supabase Realtime broadcast on topic `mask:<participant id>`; about 12 frames a second, ~3.7 kB each.
// Only the participant in transmission listens, so this stays far below Realtime's message limits.
// Like the video signalling, the topic is not access-controlled; participant ids are random UUIDs.

import type { ChannelClient } from './live_video';

export interface MaskChannel {
  send(frame: string): Promise<void>;
  onFrame(cb: (frame: string) => void): () => void;
  close(): Promise<void>;
}

export function supabaseMaskChannel(client: ChannelClient, participantId: string): MaskChannel {
  const ch = client.channel(`mask:${participantId}`, { config: { broadcast: { self: false } } });
  const cbs = new Set<(f: string) => void>();
  ch.on('broadcast', { event: 'face' }, (p) => {
    const f = (p.payload as { f?: unknown } | null)?.f;
    if (typeof f === 'string') cbs.forEach((cb) => cb(f));
  });
  let subscribed = false;
  ch.subscribe((status) => { if (status === 'SUBSCRIBED') subscribed = true; });
  return {
    async send(frame) {
      if (!subscribed) return; // drop frames until connected; the next one comes 80 ms later
      await ch.send({ type: 'broadcast', event: 'face', payload: { f: frame } });
    },
    onFrame(cb) {
      cbs.add(cb);
      return () => { cbs.delete(cb); };
    },
    async close() {
      cbs.clear();
      await client.removeChannel(ch);
    },
  };
}

/** Sends at most `fps` frames a second, newest first; drops frames while a send is still running. */
export class FrameThrottle {
  private last = -Infinity;
  private busy = false;

  constructor(private readonly fps = 12) {}

  /** Call for every captured frame; `send` runs only when it is time. Returns true if it sent. */
  offer(nowMs: number, send: () => Promise<void>): boolean {
    if (this.busy || nowMs - this.last < 1000 / this.fps) return false;
    this.last = nowMs;
    this.busy = true;
    void send().catch(() => {}).finally(() => { this.busy = false; });
    return true;
  }
}
