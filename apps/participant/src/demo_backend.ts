// In-memory backend for design previews and tests. Nothing answers: there is no AI and no fake reply
// (CLAUDE.md). The `act` handle lets tests (or the console of a preview) play Nickii's side.

import type {
  LinePosition, LineStatus, Message, OperatorStatus, ParticipantEvent,
} from '@nickii/shared';
import type { Backend } from './backend';

export interface DemoHandle {
  backend: Backend;
  act: {
    reply(body: string): Message;
    setStatus(s: Partial<OperatorStatus>): void;
    setLine(status: LineStatus | null, position?: number): void;
    setOnline(online: boolean): void;
  };
  state: {
    agreed: boolean;
    messages: Message[];
    events: ParticipantEvent[];
    pushSubscriptions: number;
    line: LinePosition | null;
  };
}

export function demoBackend(opts: { agreed?: boolean } = {}): DemoHandle {
  const state: DemoHandle['state'] = {
    agreed: opts.agreed ?? false, messages: [], events: [], pushSubscriptions: 0, line: null,
  };
  let status: OperatorStatus = { state: 'live', status_word: 'LISTENING', updated_t_ms: Date.now() };
  const msgCbs = new Set<(m: Message) => void>();
  const statusCbs = new Set<(s: OperatorStatus) => void>();
  const lineCbs = new Set<(s: LineStatus) => void>();
  const connCbs = new Set<(o: boolean) => void>();
  const id = 'demo-participant';
  let n = 0;

  const add = (sender: Message['sender'], body: string, input_method: Message['input_method']): Message => {
    const m: Message = {
      id: `m${++n}`, participant_id: id, sender, body, input_method, t_ms: Date.now() + n, created_at: new Date().toISOString(),
    };
    state.messages.push(m);
    queueMicrotask(() => msgCbs.forEach((cb) => cb(m)));
    return m;
  };
  const sub = <T>(set: Set<T>, cb: T) => { set.add(cb); return () => { set.delete(cb); }; };

  const backend: Backend = {
    async signIn() { return id; },
    async hasAgreed() { return state.agreed; },
    async acceptAgreement() { state.agreed = true; },
    async savePushSubscription() { state.pushSubscriptions++; },
    async measureClockOffset() { return 0; },
    async loadMessages() { return [...state.messages]; },
    async sendMessage(body, inputMethod) { return add('participant', body, inputMethod); },
    onMessage(cb) { return sub(msgCbs, cb); },
    async loadStatus() { return status; },
    onStatus(cb) { return sub(statusCbs, cb); },
    async loadLine() { return state.line; },
    onLineChange(cb) { return sub(lineCbs, cb); },
    async lineArrive() { if (state.line?.status === 'invited') act.setLine('waiting', state.line.line_position); },
    async lineLeave() { act.setLine('left'); },
    async insertEvents(events) { state.events.push(...events); },
    onConnection(cb) { cb(true); return sub(connCbs, cb); },
  };

  const act: DemoHandle['act'] = {
    reply: (body) => add('nickii', body, null),
    setStatus(s) {
      status = { ...status, ...s, updated_t_ms: Date.now() };
      statusCbs.forEach((cb) => cb(status));
    },
    setLine(lineStatus, position = 1) {
      const open = lineStatus === 'invited' || lineStatus === 'waiting' || lineStatus === 'live';
      state.line = open && lineStatus
        ? { status: lineStatus, line_position: lineStatus === 'live' ? 0 : position, estimated_wait_ms: position * 300_000 }
        : null;
      if (lineStatus) lineCbs.forEach((cb) => cb(lineStatus));
    },
    setOnline(online) { connCbs.forEach((cb) => cb(online)); },
  };

  return { backend, act, state };
}
