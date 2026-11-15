// Console panel: import Nickii's head scan (PLY/OBJ from an iPhone/iPad scanning app), adjust, preview, publish.
// Everything runs in the browser; only the finished dots (about 16 bytes each) are uploaded.

import {
  DEFAULT_HEAD_OPTIONS, encodeHead, h, parseScan, scanToHead,
  type HeadOptions, type HeadPoint, type ScanMesh,
} from '@nickii/shared';

export interface HeadPreview {
  el: HTMLElement;
  setPoints(points: HeadPoint[] | null): void;
  setTurn(radians: number | null): void;
  dispose(): void;
}

export interface HeadPanelDeps {
  /** Uploads the encoded head and makes it the one participants see. */
  publish(version: string, data: ArrayBuffer): Promise<void>;
  /** Back to the generated placeholder head. */
  usePlaceholder(): Promise<void>;
  /** The version participants see now (null = placeholder). */
  current(): string | null;
  /** 3D preview (Three.js); tests pass a fake. */
  makePreview?: () => Promise<HeadPreview>;
  now?: () => number;
}

/** Blob.arrayBuffer() where it exists, FileReader otherwise (older Safari, test environments). */
function readFile(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('could not read the file'));
    r.readAsArrayBuffer(file);
  });
}

async function defaultPreview(): Promise<HeadPreview> {
  const { ghostHead3D } = await import('@nickii/shared/head_render');
  const head = ghostHead3D();
  head.el.className = 'head-preview';
  return head as unknown as HeadPreview;
}

export class HeadPanel {
  readonly el: HTMLElement;
  private mesh: ScanMesh | null = null;
  private fileName = '';
  private opts: HeadOptions = { ...DEFAULT_HEAD_OPTIONS, cropBottom: 0.15, keepRadius: 0.6 };
  private points: HeadPoint[] = [];
  private preview: HeadPreview | null = null;
  private readonly info = h('p', { class: 'quiet small' });
  private readonly controls = h('div', { class: 'head-controls', hidden: true });
  private readonly previewSlot = h('div', { class: 'head-preview-slot', hidden: true });
  private readonly publishBtn = h('button', { type: 'button', class: 'btn' }, 'Publish to participants');
  private readonly currentLine = h('p', { class: 'small' });
  private redrawTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly d: HeadPanelDeps) {
    const file = h('input', { type: 'file', attrs: { accept: '.ply,.obj', 'aria-label': 'Head scan file' } });
    file.onchange = () => { const f = file.files?.[0]; if (f) void this.load(f); };
    const pick = h('button', { type: 'button', class: 'btn secondary' }, 'Choose scan (.ply / .obj)');
    pick.onclick = () => file.click();
    file.hidden = true;

    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
      const out = h('span', { class: 'small quiet' }, fmt(get()));
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()), attrs: { 'aria-label': label } });
      input.oninput = () => { set(Number(input.value)); out.textContent = fmt(Number(input.value)); this.schedule(); };
      return h('label', { class: 'head-row' }, h('span', { class: 'small' }, label), input, out);
    };
    const up = h('select', { attrs: { 'aria-label': 'Up direction' } },
      h('option', { value: 'y' }, 'Up: Y (most apps)'), h('option', { value: 'z' }, 'Up: Z'), h('option', { value: '-z' }, 'Up: −Z'));
    up.onchange = () => { this.opts.up = up.value as HeadOptions['up']; this.schedule(); };
    const turn = h('button', { type: 'button', class: 'btn secondary' }, 'Turn 90°');
    turn.onclick = () => { this.opts.turn = ((this.opts.turn + 1) % 4) as HeadOptions['turn']; this.schedule(); };
    const mirror = h('label', { class: 'small' }, h('input', { type: 'checkbox' }), ' mirror');
    (mirror.firstChild as HTMLInputElement).onchange = (e) => { this.opts.mirror = (e.target as HTMLInputElement).checked; this.schedule(); };
    const look = h('input', { type: 'range', min: '-3.14', max: '3.14', step: '0.01', value: '0', attrs: { 'aria-label': 'Look around' } });
    look.oninput = () => this.preview?.setTurn(Number(look.value));

    this.controls.append(
      h('div', { class: 'row' }, up, turn, mirror),
      slider('Cut bottom', 0, 0.6, 0.01, () => this.opts.cropBottom, (v) => { this.opts.cropBottom = v; }, (v) => `${Math.round(v * 100)}%`),
      slider('Keep around head', 0.2, 1, 0.01, () => this.opts.keepRadius, (v) => { this.opts.keepRadius = v; }, (v) => `${Math.round(v * 100)}%`),
      slider('Dots', 1000, 8000, 250, () => this.opts.points, (v) => { this.opts.points = v; }, (v) => String(v)),
      h('label', { class: 'head-row' }, h('span', { class: 'small' }, 'Look around'), look),
      this.publishBtn,
    );
    this.publishBtn.onclick = () => void this.publish();
    const placeholder = h('button', { type: 'button', class: 'btn secondary' }, 'Use placeholder head');
    placeholder.onclick = () => void this.toPlaceholder();

    this.el = h('div', { class: 'head-panel' },
      this.currentLine,
      h('div', { class: 'row' }, pick, placeholder), file,
      this.info, this.previewSlot, this.controls);
    this.renderCurrent();
  }

  renderCurrent(): void {
    const v = this.d.current();
    this.currentLine.textContent = v ? `Participants see: your scan (${v}).` : 'Participants see: the placeholder head.';
  }

  /** Reads and parses the file; shows the preview. */
  async load(file: Blob & { name: string }): Promise<void> {
    this.info.textContent = `Reading ${file.name}…`;
    try {
      const data = await readFile(file);
      this.mesh = parseScan(file.name, data);
      this.fileName = file.name;
    } catch (err) {
      this.mesh = null;
      this.info.textContent = `Could not read ${file.name}: ${(err as Error).message}`;
      this.controls.hidden = true;
      return;
    }
    const n = this.mesh.positions.length / 3;
    const tris = this.mesh.triangles ? this.mesh.triangles.length / 3 : 0;
    this.info.textContent = `${file.name}: ${n.toLocaleString('en')} points${tris ? `, ${tris.toLocaleString('en')} triangles` : ''}${this.mesh.colors ? ', with colours' : ''}. Adjust until only the head is left and the face looks at you.`;
    this.controls.hidden = false;
    if (!this.preview) {
      try {
        this.preview = await (this.d.makePreview ?? defaultPreview)();
        this.previewSlot.replaceChildren(this.preview.el);
        this.preview.setTurn(0);
      } catch {
        this.previewSlot.replaceChildren(h('p', { class: 'small quiet' }, 'No 3D preview on this device.'));
      }
    }
    this.previewSlot.hidden = false;
    this.redraw();
  }

  /** The dots as they would be published (tests read this). */
  get result(): HeadPoint[] {
    return this.points;
  }

  get options(): HeadOptions {
    return { ...this.opts };
  }

  private schedule() {
    if (this.redrawTimer) clearTimeout(this.redrawTimer);
    this.redrawTimer = setTimeout(() => this.redraw(), 60);
  }

  private redraw() {
    if (!this.mesh) return;
    this.points = scanToHead(this.mesh, this.opts);
    this.preview?.setPoints(this.points.length ? this.points : null);
    this.publishBtn.disabled = this.points.length < 100;
  }

  async publish(): Promise<void> {
    this.redraw();
    if (this.points.length < 100) return;
    const t = new Date((this.d.now ?? Date.now)());
    const pad = (n: number) => String(n).padStart(2, '0');
    const version = `scan_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}_${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
    this.publishBtn.disabled = true;
    this.info.textContent = 'Publishing…';
    try {
      await this.d.publish(version, encodeHead(this.points));
      this.info.textContent = `Published from ${this.fileName}. Open phones switch to it within seconds.`;
    } catch (err) {
      this.info.textContent = `Not published: ${(err as Error).message}`;
    } finally {
      this.publishBtn.disabled = false;
      this.renderCurrent();
    }
  }

  private async toPlaceholder() {
    try {
      await this.d.usePlaceholder();
      this.info.textContent = 'Participants see the placeholder head again.';
    } catch (err) {
      this.info.textContent = `Could not switch: ${(err as Error).message}`;
    }
    this.renderCurrent();
  }

  dispose(): void {
    this.preview?.dispose();
  }
}
