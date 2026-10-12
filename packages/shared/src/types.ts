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

export interface LineEntry {
  id: string;
  participant_id: string;
  status: 'invited' | 'waiting' | 'live' | 'done' | 'left';
  position: number | null;
  invited_t_ms: number;
  started_t_ms: number | null;
  ended_t_ms: number | null;
}

export interface OperatorStatus {
  state: OperatorState;
  status_word: string;     // shown to participants: LISTENING / THINKING / …
  live_participant_id: string | null;
  updated_t_ms: number;
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
