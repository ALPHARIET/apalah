// src/main.js
// WebAR Face Filter (vanilla JS)
// Integrates: MediaPipe FaceMesh (face tracking), Three.js (3D render), OpenCV.js (post-capture filters)

import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { FaceMesh } from 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js';
import { Camera } from 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';

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

  // keep sizes for mapping
  videoWidth = width; videoHeight = height;
}

// ----- FaceMesh setup -----
async function initFaceMesh() {
  faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
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

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    glassesGroup.visible = false;
    renderer.clear();
    // clear debug canvas
    if (debugCanvas && debugCanvas.getContext) {
      const dctx = debugCanvas.getContext('2d');
      dctx.clearRect(0,0,debugCanvas.width, debugCanvas.height);
    }
    return;
  }

  const landmarks = results.multiFaceLandmarks[0];

  // compute centroid
  let cx = 0, cy = 0, cz = 0;
  for (const p of landmarks) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= landmarks.length; cy /= landmarks.length; cz /= landmarks.length;

  // find leftmost & rightmost landmark to estimate face width and roll
  let left = landmarks[0], right = landmarks[0];
  for (const p of landmarks) {
    if (p.x < left.x) left = p;
    if (p.x > right.x) right = p;
  }

  // map normalized mediapipe coords to three.js centered pixel coords
  const px = (cx - 0.5) * videoWidth; // x: left->right
  const py = -(cy - 0.5) * videoHeight; // invert y

  const dx = (right.x - left.x) * videoWidth;
  const dy = (right.y - left.y) * videoHeight;
  const faceWidth = Math.hypot(dx, dy);
  const angle = Math.atan2(-dy, dx); // roll

  // apply transform to glasses group
  glassesGroup.visible = true;
  // apply smoothing (exponential) for stable demo
  const targetPos = new THREE.Vector3(px, py, (cz || 0) * -600);
  const baseWidth = 100; // base width of model in pixels
  const targetScale = faceWidth / baseWidth;
  const alpha = 0.35; // smoothing factor (0..1)
  smoothPos.lerp(targetPos, alpha);
  smoothRotZ = smoothRotZ * (1 - alpha) + angle * alpha;
  smoothScale = smoothScale * (1 - alpha) + targetScale * alpha;

  glassesGroup.position.copy(smoothPos);
  glassesGroup.scale.set(smoothScale, smoothScale, smoothScale);
  glassesGroup.rotation.set(0, 0, smoothRotZ);

  renderer.render(scene, orthoCamera);

  // draw debug landmarks if enabled
  if (chkDebug && chkDebug.checked && debugCanvas && debugCanvas.getContext) {
    debugCanvas.width = video.videoWidth || videoWidth;
    debugCanvas.height = video.videoHeight || videoHeight;
    const dctx = debugCanvas.getContext('2d');
    dctx.clearRect(0,0,debugCanvas.width, debugCanvas.height);
    dctx.save();
    dctx.scale(-1,1); // mirror
    dctx.translate(-debugCanvas.width,0);
    dctx.fillStyle = 'rgba(255,0,120,0.8)';
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      const x = p.x * debugCanvas.width;
      const y = p.y * debugCanvas.height;
      dctx.beginPath(); dctx.arc(x,y,1.6,0,Math.PI*2); dctx.fill();
    }
    dctx.restore();
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
    glassesGroup.visible = false;
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

  // draw three overlay (renderer.domElement) on top
  try {
    ctx.drawImage(renderer.domElement, 0, 0, w, h);
  } catch (e) {
    console.warn('Could not draw overlay canvas to output', e);
  }

  // show in modal
  captureCanvas.width = w; captureCanvas.height = h;
  const cctx = captureCanvas.getContext('2d');
  cctx.clearRect(0,0,w,h); cctx.drawImage(tmp,0,0);
  downloadLink.href = tmp.toDataURL('image/png');
  captureModal.classList.remove('hidden');
  enable(applyFilterBtn, true);
}

// ----- OpenCV filters (post-capture) -----
function applyOpenCVFilter(type) {
  if (!window.cv || !cv || !cv.Mat) { alert('OpenCV.js belum siap. Tunggu beberapa detik dan coba lagi.'); return; }
  const src = cv.imread(captureCanvas);
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

// initial UI state
setStatus('idle');

// expose for debugging (optional)
window._app = { startCamera, stopCamera, captureScreenshot };
