# Decisions

What was decided while building the foundation, and why. Things marked **Nickii decides** are open.

## Built this way
1. **No frontend framework.** Vite + TypeScript + a 20-line DOM helper. Small, fast on old phones, nothing to upgrade during the performance.
2. **Participants get anonymous Supabase accounts**, created only inside the installed app (browser tabs never create one). No email or phone number is ever asked. https://supabase.com/docs/guides/auth/auth-anonymous
3. **Nothing is recorded before consent.** The agreement is accepted with `accept_agreement()`; the database refuses messages and events from accounts that have not agreed.
4. **Message times are set by the database**, not the phone, so they cannot be wrong or backdated.
5. **Push payloads use Declarative Web Push** (`web_push: 8030`, https://webkit.org/blog/16535/meet-declarative-web-push/) with `mutable: true`, and the service worker understands the same JSON, so one payload works on iOS 18.4+, older iOS (16.4+) and Android. *Unverified on a real iPhone; the WebKit page could not be re-opened from the build machine. Check with docs/setup.md step 9.*
6. **Push encryption with the `web-push` npm library inside the Deno function, sent with Deno's own `fetch`.** web-push's built-in sender uses Node's https layer, which failed under Deno in testing; `generateRequestDetails()` + `fetch` works (tested). https://github.com/web-push-libs/web-push
7. **Every notification link carries `?from=push&kind=…`** so `push_opened` can be logged whether Safari or the service worker opened the app.
8. **Push to all also writes the message into every thread**, so the notification leads to something in the app. **Nickii decides** if she wants notification-only broadcasts too.
9. **The head is a Three.js point cloud** (`apps/participant/src/head_points.ts`, `ghost_head_3d.ts`): a generated head surface sampled along contour rings, slowly turning, floating, flickering; dimmer and slower while Nickii is away. On phones without WebGL, or with "reduce motion" on, the flat `assets/mask/ghost_head.svg` is inserted inline instead (the file has no SVG namespace, so browsers do not show it as an image; editing it would break its content credentials). The gate screens always use the flat one. Nickii's real scan replaces `head_points.ts` (Milestone 5).
10. **Hosting settings are in the repository** (`netlify.toml` for the participant app, `apps/console/netlify.toml` for the console): the service worker is never cached, every path serves the app.
11. **Face chunks are gzipped CSV**, converted to Parquet at export (dataset.md allowed this). Names use the first frame's time to the second (`face_2026-10-12_10-00-00.csv.gz`) so a restart never overwrites a file.
12. **Head-pose matrix is stored row-major** (`m03 m13 m23` = position). MediaPipe's matrix format defaults to column-major (mediapipe `matrix_data.proto`); `face_row.ts` checks the layout on the actual numbers. *Confirm with real data: m23 should be negative (cm in front of the camera).*
13. **Face capture is local-first**: IndexedDB, optional copy into a folder (File System Access API, Chrome), upload every 30 s. Raw video is not recorded (open decision below).
14. **"typed" / "dictated" is a guess** from key events (dictation inserts text without key presses). *Not verified on devices*; stored as `input_method`, documented as a guess in the dataset README.
15. **Mode in face_context** is: live (transmission running) > away (Nickii set away) > line (someone waiting) > chat.
16. **Schema tests run in PGlite** (Postgres compiled to WebAssembly, https://pglite.dev) with a small stand-in for Supabase's auth/storage schemas. They check row-level security for each role without Docker or a Supabase account. They do not test Supabase's real Auth or Realtime.
17. **MediaPipe's WebAssembly files are served from the face-capture page itself**; the model file comes from Google's server unless `VITE_FACE_MODEL_URL` is set.
18. **LIVE video goes straight from the Mac to the phone (WebRTC), with Supabase Realtime broadcast only
    for the setup messages** (`packages/shared/src/live_video.ts`). No video service, no cost, one-to-one by
    design. Only a STUN server (Google's public one) is used; without a TURN relay, some mobile networks
    cannot connect (estimate: around 1 in 10). If tests show that, add a TURN server to `DEFAULT_ICE_SERVERS`
    (e.g. a small Coturn on a VPS, or a hosted one; **paid, Nickii decides**). The console's "with sound"
    box sends her voice as well; off by default. The phone never sends audio or video back.
19. **No paid service was added.** Everything runs on free tiers. The Supabase Pro plan in CLAUDE.md is Nickii's call.

## App store path (later, if wanted)
The apps are web apps today. To ship in the App Store / Play Store, wrap the participant app with
Capacitor (https://capacitorjs.com/docs), which runs the same built files inside a native shell.

What changes:
- **`packages/shared/src/platform.ts`**: add `nativePlatform` implementing the same `Platform` interface and
  choose it in `currentPlatform()`:
  - `isInstalled()` → always true; `isInAppBrowser()` → false; `start()` → no service worker.
  - push via `@capacitor/push-notifications` (https://capacitorjs.com/docs/apis/push-notifications):
    `requestPushAndSubscribe()` returns `{ kind: 'apns' | 'fcm', endpoint: <device token> }`.
    The `push_subscriptions` table already accepts these kinds.
  - `storage` via `@capacitor/preferences`; `setBadge` via a badge plugin;
    `takeLaunchFromNotification` / `onNotificationOpened` from the push plugin's tap events.
- **`send_push`**: add senders for APNs (Apple token-based key) and FCM HTTP v1, selected by `kind`.
  The payload logic in `push_logic.ts` stays.
- **No change** to screens, chat, line, events or the database.

Costs and risks (**Nickii decides** before any of this):
- Apple Developer Program (yearly fee) and Google Play developer account (one-time fee): **paid**.
- Apple review: apps that are mostly a website can be rejected (App Review Guideline 4.2, Minimum
  Functionality, https://developer.apple.com/app-store/review/guidelines/#minimum-functionality).
  Review notes must describe the method honestly (CLAUDE.md); the participant UI keeps the illusion.
- Review and TestFlight take days; plan weeks ahead of the performance.

## Open (Nickii decides)
- Agreement text (`apps/participant/src/agreement.ts`, currently a draft with [brackets]); deletion date and contact.
- Every participant-facing word (`apps/participant/src/copy.ts`), status words, invitation text (`apps/console/src/copy.ts`).
- What participants see while she is away (loops: none exist yet in `assets/loops`).
- Holding-line narrative and mask clips (Milestone 4).
- LIVE video route (LiveKit or similar, likely paid) — not started.
- Whether her face video (not just numbers) is recorded.
- Performance dates; disclosure; AI assist level.
