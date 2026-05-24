const canvas = document.querySelector("#scene");
const ctx2d = canvas.getContext("2d");
const startButton = document.querySelector("#startButton");
const testButton = document.querySelector("#testButton");
const statusText = document.querySelector("#statusText");
const volumeControl = document.querySelector("#volumeControl");
const sensitivityControl = document.querySelector("#sensitivityControl");
const sustainControl = document.querySelector("#sustainControl");
const breezeToggle = document.querySelector("#breezeToggle");
const keyControl = document.querySelector("#keyControl");
const motionMeter = document.querySelector("#motionMeter");

const KEYS = {
  pentatonic: {
    label: "Pentatonic",
    notes: [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51],
  },
  amazingGrace: {
    label: "Amazing Grace",
    notes: [392.0, 440.0, 493.88, 587.33, 659.25, 783.99, 880.0, 987.77],
  },
  minorPent: {
    label: "Minor",
    notes: [440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66],
  },
  zenGarden: {
    label: "Zen Garden",
    notes: [349.23, 415.3, 466.16, 523.25, 622.25, 698.46, 830.61, 932.33],
  },
  original: {
    label: "Original",
    notes: [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1174.66, 1318.51],
  },
};
const ROD_COUNT = 6;
const ROD_PITCHES = [0, 2, 4, 1, 5, 3];
const LENGTH_BY_PITCH = { 0: 240, 1: 226, 2: 214, 3: 198, 4: 188, 5: 178 };
const ROD_LENGTHS = ROD_PITCHES.map((p) => LENGTH_BY_PITCH[p]);
const ROD_WIDTHS = [20, 19, 18, 17, 19, 18];

const MAX_ACTIVE_STRIKES = 16;
const PHY_STEP = 1 / 120;
const PHY_MAX_STEPS_PER_FRAME = 6;

const STORAGE = {
  volume: "chimes.volume",
  sensitivity: "chimes.sensitivity",
  sustain: "chimes.sustain",
  breeze: "chimes.breeze",
  key: "chimes.key",
};

const PHY = {
  ringR: 52,
  ringAngleOffset: Math.PI / 12,
  gravity: 1400,
  rodDamping: 1.05,
  rodMass: 1.0,
  rodRadius: 11.5,
  penDamping: 0.32,
  penMass: 2.8,
  penRadius: 17,
  penLength: 300,
  discFraction: 0.5,
  discRadius: 30,
  bottomWeightRadius: 22,
  motionForceScale: 220,
  testImpulse: 400,
  testInitialDisp: 32,
  collisionDebounceMs: 55,
  collisionImpulseToIntensity: 0.05,
  collisionMinImpulse: 2,
  restitution: 0.55,
  idleSwayForce: 3.0,
  breezeForcePendulum: 120,
  breezeForceRod: 5,
  breezeGustPeak: 5.5,
};

const state = {
  audioContext: null,
  masterGain: null,
  convolver: null,
  dryGain: null,
  wetGain: null,
  started: false,
  motionReady: false,
  volume: 0.76,
  sensitivity: 0.64,
  sustain: 15,
  breeze: false,
  key: "pentatonic",
  width: 0,
  height: 0,
  dpr: 1,
  activeStrikes: [],
  lastFrameMs: null,
  physAccum: 0,
  motionAx: 0,
  motionAz: 0,
  motionBaseX: 0,
  motionBaseY: 0,
  motionBaseZ: 0,
  motionBaseInit: false,
  motionEnergy: 0,
};

let rods = [];
let pendulum = null;

function safeNumber(v) {
  return Number.isFinite(v) ? v : 0;
}

function updateStatus(message) {
  statusText.textContent = message;
}

function readNumber(key, fallback, min, max) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    if (min !== undefined && n < min) return fallback;
    if (max !== undefined && n > max) return fallback;
    return n;
  } catch {
    return fallback;
  }
}

function readBool(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function readKey(fallback) {
  try {
    const raw = localStorage.getItem(STORAGE.key);
    if (raw && KEYS[raw]) return raw;
    return fallback;
  } catch {
    return fallback;
  }
}

function applyPersistedSettings() {
  const v = readNumber(STORAGE.volume, 0.76, 0, 1);
  const s = readNumber(STORAGE.sensitivity, 0.64, 0, 1);
  const su = readNumber(STORAGE.sustain, 15, 10, 20);
  const br = readBool(STORAGE.breeze, false);
  const k = readKey("pentatonic");
  volumeControl.value = String(v);
  sensitivityControl.value = String(s);
  sustainControl.value = String(su);
  breezeToggle.checked = br;
  if (keyControl) keyControl.value = k;
  state.volume = v;
  state.sensitivity = s;
  state.sustain = su;
  state.breeze = br;
  state.key = k;
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  state.width = rect.width;
  state.height = rect.height;
  state.dpr = dpr;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function buildBodies() {
  rods = [];
  for (let i = 0; i < ROD_COUNT; i += 1) {
    const angle = (i / ROD_COUNT) * Math.PI * 2 - Math.PI / 2 + PHY.ringAngleOffset;
    const px = Math.cos(angle) * PHY.ringR;
    const pz = Math.sin(angle) * PHY.ringR;
    const L = ROD_LENGTHS[i];
    rods.push({
      idx: i,
      isPendulum: false,
      pivotX: px,
      pivotY: 0,
      pivotZ: pz,
      x: px,
      y: -L,
      z: pz,
      vx: 0,
      vy: 0,
      vz: 0,
      length: L,
      width: ROD_WIDTHS[i],
      pitchIdx: ROD_PITCHES[i],
      mass: PHY.rodMass,
      radius: PHY.rodRadius,
      glow: 0,
      lastStrikeMs: 0,
    });
  }
  pendulum = {
    idx: -1,
    isPendulum: true,
    pivotX: 0,
    pivotY: 0,
    pivotZ: 0,
    x: 0,
    y: -PHY.penLength,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    length: PHY.penLength,
    width: 0,
    mass: PHY.penMass,
    radius: PHY.penRadius,
    glow: 0,
    lastStrikeMs: 0,
  };
}

function createImpulse(audioContext, seconds = 3.2) {
  const length = Math.floor(audioContext.sampleRate * seconds);
  const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const fade = Math.pow(1 - i / length, 2.5);
      data[i] = (Math.random() * 2 - 1) * fade;
    }
  }
  return impulse;
}

function ensureAudio() {
  if (state.audioContext) return state.audioContext;
  const AudioCtx = window.AudioContext || window["webkitAudioContext"];
  if (!AudioCtx) {
    updateStatus("Audio is not available here.");
    return null;
  }
  const audioContext = new AudioCtx();
  const masterGain = audioContext.createGain();
  const dryGain = audioContext.createGain();
  const wetGain = audioContext.createGain();
  const convolver = audioContext.createConvolver();
  const compressor = audioContext.createDynamicsCompressor();

  convolver.buffer = createImpulse(audioContext);
  masterGain.gain.value = state.volume;
  dryGain.gain.value = 0.82;
  wetGain.gain.value = 0.26;
  compressor.threshold.value = -18;
  compressor.knee.value = 22;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.28;

  masterGain.connect(dryGain);
  masterGain.connect(convolver);
  convolver.connect(wetGain);
  dryGain.connect(compressor);
  wetGain.connect(compressor);
  compressor.connect(audioContext.destination);

  state.audioContext = audioContext;
  state.masterGain = masterGain;
  state.convolver = convolver;
  state.dryGain = dryGain;
  state.wetGain = wetGain;
  return audioContext;
}

async function resumeAudio() {
  const audioContext = ensureAudio();
  if (!audioContext) return false;
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  return audioContext.state === "running";
}

function createPanner(pan) {
  const audioContext = state.audioContext;
  if (audioContext.createStereoPanner) {
    const p = audioContext.createStereoPanner();
    p.pan.value = pan;
    return p;
  }
  return audioContext.createGain();
}

function panForRod(rod) {
  const normX = rod.pivotX / PHY.ringR;
  return Math.max(-0.8, Math.min(0.8, normX * 0.8));
}

function strikeRod(rod, intensity) {
  const audioContext = state.audioContext;
  if (!audioContext || !state.masterGain) return;

  if (state.activeStrikes.length >= MAX_ACTIVE_STRIKES) {
    const oldest = state.activeStrikes.shift();
    if (oldest) {
      const cutTime = audioContext.currentTime;
      try {
        oldest.hitGain.gain.cancelScheduledValues(cutTime);
        const v = Math.max(0.0001, oldest.hitGain.gain.value);
        oldest.hitGain.gain.setValueAtTime(v, cutTime);
        oldest.hitGain.gain.exponentialRampToValueAtTime(0.0001, cutTime + 0.05);
      } catch {}
      oldest.oscillators.forEach((o) => {
        try {
          o.stop(cutTime + 0.07);
        } catch {}
      });
    }
  }

  const now = audioContext.currentTime;
  const keyNotes = (KEYS[state.key] || KEYS.pentatonic).notes;
  const base = keyNotes[rod.pitchIdx % keyNotes.length] * (0.985 + Math.random() * 0.03);
  const panner = createPanner(panForRod(rod));
  const hitGain = audioContext.createGain();
  const sustain = state.sustain;

  const partials = [
    { ratio: 1, gain: 0.58, decayFrac: 1.0 },
    { ratio: 2.03, gain: 0.22, decayFrac: 0.62 },
    { ratio: 2.71, gain: 0.16, decayFrac: 0.42 },
    { ratio: 4.18, gain: 0.09, decayFrac: 0.3 },
    { ratio: 5.43, gain: 0.06, decayFrac: 0.22 },
  ];

  hitGain.gain.setValueAtTime(0.0001, now);
  hitGain.gain.linearRampToValueAtTime(0.55 * intensity, now + 0.015);
  hitGain.gain.exponentialRampToValueAtTime(0.0001, now + sustain + 0.25);
  hitGain.connect(panner);
  panner.connect(state.masterGain);

  const strike = { hitGain, oscillators: [] };
  state.activeStrikes.push(strike);
  let alive = partials.length;
  const onOscEnded = () => {
    alive -= 1;
    if (alive <= 0) {
      const idx = state.activeStrikes.indexOf(strike);
      if (idx !== -1) state.activeStrikes.splice(idx, 1);
    }
  };

  partials.forEach((partial, index) => {
    const osc = audioContext.createOscillator();
    const partialGain = audioContext.createGain();
    const detune = (Math.random() - 0.5) * 9;
    osc.type = "sine";
    osc.frequency.setValueAtTime(base * partial.ratio, now);
    osc.detune.setValueAtTime(detune, now);
    const partialDecay = Math.max(0.4, sustain * partial.decayFrac);
    partialGain.gain.setValueAtTime(partial.gain, now);
    partialGain.gain.exponentialRampToValueAtTime(0.0001, now + partialDecay);
    osc.connect(partialGain);
    partialGain.connect(hitGain);
    osc.start(now + index * 0.002);
    osc.stop(now + partialDecay + 0.1);
    osc.onended = onOscEnded;
    strike.oscillators.push(osc);
  });

  const noise = audioContext.createBufferSource();
  const noiseBuffer = audioContext.createBuffer(
    1,
    Math.floor(audioContext.sampleRate * 0.08),
    audioContext.sampleRate
  );
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i += 1) {
    const fade = 1 - i / noiseData.length;
    noiseData[i] = (Math.random() * 2 - 1) * fade;
  }
  const filter = audioContext.createBiquadFilter();
  const noiseGain = audioContext.createGain();
  noise.buffer = noiseBuffer;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(base * 5.5, now);
  filter.Q.value = 7;
  noiseGain.gain.setValueAtTime(0.045 * intensity, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(hitGain);
  noise.start(now);
  noise.stop(now + 0.09);

  rod.glow = Math.max(rod.glow, Math.min(1, intensity));
}

function applyForce(body, fx, fy, fz, dt) {
  body.vx += (fx / body.mass) * dt;
  body.vy += (fy / body.mass) * dt;
  body.vz += (fz / body.mass) * dt;
}

function integrateBody(body, dt) {
  body.vy -= PHY.gravity * dt;

  const damp = body.isPendulum ? PHY.penDamping : PHY.rodDamping;
  const dampFactor = Math.max(0, 1 - damp * dt);
  body.vx *= dampFactor;
  body.vy *= dampFactor;
  body.vz *= dampFactor;

  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.z += body.vz * dt;

  const dx = body.x - body.pivotX;
  const dy = body.y - body.pivotY;
  const dz = body.z - body.pivotZ;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > 0.0001) {
    const ratio = body.length / dist;
    body.x = body.pivotX + dx * ratio;
    body.y = body.pivotY + dy * ratio;
    body.z = body.pivotZ + dz * ratio;
    const rx = dx / dist;
    const ry = dy / dist;
    const rz = dz / dist;
    const vAlong = body.vx * rx + body.vy * ry + body.vz * rz;
    body.vx -= vAlong * rx;
    body.vy -= vAlong * ry;
    body.vz -= vAlong * rz;
  }
}

function resolveCollision(a, b, nowMs) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let dist = Math.sqrt(dx * dx + dz * dz);
  const minDist = a.radius + b.radius;
  if (dist >= minDist) return;
  if (dist < 0.0001) return;
  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = minDist - dist;
  const invMassA = 1 / a.mass;
  const invMassB = 1 / b.mass;
  const totalInv = invMassA + invMassB;
  const aShare = invMassA / totalInv;
  const bShare = invMassB / totalInv;
  a.x -= nx * overlap * aShare;
  a.z -= nz * overlap * aShare;
  b.x += nx * overlap * bShare;
  b.z += nz * overlap * bShare;

  const rvx = b.vx - a.vx;
  const rvz = b.vz - a.vz;
  const velAlongNormal = rvx * nx + rvz * nz;
  if (velAlongNormal > 0) return;

  const j = -(1 + PHY.restitution) * velAlongNormal / totalInv;
  a.vx -= j * nx * invMassA;
  a.vz -= j * nz * invMassA;
  b.vx += j * nx * invMassB;
  b.vz += j * nz * invMassB;

  const impulseMag = Math.abs(j);
  if (impulseMag < PHY.collisionMinImpulse) return;
  const norm = Math.min(1.0, impulseMag * PHY.collisionImpulseToIntensity);
  const intensity = Math.max(0.05, Math.pow(norm, 0.7));
  if (!a.isPendulum && nowMs - a.lastStrikeMs > PHY.collisionDebounceMs) {
    a.lastStrikeMs = nowMs;
    strikeRod(a, intensity);
  }
  if (!b.isPendulum && nowMs - b.lastStrikeMs > PHY.collisionDebounceMs) {
    b.lastStrikeMs = nowMs;
    strikeRod(b, intensity);
  }
}

function resolveDiscCollision(pen, rod, nowMs) {
  const f = PHY.discFraction;
  const discX = pen.pivotX + (pen.x - pen.pivotX) * f;
  const discZ = pen.pivotZ + (pen.z - pen.pivotZ) * f;
  const discVx = pen.vx * f;
  const discVz = pen.vz * f;

  const dx = rod.x - discX;
  const dz = rod.z - discZ;
  let dist = Math.sqrt(dx * dx + dz * dz);
  const minDist = PHY.discRadius + rod.radius;
  if (dist >= minDist) return;
  if (dist < 0.0001) return;

  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = minDist - dist;

  const invMassDisc = (f * f) / pen.mass;
  const invMassRod = 1 / rod.mass;
  const totalInv = invMassDisc + invMassRod;
  const discShare = invMassDisc / totalInv;
  const rodShare = invMassRod / totalInv;

  pen.x -= (nx * overlap * discShare) / f;
  pen.z -= (nz * overlap * discShare) / f;
  rod.x += nx * overlap * rodShare;
  rod.z += nz * overlap * rodShare;

  const rvx = rod.vx - discVx;
  const rvz = rod.vz - discVz;
  const velAlongNormal = rvx * nx + rvz * nz;
  if (velAlongNormal > 0) return;

  const j = -(1 + PHY.restitution) * velAlongNormal / totalInv;

  pen.vx -= (j * nx * invMassDisc) / f;
  pen.vz -= (j * nz * invMassDisc) / f;
  rod.vx += j * nx * invMassRod;
  rod.vz += j * nz * invMassRod;

  const impulseMag = Math.abs(j);
  if (impulseMag < PHY.collisionMinImpulse) return;
  const norm = Math.min(1.0, impulseMag * PHY.collisionImpulseToIntensity);
  const intensity = Math.max(0.05, Math.pow(norm, 0.7));
  if (nowMs - rod.lastStrikeMs > PHY.collisionDebounceMs) {
    rod.lastStrikeMs = nowMs;
    strikeRod(rod, intensity);
  }
}

function noise1(t, seed) {
  return (
    Math.sin(t + seed) * 0.5 +
    Math.sin(t * 2.13 + seed * 1.3) * 0.3 +
    Math.sin(t * 4.71 + seed * 2.7) * 0.2
  );
}

function physicsStep(dt, nowMs) {
  const sens = state.sensitivity;
  const motionFx = state.motionAx * sens * PHY.motionForceScale;
  const motionFz = state.motionAz * sens * PHY.motionForceScale;
  applyForce(pendulum, motionFx, 0, motionFz, dt);

  const tSec = nowMs / 1000;
  const idleFx = noise1(tSec * 0.31, 1.3) * PHY.idleSwayForce;
  const idleFz = noise1(tSec * 0.37, 2.7) * PHY.idleSwayForce;
  applyForce(pendulum, idleFx, 0, idleFz, dt);

  if (state.breeze) {
    const gust = Math.pow(Math.max(0, noise1(tSec * 0.09, 11.3)), 2.4) * PHY.breezeGustPeak;
    const penDirX = noise1(tSec * 0.42, 5.1);
    const penDirZ = noise1(tSec * 0.51, 7.3);
    const penForce = gust * PHY.breezeForcePendulum;
    applyForce(pendulum, penDirX * penForce, 0, penDirZ * penForce, dt);

    for (let i = 0; i < rods.length; i += 1) {
      const offset = i * 1.7;
      const rodGust =
        Math.pow(Math.max(0, noise1(tSec * 0.09 + offset * 0.3, offset + 11.7)), 2.4) *
        PHY.breezeGustPeak;
      const dx = noise1(tSec * 0.34 + offset, offset + 1.1);
      const dz = noise1(tSec * 0.41 + offset, offset + 3.3);
      const f = rodGust * PHY.breezeForceRod;
      applyForce(rods[i], dx * f, 0, dz * f, dt);
    }
  }

  integrateBody(pendulum, dt);
  for (let i = 0; i < rods.length; i += 1) {
    integrateBody(rods[i], dt);
  }

  for (let i = 0; i < rods.length; i += 1) {
    resolveDiscCollision(pendulum, rods[i], nowMs);
  }
  for (let i = 0; i < rods.length; i += 1) {
    for (let j = i + 1; j < rods.length; j += 1) {
      resolveCollision(rods[i], rods[j], nowMs);
    }
  }
}

function handleMotion(event) {
  const ag = event.accelerationIncludingGravity;
  const acc = event.acceleration;
  let ax, az;
  if (acc && (acc.x !== null || acc.y !== null || acc.z !== null)) {
    ax = safeNumber(acc.x);
    az = safeNumber(acc.z);
  } else if (ag) {
    const rawX = safeNumber(ag.x);
    const rawY = safeNumber(ag.y);
    const rawZ = safeNumber(ag.z);
    if (!state.motionBaseInit) {
      state.motionBaseX = rawX;
      state.motionBaseY = rawY;
      state.motionBaseZ = rawZ;
      state.motionBaseInit = true;
    }
    ax = rawX - state.motionBaseX;
    az = rawZ - state.motionBaseZ;
    state.motionBaseX += (rawX - state.motionBaseX) * 0.04;
    state.motionBaseY += (rawY - state.motionBaseY) * 0.04;
    state.motionBaseZ += (rawZ - state.motionBaseZ) * 0.04;
  } else {
    return;
  }

  state.motionAx = state.motionAx * 0.62 + ax * 0.38;
  state.motionAz = state.motionAz * 0.62 + az * 0.38;

  const mag = Math.min(1, Math.hypot(state.motionAx, state.motionAz) / 10);
  if (mag > state.motionEnergy) state.motionEnergy = mag;
}

async function requestMotion() {
  if (!("DeviceMotionEvent" in window)) {
    updateStatus("Motion is not available here.");
    return false;
  }
  try {
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== "granted") {
        updateStatus("Motion permission was not granted.");
        return false;
      }
    }
  } catch {
    updateStatus("Motion needs a secure browser page.");
    return false;
  }
  window.removeEventListener("devicemotion", handleMotion);
  window.addEventListener("devicemotion", handleMotion, { passive: true });
  state.motionReady = true;
  updateStatus("Ready.");
  return true;
}

async function startApp() {
  updateStatus("Waking...");
  const audioReady = await resumeAudio();
  if (!audioReady) {
    updateStatus("Audio could not start.");
    return;
  }
  const motionReady = await requestMotion();
  state.started = true;
  startButton.textContent = motionReady ? "Awake" : "Wake";
  startButton.disabled = motionReady;
  const welcomeRod = rods[Math.floor(Math.random() * rods.length)];
  strikeRod(welcomeRod, 0.4);
}

function testKick() {
  const angle = Math.random() * Math.PI * 2;
  const disp = PHY.testInitialDisp + Math.random() * 16;
  const vel = PHY.testImpulse * (0.85 + Math.random() * 0.35);
  const spin = Math.random() < 0.5 ? -1 : 1;
  pendulum.x = pendulum.pivotX + Math.cos(angle) * disp;
  pendulum.z = pendulum.pivotZ + Math.sin(angle) * disp;
  pendulum.vx = -Math.sin(angle) * vel * spin;
  pendulum.vz = Math.cos(angle) * vel * spin;
  pendulum.vy = 0;
  state.motionEnergy = Math.max(state.motionEnergy, 0.6);
}

function getLayout() {
  const w = state.width;
  const h = state.height;
  const cx = w * 0.5;
  const cyTop = Math.max(96, Math.min(160, h * 0.2));
  const foreshorten = 0.32;
  const ringRyScreen = PHY.ringR * foreshorten;
  const sizeScale = Math.max(0.78, Math.min(1, h / 760));
  return { w, h, cx, cyTop, foreshorten, ringRyScreen, sizeScale };
}

function project(x, y, z, layout) {
  return {
    sx: layout.cx + x,
    sy: layout.cyTop + (-y) + z * layout.foreshorten,
  };
}

function rodDepthScale(rod) {
  const dz = rod.pivotZ / PHY.ringR;
  return 0.86 + 0.14 * ((dz + 1) / 2);
}

function drawCylinder(ctx, topX, topY, botX, botY, radius, visibility, opts) {
  const dx = botX - topX;
  const dy = botY - topY;
  const L = Math.hypot(dx, dy);
  if (L < 0.001) return;
  const axisAngle = Math.atan2(dy, dx);

  ctx.save();
  ctx.translate(topX, topY);
  ctx.rotate(axisAngle - Math.PI / 2);

  const radMajor = radius;
  const radMinor = radius * visibility;

  if (opts.side) {
    if (opts.shadow) {
      ctx.shadowColor = opts.shadow.color;
      ctx.shadowBlur = opts.shadow.blur;
      ctx.shadowOffsetX = opts.shadow.offsetX || 0;
      ctx.shadowOffsetY = opts.shadow.offsetY || 0;
    }
    ctx.fillStyle = opts.side(radMajor, radMinor, L);
    ctx.beginPath();
    ctx.moveTo(-radMajor, 0);
    ctx.lineTo(-radMajor, L);
    ctx.ellipse(0, L, radMajor, radMinor, 0, Math.PI, 0, true);
    ctx.lineTo(radMajor, 0);
    ctx.ellipse(0, 0, radMajor, radMinor, 0, 0, Math.PI, false);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = "transparent";
  }

  if (opts.top) {
    ctx.fillStyle = opts.top(radMajor, radMinor, L);
    ctx.beginPath();
    ctx.ellipse(0, 0, radMajor, radMinor, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (opts.topRim) {
    ctx.strokeStyle = opts.topRim;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.ellipse(0, 0, radMajor - 0.3, Math.max(0.3, radMinor - 0.2), 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  if (opts.highlightStripe) {
    ctx.save();
    ctx.globalAlpha = opts.highlightStripe.alpha || 0.5;
    ctx.strokeStyle = opts.highlightStripe.color || "rgba(255, 255, 255, 0.8)";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.5, radMajor * 0.4);
    const inset = 0.1;
    const off = radMajor * 0.35;
    ctx.beginPath();
    ctx.moveTo(-off, L * inset);
    ctx.lineTo(-off, L * (1 - inset));
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function drawBackground(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#e4f5f4");
  sky.addColorStop(0.48, "#f8fbfb");
  sky.addColorStop(1, "#ffdcca");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = "#9fcac8";
  ctx.lineWidth = 1;
  for (let line = 0; line < 8; line += 1) {
    const y = h * (0.16 + line * 0.075);
    ctx.beginPath();
    ctx.moveTo(-40, y);
    ctx.bezierCurveTo(w * 0.25, y - 28, w * 0.5, y + 26, w + 40, y - 8);
    ctx.stroke();
  }
  ctx.restore();

  const floor = ctx.createLinearGradient(0, h * 0.72, 0, h);
  floor.addColorStop(0, "rgba(81, 139, 128, 0)");
  floor.addColorStop(1, "rgba(81, 139, 128, 0.23)");
  ctx.fillStyle = floor;
  ctx.fillRect(0, h * 0.68, w, h * 0.32);
}

function drawCord(ctx, layout, time) {
  const { cx, cyTop } = layout;
  const t = time / 1000;
  const swayX = Math.sin(t * 0.6) * 3;
  ctx.save();
  ctx.strokeStyle = "rgba(72, 87, 86, 0.62)";
  ctx.lineCap = "round";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx + swayX * 1.4, -16);
  ctx.bezierCurveTo(
    cx + swayX * 0.6,
    cyTop * 0.35,
    cx + swayX * 0.2,
    cyTop * 0.7,
    cx,
    cyTop - 6
  );
  ctx.stroke();
  ctx.restore();
}

function drawTopRing(ctx, layout) {
  const { cx, cyTop } = layout;
  const ringR = PHY.ringR;
  const ringThickness = 22;
  const ringHeight = 10;
  const outerR = ringR + ringThickness * 0.5;
  const innerR = ringR - ringThickness * 0.5;
  const fs = layout.foreshorten;
  const outerRy = outerR * fs;
  const innerRy = innerR * fs;
  const cyBot = cyTop + ringHeight;

  ctx.save();
  ctx.shadowColor = "rgba(18, 34, 42, 0.32)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 8;

  const innerSideGrad = ctx.createLinearGradient(cx - innerR, cyTop, cx + innerR, cyTop);
  innerSideGrad.addColorStop(0, "#26160c");
  innerSideGrad.addColorStop(0.5, "#5c3c22");
  innerSideGrad.addColorStop(1, "#26160c");
  ctx.fillStyle = innerSideGrad;
  ctx.beginPath();
  ctx.moveTo(cx + innerR, cyTop);
  ctx.ellipse(cx, cyTop, innerR, innerRy, 0, 0, Math.PI, true);
  ctx.lineTo(cx - innerR, cyBot);
  ctx.ellipse(cx, cyBot, innerR, innerRy, 0, Math.PI, 0, false);
  ctx.closePath();
  ctx.fill();

  const outerSideGrad = ctx.createLinearGradient(cx - outerR, cyTop, cx + outerR, cyTop);
  outerSideGrad.addColorStop(0, "#3a2515");
  outerSideGrad.addColorStop(0.5, "#8c5d38");
  outerSideGrad.addColorStop(1, "#3a2515");
  ctx.fillStyle = outerSideGrad;
  ctx.beginPath();
  ctx.moveTo(cx - outerR, cyTop);
  ctx.lineTo(cx - outerR, cyBot);
  ctx.ellipse(cx, cyBot, outerR, outerRy, 0, Math.PI, 0, true);
  ctx.lineTo(cx + outerR, cyTop);
  ctx.ellipse(cx, cyTop, outerR, outerRy, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fill();

  ctx.shadowColor = "transparent";

  const topGrad = ctx.createRadialGradient(
    cx - outerR * 0.25,
    cyTop - outerRy * 0.6,
    outerR * 0.1,
    cx,
    cyTop,
    outerR * 1.1
  );
  topGrad.addColorStop(0, "#d4a577");
  topGrad.addColorStop(0.5, "#9c6f46");
  topGrad.addColorStop(1, "#5a3c25");
  ctx.fillStyle = topGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cyTop, outerR, outerRy, 0, 0, Math.PI * 2);
  ctx.ellipse(cx, cyTop, innerR, innerRy, 0, 0, Math.PI * 2);
  ctx.fill("evenodd");
  ctx.restore();

  ctx.strokeStyle = "rgba(48, 32, 20, 0.6)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(cx, cyTop + 0.5, innerR, innerRy, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 232, 200, 0.45)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(cx, cyTop - 0.5, outerR, outerRy, 0, Math.PI * 1.05, Math.PI * 1.95, false);
  ctx.stroke();

  ctx.strokeStyle = "rgba(36, 22, 14, 0.6)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(cx, cyBot, outerR, outerRy, 0, 0.05 * Math.PI, 0.95 * Math.PI, false);
  ctx.stroke();
}

function drawRod(ctx, layout, rod) {
  const depth = rodDepthScale(rod);
  const rodWidth = rod.width * depth;
  const tubeR = rodWidth * 0.5;
  const stringDrop = 22;

  const cdx = rod.x - rod.pivotX;
  const cdy = rod.y - rod.pivotY;
  const cdz = rod.z - rod.pivotZ;
  const cordLen = Math.hypot(cdx, cdy, cdz) || 1;
  const t = stringDrop / cordLen;
  const vtxW = rod.pivotX + cdx * t;
  const vtyW = rod.pivotY + cdy * t;
  const vtzW = rod.pivotZ + cdz * t;

  const anchor = project(rod.pivotX, rod.pivotY, rod.pivotZ, layout);
  const visualTop = project(vtxW, vtyW, vtzW, layout);
  const bob = project(rod.x, rod.y, rod.z, layout);

  const fs = layout.foreshorten;
  const viewMag = Math.sqrt(1 + fs * fs);
  const vy = fs / viewMag;
  const vz = 1 / viewMag;
  const ny = -cdy / cordLen;
  const nz = -cdz / cordLen;
  const dotv = ny * vy + nz * vz;
  const visibility = Math.max(0.05, Math.abs(dotv));

  ctx.save();
  ctx.strokeStyle = "rgba(63, 74, 76, 0.65)";
  ctx.lineCap = "round";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(anchor.sx, anchor.sy);
  ctx.lineTo(visualTop.sx, visualTop.sy);
  ctx.stroke();
  ctx.restore();

  const depthN = (depth - 0.86) / 0.14;
  const coolBack = 1 - depthN;
  const darkR = Math.round(150 - coolBack * 18);
  const darkG = Math.round(164 - coolBack * 12);
  const darkB = Math.round(170 + coolBack * 12);

  const shadow = rod.glow > 0.02
    ? {
        color: `rgba(220, 169, 74, ${0.65 + rod.glow * 0.3})`,
        blur: 8 + rod.glow * 22,
        offsetX: 2 + depthN * 2,
        offsetY: 4 + depthN * 3,
      }
    : {
        color: `rgba(18, 34, 42, ${0.14 + depthN * 0.12})`,
        blur: 4 + depthN * 4,
        offsetX: 2 + depthN * 2,
        offsetY: 4 + depthN * 3,
      };

  drawCylinder(ctx, visualTop.sx, visualTop.sy, bob.sx, bob.sy, tubeR, visibility, {
    shadow,
    side: (rMajor) => {
      const g = ctx.createLinearGradient(-rMajor, 0, rMajor, 0);
      g.addColorStop(0, `rgb(${darkR}, ${darkG}, ${darkB})`);
      g.addColorStop(0.35, "#f7fbfb");
      g.addColorStop(0.56, "#bcc8cb");
      g.addColorStop(1, "#6c7e84");
      return g;
    },
    top: (rMajor, rMinor) => {
      const g = ctx.createRadialGradient(
        0,
        -rMinor * 0.55,
        rMajor * 0.08,
        0,
        rMinor * 0.2,
        rMajor
      );
      g.addColorStop(0, "rgb(8, 14, 18)");
      g.addColorStop(0.65, "rgb(26, 36, 42)");
      g.addColorStop(1, "rgb(56, 70, 76)");
      return g;
    },
    topRim: "rgba(220, 232, 236, 0.55)",
    highlightStripe: {
      alpha: 0.45 + rod.glow * 0.35,
      color: "rgba(255, 255, 255, 0.85)",
    },
  });
}

function drawPendulum(ctx, layout) {
  const { sizeScale } = layout;
  const f = PHY.discFraction;

  const anchor = project(pendulum.pivotX, pendulum.pivotY, pendulum.pivotZ, layout);
  const bob = project(pendulum.x, pendulum.y, pendulum.z, layout);
  const discWorldX = pendulum.pivotX + (pendulum.x - pendulum.pivotX) * f;
  const discWorldY = pendulum.pivotY + (pendulum.y - pendulum.pivotY) * f;
  const discWorldZ = pendulum.pivotZ + (pendulum.z - pendulum.pivotZ) * f;
  const disc = project(discWorldX, discWorldY, discWorldZ, layout);

  const ax = anchor.sx;
  const ay = anchor.sy;
  const bx = bob.sx;
  const by = bob.sy;
  const dx = disc.sx;
  const dy = disc.sy;

  const cordX = pendulum.x - pendulum.pivotX;
  const cordY = pendulum.y - pendulum.pivotY;
  const cordZ = pendulum.z - pendulum.pivotZ;
  const cordLen = Math.hypot(cordX, cordY, cordZ) || 1;
  const nx = -cordX / cordLen;
  const ny = -cordY / cordLen;
  const nz = -cordZ / cordLen;
  const fs = layout.foreshorten;
  const viewMag = Math.sqrt(1 + fs * fs);
  const vy = fs / viewMag;
  const vz = 1 / viewMag;
  const ndotv = ny * vy + nz * vz;
  const visibility = Math.max(0.05, Math.abs(ndotv));
  const screenNx = nx;
  const screenNy = -ny + nz * fs;
  const screenNlen = Math.hypot(screenNx, screenNy);
  const rotation =
    screenNlen > 0.001 ? Math.atan2(screenNy, screenNx) + Math.PI / 2 : 0;

  const radMajor = PHY.discRadius * sizeScale;
  const radMinor = radMajor * visibility;
  const thickness = 5 * sizeScale;
  const rimOffset = thickness * Math.sqrt(1 - visibility * visibility);
  const wR = PHY.bottomWeightRadius * sizeScale;

  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const botEdgeX = dx - (rimOffset + radMinor) * sinR;
  const botEdgeY = dy + (rimOffset + radMinor) * cosR;

  ctx.save();
  ctx.translate(dx, dy);
  ctx.rotate(rotation);

  ctx.fillStyle = "rgba(18, 34, 42, 0.2)";
  ctx.beginPath();
  ctx.ellipse(0, rimOffset + 3, radMajor * 1.06, radMinor * 1.18, 0, 0, Math.PI * 2);
  ctx.fill();

  const rimGrad = ctx.createLinearGradient(-radMajor, 0, radMajor, 0);
  rimGrad.addColorStop(0, "#4a3020");
  rimGrad.addColorStop(0.5, "#7d4f30");
  rimGrad.addColorStop(1, "#4a3020");
  ctx.fillStyle = rimGrad;
  ctx.beginPath();
  ctx.ellipse(0, rimOffset, radMajor, radMinor, 0, 0, Math.PI * 2);
  ctx.fill();

  if (rimOffset > 0.5) {
    const sideGrad = ctx.createLinearGradient(-radMajor, 0, radMajor, 0);
    sideGrad.addColorStop(0, "#3a2515");
    sideGrad.addColorStop(0.5, "#8a5d3a");
    sideGrad.addColorStop(1, "#3a2515");
    ctx.fillStyle = sideGrad;
    ctx.beginPath();
    ctx.moveTo(-radMajor, 0);
    ctx.lineTo(-radMajor, rimOffset);
    ctx.ellipse(0, rimOffset, radMajor, radMinor, 0, Math.PI, 0, true);
    ctx.lineTo(radMajor, 0);
    ctx.ellipse(0, 0, radMajor, radMinor, 0, 0, Math.PI, false);
    ctx.closePath();
    ctx.fill();
  }

  const lightSign = ndotv >= 0 ? -1 : 1;
  const topGrad = ctx.createRadialGradient(
    -radMajor * 0.35,
    lightSign * radMinor * 0.55,
    radMajor * 0.08,
    0,
    0,
    radMajor
  );
  topGrad.addColorStop(0, "#ecb78d");
  topGrad.addColorStop(0.45, "#b88158");
  topGrad.addColorStop(1, "#7a4d2c");
  ctx.fillStyle = topGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, radMajor, radMinor, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 232, 200, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(
    0,
    lightSign * 1.1,
    radMajor - 1,
    Math.max(0.5, radMinor - 0.8),
    0,
    0,
    Math.PI * 2
  );
  ctx.stroke();

  if (radMinor > 2) {
    ctx.strokeStyle = "rgba(48, 32, 20, 0.32)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, radMajor * 0.62, radMinor * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(63, 74, 76, 0.65)";
  ctx.lineCap = "round";
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(dx, dy);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(63, 74, 76, 0.65)";
  ctx.lineCap = "round";
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(botEdgeX, botEdgeY);
  ctx.lineTo(bx, by - wR * 0.65);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(18, 34, 42, 0.4)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 5;
  ctx.shadowOffsetY = 9;
  const wGrad = ctx.createRadialGradient(bx - wR * 0.4, by - wR * 0.45, wR * 0.18, bx, by, wR);
  wGrad.addColorStop(0, "#f0c089");
  wGrad.addColorStop(0.55, "#d97962");
  wGrad.addColorStop(1, "#9c4736");
  ctx.fillStyle = wGrad;
  ctx.beginPath();
  ctx.arc(bx, by, wR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.beginPath();
  ctx.arc(bx - wR * 0.35, by - wR * 0.4, wR * 0.28, 0, Math.PI * 2);
  ctx.fill();

}

function render(time) {
  const ctx = ctx2d;
  const w = state.width;
  const h = state.height;
  const layout = getLayout();

  drawBackground(ctx, w, h);
  drawCord(ctx, layout, time);

  const drawList = rods.slice();
  drawList.push(pendulum);
  drawList.sort((a, b) => a.pivotZ - b.pivotZ);
  for (let i = 0; i < drawList.length; i += 1) {
    const body = drawList[i];
    if (body.isPendulum) drawPendulum(ctx, layout);
    else drawRod(ctx, layout, body);
  }

  drawTopRing(ctx, layout);

  for (let i = 0; i < rods.length; i += 1) {
    rods[i].glow *= 0.91;
    if (rods[i].glow < 0.005) rods[i].glow = 0;
  }

  let meterVal = state.motionEnergy;
  if (state.breeze) {
    const breezeBase = 0.16 + Math.abs(noise1(time / 1000 * 0.4, 9.1)) * 0.14;
    if (breezeBase > meterVal) meterVal = breezeBase;
  }
  motionMeter.style.width = `${Math.round(Math.min(1, meterVal) * 100)}%`;
  state.motionEnergy *= 0.92;
  if (state.motionEnergy < 0.002) state.motionEnergy = 0;
}

function tick(time) {
  if (state.lastFrameMs === null) state.lastFrameMs = time;
  let frameDt = (time - state.lastFrameMs) / 1000;
  state.lastFrameMs = time;
  if (frameDt > 0.05) frameDt = 0.05;

  state.physAccum += frameDt;
  let steps = 0;
  while (state.physAccum >= PHY_STEP && steps < PHY_MAX_STEPS_PER_FRAME) {
    physicsStep(PHY_STEP, time);
    state.physAccum -= PHY_STEP;
    steps += 1;
  }
  if (state.physAccum > PHY_STEP * PHY_MAX_STEPS_PER_FRAME) {
    state.physAccum = 0;
  }

  render(time);
  requestAnimationFrame(tick);
}

volumeControl.addEventListener("input", () => {
  state.volume = Number(volumeControl.value);
  writeStorage(STORAGE.volume, state.volume);
  if (state.masterGain) {
    state.masterGain.gain.setTargetAtTime(state.volume, state.audioContext.currentTime, 0.04);
  }
});

sensitivityControl.addEventListener("input", () => {
  state.sensitivity = Number(sensitivityControl.value);
  writeStorage(STORAGE.sensitivity, state.sensitivity);
});

sustainControl.addEventListener("input", () => {
  state.sustain = Number(sustainControl.value);
  writeStorage(STORAGE.sustain, state.sustain);
});

breezeToggle.addEventListener("change", () => {
  state.breeze = breezeToggle.checked;
  writeStorage(STORAGE.breeze, state.breeze);
});

if (keyControl) {
  keyControl.addEventListener("change", () => {
    const v = keyControl.value;
    if (KEYS[v]) {
      state.key = v;
      writeStorage(STORAGE.key, v);
    }
  });
}

startButton.addEventListener("click", startApp);

testButton.addEventListener("click", async () => {
  const audioReady = await resumeAudio();
  if (!audioReady) return;
  state.started = true;
  testKick();
});

window.addEventListener("resize", resizeCanvas);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  }).catch(() => {});
}
if ("caches" in window) {
  caches.keys().then((keys) => {
    keys.forEach((k) => caches.delete(k));
  }).catch(() => {});
}

applyPersistedSettings();
resizeCanvas();
buildBodies();
requestAnimationFrame(tick);
