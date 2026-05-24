const canvas = document.querySelector("#scene");
const context = canvas.getContext("2d");
const startButton = document.querySelector("#startButton");
const testButton = document.querySelector("#testButton");
const statusText = document.querySelector("#statusText");
const volumeControl = document.querySelector("#volumeControl");
const sensitivityControl = document.querySelector("#sensitivityControl");
const motionMeter = document.querySelector("#motionMeter");

const state = {
  audioContext: null,
  masterGain: null,
  convolver: null,
  dryGain: null,
  wetGain: null,
  started: false,
  motionReady: false,
  lastMagnitude: null,
  lastStrike: 0,
  energy: 0,
  volume: Number(volumeControl.value),
  sensitivity: Number(sensitivityControl.value),
  width: 0,
  height: 0,
  dpr: 1,
  sparks: [],
};

const notes = [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1174.66, 1318.51];
const rods = [
  { pitch: 0, length: 184, width: 20, phase: 0.1, glow: 0 },
  { pitch: 2, length: 226, width: 18, phase: 1.2, glow: 0 },
  { pitch: 4, length: 204, width: 22, phase: 2.1, glow: 0 },
  { pitch: 7, length: 252, width: 19, phase: 3.2, glow: 0 },
  { pitch: 1, length: 172, width: 17, phase: 4.0, glow: 0 },
  { pitch: 5, length: 216, width: 21, phase: 4.9, glow: 0 },
  { pitch: 3, length: 192, width: 18, phase: 5.7, glow: 0 },
];

const safeNumber = (value) => (Number.isFinite(value) ? value : 0);

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  state.width = rect.width;
  state.height = rect.height;
  state.dpr = dpr;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function updateStatus(message) {
  statusText.textContent = message;
}

function createImpulse(audioContext) {
  const seconds = 3.2;
  const length = Math.floor(audioContext.sampleRate * seconds);
  const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const fade = Math.pow(1 - index / length, 2.5);
      data[index] = (Math.random() * 2 - 1) * fade;
    }
  }

  return impulse;
}

function ensureAudio() {
  if (state.audioContext) {
    return state.audioContext;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    updateStatus("Audio is not available here.");
    return null;
  }

  const audioContext = new AudioContextClass();
  const masterGain = audioContext.createGain();
  const dryGain = audioContext.createGain();
  const wetGain = audioContext.createGain();
  const convolver = audioContext.createConvolver();
  const compressor = audioContext.createDynamicsCompressor();

  convolver.buffer = createImpulse(audioContext);
  masterGain.gain.value = state.volume;
  dryGain.gain.value = 0.82;
  wetGain.gain.value = 0.24;
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
  if (!audioContext) {
    return false;
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return audioContext.state === "running";
}

function createPanner(pan) {
  const audioContext = state.audioContext;
  if (audioContext.createStereoPanner) {
    const panner = audioContext.createStereoPanner();
    panner.pan.value = pan;
    return panner;
  }

  return audioContext.createGain();
}

function strikeRod(rodIndex, intensity = 0.8, delay = 0) {
  const audioContext = state.audioContext;
  if (!audioContext || !state.masterGain) {
    return;
  }

  const rod = rods[rodIndex % rods.length];
  const now = audioContext.currentTime + delay;
  const base = notes[rod.pitch % notes.length] * (0.985 + Math.random() * 0.03);
  const pan = ((rodIndex / Math.max(1, rods.length - 1)) * 2 - 1) * 0.72;
  const panner = createPanner(pan);
  const hitGain = audioContext.createGain();
  const partials = [
    { ratio: 1, gain: 0.58, decay: 3.7 },
    { ratio: 2.03, gain: 0.22, decay: 2.4 },
    { ratio: 2.71, gain: 0.16, decay: 1.6 },
    { ratio: 4.18, gain: 0.09, decay: 1.2 },
    { ratio: 5.43, gain: 0.06, decay: 0.9 },
  ];

  hitGain.gain.setValueAtTime(0.0001, now);
  hitGain.gain.linearRampToValueAtTime(0.55 * intensity, now + 0.015);
  hitGain.gain.exponentialRampToValueAtTime(0.0001, now + 4.4);
  hitGain.connect(panner);
  panner.connect(state.masterGain);

  partials.forEach((partial, index) => {
    const oscillator = audioContext.createOscillator();
    const partialGain = audioContext.createGain();
    const detune = (Math.random() - 0.5) * 9;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(base * partial.ratio, now);
    oscillator.detune.setValueAtTime(detune, now);
    partialGain.gain.setValueAtTime(partial.gain, now);
    partialGain.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);

    oscillator.connect(partialGain);
    partialGain.connect(hitGain);
    oscillator.start(now + index * 0.002);
    oscillator.stop(now + partial.decay + 0.1);
  });

  const noise = audioContext.createBufferSource();
  const noiseBuffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * 0.08), audioContext.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  const filter = audioContext.createBiquadFilter();
  const noiseGain = audioContext.createGain();

  for (let index = 0; index < noiseData.length; index += 1) {
    const fade = 1 - index / noiseData.length;
    noiseData[index] = (Math.random() * 2 - 1) * fade;
  }

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

  rod.glow = Math.max(rod.glow, intensity);
  addSpark(rodIndex, intensity);
}

function playChimeCluster(intensity = 0.8) {
  if (!state.audioContext) {
    return;
  }

  const count = 2 + Math.floor(Math.random() * 3 + intensity * 2);
  const used = new Set();

  for (let index = 0; index < count; index += 1) {
    let rodIndex = Math.floor(Math.random() * rods.length);
    if (used.has(rodIndex)) {
      rodIndex = (rodIndex + index + 1) % rods.length;
    }
    used.add(rodIndex);
    strikeRod(rodIndex, Math.min(1, intensity * (0.62 + Math.random() * 0.5)), index * (0.045 + Math.random() * 0.08));
  }
}

function addSpark(rodIndex, intensity) {
  const layout = getChimeLayout();
  const x = layout.startX + rodIndex * layout.gap;
  const y = layout.top + rods[rodIndex].length * 0.48;
  const amount = 4 + Math.round(intensity * 5);

  for (let index = 0; index < amount; index += 1) {
    state.sparks.push({
      x,
      y,
      angle: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.8,
      life: 1,
      size: 2 + Math.random() * 3,
      hue: Math.random() > 0.45 ? "#dca94a" : "#3f8f8d",
    });
  }
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
  } catch (error) {
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
  const audioPromise = resumeAudio();
  const motionPromise = requestMotion();
  const [audioReady, motionReady] = await Promise.all([audioPromise, motionPromise]);

  if (!audioReady) {
    return;
  }

  state.started = true;
  startButton.textContent = motionReady ? "Awake" : "Wake";
  startButton.disabled = motionReady;
  playChimeCluster(0.45);
}

function handleMotion(event) {
  const acceleration = event.accelerationIncludingGravity || event.acceleration;
  if (!acceleration) {
    return;
  }

  const x = safeNumber(acceleration.x);
  const y = safeNumber(acceleration.y);
  const z = safeNumber(acceleration.z);
  const magnitude = Math.sqrt(x * x + y * y + z * z);

  if (state.lastMagnitude === null) {
    state.lastMagnitude = magnitude;
    return;
  }

  const delta = Math.abs(magnitude - state.lastMagnitude);
  state.lastMagnitude = state.lastMagnitude * 0.72 + magnitude * 0.28;
  const movement = Math.min(1, delta / 16);
  state.energy = Math.max(state.energy, movement);
  motionMeter.style.width = `${Math.round(Math.min(1, state.energy) * 100)}%`;

  const threshold = 13.5 - state.sensitivity * 8.2;
  const now = performance.now();
  if (delta > threshold && now - state.lastStrike > 520) {
    state.lastStrike = now;
    playChimeCluster(Math.min(1, 0.52 + delta / 18));
  }
}

function getChimeLayout() {
  const w = state.width;
  const h = state.height;
  const gap = Math.min(58, Math.max(36, w / 11));
  const groupWidth = gap * (rods.length - 1);
  const startX = w / 2 - groupWidth / 2;
  const top = Math.max(88, Math.min(150, h * 0.17));

  return { startX, gap, top };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
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

function drawChimes(ctx, time) {
  const { startX, gap, top } = getChimeLayout();
  const t = time / 1000;
  const w = state.width;

  ctx.save();
  ctx.lineCap = "round";

  ctx.strokeStyle = "rgba(72, 87, 86, 0.62)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(Math.max(22, startX - 56), top - 34);
  ctx.bezierCurveTo(w * 0.38, top - 54, w * 0.62, top - 18, Math.min(w - 22, startX + gap * (rods.length - 1) + 56), top - 38);
  ctx.stroke();

  rods.forEach((rod, index) => {
    const anchorX = startX + index * gap;
    const anchorY = top - 22 + Math.sin(t * 0.8 + rod.phase) * 2;
    const sway = Math.sin(t * (0.9 + index * 0.05) + rod.phase) * (7 + state.energy * 38);
    const rodTop = top + Math.sin(t + rod.phase) * (1.5 + state.energy * 5);
    const rodLength = rod.length * Math.min(1, Math.max(0.72, state.height / 760));
    const rodX = anchorX + sway;
    const rodY = rodTop;
    const glow = rod.glow;

    ctx.strokeStyle = "rgba(63, 74, 76, 0.55)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    ctx.lineTo(rodX, rodY + 3);
    ctx.stroke();

    const metal = ctx.createLinearGradient(rodX - rod.width, rodY, rodX + rod.width, rodY);
    metal.addColorStop(0, "#98a6aa");
    metal.addColorStop(0.35, "#f7fbfb");
    metal.addColorStop(0.56, "#bcc8cb");
    metal.addColorStop(1, "#77898f");

    ctx.save();
    ctx.shadowColor = glow > 0.02 ? "rgba(220, 169, 74, 0.8)" : "rgba(18, 34, 42, 0.2)";
    ctx.shadowBlur = 8 + glow * 26;
    roundedRect(ctx, rodX - rod.width / 2, rodY, rod.width, rodLength, rod.width / 2);
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = `rgba(255, 255, 255, ${0.28 + glow * 0.38})`;
    roundedRect(ctx, rodX - rod.width / 2 + 4, rodY + 8, Math.max(3, rod.width * 0.18), rodLength - 20, 3);
    ctx.fill();

    rod.glow *= 0.91;
  });

  const strikerX = startX + gap * 3 + Math.sin(t * 1.25) * (10 + state.energy * 24);
  const strikerY = top + Math.min(190, state.height * 0.28);
  ctx.strokeStyle = "rgba(63, 74, 76, 0.5)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(startX + gap * 3, top - 18);
  ctx.lineTo(strikerX, strikerY);
  ctx.stroke();

  ctx.fillStyle = "#d97962";
  ctx.beginPath();
  ctx.arc(strikerX, strikerY, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.beginPath();
  ctx.arc(strikerX - 6, strikerY - 7, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(63, 74, 76, 0.5)";
  ctx.beginPath();
  ctx.moveTo(strikerX, strikerY + 18);
  ctx.lineTo(strikerX + Math.sin(t * 1.7) * (12 + state.energy * 20), strikerY + 86);
  ctx.stroke();

  ctx.fillStyle = "#3f8f8d";
  ctx.beginPath();
  ctx.moveTo(strikerX - 18, strikerY + 82);
  ctx.quadraticCurveTo(strikerX, strikerY + 112 + state.energy * 14, strikerX + 18, strikerY + 82);
  ctx.quadraticCurveTo(strikerX, strikerY + 94, strikerX - 18, strikerY + 82);
  ctx.fill();

  ctx.restore();
}

function drawSparks(ctx) {
  for (let index = state.sparks.length - 1; index >= 0; index -= 1) {
    const spark = state.sparks[index];
    spark.x += Math.cos(spark.angle) * spark.speed;
    spark.y += Math.sin(spark.angle) * spark.speed - 0.45;
    spark.life -= 0.025;

    if (spark.life <= 0) {
      state.sparks.splice(index, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = spark.life;
    ctx.fillStyle = spark.hue;
    ctx.beginPath();
    ctx.arc(spark.x, spark.y, spark.size * spark.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function draw(time) {
  const ctx = context;
  const w = state.width;
  const h = state.height;

  state.energy *= 0.94;
  if (state.energy < 0.002) {
    state.energy = 0;
  }

  motionMeter.style.width = `${Math.round(Math.min(1, state.energy) * 100)}%`;
  drawBackground(ctx, w, h);
  drawChimes(ctx, time);
  drawSparks(ctx);
  requestAnimationFrame(draw);
}

volumeControl.addEventListener("input", () => {
  state.volume = Number(volumeControl.value);
  if (state.masterGain) {
    state.masterGain.gain.setTargetAtTime(state.volume, state.audioContext.currentTime, 0.04);
  }
});

sensitivityControl.addEventListener("input", () => {
  state.sensitivity = Number(sensitivityControl.value);
});

startButton.addEventListener("click", startApp);

testButton.addEventListener("click", async () => {
  const audioReady = await resumeAudio();
  if (!audioReady) {
    return;
  }
  state.started = true;
  playChimeCluster(0.86);
  state.energy = Math.max(state.energy, 0.75);
});

window.addEventListener("resize", resizeCanvas);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

resizeCanvas();
requestAnimationFrame(draw);
