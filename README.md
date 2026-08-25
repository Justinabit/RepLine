# REP LINE — Camera-Based Push-Up Challenge Tracker

Do push-ups in front of your camera and REP LINE counts your reps for you —
no wearables, no manual counting. Compete for the highest number of
**consecutive** push-ups on a live leaderboard.

Built with plain HTML, CSS, and JavaScript — no framework, no build step.
Pose detection runs entirely in the browser via
[MediaPipe Pose Landmarker](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker).
Nothing from your camera is ever recorded or uploaded.

---

## Features

- **Real pose-based rep counting** — tracks shoulder/elbow/wrist/hip
  landmarks and only counts a rep after a full up → down → up cycle, so
  wiggling, partial dips, and camera jitter don't inflate your score.
- **Calibration screen** before every session, checking body visibility and
  push-up orientation so you know tracking will actually work.
- **Live tracking screen** with a big scoreboard-style rep counter, rest-break
  detection with a grace period, milestone celebrations, and PR effects.
- **Personal records & full challenge history**, stored per browser.
- **Leaderboard** — works local-only out of the box (`localStorage`), or as a
  live, shared, real-time leaderboard for every visitor once you connect a
  free [Supabase](https://supabase.com) project (see below).
- Sound toggle, light/dark theme, display-name log in/out, responsive layout
  (phone portrait & landscape through desktop).

## Project structure

```
index.html                    the app (structure/markup)
style.css                     design system + styles
script.js                     all application logic
supabase_schema.sql           run once in Supabase to enable the shared leaderboard
SETUP_SHARED_LEADERBOARD.md   step-by-step: Supabase setup + Vercel deployment
```

## Running it locally

This is a static site — no build step, no `npm install`. Camera access
requires a "secure context," so open it via a local server rather than
double-clicking the file:

```bash
# from this folder
python3 -m http.server 8000
# then open http://localhost:8000
```

(`localhost` counts as secure even over plain HTTP, so this works fine.)

## Enabling the shared (global) leaderboard

By default the leaderboard is local to each browser. To make it live and
shared across every visitor, connect a free Supabase project and paste your
project URL + anon key into `CONFIG` at the top of `script.js`. Full
step-by-step instructions, including the one-time SQL setup, are in
[`SETUP_SHARED_LEADERBOARD.md`](./SETUP_SHARED_LEADERBOARD.md).

Until you do that, the app works exactly as-is with a local, per-browser
leaderboard — nothing is broken or fake in the meantime.

## Deploying

Recommended: push this repo to GitHub, then import it into
[Vercel](https://vercel.com) — it's detected as a static site automatically,
with no configuration needed. Full walkthrough in
[`SETUP_SHARED_LEADERBOARD.md`](./SETUP_SHARED_LEADERBOARD.md).

## Privacy

- Camera video is processed **locally in the browser** for pose detection —
  it is never recorded, uploaded, or stored.
- Only challenge results (name, rep count, duration, date) are saved, either
  to `localStorage` on your device or, if you've connected Supabase, to the
  shared leaderboard table — see `supabase_schema.sql` for exactly what that
  stores and how it's protected.

## Tech

- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker) — on-device pose detection
- [Supabase](https://supabase.com) (optional) — Postgres + realtime for the shared leaderboard
- No frameworks, no bundler — vanilla HTML/CSS/JS throughout
