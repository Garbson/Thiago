/* Sobrevoo 3D — litoral catarinense em Three.js (r128, global THREE).
   Uso: const api = Sobrevoo3D.init(canvas, { cities: [{ name, t }] });
        api.setProgress(0..1); api.setCounts([n por cidade]); api.dispose();
   init devolve null se o WebGL não estiver disponível.
   Eixos: o voo segue -Z (norte → sul); mar em +X, terra em -X.
   "o" = distância à linha da costa (o > 20 é água, o < 0 é cidade). */
(function () {
  "use strict";

  const L = 2200;
  const SHORE = 20; // largura da faixa de areia

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const wob = (z, s) =>
    Math.sin(z * 0.013 + s) * 0.5 + Math.sin(z * 0.031 + s * 2.3) * 0.3 + Math.sin(z * 0.07 + s * 5.1) * 0.2;
  const coastX = (z) => 16 * Math.sin(z * 0.006) + 7 * Math.sin(z * 0.019 + 1.3);
  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  const RIVERS = [
    { z: -0.205 * L, half: 15 },
    { z: -0.615 * L, half: 30, stay: true }, // foz larga: ponte estaiada
    { z: -0.995 * L, half: 17 },
  ];
  const riverF = (z) => {
    let f = 0;
    for (const r of RIVERS) f = Math.max(f, 1 - smooth(r.half, r.half + 12, Math.abs(z - r.z)));
    return f;
  };
  const inRiver = (z, m) => RIVERS.some((r) => Math.abs(z - r.z) < r.half + (m || 0));

  const PROFILE = {
    "Itapoá": { ext: 128, depth: 120, dens: 0.66, h: [7, 26], sky: [30, 66], build: 7, lots: true, houses: 0.4, pier: true },
    "Barra Velha": { ext: 58, depth: 82, dens: 0.6, h: [6, 30], houses: 0.3 },
    "Piçarras": { ext: 62, depth: 82, dens: 0.62, h: [6, 38], houses: 0.25, pier: true },
    "Penha": { ext: 58, depth: 82, dens: 0.55, h: [5, 24], houses: 0.4 },
    "Navegantes": { ext: 58, depth: 82, dens: 0.6, h: [5, 22], houses: 0.4 },
    "Itajaí": { ext: 84, depth: 120, dens: 0.72, h: [8, 48], houses: 0.12, port: true },
    "Camboriú": { ext: 62, depth: 82, dens: 0.62, h: [5, 30], houses: 0.3, inland: 60 },
    "Balneário Camboriú": { ext: 122, depth: 158, dens: 0.92, h: [26, 80], towers: [95, 205], wheel: true, pier: true },
  };

  // ---------- Texturas procedurais ----------
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

  // Cada textura cobre 8 janelas × 16 andares; devolve [dia, noite].
  function facade(style, seed) {
    const r = rng(seed), W = 256, H = 512, cw = 32, ch = 32;
    const day = canvas(W, H), night = canvas(W, H), d = day.getContext("2d"), n = night.getContext("2d");
    n.fillStyle = "#000"; n.fillRect(0, 0, W, H);
    const lit = (x, y, w, h, p) => {
      const k = r(); if (k > p) return false;
      n.globalAlpha = 0.45 + r() * 0.55;
      n.fillStyle = k < p * 0.55 ? "#ffcf87" : k < p * 0.85 ? "#ffe6b8" : "#b4d6ff";
      n.fillRect(x, y, w, h); n.globalAlpha = 1; return true;
    };
    if (style === "res") {
      d.fillStyle = "#ece9e2"; d.fillRect(0, 0, W, H);
      for (let fy = 0; fy < 16; fy++) for (let fx = 0; fx < 8; fx++) {
        const x = fx * cw, y = fy * ch;
        d.fillStyle = r() < 0.5 ? "#2c4056" : "#38506a"; d.fillRect(x + 5, y + 4, 22, 15);
        d.fillStyle = "#f6f4ee"; d.fillRect(x + 15, y + 4, 2, 15);
        d.fillStyle = "rgba(120,160,185,.75)"; d.fillRect(x + 1, y + 20, 30, 8); // guarda-corpo de vidro
        d.fillStyle = "#bfb9ad"; d.fillRect(x, y + 28, cw, 4); // laje
        if (lit(x + 5, y + 4, 22, 15, 0.5)) { n.globalAlpha = 0.18; n.fillStyle = "#ffd9a0"; n.fillRect(x + 1, y + 20, 30, 8); n.globalAlpha = 1; }
      }
    } else if (style === "glass") {
      for (let fy = 0; fy < 16; fy++) for (let fx = 0; fx < 8; fx++) {
        const x = fx * cw, y = fy * ch, g = d.createLinearGradient(0, y, 0, y + ch);
        const t = 0.85 + r() * 0.3;
        g.addColorStop(0, `rgb(${96 * t | 0},${150 * t | 0},${190 * t | 0})`); g.addColorStop(1, `rgb(${44 * t | 0},${84 * t | 0},${122 * t | 0})`);
        d.fillStyle = g; d.fillRect(x, y, cw, ch);
        d.fillStyle = "#1b2d40"; d.fillRect(x, y, 2, ch); d.fillRect(x, y + 26, cw, 6);
        lit(x + 2, y + 1, cw - 2, 25, 0.36);
      }
    } else if (style === "concrete") {
      d.fillStyle = "#d2c6b2"; d.fillRect(0, 0, W, H);
      for (let fy = 0; fy < 16; fy++) for (let fx = 0; fx < 8; fx++) {
        const x = fx * cw, y = fy * ch;
        d.fillStyle = "#efe9dc"; d.fillRect(x + 6, y + 5, 20, 20);
        d.fillStyle = r() < 0.5 ? "#33465c" : "#42566e"; d.fillRect(x + 8, y + 7, 16, 16);
        d.fillStyle = "rgba(0,0,0,.12)"; d.fillRect(x, y + 30, cw, 2);
        lit(x + 8, y + 7, 16, 16, 0.55);
      }
    } else if (style === "dark") {
      d.fillStyle = "#30353d"; d.fillRect(0, 0, W, H);
      for (let fy = 0; fy < 16; fy++) for (let fx = 0; fx < 8; fx++) {
        const x = fx * cw, y = fy * ch;
        d.fillStyle = "#566d82"; d.fillRect(x + 4, y + 2, 10, 26); d.fillRect(x + 18, y + 2, 10, 26);
        d.fillStyle = "#1f2329"; d.fillRect(x, y + 29, cw, 3);
        lit(x + 4, y + 2, 10, 26, 0.42); lit(x + 18, y + 2, 10, 26, 0.42);
      }
    } else { // lojas no térreo
      d.fillStyle = "#b9b2a6"; d.fillRect(0, 0, W, H);
      const aw = ["#b33a2e", "#1f6f8f", "#2d7a4d", "#c9972e", "#3a3f48"];
      for (let fx = 0; fx < 8; fx++) {
        const x = fx * cw;
        d.fillStyle = "#28384a"; d.fillRect(x + 3, 190, 26, 290);
        d.fillStyle = aw[(r() * aw.length) | 0]; d.fillRect(x + 1, 150, 30, 46);
        d.fillStyle = "#8f887c"; d.fillRect(x, 0, cw, 40);
        n.globalAlpha = 0.65 + r() * 0.35; n.fillStyle = r() < 0.7 ? "#ffd590" : "#d8ecff"; n.fillRect(x + 3, 190, 26, 290); n.globalAlpha = 1;
      }
    }
    const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
    return [mk(day), mk(night)];
  }

  function noiseTex(seed, base, amp) {
    const c = canvas(256, 256), g = c.getContext("2d"), r = rng(seed), img = g.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) { const v = base + (r() - 0.5) * amp + (r() < 0.03 ? -18 : 0); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }

  function glowTex(color) {
    const c = canvas(128, 128), g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.18, color); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  function glowSprite(color, size) {
    const m = new THREE.SpriteMaterial({ map: glowTex(color), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m); s.scale.set(size, size, 1); return s;
  }
  function cloudTex(seed) {
    const c = canvas(256, 128), g = c.getContext("2d"), r = rng(seed);
    for (let i = 0; i < 26; i++) {
      const x = 40 + r() * 176, y = 50 + r() * 40, rad = 18 + r() * 34, gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    }
    return new THREE.CanvasTexture(c);
  }
  function labelSprite(text) {
    const c = canvas(512, 128), g = c.getContext("2d");
    g.font = "600 54px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,.75)"; g.shadowBlur = 14; g.fillStyle = "#fff"; g.fillText(text, 256, 56);
    g.shadowBlur = 0; g.fillStyle = "#E5BC57";
    const w = Math.min(420, g.measureText(text).width); g.fillRect(256 - w / 2, 98, w, 5);
    const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false });
    const s = new THREE.Sprite(m); s.scale.set(64, 16, 1); s.renderOrder = 5; return s;
  }

  // ---------- Helicóptero ----------
  function buildHelicopter() {
    const g = new THREE.Group();
    // pintura: branco em cima, barriga azul-marinho, filete dourado
    const lc = canvas(256, 64), lg = lc.getContext("2d");
    lg.fillStyle = "#f5f5f2"; lg.fillRect(0, 0, 256, 64);
    lg.fillStyle = "#0b2f5b"; lg.fillRect(80, 0, 96, 64);
    lg.fillStyle = "#c9972e"; lg.fillRect(72, 0, 8, 64); lg.fillRect(176, 0, 8, 64);
    const paint = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(lc), roughness: 0.28, metalness: 0.35 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: 0.3, metalness: 0.35 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x0b2f5b, roughness: 0.35, metalness: 0.4 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9972e, roughness: 0.35, metalness: 0.7 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a1b30, roughness: 0.06, metalness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1f27, roughness: 0.55, metalness: 0.4 });
    const add = (m) => { m.castShadow = true; g.add(m); return m; };

    const prof = new THREE.SplineCurve([[0.02, -3.5], [0.75, -3.1], [1.55, -2.1], [2.02, -0.7], [2.15, 0.6], [2.0, 1.9], [1.5, 2.95], [0.8, 3.55], [0.02, 3.75]].map((p) => new THREE.Vector2(p[0], p[1])));
    const hull = new THREE.LatheGeometry(prof.getPoints(28), 28); hull.rotateX(-Math.PI / 2);
    const fus = add(new THREE.Mesh(hull, paint)); fus.scale.set(0.92, 1, 1);
    const canopy = add(new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), glass));
    canopy.scale.set(1.78, 1.75, 2.5); canopy.rotation.x = -1.15; canopy.position.set(0, 0.35, -1.55);
    [-1, 1].forEach((s) => {
      const w = add(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), glass)); w.scale.set(0.12, 0.62, 0.95); w.position.set(s * 1.86, 0.45, 0.75);
      const dl = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.05), dark)); dl.position.set(s * 1.93, 0.1, 1.85);
    });
    const cowl = add(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), white)); cowl.scale.set(1.25, 0.8, 2.4); cowl.position.set(0, 2.05, 0.9);
    const exh = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.9, 10), dark)); exh.rotation.x = Math.PI / 2; exh.position.set(0.6, 2.2, 3.1);
    const boom = add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.24, 8.6, 14), white)); boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.75, 7.0);
    const stripe = add(new THREE.Mesh(new THREE.CylinderGeometry(0.635, 0.5, 2.2, 14), gold)); stripe.rotation.x = Math.PI / 2; stripe.position.set(0, 0.75, 4.2);
    const finS = new THREE.Shape(); finS.moveTo(0, 0); finS.lineTo(1.5, 0); finS.lineTo(2.5, 3.1); finS.lineTo(1.5, 3.1); finS.lineTo(0, 0);
    const finG = new THREE.ExtrudeGeometry(finS, { depth: 0.16, bevelEnabled: false }); finG.rotateY(-Math.PI / 2); finG.translate(0.08, 0, 0);
    const fin = add(new THREE.Mesh(finG, navy)); fin.position.set(0, 0.6, 9.6);
    const fin2 = add(new THREE.Mesh(finG, navy)); fin2.scale.set(1, -0.45, 0.8); fin2.position.set(0, 0.7, 10.0);
    const stab = add(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 0.85), white)); stab.position.set(0, 0.9, 9.3);
    [-1.8, 1.8].forEach((x) => { const e = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.9), gold)); e.position.set(x, 0.9, 9.3); });

    const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1.1, 10), dark)); mast.position.set(0, 3.1, 0.6);
    const rotor = new THREE.Group(); rotor.position.set(0, 3.7, 0.6);
    rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.28, 12), dark));
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group(); arm.rotation.y = (i * Math.PI) / 2;
      const b = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.07, 0.5), dark); b.position.set(4.7, -0.08, 0); b.rotation.z = -0.03; arm.add(b);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.075, 0.5), gold); tip.position.set(8.65, -0.2, 0); arm.add(tip);
      rotor.add(arm);
    }
    const disc = new THREE.Mesh(new THREE.RingGeometry(1, 9, 48), new THREE.MeshBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; rotor.add(disc);
    g.add(rotor);
    const tail = new THREE.Group(); tail.position.set(0.5, 2.6, 10.9);
    tail.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.2, 0.3), dark));
    const tb2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.2, 0.3), dark); tb2.rotation.x = Math.PI / 2; tail.add(tb2);
    const td = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    td.rotation.y = Math.PI / 2; tail.add(td);
    g.add(tail);

    const tube = new THREE.CylinderGeometry(0.1, 0.1, 6.4, 8);
    [-1.75, 1.75].forEach((x) => {
      const s = add(new THREE.Mesh(tube, dark)); s.rotation.x = Math.PI / 2; s.position.set(x, -2.75, 0.3);
      const up = add(new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.1, 6, 10, Math.PI / 2), dark)); up.rotation.set(0, Math.PI / 2, Math.PI); up.position.set(x, -2.05, -2.9);
      [-1.3, 1.7].forEach((z) => { const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.5, 6), dark)); leg.position.set(x * 0.8, -2.15, z); leg.rotation.z = x > 0 ? 0.42 : -0.42; });
    });
    const red = glowSprite("rgba(255,50,50,.9)", 3.2); red.position.set(-2.0, 0.2, 0.5);
    const green = glowSprite("rgba(60,255,120,.9)", 3.2); green.position.set(2.0, 0.2, 0.5);
    const strobe = glowSprite("rgba(255,255,255,.95)", 6); strobe.position.set(0, 3.9, 10.4);
    const lamp = glowSprite("rgba(255,240,205,.9)", 5.5); lamp.position.set(0, -1.9, -2.6);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(15, 70, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0cc, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    cone.geometry.translate(0, -35, 0); cone.position.set(0, -1.9, -2.6); cone.rotation.x = -0.7;
    g.add(red, green, strobe, lamp, cone);
    g.scale.setScalar(1.12);
    g.userData = { rotor, tail, strobe, lamp, cone };
    return g;
  }

  function init(canvasEl, opts) {
    if (!window.THREE) return null;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: "high-performance" }); }
    catch (e) { return null; }
    let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const cities = opts.cities;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf2a878, 320, 1700);
    const camera = new THREE.PerspectiveCamera(52, 1, 2, 6500);
    const dummy = new THREE.Object3D();
    const noCull = (o) => { o.frustumCulled = false; return o; };

    // ---------- Céu, sol, lua, estrelas, nuvens ----------
    const skyU = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3200, 24, 16), new THREE.ShaderMaterial({
      uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: "varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ float t = pow(clamp(h*1.5+0.06,0.0,1.0),0.55); gl_FragColor = vec4(mix(bottom, top, t),1.0); }",
    }));
    scene.add(sky);
    const sr = rng(7), starPos = [];
    for (let i = 0; i < 1100; i++) { const u = sr() * Math.PI * 2, v = Math.acos(sr() * 0.9 + 0.08); starPos.push(3000 * Math.sin(v) * Math.cos(u), 3000 * Math.cos(v), 3000 * Math.sin(v) * Math.sin(u)); }
    const starG = new THREE.BufferGeometry(); starG.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    const stars = noCull(new THREE.Points(starG, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false })));
    scene.add(stars);
    const sun = glowSprite("rgba(255,170,80,.95)", 700); scene.add(sun);
    const moon = glowSprite("rgba(200,215,255,.75)", 200); scene.add(moon);
    const clouds = [], CR = rng(55);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.SpriteMaterial({ map: cloudTex(60 + i), transparent: true, depthWrite: false, fog: false, opacity: 0.8 });
      const s = new THREE.Sprite(m), a = -Math.PI * (0.1 + CR() * 0.8), dist = 2100 + CR() * 500;
      s.userData = { x: Math.sin(a) * dist * (CR() < 0.75 ? -1 : 1), y: 230 + CR() * 520, z: -Math.abs(Math.cos(a)) * dist - 300 };
      const k = 500 + CR() * 620; s.scale.set(k, k * 0.42, 1); scene.add(s); clouds.push(s);
    }

    // ---------- Luzes ----------
    const hemi = new THREE.HemisphereLight(0xffd9b0, 0x2a3640, 1.0); scene.add(hemi);
    const sunL = new THREE.DirectionalLight(0xffb070, 1.25); scene.add(sunL); scene.add(sunL.target);
    sunL.castShadow = true; sunL.shadow.mapSize.set(2048, 2048); sunL.shadow.bias = -0.0007; sunL.shadow.normalBias = 0.6;
    Object.assign(sunL.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 40, far: 1500 });
    const moonL = new THREE.DirectionalLight(0x8fb0ff, 0); moonL.position.set(260, 220, -120); scene.add(moonL);
    const SUN_DIR = new THREE.Vector3(-0.42, 0.3, 0.6).normalize();

    // ---------- Terreno ----------
    const offs = [-1500, -1000, -700, -480, -330, -200, -100, 0];
    const z0 = 340, z1 = -(L + 560), step = 8, rowsN = Math.floor((z0 - z1) / step) + 1;
    const gLow = new THREE.Color(0x6e9a5c), gMid = new THREE.Color(0x3f7447), gHigh = new THREE.Color(0x24503a), tc = new THREE.Color();
    const tp = [], tcol = [], tuv = [], ti = [];
    const groundY = (o, z) => {
      const d = Math.max(0, -o - 200);
      const y = 0.4 + d * 0.085 * (0.62 + 0.5 * wob(z + o * 0.7, 3)) + 16 * Math.max(0, wob(z * 1.7 + o, 9)) * smooth(0, 320, d);
      return lerp(y, -2.6, riverF(z) * smooth(-1250, -900, o));
    };
    for (let r = 0; r < rowsN; r++) {
      const z = z0 - r * step, cx = coastX(z);
      offs.forEach((o) => {
        const y = groundY(o, z), x = cx + o;
        tp.push(x, y, z); tuv.push(x / 70, z / 70);
        tc.copy(gLow).lerp(gMid, smooth(0, 30, y)).lerp(gHigh, smooth(30, 120, y)); const v = 0.92 + 0.12 * wob(z * 3 + o, 2);
        tcol.push(tc.r * v, tc.g * v, tc.b * v);
      });
      if (r > 0) for (let i = 0; i < offs.length - 1; i++) { const a = (r - 1) * offs.length + i, b = a + 1, c = r * offs.length + i, d = c + 1; ti.push(a, c, b, b, c, d); }
    }
    const landG = new THREE.BufferGeometry();
    landG.setAttribute("position", new THREE.Float32BufferAttribute(tp, 3)); landG.setAttribute("color", new THREE.Float32BufferAttribute(tcol, 3));
    landG.setAttribute("uv", new THREE.Float32BufferAttribute(tuv, 2)); landG.setIndex(ti); landG.computeVertexNormals();
    const land = new THREE.Mesh(landG, new THREE.MeshLambertMaterial({ vertexColors: true, map: noiseTex(3, 215, 60), side: THREE.DoubleSide }));
    land.receiveShadow = true; scene.add(land);

    // faixas planas que acompanham a costa (areia, calçadão, avenida, rodovia…)
    function Strip() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; }
    Strip.prototype.row = function (o1, o2, y1, y2, z, c1, c2) {
      const cx = coastX(z), k = this.p.length / 3;
      this.p.push(cx + o1, y1, z, cx + o2, y2, z); this.n.push(0, -1, 0, 0, -1, 0); // faces viradas para baixo: o DoubleSide inverte e a luz vem de cima
      this.u.push(o1 / 12, z / 12, o2 / 12, z / 12);
      if (c1) this.c.push(c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
      return k;
    };
    Strip.prototype.run = function (o1, o2, y, za, zb, st, skipRiver) {
      let prev = -1;
      for (let z = za; z >= zb - 0.01; z -= st) {
        if (skipRiver && inRiver(z, 2)) { prev = -1; continue; }
        const k = this.row(o1, o2, y, y, z);
        if (prev >= 0) this.i.push(prev, k, prev + 1, prev + 1, k, k + 1);
        prev = k;
      }
    };
    Strip.prototype.quad = function (x1, x2, z1q, z2q, y) {
      const k = this.p.length / 3;
      this.p.push(x1, y, z1q, x2, y, z1q, x1, y, z2q, x2, y, z2q); for (let j = 0; j < 4; j++) this.n.push(0, -1, 0);
      this.u.push(x1 / 12, z1q / 12, x2 / 12, z1q / 12, x1 / 12, z2q / 12, x2 / 12, z2q / 12);
      this.i.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    };
    Strip.prototype.mesh = function (mat, shadow) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
      if (this.c.length) g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.i);
      const m = noCull(new THREE.Mesh(g, mat)); m.receiveShadow = shadow !== false; scene.add(m); return m;
    };

    // areia: seca junto ao calçadão, molhada na linha d'água
    const sand = new Strip(), sDry = new THREE.Color(0xf0dfb6), sMid = new THREE.Color(0xe4cf9f), sWet = new THREE.Color(0xb59f78);
    let prevS = -1;
    for (let z = z0; z >= z1; z -= step) {
      const rf = riverF(z);
      const a = sand.row(-1, 9, lerp(0.5, -2.6, rf), lerp(0.42, -2.6, rf), z, sDry, sMid);
      const b = sand.row(9, SHORE + 6, lerp(0.42, -2.6, rf), -2.2, z, sMid, sWet);
      if (prevS >= 0) sand.i.push(prevS, a, prevS + 1, prevS + 1, a, a + 1, prevS + 2, b, prevS + 3, prevS + 3, b, b + 1);
      prevS = a;
    }
    sand.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, map: noiseTex(9, 232, 34), side: THREE.DoubleSide }));

    const asphalt = new Strip(), marks = new Strip(), walk = new Strip(), aveGlow = new Strip();
    const zTop = z0 - 4, zEnd = z1 + 4;
    walk.run(-6, -0.5, 0.56, zTop, zEnd, 6);          // calçadão
    asphalt.run(-18, -6, 0.52, zTop, zEnd, 6);        // avenida beira-mar
    asphalt.run(-180, -166, 0.6, zTop, zEnd, 6);      // rodovia
    for (let z = zTop; z > zEnd; z -= 9) { const cx = coastX(z); marks.quad(cx - 12.2, cx - 11.8, z, z - 4, 0.58); marks.quad(cx - 173.2, cx - 172.8, z, z - 4, 0.66); }

    // ---------- Mar ----------
    const seaU = {
      time: { value: 0 }, night: { value: 0 },
      cShallow: { value: new THREE.Color() }, cMid: { value: new THREE.Color() }, cDeep: { value: new THREE.Color() }, cSky: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(-0.85, 0.12, -0.5).normalize() }, sunCol: { value: new THREE.Color() },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 320 }, fogFar: { value: 1700 },
    };
    const sea = noCull(new THREE.Mesh(new THREE.PlaneGeometry(9000, L + 5000), new THREE.ShaderMaterial({
      uniforms: seaU,
      vertexShader: "varying vec3 vW; varying float vD; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix*w; vD = -mv.z; gl_Position = projectionMatrix*mv; }",
      fragmentShader: [
        "uniform float time; uniform float night; uniform vec3 cShallow; uniform vec3 cMid; uniform vec3 cDeep; uniform vec3 cSky;",
        "uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;",
        "varying vec3 vW; varying float vD;",
        "vec2 wv(vec2 p, vec2 d, float f, float a, float s){ return d*f*a*cos(dot(p,d)*f + time*s); }",
        "void main(){",
        "  float cx = 16.0*sin(vW.z*0.006) + 7.0*sin(vW.z*0.019+1.3);",
        "  float off = vW.x - cx - " + SHORE.toFixed(1) + ";",
        "  vec2 p = vW.xz; vec2 g = vec2(0.0);",
        "  g += wv(p, normalize(vec2(-1.0,0.25)), 0.07, 1.1, 0.9);",
        "  g += wv(p, normalize(vec2(-0.7,-0.7)), 0.16, 0.5, 1.3);",
        "  g += wv(p, normalize(vec2(0.3,1.0)), 0.33, 0.24, 1.9);",
        "  g += wv(p, normalize(vec2(-0.9,0.5)), 0.71, 0.11, 2.7);",
        "  g += wv(p, normalize(vec2(0.6,-0.8)), 1.37, 0.05, 3.4);",
        "  g *= 1.0/(1.0 + vD*0.0035);",
        "  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));",
        "  vec3 V = normalize(cameraPosition - vW);",
        "  float fres = pow(1.0 - max(dot(n,V),0.0), 4.0);",
        "  vec3 col = mix(cShallow, cMid, smoothstep(0.0, 30.0, off));",
        "  col = mix(col, cDeep, smoothstep(24.0, 300.0, off));",
        "  col = mix(col, cMid*vec3(0.62,0.82,0.62), smoothstep(-24.0, -70.0, off));", // rios
        "  col = mix(col, cSky, fres*0.8);",
        "  vec3 R = reflect(-V, n); float sd = max(dot(R, sunDir), 0.0);",
        "  col += sunCol*(pow(sd, 160.0)*1.6 + pow(sd, 22.0)*0.2);",
        "  float sea = step(-1.5, off);",
        "  float band = sin(off*0.5 + time*1.25 + sin(vW.z*0.07)*1.6 + sin(vW.z*0.23)*0.5);",
        "  float foam = smoothstep(0.72, 1.0, band)*(1.0 - smoothstep(3.0, 30.0, off));",
        "  float lip = 1.0 - smoothstep(0.0, 2.6 + 1.2*sin(time*0.8 + vW.z*0.05), off);",
        "  float speck = smoothstep(0.86, 1.0, sin(vW.x*1.9 + time)*sin(vW.z*2.3 - time*0.7));",
        "  float fo = clamp(foam*0.75*(0.7+0.3*speck) + lip*0.85, 0.0, 1.0)*sea;",
        "  col = mix(col, mix(vec3(1.0), cSky, 0.25)*(1.0 - night*0.55), fo);",
        "  col = mix(col, fogColor, smoothstep(fogNear, fogFar, vD));",
        "  gl_FragColor = vec4(col, 1.0);",
        "}",
      ].join("\n"),
    })));
    sea.rotation.x = -Math.PI / 2; sea.position.set(2500, -1.5, -L / 2); scene.add(sea);

    // ---------- Cidades ----------
    const STYLES = ["res", "glass", "concrete", "dark"];
    const shafts = { res: [], glass: [], concrete: [], dark: [] }, podiums = [], roofs = [], houseRoofs = [], props = [];
    const lampPts = [], beaconPts = [], lotPts = [], umbrellas = [], palms = [], containers = [], labels = [], cityInfo = [], reflDefs = [];
    const R = rng(2026);
    const prop = (x, y, z, sx, sy, sz, color, ry) => props.push({ x, y, z, sx, sy, sz, color, ry: ry || 0 });
    const TINT = {
      res: [0xffffff, 0xf7efe0, 0xe9f0f5, 0xf5dfd2, 0xe8e2d4], glass: [0xffffff, 0xd9f0ff, 0xcfe6e0, 0xffe9d0],
      concrete: [0xffffff, 0xe9e2d8, 0xd8dde2, 0xf2d9c4], dark: [0xffffff, 0xd9d2c4, 0xc4ccd6],
    };
    function building(x, z, w, d, h, style) {
      const tint = new THREE.Color(TINT[style][(R() * TINT[style].length) | 0]).multiplyScalar(0.86 + R() * 0.14);
      const uo = [((R() * 8) | 0) / 8, ((R() * 16) | 0) / 16];
      shafts[style].push({ x, z, w, d, y0: 0.4, h, tint, uo });
      if (h > 60) { // recuo no topo
        const hh = h * (0.1 + R() * 0.12);
        shafts[style].push({ x, z, w: w * 0.72, d: d * 0.72, y0: 0.4 + h, h: hh, tint, uo });
        roofs.push({ x, z, w: w * 0.4, d: d * 0.4, y0: 0.4 + h + hh, h: 3 + R() * 4 });
        if (h > 110) beaconPts.push(x, 0.4 + h + hh + 9, z);
        h += hh;
      } else if (h > 9) roofs.push({ x: x + (R() - 0.5) * w * 0.3, z: z + (R() - 0.5) * d * 0.3, w: w * 0.42, d: d * 0.42, y0: 0.4 + h, h: 1.6 + R() * 2.2 });
      if (h > 34) podiums.push({ x, z, w: w * 1.22, d: d * 1.22, h: 5.5 + R() * 3 });
      return h;
    }

    cities.forEach((c) => {
      const P = PROFILE[c.name] || { ext: 56, depth: 82, dens: 0.5, h: [5, 20], houses: 0.4 };
      const zc = -c.t * L, inl = P.inland || 0;
      let maxH = 0, sites = 0;
      // obra: estrutura de lajes e pilares + guindaste de torre
      const construction = (x, z, w, d, h, crane) => {
        const fl = 3.2, n = Math.floor(h / fl);
        for (let i = 1; i <= n; i++) prop(x, 0.4 + i * fl, z, w, 0.35, d, 0xb7b3aa);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => prop(x + a * (w / 2 - 0.4), 0.4 + n * fl / 2, z + b * (d / 2 - 0.4), 0.55, n * fl, 0.55, 0xa9a59c));
        prop(x, 0.4 + n * fl + 1.2, z, w * 0.9, 0.12, d * 0.9, 0x2f9e6b);
        if (crane) {
          const ch = n * fl + 18, cx = x + w * 0.7;
          prop(cx, ch / 2, z, 1.1, ch, 1.1, 0xe3a21a);
          prop(cx - 6, ch + 1, z, 22, 0.9, 0.9, 0xe3a21a); prop(cx + 7.5, ch + 1, z, 3.4, 2, 1.6, 0x54595f); prop(cx, ch + 3.6, z, 0.4, 5, 0.4, 0xe3a21a);
          prop(cx - 12, ch - 4, z, 0.12, 9, 0.12, 0x30343a); lampPts.push(cx, ch + 6.4, z);
        }
        maxH = Math.max(maxH, n * fl + (crane ? 22 : 4));
      };
      // ruas transversais e paralelas
      const cross = [];
      for (let k = Math.ceil(P.ext / 46); k >= -Math.ceil(P.ext / 46); k--) {
        const z = zc + k * 46; if (Math.abs(k * 46) > P.ext + 23 || inRiver(z, 8)) continue;
        cross.push(z); const cx = coastX(z);
        asphalt.quad(cx - P.depth - inl - 6, cx - 18, z + 3.5, z - 3.5, 0.53);
        lampPts.push(cx - inl - 44, 7.4, z, cx - inl - 82, 7.4, z);
      }
      const zA = zc + P.ext + 23, zB = zc - P.ext - 23;
      [-54.5, -92.5, -130.5].forEach((o) => { if (-o < P.depth + 6) asphalt.run(o - inl - 3.5, o - inl + 3.5, 0.53, zA, zB, 6, true); });
      if (inl) asphalt.run(-inl - 18, -inl - 6, 0.53, zA, zB, 6, true);
      aveGlow.run(-19, -5, 0.6, zA, zB, 6);
      // postes e palmeiras na beira-mar
      for (let z = zA; z > zB; z -= 23) {
        if (inRiver(z, 4)) continue; const cx = coastX(z);
        prop(cx - 5.4, 4, z, 0.22, 7.2, 0.22, 0x4a4f57); prop(cx - 7, 7.5, z, 3.2, 0.16, 0.24, 0x4a4f57);
        lampPts.push(cx - 8.4, 7.3, z);
        palms.push([cx - 2.4 + (R() - 0.5), z - 8 + R() * 3, 5.5 + R() * 2.5], [cx - 2.6 + (R() - 0.5), z - 16 + R() * 3, 5 + R() * 3]);
      }
      // guarda-sóis
      for (let i = 0; i < P.ext * 1.1 * P.dens; i++) { const z = zc + (R() - 0.5) * 2 * P.ext; if (!inRiver(z, 6)) umbrellas.push([coastX(z) + 2.5 + R() * 9, z, R()]); }
      // quadras: 4 lotes entre cada par de transversais, em fileiras paralelas à costa
      const rowsO = [-29, -41, -67, -80, -105, -118, -143, -156].filter((o) => -o < P.depth + 2);
      for (let k = 0; k < cross.length - 1; k++) {
        if (Math.abs(cross[k] - cross[k + 1]) > 47) continue;
        for (let si = 0; si < 4; si++) {
          const zz = cross[k] - 8.3 - si * 9.8;
          const edge = 1 - Math.pow(Math.min(1, Math.abs(zz - zc) / (P.ext + 20)), 2.4);
          rowsO.forEach((o, ri) => {
            const x = coastX(zz) + o - inl;
            if (P.wheel && Math.abs(zz - (zc + P.ext - 6)) < 26 && ri < 2) return;
            if (R() > P.dens * (0.45 + 0.55 * edge)) {
              if (P.build && sites < P.build && ri < 4 && R() < 0.2) { sites++; construction(x, zz, 7.4, 7.6, 14 + R() * 26, R() < 0.6); return; }
              if (P.lots && R() < 0.75) { const w = 4.2, y = 0.62; lotPts.push(x - w, y, zz - w, x + w, y, zz - w, x + w, y, zz - w, x + w, y, zz + w, x + w, y, zz + w, x - w, y, zz + w, x - w, y, zz + w, x - w, y, zz - w); }
              return;
            }
            const front = ri < 2;
            if (!P.towers && R() < (P.houses || 0) * (front ? 0.6 : 1)) { // casa
              const w = 5.2 + R() * 2, d = 5.2 + R() * 2, h = 2.9 + R() * 1.4;
              shafts.concrete.push({ x, z: zz, w, d, y0: 0.4, h, tint: new THREE.Color([0xfff6e6, 0xf2e2c8, 0xe6eef2, 0xf6d9c9][(R() * 4) | 0]), uo: [0, 0], house: true });
              houseRoofs.push({ x, z: zz, w: w * 1.12, d: d * 1.12, y: 0.4 + h, c: [0xb5533a, 0xa3472f, 0x8c5a3c, 0x6b6f77][(R() * 4) | 0] });
              return;
            }
            let h = lerp(P.h[0], P.h[1], Math.pow(R(), 1.5)) * (0.55 + 0.45 * edge) * (front ? 1.15 : 1 - ri * 0.05);
            let w = 7.2 + R() * 1.6, d = 7.4 + R() * 2.2;
            let style = STYLES[(R() * 4) | 0];
            if (P.towers && ri < 4 && R() < 0.82 - ri * 0.12) { h = lerp(P.towers[0], P.towers[1], Math.pow(R(), 1.25)) * (0.45 + 0.55 * edge) * (1 - ri * 0.1); w = 7.4 + R() * 1.4; d = 7.6 + R() * 1.6; style = R() < 0.55 ? "res" : R() < 0.75 ? "glass" : "dark"; }
            else if (P.sky && ri < 3 && R() < 0.52 - ri * 0.14) { h = lerp(P.sky[0], P.sky[1], Math.pow(R(), 1.2)) * (0.5 + 0.5 * edge); w = 7.4 + R() * 1.4; d = 7.6 + R() * 1.6; style = R() < 0.6 ? "res" : R() < 0.75 ? "glass" : "dark"; }
            else if (h < 14) style = R() < 0.6 ? "concrete" : "res";
            maxH = Math.max(maxH, building(x, zz, w, d, h, style));
          });
        }
      }
      if (P.port) {
        for (let i = 0; i < 90; i++) { const z = zc - 66 + R() * 132; containers.push({ x: coastX(z) + 3 + ((R() * 4) | 0) * 3.1, y: 1.7 + ((R() * 3) | 0) * 2.3, z, c: [0xc0392b, 0x1f6fb5, 0xe08a1e, 0x2e8b57, 0x8e9aa6][(R() * 5) | 0] }); }
        [-44, -6, 34].forEach((o) => {
          const z = zc + o, x = coastX(z) + 14;
          [[-3.4, -3], [3.4, -3], [-3.4, 3], [3.4, 3]].forEach(([dx, dz]) => prop(x + dx, 14, z + dz, 0.8, 28, 0.8, 0xd9a21b));
          prop(x + 9, 28.5, z, 36, 1.5, 1.7, 0xd9a21b); prop(x, 31.5, z, 2.4, 5, 2.4, 0xd9a21b); prop(x + 18, 25, z, 0.3, 6, 0.3, 0x30343a);
          lampPts.push(x, 34, z);
        });
      }
      if (P.pier) {
        const z = zc - (P.towers ? 86 : 10), x0 = coastX(z);
        for (let o = 4; o < 96; o += 8) { prop(x0 + o + 4, 2.0, z, 8.2, 0.5, 5, 0xb9a98c); prop(x0 + o + 4, 0, z - 1.8, 0.5, 4, 0.5, 0x7b6f5c); prop(x0 + o + 4, 0, z + 1.8, 0.5, 4, 0.5, 0x7b6f5c); if (o % 16 === 4) lampPts.push(x0 + o + 4, 4.6, z); }
        prop(x0 + 100, 3.6, z, 9, 3.2, 9, 0xf2ede4); prop(x0 + 100, 5.5, z, 11, 0.5, 11, 0xb5533a);
        prop(x0 + 52, 2.9, z - 2.4, 96, 0.12, 0.12, 0xffffff); prop(x0 + 52, 2.9, z + 2.4, 96, 0.12, 0.12, 0xffffff);
      }
      const lab = labelSprite(c.name); lab.position.set(coastX(zc) - 40 - inl, Math.max(34, maxH + 28), zc); scene.add(lab); labels.push(lab);
      cityInfo.push({ zc, x: coastX(zc) - 44 - inl, top: Math.max(22, maxH * 0.55 + 16), pins: [], P });
      if (!inl) reflDefs.push({ zc, ext: P.ext, len: P.towers ? 210 : 100, k: Math.min(1, P.towers ? 1 : P.dens * (P.h[1] / 55)) });
    });

    // ---------- Pontes ----------
    const cableP = [];
    RIVERS.forEach((rv) => {
      const za = rv.z + rv.half + 10, zb = rv.z - rv.half - 10;
      [[-12, 13, 0xcfd3d6, true], [-173, 15, 0xb9bdc1, false]].forEach(([oc, wd, col, fancy]) => {
        for (let z = za; z > zb; z -= 6) {
          const x = coastX(z - 3) + oc;
          prop(x, -0.25, z - 3, wd + 1.5, 1.3, 6.1, col);
          prop(x - wd / 2 - 0.4, 1.25, z - 3, 0.3, 1.1, 6.1, 0xe9ecee); prop(x + wd / 2 + 0.4, 1.25, z - 3, 0.3, 1.1, 6.1, 0xe9ecee);
        }
        const nP = rv.stay && fancy ? 0 : Math.max(2, Math.round((za - zb) / 20));
        for (let i = 1; i < nP; i++) { const z = lerp(za, zb, i / nP); prop(coastX(z) + oc, -2.4, z, wd * 0.5, 4.2, 1.8, 0xaeb3b8); }
        for (let z = za; z > zb; z -= 13) lampPts.push(coastX(z) + oc + wd / 2, 2.6, z);
        if (rv.stay && fancy) {
          [rv.z + 17, rv.z - 17].forEach((zp) => {
            const x = coastX(zp) + oc, H = 50;
            [-1, 1].forEach((s) => { prop(x + s * (wd / 2 + 1.6), H / 2 - 2.5, zp, 1.5, H + 5, 2.4, 0xf1f1ee); });
            prop(x, H - 3, zp, wd + 4.6, 1.6, 2, 0xf1f1ee); prop(x, H * 0.55, zp, wd + 4.6, 1.2, 1.8, 0xf1f1ee);
            lampPts.push(x - wd / 2 - 1.6, H + 1.5, zp, x + wd / 2 + 1.6, H + 1.5, zp);
            beaconPts.push(x, H + 4, zp);
            for (let k = 1; k <= 7; k++) [-1, 1].forEach((dir) => [-1, 1].forEach((s) => {
              const zd = zp + dir * k * 5.2; if (Math.abs(zd - rv.z) > rv.half + 12) return;
              cableP.push(x + s * (wd / 2 + 1.6), H - 2 - (7 - k) * 2.6, zp, coastX(zd) + oc + s * (wd / 2 + 0.4), 1.2, zd);
            }));
          });
        }
      });
    });
    if (cableP.length) { const cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.Float32BufferAttribute(cableP, 3)); scene.add(noCull(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0xf4f4f0, transparent: true, opacity: 0.85 })))); }

    asphalt.mesh(new THREE.MeshLambertMaterial({ color: 0x4a4e55, map: noiseTex(21, 225, 40), side: THREE.DoubleSide }));
    walk.mesh(new THREE.MeshLambertMaterial({ color: 0xd9cdb8, map: noiseTex(23, 228, 46), side: THREE.DoubleSide }));
    marks.mesh(new THREE.MeshBasicMaterial({ color: 0xf2efe6, side: THREE.DoubleSide }), false);
    const aveGlowM = new THREE.MeshBasicMaterial({ color: 0xffb65c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    aveGlow.mesh(aveGlowM, false);

    // ---------- Malhas instanciadas dos prédios ----------
    const facadeMats = [];
    function patchUv(mat) {
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = "attribute vec2 uvS;\nattribute vec2 uvO;\n" + sh.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_UV\n  vUv = vUv * uvS + uvO;\n#endif");
      };
      return mat;
    }
    const roofM = new THREE.MeshStandardMaterial({ color: 0x8d9197, roughness: 0.9 });
    function instBoxes(items, sideMat, topMat, uvOf) {
      if (!items.length) return null;
      const geo = new THREE.BoxGeometry(1, 1, 1), uvS = new Float32Array(items.length * 2), uvO = new Float32Array(items.length * 2);
      const im = noCull(new THREE.InstancedMesh(geo, [sideMat, sideMat, topMat, topMat, sideMat, sideMat], items.length));
      items.forEach((b, i) => {
        dummy.position.set(b.x, b.y0 + b.h / 2, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(b.w, b.h, b.d); dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, b.tint || new THREE.Color(0xffffff));
        const u = uvOf(b); uvS[i * 2] = u[0]; uvS[i * 2 + 1] = u[1]; uvO[i * 2] = u[2]; uvO[i * 2 + 1] = u[3];
      });
      geo.setAttribute("uvS", new THREE.InstancedBufferAttribute(uvS, 2)); geo.setAttribute("uvO", new THREE.InstancedBufferAttribute(uvO, 2));
      im.castShadow = true; im.receiveShadow = true; scene.add(im); return im;
    }
    STYLES.forEach((st, k) => {
      const [dt, nt] = facade(st, 11 + k * 7);
      const m = patchUv(new THREE.MeshStandardMaterial({ map: dt, emissiveMap: nt, emissive: 0xffffff, emissiveIntensity: 0.04, roughness: st === "glass" ? 0.22 : 0.62, metalness: st === "glass" ? 0.65 : 0.12 }));
      facadeMats.push(m);
      instBoxes(shafts[st], m, roofM, (b) => b.house ? [0.25, 0.0625, 0.125, 0] : [Math.max(0.25, Math.round(((b.w + b.d) / 2 / 12.8) * 8) / 8), Math.max(0.0625, Math.round((b.h / 51) * 16) / 16), b.uo[0], b.uo[1]]);
    });
    const [sd, sn] = facade("shop", 91);
    const shopM = patchUv(new THREE.MeshStandardMaterial({ map: sd, emissiveMap: sn, emissive: 0xffffff, emissiveIntensity: 0.04, roughness: 0.6 }));
    facadeMats.push(shopM);
    instBoxes(podiums.map((q) => ({ ...q, y0: 0.4 })), shopM, roofM, (b) => [Math.max(0.25, Math.round((b.w / 12.8) * 8) / 8), 1, 0, 0]);
    const plain = (list, geo, mat, set) => {
      if (!list.length) return null;
      const im = noCull(new THREE.InstancedMesh(geo, mat, list.length)), col = new THREE.Color();
      list.forEach((b, i) => { set(b, col); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, col); });
      im.castShadow = true; im.receiveShadow = true; scene.add(im); return im;
    };
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const lam = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    plain(roofs, unit, lam(), (b, col) => { dummy.position.set(b.x, b.y0 + b.h / 2, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(b.w, b.h, b.d); col.set(0x9aa0a6); });
    const pyr = new THREE.ConeGeometry(0.72, 1, 4); pyr.rotateY(Math.PI / 4);
    plain(houseRoofs, pyr, lam(), (b, col) => { dummy.position.set(b.x, b.y + 1.0, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(b.w, 2.0, b.d); col.set(b.c); });
    plain(props, unit, lam(), (b, col) => { dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(0, b.ry, 0); dummy.scale.set(b.sx, b.sy, b.sz); col.set(b.color); });
    plain(containers, new THREE.BoxGeometry(2.6, 2.2, 6), lam(), (b, col) => { dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); col.set(b.c); });
    plain(umbrellas, new THREE.ConeGeometry(1.5, 0.9, 8), lam(), (b, col) => { dummy.position.set(b[0], 2.3, b[1]); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); col.set([0xe5483b, 0xf2c230, 0x2b8fd6, 0xffffff, 0x2fae6b, 0xff8a3c][(b[2] * 6) | 0]); });
    plain(palms, new THREE.CylinderGeometry(0.16, 0.26, 1, 6), lam(), (b, col) => { dummy.position.set(b[0], 0.5 + b[2] / 2, b[1]); dummy.rotation.set(0.06, 0, 0.07); dummy.scale.set(1, b[2], 1); col.set(0x8a7355); });
    const frond = new THREE.ConeGeometry(1, 0.5, 7); frond.translate(0, -0.1, 0);
    plain(palms, frond, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), (b, col) => { dummy.position.set(b[0] + 0.3, 0.7 + b[2], b[1] + 0.2); dummy.rotation.set(0, b[2], 0); dummy.scale.set(2.5, 2.2, 2.5); col.set(0x3d8a45); });

    if (lotPts.length) { const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lotPts, 3)); scene.add(noCull(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xe5bc57, transparent: true, opacity: 0.9 })))); }

    // ---------- Vegetação ----------
    const TR = rng(99), cones = [], blobs = [];
    for (let i = 0; i < 2600; i++) {
      const z = 300 - TR() * (L + 780), o = -24 - Math.pow(TR(), 1.25) * 620;
      if (inRiver(z, 5) || (o > -186 && o < -160)) continue;
      const inCity = cityInfo.some((ci) => Math.abs(z - ci.zc) < ci.P.ext + 30 && o > -(ci.P.depth + (ci.P.inland || 0) + 12));
      if (inCity) continue;
      (TR() < 0.45 ? cones : blobs).push([coastX(z) + o, groundY(o, z), z, 2.6 + TR() * 3.8, TR()]);
    }
    plain(cones, new THREE.ConeGeometry(1, 2.6, 7), lam(), (b, col) => { dummy.position.set(b[0], b[1] + b[3] * 1.2, b[2]); dummy.rotation.set(0, 0, 0); dummy.scale.set(b[3] * 0.72, b[3], b[3] * 0.72); col.setHSL(0.36 + b[4] * 0.04, 0.42, 0.2 + b[4] * 0.08); });
    plain(blobs, new THREE.IcosahedronGeometry(1, 1), lam(), (b, col) => { dummy.position.set(b[0], b[1] + b[3] * 0.75, b[2]); dummy.rotation.set(0, b[4] * 6, 0); dummy.scale.set(b[3], b[3] * 0.82, b[3]); col.setHSL(0.3 + b[4] * 0.06, 0.45, 0.22 + b[4] * 0.1); });

    // ---------- Roda-gigante (Balneário Camboriú) ----------
    let wheel = null, wheelLights = null;
    const bcI = cityInfo.findIndex((ci) => ci.P.wheel);
    if (bcI >= 0) {
      const ci = cityInfo[bcI], z = ci.zc + ci.P.ext - 6, x = coastX(z) - 36, RW = 30, wm = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
      const base = new THREE.Group(); base.position.set(x, 0.4, z);
      [-1, 1].forEach((s) => [-1, 1].forEach((t) => { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, RW + 9, 8), wm); leg.position.set(s * 3.2, (RW + 6) / 2, t * 8); leg.rotation.x = -t * 0.26; leg.castShadow = true; base.add(leg); }));
      wheel = new THREE.Group(); wheel.position.set(0, RW + 5, 0);
      [-1.2, 1.2].forEach((dx) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(RW, 0.42, 8, 64), wm); ring.rotation.y = Math.PI / 2; ring.position.x = dx; ring.castShadow = true; wheel.add(ring); });
      const lp = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        if (i % 2 === 0) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.18, RW * 2, 0.18), wm); sp.rotation.x = a; wheel.add(sp); }
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.2), new THREE.MeshLambertMaterial({ color: 0xdfe8ee })); cab.position.set(0, Math.cos(a) * RW, Math.sin(a) * RW); wheel.add(cab);
        for (let j = 0; j < 3; j++) { const b = a + (j / 3) * (Math.PI / 12); lp.push(1.9, Math.cos(b) * RW, Math.sin(b) * RW); }
      }
      const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
      wheelLights = new THREE.Points(wg, new THREE.PointsMaterial({ map: glowTex("rgba(120,220,255,.9)"), color: 0xbfe9ff, size: 7, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      wheel.add(wheelLights); base.add(wheel); scene.add(base);
    }

    // ---------- Luzes da cidade (pontos) ----------
    const ptsOf = (arr, tex, color, size) => {
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const pt = noCull(new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex(tex), color, size, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
      scene.add(pt); return pt;
    };
    const lamps = ptsOf(lampPts, "rgba(255,190,110,.9)", 0xffd9a0, 9);
    const beacons = ptsOf(beaconPts, "rgba(255,60,60,.95)", 0xff5a4a, 9);

    // ---------- Carros ----------
    const NC = 64, cars = [], KR = rng(404);
    for (let i = 0; i < NC; i++) cars.push({ lane: i % 2, base: KR() * 1300, sp: 15 + KR() * 9, c: [0xf2f2f2, 0x20242a, 0xb7bcc2, 0xa32020, 0x1d4e89, 0xd9d2c0][(KR() * 6) | 0] });
    const carM = noCull(new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 1.3, 4.2), lam(), NC));
    cars.forEach((c, i) => carM.setColorAt(i, new THREE.Color(c.c))); carM.castShadow = true; scene.add(carM);
    const headA = new Float32Array(NC * 3), tailA = new Float32Array(NC * 3);
    const heads = ptsOf(headA, "rgba(255,245,210,.95)", 0xfff2cc, 6), tails = ptsOf(tailA, "rgba(255,40,40,.95)", 0xff3b30, 5);

    // ---------- Reflexo das luzes no mar ----------
    const rc = canvas(256, 128), rg = rc.getContext("2d"), RR = rng(31);
    for (let i = 0; i < 170; i++) {
      const x = RR() * 256, len = 30 + RR() * 98, gr = rg.createLinearGradient(0, 0, 0, len), k = RR();
      gr.addColorStop(0, k < 0.6 ? "rgba(255,214,140,.9)" : k < 0.85 ? "rgba(255,240,210,.8)" : "rgba(170,210,255,.8)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      rg.fillStyle = gr; rg.fillRect(x, 0, 1 + RR() * 2.2, len);
    }
    const reflTex = new THREE.CanvasTexture(rc), reflMats = [];
    reflDefs.forEach((d) => {
      const m = new THREE.MeshBasicMaterial({ map: reflTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.len, d.ext * 2), m);
      mesh.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); mesh.position.set(coastX(d.zc) + SHORE + 4 + d.len / 2, -1.25, d.zc);
      scene.add(mesh); reflMats.push([m, d.k]);
    });

    // ---------- Pinos dos imóveis ----------
    const pinG = new THREE.OctahedronGeometry(2.8, 0);
    const pinM = new THREE.MeshStandardMaterial({ color: 0xe5bc57, emissive: 0xc9972e, emissiveIntensity: 1.2, metalness: 0.7, roughness: 0.25 });
    const stemM = new THREE.LineBasicMaterial({ color: 0xe5bc57, transparent: true, opacity: 0.7 }), PR = rng(5);
    cityInfo.forEach((ci) => {
      for (let i = 0; i < 6; i++) {
        const g = new THREE.Group(), x = ci.x + (PR() - 0.5) * 50, z = ci.zc + (PR() - 0.5) * 100, top = ci.top + PR() * 16;
        const m = new THREE.Mesh(pinG, pinM); m.position.y = top; m.scale.y = 1.5;
        const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, top - 3, 0)]);
        const glow = glowSprite("rgba(229,188,87,.85)", 22); glow.position.y = top;
        g.add(m, new THREE.Line(lg, stemM), glow); g.position.set(x, 0, z); g.visible = false; g.userData = { m, top, ph: PR() * 6 };
        scene.add(g); ci.pins.push(g);
      }
    });

    const heli = buildHelicopter(); scene.add(heli);

    // ---------- Pós-processamento ----------
    let composer = null, bloom = null, fxaa = null;
    if (THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass && THREE.ShaderPass) {
      try {
        composer = new THREE.EffectComposer(renderer);
        composer.addPass(new THREE.RenderPass(scene, camera));
        if (THREE.FXAAShader) { fxaa = new THREE.ShaderPass(THREE.FXAAShader); composer.addPass(fxaa); }
        bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.6, 0.74); composer.addPass(bloom);
        composer.addPass(new THREE.ShaderPass({
          uniforms: { tDiffuse: { value: null } },
          vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
          fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; c = (c - 0.5)*1.08 + 0.5; float l = dot(c, vec3(0.299,0.587,0.114)); c = mix(vec3(l), c, 1.14); float v = smoothstep(0.42, 0.98, length(vUv - 0.5)*1.15); c *= 1.0 - 0.38*v; gl_FragColor = vec4(c, 1.0); }",
        }));
      } catch (e) { composer = null; }
    }

    // ---------- Estado e laço ----------
    const C = (h) => new THREE.Color(h);
    const pal = {
      top: [C(0x2f62a0), C(0x030714)], bottom: [C(0xffa468), C(0x15244a)], fog: [C(0xf0a97c), C(0x0b152c)],
      shallow: [C(0x4fc7c2), C(0x0e3a52)], mid: [C(0x1c86a6), C(0x0a2740)], deep: [C(0x0f4d7c), C(0x051426)],
      sunC: [C(0xffc27a), C(0x9db8f0)], cloud: [C(0xffc9a0), C(0x1c2a4a)],
    };
    const camPos = new THREE.Vector3(), look = new THREE.Vector3(), curLook = new THREE.Vector3(), hemiDay = C(0xffd9b0), hemiNight = C(0x6f86c4), cc = new THREE.Color();
    let target = 0, p = 0, visible = true, raf = 0, last = performance.now(), disposed = false, first = true, prevP = 0, frames = 0, slow = 0, degraded = false;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const bc = cityInfo[cityInfo.length - 1];

    function resize() {
      const w = canvasEl.clientWidth || 1, h = canvasEl.clientHeight || 1;
      renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      if (composer) { composer.setPixelRatio(pixelRatio); composer.setSize(w, h); }
      if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (w * pixelRatio), 1 / (h * pixelRatio));
    }

    function frame(now) {
      raf = 0; if (disposed) return;
      const rawDt = (now - last) / 1000, dt = Math.min(0.05, rawDt), time = now / 1000; last = now;
      // máquinas fracas: desliga sombras e baixa a resolução
      if (!degraded && frames > 20 && frames < 200) { if (rawDt > 0.05 && rawDt < 0.5) slow++; if (slow > 45) { degraded = true; sunL.castShadow = false; pixelRatio = 1; resize(); } }
      frames++;
      p = first || reduce ? target : lerp(p, target, 1 - Math.pow(0.002, dt)); first = false;
      const vel = (p - prevP) / Math.max(dt, 0.001); prevP = p;
      const n = smooth(0.3, 0.8, p);

      skyU.top.value.copy(pal.top[0]).lerp(pal.top[1], n); skyU.bottom.value.copy(pal.bottom[0]).lerp(pal.bottom[1], n);
      scene.fog.color.copy(pal.fog[0]).lerp(pal.fog[1], n); scene.fog.far = lerp(1700, 2100, n);
      seaU.time.value = time; seaU.night.value = n;
      seaU.cShallow.value.copy(pal.shallow[0]).lerp(pal.shallow[1], n); seaU.cMid.value.copy(pal.mid[0]).lerp(pal.mid[1], n); seaU.cDeep.value.copy(pal.deep[0]).lerp(pal.deep[1], n);
      seaU.cSky.value.copy(skyU.bottom.value).lerp(skyU.top.value, 0.25);
      seaU.sunCol.value.copy(pal.sunC[0]).lerp(pal.sunC[1], n).multiplyScalar(lerp(1, 0.35, n));
      seaU.sunDir.value.set(lerp(-0.85, 0.5, n), lerp(0.14, 0.42, n), lerp(-0.5, -0.75, n)).normalize();
      seaU.fogColor.value.copy(scene.fog.color); seaU.fogFar.value = scene.fog.far;
      hemi.intensity = lerp(1.0, 0.34, n); hemi.color.copy(hemiDay).lerp(hemiNight, n);
      sunL.intensity = lerp(1.3, 0, smooth(0, 0.85, n)); moonL.intensity = lerp(0, 0.42, n);
      stars.material.opacity = n * 0.9;
      const em = 0.03 + n * 1.75; facadeMats.forEach((m) => (m.emissiveIntensity = em));
      aveGlowM.opacity = n * 0.2; lamps.material.opacity = smooth(0.15, 0.7, n);
      beacons.material.opacity = n * (Math.sin(time * 2.2) > 0 ? 1 : 0.15);
      reflMats.forEach(([m, k]) => (m.opacity = n * k * (0.5 + 0.08 * Math.sin(time * 2.1))));
      cc.copy(pal.cloud[0]).lerp(pal.cloud[1], n); clouds.forEach((s) => { s.material.color.copy(cc); s.material.opacity = lerp(0.85, 0.3, n); });
      if (bloom) bloom.strength = 0.22 + n * 0.62;
      if (wheel) { wheel.rotation.x = time * 0.12; wheelLights.material.opacity = 0.15 + n * 0.85; wheelLights.material.color.setHSL((time * 0.05) % 1, 0.7, 0.72); }

      // helicóptero
      const hz = 90 - p * (L + 60), hx = coastX(hz) + SHORE + 22, hy = 60 + (reduce ? 0 : Math.sin(time * 1.1) * 1.1);
      heli.position.set(hx, hy, hz);
      heli.rotation.set(-0.09 - Math.max(-0.12, Math.min(0.12, vel * 0.5)), -(coastX(hz - 30) - coastX(hz + 30)) * 0.012, reduce ? 0 : Math.sin(time * 0.7) * 0.035);
      const U = heli.userData; U.rotor.rotation.y = time * 34; U.tail.rotation.x = time * 46;
      U.strobe.material.opacity = (time * 1.1) % 1 < 0.08 ? 1 : 0.04;
      U.lamp.material.opacity = 0.35 + n * 0.65; U.cone.material.opacity = n * 0.07;

      // sombra do sol acompanha o helicóptero
      sunL.target.position.set(hx - 70, 0, hz - 150); sunL.position.copy(sunL.target.position).addScaledVector(SUN_DIR, 700);
      renderer.shadowMap.autoUpdate = n < 0.97;

      // carros na avenida (duas mãos), sempre em volta do helicóptero
      for (let i = 0; i < NC; i++) {
        const c = cars[i], dir = c.lane ? 1 : -1, rel = ((((c.base + dir * c.sp * time) % 1300) + 1300) % 1300) - 500;
        const z = hz - 150 + rel, x = coastX(z) + (c.lane ? -14.8 : -9.2);
        dummy.position.set(x, 1.25, z); dummy.rotation.set(0, -Math.atan((coastX(z - 4) - coastX(z + 4)) / 8), 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); carM.setMatrixAt(i, dummy.matrix);
        headA[i * 3] = x; headA[i * 3 + 1] = 1.3; headA[i * 3 + 2] = z + dir * 2.3;
        tailA[i * 3] = x; tailA[i * 3 + 1] = 1.3; tailA[i * 3 + 2] = z - dir * 2.3;
      }
      carM.instanceMatrix.needsUpdate = true;
      heads.geometry.attributes.position.needsUpdate = true; tails.geometry.attributes.position.needsUpdate = true;
      heads.material.opacity = 0.25 + n * 0.75; tails.material.opacity = 0.2 + n * 0.8;

      // câmera: perseguição + abertura final sobre o mar olhando o skyline
      const f = smooth(0.84, 1, p);
      camPos.set(hx + lerp(22, 320, f), hy + lerp(15, -24, f), hz + lerp(60, 175, f));
      look.set(lerp(hx - 40, bc.x - 10, f), lerp(hy - 22, 80, f), lerp(hz - 110, bc.zc + 135, f));
      camera.position.copy(camPos);
      if (curLook.lengthSq() === 0) curLook.copy(look); else curLook.lerp(look, reduce ? 1 : 0.2);
      camera.lookAt(curLook);
      sky.position.copy(camera.position); stars.position.copy(camera.position);
      clouds.forEach((s) => s.position.set(camera.position.x + s.userData.x, s.userData.y, camera.position.z + s.userData.z));
      sun.position.set(camera.position.x - 2400, lerp(250, -180, smooth(0, 0.6, p)), camera.position.z - 1400); sun.material.opacity = 1 - smooth(0.35, 0.65, p);
      moon.position.set(camera.position.x + 1500, 1150, camera.position.z - 2000); moon.material.opacity = n;

      labels.forEach((s, i) => {
        const ahead = hz - cityInfo[i].zc, dz = Math.abs(ahead);
        s.material.opacity = smooth(150, 230, ahead) * (1 - smooth(420, 640, dz)) * (1 - f);
        const k = lerp(1, 1.5, smooth(150, 600, dz)); s.scale.set(64 * k, 16 * k, 1);
      });
      cityInfo.forEach((ci) => ci.pins.forEach((g) => {
        if (!g.visible) return;
        g.userData.m.position.y = g.userData.top + (reduce ? 0 : Math.sin(time * 2 + g.userData.ph) * 1.2); g.userData.m.rotation.y = time * 1.2 + g.userData.ph;
      }));

      if (composer) composer.render(); else renderer.render(scene, camera);
      if (visible) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && !disposed) { last = performance.now(); raf = requestAnimationFrame(frame); } }

    const io = "IntersectionObserver" in window ? new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) kick(); }) : null;
    if (io) io.observe(canvasEl);
    window.addEventListener("resize", resize);
    resize(); frame(performance.now());

    const api = {
      snap() { first = true; curLook.set(0, 0, 0); }, // pula a suavização (depuração)
      setProgress(v) { target = Math.max(0, Math.min(1, v)); if (visible) kick(); },
      setCounts(counts) { cityInfo.forEach((ci, i) => ci.pins.forEach((g, k) => (g.visible = k < Math.min(6, counts[i] || 0)))); },
      resize,
      dispose() { disposed = true; if (raf) cancelAnimationFrame(raf); if (io) io.disconnect(); window.removeEventListener("resize", resize); renderer.dispose(); },
    };
    window.__sv3d = api;
    return api;
  }

  window.Sobrevoo3D = { init };
})();
