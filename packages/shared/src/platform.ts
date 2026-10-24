// Platform layer: everything that differs between "home-screen web app" today and a
// wrapped App Store / Play Store app later (e.g. Capacitor). App code only talks to `Platform`,
// never to `navigator.serviceWorker`, `Notification` or `matchMedia` directly.
// To ship natively later: add a `nativePlatform` implementing the same interface and pick it at startup.

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface PushSubscriptionInfo {
  kind: 'webpush' | 'apns' | 'fcm';
  endpoint: string;       // web push endpoint, or native device token
  keys?: { p256dh: string; auth: string };
}

/** Small string store. Web: localStorage. Native later: Capacitor Preferences (survives app updates). */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface Platform {
  name: 'web' | 'ios-native' | 'android-native';
  /** True when running as an installed app (home-screen web app or native app). */
  isInstalled(): boolean;
  /** iOS vs Android vs desktop, for choosing install instructions. */
  device(): 'ios' | 'android' | 'desktop';
  /** True inside Instagram/WhatsApp/Facebook in-app browsers, which cannot install. */
  isInAppBrowser(): boolean;
  pushPermission(): PushPermission;
  /** Must be called from a direct user tap. */
  requestPushAndSubscribe(vapidPublicKey: string): Promise<PushSubscriptionInfo | null>;
  currentPushSubscription(): Promise<PushSubscriptionInfo | null>;
  setBadge(count: number): void;
  storage: KeyValueStore;

  /** Call once at startup, before anything else (web: registers the service worker). */
  start(serviceWorkerUrl?: string): Promise<void>;
  /** Android/desktop Chrome offers its own install dialog; iOS never does. */
  installPromptAvailable(): boolean;
  onInstallPromptAvailable(cb: () => void): void;
  /** Must be called from a direct user tap. */
  promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Did this launch come from tapping a notification? Reads and then removes the marker from the address. */
  takeLaunchFromNotification(): NotificationOpen | null;
  /** The app was already open and a notification was tapped. Returns an unsubscribe function. */
  onNotificationOpened(cb: (open: NotificationOpen) => void): () => void;
}

export interface NotificationOpen {
  kind: string | null;
  mode: string | null;
}

/** Marker added to every notification link (see supabase/functions/send_push/push_logic.ts). */
export const FROM_PUSH_PARAM = 'from';
export const FROM_PUSH_VALUE = 'push';

/** Reads ?from=push&kind=…&mode=… from a URL. Returns null if it was not a notification launch. */
export function parseNotificationOpen(url: string): NotificationOpen | null {
  const u = new URL(url, 'https://x.invalid');
  if (u.searchParams.get(FROM_PUSH_PARAM) !== FROM_PUSH_VALUE) return null;
  return { kind: u.searchParams.get('kind'), mode: u.searchParams.get('mode') };
}

/** The same URL without the notification marker (so a reload does not count again). */
export function stripNotificationParams(url: string): string {
  const u = new URL(url);
  u.searchParams.delete(FROM_PUSH_PARAM);
  u.searchParams.delete('kind');
  return u.toString();
}

export function detectDevice(userAgent: string, maxTouchPoints = 0): 'ios' | 'android' | 'desktop' {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  // iPadOS reports itself as Mac; touch points give it away.
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return 'desktop';
}

/** Standalone = launched from the home-screen icon, not a browser tab. */
export function detectStandalone(
  matchMedia: ((query: string) => { matches: boolean }) | undefined,
  navigatorStandalone: boolean | undefined,
): boolean {
  const displayMode = ['standalone', 'fullscreen', 'minimal-ui']
    .some((m) => matchMedia?.(`(display-mode: ${m})`).matches === true);
  // Older iOS only exposes navigator.standalone.
  return displayMode || navigatorStandalone === true;
}

export function detectInAppBrowser(userAgent: string): boolean {
  return /(Instagram|FBAN|FBAV|FB_IAB|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|LinkedInApp)/i.test(userAgent);
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function memoryStorage(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => { m.set(k, v); },
    remove: (k) => { m.delete(k); },
  };
}

/** localStorage can throw (private mode, storage full); fall back to memory so the app still runs. */
function webStorage(): KeyValueStore {
  const fallback = memoryStorage();
  const ls = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
  return {
    get(k) { try { return ls()?.getItem(k) ?? fallback.get(k); } catch { return fallback.get(k); } },
    set(k, v) { fallback.set(k, v); try { ls()?.setItem(k, v); } catch { /* keep in memory */ } },
    remove(k) { fallback.remove(k); try { ls()?.removeItem(k); } catch { /* ignore */ } },
  };
}

function toInfo(sub: PushSubscription | null): PushSubscriptionInfo | null {
  if (!sub) return null;
  const json = sub.toJSON();
  return {
    kind: 'webpush',
    endpoint: sub.endpoint,
    keys: json.keys ? { p256dh: json.keys.p256dh ?? '', auth: json.keys.auth ?? '' } : undefined,
  };
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredInstall: BeforeInstallPromptEvent | null = null;
const installListeners: Array<() => void> = [];

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export const webPlatform: Platform = {
  name: 'web',

  isInstalled() {
    return detectStandalone(
      typeof window.matchMedia === 'function' ? (q) => window.matchMedia(q) : undefined,
      (navigator as Navigator & { standalone?: boolean }).standalone,
    );
  },

  device() {
    return detectDevice(navigator.userAgent, navigator.maxTouchPoints);
  },

  isInAppBrowser() {
    return detectInAppBrowser(navigator.userAgent);
  },

  pushPermission() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
    return Notification.permission as PushPermission;
  },

  async requestPushAndSubscribe(vapidPublicKey) {
    if (this.pushPermission() === 'unsupported') return null;
    const result = await Notification.requestPermission();
    if (result !== 'granted') return null;
    // `ready` never resolves if the service worker failed to register; do not hang the Activate button.
    const reg = await withTimeout(navigator.serviceWorker.ready, 10_000, null);
    if (!reg) return null;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return toInfo(existing);
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
    return toInfo(sub);
  },

  async currentPushSubscription() {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return toInfo((await reg?.pushManager.getSubscription()) ?? null);
  },

  setBadge(count) {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (count > 0) nav.setAppBadge?.(count).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  },

  storage: webStorage(),

  async start(serviceWorkerUrl = '/sw.js') {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // keep it for our own Install button
      deferredInstall = e as BeforeInstallPromptEvent;
      installListeners.forEach((cb) => cb());
    });
    window.addEventListener('appinstalled', () => { deferredInstall = null; });
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register(serviceWorkerUrl, { scope: '/' });
      } catch (err) {
        console.error('service worker registration failed', err);
      }
    }
  },

  installPromptAvailable() {
    return deferredInstall !== null;
  },

  onInstallPromptAvailable(cb) {
    installListeners.push(cb);
  },

  async promptInstall() {
    const e = deferredInstall;
    if (!e) return 'unavailable';
    deferredInstall = null; // can only be used once
    await e.prompt();
    return (await e.userChoice).outcome;
  },

  takeLaunchFromNotification() {
    const open = parseNotificationOpen(location.href);
    if (open) history.replaceState(history.state, '', stripNotificationParams(location.href));
    return open;
  },

  onNotificationOpened(cb) {
    if (!('serviceWorker' in navigator)) return () => {};
    const handler = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type === 'notification_opened' && d.url) {
        const open = parseNotificationOpen(d.url);
        if (open) cb(open);
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  },
};

/** The one place that picks the platform. A native build adds its own branch here. */
export function currentPlatform(): Platform {
  return webPlatform;
}
