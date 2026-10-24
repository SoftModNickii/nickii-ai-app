import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { bestOffset, type ClockSample } from './clock';
import type { KeyValueStore } from './platform';

export interface PublicConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  vapidPublicKey: string;
}

export function readPublicConfig(env: Record<string, string | undefined>): PublicConfig {
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_VAPID_PUBLIC_KEY'].filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing settings in .env: ${missing.join(', ')}. See .env.example and docs/setup.md.`);
  }
  return {
    supabaseUrl: env.VITE_SUPABASE_URL!,
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY!,
    vapidPublicKey: env.VITE_VAPID_PUBLIC_KEY!,
  };
}

/** `storage` keeps the login on the device (Platform.storage, so a native build can swap it). */
export function makeClient(cfg: PublicConfig, storage?: KeyValueStore): SupabaseClient {
  return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: storage && {
        getItem: (k: string) => storage.get(k),
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.remove(k),
      },
    },
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

/** Measures server clock offset using the `server_time_ms` database function. */
export async function measureServerOffset(client: SupabaseClient, rounds = 5) {
  const samples: ClockSample[] = [];
  for (let i = 0; i < rounds; i++) {
    const clientSendMs = Date.now();
    const { data, error } = await client.rpc('server_time_ms');
    const clientReceiveMs = Date.now();
    if (error || typeof data !== 'number') continue;
    samples.push({ clientSendMs, serverMs: data, clientReceiveMs });
  }
  return bestOffset(samples);
}
