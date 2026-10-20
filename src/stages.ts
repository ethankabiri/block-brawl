import * as THREE from 'three';

export type StageScene = {
  group: THREE.Group;
  background: THREE.Color;
  fog: THREE.Fog;
  hemi: [string, string, number];
  sun: [string, number];
  update: (t: number) => void;
};

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(...repeat); }
  return tex;
}
const mat = (color: string, rough = 0.8, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
function box(g: THREE.Group, size: [number, number, number], pos: [number, number, number], material: THREE.Material, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  m.position.set(...pos); m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
}
function glow(g: THREE.Group, color: string, pos: [number, number, number], intensity: number, distance: number) {
  const l = new THREE.PointLight(color, intensity, distance, 1.6); l.position.set(...pos); g.add(l); return l;
}
function floor(g: THREE.Group, tex: THREE.Texture, w = 60, d = 40, color = '#ffffff') {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, color, roughness: 0.85 }));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; g.add(m);
}

function dojo(): StageScene {
  const g = new THREE.Group();
  const planks = canvasTex(512, 512, c => {
    c.fillStyle = '#b98a5c'; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#a97b4f' : '#c29566'; c.fillRect(0, i * 64, 512, 62);
      c.strokeStyle = 'rgba(70,40,20,.25)'; c.lineWidth = 2; c.strokeRect(0, i * 64, 512, 62);
      for (let k = 0; k < 14; k++) { c.fillStyle = 'rgba(90,55,30,.12)'; c.fillRect(Math.random() * 512, i * 64 + Math.random() * 60, 40 + Math.random() * 80, 2); }
    }
  }, [14, 9]);
  floor(g, planks);
  const mat2 = canvasTex(256, 256, c => {
    c.fillStyle = '#d8c58a'; c.fillRect(0, 0, 256, 256);
    c.strokeStyle = '#7a8a4a'; c.lineWidth = 8; c.strokeRect(4, 4, 248, 248);
    for (let y = 8; y < 256; y += 6) { c.strokeStyle = 'rgba(120,100,50,.18)'; c.beginPath(); c.moveTo(8, y); c.lineTo(248, y); c.stroke(); }
  });
  const arena = new THREE.Mesh(new THREE.BoxGeometry(15.5, 0.08, 4.4), new THREE.MeshStandardMaterial({ map: mat2, roughness: 0.9 }));
  arena.position.set(0, 0.04, 0); arena.receiveShadow = true; g.add(arena);
  const wall = canvasTex(512, 256, c => {
    c.fillStyle = '#f1e4c4'; c.fillRect(0, 0, 512, 256);
    c.strokeStyle = '#6b4a33'; c.lineWidth = 6;
    for (let x = 0; x <= 512; x += 128) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 256); c.stroke(); }
    for (let y = 0; y <= 256; y += 85) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
  }, [3, 1]);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(36, 9), new THREE.MeshStandardMaterial({ map: wall, roughness: 0.9 }));
  back.position.set(0, 4.5, -6); back.receiveShadow = true; g.add(back);
  const red = mat('#9c3b30', 0.6); const wood = mat('#5a3b27', 0.7);
  for (const x of [-9, -4.5, 0, 4.5, 9]) { box(g, [0.45, 9, 0.45], [x, 4.5, -5.7], red); }
  box(g, [36, 0.4, 0.6], [0, 8.3, -5.6], wood); box(g, [36, 0.3, 0.5], [0, 6.2, -5.65], wood);
  const lanterns: THREE.Mesh[] = [];
  for (const x of [-6.8, -2.2, 2.2, 6.8]) {
    const lan = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ff9d4a', emissiveIntensity: 1.1, roughness: 0.5 }));
    lan.scale.y = 1.25; lan.position.set(x, 5.2, -4.6); g.add(lan); lanterns.push(lan);
    box(g, [0.02, 1.4, 0.02], [x, 6.2, -4.6], wood, false);
    glow(g, '#ffb36a', [x, 5.0, -3.8], 6, 12);
  }
  for (const x of [-7.5, 7.5]) { box(g, [0.8, 0.6, 0.8], [x, 0.3, -3.6], wood); box(g, [0.5, 0.2, 0.5], [x, 0.7, -3.6], mat('#d8c58a')); }
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.9, 20), mat('#b0452f', 0.5)); drum.position.set(-8.4, 0.45, -2.4); drum.castShadow = true; g.add(drum);
  const drum2 = drum.clone(); drum2.position.set(8.4, 0.45, -2.4); g.add(drum2);
  return {
    group: g, background: new THREE.Color('#3a2a22'), fog: new THREE.Fog('#3a2a22', 18, 42),
    hemi: ['#ffe9c8', '#6b4a33', 1.1], sun: ['#ffe2b8', 2.1],
    update: t => lanterns.forEach((l, i) => { (l.material as THREE.MeshStandardMaterial).emissiveIntensity = 1 + Math.sin(t * 2 + i) * 0.15; }),
  };
}

function rooftop(): StageScene {
  const g = new THREE.Group();
  const concrete = canvasTex(512, 512, c => {
    c.fillStyle = '#34363f'; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; c.fillRect(Math.random() * 512, Math.random() * 512, 3, 3); }
    c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 3;
    for (let i = 0; i <= 512; i += 128) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 512); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(512, i); c.stroke(); }
  }, [12, 8]);
  floor(g, concrete);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(14.5, 0.12), new THREE.MeshBasicMaterial({ color: '#ffd24a' })); stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.02, 2.2); g.add(stripe);
  const stripe2 = stripe.clone(); stripe2.position.z = -2.2; g.add(stripe2);
  const win = canvasTex(256, 512, c => {
    c.fillStyle = '#14172b'; c.fillRect(0, 0, 256, 512);
    for (let y = 8; y < 512; y += 22) for (let x = 8; x < 256; x += 22) {
      if (Math.random() < 0.55) { c.fillStyle = ['#ffd98a', '#8fd7ff', '#ff9ad5'][Math.floor(Math.random() * 3)]; c.fillRect(x, y, 12, 14); }
    }
  });
  const colors = ['#1d2140', '#232748', '#191c36'];
  for (let i = 0; i < 16; i++) {
    const w = 2.4 + Math.random() * 2.2; const h = 6 + Math.random() * 14;
    const tex = win.clone(); tex.needsUpdate = true; tex.repeat.set(w / 3, h / 8); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2.4), new THREE.MeshStandardMaterial({ color: colors[i % 3], map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.9 }));
    b.position.set(-22 + i * 2.9 + Math.random(), h / 2 - 3, -14 - Math.random() * 6); g.add(b);
  }
  const rail = mat('#6a6f80', 0.5);
  for (let x = -9; x <= 9; x += 1.5) box(g, [0.08, 1.2, 0.08], [x, 0.6, -4.2], rail);
  box(g, [18.2, 0.1, 0.12], [0, 1.2, -4.2], rail); box(g, [18.2, 0.08, 0.1], [0, 0.65, -4.2], rail);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.4, 20), mat('#7a5a44', 0.8)); tank.position.set(-8.6, 1.2, -3.2); tank.castShadow = true; g.add(tank);
  box(g, [0.15, 1.2, 0.15], [-9.1, 0.0, -3.2], mat('#444')); box(g, [0.15, 1.2, 0.15], [-8.1, 0.0, -3.2], mat('#444'));
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 0.12), new THREE.MeshStandardMaterial({ color: '#ff3d9a', emissive: '#ff2b8a', emissiveIntensity: 1.5 })); sign.position.set(7.2, 3.6, -4.8); g.add(sign);
  const sign2 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.12), new THREE.MeshStandardMaterial({ color: '#35e0ff', emissive: '#18c8ff', emissiveIntensity: 1.5 })); sign2.position.set(-5.2, 4.4, -4.8); g.add(sign2);
  box(g, [0.1, 3.6, 0.1], [7.2, 1.8, -4.85], rail); box(g, [0.1, 4.4, 0.1], [-5.2, 2.2, -4.85], rail);
  glow(g, '#ff3d9a', [7.2, 3.0, -2.6], 14, 16); glow(g, '#35e0ff', [-5.2, 3.2, -2.6], 12, 16);
  return {
    group: g, background: new THREE.Color('#0d1024'), fog: new THREE.Fog('#0d1024', 16, 46),
    hemi: ['#7f8cff', '#2a2f46', 0.9], sun: ['#aab6ff', 1.3],
    update: t => { (sign.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.3 + Math.sin(t * 3) * 0.25 + (Math.sin(t * 17) > 0.93 ? -0.7 : 0); },
  };
}

function meadow(): StageScene {
  const g = new THREE.Group();
  const grass = canvasTex(512, 512, c => {
    c.fillStyle = '#7fb069'; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1600; i++) { c.fillStyle = Math.random() < 0.5 ? 'rgba(70,120,60,.35)' : 'rgba(160,210,110,.3)'; c.fillRect(Math.random() * 512, Math.random() * 512, 2, 7); }
  }, [10, 7]);
  floor(g, grass);
  const dirt = canvasTex(256, 256, c => {
    c.fillStyle = '#c9a56e'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 600; i++) { c.fillStyle = `rgba(110,80,40,${Math.random() * 0.2})`; c.fillRect(Math.random() * 256, Math.random() * 256, 3, 2); }
  });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 0.06, 48), new THREE.MeshStandardMaterial({ map: dirt, roughness: 1 }));
  ring.scale.z = 0.36; ring.position.y = 0.03; ring.receiveShadow = true; g.add(ring);
  const hills = ['#8fbf73', '#78a862', '#6a9a58'];
  [[-14, -14, 8], [-4, -16, 10], [9, -15, 9], [18, -13, 7]].forEach(([x, z, r], i) => {
    const h = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat(hills[i % 3], 1)); h.scale.y = 0.55; h.position.set(x, -r * 0.35, z); g.add(h);
  });
  const trunk = mat('#6b4a33'); const leaves = [mat('#5f9a54'), mat('#4f8a4a')];
  [[-8.5, -4], [8.8, -4.5], [-11, -7], [11.5, -8], [-5.5, -9], [5, -10]].forEach(([x, z], i) => {
    const s = 0.9 + (i % 3) * 0.25;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.2 * s, 1.6 * s, 8), trunk); t.position.set(x, 0.8 * s, z); t.castShadow = true; g.add(t);
    for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry((1.3 - k * 0.3) * s, 1.4 * s, 10), leaves[k % 2]); c.position.set(x, (1.9 + k * 0.85) * s, z); c.castShadow = true; g.add(c); }
  });
  const flowers = ['#ff8fb1', '#ffe27a', '#ffffff', '#b8a2ff'];
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() - 0.5) * 30; const z = -3 - Math.random() * 5;
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), mat(flowers[i % 4], 0.7)); f.position.set(x, 0.1, z); g.add(f);
  }
  const clouds: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 10), new THREE.MeshBasicMaterial({ color: '#fff3e0', transparent: true, opacity: 0.85 }));
    c.scale.set(2.6 + Math.random(), 0.6, 0.9); c.position.set(-18 + i * 7, 9 + Math.random() * 4, -22); g.add(c); clouds.push(c);
  }
  const sun = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 16), new THREE.MeshBasicMaterial({ color: '#ffd08a' })); sun.position.set(10, 7, -26); g.add(sun);
  const fence = mat('#d8c9a8');
  for (let x = -9; x <= 9; x += 1.2) box(g, [0.12, 0.8, 0.12], [x, 0.4, -3.9], fence);
  box(g, [19, 0.1, 0.08], [0, 0.65, -3.9], fence); box(g, [19, 0.1, 0.08], [0, 0.35, -3.9], fence);
  return {
    group: g, background: new THREE.Color('#f6c58f'), fog: new THREE.Fog('#f6c58f', 22, 55),
    hemi: ['#ffe9c8', '#7fb069', 1.2], sun: ['#ffd9a0', 2.4],
    update: t => clouds.forEach((c, i) => { c.position.x += 0.004 * (1 + (i % 3)); if (c.position.x > 26) c.position.x = -26; void t; }),
  };
}

export function buildStage(id: string): StageScene {
  return id === 'roof' ? rooftop() : id === 'meadow' ? meadow() : dojo();
}
