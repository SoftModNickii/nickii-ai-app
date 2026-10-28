// Nickii's control room: inbox (longest waiting first), thread + reply with compose timing,
// push to one/all, Live/Away, holding line, face-capture health. Desktop and phone layouts.

import {
  clear, h, ServerClock, type ConsoleStats, type InboxRow, type LineEntry, type Message, type OperatorEventName,
  type OperatorStatus,
} from '@nickii/shared';
import { ComposeTiming } from './compose_timing';
import type { ConsoleBackend, OperatorEventInput, Unsubscribe } from './console_backend';
import { INVITE_PUSH_TEXT, STATUS_WORD_CHOICES } from './copy';
import { faceHealth, type HeartbeatData } from './face_health';
import { formatWait, sortInbox, waitingCount } from './inbox_order';

type Panel = 'inbox' | 'thread' | 'control';

export interface ConsoleOptions {
  root: HTMLElement;
  backend: ConsoleBackend | null;
  /** Local time source (tests replace it). */
  now?: () => number;
  /** Re-sync the clock this often (docs/dataset.md: every 10 minutes). */
  clockSyncMs?: number;
  /** Refresh the numbers strip this often. */
  statsMs?: number;
  /** Decides when "today" starts in the numbers. */
  timezone?: string;
}

export class ConsoleApp {
  readonly clock = new ServerClock();
  screen: 'login' | 'main' | 'not_configured' = 'login';
  selected: string | null = null;
  private inbox: InboxRow[] = [];
  private thread: Message[] = [];
  private status: OperatorStatus = { state: 'away', status_word: 'LISTENING', updated_t_ms: 0 };
  private line: LineEntry[] = [];
  private heartbeat: { t_ms: number; data: HeartbeatData } | null = null;
  private stats: ConsoleStats | null = null;
  private online = new Set<string>();
  private subs: Unsubscribe[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private failedEvents: OperatorEventInput[] = [];
  private notice = '';
  private panel: Panel = 'inbox';
  private readonly compose: ComposeTiming;
  private readonly el: Record<string, HTMLElement> = {};

  constructor(private readonly o: ConsoleOptions) {
    this.compose = new ComposeTiming((e) => this.log(e.name, e.data, this.selected, e.t_ms));
  }

  private get b(): ConsoleBackend {
    return this.o.backend!;
  }

  private nowServer(): number {
    return this.clock.now(this.o.now?.() ?? Date.now());
  }

  async start(): Promise<void> {
    if (!this.o.backend) {
      this.screen = 'not_configured';
      this.o.root.replaceChildren(h('p', { class: 'center' }, 'Not configured: copy .env.example to .env (docs/setup.md).'));
      return;
    }
    if (await this.b.restore().catch(() => false)) await this.enterMain();
    else this.showLogin();
  }

  // ------------------------------------------------------------------ login

  private showLogin(message = '') {
    this.screen = 'login';
    const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'username', required: true });
    const password = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', required: true });
    const error = h('p', { class: 'error' }, message);
    const form = h('form', { class: 'login' },
      h('div', { class: 'wordmark' }, 'NICKII AI · CONSOLE'), email, password,
      h('button', { class: 'btn', type: 'submit' }, 'Log in'), error);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const r = await this.b.login(email.value, password.value).catch(() => 'wrong' as const);
      if (r === 'ok') await this.enterMain();
      else error.textContent = r === 'not_operator' ? 'This account is not an operator.' : 'Wrong email or password.';
    };
    this.o.root.replaceChildren(form);
  }

  // ------------------------------------------------------------------ main

  private async enterMain() {
    this.screen = 'main';
    this.build();
    await this.syncClock();
    [this.inbox, this.status, this.line, this.heartbeat] = await Promise.all([
      this.b.loadInbox(), this.b.loadStatus(), this.b.loadLine(), this.b.lastHeartbeat(),
    ]);
    await this.refreshStats();
    this.subs.push(
      this.b.onMessage((m) => void this.onMessage(m)),
      this.b.onLineChange(() => void this.reloadLine()),
      this.b.onHeartbeat((hb) => { this.heartbeat = hb; this.renderHealth(); }),
    );
    this.timers.push(
      setInterval(() => { this.renderInbox(); this.renderHealth(); }, 1000),
      setInterval(() => void this.syncClock(), this.o.clockSyncMs ?? 10 * 60_000),
      setInterval(() => void this.refreshStats(), this.o.statsMs ?? 10_000),
    );
    this.renderAll();
  }

  stop(): void {
    this.subs.forEach((u) => u());
    this.timers.forEach(clearInterval);
    this.subs = [];
    this.timers = [];
  }

  private get timezone(): string {
    return this.o.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Vienna';
  }

  /** Numbers strip + who is online. Keeps the old numbers when the connection is bad. */
  private async refreshStats() {
    try {
      [this.stats, this.online] = await Promise.all([this.b.loadStats(this.timezone), this.b.loadOnline()]);
    } catch {
      return;
    }
    this.renderStats();
    this.renderInbox();
  }

  private async syncClock() {
    const r = await this.b.measureClockOffset().catch(() => null);
    if (!r) return;
    this.clock.setOffset(r.offsetMs);
    await this.b.saveClockSync(r.offsetMs, r.roundTripMs).catch(() => {});
  }

  private build() {
    const e = this.el;
    e.liveBtn = h('button', { type: 'button', class: 'switch' });
    e.liveBtn.onclick = () => void this.toggleLive();
    const word = h('input', { class: 'status-word', attrs: { list: 'status-words', 'aria-label': 'Status word' } });
    word.onchange = () => void this.setWord(word.value.trim().toUpperCase());
    e.word = word;
    e.waiting = h('span', { class: 'pill' });
    e.health = h('span', { class: 'pill' });
    e.stats = h('div', { class: 'stats', attrs: { 'aria-label': 'Numbers' } });
    e.inbox = h('ul', { class: 'inbox' });
    e.threadHead = h('div', { class: 'thread-head' });
    e.messages = h('div', { class: 'messages' });
    const replyBox = h('textarea', { rows: 3, placeholder: 'Reply (⌘/Ctrl + Enter sends)', attrs: { 'aria-label': 'Reply' } });
    let lastLen = 0;
    replyBox.addEventListener('input', (ev) => {
      this.compose.input(this.nowServer(), (ev as InputEvent).inputType ?? '', lastLen, replyBox.value.length);
      lastLen = replyBox.value.length;
    });
    replyBox.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); void this.sendReply(); }
    });
    e.reply = replyBox;
    const sendBtn = h('button', { type: 'button', class: 'btn' }, 'Send');
    sendBtn.onclick = () => void this.sendReply();
    const inviteBtn = h('button', { type: 'button', class: 'btn secondary' }, 'Invite to line');
    inviteBtn.onclick = () => void this.invite();
    e.composer = h('div', { class: 'composer' }, replyBox, h('div', { class: 'row' }, inviteBtn, sendBtn));
    e.notice = h('p', { class: 'notice', attrs: { role: 'status' } });
    e.line = h('div', { class: 'line' });
    const bc = h('textarea', { rows: 3, placeholder: 'Message to everyone', attrs: { 'aria-label': 'Message to everyone' } });
    const bcBtn = h('button', { type: 'button', class: 'btn secondary' }, 'Send to all');
    bcBtn.onclick = () => void this.broadcast(bc);
    e.faceDetail = h('p', { class: 'quiet small' });

    const nav = h('nav', { class: 'panels' }, ...(['inbox', 'thread', 'control'] as Panel[]).map((p) => {
      const b = h('button', { type: 'button', attrs: { 'data-panel': p } }, p[0]!.toUpperCase() + p.slice(1));
      b.onclick = () => this.showPanel(p);
      return b;
    }));
    e.nav = nav;
    e.main = h('div', { class: 'console panel-inbox' },
      h('header', { class: 'bar' },
        h('span', { class: 'wordmark' }, 'NICKII AI'), e.liveBtn, word,
        h('datalist', { id: 'status-words' }, ...STATUS_WORD_CHOICES.map((w) => h('option', { value: w }))),
        e.waiting, e.health),
      e.stats,
      nav,
      h('section', { class: 'col col-inbox' }, h('h2', {}, 'Inbox'), e.inbox),
      h('section', { class: 'col col-thread' }, e.threadHead, e.messages, e.composer, e.notice),
      h('section', { class: 'col col-control' },
        h('h2', {}, 'Holding line'), e.line,
        h('h2', {}, 'Push to all'), bc, bcBtn,
        h('h2', {}, 'Face capture'), e.faceDetail));
    clear(this.o.root);
    this.o.root.append(e.main);
  }

  private showPanel(p: Panel) {
    this.panel = p;
    this.el.main!.className = `console panel-${p}`;
  }

  private renderAll() {
    this.renderStatus();
    this.renderStats();
    this.renderInbox();
    this.renderThread();
    this.renderLine();
    this.renderHealth();
  }

  private renderStatus() {
    const live = this.status.state === 'live';
    this.el.liveBtn!.textContent = live ? '● LIVE' : '○ AWAY';
    this.el.liveBtn!.classList.toggle('on', live);
    this.el.liveBtn!.setAttribute('aria-pressed', String(live));
    if (document.activeElement !== this.el.word) (this.el.word as HTMLInputElement).value = this.status.status_word;
  }

  private renderStats() {
    if (!this.el.stats) return;
    const s = this.stats;
    const tile = (label: string, value: number | string, hint = '') =>
      h('div', { class: 'stat', title: hint }, h('span', { class: 'stat-value' }, String(value)), h('span', { class: 'stat-label' }, label));
    if (!s) {
      this.el.stats.replaceChildren(h('p', { class: 'quiet small' }, 'Numbers not loaded yet.'));
      return;
    }
    this.el.stats.replaceChildren(
      tile('installed', s.installed, 'accepted the agreement inside the installed app'),
      tile('reachable', s.with_push, 'have working notifications'),
      tile('online now', s.online_now, 'app open on the screen in the last 90 s'),
      tile('waiting', s.waiting, 'wrote and have no answer yet'),
      tile('in line', s.in_line + s.live_now, s.live_now ? 'one in direct transmission' : ''),
      tile('new today', s.installed_today),
      tile('in today', s.messages_in_today, 'messages from participants today'),
      tile('out today', s.messages_out_today, 'your replies today'),
      tile('pushes today', s.pushes_today),
    );
  }

  private renderInbox() {
    if (!this.el.inbox) return;
    const now = this.nowServer();
    const rows = sortInbox(this.inbox);
    this.el.waiting!.textContent = `${waitingCount(rows)} waiting`;
    this.el.inbox.replaceChildren(...rows.map((r) => {
      const waiting = r.waiting_since_t_ms !== null;
      const online = this.online.has(r.participant_id);
      const li = h('li', { class: `${waiting ? 'waiting' : ''} ${r.participant_id === this.selected ? 'selected' : ''} ${online ? 'online' : ''}` },
        h('span', { class: 'who' }, r.pseudonym, online ? h('span', { class: 'online-dot', title: 'online now' }) : null),
        h('span', { class: 'when' }, waiting ? formatWait(now - r.waiting_since_t_ms!) : ''),
        h('span', { class: 'what' }, r.last_in_body ?? ''));
      li.onclick = () => void this.openThread(r.participant_id);
      li.tabIndex = 0;
      li.onkeydown = (ev) => { if (ev.key === 'Enter') void this.openThread(r.participant_id); };
      return li;
    }));
  }

  private renderThread() {
    const row = this.inbox.find((r) => r.participant_id === this.selected);
    this.el.composer!.hidden = !this.selected;
    this.el.threadHead!.textContent = row ? row.pseudonym : 'Pick a conversation';
    this.el.messages!.replaceChildren(...this.thread.map((m) =>
      h('p', { class: `msg ${m.sender}` }, m.body)));
    this.el.messages!.scrollTop = this.el.messages!.scrollHeight;
    this.el.notice!.textContent = this.notice;
  }

  private renderLine() {
    const name = (id: string) => this.inbox.find((r) => r.participant_id === id)?.pseudonym ?? id.slice(0, 8);
    const someoneLive = this.line.some((e) => e.status === 'live');
    if (this.line.length === 0) {
      this.el.line!.replaceChildren(h('p', { class: 'quiet small' }, 'Nobody in the line.'));
      return;
    }
    this.el.line!.replaceChildren(h('ol', {}, ...this.line.map((e) => {
      const buttons: HTMLElement[] = [];
      if (e.status === 'live') {
        const end = h('button', { type: 'button', class: 'btn' }, 'End');
        end.onclick = () => void this.endTransmission(e);
        buttons.push(end);
      } else {
        const start = h('button', { type: 'button', class: 'btn', disabled: someoneLive }, 'Start');
        start.onclick = () => void this.startTransmission(e);
        const remove = h('button', { type: 'button', class: 'btn secondary' }, 'Remove');
        remove.onclick = () => void this.b.updateLine(e.id, { status: 'left', ended_t_ms: this.nowServer() }).then(() => this.reloadLine());
        buttons.push(start, remove);
      }
      return h('li', { class: e.status }, h('span', {}, `${name(e.participant_id)} · ${e.status}`), ...buttons);
    })));
  }

  private renderHealth() {
    if (!this.el.health) return;
    const fh = faceHealth(this.heartbeat, this.nowServer());
    this.el.health.textContent = `FACE ${fh.level === 'ok' ? 'OK' : fh.level.toUpperCase()}`;
    this.el.health.className = `pill health-${fh.level}`;
    const d = this.heartbeat?.data;
    this.el.faceDetail!.textContent = d
      ? `${fh.message} Frames today: ${d.frames_today ?? '–'} · ${d.fps?.toFixed(0) ?? '–'} fps · waiting uploads: ${d.pending_chunks ?? 0}`
      : fh.message;
  }

  // ------------------------------------------------------------------ actions

  private async openThread(participantId: string) {
    if (this.selected === participantId) { this.showPanel('thread'); return; }
    if (this.selected) await this.closeThread();
    this.selected = participantId;
    this.notice = '';
    this.thread = await this.b.loadThread(participantId);
    void this.log('thread_opened', {}, participantId);
    this.showPanel('thread');
    this.renderInbox();
    this.renderThread();
    (this.el.reply as HTMLTextAreaElement).focus();
  }

  private async closeThread() {
    if (this.compose.active) this.compose.abandon();
    await this.log('thread_closed', {}, this.selected);
    (this.el.reply as HTMLTextAreaElement).value = '';
  }

  private async sendReply() {
    const box = this.el.reply as HTMLTextAreaElement;
    const body = box.value.trim();
    const to = this.selected;
    if (!body || !to) return;
    let m: Message;
    try {
      m = await this.b.reply(to, body);
    } catch (err) {
      this.setNotice(`Not sent: ${(err as Error).message}`);
      return;
    }
    this.compose.send(this.nowServer(), body.length);
    box.value = '';
    this.addToThread(m);
    try {
      const r = await this.b.push([to], 'reply', body);
      this.setNotice(r.sent > 0 ? '' : 'Saved, but no push was delivered (no active notification on that phone).');
    } catch (err) {
      this.setNotice(`Saved, but push failed: ${(err as Error).message}`);
    }
  }

  private async broadcast(box: HTMLTextAreaElement) {
    const body = box.value.trim();
    if (!body) return;
    if (typeof confirm === 'function' && !confirm(`Send to all ${this.inbox.length} participants?`)) return;
    try {
      await this.b.broadcast(this.inbox.map((r) => r.participant_id), body);
      const r = await this.b.push('all', 'broadcast', body);
      box.value = '';
      this.setNotice(`Sent to all. Push delivered: ${r.sent}, removed: ${r.removed}, failed: ${r.failed}.`);
    } catch (err) {
      this.setNotice(`Broadcast problem: ${(err as Error).message}`);
    }
  }

  private async toggleLive() {
    const state = this.status.state === 'live' ? 'away' : 'live';
    await this.b.setStatus({ state });
    this.status = { ...this.status, state };
    await this.log(state === 'live' ? 'state_live' : 'state_away', {});
    this.renderStatus();
  }

  private async setWord(word: string) {
    if (!word || word === this.status.status_word) return;
    await this.b.setStatus({ status_word: word });
    this.status = { ...this.status, status_word: word };
  }

  private async invite() {
    const to = this.selected;
    if (!to) return;
    if (this.line.some((e) => e.participant_id === to)) {
      this.setNotice('Already in the line.');
      return;
    }
    try {
      await this.b.invite(to);
      await this.log('line_invite', {}, to);
      await this.b.push([to], 'line_invite', INVITE_PUSH_TEXT).catch(() => this.setNotice('Invited, but push failed.'));
      await this.reloadLine();
    } catch (err) {
      this.setNotice(`Invite failed: ${(err as Error).message}`);
    }
  }

  private async startTransmission(e: LineEntry) {
    await this.b.updateLine(e.id, { status: 'live', started_t_ms: this.nowServer() });
    await this.log('transmission_start', {}, e.participant_id);
    await this.reloadLine();
  }

  private async endTransmission(e: LineEntry) {
    await this.b.updateLine(e.id, { status: 'done', ended_t_ms: this.nowServer() });
    await this.log('transmission_end', {}, e.participant_id);
    await this.reloadLine();
  }

  // ------------------------------------------------------------------ updates

  private async onMessage(m: Message) {
    if (m.participant_id === this.selected) this.addToThread(m);
    // Refresh the inbox from the server so waiting times stay exact.
    this.inbox = await this.b.loadInbox().catch(() => this.inbox);
    this.renderInbox();
  }

  private addToThread(m: Message) {
    if (this.thread.some((x) => x.id === m.id)) return;
    this.thread.push(m);
    this.renderThread();
  }

  private async reloadLine() {
    this.line = await this.b.loadLine().catch(() => this.line);
    this.renderLine();
  }

  private setNotice(text: string) {
    this.notice = text;
    if (this.el.notice) this.el.notice.textContent = text;
  }

  /** Dataset event with server time. Failed writes are kept and retried with the next event. */
  private async log(name: OperatorEventName, data: Record<string, unknown>, participantId: string | null = null, t_ms?: number) {
    this.failedEvents.push({ name, data, participant_id: participantId, t_ms: t_ms ?? this.nowServer() });
    const pending = this.failedEvents.splice(0);
    for (const [i, e] of pending.entries()) {
      try {
        await this.b.logEvent(e);
      } catch {
        this.failedEvents.push(...pending.slice(i));
        return;
      }
    }
  }

  get pendingEvents(): number {
    return this.failedEvents.length;
  }
}
