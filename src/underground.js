// Small 3D column chart of the TDCC shareholder distribution (15 levels) for the selected stock.
import * as THREE from 'three';

export function createUnderground(host) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 100); camera.position.set(9, 8, 11); camera.lookAt(0, 1, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); host.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight('#dfe9ff', '#0a0f1a', 2.2)); const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(4, 8, 5); scene.add(key);
  const base = new THREE.Mesh(new THREE.BoxGeometry(9, .2, 5.6), new THREE.MeshStandardMaterial({ color: '#111826', roughness: 1 })); base.position.y = -.1; scene.add(base);
  const grid = new THREE.GridHelper(9, 9, '#2c3a52', '#1b2436'); grid.position.y = .02; grid.scale.z = 5.6 / 9; scene.add(grid);
  const group = new THREE.Group(); scene.add(group);
  const columns = Array.from({ length: 15 }, (_, i) => {
    const col = i % 5, row = Math.floor(i / 5);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1, 1.1), new THREE.MeshStandardMaterial({ color: i >= 11 ? '#e0b95a' : i >= 8 ? '#7fb2e6' : '#4d6fa3', roughness: .55, metalness: .1, transparent: true, opacity: .92 }));
    mesh.position.set(-3.6 + col * 1.8, .5, -1.6 + row * 1.6); mesh.scale.y = .01; group.add(mesh); return mesh;
  });
  let targets = columns.map(() => .05), phase = 0, disposed = false, last = 0;
  const resize = new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); resize.observe(host);
  function tick(ms) { if (disposed) return; requestAnimationFrame(tick); if (document.hidden) return; const dt = Math.min((ms - last) / 1000, .05); last = ms; phase += dt;
    columns.forEach((c, i) => { c.scale.y += (targets[i] - c.scale.y) * .12; c.position.y = c.scale.y / 2; });
    group.rotation.y = Math.sin(phase * .25) * .35; renderer.render(scene, camera); }
  requestAnimationFrame(tick);
  return {
    // levels: [{level, pct}] from /api/holders. Heights use sqrt so the 1000+ 張 level does not flatten the rest.
    set(levels) { const pct = Array(15).fill(0); for (const l of levels ?? []) if (l.level >= 1 && l.level <= 15) pct[l.level - 1] = l.pct; const max = Math.max(1, ...pct); targets = pct.map(p => .05 + Math.sqrt(p / max) * 4.2); },
    dispose() { disposed = true; resize.disconnect(); renderer.dispose(); },
  };
}
