/* ============================================================
   Jurnal Pemasukan & Pengeluaran — app.js
   Auth lokal + PIN + Pengaturan + Jurnal Keuangan
   Semua data tersimpan di localStorage perangkat. Tidak ada server.
   ============================================================ */
(function(){
  "use strict";

  const DEFAULT_CATEGORIES = ["Kiriman Ortu","Transport","Makan","Invest BTC","Lainnya (Masuk)","Lainnya (Keluar)"];
  const CAT_COLORS = ["#9aa3b2","#93b06a","#c1655a","#6f9c98","#a5709a","#7f8fbf"];

  const ICON_EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a21.27 21.27 0 015.06-6.06M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 7 11 7a21.27 21.27 0 01-2.16 3.19M14.12 14.12a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  const LS_ACCOUNT = "jurnalapp:account";
  const LS_LOGGEDIN = "jurnalapp:loggedin";
  const LS_STATE = "jurnalapp:state";

  /* ---------------- account / auth ----------------
     Login (email/password) persisted across app restarts via localStorage
     (khas aplikasi keuangan personal di 1 perangkat). PIN, jika aktif,
     jadi gerbang cepat setiap aplikasi dibuka ulang — dicek setiap boot. */
  let account = null;      // {nama, email, passHash, passSalt, pinHash, pinSalt, pinEnabled, pinOnOpen, foto, haptic, theme}

  let state = {
    saldoAwal: 0,
    categories: DEFAULT_CATEGORIES.slice(),
    entries: []
  };
  let editingId = null;
  let deleteConfirmId = null;
  let pinBuffer = "";
  let pinSetupBuffer = "";
  let pinSetupStage = "first"; // first -> confirm
  let pinSetupFirst = "";
  let selectedAssetKategoriDummy = null; // unused placeholder (kept for structural parity)

  /* ---------------- crypto helpers ---------------- */
  function randomSalt(){
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b=>b.toString(16).padStart(2,"0")).join("");
  }
  async function hashWithSalt(text, salt){
    const enc = new TextEncoder().encode(salt + ":" + text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
  }

  /* ---------------- storage ---------------- */
  function loadAccount(){
    try{
      const raw = localStorage.getItem(LS_ACCOUNT);
      account = raw ? JSON.parse(raw) : null;
    }catch(err){ account = null; }
  }
  function saveAccount(){
    localStorage.setItem(LS_ACCOUNT, JSON.stringify(account));
  }
  function isLoggedIn(){ return localStorage.getItem(LS_LOGGEDIN) === "1"; }
  function setLoggedIn(v){
    if(v) localStorage.setItem(LS_LOGGEDIN, "1");
    else localStorage.removeItem(LS_LOGGEDIN);
  }
  function loadState(){
    try{
      const raw = localStorage.getItem(LS_STATE);
      if(raw){ state = Object.assign(state, JSON.parse(raw)); }
    }catch(err){ /* mulai baru */ }
  }
  let saveTimer = null;
  function saveState(){
    clearTimeout(saveTimer);
    saveTimer = setTimeout(()=>{
      localStorage.setItem(LS_STATE, JSON.stringify(state));
    }, 200);
  }

  /* ---------------- date & format helpers ---------------- */
  function toDate(iso){ const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d); }
  function toISO(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  function fmtID(d){ return String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+d.getFullYear(); }
  function fmtMonthID(d){ return d.toLocaleDateString("id-ID",{month:"long", year:"numeric"}); }
  function getMonday(d){
    const nd = new Date(d);
    const day = nd.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    nd.setDate(nd.getDate()+diff);
    nd.setHours(0,0,0,0);
    return nd;
  }
  function addDays(d,n){ const nd = new Date(d); nd.setDate(nd.getDate()+n); return nd; }
  function addMonths(d,n){ const nd = new Date(d); nd.setMonth(nd.getMonth()+n); return nd; }
  function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
  function todayDate(){ const t = new Date(); t.setHours(0,0,0,0); return t; }
  function rp(n){
    n = Number(n) || 0;
    if(account && account.currency === "USD"){
      const rate = Number(account.exchangeRate) || 17800;
      const usd = n / rate;
      const sign = usd < 0 ? "-" : "";
      return sign + "$" + Math.abs(usd).toLocaleString("en-US",{minimumFractionDigits:2, maximumFractionDigits:2});
    }
    n = Math.round(n);
    return "Rp " + n.toLocaleString("id-ID");
  }
  function rpCompact(n){
    n = Number(n) || 0;
    const isUSD = account && account.currency === "USD";
    if(isUSD){
      const rate = Number(account.exchangeRate) || 17800;
      n = n / rate;
    }
    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n);
    let val = abs, suffix = "";
    if(abs >= 1000000000){ val = abs/1000000000; suffix = "M"; }
    else if(abs >= 1000000){ val = abs/1000000; suffix = "Jt"; }
    else if(abs >= 1000){ val = abs/1000; suffix = "rb"; }
    val = Math.round(val*10)/10;
    const prefix = isUSD ? "$" : "Rp ";
    return sign + prefix + val.toLocaleString("id-ID") + suffix;
  }
  function niceMaxValue(n){
    if(!n || n <= 0) return 1;
    const exp = Math.floor(Math.log10(n));
    const base = Math.pow(10, exp);
    const frac = n / base;
    let niceFrac;
    if(frac <= 1) niceFrac = 1;
    else if(frac <= 2) niceFrac = 2;
    else if(frac <= 5) niceFrac = 5;
    else niceFrac = 10;
    return niceFrac * base;
  }
  function catColor(cat){
    const idx = state.categories.indexOf(cat);
    return CAT_COLORS[(idx < 0 ? 0 : idx) % CAT_COLORS.length];
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function initials(name){
    if(!name) return "?";
    return name.trim().split(/\s+/).slice(0,2).map(w=>w[0].toUpperCase()).join("");
  }

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(msg){
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> el.classList.remove("show"), 2200);
  }

  /* ---------------- haptic ---------------- */
  function haptic(ms){
    if(account && account.haptic && navigator.vibrate){ navigator.vibrate(ms||12); }
  }

  /* ---------------- derived journal data ---------------- */
  function sortedEntries(){
    return state.entries.slice().sort((a,b)=>{
      if(a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? -1 : 1;
      return a.order - b.order;
    });
  }
  function computeRunning(){
    const rows = sortedEntries();
    let saldo = Number(state.saldoAwal) || 0;
    return rows.map((e,i)=>{
      saldo += (Number(e.pemasukan)||0) - (Number(e.pengeluaran)||0);
      return Object.assign({}, e, {no:i+1, saldo});
    });
  }
  function computeWeekly(rows){
    if(rows.length === 0) return [];
    const firstMonday = getMonday(toDate(rows[0].tanggal));
    const lastEntryMonday = getMonday(toDate(rows[rows.length-1].tanggal));
    const currentMonday = getMonday(todayDate());
    const lastMonday = lastEntryMonday > currentMonday ? lastEntryMonday : currentMonday;
    const weeks = [];
    let cursor = new Date(firstMonday);
    let idx = 1;
    let saldoAcc = Number(state.saldoAwal) || 0;
    while(cursor <= lastMonday){
      const weekEnd = addDays(cursor, 6);
      const weekEndISO = toISO(weekEnd);
      const weekStartISO = toISO(cursor);
      let masuk = 0, keluar = 0;
      rows.forEach(r=>{
        if(r.tanggal >= weekStartISO && r.tanggal <= weekEndISO){
          masuk += Number(r.pemasukan)||0;
          keluar += Number(r.pengeluaran)||0;
        }
      });
      saldoAcc += masuk - keluar;
      weeks.push({ke:idx, awal:new Date(cursor), akhir:weekEnd, masuk, keluar, selisih:masuk-keluar, saldo:saldoAcc});
      cursor = addDays(cursor,7);
      idx++;
    }
    return weeks;
  }
  function computeMonthly(rows){
    if(rows.length === 0) return [];
    const firstMonth = startOfMonth(toDate(rows[0].tanggal));
    const lastEntryMonth = startOfMonth(toDate(rows[rows.length-1].tanggal));
    const currentMonth = startOfMonth(todayDate());
    const lastMonth = lastEntryMonth > currentMonth ? lastEntryMonth : currentMonth;
    const months = [];
    let cursor = new Date(firstMonth);
    let idx = 1;
    let saldoAcc = Number(state.saldoAwal) || 0;
    while(cursor <= lastMonth){
      const nextMonth = addMonths(cursor,1);
      const curISO = toISO(cursor), nextISO = toISO(nextMonth);
      let masuk=0, keluar=0;
      rows.forEach(r=>{
        if(r.tanggal >= curISO && r.tanggal < nextISO){
          masuk += Number(r.pemasukan)||0;
          keluar += Number(r.pengeluaran)||0;
        }
      });
      saldoAcc += masuk - keluar;
      months.push({ke:idx, bulan:new Date(cursor), masuk, keluar, selisih:masuk-keluar, saldo:saldoAcc});
      cursor = nextMonth;
      idx++;
    }
    return months;
  }

  /* ---------------- rendering: journal ---------------- */
  function renderCategoryOptions(){
    const sel = document.getElementById("fKategori");
    sel.innerHTML = "";
    state.categories.forEach(c=>{
      const opt = document.createElement("option");
      opt.value = c; opt.textContent = c;
      sel.appendChild(opt);
    });
    const optAdd = document.createElement("option");
    optAdd.value = "__add__"; optAdd.textContent = "+ Tambah kategori baru…";
    sel.appendChild(optAdd);
  }

  function renderAll(){
    const rows = computeRunning();
    renderCards(rows);
    renderTrend(rows);
    renderHarian(rows);
    const weeks = computeWeekly(rows);
    const months = computeMonthly(rows);
    renderMingguan(weeks);
    renderBulanan(months);
    renderWeeklyChart(weeks);
    renderMonthlyChart(months);
  }

  function renderCards(rows){
    const saldo = rows.length ? rows[rows.length-1].saldo : (Number(state.saldoAwal)||0);
    let masuk = 0, keluar = 0;
    rows.forEach(r=>{ masuk += Number(r.pemasukan)||0; keluar += Number(r.pengeluaran)||0; });
    document.getElementById("cardSaldo").textContent = rp(saldo);
    document.getElementById("cardMasuk").textContent = rp(masuk);
    document.getElementById("cardKeluar").textContent = rp(keluar);
  }

  function renderTrend(rows){
    const svg = document.getElementById("trendSvg");
    const w = 400, h = 52;
    if(rows.length < 2){ svg.innerHTML = ""; return; }
    const vals = [Number(state.saldoAwal)||0, ...rows.map(r=>r.saldo)];
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = (max - min) || 1;
    const stepX = w / (vals.length - 1);
    const pts = vals.map((v,i)=>{
      const x = i*stepX;
      const y = h - 6 - ((v-min)/range)*(h-12);
      return [x,y];
    });
    const path = pts.map((p,i)=> (i===0?"M":"L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
    const areaPath = path + ` L${w},${h} L0,${h} Z`;
    svg.innerHTML = `
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#9aa3b2" stop-opacity="0.35"/>
          <stop offset="1" stop-color="#9aa3b2" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#trendFill)" stroke="none"/>
      <path d="${path}" fill="none" stroke="#c2c9d6" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    `;
  }

  function drawBarChart(svgEl, wrapEl, emptyEl, periods){
    if(!periods || periods.length === 0){
      svgEl.style.display = "none";
      emptyEl.style.display = "block";
      return;
    }
    svgEl.style.display = "block";
    emptyEl.style.display = "none";

    const padLeft = 46, padRight = 10, padTop = 14, padBottom = 26;
    const groupW = 62;
    const chartW = periods.length * groupW;
    const chartH = 180;
    const W = padLeft + chartW + padRight;
    const H = padTop + chartH + padBottom;

    const maxRaw = Math.max(1, ...periods.map(p => Math.max(p.masuk, p.keluar)));
    const niceMax = niceMaxValue(maxRaw);
    const steps = 4;

    let gridSVG = "";
    for(let i = 0; i <= steps; i++){
      const v = niceMax * i / steps;
      const y = padTop + chartH - (v / niceMax) * chartH;
      gridSVG += `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${W - padRight}" y2="${y.toFixed(1)}" style="stroke:var(--border-soft)" stroke-width="1"/>`;
      gridSVG += `<text x="${padLeft - 6}" y="${(y+3).toFixed(1)}" text-anchor="end" font-size="9" font-family="var(--font-body)" style="fill:var(--text-faint)">${escapeHtml(rpCompact(v))}</text>`;
    }

    const barW = 15, gap = 3;
    let barsSVG = "";
    let labelsSVG = "";
    periods.forEach((p, i) => {
      const gx = padLeft + i * groupW;
      const cx = gx + groupW / 2;
      const hMasuk = (Math.min(p.masuk, niceMax) / niceMax) * chartH;
      const hKeluar = (Math.min(p.keluar, niceMax) / niceMax) * chartH;
      const xMasuk = cx - barW - gap / 2;
      const xKeluar = cx + gap / 2;
      const yMasuk = padTop + chartH - hMasuk;
      const yKeluar = padTop + chartH - hKeluar;
      barsSVG += `<rect x="${xMasuk.toFixed(1)}" y="${yMasuk.toFixed(1)}" width="${barW}" height="${hMasuk.toFixed(1)}" rx="2" style="fill:var(--income)"><title>${escapeHtml(p.label)} — Pemasukan: ${escapeHtml(rp(p.masuk))}</title></rect>`;
      barsSVG += `<rect x="${xKeluar.toFixed(1)}" y="${yKeluar.toFixed(1)}" width="${barW}" height="${hKeluar.toFixed(1)}" rx="2" style="fill:var(--expense)"><title>${escapeHtml(p.label)} — Pengeluaran: ${escapeHtml(rp(p.keluar))}</title></rect>`;
      labelsSVG += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9.5" font-family="var(--font-body)" style="fill:var(--text-faint)">${escapeHtml(p.label)}</text>`;
    });

    const axisSVG = `<line x1="${padLeft}" y1="${padTop + chartH}" x2="${W - padRight}" y2="${padTop + chartH}" style="stroke:var(--border)" stroke-width="1"/>`;

    svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svgEl.setAttribute("width", String(W));
    svgEl.setAttribute("height", String(H));
    svgEl.setAttribute("preserveAspectRatio", "xMinYMin meet");
    svgEl.innerHTML = gridSVG + axisSVG + barsSVG + labelsSVG;

    // Jika grafik lebih sempit dari kontainer, biarkan melebar penuh & tidak perlu discroll.
    if(wrapEl.clientWidth && W < wrapEl.clientWidth){
      svgEl.style.width = "100%";
    } else {
      svgEl.style.width = W + "px";
    }
  }

  function renderWeeklyChart(weeks){
    const svgEl = document.getElementById("chartMingguan");
    const wrapEl = document.getElementById("chartMingguanWrap");
    const emptyEl = document.getElementById("chartMingguanEmpty");
    const periods = weeks.map(w => ({ masuk: w.masuk, keluar: w.keluar, label: "M" + w.ke }));
    drawBarChart(svgEl, wrapEl, emptyEl, periods);
  }

  function renderMonthlyChart(months){
    const svgEl = document.getElementById("chartBulanan");
    const wrapEl = document.getElementById("chartBulananWrap");
    const emptyEl = document.getElementById("chartBulananEmpty");
    const periods = months.map(m => ({ masuk: m.masuk, keluar: m.keluar, label: m.bulan.toLocaleDateString("id-ID", { month: "short", year: "2-digit" }) }));
    drawBarChart(svgEl, wrapEl, emptyEl, periods);
  }

  function renderHarian(rows){
    const tbody = document.getElementById("tbodyHarian");
    const empty = document.getElementById("emptyHarian");
    tbody.innerHTML = "";
    if(rows.length === 0){ empty.style.display="block"; return; }
    empty.style.display = "none";
    rows.forEach(r=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.no}</td>
        <td>${fmtID(toDate(r.tanggal))}</td>
        <td class="ket">${escapeHtml(r.keterangan||"")}</td>
        <td><span class="cat-pill"><span class="cat-dot" style="background:${catColor(r.kategori)}"></span>${escapeHtml(r.kategori||"")}</span></td>
        <td class="num ${r.pemasukan?'in':'zero'}">${r.pemasukan ? rp(r.pemasukan) : "–"}</td>
        <td class="num ${r.pengeluaran?'out':'zero'}">${r.pengeluaran ? rp(r.pengeluaran) : "–"}</td>
        <td class="num">${rp(r.saldo)}</td>
        <td>
          <div class="row-actions" id="actions-${r.id}">
            <button class="icon-btn" data-edit="${r.id}" title="Ubah">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="icon-btn danger" data-del="${r.id}" title="Hapus">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3m-8 0l1 13a2 2 0 002 2h4a2 2 0 002-2l1-13"/></svg>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("[data-edit]").forEach(b=> b.addEventListener("click", ()=> startEdit(b.dataset.edit)));
    tbody.querySelectorAll("[data-del]").forEach(b=> b.addEventListener("click", ()=> askDeleteConfirm(b.dataset.del)));
  }

  function renderMingguan(weeks){
    const tbody = document.getElementById("tbodyMingguan");
    const empty = document.getElementById("emptyMingguan");
    tbody.innerHTML = "";
    if(weeks.length===0){ empty.style.display="block"; return; }
    empty.style.display="none";
    weeks.forEach(w=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${w.ke}</td>
        <td>${fmtID(w.awal)}</td>
        <td>${fmtID(w.akhir)}</td>
        <td class="num ${w.masuk?'in':'zero'}">${rp(w.masuk)}</td>
        <td class="num ${w.keluar?'out':'zero'}">${rp(w.keluar)}</td>
        <td class="num ${w.selisih>0?'in':(w.selisih<0?'out':'zero')}">${rp(w.selisih)}</td>
        <td class="num">${rp(w.saldo)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderBulanan(months){
    const tbody = document.getElementById("tbodyBulanan");
    const empty = document.getElementById("emptyBulanan");
    tbody.innerHTML = "";
    if(months.length===0){ empty.style.display="block"; return; }
    empty.style.display="none";
    months.forEach(m=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.ke}</td>
        <td>${fmtMonthID(m.bulan)}</td>
        <td class="num ${m.masuk?'in':'zero'}">${rp(m.masuk)}</td>
        <td class="num ${m.keluar?'out':'zero'}">${rp(m.keluar)}</td>
        <td class="num ${m.selisih>0?'in':(m.selisih<0?'out':'zero')}">${rp(m.selisih)}</td>
        <td class="num">${rp(m.saldo)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  /* ---------------- form logic ---------------- */
  function resetForm(){
    document.getElementById("fTanggal").value = toISO(todayDate());
    document.getElementById("fKeterangan").value = "";
    document.getElementById("fKategori").value = state.categories[0];
    document.getElementById("fPemasukan").value = 0;
    document.getElementById("fPengeluaran").value = 0;
    editingId = null;
    document.getElementById("btnSaveEntry").innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14m-7-7h14"/></svg> Tambah Transaksi`;
    document.getElementById("btnCancelEdit").style.display = "none";
    document.getElementById("editingNote").classList.remove("show");
  }

  function startEdit(id){
    const e = state.entries.find(x=>x.id===id);
    if(!e) return;
    document.getElementById("fTanggal").value = e.tanggal;
    document.getElementById("fKeterangan").value = e.keterangan;
    document.getElementById("fKategori").value = e.kategori;
    document.getElementById("fPemasukan").value = e.pemasukan;
    document.getElementById("fPengeluaran").value = e.pengeluaran;
    editingId = id;
    document.getElementById("btnSaveEntry").innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Simpan Perubahan`;
    document.getElementById("btnCancelEdit").style.display = "inline-flex";
    document.getElementById("editingNote").classList.add("show");
    document.querySelector(".entry-form").scrollIntoView({behavior:"smooth", block:"center"});
  }

  function askDeleteConfirm(id){
    const holder = document.getElementById("actions-"+id);
    if(!holder) return;
    deleteConfirmId = id;
    holder.innerHTML = `
      <div class="confirm-delete">
        <span>Yakin hapus?</span>
        <button class="yes" data-yes="${id}">Ya, hapus</button>
        <button class="no" data-no="${id}">Batal</button>
      </div>
    `;
    holder.querySelector("[data-yes]").addEventListener("click", ()=> confirmDelete(id));
    holder.querySelector("[data-no]").addEventListener("click", ()=> cancelDelete());
  }
  function confirmDelete(id){
    state.entries = state.entries.filter(x=>x.id!==id);
    deleteConfirmId = null;
    saveState();
    renderAll();
    toast("Transaksi dihapus.");
  }
  function cancelDelete(){ deleteConfirmId = null; renderAll(); }

  function handleSaveEntry(){
    const tanggal = document.getElementById("fTanggal").value;
    const keterangan = document.getElementById("fKeterangan").value.trim();
    const kategori = document.getElementById("fKategori").value;
    const pemasukan = Number(document.getElementById("fPemasukan").value) || 0;
    const pengeluaran = Number(document.getElementById("fPengeluaran").value) || 0;

    if(!tanggal){ alert("Isi tanggal terlebih dahulu."); return; }
    if(!keterangan){ alert("Isi keterangan terlebih dahulu."); return; }
    if(pemasukan===0 && pengeluaran===0){ alert("Isi jumlah pemasukan atau pengeluaran."); return; }

    if(editingId){
      const e = state.entries.find(x=>x.id===editingId);
      Object.assign(e, {tanggal, keterangan, kategori, pemasukan, pengeluaran});
      toast("Perubahan disimpan.");
    } else {
      state.entries.push({
        id: "e" + Date.now() + Math.random().toString(36).slice(2,7),
        order: state.entries.length,
        tanggal, keterangan, kategori, pemasukan, pengeluaran
      });
      toast("Transaksi ditambahkan.");
    }
    saveState();
    resetForm();
    renderAll();
  }

  function handleCategoryChange(){
    const sel = document.getElementById("fKategori");
    if(sel.value === "__add__"){
      const name = prompt("Nama kategori baru:");
      sel.value = state.categories[0];
      if(name && name.trim()){
        const trimmed = name.trim();
        if(!state.categories.includes(trimmed)){
          state.categories.push(trimmed);
          saveState();
        }
        renderCategoryOptions();
        sel.value = trimmed;
      }
    }
  }

  /* ---------------- kelola kategori ---------------- */
  function categoryUsageCount(cat){
    return state.entries.filter(e=>e.kategori===cat).length;
  }
  function renderCategoryManageList(){
    const list = document.getElementById("catManageList");
    list.innerHTML = "";
    state.categories.forEach(c=>{
      const count = categoryUsageCount(c);
      const row = document.createElement("div");
      row.className = "cat-manage-row";
      row.innerHTML = `
        <span class="cat-dot" style="background:${catColor(c)}"></span>
        <span class="cat-name">${escapeHtml(c)}</span>
        <span class="cat-count">${count} transaksi</span>
        <button type="button" class="cat-del-btn" data-delcat="${escapeHtml(c)}" title="Hapus kategori">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3m-8 0l1 13a2 2 0 002 2h4a2 2 0 002-2l1-13"/></svg>
        </button>
      `;
      list.appendChild(row);
    });
    list.querySelectorAll("[data-delcat]").forEach(b=>{
      b.addEventListener("click", ()=> deleteCategory(b.dataset.delcat));
    });
  }
  function deleteCategory(cat){
    if(state.categories.length <= 1){ toast("Minimal harus ada 1 kategori."); return; }
    const count = categoryUsageCount(cat);
    const msg = count > 0
      ? `Kategori "${cat}" dipakai di ${count} transaksi. Transaksi lama tetap menyimpan nama kategorinya, tapi kategori ini akan hilang dari daftar pilihan. Lanjutkan hapus?`
      : `Hapus kategori "${cat}"?`;
    if(!confirm(msg)) return;
    state.categories = state.categories.filter(c=>c!==cat);
    saveState();
    renderCategoryOptions();
    renderCategoryManageList();
    toast("Kategori dihapus.");
  }
  function openManageCategories(){
    renderCategoryManageList();
    document.getElementById("cat-new-input").value = "";
    openModal("modal-categories");
  }
  function addCategoryFromModal(){
    const input = document.getElementById("cat-new-input");
    const name = input.value.trim();
    if(!name){ toast("Isi nama kategori dulu."); return; }
    if(state.categories.includes(name)){ toast("Kategori sudah ada."); input.value=""; return; }
    state.categories.push(name);
    saveState();
    renderCategoryOptions();
    renderCategoryManageList();
    input.value = "";
    toast("Kategori ditambahkan.");
  }

  /* ---------------- export excel ---------------- */
  function exportExcel(){
    const rows = computeRunning();
    const weeks = computeWeekly(rows);
    const months = computeMonthly(rows);
    const wb = XLSX.utils.book_new();

    const harianData = [
      ["Jurnal Pemasukan & Pengeluaran Harian / " + (account?account.nama:"")],
      [],
      ["Saldo awal (Rp)", Number(state.saldoAwal)||0],
      [],
      ["No","Tanggal","Keterangan","Kategori","Pemasukan (Rp)","Pengeluaran (Rp)","Saldo (Rp)"],
      ...rows.map(r=>[r.no, fmtID(toDate(r.tanggal)), r.keterangan, r.kategori, r.pemasukan, r.pengeluaran, r.saldo])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(harianData), "Jurnal Harian");

    const mingguanData = [
      ["Ringkasan Mingguan"], [],
      ["Minggu ke","Awal (Senin)","Akhir (Minggu)","Total Pemasukan (Rp)","Total Pengeluaran (Rp)","Selisih (Rp)","Saldo Akhir Minggu (Rp)"],
      ...weeks.map(w=>[w.ke, fmtID(w.awal), fmtID(w.akhir), w.masuk, w.keluar, w.selisih, w.saldo])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mingguanData), "Ringkasan Mingguan");

    const bulananData = [
      ["Ringkasan Bulanan"], [],
      ["Bulan ke","Bulan","Total Pemasukan (Rp)","Total Pengeluaran (Rp)","Selisih (Rp)","Saldo Akhir Bulan (Rp)"],
      ...months.map(m=>[m.ke, fmtMonthID(m.bulan), m.masuk, m.keluar, m.selisih, m.saldo])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bulananData), "Ringkasan Bulanan");

    const fname = "Jurnal_Pemasukan_Pengeluaran_" + ((account&&account.nama)||"User").replace(/\s+/g,"_") + ".xlsx";
    XLSX.writeFile(wb, fname);
  }

  /* ============================================================
     AUTH: register / login
     ============================================================ */
  function switchLoginTab(tab){
    document.getElementById("tab-login").classList.toggle("active", tab==="login");
    document.getElementById("tab-register").classList.toggle("active", tab==="register");
    document.getElementById("form-login").classList.toggle("active", tab==="login");
    document.getElementById("form-register").classList.toggle("active", tab==="register");
    hideMsg("login-error"); hideMsg("login-success"); hideMsg("reg-error"); hideMsg("reg-success");
  }
  function toggleEye(inputId, btnId){
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if(input.type === "password"){ input.type = "text"; btn.innerHTML = ICON_EYE_OPEN; }
    else { input.type = "password"; btn.innerHTML = ICON_EYE_OFF; }
  }
  function showMsg(id, text){
    const el = document.getElementById(id);
    el.textContent = text;
    el.classList.add("show");
  }
  function hideMsg(id){
    const el = document.getElementById(id);
    el.textContent = "";
    el.classList.remove("show");
  }
  function showForgotMsg(){
    showMsg("login-error", "Data tersimpan lokal di perangkat ini — tidak ada pemulihan via email. Jika lupa password, gunakan \"Hapus semua data aplikasi\" di pengaturan browser untuk mulai ulang (data lama akan hilang).");
  }

  async function doRegister(){
    hideMsg("reg-error"); hideMsg("reg-success");
    const nama = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim().toLowerCase();
    const pass = document.getElementById("reg-password").value;
    const confirm = document.getElementById("reg-confirm").value;

    if(account){ showMsg("reg-error", "Sudah ada akun terdaftar di perangkat ini. Silakan Masuk, atau hapus akun lama lewat Pengaturan."); return; }
    if(!nama){ showMsg("reg-error", "Nama lengkap wajib diisi."); return; }
    if(!/^\S+@\S+\.\S+$/.test(email)){ showMsg("reg-error", "Format email tidak valid."); return; }
    if(pass.length < 8 || !/\d/.test(pass)){ showMsg("reg-error", "Password minimal 8 karakter dan mengandung angka."); return; }
    if(pass !== confirm){ showMsg("reg-error", "Konfirmasi password tidak cocok."); return; }

    const salt = randomSalt();
    const passHash = await hashWithSalt(pass, salt);
    account = {
      nama, email, passHash, passSalt: salt,
      pinHash: null, pinSalt: null, pinEnabled:false, pinOnOpen:true,
      foto: null, haptic:true, theme:"dark", currency:"IDR", exchangeRate:17800, createdAt: Date.now()
    };
    saveAccount();
    showMsg("reg-success", "Akun berhasil dibuat! Selamat datang.");
    setLoggedIn(true);
    setTimeout(()=> enterApp(), 500);
  }

  async function doLogin(){
    hideMsg("login-error"); hideMsg("login-success");
    const email = document.getElementById("login-email").value.trim().toLowerCase();
    const pass = document.getElementById("login-password").value;
    if(!account){ showMsg("login-error", "Belum ada akun di perangkat ini. Silakan daftar terlebih dahulu."); return; }
    if(email !== account.email){ showMsg("login-error", "Email tidak cocok dengan akun terdaftar."); return; }
    const hash = await hashWithSalt(pass, account.passSalt);
    if(hash !== account.passHash){ showMsg("login-error", "Password salah."); return; }
    setLoggedIn(true);
    enterApp();
  }

  function logoutToLogin(){
    setLoggedIn(false);
    document.getElementById("app-wrap").classList.remove("active");
    document.getElementById("page-pin").style.display = "none";
    document.getElementById("page-login").style.display = "flex";
    switchLoginTab("login");
    document.getElementById("login-email").value = "";
    document.getElementById("login-password").value = "";
  }

  function doLogout(){
    if(!confirm("Keluar dari aplikasi?")) return;
    logoutToLogin();
  }

  /* ============================================================
     PIN
     ============================================================ */
  function renderPinLockScreen(){
    document.getElementById("pin-user-name").textContent = account.nama || "—";
    document.getElementById("pin-user-email").textContent = account.email || "—";
    const av = document.getElementById("pin-avatar");
    av.innerHTML = account.foto ? `<img src="${account.foto}" alt="">` : "👤";
  }

  function updatePinDots(){
    for(let i=0;i<6;i++){
      const dot = document.getElementById("pd"+i);
      dot.classList.toggle("filled", i < pinBuffer.length);
      dot.classList.remove("error");
    }
  }
  function pinError(){
    for(let i=0;i<6;i++){ document.getElementById("pd"+i).classList.add("error"); }
    document.getElementById("pin-error-msg").textContent = "PIN salah, coba lagi.";
    haptic(200);
    setTimeout(()=>{ pinBuffer=""; updatePinDots(); }, 420);
  }

  async function pinPress(d){
    if(pinBuffer.length >= 6) return;
    haptic(10);
    pinBuffer += d;
    updatePinDots();
    if(pinBuffer.length === 6){
      const hash = await hashWithSalt(pinBuffer, account.pinSalt);
      if(hash === account.pinHash){
        document.getElementById("pin-error-msg").textContent = "";
        setTimeout(()=>{ pinBuffer=""; updatePinDots(); enterApp(); }, 120);
      } else {
        pinError();
      }
    }
  }
  function pinDel(){
    haptic(8);
    pinBuffer = pinBuffer.slice(0,-1);
    updatePinDots();
    document.getElementById("pin-error-msg").textContent = "";
  }

  /* ---- pin setup (in settings modal) ---- */
  function openChangePIN(){
    pinSetupStage = "first";
    pinSetupBuffer = ""; pinSetupFirst = "";
    document.getElementById("pin-setup-step").textContent = "Masukkan 6 digit PIN baru";
    updatePinSetupDots();
    document.getElementById("pin-setup-error").textContent = "";
    openModal("modal-pin");
  }
  function updatePinSetupDots(){
    for(let i=0;i<6;i++){
      const dot = document.getElementById("spd"+i);
      dot.classList.toggle("filled", i < pinSetupBuffer.length);
      dot.classList.remove("error");
    }
  }
  async function pinSetupPress(d){
    if(pinSetupBuffer.length >= 6) return;
    haptic(10);
    pinSetupBuffer += d;
    updatePinSetupDots();
    if(pinSetupBuffer.length === 6){
      if(pinSetupStage === "first"){
        pinSetupFirst = pinSetupBuffer;
        pinSetupStage = "confirm";
        pinSetupBuffer = "";
        document.getElementById("pin-setup-step").textContent = "Ulangi 6 digit PIN untuk konfirmasi";
        setTimeout(updatePinSetupDots, 150);
      } else {
        if(pinSetupBuffer === pinSetupFirst){
          const salt = randomSalt();
          account.pinHash = await hashWithSalt(pinSetupBuffer, salt);
          account.pinSalt = salt;
          account.pinEnabled = true;
          saveAccount();
          toast("PIN berhasil diatur.");
          closeModal("modal-pin");
          renderSettingsSecurity();
        } else {
          for(let i=0;i<6;i++){ document.getElementById("spd"+i).classList.add("error"); }
          document.getElementById("pin-setup-error").textContent = "PIN tidak cocok, mulai ulang.";
          haptic(200);
          setTimeout(()=>{
            pinSetupStage = "first"; pinSetupBuffer=""; pinSetupFirst="";
            document.getElementById("pin-setup-step").textContent = "Masukkan 6 digit PIN baru";
            updatePinSetupDots();
          }, 500);
        }
      }
    }
  }
  function pinSetupDel(){
    haptic(8);
    pinSetupBuffer = pinSetupBuffer.slice(0,-1);
    updatePinSetupDots();
  }

  function togglePinOnOpen(){
    if(!account.pinEnabled){ toast("Atur PIN terlebih dahulu."); return; }
    account.pinOnOpen = !account.pinOnOpen;
    saveAccount();
    renderSettingsSecurity();
  }

  /* ============================================================
     SETTINGS
     ============================================================ */
  function renderSettingsProfile(){
    document.getElementById("sett-name").textContent = account.nama;
    document.getElementById("sett-email").textContent = account.email;
    const av = document.getElementById("sett-avatar");
    av.innerHTML = account.foto ? `<img src="${account.foto}" alt="">` : "👤";
    const headerAv = document.getElementById("header-avatar");
    headerAv.innerHTML = account.foto ? `<img src="${account.foto}" alt="">` : "👤";
  }
  function renderSettingsSecurity(){
    document.getElementById("pin-status-desc").textContent = account.pinEnabled ? "Aktif — ketuk untuk ubah PIN" : "Belum diatur";
    document.getElementById("toggle-pin-onopen").classList.toggle("on", !!(account.pinEnabled && account.pinOnOpen));
  }
  function renderSettingsApp(){
    document.getElementById("toggle-haptic").classList.toggle("on", !!account.haptic);
    document.getElementById("toggle-theme").classList.toggle("on", account.theme === "light");
    renderSettingsCurrency();
  }
  function renderSettingsCurrency(){
    const cur = account.currency || "IDR";
    document.getElementById("btnCurrencyUSD").classList.toggle("active", cur === "USD");
    document.getElementById("btnCurrencyIDR").classList.toggle("active", cur === "IDR");
    const rateRow = document.getElementById("row-exchange-rate");
    rateRow.style.display = cur === "USD" ? "flex" : "none";
    const rate = Number(account.exchangeRate) || 17800;
    document.getElementById("exchange-rate-desc").textContent = "1 USD = Rp " + Math.round(rate).toLocaleString("id-ID");
  }
  function setCurrency(cur){
    if(account.currency === cur) return;
    account.currency = cur;
    saveAccount();
    renderSettingsCurrency();
    renderAll();
    haptic(10);
    toast(cur === "USD" ? "Mata uang diubah ke USD." : "Mata uang diubah ke IDR.");
  }
  function editExchangeRate(){
    const current = Number(account.exchangeRate) || 17800;
    const input = prompt("Masukkan kurs 1 USD dalam Rupiah:", current);
    if(input === null) return;
    const val = Number(String(input).replace(/[^\d.]/g,""));
    if(!val || val <= 0){ toast("Kurs tidak valid."); return; }
    account.exchangeRate = val;
    saveAccount();
    renderSettingsCurrency();
    renderAll();
    toast("Kurs diperbarui.");
  }
  function renderSettingsAll(){
    renderSettingsProfile();
    renderSettingsSecurity();
    renderSettingsApp();
  }

  function toggleHapticFeedback(){
    account.haptic = !account.haptic;
    saveAccount();
    renderSettingsApp();
    haptic(15);
  }
  function toggleTheme(){
    account.theme = account.theme === "light" ? "dark" : "light";
    applyTheme();
    saveAccount();
    renderSettingsApp();
  }
  function applyTheme(){
    document.documentElement.setAttribute("data-theme", (account && account.theme==="light") ? "light" : "dark");
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  }

  /* ---- edit profile ---- */
  function openEditProfile(){
    document.getElementById("edit-name").value = account.nama;
    document.getElementById("edit-email").value = account.email;
    const prev = document.getElementById("edit-avatar-preview");
    prev.innerHTML = account.foto ? `<img src="${account.foto}" alt="">` : "👤";
    openModal("modal-profile");
  }
  function handlePhotoUpload(ev){
    const file = ev.target.files[0];
    if(!file) return;
    if(file.size > 2*1024*1024){ toast("Ukuran foto maksimal 2MB."); return; }
    const reader = new FileReader();
    reader.onload = ()=>{
      document.getElementById("edit-avatar-preview").innerHTML = `<img src="${reader.result}" alt="">`;
      document.getElementById("edit-avatar-preview").dataset.pending = reader.result;
    };
    reader.readAsDataURL(file);
  }
  function saveProfile(){
    const nama = document.getElementById("edit-name").value.trim();
    const email = document.getElementById("edit-email").value.trim().toLowerCase();
    if(!nama){ toast("Nama tidak boleh kosong."); return; }
    if(!/^\S+@\S+\.\S+$/.test(email)){ toast("Format email tidak valid."); return; }
    account.nama = nama;
    account.email = email;
    const pending = document.getElementById("edit-avatar-preview").dataset.pending;
    if(pending){ account.foto = pending; delete document.getElementById("edit-avatar-preview").dataset.pending; }
    saveAccount();
    renderSettingsProfile();
    closeModal("modal-profile");
    toast("Profil diperbarui.");
  }

  /* ---- change password ---- */
  function openChangePassword(){
    document.getElementById("pw-old").value = "";
    document.getElementById("pw-new").value = "";
    document.getElementById("pw-confirm").value = "";
    hideMsg("pw-error");
    openModal("modal-password");
  }
  async function savePassword(){
    hideMsg("pw-error");
    const oldPass = document.getElementById("pw-old").value;
    const newPass = document.getElementById("pw-new").value;
    const confirm = document.getElementById("pw-confirm").value;
    const oldHash = await hashWithSalt(oldPass, account.passSalt);
    if(oldHash !== account.passHash){ showMsg("pw-error","Password lama salah."); return; }
    if(newPass.length < 8 || !/\d/.test(newPass)){ showMsg("pw-error","Password baru minimal 8 karakter dan mengandung angka."); return; }
    if(newPass !== confirm){ showMsg("pw-error","Konfirmasi password baru tidak cocok."); return; }
    const salt = randomSalt();
    account.passHash = await hashWithSalt(newPass, salt);
    account.passSalt = salt;
    saveAccount();
    closeModal("modal-password");
    toast("Password berhasil diubah.");
  }

  /* ---- export / import JSON ---- */
  function exportData(){
    const payload = {
      exportedAt: new Date().toISOString(),
      nama: account.nama,
      saldoAwal: state.saldoAwal,
      categories: state.categories,
      entries: state.entries
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Jurnal_Backup_" + toISO(todayDate()) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast("Data diekspor.");
  }
  function triggerImport(){ document.getElementById("import-file-input").click(); }
  function handleImportFile(ev){
    const file = ev.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const data = JSON.parse(reader.result);
        if(!Array.isArray(data.entries)) throw new Error("format tidak valid");
        if(!confirm("Impor akan MENGGANTI seluruh data jurnal saat ini dengan isi file. Lanjutkan?")) return;
        state.saldoAwal = Number(data.saldoAwal)||0;
        state.categories = Array.isArray(data.categories) && data.categories.length ? data.categories : DEFAULT_CATEGORIES.slice();
        state.entries = data.entries;
        saveState();
        renderCategoryOptions();
        document.getElementById("saldoAwal").value = state.saldoAwal;
        resetForm();
        renderAll();
        toast("Data berhasil diimpor.");
      }catch(err){
        alert("Gagal impor: file tidak valid.");
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  }

  function openClearData(){
    if(!confirm("Hapus SEMUA transaksi jurnal? Tindakan ini tidak dapat dibatalkan.")) return;
    state.entries = [];
    state.saldoAwal = 0;
    saveState();
    document.getElementById("saldoAwal").value = 0;
    resetForm();
    renderAll();
    toast("Semua data transaksi dihapus.");
  }

  /* ---- delete account ---- */
  function openDeleteAccount(){
    document.getElementById("del-acc-password").value = "";
    document.getElementById("del-acc-confirm-text").value = "";
    hideMsg("del-acc-error");
    openModal("modal-delete-account");
  }
  async function confirmDeleteAccount(){
    hideMsg("del-acc-error");
    const pass = document.getElementById("del-acc-password").value;
    const confirmText = document.getElementById("del-acc-confirm-text").value.trim();
    const hash = await hashWithSalt(pass, account.passSalt);
    if(hash !== account.passHash){ showMsg("del-acc-error","Password salah."); return; }
    if(confirmText !== "HAPUS AKUN"){ showMsg("del-acc-error",'Ketik persis "HAPUS AKUN" untuk konfirmasi.'); return; }
    localStorage.removeItem(LS_ACCOUNT);
    localStorage.removeItem(LS_STATE);
    localStorage.removeItem(LS_LOGGEDIN);
    location.reload();
  }

  /* ============================================================
     MODALS
     ============================================================ */
  function openModal(id){ document.getElementById(id).classList.add("show"); }
  function closeModal(id){ document.getElementById(id).classList.remove("show"); }

  /* ============================================================
     PAGE / TAB / NAV navigation
     ============================================================ */
  function showPage(name){
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
    document.getElementById("page-"+name).classList.add("active");
    document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
    const nav = document.getElementById("nav-"+name);
    if(nav) nav.classList.add("active");
  }
  function setupTabs(){
    document.querySelectorAll(".tab").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("panel-"+btn.dataset.tab).classList.add("active");
      });
    });
  }

  /* ============================================================
     APP ENTRY FLOW
     ============================================================ */
  function showLoginPage(){
    document.getElementById("page-login").style.display = "flex";
    document.getElementById("page-pin").style.display = "none";
    document.getElementById("app-wrap").classList.remove("active");
  }
  function showPinPage(){
    document.getElementById("page-login").style.display = "none";
    document.getElementById("page-pin").style.display = "flex";
    document.getElementById("app-wrap").classList.remove("active");
    renderPinLockScreen();
    pinBuffer = ""; updatePinDots();
    document.getElementById("pin-error-msg").textContent = "";
  }
  function showMainApp(){
    document.getElementById("page-login").style.display = "none";
    document.getElementById("page-pin").style.display = "none";
    document.getElementById("app-wrap").classList.add("active");
    renderSettingsAll();
    showPage("beranda");
  }

  function enterApp(){
    applyTheme();
    loadState();
    renderCategoryOptions();
    document.getElementById("saldoAwal").value = Number(state.saldoAwal)||0;
    resetForm();
    renderAll();
    showMainApp();
  }

  function boot(){
    loadAccount();
    applyTheme();

    if(!account){
      showLoginPage();
      switchLoginTab("register");
    } else if(isLoggedIn()){
      // Setiap aplikasi dibuka ulang: jika PIN aktif & diminta saat buka,
      // selalu tampilkan kunci PIN dulu sebelum masuk ke jurnal.
      if(account.pinEnabled && account.pinOnOpen){
        showPinPage();
      } else {
        enterApp();
      }
    } else {
      showLoginPage();
      switchLoginTab("login");
      document.getElementById("login-email").value = account.email || "";
    }

    document.getElementById("loading").style.display = "none";
    document.getElementById("root").style.display = "block";
  }

  /* ============================================================
     INIT / EVENT WIRING
     ============================================================ */
  function init(){
    boot();
    setupTabs();

    // login/register
    document.getElementById("tab-login").addEventListener("click", ()=>switchLoginTab("login"));
    document.getElementById("tab-register").addEventListener("click", ()=>switchLoginTab("register"));
    document.querySelectorAll('[data-switch-tab]').forEach(el=>{
      el.addEventListener("click", ()=> switchLoginTab(el.dataset.switchTab));
    });
    document.getElementById("btnDoLogin").addEventListener("click", doLogin);
    document.getElementById("btnDoRegister").addEventListener("click", doRegister);
    document.getElementById("eye-login-pw").innerHTML = ICON_EYE_OFF;
    document.getElementById("eye-reg-pw").innerHTML = ICON_EYE_OFF;
    document.getElementById("eye-reg-cnf").innerHTML = ICON_EYE_OFF;
    document.getElementById("eye-login-pw").addEventListener("click", ()=>toggleEye("login-password","eye-login-pw"));
    document.getElementById("eye-reg-pw").addEventListener("click", ()=>toggleEye("reg-password","eye-reg-pw"));
    document.getElementById("eye-reg-cnf").addEventListener("click", ()=>toggleEye("reg-confirm","eye-reg-cnf"));
    ["eye-pw-old","eye-pw-new","eye-pw-confirm"].forEach(id=>{
      const inputId = id.replace("eye-","");
      const btn = document.getElementById(id);
      if(btn){ btn.innerHTML = ICON_EYE_OFF; btn.addEventListener("click", ()=>toggleEye(inputId, id)); }
    });
    document.getElementById("login-forgot").addEventListener("click", showForgotMsg);

    // pin keypad
    document.querySelectorAll("[data-pin]").forEach(b=> b.addEventListener("click", ()=>pinPress(b.dataset.pin)));
    document.getElementById("pin-del-btn").addEventListener("click", pinDel);
    document.getElementById("pin-switch-user").addEventListener("click", logoutToLogin);

    // pin setup keypad (modal)
    document.querySelectorAll("[data-pinsetup]").forEach(b=> b.addEventListener("click", ()=>pinSetupPress(b.dataset.pinsetup)));
    document.getElementById("pin-setup-del-btn").addEventListener("click", pinSetupDel);

    // header / nav
    document.getElementById("header-avatar").addEventListener("click", ()=>showPage("settings"));
    document.querySelectorAll("[data-nav]").forEach(b=> b.addEventListener("click", ()=>showPage(b.dataset.nav)));

    // journal form
    document.getElementById("fKategori").addEventListener("change", handleCategoryChange);
    document.getElementById("btnManageCategories").addEventListener("click", (e)=>{ e.preventDefault(); openManageCategories(); });
    document.getElementById("btnAddCategory").addEventListener("click", addCategoryFromModal);
    document.getElementById("cat-new-input").addEventListener("keydown", (e)=>{
      if(e.key === "Enter"){ e.preventDefault(); addCategoryFromModal(); }
    });
    [document.getElementById("fPemasukan"), document.getElementById("fPengeluaran"), document.getElementById("saldoAwal")].forEach(el=>{
      el.addEventListener("focus", function(){ const t=this; setTimeout(()=>t.select(),0); });
    });
    document.getElementById("btnSaveEntry").addEventListener("click", handleSaveEntry);
    document.getElementById("btnCancelEdit").addEventListener("click", resetForm);
    document.getElementById("btnExport").addEventListener("click", exportExcel);
    document.getElementById("saldoAwal").addEventListener("input", (e)=>{
      state.saldoAwal = Number(e.target.value)||0;
      saveState();
      renderAll();
    });

    // settings rows
    document.getElementById("row-pin").addEventListener("click", openChangePIN);
    document.getElementById("row-pin-onopen").addEventListener("click", togglePinOnOpen);
    document.getElementById("row-password").addEventListener("click", openChangePassword);
    document.getElementById("row-haptic").addEventListener("click", toggleHapticFeedback);
    document.getElementById("toggle-theme").addEventListener("click", (e)=>{ e.stopPropagation(); toggleTheme(); });
    document.getElementById("btnCurrencyUSD").addEventListener("click", ()=> setCurrency("USD"));
    document.getElementById("btnCurrencyIDR").addEventListener("click", ()=> setCurrency("IDR"));
    document.getElementById("row-exchange-rate").addEventListener("click", editExchangeRate);
    document.getElementById("row-export").addEventListener("click", exportData);
    document.getElementById("row-import").addEventListener("click", triggerImport);
    document.getElementById("import-file-input").addEventListener("change", handleImportFile);
    document.getElementById("row-clear").addEventListener("click", openClearData);
    document.getElementById("row-delete-account").addEventListener("click", openDeleteAccount);
    document.getElementById("btnLogout").addEventListener("click", doLogout);
    document.getElementById("profile-edit-btn").addEventListener("click", openEditProfile);

    // modals
    document.getElementById("photo-upload-input").addEventListener("change", handlePhotoUpload);
    document.getElementById("edit-avatar-preview").addEventListener("click", ()=>document.getElementById("photo-upload-input").click());
    document.getElementById("avatar-upload-btn").addEventListener("click", ()=>document.getElementById("photo-upload-input").click());
    document.getElementById("btnSaveProfile").addEventListener("click", saveProfile);
    document.getElementById("btnSavePassword").addEventListener("click", savePassword);
    document.getElementById("btnConfirmDeleteAccount").addEventListener("click", confirmDeleteAccount);
    document.querySelectorAll("[data-close-modal]").forEach(b=>{
      b.addEventListener("click", ()=>closeModal(b.dataset.closeModal));
    });
    document.querySelectorAll(".modal-overlay").forEach(ov=>{
      ov.addEventListener("click", (e)=>{ if(e.target === ov) closeModal(ov.id); });
    });
  }

  /* ============================================================
     JEMBATAN UNTUK cloud-sync.js
     Variabel account/state ada di dalam closure ini (tersembunyi
     dari luar secara sengaja). Blok ini mengekspos akses terbatas
     supaya cloud-sync.js bisa membaca/menulis & memicu render ulang
     saat ada perubahan dari perangkat lain, TANPA mengubah cara
     kerja aplikasi jurnal aslinya.
     ============================================================ */
  window.JKApp = {
    LS_ACCOUNT, LS_STATE, LS_LOGGEDIN,
    getAccount: () => account,
    setAccount: (a) => { account = a; },
    getState: () => state,
    setState: (s) => { state = s; },
    saveAccount, saveState, loadAccount, loadState,
    setLoggedIn, isLoggedIn,
    enterApp, showLoginPage, showMsg, hideMsg, switchLoginTab,
    toggleEye, closeModal,
    refreshUI: () => {
      applyTheme();
      renderCategoryOptions();
      const saldoEl = document.getElementById("saldoAwal");
      if (saldoEl) saldoEl.value = Number(state.saldoAwal) || 0;
      renderAll();
      if (document.getElementById("app-wrap")?.classList.contains("active")) {
        renderSettingsAll();
      }
    }
  };

  document.addEventListener("DOMContentLoaded", init);
})();
