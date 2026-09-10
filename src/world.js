// Three.js scene: wireframe terrain with amplitude colouring, ETF ranges, money river, pressure-map wind,
// hex storm cloud with lightning, landslides, focus pulse and short-seller excavators.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gauss, spineItems, fieldValue, BOUNDS, layout } from './landscape.js';
import { AMPLITUDE_BANDS } from './universe.js';

const BG = '#05080f';
const rnd = (a, b) => a + Math.random() * (b - a);

export function createWorld(host, { onSelect, onPlay, onCollapse }) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(BG); scene.fog = new THREE.Fog(BG, 130, 260);
  const home = () => new THREE.Vector3(38, 86, 126).multiplyScalar(host.clientWidth < 600 ? 1.5 : 1);
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 500); camera.position.copy(home());
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); renderer.outputColorSpace = THREE.SRGBColorSpace; host.prepend(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = .08; controls.minDistance = 12; controls.maxDistance = 230; controls.maxPolarAngle = Math.PI * .47; controls.target.set(0, 1, 6); controls.update();
  scene.add(new THREE.HemisphereLight('#8fb0e0', '#05070d', 1.5)); const sun = new THREE.DirectionalLight('#e8f0ff', 2.1); sun.position.set(-28, 52, 26); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.BoxGeometry(BOUNDS.width, 2, BOUNDS.depth), new THREE.MeshStandardMaterial({ color: '#080d18', roughness: 1 })); ground.position.set(BOUNDS.cx, -1.15, BOUNDS.cz); scene.add(ground);
  const floor = new THREE.GridHelper(160, 64, '#1a2740', '#0f1727'); floor.position.y = -2.2; scene.add(floor);

  // Terrain (wireframe look + contours + optional pressure map painted in the shader)
  const geo = new THREE.PlaneGeometry(BOUNDS.width, BOUNDS.depth, 200, 192); geo.rotateX(-Math.PI / 2); geo.translate(BOUNDS.cx, 0, BOUNDS.cz);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  geo.setAttribute('aPress', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
  const uniforms = { uWire: { value: 1 }, uGlow: { value: 1 }, uWind: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: .12, side: THREE.DoubleSide, transparent: false });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLand; varying float vPress; attribute float aPress;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLand = position; vPress = aPress;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLand; varying float vPress; uniform float uWire; uniform float uGlow; uniform float uWind;').replace('#include <color_fragment>', `#include <color_fragment>
      vec2 gc = vLand.xz * 0.5; vec2 gw = fwidth(gc); vec2 gl = abs(fract(gc - 0.5) - 0.5) / max(gw, vec2(0.004)); float line = 1.0 - min(min(gl.x, gl.y), 1.0);
      float band = abs(fract(vLand.y * 0.8 - 0.5) - 0.5) / max(fwidth(vLand.y) * 0.8, 0.02); float contour = (1.0 - smoothstep(0.0, 0.9, band)) * step(0.35, vLand.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.38, 0.52), contour * 0.35);
      float pk = clamp(vPress / 4.0, -1.0, 1.0); vec3 pcol = pk >= 0.0 ? mix(vec3(0.45,0.55,0.7), vec3(1.0,0.62,0.25), pk) : mix(vec3(0.45,0.55,0.7), vec3(0.18,0.5,1.0), -pk);
      diffuseColor.rgb = mix(diffuseColor.rgb, pcol, uWind * (0.08 + 0.22 * abs(pk)) * (1.0 - 0.5 * smoothstep(0.5, 3.0, vLand.y)));
      float iso = abs(fract(vPress * 2.0 - 0.5) - 0.5) / max(fwidth(vPress) * 2.0, 0.02); float isoLine = 1.0 - smoothstep(0.0, 1.0, iso);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.97, 1.0), isoLine * uWind * 0.45 * step(0.05, abs(vPress)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.76, 0.92), line * uWire * (0.28 + 0.42 * smoothstep(0.2, 6.0, vLand.y)));
      diffuseColor.rgb += vec3(0.55, 0.65, 0.85) * smoothstep(5.0, 11.0, vLand.y) * 0.22 * uGlow;`);
  };
  const terrain = new THREE.Mesh(geo, material); scene.add(terrain);
  const pressureGeo = new THREE.PlaneGeometry(BOUNDS.width, BOUNDS.depth, 100, 96); pressureGeo.rotateX(-Math.PI / 2); pressureGeo.translate(BOUNDS.cx, -.05, BOUNDS.cz); pressureGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pressureGeo.attributes.position.count * 3), 3));
  const pressureMap = new THREE.Mesh(pressureGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })); pressureMap.visible = false; scene.add(pressureMap);
  const rangeGroup = new THREE.Group(); scene.add(rangeGroup); let rangeKey = '';
  const selection = new THREE.Mesh(new THREE.TorusGeometry(1.1, .05, 8, 64), new THREE.MeshBasicMaterial({ color: '#ffe9a8' })); selection.rotation.x = Math.PI / 2; scene.add(selection);
  const markerGroup = new THREE.Group(); scene.add(markerGroup); const markers = new Map();

  // River
  const river = new THREE.Group(); river.renderOrder = 5; scene.add(river);
  const riverCore = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#7fe6ff', transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false }));
  const riverGlow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#2aa8ff', transparent: true, opacity: .24, blending: THREE.AdditiveBlending, depthWrite: false }));
  riverGlow.renderOrder = 5; riverCore.renderOrder = 6; river.add(riverGlow, riverCore);
  const riverDots = Array.from({ length: 40 }, () => { const d = new THREE.Mesh(new THREE.SphereGeometry(.24, 6, 6), new THREE.MeshBasicMaterial({ color: '#dffaff', transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false })); d.renderOrder = 7; river.add(d); return d; });
  let riverCurve = null, riverKey = '', riverRadius = .2;

  // Wind arrows
  const wind = new THREE.Group(); scene.add(wind); const arrows = [];
  for (let i = 0; i < 63; i++) { const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-45 + (i % 9) * 11.25, 6, -38 + Math.floor(i / 9) * 13), 2.6, '#6fe3ff', .8, .45); a.line.material.transparent = a.cone.material.transparent = true; wind.add(a); arrows.push(a); }

  // Storm
  const storm = new THREE.Group(); scene.add(storm); const hexes = [];
  const hexMat = new THREE.MeshPhysicalMaterial({ color: '#b9d2ff', transparent: true, opacity: .32, roughness: .25, metalness: .05, transmission: .2, depthWrite: false });
  for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) { if (Math.abs(q + r) > 2) continue; const h = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, .55, 6), hexMat.clone()); h.position.set((q + r / 2) * 2.55, 10 + Math.abs(q + r) * .35, r * 2.2); h.rotation.y = Math.PI / 6; storm.add(h); hexes.push(h); }
  const rainPos = new Float32Array(240 * 3); for (let i = 0; i < 240; i++) { rainPos[i * 3] = rnd(-6, 6); rainPos[i * 3 + 1] = rnd(0, 9); rainPos[i * 3 + 2] = rnd(-5, 5); }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3)); const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: '#9fc4ff', size: .09, transparent: true, opacity: .55 })); storm.add(rain);
  const boltGeo = new THREE.BufferGeometry(); boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3)); const bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 })); storm.add(bolt);
  const flash = new THREE.PointLight('#cfe4ff', 0, 60); flash.position.y = 8; storm.add(flash); let nextBolt = 2, boltT = 0;

  // Excavators (short sellers "mining" a hill). Simple box models, pooled.
  const digGroup = new THREE.Group(); scene.add(digGroup); const diggers = [];
  const yellow = new THREE.MeshStandardMaterial({ color: '#f2c94c', roughness: .6 }), dark = new THREE.MeshStandardMaterial({ color: '#2b2f38', roughness: .9 });
  for (let i = 0; i < 12; i++) { const g = new THREE.Group(); const track = new THREE.Mesh(new THREE.BoxGeometry(1.5, .35, 1.1), dark); track.position.y = .18; const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, .55, .9), yellow); body.position.y = .62; const cab = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .6), new THREE.MeshStandardMaterial({ color: '#8fc4ff', roughness: .3 })); cab.position.set(-.25, 1.1, 0);
    const boom = new THREE.Group(); boom.position.set(.5, .85, 0); const arm1 = new THREE.Mesh(new THREE.BoxGeometry(1.4, .18, .18), yellow); arm1.position.x = .7; boom.add(arm1); const joint = new THREE.Group(); joint.position.x = 1.4; const arm2 = new THREE.Mesh(new THREE.BoxGeometry(1, .15, .15), yellow); arm2.position.x = .5; joint.add(arm2); const bucket = new THREE.Mesh(new THREE.BoxGeometry(.4, .35, .45), dark); bucket.position.x = 1.05; joint.add(bucket); boom.add(joint);
    g.add(track, body, cab, boom); g.visible = false; g.userData = { boom, joint, phase: i * 1.3 }; digGroup.add(g); diggers.push(g); }

  // Landslides / focus pulse
  const slidesGroup = new THREE.Group(); slidesGroup.renderOrder = 7; scene.add(slidesGroup); const slides = [];
  const pulseGroup = new THREE.Group(); pulseGroup.renderOrder = 8; scene.add(pulseGroup); let pulse = null;
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64); grd.addColorStop(0, 'rgba(255,240,190,1)'); grd.addColorStop(.35, 'rgba(255,220,120,.55)'); grd.addColorStop(1, 'rgba(255,200,80,0)'); g.fillStyle = grd; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); glowSprite.scale.set(9, 9, 1); pulseGroup.add(glowSprite);
  const pulseRings = Array.from({ length: 3 }, () => { const r = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 64), new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })); r.rotation.x = -Math.PI / 2; r.visible = false; pulseGroup.add(r); return r; });
  const pulseLight = new THREE.PointLight('#ffe2a0', 0, 30); pulseGroup.add(pulseLight);

  const vis = new Map();
  let current = null, state = null, slice = 4, aim = null, last = 0, phase = 0, disposed = false, dirty = true, frameKey = '', shake = 0;
  let labels = new Map(); const labelHost = host.querySelector('#labels');
  const deep = new THREE.Color('#0a1424'), mid = new THREE.Color('#1c3660'), high = new THREE.Color('#7f9fd0'), cool = new THREE.Color('#2f7fd6'), warm = new THREE.Color('#e3a24a'), hot = new THREE.Color('#ff5a4d'), scarColor = new THREE.Color('#7a2f2a');
  const bandColors = AMPLITUDE_BANDS.map(b => new THREE.Color(b.color));
  const bandColor = amp => { const edges = [0, 1.5, 3, 6, 10]; const a = Math.max(0, Math.min(9.99, amp)); for (let i = 0; i < 4; i++) if (a < edges[i + 1]) { const t = (a - edges[i]) / (edges[i + 1] - edges[i]); return bandColors[i].clone().lerp(bandColors[Math.min(3, i + 1)], Math.max(0, t - .55) / .45); } return bandColors[3].clone(); };
  const heatPalette = v => { const t = Math.max(0, Math.min(1, v)); return t < .5 ? cool.clone().lerp(mid, t * 2) : t < .8 ? mid.clone().lerp(warm, (t - .5) / .3) : warm.clone().lerp(hot, (t - .8) / .2); };
  const items = () => [...vis.values()].map(v => ({ x: v.x, z: v.z, width: v.width, height: v.h }));
  let cachedItems = [], cachedSpine = [];
  const rawHeight = (x, z) => gauss(x, z, cachedItems) + gauss(x, z, cachedSpine) * .3;
  const shownHeight = (x, z) => { const h = rawHeight(x, z); return state?.mode === 'underground' ? .1 : state?.mode === 'heat' ? Math.min(slice, h) : h; };

  function rebuild() {
    if (!current) return; cachedItems = items(); cachedSpine = spineItems(); const p = geo.attributes.position, c = geo.attributes.color, pr = geo.attributes.aPress; const heat = state.mode === 'heat';
    const stocks = current.stocks, withAmp = stocks.filter(s => s.amplitude != null), districts = current.sectors.filter(g => g.change != null);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = rawHeight(x, z); p.setY(i, heat ? Math.min(slice, h) : h);
      let color;
      if (heat) color = heatPalette(fieldValue(x, z, stocks, 'heat') / 100);
      else { color = h < 3 ? deep.clone().lerp(mid, h / 3) : mid.clone().lerp(high, Math.min(1, (h - 3) / 7)); const hk = Math.min(1, Math.max(0, (h - .4) / 2.2)); if (withAmp.length && hk > 0) { const amp = fieldValue(x, z, withAmp, 'amplitude'); color.lerp(bandColor(amp), (.25 + Math.min(.45, amp * .07)) * hk); } }
      let scar = 0; for (const v of vis.values()) if (v.scar > 0) { const d2 = (x - v.x) ** 2 + (z - v.z) ** 2; if (d2 < v.width * v.width * 6) scar = Math.max(scar, v.scar * Math.exp(-d2 / (v.width * v.width * 2.5))); }
      if (scar > 0) color.lerp(scarColor, scar * .8);
      c.setXYZ(i, color.r, color.g, color.b);
      let pv = 0, pw = 0; for (const g of districts) { const d2 = (x - g.x) ** 2 + (z - g.z) ** 2; if (d2 > 900) continue; const a = Math.exp(-d2 / 90); pv += g.change * a; pw += a; } pr.setX(i, pw > .02 ? pv / pw : 0);
    }
    p.needsUpdate = true; c.needsUpdate = true; pr.needsUpdate = true; geo.computeVertexNormals();
    const underground = state.mode === 'underground';
    material.opacity = underground ? .12 : 1; material.transparent = underground; material.wireframe = underground; material.depthWrite = !underground; material.needsUpdate = material.userData.underground !== underground; material.userData.underground = underground; uniforms.uGlow.value = underground ? 0 : 1; pressureMap.visible = underground;
    uniforms.uWind.value = state.layers.wind && !underground && !heat ? 1 : 0;
    if (underground) { const pp = pressureGeo.attributes.position, pc = pressureGeo.attributes.color; for (let i = 0; i < pp.count; i++) { const v = fieldValue(pp.getX(i), pp.getZ(i), stocks, 'pressure') / 100; const color = deep.clone().lerp(warm, Math.min(1, v * 1.4)); if (v > .55) color.lerp(hot, (v - .55) * 2); pc.setXYZ(i, color.r, color.g, color.b); } pc.needsUpdate = true; }
    for (const s of stocks) { const m = markers.get(s.id); if (!m) continue; m.position.set(s.x, shownHeight(s.x, s.z) + .2, s.z); m.material.color.set(s.collapse ? '#ff7a6b' : s.change > 0 ? '#ffe7b0' : s.change < 0 ? '#ffb4ad' : '#c5d3ea'); }
    const sel = markers.get(state.selected); if (sel) { selection.position.copy(sel.position); selection.position.y += .12; selection.visible = true; } else selection.visible = false;
    if (riverCurve) { const pts = riverCurve.basePoints.map(bp => new THREE.Vector3(bp.x, shownHeight(bp.x, bp.z) + .6, bp.z)); riverCurve.curve = new THREE.CatmullRomCurve3(pts); riverCore.geometry.dispose(); riverGlow.geometry.dispose(); riverCore.geometry = new THREE.TubeGeometry(riverCurve.curve, 160, riverRadius, 7, false); riverGlow.geometry = new THREE.TubeGeometry(riverCurve.curve, 100, riverRadius * 4.2, 8, false); }
    rangeGroup.children.forEach(o => { const pos = o.geometry.attributes.position; o.userData.hull.forEach((q, i) => pos.setY(i, shownHeight(q.x, q.z) + .25)); pos.needsUpdate = true; });
    diggers.forEach(d => { if (d.visible) d.position.y = shownHeight(d.position.x, d.position.z); });
    dirty = false;
  }
  function syncScene(snap) {
    const key = snap.stocks.map(s => s.id).join(','); if (key !== frameKey.split('#')[0]) { for (const m of markers.values()) { markerGroup.remove(m); m.geometry.dispose(); m.material.dispose(); } markers.clear(); for (const s of snap.stocks) { const m = new THREE.Mesh(new THREE.SphereGeometry(.18, 10, 8), new THREE.MeshBasicMaterial({ color: '#c5d3ea' })); m.userData.id = s.id; markerGroup.add(m); markers.set(s.id, m); } }
    const rk = layout.etfs.filter(e => e.visible).map(e => e.id + e.hull.length).join('|');
    if (rk !== rangeKey) { rangeKey = rk; for (const o of [...rangeGroup.children]) { rangeGroup.remove(o); o.geometry.dispose(); o.material.dispose(); }
      for (const e of layout.etfs) { if (!e.visible || e.hull.length < 3) continue; const curve = new THREE.CatmullRomCurve3(e.hull.map(q => new THREE.Vector3(q.x, .3, q.z)), true, 'catmullrom', .6); const pts = curve.getPoints(160); const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: e.color, dashSize: 1.1, gapSize: .6, transparent: true, opacity: .75 })); line.computeLineDistances(); line.userData.hull = pts.map(q => ({ x: q.x, z: q.z })); rangeGroup.add(line); } }
    rangeGroup.visible = state.mode !== 'underground';
    const rkey = snap.river ? `${snap.river.from.id}>${snap.river.to.id}` : ''; if (rkey !== riverKey) { riverKey = rkey; if (snap.river) { const a = snap.river.from, b = snap.river.to; const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, nx = -(b.z - a.z), nz = b.x - a.x, len = Math.hypot(nx, nz) || 1; const bend = Math.min(9, len * .3); const base = new THREE.CatmullRomCurve3([new THREE.Vector3(a.x, 0, a.z), new THREE.Vector3(mx + nx / len * bend, 0, mz + nz / len * bend), new THREE.Vector3(b.x, 0, b.z)]); riverCurve = { basePoints: Array.from({ length: 70 }, (_, i) => base.getPoint(i / 69)), curve: null }; } else riverCurve = null; }
    riverRadius = snap.river ? .14 + Math.min(.42, Math.abs(snap.river.amount) / 300) : .2;
    river.visible = !!snap.river && state.layers.flow && state.mode !== 'underground';
    arrows.forEach(a => { const s = snap.sectors.filter(g => g.change != null).reduce((best, g) => !best || Math.hypot(g.x - a.position.x, g.z - a.position.z) < Math.hypot(best.x - a.position.x, best.z - a.position.z) ? g : best, null); const ch = s?.change ?? 0; a.visible = !!s && Math.hypot(s.x - a.position.x, s.z - a.position.z) < 22; a.setDirection(new THREE.Vector3(ch >= 0 ? 1 : -1, 0, -.2).normalize()); a.setLength(1.4 + Math.min(4, Math.abs(ch)) * .9, .7, .4); const col = ch >= 0 ? '#ffb266' : '#5fb8ff'; a.line.material.color.set(col); a.cone.material.color.set(col); a.line.material.opacity = a.cone.material.opacity = Math.abs(ch) < .05 ? .25 : .85; });
    wind.visible = state.layers.wind && state.mode !== 'underground';
    if (snap.storm) { storm.position.set(snap.storm.sector.x, 0, snap.storm.sector.z); const k = .25 + snap.storm.intensity * .55; hexes.forEach(h => h.material.opacity = k); rain.material.opacity = .15 + snap.storm.intensity * .6; storm.userData.intensity = snap.storm.intensity; } storm.visible = !!snap.storm && state.layers.storm && state.mode !== 'underground';
    const dug = snap.stocks.filter(s => s.dig > 0).sort((a, b) => b.dig - a.dig); let di = 0;
    for (const s of dug) { const n = s.dig > .5 ? 2 : 1; for (let k = 0; k < n && di < diggers.length; k++, di++) { const d = diggers[di]; d.visible = state.layers.short !== false && state.mode !== 'underground'; const ang = k * 2.4 + 1; d.position.set(s.x + Math.cos(ang) * (s.width * 1.1 + .8), 0, s.z + Math.sin(ang) * (s.width * 1.1 + .8)); d.lookAt(s.x, 0, s.z); d.userData.speed = .8 + s.dig * 1.6; d.userData.id = s.id; } }
    for (; di < diggers.length; di++) diggers[di].visible = false;
    const defs = new Map();
    for (const e of layout.etfs) if (e.visible && e.ridge) defs.set('e:' + e.id, { x: e.ridge.anchor.x, z: e.ridge.anchor.z, text: `${e.id} ${e.name}`, sub: `${e.holdings.length} 檔${e.shared ? ` · 共同 ${e.shared}` : ''}`, kind: 'etf', color: e.color, id: e.members[0] });
    for (const g of snap.sectors) if (g.labelVisible) defs.set('g:' + g.id, { x: g.x, z: g.z, text: g.name, sub: g.change == null ? '—' : `${g.change >= 0 ? '+' : ''}${g.change.toFixed(2)}%`, kind: 'sector', color: g.color, id: g.members[0]?.[0] });
    for (const s of snap.stocks) { const top = s.weight >= 2.5; if (top || s.id === state.selected || s.collapse || s.dig > .5) defs.set('s:' + s.id, { x: s.x, z: s.z, text: s.name, sub: s.change == null ? '—' : `${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%${s.dig > .5 ? ' ⛏' : ''}`, kind: s.collapse ? 'collapse' : s.id === state.selected ? 'selected' : 'stock', id: s.id, band: s.band?.color }); }
    for (const [k, l] of labels) if (!defs.has(k)) { l.el.remove(); labels.delete(k); }
    for (const [k, d] of defs) { let l = labels.get(k); if (!l) { const el = document.createElement('button'); el.className = 'terrain-label'; el.addEventListener('click', () => onSelect(d.id)); labelHost.append(el); l = { el }; labels.set(k, l); } Object.assign(l, d); l.el.className = `terrain-label ${d.kind}`; l.el.style.setProperty('--sector', d.color ?? d.band ?? '#9fb3d8'); l.el.innerHTML = `<span>${d.text}</span><small>${d.sub}</small>`; }
  }
  function startSlide(s, change) {
    const v = vis.get(s.id); if (!v || slides.length >= 8) return; const peak = rawHeight(s.x, s.z); const N = 170;
    const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const a = rnd(0, Math.PI * 2), r = rnd(.1, .5) * v.width; pos[i * 3] = s.x + Math.cos(a) * r; pos[i * 3 + 1] = peak + rnd(0, .6); pos[i * 3 + 2] = s.z + Math.sin(a) * r; const sp = rnd(2, 6); vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = rnd(1, 4); vel[i * 3 + 2] = Math.sin(a) * sp; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: '#d9b28c', size: .26, transparent: true, opacity: .95 }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(.9, 1, 64), new THREE.MeshBasicMaterial({ color: '#c9a27a', transparent: true, opacity: .6, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, .15, s.z);
    const dust = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: '#8d7a68', transparent: true, opacity: .18, depthWrite: false })); dust.position.set(s.x, peak * .5, s.z);
    slidesGroup.add(pts, ring, dust); slides.push({ id: s.id, x: s.x, z: s.z, width: v.width, peak, pos, vel, pts, ring, dust, age: 0, dur: 4.2 });
    v.scar = 1; v.dropping = 1; shake = .55;
    const el = document.createElement('div'); el.className = 'collapse-badge'; el.textContent = `⛰ 山崩 ${change == null ? '' : `${change.toFixed(2)}%`}`; labelHost.append(el); slides[slides.length - 1].badge = el;
    onCollapse?.(s);
  }
  const api = {
    update(snap, st) {
      current = snap; state = st;
      const key = `${snap.stocks.map(s => s.id).join(',')}#${snap.range}#${snap.frame}#${snap.date ?? ''}`; const frameChanged = key !== frameKey;
      for (const s of snap.stocks) { let v = vis.get(s.id); if (!v) { v = { x: s.x, z: s.z, width: s.width, h: s.height, target: s.height, scar: 0, dropping: 0 }; vis.set(s.id, v); } v.x = s.x; v.z = s.z; v.target = s.height; v.width = s.width; if (frameChanged && s.collapse && !v.demo && !slides.some(x => x.id === s.id && x.age < 1)) startSlide(s, s.change); }
      for (const id of [...vis.keys()]) if (!snap.stocks.some(s => s.id === id)) vis.delete(id);
      syncScene(snap); frameKey = key; dirty = true;
    },
    setSlice(v) { slice = v; dirty = true; },
    // Fly to a hill; when the camera arrives, pulse rings + glow mark the spot for ~2.5 s.
    focus(x, z, { pulse: withPulse = true } = {}) { aim = { target: new THREE.Vector3(x, 2, z), position: new THREE.Vector3(x + 20, 24, z + 30), onArrive: withPulse ? () => { pulse = { x, z, age: 0 }; } : null }; },
    reset() { aim = { target: new THREE.Vector3(0, 1, 6), position: home() }; },
    top() { aim = { target: controls.target.clone(), position: controls.target.clone().add(new THREE.Vector3(0, 90, .1)) }; },
    zoom(f) { aim = null; const o = camera.position.clone().sub(controls.target); o.setLength(THREE.MathUtils.clamp(o.length() * f, controls.minDistance, controls.maxDistance)); camera.position.copy(controls.target).add(o); controls.update(); },
    demoCollapse(id) { const s = current?.stocks.find(x => x.id === id); const v = vis.get(id); if (!s || !v) return; v.demo = true; startSlide(s, null); v.target = .15; setTimeout(() => { v.demo = false; v.target = s.height; dirty = true; }, 7000); },
    dispose() { disposed = true; },
  };
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down = null;
  const pick = e => { const rect = renderer.domElement.getBoundingClientRect(); pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects([...markers.values(), pressureMap.visible ? pressureMap : terrain])[0]; if (!hit || !current) return null; if (hit.object.userData.id) return current.stocks.find(s => s.id === hit.object.userData.id); const nearest = [...current.stocks].sort((a, b) => Math.hypot(a.x - hit.point.x, a.z - hit.point.z) - Math.hypot(b.x - hit.point.x, b.z - hit.point.z))[0]; return nearest && Math.hypot(nearest.x - hit.point.x, nearest.z - hit.point.z) < 4.5 ? nearest : null; };
  renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; aim = null; host.focus({ preventScroll: true }); });
  renderer.domElement.addEventListener('pointerup', e => { if (down && Math.hypot(down.x - e.clientX, down.y - e.clientY) < 5 && e.button === 0) { const s = pick(e); if (s) onSelect(s.id); } down = null; });
  const tip = host.querySelector('#tooltip');
  renderer.domElement.addEventListener('pointermove', e => { if (!current || e.buttons) return; const s = pick(e); tip.hidden = !s; renderer.domElement.style.cursor = s ? 'pointer' : 'grab'; if (s) { tip.innerHTML = `<b>${s.name}</b> ${s.id} · ${s.change == null ? '無資料' : `${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%`}${s.price != null ? ` · ${s.price}` : ''}${s.amplitude != null ? ` · 振幅 ${s.amplitude.toFixed(1)}%` : ''}${s.etfs.length ? ` · ${s.etfs.map(e => e.id).join('+')}` : ''}`; const r = host.getBoundingClientRect(); tip.style.left = `${Math.min(e.clientX - r.left + 12, r.width - 260)}px`; tip.style.top = `${Math.max(10, e.clientY - r.top - 40)}px`; } });
  renderer.domElement.addEventListener('pointerleave', () => tip.hidden = true);
  host.addEventListener('keydown', e => { if (e.target !== host && e.target !== renderer.domElement) return; const key = e.key.toLowerCase(); if (!['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd', '+', '=', '-', 'r', ' '].includes(key)) return; e.preventDefault(); aim = null;
    if (key === ' ') return onPlay(); if (key === 'r') return api.reset(); if (key === '+' || key === '=') return api.zoom(.85); if (key === '-') return api.zoom(1.18);
    if (key.startsWith('arrow')) { const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); sph.theta += key === 'arrowleft' ? .1 : key === 'arrowright' ? -.1 : 0; sph.phi = THREE.MathUtils.clamp(sph.phi + (key === 'arrowup' ? -.08 : key === 'arrowdown' ? .08 : 0), .05, Math.PI * .47); camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph)); }
    else { const o = new THREE.Vector3(key === 'a' ? -2 : key === 'd' ? 2 : 0, 0, key === 'w' ? -2 : key === 's' ? 2 : 0); camera.position.add(o); controls.target.add(o); } controls.update(); });
  const resize = new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); resize.observe(host);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');

  function tick(ms) {
    if (disposed) return; requestAnimationFrame(tick); if (document.hidden) return; const dt = Math.min((ms - last) / 1000, .05); last = ms; if (!motion.matches) phase += dt;
    if (aim) { camera.position.lerp(aim.position, .07); controls.target.lerp(aim.target, .07); if (camera.position.distanceTo(aim.position) < .3) { const cb = aim.onArrive; aim = null; cb?.(); } } controls.update();
    let moving = false; for (const v of vis.values()) { const d = v.target - v.h; if (Math.abs(d) > .004) { v.h += d * (1 - Math.exp(-dt * (v.dropping > 0 && d < 0 ? 9 : 4.5))); moving = true; } else v.h = v.target; if (v.dropping > 0) v.dropping = Math.max(0, v.dropping - dt * .5); if (v.scar > 0) { v.scar = Math.max(0, v.scar - dt / 28); if (Math.abs(v.scar % .04) < dt / 28) moving = true; } }
    if (slides.length) { moving = true; cachedItems = items(); }
    for (const sl of slides) {
      sl.age += dt; const k = 1 - sl.age / sl.dur; const p = sl.pos, vl = sl.vel;
      for (let i = 0; i < p.length; i += 3) { vl[i + 1] -= 9.8 * dt * .7; p[i] += vl[i] * dt; p[i + 1] += vl[i + 1] * dt; p[i + 2] += vl[i + 2] * dt; const g = rawHeight(p[i], p[i + 2]) + .1; if (p[i + 1] < g) { p[i + 1] = g; vl[i + 1] *= -.2; const gx = rawHeight(p[i] + .5, p[i + 2]) - rawHeight(p[i] - .5, p[i + 2]), gz = rawHeight(p[i], p[i + 2] + .5) - rawHeight(p[i], p[i + 2] - .5); vl[i] -= gx * 7 * dt; vl[i + 2] -= gz * 7 * dt; vl[i] *= .97; vl[i + 2] *= .97; } }
      sl.pts.geometry.attributes.position.needsUpdate = true; sl.pts.material.opacity = Math.max(0, k); const rs = 1 + Math.min(1, sl.age / 1.4) * sl.width * 3.2; sl.ring.scale.setScalar(rs); sl.ring.material.opacity = Math.max(0, .6 - sl.age / 1.6); sl.dust.material.opacity = Math.max(0, .18 * k); sl.dust.scale.set(sl.width * (1 + sl.age * .35), sl.peak * .4 * (1 + sl.age * .2), sl.width * (1 + sl.age * .35)); sl.dust.position.y += dt * .5;
      if (sl.badge) { const pt = new THREE.Vector3(sl.x, rawHeight(sl.x, sl.z) + 3.2, sl.z).project(camera); sl.badge.style.left = `${(pt.x * .5 + .5) * host.clientWidth}px`; sl.badge.style.top = `${(-pt.y * .5 + .5) * host.clientHeight}px`; sl.badge.style.opacity = sl.age > sl.dur ? String(Math.max(0, 1 - (sl.age - sl.dur) / 1.5)) : '1'; }
      if (sl.age > sl.dur + 1.5) { slidesGroup.remove(sl.pts, sl.ring, sl.dust); sl.pts.geometry.dispose(); sl.badge?.remove(); slides.splice(slides.indexOf(sl), 1); }
    }
    if (pulse) { pulse.age += dt; const y = shownHeight(pulse.x, pulse.z); const t = pulse.age / 2.6; glowSprite.position.set(pulse.x, y + 1.2, pulse.z); glowSprite.material.opacity = Math.max(0, .95 * (1 - t)) * (.7 + .3 * Math.sin(phase * 14)); pulseLight.position.set(pulse.x, y + 3, pulse.z); pulseLight.intensity = Math.max(0, 40 * (1 - t));
      pulseRings.forEach((r, i) => { const rt = (pulse.age - i * .45) / 1.6; r.visible = rt > 0 && rt < 1; if (r.visible) { r.position.set(pulse.x, y + .2, pulse.z); r.scale.setScalar(1 + rt * 7); r.material.opacity = (1 - rt) * .9; } });
      const sel = labels.get('s:' + state?.selected); sel?.el.classList.toggle('flash', t < 1);
      if (t >= 1) { pulse = null; glowSprite.material.opacity = 0; pulseLight.intensity = 0; pulseRings.forEach(r => r.visible = false); sel?.el.classList.remove('flash'); } }
    if (shake > 0) { shake = Math.max(0, shake - dt); scene.position.set(rnd(-1, 1) * shake * .25, rnd(-1, 1) * shake * .15, rnd(-1, 1) * shake * .25); } else scene.position.set(0, 0, 0);
    if ((dirty || moving) && current) rebuild();
    if (riverCurve?.curve && river.visible) { const rl = host.querySelector('#river-label'); if (rl) { const pt = riverCurve.curve.getPoint(.5).clone(); pt.y += 1.2; pt.project(camera); rl.style.left = `${(pt.x * .5 + .5) * host.clientWidth}px`; rl.style.top = `${(-pt.y * .5 + .5) * host.clientHeight}px`; rl.style.bottom = 'auto'; } riverDots.forEach((d, i) => { const t = (i / riverDots.length + phase * .06) % 1; d.position.copy(riverCurve.curve.getPoint(t)); d.scale.setScalar((.7 + Math.sin(phase * 4 + i) * .3) * (riverRadius / .2)); }); }
    arrows.forEach((a, i) => { a.position.y = 6 + Math.sin(phase * 1.3 + i) * .35; });
    diggers.forEach(d => { if (!d.visible) return; const t = phase * d.userData.speed + d.userData.phase; d.userData.boom.rotation.z = -.35 + Math.sin(t) * .35; d.userData.joint.rotation.z = -.9 + Math.sin(t * 1.3 + .8) * .55; });
    if (storm.visible) { hexes.forEach((h, i) => { h.position.y = 10 + Math.sin(phase * .9 + i * .7) * .35; h.rotation.y = Math.PI / 6 + Math.sin(phase * .2 + i) * .05; }); for (let i = 0; i < 240; i++) rainPos[i * 3 + 1] = ((rainPos[i * 3 + 1] - dt * 9) % 9 + 9) % 9; rainGeo.attributes.position.needsUpdate = true;
      nextBolt -= dt; if (nextBolt <= 0 && (storm.userData.intensity > .35 || slides.length)) { const bp = boltGeo.attributes.position.array; let x = rnd(-3, 3), z = rnd(-3, 3); for (let i = 0; i < 12; i++) { bp[i * 3] = x; bp[i * 3 + 1] = 9.5 - i * .8; bp[i * 3 + 2] = z; x += rnd(-.9, .9); z += rnd(-.9, .9); } boltGeo.attributes.position.needsUpdate = true; boltT = .18; nextBolt = rnd(1.5, 5) / Math.max(.3, storm.userData.intensity); }
      if (boltT > 0) { boltT -= dt; bolt.material.opacity = boltT > .09 ? 1 : boltT / .09; flash.intensity = bolt.material.opacity * 45; } else { bolt.material.opacity = 0; flash.intensity = 0; } }
    if (current) { const occupied = []; for (const l of labels.values()) { const pt = new THREE.Vector3(l.x, shownHeight(l.x, l.z) + (l.kind === 'etf' ? 4.2 : l.kind === 'sector' ? 2.6 : 1.7), l.z).project(camera); const x = (pt.x * .5 + .5) * host.clientWidth; let y = (-pt.y * .5 + .5) * host.clientHeight; for (const o of occupied) if (Math.abs(o.x - x) < 96 && Math.abs(o.y - y) < 34) y = o.y - 36; occupied.push({ x, y }); l.el.style.left = `${x}px`; l.el.style.top = `${y}px`; l.el.hidden = pt.z > 1 || Math.abs(pt.x) > .95 || y < 10 || y > host.clientHeight - 20; } }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);
  host.addEventListener('webglcontextlost', e => { e.preventDefault(); tip.hidden = false; tip.textContent = '3D 顯示已中斷，請重新整理頁面。'; }, true);
  window.addEventListener('pagehide', () => { disposed = true; resize.disconnect(); controls.dispose(); renderer.dispose(); }, { once: true });
  return api;
}
