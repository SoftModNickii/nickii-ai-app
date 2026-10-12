import '@nickii/shared/design.css';
import './style.css';
import { currentPlatform, makeClient, readPublicConfig } from '@nickii/shared';
import { CaptureApp, DEFAULT_MODEL_URL } from './capture_app';
import { supabaseCaptureBackend, type CaptureBackend } from './capture_backend';

const env = import.meta.env as Record<string, string | undefined>;
let backend: CaptureBackend | null = null;
try {
  backend = supabaseCaptureBackend(makeClient(readPublicConfig(env), currentPlatform().storage));
} catch (err) {
  console.error(err);
}

// VITE_FACE_MODEL_URL lets the model file be served locally (see docs/setup.md).
void new CaptureApp(document.getElementById('app')!, backend, env.VITE_FACE_MODEL_URL || DEFAULT_MODEL_URL).start();
