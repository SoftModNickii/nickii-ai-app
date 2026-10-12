// Face-capture health shown in the console (docs/dataset.md "Must work during the 7 days":
// red warning within 30 seconds if the webcam or browser tab crashes).
// apps/face-capture sends a `face_capture_heartbeat` operator event every 10 seconds.

export const HEARTBEAT_EVERY_MS = 10_000;
export const STALE_AFTER_MS = 30_000;

export interface HeartbeatData {
  frames_today?: number;
  face_present?: boolean;
  fps?: number;
  last_upload_t_ms?: number | null;
  pending_chunks?: number;
  camera_ok?: boolean;
  /** false when the face-capture window is hidden or minimised (the browser then slows it down). */
  tab_visible?: boolean;
}

export type FaceHealthLevel = 'ok' | 'warning' | 'down' | 'never';

export interface FaceHealth {
  level: FaceHealthLevel;
  message: string;
}

export function faceHealth(last: { t_ms: number; data: HeartbeatData } | null, now: number): FaceHealth {
  if (!last) return { level: 'never', message: 'Face capture has not started.' };
  const age = now - last.t_ms;
  if (age > STALE_AFTER_MS) {
    return { level: 'down', message: `No signal from face capture for ${Math.round(age / 1000)} s. Check the Mac.` };
  }
  const d = last.data;
  if (d.camera_ok === false) return { level: 'down', message: 'Webcam not delivering images.' };
  if (d.tab_visible === false) return { level: 'warning', message: 'Face-capture window is hidden: bring it to the front.' };
  if ((d.pending_chunks ?? 0) > 3) {
    return { level: 'warning', message: `${d.pending_chunks} chunks waiting to upload (saved on the Mac).` };
  }
  if (d.fps !== undefined && d.fps < 15) return { level: 'warning', message: `Low frame rate: ${d.fps.toFixed(0)} fps.` };
  if (d.face_present === false) return { level: 'warning', message: 'Recording, but no face found.' };
  return { level: 'ok', message: 'Recording.' };
}
