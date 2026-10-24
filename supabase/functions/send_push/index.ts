// Supabase Edge Function (Deno): sends Web Push notifications to participants.
// Called by the operator console with Nickii's login token. Logic lives in push_logic.ts (tested with vitest).
//
// POST /functions/v1/send_push
//   { "to": ["<participant id>"] | "all", "kind": "reply" | "broadcast" | "line_invite", "body": "...", "path"?: "/?mode=line" }
// Answer: { "sent": n, "removed": n, "failed": n }
//
// Secrets (set with `supabase secrets set`, never in the repo):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…), APP_URL (participant app address)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// Edge Function docs: https://supabase.com/docs/guides/functions
// web-push library: https://github.com/web-push-libs/web-push (used through Deno's npm: support).

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildPayload, parsePushRequest, sendToAll, type SubscriptionTarget } from './push_logic.ts';

/**
 * Encrypts with web-push (VAPID + aes128gcm) but sends with Deno's own fetch, avoiding web-push's
 * Node https layer. Returns the push service's HTTP status, 0 on network error.
 */
export async function sendWebPush(sub: SubscriptionTarget, body: string): Promise<number> {
  const details = webpush.generateRequestDetails(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    body,
    { TTL: 60 * 60 * 24, urgency: 'high', contentEncoding: 'aes128gcm' },
  );
  try {
    const res = await fetch(details.endpoint, {
      method: details.method,
      headers: details.headers as Record<string, string>,
      body: new Uint8Array(details.body as Uint8Array),
    });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}

const env = (name: string): string => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  // 1. Only Nickii (a row in public.operators) may send.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: isOperator, error: opError } = await asCaller.rpc('is_operator');
  if (opError || isOperator !== true) return json(403, { error: 'operator login required' });

  // 2. Validate the request.
  let request;
  try {
    request = parsePushRequest(await req.json());
  } catch (e) {
    return json(400, { error: (e as Error).message });
  }

  // 3. Load subscriptions with the service role (participants' rows are not visible to anyone else).
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  let query = admin.from('push_subscriptions').select('id, participant_id, endpoint, p256dh, auth').eq('kind', 'webpush');
  if (request.to !== 'all') query = query.in('participant_id', request.to);
  const { data: subs, error: subError } = await query;
  if (subError) return json(500, { error: subError.message });

  // 4. Send.
  webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  const payload = JSON.stringify(buildPayload(request, env('APP_URL')));
  const summary = await sendToAll(subs as SubscriptionTarget[], payload, (sub, body) => sendWebPush(sub, body));

  // 5. Housekeeping: drop dead subscriptions, remember good ones.
  if (summary.gone.length) await admin.from('push_subscriptions').delete().in('id', summary.gone);
  if (summary.sent.length) {
    await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).in('id', summary.sent);
  }

  // 6. Dataset: one operator event per send (operational endpoints are never logged).
  const { data: now } = await admin.rpc('server_time_ms');
  await admin.from('operator_events').insert({
    name: request.to === 'all' ? 'push_broadcast' : 'push_sent',
    participant_id: request.to !== 'all' && request.to.length === 1 ? request.to[0] : null,
    data: {
      kind: request.kind,
      recipients: request.to === 'all' ? 'all' : request.to.length,
      sent: summary.sent.length,
      removed: summary.gone.length,
      failed: summary.failed.length,
    },
    t_ms: typeof now === 'number' ? now : Date.now(),
  });

  if (summary.failed.length) console.error('push failures', summary.failed);
  return json(200, { sent: summary.sent.length, removed: summary.gone.length, failed: summary.failed.length });
}

if (import.meta.main) Deno.serve(handle);
