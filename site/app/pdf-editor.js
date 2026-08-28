/**
 * Session-only PDF annotator for the CRM.
 * Renders with PDF.js; drawings live in memory until download or leave.
 */
(function () {
  const PDFJS_VERSION = "4.10.38";
  const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
  const PDFLIB_CDN = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";

  const TOOLS = [
    { id: "select", label: "Select", title: "Select, move, and resize text & patches" },
    { id: "pen", label: "Pen", title: "Freehand pen" },
    { id: "highlight", label: "Highlight", title: "Highlighter" },
    { id: "text", label: "Text", title: "Add text — then move, resize, and change font" },
    {
      id: "blank",
      label: "Blank",
      title: "Drag to copy a blank chunk from the form, then click to paste it over content",
    },
    { id: "stamp", label: "Stamp", title: "Place an image stamp" },
    { id: "eraser", label: "Eraser", title: "Erase strokes / delete items" },
  ];

  const COLORS = ["#141820", "#c0392b", "#1f7a6c", "#3d4f8c", "#b8953e", "#ffffff"];

  const FONTS = [
    { id: "Outfit", label: "Outfit" },
    { id: "Georgia", label: "Georgia" },
    { id: "Times New Roman", label: "Times" },
    { id: "Arial", label: "Arial" },
    { id: "Verdana", label: "Verdana" },
    { id: "Courier New", label: "Courier" },
    { id: "Trebuchet MS", label: "Trebuchet" },
    { id: "Palatino Linotype", label: "Palatino" },
  ];

  const HANDLE = 10;
  const measureCtx = document.createElement("canvas").getContext("2d");

  let pdfjsLib = null;
  let pdfLib = null;
  let host = null;
  let opts = { toast: () => {} };
  let textStyleHistPending = false;
  let keysBound = false;

  const state = {
    pdfDoc: null,
    fileName: "",
    scale: 1.15,
    annScale: 1.15,
    fitWidth: false,
    pageCount: 0,
    currentPage: 1,
    tool: "pen",
    color: "#141820",
    strokeWidth: 2.5,
    fontFamily: "Outfit",
    fontSize: 18,
    annotations: new Map(),
    undoStack: [],
    redoStack: [],
    stampDataUrl: null,
    clipboardPatch: null, // { dataUrl, w, h }
    marquee: null, // { pageNum, x0, y0, x1, y1 }
    drawing: null,
    selectedId: null,
    selectedPage: null,
    drag: null,
    dragMoved: false,
    rendering: false,
  };

  const stampCache = new Map();

  function toast(msg) {
    if (typeof opts.toast === "function") opts.toast(msg);
  }

  function uid() {
    return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function pageAnns(pageNum) {
    if (!state.annotations.has(pageNum)) state.annotations.set(pageNum, []);
    return state.annotations.get(pageNum);
  }

  function cloneAnn(a) {
    if (a.type === "stroke" || a.type === "highlight") {
      return {
        ...a,
        points: a.points.map((p) => ({ x: p.x, y: p.y })),
      };
    }
    return { ...a };
  }

  function snapshot() {
    const copy = [];
    state.annotations.forEach((list, page) => {
      copy.push([page, list.map(cloneAnn)]);
    });
    return copy;
  }

  function restore(snap) {
    state.annotations = new Map(snap.map(([page, list]) => [page, list.map(cloneAnn)]));
  }

  function pushHistory() {
    state.undoStack.push(snapshot());
    if (state.undoStack.length > 80) state.undoStack.shift();
    state.redoStack = [];
    updateToolbarState();
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(snapshot());
    restore(state.undoStack.pop());
    clearSelection();
    redrawAllOverlays();
    updateToolbarState();
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(snapshot());
    restore(state.redoStack.pop());
    clearSelection();
    redrawAllOverlays();
    updateToolbarState();
  }

  function clearSelection() {
    state.selectedId = null;
    state.selectedPage = null;
    syncTextControls();
  }

  function findAnnById(id) {
    if (!id) return null;
    for (const [page, list] of state.annotations) {
      const ann = list.find((a) => a.id === id);
      if (ann) return { page, ann };
    }
    return null;
  }

  function textFontCss(a) {
    const weight = a.fontWeight || 600;
    const family = a.fontFamily || state.fontFamily || "Outfit";
    const size = a.fontSize || state.fontSize || 18;
    return `${weight} ${size}px "${family}", system-ui, sans-serif`;
  }

  function textBounds(a, ctx = measureCtx) {
    ctx.save();
    ctx.font = textFontCss(a);
    const metrics = ctx.measureText(a.text || " ");
    const w = Math.max(24, metrics.width);
    const ascent = metrics.actualBoundingBoxAscent || a.fontSize * 0.8;
    const descent = metrics.actualBoundingBoxDescent || a.fontSize * 0.25;
    ctx.restore();
    return {
      x: a.x - 3,
      y: a.y - ascent - 3,
      w: w + 6,
      h: ascent + descent + 6,
      ascent,
      descent,
    };
  }

  function isImageAnn(a) {
    return a && (a.type === "stamp" || a.type === "patch");
  }

  function imageBounds(a) {
    return { x: a.x, y: a.y, w: a.w, h: a.h };
  }

  function resizeHandleRect(bounds) {
    return {
      x: bounds.x + bounds.w - HANDLE / 2,
      y: bounds.y + bounds.h - HANDLE / 2,
      w: HANDLE,
      h: HANDLE,
    };
  }

  function hitResizeHandle(ann, x, y) {
    if (!ann) return false;
    const bounds = ann.type === "text" ? textBounds(ann) : isImageAnn(ann) ? imageBounds(ann) : null;
    if (!bounds) return false;
    const h = resizeHandleRect(bounds);
    return x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h;
  }

  function normalizeRect(x0, y0, x1, y1) {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    return { x, y, w, h };
  }

  function capturePageRegion(pageNum, x, y, w, h) {
    const pageEl = host.querySelector(`.pdf-page[data-page="${pageNum}"]`);
    const canvas = pageEl?.querySelector(".pdf-page__canvas");
    const overlay = pageEl?.querySelector(".pdf-page__overlay");
    if (!canvas || !overlay) throw new Error("Could not capture page area");
    const ratio = Number(overlay.dataset.ratio) || 1;
    const sx = Math.max(0, Math.floor(x * ratio));
    const sy = Math.max(0, Math.floor(y * ratio));
    const sw = Math.max(1, Math.min(Math.floor(w * ratio), canvas.width - sx));
    const sh = Math.max(1, Math.min(Math.floor(h * ratio), canvas.height - sy));
    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    out.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return {
      dataUrl: out.toDataURL("image/png"),
      w: sw / ratio,
      h: sh / ratio,
    };
  }

  function pastePatchAt(pageNum, x, y) {
    const clip = state.clipboardPatch;
    if (!clip) return null;
    pushHistory();
    const ann = {
      id: uid(),
      type: "patch",
      x: x - clip.w / 2,
      y: y - clip.h / 2,
      w: clip.w,
      h: clip.h,
      dataUrl: clip.dataUrl,
    };
    pageAnns(pageNum).push(ann);
    selectAnn(ann, pageNum);
    updatePatchStatus();
    return ann;
  }

  function updatePatchStatus() {
    if (!host) return;
    const el = host.querySelector("[data-pdf-patch-status]");
    if (!el) return;
    if (state.clipboardPatch) {
      el.hidden = false;
      el.textContent = "Blank patch ready — click to paste, or drag again to copy a new area";
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  }

  function selectAnn(ann, pageNum) {
    state.selectedId = ann ? ann.id : null;
    state.selectedPage = ann ? pageNum : null;
    if (ann && ann.type === "text") {
      state.color = ann.color || state.color;
      state.fontFamily = ann.fontFamily || state.fontFamily;
      state.fontSize = ann.fontSize || state.fontSize;
    }
    syncTextControls();
    syncSwatches();
    const colorEl = host?.querySelector("[data-pdf-color]");
    if (colorEl && ann?.type === "text") colorEl.value = state.color;
    // Keep keyboard focus on the stage so Delete/Backspace reaches the editor.
    host?.querySelector("[data-pdf-stage]")?.focus({ preventScroll: true });
  }

  function deleteSelected() {
    if (!state.selectedId) return false;
    const id = state.selectedId;
    pushHistory();
    state.annotations.forEach((list, page) => {
      state.annotations.set(
        page,
        list.filter((a) => a.id !== id)
      );
    });
    clearSelection();
    redrawAllOverlays();
    updateToolbarState();
    return true;
  }

  function beginTextStyleHistory() {
    if (!findAnnById(state.selectedId)?.ann || findAnnById(state.selectedId).ann.type !== "text") {
      return;
    }
    if (!textStyleHistPending) {
      pushHistory();
      textStyleHistPending = true;
    }
  }

  function endTextStyleHistory() {
    textStyleHistPending = false;
  }

  function applySelectedTextStyle(mutator) {
    const found = findAnnById(state.selectedId);
    if (!found || found.ann.type !== "text") return false;
    beginTextStyleHistory();
    mutator(found.ann);
    redrawAllOverlays();
    return true;
  }

  async function loadPdfJs() {
    if (pdfjsLib) return pdfjsLib;
    pdfjsLib = await import(`${PDFJS_CDN}/build/pdf.min.mjs`);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/build/pdf.worker.min.mjs`;
    return pdfjsLib;
  }

  async function loadPdfLib() {
    if (pdfLib) return pdfLib;
    if (window.PDFLib) {
      pdfLib = window.PDFLib;
      return pdfLib;
    }
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PDFLIB_CDN;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load pdf-lib"));
      document.head.appendChild(s);
    });
    pdfLib = window.PDFLib;
    return pdfLib;
  }

  function mount(container, options = {}) {
    destroy();
    host = container;
    opts = options || {};
    host.innerHTML = shellHtml();
    bindShell();
    showEmpty();
  }

  function destroy() {
    if (state.pdfDoc) {
      try {
        state.pdfDoc.destroy();
      } catch {
        /* ignore */
      }
    }
    state.pdfDoc = null;
    state.fileName = "";
    state.annotations = new Map();
    state.undoStack = [];
    state.redoStack = [];
    state.drawing = null;
    state.selectedId = null;
    state.selectedPage = null;
    state.drag = null;
    state.dragMoved = false;
    state.stampDataUrl = null;
    state.clipboardPatch = null;
    state.marquee = null;
    state.pageCount = 0;
    state.currentPage = 1;
    state.rendering = false;
    textStyleHistPending = false;
    unbindKeys();
    if (host) host.innerHTML = "";
    host = null;
  }

  function bindKeys() {
    if (keysBound) return;
    document.addEventListener("keydown", onKeyDown, true);
    keysBound = true;
  }

  function unbindKeys() {
    if (!keysBound) return;
    document.removeEventListener("keydown", onKeyDown, true);
    keysBound = false;
  }

  function shellHtml() {
    return `
      <div class="pdf-editor">
        <div class="pdf-editor__banner" role="note">
          Edits stay in this session only — not saved to the CRM. Use <strong>Blank</strong> to copy a clean chunk of the form and paste it over fields you want to write over.
        </div>
        <p class="pdf-editor__patch-status" data-pdf-patch-status hidden></p>
        <div class="pdf-editor__toolbar" role="toolbar" aria-label="PDF tools">
          <div class="pdf-editor__group">
            <button type="button" class="btn btn-primary" data-pdf-action="open">Open PDF</button>
            <input type="file" accept="application/pdf,.pdf" data-pdf-file hidden />
            <input type="file" accept="image/*" data-pdf-stamp-file hidden />
            <button type="button" class="btn btn-soft" data-pdf-action="download" disabled>Download</button>
          </div>
          <div class="pdf-editor__group pdf-editor__tools" role="group" aria-label="Annotation tools">
            ${TOOLS.map(
              (t) =>
                `<button type="button" class="btn btn-soft pdf-tool${
                  t.id === state.tool ? " is-active" : ""
                }" data-pdf-tool="${t.id}" title="${t.title}">${t.label}</button>`
            ).join("")}
          </div>
          <div class="pdf-editor__group">
            <label class="pdf-editor__field">
              <span>Color</span>
              <input type="color" data-pdf-color value="${state.color}" />
            </label>
            <div class="pdf-editor__swatches" aria-label="Quick colors">
              ${COLORS.map(
                (c) =>
                  `<button type="button" class="pdf-swatch${
                    c === state.color ? " is-active" : ""
                  }" data-pdf-swatch="${c}" style="--swatch:${c}" title="${c}"></button>`
              ).join("")}
            </div>
            <label class="pdf-editor__field">
              <span>Stroke</span>
              <input type="range" min="1" max="24" step="0.5" value="${state.strokeWidth}" data-pdf-width />
            </label>
          </div>
          <div class="pdf-editor__group pdf-editor__text-props" role="group" aria-label="Text style">
            <label class="pdf-editor__field">
              <span>Font</span>
              <select data-pdf-font>
                ${FONTS.map(
                  (f) =>
                    `<option value="${f.id}"${
                      f.id === state.fontFamily ? " selected" : ""
                    }>${f.label}</option>`
                ).join("")}
              </select>
            </label>
            <label class="pdf-editor__field">
              <span>Text size</span>
              <input type="range" min="8" max="96" step="1" value="${state.fontSize}" data-pdf-font-size />
              <span class="pdf-editor__size-val" data-pdf-font-size-val>${Math.round(state.fontSize)}</span>
            </label>
          </div>
          <div class="pdf-editor__group">
            <button type="button" class="btn btn-soft" data-pdf-action="undo" disabled title="Undo">Undo</button>
            <button type="button" class="btn btn-soft" data-pdf-action="redo" disabled title="Redo">Redo</button>
            <button type="button" class="btn btn-soft" data-pdf-action="clear-page" disabled title="Clear this page">Clear page</button>
          </div>
          <div class="pdf-editor__group">
            <button type="button" class="btn btn-soft" data-pdf-action="zoom-out" disabled aria-label="Zoom out">−</button>
            <button type="button" class="btn btn-soft" data-pdf-action="zoom-in" disabled aria-label="Zoom in">+</button>
            <button type="button" class="btn btn-soft" data-pdf-action="fit" disabled>Fit width</button>
            <button type="button" class="btn btn-soft" data-pdf-action="prev" disabled aria-label="Previous page">‹</button>
            <span class="pdf-editor__page" data-pdf-page>0 / 0</span>
            <button type="button" class="btn btn-soft" data-pdf-action="next" disabled aria-label="Next page">›</button>
          </div>
        </div>
        <div class="pdf-editor__stage" data-pdf-stage tabindex="0"></div>
      </div>
    `;
  }

  function bindShell() {
    const root = host.querySelector(".pdf-editor");
    const fileInput = root.querySelector("[data-pdf-file]");
    const stampInput = root.querySelector("[data-pdf-stamp-file]");

    root.querySelector('[data-pdf-action="open"]').addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (file) await openFile(file);
    });

    stampInput.addEventListener("change", async () => {
      const file = stampInput.files && stampInput.files[0];
      stampInput.value = "";
      if (!file) return;
      try {
        state.stampDataUrl = await readFileAsDataUrl(file);
        setTool("stamp");
        toast("Stamp ready — click the page to place it");
      } catch {
        toast("Could not load stamp image");
      }
    });

    root.querySelectorAll("[data-pdf-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tool = btn.dataset.pdfTool;
        if (tool === "stamp" && !state.stampDataUrl) {
          stampInput.click();
          return;
        }
        setTool(tool);
      });
    });

    root.querySelector("[data-pdf-color]").addEventListener("input", (e) => {
      state.color = e.target.value;
      syncSwatches();
      applySelectedTextStyle((ann) => {
        ann.color = state.color;
      });
    });
    root.querySelector("[data-pdf-color]").addEventListener("change", endTextStyleHistory);
    root.querySelectorAll("[data-pdf-swatch]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.color = btn.dataset.pdfSwatch;
        root.querySelector("[data-pdf-color]").value = state.color;
        syncSwatches();
        if (applySelectedTextStyle((ann) => {
          ann.color = state.color;
        })) {
          endTextStyleHistory();
        }
      });
    });
    root.querySelector("[data-pdf-width]").addEventListener("input", (e) => {
      state.strokeWidth = Number(e.target.value) || 2.5;
    });

    root.querySelector("[data-pdf-font]").addEventListener("change", (e) => {
      state.fontFamily = e.target.value || "Outfit";
      if (applySelectedTextStyle((ann) => {
        ann.fontFamily = state.fontFamily;
      })) {
        endTextStyleHistory();
      }
    });
    const fontSizeEl = root.querySelector("[data-pdf-font-size]");
    fontSizeEl.addEventListener("input", (e) => {
      state.fontSize = Math.max(8, Math.min(96, Number(e.target.value) || 18));
      const val = root.querySelector("[data-pdf-font-size-val]");
      if (val) val.textContent = String(Math.round(state.fontSize));
      applySelectedTextStyle((ann) => {
        ann.fontSize = state.fontSize;
      });
    });
    fontSizeEl.addEventListener("change", endTextStyleHistory);

    root.querySelector('[data-pdf-action="download"]').addEventListener("click", () => downloadAnnotated());
    root.querySelector('[data-pdf-action="undo"]').addEventListener("click", undo);
    root.querySelector('[data-pdf-action="redo"]').addEventListener("click", redo);
    root.querySelector('[data-pdf-action="clear-page"]').addEventListener("click", clearCurrentPage);
    root.querySelector('[data-pdf-action="zoom-in"]').addEventListener("click", () => setScale(state.scale * 1.15));
    root.querySelector('[data-pdf-action="zoom-out"]').addEventListener("click", () => setScale(state.scale / 1.15));
    root.querySelector('[data-pdf-action="fit"]').addEventListener("click", () => {
      state.fitWidth = true;
      renderPages();
    });
    root.querySelector('[data-pdf-action="prev"]').addEventListener("click", () => goPage(state.currentPage - 1));
    root.querySelector('[data-pdf-action="next"]').addEventListener("click", () => goPage(state.currentPage + 1));

    const stage = root.querySelector("[data-pdf-stage]");
    stage.addEventListener("scroll", onStageScroll, { passive: true });
    bindKeys();
  }

  function showEmpty() {
    const stage = host.querySelector("[data-pdf-stage]");
    stage.innerHTML = `
      <div class="pdf-editor__empty">
        <strong>Open a PDF to mark it up</strong>
        <p>Use Blank to copy a clean area from the form and paste it over fields, then write with Text. Nothing is saved to the CRM — download a copy if you need to keep it.</p>
        <button type="button" class="btn btn-primary" data-pdf-empty-open>Open PDF</button>
      </div>
    `;
    stage.querySelector("[data-pdf-empty-open]").addEventListener("click", () => {
      host.querySelector("[data-pdf-file]").click();
    });
    updatePatchStatus();
    updateToolbarState();
  }

  function setTool(tool, { keepSelection = false } = {}) {
    state.tool = tool;
    if (!keepSelection) clearSelection();
    host.querySelectorAll("[data-pdf-tool]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.pdfTool === tool);
    });
    const stage = host.querySelector("[data-pdf-stage]");
    if (stage) stage.dataset.tool = tool;
    redrawAllOverlays();
  }

  function syncSwatches() {
    if (!host) return;
    host.querySelectorAll("[data-pdf-swatch]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.pdfSwatch === state.color);
    });
  }

  function syncTextControls() {
    if (!host) return;
    const fontEl = host.querySelector("[data-pdf-font]");
    const sizeEl = host.querySelector("[data-pdf-font-size]");
    const sizeVal = host.querySelector("[data-pdf-font-size-val]");
    if (fontEl) fontEl.value = state.fontFamily;
    if (sizeEl) sizeEl.value = String(state.fontSize);
    if (sizeVal) sizeVal.textContent = String(Math.round(state.fontSize));
    const props = host.querySelector(".pdf-editor__text-props");
    if (props) {
      const selectedText = findAnnById(state.selectedId)?.ann?.type === "text";
      props.classList.toggle("is-editing", !!selectedText);
    }
  }

  function updateToolbarState() {
    if (!host) return;
    const hasDoc = !!state.pdfDoc;
    const setDisabled = (action, disabled) => {
      const el = host.querySelector(`[data-pdf-action="${action}"]`);
      if (el) el.disabled = disabled;
    };
    setDisabled("download", !hasDoc);
    setDisabled("clear-page", !hasDoc);
    setDisabled("zoom-in", !hasDoc);
    setDisabled("zoom-out", !hasDoc);
    setDisabled("fit", !hasDoc);
    setDisabled("prev", !hasDoc || state.currentPage <= 1);
    setDisabled("next", !hasDoc || state.currentPage >= state.pageCount);
    setDisabled("undo", !state.undoStack.length);
    setDisabled("redo", !state.redoStack.length);
    const pageEl = host.querySelector("[data-pdf-page]");
    if (pageEl) {
      pageEl.textContent = hasDoc ? `${state.currentPage} / ${state.pageCount}` : "0 / 0";
    }
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsArrayBuffer(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.readAsDataURL(file);
    });
  }

  async function openFile(file) {
    try {
      await loadPdfJs();
      const bytes = await readFileAsArrayBuffer(file);
      if (state.pdfDoc) {
        try {
          state.pdfDoc.destroy();
        } catch {
          /* ignore */
        }
      }
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
      const pdfDoc = await loadingTask.promise;
      state.pdfDoc = pdfDoc;
      state.fileName = file.name || "document.pdf";
      state.pageCount = pdfDoc.numPages;
      state.currentPage = 1;
      state.annotations = new Map();
      state.undoStack = [];
      state.redoStack = [];
      clearSelection();
      state.fitWidth = true;
      state.annScale = state.scale;
      await renderPages();
      toast(`Opened ${state.fileName}`);
    } catch (err) {
      console.error(err);
      toast(err.message || "Could not open PDF");
      showEmpty();
    }
  }

  function stageWidth() {
    const stage = host.querySelector("[data-pdf-stage]");
    return Math.max(320, (stage?.clientWidth || 800) - 48);
  }

  async function setScale(next) {
    state.fitWidth = false;
    state.scale = Math.min(3.5, Math.max(0.45, next));
    await renderPages();
  }

  function scaleAnnList(list, k) {
    for (const a of list) {
      if (a.type === "stroke" || a.type === "highlight") {
        a.points = a.points.map((p) => ({ x: p.x * k, y: p.y * k }));
        a.width *= k;
      } else if (a.type === "text") {
        a.x *= k;
        a.y *= k;
        a.fontSize *= k;
      } else if (a.type === "stamp" || a.type === "patch") {
        a.x *= k;
        a.y *= k;
        a.w *= k;
        a.h *= k;
      }
    }
  }

  function rescaleAnnotations(fromScale, toScale) {
    if (!fromScale || !toScale || fromScale === toScale) return;
    const k = toScale / fromScale;
    state.annotations.forEach((list) => scaleAnnList(list, k));
    for (const snap of state.undoStack) {
      for (const [, list] of snap) scaleAnnList(list, k);
    }
    for (const snap of state.redoStack) {
      for (const [, list] of snap) scaleAnnList(list, k);
    }
    state.annScale = toScale;
  }

  async function renderPages() {
    if (!state.pdfDoc || !host || state.rendering) return;
    state.rendering = true;
    const stage = host.querySelector("[data-pdf-stage]");
    const scrollTop = stage.scrollTop;
    stage.innerHTML = `<div class="pdf-editor__pages" data-pdf-pages></div>`;
    const pagesEl = stage.querySelector("[data-pdf-pages]");
    stage.dataset.tool = state.tool;

    try {
      // Resolve target scale from first page when fitting width
      if (state.fitWidth) {
        const first = await state.pdfDoc.getPage(1);
        const base = first.getViewport({ scale: 1 });
        state.scale = stageWidth() / base.width;
      }
      rescaleAnnotations(state.annScale, state.scale);

      for (let pageNum = 1; pageNum <= state.pageCount; pageNum++) {
        const page = await state.pdfDoc.getPage(pageNum);
        const scale = state.scale;
        const viewport = page.getViewport({ scale });
        const wrap = document.createElement("div");
        wrap.className = "pdf-page";
        wrap.dataset.page = String(pageNum);
        wrap.style.width = `${viewport.width}px`;
        wrap.style.height = `${viewport.height}px`;

        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page__canvas";
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        await page.render({ canvasContext: ctx, viewport }).promise;

        const overlay = document.createElement("canvas");
        overlay.className = "pdf-page__overlay";
        overlay.width = Math.floor(viewport.width * ratio);
        overlay.height = Math.floor(viewport.height * ratio);
        overlay.style.width = `${viewport.width}px`;
        overlay.style.height = `${viewport.height}px`;
        overlay.dataset.page = String(pageNum);
        overlay.dataset.ratio = String(ratio);
        overlay.dataset.cssW = String(viewport.width);
        overlay.dataset.cssH = String(viewport.height);

        wrap.appendChild(canvas);
        wrap.appendChild(overlay);
        pagesEl.appendChild(wrap);
        bindOverlay(overlay, pageNum, viewport.width, viewport.height, ratio);
        drawOverlay(overlay, pageNum, ratio);
      }
      stage.scrollTop = scrollTop;
      updateToolbarState();
    } finally {
      state.rendering = false;
    }
  }

  function pointerPos(overlay, event, cssW, cssH) {
    const rect = overlay.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * cssW;
    const y = ((event.clientY - rect.top) / rect.height) * cssH;
    return { x, y };
  }

  function hitTest(pageNum, x, y) {
    const list = pageAnns(pageNum);
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.type === "text") {
        const b = textBounds(a);
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return a;
        if (a.id === state.selectedId && hitResizeHandle(a, x, y)) return a;
      } else if (isImageAnn(a)) {
        if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return a;
        if (a.id === state.selectedId && hitResizeHandle(a, x, y)) return a;
      } else if (a.type === "stroke" || a.type === "highlight") {
        const thr = (a.width || 4) + 6;
        for (let p = 1; p < a.points.length; p++) {
          if (distToSegment(x, y, a.points[p - 1], a.points[p]) <= thr) return a;
        }
      }
    }
    return null;
  }

  function distToSegment(x, y, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(x - a.x, y - a.y);
    let t = ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
  }

  function bindOverlay(overlay, pageNum, cssW, cssH, ratio) {
    const onDown = (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      try {
        overlay.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      const pos = pointerPos(overlay, event, cssW, cssH);
      const tool = state.tool;

      // Select / move / resize — also when a text item is already selected under Text tool
      if (tool === "select" || (tool === "text" && state.selectedId)) {
        const selected = findAnnById(state.selectedId)?.ann;
        state.drag = null;
        state.dragMoved = false;

        if (selected && selected.type === "text" && hitResizeHandle(selected, pos.x, pos.y)) {
          selectAnn(selected, pageNum);
          state.drag = {
            mode: "resize-text",
            pageNum,
            id: selected.id,
            startSize: selected.fontSize,
            originY: selected.y - textBounds(selected).ascent,
            before: snapshot(),
          };
          setTool("select", { keepSelection: true });
          drawOverlay(overlay, pageNum, ratio);
          return;
        }

        if (selected && isImageAnn(selected) && hitResizeHandle(selected, pos.x, pos.y)) {
          selectAnn(selected, pageNum);
          state.drag = {
            mode: "resize-image",
            pageNum,
            id: selected.id,
            startW: selected.w,
            startH: selected.h,
            originX: selected.x,
            originY: selected.y,
            before: snapshot(),
          };
          setTool("select", { keepSelection: true });
          drawOverlay(overlay, pageNum, ratio);
          return;
        }

        if (tool === "select") {
          const hit = hitTest(pageNum, pos.x, pos.y);
          if (hit) selectAnn(hit, pageNum);
          else clearSelection();

          if (hit && (hit.type === "text" || isImageAnn(hit))) {
            state.drag = {
              mode: "move",
              pageNum,
              id: hit.id,
              ox: pos.x - hit.x,
              oy: pos.y - hit.y,
              before: snapshot(),
            };
          }
          drawOverlay(overlay, pageNum, ratio);
          return;
        }
      }

      if (tool === "blank") {
        state.marquee = {
          pageNum,
          x0: pos.x,
          y0: pos.y,
          x1: pos.x,
          y1: pos.y,
        };
        state.drag = {
          mode: "marquee",
          pageNum,
          startX: pos.x,
          startY: pos.y,
        };
        drawOverlay(overlay, pageNum, ratio);
        return;
      }

      if (tool === "eraser") {
        const hit = hitTest(pageNum, pos.x, pos.y);
        if (hit) {
          pushHistory();
          state.annotations.set(
            pageNum,
            pageAnns(pageNum).filter((a) => a.id !== hit.id)
          );
          clearSelection();
          drawOverlay(overlay, pageNum, ratio);
        }
        return;
      }

      if (tool === "text") {
        // Clicking existing text selects it for editing instead of placing new
        const existing = hitTest(pageNum, pos.x, pos.y);
        if (existing && existing.type === "text") {
          selectAnn(existing, pageNum);
          setTool("select", { keepSelection: true });
          state.drag = {
            mode: "move",
            pageNum,
            id: existing.id,
            ox: pos.x - existing.x,
            oy: pos.y - existing.y,
            before: snapshot(),
          };
          drawOverlay(overlay, pageNum, ratio);
          return;
        }

        const text = window.prompt("Text to place:", "");
        if (text == null || !String(text).trim()) return;
        pushHistory();
        const ann = {
          id: uid(),
          type: "text",
          x: pos.x,
          y: pos.y,
          text: String(text).trim(),
          color: state.color,
          fontSize: state.fontSize,
          fontFamily: state.fontFamily,
          fontWeight: 600,
        };
        pageAnns(pageNum).push(ann);
        selectAnn(ann, pageNum);
        setTool("select", { keepSelection: true });
        toast("Text placed — drag to move, corner handle to resize, toolbar to change font");
        drawOverlay(overlay, pageNum, ratio);
        return;
      }

      if (tool === "stamp") {
        if (!state.stampDataUrl) {
          host.querySelector("[data-pdf-stamp-file]").click();
          return;
        }
        pushHistory();
        const size = Math.max(48, state.strokeWidth * 18);
        pageAnns(pageNum).push({
          id: uid(),
          type: "stamp",
          x: pos.x - size / 2,
          y: pos.y - size / 2,
          w: size,
          h: size,
          dataUrl: state.stampDataUrl,
        });
        drawOverlay(overlay, pageNum, ratio);
        return;
      }

      if (tool === "pen" || tool === "highlight") {
        pushHistory();
        state.drawing = {
          pageNum,
          ann: {
            id: uid(),
            type: tool === "highlight" ? "highlight" : "stroke",
            points: [pos],
            color: state.color,
            width: tool === "highlight" ? Math.max(8, state.strokeWidth * 4) : state.strokeWidth,
            opacity: tool === "highlight" ? 0.35 : 1,
          },
        };
        pageAnns(pageNum).push(state.drawing.ann);
        drawOverlay(overlay, pageNum, ratio);
      }
    };

    const onMove = (event) => {
      if (state.drag && state.drag.pageNum === pageNum) {
        const pos = pointerPos(overlay, event, cssW, cssH);

        if (state.drag.mode === "marquee") {
          state.marquee = {
            pageNum,
            x0: state.drag.startX,
            y0: state.drag.startY,
            x1: pos.x,
            y1: pos.y,
          };
          state.dragMoved = true;
          drawOverlay(overlay, pageNum, ratio);
          return;
        }

        const ann = pageAnns(pageNum).find((a) => a.id === state.drag.id);
        if (!ann) return;

        if (state.drag.mode === "resize-text" && ann.type === "text") {
          const dy = pos.y - state.drag.originY;
          const next = Math.max(8, Math.min(96, dy * 0.85));
          ann.fontSize = next;
          state.fontSize = next;
          syncTextControls();
          state.dragMoved = Math.abs(next - state.drag.startSize) > 0.5;
          drawOverlay(overlay, pageNum, ratio);
          return;
        }

        if (state.drag.mode === "resize-image" && isImageAnn(ann)) {
          const nextW = Math.max(12, pos.x - state.drag.originX);
          const nextH = Math.max(12, pos.y - state.drag.originY);
          ann.w = nextW;
          ann.h = nextH;
          state.dragMoved =
            Math.abs(nextW - state.drag.startW) > 1 || Math.abs(nextH - state.drag.startH) > 1;
          drawOverlay(overlay, pageNum, ratio);
          return;
        }

        ann.x = pos.x - state.drag.ox;
        ann.y = pos.y - state.drag.oy;
        state.dragMoved = true;
        drawOverlay(overlay, pageNum, ratio);
        return;
      }

      // Cursor hint for resize handle
      if (state.tool === "select" && state.selectedId) {
        const selected = findAnnById(state.selectedId)?.ann;
        if (selected && (selected.type === "text" || isImageAnn(selected))) {
          const pos = pointerPos(overlay, event, cssW, cssH);
          overlay.style.cursor = hitResizeHandle(selected, pos.x, pos.y) ? "nwse-resize" : "default";
        }
      }

      if (!state.drawing || state.drawing.pageNum !== pageNum) return;
      const pos = pointerPos(overlay, event, cssW, cssH);
      const pts = state.drawing.ann.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(pos.x - last.x, pos.y - last.y) < 1.2) return;
      pts.push(pos);
      drawOverlay(overlay, pageNum, ratio);
    };

    const onUp = (event) => {
      if (state.drag && state.drag.mode === "marquee" && state.drag.pageNum === pageNum) {
        const pos = event ? pointerPos(overlay, event, cssW, cssH) : null;
        const m = state.marquee;
        state.drag = null;
        state.dragMoved = false;
        state.marquee = null;
        if (m) {
          const rect = normalizeRect(m.x0, m.y0, pos ? pos.x : m.x1, pos ? pos.y : m.y1);
          if (rect.w >= 8 && rect.h >= 8) {
            try {
              state.clipboardPatch = capturePageRegion(pageNum, rect.x, rect.y, rect.w, rect.h);
              updatePatchStatus();
              toast("Blank area copied — click where you want to cover");
            } catch (err) {
              toast(err.message || "Could not copy area");
            }
          } else if (state.clipboardPatch) {
            pastePatchAt(pageNum, m.x0, m.y0);
            toast("Blank pasted — click again to paste more, or use Select to move/resize");
          } else {
            toast("Drag a larger area to copy a blank chunk from the form");
          }
        }
        drawOverlay(overlay, pageNum, ratio);
        updateToolbarState();
        return;
      }

      if (state.drag) {
        if (state.dragMoved && state.drag.before) {
          state.undoStack.push(state.drag.before);
          if (state.undoStack.length > 80) state.undoStack.shift();
          state.redoStack = [];
          updateToolbarState();
        }
        state.drag = null;
        state.dragMoved = false;
      }
      if (state.drawing) {
        const ann = state.drawing.ann;
        if (ann.points.length < 2) {
          state.annotations.set(
            state.drawing.pageNum,
            pageAnns(state.drawing.pageNum).filter((a) => a.id !== ann.id)
          );
          if (state.undoStack.length) state.undoStack.pop();
          drawOverlay(overlay, pageNum, ratio);
        }
        state.drawing = null;
        updateToolbarState();
      }
    };

    const onDblClick = (event) => {
      const pos = pointerPos(overlay, event, cssW, cssH);
      const hit = hitTest(pageNum, pos.x, pos.y);
      if (!hit || hit.type !== "text") return;
      event.preventDefault();
      selectAnn(hit, pageNum);
      setTool("select", { keepSelection: true });
      const next = window.prompt("Edit text:", hit.text);
      if (next == null) return;
      const trimmed = String(next).trim();
      if (!trimmed || trimmed === hit.text) return;
      pushHistory();
      hit.text = trimmed;
      redrawAllOverlays();
    };

    overlay.addEventListener("pointerdown", onDown);
    overlay.addEventListener("pointermove", onMove);
    overlay.addEventListener("pointerup", onUp);
    overlay.addEventListener("pointercancel", onUp);
    overlay.addEventListener("dblclick", onDblClick);
  }

  function stampImage(dataUrl) {
    if (!dataUrl) return null;
    if (stampCache.has(dataUrl)) return stampCache.get(dataUrl);
    const img = new Image();
    img.src = dataUrl;
    stampCache.set(dataUrl, img);
    return img;
  }

  function drawOverlay(overlay, pageNum, ratio) {
    const ctx = overlay.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    for (const a of pageAnns(pageNum)) {
      if (a.type === "stroke" || a.type === "highlight") {
        if (a.points.length < 2) continue;
        ctx.save();
        ctx.globalAlpha = a.opacity == null ? 1 : a.opacity;
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (a.type === "highlight") ctx.globalCompositeOperation = "multiply";
        ctx.beginPath();
        ctx.moveTo(a.points[0].x, a.points[0].y);
        for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x, a.points[i].y);
        ctx.stroke();
        ctx.restore();
      } else if (a.type === "text") {
        ctx.save();
        ctx.fillStyle = a.color;
        ctx.font = textFontCss(a);
        ctx.textBaseline = "alphabetic";
        ctx.fillText(a.text, a.x, a.y);
        if (a.id === state.selectedId) {
          const b = textBounds(a, ctx);
          ctx.strokeStyle = "#1f7a6c";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(b.x, b.y, b.w, b.h);
          ctx.setLineDash([]);
          const handle = resizeHandleRect(b);
          ctx.fillStyle = "#1f7a6c";
          ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.strokeRect(handle.x, handle.y, handle.w, handle.h);
        }
        ctx.restore();
      } else if (isImageAnn(a)) {
        const img = stampImage(a.dataUrl);
        if (img && img.complete && img.naturalWidth) {
          ctx.drawImage(img, a.x, a.y, a.w, a.h);
        } else if (img) {
          img.onload = () => drawOverlay(overlay, pageNum, ratio);
        }
        if (a.id === state.selectedId) {
          ctx.save();
          ctx.strokeStyle = "#1f7a6c";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(a.x, a.y, a.w, a.h);
          ctx.setLineDash([]);
          const handle = resizeHandleRect(imageBounds(a));
          ctx.fillStyle = "#1f7a6c";
          ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.strokeRect(handle.x, handle.y, handle.w, handle.h);
          ctx.restore();
        }
      }
    }

    if (state.marquee && state.marquee.pageNum === pageNum) {
      const r = normalizeRect(
        state.marquee.x0,
        state.marquee.y0,
        state.marquee.x1,
        state.marquee.y1
      );
      ctx.save();
      ctx.strokeStyle = "#1f7a6c";
      ctx.fillStyle = "rgba(31, 122, 108, 0.12)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }

  function redrawAllOverlays() {
    if (!host) return;
    host.querySelectorAll(".pdf-page__overlay").forEach((overlay) => {
      const pageNum = Number(overlay.dataset.page);
      const ratio = Number(overlay.dataset.ratio) || 1;
      drawOverlay(overlay, pageNum, ratio);
    });
  }

  function clearCurrentPage() {
    if (!state.pdfDoc) return;
    if (!pageAnns(state.currentPage).length) return;
    pushHistory();
    state.annotations.set(state.currentPage, []);
    clearSelection();
    redrawAllOverlays();
    updateToolbarState();
  }

  function onStageScroll() {
    const stage = host.querySelector("[data-pdf-stage]");
    const pages = [...stage.querySelectorAll(".pdf-page")];
    if (!pages.length) return;
    const mid = stage.scrollTop + stage.clientHeight / 3;
    let best = 1;
    let bestDist = Infinity;
    for (const page of pages) {
      const top = page.offsetTop;
      const dist = Math.abs(top - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = Number(page.dataset.page);
      }
    }
    if (best !== state.currentPage) {
      state.currentPage = best;
      updateToolbarState();
    }
  }

  function goPage(n) {
    if (!state.pdfDoc) return;
    const page = Math.max(1, Math.min(state.pageCount, n));
    state.currentPage = page;
    const el = host.querySelector(`.pdf-page[data-page="${page}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    updateToolbarState();
  }

  function onKeyDown(event) {
    if (!host) return;
    const target = event.target;
    const tag = (target && target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
      return;
    }
    // Only handle shortcuts while this PDF view is mounted/visible.
    if (host.hidden || host.closest("[hidden]")) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (!state.selectedId) return;
      event.preventDefault();
      event.stopPropagation();
      deleteSelected();
    }
  }

  async function ensureImageLoaded(img) {
    if (img.complete && img.naturalWidth) return;
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  }

  async function renderPageComposite(pageNum) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    const k = 2 / state.scale;
    for (const a of pageAnns(pageNum)) {
      if (a.type === "stroke" || a.type === "highlight") {
        if (a.points.length < 2) continue;
        ctx.save();
        ctx.globalAlpha = a.opacity == null ? 1 : a.opacity;
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.width * k;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (a.type === "highlight") ctx.globalCompositeOperation = "multiply";
        ctx.beginPath();
        ctx.moveTo(a.points[0].x * k, a.points[0].y * k);
        for (let i = 1; i < a.points.length; i++) {
          ctx.lineTo(a.points[i].x * k, a.points[i].y * k);
        }
        ctx.stroke();
        ctx.restore();
      } else if (a.type === "text") {
        ctx.save();
        ctx.fillStyle = a.color;
        const scaled = {
          ...a,
          fontSize: a.fontSize * k,
        };
        ctx.font = textFontCss(scaled);
        ctx.textBaseline = "alphabetic";
        ctx.fillText(a.text, a.x * k, a.y * k);
        ctx.restore();
      } else if (isImageAnn(a)) {
        const img = stampImage(a.dataUrl);
        if (img) {
          await ensureImageLoaded(img);
          if (img.naturalWidth) {
            ctx.drawImage(img, a.x * k, a.y * k, a.w * k, a.h * k);
          }
        }
      }
    }

    return canvas.toDataURL("image/jpeg", 0.92);
  }

  function dataUrlToUint8(dataUrl) {
    const b64 = dataUrl.split(",")[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function downloadAnnotated() {
    if (!state.pdfDoc) return;
    try {
      await loadPdfLib();
      const { PDFDocument } = pdfLib;
      const doc = await PDFDocument.create();
      for (let pageNum = 1; pageNum <= state.pageCount; pageNum++) {
        const dataUrl = await renderPageComposite(pageNum);
        const bytes = dataUrlToUint8(dataUrl);
        const img = await doc.embedJpg(bytes);
        const page = doc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const pdfBytes = await doc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const base = state.fileName.replace(/\.pdf$/i, "") || "document";
      a.href = url;
      a.download = `${base}-marked.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Downloaded marked-up PDF");
    } catch (err) {
      console.error(err);
      toast(err.message || "Could not download PDF");
    }
  }

  window.PdfEditor = {
    mount,
    destroy,
    isMounted: () => !!host,
  };
})();
