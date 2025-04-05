import * as THREE from 'https://unpkg.com/three@0.156.1/build/three.module.js';
import { ImprovedNoise } from 'https://esm.sh/three@0.156.1/examples/jsm/math/ImprovedNoise.js';
import { MarchingCubes } from 'https://esm.sh/three@0.156.1/examples/jsm/objects/MarchingCubes.js';


const loadingScreen = document.createElement('div');
loadingScreen.style.position = 'absolute';
loadingScreen.style.top = '0';
loadingScreen.style.left = '0';
loadingScreen.style.width = '100%';
loadingScreen.style.height = '100%';
loadingScreen.style.background = 'black';
loadingScreen.style.display = 'flex';
loadingScreen.style.alignItems = 'center';
loadingScreen.style.justifyContent = 'center';
loadingScreen.style.color = 'white';
loadingScreen.style.fontSize = '2em';
loadingScreen.innerText = 'Loading...';
document.body.appendChild(loadingScreen);

const hud = document.createElement('div');
hud.style.position = 'absolute';
hud.style.top = '10px';
hud.style.left = '10px';
hud.style.color = 'white';
hud.style.fontFamily = 'monospace';
hud.style.zIndex = '1000';
document.body.appendChild(hud);

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(1, 2, 3);
scene.add(dirLight);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const savedPos = JSON.parse(localStorage.getItem('playerPosition'));
if (savedPos) {
  camera.position.set(savedPos.x, savedPos.y, savedPos.z);
  camera.lookAt(savedPos.x, savedPos.y, savedPos.z);
} else {
    camera.position.set(32, 32, 64);
    camera.lookAt(32, 32, 32); 
}

if (!savedPos) {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    yaw = Math.atan2(direction.x, direction.z);
    const projYZ = new THREE.Vector3(0, direction.y, direction.length()); 
    pitch = Math.atan2(-direction.y, Math.sqrt(direction.x*direction.x + direction.z*direction.z)); 
    camera.rotation.set(pitch, yaw, 0); 
}

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const depthShaderMaterial = new THREE.ShaderMaterial({
  vertexShader: `
    varying float vDepth;
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vDepth = -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying float vDepth;
    void main() {
      float normalizedDepth = smoothstep(10.0, 200.0, vDepth);
      gl_FragColor = vec4(vec3(1.0 - normalizedDepth), 1.0);
    }
  `,
});

// --- CONTROLS ---
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const keys = {};
let pitch = 0, yaw = 0;

const pointerLock = () => {
  const blocker = document.createElement('div');
  blocker.style.position = 'absolute';
  blocker.style.top = '0';
  blocker.style.left = '0';
  blocker.style.width = '100%';
  blocker.style.height = '100%';
  blocker.style.backgroundColor = 'rgba(0,0,0,0.5)';
  blocker.style.zIndex = '999';
  blocker.innerText = 'Click to start';
  blocker.style.color = 'white';
  blocker.style.display = 'flex';
  blocker.style.alignItems = 'center';
  blocker.style.justifyContent = 'center';
  document.body.appendChild(blocker);

  blocker.addEventListener('click', () => {
    blocker.style.display = 'none';
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === renderer.domElement) {
      document.addEventListener('mousemove', onMouseMove, false);
    } else {
      document.removeEventListener('mousemove', onMouseMove, false);
      blocker.style.display = 'flex';
    }
  }, false);
};
pointerLock();

function onMouseMove(event) {
  yaw -= event.movementX * 0.002;
  pitch -= event.movementY * 0.002;
  pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
  yaw = ((yaw + Math.PI) % (2 * Math.PI)) - Math.PI;
  camera.rotation.order = 'YXZ';
camera.rotation.set(pitch, yaw, 0);
}

document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup', e => { keys[e.code] = false; });

// --- CHUNK SYSTEM ---
const SIZE = 64;
const ISOLEVEL = 0;
const noise = new ImprovedNoise();
let carvingSpheres = JSON.parse(localStorage.getItem('carvingSpheres') || '[]');
const chunks = new Map();

function chunkKey(x, y, z) {
  return `${x},${y},${z}`;
}

function sdf(x, y, z) {
    const tunnelScale = 0.05;
    const noiseVal = noise.noise(x * tunnelScale, y * tunnelScale, z * tunnelScale);
  
    // Low noise value = inside tunnel
    let d = noiseVal * 10 - 3; // lower threshold = more tunnel
  
    // Blend in a general spherical falloff to keep it contained
    const distToCenter = Math.sqrt((x - 32) ** 2 + (y - 32) ** 2 + (z - 32) ** 2);
    d += (distToCenter - 30) * 0.3;
  
    // Apply mining carve spheres
    for (const s of carvingSpheres) {
      const dist = Math.sqrt((x - s.x) ** 2 + (y - s.y) ** 2 + (z - s.z) ** 2) - s.r;
      d = Math.min(d, dist);
    }
  
    return d;
  }
  
  
function generateChunk(cx, cy, cz) {
  const key = chunkKey(cx, cy, cz);
  if (chunks.has(key)) return;
  const field = new Float32Array(SIZE * SIZE * SIZE);
  for (let z = 0; z < SIZE; z++) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const wx = x + cx * SIZE;
        const wy = y + cy * SIZE;
        const wz = z + cz * SIZE;
        const i = x + y * SIZE + z * SIZE * SIZE;
        field[i] = -sdf(wx, wy, wz);
      }
    }
  }
  const debugMaterial = new THREE.MeshNormalMaterial({
    flatShading: true,
    wireframe: true // 👈 Add this!
  });

  const maxPolyCount = SIZE * SIZE * SIZE;
  const mc = new MarchingCubes(SIZE, debugMaterial, true, true, maxPolyCount);
  mc.isolation = ISOLEVEL;
  for (let i = 0; i < field.length; i++) mc.field[i] = field[i];
  mc.position.set(cx * SIZE, cy * SIZE, cz * SIZE);
  scene.add(mc);
  chunks.set(key, { mesh: mc, field });
}

function getChunkCoords(position) {
  return [
    Math.floor(position.x / SIZE),
    Math.floor(position.y / SIZE),
    Math.floor(position.z / SIZE)
  ];
}

function ensureChunksAround(position) {
  const [cx, cy, cz] = getChunkCoords(position);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        generateChunk(cx + dx, cy + dy, cz + dz);
      }
    }
  }
  for (const [key, chunk] of chunks) {
    const [x, y, z] = key.split(',').map(Number);
    const dist = Math.abs(x - cx) + Math.abs(y - cy) + Math.abs(z - cz);
    if (dist > 2) {
      scene.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
      chunks.delete(key);
    }
  }
}

function isWalkable(pos) {
  const cx = Math.floor(pos.x / SIZE);
  const cy = Math.floor(pos.y / SIZE);
  const cz = Math.floor(pos.z / SIZE);
  const key = chunkKey(cx, cy, cz);
  const chunk = chunks.get(key);
  if (!chunk) return false;
  const lx = ((Math.floor(pos.x) % SIZE) + SIZE) % SIZE;
  const ly = ((Math.floor(pos.y) % SIZE) + SIZE) % SIZE;
  const lz = ((Math.floor(pos.z) % SIZE) + SIZE) % SIZE;
  if (lx < 0 || lx >= SIZE || ly < 0 || ly >= SIZE || lz < 0 || lz >= SIZE) return false;
  const i = lx + ly * SIZE + lz * SIZE * SIZE;
  return chunk.field[i] < ISOLEVEL;
}

// --- MINING ---
window.addEventListener('click', () => {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone();
  const step = dir.clone();
  const pos = origin.clone();
  for (let d = 0; d < 5; d++) {
    pos.add(step.multiplyScalar(4));
    carvingSpheres.push({ x: pos.x, y: pos.y, z: pos.z, r: 2.5 });
  }
  localStorage.setItem('carvingSpheres', JSON.stringify(carvingSpheres));
  const [cx, cy, cz] = [Math.floor(camera.position.x / SIZE), Math.floor(camera.position.y / SIZE), Math.floor(camera.position.z / SIZE)];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = chunkKey(cx + dx, cy + dy, cz + dz);
        const chunk = chunks.get(key);
        if (chunk) {
          scene.remove(chunk.mesh);
          chunks.delete(key);
        }
      }
    }
  }
  ensureChunksAround(camera.position);
});

// --- MOVEMENT + LOOP ---
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const moveSpeed = 30 * delta;
  direction.set(0, 0, 0);
  if (keys['KeyW']) direction.z -= 1;
  if (keys['KeyS']) direction.z += 1;
  if (keys['KeyA']) direction.x -= 1;
  if (keys['KeyD']) direction.x += 1;
  direction.normalize();
  const move = direction.clone().applyEuler(camera.rotation).multiplyScalar(moveSpeed);
  const newPos = camera.position.clone().add(move);
  if (isWalkable(newPos)) camera.position.copy(newPos);
  ensureChunksAround(camera.position);

  for (const { mesh } of chunks.values()) {
    mesh.update();
  }

  hud.innerText = `X: ${camera.position.x.toFixed(1)}  Y: ${camera.position.y.toFixed(1)}  Z (Depth): ${camera.position.z.toFixed(1)}`;
  localStorage.setItem('playerPosition', JSON.stringify(camera.position));
  renderer.render(scene, camera);
}

ensureChunksAround(camera.position);
loadingScreen.remove();
animate();
