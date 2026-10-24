# Nickii AI

App for Nickii Schamborski's 7-day durational performance "Nickii AI".

- `CLAUDE.md` — project instructions (read first)
- `docs/handoff.md` — where the work stands
- `docs/setup.md` — from an empty Supabase project to the app on a phone
- `docs/architecture.md` — how the pieces fit
- `docs/runbook.md` — what can fail during the 7 days and how to recover
- `docs/decisions.md` — what was decided and why; open decisions; App Store path
- `docs/build_brief.md` — what to build, in order
- `docs/dataset.md` — how the 7 days are recorded as a dataset

| Folder | What |
| --- | --- |
| `apps/participant` | Home-screen web app for participants |
| `apps/console` | Nickii's control room (Mac + phone) |
| `apps/face-capture` | Webcam face tracking and recording (Mac, Chrome) |
| `packages/shared` | Shared code; `platform.ts` holds everything device-specific |
| `supabase/` | Database schema and the push function |
| `dataset/` | Export tools |

## Run locally
```
npm install
npm run demo:participant   # design preview, no server, nothing answers
npm run dev:participant    # needs .env (docs/setup.md)
npm run dev:console
npm run dev:face
npm run check              # typecheck, all tests, build
```
