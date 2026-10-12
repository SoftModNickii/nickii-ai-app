# Runbook: what can go wrong during the 7 days

For each problem: how Nickii notices, and what to do. Keep this open on the Mac.
Items marked *(untested)* have not been tried on real devices yet.

## Before each day
- Console open and logged in; switch shows the right state (● LIVE / ○ AWAY).
- FACE pill green ("FACE OK"). Face-capture window visible, not minimised, Mac plugged in.
- Supabase dashboard → Reports: nothing unusual. (Free projects pause after a week without activity —
  on the Pro plan they do not.)

## Face capture
| Problem | How you notice | What to do |
| --- | --- | --- |
| Tab crashed / Chrome closed | Console pill turns red (**FACE DOWN**) within 30 s | Reopen http://localhost:5175, log in if asked, press **Start recording**. Unfinished chunk is recovered automatically ("Recovered … chunk(s)"). |
| Window hidden or minimised | Console: "Face-capture window is hidden" | Bring the window to the front. Browsers slow down hidden pages, so frames are lost while hidden. |
| Webcam unplugged / taken by another app | Face page: Webcam **NOT OK**; console red | Plug back in / quit the other app (Zoom, Photo Booth). Page retries every 5 s. If it does not come back: Stop, Start. |
| No face found | Console: "Recording, but no face found" | Check framing and light. Data is still recorded (face_present = 0). |
| Low frame rate | Console: "Low frame rate" | Close other heavy apps. Keep the Mac plugged in. |
| Internet down on the Mac | Console (on the phone) shows red after 30 s, because heartbeats stop | Nothing to do for the data: recording continues locally, uploads catch up ("Waiting uploads" goes back to 0). |
| "Waiting uploads" keeps growing | Console warning above 3 chunks | Check internet; check you are still logged in on the face page (reload). |
| Mac asleep | Red in console | Keep the Mac plugged in; System Settings → Lock Screen / Energy: never sleep while recording. The page also asks the browser to keep the screen on. |
| Browser storage full | Face page note "saving chunk failed" | Choose a folder ("Also save to a folder…") so chunks are copied to the 4 TB drive and dropped from the browser once uploaded. |

After a reload the folder must be chosen again (browser permission rule).

## Console
| Problem | How you notice | What to do |
| --- | --- | --- |
| Logged out | Login screen | Log in again. Nothing is lost; messages wait in the inbox. |
| A reply was saved but "push failed" | Note under the thread | The participant sees it next time they open the app. If it repeats for everyone, check the push function (below). |
| "no push was delivered" | Note under the thread | That phone has no working subscription (app removed or notifications off). Nothing to fix on our side. |
| Operator events could not be saved (bad connection) | — | They are kept in the page and sent with the next one. Do not reload while offline. |
| Someone stuck in LIVE | Line panel shows them as live | Press **End**. Only one transmission can run at a time; the database refuses a second. |

## Participants
| Problem | How you notice | What to do |
| --- | --- | --- |
| "I can't install" | They tell you / no new pseudonym appears | iPhone: Safari only, not the Instagram/WhatsApp browser; the steps are in the app. Android: Chrome. *(untested on every iOS version)* |
| Notifications denied | They see the "Notifications are off" screen | They remove the icon, open the address in Safari again, re-add, Activate. |
| No notifications although allowed | They say so | Ask them to open the app once (it re-registers on every launch). iPhone Focus modes can hide notifications. |
| App shows **OFFLINE** | They tell you | Their connection; their text stays in the field, they send again. |
| Wants their data deleted | Message / email | Note their pseudonym (console thread header) in `dataset/raw/deletion_requests.txt` (not committed). The export removes them everywhere. To also delete in the database: `delete from auth.users where id = (select id from participants where pseudonym = 'p_…');` (cascades to all their rows). |

## Backend
| Problem | How you notice | What to do |
| --- | --- | --- |
| Supabase outage | Console and apps fail to load data; https://status.supabase.com | Wait; face capture keeps recording locally. Participants see OFFLINE. |
| Push function failing for everyone | Every reply shows "push failed" | Supabase dashboard → Edge Functions → send_push → Logs. Common causes: missing secret (`Missing secret …`), wrong VAPID keys. Fix secrets, redeploy (docs/setup.md step 5). |
| VAPID keys changed by mistake | All pushes fail with 401/403 | Put the old keys back. With new keys every participant must Activate again. |
| Project paused (free plan) | Everything fails, dashboard says paused | Restore it in the dashboard. Avoid by being on Pro during the performance. |

## Clock
Every device syncs to the server clock. The face page shows "Clock offset"; values of a few hundred ms
are normal. If it says "not synced", reload the face page once the internet is back.
