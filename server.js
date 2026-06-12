// ============================================================================
//  SERVIDOR AUTORITATIVO - FPS Multijugador
//  DOS partidas independientes y simultáneas: 'ffa' (todos contra todos) y
//  'teams' (2 equipos). Cada una con su propio mapa, bots, pickups y puntajes.
//  Los jugadores se enrutan por salas de Socket.IO según el modo que eligen.
// ============================================================================
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false, lastModified: false,
  setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

const PORT = process.env.PORT || 3000;

// ----------------------------- Configuración --------------------------------
const TICK_MS = 33;
const MATCH_DURATION = 5 * 60 * 1000;
const PLAYER_HP = 200;
const BOT_HP = 100;
const BOT_COUNT = 12;                     // bots por partida
const PLAYER_RESPAWN = 3000;
const BOT_RESPAWN = 4000;
const PICKUP_RESPAWN = 15000;
const MEDKIT_HEAL = 60;
const MEDKIT_RESPAWN = 12000;
const HEADSHOT_MULT = 2;
const SPAWN_PROTECT = 5000;
const EYE = 1.7;
const SCORE_PER_PLAYER = 10;
const SCORE_PER_BOT = 1;
const BOT_VISION = 45;
const BOT_SPEED = 5;
const POWER_DURATION = 15000;
const POWER_RESPAWN = 30000;

const BOT_WEAPONS = {
  pistol:  { damage: 8,  fireMs: 600,  range: 40 },
  rifle:   { damage: 7,  fireMs: 300,  range: 46 },
  shotgun: { damage: 18, fireMs: 950,  range: 18 },
  smg:     { damage: 5,  fireMs: 190,  range: 34 },
  sniper:  { damage: 34, fireMs: 1700, range: 55 },
};
const BOT_WEAPON_POOL = ['rifle', 'rifle', 'rifle', 'smg', 'smg', 'shotgun', 'shotgun', 'pistol', 'sniper'];
const randomBotWeapon = () => BOT_WEAPON_POOL[Math.floor(Math.random() * BOT_WEAPON_POOL.length)];

const WEAPONS = {
  pistol:  { name: 'Pistola',  damage: 25, fireRate: 320,  automatic: false, pellets: 1, spread: 0.012, range: 80,  magazine: 12, reload: 1100, reserve: 96,  color: 0xf1c40f, starter: true },
  rifle:   { name: 'Rifle',    damage: 18, fireRate: 105,  automatic: true,  pellets: 1, spread: 0.022, range: 100, magazine: 30, reload: 1800, reserve: 120, color: 0x2ecc71, starter: true },
  shotgun: { name: 'Escopeta', damage: 12, fireRate: 800,  automatic: false, pellets: 8, spread: 0.085, range: 32,  magazine: 6,  reload: 2200, reserve: 36,  color: 0xe67e22, starter: true },
  smg:     { name: 'SMG',      damage: 14, fireRate: 78,   automatic: true,  pellets: 1, spread: 0.030, range: 65,  magazine: 25, reload: 1500, reserve: 150, color: 0x3498db },
  sniper:  { name: 'Sniper',   damage: 95, fireRate: 1300, automatic: false, pellets: 1, spread: 0.002, range: 200, magazine: 5,  reload: 2600, reserve: 25,  color: 0x9b59b6 },
};

// ==================== MAPAS (uno por modo de juego) =========================
const MAP_SIZE = 100;

// --- Mapa 1: ARENA (Todos contra todos) ---
const OBST_FFA = [
  { x: 0, z: 0, w: 8, d: 8, h: 6 },
  { x: 18, z: 18, w: 6, d: 6, h: 5 }, { x: -18, z: 18, w: 6, d: 6, h: 5 },
  { x: 18, z: -18, w: 6, d: 6, h: 5 }, { x: -18, z: -18, w: 6, d: 6, h: 5 },
  { x: 0, z: 28, w: 24, d: 2, h: 4 }, { x: 0, z: -28, w: 24, d: 2, h: 4 },
  { x: 28, z: 0, w: 2, d: 24, h: 4 }, { x: -28, z: 0, w: 2, d: 24, h: 4 },
  { x: 10, z: 0, w: 3, d: 3, h: 2.5 }, { x: -10, z: 0, w: 3, d: 3, h: 2.5 },
  { x: 0, z: 10, w: 3, d: 3, h: 2.5 }, { x: 0, z: -10, w: 3, d: 3, h: 2.5 },
  { x: 35, z: 35, w: 5, d: 5, h: 4 }, { x: -35, z: 35, w: 5, d: 5, h: 4 },
  { x: 35, z: -35, w: 5, d: 5, h: 4 }, { x: -35, z: -35, w: 5, d: 5, h: 4 },
  { x: 24, z: 24, w: 3, d: 3, h: 2.5 }, { x: -24, z: 24, w: 3, d: 3, h: 2.5 },
  { x: 24, z: -24, w: 3, d: 3, h: 2.5 }, { x: -24, z: -24, w: 3, d: 3, h: 2.5 },
  { x: 9, z: 9, w: 2, d: 2, h: 4 }, { x: -9, z: 9, w: 2, d: 2, h: 4 },
  { x: 9, z: -9, w: 2, d: 2, h: 4 }, { x: -9, z: -9, w: 2, d: 2, h: 4 },
  { x: 30, z: 16, w: 2, d: 12, h: 4 }, { x: -30, z: 16, w: 2, d: 12, h: 4 },
  { x: 30, z: -16, w: 2, d: 12, h: 4 }, { x: -30, z: -16, w: 2, d: 12, h: 4 },
  { x: 0, z: 16, w: 7, d: 1.5, h: 2 }, { x: 0, z: -16, w: 7, d: 1.5, h: 2 },
  { x: 16, z: 0, w: 1.5, d: 7, h: 2 }, { x: -16, z: 0, w: 1.5, d: 7, h: 2 },
];
const SPAWNS_FFA = [
  { x: 40, z: 40 }, { x: -40, z: 40 }, { x: 40, z: -40 }, { x: -40, z: -40 },
  { x: 0, z: 42 }, { x: 0, z: -42 }, { x: 42, z: 0 }, { x: -42, z: 0 },
  { x: 24, z: 4 }, { x: -24, z: 4 }, { x: 4, z: 24 }, { x: 4, z: -24 },
];

// --- Mapa 2: FRENTE (Batalla en equipos) — simétrico, dos bases en ±Z ---
const OBST_TEAMS = [
  { x: 0, z: 0, w: 8, d: 8, h: 6 },                 // torre central (power-up)
  { x: 0, z: 40, w: 22, d: 2, h: 4 },               // base A (z+)
  { x: -11, z: 35, w: 2, d: 12, h: 4 }, { x: 11, z: 35, w: 2, d: 12, h: 4 },
  { x: 0, z: -40, w: 22, d: 2, h: 4 },              // base B (z-)
  { x: -11, z: -35, w: 2, d: 12, h: 4 }, { x: 11, z: -35, w: 2, d: 12, h: 4 },
  { x: 18, z: 14, w: 5, d: 5, h: 4 }, { x: -18, z: 14, w: 5, d: 5, h: 4 }, // cobertura media
  { x: 18, z: -14, w: 5, d: 5, h: 4 }, { x: -18, z: -14, w: 5, d: 5, h: 4 },
  { x: 0, z: 19, w: 6, d: 2, h: 3 }, { x: 0, z: -19, w: 6, d: 2, h: 3 },
  { x: 34, z: 0, w: 2, d: 34, h: 5 }, { x: -34, z: 0, w: 2, d: 34, h: 5 }, // muros laterales
  { x: 12, z: 0, w: 3, d: 3, h: 2.5 }, { x: -12, z: 0, w: 3, d: 3, h: 2.5 },
  { x: 25, z: 26, w: 4, d: 4, h: 3.5 }, { x: -25, z: 26, w: 4, d: 4, h: 3.5 },
  { x: 25, z: -26, w: 4, d: 4, h: 3.5 }, { x: -25, z: -26, w: 4, d: 4, h: 3.5 },
  { x: 8, z: 28, w: 3, d: 3, h: 2.5 }, { x: -8, z: 28, w: 3, d: 3, h: 2.5 },
  { x: 8, z: -28, w: 3, d: 3, h: 2.5 }, { x: -8, z: -28, w: 3, d: 3, h: 2.5 },
];
const SPAWNS_TEAMS_A = [{ x: 0, z: 45 }, { x: -8, z: 43 }, { x: 8, z: 43 }, { x: -16, z: 41 }, { x: 16, z: 41 }, { x: 0, z: 38 }];
const SPAWNS_TEAMS_B = [{ x: 0, z: -45 }, { x: -8, z: -43 }, { x: 8, z: -43 }, { x: -16, z: -41 }, { x: 16, z: -41 }, { x: 0, z: -38 }];

// --- Mapa 3: ARENA DE DUELO (1 vs 1) — compacto y simétrico, dos lados ---
const OBST_DUEL = [
  { x: 0, z: 0, w: 7, d: 7, h: 4 },
  { x: -14, z: 0, w: 3, d: 10, h: 3.5 }, { x: 14, z: 0, w: 3, d: 10, h: 3.5 },
  { x: 0, z: 14, w: 10, d: 2, h: 3 }, { x: 0, z: -14, w: 10, d: 2, h: 3 },
  { x: -22, z: 18, w: 4, d: 4, h: 3 }, { x: 22, z: 18, w: 4, d: 4, h: 3 },
  { x: -22, z: -18, w: 4, d: 4, h: 3 }, { x: 22, z: -18, w: 4, d: 4, h: 3 },
  { x: -10, z: 28, w: 3, d: 3, h: 2.5 }, { x: 10, z: 28, w: 3, d: 3, h: 2.5 },
  { x: -10, z: -28, w: 3, d: 3, h: 2.5 }, { x: 10, z: -28, w: 3, d: 3, h: 2.5 },
  { x: -28, z: 0, w: 2, d: 22, h: 4 }, { x: 28, z: 0, w: 2, d: 22, h: 4 },
];
const DUEL_SPAWN_A = { x: 0, z: 40 };
const DUEL_SPAWN_B = { x: 0, z: -40 };

function buildAABBs(obst) {
  return obst.map(o => ({ minx: o.x - o.w / 2, maxx: o.x + o.w / 2, minz: o.z - o.d / 2, maxz: o.z + o.d / 2, miny: 0, maxy: o.h }));
}
const MAPS = {
  ffa: {
    theme: 'arena',
    obstacles: OBST_FFA, aabbs: buildAABBs(OBST_FFA), spawns: SPAWNS_FFA,
    jumppads: [{ x: 13, z: 0 }, { x: -13, z: 0 }, { x: 0, z: 13 }, { x: 0, z: -13 }],
    powerPos: { x: 0, z: 0, minY: 5.2 },
    pickupSpawns: [
      { id: 'p0', x: 13, z: 13, weapon: 'smg' }, { id: 'p1', x: -13, z: -13, weapon: 'sniper' },
      { id: 'p2', x: 13, z: -13, weapon: 'shotgun' }, { id: 'p3', x: -13, z: 13, weapon: 'rifle' },
      { id: 'p4', x: 0, z: 38, weapon: 'sniper' }, { id: 'p5', x: 0, z: -38, weapon: 'smg' },
      { id: 'p6', x: 38, z: 0, weapon: 'shotgun' }, { id: 'p7', x: -38, z: 0, weapon: 'pistol' },
    ],
    medkitSpawns: [{ id: 'm0', x: 22, z: 0 }, { id: 'm1', x: -22, z: 0 }, { id: 'm2', x: 0, z: 22 }, { id: 'm3', x: 0, z: -22 }],
    ammocrates: [{ x: 27, z: 27 }, { x: -27, z: -27 }],
  },
  teams: {
    theme: 'frente',
    obstacles: OBST_TEAMS, aabbs: buildAABBs(OBST_TEAMS), spawns: [...SPAWNS_TEAMS_A, ...SPAWNS_TEAMS_B],
    spawnsA: SPAWNS_TEAMS_A, spawnsB: SPAWNS_TEAMS_B,
    jumppads: [{ x: 10, z: 0 }, { x: -10, z: 0 }, { x: 0, z: 10 }, { x: 0, z: -10 }],
    powerPos: { x: 0, z: 0, minY: 5.2 },
    pickupSpawns: [
      { id: 'p0', x: 20, z: 0, weapon: 'sniper' }, { id: 'p1', x: -20, z: 0, weapon: 'sniper' },
      { id: 'p2', x: 0, z: 24, weapon: 'shotgun' }, { id: 'p3', x: 0, z: -24, weapon: 'shotgun' },
      { id: 'p4', x: 28, z: 22, weapon: 'smg' }, { id: 'p5', x: -28, z: -22, weapon: 'smg' },
      { id: 'p6', x: 28, z: -22, weapon: 'rifle' }, { id: 'p7', x: -28, z: 22, weapon: 'rifle' },
    ],
    medkitSpawns: [{ id: 'm0', x: 0, z: 30 }, { id: 'm1', x: 0, z: -30 }, { id: 'm2', x: 26, z: 0 }, { id: 'm3', x: -26, z: 0 }],
    ammocrates: [{ x: 26, z: 8 }, { x: -26, z: -8 }],
  },
  duel: {
    theme: 'duelo',
    obstacles: OBST_DUEL, aabbs: buildAABBs(OBST_DUEL), spawns: [DUEL_SPAWN_A, DUEL_SPAWN_B],
    jumppads: [], powerPos: { x: 0, z: 0, minY: 999 }, // sin power-up en el duelo
    pickupSpawns: [{ id: 'p0', x: -8, z: 0, weapon: 'sniper' }, { id: 'p1', x: 8, z: 0, weapon: 'shotgun' }],
    medkitSpawns: [{ id: 'm0', x: 0, z: 9 }, { id: 'm1', x: 0, z: -9 }],
    ammocrates: [{ x: -20, z: 0 }, { x: 20, z: 0 }],
  },
};
const DUEL_ROUNDS = 5;
const DUEL_ROUND_GAP = 3500;    // pausa entre rondas
const DUEL_END_GAP = 6000;      // mostrar resultado antes de volver al lobby
const DUEL_ROUND_INVULN = 1500; // breve inmunidad al empezar la ronda

// ------------------------------ Utilidades ----------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

function normalize(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return -1;
  return -b - Math.sqrt(h);
}
function rayAABB(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < 1e-8) { if (ox < b.minx || ox > b.maxx) return -1; }
  else { let t1 = (b.minx - ox) / dx, t2 = (b.maxx - ox) / dx; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  if (Math.abs(dy) < 1e-8) { if (oy < b.miny || oy > b.maxy) return -1; }
  else { let t1 = (b.miny - oy) / dy, t2 = (b.maxy - oy) / dy; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  if (Math.abs(dz) < 1e-8) { if (oz < b.minz || oz > b.maxz) return -1; }
  else { let t1 = (b.minz - oz) / dz, t2 = (b.maxz - oz) / dz; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  return tmin;
}
function obstacleBlocks(aabbs, ox, oy, oz, dx, dy, dz, maxDist) {
  for (const b of aabbs) { const t = rayAABB(ox, oy, oz, dx, dy, dz, b, maxDist); if (t >= 0 && t < maxDist) return true; }
  return false;
}
function segBlocked(aabbs, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const ndx = dx / len, ndz = dz / len;
  for (const b of aabbs) { const t = rayAABB(ax, 1.4, az, ndx, 0, ndz, b, len); if (t >= 0 && t < len) return true; }
  return false;
}
function resolve(obst, px, pz, r) {
  for (let iter = 0; iter < 2; iter++) {
    for (const o of obst) {
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
function pointClear(obst, x, z, r) {
  if (x < -49 || x > 49 || z < -49 || z > 49) return false;
  for (const o of obst) {
    if (x > o.x - o.w / 2 - r && x < o.x + o.w / 2 + r && z > o.z - o.d / 2 - r && z < o.z + o.d / 2 + r) return false;
  }
  return true;
}
function avoidDir(map, b, dx, dz) {
  const probe = 3.5, base = Math.atan2(dx, dz);
  for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
    const a = base + off, ndx = Math.sin(a), ndz = Math.cos(a);
    const tx = b.x + ndx * probe, tz = b.z + ndz * probe;
    if (pointClear(map.obstacles, tx, tz, 1.0) && !segBlocked(map.aabbs, b.x, b.z, tx, tz)) return { x: ndx, z: ndz };
  }
  return { x: dx, z: dz };
}
function randomWander(map) {
  for (let i = 0; i < 10; i++) {
    const x = rand(-46, 46), z = rand(-46, 46);
    if (pointClear(map.obstacles, x, z, 1.5)) return { x, z };
  }
  return { x: rand(-46, 46), z: rand(-46, 46) };
}

// --------------------------- Estado del juego -------------------------------
const players = new Map();   // socketId -> jugador (cada uno tiene .mode)

function spawnPoint(g, team) {
  const m = g.map;
  if (g.mode === 'teams' && team && m.spawnsA && m.spawnsB) {
    const arr = team === 'A' ? m.spawnsA : m.spawnsB;
    return arr[Math.floor(Math.random() * arr.length)];
  }
  return m.spawns[Math.floor(Math.random() * m.spawns.length)];
}
let botSeq = 0;
function spawnBot(g) {
  const s = spawnPoint(g);
  return {
    id: 'bot' + (botSeq++), name: 'BOT', x: s.x, y: 0, z: s.z, ry: Math.random() * Math.PI * 2,
    health: BOT_HP, alive: true, target: null, wander: randomWander(g.map), weapon: randomBotWeapon(),
    lastShot: 0, respawnAt: 0, lastHurtBy: null, stuck: 0, detourUntil: 0, detourDir: { x: 0, z: 0 },
    strafe: 1, strafeFlip: 0, team: null,
  };
}
function playersIn(g) { return [...players.values()].filter(p => p.mode === g.mode); }

// --- Equipos (por partida) ---
function smallerTeam(g) {
  let a = 0, b = 0;
  for (const p of playersIn(g)) { if (p.team === 'A') a++; else if (p.team === 'B') b++; }
  return a <= b ? 'A' : 'B';
}
function assignTeams(g) {
  let i = 0;
  for (const p of playersIn(g)) p.team = (i++ % 2 === 0) ? 'A' : 'B';
  g.bots.forEach((bt, idx) => { bt.team = (idx % 2 === 0) ? 'A' : 'B'; });
}
function clearTeams(g) {
  for (const p of playersIn(g)) p.team = null;
  for (const b of g.bots) b.team = null;
}
function sameTeam(g, t1, t2) { return g.mode === 'teams' && t1 && t1 === t2; }

function createGame(mode) {
  const map = MAPS[mode];
  const g = {
    mode, map, bots: [],
    pickups: map.pickupSpawns.map(p => ({ ...p, active: true, respawnAt: 0 })),
    medkits: map.medkitSpawns.map(m => ({ ...m, active: true, respawnAt: 0 })),
    drops: [], dropSeq: 0,
    power: { active: true, respawnAt: 0 },
    teamScore: { A: 0, B: 0 },
    matchEnd: Date.now() + MATCH_DURATION, phase: 'playing',
  };
  for (let i = 0; i < BOT_COUNT; i++) g.bots.push(spawnBot(g));
  if (mode === 'teams') assignTeams(g);
  return g;
}

// Ajusta la cantidad de bots: total combatientes ≈ BOT_COUNT.
// Cada jugador que entra "ocupa el lugar" de un bot; al salir, el bot vuelve.
function adjustBots(g) {
  if (!g || g.mode === 'duel') return;
  const desired = Math.max(0, BOT_COUNT - playersIn(g).length);
  while (g.bots.length > desired) {                 // quitar (preferir bots muertos)
    const di = g.bots.findIndex(b => !b.alive);
    g.bots.splice(di >= 0 ? di : g.bots.length - 1, 1);
  }
  while (g.bots.length < desired) g.bots.push(spawnBot(g)); // reponer
  if (g.mode === 'teams') g.bots.forEach((b, idx) => { b.team = idx % 2 === 0 ? 'A' : 'B'; });
}
function createDuelGame() {
  const map = MAPS.duel;
  return {
    mode: 'duel', map, bots: [],
    pickups: map.pickupSpawns.map(p => ({ ...p, active: true, respawnAt: 0 })),
    medkits: map.medkitSpawns.map(m => ({ ...m, active: true, respawnAt: 0 })),
    drops: [], dropSeq: 0, power: { active: false, respawnAt: Infinity }, teamScore: { A: 0, B: 0 },
    matchEnd: 0, phase: 'playing',
    duelState: 'waiting', round: 0, total: DUEL_ROUNDS, sides: {}, timer: 0,
    lastWinnerName: null, finalWinnerId: null,
  };
}
const games = { ffa: createGame('ffa'), teams: createGame('teams'), duel: createDuelGame() };
const gameOf = (p) => games[p.mode] || games.ffa;

// ----------------------------- Daño y muertes -------------------------------
function applyDamage(g, type, ent, dmg, attacker, head = false) {
  if (!ent.alive) return 0;
  if (type === 'player') {
    if (ent.god) return 0;
    if (!attacker.god && Date.now() < (ent.invulnUntil || 0)) return 0;
  }
  ent.health -= dmg;
  ent.lastHurtBy = { id: attacker.id, isPlayer: attacker.isPlayer, head };
  if (type === 'player') {
    let from = null;
    if (attacker.isPlayer) { const a = players.get(attacker.id); if (a) from = { x: a.x, z: a.z }; }
    else { const a = g.bots.find(b => b.id === attacker.id); if (a) from = { x: a.x, z: a.z }; }
    io.to(ent.id).emit('damaged', { health: Math.max(0, ent.health), from });
  }
  if (ent.health <= 0) { ent.health = 0; ent.alive = false; handleKill(g, type, ent); }
  return dmg;
}

function handleKill(g, victimType, victim) {
  const by = victim.lastHurtBy;
  const points = victimType === 'player' ? SCORE_PER_PLAYER : SCORE_PER_BOT;
  let killerName = 'Mundo', killerTeam = null;
  if (by) {
    if (by.isPlayer) {
      const killer = players.get(by.id);
      if (killer) {
        killer.score += points;
        killer.kills = (killer.kills || 0) + 1;
        killer.streak = (killer.streak || 0) + 1;
        killerName = killer.name; killerTeam = killer.team;
        if (g.mode !== 'duel' && [3, 5, 8, 10, 15, 20].includes(killer.streak)) {
          io.to(g.mode).emit('announce', { text: `🔥 ${killer.name} lleva una racha de ${killer.streak}` });
        }
      }
    } else {
      killerName = 'BOT';
      const kb = g.bots.find(x => x.id === by.id);
      killerTeam = kb ? kb.team : null;
    }
    if (g.mode === 'teams' && killerTeam) g.teamScore[killerTeam] += points;
  }
  io.to(g.mode).emit('killfeed', { killer: killerName, victim: victim.name || 'BOT', victimType, head: !!(by && by.head) });
  if (victimType === 'player') {
    victim.deaths = (victim.deaths || 0) + 1;
    victim.streak = 0;
    if (g.mode === 'duel') return; // el duelo maneja la muerte por rondas (sin respawn ni death-screen)
    victim.respawnAt = Date.now() + PLAYER_RESPAWN;
    io.to(victim.id).emit('died', { by: killerName });
  } else {
    victim.respawnAt = Date.now() + BOT_RESPAWN;
    if (Math.random() < 0.45) {
      g.drops.push({ id: 'drop' + (g.dropSeq++), x: victim.x, z: victim.z, weapon: victim.weapon, until: Date.now() + 12000 });
      if (g.drops.length > 10) g.drops.shift();
    }
  }
}

function respawnPlayer(g, p) {
  const s = spawnPoint(g, p.team);
  p.x = s.x; p.z = s.z; p.y = 0;
  p.health = PLAYER_HP; p.alive = true;
  p.weapon = p.startWeapon; p.lastHurtBy = null;
  p.invulnUntil = Date.now() + SPAWN_PROTECT;
  io.to(p.id).emit('respawn', { x: p.x, y: p.y, z: p.z, weapon: p.weapon });
}

// ------------------------------ Disparo -------------------------------------
function handleShot(g, shooter, weaponKey, origin, rays) {
  const w = WEAPONS[weaponKey];
  if (!w) return [];
  if (g.mode === 'duel' && g.duelState !== 'playing') return []; // sin daño fuera de la ronda
  const results = [];
  const ps = playersIn(g);
  const list = rays.slice(0, w.pellets);
  for (const r of list) {
    const d = normalize(r);
    let best = null, bestT = w.range;
    const test = (ent, type) => {
      const tHead = raySphere(origin, d, { x: ent.x, y: ent.y + 1.75, z: ent.z }, 0.42);
      const tBody = raySphere(origin, d, { x: ent.x, y: ent.y + 1.0, z: ent.z }, 0.95);
      let t = -1, head = false;
      if (tHead > 0 && (tBody <= 0 || tHead < tBody)) { t = tHead; head = true; }
      else if (tBody > 0) { t = tBody; }
      if (t > 0 && t < bestT) { bestT = t; best = { type, ent, head }; }
    };
    for (const p of ps) { if (p.id === shooter.id || !p.alive || sameTeam(g, shooter.team, p.team)) continue; test(p, 'player'); }
    for (const b of g.bots) { if (!b.alive || sameTeam(g, shooter.team, b.team)) continue; test(b, 'bot'); }
    if (best && !obstacleBlocks(g.map.aabbs, origin.x, origin.y, origin.z, d.x, d.y, d.z, bestT)) {
      const base = shooter.god ? 99999 : w.damage * (shooter.boosted ? 2 : 1);
      const dmg = base * (best.head ? HEADSHOT_MULT : 1);
      const dealt = applyDamage(g, best.type, best.ent, dmg, shooter, best.head);
      if (dealt > 0) results.push({ type: best.type, id: best.ent.id, killed: !best.ent.alive, dmg: dealt, head: best.head });
    }
  }
  return results;
}

// ------------------------------- IA de bots ---------------------------------
function updateBots(g, dt) {
  const now = Date.now();
  const ps = playersIn(g);
  for (const b of g.bots) {
    if (!b.alive) {
      if (now >= b.respawnAt) {
        const s = spawnPoint(g, b.team);
        b.x = s.x; b.z = s.z; b.y = 0; b.health = BOT_HP; b.alive = true;
        b.target = null; b.lastHurtBy = null; b.stuck = 0; b.detourUntil = 0; b.wander = randomWander(g.map);
        b.weapon = randomBotWeapon();
      }
      continue;
    }
    let target = null, bd = BOT_VISION;
    const consider = (ent, type) => {
      if (!ent.alive) return;
      if (sameTeam(g, b.team, ent.team)) return;
      const dx = ent.x - b.x, dz = ent.z - b.z, dist = Math.hypot(dx, dz);
      if (dist < bd && !segBlocked(g.map.aabbs, b.x, b.z, ent.x, ent.z)) { bd = dist; target = { ent, type, dist, dx, dz }; }
    };
    for (const p of ps) consider(p, 'player');
    for (const other of g.bots) if (other !== b) consider(other, 'bot');

    const bw = BOT_WEAPONS[b.weapon] || BOT_WEAPONS.rifle;
    let mvx = 0, mvz = 0, wantMove = false;
    if (target) {
      const reach = Math.min(bw.range, BOT_VISION);
      const ideal = reach * 0.7, near = reach * 0.4, inv = 1 / (target.dist || 1);
      if (target.dist > ideal) { mvx = target.dx * inv; mvz = target.dz * inv; wantMove = true; }
      else if (target.dist < near) { mvx = -target.dx * inv; mvz = -target.dz * inv; wantMove = true; }
      else {
        if (now > (b.strafeFlip || 0)) { b.strafe = Math.random() < 0.5 ? 1 : -1; b.strafeFlip = now + 1200 + Math.random() * 1600; }
        mvx = -target.dz * inv * b.strafe; mvz = target.dx * inv * b.strafe; wantMove = true;
      }
      if (target.dist < bw.range && now - b.lastShot > bw.fireMs) {
        b.lastShot = now;
        const hitChance = Math.max(0.16, 1 - target.dist / bw.range) * 0.72;
        if (Math.random() < hitChance) applyDamage(g, target.type, target.ent, bw.damage, { id: b.id, isPlayer: false });
        io.to(g.mode).emit('tracer', { x: b.x, y: 1.4, z: b.z, tx: target.ent.x, ty: target.ent.y + 1.2, tz: target.ent.z, weapon: b.weapon });
      }
    } else {
      const dx = b.wander.x - b.x, dz = b.wander.z - b.z, dist = Math.hypot(dx, dz);
      if (dist < 2) b.wander = randomWander(g.map);
      else { mvx = dx / dist; mvz = dz / dist; wantMove = true; }
    }

    if (wantMove) {
      let hx, hz;
      if (now < b.detourUntil) { hx = b.detourDir.x; hz = b.detourDir.z; }
      else { const a = avoidDir(g.map, b, mvx, mvz); hx = a.x; hz = a.z; }
      const sp = BOT_SPEED * dt;
      const res = resolve(g.map.obstacles, b.x + hx * sp, b.z + hz * sp, 0.6);
      const nx = clamp(res.x, -49, 49), nz = clamp(res.z, -49, 49);
      const moved = Math.hypot(nx - b.x, nz - b.z);
      b.x = nx; b.z = nz;
      if (!target) b.ry = Math.atan2(hx, hz);
      if (moved < sp * 0.35) {
        b.stuck += dt;
        if (b.stuck > 0.35 && now >= b.detourUntil) {
          const side = Math.random() < 0.5 ? 1 : -1;
          b.detourDir = { x: hz * side, z: -hx * side };
          b.detourUntil = now + 600; b.stuck = 0;
          if (!target) b.wander = randomWander(g.map);
        }
      } else b.stuck = 0;
    }
    if (target) b.ry = Math.atan2(target.dx, target.dz);
  }
}

// ---------------------------- Fin/reinicio ----------------------------------
function endMatch(g) {
  g.phase = 'over';
  const ranking = playersIn(g)
    .map(p => ({ name: p.name, score: p.score, kills: p.kills || 0, deaths: p.deaths || 0 }))
    .sort((a, b) => b.score - a.score);
  io.to(g.mode).emit('gameover', { ranking, mode: g.mode, teamScore: g.teamScore });
  setTimeout(() => resetMatch(g), 12000);
}
function resetMatch(g) {
  for (const p of playersIn(g)) { p.score = 0; p.deaths = 0; p.kills = 0; p.streak = 0; p.boostUntil = 0; respawnPlayer(g, p); }
  for (const b of g.bots) { const s = spawnPoint(g, b.team); b.x = s.x; b.z = s.z; b.health = BOT_HP; b.alive = true; }
  g.drops = [];
  g.power = { active: true, respawnAt: 0 };
  g.teamScore = { A: 0, B: 0 };
  if (g.mode === 'teams') assignTeams(g); else clearTeams(g);
  g.matchEnd = Date.now() + MATCH_DURATION;
  g.phase = 'playing';
  io.to(g.mode).emit('matchstart', {});
}

// ----------------------------- Bucle principal ------------------------------
function updateGame(g, dt) {
  const now = Date.now();
  if (g.phase === 'playing') {
    updateBots(g, dt);
    for (const p of playersIn(g)) if (!p.alive && now >= p.respawnAt) respawnPlayer(g, p);
    for (const pk of g.pickups) if (!pk.active && now >= pk.respawnAt) pk.active = true;
    for (const mk of g.medkits) if (!mk.active && now >= mk.respawnAt) mk.active = true;
    if (g.drops.length) g.drops = g.drops.filter(d => d.until > now);
    if (!g.power.active && now >= g.power.respawnAt) {
      g.power.active = true;
      io.to(g.mode).emit('announce', { text: '⚡ DAÑO x2 disponible en la torre central' });
    }
    if (g.power.active) {
      const pp = g.map.powerPos;
      for (const p of playersIn(g)) {
        if (!p.alive || p.y < pp.minY) continue;
        if (Math.abs(p.x - pp.x) < 2.4 && Math.abs(p.z - pp.z) < 2.4) {
          g.power.active = false; g.power.respawnAt = now + POWER_RESPAWN;
          p.boostUntil = now + POWER_DURATION;
          io.to(p.id).emit('boost', { ms: POWER_DURATION });
          io.to(g.mode).emit('announce', { text: `⚡ ${p.name} consiguió DAÑO x2` });
          break;
        }
      }
    }
    if (g.matchEnd - now <= 0) endMatch(g);
  }
  broadcastState(g);
}

// --------------------------- Modo Duelo (1 vs 1) ----------------------------
function duelSpawn(side) { return side === 'A' ? DUEL_SPAWN_A : DUEL_SPAWN_B; }

function startDuelMatch(g) {
  const ps = playersIn(g);
  if (ps.length < 2) { g.duelState = 'waiting'; return; }
  g.sides = {}; g.sides[ps[0].id] = 'A'; g.sides[ps[1].id] = 'B';
  for (const p of ps) { p.duelWins = 0; p.score = 0; p.kills = 0; p.deaths = 0; }
  g.round = 0; g.finalWinnerId = null;
  startDuelRound(g);
}
function startDuelRound(g) {
  g.round++;
  g.duelState = 'playing';
  for (const p of playersIn(g)) {
    const s = duelSpawn(g.sides[p.id] || 'A');
    p.x = s.x; p.z = s.z; p.y = 0; p.health = PLAYER_HP; p.alive = true;
    p.weapon = p.startWeapon; p.lastHurtBy = null;
    p.invulnUntil = Date.now() + DUEL_ROUND_INVULN;
    io.to(p.id).emit('respawn', { x: p.x, y: p.y, z: p.z, weapon: p.weapon });
  }
  for (const pk of g.pickups) { pk.active = true; pk.respawnAt = 0; }
  g.drops = [];
  io.to('duel').emit('announce', { text: `🎯 Ronda ${g.round} de ${g.total} — ¡pelea!` });
}
function endDuelRound(g, winnerId) {
  const ps = playersIn(g);
  const winner = players.get(winnerId);
  if (winner) { winner.duelWins = (winner.duelWins || 0) + 1; g.lastWinnerName = winner.name; }
  const needed = Math.floor(g.total / 2) + 1; // 3 de 5
  const champ = ps.find(p => (p.duelWins || 0) >= needed);
  if (champ || g.round >= g.total) {
    g.duelState = 'matchover';
    let win = ps[0];
    for (const p of ps) if ((p.duelWins || 0) > (win?.duelWins || 0)) win = p;
    // empate (puede pasar si se jugaron las 5 y quedan iguales): sin ganador
    const tie = ps.length === 2 && (ps[0].duelWins || 0) === (ps[1].duelWins || 0);
    g.finalWinnerId = tie ? null : (win ? win.id : null);
    g.timer = Date.now() + DUEL_END_GAP;
  } else {
    g.duelState = 'roundover';
    g.timer = Date.now() + DUEL_ROUND_GAP;
  }
}
function resetDuel(g) {
  g.duelState = 'waiting'; g.round = 0; g.sides = {}; g.finalWinnerId = null; g.lastWinnerName = null; g.timer = 0;
  g.drops = [];
  for (const pk of g.pickups) { pk.active = true; pk.respawnAt = 0; }
  for (const mk of g.medkits) { mk.active = true; mk.respawnAt = 0; }
}
function expelDuelPlayers(g) {
  for (const p of playersIn(g)) {
    io.to(p.id).emit('returnLobby', {});
    const sock = io.sockets.sockets.get(p.id);
    if (sock) sock.leave('duel');
    players.delete(p.id);
  }
  resetDuel(g);
  sendCounts();
}
function updateDuel(g, dt) {
  const now = Date.now();
  const ps = playersIn(g);
  if (g.duelState === 'playing') {
    const dead = ps.find(p => !p.alive);
    if (dead && ps.length === 2) {
      const winnerId = ps.find(p => p.id !== dead.id).id;
      endDuelRound(g, winnerId);
    }
    for (const pk of g.pickups) if (!pk.active && now >= pk.respawnAt) pk.active = true;
    for (const mk of g.medkits) if (!mk.active && now >= mk.respawnAt) mk.active = true;
    if (g.drops.length) g.drops = g.drops.filter(d => d.until > now);
  } else if (g.duelState === 'roundover') {
    if (now >= g.timer) startDuelRound(g);
  } else if (g.duelState === 'matchover') {
    if (now >= g.timer) expelDuelPlayers(g);
  }
  broadcastDuelState(g);
}
function broadcastDuelState(g) {
  const ps = playersIn(g);
  const scores = ps.map(p => ({ id: p.id, name: p.name, wins: p.duelWins || 0 }));
  const fw = g.finalWinnerId ? players.get(g.finalWinnerId) : null;
  const duel = {
    state: g.duelState, round: g.round, total: g.total, needed: 2,
    scores, lastWinner: g.lastWinnerName,
    countdown: (g.duelState === 'roundover' || g.duelState === 'matchover') ? Math.max(0, g.timer - Date.now()) : 0,
    winnerId: g.finalWinnerId, winnerName: fw ? fw.name : (g.duelState === 'matchover' ? 'Empate' : null),
  };
  io.to('duel').emit('state', {
    players: ps.map(playerObj), bots: [], pickups: g.pickups.map(p => ({ id: p.id, x: p.x, z: p.z, weapon: p.weapon, active: p.active })),
    medkits: g.medkits.map(m => ({ id: m.id, x: m.x, z: m.z, active: m.active })),
    drops: g.drops.map(d => ({ id: d.id, x: d.x, z: d.z, weapon: d.weapon, until: d.until })),
    leaderId: null, power: { active: false }, mode: 'duel', teamScore: { A: 0, B: 0 }, duel, timeLeft: 0, phase: 'playing',
  });
}

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  updateGame(games.ffa, dt);
  updateGame(games.teams, dt);
  updateDuel(games.duel, dt);
}, TICK_MS);

function playerObj(p) {
  return { id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, ry: p.ry, health: p.health,
    maxHealth: PLAYER_HP, weapon: p.weapon, score: p.score, alive: p.alive, deaths: p.deaths || 0,
    kills: p.kills || 0, streak: p.streak || 0, boosted: Date.now() < (p.boostUntil || 0),
    team: p.team, protected: Date.now() < (p.invulnUntil || 0) };
}
function broadcastState(g) {
  const ps = [];
  let leaderId = null, ls = 0;
  for (const p of playersIn(g)) {
    ps.push(playerObj(p));
    if (p.score > ls) { ls = p.score; leaderId = p.id; }
  }
  const bs = g.bots.map(b => ({ id: b.id, x: b.x, y: b.y, z: b.z, ry: b.ry, health: b.health, maxHealth: BOT_HP, alive: b.alive, weapon: b.weapon, team: b.team }));
  const pk = g.pickups.map(p => ({ id: p.id, x: p.x, z: p.z, weapon: p.weapon, active: p.active }));
  const mk = g.medkits.map(m => ({ id: m.id, x: m.x, z: m.z, active: m.active }));
  const dr = g.drops.map(d => ({ id: d.id, x: d.x, z: d.z, weapon: d.weapon, until: d.until }));
  io.to(g.mode).emit('state', { players: ps, bots: bs, pickups: pk, medkits: mk, drops: dr, leaderId, power: { active: g.power.active }, mode: g.mode, teamScore: g.teamScore, timeLeft: Math.max(0, g.matchEnd - Date.now()), phase: g.phase });
}

// Contadores de jugadores por modo (para el lobby)
function modeCounts() {
  let ffa = 0, teams = 0, duel = 0;
  for (const [, p] of players) { if (p.mode === 'teams') teams++; else if (p.mode === 'duel') duel++; else ffa++; }
  return { ffa, teams, duel };
}
function sendCounts() { io.emit('counts', modeCounts()); }

// ------------------------------- Sockets ------------------------------------
io.on('connection', (socket) => {
  socket.emit('counts', modeCounts());

  socket.on('join', (data) => {
    const weapon = WEAPONS[data?.weapon]?.starter ? data.weapon : 'pistol';
    let mode = data?.mode;
    if (mode !== 'teams' && mode !== 'duel') mode = 'ffa';
    // Duelo: capacidad máxima 2 — si ya están los dos, no se puede unir
    if (mode === 'duel' && playersIn(games.duel).length >= 2) { socket.emit('duelFull', {}); return; }
    const g = games[mode];
    socket.leave('ffa'); socket.leave('teams'); socket.leave('duel'); socket.join(mode);
    const s = spawnPoint(g);
    const p = {
      id: socket.id, name: (String(data?.name || 'Jugador')).slice(0, 16) || 'Jugador', mode,
      x: s.x, y: 0, z: s.z, ry: 0, health: PLAYER_HP, alive: true,
      weapon, startWeapon: weapon, score: 0, deaths: 0, kills: 0, streak: 0, duelWins: 0, lastHurtBy: null, lastShot: 0,
      invulnUntil: Date.now() + SPAWN_PROTECT, team: null,
      god: String(data?.name || '').trim() === '6767',
    };
    players.set(socket.id, p);
    if (mode === 'teams') { p.team = smallerTeam(g); const sp2 = spawnPoint(g, p.team); p.x = sp2.x; p.z = sp2.z; }
    if (mode !== 'duel') adjustBots(g); // el jugador ocupa el lugar de un bot
    socket.to(mode).emit('notify', { text: `👋 ${p.name} se unió a la partida`, kind: 'join' });
    sendCounts();
    socket.emit('init', {
      selfId: socket.id,
      map: { size: MAP_SIZE, obstacles: g.map.obstacles, eye: EYE, jumppads: g.map.jumppads, ammocrates: g.map.ammocrates, theme: g.map.theme },
      weapons: WEAPONS, spawn: { x: p.x, y: p.y, z: p.z }, weapon, mode,
      timeLeft: Math.max(0, g.matchEnd - Date.now()), phase: g.phase,
    });
    // Duelo: si ya están los 2, arranca la partida; si no, queda esperando
    if (mode === 'duel') { if (playersIn(g).length >= 2) startDuelMatch(g); else g.duelState = 'waiting'; }
  });

  socket.on('input', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !d) return;
    if (typeof d.x === 'number') { p.x = d.x; p.y = d.y; p.z = d.z; p.ry = d.ry; }
  });

  socket.on('shoot', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || !d?.origin) return;
    const w = WEAPONS[p.weapon];
    if (!w) return;
    const now = Date.now();
    if (now - p.lastShot < w.fireRate * 0.6) return;
    p.lastShot = now;
    const g = gameOf(p);
    const hits = handleShot(g, { id: p.id, isPlayer: true, god: p.god, boosted: now < (p.boostUntil || 0), team: p.team }, p.weapon, d.origin, d.rays || []);
    if (hits.length) socket.emit('hit', { hits });
    const r0 = d.rays?.[0] || { x: 0, y: 0, z: -1 };
    socket.to(p.mode).emit('tracer', {
      x: d.origin.x, y: d.origin.y, z: d.origin.z,
      tx: d.origin.x + r0.x * w.range, ty: d.origin.y + r0.y * w.range, tz: d.origin.z + r0.z * w.range,
      weapon: p.weapon,
    });
  });

  socket.on('pickup', (id) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    const g = gameOf(p);
    const pk = g.pickups.find(x => x.id === id);
    if (pk && pk.active && Math.hypot(pk.x - p.x, pk.z - p.z) < 3) {
      pk.active = false; pk.respawnAt = Date.now() + PICKUP_RESPAWN;
      p.weapon = pk.weapon; socket.emit('weaponPickup', { weapon: pk.weapon });
      return;
    }
    const di = g.drops.findIndex(x => x.id === id);
    if (di >= 0 && Math.hypot(g.drops[di].x - p.x, g.drops[di].z - p.z) < 3) {
      p.weapon = g.drops[di].weapon; g.drops.splice(di, 1);
      socket.emit('weaponPickup', { weapon: p.weapon });
    }
  });

  socket.on('medkit', (id) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || p.health >= PLAYER_HP) return;
    const mk = gameOf(p).medkits.find(x => x.id === id);
    if (!mk || !mk.active) return;
    if (Math.hypot(mk.x - p.x, mk.z - p.z) < 2.5) {
      mk.active = false; mk.respawnAt = Date.now() + MEDKIT_RESPAWN;
      p.health = Math.min(PLAYER_HP, p.health + MEDKIT_HEAL);
      socket.emit('healed', { health: p.health });
    }
  });

  socket.on('pingcheck', (t) => socket.emit('pongcheck', t));

  function leaveGame() {
    const p = players.get(socket.id);
    if (!p) return;
    socket.to(p.mode).emit('notify', { text: `👋 ${p.name} salió de la partida`, kind: 'leave' });
    players.delete(socket.id);
    if (p.mode === 'duel') {
      const g = games.duel, rest = playersIn(g);
      if (g.duelState !== 'waiting' && rest.length < 2) {
        for (const other of rest) {
          io.to(other.id).emit('announce', { text: '🏆 Ganaste: tu rival abandonó el duelo' });
          io.to(other.id).emit('returnLobby', {});
          const sk = io.sockets.sockets.get(other.id); if (sk) sk.leave('duel');
          players.delete(other.id);
        }
        resetDuel(g);
      } else if (rest.length === 0) resetDuel(g);
    } else {
      adjustBots(games[p.mode]); // al salir el jugador, vuelve un bot
    }
    sendCounts();
  }
  socket.on('leave', leaveGame);
  socket.on('disconnect', leaveGame);
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
  }
  console.log(`\n  FPS Multijugador escuchando en el puerto ${PORT}`);
  console.log(`  En esta PC:        http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Desde el celular:  http://${ip}:${PORT}   (misma red Wi-Fi)`);
  console.log('');
});
