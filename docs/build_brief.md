# Build brief for Claude Code

Read CLAUDE.md first. Build in this order; each milestone ends with something Nickii can open on her iPhone. Stop and ask her at every **[ask]**.

## Milestone 1 — skeleton and install gate
- Vite + TypeScript monorepo layout as in the folders (`apps/participant`, `apps/console`, `apps/face-capture`, `supabase`, `dataset`).
- Participant app: manifest (name "Nickii AI", icons as placeholders, `display: standalone`, theme color), service worker, install gate exactly as in CLAUDE.md, agreement screen, "Activate" → push permission.
- Ghost design: CHAT · LINE · LIVE bar, point-cloud head placeholder (`assets/mask/ghost_head.svg` if present, else a simple Three.js point sphere), Archivo font.
- `.env.example`, `.gitignore`, `README.md` with how to run locally.

## Milestone 2 — chat end to end
- Supabase schema (see `supabase/migrations/`), row-level security: participants see only their own thread; console needs Nickii's login.
- Participant chat; replies stream in word by word; push on new reply (Edge Function + VAPID).
- Console (desktop + phone layout): inbox sorted by longest waiting, reply, push to one/group/all, schedule push, Live/Away switch with loops.

## Milestone 3 — face capture and dataset recording
- `apps/face-capture`: webcam → MediaPipe Face Landmarker → blendshapes + matrix at ~30 fps, chunked local saving and background upload exactly as docs/dataset.md, clock sync, health shown in console.
- All events in docs/dataset.md written from day one.
- `dataset/export_scripts/export_dataset.py` + a test export from test data.

## Milestone 4 — holding line and live transmission
- Nickii invites a participant → push → they land in LINE; mask clips play by chapter; position/wait shown. **[ask]** narrative chapters/script.
- One-to-one LIVE: WebRTC room (LiveKit proposed) **[ask]** before adding a paid service. Live face or live-driven mask from face-capture.

## Milestone 5 — 3D mask
- Three.js head with ARKit blendshape morph targets, driven by face-capture data live; ghost point-cloud rendering. **[ask]** when Nickii has her scan/head from Blender.

## Milestone 6 — test run and runbook
- `docs/runbook.md`: what can fail, how she notices, how she recovers.
- Load test with ~200 fake participants.
