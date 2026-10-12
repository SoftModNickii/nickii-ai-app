// Server side of face capture: operator login, clock sync, heartbeat events, chunk upload
// to the private Storage bucket `face_chunks` (supabase/migrations/0001_schema.sql).

import type { SupabaseClient } from '@supabase/supabase-js';
import { measureServerOffset } from '@nickii/shared';

export interface CaptureBackend {
  restore(): Promise<boolean>;
  login(email: string, password: string): Promise<boolean>;
  measureClockOffset(): Promise<{ offsetMs: number; roundTripMs: number } | null>;
  saveClockSync(offsetMs: number, roundTripMs: number): Promise<void>;
  heartbeat(t_ms: number, data: Record<string, unknown>): Promise<void>;
  upload(path: string, gz: Uint8Array): Promise<void>;
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
    async upload(path, gz) {
      check(await client.storage.from('face_chunks').upload(path, new Blob([gz as BlobPart], { type: 'application/gzip' }), {
        upsert: true, contentType: 'application/gzip',
      }));
    },
  };
}
