import { describe, expect, it } from 'vitest';
import { gateStep, readGateInput, type GateInput } from './install_gate';
import type { Platform } from './platform';

const ready: GateInput = {
  installed: true, inAppBrowser: false, agreed: true, permission: 'granted', hasSubscription: true,
};

describe('gateStep', () => {
  it('opens the app only when installed, agreed, granted and subscribed', () => {
    expect(gateStep(ready)).toBe('ready');
  });

  it('asks in-app browsers to open in Safari/Chrome first', () => {
    expect(gateStep({ ...ready, installed: false, inAppBrowser: true })).toBe('open_in_browser');
  });

  it('shows the install guide in a normal browser tab', () => {
    expect(gateStep({ ...ready, installed: false })).toBe('install');
  });

  it('install comes before everything else, even if push already works', () => {
    expect(gateStep({ ...ready, installed: false, agreed: false, permission: 'denied' })).toBe('install');
  });

  it('agreement comes before notifications', () => {
    expect(gateStep({ ...ready, agreed: false, permission: 'default', hasSubscription: false })).toBe('agreement');
    expect(gateStep({ ...ready, agreed: false })).toBe('agreement');
  });

  it('asks to activate when permission was never asked', () => {
    expect(gateStep({ ...ready, permission: 'default', hasSubscription: false })).toBe('activate');
  });

  it('asks to activate again when permission is granted but the subscription is gone', () => {
    expect(gateStep({ ...ready, hasSubscription: false })).toBe('activate');
  });

  it('explains how to recover when permission was denied', () => {
    expect(gateStep({ ...ready, permission: 'denied', hasSubscription: false })).toBe('push_denied');
  });

  it('tells old phones that push is unsupported', () => {
    expect(gateStep({ ...ready, permission: 'unsupported', hasSubscription: false })).toBe('push_unsupported');
  });
});

function fakePlatform(over: Partial<Platform> = {}): Platform {
  return {
    name: 'web',
    isInstalled: () => true,
    device: () => 'ios',
    isInAppBrowser: () => false,
    pushPermission: () => 'granted',
    requestPushAndSubscribe: async () => null,
    currentPushSubscription: async () => ({ kind: 'webpush', endpoint: 'https://push.example/1' }),
    setBadge: () => {},
    storage: { get: () => null, set: () => {}, remove: () => {} },
    start: async () => {},
    installPromptAvailable: () => false,
    onInstallPromptAvailable: () => {},
    promptInstall: async () => 'unavailable',
    takeLaunchFromNotification: () => null,
    onNotificationOpened: () => () => {},
    ...over,
  };
}

describe('readGateInput', () => {
  it('reads everything from the platform', async () => {
    expect(await readGateInput(fakePlatform(), true)).toEqual(ready);
  });

  it('does not look up a subscription unless permission is granted', async () => {
    let asked = false;
    const p = fakePlatform({
      pushPermission: () => 'default',
      currentPushSubscription: async () => { asked = true; return null; },
    });
    const input = await readGateInput(p, true);
    expect(asked).toBe(false);
    expect(input.hasSubscription).toBe(false);
    expect(gateStep(input)).toBe('activate');
  });

  it('reports a missing subscription', async () => {
    const input = await readGateInput(fakePlatform({ currentPushSubscription: async () => null }), true);
    expect(gateStep(input)).toBe('activate');
  });
});
