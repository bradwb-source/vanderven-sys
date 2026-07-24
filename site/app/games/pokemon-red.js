const ROM_DB = "vanderven-games";
const ROM_STORE = "roms";
const ROM_KEY = "pokemon-red";

function detectCore(fileName = "") {
  const lower = String(fileName).toLowerCase();
  if (lower.endsWith(".gba") || lower.endsWith(".agb") || lower.endsWith(".mb")) return "gba";
  return "gb";
}

function ensureGameName(name = "game.gb") {
  if (/\.(gb|gbc|gba|zip)$/i.test(name)) return name;
  return `${name}.gb`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openRomDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ROM_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ROM_STORE)) {
        db.createObjectStore(ROM_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not open ROM storage."));
  });
}

async function getStoredRom() {
  const db = await openRomDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ROM_STORE, "readonly");
    const req = tx.objectStore(ROM_STORE).get(ROM_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("Could not read stored ROM."));
  });
}

async function saveRomRecord({ name, buffer, core }) {
  const db = await openRomDb();
  const record = {
    id: ROM_KEY,
    name,
    core,
    buffer,
    updatedAt: new Date().toISOString(),
    size: buffer?.byteLength || 0,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ROM_STORE, "readwrite");
    tx.objectStore(ROM_STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error || new Error("Could not save ROM."));
  });
}

async function clearStoredRom() {
  const db = await openRomDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ROM_STORE, "readwrite");
    tx.objectStore(ROM_STORE).delete(ROM_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Could not clear ROM."));
  });
}

function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toTransferableBuffer(buffer) {
  if (buffer instanceof ArrayBuffer) return buffer.slice(0);
  if (ArrayBuffer.isView(buffer)) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  return new Uint8Array(buffer).buffer;
}

/** Isolated EmulatorJS page (srcdoc) so CRM chrome/CSS cannot break the core. */
function playerSrcDoc() {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}
#game{width:100%;height:100%}
.boot{color:#d7dde8;font:500 14px/1.4 system-ui,sans-serif;display:grid;place-items:center;height:100%;text-align:center;padding:1rem}
</style></head><body>
<div id="game"><div class="boot">Starting…</div></div>
<script>
(function(){
  var started=false;
  function start(msg){
    if(started) return;
    started=true;
    var name=msg.name||"game.gb";
    var core=msg.core==="gba"?"gba":"gb";
    var bytes=msg.bytes instanceof ArrayBuffer?msg.bytes:new Uint8Array(msg.bytes).buffer;
    var url=URL.createObjectURL(new Blob([bytes],{type:"application/octet-stream"}));
    document.getElementById("game").innerHTML="";
    window.EJS_player="#game";
    window.EJS_core=core;
    window.EJS_gameUrl=url;
    window.EJS_gameName=name;
    window.EJS_gameID=1001;
    window.EJS_color="#1f7a6c";
    window.EJS_volume=0.55;
    window.EJS_threads=false;
    window.EJS_startOnLoaded=true;
    window.EJS_fixedSaveInterval=10000;
    window.EJS_pathtodata="https://cdn.emulatorjs.org/stable/data/";
    window.EJS_Buttons={playPause:true,restart:true,mute:true,volume:true,fullscreen:true,quickSave:true,quickLoad:true,saveSavFiles:true,loadSaveFiles:true};
    window.EJS_defaultOptions={"save-state-location":"browser"};
    window.EJS_ready=function(){
      try{window.EJS_emulator&&window.EJS_emulator.play&&window.EJS_emulator.play();}catch(e){}
      parent.postMessage({type:"emu-started"},"*");
    };
    var s=document.createElement("script");
    s.src="https://cdn.emulatorjs.org/stable/data/loader.js?v="+Date.now();
    s.onerror=function(){
      document.getElementById("game").innerHTML='<div class="boot">Could not load emulator scripts.</div>';
      parent.postMessage({type:"emu-error",message:"loader failed"},"*");
    };
    document.body.appendChild(s);
  }
  window.addEventListener("message",function(event){
    if(!event.data||event.data.type!=="start-rom") return;
    start(event.data);
  });
  parent.postMessage({type:"emu-frame-ready"},"*");
})();
</script></body></html>`;
}

export function mountPokemonRed(root) {
  let destroyed = false;
  let iframe = null;
  let onMessage = null;

  async function boot() {
    root.innerHTML = `<div class="games-loading">Checking saved ROM…</div>`;
    let stored = null;
    try {
      stored = await getStoredRom();
    } catch {
      stored = null;
    }
    if (destroyed) return;
    renderGate(stored);
  }

  function renderGate(stored) {
    const hasRom = !!(stored && stored.buffer);
    root.innerHTML = `
      <div class="games-rom-gate">
        <strong>Pokemon Red</strong>
        <p>
          ROM and saves stay in this browser only.
          Use <code>.gb</code>/<code>.gbc</code> for Red, or <code>.gba</code> for FireRed / LeafGreen.
        </p>
        ${
          hasRom
            ? `<div class="games-rom-saved">
                <strong>Saved ROM</strong>
                <span>${escapeHtml(stored.name)} · ${formatBytes(stored.size)} · ${
                  stored.core === "gba" ? "GBA" : "GB"
                }</span>
                <div class="games-rom-actions">
                  <button type="button" class="btn btn-primary" data-emu-continue>Continue</button>
                  <label class="btn btn-soft">
                    Replace ROM
                    <input type="file" accept=".gb,.gbc,.gba,.zip,application/octet-stream" hidden data-rom-replace />
                  </label>
                  <button type="button" class="btn btn-ghost" data-rom-clear>Remove</button>
                </div>
              </div>`
            : `<label class="btn btn-primary">
                Choose ROM
                <input type="file" accept=".gb,.gbc,.gba,.zip,application/octet-stream" hidden data-rom-pick />
              </label>`
        }
        <p class="muted" style="color:#7f8796;font-size:0.85rem;">
          If the Nintendo logo sits still: click the game, then press A or Start (or Restart in the menu).<br/>
          Keys: arrows · Z = B · X = A · Enter = Start · Shift = Select
        </p>
      </div>`;

    const pick = root.querySelector("[data-rom-pick], [data-rom-replace]");
    pick?.addEventListener("change", async () => {
      const file = pick.files && pick.files[0];
      if (!file) return;
      root.innerHTML = `<div class="games-loading">Saving ROM to this browser…</div>`;
      try {
        const buffer = await file.arrayBuffer();
        const core = detectCore(file.name);
        const record = await saveRomRecord({
          name: ensureGameName(file.name),
          buffer,
          core,
        });
        if (destroyed) return;
        showReady(record);
      } catch (err) {
        root.innerHTML = `<div class="games-error">${escapeHtml(
          err?.message || "Could not save ROM."
        )}<br/><button type="button" class="btn btn-soft" data-rom-retry>Try again</button></div>`;
        root.querySelector("[data-rom-retry]")?.addEventListener("click", () => boot());
      }
    });

    root.querySelector("[data-emu-continue]")?.addEventListener("click", () => showReady(stored));
    root.querySelector("[data-rom-clear]")?.addEventListener("click", async () => {
      if (!confirm("Remove the saved ROM from this browser?")) return;
      try {
        await clearStoredRom();
      } catch {
        /* ignore */
      }
      if (!destroyed) renderGate(null);
    });
  }

  function showReady(record) {
    if (!record?.buffer) return;
    const core = record.core || detectCore(record.name);
    const gameName = ensureGameName(record.name || "pokemon-red.gb");
    root.innerHTML = `
      <div class="games-rom-gate">
        <strong>Ready: ${escapeHtml(gameName)}</strong>
        <p>System: <code>${core === "gba" ? "Game Boy Advance" : "Game Boy"}</code></p>
        <button type="button" class="btn btn-primary" data-emu-start>Click to play</button>
        <p class="muted" style="color:#7f8796;font-size:0.85rem;">
          Click unlocks audio so the boot logo can finish.
        </p>
      </div>`;
    root.querySelector("[data-emu-start]")?.addEventListener(
      "click",
      () => launchInFrame(record, gameName, core),
      { once: true }
    );
  }

  function launchInFrame(record, gameName, core) {
    root.innerHTML = `
      <div class="games-emu-shell">
        <div class="games-emu-wrap">
          <iframe class="games-emu-iframe" title="Pokemon emulator" allow="autoplay; gamepad; fullscreen"></iframe>
        </div>
        <p class="games-emu-hint">
          Stuck on the Nintendo logo? Click inside the game, press <strong>A</strong> / <strong>Start</strong>,
          or open the emulator menu and hit Restart.
        </p>
      </div>`;

    iframe = root.querySelector("iframe");
    iframe.srcdoc = playerSrcDoc();

    onMessage = (event) => {
      if (event.source !== iframe?.contentWindow) return;
      if (event.data?.type === "emu-frame-ready") {
        const bytes = toTransferableBuffer(record.buffer);
        iframe.contentWindow.postMessage(
          {
            type: "start-rom",
            name: gameName,
            core,
            bytes,
          },
          "*",
          [bytes]
        );
      }
      if (event.data?.type === "emu-error") {
        root.innerHTML = `<div class="games-error">Emulator failed to start.<br/><button type="button" class="btn btn-soft" data-rom-retry>Try again</button></div>`;
        root.querySelector("[data-rom-retry]")?.addEventListener("click", () => boot());
      }
    };
    window.addEventListener("message", onMessage);
  }

  boot();

  return {
    destroy() {
      destroyed = true;
      if (onMessage) window.removeEventListener("message", onMessage);
      onMessage = null;
      if (iframe) {
        try {
          iframe.srcdoc = "";
          iframe.src = "about:blank";
        } catch {
          /* ignore */
        }
      }
      iframe = null;
      root.innerHTML = "";
    },
  };
}
