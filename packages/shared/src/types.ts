// Shared data shapes. They mirror supabase/migrations/0001_schema.sql — change both together.

export type Mode = 'chat' | 'line' | 'live';
export type OperatorState = 'live' | 'away';
export type Sender = 'participant' | 'nickii' | 'system';

export interface Participant {
  id: string;            // auth user id
  pseudonym: string;     // p_xxxx, the only id that goes into the dataset
  agreed_at: string | null;
  agreement_version: string | null;
  platform: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  participant_id: string;
  sender: Sender;
  body: string;
  input_method: 'typed' | 'dictated' | 'unknown' | null;
  t_ms: number;          // server clock, UTC ms
  created_at: string;
}

export type LineStatus = 'invited' | 'waiting' | 'live' | 'done' | 'left';

export interface LineEntry {
  id: string;
  participant_id: string;
  status: LineStatus;       // at most one 'live' entry at a time (database enforces it)
  invited_t_ms: number;
  arrived_t_ms: number | null;
  started_t_ms: number | null;
  ended_t_ms: number | null;
}

/** Result of the `my_line_position()` database function (participant side). */
export interface LinePosition {
  status: LineStatus;
  line_position: number;      // 1 = next; 0 = in direct transmission now
  estimated_wait_ms: number;
}

/** Single row (id = 1). Who is in direct transmission lives in line_entries (status 'live'). */
export interface OperatorStatus {
  state: OperatorState;
  status_word: string;     // shown to participants: LISTENING / THINKING / …
  updated_t_ms: number;
}

export interface PushSubscriptionRow {
  id: string;
  participant_id: string;
  kind: 'webpush' | 'apns' | 'fcm';
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
  created_at: string;
  last_success_at: string | null;
}

/** One row per participant from the `inbox` view (console only). */
export interface InboxRow {
  participant_id: string;
  pseudonym: string;
  last_in_t_ms: number | null;
  last_in_body: string | null;
  last_out_t_ms: number | null;
  waiting_since_t_ms: number | null;   // null = Nickii answered last
}

export interface ClockSyncRow {
  device: string;
  offset_ms: number;
  round_trip_ms: number;
  t_ms: number;
}

/** Event names written to operator_events / participant_events. Keep the list closed so the dataset stays clean. */
export const OPERATOR_EVENTS = [
  'state_live', 'state_away', 'thread_opened', 'thread_closed',
  'compose_start', 'compose_pause', 'compose_delete', 'compose_send',
  'push_sent', 'push_broadcast', 'line_invite', 'transmission_start', 'transmission_end',
  'loop_started', 'mask_clip', 'face_capture_heartbeat',
] as const;
export type OperatorEventName = (typeof OPERATOR_EVENTS)[number];

export const PARTICIPANT_EVENTS = [
  'app_open', 'app_hidden', 'app_visible', 'install_gate_blocked', 'agreement_accepted',
  'push_enabled', 'push_denied', 'push_opened', 'mode_changed',
  'line_joined', 'line_left', 'transmission_seen', 'compose_start', 'message_sent',
] as const;
export type ParticipantEventName = (typeof PARTICIPANT_EVENTS)[number];

export interface OperatorEvent {
  name: OperatorEventName;
  participant_id?: string | null;
  data?: Record<string, unknown>;
  t_ms: number;            // when it happened, server clock
}

export interface ParticipantEvent {
  participant_id: string;
  name: ParticipantEventName;
  data?: Record<string, unknown>;
  t_ms: number;
}
