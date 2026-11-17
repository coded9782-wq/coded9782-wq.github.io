/**
 * Minty website: one fixed WebGL canvas behind the page.
 * A 3D phone (showing real app screenshots) and a 3D Minty follow the
 * `.slot` elements in the page as you scroll, gliding, spinning and
 * swapping screens between them. Background colour blends per section.
 *
 * Slot attributes:
 *   data-phone            phone sits here ("hide" = shrink into this element)
 *   data-screen           screenshot name in assets/screens/
 *   data-rx/ry/rz         phone rotation in degrees
 *   data-spin             spin a full turn when travelling to the next spin slot
 *   data-minty            fill | perch | side  (how Minty uses the slot)
 *   data-mood             wave | happy | cheer | look | sleep
 *   data-msize            Minty width as a share of the phone / element width
 *   data-perch            left | right
 *   data-bg               (any element) page background while it is centred
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const smoother = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
const lerp = (a, b, t) => a + (b - a) * t;
/** Shortest signed angle from a to b, so a full spin never unwinds backwards. */
const angDiff = (a, b) => { const d = (b - a) % (Math.PI * 2); return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d; };

/* ------------------------------------------------------------------ helpers */
function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function planeUV(geo, w, h) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  uv.needsUpdate = true;
  return geo;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ screens */
function screenStore(renderer, lowRes) {
  const placeholder = canvasTex(4, 8, (g, w, h) => { g.fillStyle = '#eef6f0'; g.fillRect(0, 0, w, h); });
  const store = {};
  const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  function load(name) {
    if (store[name]) return store[name];
    const entry = { tex: placeholder, ready: false };
    store[name] = entry;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      let src = img;
      const target = lowRes ? 560 : 960;
      if (img.naturalWidth > target) {
        const c = document.createElement('canvas');
        c.width = target;
        c.height = Math.round((target * img.naturalHeight) / img.naturalWidth);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        src = c;
      }
      const t = new THREE.Texture(src);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      t.needsUpdate = true;
      entry.tex = t;
      entry.ready = true;
    };
    img.src = `assets/screens/${name}.jpg`;
    return entry;
  }
  return { get: (name) => load(name).tex, preload: (names) => names.forEach(load) };
}

/* ------------------------------------------------------------------ phone */
const PW = 1, PH = 2.12;
function buildPhone(screens) {
  const g = new THREE.Group();
  const B = 0.028, DEPTH = 0.075, FRONT = DEPTH / 2 + B;
  const bodyGeo = new THREE.ExtrudeGeometry(roundedShape(PW - 2 * B, PH - 2 * B, 0.15 - B), {
    depth: DEPTH, bevelEnabled: true, bevelThickness: B, bevelSize: B, bevelSegments: 4, curveSegments: 16,
  });
  bodyGeo.center();
  const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x24392e, metalness: 0.8, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.1 });
  g.add(new THREE.Mesh(bodyGeo, frameMat));

  const bezel = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedShape(PW - 2 * B + 0.004, PH - 2 * B + 0.004, 0.124), 16),
    new THREE.MeshPhysicalMaterial({ color: 0x050a08, roughness: 0.05, metalness: 0, clearcoat: 1 }),
  );
  bezel.position.z = FRONT + 0.001;
  g.add(bezel);

  const SW = 0.9, SH = 0.9 / (960 / 2080);
  const sGeo = planeUV(new THREE.ShapeGeometry(roundedShape(SW, SH, 0.1), 16), SW, SH);
  const matA = new THREE.MeshBasicMaterial({ map: screens.get('today'), toneMapped: false });
  const matB = new THREE.MeshBasicMaterial({ map: screens.get('today'), toneMapped: false, transparent: true, opacity: 0, depthWrite: false });
  const scrA = new THREE.Mesh(sGeo, matA);
  const scrB = new THREE.Mesh(sGeo, matB);
  scrA.position.z = FRONT + 0.003;
  scrB.position.z = FRONT + 0.005;
  g.add(scrA, scrB);

  const glareTex = canvasTex(64, 256, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.42, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.62, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
  });
  glareTex.wrapS = THREE.RepeatWrapping;
  const glare = new THREE.Mesh(sGeo, new THREE.MeshBasicMaterial({ map: glareTex, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glare.position.z = FRONT + 0.007;
  g.add(glare);

  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.019, 20), new THREE.MeshBasicMaterial({ color: 0x050806 }));
  hole.position.set(0, SH / 2 - 0.04, FRONT + 0.009);
  g.add(hole);

  // back: frosted mint glass, app icon, camera bump
  const back = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedShape(PW - 2 * B + 0.004, PH - 2 * B + 0.004, 0.124), 16),
    new THREE.MeshPhysicalMaterial({ color: 0x3f8a62, roughness: 0.42, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color(0xc9eedb) }),
  );
  back.rotation.y = Math.PI;
  back.position.z = -FRONT - 0.001;
  g.add(back);

  const icon = new THREE.Mesh(new THREE.CircleGeometry(0.13, 40), new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false }));
  new THREE.TextureLoader().load('assets/icon-192.png', (t) => { t.colorSpace = THREE.SRGBColorSpace; icon.material.map = t; icon.material.needsUpdate = true; });
  icon.rotation.y = Math.PI;
  icon.position.set(0, 0.05, -FRONT - 0.004);
  g.add(icon);

  const bumpGeo = new THREE.ExtrudeGeometry(roundedShape(0.34, 0.34, 0.09), { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 12 });
  bumpGeo.center();
  const bump = new THREE.Mesh(bumpGeo, new THREE.MeshPhysicalMaterial({ color: 0x2c6648, roughness: 0.3, metalness: 0.3, clearcoat: 1 }));
  bump.position.set(0.27, PH / 2 - 0.29, -FRONT - 0.016);
  g.add(bump);
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x050807, roughness: 0.05, metalness: 0.2, clearcoat: 1 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xb8c9bf, roughness: 0.25, metalness: 1 });
  const lensGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.02, 24);
  const ringGeo = new THREE.TorusGeometry(0.058, 0.007, 8, 28);
  [[0.2, PH / 2 - 0.22], [0.2, PH / 2 - 0.36], [0.34, PH / 2 - 0.22]].forEach(([x, y], i) => {
    const r = i === 2 ? 0.55 : 1;
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.scale.set(r, 1, r);
    lens.position.set(x, y, -FRONT - 0.034);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.scale.setScalar(r);
    ring.position.set(x, y, -FRONT - 0.044);
    g.add(lens, ring);
  });

  const btnGeo = new THREE.BoxGeometry(0.02, 1, 0.034);
  [[0.5, 0.22], [0.2, 0.16], [0.0, 0.16]].forEach(([y, len], i) => {
    const b = new THREE.Mesh(btnGeo, frameMat);
    b.scale.y = len;
    b.position.set(i === 0 ? PW / 2 + 0.004 : -PW / 2 - 0.004, y, 0);
    g.add(b);
  });

  let shownA = null, shownB = null;
  return {
    group: g,
    setScreens(a, b, mix) {
      if (a !== shownA) { matA.map = screens.get(a); shownA = a; }
      const tb = b || a;
      if (tb !== shownB) { matB.map = screens.get(tb); shownB = tb; }
      // keep textures fresh once they finish loading
      matA.map = screens.get(a);
      matB.map = screens.get(tb);
      matB.opacity = tb === a ? 0 : mix;
      scrB.visible = matB.opacity > 0.002;
    },
    setGlare(x) { glareTex.offset.x = x; },
  };
}

/* ------------------------------------------------------------------ Minty */
const P = 3.0, SX = 0.66, SY = 0.61, SZ = 0.52;
const MW = 1.5, MH = 1.6, MCY = 0.14; // overall size and visual centre offset
function surf(u, v) {
  const a = 1 - Math.abs(u) ** P - Math.abs(v) ** P;
  return new THREE.Vector3(u * SX, v * SY, (a > 0 ? a ** (1 / P) : 0) * SZ);
}
function surfNormal(u, v) {
  const w = surf(u, v).z / SZ;
  return new THREE.Vector3(
    (Math.sign(u) * Math.abs(u) ** (P - 1)) / SX,
    (Math.sign(v) * Math.abs(v) ** (P - 1)) / SY,
    Math.abs(w) ** (P - 1) / SZ,
  ).normalize();
}
const Z_AXIS = new THREE.Vector3(0, 0, 1);
function onFace(obj, u, v, lift) {
  const n = surfNormal(u, v);
  obj.position.copy(surf(u, v)).addScaledVector(n, lift);
  obj.quaternion.setFromUnitVectors(Z_AXIS, n);
  return obj;
}

function buildMinty() {
  const root = new THREE.Group();      // placed by the scroll system
  const pivot = new THREE.Group();     // bob / jump / squash from the feet
  const body = new THREE.Group();      // the character itself
  pivot.position.y = -SY;
  body.position.y = SY;
  pivot.add(body);
  root.add(pivot);

  // body: a squircle "gummy" with a cream base
  const geo = new THREE.SphereGeometry(1, 72, 54);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color('#e4faee'), mid = new THREE.Color('#a2e4c1'), low = new THREE.Color('#6cc99a');
  const cream = new THREE.Color('#fffaee'), c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const s = (Math.abs(v.x) ** P + Math.abs(v.y) ** P + Math.abs(v.z) ** P) ** (-1 / P);
    const x = v.x * s, y = v.y * s, z = v.z * s;
    pos.setXYZ(i, x * SX, y * SY, z * SZ);
    const t = (y + 1) / 2;
    if (t > 0.5) c.copy(mid).lerp(top, (t - 0.5) * 2); else c.copy(low).lerp(mid, t * 2);
    const edge = -0.6 - 0.1 * (1 - x * x);
    c.lerp(cream, smooth(edge + 0.025, edge - 0.025, y));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const bodyMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.28, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff) });
  body.add(new THREE.Mesh(geo, bodyMat));

  // glossy highlight like the logo
  const shine = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
  onFace(shine, -0.46, 0.6, 0.006);
  shine.scale.set(0.15, 0.075, 1);
  shine.rotateZ(-0.42);
  body.add(shine);

  // eyes
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x1f3d2c, roughness: 0.12, clearcoat: 1 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const ball = new THREE.SphereGeometry(1, 24, 16);
  const eyes = [-1, 1].map((side) => {
    const g = onFace(new THREE.Group(), side * 0.333, 0.05, 0.004);
    const inner = new THREE.Group();
    const eye = new THREE.Mesh(ball, eyeMat);
    eye.scale.set(0.07, 0.09, 0.03);
    const h1 = new THREE.Mesh(ball, white);
    h1.scale.setScalar(0.024);
    h1.position.set(0.024, 0.036, 0.026);
    const h2 = new THREE.Mesh(ball, white);
    h2.scale.setScalar(0.01);
    h2.position.set(-0.026, -0.036, 0.022);
    inner.add(eye, h1, h2);
    g.add(inner);
    body.add(g);
    return inner;
  });

  // cheeks
  const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff98b0, transparent: true, opacity: 0.55, depthWrite: false });
  [-1, 1].forEach((side) => {
    const ch = onFace(new THREE.Mesh(new THREE.CircleGeometry(1, 24), cheekMat), side * 0.576, -0.23, 0.012);
    ch.scale.set(0.105, 0.065, 1);
    body.add(ch);
  });

  // smile
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const sx = (1 - t) ** 2 * 89 + 2 * (1 - t) * t * 100 + t * t * 111;
    const sy = (1 - t) ** 2 * 139 + 2 * (1 - t) * t * 150 + t * t * 139;
    const u = (sx - 100) / 66, vv = -(sy - 125) / 61;
    pts.push(surf(u, vv).addScaledVector(surfNormal(u, vv), 0.012));
  }
  const mouth = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.019, 8), eyeMat);
  body.add(mouth);

  // stem and leaves
  const green = new THREE.MeshPhysicalMaterial({ color: 0x5fbf73, roughness: 0.45, clearcoat: 0.5, sheen: 0.5, sheenColor: new THREE.Color(0xe6fad9), side: THREE.DoubleSide });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x2f8a60, roughness: 0.6 });
  const stem = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0.52, 0), new THREE.Vector3(0.005, 0.68, 0), new THREE.Vector3(0.04, 0.8, 0)), 12, 0.022, 8), stemMat);
  body.add(stem);
  function leaf(c1, c2, end, b1, b2) {
    const s = new THREE.Shape();
    const k = 0.01;
    s.moveTo(0, 0);
    s.bezierCurveTo(c1[0] * k, c1[1] * k, c2[0] * k, c2[1] * k, end[0] * k, end[1] * k);
    s.bezierCurveTo(b1[0] * k, b1[1] * k, b2[0] * k, b2[1] * k, 0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2, curveSegments: 14 });
    g.translate(0, 0, -0.01);
    return new THREE.Mesh(g, green);
  }
  const leafBig = leaf([8, 16], [28, 20], [40, 14], [34, -1], [16, -9]);
  const leafSmall = leaf([-8, 10], [-21, 11], [-28, 7], [-22, -3], [-9, -5]);
  const leafBigPivot = new THREE.Group(); leafBigPivot.position.set(0.03, 0.73, 0); leafBigPivot.add(leafBig); leafBig.rotation.y = -0.35;
  const leafSmallPivot = new THREE.Group(); leafSmallPivot.position.set(0.01, 0.67, 0); leafSmallPivot.add(leafSmall); leafSmall.rotation.y = 0.35;
  body.add(leafBigPivot, leafSmallPivot);

  // arms
  const armMat = new THREE.MeshPhysicalMaterial({ color: 0x9fe2be, roughness: 0.4, clearcoat: 0.7, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) });
  function arm(x) {
    const p = new THREE.Group();
    p.position.set(x, -0.06, 0.06);
    const a = new THREE.Mesh(ball, armMat);
    a.scale.set(0.11, 0.155, 0.1);
    a.position.y = 0.19;
    p.add(a);
    body.add(p);
    return p;
  }
  const armL = arm(-0.5), armR = arm(0.5);

  // soft shadow
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: canvasTex(128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(20,60,40,0.42)'); gr.addColorStop(1, 'rgba(20,60,40,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }), transparent: true, depthWrite: false, toneMapped: false,
  }));
  shadow.position.set(0, -SY - 0.04, -0.2);
  shadow.scale.set(1.25, 0.2, 1);
  root.add(shadow);

  // sleepy z's
  const zTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9eedb'; g.font = 'italic 700 104px Fraunces, Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('z', w / 2, h / 2);
  });
  const zs = [0, 1, 2].map(() => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    root.add(s);
    return s;
  });

  const MOODS = {
    wave: { rB: -0.75, rO: 0.5, rF: 9, lB: 2.55, lO: 0.06, jump: 0, eyes: 1, tilt: 0, zzz: 0 },
    happy: { rB: -2.45, rO: 0.12, rF: 3, lB: 2.45, lO: 0.12, jump: 0.05, eyes: 1, tilt: 0, zzz: 0 },
    cheer: { rB: -0.45, rO: 0.28, rF: 13, lB: 0.45, lO: 0.28, jump: 0.2, eyes: 1, tilt: 0, zzz: 0 },
    look: { rB: -2.55, rO: 0.06, rF: 2, lB: 2.55, lO: 0.06, jump: 0, eyes: 1, tilt: 0, zzz: 0 },
    sleep: { rB: -2.7, rO: 0, rF: 1, lB: 2.7, lO: 0, jump: 0, eyes: 0.08, tilt: 0.16, zzz: 1 },
  };
  const cur = { ...MOODS.happy };
  let blinkAt = 2, cheerUntil = 0;
  addEventListener('minty:cheer', () => { cheerUntil = performance.now() / 1000 + 2.5; });

  return {
    group: root,
    update(time, dt, moodName, look) {
      const mood = time < cheerUntil ? MOODS.cheer : (MOODS[moodName] || MOODS.happy);
      const k = 1 - Math.exp(-dt * 6);
      for (const key in cur) if (key !== 'rF') cur[key] += (mood[key] - cur[key]) * k;
      cur.rF = mood.rF;
      const still = reduce ? 0 : 1;
      armR.rotation.z = cur.rB + Math.sin(time * cur.rF) * cur.rO * still;
      armL.rotation.z = cur.lB - Math.sin(time * cur.rF + 0.6) * cur.lO * still;

      const hop = Math.abs(Math.sin(time * 5)) * cur.jump * still;
      const breathe = Math.sin(time * (cur.zzz > 0.5 ? 1.6 : 3.2)) * 0.018 * still;
      pivot.position.y = -SY + hop + Math.sin(time * 2) * 0.02 * still;
      const land = cur.jump > 0.05 ? (1 - Math.abs(Math.sin(time * 5))) ** 6 * 0.1 : 0;
      pivot.scale.set(1 + land * 0.6 - breathe * 0.5, 1 - land + breathe, 1);
      pivot.rotation.z = cur.tilt + Math.sin(time * 1.3) * 0.03 * still;
      shadow.scale.set(1.25 * (1 - hop * 1.2), 0.2 * (1 - hop * 1.2), 1);

      // blink
      let lid = cur.eyes;
      if (time > blinkAt) { if (time > blinkAt + 0.14) blinkAt = time + 2.2 + Math.random() * 3; else lid *= 0.12; }
      eyes.forEach((e) => {
        e.scale.y = lid;
        e.position.x = look.x * 0.018;
        e.position.y = look.y * 0.014;
      });
      body.rotation.y = look.x * 0.35;
      body.rotation.x = -look.y * 0.12;
      leafBigPivot.rotation.z = Math.sin(time * 1.7) * 0.08 * still;
      leafSmallPivot.rotation.z = Math.sin(time * 1.7 + 1) * 0.1 * still;

      zs.forEach((s, i) => {
        const p = ((time * 0.35 + i / 3) % 1);
        s.position.set(0.5 + p * 0.35, 0.55 + p * 0.75, 0.2);
        s.scale.setScalar(0.12 + p * 0.14);
        s.material.opacity = cur.zzz * Math.sin(p * Math.PI);
        s.visible = s.material.opacity > 0.01;
      });
    },
  };
}

/* ------------------------------------------------------------------ capsules */
function buildCapsules(n) {
  const palette = ['#8fdcb3', '#ff98b0', '#ffd66b', '#2f8a60', '#8fdcb3'];
  const geo = new THREE.CapsuleGeometry(0.11, 0.24, 6, 14);
  const items = [];
  const group = new THREE.Group();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const g = geo.clone();
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const a = new THREE.Color(palette[i % palette.length]), w = new THREE.Color('#fffdf6');
    for (let j = 0; j < pos.count; j++) (pos.getY(j) > 0 ? w : a).toArray(col, j * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 }));
    const side = i % 2 ? 1 : -1;
    items.push({
      m, fx: side * (0.78 + rnd() * 0.3), base: rnd(), z: -1.5 - rnd() * 4, speed: 0.25 + rnd() * 0.5,
      ax: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: 0.2 + rnd() * 0.6, s: 0.8 + rnd() * 0.7,
    });
    m.scale.setScalar(items[i].s);
    group.add(m);
  }
  return { group, items };
}

/* ------------------------------------------------------------------ main */
function start() {
  const canvas = document.getElementById('gl');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return;
  }
  root.classList.add('gl-on');
  const lowRes = coarse || innerWidth < 900;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lowRes ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9cc7b0, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 6);
  const rim = new THREE.DirectionalLight(0xc9eedb, 1.2);
  rim.position.set(-5, 2, -4);
  scene.add(key, rim);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(0, 0, 10);

  const screens = screenStore(renderer, lowRes);
  const phone = buildPhone(screens);
  const minty = buildMinty();
  const caps = buildCapsules(lowRes ? 6 : 12);
  scene.add(caps.group, phone.group, minty.group);

  /* ---- slots */
  const num = (el, k) => Number(el.dataset[k] || 0);
  const phoneSlots = [...document.querySelectorAll('[data-phone]')].map((el) => ({
    el, hide: el.dataset.phone === 'hide', screen: el.dataset.screen || 'today', spin: el.hasAttribute('data-spin'),
    rx: num(el, 'rx') * D2R, ry: num(el, 'ry') * D2R, rz: num(el, 'rz') * D2R,
  }));
  const mintySlots = [...document.querySelectorAll('[data-minty]')].map((el) => ({
    el, kind: el.dataset.minty, mood: el.dataset.mood || 'happy', msize: Number(el.dataset.msize || 0.42),
    dir: el.dataset.perch === 'left' ? -1 : 1, phone: el.hasAttribute('data-phone') && el.dataset.phone !== 'hide',
    ry: num(el, 'ry') * D2R, spin: el.hasAttribute('data-spin'), say: el.dataset.say || '',
  }));
  const bgSlots = [...document.querySelectorAll('[data-bg]')].map((el) => ({ el, c: new THREE.Color(el.dataset.bg) }));
  screens.preload(['today']);
  const later = () => screens.preload(phoneSlots.map((s) => s.screen));
  ('requestIdleCallback' in window ? requestIdleCallback : setTimeout)(later, { timeout: 1500 });

  /* ---- viewport */
  let vw = 0, vh = 0, perPx = 1, halfW = 1, halfH = 1;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === vw && h === vh) return;
    vw = w; vh = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfH = camera.position.z * Math.tan((camera.fov / 2) * D2R);
    halfW = halfH * camera.aspect;
    perPx = (halfH * 2) / vh;
  }
  const toX = (px) => (px - vw / 2) * perPx;
  const toY = (py) => -(py - vh / 2) * perPx;

  function box(r) {
    return { x: toX(r.left + r.width / 2), y: toY(r.top + r.height / 2), w: r.width * perPx, h: r.height * perPx };
  }
  function phoneFit(r) {
    const b = box(r);
    let s = (b.h * 0.96) / PH;
    if (s * PW > b.w * 0.98) s = (b.w * 0.98) / PW;
    return { ...b, s, pw: PW * s, ph: PH * s };
  }
  function phoneState(slot, r) {
    const f = phoneFit(r);
    return { x: f.x, y: f.y, z: 0, s: slot.hide ? 0 : f.s, rx: slot.rx, ry: slot.ry, rz: slot.rz, screen: slot.screen, spin: slot.spin };
  }
  function mintyState(slot, r) {
    let s, x, y, z = 0;
    if (slot.kind === 'fill') {
      const b = box(r);
      s = Math.min((b.h * 0.92) / MH, (b.w * 0.92) / MW);
      x = b.x; y = b.y - MCY * s;
    } else {
      const f = slot.phone ? phoneFit(r) : { ...box(r), pw: r.width * perPx, ph: r.height * perPx };
      const turn = slot.phone ? Math.abs(Math.cos(slot.ry)) : 1;
      s = (slot.msize * f.pw) / MW;
      if (slot.kind === 'side') {
        x = f.x + slot.dir * (f.pw * turn * 0.5 + MW * s * 0.3);
        y = f.y - f.ph / 2 + SY * s + 0.02;
        z = 0.5;
      } else {
        x = f.x + slot.dir * f.pw * turn * 0.27;
        y = f.y + f.ph / 2 + (SY - 0.03) * s;
        z = 0.35;
      }
      const lim = halfW - (MW * s) / 2 - 0.05;
      x = Math.max(-lim, Math.min(lim, x));
    }
    return { x, y, z, s, mood: slot.mood, spin: slot.spin };
  }
  /** The two slots either side of the viewport centre and how far we are between them. */
  function between(slots, band = 0.1) {
    const c = vh * 0.5;
    let b = -1;
    const rects = slots.map((s) => s.el.getBoundingClientRect());
    for (let i = 0; i < slots.length; i++) {
      if (rects[i].top + rects[i].height / 2 - c > 0) { b = i; break; }
    }
    if (b === -1) return { a: slots.length - 1, b: -1, t: 0, rects };
    if (b === 0) return { a: 0, b: -1, t: 0, rects };
    const da = rects[b - 1].top + rects[b - 1].height / 2 - c;
    const db = rects[b].top + rects[b].height / 2 - c;
    return { a: b - 1, b, t: smoother(band, 1 - band, -da / (db - da)), rects };
  }

  /* ---- pointer */
  const look = { x: 0, y: 0 }, lookT = { x: 0, y: 0 };
  if (!coarse) {
    addEventListener('pointermove', (e) => {
      lookT.x = (e.clientX / innerWidth) * 2 - 1;
      lookT.y = -((e.clientY / innerHeight) * 2 - 1);
    }, { passive: true });
  }

  /* ---- live state (damped) */
  const ph = { x: 0, y: -halfH * 3, z: 0, s: 0.6, rx: 0.4, ry: -3.2, rz: 0.3 };
  const mi = { x: 0, y: 0, z: 0, s: 0, spin: 0 };
  const bg = new THREE.Color('#f8f6f0'), tmp = new THREE.Color();
  const topbar = document.getElementById('topbar');
  const progress = document.getElementById('progress');
  const theme = document.querySelector('meta[name="theme-color"]');
  let lastBg = '', lastDark = null;
  let ryT = ph.ry, ryPrev = ph.ry, spT = 0, spPrev = 0;

  /* ---- Minty's speech bubble */
  const say = document.getElementById('say');
  const sayT = say.querySelector('.t');
  const proj = new THREE.Vector3();
  let sayText = '', sayNW = 0, sayW = 0, sayH = 0, sayVw = 0, sayOn = false, sayDir = '', override = '', overrideUntil = 0;
  addEventListener('minty:cheer', () => { override = 'Yay! Your download is starting. Take care!'; overrideUntil = performance.now() + 5000; });
  function setSay(text) {
    if (text === sayText && sayVw === vw) return;
    if (text !== sayText) { sayT.textContent = text; say.classList.add('pop'); requestAnimationFrame(() => say.classList.remove('pop')); }
    sayText = text; sayVw = vw;
    say.style.maxWidth = '';
    sayNW = sayW = say.offsetWidth; sayH = say.offsetHeight;
  }
  function bubble(settled, slotSay) {
    const now = performance.now();
    const text = now < overrideUntil ? override : slotSay;
    const vis = !!text && mi.s > 0.05 && (settled || now < overrideUntil);
    if (!vis) { if (sayOn) { sayOn = false; say.classList.remove('on'); } return; }
    setSay(text);
    proj.set(mi.x, mi.y + (MCY + MH * 0.5) * mi.s, mi.z).project(camera);
    const headX = (proj.x + 1) * 0.5 * vw, headY = (1 - proj.y) * 0.5 * vh;
    proj.set(mi.x, mi.y + (MCY - MH * 0.5) * mi.s, mi.z).project(camera);
    const feetY = (1 - proj.y) * 0.5 * vh;
    let w = sayW, h = sayH;
    if (headY < -40 || feetY > vh + 40) { if (sayOn) { sayOn = false; say.classList.remove('on'); } return; }
    proj.set(mi.x + MW * 0.5 * mi.s, mi.y + MCY * mi.s, mi.z).project(camera);
    const halfPx = (proj.x + 1) * 0.5 * vw - headX;
    const midY = (headY + feetY) / 2;
    let dir, x, y;
    const roomR = vw - (headX + halfPx + 12) - 10, roomL = headX - halfPx - 12 - 10;
    // narrow screens: let a side bubble wrap to fit next to Minty
    const fit = (room) => {
      const mw = room >= sayNW ? '' : `${Math.floor(room)}px`;
      if (say.style.maxWidth !== mw) { say.style.maxWidth = mw; w = sayW = say.offsetWidth; h = sayH = say.offsetHeight; }
    };
    if (headY - h - 14 > 76) { fit(9999); dir = 'up'; y = headY - h - 10; x = headX - w / 2; }
    else if (roomR >= Math.min(sayNW, 150)) { fit(roomR); dir = 'right'; x = headX + halfPx + 12; y = midY - h / 2; }
    else if (roomL >= Math.min(sayNW, 150)) { fit(roomL); dir = 'left'; x = headX - halfPx - 12 - w; y = midY - h / 2; }
    else { fit(9999); dir = 'down'; y = feetY + 12; x = headX - w / 2; }
    x = Math.max(12, Math.min(vw - w - 12, x));
    y = Math.max(76, y);
    if (dir !== sayDir) { if (sayDir) say.classList.remove(sayDir); sayDir = dir; say.classList.add(dir); }
    if (dir === 'up' || dir === 'down') say.style.setProperty('--tail', `${Math.max(18, Math.min(w - 18, headX - x))}px`);
    else say.style.setProperty('--tail-y', `${Math.max(16, Math.min(h - 16, midY - y))}px`);
    say.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    if (!sayOn) { sayOn = true; say.classList.add('on'); }
  }

  const clock = new THREE.Clock();
  let started = 0;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    resize();
    look.x += (lookT.x - look.x) * (1 - Math.exp(-dt * 4));
    look.y += (lookT.y - look.y) * (1 - Math.exp(-dt * 4));
    const intro = Math.min(1, (time - started) / 1.4);
    const k = 1 - Math.exp(-dt * lerp(3.5, 6.5, intro));

    /* phone */
    const narrow = vw < 900;
    const P1 = between(phoneSlots);
    const A = phoneState(phoneSlots[P1.a], P1.rects[P1.a]);
    let tgt = A, screenB = null, mix = 0;
    if (P1.b !== -1) {
      const B = phoneState(phoneSlots[P1.b], P1.rects[P1.b]);
      const t = P1.t;
      const arc = Math.sin(t * Math.PI);
      const spin = A.spin && B.spin && !reduce;
      tgt = {
        x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t), z: narrow ? 0 : (reduce ? 0 : 1.3) * arc,
        // phones: shrink through a "portal" so it never crosses the text column
        s: lerp(A.s, B.s, t) * (narrow ? Math.max(0, 1 - 1.8 * arc) : 1), rx: lerp(A.rx, B.rx, t) + arc * 0.15, rz: lerp(A.rz, B.rz, t),
        ry: lerp(A.ry, B.ry, t) + (spin ? (B.x >= A.x ? 1 : -1) * TAU * t : arc * 0.5),
      };
      screenB = B.screen;
      mix = spin ? smooth(0.44, 0.56, t) : smooth(0.3, 0.7, t);
    }
    const idle = reduce ? 0 : 1;
    for (const key of ['x', 'y', 'z', 's', 'rx', 'rz']) ph[key] += (tgt[key] - ph[key]) * k;
    // follow an unwrapped target so fast scrolling never makes a spin reverse
    ryT += angDiff(ryPrev, tgt.ry); ryPrev = tgt.ry;
    ph.ry += (ryT - ph.ry) * k;
    phone.group.position.set(ph.x, ph.y + Math.sin(time * 1.1) * 0.035 * ph.s * idle, ph.z);
    phone.group.rotation.set(ph.rx - look.y * 0.08, ph.ry + look.x * 0.14, ph.rz + Math.sin(time * 0.7) * 0.012 * idle);
    phone.group.scale.setScalar(Math.max(ph.s, 0.0001));
    phone.group.visible = ph.s > 0.01;
    phone.setScreens(A.screen, screenB, mix);
    phone.setGlare(angDiff(0, ph.ry) * 0.25 + look.x * 0.1);

    /* Minty */
    const M = between(mintySlots);
    const MA = mintyState(mintySlots[M.a], M.rects[M.a]);
    let mt = MA, mood = MA.mood;
    if (M.b !== -1) {
      const MB = mintyState(mintySlots[M.b], M.rects[M.b]);
      const t = M.t, arc = Math.sin(t * Math.PI);
      const flip = MA.spin && MB.spin && !reduce;
      mt = {
        x: lerp(MA.x, MB.x, t), y: lerp(MA.y, MB.y, t) + arc * 0.9 * Math.max(MA.s, MB.s) * (reduce ? 0 : 1),
        z: lerp(MA.z, MB.z, t) + (narrow ? 0 : (flip ? 1.7 : 0.6) * arc * (reduce ? 0 : 1)),
        s: lerp(MA.s, MB.s, t) * (narrow ? Math.max(0, 1 - 1.8 * arc) : 1), spin: flip ? TAU * t : 0,
      };
      mood = t < 0.5 ? MA.mood : MB.mood;
    }
    for (const key of ['x', 'y', 'z', 's']) mi[key] += (mt[key] - mi[key]) * k;
    spT += angDiff(spPrev, mt.spin); spPrev = mt.spin;
    mi.spin += (spT - mi.spin) * k;
    minty.group.position.set(mi.x, mi.y, mi.z);
    minty.group.scale.setScalar(Math.max(mi.s, 0.0001));
    minty.group.rotation.y = mi.spin;
    minty.group.visible = mi.s > 0.01;
    // look at the pointer, or at the phone when there is no pointer
    const lx = coarse ? Math.max(-1, Math.min(1, (ph.x - mi.x) * 0.8)) : look.x - mi.x / halfW * 0.6;
    {
      const settled = M.b === -1 || M.t < 0.06 || M.t > 0.94;
      const near = M.b !== -1 && M.t > 0.5 ? M.b : M.a;
      bubble(settled && Math.abs(mt.s - mi.s) < 0.03 * Math.max(mt.s, 0.01) + 0.01, mintySlots[near].say);
    }
    minty.update(time, dt, mood, { x: Math.max(-1, Math.min(1, lx)), y: coarse ? 0 : look.y });

    /* capsules drift with parallax */
    const sy = scrollY * perPx;
    const span = halfH * 2 * 1.6;
    caps.items.forEach((c, i) => {
      const depth = (camera.position.z - c.z) / camera.position.z;
      let y = c.base * span + sy * c.speed;
      y = ((y % span) + span) % span - span / 2;
      c.m.position.set(c.fx * halfW * depth, y * depth, c.z);
      if (!reduce) c.m.rotateOnAxis(c.ax, dt * c.spin);
      c.m.rotation.z += reduce ? 0 : Math.sin(time + i) * 0.002;
    });

    /* page background */
    const G = between(bgSlots, 0.3);
    tmp.copy(bgSlots[G.a].c);
    if (G.b !== -1) tmp.lerp(bgSlots[G.b].c, G.t);
    bg.copy(tmp);
    const hex = '#' + bg.getHexString();
    if (hex !== lastBg) {
      lastBg = hex;
      document.body.style.backgroundColor = hex;
      if (theme) theme.setAttribute('content', hex);
      const srgb = bg.clone().convertLinearToSRGB();
      topbar.style.backgroundColor = `rgba(${Math.round(srgb.r * 255)},${Math.round(srgb.g * 255)},${Math.round(srgb.b * 255)},0.72)`;
      const dark = srgb.r * 0.3 + srgb.g * 0.59 + srgb.b * 0.11 < 0.45;
      if (dark !== lastDark) { lastDark = dark; topbar.classList.toggle('on-dark', dark); }
    }
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.width = `${max > 0 ? (scrollY / max) * 100 : 0}%`;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  resize();
  started = 0;
  requestAnimationFrame(frame);

  // lost GPU context (e.g. low memory): fall back to the plain images
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); root.classList.remove('gl-on'); say.classList.remove('on'); });
}

try { start(); } catch (err) { root.classList.remove('gl-on'); console.warn('3D disabled:', err); }
