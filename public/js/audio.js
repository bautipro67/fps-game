// ============================================================================
//  Motor de sonido procedural (Web Audio API) — sin archivos externos.
//  Sonidos en capas (transitorio + cuerpo + sub), reverb, distorsión y
//  variación por disparo. Posicional 3D: lo lejano se oye más bajo.
// ============================================================================
let ctx = null, master = null, reverb = null, ready = false;
let noiseBuf = null, resumeTimer = null;

const rnd = (a, b) => a + Math.random() * (b - a);

// Curva de distorsión (da grano/cuerpo a disparos y golpes)
const distCurve = (() => {
  const n = 1024, c = new Float32Array(n), k = 8;
  for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x)); }
  return c;
})();

function makeNoise() {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function noiseSrc() { const s = ctx.createBufferSource(); s.buffer = noiseBuf; return s; }

// Respuesta al impulso para la reverb (ruido con caída exponencial)
function makeIR(dur, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * dur);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

// Envolvente: ataque rápido + caída exponencial
function gainEnv(t0, peak, dur, attack = 0.005) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  return g;
}

// Oscilador con barrido de tono opcional + envolvente
function tone(type, f0, f1, t0, dur, peak, dest, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type; o.detune.value = detune;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  o.connect(gainEnv(t0, peak, dur)).connect(dest);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

// Ráfaga de ruido filtrado (con barrido de filtro opcional)
function noiseBurst(t0, dur, peak, dest, { type = 'lowpass', f0 = 2000, f1 = null, q = 0.7 } = {}) {
  const n = noiseSrc();
  const bq = ctx.createBiquadFilter(); bq.type = type; bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t0);
  if (f1) bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  n.connect(bq).connect(gainEnv(t0, peak, dur)).connect(dest);
  n.start(t0); n.stop(t0 + dur + 0.03);
}

// Parámetros de disparo por arma
const SHOTS = {
  pistol:  { dur: 0.16, cut: 2000, peak: 0.85, thump: 130 },
  rifle:   { dur: 0.13, cut: 2800, peak: 0.80, thump: 150 },
  smg:     { dur: 0.10, cut: 3200, peak: 0.70, thump: 170 },
  shotgun: { dur: 0.30, cut: 1200, peak: 1.00, thump: 85 },
  sniper:  { dur: 0.40, cut: 2400, peak: 1.00, thump: 75 },
  rocket:  { dur: 0.34, cut: 700,  peak: 1.00, thump: 52 },  // lanzamiento grave y boomy
  botgun:  { dur: 0.20, cut: 2400, peak: 0.60, thump: 120, laser: true },
};

// Disparo en capas: chasquido + cuerpo con grano + sub-grave
function gunshot(p, dest, t) {
  const v = rnd(0.93, 1.08); // variación de tono por disparo (no suena idéntico)
  noiseBurst(t, 0.02, p.peak, dest, { type: 'highpass', f0: 3000 * v, q: 0.5 }); // chasquido
  const n = noiseSrc();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.0;
  lp.frequency.setValueAtTime(p.cut * v, t);
  lp.frequency.exponentialRampToValueAtTime(p.cut * 0.4 * v, t + p.dur);
  const ws = ctx.createWaveShaper(); ws.curve = distCurve; ws.oversample = '2x';
  const g = gainEnv(t, p.peak * 0.9, p.dur);
  n.connect(lp).connect(ws).connect(g).connect(dest);
  n.start(t); n.stop(t + p.dur + 0.03);
  tone('triangle', p.thump * v, p.thump * 0.45 * v, t, p.dur * 0.9, p.peak * 0.7, dest); // sub
  if (p.laser) {
    tone('square', 1200 * v, 300 * v, t, p.dur, 0.18, dest);
    tone('square', 1800 * v, 500 * v, t, p.dur * 0.8, 0.10, dest, 10);
  }
}

function synth(name, dest) {
  const t = ctx.currentTime;
  if (name.startsWith('shoot_')) { gunshot(SHOTS[name.slice(6)] || SHOTS.rifle, dest, t); return; }

  switch (name) {
    case 'reload': { // secuencia mecánica: soltar cargador, sacar, meter, montar
      noiseBurst(t, 0.04, 0.5, dest, { type: 'bandpass', f0: 2600, q: 6 });
      noiseBurst(t + 0.18, 0.06, 0.5, dest, { type: 'lowpass', f0: 1200, q: 1 });
      tone('triangle', 220, 150, t + 0.18, 0.1, 0.35, dest);
      noiseBurst(t + 0.52, 0.07, 0.7, dest, { type: 'lowpass', f0: 1500, q: 1.2 });
      tone('sine', 140, 90, t + 0.52, 0.12, 0.5, dest);
      noiseBurst(t + 0.74, 0.03, 0.5, dest, { type: 'bandpass', f0: 3000, q: 8 });
      noiseBurst(t + 0.82, 0.04, 0.6, dest, { type: 'bandpass', f0: 2200, q: 7 });
      return;
    }
    case 'spawn': { // materialización: barrido + brillo + swoosh + chispas
      tone('sine', 180, 720, t, 0.4, 0.45, dest);
      tone('square', 360, 1440, t, 0.34, 0.10, dest, 8);
      tone('square', 360, 1440, t, 0.34, 0.10, dest, -8);
      noiseBurst(t, 0.4, 0.18, dest, { type: 'bandpass', f0: 400, f1: 3000, q: 1.2 });
      for (let i = 0; i < 3; i++) tone('sine', rnd(900, 1600), rnd(1600, 2400), t + 0.12 + i * 0.05, 0.08, 0.12, dest);
      return;
    }
    case 'death': { // estallido: ruido con barrido + sub-drop + escombros
      noiseBurst(t, 0.5, 0.8, dest, { type: 'lowpass', f0: 2200, f1: 150, q: 0.8 });
      tone('sine', 200, 38, t, 0.5, 0.6, dest);
      tone('sawtooth', 160, 45, t, 0.45, 0.35, dest);
      for (let i = 0; i < 5; i++) {
        const tt = t + 0.1 + Math.random() * 0.3;
        noiseBurst(tt, 0.05, 0.25, dest, { type: 'bandpass', f0: rnd(500, 2000), q: 3 });
      }
      return;
    }
    case 'pickup': { // arpegio ascendente con brillo (C E G C)
      [523, 659, 784, 1047].forEach((f, i) => {
        tone('sine', f, f, t + i * 0.07, 0.16, 0.32, dest);
        tone('triangle', f * 2, f * 2, t + i * 0.07, 0.10, 0.08, dest);
      });
      return;
    }
    case 'hit': { // marca de impacto nítida (tick + ping metálico)
      tone('square', 1600, 1600, t, 0.04, 0.28, dest);
      noiseBurst(t, 0.05, 0.2, dest, { type: 'bandpass', f0: 3200, q: 6 });
      return;
    }
    case 'damaged': { // recibir daño: golpe + sub + gruñido distorsionado
      noiseBurst(t, 0.18, 0.55, dest, { type: 'lowpass', f0: 1000, f1: 300, q: 1 });
      tone('sine', 170, 60, t, 0.2, 0.5, dest);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.15);
      const ws = ctx.createWaveShaper(); ws.curve = distCurve;
      o.connect(ws).connect(gainEnv(t, 0.3, 0.16)).connect(dest);
      o.start(t); o.stop(t + 0.18);
      return;
    }
    case 'empty': { // gatillo sin munición
      noiseBurst(t, 0.03, 0.4, dest, { type: 'bandpass', f0: 2200, q: 5 });
      tone('square', 320, 200, t, 0.05, 0.18, dest);
      return;
    }
    case 'kill': { // confirmación de eliminación (dos tonos ascendentes)
      tone('square', 660, 990, t, 0.12, 0.3, dest);
      tone('square', 990, 1480, t + 0.1, 0.16, 0.3, dest);
      noiseBurst(t, 0.06, 0.28, dest, { type: 'highpass', f0: 2000, q: 0.6 });
      return;
    }
    case 'step': { // paso amortiguado
      noiseBurst(t, 0.06, 0.22, dest, { type: 'lowpass', f0: 900, f1: 300, q: 1 });
      return;
    }
    case 'land': { // aterrizaje
      noiseBurst(t, 0.1, 0.5, dest, { type: 'lowpass', f0: 1100, f1: 250, q: 1 });
      tone('sine', 150, 60, t, 0.12, 0.5, dest);
      return;
    }
    case 'jump': { // impulso de salto
      noiseBurst(t, 0.08, 0.18, dest, { type: 'highpass', f0: 600, f1: 1600, q: 0.7 });
      return;
    }
    case 'beep': { // pitido de cuenta atrás
      tone('square', 880, 880, t, 0.08, 0.3, dest);
      return;
    }
    case 'beepEnd': { // fin de partida
      tone('square', 1320, 1320, t, 0.5, 0.4, dest);
      return;
    }
    case 'ui': { // clic de interfaz
      tone('square', 700, 700, t, 0.05, 0.16, dest);
      return;
    }
    case 'headshot': { // disparo a la cabeza (ding metálico + crunch)
      tone('square', 1500, 1900, t, 0.05, 0.3, dest);
      noiseBurst(t, 0.06, 0.3, dest, { type: 'bandpass', f0: 3000, q: 5 });
      tone('sine', 600, 200, t, 0.12, 0.25, dest);
      return;
    }
    case 'heal': { // curación (acorde cálido ascendente)
      [392, 523, 659].forEach((f, i) => {
        tone('sine', f, f, t + i * 0.06, 0.2, 0.3, dest);
        tone('triangle', f * 2, f * 2, t + i * 0.06, 0.12, 0.06, dest);
      });
      return;
    }
    case 'multi': { // multi-eliminación (fanfarria ascendente)
      [660, 880, 1100, 1320].forEach((f, i) => tone('square', f, f, t + i * 0.05, 0.12, 0.22, dest));
      return;
    }
    case 'boost': { // plataforma de salto
      tone('sine', 300, 950, t, 0.25, 0.35, dest);
      noiseBurst(t, 0.2, 0.2, dest, { type: 'bandpass', f0: 600, f1: 2200, q: 1 });
      return;
    }
    case 'power': { // power-up de daño x2 (acorde épico + riser)
      [220, 277, 330, 440].forEach((f, i) => tone('sawtooth', f, f * 1.02, t + i * 0.03, 0.5, 0.16, dest));
      tone('sine', 200, 1400, t, 0.45, 0.3, dest);
      noiseBurst(t, 0.4, 0.14, dest, { type: 'bandpass', f0: 500, f1: 3500, q: 1.5 });
      return;
    }
    case 'ammo': { // recoger munición (clics metálicos + clac)
      noiseBurst(t, 0.05, 0.5, dest, { type: 'bandpass', f0: 2000, q: 5 });
      noiseBurst(t + 0.1, 0.05, 0.5, dest, { type: 'bandpass', f0: 1500, q: 5 });
      tone('triangle', 160, 110, t + 0.1, 0.1, 0.35, dest);
      return;
    }
    case 'slide': { // barrida: deslizada por el suelo (whoosh descendente)
      noiseBurst(t, 0.55, 0.4, dest, { type: 'lowpass', f0: 2600, f1: 350, q: 1 });
      tone('sine', 220, 90, t, 0.4, 0.18, dest);
      return;
    }
  }
}

// Lecho ambiente continuo (drone grave + viento) para dar atmósfera
function startAmbient() {
  const t = ctx.currentTime;
  const bed = ctx.createGain(); bed.gain.value = 0.06; bed.connect(master);
  for (const det of [-6, 6]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55; o.detune.value = det;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
    const g = ctx.createGain(); g.gain.value = 0.5;
    o.connect(lp).connect(g).connect(bed); o.start(t);
  }
  const n = noiseSrc(); n.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.8;
  const ng = ctx.createGain(); ng.gain.value = 0.25;
  n.connect(bp).connect(ng).connect(bed); n.start(t);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain(); lfoG.gain.value = 250;
  lfo.connect(lfoG).connect(bp.frequency); lfo.start(t);
}

// Cantidad de reverb (envío) según el sonido
function reverbAmount(name) {
  if (name.startsWith('shoot_')) {
    const k = name.slice(6);
    return k === 'sniper' ? 0.55 : k === 'shotgun' ? 0.4 : 0.28;
  }
  return ({ death: 0.5, spawn: 0.32, pickup: 0.16, reload: 0.12, hit: 0.12, damaged: 0.18,
    kill: 0.3, step: 0.05, land: 0.16, jump: 0.08, empty: 0.05, beep: 0.04, beepEnd: 0.25, ui: 0.04,
    headshot: 0.18, heal: 0.2, multi: 0.22, boost: 0.2, power: 0.35, ammo: 0.1, slide: 0.15 })[name] ?? 0.2;
}

// Reanuda el contexto si quedó suspendido/interrumpido (clave para que no se corte)
function ensureRunning() { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); }

// Límite de sonidos posicionales POR VENTANA DE TIEMPO (no se puede "trabar")
let recentPlays = [];
function gate() {
  if (!ready) return false;
  ensureRunning();
  const now = performance.now();
  recentPlays = recentPlays.filter((t) => now - t < 120);
  if (recentPlays.length >= 12) return false; // máx ~12 sonidos lejanos por 120 ms
  recentPlays.push(now);
  return true;
}

export const sfx = {
  init() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        noiseBuf = makeNoise();
        master = ctx.createGain(); master.gain.value = 0.5;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 24; comp.ratio.value = 3.2;
        comp.attack.value = 0.004; comp.release.value = 0.18;
        master.connect(comp); comp.connect(ctx.destination);
        reverb = ctx.createConvolver(); reverb.buffer = makeIR(1.3, 2.2);
        const ret = ctx.createGain(); ret.gain.value = 0.9;
        reverb.connect(ret); ret.connect(master);
        ready = true;
        startAmbient();
        if (!resumeTimer) resumeTimer = setInterval(ensureRunning, 1500); // red de seguridad
      }
      ensureRunning();
    } catch (e) { /* audio no disponible */ }
  },
  setVolume(v) { if (master) master.gain.value = v; },

  updateListener(px, py, pz, fx, fy, fz, ux, uy, uz) {
    if (!ready) return;
    const L = ctx.listener;
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setValueAtTime(px, t); L.positionY.setValueAtTime(py, t); L.positionZ.setValueAtTime(pz, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(ux, t); L.upY.setValueAtTime(uy, t); L.upZ.setValueAtTime(uz, t);
    } else {
      L.setPosition(px, py, pz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  },

  // Sonido POSICIONAL (se atenúa con la distancia, con su cola de reverb)
  play(name, x, y, z, vol = 1) {
    if (!gate()) return; // límite de voces para los sonidos posicionales
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower'; // mucho más barato que HRTF (evita cortes con muchos sonidos)
    panner.distanceModel = 'inverse';
    panner.refDistance = 7; panner.maxDistance = 130; panner.rolloffFactor = 1.3;
    if (panner.positionX) {
      const t = ctx.currentTime;
      panner.positionX.setValueAtTime(x, t); panner.positionY.setValueAtTime(y, t); panner.positionZ.setValueAtTime(z, t);
    } else panner.setPosition(x, y, z);
    const out = ctx.createGain(); out.gain.value = vol;
    out.connect(panner); panner.connect(master);
    const wet = ctx.createGain(); wet.gain.value = reverbAmount(name);
    panner.connect(wet); wet.connect(reverb);
    synth(name, out);
    // liberar los nodos al terminar (evita que se acumulen y el audio se corte)
    setTimeout(() => { try { out.disconnect(); panner.disconnect(); wet.disconnect(); } catch (e) {} }, 1400);
  },

  // Sonido LOCAL del propio jugador (sin atenuar)
  playLocal(name, vol = 1) {
    if (!ready) return;
    ensureRunning(); // tus propios sonidos siempre suenan (sin límite de voces)
    const out = ctx.createGain(); out.gain.value = vol;
    out.connect(master);
    const wet = ctx.createGain(); wet.gain.value = reverbAmount(name);
    out.connect(wet); wet.connect(reverb);
    synth(name, out);
    setTimeout(() => { try { out.disconnect(); wet.disconnect(); } catch (e) {} }, 1400);
  },
};
