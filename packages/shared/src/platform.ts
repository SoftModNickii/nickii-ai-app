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
}

export function detectDevice(userAgent: string, maxTouchPoints = 0): 'ios' | 'android' | 'desktop' {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  // iPadOS reports itself as Mac; touch points give it away.
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return 'desktop';
}

export function detectInAppBrowser(userAgent: string): boolean {
  return /(Instagram|FBAN|FBAV|FB_IAB|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|LinkedInApp)/i.test(userAgent);
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
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

export const webPlatform: Platform = {
  name: 'web',

  isInstalled() {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || window.matchMedia?.('(display-mode: fullscreen)').matches;
    // Older iOS exposes navigator.standalone.
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return Boolean(standalone || iosStandalone);
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
    const reg = await navigator.serviceWorker.ready;
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
};
