# Your head as the 3D dots

Participants see a floating point-cloud head. Until you publish a scan it is a generated placeholder.
This is how to replace it with your own head, scanned once with your iPhone or iPad.

## Why a scanning app (and not our web app)
Safari does not let web pages read the LiDAR or TrueDepth depth sensors; only native apps can
(Apple's ARKit). So the scan is made with a free scanning app, and our console turns the file into the
dots. Nothing has to be live: you scan once, publish, and every participant's app switches to it.
*(Checked against what we know of Safari as of 2026; not re-verified from this build machine.)*

## 1. Scan (iPhone or iPad)
Use any app that exports **PLY** or **OBJ**. Two free ones to try (check the App Store, names from memory):
- **3d Scanner App** (Laan Labs): has a front-camera (TrueDepth) mode, which is the more detailed one for
  faces; you can scan yourself. Export as **PLY** (point cloud) or **OBJ**.
- **Scaniverse**: rear LiDAR camera, so someone else holds the phone and walks around you. Export as **PLY** or **OBJ**.

Tips: good even light, keep still, include the whole head (back of the head too, if the app allows),
a plain background helps. The front-camera scan only sees the face side; that's fine, the back stays sparse.

Privacy: both apps can process on the phone; check before uploading anything to their clouds.

## 2. Import in the console (works on the iPad too)
1. Console → **Head scan** (on the phone/iPad: the **Control** tab) → **Choose scan (.ply / .obj)**.
   On the iPad you can pick the file from Files, or AirDrop it to the Mac first.
2. The preview shows the dots. Adjust:
   - **Up: Y / Z / −Z** if the head lies on its side or is upside down.
   - **Turn 90°** until the face looks at you (use **Look around** to check from the side).
   - **mirror** if left and right look swapped (front-camera scans sometimes are).
   - **Cut bottom** to remove neck and shoulders.
   - **Keep around head** to remove the room around you.
   - **Dots**: 3000–5000 looks good on phones; more is slower on old phones.
3. **Publish to participants.** Open apps switch within seconds; the line under "Head scan" says which
   scan is live. **Use placeholder head** switches back.

Only the finished dots are uploaded (about 16 bytes each, ~60 KB for 4000 dots), to the public Storage
bucket `public_assets`. The original scan file stays on your device.

## One-time database step
Run `supabase/migrations/0003_head_scan.sql` once in the Supabase SQL Editor (same as the first two).
Without it, publishing says "Not published" and participants keep the placeholder.
