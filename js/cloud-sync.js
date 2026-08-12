/* ══════════════════════════════════════════════════════════
   JURNAL KEUANGAN — cloud-sync.js
   Menambahkan sinkronisasi otomatis antar perangkat via Firebase
   (Authentication + Firestore), memakai jembatan window.JKApp
   yang diekspos dari app.js — TANPA mengubah logika jurnal
   yang sudah ada.

   Model aplikasi ini "satu akun per perangkat" (lihat app.js
   original). Dengan cloud-sync, model itu tetap sama secara
   tampilan, tapi identitasnya sekarang tervalidasi ke Firebase
   Auth, dan datanya (profil + jurnal) disinkron ke Firestore
   koleksi "jurnalkeuangan_users" — tetap bisa dipakai offline
   (Firestore offline persistence aktif).
══════════════════════════════════════════════════════════ */

(function () {
  if (typeof firebase === "undefined") {
    console.warn("Firebase SDK belum dimuat — cek urutan <script> di index.html");
    return;
  }
  if (typeof window.JKApp === "undefined") {
    console.warn("window.JKApp belum tersedia — cek urutan <script>, app.js harus dimuat SEBELUM cloud-sync.js");
    return;
  }
  const JK = window.JKApp;

  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    console.warn("Firestore offline persistence tidak aktif:", err.code);
  });

  let currentUid = null;
  let applyingRemote = false;
  let unsubProfile = null;
  let unsubData = null;
  const pendingWrites = {};

  function profileRef(uid) { return db.collection("jurnalkeuangan_users").doc(uid); }
  function dataRef(uid) { return db.collection("jurnalkeuangan_users").doc(uid).collection("data").doc("state"); }

  function translateAuthError(code) {
    const map = {
      "auth/email-already-in-use": "Email sudah terdaftar. Silakan masuk.",
      "auth/invalid-email": "Format email tidak valid.",
      "auth/weak-password": "Password terlalu lemah (minimal 6 karakter).",
      "auth/user-not-found": "Akun tidak ditemukan. Silakan daftar dahulu.",
      "auth/wrong-password": "Password salah. Coba lagi.",
      "auth/invalid-credential": "Email atau password salah.",
      "auth/invalid-login-credentials": "Email atau password salah.",
      "auth/user-disabled": "Akun ini telah dinonaktifkan.",
      "auth/missing-password": "Password wajib diisi.",
      "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
      "auth/network-request-failed": "Tidak ada koneksi internet. Periksa jaringan kamu.",
      "auth/requires-recent-login": "Sesi kamu sudah lama, silakan masuk ulang lalu coba lagi."
    };
    return map[code] || "Terjadi kesalahan. Coba lagi.";
  }

  /* ══════════════════════════════════════
     INTERCEPT localStorage.setItem
  ══════════════════════════════════════ */
  const originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (applyingRemote || !currentUid) return;

    if (key === JK.LS_ACCOUNT) {
      queuePush("profile", () => {
        const acc = JK.getAccount();
        if (acc) return profileRef(currentUid).set(acc, { merge: true });
      });
    } else if (key === JK.LS_STATE) {
      queuePush("state", () => dataRef(currentUid).set(JK.getState()));
    }
  };

  function queuePush(tag, fn) {
    clearTimeout(pendingWrites[tag]?.timer);
    pendingWrites[tag] = { fn, timer: setTimeout(() => runPush(tag), 350) };
  }
  function runPush(tag) {
    const entry = pendingWrites[tag];
    if (!entry) return;
    clearTimeout(entry.timer);
    delete pendingWrites[tag];
    entry.fn()?.catch((err) => console.warn("Gagal sinkron (" + tag + "):", err.message));
  }
  function flushAllPending() { Object.keys(pendingWrites).forEach(runPush); }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAllPending();
  });
  window.addEventListener("pagehide", flushAllPending);
  window.addEventListener("beforeunload", flushAllPending);

  /* ══════════════════════════════════════
     REALTIME LISTENERS
  ══════════════════════════════════════ */
  function attachRealtimeListeners(uid) {
    detachRealtimeListeners();
    unsubProfile = profileRef(uid).onSnapshot((doc) => {
      if (!doc.exists) return;
      applyingRemote = true;
      JK.setAccount(doc.data());
      JK.saveAccount();
      applyingRemote = false;
      JK.refreshUI();
    });
    unsubData = dataRef(uid).onSnapshot((doc) => {
      if (!doc.exists) return;
      applyingRemote = true;
      JK.setState(doc.data());
      JK.saveState();
      applyingRemote = false;
      JK.refreshUI();
    });
  }
  function detachRealtimeListeners() {
    if (unsubProfile) { unsubProfile(); unsubProfile = null; }
    if (unsubData) { unsubData(); unsubData = null; }
  }

  /* ══════════════════════════════════════
     REGISTER
  ══════════════════════════════════════ */
  window.doRegister = function () {
    JK.hideMsg("reg-error"); JK.hideMsg("reg-success");
    const nama = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim().toLowerCase();
    const pass = document.getElementById("reg-password").value;
    const confirm = document.getElementById("reg-confirm").value;

    if (!nama) return JK.showMsg("reg-error", "Nama lengkap wajib diisi.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return JK.showMsg("reg-error", "Format email tidak valid.");
    if (pass.length < 8 || !/\d/.test(pass)) return JK.showMsg("reg-error", "Password minimal 8 karakter dan mengandung angka.");
    if (pass !== confirm) return JK.showMsg("reg-error", "Konfirmasi password tidak cocok.");

    // Kalau perangkat ini sebelumnya sudah punya akun lokal dengan
    // email yang sama (sebelum update cloud), datanya ikut terangkat.
    const legacyAccount = JK.getAccount();
    const legacyMatch = legacyAccount && legacyAccount.email === email;
    const legacyState = legacyMatch ? JK.getState() : { saldoAwal: 0, categories: undefined, entries: [] };

    auth.createUserWithEmailAndPassword(email, pass)
      .then(async (cred) => {
        const uid = cred.user.uid;
        const profile = {
          nama, email,
          pinHash: legacyMatch ? legacyAccount.pinHash : null,
          pinSalt: legacyMatch ? legacyAccount.pinSalt : null,
          pinEnabled: legacyMatch ? !!legacyAccount.pinEnabled : false,
          pinOnOpen: legacyMatch ? legacyAccount.pinOnOpen !== false : true,
          foto: legacyMatch ? legacyAccount.foto : null,
          haptic: legacyMatch ? legacyAccount.haptic !== false : true,
          theme: legacyMatch ? (legacyAccount.theme || "dark") : "dark",
          currency: legacyMatch ? (legacyAccount.currency || "IDR") : "IDR",
          exchangeRate: legacyMatch ? (legacyAccount.exchangeRate || 17800) : 17800,
          createdAt: legacyMatch ? legacyAccount.createdAt : Date.now()
        };
        const initialState = legacyMatch ? legacyState : { saldoAwal: 0, categories: undefined, entries: [] };
        await profileRef(uid).set(profile, { merge: true });
        await dataRef(uid).set(initialState);

        JK.showMsg("reg-success", legacyMatch
          ? "Akun berhasil dibuat & data lama di perangkat ini otomatis disinkronkan!"
          : "Akun berhasil dibuat! Selamat datang.");

        currentUid = uid;
        applyingRemote = true;
        JK.setAccount(profile);
        JK.saveAccount();
        JK.setState(initialState);
        JK.saveState();
        applyingRemote = false;

        JK.setLoggedIn(true);
        attachRealtimeListeners(uid);
        setTimeout(() => JK.enterApp(), 400);
      })
      .catch((err) => JK.showMsg("reg-error", translateAuthError(err.code)));
  };

  /* ══════════════════════════════════════
     LOGIN
  ══════════════════════════════════════ */
  window.doLogin = function () {
    JK.hideMsg("login-error"); JK.hideMsg("login-success");
    const email = document.getElementById("login-email").value.trim().toLowerCase();
    const pass = document.getElementById("login-password").value;
    if (!email || !pass) return JK.showMsg("login-error", "Email dan password wajib diisi.");

    auth.signInWithEmailAndPassword(email, pass)
      .then(async (cred) => {
        const uid = cred.user.uid;
        currentUid = uid;

        const profileSnap = await profileRef(uid).get();
        const dataSnap = await dataRef(uid).get();
        const profile = profileSnap.exists ? profileSnap.data() : { nama: email, email, pinEnabled: false };
        const dataState = dataSnap.exists ? dataSnap.data() : { saldoAwal: 0, categories: undefined, entries: [] };

        applyingRemote = true;
        JK.setAccount(profile);
        JK.saveAccount();
        JK.setState(dataState);
        JK.saveState();
        applyingRemote = false;

        JK.setLoggedIn(true);
        attachRealtimeListeners(uid);
        JK.enterApp();
      })
      .catch((err) => JK.showMsg("login-error", translateAuthError(err.code)));
  };

  /* ══════════════════════════════════════
     LOGOUT
  ══════════════════════════════════════ */
  window.doLogout = function () {
    if (!confirm("Keluar dari aplikasi?")) return;
    detachRealtimeListeners();
    currentUid = null;
    auth.signOut().finally(() => {
      JK.setLoggedIn(false);
      JK.showLoginPage();
      JK.switchLoginTab("login");
      document.getElementById("login-email").value = "";
      document.getElementById("login-password").value = "";
    });
  };

  /* ══════════════════════════════════════
     UBAH PASSWORD
  ══════════════════════════════════════ */
  window.savePassword = async function () {
    const acc = JK.getAccount();
    if (!acc) return;
    const old = document.getElementById("pw-old").value;
    const nw = document.getElementById("pw-new").value;
    const cnf = document.getElementById("pw-confirm").value;
    const errEl = document.getElementById("pw-error");
    function err(m) { if (errEl) { errEl.textContent = m; errEl.style.display = "block"; } else alert(m); }

    if (nw.length < 8 || !/\d/.test(nw)) return err("Password baru minimal 8 karakter dan mengandung angka.");
    if (nw !== cnf) return err("Konfirmasi password tidak cocok.");

    const user = auth.currentUser;
    if (!user) return err("Sesi berakhir, silakan masuk ulang.");
    const cred = firebase.auth.EmailAuthProvider.credential(acc.email, old);

    try {
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(nw);
      JK.closeModal("modal-password");
      alert("✅ Password berhasil diubah.");
    } catch (fbErr) {
      err(translateAuthError(fbErr.code));
    }
  };

  /* ══════════════════════════════════════
     HAPUS AKUN
  ══════════════════════════════════════ */
  window.confirmDeleteAccount = async function () {
    const acc = JK.getAccount();
    if (!acc) return;
    const passInput = document.getElementById("del-acc-password");
    const pass = passInput ? passInput.value : "";
    const user = auth.currentUser;
    if (!user) { alert("Sesi berakhir, silakan masuk ulang."); return; }
    const cred = firebase.auth.EmailAuthProvider.credential(acc.email, pass);

    try {
      await user.reauthenticateWithCredential(cred);
      const uid = user.uid;
      await dataRef(uid).delete().catch(() => {});
      await profileRef(uid).delete().catch(() => {});
      await user.delete();

      detachRealtimeListeners();
      currentUid = null;
      applyingRemote = true;
      localStorage.removeItem(JK.LS_ACCOUNT);
      localStorage.removeItem(JK.LS_STATE);
      localStorage.removeItem(JK.LS_LOGGEDIN);
      applyingRemote = false;
      JK.closeModal("modal-delete-account");
      JK.showLoginPage();
      JK.switchLoginTab("register");
    } catch (fbErr) {
      alert(translateAuthError(fbErr.code));
    }
  };

  /* ══════════════════════════════════════
     Pulihkan sesi saat app dibuka ulang
  ══════════════════════════════════════ */
  auth.onAuthStateChanged((user) => {
    if (user) {
      currentUid = user.uid;
      const acc = JK.getAccount();
      if (acc && acc.email === user.email && JK.isLoggedIn()) {
        attachRealtimeListeners(user.uid);
      }
    }
  });

  /* ══════════════════════════════════════
     PENTING: app.js memasang klik tombol Daftar/Masuk/dst langsung
     ke fungsi lokal di dalam closure-nya sendiri lewat
     addEventListener(..., doLogin) — BUKAN lewat window.doLogin.
     Jadi menimpa window.doLogin/doRegister/dst saja TIDAK CUKUP;
     listener lamanya perlu "dicabut" dulu (dengan clone node, cara
     paling aman untuk melepas semua listener lama), baru dipasang
     listener baru yang memanggil versi cloud kita.
     Dijalankan setelah app.js selesai bind (DOMContentLoaded
     terdaftar belakangan → dipanggil setelah punya app.js).
  ══════════════════════════════════════ */
  document.addEventListener("DOMContentLoaded", () => {
    const rebind = (id, handler) => {
      const old = document.getElementById(id);
      if (!old) return;
      const fresh = old.cloneNode(true);
      old.parentNode.replaceChild(fresh, old);
      fresh.addEventListener("click", handler);
    };
    rebind("btnDoRegister", window.doRegister);
    rebind("btnDoLogin", window.doLogin);
    rebind("btnLogout", window.doLogout);
    rebind("btnSavePassword", window.savePassword);
    rebind("btnConfirmDeleteAccount", window.confirmDeleteAccount);
  });
})();
