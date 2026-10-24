import '@nickii/shared/design.css';
import './style.css';
import { currentPlatform, makeClient, readPublicConfig } from '@nickii/shared';
import { ConsoleApp } from './console_app';
import { supabaseConsoleBackend, type ConsoleBackend } from './console_backend';

let backend: ConsoleBackend | null = null;
try {
  const cfg = readPublicConfig(import.meta.env as Record<string, string | undefined>);
  backend = supabaseConsoleBackend(makeClient(cfg, currentPlatform().storage));
} catch (err) {
  console.error(err);
}

void new ConsoleApp({ root: document.getElementById('app')!, backend }).start();
