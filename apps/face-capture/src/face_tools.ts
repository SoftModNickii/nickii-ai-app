// What face capture does with each frame besides recording: send the live mask to the phone in
// transmission, and collect frames for "use my face as the head". No camera or network in here: tested.

import {
  decodeFace, encodeFace, encodeHead, FrameThrottle, snapshotHead,
  type HeadPoint, type LandmarkLike, type MaskChannel,
} from '@nickii/shared';

/** Sends face frames to whoever is in direct transmission; switches when that changes. */
export class MaskSender {
  private channel: MaskChannel | null = null;
  private target: string | null = null;
  private throttle: FrameThrottle;
  enabled = true;
  sent = 0;

  constructor(private readonly open: (participantId: string) => MaskChannel, fps = 12) {
    this.throttle = new FrameThrottle(fps);
  }

  get liveParticipant(): string | null {
    return this.target;
  }

  setTarget(participantId: string | null): void {
    if (participantId === this.target) return;
    void this.channel?.close();
    this.channel = participantId ? this.open(participantId) : null;
    this.target = participantId;
  }

  /** Call for every detected face. */
  frame(nowMs: number, landmarks: readonly LandmarkLike[], aspect: number): void {
    const ch = this.channel;
    if (!this.enabled || !ch || landmarks.length < 468) return;
    this.throttle.offer(nowMs, async () => {
      await ch.send(encodeFace(landmarks, aspect));
      this.sent++;
    });
  }

  close(): void {
    this.setTarget(null);
  }
}

/** Collects face frames for a snapshot: `count` frames that actually contain a face. */
export class SnapshotCollector {
  private frames: Float32Array[] = [];
  private done: ((head: HeadPoint[]) => void) | null = null;

  constructor(private readonly count = 24) {}

  get collecting(): boolean {
    return this.done !== null;
  }

  get progress(): number {
    return this.frames.length / this.count;
  }

  /** Resolves with the head once enough frames came in. */
  start(): Promise<HeadPoint[]> {
    this.frames = [];
    return new Promise((resolve) => { this.done = resolve; });
  }

  frame(landmarks: readonly LandmarkLike[], aspect: number): void {
    if (!this.done || landmarks.length < 468) return;
    this.frames.push(decodeFace(encodeFace(landmarks, aspect)));
    if (this.frames.length >= this.count) {
      const resolve = this.done;
      this.done = null;
      resolve(snapshotHead(this.frames));
    }
  }

  cancel(): void {
    this.done = null;
    this.frames = [];
  }
}

/** Version name for a published head: snapshot_YYYYMMDD_HHMMSS (local time). */
export function headVersion(prefix: string, t: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${prefix}_${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
}

export { encodeHead };
