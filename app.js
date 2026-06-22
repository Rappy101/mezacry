// ============================================================
// CRY CHECK — Pokémon cry matcher
// ============================================================

const ROSTER = [
  "eternatus", "greninja", "grimsnarl", "hooh", "kaldeo",
  "lugia", "lunala", "solgaleo", "zeraora", "zygarde"
];

const SOUND_DIR = "sounds/";

// ---------- DOM ----------
const rosterGrid = document.getElementById("rosterGrid");
const recordBtn = document.getElementById("recordBtn");
const recIconMic = document.getElementById("recIconMic");
const recIconStop = document.getElementById("recIconStop");
const captureState = document.getElementById("captureState");
const captureTimer = document.getElementById("captureTimer");
const captureHint = document.getElementById("captureHint");
const meterRingFill = document.getElementById("meterRingFill");
const relistenBtn = document.getElementById("relistenBtn");
const fileInput = document.getElementById("fileInput");
const resultsSection = document.getElementById("resultsSection");
const resultsList = document.getElementById("resultsList");
const signalIndicator = document.getElementById("signalIndicator");
const signalLabel = document.getElementById("signalLabel");
const toastEl = document.getElementById("toast");

const RING_CIRCUMFERENCE = 2 * Math.PI * 98;
meterRingFill.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
meterRingFill.style.strokeDashoffset = `${RING_CIRCUMFERENCE}`;

// ---------- toast ----------
let toastTimer = null;
function showToast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.dataset.show = "false"; }, ms);
}

// ---------- shared audio context ----------
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// ============================================================
// ROSTER PLAYBACK (tap to play/loop, tap again to stop)
// ============================================================

const rosterState = {}; // name -> { el, audio, status }

function buildRoster() {
  ROSTER.forEach((name) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "roster-card";
    card.dataset.name = name;
    card.setAttribute("aria-label", `Play ${capitalize(name)} cry`);

    card.innerHTML = `
      <div class="roster-art">
        <span class="emoji">🔊</span>
        <div class="bars" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      </div>
      <span class="roster-name">${capitalize(name)}</span>
      <span class="roster-status">tap to play</span>
    `;

    const audio = new Audio(`${SOUND_DIR}${name}.mp3`);
    audio.loop = true;
    audio.preload = "none";

    audio.addEventListener("error", () => {
      rosterState[name].status = "error";
      card.dataset.state = "error";
      card.querySelector(".roster-status").textContent = "file missing";
    });

    card.addEventListener("click", () => toggleRosterPlay(name));

    rosterState[name] = { card, audio, status: "idle" };
    rosterGrid.appendChild(card);
  });
}

function stopAllRoster(exceptName = null) {
  ROSTER.forEach((name) => {
    if (name === exceptName) return;
    const s = rosterState[name];
    if (s.status === "playing") {
      s.audio.pause();
      s.audio.currentTime = 0;
      s.status = "idle";
      s.card.dataset.playing = "false";
      s.card.querySelector(".roster-status").textContent = "tap to play";
    }
  });
}

function toggleRosterPlay(name) {
  const s = rosterState[name];
  if (s.status === "error") {
    showToast(`Couldn't find sounds/${name}.mp3 — check the file is in your sounds folder.`);
    return;
  }
  // pause any ongoing recording playback for clarity
  stopRelistenPlayback();

  if (s.status === "playing") {
    s.audio.pause();
    s.audio.currentTime = 0;
    s.status = "idle";
    s.card.dataset.playing = "false";
    s.card.querySelector(".roster-status").textContent = "tap to play";
    return;
  }

  stopAllRoster(name);
  s.audio.currentTime = 0;
  s.audio.play().then(() => {
    s.status = "playing";
    s.card.dataset.playing = "true";
    s.card.querySelector(".roster-status").textContent = "looping";
  }).catch(() => {
    showToast("Tap once anywhere on the page first, then try playing the cry again.");
  });
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

buildRoster();

// ============================================================
// RECORDING + UPLOAD
// ============================================================

let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let isRecording = false;
let recordStartTime = 0;
let timerInterval = null;

let capturedBuffer = null;   // decoded AudioBuffer of the current capture (recorded or uploaded)
let capturedLabel = "";      // "recorded clip" or filename

// --- live level meter (analyser on mic stream while recording) ---
let analyser = null;
let analyserSource = null;
let meterRAF = null;

function setSignal(state, label) {
  signalIndicator.dataset.state = state;
  signalLabel.textContent = label;
}

recordBtn.addEventListener("click", async () => {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  stopRelistenPlayback();
  stopAllRoster();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    showToast("Microphone access was blocked. Allow mic permission in your browser settings to record.");
    return;
  }

  const ctx = getAudioCtx();
  analyserSource = ctx.createMediaStreamSource(mediaStream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyserSource.connect(analyser);
  runMeterLoop();

  let mimeType = "audio/webm";
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
  }

  mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
  recordedChunks = [];

  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = handleRecordingStop;

  mediaRecorder.start();
  isRecording = true;
  recordStartTime = performance.now();

  recordBtn.dataset.active = "true";
  recordBtn.setAttribute("aria-label", "Stop recording");
  recIconMic.hidden = true;
  recIconStop.hidden = false;
  captureState.textContent = "recording…";
  setSignal("recording", "recording");
  relistenBtn.disabled = true;

  timerInterval = setInterval(updateTimer, 100);
}

function updateTimer() {
  const elapsed = (performance.now() - recordStartTime) / 1000;
  const mins = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const secs = (elapsed % 60).toFixed(1).padStart(4, "0");
  captureTimer.textContent = `${mins}:${secs}`;
}

function runMeterLoop() {
  const data = new Uint8Array(analyser.frequencyBinCount);
  function tick() {
    if (!analyser) return;
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const level = Math.min(1, rms * 3.2); // gentle gain so normal mall volume visibly moves the ring
    const offset = RING_CIRCUMFERENCE * (1 - level);
    meterRingFill.style.strokeDashoffset = `${offset}`;
    meterRingFill.style.stroke = level > 0.75 ? "var(--magenta)" : "var(--cyan)";
    meterRAF = requestAnimationFrame(tick);
  }
  tick();
}

function stopMeterLoop() {
  if (meterRAF) cancelAnimationFrame(meterRAF);
  meterRAF = null;
  meterRingFill.style.strokeDashoffset = `${RING_CIRCUMFERENCE}`;
  meterRingFill.style.stroke = "var(--cyan)";
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;
  clearInterval(timerInterval);
  stopMeterLoop();

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  recordBtn.dataset.active = "false";
  recordBtn.setAttribute("aria-label", "Start recording");
  recIconMic.hidden = false;
  recIconStop.hidden = true;
  captureState.textContent = "processing…";
  setSignal("idle", "mic idle");
}

async function handleRecordingStop() {
  const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
  if (blob.size === 0) {
    captureState.textContent = "tap to record";
    showToast("That recording came out empty — try again, holding the phone a bit closer.");
    return;
  }
  try {
    const arrayBuf = await blob.arrayBuffer();
    const ctx = getAudioCtx();
    const decoded = await ctx.decodeAudioData(arrayBuf);
    capturedBuffer = decoded;
    capturedLabel = "recorded clip";
    onCaptureReady();
  } catch (err) {
    captureState.textContent = "tap to record";
    showToast("Couldn't process that recording. Try recording again.");
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  stopRelistenPlayback();
  stopAllRoster();
  captureState.textContent = "processing…";
  try {
    const arrayBuf = await file.arrayBuffer();
    const ctx = getAudioCtx();
    const decoded = await ctx.decodeAudioData(arrayBuf);
    capturedBuffer = decoded;
    capturedLabel = file.name;
    onCaptureReady();
  } catch (err) {
    captureState.textContent = "tap to record";
    showToast("Couldn't read that file. Try a standard mp3, wav, or m4a clip.");
  }
  fileInput.value = "";
});

function onCaptureReady() {
  captureState.textContent = `ready — ${capturedLabel}`;
  captureTimer.textContent = formatDuration(capturedBuffer.duration);
  relistenBtn.disabled = false;
  setSignal("ready", "clip captured");
  showToast("Clip captured. Comparing against the roster…");
  runComparison();
}

function formatDuration(sec) {
  const mins = Math.floor(sec / 60).toString().padStart(2, "0");
  const secs = (sec % 60).toFixed(1).padStart(4, "0");
  return `${mins}:${secs}`;
}

// ============================================================
// RELISTEN MODE — loop the captured clip back for manual A/B
// ============================================================

let relistenSourceNode = null;
let relistenPlaying = false;

relistenBtn.addEventListener("click", () => {
  if (!capturedBuffer) return;
  if (relistenPlaying) {
    stopRelistenPlayback();
  } else {
    stopAllRoster();
    startRelistenPlayback();
  }
});

function startRelistenPlayback() {
  const ctx = getAudioCtx();
  relistenSourceNode = ctx.createBufferSource();
  relistenSourceNode.buffer = capturedBuffer;
  relistenSourceNode.loop = true;
  relistenSourceNode.connect(ctx.destination);
  relistenSourceNode.start();
  relistenPlaying = true;
  relistenBtn.dataset.active = "true";
  relistenBtn.querySelector("svg")?.remove();
  captureHint.textContent = "Playing your captured clip on loop. Tap roster cries above to switch back and forth by ear.";
}

function stopRelistenPlayback() {
  if (relistenSourceNode) {
    try { relistenSourceNode.stop(); } catch (e) {}
    relistenSourceNode.disconnect();
    relistenSourceNode = null;
  }
  if (relistenPlaying) {
    relistenPlaying = false;
    relistenBtn.dataset.active = "false";
    captureHint.textContent = "Relisten mode plays your captured clip back on loop so you can compare it by ear against the roster above.";
  }
}

// ============================================================
// MATCHING ENGINE
// spectral-band fingerprint + sliding cosine similarity
// robust-ish to background noise and to extra silence/junk
// before or after the actual cry in the recording.
// ============================================================

const FFT_SIZE = 1024;
const HOP_SIZE = 512;
const NUM_BANDS = 40;
const MIN_HZ = 150;   // skip rumble / mall low-end hum
const MAX_HZ = 9000;

const referenceCache = {}; // name -> fingerprint (or "error")

function hannWindow(N) {
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  return w;
}
const WINDOW = hannWindow(FFT_SIZE);

// minimal radix-2 FFT (in-place, real input via complex arrays)
function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  // bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe; curIm = nextIm;
      }
    }
  }
}

function buildLogBands(sampleRate) {
  // log-spaced band edges between MIN_HZ and MAX_HZ, mapped to FFT bin ranges
  const nyquist = sampleRate / 2;
  const hiHz = Math.min(MAX_HZ, nyquist - 1);
  const edgesHz = [];
  const logMin = Math.log(MIN_HZ), logMax = Math.log(hiHz);
  for (let i = 0; i <= NUM_BANDS; i++) {
    edgesHz.push(Math.exp(logMin + ((logMax - logMin) * i) / NUM_BANDS));
  }
  const binHz = sampleRate / FFT_SIZE;
  return edgesHz.map((hz) => Math.min(FFT_SIZE / 2 - 1, Math.max(0, Math.round(hz / binHz))));
}

// downmix to mono Float32Array
function toMono(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.getChannelData(1);
  const out = new Float32Array(ch0.length);
  for (let i = 0; i < ch0.length; i++) out[i] = (ch0[i] + ch1[i]) / 2;
  return out;
}

// produce array of frames, each frame = NUM_BANDS energies, L2-normalized
function fingerprint(buffer) {
  const samples = toMono(buffer);
  const sr = buffer.sampleRate;
  const bandEdges = buildLogBands(sr);
  const frames = [];

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  for (let start = 0; start + FFT_SIZE <= samples.length; start += HOP_SIZE) {
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = samples[start + i] * WINDOW[i];
      im[i] = 0;
    }
    fft(re, im);

    const rawBands = new Float32Array(NUM_BANDS);
    for (let b = 0; b < NUM_BANDS; b++) {
      const lo = bandEdges[b], hi = Math.max(lo + 1, bandEdges[b + 1]);
      let sum = 0, count = 0;
      for (let k = lo; k < hi && k < FFT_SIZE / 2; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        sum += mag; count++;
      }
      rawBands[b] = count > 0 ? sum / count : 0;
    }

    // spectral whitening: subtract a smoothed local "noise floor" so that broadband
    // noise (mall crowd, hiss) contributes far less than a real tonal peak standing
    // out above its neighbors. This is the key step that makes a quiet, buried cry
    // distinguishable from generic background noise.
    const SMOOTH_RADIUS = 3;
    const floor = new Float32Array(NUM_BANDS);
    for (let b = 0; b < NUM_BANDS; b++) {
      let sum = 0, count = 0;
      for (let o = -SMOOTH_RADIUS; o <= SMOOTH_RADIUS; o++) {
        const idx = b + o;
        if (idx >= 0 && idx < NUM_BANDS) { sum += rawBands[idx]; count++; }
      }
      floor[b] = sum / count;
    }

    const bands = new Float32Array(NUM_BANDS);
    for (let b = 0; b < NUM_BANDS; b++) {
      const prominence = rawBands[b] - floor[b]; // how much this band pokes above its local floor
      bands[b] = Math.max(0, prominence);
    }
    // log-compress to tame loudness/dynamic-range differences
    for (let b = 0; b < NUM_BANDS; b++) bands[b] = Math.log1p(bands[b] * 60);

    // L2 normalize the frame (removes overall volume sensitivity)
    let norm = 0;
    for (let b = 0; b < NUM_BANDS; b++) norm += bands[b] * bands[b];
    norm = Math.sqrt(norm);
    if (norm > 1e-6) for (let b = 0; b < NUM_BANDS; b++) bands[b] /= norm;

    frames.push(bands);
  }
  return frames;
}

// drop near-silent frames (helps when the recording has dead air before/after the cry)
function energyOf(frame) {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return s;
}

function trimSilence(frames) {
  if (frames.length === 0) return frames;
  const energies = frames.map(energyOf);
  const maxE = Math.max(...energies);
  if (maxE < 1e-8) return frames;
  const threshold = maxE * 0.12;
  let start = 0, end = frames.length - 1;
  while (start < end && energies[start] < threshold) start++;
  while (end > start && energies[end] < threshold) end--;
  return frames.slice(start, end + 1);
}

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both already L2-normalized, so dot product == cosine similarity
}

// slide the shorter sequence across the longer one, return best average similarity
function bestAlignmentScore(framesA, framesB) {
  let short = framesA, long = framesB;
  if (framesA.length > framesB.length) { short = framesB; long = framesA; }
  if (short.length === 0 || long.length === 0) return 0;

  if (short.length > long.length) return 0;

  const maxOffset = long.length - short.length;
  let best = -1;
  const step = Math.max(1, Math.floor(maxOffset / 60)); // cap work for very long clips

  for (let offset = 0; offset <= maxOffset; offset += step) {
    let sum = 0;
    for (let i = 0; i < short.length; i++) {
      sum += cosineSim(short[i], long[offset + i]);
    }
    const avg = sum / short.length;
    if (avg > best) best = avg;
  }
  return Math.max(0, best);
}

async function loadReferenceFingerprint(name) {
  if (referenceCache[name] !== undefined) return referenceCache[name];
  try {
    const resp = await fetch(`${SOUND_DIR}${name}.mp3`);
    if (!resp.ok) throw new Error("not found");
    const arrayBuf = await resp.arrayBuffer();
    const ctx = getAudioCtx();
    const decoded = await ctx.decodeAudioData(arrayBuf);
    const fp = trimSilence(fingerprint(decoded));
    referenceCache[name] = fp;
    return fp;
  } catch (err) {
    referenceCache[name] = "error";
    return "error";
  }
}

async function runComparison() {
  if (!capturedBuffer) return;
  resultsSection.hidden = false;
  resultsList.innerHTML = `<div class="result-row"><span class="result-name">Analyzing…</span></div>`;

  const capturedFp = trimSilence(fingerprint(capturedBuffer));

  const scored = [];
  for (const name of ROSTER) {
    const refFp = await loadReferenceFingerprint(name);
    if (refFp === "error") {
      scored.push({ name, score: null, error: true });
      continue;
    }
    const sim = bestAlignmentScore(capturedFp, refFp); // -1..1 roughly, mostly 0..1
    const score = Math.round(Math.max(0, Math.min(1, sim)) * 100);
    scored.push({ name, score, error: false });
  }

  scored.sort((a, b) => {
    if (a.error) return 1;
    if (b.error) return -1;
    return b.score - a.score;
  });

  renderResults(scored);
}

function renderResults(scored) {
  resultsList.innerHTML = "";

  const ranked = scored.filter((s) => !s.error);
  const top3 = ranked.slice(0, 3);

  const intro = document.createElement("div");
  intro.className = "verdict-banner";
  intro.dataset.verdict = "pick";
  intro.innerHTML = `<span class="verdict-title">Top 3 candidates — your call</span><span class="verdict-sub">Scores are a lead, not a verdict. Tap a candidate below to confirm it, or use relisten mode to check by ear first.</span>`;
  resultsList.appendChild(intro);

  top3.forEach((item, idx) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "result-row result-row-pick";
    row.dataset.rank = String(idx);
    row.innerHTML = `
      <span class="result-rank">${idx + 1}</span>
      <span class="result-name">${capitalize(item.name)}</span>
      <span class="result-bar-wrap"><span class="result-bar" style="width:0%"></span></span>
      <span class="result-score">${item.score}%</span>
    `;
    row.addEventListener("click", () => confirmPick(item.name));
    resultsList.appendChild(row);
  });

  const rest = ranked.slice(3);
  if (rest.length) {
    const moreToggle = document.createElement("button");
    moreToggle.type = "button";
    moreToggle.className = "results-more-toggle";
    moreToggle.textContent = `Show remaining ${rest.length}`;
    moreToggle.addEventListener("click", () => {
      moreToggle.remove();
      rest.forEach((item, idx) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "result-row result-row-pick result-row-dim";
        row.innerHTML = `
          <span class="result-rank">${idx + 4}</span>
          <span class="result-name">${capitalize(item.name)}</span>
          <span class="result-bar-wrap"><span class="result-bar" style="width:${item.score}%"></span></span>
          <span class="result-score">${item.score}%</span>
        `;
        row.addEventListener("click", () => confirmPick(item.name));
        resultsList.appendChild(row);
      });
    });
    resultsList.appendChild(moreToggle);
  }

  const erroredNames = scored.filter((s) => s.error);
  if (erroredNames.length) {
    const errNote = document.createElement("p");
    errNote.className = "results-error-note";
    errNote.textContent = `Couldn't load: ${erroredNames.map((s) => capitalize(s.name)).join(", ")} — check those mp3 files exist in sounds/.`;
    resultsList.appendChild(errNote);
  }

  // animate bars in after render
  requestAnimationFrame(() => {
    resultsList.querySelectorAll(".result-row-pick").forEach((row) => {
      const bar = row.querySelector(".result-bar");
      const scoreText = row.querySelector(".result-score")?.textContent || "0%";
      if (bar) bar.style.width = scoreText;
    });
  });

  if (top3[0]) {
    showToast(`Top lead: ${capitalize(top3[0].name)} (${top3[0].score}%) — tap a candidate to confirm.`);
  }
}

function confirmPick(name) {
  resultsList.querySelectorAll(".result-row-pick").forEach((row) => {
    const isPicked = row.querySelector(".result-name")?.textContent.toLowerCase() === name;
    row.dataset.confirmed = isPicked ? "true" : "false";
  });
  showToast(`Confirmed: ${capitalize(name)}. Tap its roster card above to relisten and double-check.`);
}
