// Deno test (run: `npx deno@2 test --allow-net --allow-env --allow-read supabase/functions`).
// Checks that the npm web-push library really encrypts and sends under Deno, the runtime
// Supabase Edge Functions use, against a local fake push service.
import webpush from 'npm:web-push@3.6.7';
import { buildPayload } from './push_logic.ts';
import { sendWebPush } from './index.ts';

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

Deno.test('web-push sends an encrypted Declarative Web Push payload from Deno', async () => {
  const vapid = webpush.generateVAPIDKeys();
  // A browser-like subscription: P-256 public key + 16 random auth bytes.
  const browserKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', browserKeys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));

  let seen: { headers: Headers; size: number } | null = null;
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    seen = { headers: req.headers, size: (await req.arrayBuffer()).byteLength };
    return new Response(null, { status: 201 });
  });

  try {
    webpush.setVapidDetails('mailto:test@example.com', vapid.publicKey, vapid.privateKey);
    const payload = JSON.stringify(buildPayload({ to: ['p'], kind: 'reply', body: 'hello' }, 'https://app.example'));
    const status = await sendWebPush(
      { id: 's1', participant_id: 'p', endpoint: `http://127.0.0.1:${server.addr.port}/push/abc`, p256dh: b64url(p256dh), auth: b64url(auth) },
      payload,
    );
    if (status !== 201) throw new Error(`status ${status}`);
    const s = seen as { headers: Headers; size: number } | null;
    if (!s) throw new Error('push service got nothing');
    if (s.headers.get('content-encoding') !== 'aes128gcm') throw new Error('not aes128gcm');
    if (!s.headers.get('authorization')?.startsWith('vapid t=')) throw new Error('no VAPID authorization');
    if (s.headers.get('urgency') !== 'high') throw new Error('urgency missing');
    if (s.size <= payload.length) throw new Error('body does not look encrypted');

    // A dead subscription answers 410; a closed port is a network error (0).
    const gone = Deno.serve({ port: 0, onListen() {} }, () => new Response(null, { status: 410 }));
    const goneStatus = await sendWebPush(
      { id: 's2', participant_id: 'p', endpoint: `http://127.0.0.1:${gone.addr.port}/x`, p256dh: b64url(p256dh), auth: b64url(auth) },
      payload,
    );
    await gone.shutdown();
    if (goneStatus !== 410) throw new Error(`expected 410, got ${goneStatus}`);
  } finally {
    await server.shutdown();
  }
});
