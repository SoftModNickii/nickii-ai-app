import { memoryStorage, type Platform, type PushPermission } from '@nickii/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParticipantApp } from './app';
import { demoBackend, type DemoHandle } from './demo_backend';

interface FakeDevice {
  installed: boolean;
  inApp: boolean;
  device: 'ios' | 'android' | 'desktop';
  permission: PushPermission;
  subscribed: boolean;
  grantOnRequest: PushPermission;
}

function fakePlatform(d: FakeDevice): Platform {
  return {
    name: 'web',
    isInstalled: () => d.installed,
    device: () => d.device,
    isInAppBrowser: () => d.inApp,
    pushPermission: () => d.permission,
    async requestPushAndSubscribe() {
      d.permission = d.grantOnRequest;
      if (d.permission !== 'granted') return null;
      d.subscribed = true;
      return { kind: 'webpush', endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } };
    },
    async currentPushSubscription() {
      return d.subscribed ? { kind: 'webpush', endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } } : null;
    },
    setBadge: vi.fn(),
    storage: memoryStorage(),
    start: async () => {},
    installPromptAvailable: () => false,
    onInstallPromptAvailable: () => {},
    promptInstall: async () => 'unavailable',
    takeLaunchFromNotification: () => null,
    onNotificationOpened: () => () => {},
  };
}

const ready: FakeDevice = {
  installed: true, inApp: false, device: 'ios', permission: 'granted', subscribed: true, grantOnRequest: 'granted',
};

let root: HTMLElement;
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const text = () => root.textContent ?? '';
const button = (label: RegExp) => [...root.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''))!;
const word = () => root.querySelector('[data-testid="status-word"]')?.textContent;

async function launch(device: Partial<FakeDevice>, demo: DemoHandle | null = demoBackend({ agreed: true })) {
  root = document.createElement('main');
  document.body.replaceChildren(root);
  const app = new ParticipantApp({
    root,
    platform: fakePlatform({ ...ready, ...device }),
    backend: demo?.backend ?? null,
    vapidPublicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
    lang: 'en',
    streamOptions: { baseMs: 1, jitter: 0 },
    linePollMs: 1_000_000,
  });
  await app.start();
  await settle();
  return app;
}

beforeEach(() => {
  history.replaceState(null, '', '/');
});

describe('install gate', () => {
  it('in a Safari tab on iPhone: step-by-step install guide, no account created', async () => {
    const demo = demoBackend();
    const signIn = vi.spyOn(demo.backend, 'signIn');
    const app = await launch({ installed: false }, demo);
    expect(app.step).toBe('install');
    expect(text()).toContain('1 · Open the Share menu');
    button(/Next/).click();
    expect(text()).toContain('2 · Add to Home Screen');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('inside Instagram: open in Safari/Chrome', async () => {
    const app = await launch({ installed: false, inApp: true });
    expect(app.step).toBe('open_in_browser');
    expect(text()).toContain('Open in Safari or Chrome');
  });

  it('Android without the install prompt: manual steps', async () => {
    const app = await launch({ installed: false, device: 'android' });
    expect(app.step).toBe('install');
    expect(text()).toContain('Add to Home screen');
  });

  it('installed first time: agreement → Activate → chat, logging consent and push', async () => {
    const demo = demoBackend({ agreed: false });
    const app = await launch({ permission: 'default', subscribed: false }, demo);
    expect(app.step).toBe('agreement');
    expect(text()).toContain('recorded for an artistic dataset');
    expect(demo.state.events).toHaveLength(0); // nothing recorded before consent

    button(/I agree/).click();
    await settle();
    expect(app.step).toBe('activate');
    expect(demo.state.agreed).toBe(true);

    button(/Activate/).click();
    await settle();
    expect(app.step).toBe('ready');
    expect(demo.state.pushSubscriptions).toBeGreaterThan(0);
    expect(demo.state.events.map((e) => e.name)).toEqual(
      expect.arrayContaining(['agreement_accepted', 'push_enabled', 'app_open']));
  });

  it('notifications denied: guide to remove and re-add the icon', async () => {
    const demo = demoBackend({ agreed: true });
    const app = await launch({ permission: 'default', subscribed: false, grantOnRequest: 'denied' }, demo);
    expect(app.step).toBe('activate');
    button(/Activate/).click();
    await settle();
    expect(app.step).toBe('push_denied');
    expect(text()).toContain('Remove the Nickii AI icon');
    expect(demo.state.events.map((e) => e.name)).toContain('push_denied');
  });

  it('subscription lost since last time: back to Activate', async () => {
    const app = await launch({ subscribed: false });
    expect(app.step).toBe('activate');
  });

  it('old phone without push', async () => {
    const app = await launch({ permission: 'unsupported', subscribed: false });
    expect(app.step).toBe('push_unsupported');
  });

  it('no server configured: plain message', async () => {
    const app = await launch({}, null);
    expect(app.step).toBe('not_configured');
  });
});

describe('chat', () => {
  it('shows CHAT · LINE · LIVE with only CHAT open, and never a name or typing indicator', async () => {
    await launch({});
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.mode')];
    expect(tabs.map((t) => t.textContent)).toEqual(['CHAT', 'LINE', 'LIVE']);
    expect(tabs.map((t) => t.disabled)).toEqual([false, true, true]);
    expect(word()).toBe('LISTENING');
    expect(text()).not.toMatch(/typing|Nickii Schamborski|seen/i);
  });

  it('send → THINKING; reply streams in → LISTENING', async () => {
    const demo = demoBackend({ agreed: true });
    await launch({}, demo);
    const input = root.querySelector('textarea')!;
    input.value = 'Who are you?';
    input.dispatchEvent(new Event('input'));
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(demo.state.messages.map((m) => m.body)).toEqual(['Who are you?']);
    expect(word()).toBe('THINKING');
    expect(input.value).toBe('');

    demo.act.reply('I am listening to you.');
    await new Promise((r) => setTimeout(r, 50));
    await settle();
    expect(root.querySelector('.msg.in')!.textContent).toBe('I am listening to you.');
    expect(word()).toBe('LISTENING');
    expect(demo.state.events.map((e) => e.name)).toEqual(expect.arrayContaining(['compose_start', 'message_sent']));
  });

  it('history appears at once in order', async () => {
    const demo = demoBackend({ agreed: true });
    await demo.backend.sendMessage('first', 'typed');
    demo.act.reply('second');
    await launch({}, demo);
    expect([...root.querySelectorAll('.msg')].map((m) => m.textContent)).toEqual(['first', 'second']);
  });

  it('offline: status says so and the text stays in the field', async () => {
    const demo = demoBackend({ agreed: true });
    await launch({}, demo);
    vi.spyOn(demo.backend, 'sendMessage').mockRejectedValue(new Error('offline'));
    const input = root.querySelector('textarea')!;
    input.value = 'hello?';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(word()).toBe('OFFLINE');
    expect(input.value).toBe('hello?');
  });
});

describe('holding line and direct transmission', () => {
  it('invitation → LINE with position; transmission → LIVE; end → CHAT', async () => {
    const demo = demoBackend({ agreed: true });
    const app = await launch({}, demo);

    demo.act.setLine('invited', 3);
    await settle();
    expect(app.mode).toBe('line');
    expect(word()).toBe('WAITING');
    expect(root.querySelector('[data-testid="line-position"]')!.textContent).toBe('3');
    expect(demo.state.line?.status).toBe('waiting'); // arrived

    demo.act.setLine('live');
    await settle();
    expect(app.mode).toBe('live');
    expect(word()).toBe('DIRECT TRANSMISSION');

    demo.act.setLine('done');
    await settle();
    expect(app.mode).toBe('chat');
    expect(demo.state.events.map((e) => e.name)).toEqual(
      expect.arrayContaining(['mode_changed', 'line_joined', 'transmission_seen']));
  });

  it('opening from the invitation lands in LINE', async () => {
    const demo = demoBackend({ agreed: true });
    demo.act.setLine('invited', 1);
    history.replaceState(null, '', '/?mode=line');
    const app = await launch({}, demo);
    expect(app.mode).toBe('line');
    expect(text()).toContain('You are next.');
  });

  it('leaving the line goes back to CHAT', async () => {
    const demo = demoBackend({ agreed: true });
    demo.act.setLine('waiting', 2);
    const app = await launch({}, demo);
    button(/Leave/).click();
    await settle();
    expect(app.mode).toBe('chat');
    expect(demo.state.line).toBeNull();
    expect(demo.state.events.map((e) => e.name)).toContain('line_left');
  });
});
