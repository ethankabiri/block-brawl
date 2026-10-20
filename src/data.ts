export type SpecialKind = 'blast' | 'rush' | 'quake';

export type FighterDef = {
  id: string;
  name: string;
  title: string;
  file: string;
  hp: number;
  speed: number;
  power: number;
  special: SpecialKind;
  cost: number;
  tint: string;
};

export const roster: FighterDef[] = [
  { id: 'a', name: 'Mochi', title: 'The Rookie', file: 'a', hp: 100, speed: 1.0, power: 1.0, special: 'blast', cost: 0, tint: '#6fb7ff' },
  { id: 'b', name: 'Rex', title: 'Iron Fist', file: 'b', hp: 110, speed: 0.9, power: 1.15, special: 'quake', cost: 0, tint: '#ff8a5c' },
  { id: 'c', name: 'Pixel', title: 'Quick Step', file: 'c', hp: 90, speed: 1.2, power: 0.95, special: 'rush', cost: 0, tint: '#8be28b' },
  { id: 'd', name: 'Juno', title: 'Flame Kick', file: 'd', hp: 100, speed: 1.05, power: 1.05, special: 'blast', cost: 0, tint: '#ffb347' },
  { id: 'e', name: 'Bruno', title: 'The Wall', file: 'e', hp: 125, speed: 0.8, power: 1.2, special: 'quake', cost: 150, tint: '#c49bff' },
  { id: 'f', name: 'Sable', title: 'Night Blade', file: 'f', hp: 85, speed: 1.25, power: 1.1, special: 'rush', cost: 200, tint: '#9aa5ff' },
  { id: 'g', name: 'Hana', title: 'Spark Queen', file: 'g', hp: 95, speed: 1.1, power: 1.0, special: 'blast', cost: 250, tint: '#ff7eb6' },
  { id: 'h', name: 'Titan', title: 'Final Boss', file: 'h', hp: 140, speed: 0.95, power: 1.25, special: 'quake', cost: 400, tint: '#ff5d5d' },
];

export const specialInfo: Record<SpecialKind, { label: string; blurb: string }> = {
  blast: { label: 'Energy Blast', blurb: 'Throws a fast projectile.' },
  rush: { label: 'Dash Strike', blurb: 'Lunges across the arena.' },
  quake: { label: 'Ground Quake', blurb: 'Shockwave, jump to dodge.' },
};

export type StageDef = { id: string; name: string; blurb: string };
export const stages: StageDef[] = [
  { id: 'dojo', name: 'Lantern Dojo', blurb: 'Warm wood and paper lanterns.' },
  { id: 'roof', name: 'Neon Rooftop', blurb: 'City lights after midnight.' },
  { id: 'meadow', name: 'Sunset Meadow', blurb: 'Soft hills and golden light.' },
];

export type Save = { coins: number; unlocked: string[]; wins: number; losses: number; clears: number; bestCombo: number; fights: number };
const KEY = 'block-brawl-v1';
export function loadSave(): Save {
  const base: Save = { coins: 0, unlocked: roster.filter(r => r.cost === 0).map(r => r.id), wins: 0, losses: 0, clears: 0, bestCombo: 0, fights: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return base;
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
    const unlocked = Array.isArray(raw.unlocked) ? raw.unlocked.filter((id: unknown) => roster.some(r => r.id === id)) : [];
    for (const id of base.unlocked) if (!unlocked.includes(id)) unlocked.push(id);
    return { coins: num(raw.coins), unlocked, wins: num(raw.wins), losses: num(raw.losses), clears: num(raw.clears), bestCombo: num(raw.bestCombo), fights: num(raw.fights) };
  } catch {
    return base;
  }
}
export function writeSave(save: Save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* storage unavailable */ }
}
