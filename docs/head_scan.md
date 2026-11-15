# Your head as the 3D dots

Participants see a floating point-cloud head. Until you publish one it is a generated placeholder.
Two ways to make it yours:

## A. With your iPhone, no extra app (quickest)
1. On the iPhone, open **https://softmodnickii.github.io/nickii-ai-app/face/** in Safari, log in,
   then Share → **Add to Home Screen** ("Nickii Face"). From then on, open it from the icon.
2. Tap **Start recording**, allow the camera. You see your face as moving dots (**Show camera** switches
   to the picture). From now on it starts by itself whenever you open the icon.
3. Tap **Use my face as the head**, look straight into the camera for the countdown and hold still for
   two seconds. Done: every participant's app shows your face as the head.

The front camera gives your face's shape (468 points from Google's MediaPipe, densified along the face
mesh); the back of the head is generated around it.

While someone is in **LIVE**, the same page sends your face live to their phone as moving dots
("Send my face to the person in LIVE", on by default). If you also switch the console's **Camera on**,
they see the camera video instead.

## B. With a 3D-scanning app (more detail: hair, back of the head)
Below. This uses the console's **Head scan** panel.

## Why route B needs a separate scanning app
Safari does not let web pages read the LiDAR or TrueDepth depth sensors; only native apps can
(Apple's ARKit). Route A works around that with the normal camera picture and MediaPipe, which estimates
depth from the image. Route B uses the real depth sensor through a scanning app, and our console turns
the file into the dots.
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
