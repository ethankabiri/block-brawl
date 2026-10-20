import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { roster, stages, specialInfo, loadSave, writeSave, type FighterDef } from './data';
import { buildStage, type StageScene } from './stages';
import { sfx, setSound, soundOn } from './audio';
import { Fighter, emptyInput, type Input, type Loaded, type Hooks, moves, ARENA_HALF, SPECIAL_COST } from './fighter';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
type Mode = 'arcade' | 'versus' | 'training';
type Phase = 'menu' | 'intro' | 'fight' | 'roundEnd' | 'matchEnd';

const save = loadSave();
const canvas = $<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
const hemi = new THREE.HemisphereLight('#fff', '#888', 1);
const sun = new THREE.DirectionalLight('#fff', 2);
sun.position.set(-4, 9, 7); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 6, bottom: -3, near: 1, far: 30 });
scene.add(hemi, sun);
let stage: StageScene | null = null;
let stageId = '';
function setStage(id: string) {
  if (stage && stageId === id) return;
  if (stage) scene.remove(stage.group);
  stage = buildStage(id); stageId = id;
  scene.add(stage.group);
  scene.background = stage.background; scene.fog = stage.fog;
  hemi.color.set(stage.hemi[0]); hemi.groundColor.set(stage.hemi[1]); hemi.intensity = stage.hemi[2];
  sun.color.set(stage.sun[0]); sun.intensity = stage.sun[1];
}

// ---------- models ----------
const loader = new GLTFLoader();
const models = new Map<string, Loaded>();
async function loadModel(file: string): Promise<Loaded> {
  const hit = models.get(file); if (hit) return hit;
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/people/character-${file}.glb`);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const m = { scene: gltf.scene, animations: gltf.animations, height: box.max.y - box.min.y };
  models.set(file, m); return m;
}

// ---------- effects ----------
type Particle = { m: THREE.Mesh; vx: number; vy: number; life: number; max: number };
const particles: Particle[] = [];
const partGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const rings: { m: THREE.Mesh; life: number; size: number }[] = [];
const ringGeo = new THREE.RingGeometry(0.7, 1, 24);
type Proj = { m: THREE.Mesh; owner: Fighter; x: number; dir: number; life: number; kind: 'ball' | 'wave' };
const projs: Proj[] = [];
let hitStopT = 0, shakeAmt = 0;
const fxGroup = new THREE.Group(); scene.add(fxGroup);

const hooks: Hooks = {
  hitStop: s => { hitStopT = Math.max(hitStopT, s); },
  shake: a => { shakeAmt = Math.max(shakeAmt, a); },
  burst(x, y, color, count, power) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      m.position.set(x, y, 0.3); fxGroup.add(m);
      const a = Math.random() * Math.PI * 2, s = power * (0.4 + Math.random());
      particles.push({ m, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 1, life: 0.45, max: 0.45 });
    }
  },
  ring(x, y, color, size) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, y, 0.4); fxGroup.add(m); rings.push({ m, life: 0.25, size });
  },
  fireball(o) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 12), new THREE.MeshBasicMaterial({ color: o.def.tint }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.35 }));
    m.add(halo); fxGroup.add(m);
    const x = o.x + o.dir * 0.8; m.position.set(x, o.y + 1.1, 0);
    projs.push({ m, owner: o, x, dir: o.dir, life: 2, kind: 'ball' });
  },
  quake(o) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 4), new THREE.MeshBasicMaterial({ color: o.def.tint, transparent: true, opacity: 0.8 }));
    m.rotation.z = -o.dir * Math.PI / 2; fxGroup.add(m);
    const x = o.x + o.dir * 0.6; m.position.set(x, 0.45, 0);
    projs.push({ m, owner: o, x, dir: o.dir, life: 1.1, kind: 'wave' });
    hooks.ring(o.x, 0.1, '#ffd27a', 1.6);
  },
};

function updateEffects(dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt; p.vy -= 12 * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt;
    (p.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life / p.max);
    if (p.life <= 0) { fxGroup.remove(p.m); (p.m.material as THREE.Material).dispose(); particles.splice(i, 1); }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.life -= dt;
    r.m.scale.setScalar(r.size * (1.3 - r.life * 3)); (r.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.life * 4);
    if (r.life <= 0) { fxGroup.remove(r.m); (r.m.material as THREE.Material).dispose(); rings.splice(i, 1); }
  }
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i]; p.life -= dt;
    const o = p.owner === f1 ? f2 : f1;
    p.x += p.dir * (p.kind === 'ball' ? 8 : 6) * dt; p.m.position.x = p.x;
    let done = p.life <= 0 || Math.abs(p.x) > ARENA_HALF + 2 || phase === 'menu';
    if (!done && !o.isDown && Math.abs(o.x - p.x) < 0.5 && (p.kind === 'ball' ? Math.abs(o.y + 1 - p.m.position.y) < 0.9 : o.y < 0.5)) {
      const mv = p.kind === 'ball' ? { ...moveOf('blast') } : { ...moveOf('quake') };
      done = o.takeHit(p.owner, mv, p.dir) !== 'none';
    }
    if (done) { fxGroup.remove(p.m); projs.splice(i, 1); }
  }
}
const moveOf = (id: string) => moves[id];
function clearEffects() {
  for (const g of [...particles.map(p => p.m), ...rings.map(r => r.m), ...projs.map(p => p.m)]) fxGroup.remove(g);
  particles.length = rings.length = projs.length = 0;
}

// ---------- state ----------
let f1!: Fighter, f2!: Fighter;
let mode: Mode = 'arcade';
let phase: Phase = 'menu';
let phaseT = 0;
let paused = false;
let roundNo = 1, wins1 = 0, wins2 = 0, timer = 60;
let ladder: FighterDef[] = [];
let ladderIdx = 0;
let pick1: FighterDef = roster[0], pick2: FighterDef = roster[1];
let pickStage = 'dojo';
let picking: 1 | 2 = 1;
let difficulty = 0.3;
let perfect = true;
let matchCombo = 0;
let earned = { coins: 0, rounds: 0, perfect: 0, clear: 0 };
let lagHp1 = 100, lagHp2 = 100;

const el = {
  hud: $('hud'), title: $('title'), select: $('select'), pause: $('pause'), result: $('result'), help: $('help'), touch: $('touch'),
  banner: $('banner'), timer: $('timer'), roundLabel: $('round-label'),
};
const show = (e: HTMLElement, on: boolean) => e.classList.toggle('hidden', !on);
const isTouch = matchMedia('(pointer: coarse)').matches;

function banner(text: string, ms = 1200) {
  el.banner.textContent = text; el.banner.classList.remove('show'); void el.banner.offsetWidth; el.banner.classList.add('show');
  setTimeout(() => { if (el.banner.textContent === text) el.banner.classList.remove('show'); }, ms);
}

async function spawn(def1: FighterDef, def2: FighterDef) {
  for (const f of [f1, f2]) if (f) { scene.remove(f.root, f.shadow); }
  const [m1, m2] = await Promise.all([loadModel(def1.file), loadModel(def2.file)]);
  f1 = new Fighter(def1, m1, 0, hooks, '#4aa8ff');
  f2 = new Fighter(def2, m2, 1, hooks, '#ff5a5a');
  scene.add(f1.root, f1.shadow, f2.root, f2.shadow);
}

async function startMatch(m: Mode) {
  mode = m; clearEffects();
  show($('loading'), true);
  setStage(pickStage);
  let opp = pick2;
  if (m === 'arcade') {
    const pool = roster.filter(r => r.id !== pick1.id && r.id !== 'h');
    ladder = [...pool.sort(() => Math.random() - 0.5).slice(0, 4)];
    ladder.push(pick1.id === 'h' ? roster.find(r => r.id === 'g')! : roster.find(r => r.id === 'h')!);
    ladderIdx = 0; opp = ladder[0]; earned = { coins: 0, rounds: 0, perfect: 0, clear: 0 };
  } else if (m === 'training') opp = roster.find(r => r.id !== pick1.id)!;
  await spawn(pick1, opp);
  show($('loading'), false);
  nextFight();
}

function nextFight() {
  wins1 = wins2 = 0; roundNo = 1; matchCombo = 0;
  difficulty = mode === 'arcade' ? Math.min(1, 0.3 + ladderIdx * 0.18) : 0.5;
  $('p1-name').textContent = f1.def.name;
  $('p2-name').textContent = mode === 'training' ? 'Dummy' : f2.def.name;
  show(el.hud, true); show(el.title, false); show(el.select, false); show(el.result, false);
  show(el.touch, isTouch);
  startRound();
}

function startRound() {
  f1.reset(-2, 1); f2.reset(2, -1);
  f1.meter = Math.min(100, f1.meter); f2.meter = mode === 'training' ? 100 : f2.meter;
  lagHp1 = f1.hp; lagHp2 = f2.hp; perfect = true;
  clearEffects();
  timer = 60; phase = 'intro'; phaseT = 0;
  el.roundLabel.textContent = mode === 'training' ? 'Training' : `Round ${roundNo}`;
  banner(mode === 'arcade' ? `Fight ${ladderIdx + 1} / ${ladder.length}` : `Round ${roundNo}`, 900);
  sfx.bell();
  updateHud(0);
}

function endRound(winner: Fighter | null) {
  phase = 'roundEnd'; phaseT = 0;
  if (winner === f1) { wins1++; earned.rounds++; if (perfect) earned.perfect++; } else if (winner === f2) wins2++;
  if (winner) winner.setWin();
  matchCombo = Math.max(matchCombo, f1.bestCombo);
  const timeUp = !winner || (f1.hp > 0 && f2.hp > 0);
  banner(winner ? (timeUp ? 'Time!' : 'K.O.!') : 'Draw', 1600);
  if (winner === f1 && perfect && f1.hp >= f1.maxHp) setTimeout(() => banner('Perfect!', 1200), 900);
}

function finishMatch() {
  phase = 'matchEnd';
  const won = wins1 > wins2;
  save.fights++; save.bestCombo = Math.max(save.bestCombo, matchCombo);
  let html = '';
  let cont = false;
  if (mode === 'training') { return; }
  if (mode === 'versus') {
    html = `<h2>${won ? f1.def.name : f2.def.name} wins!</h2><p>${wins1} – ${wins2}</p><div class="menu"><button class="btn primary" id="again">Rematch</button><button class="btn ghost" id="menu">Menu</button></div>`;
  } else if (won) {
    save.wins++;
    const base = 30 + 15 * ladderIdx;
    earned.coins += base;
    const last = ladderIdx >= ladder.length - 1;
    if (last) { save.clears++; earned.clear = 150; }
    const rounds = earned.rounds * 5, perf = earned.perfect * 20;
    const total = earned.coins + rounds + perf + earned.clear;
    save.coins += total - 0; // earned.coins accumulates per-fight base; others paid once here
    html = `<h2>${last ? 'Ladder cleared!' : 'Victory!'}</h2><ul class="rewards"><li><span>Win bonus</span><b>+${base}</b></li><li><span>Rounds won</span><b>+${rounds}</b></li><li><span>Perfect rounds</span><b>+${perf}</b></li>${last ? '<li><span>Clear bonus</span><b>+150</b></li>' : ''}<li class="total"><span>Total</span><b>+${total}</b></li></ul>`;
    earned = { coins: 0, rounds: 0, perfect: 0, clear: 0 };
    const afford = roster.filter(r => !save.unlocked.includes(r.id) && r.cost <= save.coins);
    if (afford.length) html += `<div class="unlock-note">You can now unlock ${afford.map(a => a.name).join(', ')}!</div>`;
    cont = !last;
    html += `<div class="menu">${cont ? '<button class="btn primary" id="next">Next fight</button>' : ''}<button class="btn ${cont ? '' : 'primary'}" id="menu">Menu</button></div>`;
  } else {
    save.losses++;
    const consolation = 10 + earned.rounds * 5;
    save.coins += consolation; earned = { coins: 0, rounds: 0, perfect: 0, clear: 0 };
    html = `<h2>Defeated</h2><p>${f2.def.name} was too strong this time.</p><p>Consolation: <b>+${consolation}</b> coins</p><div class="menu"><button class="btn primary" id="retry">Retry</button><button class="btn ghost" id="menu">Menu</button></div>`;
  }
  writeSave(save);
  $('result-panel').innerHTML = html;
  show(el.result, true); sfx[won ? 'win' : 'click']();
  $('menu')?.addEventListener('click', toMenu);
  $('again')?.addEventListener('click', () => { show(el.result, false); startMatch('versus'); });
  $('retry')?.addEventListener('click', () => { show(el.result, false); startMatch('arcade'); });
  $('next')?.addEventListener('click', async () => {
    show(el.result, false); ladderIdx++;
    const keepCoins = earned;
    scene.remove(f2.root, f2.shadow);
    const m2 = await loadModel(ladder[ladderIdx].file);
    f2 = new Fighter(ladder[ladderIdx], m2, 1, hooks, '#ff5a5a'); scene.add(f2.root, f2.shadow);
    earned = keepCoins; nextFight();
  });
}

function toMenu() {
  phase = 'menu'; paused = false; clearEffects();
  show(el.hud, false); show(el.result, false); show(el.pause, false); show(el.touch, false); show(el.title, true);
  refreshTitle();
}

// ---------- input ----------
const keys = new Set<string>();
const touchKeys = new Set<string>();
const p1Keys = { left: 'KeyA', right: 'KeyD', jump: 'KeyW', block: 'KeyS', punch: 'KeyJ', kick: 'KeyK', special: 'KeyL' };
const p2Keys = { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp', block: 'ArrowDown', punch: 'Comma', kick: 'Period', special: 'Slash' };
const edge = new Map<string, boolean>();
function readInput(map: typeof p1Keys, touch: boolean): Input {
  const down = (k: string, t: string) => keys.has(k) || (touch && touchKeys.has(t));
  const pressed = (k: string, t: string) => { const d = down(k, t); const was = edge.get(k + t) ?? false; edge.set(k + t, d); return d && !was; };
  return {
    x: (down(map.right, 'right') ? 1 : 0) - (down(map.left, 'left') ? 1 : 0),
    jump: down(map.jump, 'jump'), block: down(map.block, 'block'),
    punch: pressed(map.punch, 'punch'), kick: pressed(map.kick, 'kick'), special: pressed(map.special, 'special'),
  };
}
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'Escape' && (phase === 'fight' || phase === 'intro' || phase === 'roundEnd' || paused)) setPause(!paused);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); touchKeys.clear(); });
document.querySelectorAll<HTMLButtonElement>('#touch [data-key]').forEach(b => {
  const k = b.dataset.key!;
  const on = (e: Event) => { e.preventDefault(); touchKeys.add(k); b.classList.add('down'); };
  const off = (e: Event) => { e.preventDefault(); touchKeys.delete(k); b.classList.remove('down'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
});

// ---------- AI ----------
type Plan = { kind: string; t: number };
let plan: Plan = { kind: 'idle', t: 0 };
let aiCool = 0;
function aiInput(me: Fighter, opp: Fighter, dt: number): Input {
  const inp = emptyInput();
  if (mode === 'training') return inp;
  const d = (opp.x - me.x) * me.dir, dist = Math.abs(opp.x - me.x);
  aiCool -= dt; plan.t -= dt;
  const react = 0.25 + difficulty * 0.7;
  if (opp.state === 'attack' && dist < 1.8 && opp.grounded && Math.random() < react * dt * 6) { plan = { kind: 'block', t: 0.3 + Math.random() * 0.3 }; }
  if (plan.t <= 0) {
    const r = Math.random();
    if (me.meter >= SPECIAL_COST && r < 0.3 * difficulty + 0.1 && (dist > 2.2 || me.def.special !== 'rush')) plan = { kind: 'special', t: 0.2 };
    else if (dist > 1.5) plan = { kind: r < 0.12 ? 'jump' : 'approach', t: 0.3 + Math.random() * 0.4 };
    else if (r < 0.62) plan = { kind: 'poke', t: 0.2 + (1 - difficulty) * 0.5 };
    else if (r < 0.78) plan = { kind: 'retreat', t: 0.3 };
    else plan = { kind: 'block', t: 0.25 };
  }
  switch (plan.kind) {
    case 'approach': inp.x = me.dir; break;
    case 'retreat': inp.x = -me.dir; break;
    case 'block': inp.block = true; break;
    case 'jump': inp.x = me.dir; inp.jump = true; break;
    case 'special': if (aiCool <= 0) { inp.special = true; aiCool = 1.2; } break;
    case 'poke':
      if (dist < 1.35 && aiCool <= 0 && me.state !== 'hit') {
        if (Math.random() < 0.5) inp.punch = true; else inp.kick = true;
        aiCool = 0.25 + (1 - difficulty) * 0.9;
      } else if (d > 1.1) inp.x = me.dir;
      break;
  }
  if (me.state === 'attack' && me.moveHit && Math.random() < difficulty * 0.4 * dt * 10) inp.punch = true;
  return inp;
}

// ---------- HUD ----------
function setPips(id: string, n: number) { $(id).innerHTML = [0, 1].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join(''); }
const combo = { 1: 0, 2: 0 };
function updateHud(dt: number) {
  if (!f1) return;
  lagHp1 += (f1.hp - lagHp1) * Math.min(1, dt * 3); lagHp2 += (f2.hp - lagHp2) * Math.min(1, dt * 3);
  $('p1-hp').style.width = `${(f1.hp / f1.maxHp) * 100}%`; $('p1-lag').style.width = `${(lagHp1 / f1.maxHp) * 100}%`;
  $('p2-hp').style.width = `${(f2.hp / f2.maxHp) * 100}%`; $('p2-lag').style.width = `${(lagHp2 / f2.maxHp) * 100}%`;
  $('p1-meter').style.width = `${f1.meter}%`; $('p2-meter').style.width = `${f2.meter}%`;
  $('p1-meter').parentElement!.classList.toggle('ready', f1.meter >= SPECIAL_COST);
  $('p2-meter').parentElement!.classList.toggle('ready', f2.meter >= SPECIAL_COST);
  el.timer.textContent = mode === 'training' ? '∞' : String(Math.max(0, Math.ceil(timer)));
  setPips('p1-wins', wins1); setPips('p2-wins', wins2);
  for (const [n, f] of [[1, f2], [2, f1]] as const) {
    const c = $(`combo-${n}`);
    const hits = f.comboHits;
    if (hits >= 2) { c.textContent = `${hits} hit combo!`; c.classList.add('show'); combo[n] = 1; }
    else if (combo[n]) { c.classList.remove('show'); combo[n] = 0; }
  }
}

// ---------- loop ----------
function setPause(p: boolean) { paused = p; show(el.pause, p); keys.clear(); }
let last = performance.now(), time = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  stage?.update(time);
  if (f1 && phase !== 'menu') {
    let sim = paused ? 0 : dt;
    if (hitStopT > 0) { hitStopT -= sim; sim = 0; }
    if (sim > 0) {
      phaseT += sim;
      const i1 = readInput(p1Keys, true);
      const i2 = mode === 'versus' ? readInput(p2Keys, false) : aiInput(f2, f1, sim);
      const act = phase === 'fight';
      f1.update(sim, i1, f2, act); f2.update(sim, i2, f1, act);
      pushApart();
      updateEffects(sim);
      if (phase === 'intro' && phaseT > 1.1) { phase = 'fight'; phaseT = 0; banner('FIGHT!', 700); }
      else if (phase === 'fight') {
        if (mode !== 'training') timer -= sim;
        if (f1.hp < f1.maxHp) perfect = false;
        if (mode === 'training') { if (f2.hp <= 0 || f2.hp < f2.maxHp * 0.3) f2.hp = f2.maxHp; if (f1.hp < f1.maxHp * 0.3) f1.hp = f1.maxHp; f2.meter = 100; }
        else if (f1.hp <= 0 || f2.hp <= 0) endRound(f1.hp <= 0 && f2.hp <= 0 ? null : f1.hp <= 0 ? f2 : f1);
        else if (timer <= 0) endRound(f1.hp === f2.hp ? null : f1.hp > f2.hp ? f1 : f2);
      } else if (phase === 'roundEnd' && phaseT > 2.4) {
        if (wins1 >= 2 || wins2 >= 2 || roundNo >= 3) finishMatch();
        else { roundNo++; startRound(); }
      }
    }
    f1.animate(paused ? 0 : (hitStopT > 0 ? 0 : dt), time); f2.animate(paused ? 0 : (hitStopT > 0 ? 0 : dt), time);
    updateHud(dt);
    cameraFollow(dt);
  } else if (phase === 'menu') {
    const a = time * 0.1;
    camera.position.set(Math.sin(a) * 2, 2.2, 11.5); camera.lookAt(0, 1.2, 0);
  }
  renderer.render(scene, camera);
}
function pushApart() {
  if (!f1.grounded && !f2.grounded) return;
  const d = f2.x - f1.x, min = 0.7;
  if (Math.abs(d) < min && Math.abs(f1.y - f2.y) < 1.2) {
    const push = (min - Math.abs(d)) / 2 * (d >= 0 ? 1 : -1);
    f1.x = THREE.MathUtils.clamp(f1.x - push, -ARENA_HALF, ARENA_HALF); f2.x = THREE.MathUtils.clamp(f2.x + push, -ARENA_HALF, ARENA_HALF);
  }
}
const camTarget = new THREE.Vector3();
function cameraFollow(dt: number) {
  const mid = (f1.x + f2.x) / 2, span = Math.abs(f1.x - f2.x);
  const aspect = camera.aspect;
  const need = Math.max(4.2, span + 3.4);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = Math.max(8.5, (need / 2) / (Math.tan(fov / 2) * aspect));
  camTarget.set(mid * 0.8, 1.9 + Math.max(0, dist - 8.5) * 0.12, dist + 0.5);
  camera.position.lerp(camTarget, Math.min(1, dt * 5));
  shakeAmt = Math.max(0, shakeAmt - dt * 1.6);
  const s = shakeAmt * 0.25;
  camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s;
  camera.lookAt(mid * 0.8, 1.2, 0);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------- menus ----------
function refreshTitle() {
  $('stat-coins').textContent = `🪙 ${save.coins}`;
  $('stat-wins').textContent = `Wins ${save.wins}`;
  $('stat-clears').textContent = `Ladder clears ${save.clears}`;
  $('sound-btn').textContent = soundOn ? 'Sound on' : 'Sound off';
}

const portraits = new Map<string, HTMLCanvasElement>();
async function portrait(def: FighterDef) {
  const hit = portraits.get(def.id); if (hit) return hit;
  const m = await loadModel(def.file);
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight('#fff', '#998877', 2.2));
  const dl = new THREE.DirectionalLight('#fff', 2); dl.position.set(2, 3, 4); s.add(dl);
  const obj = m.scene.clone(true); obj.scale.setScalar(1.7 / m.height); s.add(obj);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 1.25, 5.2); cam.lookAt(0, 0.95, 0);
  const rt = new THREE.WebGLRenderTarget(256, 256, { colorSpace: THREE.SRGBColorSpace } as never);
  renderer.setRenderTarget(rt); renderer.render(s, cam);
  const buf = new Uint8Array(256 * 256 * 4); renderer.readRenderTargetPixels(rt, 0, 0, 256, 256, buf); renderer.setRenderTarget(null); rt.dispose();
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d')!; const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) img.data.set(buf.subarray((255 - y) * 1024, (256 - y) * 1024), y * 1024);
  ctx.putImageData(img, 0, 0);
  portraits.set(def.id, c); return c;
}

let selMode: Mode = 'arcade';
async function openSelect(m: Mode) {
  selMode = m; picking = 1;
  pick1 = roster.find(r => save.unlocked.includes(r.id))!; pick2 = roster.find(r => r.id !== pick1.id && save.unlocked.includes(r.id))!;
  show(el.title, false); show(el.select, true);
  await renderSelect();
}
async function renderSelect() {
  $('select-title').textContent = selMode === 'versus' ? `Player ${picking}: choose your fighter` : 'Choose your fighter';
  $('select-coins').textContent = `🪙 ${save.coins}`;
  const rosterEl = $('roster'); rosterEl.innerHTML = '';
  for (const def of roster) {
    const locked = !save.unlocked.includes(def.id);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'card';
    if (locked) b.classList.add('locked');
    if (def.id === pick1.id) b.classList.add('sel-1');
    if (selMode === 'versus' && def.id === pick2.id) b.classList.add('sel-2');
    b.style.setProperty('--card-bg', def.tint + '55');
    const c = document.createElement('canvas'); c.width = c.height = 256; b.appendChild(c);
    portrait(def).then(src => c.getContext('2d')!.drawImage(src, 0, 0));
    const nm = document.createElement('span'); nm.textContent = def.name; b.appendChild(nm);
    if (locked) { const l = document.createElement('i'); l.className = 'lock'; l.textContent = `🪙 ${def.cost}`; b.appendChild(l); }
    b.addEventListener('click', () => {
      sfx.click();
      if (selMode === 'versus' && picking === 2) { if (!locked) pick2 = def; } else if (!locked || true) { if (!locked) pick1 = def; }
      detailDef = def; renderSelect();
    });
    rosterEl.appendChild(b);
  }
  const d = detailDef ?? (picking === 2 ? pick2 : pick1);
  const locked = !save.unlocked.includes(d.id);
  const sp = specialInfo[d.special];
  const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.min(100, v)}%"></b></i></div>`;
  $('detail').innerHTML = `<h3>${d.name}</h3><p class="sub">${d.title}</p>${bar('Health', d.hp / 1.4)}${bar('Speed', d.speed * 70)}${bar('Power', d.power * 70)}<p class="special"><b>${sp.label}:</b> ${sp.blurb}</p>${locked ? `<button class="btn primary" id="unlock" ${save.coins < d.cost ? 'disabled' : ''}>Unlock for 🪙 ${d.cost}</button>` : ''}`;
  $('unlock')?.addEventListener('click', () => {
    if (save.coins < d.cost) return;
    save.coins -= d.cost; save.unlocked.push(d.id); writeSave(save); sfx.win();
    if (picking === 2 && selMode === 'versus') pick2 = d; else pick1 = d;
    renderSelect();
  });
  const chips = $('stage-chips'); chips.innerHTML = '';
  for (const s of stages) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (s.id === pickStage ? ' on' : ''); b.textContent = s.name; b.title = s.blurb;
    b.addEventListener('click', () => { pickStage = s.id; sfx.click(); renderSelect(); });
    chips.appendChild(b);
  }
  $('select-go').textContent = selMode === 'versus' && picking === 1 ? 'Next: Player 2' : 'Fight!';
}
let detailDef: FighterDef | null = null;

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.addEventListener('click', () => { sfx.click(); detailDef = null; openSelect(b.dataset.mode as Mode); }));
$('select-back').addEventListener('click', () => { show(el.select, false); show(el.title, true); });
$('select-go').addEventListener('click', () => {
  sfx.click();
  if (selMode === 'versus' && picking === 1) { picking = 2; detailDef = null; renderSelect(); return; }
  if (selMode === 'versus' && pick2.id === pick1.id) { const alt = roster.find(r => r.id !== pick1.id && save.unlocked.includes(r.id))!; pick2 = alt; }
  show(el.select, false); startMatch(selMode);
});
$('open-help').addEventListener('click', () => show(el.help, true));
$('close-help').addEventListener('click', () => show(el.help, false));
$('sound-btn').addEventListener('click', () => { setSound(!soundOn); refreshTitle(); });
$('pause-btn').addEventListener('click', () => setPause(true));
$('resume').addEventListener('click', () => setPause(false));
$('restart').addEventListener('click', () => { setPause(false); startMatch(mode); });
$('quit').addEventListener('click', () => toMenu());

// ---------- boot ----------
setStage('dojo');
refreshTitle();
(window as unknown as { __bb: unknown }).__bb = { get state() { return { phase, f1, f2, wins1, wins2, mode, save }; }, keys, step(n: number) { for (let i = 0; i < n; i++) { last = performance.now() - 16.7; frame(performance.now()); } } };
Promise.all(roster.slice(0, 4).map(r => loadModel(r.file))).then(() => $('loading').classList.add('hidden'));
requestAnimationFrame(frame);
