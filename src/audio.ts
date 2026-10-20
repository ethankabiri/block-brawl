let ctx: AudioContext | null = null;
export let soundOn = true;
export function setSound(on: boolean) { soundOn = on; }

function ac() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
  const c = soundOn ? ac() : null;
  if (!c) return;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur);
}
function noise(dur: number, vol: number, lowpass: number) {
  const c = soundOn ? ac() : null;
  if (!c) return;
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource(); src.buffer = buffer;
  const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = lowpass;
  const g = c.createGain(); g.gain.value = vol;
  src.connect(filter).connect(g).connect(c.destination); src.start();
}

export const sfx = {
  whoosh: () => noise(0.12, 0.12, 2600),
  hit: (heavy: boolean) => { noise(heavy ? 0.22 : 0.12, heavy ? 0.5 : 0.35, heavy ? 900 : 1600); tone(heavy ? 90 : 140, 0.15, 'square', 0.12, -50); },
  block: () => { tone(320, 0.08, 'triangle', 0.14, -120); noise(0.05, 0.12, 3000); },
  special: () => { tone(220, 0.35, 'sawtooth', 0.1, 520); },
  quake: () => { tone(70, 0.5, 'sawtooth', 0.18, -35); noise(0.4, 0.3, 500); },
  jump: () => tone(300, 0.12, 'sine', 0.06, 260),
  bell: () => { tone(880, 0.5, 'sine', 0.1); tone(1320, 0.4, 'sine', 0.05); },
  ko: () => { tone(200, 0.9, 'sawtooth', 0.14, -150); noise(0.5, 0.35, 700); },
  win: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.1), i * 130)); },
  click: () => tone(520, 0.05, 'triangle', 0.05),
};
