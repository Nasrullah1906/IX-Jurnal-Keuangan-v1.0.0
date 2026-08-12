# Jurnal Pemasukan & Pengeluaran (PWA)

Versi aplikasi jurnal keuangan kamu yang bisa **dipasang di HP** (Android/iOS/Desktop) sebagai app, lengkap dengan **halaman Login/Daftar**, **kunci PIN 6-digit**, dan **halaman Pengaturan** — semua berjalan 100% di perangkat kamu sendiri (`localStorage`), tanpa server/backend.

## ✨ Fitur baru di versi ini

- **Daftar / Masuk** dengan nama, email & password (min. 8 karakter + angka), tersimpan lokal & di-hash (SHA-256 + salt) — tidak pernah disimpan sebagai teks polos.
- **Kunci PIN 6-digit** opsional. Bisa diatur aktif/nonaktif, dan toggle "minta PIN saat buka app".
- **Pengaturan lengkap**: edit profil (nama, email, foto), ubah password, atur/ubah PIN, mode gelap/terang, haptic feedback, ekspor & impor data jurnal (JSON), hapus semua data, hapus akun.
- Fitur jurnal aslinya **tetap sama persis**: Jurnal Harian, Ringkasan Mingguan, Ringkasan Bulanan, tren saldo, dan **Unduh Excel**.
- **Bisa dipasang sebagai aplikasi (PWA)** — jalan offline setelah pertama dibuka.
- 100% front-end. Tidak ada data yang dikirim ke server manapun.

## ⚠️ Catatan penting soal akun

- Aplikasi ini **satu akun per perangkat/browser** (bukan multi-user, tidak ada sinkronisasi cloud). Cocok untuk pemakaian pribadi.
- Kalau kamu hapus data browser / ganti HP, akun & datanya **tidak ikut pindah**. Gunakan **Ekspor JSON** di Pengaturan → Kelola Data secara rutin sebagai cadangan.
- Lupa password = tidak bisa direset (tidak ada server email). Solusinya hanya hapus data situs di browser dan mulai ulang (data lama hilang).

## 📁 Struktur proyek

```
jurnal-keuangan-app/
├── index.html         # login, PIN, jurnal, pengaturan — semua halaman
├── manifest.json       # manifest PWA
├── sw.js                 # service worker (cache offline + update otomatis)
├── favicon.ico
├── css/style.css          # semua styling (tema emas asli + varian terang)
├── js/app.js               # semua logika: auth, PIN, pengaturan, jurnal
├── js/pwa.js                 # registrasi service worker + tombol pasang
└── icons/                      # ikon PWA (192, 512, maskable, apple-touch, favicon)
```

## 🚀 Menjalankan secara lokal (wajib untuk tes PWA)

PWA butuh dilayani lewat HTTP (bukan dibuka langsung sebagai file `file://`), karena service worker tidak jalan di protokol file.

```bash
python3 -m http.server 8080
# atau
npx serve .
```
Lalu buka `http://localhost:8080` di browser.

## 🌐 Cara pasang di HP (deploy dulu ke internet)

Supaya bisa "Install ke Layar Utama" di HP, file-file ini perlu di-hosting (https), misalnya gratis lewat **GitHub Pages**:

1. Buat repo baru di GitHub, upload semua file di folder ini (pertahankan struktur foldernya).
2. Buka **Settings → Pages** di repo tsb.
3. Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. Tunggu beberapa menit, situs aktif di `https://<username>.github.io/<nama-repo>/`.
5. Buka link itu di HP:
   - **Android/Chrome:** ketuk banner "Pasang" di atas, atau menu ⋮ → "Add to Home screen".
   - **iPhone/Safari:** tombol Share (kotak dengan panah ke atas) → **"Add to Home Screen"**.

Setelah dipasang, aplikasi akan muncul seperti app biasa di HP kamu dan tetap bisa dipakai offline.

## 🔄 Update aplikasi nanti

Kalau kamu edit lagi file `css/`, `js/`, atau `index.html`, naikkan `CACHE_VERSION` di `sw.js` supaya pengguna lama otomatis dapat versi terbaru (akan muncul banner "Versi baru tersedia" di app).
