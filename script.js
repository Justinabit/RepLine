/* ==========================================================================
   REP LINE — script.js
   Sections: 1 Config · 2 State · 3 DOM · 4 Camera · 5 Pose Detection
   6 Push-Up Detection · 7 Challenge Management · 8 Validation
   9 Local Storage · 10 Dashboard · 11 Leaderboard · 12 History · 13 Events
   ========================================================================== */

import {
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ======================= 1. CONFIGURATION ======================= */

const CONFIG = {
  // Elbow angle (degrees) at/above which the arm counts as "up" (extended).
  UP_ANGLE: 155,
  // Elbow angle (degrees) at/below which the arm counts as "down" (bent).
  DOWN_ANGLE: 95,
  // Minimum time between recognised phase transitions — filters out jitter.
  MIN_PHASE_MS: 180,
  // Minimum average landmark visibility (0-1) to trust the pose at all.
  MIN_VISIBILITY_FOR_TRACKING: 0.35,
  // Visibility needed for "excellent" tracking quality display.
  GOOD_VISIBILITY: 0.7,
  // How long with no meaningful movement before we assume the user stopped.
  REST_TRIGGER_MS: 7000,
  // Countdown length (ms) once rest is detected, before auto-ending.
  REST_COUNTDOWN_MS: 3000,
  // Pre-challenge "get ready" countdown, in whole seconds.
  START_COUNTDOWN_SECONDS: 3,
  // Milestone reps that trigger a special celebration.
  MILESTONES: [5, 10, 20, 30, 50, 75, 100, 150, 200],
  MODEL_URL:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  WASM_URL:
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  STORAGE_PREFIX: "repline_",

  // ---- Shared (global) leaderboard — see SETUP_SHARED_LEADERBOARD.md ----
  // Replace both of these with the values from your own Supabase project
  // (Project Settings → API). Until you do, REP LINE automatically falls
  // back to a local, per-browser leaderboard — nothing breaks either way.
  SUPABASE_URL: "https://vwfpvgusidvsbbuqdhtj.supabase.co/rest/v1/",
  SUPABASE_ANON_KEY: "sb_publishable_b9SQxrdZ09suWlzZbnKOWg_LDKJBoBU",
};

// BlazePose landmark indices we actually use.
const LM = {
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

// Simple skeleton connections relevant to a push-up (for the overlay).
const CONNECTIONS = [
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
];

/* ======================= 2. APPLICATION STATE ======================= */

const state = {
  userName: null,
  personalBest: 0,
  totalReps: 0,
  totalChallenges: 0,
  history: [],          // array of {id, playerName, reps, duration, date, isPersonalRecord}
  leaderboard: {},       // { playerName: bestScore } — local fallback
  soundOn: true,
  theme: "dark",

  // Shared (global) leaderboard, via Supabase — see section 14.
  supabase: null,
  remoteConnected: false,
  remoteLeaderboard: [], // [{ name, score }] — source of truth when connected

  // Runtime / session-only state
  stream: null,
  poseLandmarker: null,
  poseLandmarkerReady: false,
  activeVideoEl: null,
  activeCanvasEl: null,
  rafId: null,

  currentScreen: "dashboard",
  pendingNextScreen: null, // where to go after the name prompt

  // Calibration
  calibPassStreakStart: null,
  calibPassed: false,

  // Challenge session
  challengeActive: false,
  challengePaused: false,
  repCount: 0,
  repState: "up",       // 'up' | 'down'
  lastPhaseChangeAt: 0,
  lastAngle: null,
  lastMeaningfulMovementAt: 0,
  timerStartAt: 0,
  timerElapsedMs: 0,
  restTimeoutId: null,
  restCountdownIntervalId: null,
  countdownIntervalId: null,
  audioCtx: null,
};

/* ======================= 3. DOM ELEMENTS ======================= */

const $ = (id) => document.getElementById(id);

const dom = {
  screens: Array.from(document.querySelectorAll("[data-screen]")),
  navlinks: Array.from(document.querySelectorAll("[data-nav]")),
  mobileMenu: $("mobileMenu"),
  hamburgerBtn: $("hamburgerBtn"),
  userChip: $("userChip"),
  userChipName: $("userChipName"),

  startChallengeBtn: $("startChallengeBtn"),
  heroDemoNum: $("heroDemoNum"),
  statBest: $("statBest"),
  statTotal: $("statTotal"),
  statChallenges: $("statChallenges"),
  statRank: $("statRank"),
  statRankLabel: $("statRankLabel"),
  statRankUnit: $("statRankUnit"),
  dashboardPRList: $("dashboardPRList"),
  dashboardLeaderboardList: $("dashboardLeaderboardList"),

  nameInput: $("nameInput"),
  nameError: $("nameError"),
  nameContinueBtn: $("nameContinueBtn"),

  grantCameraBtn: $("grantCameraBtn"),
  retryCameraBtn: $("retryCameraBtn"),
  retryCameraBtn2: $("retryCameraBtn2"),
  cameraDeniedAlert: $("cameraDeniedAlert"),
  cameraUnavailableAlert: $("cameraUnavailableAlert"),
  browserUnsupportedAlert: $("browserUnsupportedAlert"),

  calibVideo: $("calibVideo"),
  calibCanvas: $("calibCanvas"),
  calibStatusBadge: $("calibStatusBadge"),
  calibChecks: $("calibChecks"),
  calibReady: $("calibReady"),
  startCountdownBtn: $("startCountdownBtn"),

  trackerVideo: $("trackerVideo"),
  trackerCanvas: $("trackerCanvas"),
  trackerTimer: $("trackerTimer"),
  repCounter: $("repCounter"),
  repPop: $("repPop"),
  trackingQualityBadge: $("trackingQualityBadge"),
  soundToggleBtn: $("soundToggleBtn"),
  formFeedback: $("formFeedback"),
  countdownOverlay: $("countdownOverlay"),
  countdownText: $("countdownText"),
  restOverlay: $("restOverlay"),
  restCountdownText: $("restCountdownText"),
  pausedOverlay: $("pausedOverlay"),
  milestoneToast: $("milestoneToast"),
  pauseBtn: $("pauseBtn"),
  resumeBtn: $("resumeBtn"),
  endFromPauseBtn: $("endFromPauseBtn"),
  finishBtn: $("finishBtn"),

  resultEyebrow: $("resultEyebrow"),
  resultPrBadge: $("resultPrBadge"),
  resultReps: $("resultReps"),
  resultPrevBest: $("resultPrevBest"),
  resultDuration: $("resultDuration"),
  resultRank: $("resultRank"),
  tryAgainBtn: $("tryAgainBtn"),

  leaderboardFullList: $("leaderboardFullList"),
  leaderboardEyebrow: $("leaderboardEyebrow"),
  leaderboardNotice: $("leaderboardNotice"),

  historyFullList: $("historyFullList"),
  historyEmpty: $("historyEmpty"),
  historyStartBtn: $("historyStartBtn"),

  settingsCurrentName: $("settingsCurrentName"),
  editNameBtn: $("editNameBtn"),
  logoutBtn: $("logoutBtn"),
  soundSwitch: $("soundSwitch"),
  themeSegmented: $("themeSegmented"),
  clearHistoryBtn: $("clearHistoryBtn"),
  resetDataBtn: $("resetDataBtn"),

  confirmModal: $("confirmModal"),
  confirmTitle: $("confirmTitle"),
  confirmBody: $("confirmBody"),
  confirmCancelBtn: $("confirmCancelBtn"),
  confirmOkBtn: $("confirmOkBtn"),
  toast: $("toast"),
};

/* ======================= 4. CAMERA SETUP ======================= */

function browserSupportsCamera() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

async function startCamera() {
  if (!browserSupportsCamera()) {
    dom.browserUnsupportedAlert.hidden = false;
    dom.grantCameraBtn.disabled = true;
    return null;
  }
  hideAllCameraAlerts();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 960 },
        height: { ideal: 720 },
      },
    });
    state.stream = stream;
    return stream;
  } catch (err) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      dom.cameraDeniedAlert.hidden = false;
    } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      dom.cameraUnavailableAlert.hidden = false;
    } else {
      dom.cameraUnavailableAlert.hidden = false;
    }
    return null;
  }
}

function hideAllCameraAlerts() {
  dom.cameraDeniedAlert.hidden = true;
  dom.cameraUnavailableAlert.hidden = true;
  dom.browserUnsupportedAlert.hidden = true;
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  cancelDetectionLoop();
}

function attachStreamTo(videoEl, canvasEl) {
  videoEl.srcObject = state.stream;
  state.activeVideoEl = videoEl;
  state.activeCanvasEl = canvasEl;
}

/* ======================= 5. POSE DETECTION ======================= */

async function ensurePoseLandmarker() {
  if (state.poseLandmarker) return state.poseLandmarker;
  const vision = await FilesetResolver.forVisionTasks(CONFIG.WASM_URL);
  state.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: CONFIG.MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  state.poseLandmarkerReady = true;
  return state.poseLandmarker;
}

function cancelDetectionLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
}

// mode: 'calibration' | 'tracking'
function runDetectionLoop(mode) {
  cancelDetectionLoop();

  const loop = () => {
    const video = state.activeVideoEl;
    const canvas = state.activeCanvasEl;
    if (!video || !state.poseLandmarkerReady || video.readyState < 2) {
      state.rafId = requestAnimationFrame(loop);
      return;
    }
    syncCanvasSize(video, canvas);

    const result = state.poseLandmarker.detectForVideo(video, performance.now());
    const landmarks = result && result.landmarks && result.landmarks[0];

    drawSkeleton(canvas, landmarks);

    if (mode === "calibration") {
      updateCalibration(landmarks);
    } else if (mode === "tracking") {
      processTrackingFrame(landmarks);
    }

    state.rafId = requestAnimationFrame(loop);
  };

  state.rafId = requestAnimationFrame(loop);
}

function syncCanvasSize(video, canvas) {
  const w = video.clientWidth || 640;
  const h = video.clientHeight || 480;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function drawSkeleton(canvas, landmarks) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;

  const quality = averageVisibility(landmarks, [
    LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
  ]);
  const color = quality >= CONFIG.GOOD_VISIBILITY ? "#33d19a" : quality >= CONFIG.MIN_VISIBILITY_FOR_TRACKING ? "#ffc93c" : "#ff4d5e";

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.fillStyle = color;

  CONNECTIONS.forEach(([a, b]) => {
    const p1 = landmarks[a], p2 = landmarks[b];
    if (!p1 || !p2) return;
    if ((p1.visibility ?? 1) < 0.3 || (p2.visibility ?? 1) < 0.3) return;
    ctx.beginPath();
    ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
    ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
    ctx.stroke();
  });

  Object.values(LM).forEach((idx) => {
    const p = landmarks[idx];
    if (!p || (p.visibility ?? 1) < 0.3) return;
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function averageVisibility(landmarks, indices) {
  const vals = indices.map((i) => landmarks[i]?.visibility ?? 0);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Angle (degrees) at point b, formed by points a-b-c.
function jointAngle(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magA = Math.hypot(abx, aby);
  const magC = Math.hypot(cbx, cby);
  if (magA === 0 || magC === 0) return null;
  const cos = Math.min(1, Math.max(-1, dot / (magA * magC)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/* ======================= 6. PUSH-UP DETECTION ======================= */

// Returns { angle, quality, isPlank } or null if not enough visible landmarks.
function analyzePose(landmarks) {
  if (!landmarks) return null;

  const coreIdx = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP];
  const quality = averageVisibility(landmarks, coreIdx);
  if (quality < CONFIG.MIN_VISIBILITY_FOR_TRACKING) {
    return { angle: null, quality, isPlank: false };
  }

  const leftVis = averageVisibility(landmarks, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST]);
  const rightVis = averageVisibility(landmarks, [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);

  let angle = null;
  const leftAngle = leftVis > 0.4 ? jointAngle(landmarks[LM.L_SHOULDER], landmarks[LM.L_ELBOW], landmarks[LM.L_WRIST]) : null;
  const rightAngle = rightVis > 0.4 ? jointAngle(landmarks[LM.R_SHOULDER], landmarks[LM.R_ELBOW], landmarks[LM.R_WRIST]) : null;

  if (leftAngle !== null && rightAngle !== null) angle = (leftAngle + rightAngle) / 2;
  else angle = leftAngle !== null ? leftAngle : rightAngle;

  // Rough "plank / side-on push-up position" check: shoulders and hips should
  // be more spread out horizontally than vertically (a standing person is the
  // opposite: more vertical than horizontal spread).
  const shoulder = averagePoint(landmarks[LM.L_SHOULDER], landmarks[LM.R_SHOULDER]);
  const hip = averagePoint(landmarks[LM.L_HIP], landmarks[LM.R_HIP]);
  let isPlank = false;
  if (shoulder && hip) {
    const dx = Math.abs(shoulder.x - hip.x);
    const dy = Math.abs(shoulder.y - hip.y);
    isPlank = dx > dy * 0.55;
  }

  return { angle, quality, isPlank };
}

function averagePoint(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function processTrackingFrame(landmarks) {
  if (state.challengePaused) return;

  const analysis = analyzePose(landmarks);
  updateTrackingQualityBadge(analysis?.quality ?? 0);

  if (!analysis || analysis.angle === null) {
    setFormFeedback("⚠ Body not detected — move into frame");
    return;
  }
  if (analysis.quality < CONFIG.GOOD_VISIBILITY) {
    if (analysis.quality < CONFIG.MIN_VISIBILITY_FOR_TRACKING + 0.1) {
      setFormFeedback("⚠ Move back — make sure your full body is visible");
    }
  }
  if (!analysis.isPlank) {
    setFormFeedback("⚠ Get into push-up position, camera to your side");
    return;
  }

  const now = performance.now();
  const angle = analysis.angle;

  // Track meaningful movement for the rest/grace timer.
  if (state.lastAngle === null || Math.abs(angle - state.lastAngle) > 6) {
    state.lastMeaningfulMovementAt = now;
    clearRestSequence();
  }
  state.lastAngle = angle;

  const position = angle >= CONFIG.UP_ANGLE ? "up" : angle <= CONFIG.DOWN_ANGLE ? "down" : "mid";
  const sincePhaseChange = now - state.lastPhaseChangeAt;

  if (position === "down" && state.repState === "up" && sincePhaseChange > CONFIG.MIN_PHASE_MS) {
    state.repState = "down";
    state.lastPhaseChangeAt = now;
    setFormFeedback("✓ Good depth — now push up");
  } else if (position === "up" && state.repState === "down" && sincePhaseChange > CONFIG.MIN_PHASE_MS) {
    state.repState = "up";
    state.lastPhaseChangeAt = now;
    onRepCompleted();
  } else if (position === "mid") {
    if (state.repState === "up") setFormFeedback("↓ Go lower");
    else setFormFeedback("↑ Push up");
  } else if (position === "up" && state.repState === "up") {
    setFormFeedback("✓ Good position — start your descent");
  }

  maybeTriggerRest(now);
}

function updateTrackingQualityBadge(quality) {
  let label;
  if (quality >= CONFIG.GOOD_VISIBILITY) label = "● Excellent Tracking";
  else if (quality >= CONFIG.MIN_VISIBILITY_FOR_TRACKING + 0.15) label = "● Good Tracking";
  else if (quality >= CONFIG.MIN_VISIBILITY_FOR_TRACKING) label = "⚠ Poor Tracking";
  else label = "⚠ Body Not Detected";
  dom.trackingQualityBadge.textContent = label;
}

let feedbackThrottleAt = 0;
function setFormFeedback(text) {
  const now = performance.now();
  if (now - feedbackThrottleAt < 400 && dom.formFeedback.textContent === text) return;
  feedbackThrottleAt = now;
  dom.formFeedback.textContent = text;
}

/* ======================= 7. CHALLENGE MANAGEMENT ======================= */

function resetChallengeRuntime() {
  state.repCount = 0;
  state.repState = "up";
  state.lastPhaseChangeAt = 0;
  state.lastAngle = null;
  state.lastMeaningfulMovementAt = performance.now();
  state.timerElapsedMs = 0;
  state.challengeActive = false;
  state.challengePaused = false;
  dom.repCounter.textContent = "0";
  dom.trackerTimer.textContent = "00:00";
  clearRestSequence();
}

function beginStartCountdown() {
  showScreen("tracker");
  attachStreamTo(dom.trackerVideo, dom.trackerCanvas);
  resetChallengeRuntime();
  dom.pausedOverlay.hidden = true;
  dom.restOverlay.hidden = true;

  let remaining = CONFIG.START_COUNTDOWN_SECONDS;
  dom.countdownOverlay.hidden = false;
  dom.countdownText.textContent = String(remaining);

  clearInterval(state.countdownIntervalId);
  state.countdownIntervalId = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      dom.countdownText.textContent = String(remaining);
    } else {
      clearInterval(state.countdownIntervalId);
      dom.countdownOverlay.hidden = true;
      actuallyStartChallenge();
    }
  }, 1000);

  runDetectionLoop("tracking");
}

function actuallyStartChallenge() {
  state.challengeActive = true;
  state.challengePaused = false;
  state.timerStartAt = performance.now();
  state.lastMeaningfulMovementAt = performance.now();
  tickTimer();
}

function tickTimer() {
  if (!state.challengeActive) return;
  if (!state.challengePaused) {
    const elapsed = state.timerElapsedMs + (performance.now() - state.timerStartAt);
    dom.trackerTimer.textContent = formatDuration(elapsed / 1000);
  }
  requestAnimationFrame(tickTimer);
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function onRepCompleted() {
  state.repCount += 1;
  dom.repCounter.textContent = String(state.repCount);
  bumpCounter();
  playTone(880, 90);
  setFormFeedback(`✓ REP ${state.repCount}`);

  if (CONFIG.MILESTONES.includes(state.repCount)) {
    showMilestone(state.repCount);
    playTone(1200, 160);
  }
}

function bumpCounter() {
  dom.repCounter.classList.remove("is-bump");
  dom.repPop.classList.remove("is-visible");
  // Force reflow so the animation can restart.
  void dom.repCounter.offsetWidth;
  dom.repCounter.classList.add("is-bump");
  dom.repPop.classList.add("is-visible");
  setTimeout(() => dom.repCounter.classList.remove("is-bump"), 200);
  setTimeout(() => dom.repPop.classList.remove("is-visible"), 900);
}

function showMilestone(reps) {
  dom.milestoneToast.hidden = false;
  dom.milestoneToast.textContent = `🔥 ${reps} REPS! KEEP GOING!`;
  clearTimeout(dom.milestoneToast._hideTimer);
  dom.milestoneToast._hideTimer = setTimeout(() => {
    dom.milestoneToast.hidden = true;
  }, 1800);
}

function maybeTriggerRest(now) {
  if (!state.challengeActive || state.challengePaused) return;
  if (state.restTimeoutId) return; // already in a rest sequence
  const idleFor = now - state.lastMeaningfulMovementAt;
  if (idleFor > CONFIG.REST_TRIGGER_MS) {
    startRestSequence();
  }
}

function startRestSequence() {
  dom.restOverlay.hidden = false;
  let remaining = Math.ceil(CONFIG.REST_COUNTDOWN_MS / 1000);
  dom.restCountdownText.textContent = String(remaining);

  state.restCountdownIntervalId = setInterval(() => {
    remaining -= 1;
    dom.restCountdownText.textContent = String(Math.max(remaining, 0));
  }, 1000);

  state.restTimeoutId = setTimeout(() => {
    clearRestSequence();
    finishChallenge({ auto: true });
  }, CONFIG.REST_COUNTDOWN_MS);
}

function clearRestSequence() {
  if (state.restTimeoutId) {
    clearTimeout(state.restTimeoutId);
    state.restTimeoutId = null;
    dom.restOverlay.hidden = true;
    clearInterval(state.restCountdownIntervalId);
    if (state.challengeActive) setFormFeedback("Keep going!");
  }
}

function pauseChallenge() {
  if (!state.challengeActive || state.challengePaused) return;
  state.challengePaused = true;
  state.timerElapsedMs += performance.now() - state.timerStartAt;
  clearRestSequence();
  dom.pausedOverlay.hidden = false;
}

function resumeChallenge() {
  if (!state.challengePaused) return;
  state.challengePaused = false;
  state.timerStartAt = performance.now();
  state.lastMeaningfulMovementAt = performance.now();
  dom.pausedOverlay.hidden = true;
}

function requestFinishChallenge() {
  openConfirm(
    "End challenge?",
    `Your current score is ${state.repCount} rep${state.repCount === 1 ? "" : "s"}. Are you sure you want to finish?`,
    "Finish Challenge",
    () => finishChallenge({ auto: false })
  );
}

function finishChallenge({ auto }) {
  if (!state.challengeActive) return;
  clearRestSequence();
  clearInterval(state.countdownIntervalId);
  if (!state.challengePaused) {
    state.timerElapsedMs += performance.now() - state.timerStartAt;
  }
  state.challengeActive = false;
  state.challengePaused = false;
  cancelDetectionLoop();
  stopCamera();

  const reps = state.repCount;
  const durationSeconds = Math.round(state.timerElapsedMs / 1000);
  const previousBest = state.personalBest;
  const isPR = reps > previousBest;

  const record = {
    id: `c_${Date.now()}`,
    playerName: state.userName,
    reps,
    duration: durationSeconds,
    date: new Date().toISOString(),
    isPersonalRecord: isPR,
  };

  state.history.unshift(record);
  state.totalReps += reps;
  state.totalChallenges += 1;
  if (isPR) state.personalBest = reps;
  upsertLeaderboardScore(state.userName, state.personalBest);
  if (state.remoteConnected) submitScoreRemote(state.userName, state.personalBest);
  persistAll();

  renderResult(record, previousBest);
  showScreen("result");
}

/* ======================= 8. VALIDATION ======================= */

function validateName(raw) {
  const trimmed = (raw || "").trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return { valid: false };
  if (trimmed.length > 24) return { valid: false };
  if (!/^[\p{L}\p{N} '\-_.]+$/u.test(trimmed)) return { valid: false };
  return { valid: true, value: trimmed };
}

function sanitizeScoreRecord(rec) {
  if (!rec || typeof rec !== "object") return null;
  const reps = Number(rec.reps);
  const duration = Number(rec.duration);
  if (!Number.isFinite(reps) || reps < 0) return null;
  if (!Number.isFinite(duration) || duration < 0) return null;
  if (typeof rec.date !== "string") return null;
  return {
    id: typeof rec.id === "string" ? rec.id : `c_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    playerName: typeof rec.playerName === "string" ? rec.playerName : "Guest",
    reps: Math.floor(reps),
    duration: Math.floor(duration),
    date: rec.date,
    isPersonalRecord: !!rec.isPersonalRecord,
  };
}

/* ======================= 9. LOCAL STORAGE ======================= */

const K = (name) => CONFIG.STORAGE_PREFIX + name;

function persistAll() {
  try {
    localStorage.setItem(K("userName"), state.userName || "");
    localStorage.setItem(K("personalBest"), String(state.personalBest));
    localStorage.setItem(K("totalReps"), String(state.totalReps));
    localStorage.setItem(K("totalChallenges"), String(state.totalChallenges));
    localStorage.setItem(K("history"), JSON.stringify(state.history.slice(0, 200)));
    localStorage.setItem(K("leaderboard"), JSON.stringify(state.leaderboard));
    localStorage.setItem(K("soundPreference"), state.soundOn ? "on" : "off");
    localStorage.setItem(K("themePreference"), state.theme);
  } catch (e) {
    showToast("Couldn't save your data — storage may be full or blocked.");
  }
}

function loadAll() {
  try {
    state.userName = localStorage.getItem(K("userName")) || null;
    state.personalBest = parseInt(localStorage.getItem(K("personalBest")), 10) || 0;
    state.totalReps = parseInt(localStorage.getItem(K("totalReps")), 10) || 0;
    state.totalChallenges = parseInt(localStorage.getItem(K("totalChallenges")), 10) || 0;

    const rawHistory = JSON.parse(localStorage.getItem(K("history")) || "[]");
    state.history = Array.isArray(rawHistory) ? rawHistory.map(sanitizeScoreRecord).filter(Boolean) : [];

    const rawBoard = JSON.parse(localStorage.getItem(K("leaderboard")) || "{}");
    state.leaderboard = rawBoard && typeof rawBoard === "object" ? rawBoard : {};

    state.soundOn = localStorage.getItem(K("soundPreference")) !== "off";
    state.theme = localStorage.getItem(K("themePreference")) === "light" ? "light" : "dark";
  } catch (e) {
    // Corrupted storage — fall back to safe defaults rather than crashing.
    state.history = [];
    state.leaderboard = {};
  }
}

function upsertLeaderboardScore(name, score) {
  if (!name) return;
  const current = state.leaderboard[name] || 0;
  if (score > current) state.leaderboard[name] = score;
}

function clearHistoryData() {
  state.history = [];
  state.totalReps = 0;
  state.totalChallenges = 0;
  state.personalBest = 0;
  if (state.userName) delete state.leaderboard[state.userName];
  persistAll();
  renderEverything();
  showToast("History cleared.");
}

function logOut() {
  // Logging out only forgets *who's currently using the device* — their
  // history and leaderboard entry stay saved under their name so they (or
  // anyone else who knows it) can pick up where they left off.
  state.userName = null;
  persistAll();
  renderEverything();
  showScreen("dashboard");
  showToast("Logged out.");
}

function resetAllData() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CONFIG.STORAGE_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
  state.userName = null;
  state.personalBest = 0;
  state.totalReps = 0;
  state.totalChallenges = 0;
  state.history = [];
  state.leaderboard = {};
  state.soundOn = true;
  state.theme = "dark";
  applyTheme();
  renderEverything();
  showScreen("dashboard");
  showToast("All data reset.");
}

/* ======================= 10. DASHBOARD RENDERING ======================= */

function renderDashboard() {
  dom.statBest.textContent = state.personalBest;
  dom.statTotal.textContent = state.totalReps;
  dom.statChallenges.textContent = state.totalChallenges;

  const rank = currentUserRank();
  dom.statRank.textContent = rank ? `#${rank}` : "—";

  // PR history preview (top 3 most recent).
  dom.dashboardPRList.innerHTML = "";
  if (state.history.length === 0) {
    dom.dashboardPRList.innerHTML = `<p class="muted">No challenges yet — your first session will show up here.</p>`;
  } else {
    state.history.slice(0, 3).forEach((rec) => {
      dom.dashboardPRList.appendChild(buildPrItem(rec));
    });
  }

  // Leaderboard preview (top 5).
  const rows = leaderboardRows();
  dom.dashboardLeaderboardList.innerHTML = "";
  if (rows.length === 0) {
    dom.dashboardLeaderboardList.innerHTML = `<p class="muted">Complete a challenge to join the local leaderboard.</p>`;
  } else {
    rows.slice(0, 5).forEach((row) => dom.dashboardLeaderboardList.appendChild(buildBoardRow(row)));
  }

  dom.heroDemoNum.textContent = String(Math.min(state.personalBest, 99)).padStart(2, "0");
  dom.userChipName.textContent = state.userName || "Guest";
}

function buildPrItem(rec) {
  const el = document.createElement("div");
  el.className = "pr-item" + (rec.isPersonalRecord ? " pr-item--top" : "");
  el.innerHTML = `
    <div>
      <span class="pr-item__reps">${rec.reps} reps</span>
      <div class="pr-item__date">${formatDate(rec.date)}</div>
    </div>
    ${rec.isPersonalRecord ? '<span class="pr-badge">🏆 PR</span>' : ""}
  `;
  return el;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

/* ======================= 11. LEADERBOARD RENDERING ======================= */

function leaderboardRows() {
  const source = state.remoteConnected
    ? state.remoteLeaderboard
    : Object.entries(state.leaderboard).map(([name, score]) => ({ name, score }));

  const entries = [...source].sort((a, b) => b.score - a.score);

  let rank = 0, lastScore = null, rows = [];
  entries.forEach((e, i) => {
    if (e.score !== lastScore) {
      rank = i + 1;
      lastScore = e.score;
    }
    rows.push({ ...e, rank, isYou: e.name === state.userName });
  });
  return rows;
}

function currentUserRank() {
  if (!state.userName) return null;
  const row = leaderboardRows().find((r) => r.isYou);
  return row ? row.rank : null;
}

function buildBoardRow(row) {
  const el = document.createElement("div");
  const medalClass = row.rank <= 3 ? ` board-row--${row.rank}` : "";
  el.className = "board-row" + medalClass + (row.isYou ? " board-row--you" : "");
  const medal = row.rank === 1 ? "🥇" : row.rank === 2 ? "🥈" : row.rank === 3 ? "🥉" : row.rank;
  el.innerHTML = `
    <span class="board-row__rank">${medal}</span>
    <span class="board-row__name">${escapeHtml(row.name)}${row.isYou ? " (you)" : ""}</span>
    <span class="board-row__score">${row.score}</span>
  `;
  return el;
}

function renderLeaderboardPage() {
  const rows = leaderboardRows();
  dom.leaderboardFullList.innerHTML = "";
  if (rows.length === 0) {
    dom.leaderboardFullList.innerHTML = `<p class="muted">No scores yet on this device. Finish a challenge to take the top spot.</p>`;
    return;
  }
  rows.forEach((row) => dom.leaderboardFullList.appendChild(buildBoardRow(row)));
}

/* ======================= 12. HISTORY RENDERING ======================= */

function renderHistoryPage() {
  dom.historyFullList.innerHTML = "";
  if (state.history.length === 0) {
    dom.historyEmpty.hidden = false;
    return;
  }
  dom.historyEmpty.hidden = true;
  state.history.forEach((rec) => {
    const el = document.createElement("div");
    el.className = "history-item" + (rec.isPersonalRecord ? " history-item--pr" : "");
    el.innerHTML = `
      <div class="history-item__main">
        <span class="history-item__reps">${rec.isPersonalRecord ? "🏆 " : ""}${rec.reps} reps</span>
        ${rec.isPersonalRecord ? '<span class="history-item__pr">NEW PERSONAL RECORD</span>' : ""}
      </div>
      <span class="history-item__meta">${formatDate(rec.date)} · ${formatDuration(rec.duration)}</span>
    `;
    dom.historyFullList.appendChild(el);
  });
}

function renderResult(record, previousBest) {
  dom.resultEyebrow.textContent = "CHALLENGE COMPLETE";
  dom.resultPrBadge.hidden = !record.isPersonalRecord;
  dom.resultReps.textContent = record.reps;
  dom.resultPrevBest.textContent = previousBest;
  dom.resultDuration.textContent = formatDuration(record.duration);
  const rank = currentUserRank();
  dom.resultRank.textContent = rank ? `#${rank}` : "—";
}

function renderSettings() {
  dom.settingsCurrentName.textContent = state.userName ? state.userName : "Guest — not logged in";
  dom.logoutBtn.disabled = !state.userName;
  dom.soundSwitch.setAttribute("aria-checked", String(state.soundOn));
  dom.themeSegmented.querySelectorAll(".segmented__btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.theme === state.theme);
  });
}

function renderEverything() {
  renderDashboard();
  renderLeaderboardPage();
  renderHistoryPage();
  renderSettings();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ======================= 14. SHARED LEADERBOARD (SUPABASE) =======================
   Optional. If CONFIG.SUPABASE_URL / SUPABASE_ANON_KEY are left as placeholders,
   REP LINE quietly stays on the local, per-browser leaderboard from section 11 —
   nothing breaks. See SETUP_SHARED_LEADERBOARD.md for the one-time setup. */

function supabaseConfigured() {
  return (
    !!CONFIG.SUPABASE_URL &&
    !!CONFIG.SUPABASE_ANON_KEY &&
    !CONFIG.SUPABASE_URL.includes("YOUR_") &&
    !CONFIG.SUPABASE_ANON_KEY.includes("YOUR_")
  );
}

async function initSharedLeaderboard() {
  if (!supabaseConfigured()) {
    updateLeaderboardNotice();
    return;
  }
  try {
    state.supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    await refreshRemoteLeaderboard();
    state.remoteConnected = true;

    // Live updates: whenever anyone's score changes, refresh everyone's view.
    state.supabase
      .channel("leaderboard-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "leaderboard" }, () => {
        refreshRemoteLeaderboard();
      })
      .subscribe();
  } catch (e) {
    state.remoteConnected = false;
    console.error("Shared leaderboard connection failed:", e);
  }
  updateLeaderboardNotice();
  renderDashboard();
  if (state.currentScreen === "leaderboard") renderLeaderboardPage();
}

async function refreshRemoteLeaderboard() {
  if (!state.supabase) return;
  const { data, error } = await state.supabase
    .from("leaderboard")
    .select("player_name, best_score")
    .order("best_score", { ascending: false })
    .limit(100);
  if (error) {
    console.error("Couldn't fetch shared leaderboard:", error);
    return;
  }
  state.remoteLeaderboard = data.map((r) => ({ name: r.player_name, score: r.best_score }));
  renderDashboard();
  if (state.currentScreen === "leaderboard") renderLeaderboardPage();
  if (state.currentScreen === "result") {
    const rank = currentUserRank();
    dom.resultRank.textContent = rank ? `#${rank}` : "—";
  }
}

// Scores only ever go up server-side (see submit_score in the SQL setup),
// so this can never be used to overwrite someone's best with a lower number.
async function submitScoreRemote(name, score) {
  if (!state.supabase || !name) return;
  try {
    const { error } = await state.supabase.rpc("submit_score", { p_name: name, p_score: score });
    if (error) throw error;
    await refreshRemoteLeaderboard();
  } catch (e) {
    console.error("Failed to submit score to shared leaderboard:", e);
    showToast("Couldn't reach the shared leaderboard — your score is still saved on this device.");
  }
}

function updateLeaderboardNotice() {
  if (!dom.leaderboardNotice) return;
  if (state.remoteConnected) {
    dom.leaderboardEyebrow.textContent = "🏆 GLOBAL LEADERBOARD";
    dom.statRankLabel.textContent = "Global Rank";
    dom.statRankUnit.textContent = "of all players";
    dom.leaderboardNotice.innerHTML =
      "<strong>Live global leaderboard.</strong> Scores below are shared in real time with everyone using this site.";
  } else if (supabaseConfigured()) {
    dom.leaderboardEyebrow.textContent = "🏆 LEADERBOARD";
    dom.statRankLabel.textContent = "Rank";
    dom.statRankUnit.textContent = "of all players";
    dom.leaderboardNotice.innerHTML =
      "<strong>Couldn't connect to the shared leaderboard right now.</strong> Showing your local scores instead — it'll reconnect automatically.";
  } else {
    dom.leaderboardEyebrow.textContent = "🏆 LOCAL LEADERBOARD";
    dom.statRankLabel.textContent = "Local Rank";
    dom.statRankUnit.textContent = "on this device";
    dom.leaderboardNotice.innerHTML =
      '<strong>This is a local leaderboard.</strong> Scores are saved with <code>localStorage</code> in this browser only. See <code>SETUP_SHARED_LEADERBOARD.md</code> to turn on a live, shared leaderboard for every visitor.';
  }
}

/* ======================= NAVIGATION / SCREEN HELPERS ======================= */

function showScreen(name) {
  // Leaving the calibration or tracker screen without an active/finishing
  // challenge should release the camera immediately (privacy first).
  if (state.currentScreen === "calibration" && name !== "tracker") {
    stopCamera();
  }
  if (state.currentScreen === "tracker" && name !== "tracker" && !state.challengeActive) {
    stopCamera();
  }

  state.currentScreen = name;
  dom.screens.forEach((s) => s.classList.toggle("is-active", s.id === `screen-${name}`));
  dom.navlinks.forEach((l) => {
    if (l.dataset.nav) l.classList.toggle("is-active", l.dataset.nav === name);
  });
  dom.mobileMenu.hidden = true;
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

  if (name === "leaderboard") renderLeaderboardPage();
  if (name === "history") renderHistoryPage();
  if (name === "settings") renderSettings();
  if (name === "dashboard") renderDashboard();
}

/* ======================= TOAST / CONFIRM MODAL ======================= */

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  clearTimeout(dom.toast._timer);
  dom.toast._timer = setTimeout(() => (dom.toast.hidden = true), 2600);
}

let confirmCallback = null;
function openConfirm(title, body, confirmLabel, onConfirm) {
  dom.confirmTitle.textContent = title;
  dom.confirmBody.textContent = body;
  dom.confirmOkBtn.textContent = confirmLabel || "Confirm";
  confirmCallback = onConfirm;
  dom.confirmModal.hidden = false;
}
function closeConfirm() {
  dom.confirmModal.hidden = true;
  confirmCallback = null;
}

/* ======================= SOUND ======================= */

function ensureAudioCtx() {
  if (!state.audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) state.audioCtx = new Ctx();
  }
  return state.audioCtx;
}

function playTone(freq, durationMs) {
  if (!state.soundOn) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationMs / 1000);
}

/* ======================= THEME ======================= */

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
}

/* ======================= CALIBRATION LOGIC ======================= */

function resetCalibration() {
  state.calibPassStreakStart = null;
  state.calibPassed = false;
  dom.calibReady.hidden = true;
  dom.startCountdownBtn.disabled = true;
  dom.calibStatusBadge.textContent = "● Connecting…";
  dom.calibChecks.querySelectorAll("li").forEach((li) => li.classList.remove("is-pass"));
}

function setCheck(name, pass) {
  const li = dom.calibChecks.querySelector(`[data-check="${name}"]`);
  if (li) li.classList.toggle("is-pass", pass);
}

function updateCalibration(landmarks) {
  dom.calibStatusBadge.textContent = "● Camera Connected";
  setCheck("camera", true);

  if (!landmarks) {
    setCheck("body", false);
    setCheck("landmarks", false);
    setCheck("orientation", false);
    state.calibPassStreakStart = null;
    return;
  }

  const analysis = analyzePose(landmarks);
  const bodyDetected = analysis.quality >= CONFIG.MIN_VISIBILITY_FOR_TRACKING;
  const landmarksGood = analysis.quality >= CONFIG.GOOD_VISIBILITY;
  const orientationOk = analysis.isPlank;

  setCheck("body", bodyDetected);
  setCheck("landmarks", landmarksGood);
  setCheck("orientation", orientationOk);

  const allPass = bodyDetected && landmarksGood && orientationOk;
  if (allPass) {
    if (!state.calibPassStreakStart) state.calibPassStreakStart = performance.now();
    if (performance.now() - state.calibPassStreakStart > 500 && !state.calibPassed) {
      state.calibPassed = true;
      dom.calibReady.hidden = false;
      dom.startCountdownBtn.disabled = false;
    }
  } else {
    state.calibPassStreakStart = null;
  }
}

/* ======================= FLOW ENTRY POINTS ======================= */

async function handleStartChallengeClick() {
  if (!state.userName) {
    state.pendingNextScreen = "permission";
    showScreen("name");
    dom.nameInput.focus();
    return;
  }
  goToPermissionOrCalibration();
}

function goToPermissionOrCalibration() {
  showScreen("permission");
  hideAllCameraAlerts();
  if (!browserSupportsCamera()) {
    dom.browserUnsupportedAlert.hidden = false;
    dom.grantCameraBtn.disabled = true;
  } else {
    dom.grantCameraBtn.disabled = false;
  }
}

async function handleGrantCameraClick() {
  dom.grantCameraBtn.disabled = true;
  dom.grantCameraBtn.textContent = "Requesting…";
  const stream = await startCamera();
  dom.grantCameraBtn.disabled = false;
  dom.grantCameraBtn.textContent = "Allow Camera Access";
  if (!stream) return;

  showScreen("calibration");
  resetCalibration();
  attachStreamTo(dom.calibVideo, dom.calibCanvas);

  dom.calibStatusBadge.textContent = "● Loading pose model…";
  try {
    await ensurePoseLandmarker();
  } catch (e) {
    dom.calibStatusBadge.textContent = "⚠ Couldn't load tracking model";
    showToast("Pose detection failed to load. Check your connection and try again.");
    return;
  }
  runDetectionLoop("calibration");
}

/* ======================= 13. EVENT LISTENERS ======================= */

function wireNav() {
  dom.navlinks.forEach((el) => {
    el.addEventListener("click", () => showScreen(el.dataset.nav));
  });
  dom.hamburgerBtn.addEventListener("click", () => {
    const willOpen = dom.mobileMenu.hidden;
    dom.mobileMenu.hidden = !willOpen;
    dom.hamburgerBtn.setAttribute("aria-expanded", String(willOpen));
  });
  dom.userChip.addEventListener("click", () => {
    if (state.userName) {
      openConfirm(
        "Log out?",
        `You'll be asked for a display name again next time you start a challenge. Your saved history and leaderboard score for "${state.userName}" stay on this device.`,
        "Log Out",
        logOut
      );
    } else {
      state.pendingNextScreen = "dashboard";
      showScreen("name");
      dom.nameInput.value = "";
      dom.nameError.hidden = true;
      dom.nameInput.focus();
    }
  });
}

function wireDashboard() {
  dom.startChallengeBtn.addEventListener("click", handleStartChallengeClick);
  dom.historyStartBtn?.addEventListener("click", handleStartChallengeClick);
}

function wireNameScreen() {
  dom.nameContinueBtn.addEventListener("click", () => {
    const result = validateName(dom.nameInput.value);
    if (!result.valid) {
      dom.nameError.hidden = false;
      return;
    }
    dom.nameError.hidden = true;
    state.userName = result.value;
    persistAll();
    renderDashboard();
    goToPermissionOrCalibration();
  });
  dom.nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") dom.nameContinueBtn.click();
  });
}

function wirePermissionScreen() {
  dom.grantCameraBtn.addEventListener("click", handleGrantCameraClick);
  dom.retryCameraBtn.addEventListener("click", handleGrantCameraClick);
  dom.retryCameraBtn2.addEventListener("click", handleGrantCameraClick);
}

function wireCalibration() {
  dom.startCountdownBtn.addEventListener("click", beginStartCountdown);
}

function wireTracker() {
  dom.pauseBtn.addEventListener("click", pauseChallenge);
  dom.resumeBtn.addEventListener("click", resumeChallenge);
  dom.endFromPauseBtn.addEventListener("click", requestFinishChallenge);
  dom.finishBtn.addEventListener("click", requestFinishChallenge);
  dom.soundToggleBtn.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    dom.soundToggleBtn.textContent = state.soundOn ? "🔊" : "🔇";
    persistAll();
  });
}

function wireResult() {
  dom.tryAgainBtn.addEventListener("click", () => {
    goToPermissionOrCalibration();
  });
}

function wireSettings() {
  dom.editNameBtn.addEventListener("click", () => {
    state.pendingNextScreen = "settings";
    showScreen("name");
    dom.nameInput.value = state.userName || "";
    dom.nameInput.focus();
  });
  dom.soundSwitch.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    dom.soundSwitch.setAttribute("aria-checked", String(state.soundOn));
    persistAll();
  });
  dom.themeSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    state.theme = btn.dataset.theme;
    applyTheme();
    persistAll();
    renderSettings();
  });
  dom.logoutBtn.addEventListener("click", () => {
    if (!state.userName) {
      showToast("You're not logged in.");
      return;
    }
    openConfirm(
      "Log out?",
      `You'll be asked for a display name again next time you start a challenge. Your saved history and leaderboard score for "${state.userName}" stay on this device.`,
      "Log Out",
      logOut
    );
  });
  dom.clearHistoryBtn.addEventListener("click", () => {
    openConfirm(
      "Clear your history?",
      "This will permanently remove your challenge history and personal records from this browser.",
      "Clear History",
      clearHistoryData
    );
  });
  dom.resetDataBtn.addEventListener("click", () => {
    openConfirm(
      "Reset all data?",
      "This will permanently remove your name, history, and local leaderboard entry from this browser.",
      "Reset Data",
      resetAllData
    );
  });
}

function wireConfirmModal() {
  dom.confirmCancelBtn.addEventListener("click", closeConfirm);
  dom.confirmOkBtn.addEventListener("click", () => {
    const cb = confirmCallback;
    closeConfirm();
    if (cb) cb();
  });
  dom.confirmModal.addEventListener("click", (e) => {
    if (e.target === dom.confirmModal) closeConfirm();
  });
}

// Override the name-continue behaviour when we came from Settings (edit name)
// rather than the "start a challenge" flow.
function wireNameScreenRouting() {
  dom.nameContinueBtn.addEventListener("click", () => {
    const result = validateName(dom.nameInput.value);
    if (!result.valid) return;
    if (state.pendingNextScreen === "settings") {
      state.pendingNextScreen = null;
      showScreen("settings");
    } else if (state.pendingNextScreen === "dashboard") {
      state.pendingNextScreen = null;
      showScreen("dashboard");
    } else {
      state.pendingNextScreen = null;
    }
  });
}

/* ======================= INIT ======================= */

function init() {
  loadAll();
  applyTheme();
  renderEverything();
  dom.soundToggleBtn.textContent = state.soundOn ? "🔊" : "🔇";

  wireNav();
  wireDashboard();
  wireNameScreen();
  wireNameScreenRouting();
  wirePermissionScreen();
  wireCalibration();
  wireTracker();
  wireResult();
  wireSettings();
  wireConfirmModal();

  window.addEventListener("beforeunload", stopCamera);
  window.addEventListener("resize", () => {
    if (state.activeVideoEl && state.activeCanvasEl) {
      syncCanvasSize(state.activeVideoEl, state.activeCanvasEl);
    }
  });

  showScreen("dashboard");
  initSharedLeaderboard();
}

init();