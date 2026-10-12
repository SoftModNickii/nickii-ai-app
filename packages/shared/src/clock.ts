// One clock for everything (docs/dataset.md). Each device measures its offset to the server
// and stamps events with server time, so face frames line up with messages.

export interface ClockSample {
  clientSendMs: number;   // local time when the request left
  serverMs: number;       // server time from the response
  clientReceiveMs: number;
}

/** NTP-style offset: server - client, assuming the network delay is symmetric. */
export function offsetFromSample(s: ClockSample): { offsetMs: number; roundTripMs: number } {
  const roundTripMs = s.clientReceiveMs - s.clientSendMs;
  const midpoint = s.clientSendMs + roundTripMs / 2;
  return { offsetMs: s.serverMs - midpoint, roundTripMs };
}

/** Use the sample with the shortest round trip: it has the least uncertainty. */
export function bestOffset(samples: ClockSample[]): { offsetMs: number; roundTripMs: number } | null {
  if (samples.length === 0) return null;
  return samples
    .map(offsetFromSample)
    .reduce((best, cur) => (cur.roundTripMs < best.roundTripMs ? cur : best));
}

export class ServerClock {
  private offsetMs = 0;
  private synced = false;

  setOffset(offsetMs: number) { this.offsetMs = offsetMs; this.synced = true; }
  get isSynced() { return this.synced; }
  get offset() { return this.offsetMs; }

  /** Current server time in ms (UTC epoch). */
  now(local: number = Date.now()): number { return Math.round(local + this.offsetMs); }
}
