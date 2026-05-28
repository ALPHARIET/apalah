# WebAR Face Filter — Tugas Grafika Komputer

Project sederhana WebAR (face filter) yang berjalan pada browser mobile tanpa backend. Menggunakan:
- HTML / CSS / JavaScript (vanilla)
- MediaPipe FaceMesh (face tracking)
- Three.js (render objek 3D overlay)
- OpenCV.js (filter pasca-capture)

Tujuan: Demo filter wajah realtime (kacamata/mahkota/topeng) yang bisa dijalankan di browser HP Android dan di-host di GitHub Pages / Vercel.

---

Struktur folder
```
apalah/
├─ index.html            # entry point
├─ README.md             # dokumentasi ini
├─ styles/
│  └─ styles.css         # styling responsive
└─ src/
   └─ main.js           # logika kamera, mediapipe, three.js, opencv hooks
```

Penjelasan singkat tiap file
- `index.html`: UI sederhana, video input (hidden), container untuk Three.js, modal capture.
- `styles/styles.css`: gaya mobile-first, tata letak viewer + controls.
- `src/main.js`: inisialisasi FaceMesh, Camera util, Three.js scene dengan objek 3D (kacamata sederhana), fungsi screenshot dan integrasi OpenCV.js.

Langkah instalasi & menjalankan (lokal)
1. Buka terminal di folder `apalah`.
2. Karena proyek menggunakan kamera, jalankan server lokal (tidak boleh langsung buka file):

```bash
# opsi 1: Python 3
python -m http.server 8000

# opsi 2: menggunakan Node (http-server)
npx http-server -c-1 .
```

3. Buka `http://localhost:8000` di browser desktop untuk pengembangan.
4. Untuk testing HP, pastikan server dapat diakses dari jaringan (gunakan IP komputer, mis. `http://192.168.1.5:8000`) atau deploy ke GitHub Pages / Vercel.

Catatan: Browser mobile butuh HTTPS untuk akses kamera di domain publik. Untuk demo lokal, gunakan jaringan lokal (IP) atau deploy ke HTTPS host.

Integrasi MediaPipe + Three.js (ringkasan teknis)
- MediaPipe FaceMesh menerima frame video dan mengirimkan daftar landmark (468 titik) dengan koordinat normalisasi (`x,y,z`).
- Kita ambil centroid (rata-rata) dan titik ter-kiri/ter-kanan untuk memperkirakan posisi, skala, dan rotasi wajah.
- Three.js menggunakan kamera ortografis yang dipetakan ke ukuran video sehingga koordinat mudah dikonversi:
  - px = (centroid.x - 0.5) * videoWidth
  - py = -(centroid.y - 0.5) * videoHeight
  - rotZ = atan2(-dy, dx) (dy/dx antara titik kiri/kanan)
- Dengan transform ini objek 3D (grup kacamata) diposisikan, di-scale, dan di-rotate sehingga mengikuti wajah.

Menempelkan objek 3D ke wajah (konsep)
1. Buat model 3D ringan (bisa geometry Three.js sederhana: torus/box untuk kacamata).
2. Tempatkan model pada `Group` dan di-scale agar lebar dasar sesuai perkiraan lebar wajah.
3. Di setiap hasil FaceMesh, hitung transform (posisi/rotasi/scale) dan terapkan ke `Group`.

Menambahkan OpenCV.js
- OpenCV.js dimuat via CDN di `index.html` (async). Setelah runtime siap (cv), fungsi di `src/main.js` menggunakan `cv.imread()` dan `cv.imshow()` untuk memproses `captureCanvas`.
- Implementasi saat ini: filter pasca-capture (grayscale, Canny, Gaussian blur) agar ringan dan mudah dijelaskan.

Deploy ke GitHub Pages
1. Buat repository GitHub dan push folder `apalah` (atau isi folder ke repo).
2. Di settings repo -> Pages, pilih branch `main` (atau `gh-pages`) dan folder root `/` untuk publikasi.
3. Tunggu beberapa menit, buka URL Pages (HTTPS) di HP untuk testing.

Deploy ke Vercel
1. Login ke vercel.com, import project dari GitHub.
2. Default build setting untuk static sites tidak diperlukan; Vercel akan deploy folder statis.
3. Buka domain Vercel (HTTPS) dari HP.

Testing di HP Android
- Pastikan site reachable via HTTPS (GitHub Pages / Vercel) atau server lokal reachable via IP (developer mode).
- Buka URL di Chrome Android, ijinkan akses kamera ketika diminta.
- Tekan `Start Camera`, tunggu tracking, coba `Screenshot` lalu `Apply Filter`.

Tips presentasi & best practice
- Jelaskan alur: capture frame -> FaceMesh -> landmark -> transform -> Three.js render.
- Tunjukkan kode kunci di `src/main.js` (fungsi `onResults()` dan mapping koordinat).
- Sebutkan optimasi ringan: gunakan geometry sederhana, `preserveDrawingBuffer` hanya saat perlu, batasi `maxNumFaces` ke 1.
- Error handling: cek `navigator.mediaDevices`, tangani kegagalan `getUserMedia`, fallback ke gambar statis bila perlu.

Langkah selanjutnya (Tahap yang sudah direncanakan):
1. Setup project dan kamera (selesai — file scaffold)
2. Integrasi MediaPipe FaceMesh (kode sudah di `src/main.js` — perlu pengujian di device)
3. Integrasi Three.js (sudah, model kacamata sederhana)
4. Penempelan objek 3D ke wajah (di `onResults` mapping dilakukan)
5. Integrasi OpenCV.js (filter post-capture disediakan)
6. Screenshot/capture (sudah diimplementasi)
7. Optimasi mobile (next: mengurangi geometry, tuning fps)
8. Deploy online (README di atas menjelaskan langkah)

Jika Anda ingin, saya bisa:
- Menjalankan langkah pengujian (Tahap 2) dan men-tweak mapping landmark -> transform.
- Mengganti kacamata sederhana dengan model `.glb` kecil (butuh menambah file model).
- Menambahkan opsi mirror/flip dan pengaturan performa (resolution / skip frames).
