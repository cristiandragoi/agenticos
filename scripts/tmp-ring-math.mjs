// Exact projection math for the Jarvis capability ring, using the repo's own
// three.js and the exact camera parameters from JarvisNeuralBlob.
import * as THREE from 'three';
const W = 1340, H = 560;                    // measured canvas box @1920x1080
const camera = new THREE.PerspectiveCamera(45, W / H, 0.05, 60);
camera.position.set(0, 0, 4.6); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
const R = 1.35;
const names = ['MEMORY','PROJECTS','KNOWLEDGE','HERMES','VISION','CODEX','MAGNITUDE'];
const pts = names.map((n, i) => {
  const a = -Math.PI / 2 + (i / names.length) * Math.PI * 2;
  return { n, v: new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0.12) };
});
const v = new THREE.Vector3();
const out = pts.map(({ n, v: p }) => {
  v.copy(p).project(camera);
  return { n, screenX: +((v.x * 0.5 + 0.5) * W).toFixed(1), screenY: +((-v.y * 0.5 + 0.5) * H).toFixed(1) };
});
const cx = W / 2, cy = H / 2;
const radii = out.map((o) => ({ n: o.n, r: +Math.hypot(o.screenX - cx, o.screenY - cy).toFixed(1), dx: +(o.screenX - cx).toFixed(1), dy: +(o.screenY - cy).toFixed(1) }));
// Sphere silhouette: world circle of radius 0.82 in the z=0 plane, all points at constant depth.
const sil = [];
for (let i = 0; i < 32; i++) {
  const a = (i / 32) * Math.PI * 2;
  v.set(Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0).project(camera);
  sil.push([(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]);
}
const xs = sil.map((p) => p[0]), ys = sil.map((p) => p[1]);
const sphere = { w: +(Math.max(...xs) - Math.min(...xs)).toFixed(1), h: +(Math.max(...ys) - Math.min(...ys)).toFixed(1) };
console.log(JSON.stringify({ canvas: { W, H, aspect: +(W / H).toFixed(3) }, ringRadiiPx: radii, sphereSilhouettePx: sphere, sphereWoverH: +(sphere.w / sphere.h).toFixed(3) }, null, 1));
