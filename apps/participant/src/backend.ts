// Everything the participant app needs from the server. The app only talks to this interface,
// so it can be tested with demo_backend.ts and run without a server for design previews.

import type {
  LinePosition, LineStatus, Message, Mode, OperatorStatus, ParticipantEvent, PushSubscriptionInfo,
} from '@nickii/shared';

export interface Backend {
  /** Signs in (anonymous account, kept on the phone). Returns the account id. */
  signIn(): Promise<string>;
  /** True when this account has accepted the agreement. */
  hasAgreed(): Promise<boolean>;
  acceptAgreement(version: string, platform: string): Promise<void>;
  savePushSubscription(sub: PushSubscriptionInfo): Promise<void>;

  /** Measured server clock offset (server - local) in ms, or null if it failed. */
  measureClockOffset(): Promise<number | null>;

  loadMessages(): Promise<Message[]>;
  sendMessage(body: string, inputMethod: Message['input_method']): Promise<Message>;
  /** Called for every new message in this participant's thread (including their own). */
  onMessage(cb: (m: Message) => void): Unsubscribe;

  loadStatus(): Promise<OperatorStatus>;
  onStatus(cb: (s: OperatorStatus) => void): Unsubscribe;

  loadLine(): Promise<LinePosition | null>;
  /** Called when Nickii changes this participant's line entry. */
  onLineChange(cb: (status: LineStatus) => void): Unsubscribe;
  lineArrive(): Promise<void>;
  lineLeave(): Promise<void>;

  insertEvents(events: ParticipantEvent[]): Promise<void>;
  /** "I am here": every 30 s while open, and once when hidden. */
  reportPresence(visible: boolean, mode: Mode, platform: string): Promise<void>;

  /** Realtime connection state, for the OFFLINE status. */
  onConnection(cb: (online: boolean) => void): Unsubscribe;
}

export type Unsubscribe = () => void;
