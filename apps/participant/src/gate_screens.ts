// Screens shown before the chat opens: install guide, open-in-browser, agreement, activate, blocked.

import { h, type Platform } from '@nickii/shared';
import { AGREEMENT } from './agreement';
import { GATE, IOS_STEPS, LABELS, type Lang, type Text } from './copy';
import { ghostHead } from './ghost_head';

const t = (text: Text, lang: Lang) => text[lang];

function frame(...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'gate' },
    h('div', { class: 'wordmark' }, LABELS.wordmark),
    ghostHead('ghost-small'),
    ...children);
}

export function openInBrowserScreen(lang: Lang): HTMLElement {
  const copyBtn = h('button', { class: 'btn secondary', type: 'button' }, LABELS.copyLink);
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.origin + '/');
      copyBtn.textContent = LABELS.copied;
    } catch { /* clipboard blocked: the address is shown below anyway */ }
  };
  return frame(
    h('h1', {}, t(GATE.openInBrowserTitle, lang)),
    h('p', { class: 'quiet' }, t(GATE.openInBrowserBody, lang)),
    h('p', { class: 'address' }, location.host),
    copyBtn,
  );
}

export function installScreen(platform: Platform, lang: Lang): HTMLElement {
  const device = platform.device();
  if (device === 'ios') return iosInstallSteps(lang);
  if (device === 'desktop') {
    return frame(h('h1', {}, t(GATE.installTitle, lang)), h('p', { class: 'quiet' }, t(GATE.installDesktopBody, lang)),
      h('p', { class: 'address' }, location.host));
  }
  // Android: Chrome's own install dialog when it is offered, manual steps otherwise.
  const body = h('p', { class: 'quiet' });
  const button = h('button', { class: 'btn', type: 'button' }, LABELS.install);
  const update = () => {
    const can = platform.installPromptAvailable();
    body.textContent = t(can ? GATE.installAndroidBody : GATE.installAndroidManual, lang);
    button.hidden = !can;
  };
  button.onclick = async () => { await platform.promptInstall(); update(); };
  platform.onInstallPromptAvailable(update);
  update();
  return frame(h('h1', {}, t(GATE.installTitle, lang)), body, button);
}

function iosInstallSteps(lang: Lang): HTMLElement {
  let i = 0;
  const title = h('h1', {});
  const body = h('p', { class: 'quiet' });
  const dots = h('div', { class: 'steps', attrs: { 'aria-hidden': 'true' } });
  const back = h('button', { class: 'btn secondary', type: 'button' }, LABELS.back);
  const next = h('button', { class: 'btn', type: 'button' }, LABELS.next);
  const show = () => {
    const step = IOS_STEPS[i]!;
    title.textContent = t(step.title, lang);
    body.textContent = t(step.body, lang);
    dots.replaceChildren(...IOS_STEPS.map((_, k) => h('span', { class: k === i ? 'on' : '' })));
    back.disabled = i === 0;
    next.disabled = i === IOS_STEPS.length - 1;
  };
  back.onclick = () => { i = Math.max(0, i - 1); show(); };
  next.onclick = () => { i = Math.min(IOS_STEPS.length - 1, i + 1); show(); };
  show();
  return frame(h('p', { class: 'status' }, t(GATE.installTitle, lang)), title, body, dots,
    h('div', { class: 'row' }, back, next));
}

export function agreementScreen(lang: Lang, onAgree: () => Promise<void>): HTMLElement {
  const a = AGREEMENT[lang];
  const button = h('button', { class: 'btn', type: 'button' }, LABELS.agree);
  button.onclick = async () => {
    button.disabled = true;
    try { await onAgree(); } finally { button.disabled = false; }
  };
  return frame(h('h1', {}, a.title), h('div', { class: 'agreement' }, ...a.paragraphs.map((p) => h('p', {}, p))), button);
}

export function activateScreen(lang: Lang, onActivate: () => Promise<boolean>): HTMLElement {
  const error = h('p', { class: 'error', hidden: true }, t(GATE.activateFailed, lang));
  const button = h('button', { class: 'btn', type: 'button' }, LABELS.activate);
  // Notification permission must be requested straight from this tap (iOS requires a user gesture).
  button.onclick = async () => {
    button.disabled = true;
    error.hidden = true;
    const ok = await onActivate().catch(() => false);
    button.disabled = false;
    error.hidden = ok;
  };
  return frame(h('h1', {}, t(GATE.activateTitle, lang)), h('p', { class: 'quiet' }, t(GATE.activateBody, lang)), button, error);
}

export function messageScreen(title: Text | null, body: Text, lang: Lang): HTMLElement {
  return frame(title ? h('h1', {}, t(title, lang)) : null, h('p', { class: 'quiet' }, t(body, lang)));
}
