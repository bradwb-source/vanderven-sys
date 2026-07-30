import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import {
  PDFDocument,
  rgb,
  StandardFonts,
} from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const SHELL_HTML = '\n<div class="crm-pdf">\n  <aside class="crm-pdf__toolbar" aria-label="PDF tools">\n    <div class="crm-pdf__group">\n      <button type="button" class="pdf-tool is-active" data-tool="select"><span>Move</span></button>\n      <button type="button" class="pdf-tool" data-tool="text"><span>Text</span></button>\n      <button type="button" class="pdf-tool" data-tool="pen"><span>Draw</span></button>\n      <button type="button" class="pdf-tool" data-tool="highlight"><span>Highlight</span></button>\n      <button type="button" class="pdf-tool" data-tool="signature"><span>Sign</span></button>\n      <button type="button" class="pdf-tool" data-tool="image"><span>Image</span></button>\n    </div>\n    <div class="crm-pdf__group crm-pdf__group--stack">\n      <label class="pdf-field"><span>Ink</span><input type="color" id="ink-color" value="#1a1f2a" /></label>\n      <label class="pdf-field"><span>Size</span><input type="range" id="ink-size" min="1" max="18" value="3" /></label>\n      <label class="pdf-field"><span>Text size</span><input type="range" id="text-size" min="10" max="48" value="16" /></label>\n    </div>\n    <div class="crm-pdf__group">\n      <button type="button" class="pdf-tool pdf-tool--ghost" id="btn-undo" disabled>Undo</button>\n      <button type="button" class="pdf-tool pdf-tool--ghost" id="btn-delete" disabled>Delete</button>\n      <button type="button" class="pdf-tool pdf-tool--ghost" id="btn-clear" disabled>Clear</button>\n    </div>\n    <div class="crm-pdf__group crm-pdf__group--end">\n      <button type="button" class="btn btn-soft" id="btn-open">Open PDF</button>\n      <button type="button" class="btn btn-primary" id="btn-download" disabled>Download</button>\n      <input type="file" id="file-input" accept="application/pdf,.pdf" hidden />\n      <input type="file" id="image-input" accept="image/png,image/jpeg,image/webp" hidden />\n    </div>\n  </aside>\n  <section class="crm-pdf__stage pdf-stage" aria-label="PDF canvas">\n    <div class="pdf-drop" id="drop-zone">\n      <div class="pdf-drop__card">\n        <p class="pdf-drop__eyebrow">CRM tool · local only</p>\n        <h2 class="pdf-drop__title">Drop a PDF here</h2>\n        <p class="pdf-drop__lead">Annotate, sign, and download. Nothing is uploaded or saved on the server.</p>\n        <button type="button" class="btn btn-primary" id="btn-open-drop">Choose PDF</button>\n      </div>\n    </div>\n    <div class="pdf-pages" id="pages" hidden></div>\n    <p class="pdf-status" id="status" hidden></p>\n  </section>\n</div>\n<dialog class="pdf-modal" id="signature-modal" aria-labelledby="signature-modal-title">\n  <form method="dialog" class="pdf-modal__panel" id="signature-form">\n    <header class="pdf-modal__head">\n      <h2 id="signature-modal-title">Create signature</h2>\n      <p>Draw or type, then place and drag it on the PDF.</p>\n    </header>\n    <div class="pdf-modal__tabs" role="tablist">\n      <button type="button" class="pdf-tab is-active" data-sig-tab="draw" role="tab" aria-selected="true">Draw</button>\n      <button type="button" class="pdf-tab" data-sig-tab="type" role="tab" aria-selected="false">Type</button>\n    </div>\n    <div class="pdf-modal__body" data-sig-panel="draw">\n      <canvas id="sig-canvas" width="640" height="220" aria-label="Signature drawing pad"></canvas>\n      <button type="button" class="pdf-tool pdf-tool--ghost" id="btn-sig-clear">Clear pad</button>\n    </div>\n    <div class="pdf-modal__body" data-sig-panel="type" hidden>\n      <label class="pdf-field pdf-field--grow">\n        <span>Your name</span>\n        <input type="text" id="sig-typed" placeholder="Jordan Lee" autocomplete="name" maxlength="80" />\n      </label>\n      <p class="pdf-typed-preview" id="sig-typed-preview" aria-hidden="true">Jordan Lee</p>\n    </div>\n    <footer class="pdf-modal__actions">\n      <button type="submit" value="cancel" class="btn btn-soft">Cancel</button>\n      <button type="submit" value="use" class="btn btn-primary" id="btn-sig-use">Use signature</button>\n    </footer>\n  </form>\n</dialog>\n';

export function mountCrmPdfEditor(root) {
  if (!root) return { destroy() {} };
  if (root.dataset.pdfMounted === "1") return { destroy() {} };
  root.dataset.pdfMounted = "1";
  root.innerHTML = SHELL_HTML;
  root.classList.add("crm-pdf-root");

  const $ = (sel, scope = root) => scope.querySelector(sel);
  const $$ = (sel, scope = root) => [...scope.querySelectorAll(sel)];

  let els = {
    drop: $("#drop-zone"),
    pages: $("#pages"),
    status: $("#status"),
    fileInput: $("#file-input"),
    imageInput: $("#image-input"),
    btnOpen: $("#btn-open"),
    btnOpenDrop: $("#btn-open-drop"),
    btnDownload: $("#btn-download"),
    btnUndo: $("#btn-undo"),
    btnDelete: $("#btn-delete"),
    btnClear: $("#btn-clear"),
    inkColor: $("#ink-color"),
    inkSize: $("#ink-size"),
    textSize: $("#text-size"),
    modal: $("#signature-modal"),
    sigForm: $("#signature-form"),
    sigCanvas: $("#sig-canvas"),
    sigTyped: $("#sig-typed"),
    sigTypedPreview: $("#sig-typed-preview"),
    btnSigClear: $("#btn-sig-clear"),
  };

  if (els.modal && els.modal.parentElement !== document.body) {
    document.body.appendChild(els.modal);
  }

  let sigCtx = els.sigCanvas.getContext("2d");
  let sigDrawing = false;
  let sigDirty = false;
  let sigTab = "draw";

const state = {
  tool: "select",
  fileName: "document.pdf",
  pdfBytes: null,
  pdfDoc: null,
  annotations: [],
  selectedId: null,
  history: [],
  inkColor: "#1a1f2a",
  inkSize: 3,
  textSize: 16,
  pendingSignature: null,
  pendingImage: null,
  pageViews: new Map(),
  drawing: null,
  renderToken: 0,
};

function uid() {
  return `a_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function setStatus(message, show = true) {
  els.status.hidden = !show;
  els.status.textContent = message || "";
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

function pushHistory() {
  state.history.push(JSON.stringify(state.annotations));
  if (state.history.length > 60) state.history.shift();
  syncChrome();
}

function undo() {
  const prev = state.history.pop();
  if (!prev) return;
  state.annotations = JSON.parse(prev);
  state.selectedId = null;
  renderAnnotations();
  syncChrome();
}

function syncChrome() {
  const hasDoc = Boolean(state.pdfBytes);
  const hasAnno = state.annotations.length > 0;
  els.btnDownload.disabled = !hasDoc;
  els.btnUndo.disabled = state.history.length === 0;
  els.btnDelete.disabled = !state.selectedId;
  els.btnClear.disabled = !hasAnno;
  $$(".pdf-tool[data-tool]", root).forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tool === state.tool);
  });
}

function setTool(tool) {
  state.tool = tool;
  state.pageViews.forEach((view) => {
    view.pageEl.classList.toggle("is-drawing", tool === "pen" || tool === "highlight");
  });
  if (tool === "signature") openSignatureModal();
  if (tool === "image") els.imageInput.click();
  syncChrome();
}

async function loadPdfFile(file) {
  if (!file || file.type !== "application/pdf") {
    setStatus("Please choose a PDF file.");
    return;
  }
  document.body.classList.add("pdf-editor-busy");
  setStatus("Opening PDF…");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.pdfBytes = bytes;
    state.fileName = file.name || "document.pdf";
    state.annotations = [];
    state.history = [];
    state.selectedId = null;
    state.pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    els.drop.hidden = true;
    els.pages.hidden = false;
    await renderPages();
    setStatus(`${state.fileName} · ${state.pdfDoc.numPages} page${state.pdfDoc.numPages === 1 ? "" : "s"} · local only`);
    syncChrome();
  } catch (err) {
    console.error(err);
    setStatus("Could not open that PDF. Try another file.");
  } finally {
    document.body.classList.remove("pdf-editor-busy");
  }
}

async function renderPages() {
  const token = ++state.renderToken;
  els.pages.innerHTML = "";
  state.pageViews.clear();

  const maxWidth = Math.min(920, els.pages.clientWidth || 920);

  for (let i = 1; i <= state.pdfDoc.numPages; i += 1) {
    if (token !== state.renderToken) return;
    const page = await state.pdfDoc.getPage(i);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = maxWidth / unscaled.width;
    const viewport = page.getViewport({ scale });

    const pageEl = document.createElement("div");
    pageEl.className = "pdf-page";
    pageEl.dataset.pageIndex = String(i - 1);
    pageEl.style.width = `${viewport.width}px`;
    pageEl.style.height = `${viewport.height}px`;

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page__render";
    canvas.width = Math.floor(viewport.width * window.devicePixelRatio);
    canvas.height = Math.floor(viewport.height * window.devicePixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

    const layer = document.createElement("div");
    layer.className = "pdf-page__layer";

    const drawCanvas = document.createElement("canvas");
    drawCanvas.className = "pdf-page__draw";
    drawCanvas.width = canvas.width;
    drawCanvas.height = canvas.height;

    pageEl.append(canvas, layer, drawCanvas);
    els.pages.append(pageEl);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const view = {
      pageIndex: i - 1,
      pageEl,
      layer,
      drawCanvas,
      width: viewport.width,
      height: viewport.height,
      pdfWidth: unscaled.width,
      pdfHeight: unscaled.height,
    };
    state.pageViews.set(i - 1, view);
    wirePageInteractions(view);
  }

  state.pageViews.forEach((view) => {
    view.pageEl.classList.toggle("is-drawing", state.tool === "pen" || state.tool === "highlight");
  });
  renderAnnotations();
}

function annotationsForPage(pageIndex) {
  return state.annotations.filter((a) => a.pageIndex === pageIndex);
}

function renderAnnotations() {
  state.pageViews.forEach((view) => {
    view.layer.innerHTML = "";
    for (const anno of annotationsForPage(view.pageIndex)) {
      view.layer.append(createAnnoEl(anno, view));
    }
  });
  syncChrome();
}

function createAnnoEl(anno, view) {
  const el = document.createElement("div");
  el.className = `pdf-anno pdf-anno--${anno.type}`;
  el.dataset.id = anno.id;
  el.style.left = `${anno.x * 100}%`;
  el.style.top = `${anno.y * 100}%`;
  el.style.width = `${anno.w * 100}%`;
  el.style.height = `${anno.h * 100}%`;
  if (state.selectedId === anno.id) el.classList.add("is-selected");

  if (anno.type === "text") {
    el.textContent = anno.text || "Text";
    el.style.fontSize = `${(anno.fontSize / view.pdfHeight) * view.height}px`;
    el.style.color = anno.color || "#141820";
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      beginTextEdit(anno, el);
    });
  } else if (anno.type === "highlight") {
    el.style.background = anno.color || "rgba(255, 230, 80, 0.38)";
  } else if (anno.type === "pen") {
    el.innerHTML = penSvg(anno);
  } else if (anno.type === "signature" || anno.type === "image") {
    const img = document.createElement("img");
    img.src = anno.imageDataUrl;
    img.alt = anno.type === "signature" ? "Signature" : "Image";
    el.append(img);
    const handle = document.createElement("span");
    handle.className = "pdf-anno__handle";
    handle.title = "Resize";
    el.append(handle);
    wireResize(handle, anno, view);
  }

  wireDrag(el, anno, view);
  el.addEventListener("pointerdown", (e) => {
    if (state.tool !== "select" && state.tool !== "text") return;
    e.stopPropagation();
    selectAnno(anno.id);
  });

  return el;
}

function penSvg(anno) {
  const stroke = anno.color || "#1a1f2a";
  const width = anno.strokeWidth || 2;
  if (!anno.points?.length) return "";
  const d = anno.points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 100} ${p.y * 100}`)
    .join(" ");
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

function selectAnno(id) {
  state.selectedId = id;
  $$(".pdf-anno", root).forEach((el) => el.classList.toggle("is-selected", el.dataset.id === id));
  syncChrome();
}

function beginTextEdit(anno, el) {
  el.contentEditable = "true";
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = () => {
    el.contentEditable = "false";
    const next = el.textContent.trim();
    if (next && next !== anno.text) {
      pushHistory();
      anno.text = next;
    } else if (!next) {
      pushHistory();
      state.annotations = state.annotations.filter((a) => a.id !== anno.id);
      state.selectedId = null;
      renderAnnotations();
    }
    el.removeEventListener("blur", finish);
    el.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      el.textContent = anno.text;
      el.blur();
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.blur();
    }
  };
  el.addEventListener("blur", finish);
  el.addEventListener("keydown", onKey);
}

function wireDrag(el, anno, view) {
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;
  let dragging = false;
  let moved = false;
  let snapshot = "";

  el.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("pdf-anno__handle")) return;
    if (el.isContentEditable) return;
    if (state.tool !== "select" && !(state.tool === "text" && anno.type === "text")) return;
    dragging = true;
    moved = false;
    snapshot = JSON.stringify(state.annotations);
    startX = e.clientX;
    startY = e.clientY;
    origX = anno.x;
    origY = anno.y;
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = (e.clientX - startX) / view.width;
    const dy = (e.clientY - startY) / view.height;
    if (Math.abs(dx) + Math.abs(dy) > 0.002) moved = true;
    anno.x = clamp(origX + dx, 0, 1 - anno.w);
    anno.y = clamp(origY + dy, 0, 1 - anno.h);
    el.style.left = `${anno.x * 100}%`;
    el.style.top = `${anno.y * 100}%`;
  });

  el.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("is-dragging");
    if (moved) {
      state.history.push(snapshot);
      if (state.history.length > 60) state.history.shift();
      syncChrome();
    }
  });
}

function wireResize(handle, anno, view) {
  let startX = 0;
  let startY = 0;
  let origW = 0;
  let origH = 0;
  let snapshot = "";

  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    selectAnno(anno.id);
    snapshot = JSON.stringify(state.annotations);
    startX = e.clientX;
    startY = e.clientY;
    origW = anno.w;
    origH = anno.h;
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const dw = (ev.clientX - startX) / view.width;
      const dh = (ev.clientY - startY) / view.height;
      const aspect = origW / origH;
      let nextW = clamp(origW + dw, 0.04, 1 - anno.x);
      let nextH = nextW / aspect;
      if (anno.y + nextH > 1) {
        nextH = 1 - anno.y;
        nextW = nextH * aspect;
      }
      // Allow free resize with shift? keep aspect for signatures/images
      if (Math.abs(dh) > Math.abs(dw)) {
        nextH = clamp(origH + dh, 0.03, 1 - anno.y);
        nextW = nextH * aspect;
        if (anno.x + nextW > 1) {
          nextW = 1 - anno.x;
          nextH = nextW / aspect;
        }
      }
      anno.w = nextW;
      anno.h = nextH;
      const el = handle.parentElement;
      el.style.width = `${anno.w * 100}%`;
      el.style.height = `${anno.h * 100}%`;
    };

    const onUp = () => {
      state.history.push(snapshot);
      if (state.history.length > 60) state.history.shift();
      syncChrome();
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function wirePageInteractions(view) {
  const { pageEl, drawCanvas } = view;
  const dpr = window.devicePixelRatio || 1;

  pageEl.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".pdf-anno")) return;
    selectAnno(null);

    const rect = pageEl.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (state.tool === "text") {
      pushHistory();
      const fontSize = state.textSize;
      const h = (fontSize * 1.4) / view.pdfHeight;
      const w = 0.28;
      const anno = {
        id: uid(),
        type: "text",
        pageIndex: view.pageIndex,
        x: clamp(x, 0, 1 - w),
        y: clamp(y, 0, 1 - h),
        w,
        h,
        text: "Text",
        fontSize,
        color: state.inkColor,
      };
      state.annotations.push(anno);
      state.selectedId = anno.id;
      renderAnnotations();
      const el = view.layer.querySelector(`[data-id="${anno.id}"]`);
      if (el) beginTextEdit(anno, el);
      return;
    }

    if (state.tool === "signature" && state.pendingSignature) {
      placeImageAnno(view, x, y, state.pendingSignature, "signature", 0.28);
      return;
    }

    if (state.tool === "image" && state.pendingImage) {
      placeImageAnno(view, x, y, state.pendingImage, "image", 0.3);
      return;
    }

    if (state.tool === "pen" || state.tool === "highlight") {
      beginStroke(view, e);
    }
  });

  function beginStroke(viewRef, e) {
    const ctx = drawCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewRef.width, viewRef.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const isHighlight = state.tool === "highlight";
    ctx.strokeStyle = isHighlight ? "rgba(255, 230, 80, 0.45)" : state.inkColor;
    ctx.lineWidth = isHighlight ? Math.max(12, state.inkSize * 4) : state.inkSize;

    const points = [];
    const rect = pageEl.getBoundingClientRect();
    const pointFromEvent = (ev) => ({
      x: (ev.clientX - rect.left) / rect.width,
      y: (ev.clientY - rect.top) / rect.height,
    });

    let last = pointFromEvent(e);
    points.push(last);
    ctx.beginPath();
    ctx.moveTo(last.x * viewRef.width, last.y * viewRef.height);
    drawCanvas.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const p = pointFromEvent(ev);
      points.push(p);
      ctx.lineTo(p.x * viewRef.width, p.y * viewRef.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x * viewRef.width, p.y * viewRef.height);
    };

    const onUp = () => {
      drawCanvas.removeEventListener("pointermove", onMove);
      drawCanvas.removeEventListener("pointerup", onUp);
      ctx.clearRect(0, 0, viewRef.width, viewRef.height);
      if (points.length < 2) return;

      pushHistory();
      if (isHighlight) {
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const pad = 0.008;
        const minX = Math.max(0, Math.min(...xs) - pad);
        const maxX = Math.min(1, Math.max(...xs) + pad);
        const minY = Math.max(0, Math.min(...ys) - pad);
        const maxY = Math.min(1, Math.max(...ys) + pad);
        state.annotations.push({
          id: uid(),
          type: "highlight",
          pageIndex: viewRef.pageIndex,
          x: minX,
          y: minY,
          w: Math.max(0.02, maxX - minX),
          h: Math.max(0.012, maxY - minY),
          color: "rgba(255, 230, 80, 0.38)",
        });
      } else {
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const pad = 0.01;
        const minX = Math.max(0, Math.min(...xs) - pad);
        const maxX = Math.min(1, Math.max(...xs) + pad);
        const minY = Math.max(0, Math.min(...ys) - pad);
        const maxY = Math.min(1, Math.max(...ys) + pad);
        const w = Math.max(0.02, maxX - minX);
        const h = Math.max(0.02, maxY - minY);
        const normPoints = points.map((p) => ({
          x: (p.x - minX) / w,
          y: (p.y - minY) / h,
        }));
        state.annotations.push({
          id: uid(),
          type: "pen",
          pageIndex: viewRef.pageIndex,
          x: minX,
          y: minY,
          w,
          h,
          points: normPoints,
          color: state.inkColor,
          strokeWidth: state.inkSize,
        });
      }
      renderAnnotations();
    };

    drawCanvas.addEventListener("pointermove", onMove);
    drawCanvas.addEventListener("pointerup", onUp);
  }
}

function placeImageAnno(view, x, y, dataUrl, type, defaultW) {
  const img = new Image();
  img.onload = () => {
    pushHistory();
    const aspect = img.naturalWidth / img.naturalHeight || 2.5;
    let w = defaultW;
    let h = w / aspect;
    if (h > 0.22) {
      h = 0.22;
      w = h * aspect;
    }
    const anno = {
      id: uid(),
      type,
      pageIndex: view.pageIndex,
      x: clamp(x - w / 2, 0, 1 - w),
      y: clamp(y - h / 2, 0, 1 - h),
      w,
      h,
      imageDataUrl: dataUrl,
    };
    state.annotations.push(anno);
    state.selectedId = anno.id;
    state.tool = "select";
    renderAnnotations();
    syncChrome();
  };
  img.src = dataUrl;
}

/* —— Signature modal —— */

function clearSigPad() {
  const { width, height } = els.sigCanvas;
  if (!sigCtx) sigCtx = els.sigCanvas.getContext("2d");
  sigCtx.setTransform(1, 0, 0, 1, 0, 0);
  sigCtx.fillStyle = "#ffffff";
  sigCtx.fillRect(0, 0, width, height);
  sigCtx.strokeStyle = "#141820";
  sigCtx.lineWidth = 2.5;
  sigCtx.lineCap = "round";
  sigCtx.lineJoin = "round";
  sigDirty = false;
}

function openSignatureModal() {
  clearSigPad();
  els.sigTyped.value = "";
  els.sigTypedPreview.textContent = "Your name";
  setSigTab("draw");
  if (typeof els.modal.showModal === "function") els.modal.showModal();
}

function setSigTab(tab) {
  sigTab = tab;
  const scope = els.modal || root;
  $$(".pdf-tab", scope).forEach((btn) => {
    const on = btn.dataset.sigTab === tab;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  $$("[data-sig-panel]", scope).forEach((panel) => {
    panel.hidden = panel.dataset.sigPanel !== tab;
  });
}

function wireSignaturePad() {
  const canvas = els.sigCanvas;
  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  canvas.addEventListener("pointerdown", (e) => {
    sigDrawing = true;
    const p = pos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!sigDrawing) return;
    const p = pos(e);
    sigCtx.lineTo(p.x, p.y);
    sigCtx.stroke();
    sigDirty = true;
  });
  canvas.addEventListener("pointerup", () => {
    sigDrawing = false;
  });

  els.btnSigClear.addEventListener("click", clearSigPad);
  $$(".pdf-tab", els.modal || root).forEach((btn) => {
    btn.addEventListener("click", () => setSigTab(btn.dataset.sigTab));
  });
  els.sigTyped.addEventListener("input", () => {
    els.sigTypedPreview.textContent = els.sigTyped.value.trim() || "Your name";
  });

  els.sigForm.addEventListener("submit", async (e) => {
    const submitter = e.submitter;
    const value = submitter?.value || "cancel";
    if (value !== "use") {
      state.tool = "select";
      syncChrome();
      return;
    }
    e.preventDefault();
    let dataUrl = null;
    if (sigTab === "draw") {
      if (!sigDirty) {
        setStatus("Draw a signature first, or switch to Type.");
        return;
      }
      dataUrl = trimCanvasToDataUrl(els.sigCanvas);
    } else {
      const name = els.sigTyped.value.trim();
      if (!name) {
        setStatus("Type a name for your signature.");
        return;
      }
      dataUrl = typedSignatureDataUrl(name);
    }
    state.pendingSignature = dataUrl;
    state.tool = "signature";
    els.modal.close();
    setStatus("Click on the PDF to place your signature, then drag to position.");
    syncChrome();
  });
}

function trimCanvasToDataUrl(source) {
  const ctx = source.getContext("2d");
  const { width, height } = source;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (a > 8 && (r < 250 || g < 250 || b < 250)) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right <= left || bottom <= top) return source.toDataURL("image/png");
  const pad = 8;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const w = right - left + 1;
  const h = bottom - top + 1;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d").drawImage(source, left, top, w, h, 0, 0, w, h);
  return out.toDataURL("image/png");
}

function typedSignatureDataUrl(name) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 260;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#141820";
  ctx.font = 'italic 120px "Cormorant Garamond", "Times New Roman", serif';
  ctx.textBaseline = "middle";
  ctx.fillText(name, 40, canvas.height / 2);
  // trim transparent
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width;
  let right = 0;
  let top = canvas.height;
  let bottom = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const a = pixels[(y * canvas.width + x) * 4 + 3];
      if (a > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  const pad = 12;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(canvas.width - 1, right + pad);
  bottom = Math.min(canvas.height - 1, bottom + pad);
  const out = document.createElement("canvas");
  out.width = Math.max(1, right - left + 1);
  out.height = Math.max(1, bottom - top + 1);
  out.getContext("2d").drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

async function downloadPdf() {
  if (!state.pdfBytes) return;
  document.body.classList.add("pdf-editor-busy");
  setStatus("Building PDF…");
  try {
    const pdfDoc = await PDFDocument.load(state.pdfBytes.slice());
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const anno of state.annotations) {
      const page = pages[anno.pageIndex];
      if (!page) continue;
      const { width, height } = page.getSize();
      const x = anno.x * width;
      const yTop = anno.y * height;
      const w = anno.w * width;
      const h = anno.h * height;
      const y = height - yTop - h;

      if (anno.type === "text") {
        const color = hexToRgb(anno.color || "#141820");
        const size = anno.fontSize || 14;
        page.drawText(anno.text || "", {
          x: x + 2,
          y: y + h - size,
          size,
          font,
          color: rgb(color.r, color.g, color.b),
          maxWidth: w - 4,
          lineHeight: size * 1.25,
        });
      } else if (anno.type === "highlight") {
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          color: rgb(1, 0.9, 0.2),
          opacity: 0.35,
          borderWidth: 0,
        });
      } else if (anno.type === "pen") {
        await drawPenOnPage(page, anno, width, height);
      } else if (anno.type === "signature" || anno.type === "image") {
        const embedded = await embedDataUrl(pdfDoc, anno.imageDataUrl);
        page.drawImage(embedded, { x, y, width: w, height: h });
      }
    }

    const out = await pdfDoc.save();
    const blob = new Blob([out], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const base = state.fileName.replace(/\.pdf$/i, "");
    a.href = url;
    a.download = `${base}-edited.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${base}-edited.pdf · still local only`);
  } catch (err) {
    console.error(err);
    setStatus("Could not build the PDF. Try fewer marks or another file.");
  } finally {
    document.body.classList.remove("pdf-editor-busy");
  }
}

async function embedDataUrl(pdfDoc, dataUrl) {
  const res = await fetch(dataUrl);
  const bytes = await res.arrayBuffer();
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) {
    return pdfDoc.embedJpg(bytes);
  }
  return pdfDoc.embedPng(bytes);
}

async function drawPenOnPage(page, anno, pageW, pageH) {
  const pts = anno.points || [];
  if (pts.length < 2) return;
  const color = hexToRgb(anno.color || "#1a1f2a");
  const stroke = Math.max(0.6, (anno.strokeWidth || 2) * (pageW / 700));
  // Draw as short line segments in PDF space
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const x1 = (anno.x + a.x * anno.w) * pageW;
    const y1 = pageH - (anno.y + a.y * anno.h) * pageH;
    const x2 = (anno.x + b.x * anno.w) * pageW;
    const y2 = pageH - (anno.y + b.y * anno.h) * pageH;
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: stroke,
      color: rgb(color.r, color.g, color.b),
      lineCap: 1,
    });
  }
}

function deleteSelected() {
  if (!state.selectedId) return;
  pushHistory();
  state.annotations = state.annotations.filter((a) => a.id !== state.selectedId);
  state.selectedId = null;
  renderAnnotations();
}

function clearAll() {
  if (!state.annotations.length) return;
  if (!confirm("Clear all marks on this PDF?")) return;
  pushHistory();
  state.annotations = [];
  state.selectedId = null;
  renderAnnotations();
}

function wireUi() {
  $$(".pdf-tool[data-tool]", root).forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  const openPicker = () => els.fileInput.click();
  els.btnOpen.addEventListener("click", openPicker);
  els.btnOpenDrop.addEventListener("click", openPicker);
  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files?.[0];
    if (file) loadPdfFile(file);
    els.fileInput.value = "";
  });

  els.imageInput.addEventListener("change", async () => {
    const file = els.imageInput.files?.[0];
    els.imageInput.value = "";
    if (!file) {
      state.tool = "select";
      syncChrome();
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    state.pendingImage = dataUrl;
    state.tool = "image";
    setStatus("Click on the PDF to place the image, then drag to position.");
    syncChrome();
  });

  els.btnDownload.addEventListener("click", downloadPdf);
  els.btnUndo.addEventListener("click", undo);
  els.btnDelete.addEventListener("click", deleteSelected);
  els.btnClear.addEventListener("click", clearAll);

  els.inkColor.addEventListener("input", () => {
    state.inkColor = els.inkColor.value;
  });
  els.inkSize.addEventListener("input", () => {
    state.inkSize = Number(els.inkSize.value);
  });
  els.textSize.addEventListener("input", () => {
    state.textSize = Number(els.textSize.value);
  });

  // Drag & drop
  const stage = $(".pdf-stage", root);
  const onDrag = (e) => {
    e.preventDefault();
    els.drop.classList.add("is-dragover");
  };
  const onDragLeave = (e) => {
    if (!stage.contains(e.relatedTarget)) els.drop.classList.remove("is-dragover");
  };
  stage.addEventListener("dragenter", onDrag);
  stage.addEventListener("dragover", onDrag);
  stage.addEventListener("dragleave", onDragLeave);
  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    els.drop.classList.remove("is-dragover");
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type === "application/pdf");
    if (file) loadPdfFile(file);
  });

  const onKey = (e) => {
    if (root.hidden || root.closest("[hidden]")) return;
    if (e.target.matches("input, textarea, [contenteditable='true']")) return;
    const key = e.key.toLowerCase();
    if (key === "v") setTool("select");
    if (key === "t") setTool("text");
    if (key === "p") setTool("pen");
    if (key === "h") setTool("highlight");
    if (key === "s") setTool("signature");
    if ((e.key === "Delete" || e.key === "Backspace") && state.selectedId) {
      e.preventDefault();
      deleteSelected();
    }
    if ((e.metaKey || e.ctrlKey) && key === "z") {
      e.preventDefault();
      undo();
    }
  };
  const onResize = debounce(() => {
    if (!root.hidden && state.pdfDoc) renderPages();
  }, 250);
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  root._pdfCleanup = () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
  };

  wireSignaturePad();
  clearSigPad();
  syncChrome();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}



  wireUi();
  return {
    destroy() {
      if (typeof root._pdfCleanup === "function") root._pdfCleanup();
      if (els.modal?.open) els.modal.close();
      els.modal?.remove();
      root.innerHTML = "";
      delete root.dataset.pdfMounted;
    },
  };
}
