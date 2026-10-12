// Decides which screen a participant sees. Pure function so it can be tested without a phone.
// Rule (CLAUDE.md): the chat opens only when the app is installed AND push works. Re-checked on every launch.

import type { Platform, PushPermission } from './platform';

export type GateStep =
  | 'open_in_browser'     // inside Instagram/WhatsApp: must open in Safari/Chrome first
  | 'install'             // running in a browser tab: show install guide
  | 'agreement'           // installed, not yet agreed
  | 'activate'            // agreed, notifications not yet allowed
  | 'push_denied'         // permission denied: remove icon and add again
  | 'push_unsupported'    // too old a phone/OS
  | 'ready';              // open the app

export interface GateInput {
  installed: boolean;
  inAppBrowser: boolean;
  agreed: boolean;
  permission: PushPermission;
  hasSubscription: boolean;
}

export function gateStep(i: GateInput): GateStep {
  if (!i.installed) return i.inAppBrowser ? 'open_in_browser' : 'install';
  if (!i.agreed) return 'agreement';
  if (i.permission === 'unsupported') return 'push_unsupported';
  if (i.permission === 'denied') return 'push_denied';
  if (i.permission !== 'granted' || !i.hasSubscription) return 'activate';
  return 'ready';
}

export async function readGateInput(p: Platform, agreed: boolean): Promise<GateInput> {
  const permission = p.pushPermission();
  const sub = permission === 'granted' ? await p.currentPushSubscription() : null;
  return {
    installed: p.isInstalled(),
    inAppBrowser: p.isInAppBrowser(),
    agreed,
    permission,
    hasSubscription: sub !== null,
  };
}
