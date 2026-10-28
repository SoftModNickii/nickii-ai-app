# Handoff: where the foundation stands

Branch `foundation`. Started in a claude.ai Project chat, continued in Claude Code cloud sessions.
`npm run check` runs everything (typecheck, tests, push-function test under Deno, dataset test, build).
CI runs the same on GitHub (`.github/workflows/ci.yml`).

## Done
- Workspace: npm workspaces, TypeScript project references, vitest, `.env.example`.
- `packages/shared`: design tokens, types (mirror the schema), blendshape column order, `platform.ts`
  (all device-specific code: install state, push, badge, storage, install prompt, notification taps),
  install gate rule, server clock, word-by-word streaming, Supabase client, DOM helper. Tested.
- `supabase/migrations/0001_schema.sql`: all tables, row-level security, `server_time_ms()`,
  `accept_agreement()`, line functions, `inbox` view, realtime, private `face_chunks` bucket.
  Tested in PGlite as participant / non-consented user / Nickii / signed out.
- `supabase/functions/send_push`: Web Push with VAPID, Declarative Web Push payload, dead subscriptions
  removed, sends logged. Logic tested in vitest; real encrypted send tested under Deno.
- `apps/participant`: manifest, icons (placeholders), service worker, install gate (iPhone steps,
  Android install button, in-app browser notice), agreement (draft), Activate, denied/unsupported screens,
  Ghost UI with CHAT · LINE · LIVE, streamed replies, line position, LIVE placeholder, events.
  Demo mode for design previews. Flow tested in jsdom; screenshots checked in Chromium at iPhone size.
- `apps/console`: login, inbox by longest waiting, reply + push, compose timing events, push to all,
  Live/Away + status word, invite / start / end transmission, face-capture health. Tested in jsdom.
- `apps/face-capture`: MediaPipe → 52 blendshapes + head pose per frame, 10-minute gzipped CSV chunks,
  local-first (IndexedDB + optional folder), crash recovery, background upload, heartbeat, clock sync.
  Chunking/storage/upload tested; full pipeline smoke-run in headless Chromium with a fake webcam.
- `dataset/`: dump script, `export_dataset.py`, test with a fake performance.
- Docs: `architecture.md`, `setup.md`, `runbook.md`, `decisions.md` (incl. App Store path).

## Live and running (28 Oct 2026)
- Supabase project `nvvpcevgdmhnhzcfxvun` (Frankfurt, free plan): both migrations run, anonymous sign-ins on,
  operator accounts n.schamborski@gmail.com and dy.westwick@gmail.com, `send_push` deployed with VAPID secrets.
- GitHub Pages publishes on every push to `main`: participant app `/nickii-ai-app/`, console `/console/`,
  face capture `/face/`. First real phone installed, wrote, was invited and put in transmission.
- Added since the first pull request: console numbers (installed, online, waiting, …), 3D point-cloud head,
  LIVE video from the Mac camera to the phone (WebRTC, no relay yet).

## Not verified yet (needs real devices or a real Supabase project)
- Everything in docs/setup.md step 9: install + push + badge on real iPhones (iOS 16.4–18.3 and 18.4+)
  and Android; Declarative Web Push behaviour; the iOS install-guide wording against current Safari.
- Real Supabase Auth / Realtime / Storage / Edge Function deploy (tests use stand-ins).
- Face capture with a real face on Nickii's Mac (frame rate, matrix layout, blendshape values).
- The typed/dictated guess.

## Next (build_brief.md milestones)
1. Set up the Supabase project and hosting (docs/setup.md) and run step 9 on phones.
2. Milestone 4: holding-line narrative + mask clips **[ask Nickii]**; LIVE video route (LiveKit or similar)
   **[ask before any paid service]**.
3. Milestone 5: Three.js mask driven by face-capture blendshapes (live channel from face capture to LIVE).
4. Milestone 6: load test with ~200 fake participants; rehearse the runbook.
5. Loops while away (`assets/loops` is empty); final agreement text and wording (`copy.ts`).

Keep CLAUDE.md rules: plain names, cite docs, say what is unverified, ask Nickii before paid services.
