// Backend implementation on Supabase (Auth anonymous sign-in, Postgres with RLS, Realtime).
// Schema: supabase/migrations/0001_schema.sql.
// Anonymous sign-ins: https://supabase.com/docs/guides/auth/auth-anonymous (must be switched on in the dashboard).
// Realtime Postgres changes: https://supabase.com/docs/guides/realtime/postgres-changes

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  measureServerOffset, type LinePosition, type LineStatus, type Message, type OperatorStatus,
} from '@nickii/shared';
import type { Backend } from './backend';

export function supabaseBackend(client: SupabaseClient): Backend {
  let userId: string | null = null;
  const uid = () => {
    if (!userId) throw new Error('not signed in');
    return userId;
  };
  const check = <T>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };

  return {
    async signIn() {
      const { data } = await client.auth.getSession();
      if (data.session) {
        userId = data.session.user.id;
        return userId;
      }
      const r = check(await client.auth.signInAnonymously());
      userId = r.user!.id;
      return userId;
    },

    async hasAgreed() {
      const rows = check(await client.from('participants').select('agreed_at').eq('id', uid()));
      return (rows?.[0]?.agreed_at ?? null) !== null;
    },

    async acceptAgreement(version, platform) {
      check(await client.rpc('accept_agreement', { p_agreement_version: version, p_platform: platform }));
    },

    async savePushSubscription(sub) {
      check(await client.from('push_subscriptions').upsert({
        participant_id: uid(),
        kind: sub.kind,
        endpoint: sub.endpoint,
        p256dh: sub.keys?.p256dh ?? null,
        auth: sub.keys?.auth ?? null,
      }, { onConflict: 'endpoint' }));
    },

    async measureClockOffset() {
      const r = await measureServerOffset(client, 3);
      return r?.offsetMs ?? null;
    },

    async loadMessages() {
      return check(await client.from('messages').select('*').eq('participant_id', uid()).order('t_ms')) as Message[];
    },

    async sendMessage(body, inputMethod) {
      return check(await client.from('messages')
        .insert({ participant_id: uid(), sender: 'participant', body, input_method: inputMethod })
        .select().single()) as Message;
    },

    onMessage(cb) {
      const ch = client.channel(`messages:${uid()}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `participant_id=eq.${uid()}` },
          (p) => cb(p.new as Message))
        .subscribe();
      return () => { void client.removeChannel(ch); };
    },

    async loadStatus() {
      return check(await client.from('operator_status').select('state, status_word, updated_t_ms').single()) as OperatorStatus;
    },

    onStatus(cb) {
      const ch = client.channel('operator_status')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'operator_status' },
          (p) => cb(p.new as OperatorStatus))
        .subscribe();
      return () => { void client.removeChannel(ch); };
    },

    async loadLine() {
      const rows = check(await client.rpc('my_line_position')) as LinePosition[];
      return rows[0] ?? null;
    },

    onLineChange(cb) {
      const ch = client.channel(`line:${uid()}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'line_entries', filter: `participant_id=eq.${uid()}` },
          (p) => cb((p.new as { status: LineStatus }).status))
        .subscribe();
      return () => { void client.removeChannel(ch); };
    },

    async lineArrive() {
      check(await client.rpc('line_arrive'));
    },

    async lineLeave() {
      check(await client.rpc('line_leave'));
    },

    async insertEvents(events) {
      check(await client.from('participant_events').insert(events));
    },

    onConnection(cb) {
      // Browser online/offline is the most reliable signal on phones; Realtime reconnects on its own.
      const on = () => cb(true);
      const off = () => cb(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      cb(navigator.onLine);
      return () => {
        window.removeEventListener('online', on);
        window.removeEventListener('offline', off);
      };
    },
  };
}
