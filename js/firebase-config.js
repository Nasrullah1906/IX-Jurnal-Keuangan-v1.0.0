// /* ══════════════════════════════════════════════════════════
//    JURNAL KEUANGAN — firebase-config.js
//    ISI file ini dengan konfigurasi project Firebase KHUSUS
//    untuk aplikasi ini (project TERPISAH dari 2 aplikasi lainnya,
//    supaya login & data benar-benar independen).

//    Cara mendapatkan config:
//    1. https://console.firebase.google.com → Add project
//       → beri nama, misal "jurnalkeuangan"
//    2. Project settings (⚙️) → scroll ke "Your apps" → klik "</>"
//       → daftarkan app Web, JANGAN centang Firebase Hosting
//    3. Copy object "firebaseConfig", tempel di bawah ini
//    4. Authentication → Sign-in method → aktifkan "Email/Password"
//    5. Firestore Database → Create database → "Start in production
//       mode" → pilih lokasi terdekat (mis. asia-southeast2/Jakarta)
//    6. Tempel isi firestore.rules ke tab "Rules" Firestore → Publish
// ══════════════════════════════════════════════════════════ */

const firebaseConfig = {
  apiKey: "AIzaSyBaRhMTpqzP-yjGPmlxGQdui0J4LYW9V6Q",
  authDomain: "informatikxaujurnalkeuanagan.firebaseapp.com",
  projectId: "informatikxaujurnalkeuanagan",
  storageBucket: "informatikxaujurnalkeuanagan.firebasestorage.app",
  messagingSenderId: "469175370147",
  appId: "1:469175370147:web:407bf63e9607614d20da16",
  measurementId: "G-E1HZTKW7M0"
};
