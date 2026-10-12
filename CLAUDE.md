# Nickii AI — project instructions for Claude

## Roles
Nickii Schamborski is the artist and design head. Claude is the developer: build, explain trade-offs, ask when a decision is hers. Design decisions are hers.

## The piece
Nickii AI is a Wizard-of-Oz artwork for a 7-day durational performance. About 200 participants install an app that looks and behaves like an AI. No AI answers them: it is Nickii, live, around the clock. The illusion is the artwork. Earlier version: Ars Electronica Campus Exhibition, Linz, Sept 2026.

The 7 days are also recorded as a dataset (see docs/dataset.md): what was said, what Nickii did, and how her face and head moved and reacted, all on one clock.

## Three parts of the system
1. **Participant app** (`apps/participant`) — home-screen web app (PWA), iPhone + Android, no App Store.
2. **Operator console** (`apps/console`) — Nickii's control room, on her Mac and installed on her phone.
3. **Face capture** (`apps/face-capture`) — runs on Nickii's Mac in the browser: webcam → MediaPipe Face Landmarker → 52 blendshapes + head pose. Drives the 3D mask and records her face data for the dataset.
Backend: Supabase (`supabase/`). Dataset tools: `dataset/`.

## Participant app: three modes, always labelled CHAT · LINE · LIVE
- **Chat**: participants type or dictate with the keyboard microphone. Only text is sent; Nickii never hears participants' voices; no audio is ever uploaded or stored. Replies stream in word by word and also arrive as push notifications.
- **Holding line (LINE)**: only Nickii invites people into it (push → they land in the line). A 3D mask of Nickii speaks on its own (pre-rendered clips, her own recorded voice) and tells a narrative in chapters. Shows position and wait; connects automatically when Nickii starts their transmission.
- **Direct transmission (LIVE)**: one person at a time. Nickii's live face or live-driven 3D mask, for them only. They answer by text.
- When Nickii is briefly away: loops.

### Install gate (must hold)
- The chat only opens when the app runs from the home screen (standalone) AND notification permission is granted with an active push subscription. Re-check on every launch.
- Not installed → install guide (iPhone: step-by-step screens for Share → Add to Home Screen; Android: `beforeinstallprompt` Install button). In-app browsers (Instagram, WhatsApp) → "open in Safari/Chrome".
- Agreement and sign-up happen INSIDE the installed app (iOS home-screen apps don't share storage with Safari).
- Notification permission is requested only from a direct tap ("Activate"). Denied → guide to remove and re-add the icon.
- Push: Web Push with VAPID; use Declarative Web Push payloads on iOS 18.4+ (backwards compatible). App badge updates.

## Design (Nickii decides; current choice: option 3 "Ghost")
- Light, open, pinkish-white, sci-fi elegant, simple. Background ~#FCF5F6, ink #2A2025, accent #D9668A / #B23E66, quiet text #6E6168.
- Typeface: Archivo (SIL OFL), including wide widths for the wordmark and labels.
- The face is a translucent, floating, slightly flickering point-cloud 3D head. Placeholder until her real scan exists.
- A few clear orientation elements only: the CHAT · LINE · LIVE bar, one status word (LISTENING / THINKING / DIRECT TRANSMISSION), one plain sentence of what happens next.
- Bilingual DE/EN labels where short ("Ask · Frag").
- Never show "typing…", a human name, read receipts or "last seen" to participants.
- Design reference: the claude.ai design canvas "Nickii AI — Design Options", row 3.

## Tech choices (proposed; ask before swapping)
- Frontend: plain, small, fast. Vite + TypeScript + vanilla or a light framework. Three.js for the mask.
- Backend: Supabase (Postgres, Realtime, Storage, Edge Functions for push). Pro plan for the performance (free projects pause after 1 week idle).
- One-to-one live video: LiveKit (or similar WebRTC room). Decide when building LIVE.
- Face capture: MediaPipe Face Landmarker (web), output 52 ARKit-compatible blendshapes + facial transformation matrix.
- Hosting: static host (Vercel / Netlify / Cloudflare Pages).

## How to work with Nickii
- Plain, direct language. No poetic or literary framing about the work; art writing is her job.
- Plain descriptive file names (`holding_line.ts`, not `queueOrchestrator.ts`).
- Back technical claims with real docs and link them. Say plainly when something is a guess, estimate or unverified.
- Simple, robust solutions. For anything that can fail during the 7 days, write down how she notices and recovers (docs/runbook.md).
- Method is described honestly in docs and in any app-store or service review notes; participant UI keeps the illusion.
- Collect the minimum participant data. The agreement must say plainly that conversations are recorded for an artistic dataset, pseudonymised, and what is kept after the 7 days.
- Never add an AI that answers participants on its own unless Nickii explicitly decides that.
- Secrets (Supabase service key, VAPID private key, LiveKit secret) never go in the repo: `.env` only, listed in `.gitignore`.

## Open decisions
Performance dates · disclosure (when participants learn it was her) · holding-line narrative script · 3D mask route (Blender + browser preferred) · AI assist level for Nickii (summaries/drafts she approves) · whether her face video (not just numbers) is recorded.
