// src/main.js
// WebAR Face Filter (vanilla JS)
// Integrates: MediaPipe FaceMesh (face tracking), Three.js (3D render), OpenCV.js (post-capture filters)

import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';

// FaceMesh is loaded globally via index.html script tag
const FaceMesh = window.FaceMesh;

// NOTE: some CDN builds of MediaPipe may not export `Camera` as a named export.
// To avoid import errors in browsers/contexts where that module shape differs,
// provide a small local `Camera` wrapper that uses `navigator.mediaDevices.getUserMedia`.
class Camera {
  constructor(videoElement, { onFrame = async () => {}, width = 640, height = 480 } = {}) {
    this.video = videoElement;
    this.onFrame = onFrame;
    this.width = width;
    this.height = height;
    this._stream = null;
    this._raf = null;
    this._running = false;
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia not available');
    }
    const constraints = { video: { width: this.width, height: this.height, facingMode: 'user' } };
    this._stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this._stream;
    await this.video.play();
    this._running = true;

    const loop = async () => {
      if (!this._running) return;
      try { await this.onFrame(); } catch (e) { console.warn('Camera onFrame error', e); }
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  async stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this.video && !this.video.paused) this.video.pause();
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
  }
}

// ----- UI elements -----
const video = document.getElementById('input_video');
const startBtn = document.getElementById('btnStart');
const stopBtn = document.getElementById('btnStop');
const captureBtn = document.getElementById('btnCapture');
const filterSelect = document.getElementById('filterSelect');
const applyFilterBtn = document.getElementById('btnApplyFilter');
const statusEl = document.getElementById('status');
const fpsEl = document.getElementById('fps');
const threeContainer = document.getElementById('three-container');
const debugCanvas = document.getElementById('debugCanvas');
const chkDebug = document.getElementById('chkDebug');
const chkPerf = document.getElementById('chkPerf');
const captureModal = document.getElementById('captureModal');
const captureCanvas = document.getElementById('captureCanvas');
const downloadLink = document.getElementById('downloadLink');
const closeModal = document.getElementById('closeModal');
const arFilterSelect = document.getElementById('arFilterSelect');

// ----- Global state -----
let cameraUtils = null; // MediaPipe Camera wrapper
let faceMesh = null;
let renderer, scene, orthoCamera, glassesGroup;
let videoWidth = 640, videoHeight = 480;
let lastFpsUpdate = performance.now(), frames = 0;
// smoothing state to reduce jitter
let smoothPos = new THREE.Vector3(0,0,0);
let smoothRotZ = 0;
let smoothScale = 1;

// AR Filters state
let currentFilter = 'glasses_3d';
let filters = {};
let originalCanvas = document.createElement('canvas');

// ----- Utilities -----
function setStatus(msg) { statusEl.textContent = `Status: ${msg}`; }
function enable(el, v = true) { el.disabled = !v; }

// ----- Three.js scene & simple glasses model -----
function initThree(width = 640, height = 480) {
  // Renderer: alpha true so video shows underneath; preserveDrawingBuffer needed for screenshot
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(width, height);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  threeContainer.innerHTML = '';
  threeContainer.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  // Orthographic camera that maps roughly to pixel units centered at (0,0)
  orthoCamera = new THREE.OrthographicCamera(-width/2, width/2, height/2, -height/2, -1000, 1000);
  orthoCamera.position.set(0, 0, 10);

  // light
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  scene.add(hemi);

  // simple glasses model (two rings + bridge)
  glassesGroup = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6, roughness: 0.3 });

  const lensGeom = new THREE.TorusGeometry(1, 0.25, 8, 24);
  const leftLens = new THREE.Mesh(lensGeom, mat);
  const rightLens = new THREE.Mesh(lensGeom, mat);
  leftLens.position.set(-40, 0, 0);
  rightLens.position.set(40, 0, 0);
  leftLens.rotation.z = Math.PI/2;
  rightLens.rotation.z = Math.PI/2;

  const bridgeGeom = new THREE.BoxGeometry(18, 4, 6);
  const bridge = new THREE.Mesh(bridgeGeom, mat);
  bridge.position.set(0, 0, 0);

  glassesGroup.add(leftLens, rightLens, bridge);
  glassesGroup.scale.set(1.5, 1.5, 1.5);
  glassesGroup.visible = false;
  scene.add(glassesGroup);

  filters['glasses_3d'] = glassesGroup;

  // Create Sunglasses mesh
  const sunglassesMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide });
  const sunglassesGeom = new THREE.PlaneGeometry(140, 140);
  const sunglassesMesh = new THREE.Mesh(sunglassesGeom, sunglassesMat);
  sunglassesMesh.visible = false;
  scene.add(sunglassesMesh);
  filters['sunglasses'] = sunglassesMesh;

  // Create Cyberpunk visor mesh
  const cyberpunkMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide });
  const cyberpunkGeom = new THREE.PlaneGeometry(150, 150);
  const cyberpunkMesh = new THREE.Mesh(cyberpunkGeom, cyberpunkMat);
  cyberpunkMesh.visible = false;
  scene.add(cyberpunkMesh);
  filters['cyberpunk'] = cyberpunkMesh;

  // Create Flower Crown mesh
  const crownMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide });
  const crownGeom = new THREE.PlaneGeometry(200, 200);
  crownGeom.translate(0, 100, 0); // Shift upward by 100 units so the pivot is at the bottom center of the crown
  const crownMesh = new THREE.Mesh(crownGeom, crownMat);
  crownMesh.visible = false;
  scene.add(crownMesh);
  filters['flower_crown'] = crownMesh;

  // keep sizes for mapping
  videoWidth = width; videoHeight = height;
}

// ----- Chroma key transparency helper -----
function createTransparentTexture(url, removeColor = 'black') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      // Make colors close to black transparent
      if (removeColor === 'black') {
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2];
          // Chroma key threshold
          if (r < 40 && g < 40 && b < 40) {
            data[i+3] = 0;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      resolve(texture);
    };
    img.onerror = (e) => reject(e);
  });
}

// ----- Load all PNG assets as transparent textures -----
async function loadFilterTextures() {
  const assets = {
    sunglasses: 'assets/sunglasses.png',
    cyberpunk: 'assets/cyberpunk.png',
    flower_crown: 'assets/flower_crown.png'
  };

  try {
    const sunglassesTex = await createTransparentTexture(assets.sunglasses, 'black');
    filters['sunglasses'].material.map = sunglassesTex;
    filters['sunglasses'].material.needsUpdate = true;

    const cyberpunkTex = await createTransparentTexture(assets.cyberpunk, 'black');
    filters['cyberpunk'].material.map = cyberpunkTex;
    filters['cyberpunk'].material.needsUpdate = true;

    const crownTex = await createTransparentTexture(assets.flower_crown, 'black');
    filters['flower_crown'].material.map = crownTex;
    filters['flower_crown'].material.needsUpdate = true;
  } catch (e) {
    console.error('Failed to load filter textures:', e);
  }
}

// ----- FaceMesh setup -----
async function initFaceMesh() {
  const FaceMeshClass = window.FaceMesh || FaceMesh;
  if (!FaceMeshClass) {
    throw new Error('MediaPipe FaceMesh library not loaded. Please check network connection or script source.');
  }
  faceMesh = new FaceMeshClass({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });

  faceMesh.onResults(onResults);
}

// Called every time MediaPipe returns results
function onResults(results) {
  frames++;
  const now = performance.now();
  if (now - lastFpsUpdate >= 1000) {
    fpsEl.textContent = `FPS: ${frames}`;
    frames = 0; lastFpsUpdate = now;
  }

  // Always clear the debug canvas first so landmarks don't freeze when unchecked
  if (debugCanvas && debugCanvas.getContext) {
    const dctx = debugCanvas.getContext('2d');
    dctx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  }

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    for (const key in filters) {
      if (filters[key]) filters[key].visible = false;
    }
    renderer.clear();
    return;
  }

  const landmarks = results.multiFaceLandmarks[0];

  // Hide all filters by default, we will enable the selected one later
  for (const key in filters) {
    if (filters[key]) filters[key].visible = false;
  }

  // Select anchor landmark based on active filter
  // 168: Nose bridge (between eyes) - best for glasses
  // 10: Forehead top - best for flower crown
  let anchor = landmarks[168];
  if (currentFilter === 'flower_crown') {
    anchor = landmarks[10];
  }

  // Map normalized MediaPipe coordinates to centered pixel coordinates
  const px = (anchor.x - 0.5) * videoWidth;
  const py = -(anchor.y - 0.5) * videoHeight;
  const pz = (anchor.z || 0) * -600;

  // Use fixed landmarks for left eye (33) and right eye (263) to compute face width and rotation
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];

  // Map eyes to Three.js coordinates
  const lx = (leftEye.x - 0.5) * videoWidth;
  const rx = (rightEye.x - 0.5) * videoWidth;
  const ly = -(leftEye.y - 0.5) * videoHeight;
  const ry = -(rightEye.y - 0.5) * videoHeight;

  const dx = rx - lx;
  const dy = ry - ly;
  const faceWidth = Math.hypot(dx, dy);

  // Roll angle (direct angle to match the visual tilt)
  const angle = Math.atan2(dy, dx);

  // Apply smoothing (exponential moving average) to prevent jitter
  const targetPos = new THREE.Vector3(px, py, pz);
  
  // Custom scale factor (baseWidth) for different filters
  let baseWidth = 60; // 3D glasses default
  if (currentFilter === 'sunglasses') {
    baseWidth = 55;
  } else if (currentFilter === 'cyberpunk') {
    baseWidth = 55;
  } else if (currentFilter === 'flower_crown') {
    baseWidth = 65;
  }

  const targetScale = faceWidth / baseWidth;
  const alpha = 0.35; // smoothing factor
  smoothPos.lerp(targetPos, alpha);
  smoothRotZ = smoothRotZ * (1 - alpha) + angle * alpha;
  smoothScale = smoothScale * (1 - alpha) + targetScale * alpha;

  // Apply transforms to the active filter mesh
  const activeMesh = filters[currentFilter];
  if (activeMesh) {
    activeMesh.visible = true;
    activeMesh.position.copy(smoothPos);
    activeMesh.scale.set(smoothScale, smoothScale, smoothScale);
    activeMesh.rotation.set(0, 0, smoothRotZ);
  }

  renderer.render(scene, orthoCamera);

  // Draw debug landmarks if enabled
  if (chkDebug && chkDebug.checked && debugCanvas && debugCanvas.getContext) {
    if (debugCanvas.width !== (video.videoWidth || videoWidth) || debugCanvas.height !== (video.videoHeight || videoHeight)) {
      debugCanvas.width = video.videoWidth || videoWidth;
      debugCanvas.height = video.videoHeight || videoHeight;
    }
    const dctx = debugCanvas.getContext('2d');
    dctx.fillStyle = 'rgba(255,0,120,0.8)';
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      const x = p.x * debugCanvas.width;
      const y = p.y * debugCanvas.height;
      dctx.beginPath(); dctx.arc(x,y,1.6,0,Math.PI*2); dctx.fill();
    }
  }
}

// ----- Camera control (MediaPipe Camera util) -----
async function startCamera() {
  // initialize three with default or measured size
  initThree(640, 480);
  setStatus('Menginisialisasi FaceMesh...');
  await initFaceMesh();

  try {
    // Performance mode: reduce resolution and skip frames
    const perf = (chkPerf && chkPerf.checked);
    const useWidth = perf ? 320 : 640;
    const useHeight = perf ? 240 : 480;
    const skip = perf ? 2 : 1; // process every `skip` frames

    // recreate renderer with chosen size
    initThree(useWidth, useHeight);
    setStatus('Memuat aset filter...');
    await loadFilterTextures();

    // If modern API available, use MediaPipe Camera util which wraps getUserMedia
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      let frameCounter = 0;
      cameraUtils = new Camera(video, {
        onFrame: async () => {
          frameCounter++;
          if (frameCounter % skip === 0) {
            // feed frames to MediaPipe
            await faceMesh.send({ image: video });
          }
        },
        width: useWidth,
        height: useHeight,
      });
      await cameraUtils.start();
      setStatus('Camera aktif');
      enable(stopBtn, true); enable(captureBtn, true); enable(startBtn, false);
      return;
    }

    // Legacy fallback: try older getUserMedia implementations (webkit/moz)
    const legacyGet = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    if (!legacyGet) {
      console.error('No getUserMedia available. isSecureContext=', window.isSecureContext, 'protocol=', location.protocol);
      setStatus('Browser tidak mendukung camera API atau halaman tidak aman (HTTPS dibutuhkan).');
      return;
    }

    setStatus('Mencoba akses kamera (legacy API)...');
    const constraints = { video: { facingMode: 'user', width: useWidth, height: useHeight } };
    const getStreamLegacy = (c) => new Promise((resolve, reject) => {
      legacyGet.call(navigator, c, resolve, reject);
    });

    try {
      const stream = await getStreamLegacy(constraints);
      video.srcObject = stream;
      await video.play();

      // manual loop to feed frames to MediaPipe
      let rafId;
      let running = true;
      const frameLoop = async () => {
        if (!running) return;
        try { await faceMesh.send({ image: video }); } catch(e) { console.warn('faceMesh send error', e); }
        rafId = requestAnimationFrame(frameLoop);
      };
      frameLoop();

      cameraUtils = {
        stop: async () => {
          running = false;
          if (rafId) cancelAnimationFrame(rafId);
          stream.getTracks().forEach(t => t.stop());
        }
      };

      setStatus('Camera aktif (legacy)');
      enable(stopBtn, true); enable(captureBtn, true); enable(startBtn, false);
    } catch (err) {
      console.error('Legacy getUserMedia error', err);
      setStatus('Gagal mengakses kamera (legacy): ' + (err.message || err));
    }
  } catch (err) {
    console.error('Camera error', err);
    setStatus('Gagal mengakses kamera: ' + (err.message || err));
  }
}

async function stopCamera() {
  try {
    if (cameraUtils && cameraUtils.stop) await cameraUtils.stop();
    setStatus('Camera berhenti');
    enable(stopBtn, false); enable(captureBtn, false); enable(startBtn, true);
    for (const key in filters) {
      if (filters[key]) filters[key].visible = false;
    }
  } catch (err) {
    console.warn(err);
  }
}

// ----- Screenshot (merge video + three.js overlay) -----
function captureScreenshot() {
  const w = video.videoWidth || videoWidth;
  const h = video.videoHeight || videoHeight;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const ctx = tmp.getContext('2d');

  // draw mirrored video (mirror to match UX)
  ctx.save(); ctx.scale(-1,1); ctx.drawImage(video, -w, 0, w, h); ctx.restore();

  // draw three overlay (renderer.domElement) on top mirrored to match the mirrored video
  try {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(renderer.domElement, -w, 0, w, h);
    ctx.restore();
  } catch (e) {
    console.warn('Could not draw overlay canvas to output', e);
  }

  // show in modal
  captureCanvas.width = w; captureCanvas.height = h;
  const cctx = captureCanvas.getContext('2d');
  cctx.clearRect(0,0,w,h); cctx.drawImage(tmp,0,0);

  // backup original capture for non-destructive filter applications
  originalCanvas.width = w; originalCanvas.height = h;
  const octx = originalCanvas.getContext('2d');
  octx.clearRect(0,0,w,h); octx.drawImage(tmp,0,0);

  filterSelect.value = 'none'; // reset filter dropdown in modal
  downloadLink.href = tmp.toDataURL('image/png');
  captureModal.classList.remove('hidden');
  enable(applyFilterBtn, true);
}

// ----- OpenCV filters (post-capture) -----
function applyOpenCVFilter(type) {
  if (!window.cv || !cv || !cv.Mat) { alert('OpenCV.js belum siap. Tunggu beberapa detik dan coba lagi.'); return; }
  const src = cv.imread(originalCanvas);
  const dst = new cv.Mat();

  try {
    if (type === 'grayscale') {
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
      cv.cvtColor(dst, dst, cv.COLOR_GRAY2RGBA);
    } else if (type === 'canny') {
      let gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.Canny(gray, dst, 50, 150);
      cv.cvtColor(dst, dst, cv.COLOR_GRAY2RGBA);
      gray.delete();
    } else if (type === 'blur') {
      let ksize = new cv.Size(9,9);
      cv.GaussianBlur(src, dst, ksize, 0, 0, cv.BORDER_DEFAULT);
    } else {
      src.copyTo(dst);
    }

    cv.imshow(captureCanvas, dst);
    downloadLink.href = captureCanvas.toDataURL('image/png');
  } catch (err) {
    console.error('OpenCV error', err);
    alert('Terjadi error saat menerapkan filter: ' + err.message);
  } finally {
    src.delete(); dst.delete();
  }
}

// ----- UI wiring -----
startBtn.addEventListener('click', () => { setStatus('Memulai kamera...'); startCamera(); });
stopBtn.addEventListener('click', () => { stopCamera(); });
captureBtn.addEventListener('click', () => { captureScreenshot(); });
applyFilterBtn.addEventListener('click', () => { applyOpenCVFilter(filterSelect.value); });
closeModal.addEventListener('click', () => { captureModal.classList.add('hidden'); });

// close button may be absent if HTML is minimal — safe guard
if (closeModal) closeModal.addEventListener('click', () => captureModal.classList.add('hidden'));

if (filterSelect) {
  filterSelect.addEventListener('change', () => {
    applyOpenCVFilter(filterSelect.value);
  });
}

if (arFilterSelect) {
  arFilterSelect.addEventListener('change', (e) => {
    currentFilter = e.target.value;
  });
}

// initial UI state
setStatus('idle');

// expose for debugging (optional)
window._app = { startCamera, stopCamera, captureScreenshot };
