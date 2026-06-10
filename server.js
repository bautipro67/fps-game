// ============================================================================
//  SERVIDOR AUTORITATIVO - FPS Multijugador
//  Maneja: jugadores, bots con IA, daño/vidas, pickups, puntajes y temporizador
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
  setHeaders: (res) => res.set('Cache-Control', 'no-store'), // siempre la última versión
}));

const PORT = process.env.PORT || 3000;

// ----------------------------- Configuración --------------------------------
const TICK_MS = 33;                       // ~30 ticks por segundo
const MATCH_DURATION = 5 * 60 * 1000;     // 5 minutos de partida
const PLAYER_HP = 200;                    // vida de los jugadores
const BOT_HP = 100;                       // vida de los bots
const BOT_COUNT = 12;                     // bots controlados por la IA
const PLAYER_RESPAWN = 3000;
const BOT_RESPAWN = 4000;
const PICKUP_RESPAWN = 15000;
const MEDKIT_HEAL = 60;                    // curación de un botiquín
const MEDKIT_RESPAWN = 12000;
const HEADSHOT_MULT = 2;                   // daño x2 a la cabeza
const SPAWN_PROTECT = 5000;               // inmunidad al daño al (re)aparecer
const EYE = 1.7;                          // altura de los ojos

// Puntajes
const SCORE_PER_PLAYER = 10;              // eliminar a un jugador = +10
const SCORE_PER_BOT = 1;                  // eliminar a un bot = +1

// IA de los bots
const BOT_VISION = 45;
const BOT_SPEED = 5;

// Cada bot lleva un arma distinta (stats ajustados para que sean justos)
const BOT_WEAPONS = {
  pistol:  { damage: 8,  fireMs: 600,  range: 40 },
  rifle:   { damage: 7,  fireMs: 300,  range: 46 },
  shotgun: { damage: 18, fireMs: 950,  range: 18 },
  smg:     { damage: 5,  fireMs: 190,  range: 34 },
  sniper:  { damage: 34, fireMs: 1700, range: 55 },
};
// Mezcla: rifle el más común, algo de smg/escopeta, pocos pistola/sniper
const BOT_WEAPON_POOL = ['rifle', 'rifle', 'rifle', 'smg', 'smg', 'shotgun', 'shotgun', 'pistol', 'sniper'];
const randomBotWeapon = () => BOT_WEAPON_POOL[Math.floor(Math.random() * BOT_WEAPON_POOL.length)];

// ------------------------------- Armas --------------------------------------
// Las 3 iniciales: pistol, rifle, shotgun. El resto se encuentran en el mapa.
const WEAPONS = {
  pistol:  { name: 'Pistola',  damage: 25, fireRate: 320,  automatic: false, pellets: 1, spread: 0.012, range: 80,  magazine: 12, reload: 1100, reserve: 96,  color: 0xf1c40f, starter: true },
  rifle:   { name: 'Rifle',    damage: 18, fireRate: 105,  automatic: true,  pellets: 1, spread: 0.022, range: 100, magazine: 30, reload: 1800, reserve: 120, color: 0x2ecc71, starter: true },
  shotgun: { name: 'Escopeta', damage: 12, fireRate: 800,  automatic: false, pellets: 8, spread: 0.085, range: 32,  magazine: 6,  reload: 2200, reserve: 36,  color: 0xe67e22, starter: true },
  smg:     { name: 'SMG',      damage: 14, fireRate: 78,   automatic: true,  pellets: 1, spread: 0.030, range: 65,  magazine: 25, reload: 1500, reserve: 150, color: 0x3498db },
  sniper:  { name: 'Sniper',   damage: 95, fireRate: 1300, automatic: false, pellets: 1, spread: 0.002, range: 200, magazine: 5,  reload: 2600, reserve: 25,  color: 0x9b59b6 },
};

// -------------------------------- Mapa --------------------------------------
const MAP_SIZE = 100; // arena de -50..50
const OBST = [
  { x: 0,   z: 0,   w: 8, d: 8, h: 6 },
  { x: 18,  z: 18,  w: 6, d: 6, h: 5 },
  { x: -18, z: 18,  w: 6, d: 6, h: 5 },
  { x: 18,  z: -18, w: 6, d: 6, h: 5 },
  { x: -18, z: -18, w: 6, d: 6, h: 5 },
  { x: 0,   z: 28,  w: 24, d: 2, h: 4 },
  { x: 0,   z: -28, w: 24, d: 2, h: 4 },
  { x: 28,  z: 0,   w: 2,  d: 24, h: 4 },
  { x: -28, z: 0,   w: 2,  d: 24, h: 4 },
  { x: 10,  z: 0,   w: 3, d: 3, h: 2.5 },
  { x: -10, z: 0,   w: 3, d: 3, h: 2.5 },
  { x: 0,   z: 10,  w: 3, d: 3, h: 2.5 },
  { x: 0,   z: -10, w: 3, d: 3, h: 2.5 },
  { x: 35,  z: 35,  w: 5, d: 5, h: 4 },
  { x: -35, z: 35,  w: 5, d: 5, h: 4 },
  { x: 35,  z: -35, w: 5, d: 5, h: 4 },
  { x: -35, z: -35, w: 5, d: 5, h: 4 },
  // --- obstáculos extra: más cobertura y variedad ---
  { x: 24,  z: 24,  w: 3, d: 3, h: 2.5 },   // cajas diagonales medias
  { x: -24, z: 24,  w: 3, d: 3, h: 2.5 },
  { x: 24,  z: -24, w: 3, d: 3, h: 2.5 },
  { x: -24, z: -24, w: 3, d: 3, h: 2.5 },
  { x: 9,   z: 9,   w: 2, d: 2, h: 4 },     // pilares pequeños interiores
  { x: -9,  z: 9,   w: 2, d: 2, h: 4 },
  { x: 9,   z: -9,  w: 2, d: 2, h: 4 },
  { x: -9,  z: -9,  w: 2, d: 2, h: 4 },
  { x: 30,  z: 16,  w: 2, d: 12, h: 4 },    // muros de carril laterales
  { x: -30, z: 16,  w: 2, d: 12, h: 4 },
  { x: 30,  z: -16, w: 2, d: 12, h: 4 },
  { x: -30, z: -16, w: 2, d: 12, h: 4 },
  { x: 0,   z: 16,  w: 7, d: 1.5, h: 2 },   // muretes bajos del anillo interior
  { x: 0,   z: -16, w: 7, d: 1.5, h: 2 },
  { x: 16,  z: 0,   w: 1.5, d: 7, h: 2 },
  { x: -16, z: 0,   w: 1.5, d: 7, h: 2 },
];
const AABBS = OBST.map(o => ({
  minx: o.x - o.w / 2, maxx: o.x + o.w / 2,
  minz: o.z - o.d / 2, maxz: o.z + o.d / 2,
  miny: 0, maxy: o.h,
}));

const SPAWNS = [
  { x: 40, z: 40 }, { x: -40, z: 40 }, { x: 40, z: -40 }, { x: -40, z: -40 },
  { x: 0, z: 42 }, { x: 0, z: -42 }, { x: 42, z: 0 }, { x: -42, z: 0 },
  { x: 24, z: 4 }, { x: -24, z: 4 }, { x: 4, z: 24 }, { x: 4, z: -24 },
];

const PICKUP_SPAWNS = [
  { id: 'p0', x: 13,  z: 13,  weapon: 'smg' },
  { id: 'p1', x: -13, z: -13, weapon: 'sniper' },
  { id: 'p2', x: 13,  z: -13, weapon: 'shotgun' },
  { id: 'p3', x: -13, z: 13,  weapon: 'rifle' },
  { id: 'p4', x: 0,   z: 38,  weapon: 'sniper' },
  { id: 'p5', x: 0,   z: -38, weapon: 'smg' },
  { id: 'p6', x: 38,  z: 0,   weapon: 'shotgun' },
  { id: 'p7', x: -38, z: 0,   weapon: 'pistol' },
];

const MEDKIT_SPAWNS = [
  { id: 'm0', x: 22, z: 0 }, { id: 'm1', x: -22, z: 0 },
  { id: 'm2', x: 0, z: 22 }, { id: 'm3', x: 0, z: -22 },
];

// Plataformas de salto (impulsan al jugador hacia arriba)
const JUMP_PADS = [
  { x: 13, z: 0 }, { x: -13, z: 0 }, { x: 0, z: 13 }, { x: 0, z: -13 },
];

// Power-up de DAÑO x2: aparece en lo alto de la torre central
const POWER_POS = { x: 0, z: 0, minY: 5.2 };
const POWER_DURATION = 15000;
const POWER_RESPAWN = 30000;
let power = { active: true, respawnAt: 0 };

// ------------------------------ Utilidades ----------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randomSpawn = () => SPAWNS[Math.floor(Math.random() * SPAWNS.length)];

function normalize(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

// Intersección rayo-esfera: devuelve t (distancia) o -1
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return -1;
  return -b - Math.sqrt(h);
}

// Intersección rayo-AABB (slab): devuelve t de entrada o -1
function rayAABB(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT;
  // X
  if (Math.abs(dx) < 1e-8) { if (ox < b.minx || ox > b.maxx) return -1; }
  else { let t1 = (b.minx - ox) / dx, t2 = (b.maxx - ox) / dx; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  // Y
  if (Math.abs(dy) < 1e-8) { if (oy < b.miny || oy > b.maxy) return -1; }
  else { let t1 = (b.miny - oy) / dy, t2 = (b.maxy - oy) / dy; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  // Z
  if (Math.abs(dz) < 1e-8) { if (oz < b.minz || oz > b.maxz) return -1; }
  else { let t1 = (b.minz - oz) / dz, t2 = (b.maxz - oz) / dz; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  return tmin;
}

// ¿Hay un obstáculo bloqueando el disparo antes de maxDist?
function obstacleBlocks(ox, oy, oz, dx, dy, dz, maxDist) {
  for (const b of AABBS) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, b, maxDist);
    if (t >= 0 && t < maxDist) return true;
  }
  return false;
}

// ¿Hay un obstáculo en la línea de visión (2D, a la altura del pecho)?
function segBlocked(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const ndx = dx / len, ndz = dz / len;
  for (const b of AABBS) {
    const t = rayAABB(ax, 1.4, az, ndx, 0, ndz, b, len);
    if (t >= 0 && t < len) return true;
  }
  return false;
}

// Empuja una posición fuera de los obstáculos (colisión XZ con radio)
function resolve(px, pz, r) {
  for (let iter = 0; iter < 2; iter++) {
    for (const o of OBST) {
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

// ¿Está el punto libre de obstáculos (con margen) y dentro de la arena?
function pointClear(x, z, r) {
  if (x < -49 || x > 49 || z < -49 || z > 49) return false;
  for (const o of OBST) {
    if (x > o.x - o.w / 2 - r && x < o.x + o.w / 2 + r &&
        z > o.z - o.d / 2 - r && z < o.z + o.d / 2 + r) return false;
  }
  return true;
}

// Esquive: busca la dirección más cercana a la deseada que tenga el paso libre
function avoidDir(b, dx, dz) {
  const probe = 3.5;
  const base = Math.atan2(dx, dz);
  for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
    const a = base + off;
    const ndx = Math.sin(a), ndz = Math.cos(a);
    const tx = b.x + ndx * probe, tz = b.z + ndz * probe;
    if (pointClear(tx, tz, 1.0) && !segBlocked(b.x, b.z, tx, tz)) return { x: ndx, z: ndz };
  }
  return { x: dx, z: dz };
}

// Punto de vagabundeo aleatorio que no caiga dentro de un obstáculo
function randomWander() {
  for (let i = 0; i < 10; i++) {
    const x = rand(-46, 46), z = rand(-46, 46);
    if (pointClear(x, z, 1.5)) return { x, z };
  }
  return { x: rand(-46, 46), z: rand(-46, 46) };
}

// --------------------------- Estado del juego -------------------------------
const players = new Map();   // socketId -> jugador
const bots = [];
const pickups = PICKUP_SPAWNS.map(p => ({ ...p, active: true, respawnAt: 0 }));
const medkits = MEDKIT_SPAWNS.map(m => ({ ...m, active: true, respawnAt: 0 }));
let drops = [];      // armas soltadas por bots (temporales)
let dropSeq = 0;
let matchEnd = Date.now() + MATCH_DURATION;
let phase = 'playing';       // 'playing' | 'over'

function spawnBot(i) {
  const s = randomSpawn();
  return {
    id: 'bot' + i, name: 'BOT', x: s.x, y: 0, z: s.z, ry: Math.random() * Math.PI * 2,
    health: BOT_HP, alive: true, target: null, wander: randomWander(), weapon: randomBotWeapon(),
    lastShot: 0, respawnAt: 0, lastHurtBy: null, stuck: 0, detourUntil: 0, detourDir: { x: 0, z: 0 },
    strafe: 1, strafeFlip: 0,
  };
}
for (let i = 0; i < BOT_COUNT; i++) bots.push(spawnBot(i));

// ----------------------------- Daño y muertes -------------------------------
function applyDamage(type, ent, dmg, attacker, head = false) {
  if (!ent.alive) return 0;
  if (type === 'player') {
    if (ent.god) return 0;                                                  // jugador invencible
    if (!attacker.god && Date.now() < (ent.invulnUntil || 0)) return 0;     // inmunidad de reaparición
  }
  ent.health -= dmg;
  ent.lastHurtBy = { id: attacker.id, isPlayer: attacker.isPlayer, head };
  if (type === 'player') {
    let from = null;
    if (attacker.isPlayer) { const a = players.get(attacker.id); if (a) from = { x: a.x, z: a.z }; }
    else { const a = bots.find(b => b.id === attacker.id); if (a) from = { x: a.x, z: a.z }; }
    io.to(ent.id).emit('damaged', { health: Math.max(0, ent.health), from });
  }
  if (ent.health <= 0) {
    ent.health = 0;
    ent.alive = false;
    handleKill(type, ent);
  }
  return dmg;
}

function handleKill(victimType, victim) {
  const by = victim.lastHurtBy;
  let killerName = 'Mundo';
  if (by) {
    if (by.isPlayer) {
      const killer = players.get(by.id);
      if (killer) {
        killer.score += (victimType === 'player' ? SCORE_PER_PLAYER : SCORE_PER_BOT);
        killer.kills = (killer.kills || 0) + 1;
        killer.streak = (killer.streak || 0) + 1;
        killerName = killer.name;
        if ([3, 5, 8, 10, 15, 20].includes(killer.streak)) {
          io.emit('announce', { text: `🔥 ${killer.name} lleva una racha de ${killer.streak}` });
        }
      }
    } else {
      killerName = 'BOT';
    }
  }
  io.emit('killfeed', { killer: killerName, victim: victim.name || 'BOT', victimType, head: !!(by && by.head) });
  victim.respawnAt = Date.now() + (victimType === 'player' ? PLAYER_RESPAWN : BOT_RESPAWN);
  if (victimType === 'player') {
    victim.deaths = (victim.deaths || 0) + 1;
    victim.streak = 0;
    io.to(victim.id).emit('died', { by: killerName });
  }
  // los bots a veces sueltan su arma como pickup temporal
  if (victimType === 'bot' && Math.random() < 0.45) {
    drops.push({ id: 'drop' + (dropSeq++), x: victim.x, z: victim.z, weapon: victim.weapon, until: Date.now() + 12000 });
    if (drops.length > 10) drops.shift();
  }
}

function respawnPlayer(p) {
  const s = randomSpawn();
  p.x = s.x; p.z = s.z; p.y = 0;
  p.health = PLAYER_HP; p.alive = true;
  p.weapon = p.startWeapon; p.lastHurtBy = null;
  p.invulnUntil = Date.now() + SPAWN_PROTECT;
  io.to(p.id).emit('respawn', { x: p.x, y: p.y, z: p.z, weapon: p.weapon });
}

// ------------------------------ Disparo -------------------------------------
function handleShot(shooter, weaponKey, origin, rays) {
  const w = WEAPONS[weaponKey];
  if (!w) return [];
  const results = [];
  const list = rays.slice(0, w.pellets); // anti-trampa: no más rayos que perdigones
  for (const r of list) {
    const d = normalize(r);
    let best = null, bestT = w.range;
    const test = (ent, type) => {
      const tHead = raySphere(origin, d, { x: ent.x, y: ent.y + 1.75, z: ent.z }, 0.42); // cabeza
      const tBody = raySphere(origin, d, { x: ent.x, y: ent.y + 1.0, z: ent.z }, 0.95);   // cuerpo
      let t = -1, head = false;
      if (tHead > 0 && (tBody <= 0 || tHead < tBody)) { t = tHead; head = true; }
      else if (tBody > 0) { t = tBody; }
      if (t > 0 && t < bestT) { bestT = t; best = { type, ent, head }; }
    };
    for (const [id, p] of players) { if (id === shooter.id || !p.alive) continue; test(p, 'player'); }
    for (const b of bots) { if (!b.alive) continue; test(b, 'bot'); }
    if (best && !obstacleBlocks(origin.x, origin.y, origin.z, d.x, d.y, d.z, bestT)) {
      const base = shooter.god ? 99999 : w.damage * (shooter.boosted ? 2 : 1);
      const dmg = base * (best.head ? HEADSHOT_MULT : 1);
      const dealt = applyDamage(best.type, best.ent, dmg, shooter, best.head);
      if (dealt > 0) results.push({ type: best.type, id: best.ent.id, killed: !best.ent.alive, dmg: dealt, head: best.head });
    }
  }
  return results;
}

// ------------------------------- IA de bots ---------------------------------
function updateBots(dt) {
  const now = Date.now();
  for (const b of bots) {
    if (!b.alive) {
      if (now >= b.respawnAt) {
        const s = randomSpawn();
        b.x = s.x; b.z = s.z; b.y = 0; b.health = BOT_HP; b.alive = true;
        b.target = null; b.lastHurtBy = null; b.stuck = 0; b.detourUntil = 0; b.wander = randomWander();
        b.weapon = randomBotWeapon();
      }
      continue;
    }
    // Buscar al enemigo vivo más cercano (jugador U otro bot) con línea de visión
    let target = null, bd = BOT_VISION;
    const consider = (ent, type) => {
      if (!ent.alive) return;
      const dx = ent.x - b.x, dz = ent.z - b.z;
      const dist = Math.hypot(dx, dz);
      if (dist < bd && !segBlocked(b.x, b.z, ent.x, ent.z)) {
        bd = dist; target = { ent, type, dist, dx, dz };
      }
    };
    for (const [, p] of players) consider(p, 'player');
    for (const other of bots) if (other !== b) consider(other, 'bot');

    const bw = BOT_WEAPONS[b.weapon] || BOT_WEAPONS.rifle;
    let mvx = 0, mvz = 0, wantMove = false;
    if (target) {
      // mantener una distancia acorde al arma (escopeta se acerca, sniper se aleja)
      const reach = Math.min(bw.range, BOT_VISION);
      const ideal = reach * 0.7, near = reach * 0.4, inv = 1 / (target.dist || 1);
      if (target.dist > ideal) { mvx = target.dx * inv; mvz = target.dz * inv; wantMove = true; }
      else if (target.dist < near) { mvx = -target.dx * inv; mvz = -target.dz * inv; wantMove = true; }
      else { // en rango: moverse de costado (strafe) para no ser un blanco fijo
        if (now > (b.strafeFlip || 0)) { b.strafe = Math.random() < 0.5 ? 1 : -1; b.strafeFlip = now + 1200 + Math.random() * 1600; }
        mvx = -target.dz * inv * b.strafe; mvz = target.dx * inv * b.strafe; wantMove = true;
      }
      if (target.dist < bw.range && now - b.lastShot > bw.fireMs) {
        b.lastShot = now;
        const hitChance = Math.max(0.16, 1 - target.dist / bw.range) * 0.72;
        if (Math.random() < hitChance) {
          applyDamage(target.type, target.ent, bw.damage, { id: b.id, isPlayer: false });
        }
        io.emit('tracer', { x: b.x, y: 1.4, z: b.z, tx: target.ent.x, ty: target.ent.y + 1.2, tz: target.ent.z, weapon: b.weapon });
      }
    } else {
      const dx = b.wander.x - b.x, dz = b.wander.z - b.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 2) b.wander = randomWander();
      else { mvx = dx / dist; mvz = dz / dist; wantMove = true; }
    }

    if (wantMove) {
      // dirección: desvío activo para destrabarse, o esquive de obstáculos
      let hx, hz;
      if (now < b.detourUntil) { hx = b.detourDir.x; hz = b.detourDir.z; }
      else { const a = avoidDir(b, mvx, mvz); hx = a.x; hz = a.z; }
      const sp = BOT_SPEED * dt;
      const res = resolve(b.x + hx * sp, b.z + hz * sp, 0.6);
      const nx = clamp(res.x, -49, 49), nz = clamp(res.z, -49, 49);
      const moved = Math.hypot(nx - b.x, nz - b.z);
      b.x = nx; b.z = nz;
      if (!target) b.ry = Math.atan2(hx, hz);
      // si apenas avanzó, está atascado → desvío perpendicular durante un momento
      if (moved < sp * 0.35) {
        b.stuck += dt;
        if (b.stuck > 0.35 && now >= b.detourUntil) {
          const side = Math.random() < 0.5 ? 1 : -1;
          b.detourDir = { x: hz * side, z: -hx * side };
          b.detourUntil = now + 600;
          b.stuck = 0;
          if (!target) b.wander = randomWander();
        }
      } else b.stuck = 0;
    }
    if (target) b.ry = Math.atan2(target.dx, target.dz); // siempre mira (y apunta) al objetivo
  }
}

// ---------------------------- Fin/reinicio ----------------------------------
function endMatch() {
  phase = 'over';
  const ranking = [...players.values()]
    .map(p => ({ name: p.name, score: p.score, kills: p.kills || 0, deaths: p.deaths || 0 }))
    .sort((a, b) => b.score - a.score);
  io.emit('gameover', { ranking });
  setTimeout(resetMatch, 12000);
}

function resetMatch() {
  for (const [, p] of players) { p.score = 0; p.deaths = 0; p.kills = 0; p.streak = 0; p.boostUntil = 0; respawnPlayer(p); }
  for (const b of bots) { const s = randomSpawn(); b.x = s.x; b.z = s.z; b.health = BOT_HP; b.alive = true; }
  drops = [];
  power = { active: true, respawnAt: 0 };
  matchEnd = Date.now() + MATCH_DURATION;
  phase = 'playing';
  io.emit('matchstart', {});
}

// ----------------------------- Bucle principal ------------------------------
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (phase === 'playing') {
    updateBots(dt);
    for (const [, p] of players) if (!p.alive && now >= p.respawnAt) respawnPlayer(p);
    for (const pk of pickups) if (!pk.active && now >= pk.respawnAt) pk.active = true;
    for (const mk of medkits) if (!mk.active && now >= mk.respawnAt) mk.active = true;
    if (drops.length) drops = drops.filter(d => d.until > now);
    // power-up de daño x2: reaparición y recogida (hay que estar ARRIBA de la torre)
    if (!power.active && now >= power.respawnAt) {
      power.active = true;
      io.emit('announce', { text: '⚡ DAÑO x2 disponible en la torre central' });
    }
    if (power.active) {
      for (const [, p] of players) {
        if (!p.alive || p.y < POWER_POS.minY) continue;
        if (Math.abs(p.x - POWER_POS.x) < 2.4 && Math.abs(p.z - POWER_POS.z) < 2.4) {
          power.active = false; power.respawnAt = now + POWER_RESPAWN;
          p.boostUntil = now + POWER_DURATION;
          io.to(p.id).emit('boost', { ms: POWER_DURATION });
          io.emit('announce', { text: `⚡ ${p.name} consiguió DAÑO x2` });
          break;
        }
      }
    }
    if (matchEnd - now <= 0) endMatch();
  }
  broadcastState();
}, TICK_MS);

function broadcastState() {
  const ps = [];
  for (const [id, p] of players) {
    ps.push({ id, name: p.name, x: p.x, y: p.y, z: p.z, ry: p.ry, health: p.health,
      maxHealth: PLAYER_HP, weapon: p.weapon, score: p.score, alive: p.alive, deaths: p.deaths || 0,
      kills: p.kills || 0, streak: p.streak || 0, boosted: Date.now() < (p.boostUntil || 0),
      protected: Date.now() < (p.invulnUntil || 0) });
  }
  const bs = bots.map(b => ({ id: b.id, x: b.x, y: b.y, z: b.z, ry: b.ry, health: b.health, maxHealth: BOT_HP, alive: b.alive, weapon: b.weapon }));
  const pk = pickups.map(p => ({ id: p.id, x: p.x, z: p.z, weapon: p.weapon, active: p.active }));
  const mk = medkits.map(m => ({ id: m.id, x: m.x, z: m.z, active: m.active }));
  const dr = drops.map(d => ({ id: d.id, x: d.x, z: d.z, weapon: d.weapon, until: d.until }));
  let leaderId = null, ls = 0;
  for (const [id, p] of players) if (p.score > ls) { ls = p.score; leaderId = id; }
  io.emit('state', { players: ps, bots: bs, pickups: pk, medkits: mk, drops: dr, leaderId, power: { active: power.active }, timeLeft: Math.max(0, matchEnd - Date.now()), phase });
}

// ------------------------------- Sockets ------------------------------------
io.on('connection', (socket) => {
  socket.on('join', (data) => {
    const weapon = WEAPONS[data?.weapon]?.starter ? data.weapon : 'pistol';
    const s = randomSpawn();
    const p = {
      id: socket.id, name: (String(data?.name || 'Jugador')).slice(0, 16) || 'Jugador',
      x: s.x, y: 0, z: s.z, ry: 0, health: PLAYER_HP, alive: true,
      weapon, startWeapon: weapon, score: 0, deaths: 0, kills: 0, streak: 0, lastHurtBy: null, lastShot: 0,
      invulnUntil: Date.now() + SPAWN_PROTECT,
      god: String(data?.name || '').trim() === '6767', // código: vida infinita + 1 disparo mata
    };
    players.set(socket.id, p);
    socket.emit('init', {
      selfId: socket.id,
      map: { size: MAP_SIZE, obstacles: OBST, eye: EYE, jumppads: JUMP_PADS },
      weapons: WEAPONS,
      spawn: { x: p.x, y: p.y, z: p.z },
      weapon,
      timeLeft: Math.max(0, matchEnd - Date.now()),
      phase,
    });
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
    if (now - p.lastShot < w.fireRate * 0.6) return; // límite de cadencia anti-trampa
    p.lastShot = now;
    const hits = handleShot({ id: p.id, isPlayer: true, god: p.god, boosted: Date.now() < (p.boostUntil || 0) }, p.weapon, d.origin, d.rays || []);
    if (hits.length) socket.emit('hit', { hits });
    const r0 = d.rays?.[0] || { x: 0, y: 0, z: -1 };
    socket.broadcast.emit('tracer', {
      x: d.origin.x, y: d.origin.y, z: d.origin.z,
      tx: d.origin.x + r0.x * w.range, ty: d.origin.y + r0.y * w.range, tz: d.origin.z + r0.z * w.range,
      weapon: p.weapon,
    });
  });

  socket.on('pickup', (id) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    const pk = pickups.find(x => x.id === id);
    if (pk && pk.active && Math.hypot(pk.x - p.x, pk.z - p.z) < 3) {
      pk.active = false;
      pk.respawnAt = Date.now() + PICKUP_RESPAWN;
      p.weapon = pk.weapon;
      socket.emit('weaponPickup', { weapon: pk.weapon });
      return;
    }
    const di = drops.findIndex(x => x.id === id);
    if (di >= 0 && Math.hypot(drops[di].x - p.x, drops[di].z - p.z) < 3) {
      p.weapon = drops[di].weapon;
      drops.splice(di, 1);
      socket.emit('weaponPickup', { weapon: p.weapon });
    }
  });

  socket.on('medkit', (id) => {
    const p = players.get(socket.id);
    if (!p || !p.alive || p.health >= PLAYER_HP) return;
    const mk = medkits.find(x => x.id === id);
    if (!mk || !mk.active) return;
    if (Math.hypot(mk.x - p.x, mk.z - p.z) < 2.5) {
      mk.active = false; mk.respawnAt = Date.now() + MEDKIT_RESPAWN;
      p.health = Math.min(PLAYER_HP, p.health + MEDKIT_HEAL);
      socket.emit('healed', { health: p.health });
    }
  });

  socket.on('pingcheck', (t) => socket.emit('pongcheck', t)); // medición de latencia

  socket.on('leave', () => players.delete(socket.id)); // volver al lobby

  socket.on('disconnect', () => players.delete(socket.id));
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
