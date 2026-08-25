<div align="center">

# 💪 REP LINE

**A camera-based push-up tracker that counts your reps for you.**

No wearables. No manual counting. Just your camera, real pose detection, and a live leaderboard to keep you honest.

</div>

---

## What is this?

REP LINE turns any laptop or phone camera into a push-up referee. Get in
frame, start a challenge, and it tracks your shoulders, elbows, wrists, and
hips in real time to count only **full, valid repetitions** — down, bottom,
and back up. Wiggling, partial dips, and camera jitter don't count.

The goal each session is simple: **how many push-ups can you do without
stopping?** Your best gets saved, your history is tracked, and your score
can go up against everyone else on a live leaderboard.

Everything runs client-side. Your camera feed is processed locally in the
browser for pose detection and is never recorded, streamed, or uploaded
anywhere — the only thing that ever leaves your device is a rep count.

## Features

- 🎯 **Real pose-based rep counting** — not a timer, not a guess. Detection
  is driven by actual joint-angle tracking via MediaPipe's Pose Landmarker,
  with a state machine that requires a complete movement cycle before a rep
  counts.
- ✅ **Calibration screen** before every session confirms your full body is
  visible and you're positioned correctly, so you're not guessing whether
  tracking will work.
- 🔥 **Live tracking UI** — a big scoreboard-style counter, rest-break
  detection with a grace period (so a short pause doesn't end your set),
  milestone celebrations, and personal-record effects.
- 📈 **Personal records & full challenge history**, saved per browser.
- 🏆 **Leaderboard** — works out of the box as a local, per-browser
  leaderboard, or as a live, real-time leaderboard shared across every
  visitor once connected to a free Supabase backend.
- 🌗 Light/dark theme, sound toggle, and a fully responsive layout that
  works in phone portrait, phone landscape, and desktop.

## Try it

*`https://repline-sigma.vercel.app`*

## How it works

REP LINE loads [MediaPipe's Pose Landmarker](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker)
directly in the browser and runs it against your live camera feed. Each
frame, it:

1. Reads the angle at your elbow (shoulder–elbow–wrist).
2. Classifies your position as **up**, **down**, or **mid-movement**.
3. Only counts a rep once you've completed a full **up → down → up** cycle —
   a single frame or small twitch is never enough.
4. Cross-checks that you're actually in a horizontal push-up position (not
   just standing and bending an arm) before counting anything at all.

If tracking drops out briefly — bad lighting, a body part leaving frame —
the app tolerates it with a short grace period instead of ending your
session on one bad frame.

## Getting started

This is a static site — plain HTML, CSS, and JavaScript, no framework, no
build step, no `npm install`.

```bash
git clone https://github.com/Justinabit/repline.git
cd repline
python3 -m http.server 8000
```

Then open `http://localhost:8000`. (Camera access requires a secure
context; `localhost` satisfies that, so this works without HTTPS locally.)

## Enabling the shared leaderboard

Out of the box, the leaderboard is local to each browser (via
`localStorage`) — fully functional, just not shared across devices. To turn
on a live, real-time leaderboard for every visitor, connect a free
[Supabase](https://supabase.com) project and drop your credentials into
`script.js`.


## Project structure

```
index.html                    app structure/markup
style.css                     design system + styles
script.js                     all application logic
supabase_schema.sql           run once in Supabase to enable the shared leaderboard
SETUP_SHARED_LEADERBOARD.md   Supabase setup + Vercel deployment guide
```

## Privacy

- Camera video is processed **locally in the browser** for pose detection.
  It is never recorded, streamed, or uploaded.
- The only data ever saved is challenge results — display name, rep count,
  duration, date — either to `localStorage` on your device, or, if you've
  connected Supabase, to a leaderboard table designed so scores can only go
  up and can't be forged for another player. See `supabase_schema.sql` for
  the exact schema and access rules.

## Built with

- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker) — on-device pose detection
- [Supabase](https://supabase.com) *(optional)* — Postgres + realtime for the shared leaderboard
- Vanilla HTML/CSS/JS — no frameworks, no bundler

## Contributing

Issues and pull requests are welcome — whether that's improving detection
accuracy, adding new milestone effects, or general polish.

## License

[MIT](./LICENSE) — feel free to use, modify, and distribute this, including commercially, as long as the original copyright notice is kept.