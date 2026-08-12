/* ============================================================
   pwa.js — registrasi service worker + tombol pasang + update
   ============================================================ */
(function(){
  "use strict";

  let deferredPrompt = null;
  let waitingWorker = null;

  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    const banner = document.getElementById("install-banner");
    if(banner && !localStorage.getItem("jurnalapp:installBannerDismissed")){
      banner.classList.add("show");
    }
  });

  document.addEventListener("DOMContentLoaded", ()=>{
    const installBtn = document.getElementById("install-btn");
    const closeBtn = document.getElementById("install-close");
    if(installBtn){
      installBtn.addEventListener("click", async ()=>{
        const banner = document.getElementById("install-banner");
        if(banner) banner.classList.remove("show");
        if(!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
      });
    }
    if(closeBtn){
      closeBtn.addEventListener("click", ()=>{
        const banner = document.getElementById("install-banner");
        if(banner) banner.classList.remove("show");
        localStorage.setItem("jurnalapp:installBannerDismissed", "1");
      });
    }
  });

  window.addEventListener("appinstalled", ()=>{
    const banner = document.getElementById("install-banner");
    if(banner) banner.classList.remove("show");
    deferredPrompt = null;
  });

  if("serviceWorker" in navigator){
    window.addEventListener("load", ()=>{
      navigator.serviceWorker.register("./sw.js").then((reg)=>{
        reg.addEventListener("updatefound", ()=>{
          const newWorker = reg.installing;
          if(!newWorker) return;
          newWorker.addEventListener("statechange", ()=>{
            if(newWorker.state === "installed" && navigator.serviceWorker.controller){
              waitingWorker = newWorker;
              const bar = document.getElementById("update-banner");
              if(bar) bar.style.display = "flex";
            }
          });
        });
      }).catch(()=>{ /* offline pertama kali / lingkungan tanpa https, abaikan */ });

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", ()=>{
        if(refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      const updateBtn = document.getElementById("update-btn");
      if(updateBtn){
        updateBtn.addEventListener("click", ()=>{
          if(waitingWorker){ waitingWorker.postMessage({type:"SKIP_WAITING"}); }
        });
      }
    });
  }
})();
