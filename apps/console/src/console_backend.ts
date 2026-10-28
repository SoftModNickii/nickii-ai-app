// What the operator console needs from the server. Supabase implementation below; tests use a fake.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  measureServerOffset, supabaseLiveSignal, type ConsoleStats, type LiveSignal, type InboxRow, type LineEntry, type Message, type OperatorEventName,
  type OperatorStatus,
} from '@nickii/shared';
import type { HeartbeatData } from './face_health';

export type Unsubscribe = () => void;

export interface OperatorEventInput {
  name: OperatorEventName;
  participant_id?: string | null;
  data?: Record<string, unknown>;
  t_ms: number;
}

export interface ConsoleBackend {
  /** Restores a saved login. Returns true when logged in as an operator. */
  restore(): Promise<boolean>;
  login(email: string, password: string): Promise<'ok' | 'wrong' | 'not_operator'>;
  logout(): Promise<void>;
  measureClockOffset(): Promise<{ offsetMs: number; roundTripMs: number } | null>;
  saveClockSync(offsetMs: number, roundTripMs: number): Promise<void>;

  loadInbox(): Promise<InboxRow[]>;
  /** The numbers strip. `timezone` decides when "today" starts. */
  loadStats(timezone: string): Promise<ConsoleStats>;
  /** participant ids seen in the last 90 s with the app visible. */
  loadOnline(): Promise<Set<string>>;
  loadThread(participantId: string): Promise<Message[]>;
  /** Every new message in any thread. */
  onMessage(cb: (m: Message) => void): Unsubscribe;
  reply(participantId: string, body: string): Promise<Message>;
  broadcast(participantIds: string[], body: string): Promise<void>;
  push(to: string[] | 'all', kind: 'reply' | 'broadcast' | 'line_invite', body: string): Promise<{ sent: number; removed: number; failed: number }>;

  loadStatus(): Promise<OperatorStatus>;
  setStatus(s: Partial<Pick<OperatorStatus, 'state' | 'status_word'>>): Promise<void>;

  loadLine(): Promise<LineEntry[]>;
  onLineChange(cb: () => void): Unsubscribe;
  invite(participantId: string): Promise<void>;
  updateLine(entryId: string, change: Partial<Pick<LineEntry, 'status' | 'started_t_ms' | 'ended_t_ms'>>): Promise<void>;

  /** Signalling channel for the live video to one participant's phone. */
  liveSignal(participantId: string): LiveSignal;

  logEvent(e: OperatorEventInput): Promise<void>;
  lastHeartbeat(): Promise<{ t_ms: number; data: HeartbeatData } | null>;
  onHeartbeat(cb: (h: { t_ms: number; data: HeartbeatData }) => void): Unsubscribe;
}

export function supabaseConsoleBackend(client: SupabaseClient): ConsoleBackend {
  const check = <T>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  const isOperator = async () => (await client.rpc('is_operator')).data === true;

  return {
    async restore() {
      const { data } = await client.auth.getSession();
      return data.session !== null && !data.session.user.is_anonymous && (await isOperator());
    },

    async login(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) return 'wrong';
      if (!(await isOperator())) {
        await client.auth.signOut();
        return 'not_operator';
      }
      return 'ok';
    },

    async logout() {
      await client.auth.signOut();
    },

    measureClockOffset: () => measureServerOffset(client, 5),

    async saveClockSync(offsetMs, roundTripMs) {
      check(await client.from('clock_sync').insert({ device: 'console', offset_ms: offsetMs, round_trip_ms: roundTripMs }));
    },

    async loadInbox() {
      return check(await client.from('inbox').select('*')) as InboxRow[];
    },

    async loadStats(timezone) {
      const rows = check(await client.rpc('console_stats', { p_timezone: timezone })) as ConsoleStats[];
      if (!rows[0]) throw new Error('not an operator');
      return rows[0];
    },

    async loadOnline() {
      const { data: now } = await client.rpc('server_time_ms');
      const since = (typeof now === 'number' ? now : Date.now()) - 90_000;
      const rows = check(await client.from('participant_presence').select('participant_id')
        .eq('visible', true).gt('last_seen_t_ms', since)) as Array<{ participant_id: string }>;
      return new Set(rows.map((r) => r.participant_id));
    },

    async loadThread(participantId) {
      return check(await client.from('messages').select('*').eq('participant_id', participantId).order('t_ms')) as Message[];
    },

    onMessage(cb) {
      const ch = client.channel('console:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => cb(p.new as Message))
        .subscribe();
      return () => { void client.removeChannel(ch); };
    },

    async reply(participantId, body) {
      return check(await client.from('messages')
        .insert({ participant_id: participantId, sender: 'nickii', body }).select().single()) as Message;
    },

    async broadcast(participantIds, body) {
      if (participantIds.length === 0) return;
      check(await client.from('messages').insert(participantIds.map((id) => ({ participant_id: id, sender: 'nickii', body }))));
    },

    async push(to, kind, body) {
      const { data, error } = await client.functions.invoke('send_push', { body: { to, kind, body } });
      if (error) throw new Error(error.message);
      return data as { sent: number; removed: number; failed: number };
    },

    async loadStatus() {
      return check(await client.from('operator_status').select('state, status_word, updated_t_ms').single()) as OperatorStatus;
    },

    async setStatus(s) {
      const { data: now } = await client.rpc('server_time_ms');
      check(await client.from('operator_status').update({ ...s, updated_t_ms: now }).eq('id', 1));
    },

    async loadLine() {
      return check(await client.from('line_entries').select('*')
        .in('status', ['invited', 'waiting', 'live']).order('invited_t_ms')) as LineEntry[];
    },

    onLineChange(cb) {
      const ch = client.channel('console:line')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'line_entries' }, () => cb())
        .subscribe();
      return () => { void client.removeChannel(ch); };
    },

    async invite(participantId) {
      check(await client.from('line_entries').insert({ participant_id: participantId }));
    },

    async updateLine(entryId, change) {
      check(await client.from('line_entries').update(change).eq('id', entryId));
    },

    liveSignal(participantId) {
      return supabaseLiveSignal(client, participantId);
    },

    async logEvent(e) {
      check(await client.from('operator_events').insert({ ...e, data: e.data ?? {} }));
    },

    async lastHeartbeat() {
      const rows = check(await client.from('operator_events').select('t_ms, data')
        .eq('name', 'face_capture_heartbeat').order('t_ms', { ascending: false }).limit(1));
      return (rows?.[0] as { t_ms: number; data: HeartbeatData } | undefined) ?? null;
    },

    onHeartbeat(cb) {
      const ch = client.channel('console:heartbeat')
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'operator_events', filter: 'name=eq.face_capture_heartbeat' },
          (p) => cb(p.new as { t_ms: number; data: HeartbeatData }))
        .subscribe();
      return () => { void client.removeChannel(ch); };
    },
  };
}
