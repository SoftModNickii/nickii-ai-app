# Dataset: the 7 days as a recording

Goal: when the performance ends, everything is ready to export as one dataset, aligned on one clock: what participants wrote, what Nickii answered and did, and how her face and head moved and reacted while she did it.

## One clock
Every record carries `t_ms`: server time, UTC, milliseconds since epoch. Face capture on the Mac syncs to server time at start and every 10 minutes (store the measured offset in `clock_sync`). Without this, face data cannot be matched to messages.

## Streams

| Stream | What | Where it is recorded | Rate |
| --- | --- | --- | --- |
| messages | participant text, Nickii's replies, system lines | Supabase `messages` | per event |
| reply_typing | Nickii's keystroke timing while composing (start, pauses, deletes, send) — not shown to participants | Supabase `operator_events` | per event |
| operator_events | mode switches (live/away), pushes sent, invites to the line, transmission start/end, loop triggered | Supabase `operator_events` | per event |
| participant_events | app opened, push opened, joined/left line, transmission seen, app closed | Supabase `participant_events` | per event |
| face | 52 MediaPipe blendshapes + 4x4 facial transformation matrix (head pose) + face-present flag | Mac, local files, uploaded in chunks | 30 fps target |
| face_video (optional, decide) | raw webcam video of Nickii | Mac local disk only | continuous |
| mask_output | what the 3D mask showed (clip id or "live") | Supabase `operator_events` | per change |

Participants' voices are never recorded: voice input is turned into text on their phone by the keyboard.

## Face stream format
- MediaPipe Face Landmarker (web) with `outputFaceBlendshapes: true` and `outputFacialTransformationMatrixes: true`. Blendshape names are the 52 ARKit-compatible categories (browDownLeft … mouthSmileRight …, plus `_neutral`).
- Written by `apps/face-capture` to 10-minute chunk files: `face_YYYY-MM-DD_HH-MM-SS.csv.gz` (UTC, named after the first frame; gzipped CSV because Parquet is awkward in the browser — `dataset/export_scripts/export_dataset.py` converts to Parquet). Chunks end at every 10-minute mark; a restart mid-window starts a new file instead of overwriting.
- Columns: `t_ms`, `face_present`, 52 blendshape columns (float32), 16 matrix columns `m00…m33` (float32, row-major: `m03`, `m13`, `m23` = head position), `fps_measured`.
- Do NOT stream face frames into Postgres/Realtime. Save locally first (survives internet drops), upload finished chunks to Supabase Storage bucket `face_chunks` in the background.
- Rough size (estimate, not measured): 30 fps × 604,800 s ≈ 18 million frames × ~280 bytes ≈ 5 GB raw for 7 days. Fine on the 4 TB drive.

## Context labels on every face frame (joined at export, not stored per frame)
At export, each face frame gets: current mode (chat / line / live / away), which participant thread was open in the console, whether Nickii was typing, last message in and out with time since. This is what makes it "how she reacts to what".

## Participants and consent
- Participants get a random pseudonym id (`p_7f3a…`). No names, emails or phone numbers in the dataset.
- The agreement (inside the app) says plainly: conversations are recorded for an artistic dataset, pseudonymised; what is kept after the 7 days; how to ask for deletion until a stated date.
- Push subscription endpoints and device info are operational only and are dropped at export.

## Export (after the performance)
`dataset/export_scripts/dump_tables.sh` dumps the tables to CSV, then `dataset/export_scripts/export_dataset.py` produces:
```
nickii_ai_dataset_<dates>/
  README.md            what it is, how it was recorded, consent, columns
  messages.parquet
  operator_events.parquet
  participant_events.parquet
  face/                one parquet per day
  face_context/        face frames joined with context labels, one parquet per day
  samples/             first 200 rows of each table as CSV
  clock_sync.csv
```
Formats: Parquet as main, plus a small CSV sample of each table for quick viewing.

## Must work during the 7 days
- Face capture keeps recording if the internet drops; uploads catch up later.
- A live counter in the console: frames recorded today, last chunk uploaded, face found yes/no.
- If the webcam or browser tab crashes, the console shows a red warning within 30 seconds.
