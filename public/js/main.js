// ============================================================================
//  CLIENTE - FPS Multijugador (Three.js)
//  Render 3D, cámara en primera persona, disparo, red e interpolación.
// ============================================================================
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sfx } from './audio.js';

const socket = io();

// Desbloqueo de audio: los navegadores exigen un gesto del usuario para que suene.
// Reanudamos el AudioContext ante cualquier interacción (y al volver a la pestaña).
['pointerdown', 'mousedown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, () => sfx.init(), { passive: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden) sfx.init(); });

// ----------------------------- Estado global --------------------------------
let scene, camera, renderer, controls, clock;
let selfId = null;
let joined = false;
let pointerLocked = false;
let weapons = {};            // config recibida del servidor
let obstacles = [];          // para colisión en el cliente
let EYE = 1.7;

let latest = { players: [], bots: [], pickups: [], medkits: [], drops: [], leaderId: null, power: { active: false }, timeLeft: 0, phase: 'playing' };
let selfAlive = true;
let selfHealth = 200;
let selfMaxHealth = 200;
let protectStart = 0;        // marca para la cuenta atrás de inmunidad

const entities = new Map();  // id -> { group, avatar, label, labelG, shield, target }
const pickupMeshes = new Map();
const tracers = [];

// Jugador local (autoritativo en movimiento, el servidor valida el daño)
const local = {
  x: 0, z: 0, feetY: 0, velY: 0, onGround: true, eye: 1.7,
  weapon: 'pistol', ammo: 12, reserve: 96, lastShot: 0, reloading: false,
  sliding: false, slideTime: 0, slideSpeed: 0, slideDirX: 0, slideDirZ: 0,
};
const keys = { w: false, a: false, s: false, d: false, space: false, shift: false, crouch: false };
let firing = false;
let viewModel = null;        // arma en primera persona
let nearbyPickup = null;
let aiming = false;          // apuntar con mira (ADS)
const baseFov = 78;
let recoilKick = 0;
let lastYaw = 0, lastPitch = 0, swayX = 0, swayY = 0;          // sway del arma al mirar
let scoreboardOpen = false, pingMs = 0, fps = 0;               // marcador en vivo + perf
let frames = 0, perfAcc = 0;

const UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
let muted = false;

// --- pulido: efectos y feel ---
const worldColliders = [];
const raycaster = new THREE.Raycaster();
let muzzle = null, muzzleLight = null, muzzleT = 0;
const sparks = [];
let fireSpread = 0, stepAcc = 0, bobPhase = 0, miniAcc = 0, prevTimeSec = 999;
let isMoving = false, sprintActive = false, prevCrouch = false, prevSprint = false;

// --- optimización: cache de DOM, temporales reutilizables, pool de luces ---
const _dom = {};
const D = (id) => _dom[id] || (_dom[id] = document.getElementById(id));
const _hud = {};
const _mv = new THREE.Vector3();
const effectLights = [];
let lightIdx = 0;
let jumpPads = [], dust = null, powerMesh = null;
let worldGroup = null, builtTheme = null;              // para reconstruir el mundo al cambiar de mapa
const padRings = [];                                   // anillos ascendentes de los jump pads
let AMMO_CRATES = [{ x: 27, z: 27 }, { x: -27, z: -27 }]; // cajas de munición (las define el mapa)
const ammoCrateMeshes = [];
let ammoCd = 0;
let boostUntil = 0;                                    // mi power-up de daño x2
let myTeam = null;                                     // 'A' | 'B' | null (FFA)
let myJugg = false;                                    // ¿soy el gigante en Juggernaut?
const TEAM_COLOR = { A: 0x3b82f6, B: 0xe0483b };       // azul / rojo
const ALLY = 0x39d98a, ENEMY = 0xff5a5a;               // verde aliado / rojo enemigo
let chosenMode = 'ffa', currentMode = 'ffa', modePicked = false; // selección de modo en el lobby
const shotPings = [];                                  // destellos de disparos en el minimapa
let enemyAcc = 0;                                      // detección de enemigo bajo la mira

// --- móvil, menú in-game y sensibilidad ---
const isMobile = /Mobi|Android|iPhone|iPad|iPod|Tablet/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches);
const touchMove = { x: 0, y: 0 };
let menuOpen = false, inputOn = false;
let sensitivity = parseFloat(localStorage.getItem('fps_sens') || '1') || 1;
let worldBuilt = false, animating = false;
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
if (isMobile) document.body.classList.add('mobile');

// ============================================================================
//  RED
// ============================================================================
socket.on('init', (data) => {
  selfId = data.selfId;
  weapons = data.weapons;
  if (data.mode) currentMode = data.mode;
  EYE = data.map.eye;
  local.x = data.spawn.x; local.z = data.spawn.z; local.feetY = 0;
  setWeapon(data.weapon, true);
  if (!worldBuilt) { initThree(); buildWorld(data.map); worldBuilt = true; builtTheme = data.map.theme; }
  else if (data.map.theme !== builtTheme) { buildWorld(data.map); builtTheme = data.map.theme; } // cambió el mapa
  joined = true;
  D('menu').classList.add('hidden');
  D('crosshair').classList.remove('hidden');
  D('hud').classList.remove('hidden');
  if (isMobile) { D('touch-controls').classList.remove('hidden'); D('btn-menu').classList.remove('hidden'); }
  sfx.playLocal('spawn', 0.8);
  if (!animating) { clock = new THREE.Clock(); animate(); animating = true; }
});

socket.on('state', (s) => {
  latest = s;
  const oc = D('online-count'); if (oc) oc.textContent = s.players.length;   // contador del lobby
  const pc = D('players-count'); if (pc) pc.textContent = s.players.length;  // contador en partida
  const meSt = s.players.find(p => p.id === selfId);
  myTeam = meSt ? meSt.team : null;
  updateTeamHud(s);                                                          // marcador por equipos
  updateDuelUI(s);                                                           // interfaz del duelo 1v1
  updateJuggUI(s);                                                           // interfaz del Juggernaut
  myJugg = !!(s.jugg && s.jugg.juggId === selfId);                          // ¿soy el gigante?
  if (!joined && !modePicked && s.mode) setMode(s.mode);                     // en el lobby, refleja el modo activo
  const me = s.players.find(p => p.id === selfId);
  if (me) {
    selfHealth = me.health; selfMaxHealth = me.maxHealth;
    const wasDead = !selfAlive;
    selfAlive = me.alive;
    if (selfAlive && wasDead) hideDeath();
  }
  if (s.phase === 'playing') D('gameover-screen').classList.add('hidden');
});

socket.on('respawn', (d) => {
  local.x = d.x; local.z = d.z; local.feetY = 0; local.velY = 0;
  local.sliding = false;
  setWeapon(d.weapon, true);
  protectStart = 0;
  hideDeath();
  sfx.playLocal('spawn', 0.8);
});

socket.on('died', (d) => { sfx.playLocal('death', 0.9); if (!d || !d.jugg) showDeath(d.by); }); // el gigante no reaparece
socket.on('hit', (d) => {
  const per = new Map(); let kill = false, killType = 'bot', head = false;
  for (const h of d.hits || []) {
    const cur = per.get(h.id) || { dmg: 0, head: false };
    cur.dmg += (h.dmg || 0); if (h.head) cur.head = true;
    per.set(h.id, cur);
    if (h.killed) { kill = true; killType = h.type; }
    if (h.head) head = true;
    const e = entities.get(h.id); if (e) e.hitFlash = 1; // destello blanco al recibir el impacto
  }
  for (const [id, info] of per) spawnDamageNumber(id, info.dmg, kill && per.size === 1, info.head);
  flashHitmarker(kill, head);
  if (kill) { registerKill(); killPopup(killType === 'bot' ? 1 : 10, head); }
  if (head) sfx.playLocal('headshot', 0.7);
  else if (kill) sfx.playLocal('kill', 0.7);
  else sfx.playLocal('hit', 0.5);
});
socket.on('healed', () => { sfx.playLocal('heal', 0.7); healFlash(); showToast('+60 vida'); });
socket.on('announce', (d) => { showToast(d.text); sfx.playLocal('multi', 0.45); });
socket.on('notify', (d) => { showNotify(d.text); sfx.playLocal(d.kind === 'join' ? 'pickup' : 'ui', 0.5); });
socket.on('boost', (d) => { boostUntil = performance.now() + d.ms; sfx.playLocal('power', 0.8); showToast('⚡ DAÑO x2'); });
socket.on('counts', (c) => {  // contadores de jugadores por modo (lobby)
  const a = D('count-ffa'), b = D('count-teams'), du = D('count-duel'), ju = D('count-jugg'), tot = D('online-count');
  if (a) a.textContent = c.ffa;
  if (b) b.textContent = c.teams;
  if (du) du.textContent = (c.duel || 0) + '/2';
  if (ju) ju.textContent = (c.juggernaut || 0);
  if (tot) tot.textContent = c.ffa + c.teams + (c.duel || 0) + (c.juggernaut || 0);
});
socket.on('duelFull', () => {  // el duelo ya tiene 2 jugadores
  const m = D('lobby-msg');
  if (m) { m.textContent = '⚔️ El duelo ya está lleno (2/2). Probá otro modo o esperá.'; m.classList.remove('hidden'); }
  sfx.playLocal('empty', 0.5);
});
socket.on('returnLobby', () => { returnToLobby(); }); // fin del duelo → al lobby
socket.on('pongcheck', (t) => { pingMs = Math.round(performance.now() - t); });
setInterval(() => { if (joined) socket.emit('pingcheck', performance.now()); }, 2000);
socket.on('damaged', (d) => { flashDamage(); sfx.playLocal('damaged', 0.8); showDamageDir(d && d.from); });
socket.on('weaponPickup', (d) => { setWeapon(d.weapon, true); sfx.playLocal('pickup', 0.8); showToast('Recogiste: ' + (weapons[d.weapon]?.name || '')); });
socket.on('tracer', (t) => {
  if (!joined) return; // aún en el menú: la escena no existe todavía
  spawnTracerPoints(new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(t.tx, t.ty, t.tz), weapons[t.weapon]?.color);
  sfx.play('shoot_' + (t.weapon || 'rifle'), t.x, t.y, t.z, 0.85); // disparo lejano = más bajo
  shotPings.push({ x: t.x, z: t.z, t: performance.now() });        // destello en el minimapa
  if (shotPings.length > 24) shotPings.shift();
});
socket.on('killfeed', (k) => addKillFeed(k));
socket.on('gameover', (d) => { if (joined) showGameOver(d.ranking, d.mode, d.teamScore); });
socket.on('matchstart', () => { D('gameover-screen').classList.add('hidden'); });

// Enviar nuestra posición ~20 veces por segundo
setInterval(() => {
  if (!joined || !selfAlive) return;
  camera.getWorldDirection(_dir);
  const ry = Math.atan2(_dir.x, _dir.z);
  socket.emit('input', { x: local.x, y: local.feetY, z: local.z, ry });
}, 50);

// ============================================================================
//  THREE.JS - escena y mundo
// ============================================================================
function initThree() {
  scene = new THREE.Scene();
  scene.background = makeGradientSky();
  // móvil: niebla apenas más corta (no afecta la visibilidad del mapa)
  scene.fog = new THREE.Fog(0x9fc0d8, isMobile ? 72 : 80, isMobile ? 165 : 175);

  camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, isMobile ? 420 : 600);

  // móvil: sin antialias (caro en GPU móvil); la menor resolución ya suaviza
  renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  // móvil: renderiza a ~1x (los teléfonos suelen ser 2x–3x → enorme ahorro de píxeles)
  renderer.setPixelRatio(isMobile ? Math.min(1, devicePixelRatio) : Math.min(1.6, devicePixelRatio));
  renderer.shadowMap.enabled = !isMobile;           // móvil: sin sombras proyectadas (gran ahorro)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  D('game').appendChild(renderer.domElement);

  // entorno IBL: reflejos suaves en metales — se omite en móvil (sombreado más barato)
  if (!isMobile) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    } catch (e) { /* sin entorno IBL */ }
  }

  scene.add(new THREE.HemisphereLight(0xcfe3f2, 0x3a4452, isMobile ? 1.45 : 1.2)); // móvil: hemisférica más fuerte (compensa la falta de IBL)
  const sun = new THREE.DirectionalLight(0xfff3df, 1.25);
  sun.position.set(55, 95, 35);
  if (!isMobile) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); // sombra más liviana
    const c = sun.shadow.camera;
    c.left = -75; c.right = 75; c.top = 75; c.bottom = -75; c.near = 1; c.far = 260;
  }
  scene.add(sun);
  // pool FIJO de luces de efecto: evita recompilar shaders al crear/destruir luces
  for (let i = 0; i < (isMobile ? 1 : 3); i++) {       // móvil: menos luces dinámicas
    const pl = new THREE.PointLight(0xffffff, 0, 10);
    pl.userData.t = 0; pl.userData.max = 1; pl.userData.peak = 0;
    effectLights.push(pl); scene.add(pl);
  }

  controls = new PointerLockControls(camera, renderer.domElement);
  controls.pointerSpeed = sensitivity;
  controls.addEventListener('lock', () => { pointerLocked = true; firing = false; sfx.init(); });
  controls.addEventListener('unlock', () => { pointerLocked = false; firing = false; });

  buildViewModel();
  buildMuzzle();
  window.addEventListener('resize', onResize);
  setupInput();
  setupTouch();
  setupMenus();
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

// ----------------------------- Texturas procedurales ------------------------
function makeGradientSky() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, '#0c1e33');
  g.addColorStop(0.42, '#2c5078');
  g.addColorStop(0.5, '#7e9fbb'); // horizonte
  g.addColorStop(1.0, '#aac4d6');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
  // estrellas tenues en la parte alta
  for (let i = 0; i < 90; i++) {
    x.globalAlpha = Math.random() * 0.5;
    x.fillStyle = '#ffffff';
    x.fillRect(Math.random() * 1024, Math.random() * 170, 1.6, 1.6);
  }
  x.globalAlpha = 1;
  // sol con halo cálido
  const sun = x.createRadialGradient(770, 150, 0, 770, 150, 90);
  sun.addColorStop(0, 'rgba(255,240,210,0.95)');
  sun.addColorStop(0.25, 'rgba(255,220,160,0.55)');
  sun.addColorStop(1, 'rgba(255,220,160,0)');
  x.fillStyle = sun; x.fillRect(660, 40, 220, 220);
  // nubes suaves cerca del horizonte
  x.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < 14; i++) {
    const cx2 = Math.random() * 1024, cy2 = 195 + Math.random() * 85, rw = 60 + Math.random() * 120;
    for (let j = 0; j < 5; j++) {
      x.beginPath();
      x.ellipse(cx2 + (Math.random() - 0.5) * rw, cy2 + (Math.random() - 0.5) * 16, rw * 0.4, 13 + Math.random() * 10, 0, 0, 7);
      x.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeFloorTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = '#2b3440'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#3a4a5b'; x.lineWidth = 4;
  for (let i = 0; i <= 256; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
  x.fillStyle = '#26415a'; x.fillRect(0, 0, 64, 64); x.fillRect(128, 128, 64, 64);
  x.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 70; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(12, 12);
  return t;
}
function makeCrateTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#6b5535'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#7d6440'; x.fillRect(7, 7, 114, 114);
  x.strokeStyle = '#3e3220'; x.lineWidth = 9; x.strokeRect(9, 9, 110, 110);
  x.lineWidth = 6; x.beginPath(); x.moveTo(9, 9); x.lineTo(119, 119); x.moveTo(119, 9); x.lineTo(9, 119); x.stroke();
  x.fillStyle = '#2e2618';
  for (const [bx, by] of [[18, 18], [110, 18], [18, 110], [110, 110]]) { x.beginPath(); x.arc(bx, by, 5, 0, 7); x.fill(); }
  return new THREE.CanvasTexture(cv);
}

function addBox(x, y, z, w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  worldGroup.add(m);
  worldColliders.push(m); // para los impactos de bala
  return m;
}
function addEdges(mesh, color) {
  const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color }));
  mesh.add(line);
}

function disposeGroup(grp) {
  grp.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { Array.isArray(o.material) ? o.material.forEach(m => m.dispose()) : o.material.dispose(); }
  });
}
function buildWorld(map) {
  const size = map.size, half = size / 2;
  obstacles = map.obstacles;
  const theme = map.theme || 'arena';
  const accent = theme === 'frente' ? 0xff7a3c : theme === 'duelo' ? 0xff4d6d : theme === 'coliseo' ? 0xffc24d : 0x33d6ff;  // color neón por mapa
  const accent2 = theme === 'frente' ? 0xffb37a : theme === 'duelo' ? 0xff8aa0 : theme === 'coliseo' ? 0xffe0a0 : 0x6fe6ff;
  const floorCol = theme === 'frente' ? 0x4a3a30 : theme === 'duelo' ? 0x33303c : theme === 'coliseo' ? 0x4a4030 : 0x394452;

  // ---- limpiar el mundo anterior (cambio de mapa) ----
  if (worldGroup) { scene.remove(worldGroup); disposeGroup(worldGroup); }
  worldGroup = new THREE.Group(); scene.add(worldGroup);
  worldColliders.length = 0; spinners.length = 0; padRings.length = 0; ammoCrateMeshes.length = 0;
  for (const [, m] of pickupMeshes) scene.remove(m); pickupMeshes.clear();
  for (const [, m] of medkitMeshes) scene.remove(m); medkitMeshes.clear();
  for (const [, m] of dropMeshes) scene.remove(m); dropMeshes.clear();
  powerMesh = null; dust = null;
  AMMO_CRATES = map.ammocrates || AMMO_CRATES;
  const add = (o) => worldGroup.add(o);

  // ---- suelo texturizado ----
  const floorMat = new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: .95 });
  floorMat.color.setHex(floorCol);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; add(floor); worldColliders.push(floor);

  // ---- horizonte de edificios lejanos (fusionado en 1 sola malla) ----
  const cityGeos = [];
  for (let i = 0; i < 70; i++) {
    const ang = (i / 70) * Math.PI * 2 + Math.random() * 0.06;
    const rad = half + 22 + Math.random() * 70, bh = 12 + Math.random() * 52, bw = 6 + Math.random() * 12;
    const geo = new THREE.BoxGeometry(bw, bh, bw);
    geo.translate(Math.cos(ang) * rad, bh / 2, Math.sin(ang) * rad);
    cityGeos.push(geo);
  }
  add(new THREE.Mesh(mergeGeometries(cityGeos),
    new THREE.MeshStandardMaterial({ color: 0x2c3543, roughness: 1, emissive: 0x141d2a, emissiveIntensity: .35 })));

  // ---- aro central + emblema flotante ----
  const ring = new THREE.Mesh(new THREE.RingGeometry(7.6, 8.4, 56),
    new THREE.MeshBasicMaterial({ color: 0xf8c537, transparent: true, opacity: .45 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; add(ring);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.18, 10, 36),
    new THREE.MeshStandardMaterial({ color: 0xf8c537, emissive: 0xf8c537, emissiveIntensity: 1.2 }));
  halo.rotation.x = Math.PI / 2; halo.position.set(0, 9, 0); add(halo); spinners.push(halo);
  const haloCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 0),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.0 }));
  haloCore.position.set(0, 9, 0); add(haloCore); spinners.push(haloCore);

  // ---- plataformas de salto ----
  jumpPads = map.jumppads || [];
  for (const pad of jumpPads) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.4, 28),
      new THREE.MeshStandardMaterial({ color: 0x0e2a3a, emissive: accent, emissiveIntensity: .7 }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(pad.x, 0.05, pad.z); add(disc);
    const pring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.09, 8, 28), new THREE.MeshBasicMaterial({ color: accent2 }));
    pring.rotation.x = Math.PI / 2; pring.position.set(pad.x, 0.12, pad.z); add(pring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 5, 18, 1, true),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.set(pad.x, 2.5, pad.z); add(beam);
    const rise = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 8, 24),
      new THREE.MeshBasicMaterial({ color: accent2, transparent: true, opacity: 0.5 }));
    rise.rotation.x = Math.PI / 2; rise.position.set(pad.x, 0.2, pad.z); add(rise); padRings.push(rise);
  }

  // ---- power-up de daño x2 ----
  powerMesh = new THREE.Group();
  powerMesh.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0),
    new THREE.MeshStandardMaterial({ color: 0xc26bff, emissive: 0xb14cff, emissiveIntensity: 1.3 })));
  const pbeam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 26, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xc26bff, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false }));
  pbeam.position.y = 10; powerMesh.add(pbeam);
  powerMesh.position.set(0, 7.0, 0); add(powerMesh);

  // ---- cajas de munición ----
  for (const a of AMMO_CRATES) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.65),
      new THREE.MeshStandardMaterial({ color: 0x3a4252, metalness: .4, roughness: .5 }));
    box.castShadow = true; g.add(box);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xf8c537, emissive: 0xf8c537, emissiveIntensity: .6 })));
    const aring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.045, 8, 24), new THREE.MeshBasicMaterial({ color: 0xf8c537 }));
    aring.rotation.x = Math.PI / 2; aring.position.y = -0.35; g.add(aring);
    g.position.set(a.x, 0.75, a.z); add(g); ammoCrateMeshes.push(g);
  }

  // ---- polvo en suspensión ----
  const dustN = 220, dustPos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dustPos[i * 3] = Math.random() * 100 - 50; dustPos[i * 3 + 1] = Math.random() * 22; dustPos[i * 3 + 2] = Math.random() * 100 - 50; }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xbcd6ee, size: 0.08, transparent: true, opacity: 0.35, depthWrite: false }));
  add(dust);

  // ---- muros perimetrales con franja luminosa ----
  const wallMat = new THREE.MeshStandardMaterial({ color: theme === 'frente' ? 0x4a4038 : theme === 'duelo' ? 0x3a3340 : theme === 'coliseo' ? 0x5b5040 : 0x38424f, roughness: .85 });
  const h = 8, t = 2;
  for (const [wx, wz, ww, wd] of [[0, half, size, t], [0, -half, size, t], [half, 0, t, size], [-half, 0, t, size]]) {
    addBox(wx, h / 2, wz, ww, h, wd, wallMat);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.05, 0.28, wd + 0.05),
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: .85 }));
    trim.position.set(wx, h - 0.7, wz); add(trim);
  }

  // ---- obstáculos diferenciados ----
  const crateTex = makeCrateTexture();
  for (const o of map.obstacles) {
    const isCover = o.h <= 3;
    const isBarrier = (o.w === 2 || o.d === 2) && Math.max(o.w, o.d) > 10;
    if (isCover) {
      addEdges(addBox(o.x, o.h / 2, o.z, o.w, o.h, o.d, new THREE.MeshStandardMaterial({ map: crateTex, roughness: .9 })), 0x2e2618);
    } else if (isBarrier) {
      addEdges(addBox(o.x, o.h / 2, o.z, o.w, o.h, o.d, new THREE.MeshStandardMaterial({ color: 0x47505e, roughness: .8 })), 0x222831);
      const tr = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.06, 0.22, o.d + 0.06),
        new THREE.MeshStandardMaterial({ color: 0xf8c537, emissive: 0xf8c537, emissiveIntensity: .5 }));
      tr.position.set(o.x, o.h - 0.4, o.z); add(tr);
    } else {
      const m = addBox(o.x, o.h / 2, o.z, o.w, o.h, o.d, new THREE.MeshStandardMaterial({ color: 0x515b6c, metalness: .35, roughness: .55 }));
      addEdges(m, 0x20262f);
      const stripMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: .7 });
      for (const sx of [-1, 1]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.14, o.h * 0.7, 0.14), stripMat);
        s.position.set(o.x + sx * (o.w / 2 + 0.02), o.h * 0.45, o.z); add(s);
      }
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0),
        new THREE.MeshStandardMaterial({ color: 0xffb03a, emissive: 0xffb03a, emissiveIntensity: 1.4 }));
      core.position.set(o.x, o.h + 0.6, o.z); add(core); spinners.push(core);
    }
  }
}
const spinners = [];

// ============================================================================
//  Modelos de armas (compartidos por la vista en 1ª persona y los pickups)
// ============================================================================
function weaponMats(key) {
  const accent = weapons[key]?.color ?? 0xf1c40f;
  return {
    metal: new THREE.MeshStandardMaterial({ color: 0x23272e, metalness: .6, roughness: .4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: .5, roughness: .5 }),
    accent: new THREE.MeshStandardMaterial({ color: accent, metalness: .4, roughness: .35, emissive: accent, emissiveIntensity: .3 }),
  };
}
function makeWeaponModel(key) {
  const g = new THREE.Group();
  const m = weaponMats(key);
  const box = (w, h, d, mat, x, y, z, rx) => {
    const e = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    e.position.set(x, y, z); if (rx) e.rotation.x = rx; e.castShadow = true; g.add(e); return e;
  };
  const cyl = (r, len, mat, x, y, z, axis) => {
    const e = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), mat);
    e.position.set(x, y, z);
    if (axis === 'z') e.rotation.x = Math.PI / 2; if (axis === 'x') e.rotation.z = Math.PI / 2;
    e.castShadow = true; g.add(e); return e;
  };
  switch (key) {
    case 'pistol':
      box(0.13, 0.17, 0.42, m.metal, 0, 0, -0.12);
      box(0.10, 0.10, 0.18, m.dark, 0, 0.02, -0.34);
      box(0.11, 0.22, 0.14, m.dark, 0, -0.17, 0.02, 0.25);
      box(0.06, 0.05, 0.16, m.accent, 0, 0.10, -0.10);
      break;
    case 'rifle':
      box(0.12, 0.16, 0.85, m.metal, 0, 0, -0.30);
      cyl(0.03, 0.5, m.dark, 0, 0.02, -0.78, 'z');
      box(0.09, 0.28, 0.13, m.dark, 0, -0.20, -0.12, 0.12);
      box(0.10, 0.13, 0.26, m.dark, 0, -0.02, 0.18);
      box(0.05, 0.06, 0.5, m.accent, 0, 0.10, -0.30);
      box(0.04, 0.07, 0.04, m.dark, 0, 0.15, -0.50);
      break;
    case 'shotgun':
      cyl(0.045, 0.8, m.dark, 0.055, 0.02, -0.55, 'z');
      cyl(0.045, 0.8, m.dark, -0.055, 0.02, -0.55, 'z');
      box(0.17, 0.16, 0.5, m.metal, 0, -0.02, -0.2);
      box(0.15, 0.10, 0.22, m.accent, 0, -0.05, -0.34);
      box(0.11, 0.22, 0.15, m.dark, 0, -0.18, 0.04, 0.22);
      box(0.10, 0.13, 0.28, m.dark, 0, -0.02, 0.2);
      break;
    case 'smg':
      box(0.12, 0.17, 0.5, m.metal, 0, 0, -0.18);
      cyl(0.028, 0.26, m.dark, 0, 0.02, -0.5, 'z');
      box(0.08, 0.30, 0.10, m.accent, 0, -0.22, -0.02, 0.12);
      box(0.11, 0.20, 0.13, m.dark, 0, -0.16, 0.10, 0.25);
      box(0.06, 0.10, 0.22, m.dark, 0, 0.0, 0.16);
      break;
    case 'sniper':
      box(0.11, 0.15, 1.0, m.metal, 0, 0, -0.32);
      cyl(0.028, 0.85, m.dark, 0, 0.0, -0.95, 'z');
      cyl(0.06, 0.42, m.accent, 0, 0.16, -0.32, 'z');
      cyl(0.07, 0.05, m.dark, 0, 0.16, -0.12, 'z');
      cyl(0.07, 0.05, m.dark, 0, 0.16, -0.52, 'z');
      box(0.04, 0.10, 0.04, m.dark, 0, 0.09, -0.30);
      box(0.10, 0.14, 0.30, m.dark, 0, -0.02, 0.22);
      box(0.11, 0.22, 0.14, m.dark, 0, -0.17, 0.06, 0.22);
      break;
    default:
      box(0.13, 0.16, 0.6, m.metal, 0, 0, -0.2);
  }
  return g;
}

function buildViewModel() {
  if (viewModel) camera.remove(viewModel);
  const g = makeWeaponModel(local.weapon);
  const hip = new THREE.Vector3(0.3, -0.28, -0.55);
  const ads = (local.weapon === 'sniper')
    ? new THREE.Vector3(0.0, -0.085, -0.34)
    : new THREE.Vector3(0.0, -0.135, -0.40);
  const draw = hip.clone().add(new THREE.Vector3(0, -0.5, 0.2)); // arranca abajo (animación de sacar)
  g.position.copy(draw);
  camera.add(g);
  scene.add(camera);
  viewModel = g;
  viewModel.userData.hip = hip;
  viewModel.userData.ads = ads;
  viewModel.userData.cur = draw;
}
function recoil() { recoilKick = 0.07; }

// Apuntar con mira (ADS): zoom, centra el arma frente a la cámara y reduce la dispersión
function updateAim(dt) {
  const canAim = aiming && selfAlive && inputOn;
  const isSniper = local.weapon === 'sniper';
  const scoped = canAim && isSniper;                 // sniper: mira de pantalla con zoom fuerte
  const targetFov = canAim ? (isSniper ? 28 : 55) : (local.sliding ? baseFov + 14 : sprintActive ? baseFov + 8 : baseFov);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  if (viewModel) {
    viewModel.visible = !scoped;                     // ocultar el arma al mirar por la mira
    const target = canAim ? viewModel.userData.ads : viewModel.userData.hip;
    viewModel.userData.cur.lerp(target, Math.min(1, dt * 16));
    viewModel.position.copy(viewModel.userData.cur);
    viewModel.position.z += recoilKick;              // retroceso encima de la base
    recoilKick += (0 - recoilKick) * Math.min(1, dt * 10);
    // balanceo al caminar
    bobPhase += dt * (sprintActive ? 14 : 9) * (isMoving ? 1 : 0);
    const amp = canAim ? 0.003 : (sprintActive ? 0.02 : 0.012);
    viewModel.position.x += Math.sin(bobPhase) * amp;
    viewModel.position.y += Math.abs(Math.cos(bobPhase)) * amp * 0.7;
    // animación de recarga: inclina y baja el arma
    const rt = local.reloading ? 0.7 : 0;
    viewModel.rotation.x += (rt - viewModel.rotation.x) * Math.min(1, dt * 9);
    if (local.reloading) viewModel.position.y -= 0.12;
    // sway: el arma "sigue" con retraso el giro de la cámara
    _euler.setFromQuaternion(camera.quaternion);
    let dyw = ((_euler.y - lastYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const dpt = _euler.x - lastPitch;
    lastYaw = _euler.y; lastPitch = _euler.x;
    const swayMul = canAim ? 0.25 : 1;
    swayX += ((-dyw * 1.6 * swayMul) - swayX) * Math.min(1, dt * 10);
    swayY += ((dpt * 1.2 * swayMul) - swayY) * Math.min(1, dt * 10);
    swayX = Math.max(-0.06, Math.min(0.06, swayX));
    swayY = Math.max(-0.05, Math.min(0.05, swayY));
    viewModel.position.x += swayX;
    viewModel.position.y += swayY;
  }
  // el fogonazo acompaña la posición del arma (cadera vs apuntado)
  if (muzzle) {
    muzzle.position.x = canAim ? 0 : 0.16;
    muzzle.position.y = canAim ? -0.05 : -0.1;
    if (muzzleLight) { muzzleLight.position.x = muzzle.position.x; muzzleLight.position.y = muzzle.position.y; }
  }
  const ch = D('crosshair');
  if (ch) ch.style.opacity = canAim ? '0' : '1';     // al apuntar, guías por la mira
  document.body.classList.toggle('aiming', canAim && !scoped); // viñeta sólo armas no-sniper
  const scope = D('scope');
  if (scope) scope.style.display = scoped ? 'block' : 'none';
}

// ============================================================================
//  Avatares: jugadores (humanoides azules) y bots (robots)
// ============================================================================
// Crea un miembro articulado: un grupo pivote (hombro/cadera) con la malla colgando
function limb(parent, px, py, pz, mesh, hang) {
  const pivot = new THREE.Group();
  pivot.position.set(px, py, pz);
  mesh.position.y = hang; mesh.castShadow = true;
  pivot.add(mesh); parent.add(pivot);
  return pivot;
}
function makePlayerMesh(color) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2330, roughness: .6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0a98a, roughness: .7 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x10141a, roughness: .3, metalness: .6, emissive: 0x2a5a88, emissiveIntensity: .5 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.6, 4, 12), suit);
  torso.position.y = 1.28; torso.castShadow = true; g.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.32, 0.12),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .3 }));
  chest.position.set(0, 1.35, -0.3); g.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), skin);
  head.position.y = 1.95; head.castShadow = true; g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  helmet.position.y = 1.97; g.add(helmet);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.06), visorMat);
  visor.position.set(0, 1.95, -0.25); g.add(visor);
  const bp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.18), dark);
  bp.position.set(0, 1.32, 0.3); g.add(bp);
  const armL = limb(g, 0.42, 1.52, 0, new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), suit), -0.35);
  const armR = limb(g, -0.42, 1.52, 0, new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), suit), -0.35);
  const legL = limb(g, 0.16, 0.92, 0, new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.55, 4, 8), dark), -0.42);
  const legR = limb(g, -0.16, 0.92, 0, new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.55, 4, 8), dark), -0.42);
  g.userData.walk = { armL, armR, legL, legR };
  g.userData.bodyMat = suit; // para flash de impacto
  return g;
}
function makeBotMesh() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: .75, roughness: .35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x16191e, metalness: .6, roughness: .5 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2a20, emissiveIntensity: 1.1, roughness: .4 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.7, 0.46), metal);
  torso.position.y = 1.3; torso.castShadow = true; g.add(torso);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12), glow);
  core.rotation.x = Math.PI / 2; core.position.set(0, 1.35, -0.24); g.add(core);
  for (const sx of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.36), dark);
    sh.position.set(sx * 0.45, 1.52, 0); sh.castShadow = true; g.add(sh);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.38, 0.4), metal);
  head.position.y = 1.92; head.castShadow = true; g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), glow);
  visor.position.set(0, 1.95, -0.19); g.add(visor);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), dark);
  ant.position.set(0.15, 2.25, 0); g.add(ant);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), glow);
  tip.position.set(0.15, 2.42, 0); g.add(tip);
  const armL = limb(g, 0.45, 1.45, 0, new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 10), dark), -0.32);
  const armR = limb(g, -0.45, 1.45, 0, new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 10), dark), -0.32);
  const legL = limb(g, 0.16, 0.82, 0, new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), dark), -0.33);
  const legR = limb(g, -0.16, 0.82, 0, new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), dark), -0.33);
  g.userData.walk = { armL, armR, legL, legR };
  g.userData.bodyMat = metal; g.userData.glow = glow; // para flash de impacto y tinte por arma
  return g;
}

// Coloca el arma (visible) en la mano de un bot u otro jugador
function setHeldWeapon(e, weaponKey) {
  if (e.heldWeapon) {
    e.avatar.remove(e.heldWeapon);
    e.heldWeapon.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    e.heldWeapon = null;
  }
  e.weapon = weaponKey;
  if (!weaponKey || !weapons[weaponKey]) return;
  const wm = makeWeaponModel(weaponKey);
  wm.scale.setScalar(1.4); // bien visible para distinguir el arma de cada bot
  wm.position.set(0.26, 1.28, -0.42); // mano derecha, al frente, a la altura del pecho
  wm.traverse((o) => { o.castShadow = false; });
  e.avatar.add(wm);
  e.heldWeapon = wm;
  // los bots tiñen su visor/núcleo con el color de su arma (para distinguirla)
  if (e.avatar.userData.glow) {
    const c = weapons[weaponKey].color;
    e.avatar.userData.glow.color.setHex(c);
    e.avatar.userData.glow.emissive.setHex(c);
  }
}

// ---- etiquetas (nombre + barra de vida) -----------------------------------
function makeTextSprite(text, depthTest = true) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 30px Segoe UI, Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, 8, 8, 240, 48, 8); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest, transparent: true }));
  sp.scale.set(2.2, 0.55, 1);
  return sp;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// Sprite con un emoji (sin fondo) — usado para la corona del líder
function makeEmojiSprite(emoji, scale = 0.9) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c2 = cv.getContext('2d');
  c2.font = '48px serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
  c2.fillText(emoji, 32, 36);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(scale, scale, 1);
  return sp;
}

// Color único por jugador (estable por id)
const PLAYER_COLORS = [0x3b82f6, 0x2ecc71, 0xe67e22, 0x9b59b6, 0x1abc9c, 0xe84393, 0xf1c40f, 0x74b9ff];
function colorForId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}

function makeLabel(name) {
  const group = new THREE.Group();
  const nameSp = makeTextSprite(name, true);
  nameSp.position.y = 0.34;
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .6 }));
  const barFg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x38d66b }));
  barFg.position.z = 0.001;
  group.add(barBg, barFg, nameSp);
  return {
    group,
    setHealth(frac) {
      frac = Math.max(0, Math.min(1, frac));
      barFg.scale.x = frac || 0.0001;
      barFg.position.x = -(1.6 * (1 - frac)) / 2;
      barFg.material.color.setHSL(0.33 * frac, 0.8, 0.5);
    },
  };
}

function syncEntities() {
  const seen = new Set();
  const upsert = (id, color, isBot, st) => {
    seen.add(id);
    let e = entities.get(id);
    if (!e) {
      const group = new THREE.Group();
      const avatar = isBot ? makeBotMesh() : makePlayerMesh(color);
      avatar.userData.isAvatar = true; // para que la mira detecte enemigos
      group.add(avatar);
      const label = makeLabel(isBot ? 'BOT' : st.name);
      label.group.position.y = 2.7;
      group.add(label.group);
      const shield = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 14),
        new THREE.MeshBasicMaterial({ color: 0x4dd2ff, transparent: true, opacity: 0.16, depthWrite: false }));
      shield.position.y = 1.05; shield.visible = false; group.add(shield);
      group.position.set(st.x, st.y, st.z);
      scene.add(group);
      const crown = makeEmojiSprite('👑', 0.85);
      crown.position.y = 3.25; crown.visible = false; group.add(crown);
      const aura = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xc26bff, transparent: true, opacity: 0.15, depthWrite: false }));
      aura.position.y = 1.05; aura.visible = false; group.add(aura);
      // anillo de equipo a los pies (verde aliado / rojo enemigo) — solo en modo equipos
      const teamRing = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 8, 24),
        new THREE.MeshBasicMaterial({ color: ALLY }));
      teamRing.rotation.x = Math.PI / 2; teamRing.position.y = 0.06; teamRing.visible = false; group.add(teamRing);
      const jmark = makeEmojiSprite('👹', 1.1);
      jmark.position.y = 3.4; jmark.visible = false; group.add(jmark);
      e = { id, group, avatar, label, labelG: label.group, shield, crown, aura, teamRing, jmark, scaleApplied: 1, rot: st.ry + Math.PI, prevAlive: st.alive, target: { x: st.x, y: st.y, z: st.z, ry: st.ry } };
      entities.set(id, e);
    }
    // sonidos posicionales: muerte (de todos) y aparición (de jugadores)
    if (e.prevAlive === true && !st.alive) {
      sfx.play('death', st.x, st.y + 1, st.z, isBot ? 0.45 : 0.9);
      deathBurst(st.x, st.y + 1.1, st.z, isBot ? 0xff5a3c : 0x4da3ff);
    } else if (e.prevAlive === false && st.alive && !isBot) sfx.play('spawn', st.x, st.y + 1, st.z, 0.6);
    e.prevAlive = st.alive;

    e.target.x = st.x; e.target.y = st.y; e.target.z = st.z; e.target.ry = st.ry;
    e.group.visible = st.alive;
    e.label.setHealth(st.health / st.maxHealth);
    e.shield.visible = !!st.protected;
    e.aura.visible = !!st.boosted; // aura violeta: lleva daño x2
    // equipos: anillo aliado/enemigo a los pies
    if (latest.mode === 'teams' && st.team) {
      e.teamRing.visible = true;
      e.teamRing.material.color.setHex(st.team === myTeam ? ALLY : ENEMY);
    } else e.teamRing.visible = false;
    e.team = st.team;
    e.avatar.userData.team = st.team;
    if (e.weapon !== st.weapon) setHeldWeapon(e, st.weapon); // arma visible en la mano
    // Juggernaut: el gigante es más grande y lleva un marcador 👹
    const sc = st.isJugg ? (latest.jugg?.scale || 1.8) : 1;
    if (e.scaleApplied !== sc) {
      e.avatar.scale.setScalar(sc);
      e.shield.scale.setScalar(sc); e.shield.position.y = 1.05 * sc;
      e.aura.scale.setScalar(sc); e.aura.position.y = 1.05 * sc;
      e.labelG.position.y = 2.7 * sc; e.crown.position.y = 3.25 * sc; e.jmark.position.y = 3.4 * sc;
      e.scaleApplied = sc;
    }
    e.jmark.visible = !!st.isJugg;
  };

  for (const p of latest.players) { if (p.id === selfId) continue; upsert(p.id, colorForId(p.id), false, p); }
  for (const b of latest.bots) upsert(b.id, 0xc0392b, true, b);

  for (const [id, e] of entities) {
    if (!seen.has(id)) { scene.remove(e.group); disposeGroup(e.group); entities.delete(id); }
  }
}

function interpEntities(dt) {
  const k = Math.min(1, dt * 14);
  for (const [, e] of entities) {
    const prevGX = e.group.position.x, prevGZ = e.group.position.z;
    e.group.position.x += (e.target.x - e.group.position.x) * k;
    e.group.position.y += (e.target.y - e.group.position.y) * k;
    e.group.position.z += (e.target.z - e.group.position.z) * k;
    // rotación suavizada por el camino más corto (el frente del modelo es -Z)
    const targetRot = e.target.ry + Math.PI;
    let dr = ((targetRot - e.rot + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    e.rot += dr * Math.min(1, dt * 12);
    e.avatar.rotation.y = e.rot;
    e.labelG.quaternion.copy(camera.quaternion);
    if (e.shield.visible) e.shield.scale.setScalar(1 + Math.sin(performance.now() / 140) * 0.05);
    // velocidad real del avatar (posición interpolada) para animar la caminata
    const moved = Math.hypot(e.group.position.x - prevGX, e.group.position.z - prevGZ);
    const sp = moved / Math.max(dt, 0.001);
    const w = e.avatar.userData.walk;
    if (w) {
      if (sp > 0.4) {
        e.walkPhase = (e.walkPhase || 0) + dt * Math.min(sp, 11) * 1.1;
        const s = Math.sin(e.walkPhase) * Math.min(0.7, 0.12 + sp * 0.05);
        w.legL.rotation.x = s; w.legR.rotation.x = -s;
        w.armL.rotation.x = -s; w.armR.rotation.x = s;
      } else {
        for (const part of [w.legL, w.legR, w.armL, w.armR]) part.rotation.x *= 0.8;
      }
    }
    // pasos audibles de los demás (conciencia espacial)
    e.stepD = (e.stepD || 0) + moved;
    if (sp > 2.5 && e.stepD > 2.6 && e.group.visible) {
      e.stepD = 0;
      sfx.play('step', e.group.position.x, e.group.position.y + 0.2, e.group.position.z, 0.45);
    }
    // corona del líder de la partida
    if (e.crown) e.crown.visible = latest.leaderId === e.id && e.group.visible;
    if (e.hitFlash > 0) { // destello al recibir daño
      e.hitFlash = Math.max(0, e.hitFlash - dt * 5);
      const bm = e.avatar.userData.bodyMat;
      if (bm) bm.emissive.setScalar(e.hitFlash * 0.9);
    }
  }
}

// ============================================================================
//  Pickups de armas (silueta del arma + aro + haz + nombre)
// ============================================================================
function makePickupMesh(weapon) {
  const g = new THREE.Group();
  const col = weapons[weapon]?.color ?? 0xffffff;
  const model = makeWeaponModel(weapon);
  model.scale.setScalar(1.1);
  model.rotation.y = Math.PI / 2;
  g.add(model);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 8, 28),
    new THREE.MeshBasicMaterial({ color: col }));
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.45; g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 1.0; g.add(beam);
  const label = makeTextSprite(weapons[weapon]?.name || '', true);
  label.position.y = 1.35; label.scale.set(1.8, 0.45, 1); g.add(label);
  return g;
}

function syncPickups() {
  for (const pk of latest.pickups) {
    let m = pickupMeshes.get(pk.id);
    if (!m) {
      m = makePickupMesh(pk.weapon);
      m.position.set(pk.x, 1.3, pk.z);
      scene.add(m);
      pickupMeshes.set(pk.id, m);
    }
    m.visible = pk.active;
    m.userData.weapon = pk.weapon;
    m.userData.x = pk.x; m.userData.z = pk.z; m.userData.active = pk.active;
  }
}

// Armas soltadas por bots al morir (pickups temporales)
const dropMeshes = new Map();
function makeDropMesh(weapon) {
  const g = new THREE.Group();
  const col = weapons[weapon]?.color ?? 0xffffff;
  const model = makeWeaponModel(weapon);
  model.scale.setScalar(1.0);
  g.add(model);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 22),
    new THREE.MeshBasicMaterial({ color: col }));
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.35; g.add(ring);
  return g;
}
function syncDrops() {
  const seen = new Set();
  for (const d of (latest.drops || [])) {
    seen.add(d.id);
    let m = dropMeshes.get(d.id);
    if (!m) { m = makeDropMesh(d.weapon); m.position.set(d.x, 0.8, d.z); scene.add(m); dropMeshes.set(d.id, m); }
    m.userData.x = d.x; m.userData.z = d.z; m.userData.weapon = d.weapon; m.userData.until = d.until;
  }
  for (const [id, m] of dropMeshes) {
    if (seen.has(id)) continue;
    scene.remove(m);
    m.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    dropMeshes.delete(id);
  }
}

function updatePickups(dt) {
  nearbyPickup = null;
  let best = 99;
  for (const [id, m] of pickupMeshes) {
    if (!m.userData.active) continue;
    m.rotation.y += dt * 1.4;
    m.position.y = 1.3 + Math.sin(performance.now() / 400) * 0.12;
    const dist = Math.hypot(m.userData.x - local.x, m.userData.z - local.z);
    if (dist < 2.6 && dist < best && m.userData.weapon !== local.weapon) {
      best = dist; nearbyPickup = { id, weapon: m.userData.weapon };
    }
  }
  // drops de bots: giran, flotan y parpadean cuando están por desaparecer
  const nowMs = Date.now();
  for (const [id, m] of dropMeshes) {
    m.rotation.y += dt * 2;
    m.position.y = 0.8 + Math.sin(performance.now() / 350) * 0.08;
    m.visible = (m.userData.until - nowMs > 3000) || (Math.sin(performance.now() / 90) > 0);
    const dist = Math.hypot(m.userData.x - local.x, m.userData.z - local.z);
    if (dist < 2.6 && dist < best && m.userData.weapon !== local.weapon) {
      best = dist; nearbyPickup = { id, weapon: m.userData.weapon };
    }
  }
  const prompt = D('prompt-pickup');
  if (nearbyPickup && selfAlive) {
    D('pickup-name').textContent = weapons[nearbyPickup.weapon]?.name || '';
    prompt.classList.remove('hidden');
  } else prompt.classList.add('hidden');
}

// ============================================================================
//  Trazadoras de disparo
// ============================================================================
function spawnTracer(origin, dir, range, color) {
  spawnTracerPoints(origin.clone(), origin.clone().add(dir.clone().multiplyScalar(range)), color);
}
function spawnTracerPoints(a, b, color = 0xffe066) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracers.push({ line, mat, life: 0.07 });
}
function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.mat.opacity = Math.max(0, t.life / 0.07) * 0.85;
    if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.mat.dispose(); tracers.splice(i, 1); }
  }
}

// ============================================================================
//  Pulido: fogonazo, impactos, números de daño, minimapa
// ============================================================================
function makeFlashTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(0.3, 'rgba(255,210,120,0.9)');
  g.addColorStop(1, 'rgba(255,150,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(255,230,170,0.9)'; x.lineWidth = 4;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); x.stroke();
  }
  return new THREE.CanvasTexture(cv);
}
function buildMuzzle() {
  const tex = makeFlashTex();
  muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffe6b0, blending: THREE.AdditiveBlending, depthTest: false, transparent: true }));
  muzzle.scale.set(0.6, 0.6, 1); muzzle.position.set(0.16, -0.1, -1.0); muzzle.visible = false;
  camera.add(muzzle);
  muzzleLight = new THREE.PointLight(0xffcc88, 0, 14); muzzleLight.position.set(0.16, -0.1, -1.2);
  camera.add(muzzleLight);
}
function flashMuzzle() {
  if (!muzzle || (viewModel && !viewModel.visible)) return; // no en mira de sniper
  muzzle.visible = true;
  muzzle.material.rotation = Math.random() * 6.28;
  muzzle.scale.setScalar(0.45 + Math.random() * 0.3);
  muzzleLight.intensity = 5;
  muzzleT = 0.05;
}
function updateMuzzle(dt) {
  if (muzzleT > 0) {
    muzzleT -= dt;
    if (muzzleLight) muzzleLight.intensity *= 0.78;
    if (muzzleT <= 0 && muzzle) { muzzle.visible = false; if (muzzleLight) muzzleLight.intensity = 0; }
  }
}

// Pool de luces de efecto (reutiliza luces fijas en vez de crear/destruir)
function grabLight(x, y, z, color, intensity, dist, dur) {
  const pl = effectLights[lightIdx]; lightIdx = (lightIdx + 1) % effectLights.length;
  pl.color.setHex(color); pl.position.set(x, y, z); pl.distance = dist;
  pl.intensity = intensity; pl.userData.peak = intensity; pl.userData.t = dur; pl.userData.max = dur;
}
function updateEffectLights(dt) {
  for (const pl of effectLights) {
    if (pl.userData.t > 0) {
      pl.userData.t -= dt;
      pl.intensity = pl.userData.peak * Math.max(0, pl.userData.t / pl.userData.max);
    }
  }
}

// Impacto: lanza un rayo desde el centro de la mira y crea chispas donde golpea
function spawnImpact() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.far = 200;
  const list = worldColliders.slice();
  for (const [, e] of entities) if (e.group.visible) list.push(e.avatar);
  const hits = raycaster.intersectObjects(list, true);
  if (hits.length) sparkBurst(hits[0].point);
}
function sparkBurst(p) {
  grabLight(p.x, p.y, p.z, 0xffd090, 3, 6, 0.12);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: muzzle.material.map, color: 0xfff0c0, blending: THREE.AdditiveBlending, transparent: true }));
  s.position.copy(p); s.scale.setScalar(0.5); scene.add(s);
  sparks.push({ obj: s, life: 0.12, max: 0.12 });
  for (let i = 0; i < 4; i++) {
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
    const end = p.clone().add(dir.multiplyScalar(0.3 + Math.random() * 0.3));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, end]),
      new THREE.LineBasicMaterial({ color: 0xffd070, transparent: true }));
    scene.add(line);
    sparks.push({ obj: line, life: 0.18, max: 0.18 });
  }
}
function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]; s.life -= dt;
    const f = Math.max(0, s.life / s.max);
    if (s.obj.material) s.obj.material.opacity = f;
    if (s.obj.isSprite) s.obj.scale.setScalar(0.5 * f + 0.1);
    if (s.life <= 0) {
      scene.remove(s.obj);
      if (s.obj.geometry) s.obj.geometry.dispose();
      if (s.obj.material) s.obj.material.dispose();
      sparks.splice(i, 1);
    }
  }
}

// Explosión de partículas al morir
const debris = [];
function deathBurst(x, y, z, color) {
  grabLight(x, y, z, color, 4, 9, 0.3);
  const mat0 = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, transparent: true });
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), mat0.clone());
    m.position.set(x, y, z); scene.add(m);
    const v = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4 + 1.5, (Math.random() - 0.5) * 5);
    debris.push({ obj: m, vel: v, life: 0.7, max: 0.7 });
  }
  mat0.dispose(); // las piezas usan clones; el material base se libera
}
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]; d.life -= dt;
    d.vel.y -= 14 * dt;
    d.obj.position.addScaledVector(d.vel, dt);
    d.obj.rotation.x += dt * 6; d.obj.rotation.y += dt * 5;
    if (d.obj.position.y < 0.12) { d.obj.position.y = 0.12; d.vel.y = Math.abs(d.vel.y) * 0.35; d.vel.x *= 0.6; d.vel.z *= 0.6; }
    d.obj.material.opacity = Math.max(0, d.life / d.max);
    if (d.life <= 0) {
      scene.remove(d.obj);
      d.obj.geometry.dispose(); d.obj.material.dispose();
      debris.splice(i, 1);
    }
  }
}

// Polvo en suspensión: deriva lentamente hacia arriba y se recicla
function updateDust(dt) {
  if (!dust) return;
  const attr = dust.geometry.attributes.position, a = attr.array;
  for (let i = 1; i < a.length; i += 3) { a[i] += dt * 0.4; if (a[i] > 22) a[i] = 0; }
  attr.needsUpdate = true;
}

// Botiquines (curación automática al pasar por encima)
const medkitMeshes = new Map();
function makeMedkitMesh() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: .5 }));
  base.castShadow = true; g.add(base);
  const crossMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x2ecc71, emissiveIntensity: .6 });
  const cv = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.16), crossMat); cv.position.y = 0.22; g.add(cv);
  const ch = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.16), crossMat); ch.position.y = 0.22; g.add(ch);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 8, 24), new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.32; g.add(ring);
  return g;
}
function syncMedkits() {
  for (const mk of (latest.medkits || [])) {
    let m = medkitMeshes.get(mk.id);
    if (!m) { m = makeMedkitMesh(); m.position.set(mk.x, 0.9, mk.z); scene.add(m); medkitMeshes.set(mk.id, m); }
    m.visible = mk.active;
    m.userData.x = mk.x; m.userData.z = mk.z; m.userData.active = mk.active;
  }
}
let medkitCd = 0;
function updateMedkits(dt) {
  medkitCd -= dt;
  for (const [id, m] of medkitMeshes) {
    if (!m.userData.active) continue;
    m.rotation.y += dt * 1.2;
    m.position.y = 0.9 + Math.sin(performance.now() / 450) * 0.1;
    if (selfAlive && selfHealth < selfMaxHealth && medkitCd <= 0 &&
        Math.hypot(m.userData.x - local.x, m.userData.z - local.z) < 2) {
      medkitCd = 0.5; socket.emit('medkit', id);
    }
  }
}

// Cajas de munición: rellenan la reserva del arma actual al acercarte
function updateAmmoCrates(dt) {
  ammoCd -= dt;
  const w = weapons[local.weapon];
  for (const g of ammoCrateMeshes) {
    g.rotation.y += dt * 0.8;
    if (!w || !selfAlive || ammoCd > 0) continue;
    if (local.reserve < w.reserve && Math.hypot(g.position.x - local.x, g.position.z - local.z) < 2.2) {
      local.reserve = w.reserve;
      ammoCd = 1.2;
      sfx.playLocal('ammo', 0.7);
      showToast('Munición al máximo');
      updateHud();
    }
  }
}

const _proj = new THREE.Vector3();
function spawnDamageNumber(id, dmg, kill, head) {
  const e = entities.get(id);
  if (!e) return;
  _proj.copy(e.group.position); _proj.y += 1.7;
  _proj.project(camera);
  if (_proj.z > 1) return;
  const el = document.createElement('div');
  el.className = 'dmg-num' + (kill ? ' kill' : '') + (head ? ' head' : '');
  el.textContent = (head ? '🎯' : '') + (kill ? '☠ ' : '') + dmg;
  el.style.left = ((_proj.x * 0.5 + 0.5) * innerWidth) + 'px';
  el.style.top = ((-_proj.y * 0.5 + 0.5) * innerHeight) + 'px';
  D('dmg-layer').appendChild(el);
  setTimeout(() => el.remove(), 800);
}
function killPopup(points, head) {
  const el = D('kill-popup');
  el.textContent = (head ? '🎯 ' : '') + '+' + points;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

let miniCv = null, miniCtx = null;
function drawMinimap() {
  if (!miniCtx) { miniCv = D('minimap'); if (!miniCv) return; miniCtx = miniCv.getContext('2d'); }
  const S = miniCv.width, half = 50, sc = S / (half * 2);
  const X = (wx) => (wx + half) * sc, Z = (wz) => (wz + half) * sc;
  const c = miniCtx;
  c.clearRect(0, 0, S, S);
  c.fillStyle = 'rgba(10,16,24,0.7)'; c.fillRect(0, 0, S, S);
  c.fillStyle = 'rgba(120,140,165,0.55)';
  for (const o of obstacles) c.fillRect(X(o.x - o.w / 2), Z(o.z - o.d / 2), o.w * sc, o.d * sc);
  for (const [, m] of pickupMeshes) {
    if (!m.userData.active) continue;
    c.fillStyle = '#f8c537';
    c.fillRect(X(m.userData.x) - 2, Z(m.userData.z) - 2, 4, 4);
  }
  for (const mk of (latest.medkits || [])) {
    if (!mk.active) continue;
    c.fillStyle = '#2ecc71';
    c.fillRect(X(mk.x) - 2, Z(mk.z) - 2, 4, 4);
  }
  // armas soltadas por bots
  c.fillStyle = '#ffffff';
  for (const [, m] of dropMeshes) c.fillRect(X(m.userData.x) - 1.5, Z(m.userData.z) - 1.5, 3, 3);
  // cajas de munición
  c.fillStyle = '#ffd84d';
  for (const a of AMMO_CRATES) { c.beginPath(); c.arc(X(a.x), Z(a.z), 2.4, 0, 7); c.fill(); }
  // plataformas de salto
  c.strokeStyle = '#33d6ff';
  for (const p2 of jumpPads) { c.beginPath(); c.arc(X(p2.x), Z(p2.z), 3, 0, 7); c.stroke(); }
  // balizas de las esquinas (mismos colores que en el mapa)
  for (const [bx2, bz2, bc] of [[35, 35, '#ff5a5a'], [35, -35, '#ffe14d'], [-35, 35, '#33d6ff'], [-35, -35, '#7cfc66']]) {
    c.fillStyle = bc; c.beginPath(); c.arc(X(bx2), Z(bz2), 2.6, 0, 7); c.fill();
  }
  const teams = latest.mode === 'teams';
  for (const b of latest.bots) {
    if (!b.alive) continue;
    c.fillStyle = teams ? (b.team === myTeam ? '#39d98a' : '#ff5a5a') : '#e0483b';
    c.beginPath(); c.arc(X(b.x), Z(b.z), 2.2, 0, 7); c.fill();
  }
  for (const p of latest.players) {
    if (p.id === selfId || !p.alive) continue;
    c.fillStyle = teams ? (p.team === myTeam ? '#39d98a' : '#ff5a5a') : '#' + colorForId(p.id).toString(16).padStart(6, '0');
    c.beginPath(); c.arc(X(p.x), Z(p.z), 2.8, 0, 7); c.fill();
  }
  // destellos de disparos recientes (de dónde vienen los tiros)
  const nowP = performance.now();
  for (let i = shotPings.length - 1; i >= 0; i--) {
    const sp2 = shotPings[i];
    const age = (nowP - sp2.t) / 1200;
    if (age >= 1) { shotPings.splice(i, 1); continue; }
    c.fillStyle = `rgba(255,140,50,${(0.8 * (1 - age)).toFixed(2)})`;
    c.beginPath(); c.arc(X(sp2.x), Z(sp2.z), 2 + age * 3, 0, 7); c.fill();
  }
  // yo (triángulo orientado)
  camera.getWorldDirection(_dir);
  const L = Math.hypot(_dir.x, _dir.z) || 1, nx = _dir.x / L, nz = _dir.z / L, rx = -nz, rz = nx;
  const px = X(local.x), pz = Z(local.z);
  c.fillStyle = '#38d66b';
  c.beginPath();
  c.moveTo(px + nx * 6, pz + nz * 6);
  c.lineTo(px - nx * 3 + rx * 3.5, pz - nz * 3 + rz * 3.5);
  c.lineTo(px - nx * 3 - rx * 3.5, pz - nz * 3 - rz * 3.5);
  c.closePath(); c.fill();
}

// ============================================================================
//  Movimiento del jugador local + colisión
// ============================================================================
// Altura del "suelo" bajo los pies: 0 o el techo del obstáculo sobre el que estás
function groundHeightAt(x, z, feetY) {
  let g = 0;
  for (const o of obstacles) {
    if (feetY < o.h - 0.25) continue; // solo cuenta si venís desde arriba
    if (x > o.x - o.w / 2 - 0.3 && x < o.x + o.w / 2 + 0.3 &&
        z > o.z - o.d / 2 - 0.3 && z < o.z + o.d / 2 + 0.3 && o.h > g) g = o.h;
  }
  return g;
}

function resolveCollision(px, pz, r, feetY = 0) {
  for (let iter = 0; iter < 2; iter++) {
    for (const o of obstacles) {
      if (feetY >= o.h - 0.25) continue; // estás por encima: podés caminar sobre él
      const minx = o.x - o.w / 2 - r, maxx = o.x + o.w / 2 + r;
      const minz = o.z - o.d / 2 - r, maxz = o.z + o.d / 2 + r;
      if (px > minx && px < maxx && pz > minz && pz < maxz) {
        const ox1 = px - minx, ox2 = maxx - px, oz1 = pz - minz, oz2 = maxz - pz;
        const m = Math.min(ox1, ox2, oz1, oz2);
        if (m === ox1) px = minx; else if (m === ox2) px = maxx;
        else if (m === oz1) pz = minz; else pz = maxz;
      }
    }
  }
  return { x: px, z: pz };
}

function updatePlayer(dt) {
  if (!selfAlive) { camera.position.set(local.x, local.feetY + (local.eye || EYE), local.z); return; }
  camera.getWorldDirection(_fwd);
  _fwd.y = 0; _fwd.normalize();
  _right.crossVectors(_fwd, UP).normalize();

  _mv.set(0, 0, 0);
  if (inputOn) {
    if (keys.w) _mv.add(_fwd);
    if (keys.s) _mv.sub(_fwd);
    if (keys.d) _mv.add(_right);
    if (keys.a) _mv.sub(_right);
    if (touchMove.x || touchMove.y) { _mv.addScaledVector(_fwd, touchMove.y); _mv.addScaledVector(_right, touchMove.x); }
  }
  isMoving = _mv.lengthSq() > 0.0001;
  const touchMag = Math.hypot(touchMove.x, touchMove.y);
  const crouching = keys.crouch && local.onGround && inputOn;
  const sprintIntent = inputOn && isMoving && !aiming && ((keys.shift && keys.w) || (touchMag > 0.92 && touchMove.y > 0.4));
  sprintActive = sprintIntent && !crouching;

  // --- barrida / slide: venías corriendo y te agachás → deslizada con impulso ---
  const crouchPressed = keys.crouch && !prevCrouch;
  prevCrouch = keys.crouch;
  if (crouchPressed && prevSprint && local.onGround && !local.sliding) {
    local.sliding = true; local.slideTime = 0; local.slideSpeed = 17;
    local.slideDirX = _fwd.x; local.slideDirZ = _fwd.z; // dirección fija de la barrida
    sfx.playLocal('slide', 0.7);
  }
  let speed, sliding = false;
  if (local.sliding) {
    local.slideTime += dt;
    local.slideSpeed -= dt * 16;                          // va frenando
    if (local.slideSpeed <= 5.5 || !keys.crouch || local.slideTime > 0.9 || !local.onGround || !inputOn) {
      local.sliding = false;                              // fin de la barrida
    } else {
      sliding = true; isMoving = true;
      _mv.set(local.slideDirX, 0, local.slideDirZ);
      speed = local.slideSpeed;
    }
  }
  if (!sliding) {
    speed = (aiming && inputOn) ? 4.8 : crouching ? 4.3 : sprintActive ? 12 : 8.5;
    if (isMoving) _mv.normalize();
  }
  prevSprint = sprintActive;
  local.x += _mv.x * speed * dt;
  local.z += _mv.z * speed * dt;

  const r = resolveCollision(local.x, local.z, 0.5, local.feetY);
  local.x = Math.max(-49, Math.min(49, r.x));
  local.z = Math.max(-49, Math.min(49, r.z));

  const wasOnGround = local.onGround;
  const prevFeet = local.feetY;
  local.velY -= 25 * dt;
  local.feetY += local.velY * dt;
  const groundH = groundHeightAt(local.x, local.z, prevFeet); // techos pisables
  let landed = false, impact = 0;
  if (local.feetY <= groundH) {
    if (!wasOnGround) { landed = true; impact = -local.velY; }
    local.feetY = groundH; local.velY = 0; local.onGround = true;
  } else local.onGround = false;
  if (keys.space && local.onGround && inputOn && (!crouching || local.sliding)) { local.velY = 9; local.onGround = false; local.sliding = false; sfx.playLocal('jump', 0.5); }
  // plataformas de salto: gran impulso (alcanza para subir a los techos)
  if (local.onGround && local.feetY === 0 && inputOn) {
    for (const pad of jumpPads) {
      if (Math.hypot(pad.x - local.x, pad.z - local.z) < 1.6) { local.velY = 20; local.onGround = false; sfx.playLocal('boost', 0.6); break; }
    }
  }

  // altura de cámara: agachado más bajo (interpolado)
  const baseEye = myJugg ? EYE * 1.55 : EYE;                 // el gigante ve desde más alto
  const targetEye = sliding ? 0.8 : crouching ? 1.15 : baseEye; // en barrida, más bajo aún
  local.eye = (local.eye || EYE) + (targetEye - (local.eye || EYE)) * Math.min(1, dt * 12);
  camera.position.set(local.x, local.feetY + local.eye, local.z);

  // pasos y aterrizaje
  if (landed && impact > 4) sfx.playLocal('land', Math.min(0.8, impact / 12));
  if (isMoving && local.onGround && !crouching) {
    stepAcc += dt;
    if (stepAcc >= (sprintActive ? 0.30 : 0.42)) { stepAcc = 0; sfx.playLocal('step', 0.35); }
  } else stepAcc = 0.3;
}

// ============================================================================
//  Disparo y recarga
// ============================================================================
function setWeapon(key, fillAmmo) {
  local.weapon = key;
  const w = weapons[key];
  if (fillAmmo && w) { local.ammo = w.magazine; local.reserve = w.reserve; local.reloading = false; }
  D('reload-msg').classList.add('hidden');
  if (viewModel) buildViewModel();
  updateHud();
}

function tryShoot() {
  if (!selfAlive || !inputOn || local.reloading) return;
  const w = weapons[local.weapon];
  if (!w) return;
  if (local.ammo <= 0) { sfx.playLocal('empty', 0.5); startReload(); return; }
  const now = performance.now();
  if (now - local.lastShot < w.fireRate) return;
  local.lastShot = now;
  local.ammo--;

  const origin = camera.position.clone();
  const base = new THREE.Vector3();
  camera.getWorldDirection(base);
  const rays = [];
  const pellets = w.pellets || 1;
  const spreadMul = (aiming && inputOn) ? 0.3 : (keys.crouch && local.onGround) ? 0.55 : 1; // apuntar/agacharse = más precisión
  for (let i = 0; i < pellets; i++) {
    const d = base.clone();
    d.x += (Math.random() - 0.5) * w.spread * 2 * spreadMul;
    d.y += (Math.random() - 0.5) * w.spread * 2 * spreadMul;
    d.z += (Math.random() - 0.5) * w.spread * 2 * spreadMul;
    d.normalize();
    rays.push({ x: d.x, y: d.y, z: d.z });
    spawnTracer(origin, d, w.range, w.color);
  }
  socket.emit('shoot', { weapon: local.weapon, origin: { x: origin.x, y: origin.y, z: origin.z }, rays });
  sfx.playLocal('shoot_' + local.weapon, 0.85);
  recoil();
  flashMuzzle();
  spawnImpact();
  fireSpread = Math.min(fireSpread + 6, 22);
  if (!w.automatic) firing = false;
  updateHud();
}

function startReload() {
  const w = weapons[local.weapon];
  if (!w || local.reloading || local.ammo >= w.magazine || local.reserve <= 0) return;
  local.reloading = true;
  local.reloadStart = performance.now(); local.reloadDur = w.reload;
  D('reload-msg').classList.remove('hidden');
  sfx.playLocal('reload', 0.8);
  const wkey = local.weapon; // si cambiás de arma a mitad de recarga, se cancela
  setTimeout(() => {
    if (local.weapon !== wkey || !local.reloading) return;
    const need = w.magazine - local.ammo;
    const take = Math.min(need, local.reserve);
    local.ammo += take; local.reserve -= take;
    local.reloading = false;
    D('reload-msg').classList.add('hidden');
    updateHud();
  }, w.reload);
}

// ============================================================================
//  HUD
// ============================================================================
function updateHud() {
  const w = weapons[local.weapon];
  if (_hud.weapon !== local.weapon) { D('weapon-name').textContent = w?.name || ''; _hud.weapon = local.weapon; }
  if (_hud.ammo !== local.ammo) {
    const el = D('ammo-cur'); el.textContent = local.ammo;
    const mag = weapons[local.weapon]?.magazine || 1;
    el.style.color = local.ammo === 0 ? '#e84545' : local.ammo <= mag * 0.25 ? '#f8a13c' : '';
    _hud.ammo = local.ammo;
  }
  if (_hud.reserve !== local.reserve) { D('ammo-res').textContent = local.reserve; _hud.reserve = local.reserve; }
  const scoreTxt = (latest.leaderId === selfId ? '👑 ' : '') + getMyScore();
  if (_hud.score !== scoreTxt) { D('score').textContent = scoreTxt; _hud.score = scoreTxt; }
  const meP = latest.players.find(p => p.id === selfId);
  const stk = meP?.streak || 0;
  if (_hud.streak !== stk) {
    _hud.streak = stk;
    const sb = D('streak-box');
    if (stk >= 2) { sb.classList.remove('hidden'); D('streak').textContent = stk; }
    else sb.classList.add('hidden');
  }
  if (_hud.health !== selfHealth || _hud.alive !== selfAlive) {
    const frac = Math.max(0, selfHealth / selfMaxHealth);
    const bar = D('health-bar');
    bar.style.width = (frac * 100) + '%';
    bar.style.background = frac > 0.5
      ? 'linear-gradient(90deg,#2ecc71,#38d66b)'
      : frac > 0.25 ? 'linear-gradient(90deg,#e0a800,#f8c537)'
      : 'linear-gradient(90deg,#c0392b,#e84545)';
    D('health-text').textContent = Math.ceil(selfHealth);
    document.body.classList.toggle('lowhp', selfAlive && frac > 0 && frac < 0.25);
    _hud.health = selfHealth; _hud.alive = selfAlive;
  }
}

function updateProtect() {
  const me = latest.players.find(p => p.id === selfId);
  const on = !!(me && me.protected && selfAlive);
  const el = D('protect-indicator');
  if (on) {
    if (!protectStart) protectStart = performance.now();
    const left = Math.max(0, 5 - (performance.now() - protectStart) / 1000);
    D('protect-time').textContent = left.toFixed(1) + 's';
    el.classList.remove('hidden');
    document.body.classList.add('protected');
  } else {
    protectStart = 0;
    el.classList.add('hidden');
    document.body.classList.remove('protected');
  }
}

// Indicador del power-up de daño x2 (con cuenta atrás)
function updateBoost() {
  const left = (boostUntil - performance.now()) / 1000;
  const el = D('boost-indicator');
  if (left > 0 && selfAlive) {
    D('boost-time').textContent = left.toFixed(1) + 's';
    el.classList.remove('hidden');
  } else el.classList.add('hidden');
}

function getMyScore() {
  const me = latest.players.find(p => p.id === selfId);
  return me ? me.score : 0;
}

function updateTimer() {
  const sec = Math.ceil(latest.timeLeft / 1000);
  const m = Math.floor(sec / 60), s = sec % 60;
  const el = D('timer');
  el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('urgent', sec <= 30);
  if (sec !== prevTimeSec) {
    if (latest.phase === 'playing' && sec === 60 && prevTimeSec === 61) { showToast('⏱ ¡Último minuto!'); sfx.playLocal('beep', 0.5); }
    if (latest.phase === 'playing' && sec <= 5 && sec > 0) sfx.playLocal('beep', 0.5);
    if (sec === 0 && prevTimeSec === 1) sfx.playLocal('beepEnd', 0.7);
    prevTimeSec = sec;
  }
}

let hitTimer = null;
function flashHitmarker(kill, head) {
  const hm = D('hitmarker');
  hm.classList.toggle('kill', !!kill);
  hm.classList.toggle('head', !!head);
  hm.classList.remove('hidden');
  hm.style.transform = 'translate(-50%,-50%) scale(1.5)';
  requestAnimationFrame(() => { hm.style.transform = 'translate(-50%,-50%) scale(1)'; });
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => hm.classList.add('hidden'), 220);
}
let dmgFlashTimer = null;
function healFlash() {
  const f = D('heal-flash');
  if (!f) return;
  f.style.opacity = '1';
  clearTimeout(dmgFlashTimer);
  dmgFlashTimer = setTimeout(() => { f.style.opacity = '0'; }, 200);
}
// Multi-eliminaciones (kills encadenados en una ventana corta)
let killTimes = [];
function registerKill() {
  const now = performance.now();
  killTimes = killTimes.filter(t => now - t < 4000);
  killTimes.push(now);
  const n = killTimes.length;
  if (n >= 2) {
    const labels = { 2: 'DOBLE', 3: 'TRIPLE', 4: 'CUÁDRUPLE' };
    multiKill(n >= 5 ? '¡MASACRE!' : (labels[n] || 'MULTI') + ' ELIMINACIÓN');
    sfx.playLocal('multi', Math.min(0.95, 0.55 + n * 0.1));
  }
}
function multiKill(text) {
  const el = D('multi-popup');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
// Selección de modo en el lobby (resalta el botón elegido)
function setMode(m, byUser) {
  chosenMode = m;
  currentMode = m;
  if (byUser) modePicked = true;
  const ffa = D('mode-ffa'), team = D('mode-teams'), duel = D('mode-duel'), jug = D('mode-jugg');
  if (ffa) ffa.classList.toggle('selected', m === 'ffa');
  if (team) team.classList.toggle('selected', m === 'teams');
  if (duel) duel.classList.toggle('selected', m === 'duel');
  if (jug) jug.classList.toggle('selected', m === 'juggernaut');
}

// Marcador por equipos (arriba) — solo visible en modo equipos
function updateTeamHud(s) {
  const box = D('team-scores');
  if (!box) return;
  if (s.mode !== 'teams') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const ts = s.teamScore || { A: 0, B: 0 };
  D('ts-a').textContent = ts.A;
  D('ts-b').textContent = ts.B;
  D('team-a').classList.toggle('mine', myTeam === 'A');
  D('team-b').classList.toggle('mine', myTeam === 'B');
}

// Interfaz del modo Duelo (espera / marcador de rondas / resultado)
function updateDuelUI(s) {
  const hud = D('duel-hud'), ov = D('duel-overlay');
  if (!hud || !ov) return;
  if (s.mode !== 'duel' || !s.duel) { hud.classList.add('hidden'); ov.classList.add('hidden'); return; }
  const d = s.duel;
  const me = d.scores.find(x => x.id === selfId), opp = d.scores.find(x => x.id !== selfId);
  const myWins = me ? me.wins : 0, oppWins = opp ? opp.wins : 0;
  if (d.state === 'playing') {
    hud.classList.remove('hidden'); ov.classList.add('hidden');
    D('duel-score').innerHTML = `TÚ <b>${myWins}</b> &nbsp;–&nbsp; <b>${oppWins}</b> ${opp ? esc(opp.name) : 'RIVAL'}`;
    D('duel-round').textContent = `Ronda ${d.round}/${d.total}`;
    return;
  }
  hud.classList.add('hidden'); ov.classList.remove('hidden');
  const sec = Math.ceil((d.countdown || 0) / 1000);
  let title = '', sub = '';
  if (d.state === 'waiting') {
    title = '⏳ Esperando oponente…';
    sub = `${d.scores.length}/2 jugadores · el duelo empieza cuando se conecten 2`;
  } else if (d.state === 'roundover') {
    title = `Ronda ${d.round}: ganó ${esc(d.lastWinner || '—')}`;
    sub = `Marcador ${myWins} – ${oppWins} · próxima ronda en ${sec}s`;
  } else if (d.state === 'matchover') {
    title = !d.winnerId ? '🤝 ¡Empate!' : (d.winnerId === selfId ? '🏆 ¡Ganaste el duelo!' : '💀 Perdiste el duelo');
    sub = `Resultado ${myWins} – ${oppWins} · volviendo al lobby en ${sec}s`;
  }
  D('duel-title').innerHTML = title;
  D('duel-sub').textContent = sub;
}

// Interfaz del modo Juggernaut (barra de vida del gigante + tiempo + resultado)
function updateJuggUI(s) {
  const hud = D('jugg-hud'), ov = D('jugg-overlay');
  if (!hud || !ov) return;
  if (s.mode !== 'juggernaut' || !s.jugg) { hud.classList.add('hidden'); ov.classList.add('hidden'); return; }
  const j = s.jugg;
  const iAmGiant = j.juggId === selfId;
  if (j.state === 'fighting') {
    hud.classList.remove('hidden'); ov.classList.add('hidden');
    const pct = j.juggMax ? Math.max(0, j.juggHealth / j.juggMax) * 100 : 0;
    D('jugg-bar-fill').style.width = pct + '%';
    D('jugg-bar-label').textContent = `👹 ${iAmGiant ? 'VOS' : esc(j.juggName)} · ${j.juggHealth}/${j.juggMax}`;
    const sec = Math.max(0, Math.ceil((j.timeLeft || 0) / 1000));
    D('jugg-timer').textContent = `⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const obj = D('jugg-objective');
    obj.textContent = iAmGiant
      ? '👹 ¡SOS EL JUGGERNAUT! Sobreviví hasta que se acabe el tiempo'
      : `🎯 Eliminá al Juggernaut antes de que se acabe el tiempo`;
    hud.classList.toggle('iamgiant', iAmGiant);
    return;
  }
  hud.classList.add('hidden'); ov.classList.remove('hidden');
  const sec = Math.max(0, Math.ceil((j.countdown || 0) / 1000));
  let title = '', cls = '';
  if (j.result === 'hunters') { title = iAmGiant ? '💀 Te eliminaron' : '🎉 ¡Los cazadores ganan!'; cls = iAmGiant ? 'lose' : 'win'; }
  else { title = iAmGiant ? '🏆 ¡Sobreviviste! Ganaste' : '👹 El Juggernaut sobrevivió'; cls = iAmGiant ? 'win' : 'lose'; }
  const t = D('jugg-ov-title'); t.textContent = title; t.className = cls;
  D('jugg-ov-sub').textContent = `Próxima ronda en ${sec}s…`;
}

function showToast(msg) {
  const el = D('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
// Banner de avisos (jugador entró/salió) — independiente de los toasts del juego
let notifyTimer = null;
function showNotify(msg) {
  const el = D('notify');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}
let dmgTimer = null;
function flashDamage() {
  const f = D('damage-flash');
  f.style.opacity = '1';
  clearTimeout(dmgTimer);
  dmgTimer = setTimeout(() => { f.style.opacity = '0'; }, 120);
}

function addKillFeed(k) {
  const feed = D('killfeed');
  const el = document.createElement('div');
  el.className = 'kill-entry';
  const tag = k.victimType === 'bot' ? ' [bot]' : '';
  el.innerHTML = `<span class="k">${esc(k.killer)}</span>${k.head ? ' 🎯' : ''} ➜ <span class="v">${esc(k.victim)}${tag}</span>`;
  feed.prepend(el);
  while (feed.children.length > 6) feed.removeChild(feed.lastChild);
  setTimeout(() => el.remove(), 5000);
}
function esc(s) { return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

function updateScoreboard() {
  const body = D('scoreboard-body');
  const rows = [...latest.players].sort((a, b) => b.score - a.score);
  body.innerHTML = rows.map((p, i) =>
    `<tr class="${p.id === selfId ? 'me' : ''}"><td>${i + 1}</td><td>${(latest.leaderId === p.id ? '👑 ' : '') + esc(p.name)}</td><td>${p.score}</td><td>${p.kills ?? 0}</td><td>${p.deaths}</td></tr>`
  ).join('');
}

// ============================================================================
//  Pantallas
// ============================================================================
let deathTimer = null;
function showDeath(by) {
  D('killer-name').textContent = by;
  D('death-screen').classList.remove('hidden');
  // cuenta atrás de reaparición (no soltamos el puntero: al reaparecer seguís jugando)
  const t0 = performance.now();
  clearInterval(deathTimer);
  deathTimer = setInterval(() => {
    const left = Math.max(0, 3 - (performance.now() - t0) / 1000);
    const el = D('respawn-count');
    if (el) el.textContent = left.toFixed(1);
    if (left <= 0) clearInterval(deathTimer);
  }, 100);
}
let dirTimer = null;
function showDamageDir(from) {
  if (!from) return;
  const dx = from.x - local.x, dz = from.z - local.z;
  if (!dx && !dz) return;
  camera.getWorldDirection(_dir);
  const rel = Math.atan2(dx, dz) - Math.atan2(_dir.x, _dir.z);
  const el = D('dmg-dir');
  el.style.transform = `translate(-50%,-50%) rotate(${rel}rad)`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function updateMenuVisibility() {
  const show = isMobile
    ? (menuOpen && joined)
    : (joined && selfAlive && !pointerLocked && latest.phase === 'playing');
  D('ingame-menu').classList.toggle('hidden', !show);
}

// Mirar con la cámara (móvil): rota la cámara como lo hace PointerLockControls
function applyLook(dx, dy) {
  _euler.setFromQuaternion(camera.quaternion);
  _euler.y -= dx * 0.0024 * sensitivity;
  _euler.x -= dy * 0.0024 * sensitivity;
  const lim = Math.PI / 2 - 0.02;
  _euler.x = Math.max(-lim, Math.min(lim, _euler.x));
  camera.quaternion.setFromEuler(_euler);
}

function setSensitivity(v) {
  sensitivity = Math.max(0.2, Math.min(3, v));
  localStorage.setItem('fps_sens', String(sensitivity));
  if (controls) controls.pointerSpeed = sensitivity;
}

function returnToLobby() {
  joined = false; menuOpen = false; firing = false; aiming = false; keys.crouch = false; boostUntil = 0; local.sliding = false;
  touchMove.x = 0; touchMove.y = 0;
  if (controls && pointerLocked) controls.unlock();
  for (const id of ['hud', 'crosshair', 'ingame-menu', 'scoreboard', 'death-screen', 'gameover-screen', 'touch-controls', 'btn-menu'])
    D(id).classList.add('hidden');
  document.body.classList.remove('aiming', 'lowhp', 'protected');
  D('menu').classList.remove('hidden');
}

function setupMenus() {
  const range = D('sens-range'), val = D('sens-val');
  range.value = sensitivity; val.textContent = sensitivity.toFixed(1);
  range.addEventListener('input', () => { setSensitivity(parseFloat(range.value)); val.textContent = sensitivity.toFixed(1); });
  D('im-resume').onclick = () => { if (isMobile) menuOpen = false; else controls.lock(); };
  D('im-lobby').onclick = () => returnToLobby();
  const bm = D('btn-menu');
  bm.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  bm.addEventListener('click', () => { menuOpen = true; });
}

// Controles táctiles: joystick (mover), arrastre (mirar) y botones de acción
function setupTouch() {
  const base = D('joystick'), knob = D('joy-knob');
  let joyId = null;
  base.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (joyId === null) joyId = e.changedTouches[0].identifier;
  }, { passive: false });
  base.addEventListener('touchmove', (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = base.getBoundingClientRect(), max = r.width / 2;
    const cx = r.left + max, cy = r.top + max;
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const mag = Math.hypot(dx, dy);
      if (mag > max) { dx = dx / mag * max; dy = dy / mag * max; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      touchMove.x = dx / max; touchMove.y = -dy / max;
    }
  }, { passive: false });
  const joyEnd = (e) => {
    for (const t of e.changedTouches) if (t.identifier === joyId) {
      joyId = null; touchMove.x = 0; touchMove.y = 0; knob.style.transform = 'translate(0,0)';
    }
  };
  base.addEventListener('touchend', joyEnd);
  base.addEventListener('touchcancel', joyEnd);

  // Mirar: toques que llegan a document (zonas libres; los controles cortan la propagación)
  let lookId = null, lx = 0, ly = 0;
  document.addEventListener('touchstart', (e) => {
    if (!isMobile || menuOpen || lookId !== null) return;
    const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (lookId === null || menuOpen) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      applyLook(t.clientX - lx, t.clientY - ly); lx = t.clientX; ly = t.clientY;
    }
  }, { passive: true });
  const lookEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
  document.addEventListener('touchend', lookEnd);
  document.addEventListener('touchcancel', lookEnd);

  // Botones de acción
  const press = (id, on, off) => {
    const el = D(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); on(); el.classList.add('pressed'); }, { passive: false });
    const end = (e) => { e.preventDefault(); e.stopPropagation(); if (off) off(); el.classList.remove('pressed'); };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  };
  press('btn-fire', () => { firing = true; tryShoot(); }, () => { firing = false; });
  press('btn-aim', () => { aiming = true; }, () => { aiming = false; });
  press('btn-jump', () => { keys.space = true; }, () => { keys.space = false; });
  { // agacharse es un toggle: el botón queda marcado mientras estés agachado
    const el = D('btn-crouch');
    el.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      keys.crouch = !keys.crouch;
      el.classList.toggle('pressed', keys.crouch);
    }, { passive: false });
  }
  press('btn-reload', () => startReload());
  press('btn-pickup', () => { if (nearbyPickup) socket.emit('pickup', nearbyPickup.id); });
}
function hideDeath() {
  D('death-screen').classList.add('hidden');
  clearInterval(deathTimer);
}
function showGameOver(ranking, mode, teamScore) {
  const body = D('final-body');
  body.innerHTML = ranking.map((p, i) =>
    `<tr class="${p.name === myName() ? 'me' : ''}"><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.score}</td><td>${p.kills ?? 0}</td><td>${p.deaths}</td></tr>`
  ).join('');
  if (mode === 'teams' && teamScore) {
    const a = teamScore.A, b = teamScore.B;
    const res = a === b ? '🤝 ¡Empate!'
      : (a > b ? '🔵 ¡Gana el Equipo Azul!' : '🔴 ¡Gana el Equipo Rojo!');
    D('winner').innerHTML = `${res}<br><span style="font-size:18px;opacity:.85">🔵 ${a} &nbsp;–&nbsp; ${b} 🔴</span>`;
  } else {
    const winner = ranking[0];
    D('winner').innerHTML = winner
      ? `🏆 Ganador: <b>${esc(winner.name)}</b> con ${winner.score} puntos`
      : 'Sin jugadores';
  }
  D('gameover-screen').classList.remove('hidden');
  if (controls) controls.unlock();
}
function myName() {
  const me = latest.players.find(p => p.id === selfId);
  return me?.name;
}

// ============================================================================
//  Entrada de teclado/ratón
// ============================================================================
function setupInput() {
  const dom = renderer.domElement;
  dom.addEventListener('click', () => { if (!isMobile && joined && selfAlive && !pointerLocked) controls.lock(); });

  document.addEventListener('mousedown', (e) => {
    if (!pointerLocked) return;
    if (e.button === 0) { firing = true; tryShoot(); }   // clic izq: disparar
    else if (e.button === 2) { aiming = true; }           // clic der: apuntar
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    else if (e.button === 2) aiming = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  // evitar teclas "trabadas" al perder el foco de la ventana (alt-tab, etc.)
  window.addEventListener('blur', () => {
    keys.w = keys.a = keys.s = keys.d = keys.space = keys.shift = keys.crouch = false;
    firing = false; touchMove.x = 0; touchMove.y = 0;
  });

  document.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'KeyW': keys.w = true; break;
      case 'KeyA': keys.a = true; break;
      case 'KeyS': keys.s = true; break;
      case 'KeyD': keys.d = true; break;
      case 'Space': keys.space = true; break;
      case 'ShiftLeft': case 'ShiftRight': keys.shift = true; break;
      case 'KeyC': case 'ControlLeft': keys.crouch = true; break;
      case 'KeyR': startReload(); break;
      case 'KeyE': if (nearbyPickup) socket.emit('pickup', nearbyPickup.id); break;
      case 'KeyM': muted = !muted; sfx.setVolume(muted ? 0 : 0.5); break;
      case 'Tab': e.preventDefault(); if (!joined) break; scoreboardOpen = true; D('scoreboard').classList.remove('hidden'); updateScoreboard(); break;
    }
  });
  document.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW': keys.w = false; break;
      case 'KeyA': keys.a = false; break;
      case 'KeyS': keys.s = false; break;
      case 'KeyD': keys.d = false; break;
      case 'Space': keys.space = false; break;
      case 'ShiftLeft': case 'ShiftRight': keys.shift = false; break;
      case 'KeyC': case 'ControlLeft': keys.crouch = false; break;
      case 'Tab': e.preventDefault(); scoreboardOpen = false; D('scoreboard').classList.add('hidden'); break;
    }
  });
}

// ============================================================================
//  Bucle de render
// ============================================================================
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const duelFrozen = latest.mode === 'duel' && latest.duel && latest.duel.state !== 'playing';
  const juggFrozen = latest.mode === 'juggernaut' && latest.jugg && latest.jugg.state !== 'fighting';
  inputOn = joined && selfAlive && !duelFrozen && !juggFrozen && (pointerLocked || (isMobile && !menuOpen));

  // métricas de rendimiento (FPS/ping) y marcador en vivo
  frames++; perfAcc += dt;
  if (perfAcc >= 0.5) {
    fps = Math.round(frames / perfAcc); frames = 0; perfAcc = 0;
    const ph = D('perf-hud');
    if (ph) ph.textContent = `${fps} FPS · ${pingMs} ms`;
    if (scoreboardOpen && joined) updateScoreboard();
  }

  if (joined) {
    updatePlayer(dt);
    updateAim(dt);
    if (firing && weapons[local.weapon]?.automatic) tryShoot();
    syncEntities();
    interpEntities(dt);
    syncPickups();
    syncDrops();
    updatePickups(dt);
    syncMedkits();
    updateMedkits(dt);
    updateAmmoCrates(dt);
    // power-up de daño x2 (orbe en la torre central)
    if (powerMesh) {
      powerMesh.visible = !!(latest.power && latest.power.active);
      powerMesh.rotation.y += dt * 1.5;
    }
    // anillos ascendentes de las plataformas de salto
    for (const r2 of padRings) {
      r2.position.y += dt * 2.2;
      r2.material.opacity = Math.max(0, 0.5 - r2.position.y * 0.16);
      if (r2.position.y > 3) r2.position.y = 0.1;
    }
    updateTracers(dt);
    const pulse = 1.2 + Math.sin(performance.now() / 500) * 0.4;
    for (const s of spinners) { s.rotation.y += dt * 0.8; s.material.emissiveIntensity = pulse; }
    updateMuzzle(dt);
    updateEffectLights(dt);
    updateSparks(dt);
    updateDebris(dt);
    updateDust(dt);
    updateTimer();
    updateHud();
    updateProtect();
    updateBoost();
    updateMenuVisibility();

    // mira dinámica (se abre al moverse/disparar)
    fireSpread = Math.max(0, fireSpread - dt * 40);
    const chSize = 14 + (isMoving ? (sprintActive ? 12 : 7) : 0) + fireSpread;
    const ch = D('crosshair');
    if (ch) { ch.style.width = chSize + 'px'; ch.style.height = chSize + 'px'; }

    // la mira se pone roja cuando hay un enemigo bajo el punto de mira
    enemyAcc += dt;
    if (enemyAcc > 0.12) {
      enemyAcc = 0;
      let onEnemy = false;
      raycaster.setFromCamera({ x: 0, y: 0 }, camera);
      raycaster.far = 160;
      const list = worldColliders.slice();
      for (const [, e2] of entities) if (e2.group.visible) list.push(e2.avatar);
      const hits = raycaster.intersectObjects(list, true);
      if (hits.length) {
        let o = hits[0].object;
        while (o && o !== scene) {
          if (o.userData && o.userData.isAvatar) {
            const isAlly = latest.mode === 'teams' && o.userData.team && o.userData.team === myTeam;
            onEnemy = !isAlly; // no marcar rojo sobre compañeros
            break;
          }
          o = o.parent;
        }
      }
      if (ch) ch.classList.toggle('enemy', onEnemy);
    }

    // anillo de progreso de recarga
    const rr = D('reload-ring');
    if (local.reloading) {
      const pr = Math.min(1, (performance.now() - local.reloadStart) / local.reloadDur);
      rr.style.background = `conic-gradient(var(--accent) ${pr * 360}deg, rgba(255,255,255,.12) 0deg)`;
      rr.classList.remove('hidden');
    } else rr.classList.add('hidden');

    // minimapa (refresco ~12 fps)
    miniAcc += dt; if (miniAcc > 0.08) { miniAcc = 0; drawMinimap(); }

    // mover el "oyente" de audio con la cámara (para el sonido posicional)
    camera.getWorldDirection(_dir);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    sfx.updateListener(camera.position.x, camera.position.y, camera.position.z,
      _dir.x, _dir.y, _dir.z, _up.x, _up.y, _up.z);
  }

  renderer.render(scene, camera);
}

// ============================================================================
//  Menú de inicio
// ============================================================================
(function buildMenu() {
  const SVG = {
    pistol: '<svg viewBox="0 0 64 32" fill="currentColor"><rect x="12" y="9" width="26" height="7" rx="1.5"/><rect x="36" y="10" width="11" height="4"/><rect x="15" y="15" width="8" height="13" rx="1.5"/></svg>',
    rifle: '<svg viewBox="0 0 64 32" fill="currentColor"><rect x="8" y="11" width="40" height="6" rx="1.5"/><rect x="46" y="12.5" width="14" height="3"/><rect x="3" y="12" width="7" height="6" rx="1.5"/><rect x="22" y="16" width="7" height="11" rx="1.5"/><rect x="17" y="7.5" width="3" height="4"/></svg>',
    shotgun: '<svg viewBox="0 0 64 32" fill="currentColor"><rect x="20" y="10" width="38" height="3.2" rx="1.5"/><rect x="20" y="14.6" width="38" height="3.2" rx="1.5"/><rect x="26" y="18" width="11" height="4" rx="1.5"/><rect x="6" y="11" width="14" height="7" rx="1.5"/><rect x="13" y="16" width="6" height="10" rx="1.5"/></svg>',
  };
  const STARTERS = [
    { key: 'pistol',  name: 'Pistola',  color: '#f1c40f', tag: 'Equilibrada y precisa', dmg: .5,  rof: .5,  rng: .65 },
    { key: 'rifle',   name: 'Rifle',    color: '#2ecc71', tag: 'Automática y versátil', dmg: .55, rof: .92, rng: .8 },
    { key: 'shotgun', name: 'Escopeta', color: '#e67e22', tag: 'Demoledora de cerca',    dmg: .9,  rof: .25, rng: .28 },
  ];
  const bar = (label, f) => `<div class="wbar"><span>${label}</span><i><b style="width:${Math.round(f * 100)}%"></b></i></div>`;
  let chosen = null;
  const wrap = D('weapon-choices');
  STARTERS.forEach(w => {
    const el = document.createElement('div');
    el.className = 'weapon-opt';
    el.innerHTML = `
      <div class="wicon" style="color:${w.color}">${SVG[w.key]}</div>
      <div class="wname">${w.name}</div>
      <div class="wtag">${w.tag}</div>
      <div class="wbars">${bar('DAÑO', w.dmg)}${bar('CADENCIA', w.rof)}${bar('ALCANCE', w.rng)}</div>`;
    el.onclick = () => {
      sfx.init(); sfx.playLocal('ui', 0.4);
      chosen = w.key;
      [...wrap.children].forEach(c => c.classList.remove('selected'));
      el.classList.add('selected');
      const btn = D('play-btn');
      btn.disabled = false; btn.textContent = 'JUGAR';
    };
    wrap.appendChild(el);
  });

  // selector de modo de juego
  const mffa = D('mode-ffa'), mteam = D('mode-teams'), mduel = D('mode-duel'), mjug = D('mode-jugg');
  if (mffa) mffa.onclick = () => { sfx.init(); sfx.playLocal('ui', 0.4); setMode('ffa', true); };
  if (mteam) mteam.onclick = () => { sfx.init(); sfx.playLocal('ui', 0.4); setMode('teams', true); };
  if (mduel) mduel.onclick = () => { sfx.init(); sfx.playLocal('ui', 0.4); setMode('duel', true); };
  if (mjug) mjug.onclick = () => { sfx.init(); sfx.playLocal('ui', 0.4); setMode('juggernaut', true); };
  setMode('ffa'); // por defecto

  D('play-btn').onclick = () => {
    if (!chosen) return;
    sfx.init(); sfx.playLocal('ui', 0.5);
    const name = D('name-input').value.trim() || 'Jugador';
    socket.emit('join', { name, weapon: chosen, mode: chosenMode });
  };
})();
