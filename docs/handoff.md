# Handoff: where the foundation stands

Branch `foundation`. Started in a claude.ai Project chat, continued in a Claude Code cloud session.

## Done
- Root workspace: `package.json` (npm workspaces), `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`.
- `packages/shared`:
  - `design.css` — Ghost design tokens (colors, Archivo, touch targets, safe areas, animations).
  - `types.ts` — data shapes + closed lists of operator/participant event names for the dataset.
  - `blendshapes.ts` — the 52 MediaPipe blendshape names in fixed column order + head-pose matrix columns.
  - `platform.ts` — platform layer. App code only talks to `Platform`. `webPlatform` exists now; a native one (Capacitor) can be added later for App Store / Play Store without rewriting the apps.
  - `install_gate.ts` — pure function deciding which screen to show (install / agreement / activate / denied / ready).
  - `clock.ts` — server clock offset (one clock for the dataset).
  - `stream_text.ts` — reply appears word by word.
  - `supabase.ts` — config reading, client, clock sync via `server_time_ms` RPC.

## Not done yet (continue in this order)
1. Tests for `install_gate`, `clock`, `stream_text`, `platform` detection. Run `npm install && npm run typecheck && npm test`.
2. `supabase/migrations/0001_schema.sql`: participants, push_subscriptions, messages, operator_status, line_entries, operator_events, participant_events, clock_sync, `server_time_ms()` function; row-level security (participants only their own rows; console = Nickii's account via an `operators` table); Storage bucket `face_chunks`.
3. `supabase/functions/send_push`: Web Push with VAPID, Declarative Web Push payload (iOS 18.4+), drop dead subscriptions (404/410).
4. `apps/participant` (Vite + TS): manifest, service worker (push + notification click → open app), install gate screens, agreement, Activate, Ghost UI with CHAT · LINE · LIVE, chat with streamed replies, events logged.
5. `apps/console`: login, inbox by longest waiting, reply with compose-timing events, push to one/all, Live/Away, invite to line, face-capture health.
6. `apps/face-capture`: MediaPipe Face Landmarker → blendshapes + matrix at ~30 fps, 10-minute CSV chunks saved locally (File System Access API or IndexedDB), background upload, clock sync, heartbeat.
7. `dataset/export_scripts/export_dataset.py` + sample data test.
8. Docs: `docs/architecture.md`, `docs/setup.md`, `docs/runbook.md`, `docs/decisions.md` (incl. Capacitor path for app stores). CI: `.github/workflows/ci.yml`.
9. Open a pull request into `main`. Do not merge.

Keep CLAUDE.md rules: plain names, cite docs, say what is unverified, ask Nickii before paid services.
