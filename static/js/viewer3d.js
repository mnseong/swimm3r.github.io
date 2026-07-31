import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const METHODS = [
  { key: 'colmap', label: 'COLMAP' },
  { key: 'gluemap', label: 'GLUEMAP' },
  { key: 'mast3r-sfm', label: 'MASt3R-SfM' },
  { key: 'swimm3r', label: 'Swimm3R (Ours)' },
];

const SCENES = [
  { key: 'cyan', label: 'Cyan' },
  { key: 'murky', label: 'Murky' },
  { key: 'outcrop', label: 'Outcrop' },
  { key: 'caustics', label: 'Caustics' },
];

const DATA_BASE_URL = 'https://huggingface.co/datasets/mskweon/underwater_ply/resolve/main/';

const NORMALIZED_EXTENT = 10;

const state = { method: 'swimm3r', scene: 'cyan' };

const root = document.getElementById('viewer3d-root');

root.innerHTML = `
  <div class="v3d-frame">
    <div class="v3d-controls">
      <div class="v3d-group">
        <span class="v3d-group-label">Method</span>
        <div class="v3d-pills" id="v3d-methods"></div>
      </div>
      <div class="v3d-group">
        <span class="v3d-group-label">Scene</span>
        <div class="v3d-pills" id="v3d-scenes"></div>
      </div>
    </div>
    <div class="v3d-canvas-wrap">
      <div class="v3d-empty" id="v3d-empty">
        <div class="v3d-empty-title" id="v3d-empty-title">Select a method and scene</div>
        <div class="v3d-empty-sub" id="v3d-empty-sub">Point cloud data will be added soon.</div>
      </div>
      <div class="v3d-loading" id="v3d-loading" aria-hidden="true">
        <div class="v3d-water" id="v3d-water">
          <div class="v3d-wave-layer">
            <svg class="v3d-wave v3d-wave-back" viewBox="0 0 2880 120" preserveAspectRatio="none">
              <path d="M0,60 C180,10 540,10 720,60 C900,110 1260,110 1440,60 C1620,10 1980,10 2160,60 C2340,110 2700,110 2880,60 L2880,120 L0,120 Z"></path>
            </svg>
            <svg class="v3d-wave v3d-wave-front" viewBox="0 0 2880 120" preserveAspectRatio="none">
              <path d="M0,60 C180,100 540,100 720,60 C900,20 1260,20 1440,60 C1620,100 1980,100 2160,60 C2340,20 2700,20 2880,60 L2880,120 L0,120 Z"></path>
            </svg>
          </div>
          <span class="v3d-drop" style="left:12%; animation-duration:4.2s; animation-delay:0s;"></span>
          <span class="v3d-drop" style="left:27%; animation-duration:5.4s; animation-delay:1.1s;"></span>
          <span class="v3d-drop" style="left:44%; animation-duration:3.8s; animation-delay:2.2s;"></span>
          <span class="v3d-drop" style="left:61%; animation-duration:5s;   animation-delay:0.6s;"></span>
          <span class="v3d-drop" style="left:78%; animation-duration:4.6s; animation-delay:1.7s;"></span>
          <span class="v3d-drop" style="left:90%; animation-duration:5.8s; animation-delay:3s;"></span>
        </div>
        <div class="v3d-loading-caption">
          <div class="v3d-loading-title" id="v3d-loading-title"></div>
          <div class="v3d-loading-pct" id="v3d-loading-pct"></div>
        </div>
      </div>
      <div class="v3d-status" id="v3d-status"></div>
    </div>
  </div>
`;

function buildPills(containerId, items, group) {
  const container = document.getElementById(containerId);
  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'v3d-pill' + (state[group] === item.key ? ' active' : '');
    btn.textContent = item.label;
    btn.dataset.key = item.key;
    btn.addEventListener('click', () => {
      state[group] = item.key;
      container.querySelectorAll('.v3d-pill').forEach((el) => {
        el.classList.toggle('active', el.dataset.key === item.key);
      });
      loadPointCloud();
    });
    container.appendChild(btn);
  });
}

buildPills('v3d-methods', METHODS, 'method');
buildPills('v3d-scenes', SCENES, 'scene');

const wrap = root.querySelector('.v3d-canvas-wrap');
const emptyEl = document.getElementById('v3d-empty');
const emptyTitle = document.getElementById('v3d-empty-title');
const emptySub = document.getElementById('v3d-empty-sub');
const statusEl = document.getElementById('v3d-status');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0xffffff, 1);
wrap.appendChild(renderer.domElement);

const scene3d = new THREE.Scene();
scene3d.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000);
camera.position.set(0, 0, 12);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 2.6;
controls.minDistance = NORMALIZED_EXTENT * 0.06;
controls.maxDistance = NORMALIZED_EXTENT * 8;

const loadingEl = document.getElementById('v3d-loading');
const waterEl = document.getElementById('v3d-water');
const loadingTitle = document.getElementById('v3d-loading-title');
const loadingPct = document.getElementById('v3d-loading-pct');

let currentPoints = null;
let loadToken = 0;
let loadingStartedAt = 0;
let viewerVisible = false;
let needsRender = true;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('static/js/draco/');
dracoLoader.setDecoderConfig({ type: 'wasm' });
dracoLoader.preload();

function resize() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  needsRender = true;
}

new ResizeObserver(resize).observe(wrap);
resize();

new IntersectionObserver((entries) => {
  viewerVisible = entries[0].isIntersecting;
  if (viewerVisible) needsRender = true;
}, { threshold: 0.01 }).observe(wrap);

controls.addEventListener('change', () => {
  needsRender = true;
});

function animate() {
  requestAnimationFrame(animate);
  if (!viewerVisible) return;
  const moved = controls.update();
  if (!moved && !needsRender) return;
  renderer.render(scene3d, camera);
  needsRender = false;
}
animate();

function showEmpty(title, sub) {
  emptyTitle.textContent = title;
  emptySub.textContent = sub;
  emptyEl.style.display = 'flex';
  statusEl.textContent = '';
}

function cloudUrl() {
  return DATA_BASE_URL + state.method + '/' + state.scene + '.drc';
}

const MIN_LOADING_MS = 450;

function showLoading(label) {
  loadingStartedAt = performance.now();
  loadingTitle.textContent = label;
  loadingPct.textContent = 'Streaming';
  waterEl.style.height = '8%';
  loadingEl.classList.remove('decoding');
  loadingEl.classList.add('active');
}

function setLoadingProgress(fraction) {
  const pct = Math.max(8, Math.min(100, Math.round(fraction * 100)));
  waterEl.style.height = pct + '%';
  loadingPct.textContent = pct + '%';
}

function setDecoding() {
  waterEl.style.height = '100%';
  loadingEl.classList.add('decoding');
  loadingPct.textContent = 'Decoding';
}

function hideLoading() {
  const elapsed = performance.now() - loadingStartedAt;
  const wait = Math.max(0, MIN_LOADING_MS - elapsed);
  setTimeout(() => {
    loadingEl.classList.remove('active', 'decoding');
    waterEl.style.height = '0%';
  }, wait);
}

function normalizeColors(geometry) {
  const attr = geometry.getAttribute('color');
  if (!attr || attr.array instanceof Uint8Array) return;
  const arr = attr.array;
  let max = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  if (max <= 2) return;
  for (let i = 0; i < arr.length; i++) {
    arr[i] /= 255;
  }
  attr.needsUpdate = true;
}

function loadPointCloud() {
  const methodLabel = METHODS.find((m) => m.key === state.method).label;
  const sceneLabel = SCENES.find((s) => s.key === state.scene).label;
  const token = ++loadToken;
  emptyEl.style.display = 'none';
  statusEl.textContent = '';
  showLoading(methodLabel + ' · ' + sceneLabel);

  dracoLoader.load(
    cloudUrl(),
    (geometry) => {
      if (token !== loadToken) {
        geometry.dispose();
        return;
      }
      normalizeColors(geometry);
      if (currentPoints) {
        scene3d.remove(currentPoints);
        currentPoints.geometry.dispose();
        currentPoints.material.dispose();
        currentPoints = null;
      }
      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox;
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = NORMALIZED_EXTENT / maxDim;
      geometry.translate(-center.x, -center.y, -center.z);
      geometry.scale(scale, scale, scale);

      const hasColor = geometry.hasAttribute('color');
      const material = new THREE.PointsMaterial({
        size: NORMALIZED_EXTENT * 0.0045,
        vertexColors: hasColor,
        color: hasColor ? 0xffffff : 0x1f6f8b,
        sizeAttenuation: true,
      });
      currentPoints = new THREE.Points(geometry, material);
      scene3d.add(currentPoints);

      camera.position.set(0, NORMALIZED_EXTENT * 0.28, NORMALIZED_EXTENT * 0.95);
      controls.target.set(0, 0, 0);
      controls.update();
      needsRender = true;

      const count = geometry.getAttribute('position').count;
      statusEl.textContent = methodLabel + ' · ' + sceneLabel + ' — ' + count.toLocaleString() + ' points';
      hideLoading();
    },
    (event) => {
      if (token !== loadToken) return;
      if (event.lengthComputable && event.total > 0) {
        const fraction = event.loaded / event.total;
        setLoadingProgress(fraction);
        if (fraction >= 1) setDecoding();
      }
    },
    () => {
      if (token !== loadToken) {
        return;
      }
      if (currentPoints) {
        scene3d.remove(currentPoints);
        currentPoints.geometry.dispose();
        currentPoints.material.dispose();
        currentPoints = null;
      }
      loadingEl.classList.remove('active', 'decoding');
      waterEl.style.height = '0%';
      showEmpty(
        methodLabel + ' · ' + sceneLabel,
        'Point cloud data for this combination will be added soon.'
      );
    }
  );
}

loadPointCloud();
