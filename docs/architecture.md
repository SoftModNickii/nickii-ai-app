# Architecture

```
 participants' phones                     Supabase (one project)                 Nickii's Mac / phone
 ┌──────────────────────┐   HTTPS / WS   ┌───────────────────────────────┐   HTTPS / WS  ┌──────────────────┐
 │ apps/participant     │ ─────────────► │ Auth: anonymous participants, │ ◄──────────── │ apps/console     │
 │ home-screen web app  │                │       Nickii's email login    │               │ (Mac + phone)    │
 │ service worker (push)│ ◄── Web Push ──│ Postgres + row-level security │               └──────────────────┘
 └──────────────────────┘   (Apple/      │ Realtime (messages, status,   │   upload      ┌──────────────────┐
                             Google push │   line, heartbeats)           │ ◄──────────── │ apps/face-capture│
                             services)   │ Storage: face_chunks (private)│  every 30 s   │ Chrome, webcam,  │
                                         │ Edge Function: send_push      │               │ MediaPipe, local │
                                         └───────────────────────────────┘               │ IndexedDB/folder │
                                                                                          └──────────────────┘
```

## Pieces
| Folder | What | Tests |
| --- | --- | --- |
| `packages/shared` | Types (mirror the schema), design tokens, `platform.ts` (everything device-specific), install gate rule, server clock, word-by-word streaming, Supabase client | vitest |
| `apps/participant` | Install gate → agreement → Activate → CHAT · LINE · LIVE | vitest + jsdom with a fake device and an in-memory backend |
| `apps/console` | Inbox, replies with compose timing, push, Live/Away, line, face health | vitest + jsdom with a fake backend |
| `apps/face-capture` | Webcam → MediaPipe → 10-minute chunks → upload, heartbeat | vitest (chunks, IndexedDB via fake-indexeddb, upload) + a manual Chromium smoke run |
| `supabase/migrations` | Schema, RLS, functions, storage bucket | vitest runs the SQL in PGlite (Postgres in WebAssembly) and checks RLS as each role |
| `supabase/functions/send_push` | Web Push sender (Deno) | vitest for the logic, Deno test sending a real encrypted push to a local fake push service |
| `dataset/` | Dump + export to the final dataset | Python unittest with a fake performance |

## Data
Tables (`supabase/migrations/0001_schema.sql`): `participants` (pseudonym, consent), `push_subscriptions`
(operational only), `messages`, `operator_status` (one row), `line_entries`, `operator_events`,
`participant_events`, `clock_sync`, `operators`, `participant_presence` (who is online); view `inbox`;
`console_stats()` for the numbers strip (installed, reachable, online now, waiting, in line, today).

Who can do what (row-level security):
- A participant (anonymous account that accepted the agreement) reads and writes **only their own thread**,
  their own push subscriptions and their own events; reads the status row; sees only their own line entry
  and their position through `my_line_position()`.
- Nickii (listed in `operators`) reads everything, writes replies, status, line, operator events, clock sync,
  face chunks.
- Signed-out visitors can only call `server_time_ms()`.
- The push function uses the service role, after checking the caller is an operator.

## One clock
Every record has `t_ms` (server time, UTC ms). Message times are set by the database. Devices measure
their offset with `server_time_ms()` (shortest of several round trips, `packages/shared/src/clock.ts`)
and stamp events with it; face capture and console store their offsets in `clock_sync`.

## Push
Console → `send_push` (with Nickii's login) → payload in Declarative Web Push format → Apple/Google push
services → phone. Safari 18.4+ can show it directly; elsewhere the service worker (`apps/participant/public/sw.js`)
shows it. Dead subscriptions (404/410) are deleted. Each send is logged as `push_sent` / `push_broadcast`.

## App Store / Play Store later
App code never touches browser device APIs directly; it uses `Platform` (`packages/shared/src/platform.ts`).
A native wrapper adds a second implementation; see `docs/decisions.md` → "App store path".
