// The Ghost UI: CHAT · LINE · LIVE bar, floating head, one status word, one sentence, and the thread.

import { h, streamText, type LinePosition, type Message, type Mode, type StreamOptions } from '@nickii/shared';
import { LABELS, LINE_LABELS, SENTENCES, type Lang } from './copy';
import { InputMethodTracker, type InputMethod } from './input_method';
import { availableModes } from './mode';
import type { StatusLine } from './status_line';
import { ghostHead, type GhostHead } from './ghost_head';

export interface MainScreenHandlers {
  onModeTap(mode: Mode): void;
  onComposeStart(): void;
  onSend(text: string, inputMethod: InputMethod): Promise<boolean>;
  onLeaveLine(): void;
}

export class MainScreen {
  readonly el: HTMLElement;
  private readonly tabs: Record<Mode, HTMLButtonElement>;
  private readonly headSlot: HTMLElement;
  private readonly video: HTMLVideoElement;
  private head: GhostHead | null = null;
  private away = false;
  private readonly word: HTMLElement;
  private readonly sentence: HTMLElement;
  private readonly lineInfo: HTMLElement;
  private readonly thread: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly tracker = new InputMethodTracker();
  private readonly shown = new Set<string>();
  private composing = false;

  constructor(private readonly lang: Lang, private readonly handlers: MainScreenHandlers,
    private readonly streamOpts: StreamOptions = {}, headStyle?: 'svg' | '3d') {
    const tab = (m: Mode) => {
      const b = h('button', { type: 'button', class: 'mode', attrs: { role: 'tab' } }, LABELS.modes[m]);
      b.onclick = () => handlers.onModeTap(m);
      return b;
    };
    this.tabs = { chat: tab('chat'), line: tab('line'), live: tab('live') };
    this.headSlot = h('div', { class: 'ghost-slot' });
    this.video = h('video', { class: 'live-video', autoplay: true, playsInline: true, muted: false, hidden: true });
    void ghostHead('', headStyle).then((head) => {
      this.head = head;
      head.setAway(this.away);
      this.headSlot.replaceChildren(head.el);
    });
    this.word = h('p', { class: 'status', attrs: { 'data-testid': 'status-word' } });
    this.sentence = h('p', { class: 'sentence quiet' });
    this.lineInfo = h('div', { class: 'line-info', hidden: true });
    this.thread = h('div', { class: 'thread', attrs: { 'aria-live': 'polite' } });
    this.input = h('textarea', { rows: 1, placeholder: LABELS.ask, attrs: { 'aria-label': LABELS.ask, enterkeyhint: 'send' } });
    this.sendBtn = h('button', { type: 'submit', class: 'send', attrs: { 'aria-label': LABELS.send } }, '↑');

    const form = h('form', { class: 'composer' }, this.input, this.sendBtn);
    form.onsubmit = (e) => { e.preventDefault(); void this.submit(); };
    this.input.addEventListener('keydown', () => this.tracker.keyDown());
    this.input.addEventListener('input', (e) => {
      this.tracker.input((e as InputEvent).inputType ?? '');
      this.autosize();
      const has = this.input.value.trim().length > 0;
      if (has && !this.composing) handlers.onComposeStart();
      this.composing = has;
      this.sendBtn.disabled = !has;
    });
    this.sendBtn.disabled = true;

    this.el = h('section', { class: 'main mode-chat' },
      h('header', { class: 'top' },
        h('div', { class: 'wordmark' }, LABELS.wordmark),
        h('nav', { class: 'modes', attrs: { role: 'tablist' } },
          this.tabs.chat, h('span', { class: 'dot' }, '·'), this.tabs.line, h('span', { class: 'dot' }, '·'), this.tabs.live)),
      h('div', { class: 'stage' }, this.headSlot, this.video, this.word, this.sentence, this.lineInfo),
      this.thread,
      form);
  }

  setMode(mode: Mode, line: LinePosition | null): void {
    this.el.className = `main mode-${mode}`;
    const open = availableModes(line?.status ?? null);
    for (const m of ['chat', 'line', 'live'] as Mode[]) {
      this.tabs[m].disabled = !open[m];
      this.tabs[m].setAttribute('aria-selected', String(m === mode));
    }
    this.renderLine(mode, line);
  }

  setStatus(s: StatusLine): void {
    this.word.textContent = s.word;
    this.sentence.textContent = SENTENCES[s.sentence][this.lang];
  }

  setAway(away: boolean): void {
    this.away = away;
    this.head?.setAway(away);
  }

  /** Live transmission video. null = back to the head. */
  setVideo(stream: MediaStream | null): void {
    this.video.srcObject = stream;
    this.video.hidden = !stream;
    this.headSlot.hidden = Boolean(stream);
    if (stream) void this.video.play().catch(() => {});
  }

  dispose(): void {
    this.head?.dispose();
    this.video.srcObject = null;
  }

  /** History: shown at once. */
  addMessages(messages: Message[]): void {
    for (const m of messages) this.addMessage(m, false);
  }

  /** New message. Replies from Nickii stream in word by word. */
  addMessage(m: Message, stream: boolean): void {
    if (this.shown.has(m.id)) return;
    this.shown.add(m.id);
    const bubble = h('p', { class: `msg ${m.sender === 'participant' ? 'out' : 'in'}` });
    this.thread.append(bubble);
    if (stream && m.sender !== 'participant') {
      void streamText(m.body, (text) => { bubble.textContent = text; this.scrollDown(); }, this.streamOpts);
    } else {
      bubble.textContent = m.body;
    }
    this.scrollDown();
  }

  private renderLine(mode: Mode, line: LinePosition | null) {
    this.lineInfo.hidden = mode !== 'line' || !line;
    if (this.lineInfo.hidden || !line) return;
    const minutes = Math.max(1, Math.round(line.estimated_wait_ms / 60_000));
    const leave = h('button', { type: 'button', class: 'btn secondary' }, LABELS.leaveLine);
    leave.onclick = () => this.handlers.onLeaveLine();
    this.lineInfo.replaceChildren(
      line.line_position <= 1
        ? h('p', {}, LINE_LABELS.next[this.lang])
        : h('dl', {},
          h('dt', {}, LINE_LABELS.position[this.lang]), h('dd', { attrs: { 'data-testid': 'line-position' } }, String(line.line_position)),
          h('dt', {}, LINE_LABELS.wait[this.lang]), h('dd', {}, `~${minutes} ${LINE_LABELS.minutes[this.lang]}`)),
      leave);
  }

  private async submit() {
    const text = this.input.value.trim();
    if (!text) return;
    const method = this.tracker.guess(text);
    this.sendBtn.disabled = true;
    const ok = await this.handlers.onSend(text, method);
    if (ok) {
      this.input.value = '';
      this.tracker.reset();
      this.composing = false;
      this.autosize();
    } else {
      this.sendBtn.disabled = false;
    }
  }

  private autosize() {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, 140)}px`;
  }

  private scrollDown() {
    this.thread.scrollTop = this.thread.scrollHeight;
  }
}
