// Face capture page (runs on Nickii's Mac in Chrome): webcam → MediaPipe Face Landmarker →
// 52 blendshapes + head pose at ~30 fps → 10-minute chunks saved locally → background upload.
// Sends a heartbeat every 10 s so the console can show a red warning within 30 s if this stops.
// MediaPipe Face Landmarker for web: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js

import { h, ServerClock } from '@nickii/shared';
import type { CaptureBackend } from './capture_backend';
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
    this.root.replaceChildren(h('section', { class: 'capture' },
      h('div', { class: 'wordmark' }, 'NICKII AI · FACE CAPTURE'),
      this.video,
      h('div', { class: 'row' }, this.startBtn, this.folderBtn),
      this.info,
      h('p', { class: 'quiet small' },
        'Keep this window open and visible. Recording continues without internet; uploads catch up later.')));
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
    document.addEventListener('visibilitychange', () => void this.sendHeartbeat());
    void this.upload();
    void this.sendHeartbeat();
    this.renderInfo();
  }

  private async loadDetector(): Promise<Detector> {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe`);
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: this.modelUrl, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  }

  private async begin() {
    this.startBtn.disabled = true;
    try {
      this.detector ??= await this.loadDetector();
      await this.openCamera();
      this.running = true;
      this.startBtn.textContent = 'Stop recording';
      this.wakeLock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } })
        .wakeLock?.request('screen').catch(() => null) ?? null;
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
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false,
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
    }
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
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
