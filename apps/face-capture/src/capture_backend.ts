// Server side of face capture: operator login, clock sync, heartbeat events, chunk upload
// to the private Storage bucket `face_chunks` (supabase/migrations/0001_schema.sql).

import type { SupabaseClient } from '@supabase/supabase-js';
import { measureServerOffset, supabaseMaskChannel, type MaskChannel } from '@nickii/shared';

export interface CaptureBackend {
  restore(): Promise<boolean>;
  login(email: string, password: string): Promise<boolean>;
  measureClockOffset(): Promise<{ offsetMs: number; roundTripMs: number } | null>;
  saveClockSync(offsetMs: number, roundTripMs: number): Promise<void>;
  heartbeat(t_ms: number, data: Record<string, unknown>): Promise<void>;
  upload(path: string, gz: Uint8Array): Promise<void>;
  /** Called with the participant in direct transmission (null = nobody), now and on every change. */
  onLiveParticipant(cb: (participantId: string | null) => void): () => void;
  /** Live mask frames to that participant's phone. */
  maskChannel(participantId: string): MaskChannel;
  /** Publishes a head (same as the console's Head scan): upload, then make it the current one. */
  publishHead(version: string, data: ArrayBuffer): Promise<void>;
}

export function supabaseCaptureBackend(client: SupabaseClient): CaptureBackend {
  const isOperator = async () => (await client.rpc('is_operator')).data === true;
  const check = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };
  return {
    async restore() {
      const { data } = await client.auth.getSession();
      return data.session !== null && (await isOperator());
    },
    async login(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return !error && (await isOperator());
    },
    measureClockOffset: () => measureServerOffset(client, 5),
    async saveClockSync(offsetMs, roundTripMs) {
      check(await client.from('clock_sync').insert({ device: 'face-capture', offset_ms: offsetMs, round_trip_ms: roundTripMs }));
    },
    async heartbeat(t_ms, data) {
      check(await client.from('operator_events').insert({ name: 'face_capture_heartbeat', t_ms, data }));
    },
    onLiveParticipant(cb) {
      const load = async () => {
        const { data } = await client.from('line_entries').select('participant_id').eq('status', 'live').limit(1);
        cb((data?.[0] as { participant_id: string } | undefined)?.participant_id ?? null);
      };
      void load();
      const ch = client.channel('face:line')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'line_entries' }, () => void load())
        .subscribe();
      const poll = setInterval(() => void load(), 30_000); // in case a realtime message is missed
      return () => { clearInterval(poll); void client.removeChannel(ch); };
    },
    maskChannel(participantId) {
      return supabaseMaskChannel(client, participantId);
    },
    async publishHead(version, data) {
      check(await client.storage.from('public_assets').upload(`head/${version}.bin`, new Blob([data]), {
        upsert: true, contentType: 'application/octet-stream', cacheControl: '31536000',
      }));
      const { data: now } = await client.rpc('server_time_ms');
      check(await client.from('operator_status').update({ head_version: version, updated_t_ms: now }).eq('id', 1));
    },
    async upload(path, gz) {
      check(await client.storage.from('face_chunks').upload(path, new Blob([gz as BlobPart], { type: 'application/gzip' }), {
        upsert: true, contentType: 'application/gzip',
      }));
    },
  };
}
