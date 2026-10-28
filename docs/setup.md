# Setup

How to get everything running, from an empty Supabase project to the app on an iPhone.
Commands run in the repository folder on Nickii's Mac (Terminal).

## 1. Tools (free)
- Node.js 22 (https://nodejs.org). Check: `node -v`.
- Python 3.10+ for the dataset export (macOS has `python3`; `pip` packages in step 8).
- Chrome on the Mac (face capture needs it).
- `npm install` in the repository folder. This also installs Deno (for the push function test) and MediaPipe.

Run all checks: `npm run check` (typecheck, tests, push-function test, dataset test, build).
The dataset test needs `pip install -r dataset/requirements.txt` first (step 8).

## 2. Supabase project
1. Create a project at https://supabase.com/dashboard. Region close to the performance (e.g. Frankfurt).
   Free projects pause after a week without activity; CLAUDE.md plans the Pro plan for the performance.
   **That is a paid plan: Nickii decides when to switch.**
2. **Authentication → Sign In / Providers → Anonymous sign-ins: on.** Participants get an anonymous account
   inside the installed app (https://supabase.com/docs/guides/auth/auth-anonymous).
   Email sign-in stays on for Nickii's own login. Turn off "Confirm email" or confirm her address once.
3. **Database:** open **SQL Editor**, paste the whole of `supabase/migrations/0001_schema.sql`, run it once;
   then the same with `0002_presence_and_stats.sql` (every file in `supabase/migrations`, in name order).
   (With the Supabase CLI instead: `npx supabase link --project-ref <ref>` then `npx supabase db push`.)
4. **Nickii's operator account:** Authentication → Users → Add user (her email + a strong password).
   Then in SQL Editor (replace the email):
   ```sql
   insert into public.operators (user_id)
   select id from auth.users where email = 'nickii@example.com';
   ```
   Only accounts in `operators` can use the console, face capture and the push function.

## 3. Push keys (VAPID)
```
npx web-push generate-vapid-keys
```
(This downloads the free `web-push` tool once.) Keep the **private key** secret: never in the repository,
never in `.env` files that are committed. Generate once; changing it later makes every phone re-Activate.

## 4. `.env` for the apps
`cp .env.example .env` and fill in:
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`: Project Settings → API (the anon/publishable key, safe in the browser).
- `VITE_VAPID_PUBLIC_KEY`: the public key from step 3.

`.env` is in `.gitignore`. Only `VITE_…` values end up in the apps.

## 5. Push function
Secrets for the Edge Function (https://supabase.com/docs/guides/functions/secrets):
```
npx supabase secrets set --project-ref <ref> \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:studio@schamborski.com \
  APP_URL=https://<participant app address>
npx supabase functions deploy send_push --project-ref <ref>
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions by Supabase.
The CLI asks you to log in once (`npx supabase login`).

## 6. Run locally
- Participant app: `npm run dev:participant` → http://localhost:5173
- Design preview without any server (nothing answers): `npm run demo:participant`.
  In the browser console, `demo.reply('…')`, `demo.setLine('invited', 3)`, `demo.setLine('live')` play Nickii's side.
  On a desktop browser the install gate blocks the chat; open it on a phone or use Chrome's device emulation.
- Console: `npm run dev:console` → http://localhost:5174
- Face capture: `npm run dev:face` → http://localhost:5175 (Chrome; allow the camera).

Phones cannot install from `localhost`. To try on the iPhone, deploy (step 7).

## 7. Hosting (static, free tiers)

**Current choice: GitHub Pages**, set up by `.github/workflows/pages.yml`. Every push to `foundation` or `main`
publishes both apps:
- participant app: https://softmodnickii.github.io/nickii-ai-app/
- console: https://softmodnickii.github.io/nickii-ai-app/console/

The public values (Supabase URL, anon key, VAPID public key) are in that workflow file. The push function's
`APP_URL` secret must match the participant address. A custom domain can be added later in the repository's
Settings → Pages. Netlify is the alternative below (`netlify.toml` files are ready).

Each app builds to plain files: `npm run build` → `apps/<app>/dist`.
- **Participant app** needs its own address with HTTPS at the root (`/`), e.g. a Netlify / Cloudflare Pages /
  Vercel site with build command `npm run build -w apps/participant` and output `apps/participant/dist`.
  Set the three `VITE_…` values as environment variables in the host's settings.
  The address must stay the same for all 7 days (home-screen icons and push are tied to it).
- **Console**: a second site, same way (`apps/console`). Keep its address private.
- **Face capture**: run it on the Mac (`npm run dev:face`, or `npm run build -w apps/face-capture` and
  `npm run preview -w apps/face-capture`). `localhost` counts as secure, so the webcam works.
  The MediaPipe model (about 3.7 MB) is loaded from Google's server at start. To remove that dependency:
  download it once from the URL in `apps/face-capture/src/capture_app.ts`, put it in
  `apps/face-capture/public/models/face_landmarker.task` and set `VITE_FACE_MODEL_URL=/models/face_landmarker.task`.

## 8. Dataset export (after the performance)
```
python3 -m venv .venv && .venv/bin/pip install -r dataset/requirements.txt
DATABASE_URL='postgres://…' dataset/export_scripts/dump_tables.sh dataset/raw/tables
# download the face_chunks bucket into dataset/raw/face (or copy the Mac's folder)
.venv/bin/python dataset/export_scripts/export_dataset.py --tables dataset/raw/tables \
   --face dataset/raw/face --out dataset/output [--exclude dataset/raw/deletion_requests.txt]
```
`DATABASE_URL`: Project Settings → Database → connection string. Never commit it. `dataset/raw` and
`dataset/output` are git-ignored.

## 9. Before the performance: test on real phones
Things that cannot be tested in this repository's automated tests:
- iPhone (iOS 18.4+ and an older iOS 16.4–18.3): install guide steps match Safari, Activate shows the
  system prompt, a reply arrives as a notification with the app closed, the badge appears and clears,
  tapping the notification opens the app (and the line, for invitations).
- Android Chrome: Install button, push, badge.
- Face capture with Nickii's face: blendshapes move, `m23` (distance) is negative and stable,
  30 fps on the Mac, heartbeat green in the console, chunks appear in Storage.
- Load test with ~200 fake participants (Milestone 6).
