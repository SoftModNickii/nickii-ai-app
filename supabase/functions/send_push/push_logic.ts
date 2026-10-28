// Pure logic for the send_push Edge Function. No Deno or Node APIs here, so vitest can test it.
//
// Payload format: Declarative Web Push (Safari / iOS 18.4+), described in
// https://webkit.org/blog/16535/meet-declarative-web-push/ . Older browsers ignore the format and
// just fire the service worker's `push` event; apps/participant/public/sw.js reads the same JSON
// and shows the notification itself, so one payload works everywhere.
// `mutable: true` asks Safari to still run the service worker first (it sets the app badge).
// Not yet verified on a real iPhone: see docs/decisions.md.

export const DECLARATIVE_MAGIC = 8030;
export const MAX_BODY_CHARS = 180;

export type PushKind = 'reply' | 'broadcast' | 'line_invite';

export interface PushRequest {
  /** 'all' = every participant with a subscription. */
  to: 'all' | string[];
  kind: PushKind;
  body: string;
  title?: string;
  /** Path inside the participant app, e.g. '/?mode=line'. */
  path?: string;
}

export interface DeclarativePayload {
  web_push: typeof DECLARATIVE_MAGIC;
  notification: {
    title: string;
    body: string;
    navigate: string;
    lang: string;
    silent: boolean;
    tag: string;
  };
  mutable: boolean;
  /** Extra data for our own service worker. */
  data: { kind: PushKind; badge: number };
}

export function parsePushRequest(input: unknown): PushRequest {
  if (typeof input !== 'object' || input === null) throw new Error('body must be a JSON object');
  const o = input as Record<string, unknown>;
  const kinds: PushKind[] = ['reply', 'broadcast', 'line_invite'];
  if (!kinds.includes(o.kind as PushKind)) throw new Error(`kind must be one of ${kinds.join(', ')}`);
  const to = o.to;
  if (to !== 'all' && !(Array.isArray(to) && to.length > 0 && to.every((x) => typeof x === 'string'))) {
    throw new Error("to must be 'all' or a non-empty list of participant ids");
  }
  if (typeof o.body !== 'string' || o.body.trim() === '') throw new Error('body must be non-empty text');
  if (o.title !== undefined && typeof o.title !== 'string') throw new Error('title must be text');
  if (o.path !== undefined && (typeof o.path !== 'string' || !o.path.startsWith('/'))) {
    throw new Error("path must start with '/'");
  }
  return {
    to: to as PushRequest['to'],
    kind: o.kind as PushKind,
    body: o.body,
    title: o.title as string | undefined,
    path: o.path as string | undefined,
  };
}

/** Shortens long replies for the lock screen, at a word boundary. */
export function truncateBody(text: string, max = MAX_BODY_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export function buildPayload(req: PushRequest, appUrl: string): DeclarativePayload {
  const path = req.path ?? (req.kind === 'line_invite' ? '/?mode=line' : '/');
  // APP_URL may live in a folder (https://host/nickii-ai-app/); the path is relative to that folder.
  const navigate = new URL(path.replace(/^\//, ''), appUrl.endsWith('/') ? appUrl : appUrl + '/');
  // The app reads this marker to log `push_opened` (packages/shared/src/platform.ts parseNotificationOpen).
  navigate.searchParams.set('from', 'push');
  navigate.searchParams.set('kind', req.kind);
  return {
    web_push: DECLARATIVE_MAGIC,
    notification: {
      title: req.title ?? 'Nickii AI',
      body: truncateBody(req.body),
      navigate: navigate.toString(),
      lang: 'de-DE',
      silent: false,
      // Same tag = a newer reply replaces the older notification instead of stacking.
      tag: req.kind === 'reply' ? 'nickii-reply' : `nickii-${req.kind}`,
    },
    mutable: true,
    data: { kind: req.kind, badge: 1 },
  };
}

export type SendOutcome = 'ok' | 'gone' | 'retry' | 'error';

/** What to do with a subscription after a push service answered with this HTTP status. */
export function outcomeForStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return 'ok';
  // 404/410: the subscription expired or the app was removed. Delete it.
  if (status === 404 || status === 410) return 'gone';
  if (status === 429 || status >= 500) return 'retry';
  return 'error';
}

export interface SubscriptionTarget {
  id: string;
  participant_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one push; returns the HTTP status from the push service (0 for network errors). */
export type SendOne = (sub: SubscriptionTarget, payload: string) => Promise<number>;

export interface SendSummary {
  sent: string[];       // subscription ids
  gone: string[];       // subscription ids to delete
  failed: Array<{ id: string; status: number }>;
}

/** Sends to all subscriptions with limited parallelism; retries 'retry' outcomes once after a short wait. */
export async function sendToAll(
  subs: SubscriptionTarget[],
  payload: string,
  sendOne: SendOne,
  opts: { concurrency?: number; retryDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SendSummary> {
  const concurrency = opts.concurrency ?? 10;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const summary: SendSummary = { sent: [], gone: [], failed: [] };
  const queue = [...subs];

  async function attempt(sub: SubscriptionTarget): Promise<number> {
    try {
      return await sendOne(sub, payload);
    } catch {
      return 0;
    }
  }

  async function worker() {
    for (let sub = queue.shift(); sub; sub = queue.shift()) {
      let status = await attempt(sub);
      if (outcomeForStatus(status) === 'retry' || status === 0) {
        await sleep(opts.retryDelayMs ?? 1000);
        status = await attempt(sub);
      }
      const outcome = outcomeForStatus(status);
      if (outcome === 'ok') summary.sent.push(sub.id);
      else if (outcome === 'gone') summary.gone.push(sub.id);
      else summary.failed.push({ id: sub.id, status });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, subs.length) }, worker));
  return summary;
}
