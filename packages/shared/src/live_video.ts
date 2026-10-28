// Live transmission video: Nickii's webcam (console, Mac) → the one phone in direct transmission.
// WebRTC peer to peer; Supabase Realtime only carries the small "signal" messages that set the call up.
// WebRTC: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
// Supabase broadcast: https://supabase.com/docs/guides/realtime/broadcast
//
// No relay (TURN) server yet: on some mobile networks a direct connection cannot be made; the phone then
// keeps showing the head and the status. Add a TURN server to `iceServers` if tests show it is needed.

export type SignalMessage =
  | { type: 'hello' }                                  // phone: "I am in the transmission, send me video"
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'bye' };                                   // sender stopped

/** A two-way message channel between the console and one participant's phone. */
export interface LiveSignal {
  send(msg: SignalMessage): Promise<void>;
  onMessage(cb: (msg: SignalMessage) => void): () => void;
  close(): Promise<void>;
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export type LiveState = 'idle' | 'connecting' | 'connected' | 'failed';

/** Minimal surface of RTCPeerConnection the classes below use (so tests can fake it). */
export interface PeerLike {
  createOffer(opts?: { iceRestart?: boolean }): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(d: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(c: RTCIceCandidateInit): Promise<void>;
  addTrack(track: MediaStreamTrack, stream: MediaStream): unknown;
  addTransceiver(kind: 'video' | 'audio', init: { direction: 'recvonly' }): unknown;
  close(): void;
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  ontrack: ((e: { streams: readonly MediaStream[] }) => void) | null;
  connectionState: string;
}

export type PeerFactory = (config: { iceServers: RTCIceServer[] }) => PeerLike;

export const defaultPeerFactory: PeerFactory = (config) => new RTCPeerConnection(config) as unknown as PeerLike;

/** Console side: sends the camera to the phone. One sender per transmission. */
export class LiveSender {
  private pc: PeerLike | null = null;
  private stream: MediaStream | null = null;
  private unsubscribe: (() => void) | null = null;
  private stateCb: (s: LiveState) => void = () => {};
  state: LiveState = 'idle';

  constructor(
    private readonly signal: LiveSignal,
    private readonly peerFactory: PeerFactory = defaultPeerFactory,
    private readonly iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
  ) {}

  onState(cb: (s: LiveState) => void): void {
    this.stateCb = cb;
  }

  /** Starts sending `stream`. Waits for the phone's "hello" (or answers a hello that already came). */
  async start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    this.unsubscribe = this.signal.onMessage((m) => void this.handle(m));
    this.setState('connecting');
    // The phone may already be waiting: a hello from us makes it say hello back.
    await this.signal.send({ type: 'hello' });
  }

  private async handle(m: SignalMessage) {
    if (m.type === 'hello') await this.offer(false);
    else if (m.type === 'answer' && this.pc) await this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
    else if (m.type === 'ice' && this.pc) await this.pc.addIceCandidate(m.candidate).catch(() => {});
  }

  private async offer(iceRestart: boolean) {
    if (!this.stream) return;
    if (!this.pc || !iceRestart) {
      this.pc?.close();
      this.pc = this.peerFactory({ iceServers: this.iceServers });
      for (const track of this.stream.getTracks()) this.pc.addTrack(track, this.stream);
      this.pc.onicecandidate = (e) => { if (e.candidate) void this.signal.send({ type: 'ice', candidate: e.candidate.toJSON() }); };
      this.pc.onconnectionstatechange = () => {
        const s = this.pc?.connectionState;
        if (s === 'connected') this.setState('connected');
        else if (s === 'failed') { this.setState('failed'); void this.offer(true); }
        else if (s === 'disconnected') this.setState('connecting');
      };
    }
    const offer = await this.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    await this.pc.setLocalDescription(offer);
    await this.signal.send({ type: 'offer', sdp: offer.sdp ?? '' });
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.signal.send({ type: 'bye' }).catch(() => {});
    this.pc?.close();
    this.pc = null;
    this.stream = null;
    this.setState('idle');
  }

  private setState(s: LiveState) {
    this.state = s;
    this.stateCb(s);
  }
}

/** Phone side: receives the camera. Shows nothing until a track arrives. */
export class LiveReceiver {
  private pc: PeerLike | null = null;
  private unsubscribe: (() => void) | null = null;
  private streamCb: (s: MediaStream | null) => void = () => {};
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(
    private readonly signal: LiveSignal,
    private readonly peerFactory: PeerFactory = defaultPeerFactory,
    private readonly iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
  ) {}

  onStream(cb: (s: MediaStream | null) => void): void {
    this.streamCb = cb;
  }

  async start(): Promise<void> {
    this.unsubscribe = this.signal.onMessage((m) => void this.handle(m));
    await this.signal.send({ type: 'hello' });
  }

  private async handle(m: SignalMessage) {
    if (m.type === 'hello') {
      await this.signal.send({ type: 'hello' }); // the console just (re)started: ask for the offer
    } else if (m.type === 'offer') {
      this.pc?.close();
      this.pc = this.peerFactory({ iceServers: this.iceServers });
      this.pc.addTransceiver('video', { direction: 'recvonly' });
      this.pc.addTransceiver('audio', { direction: 'recvonly' });
      this.pc.onicecandidate = (e) => { if (e.candidate) void this.signal.send({ type: 'ice', candidate: e.candidate.toJSON() }); };
      this.pc.ontrack = (e) => { if (e.streams[0]) this.streamCb(e.streams[0]); };
      this.pc.onconnectionstatechange = () => {
        if (this.pc?.connectionState === 'failed' || this.pc?.connectionState === 'closed') this.streamCb(null);
      };
      await this.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this.signal.send({ type: 'answer', sdp: answer.sdp ?? '' });
    } else if (m.type === 'ice') {
      if (this.pc) await this.pc.addIceCandidate(m.candidate).catch(() => {});
      else this.pendingIce.push(m.candidate);
    } else if (m.type === 'bye') {
      this.pc?.close();
      this.pc = null;
      this.streamCb(null);
    }
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pc?.close();
    this.pc = null;
    this.streamCb(null);
    await this.signal.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- Supabase channel

/** Something with Supabase's `channel()` (kept structural so the shared package does not import the client type here). */
export interface ChannelClient {
  channel(name: string, opts?: { config: { broadcast: { self: boolean } } }): {
    on(type: 'broadcast', filter: { event: string }, cb: (p: { payload: unknown }) => void): unknown;
    subscribe(cb?: (status: string) => void): unknown;
    send(msg: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown>;
  };
  removeChannel(ch: unknown): Promise<unknown>;
}

/** One channel per transmission, named after the participant. Both sides join the same name. */
export function supabaseLiveSignal(client: ChannelClient, participantId: string): LiveSignal {
  const ch = client.channel(`live:${participantId}`, { config: { broadcast: { self: false } } });
  const cbs = new Set<(m: SignalMessage) => void>();
  ch.on('broadcast', { event: 'signal' }, (p) => cbs.forEach((cb) => cb(p.payload as SignalMessage)));
  const ready = new Promise<void>((resolve) => {
    ch.subscribe((status) => { if (status === 'SUBSCRIBED') resolve(); });
  });
  return {
    async send(msg) {
      await ready;
      await ch.send({ type: 'broadcast', event: 'signal', payload: msg });
    },
    onMessage(cb) {
      cbs.add(cb);
      return () => { cbs.delete(cb); };
    },
    async close() {
      cbs.clear();
      await client.removeChannel(ch);
    },
  };
}
