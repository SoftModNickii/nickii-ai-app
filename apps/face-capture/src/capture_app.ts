// Face capture page (Nickii's iPhone/iPad front camera, or the Mac webcam): MediaPipe Face Landmarker →
// 52 blendshapes + head pose at ~30 fps → 10-minute chunks saved locally → background upload.
// Also: live dots of her face on screen, the live mask sent to the phone in direct transmission, and
// "Use my face as the head" (a few seconds of frames become the published head).
// Sends a heartbeat every 10 s so the console can show a red warning within 30 s if this stops.
// MediaPipe Face Landmarker for web: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js

import { decodeFace, encodeFace, encodeHead, faceDots, h, ServerClock, type HeadPoint } from '@nickii/shared';
import type { CaptureBackend } from './capture_backend';
import { headVersion, MaskSender, SnapshotCollector } from './face_tools';
import { ChunkStore, uploadPending, type StoredChunk } from './chunk_store';
import type { FaceResultLike } from './face_row';
import { Recorder } from './recorder';

export const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const HEARTBEAT_MS = 10_000;
const SNAPSHOT_MS = 30_000;
const UPLOAD_MS = 30_000;
const CLOCK_SYNC_MS = 10 * 60_000;
const CAMERA_RETRY_MS = 5_000;
const AUTOSTART_KEY = 'nickii.face.autostart';

/** Phones and tablets: front camera, smaller frames (MediaPipe runs on the phone's GPU). */
export function isPhoneOrTablet(ua: string, touchPoints: number): boolean {
  return /iphone|ipad|ipod|android/i.test(ua) || (/macintosh/i.test(ua) && touchPoints > 1);
}

function remember(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private mode */ }
}
function recall(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

interface DotsView { el: HTMLElement; setPoints(p: HeadPoint[] | null): void; setTurn(r: number | null): void; dispose(): void }

interface Detector {
  detectForVideo(video: HTMLVideoElement, timestamp: number): FaceResultLike;
}

type DirHandle = {
  getDirectoryHandle(name: string, o: { create: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void> }> }>;
  name: string;
};

export class CaptureApp {
  private clock = new ServerClock();
  private store!: ChunkStore;
  private recorder!: Recorder;
  private detector: Detector | null = null;
  private video = h('video', { muted: true, playsInline: true, autoplay: true, class: 'preview' });
  private stream: MediaStream | null = null;
  private cameraOk = false;
  private running = false;
  private folder: DirHandle | null = null;
  private pending = 0;
  private lastUploadT: number | null = null;
  private lastError = '';
  private timers: ReturnType<typeof setInterval>[] = [];
  private lastVideoTime = -1;
  private wakeLock: { release(): Promise<void> } | null = null;
  private readonly info = h('dl', { class: 'info' });
  private readonly startBtn = h('button', { class: 'btn', type: 'button' }, 'Start recording');
  private readonly folderBtn = h('button', { class: 'btn secondary', type: 'button' }, 'Also save to a folder…');
  private readonly headBtn = h('button', { class: 'btn secondary', type: 'button', disabled: true }, 'Use my face as the head');
  private readonly maskBox = h('input', { type: 'checkbox', checked: true });
  private readonly viewBtn = h('button', { class: 'btn secondary', type: 'button' }, 'Show camera');
  private readonly stage = h('div', { class: 'stage' });
  private readonly banner = h('p', { class: 'banner', hidden: true });
  private dots: DotsView | null = null;
  private showDots = true;
  private lastDotsT = 0;
  private faceFound = false;
  private mask: MaskSender | null = null;
  private snapshot = new SnapshotCollector(24);
  private stopLive: (() => void) | null = null;
  private readonly mobile = isPhoneOrTablet(navigator.userAgent, navigator.maxTouchPoints ?? 0);

  constructor(private readonly root: HTMLElement, private readonly backend: CaptureBackend | null,
    private readonly modelUrl = DEFAULT_MODEL_URL) {}

  async start(): Promise<void> {
    if (!this.backend) {
      this.root.replaceChildren(h('p', {}, 'Not configured: copy .env.example to .env (docs/setup.md).'));
      return;
    }
    if (await this.backend.restore().catch(() => false)) await this.ready();
    else this.showLogin();
  }

  private showLogin() {
    const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'username' });
    const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
    const err = h('p', { class: 'error' });
    const form = h('form', { class: 'login' }, h('div', { class: 'wordmark' }, 'NICKII AI · FACE CAPTURE'), email, pw,
      h('button', { class: 'btn', type: 'submit' }, 'Log in'), err);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (await this.backend!.login(email.value, pw.value).catch(() => false)) await this.ready();
      else err.textContent = 'Wrong login, or not an operator account.';
    };
    this.root.replaceChildren(form);
  }

  private async ready() {
    this.store = await ChunkStore.open();
    const recovered = await this.store.recoverPartials();
    this.recorder = new Recorder({
      store: this.store,
      now: () => this.clock.now(),
      onChunkSaved: (c) => this.writeToFolder(c),
    });
    this.startBtn.onclick = () => void (this.running ? this.stop() : this.begin());
    this.folderBtn.onclick = () => void this.chooseFolder();
    this.folderBtn.hidden = !('showDirectoryPicker' in window); // Chrome on the Mac only
    this.headBtn.onclick = () => void this.useFaceAsHead();
    this.viewBtn.onclick = () => this.toggleView();
    this.maskBox.onchange = () => { if (this.mask) this.mask.enabled = this.maskBox.checked; };
    this.mask = new MaskSender((pid) => this.backend!.maskChannel(pid));
    this.stopLive = this.backend!.onLiveParticipant((pid) => { this.mask?.setTarget(pid); this.renderInfo(); });
    this.stage.append(this.video);
    this.root.replaceChildren(h('section', { class: 'capture' },
      h('div', { class: 'wordmark' }, 'NICKII AI · FACE'),
      this.stage,
      this.banner,
      h('div', { class: 'row' }, this.startBtn, this.viewBtn, this.headBtn, this.folderBtn),
      h('label', { class: 'small row' }, this.maskBox, ' Send my face to the person in LIVE (as moving dots)'),
      this.info,
      h('p', { class: 'quiet small' },
        'Keep this open and on screen. Recording continues without internet; uploads catch up later.')));
    void this.setUpDots();
    if (recovered) this.lastError = `Recovered ${recovered} unfinished chunk(s) from last time.`;
    await this.syncClock();
    this.timers.push(
      setInterval(() => void this.syncClock(), CLOCK_SYNC_MS),
      setInterval(() => void this.sendHeartbeat(), HEARTBEAT_MS),
      setInterval(() => void this.upload(), UPLOAD_MS),
      setInterval(() => void (this.running && this.recorder.snapshot()), SNAPSHOT_MS),
      setInterval(() => this.renderInfo(), 1000),
    );
    window.addEventListener('pagehide', () => void this.recorder.snapshot());
    document.addEventListener('visibilitychange', () => {
      void this.sendHeartbeat();
      // Phones drop the "keep screen on" lock when the app is hidden; take it again on return.
      if (document.visibilityState === 'visible' && this.running) void this.keepScreenOn();
    });
    void this.upload();
    void this.sendHeartbeat();
    this.renderInfo();
    // Opened from the home-screen icon after it ran before: start by itself.
    if (recall(AUTOSTART_KEY) === '1') void this.begin();
  }

  /** Live dots of the face next to (or instead of) the camera picture. */
  private async setUpDots() {
    try {
      const { ghostHead3D } = await import('@nickii/shared/head_render');
      const view = ghostHead3D();
      view.el.className = 'dots';
      view.setTurn(0);
      this.dots = view;
    } catch {
      this.dots = null; // no WebGL: camera picture only
    }
    this.renderStage();
  }

  private toggleView() {
    this.showDots = !this.showDots;
    this.renderStage();
  }

  private renderStage() {
    const dots = this.showDots && this.dots;
    this.stage.replaceChildren(dots ? this.dots!.el : this.video);
    // The video must stay in the page for the camera to keep running; hide it rather than remove it.
    if (dots) { this.video.classList.add('offstage'); this.stage.append(this.video); } else this.video.classList.remove('offstage');
    this.viewBtn.textContent = dots ? 'Show camera' : 'Show dots';
    this.viewBtn.hidden = !this.dots;
  }

  private say(text: string, ms = 4000) {
    this.banner.textContent = text;
    this.banner.hidden = !text;
    if (text && ms) setTimeout(() => { if (this.banner.textContent === text) this.banner.hidden = true; }, ms);
  }

  /** Countdown, then a couple of seconds of frames become the head participants see. */
  private async useFaceAsHead() {
    if (!this.running) return;
    this.headBtn.disabled = true;
    for (const n of [3, 2, 1]) {
      this.say(`Look straight into the camera… ${n}`, 0);
      await new Promise((r) => setTimeout(r, 800));
    }
    this.say('Hold still…', 0);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 8000));
    const head = await Promise.race([this.snapshot.start(), timeout]);
    if (!head || head.length < 500) {
      this.snapshot.cancel();
      this.say('No face found. Try again with your face in the middle and good light.');
      this.headBtn.disabled = false;
      return;
    }
    this.dots?.setPoints(head);
    this.say('Publishing…', 0);
    try {
      const version = headVersion('face', new Date());
      await this.backend!.publishHead(version, encodeHead(head));
      this.say('Done: participants now see your face as the head.', 6000);
    } catch (err) {
      this.say(`Not published: ${(err as Error).message}`, 8000);
    }
    this.headBtn.disabled = false;
  }

  private async loadDetector(): Promise<Detector> {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe`);
    const create = (delegate: 'GPU' | 'CPU') => FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: this.modelUrl, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    // GPU is much faster; some browsers refuse it, then CPU still works (slower).
    return create('GPU').catch(() => create('CPU'));
  }

  private async begin() {
    this.startBtn.disabled = true;
    try {
      this.detector ??= await this.loadDetector();
      await this.openCamera();
      this.running = true;
      remember(AUTOSTART_KEY, '1');
      this.headBtn.disabled = false;
      this.startBtn.textContent = 'Stop recording';
      await this.keepScreenOn();
      this.loop();
    } catch (err) {
      this.lastError = `Could not start: ${(err as Error).message}`;
    } finally {
      this.startBtn.disabled = false;
      this.renderInfo();
    }
  }

  private async stop() {
    this.running = false;
    remember(AUTOSTART_KEY, null);
    this.headBtn.disabled = true;
    this.startBtn.textContent = 'Start recording';
    await this.recorder.stop();
    await this.wakeLock?.release().catch(() => {});
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.cameraOk = false;
    void this.upload();
  }

  private async openCamera() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: this.mobile
        ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    const track = this.stream.getVideoTracks()[0]!;
    track.addEventListener('ended', () => {
      this.cameraOk = false;
      this.lastError = 'Webcam stopped. Retrying…';
      void this.sendHeartbeat();
      setTimeout(() => void this.reopenCamera(), CAMERA_RETRY_MS);
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.cameraOk = true;
  }

  private async reopenCamera() {
    if (!this.running || this.cameraOk) return;
    try {
      await this.openCamera();
      this.lastError = 'Webcam back.';
    } catch {
      setTimeout(() => void this.reopenCamera(), CAMERA_RETRY_MS);
    }
  }

  private loop() {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const next = () => this.loop();
    if (this.cameraOk && this.detector && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      let result: FaceResultLike | null = null;
      try {
        result = this.detector.detectForVideo(v, performance.now());
      } catch (err) {
        this.lastError = `Detection error: ${(err as Error).message}`;
      }
      this.recorder.frame(result);
      this.useLandmarks(result);
    }
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  }

  private async keepScreenOn() {
    this.wakeLock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } })
      .wakeLock?.request('screen').catch(() => null) ?? null;
  }

  /** Live dots on screen, live mask to LIVE, snapshot frames. */
  private useLandmarks(result: FaceResultLike | null) {
    const lm = result?.faceLandmarks?.[0];
    this.faceFound = Boolean(lm && lm.length >= 468);
    if (!lm || !this.faceFound) return;
    const v = this.video;
    const aspect = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
    const now = performance.now();
    this.mask?.frame(now, lm, aspect);
    this.snapshot.frame(lm, aspect);
    if (this.dots && this.showDots && now - this.lastDotsT > 66) { // ~15 fps is enough for the preview
      this.lastDotsT = now;
      // Mirror like the camera picture, so moving left moves the dots left.
      const dots = faceDots(decodeFace(encodeFace(lm, aspect)), { perEdge: 1, keepPose: true });
      this.dots.setPoints(dots.map((p) => ({ ...p, x: -p.x })));
    }
  }

  private async syncClock() {
    const r = await this.backend!.measureClockOffset().catch(() => null);
    if (!r) return;
    this.clock.setOffset(r.offsetMs);
    await this.backend!.saveClockSync(r.offsetMs, r.roundTripMs).catch(() => {});
  }

  private async upload() {
    try {
      const r = await uploadPending(this.store, (path, gz) => this.backend!.upload(path, gz), () => this.clock.now());
      this.pending = r.pending;
      if (r.lastUploadT) this.lastUploadT = r.lastUploadT;
    } catch (err) {
      this.lastError = `Upload: ${(err as Error).message}`;
    }
  }

  private async sendHeartbeat() {
    const s = this.recorder?.stats;
    await this.backend!.heartbeat(this.clock.now(), {
      recording: this.running,
      camera_ok: this.running ? this.cameraOk : undefined,
      face_present: s?.face_present ?? false,
      fps: s?.fps ?? 0,
      frames_today: s?.frames_today ?? 0,
      pending_chunks: this.pending,
      last_upload_t_ms: this.lastUploadT,
      tab_visible: document.visibilityState === 'visible',
      device: this.mobile ? 'phone' : 'computer',
      mask_live: Boolean(this.mask?.enabled && this.mask.liveParticipant),
      clock_offset_ms: Math.round(this.clock.offset),
    }).catch(() => {}); // offline: the console will show red after 30 s, which is correct
  }

  private async chooseFolder() {
    const picker = (window as Window & { showDirectoryPicker?: (o: { mode: 'readwrite' }) => Promise<DirHandle> }).showDirectoryPicker;
    if (!picker) {
      this.lastError = 'This browser cannot write to folders. Use Chrome.';
      return;
    }
    try {
      this.folder = await picker({ mode: 'readwrite' });
      this.folderBtn.textContent = `Saving to folder: ${this.folder.name}`;
    } catch { /* cancelled */ }
  }

  private async writeToFolder(c: StoredChunk) {
    if (!this.folder || !c.gz) return;
    try {
      const day = await this.folder.getDirectoryHandle(c.day, { create: true });
      const file = await day.getFileHandle(c.name, { create: true });
      const w = await file.createWritable();
      await w.write(c.gz as BlobPart);
      await w.close();
      await this.store.update(c.name, { in_folder: true });
    } catch (err) {
      this.lastError = `Folder write failed (chunk is still saved in the browser): ${(err as Error).message}`;
    }
  }

  private renderInfo() {
    const s = this.recorder?.stats;
    const item = (k: string, v: string) => [h('dt', {}, k), h('dd', {}, v)];
    const ago = (t: number | null) => (t ? `${Math.round((this.clock.now() - t) / 1000)} s ago` : '—');
    this.info.replaceChildren(
      ...item('Recording', this.running ? 'yes' : 'no'),
      ...item('Webcam', this.running ? (this.cameraOk ? 'ok' : 'NOT OK') : '—'),
      ...item('Face found', s?.face_present ? 'yes' : 'no'),
      ...item('LIVE mask', !this.maskBox.checked ? 'off' : this.mask?.liveParticipant ? `sending (${this.mask.sent} frames)` : 'nobody in LIVE'),
      ...item('Frame rate', `${s?.fps ?? 0} fps`),
      ...item('Frames today', String(s?.frames_today ?? 0)),
      ...item('Rows in this chunk', String(s?.rows_in_chunk ?? 0)),
      ...item('Waiting uploads', String(this.pending)),
      ...item('Last upload', ago(this.lastUploadT)),
      ...item('Clock offset', this.clock.isSynced ? `${Math.round(this.clock.offset)} ms` : 'not synced'),
      ...item('Note', this.lastError || '—'),
    );
  }
}
