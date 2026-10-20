import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FighterDef, SpecialKind } from './data';
import { sfx } from './audio';

export type Input = { x: number; jump: boolean; block: boolean; punch: boolean; kick: boolean; special: boolean };
export const emptyInput = (): Input => ({ x: 0, jump: false, block: false, punch: false, kick: false, special: false });

export const SPECIAL_COST = 50;
export const ARENA_HALF = 6.4;

export type Move = {
  id: string; anim: string; startup: number; active: number; recovery: number;
  dmg: number; range: number; stun: number; kb: number; meter: number;
  air?: boolean; special?: SpecialKind; launch?: boolean; dash?: number;
};
export const moves: Record<string, Move> = {
  punch: { id: 'punch', anim: 'attack-melee-right', startup: 0.06, active: 0.08, recovery: 0.15, dmg: 5, range: 1.1, stun: 0.27, kb: 1.6, meter: 5 },
  kick: { id: 'kick', anim: 'attack-kick-right', startup: 0.1, active: 0.1, recovery: 0.24, dmg: 8, range: 1.4, stun: 0.34, kb: 3, meter: 8 },
  airPunch: { id: 'airPunch', anim: 'attack-melee-left', startup: 0.04, active: 0.3, recovery: 0.1, dmg: 7, range: 1.15, stun: 0.3, kb: 2, meter: 6, air: true },
  airKick: { id: 'airKick', anim: 'attack-kick-left', startup: 0.05, active: 0.3, recovery: 0.1, dmg: 9, range: 1.35, stun: 0.34, kb: 2.6, meter: 8, air: true },
  blast: { id: 'blast', anim: 'attack-melee-left', startup: 0.26, active: 0.02, recovery: 0.34, dmg: 12, range: 0, stun: 0.36, kb: 3.5, meter: 0, special: 'blast' },
  rush: { id: 'rush', anim: 'attack-kick-right', startup: 0.12, active: 0.42, recovery: 0.3, dmg: 13, range: 1.25, stun: 0.5, kb: 5, meter: 0, special: 'rush', launch: true, dash: 8.5 },
  quake: { id: 'quake', anim: 'attack-melee-left', startup: 0.34, active: 0.02, recovery: 0.45, dmg: 12, range: 0, stun: 0.5, kb: 4, meter: 0, special: 'quake', launch: true },
};

export type FState = 'idle' | 'walk' | 'jump' | 'attack' | 'hit' | 'block' | 'down' | 'ko' | 'win';
export type HitResult = 'hit' | 'block' | 'none';

export interface Hooks {
  hitStop(seconds: number): void;
  shake(amount: number): void;
  burst(x: number, y: number, color: string, count: number, power: number): void;
  ring(x: number, y: number, color: string, size: number): void;
  fireball(owner: Fighter): void;
  quake(owner: Fighter): void;
}

export type Loaded = { scene: THREE.Object3D; animations: THREE.AnimationClip[]; height: number };

const SCALE: Record<string, number> = { e: 1.85, f: 1.7, h: 1.95 };
const GRAVITY = 22;

export class Fighter {
  readonly root = new THREE.Group();
  readonly pivot = new THREE.Group();
  readonly marker: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = '';
  private flashMats: THREE.MeshStandardMaterial[] = [];
  readonly maxHp: number;

  x = 0; y = 0; vx = 0; vy = 0; dir = 1;
  hp = 100; meter = 0;
  state: FState = 'idle';
  stateT = 0;
  move: Move | null = null; moveT = 0; moveHit = false; fired = false; chain = 0;
  private buf: { kind: 'punch' | 'kick' | 'special'; t: number } | null = null;
  private stun = 0;
  private blockT = 0;
  private flash = 0;
  private altPunch = false;
  private face = Math.PI / 2;
  comboHits = 0;
  comboDamage = 0;
  bestCombo = 0;
  jumpDir = 0;

  constructor(readonly def: FighterDef, loaded: Loaded, readonly side: 0 | 1, private hooks: Hooks, tintColor: string) {
    this.maxHp = def.hp;
    const model = cloneSkinned(loaded.scene) as THREE.Group;
    const factor = (SCALE[def.id] ?? 1.78) / Math.max(loaded.height, 0.001);
    model.scale.setScalar(factor);
    model.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(m => m.clone());
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      for (const m of mats) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        const sm = m as THREE.MeshStandardMaterial; sm.emissive = new THREE.Color('#ff3a22'); sm.emissiveIntensity = 0; this.flashMats.push(sm);
      }
    });
    this.pivot.add(model);
    this.root.add(this.pivot);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of loaded.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 4), new THREE.MeshBasicMaterial({ color: tintColor }));
    this.marker.rotation.x = Math.PI;
    this.root.add(this.marker);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.72, 28), new THREE.MeshBasicMaterial({ color: tintColor, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    this.shadow.add(ring);
    ring.position.z = 0.012;
  }

  get grounded() { return this.y <= 0.001; }
  get isDown() { return this.state === 'down' || this.state === 'ko'; }

  reset(x: number, dir: number) {
    this.x = x; this.y = 0; this.vx = 0; this.vy = 0; this.dir = dir;
    this.hp = this.maxHp; this.state = 'idle'; this.stateT = 0; this.move = null; this.buf = null;
    this.comboHits = 0; this.comboDamage = 0; this.stun = 0; this.flash = 0; this.chain = 0;
    this.face = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.play('idle', 1, false, true);
    this.syncTransform();
  }

  private setState(s: FState) {
    if (this.state === s) return;
    if ((s === 'idle' || s === 'walk') && (this.state === 'hit' || this.state === 'down')) { this.comboHits = 0; this.comboDamage = 0; }
    this.state = s; this.stateT = 0;
  }

  private play(name: string, speed = 1, once = false, restart = false, fade = 0.1) {
    const next = this.actions.get(name);
    if (!next) return;
    if (this.current === name && !restart) { next.timeScale = speed; return; }
    const prev = this.actions.get(this.current);
    next.reset(); next.enabled = true; next.timeScale = speed;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = once;
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    this.current = name;
  }

  setWin() { if (this.state === 'ko') return; this.setState('win'); this.move = null; this.vx = 0; this.play('emote-yes', 1); }

  private clipDuration(name: string) { return this.actions.get(name)?.getClip().duration ?? 0.6; }

  private begin(kind: 'punch' | 'kick' | 'special') {
    let mv: Move;
    if (!this.grounded) mv = kind === 'punch' ? moves.airPunch : moves.airKick;
    else if (kind === 'special') mv = moves[this.def.special];
    else mv = moves[kind];
    const fromAttack = this.state === 'attack';
    this.chain = fromAttack ? this.chain + 1 : 0;
    this.move = mv; this.moveT = 0; this.moveHit = false; this.fired = false; this.buf = null;
    this.setState('attack');
    if (kind === 'special') { this.meter -= SPECIAL_COST; sfx.special(); } else sfx.whoosh();
    let anim = mv.anim;
    if (mv.id === 'punch') { anim = this.altPunch ? 'attack-melee-left' : 'attack-melee-right'; this.altPunch = !this.altPunch; }
    const total = mv.startup + mv.active + mv.recovery * 0.5;
    this.play(anim, Math.min(3, this.clipDuration(anim) / total), true, true, 0.05);
    if (!mv.air) { this.vx = 0; if (mv.id === 'blast' || mv.id === 'quake') this.vx = 0; }
  }

  update(dt: number, inp: Input, opp: Fighter, canAct: boolean) {
    this.stateT += dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.buf) { this.buf.t -= dt; if (this.buf.t <= 0) this.buf = null; }
    if (!canAct) inp = emptyInput();
    const speed = 3.3 * this.def.speed;

    if (this.grounded && (this.state === 'idle' || this.state === 'walk' || this.state === 'block')) this.dir = opp.x >= this.x ? 1 : -1;

    const wantsAttack: 'punch' | 'kick' | 'special' | null = inp.special && this.meter >= SPECIAL_COST ? 'special' : inp.kick ? 'kick' : inp.punch ? 'punch' : null;

    switch (this.state) {
      case 'idle': case 'walk': case 'block': {
        if (wantsAttack) { this.begin(wantsAttack); break; }
        if (inp.jump && this.grounded) { this.vy = 8.2; this.jumpDir = inp.x; this.vx = inp.x * speed; this.setState('jump'); sfx.jump(); break; }
        if (inp.block) { if (this.state !== 'block') this.setState('block'); this.vx = 0; break; }
        if (this.blockT > 0 && this.state === 'block') { this.blockT -= dt; break; }
        this.vx = inp.x * speed;
        this.setState(inp.x !== 0 ? 'walk' : 'idle');
        break;
      }
      case 'jump': {
        if (wantsAttack && wantsAttack !== 'special') { this.begin(wantsAttack); break; }
        this.vx += (inp.x * speed - this.vx) * Math.min(1, dt * 2.5);
        break;
      }
      case 'attack': this.updateAttack(dt, opp, wantsAttack); break;
      case 'hit': {
        this.stun -= dt;
        this.vx *= Math.max(0, 1 - dt * 6);
        if (this.stun <= 0) { this.setState(inp.block ? 'block' : 'idle'); }
        break;
      }
      case 'down': {
        this.vx *= Math.max(0, 1 - dt * 3);
        if (this.stateT > 1.05 && this.grounded) this.setState('idle');
        break;
      }
      case 'ko': this.vx *= Math.max(0, 1 - dt * 3); break;
      case 'win': this.vx = 0; break;
    }

    if (inp.punch || inp.kick || (inp.special && this.meter >= SPECIAL_COST)) {
      if (this.state === 'attack') this.buf = { kind: wantsAttack ?? 'punch', t: 0.22 };
    }

    this.x += this.vx * dt;
    if (!this.grounded || this.vy > 0) {
      this.vy -= GRAVITY * dt; this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0; this.vy = 0;
        if (this.state === 'jump') { this.vx = 0; this.setState('idle'); }
        else if (this.state === 'hit') this.vx *= 0.5;
      }
    }
    this.x = THREE.MathUtils.clamp(this.x, -ARENA_HALF, ARENA_HALF);
  }

  private updateAttack(dt: number, opp: Fighter, wantsAttack: 'punch' | 'kick' | 'special' | null) {
    const m = this.move!;
    this.moveT += dt;
    const a0 = m.startup, a1 = m.startup + m.active, end = a1 + m.recovery;
    if (m.air) {
      if (this.moveT >= a0 && this.moveT <= a1 && !this.moveHit) this.tryHit(opp);
      if (this.grounded) { this.move = null; this.setState('idle'); }
      else if (this.moveT > end) { this.move = null; this.setState('jump'); }
      return;
    }
    if (!this.fired && this.moveT >= a0) {
      this.fired = true;
      if (m.special === 'blast') this.hooks.fireball(this);
      if (m.special === 'quake') { this.hooks.quake(this); sfx.quake(); this.hooks.shake(0.25); }
    }
    if (m.dash) {
      if (this.moveT >= a0 && this.moveT < a1 && !this.moveHit) this.vx = this.dir * m.dash;
      else this.vx *= 0.8;
    }
    if (this.moveT >= a0 && this.moveT <= a1 && !this.moveHit && m.range > 0) this.tryHit(opp);
    const can = this.moveHit && !m.special && this.chain < 4 && this.moveT >= a0 + 0.03;
    const next = this.buf?.kind ?? wantsAttack;
    if (can && next && (next !== 'special' || this.meter >= SPECIAL_COST)) { this.begin(next); return; }
    if (this.moveT >= end) { this.move = null; this.setState('idle'); this.vx = 0; }
  }

  private tryHit(opp: Fighter) {
    const m = this.move!;
    if (opp.isDown || opp.state === 'win') return;
    const dx = (opp.x - this.x) * this.dir;
    const dy = Math.abs(opp.y - this.y);
    if (dx > -0.25 && dx < m.range + 0.3 && dy < 1.0) {
      const result = opp.takeHit(this, m, this.dir, this.chain >= 2 && m.id === 'kick');
      if (result !== 'none') { this.moveHit = true; if (m.dash) this.vx = 0; }
    }
  }

  takeHit(att: Fighter, m: Move, kdir: number, forceLaunch = false): HitResult {
    if (this.isDown || this.state === 'win') return 'none';
    const guarding = (this.state === 'block') && this.grounded;
    const sy = this.y + 1.0;
    if (guarding) {
      const chip = Math.max(0.5, m.dmg * att.def.power * (m.special ? 0.28 : 0.1));
      this.hp = Math.max(1, this.hp - chip);
      this.vx = kdir * m.kb * 0.8; this.blockT = 0.14; this.flash = 0;
      this.meter = Math.min(100, this.meter + 3); att.meter = Math.min(100, att.meter + 2);
      this.hooks.burst(this.x - this.dir * 0.2, sy, '#9fd0ff', 6, 2);
      this.hooks.ring(this.x - this.dir * 0.25, sy, '#9fd0ff', 0.5);
      this.hooks.hitStop(0.04);
      sfx.block();
      return 'block';
    }
    const scale = Math.max(0.45, 1 - this.comboHits * 0.1);
    const dmg = Math.round(m.dmg * att.def.power * scale * 10) / 10;
    this.hp = Math.max(0, this.hp - dmg);
    this.comboHits++; this.comboDamage += dmg;
    att.bestCombo = Math.max(att.bestCombo, this.comboHits);
    const launch = m.launch || forceLaunch;
    this.vx = kdir * m.kb * (launch ? 1.2 : 1);
    this.flash = 1; this.stun = m.stun; this.move = null; this.buf = null;
    const heavy = !!(launch || m.special || m.dmg >= 8);
    if (this.hp <= 0) {
      this.setState('ko'); this.vy = 6; this.vx = kdir * 4; this.y = Math.max(this.y, 0.01);
      this.play('die', 1, true, true, 0.05);
      sfx.ko(); this.hooks.hitStop(0.35); this.hooks.shake(0.6);
    } else if (launch) {
      this.setState('down'); this.vy = 5.2; this.y = Math.max(this.y, 0.01);
      this.play('die', 1.5, true, true, 0.05);
      this.hooks.hitStop(0.12); this.hooks.shake(0.35);
    } else {
      this.setState('hit'); this.play('idle', 1, false, false, 0.05);
      this.hooks.hitStop(heavy ? 0.09 : 0.055); this.hooks.shake(heavy ? 0.2 : 0.1);
    }
    att.meter = Math.min(100, att.meter + m.meter);
    this.meter = Math.min(100, this.meter + m.meter * 0.6 + 2);
    this.hooks.burst(this.x - this.dir * 0.1, sy, heavy ? '#ffb03c' : '#fff1b0', heavy ? 14 : 8, heavy ? 4 : 2.6);
    this.hooks.ring(this.x - this.dir * 0.15, sy, heavy ? '#ff8a3c' : '#ffffff', heavy ? 0.9 : 0.6);
    sfx.hit(heavy);
    return 'hit';
  }

  /** Called every rendered frame, even during hit-stop (dt may be 0). */
  animate(dt: number, time: number) {
    const s = this.state;
    if (s === 'idle') this.play('idle', 1);
    else if (s === 'walk') this.play('walk', this.vx * this.dir >= 0 ? 1.3 : -1.1);
    else if (s === 'block') this.play('holding-both', 1);
    else if (s === 'jump') this.play('sprint', 1.4);
    this.mixer.update(dt);
    const targetLean = s === 'hit' ? -0.38 : s === 'block' ? -0.12 : s === 'jump' ? 0.12 : s === 'attack' && this.moveT > (this.move?.startup ?? 0) ? 0.2 : 0;
    this.pivot.rotation.x += (targetLean - this.pivot.rotation.x) * Math.min(1, dt * 18);
    this.pivot.position.y = s === 'win' ? Math.abs(Math.sin(time * 5)) * 0.08 : 0;
    const want = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    let diff = want - this.face; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.face += diff * Math.min(1, dt * 16);
    for (const m of this.flashMats) m.emissiveIntensity = this.flash * 0.8;
    this.syncTransform();
    this.marker.position.y = 2.35 + Math.sin(time * 4 + this.side) * 0.06;
    this.marker.rotation.y = time * 2;
    this.marker.visible = s !== 'ko';
  }

  private syncTransform() {
    this.root.position.set(this.x, this.y, 0);
    this.root.rotation.y = this.face;
    this.marker.rotation.y = 0;
    this.shadow.position.set(this.x, 0.02, 0.05);
    const k = 1 / (1 + this.y * 0.9);
    this.shadow.scale.setScalar(k);
  }
}
