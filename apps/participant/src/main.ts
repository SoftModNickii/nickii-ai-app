import '@nickii/shared/design.css';
import './style.css';
import { currentPlatform, makeClient, readPublicConfig } from '@nickii/shared';
import { ParticipantApp } from './app';
import type { Backend } from './backend';
import { pickLang } from './copy';
import { demoBackend } from './demo_backend';
import { supabaseBackend } from './supabase_backend';

const platform = currentPlatform();
const env = import.meta.env as Record<string, string | undefined>;

// VITE_DEMO=1: no server, nothing answers. Only for looking at the design.
let backend: Backend | null = null;
let vapidPublicKey = '';
if (env.VITE_DEMO === '1') {
  const demo = demoBackend();
  backend = demo.backend;
  (window as unknown as { demo: typeof demo.act }).demo = demo.act; // play Nickii's side from the browser console
} else {
  try {
    const cfg = readPublicConfig(env);
    vapidPublicKey = cfg.vapidPublicKey;
    backend = supabaseBackend(makeClient(cfg, platform.storage));
  } catch (err) {
    console.error(err);
  }
}

const app = new ParticipantApp({
  root: document.getElementById('app')!,
  platform,
  backend,
  vapidPublicKey,
  lang: pickLang(navigator.languages ?? [navigator.language]),
});
void app.start();
