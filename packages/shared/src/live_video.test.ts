import { describe, expect, it } from 'vitest';
import { LiveReceiver, LiveSender, type LiveSignal, type PeerLike, type SignalMessage } from './live_video';

/** Two ends of one channel, delivering asynchronously like the network does. */
function pair(): [LiveSignal, LiveSignal, SignalMessage[]] {
  const log: SignalMessage[] = [];
  const a = new Set<(m: SignalMessage) => void>();
  const b = new Set<(m: SignalMessage) => void>();
  const end = (mine: Set<(m: SignalMessage) => void>, other: Set<(m: SignalMessage) => void>): LiveSignal => ({
    async send(m) { log.push(m); await Promise.resolve(); other.forEach((cb) => cb(m)); },
    onMessage(cb) { mine.add(cb); return () => mine.delete(cb); },
    async close() { mine.clear(); },
  });
  return [end(a, b), end(b, a), log];
}

/** Fake peer connection: records calls, connects when both descriptions are set. */
function fakePeer(all: FakePeer[]) {
  const p = new FakePeer();
  all.push(p);
  return p;
}
class FakePeer implements PeerLike {
  calls: string[] = [];
  tracks = 0;
  local: RTCSessionDescriptionInit | null = null;
  remote: RTCSessionDescriptionInit | null = null;
  ice: RTCIceCandidateInit[] = [];
  closed = false;
  connectionState = 'new';
  onicecandidate: PeerLike['onicecandidate'] = null;
  onconnectionstatechange: PeerLike['onconnectionstatechange'] = null;
  ontrack: PeerLike['ontrack'] = null;
  async createOffer(o?: { iceRestart?: boolean }) { this.calls.push(o?.iceRestart ? 'offer(restart)' : 'offer'); return { type: 'offer' as const, sdp: 'OFFER' }; }
  async createAnswer() { this.calls.push('answer'); return { type: 'answer' as const, sdp: 'ANSWER' }; }
  async setLocalDescription(d: RTCSessionDescriptionInit) { this.local = d; this.maybeConnect(); }
  async setRemoteDescription(d: RTCSessionDescriptionInit) { this.remote = d; this.maybeConnect(); }
  async addIceCandidate(c: RTCIceCandidateInit) { this.ice.push(c); }
  addTrack() { this.tracks++; }
  addTransceiver() { this.calls.push('transceiver'); }
  close() { this.closed = true; this.connectionState = 'closed'; }
  private maybeConnect() {
    if (this.local && this.remote) {
      this.connectionState = 'connected';
      this.onconnectionstatechange?.();
      this.ontrack?.({ streams: [{ id: 'remote-stream' } as unknown as MediaStream] });
    }
  }
}

const fakeStream = () => ({ getTracks: () => [{ kind: 'video' } as MediaStreamTrack] }) as unknown as MediaStream;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('live video signalling', () => {
  it('phone first, then console: offer → answer → connected, video arrives on the phone', async () => {
    const [consoleEnd, phoneEnd, log] = pair();
    const peers: FakePeer[] = [];
    const receiver = new LiveReceiver(phoneEnd, () => fakePeer(peers));
    const streams: Array<MediaStream | null> = [];
    receiver.onStream((s) => streams.push(s));
    await receiver.start();            // hello goes nowhere yet: console not listening
    const sender = new LiveSender(consoleEnd, () => fakePeer(peers));
    const states: string[] = [];
    sender.onState((s) => states.push(s));
    await sender.start(fakeStream());
    await tick(); await tick(); await tick();
    expect(log.map((m) => m.type)).toEqual(['hello', 'hello', 'hello', 'offer', 'answer']);
    expect(peers).toHaveLength(2);
    expect(peers[0]!.tracks).toBe(1);                       // console sends its camera
    expect(peers[1]!.calls).toContain('transceiver');       // phone only receives
    expect(states).toEqual(['connecting', 'connected']);
    expect((streams[0] as unknown as { id: string }).id).toBe('remote-stream');
  });

  it('console first, then phone: the hello from the phone triggers the offer', async () => {
    const [consoleEnd, phoneEnd, log] = pair();
    const peers: FakePeer[] = [];
    const sender = new LiveSender(consoleEnd, () => fakePeer(peers));
    await sender.start(fakeStream());
    const receiver = new LiveReceiver(phoneEnd, () => fakePeer(peers));
    await receiver.start();
    await tick(); await tick(); await tick();
    expect(log.map((m) => m.type)).toEqual(['hello', 'hello', 'offer', 'answer']);
    expect(sender.state).toBe('connected');
  });

  it('ICE candidates that arrive before the offer are kept and added later', async () => {
    const [consoleEnd, phoneEnd] = pair();
    const peers: FakePeer[] = [];
    const receiver = new LiveReceiver(phoneEnd, () => fakePeer(peers));
    await receiver.start();
    await consoleEnd.send({ type: 'ice', candidate: { candidate: 'early' } });
    await consoleEnd.send({ type: 'offer', sdp: 'OFFER' });
    await tick(); await tick();
    expect(peers[0]!.ice).toEqual([{ candidate: 'early' }]);
  });

  it('bye from the console removes the video on the phone', async () => {
    const [consoleEnd, phoneEnd] = pair();
    const peers: FakePeer[] = [];
    const receiver = new LiveReceiver(phoneEnd, () => fakePeer(peers));
    const streams: Array<MediaStream | null> = [];
    receiver.onStream((s) => streams.push(s));
    await receiver.start();
    const sender = new LiveSender(consoleEnd, () => fakePeer(peers));
    await sender.start(fakeStream());
    await tick(); await tick(); await tick();
    await sender.stop();
    await tick();
    expect(streams.at(-1)).toBeNull();
    expect(peers.every((p) => p.closed)).toBe(true);
    expect(sender.state).toBe('idle');
  });

  it('a failed connection makes the console try again with a fresh offer', async () => {
    const [consoleEnd, phoneEnd, log] = pair();
    const peers: FakePeer[] = [];
    const sender = new LiveSender(consoleEnd, () => fakePeer(peers));
    await sender.start(fakeStream());
    const receiver = new LiveReceiver(phoneEnd, () => fakePeer(peers));
    await receiver.start();
    await tick(); await tick(); await tick();
    const consolePeer = peers[0]!;
    consolePeer.connectionState = 'failed';
    consolePeer.onconnectionstatechange?.();
    await tick(); await tick();
    expect(consolePeer.calls).toContain('offer(restart)');
    expect(log.filter((m) => m.type === 'offer')).toHaveLength(2);
  });
});
