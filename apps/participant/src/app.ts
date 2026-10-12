// Participant app controller: install gate first (re-checked on every launch and every return to
// the app), then the Ghost UI. Talks only to `Platform` (device) and `Backend` (server).

import {
  gateStep, readGateInput, ServerClock, type GateStep, type LinePosition, type LineStatus, type Message,
  type Mode, type OperatorStatus, type Platform, type StreamOptions,
} from '@nickii/shared';
import { AGREEMENT_VERSION } from './agreement';
import type { Backend, Unsubscribe } from './backend';
import { GATE, type Lang } from './copy';
import { clear } from './dom';
import { EventLog } from './event_log';
import {
  activateScreen, agreementScreen, installScreen, messageScreen, openInBrowserScreen,
} from './gate_screens';
import { MainScreen } from './main_screen';
import { modeAfterLineChange, requestedMode } from './mode';
import { statusLine } from './status_line';

export interface AppOptions {
  root: HTMLElement;
  platform: Platform;
  backend: Backend | null;   // null = no server configured
  vapidPublicKey: string;
  lang: Lang;
  streamOptions?: StreamOptions;
  /** How often to refresh the line position while waiting (ms). */
  linePollMs?: number;
}

export class ParticipantApp {
  readonly clock = new ServerClock();
  step: GateStep | 'not_configured' | null = null;
  mode: Mode = 'chat';
  private participantId: string | null = null;
  private agreed = false;
  private events: EventLog;
  private main: MainScreen | null = null;
  private messages: Message[] = [];
  private status: OperatorStatus = { state: 'live', status_word: 'LISTENING', updated_t_ms: 0 };
  private line: LinePosition | null = null;
  private online = true;
  private subs: Unsubscribe[] = [];
  private linePoll: ReturnType<typeof setInterval> | null = null;
  private checking: Promise<void> | null = null;
  private opened = false;

  constructor(private readonly o: AppOptions) {
    this.events = new EventLog({
      store: o.platform.storage,
      insert: (ev) => (o.backend ? o.backend.insertEvents(ev) : Promise.resolve()),
      now: () => this.clock.now(),
      participantId: () => (this.agreed ? this.participantId : null),
    });
  }

  async start(): Promise<void> {
    await this.o.platform.start();
    const launch = this.o.platform.takeLaunchFromNotification();
    document.addEventListener('visibilitychange', () => this.onVisibility());
    this.o.platform.onNotificationOpened((open) => this.events.log('push_opened', { kind: open.kind, while_open: true }));
    await this.check();
    if (launch) this.events.log('push_opened', { kind: launch.kind });
  }

  /** Runs the install gate. Safe to call repeatedly. */
  check(): Promise<void> {
    this.checking ??= this.runCheck().finally(() => { this.checking = null; });
    return this.checking;
  }

  private async runCheck() {
    const p = this.o.platform;
    // Not installed: show the guide without touching the server (browser tabs get no account).
    if (!p.isInstalled()) {
      this.show(p.isInAppBrowser() ? 'open_in_browser' : 'install');
      return;
    }
    const backend = this.o.backend;
    if (!backend) {
      this.show('not_configured');
      return;
    }
    if (!this.participantId) {
      try {
        this.participantId = await backend.signIn();
        this.agreed = await backend.hasAgreed();
      } catch {
        this.show('not_configured');
        return;
      }
      void backend.measureClockOffset().then((off) => { if (off !== null) this.clock.setOffset(off); });
    }
    const input = await readGateInput(p, this.agreed);
    const step = gateStep(input);
    if (step === 'ready') {
      // The push address can change; keep the server's copy current on every launch.
      const sub = await p.currentPushSubscription();
      if (sub) void backend.savePushSubscription(sub).catch(() => {});
    } else if (this.agreed && step !== this.step) {
      this.events.log('install_gate_blocked', { step });
    }
    this.show(step);
  }

  private show(step: GateStep | 'not_configured') {
    if (step === this.step && step === 'ready') return;
    this.step = step;
    if (step !== 'ready') this.stopMain();
    const { root, lang, platform } = this.o;
    clear(root);
    switch (step) {
      case 'open_in_browser': root.append(openInBrowserScreen(lang)); break;
      case 'install': root.append(installScreen(platform, lang)); break;
      case 'agreement': root.append(agreementScreen(lang, () => this.agree())); break;
      case 'activate': root.append(activateScreen(lang, () => this.activate())); break;
      case 'push_denied': root.append(messageScreen(GATE.pushDeniedTitle, GATE.pushDeniedBody, lang)); break;
      case 'push_unsupported': root.append(messageScreen(GATE.pushUnsupportedTitle, GATE.pushUnsupportedBody, lang)); break;
      case 'not_configured': root.append(messageScreen(null, GATE.notConfigured, lang)); break;
      case 'ready': void this.startMain(); break;
    }
  }

  private async agree() {
    await this.o.backend!.acceptAgreement(AGREEMENT_VERSION, this.o.platform.device());
    this.agreed = true;
    this.events.log('agreement_accepted', { version: AGREEMENT_VERSION });
    await this.check();
  }

  private async activate(): Promise<boolean> {
    const p = this.o.platform;
    const sub = await p.requestPushAndSubscribe(this.o.vapidPublicKey);
    if (!sub) {
      if (p.pushPermission() === 'denied') {
        this.events.log('push_denied');
        await this.check();
        return true;
      }
      return false;
    }
    await this.o.backend!.savePushSubscription(sub);
    this.events.log('push_enabled');
    await this.check();
    return true;
  }

  // ------------------------------------------------------------------ main UI

  private async startMain() {
    const backend = this.o.backend!;
    this.main = new MainScreen(this.o.lang, {
      onModeTap: (m) => this.setMode(m),
      onComposeStart: () => this.events.log('compose_start', { mode: this.mode }),
      onSend: (text, method) => this.send(text, method),
      onLeaveLine: () => void this.leaveLine(),
    }, this.o.streamOptions);
    clear(this.o.root);
    this.o.root.append(this.main.el);
    this.o.platform.setBadge(0);
    if (!this.opened) this.events.log('app_open');
    this.opened = true;

    try {
      [this.messages, this.status, this.line] = await Promise.all([
        backend.loadMessages(), backend.loadStatus(), backend.loadLine(),
      ]);
    } catch {
      this.online = false;
    }
    this.main.addMessages(this.messages);
    this.subs.push(
      backend.onMessage((m) => this.onNewMessage(m)),
      backend.onStatus((s) => { this.status = s; this.render(); }),
      backend.onLineChange((s) => void this.onLineChange(s)),
      backend.onConnection((online) => {
        this.online = online;
        if (online) void this.events.flush();
        this.render();
      }),
    );
    const asked = requestedMode(location.search, this.line?.status ?? null);
    this.mode = modeAfterLineChange(asked ?? 'chat', null, this.line?.status ?? null);
    await this.enterMode(this.mode);
    this.render();
  }

  private stopMain() {
    this.subs.forEach((u) => u());
    this.subs = [];
    if (this.linePoll) clearInterval(this.linePoll);
    this.linePoll = null;
    this.main = null;
  }

  private onNewMessage(m: Message) {
    if (this.messages.some((x) => x.id === m.id)) return;
    this.messages.push(m);
    this.main?.addMessage(m, true);
    if (m.sender !== 'participant' && document.visibilityState === 'visible') this.o.platform.setBadge(0);
    this.render();
  }

  private async send(text: string, method: Message['input_method']): Promise<boolean> {
    try {
      const m = await this.o.backend!.sendMessage(text, method);
      this.onNewMessage(m);
      this.events.log('message_sent', { mode: this.mode, chars: text.length, input_method: method });
      return true;
    } catch {
      this.online = false;
      this.render();
      return false;
    }
  }

  private async onLineChange(status: LineStatus) {
    const before = this.line?.status ?? null;
    try {
      this.line = await this.o.backend!.loadLine();
    } catch {
      this.line = status === 'done' || status === 'left' ? null : this.line;
    }
    const next = modeAfterLineChange(this.mode, before, this.line?.status ?? null);
    if (next !== this.mode) await this.setMode(next, true);
    this.render();
  }

  private async setMode(mode: Mode, automatic = false) {
    if (mode === this.mode) return;
    const from = this.mode;
    this.mode = mode;
    this.events.log('mode_changed', { from, to: mode, automatic });
    await this.enterMode(mode);
    this.render();
  }

  private async enterMode(mode: Mode) {
    const backend = this.o.backend!;
    if (mode === 'line' && this.line?.status === 'invited') {
      await backend.lineArrive().catch(() => {});
      this.line = await backend.loadLine().catch(() => this.line);
      this.events.log('line_joined');
    }
    if (mode === 'live') this.events.log('transmission_seen');
    if (this.linePoll) clearInterval(this.linePoll);
    this.linePoll = null;
    if (mode === 'line') {
      // Other people leaving moves this participant up; they cannot see others' rows, so ask again now and then.
      this.linePoll = setInterval(async () => {
        this.line = await backend.loadLine().catch(() => this.line);
        this.render();
      }, this.o.linePollMs ?? 20_000);
    }
  }

  private async leaveLine() {
    await this.o.backend!.lineLeave().catch(() => {});
    this.events.log('line_left');
    this.line = null;
    await this.setMode('chat');
  }

  private onVisibility() {
    const visible = document.visibilityState === 'visible';
    if (this.step === 'ready') this.events.log(visible ? 'app_visible' : 'app_hidden');
    if (visible) {
      this.o.platform.setBadge(0);
      void this.events.flush();
      void this.check(); // permission may have been revoked in Settings
    }
  }

  private render() {
    if (!this.main) return;
    const last = this.messages[this.messages.length - 1];
    this.main.setMode(this.mode, this.line);
    this.main.setAway(this.status.state === 'away');
    this.main.setStatus(statusLine({
      mode: this.mode,
      operatorState: this.status.state,
      operatorWord: this.status.status_word,
      awaitingReply: last?.sender === 'participant',
      lineStatus: this.line?.status ?? null,
      online: this.online,
    }));
  }
}
