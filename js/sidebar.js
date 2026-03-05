/**
 * CYOA Image Sidebar Tool - sidebar.js
 *
 * Injects a collapsible sidebar into the ICC Plus CYOA editor that allows:
 *  1. Loading a reference CYOA screenshot image
 *  2. Interactively cropping regions from it with mouse drag
 *  3. Upscaling the crop using canvas bicubic (imageSmoothingQuality: 'high')
 *  4. Dragging the upscaled image to any choice image field in the editor
 */

(function () {
  'use strict';

  /* -----------------------------------------------------------------------
   * Constants & State
   * --------------------------------------------------------------------- */

  const SIDEBAR_STORAGE_KEY = 'cyoa_sidebar_state';

  const state = {
    refImage: null,          // HTMLImageElement - loaded reference image
    refImageDataUrl: null,   // string - data URL of the reference image
    scaleFactor: 2,          // current upscale factor (2 / 4 / 8)
    crops: [],               // array of { dataUrl, width, height, label }
    cropStart: null,         // { x, y } in canvas coords when dragging
    cropRect: null,          // { x, y, w, h } current crop rectangle in canvas coords
    isCropping: false,       // mouse is down
    dragItemIndex: null,     // which gallery item is being dragged
    refCanvasNaturalW: 0,    // natural (pixel) dimensions of reference image
    refCanvasNaturalH: 0,
    refCanvasDisplayW: 0,    // displayed canvas dimensions
    refCanvasDisplayH: 0,
    creatorModeActive: false, // whether hidden because not in CYOA creator section
    ocrIsRunning: false,     // prevent concurrent OCR runs
  };

  /* -----------------------------------------------------------------------
   * DOM references (assigned after injection)
   * --------------------------------------------------------------------- */

  let sidebar, toggleBtn, arrowSpan;
  let helpBtn, helpTooltip;
  let refDropZone, refCanvas, cropOverlay, refPlaceholder;
  let cropBtn, clearRefBtn, clearCropsBtn, ocrRegionBtn;
  let gallery;
  let scaleBtns;
  let upscaleIndicator;
  let ocrSection, ocrTitle, ocrLoading, ocrText, ocrCopyBtn, ocrCloseBtn;

  /* -----------------------------------------------------------------------
   * Sidebar Injection
   * --------------------------------------------------------------------- */

  function buildSidebarHTML() {
    return `
      <button id="sidebar-toggle" title="Toggle CYOA Image Sidebar (Ctrl+Shift+S)">
        <span id="sidebar-arrow">&#9664;</span>
      </button>
      <div id="sidebar-content">
        <div id="sidebar-header">
          <h3>&#128444; CYOA Image Tool</h3>
          <button id="sidebar-help-btn" title="How to use">?</button>
        </div>

        <div id="sidebar-help-tooltip">
          <strong>How to use:</strong>
          <ol>
            <li>Drop or browse for your reference CYOA image below.</li>
            <li>Click &amp; drag on the image to select a region to crop.</li>
            <li>Click <em>Crop &amp; Upscale</em> to add it to the gallery.</li>
            <li>Click <em>&#128203; OCR</em> to extract text from the selected region.</li>
            <li>Drag any gallery image onto a choice image field in the editor.</li>
            <li>Hover a gallery image and click &#128203; to extract its text.</li>
          </ol>
          <small>Tip: Press <kbd>Ctrl+Shift+S</kbd> to toggle this sidebar.</small>
        </div>

        <div id="sidebar-scale-section">
          <label>Upscale:</label>
          <div class="sidebar-scale-buttons">
            <button class="scale-btn" data-scale="1">1&#215;</button>
            <button class="scale-btn active" data-scale="2">2&#215;</button>
            <button class="scale-btn" data-scale="4">4&#215;</button>
            <button class="scale-btn" data-scale="8">8&#215;</button>
          </div>
        </div>

        <div id="sidebar-ref-section">
          <div id="sidebar-ref-label">Reference CYOA Image</div>
          <div id="sidebar-ref-drop-zone">
            <div id="sidebar-ref-placeholder">
              <div class="placeholder-icon">&#128247;</div>
              <div class="placeholder-text">Drop CYOA image here</div>
              <div class="placeholder-sub">or click to browse</div>
            </div>
            <div id="sidebar-canvas-wrapper">
              <canvas id="sidebar-ref-canvas"></canvas>
              <canvas id="sidebar-crop-overlay"></canvas>
            </div>
            <div id="sidebar-upscale-indicator">
              <div class="sidebar-spinner"></div>
              <span>Upscaling…</span>
            </div>
          </div>
          <div id="sidebar-ref-controls">
            <button id="sidebar-crop-btn" class="sidebar-btn primary" disabled>Crop &amp; Upscale</button>
            <button id="sidebar-ocr-region-btn" class="sidebar-btn" disabled title="Extract text from selected region (OCR)">&#128203; OCR</button>
            <button id="sidebar-clear-ref-btn" class="sidebar-btn danger" disabled>Clear</button>
          </div>
        </div>

        <div id="sidebar-gallery-section">
          <div id="sidebar-gallery-header">
            <span>Upscaled Crops</span>
            <button id="sidebar-clear-crops-btn">Clear All</button>
          </div>
          <div id="sidebar-gallery"></div>
        </div>

        <div id="sidebar-ocr-section" hidden>
          <div id="sidebar-ocr-header">
            <span id="sidebar-ocr-title">&#128203; Extracted Text</span>
            <div id="sidebar-ocr-actions">
              <button id="sidebar-ocr-copy-btn" class="sidebar-btn" title="Copy all text" disabled>Copy</button>
              <button id="sidebar-ocr-close-btn" title="Close OCR panel">&#10005;</button>
            </div>
          </div>
          <div id="sidebar-ocr-loading" hidden>
            <div class="sidebar-spinner"></div>
            <span>Extracting text&#8230;</span>
          </div>
          <textarea id="sidebar-ocr-text" readonly placeholder="Extracted text will appear here&#8230;"></textarea>
        </div>

        <div id="sidebar-instructions">
          <small>&#128161; Drag a crop from the gallery onto a choice image field in the editor to set it.</small>
        </div>
      </div>
    `;
  }

  function injectSidebar() {
    sidebar = document.createElement('div');
    sidebar.id = 'cyoa-sidebar';
    sidebar.innerHTML = buildSidebarHTML();

    // Restore collapsed state
    const savedState = sessionStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (savedState === 'collapsed') {
      sidebar.classList.add('collapsed');
    }

    document.body.appendChild(sidebar);

    cacheElements();
    bindEvents();
    restoreCropsFromSession();
  }

  function cacheElements() {
    toggleBtn = document.getElementById('sidebar-toggle');
    arrowSpan = document.getElementById('sidebar-arrow');
    helpBtn = document.getElementById('sidebar-help-btn');
    helpTooltip = document.getElementById('sidebar-help-tooltip');
    refDropZone = document.getElementById('sidebar-ref-drop-zone');
    refCanvas = document.getElementById('sidebar-ref-canvas');
    cropOverlay = document.getElementById('sidebar-crop-overlay');
    refPlaceholder = document.getElementById('sidebar-ref-placeholder');
    cropBtn = document.getElementById('sidebar-crop-btn');
    ocrRegionBtn = document.getElementById('sidebar-ocr-region-btn');
    clearRefBtn = document.getElementById('sidebar-clear-ref-btn');
    clearCropsBtn = document.getElementById('sidebar-clear-crops-btn');
    gallery = document.getElementById('sidebar-gallery');
    upscaleIndicator = document.getElementById('sidebar-upscale-indicator');
    scaleBtns = document.querySelectorAll('#cyoa-sidebar .scale-btn');
    ocrSection = document.getElementById('sidebar-ocr-section');
    ocrTitle = document.getElementById('sidebar-ocr-title');
    ocrLoading = document.getElementById('sidebar-ocr-loading');
    ocrText = document.getElementById('sidebar-ocr-text');
    ocrCopyBtn = document.getElementById('sidebar-ocr-copy-btn');
    ocrCloseBtn = document.getElementById('sidebar-ocr-close-btn');
  }

  /* -----------------------------------------------------------------------
   * Event Binding
   * --------------------------------------------------------------------- */

  function bindEvents() {
    // Toggle sidebar
    toggleBtn.addEventListener('click', toggleSidebar);

    // Keyboard shortcut (only when in creator mode)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        if (state.creatorModeActive) toggleSidebar();
      }
    });

    // Help tooltip
    helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      helpTooltip.classList.toggle('visible');
    });
    document.addEventListener('click', (e) => {
      if (!helpBtn.contains(e.target) && !helpTooltip.contains(e.target)) {
        helpTooltip.classList.remove('visible');
      }
    });

    // Scale factor buttons
    scaleBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        scaleBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.scaleFactor = parseInt(btn.dataset.scale, 10);
      });
    });

    // Reference image drop zone — click to browse
    refDropZone.addEventListener('click', (e) => {
      if (refDropZone.classList.contains('has-image')) return; // let crop overlay handle it
      openFileBrowser();
    });

    // Reference image drop zone — drag-and-drop
    refDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Only accept if dragging an external file (not a gallery item from sidebar)
      if (dtTypesHasSidebarImage(e.dataTransfer.types)) return;
      refDropZone.classList.add('drag-over');
    });

    refDropZone.addEventListener('dragleave', (e) => {
      e.stopPropagation();
      refDropZone.classList.remove('drag-over');
    });

    refDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      refDropZone.classList.remove('drag-over');
      // Ignore sidebar-originated drags
      if (dtTypesHasSidebarImage(e.dataTransfer.types)) return;
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        loadRefImage(file);
      }
    });

    // Crop overlay mouse events
    cropOverlay.addEventListener('mousedown', onCropMouseDown);
    cropOverlay.addEventListener('mousemove', onCropMouseMove);
    cropOverlay.addEventListener('mouseup', onCropMouseUp);
    cropOverlay.addEventListener('mouseleave', onCropMouseLeave);

    // Crop & Upscale button
    cropBtn.addEventListener('click', () => {
      if (state.cropRect) {
        performCropAndUpscale();
      }
    });

    // OCR selected region button
    ocrRegionBtn.addEventListener('click', () => {
      if (state.cropRect) performOCROnRegion();
    });

    // OCR panel copy button
    ocrCopyBtn.addEventListener('click', () => {
      const text = ocrText.value;
      if (!text) return;
      navigator.clipboard.writeText(text).catch(() => {
        ocrText.select();
        document.execCommand('copy');
      });
    });

    // OCR panel close button
    ocrCloseBtn.addEventListener('click', hideOCRPanel);

    // Clear reference
    clearRefBtn.addEventListener('click', clearRefImage);

    // Clear all crops
    clearCropsBtn.addEventListener('click', clearAllCrops);

    // Global drop handler — intercept gallery images dropped onto choices
    document.addEventListener('dragover', onGlobalDragOver, true);
    document.addEventListener('drop', onGlobalDrop, true);
    document.addEventListener('dragend', onGlobalDragEnd, true);
  }

  /* -----------------------------------------------------------------------
   * Sidebar Toggle
   * --------------------------------------------------------------------- */

  function toggleSidebar() {
    sidebar.classList.toggle('collapsed');
    sessionStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      sidebar.classList.contains('collapsed') ? 'collapsed' : 'open'
    );
  }

  /* -----------------------------------------------------------------------
   * File Browser
   * --------------------------------------------------------------------- */

  function openFileBrowser() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (file) loadRefImage(file);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  /* -----------------------------------------------------------------------
   * Load Reference Image
   * --------------------------------------------------------------------- */

  function loadRefImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const img = new Image();
      img.onload = () => {
        state.refImage = img;
        state.refImageDataUrl = dataUrl;
        renderRefCanvas();
        refDropZone.classList.add('has-image');
        clearRefBtn.disabled = false;
        resetCropState();
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function renderRefCanvas() {
    const img = state.refImage;
    const maxW = refDropZone.clientWidth;
    const maxH = 240;

    // Guard against zero clientWidth (e.g. sidebar is still animating)
    const availW = maxW || 296;

    let displayW = img.naturalWidth;
    let displayH = img.naturalHeight;

    // Scale down to fit
    const scale = Math.min(availW / displayW, maxH / displayH, 1);
    displayW = Math.max(1, Math.floor(displayW * scale));
    displayH = Math.max(1, Math.floor(displayH * scale));

    refCanvas.width = displayW;
    refCanvas.height = displayH;
    // style dimensions are controlled via CSS (width: 100% on the canvas + wrapper)

    const ctx = refCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, displayW, displayH);

    // Match overlay canvas dimensions exactly to the reference canvas
    cropOverlay.width = displayW;
    cropOverlay.height = displayH;
    // Do NOT set style.width/height here — the overlay fills the wrapper via CSS

    state.refCanvasNaturalW = img.naturalWidth;
    state.refCanvasNaturalH = img.naturalHeight;
    state.refCanvasDisplayW = displayW;
    state.refCanvasDisplayH = displayH;
  }

  function clearRefImage() {
    state.refImage = null;
    state.refImageDataUrl = null;
    refDropZone.classList.remove('has-image');
    clearRefBtn.disabled = true;
    resetCropState();
    clearOverlayCanvas();
    const ctx = refCanvas.getContext('2d');
    ctx.clearRect(0, 0, refCanvas.width, refCanvas.height);
  }

  /* -----------------------------------------------------------------------
   * Crop Tool
   * --------------------------------------------------------------------- */

  function resetCropState() {
    state.cropStart = null;
    state.cropRect = null;
    state.isCropping = false;
    cropBtn.disabled = true;
    if (ocrRegionBtn) ocrRegionBtn.disabled = true;
    clearOverlayCanvas();
  }

  function clearOverlayCanvas() {
    const ctx = cropOverlay.getContext('2d');
    ctx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);
  }

  function getCanvasPos(e) {
    const rect = cropOverlay.getBoundingClientRect();
    // Account for any CSS scaling
    const scaleX = cropOverlay.width / rect.width;
    const scaleY = cropOverlay.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  function onCropMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    state.isCropping = true;
    state.cropStart = getCanvasPos(e);
    state.cropRect = null;
    cropBtn.disabled = true;
    clearOverlayCanvas();
  }

  function onCropMouseMove(e) {
    if (!state.isCropping) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const sx = state.cropStart.x;
    const sy = state.cropStart.y;
    const rect = {
      x: Math.min(sx, pos.x),
      y: Math.min(sy, pos.y),
      w: Math.abs(pos.x - sx),
      h: Math.abs(pos.y - sy),
    };
    state.cropRect = rect;
    drawCropRect(rect);
  }

  function onCropMouseUp(e) {
    if (!state.isCropping) return;
    state.isCropping = false;
    if (state.cropRect && state.cropRect.w > 4 && state.cropRect.h > 4) {
      cropBtn.disabled = false;
      if (ocrRegionBtn) ocrRegionBtn.disabled = false;
    } else {
      state.cropRect = null;
      clearOverlayCanvas();
    }
  }

  function onCropMouseLeave(e) {
    if (state.isCropping) {
      onCropMouseUp(e);
    }
  }

  function drawCropRect(rect) {
    const ctx = cropOverlay.getContext('2d');
    ctx.clearRect(0, 0, cropOverlay.width, cropOverlay.height);

    // Dimmed overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, cropOverlay.width, cropOverlay.height);

    // Clear selected region
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);

    // Dashed border on selection
    ctx.save();
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

    // Corner handles
    ctx.setLineDash([]);
    ctx.fillStyle = '#89b4fa';
    const hs = 5;
    [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]].forEach(([cx, cy]) => {
      ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    });
    ctx.restore();

    // Dimensions label
    // Map from display coords back to natural pixel coords
    const xScale = state.refCanvasNaturalW / state.refCanvasDisplayW;
    const yScale = state.refCanvasNaturalH / state.refCanvasDisplayH;
    const naturalW = Math.round(rect.w * xScale);
    const naturalH = Math.round(rect.h * yScale);

    ctx.save();
    ctx.fillStyle = 'rgba(30,30,46,0.8)';
    ctx.font = '10px Roboto, sans-serif';
    const label = `${naturalW} × ${naturalH}`;
    const tw = ctx.measureText(label).width + 8;
    const lx = Math.min(rect.x, cropOverlay.width - tw - 2);
    const ly = Math.max(rect.y - 18, 2);
    ctx.fillRect(lx, ly, tw, 16);
    ctx.fillStyle = '#89b4fa';
    ctx.fillText(label, lx + 4, ly + 11);
    ctx.restore();
  }

  /* -----------------------------------------------------------------------
   * Upscaling
   * --------------------------------------------------------------------- */

  function performCropAndUpscale() {
    if (!state.refImage || !state.cropRect) return;

    const rect = state.cropRect;

    // Map display crop rect back to natural image coordinates
    const xScale = state.refCanvasNaturalW / state.refCanvasDisplayW;
    const yScale = state.refCanvasNaturalH / state.refCanvasDisplayH;
    const srcX = Math.round(rect.x * xScale);
    const srcY = Math.round(rect.y * yScale);
    const srcW = Math.round(rect.w * xScale);
    const srcH = Math.round(rect.h * yScale);

    if (srcW < 1 || srcH < 1) return;

    // Show indicator
    upscaleIndicator.classList.add('visible');

    // Use setTimeout to allow the UI to update before heavy canvas work
    setTimeout(() => {
      try {
        const targetW = srcW * state.scaleFactor;
        const targetH = srcH * state.scaleFactor;

        // Use offscreen canvas for upscaling
        const offCanvas = document.createElement('canvas');
        offCanvas.width = targetW;
        offCanvas.height = targetH;
        const offCtx = offCanvas.getContext('2d');

        offCtx.imageSmoothingEnabled = true;
        offCtx.imageSmoothingQuality = 'high';

        // Draw the natural-resolution crop, upscaled to targetW×targetH
        offCtx.drawImage(
          state.refImage,
          srcX, srcY, srcW, srcH,
          0, 0, targetW, targetH
        );

        // Optional: apply a subtle sharpening pass via convolution for small crops
        if (state.scaleFactor >= 2 && targetW <= 1024 && targetH <= 1024) {
          applySharpen(offCtx, targetW, targetH, 0.3);
        }

        const dataUrl = offCanvas.toDataURL('image/png');
        addCropToGallery(dataUrl, targetW, targetH, srcW, srcH);

        resetCropState();
      } catch (err) {
        console.error('[CYOA Sidebar] Upscale error:', err);
      } finally {
        upscaleIndicator.classList.remove('visible');
      }
    }, 20);
  }

  /**
   * Lightweight sharpening via a unsharp-mask-style convolution on ImageData.
   * strength: 0.0–1.0  (0.3 is subtle but noticeable)
   */
  function applySharpen(ctx, w, h, strength) {
    try {
      const imageData = ctx.getImageData(0, 0, w, h);
      const src = imageData.data;
      const dst = new Uint8ClampedArray(src);
      const kernel = [
        0, -1,  0,
       -1,  5, -1,
        0, -1,  0,
      ];

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            let acc = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                const kidx = ((y + ky) * w + (x + kx)) * 4 + c;
                acc += src[kidx] * kernel[(ky + 1) * 3 + (kx + 1)];
              }
            }
            // Blend sharpened with original by strength
            dst[idx + c] = Math.min(255, Math.max(0,
              Math.round(src[idx + c] * (1 - strength) + acc * strength)
            ));
          }
          dst[idx + 3] = src[idx + 3]; // preserve alpha
        }
      }

      const outData = new ImageData(dst, w, h);
      ctx.putImageData(outData, 0, 0);
    } catch (e) {
      // Silently skip sharpening on error (e.g., cross-origin)
    }
  }

  /* -----------------------------------------------------------------------
   * Gallery Management
   * --------------------------------------------------------------------- */

  function addCropToGallery(dataUrl, targetW, targetH, srcW, srcH) {
    const label = `${targetW}×${targetH}`;
    const item = {
      dataUrl,
      width: targetW,
      height: targetH,
      label,
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    };
    state.crops.push(item);
    renderGalleryItem(item, state.crops.length - 1);
    saveCropsToSession();
  }

  function renderGalleryItem(item, index) {
    const el = document.createElement('div');
    el.className = 'gallery-item';
    el.dataset.cropId = item.id;
    el.draggable = true;
    el.title = `${item.label} — drag to a choice image field`;

    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.alt = item.label;

    const lbl = document.createElement('div');
    lbl.className = 'gallery-item-label';
    lbl.textContent = item.label;

    const delBtn = document.createElement('button');
    delBtn.className = 'gallery-item-delete';
    delBtn.title = 'Remove crop';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeCropById(item.id);
    });

    const ocrBtn = document.createElement('button');
    ocrBtn.className = 'gallery-item-ocr';
    ocrBtn.title = 'Extract text from this image (OCR)';
    ocrBtn.textContent = '\u{1F4CB}';
    ocrBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      performOCR(item.dataUrl, item.label);
    });

    el.appendChild(img);
    el.appendChild(lbl);
    el.appendChild(delBtn);
    el.appendChild(ocrBtn);

    // Drag events
    el.addEventListener('dragstart', (e) => {
      state.dragItemIndex = item.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-cyoa-sidebar-image', item.dataUrl);
      e.dataTransfer.setData('text/plain', item.dataUrl);

      // Use the already-rendered gallery img as drag ghost (synchronous, no blank flash)
      const galleryImg = el.querySelector('img');
      if (galleryImg && galleryImg.complete) {
        const maxGhostSize = 80;
        const ratio = (galleryImg.naturalWidth || item.width) / (galleryImg.naturalHeight || item.height);
        const ghost = document.createElement('canvas');
        if (ratio >= 1) {
          ghost.width = maxGhostSize;
          ghost.height = Math.max(1, Math.round(maxGhostSize / ratio));
        } else {
          ghost.height = maxGhostSize;
          ghost.width = Math.max(1, Math.round(maxGhostSize * ratio));
        }
        const gCtx = ghost.getContext('2d');
        gCtx.imageSmoothingEnabled = true;
        gCtx.imageSmoothingQuality = 'high';
        gCtx.drawImage(galleryImg, 0, 0, ghost.width, ghost.height);
        e.dataTransfer.setDragImage(ghost, ghost.width / 2, ghost.height / 2);
      }
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      state.dragItemIndex = null;
    });

    gallery.appendChild(el);
  }

  function removeCropById(id) {
    const idx = state.crops.findIndex((c) => c.id === id);
    if (idx === -1) return;
    state.crops.splice(idx, 1);
    const el = gallery.querySelector(`[data-crop-id="${id}"]`);
    if (el) el.remove();
    saveCropsToSession();
  }

  function clearAllCrops() {
    state.crops = [];
    gallery.innerHTML = '';
    saveCropsToSession();
  }

  /* -----------------------------------------------------------------------
   * Session Persistence (crops survive sidebar toggle, not page reload)
   * --------------------------------------------------------------------- */

  function saveCropsToSession() {
    try {
      sessionStorage.setItem('cyoa_sidebar_crops', JSON.stringify(
        state.crops.map((c) => ({ id: c.id, dataUrl: c.dataUrl, width: c.width, height: c.height, label: c.label }))
      ));
    } catch (e) {
      // Storage quota exceeded — silently ignore
    }
  }

  function restoreCropsFromSession() {
    try {
      const raw = sessionStorage.getItem('cyoa_sidebar_crops');
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) {
        saved.forEach((item, i) => {
          state.crops.push(item);
          renderGalleryItem(item, i);
        });
      }
    } catch (e) {
      sessionStorage.removeItem('cyoa_sidebar_crops');
    }
  }

  /* -----------------------------------------------------------------------
   * Global Drag / Drop — intercept sidebar images dropped onto choices
   * --------------------------------------------------------------------- */

  let currentHighlightEl = null;

  function dtTypesHasSidebarImage(types) {
    // DataTransfer.types can be a DOMStringList (has .contains()) or an array (has .includes())
    if (!types) return false;
    if (typeof types.contains === 'function') return types.contains('application/x-cyoa-sidebar-image');
    if (typeof types.includes === 'function') return types.includes('application/x-cyoa-sidebar-image');
    return Array.from(types).indexOf('application/x-cyoa-sidebar-image') !== -1;
  }

  function onGlobalDragOver(e) {
    if (!dtTypesHasSidebarImage(e.dataTransfer.types)) return;

    // Find the best image input target
    const target = findImageTarget(e.target);
    if (target) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      highlightTarget(target);
    } else {
      clearHighlight();
    }
  }

  function onGlobalDrop(e) {
    const dataUrl = e.dataTransfer.getData('application/x-cyoa-sidebar-image');
    if (!dataUrl) return;

    const target = findImageTarget(e.target);
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();
    clearHighlight();

    applyImageToTarget(target, dataUrl);
  }

  function onGlobalDragEnd() {
    clearHighlight();
  }

  function highlightTarget(el) {
    if (currentHighlightEl === el) return;
    clearHighlight();
    currentHighlightEl = el;
    el.classList.add('sidebar-drop-target-highlight');
  }

  function clearHighlight() {
    if (currentHighlightEl) {
      currentHighlightEl.classList.remove('sidebar-drop-target-highlight');
      currentHighlightEl = null;
    }
  }

  /**
   * Walk up the DOM tree from the drop target to find the most appropriate
   * element to receive the image. Strategies (in priority order):
   *  1. Direct <input type="file"> that accepts images
   *  2. <input type="text"> or <input type="url"> that looks like an image URL field
   *  3. An <img> tag we can update directly (with Vue reactivity hack)
   *  4. Any nearby container that has a file/url input
   */
  function findImageTarget(el) {
    if (!el || el === document || el.id === 'cyoa-sidebar') return null;

    // Skip elements inside the sidebar itself
    if (sidebar.contains(el)) return null;

    // Strategy 1: direct file input
    if (el.tagName === 'INPUT' && el.type === 'file' && acceptsImages(el)) {
      return el;
    }

    // Strategy 2: direct text/url input (likely an image URL field)
    if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'url')) {
      if (looksLikeImageInput(el)) return el;
    }

    // Strategy 3: img tag — look for nearby input
    if (el.tagName === 'IMG') {
      const input = findInputNear(el);
      if (input) return input;
    }

    // Strategy 4: walk up to a "choice" container and search within
    let ancestor = el.parentElement;
    let depth = 0;
    while (ancestor && depth < 10) {
      // File input inside ancestor
      const fileInput = ancestor.querySelector('input[type="file"]');
      if (fileInput && acceptsImages(fileInput)) return fileInput;

      // URL/text input inside ancestor
      const textInputs = ancestor.querySelectorAll('input[type="text"], input[type="url"], input:not([type])');
      for (const inp of textInputs) {
        if (looksLikeImageInput(inp)) return inp;
      }

      ancestor = ancestor.parentElement;
      depth++;
    }

    return null;
  }

  function acceptsImages(fileInput) {
    const accept = (fileInput.accept || '').toLowerCase();
    return !accept || accept.includes('image') || accept.includes('*');
  }

  function looksLikeImageInput(input) {
    const name = (input.name || input.id || input.placeholder || '').toLowerCase();
    return (
      name.includes('image') ||
      name.includes('img') ||
      name.includes('photo') ||
      name.includes('picture') ||
      name.includes('url') ||
      name.includes('src') ||
      name.includes('icon')
    );
  }

  function findInputNear(img) {
    const parent = img.parentElement;
    if (!parent) return null;
    return (
      parent.querySelector('input[type="file"]') ||
      parent.querySelector('input[type="text"]') ||
      parent.querySelector('input[type="url"]')
    );
  }

  /* -----------------------------------------------------------------------
   * Apply Image to Target Element
   * --------------------------------------------------------------------- */

  async function applyImageToTarget(target, dataUrl) {
    try {
      if (target.tagName === 'INPUT' && target.type === 'file') {
        await setFileOnInput(target, dataUrl);
      } else if (target.tagName === 'INPUT') {
        // Text / URL input — set the data URL as the value
        setNativeInputValue(target, dataUrl);
      }
    } catch (err) {
      console.error('[CYOA Sidebar] Drop apply error:', err);
    }
  }

  /**
   * Convert a data URL to a File object and set it on a file input,
   * then dispatch change/input events to trigger Vue/Svelte reactivity.
   */
  async function setFileOnInput(fileInput, dataUrl) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const ext = blob.type.split('/')[1] || 'png';
    const file = new File([blob], `cyoa-crop-${Date.now()}.${ext}`, { type: blob.type });

    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;

    // Dispatch events to trigger framework reactivity
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Set a text/url input value using the native input value setter
   * so that Vue/Svelte reactivity is triggered properly.
   */
  function setNativeInputValue(input, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    );
    if (nativeInputValueSetter && nativeInputValueSetter.set) {
      nativeInputValueSetter.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* -----------------------------------------------------------------------
   * CYOA Creator Mode Detection
   * The sidebar is only relevant in the CYOA creator section (not in the
   * viewer, main menu, or other sections). We detect this by checking for
   * the "Create New Row" button which only renders in the creator section.
   * --------------------------------------------------------------------- */

  function isInCreatorMode() {
    return !!document.querySelector('.create-box');
  }

  function updateSidebarVisibility() {
    const inCreator = isInCreatorMode();
    if (inCreator !== state.creatorModeActive) {
      state.creatorModeActive = inCreator;
      sidebar.classList.toggle('hidden-outside-creator', !inCreator);
      if (!inCreator && helpTooltip) {
        helpTooltip.classList.remove('visible');
      }
    }
  }

  function startCreatorModeWatcher() {
    // Immediate check, then poll every 300 ms (route transitions are infrequent)
    updateSidebarVisibility();
    setInterval(updateSidebarVisibility, 300);
  }

  /* -----------------------------------------------------------------------
   * OCR — Extract text from an image via Electron IPC (Windows OCR)
   * --------------------------------------------------------------------- */

  function performOCR(dataUrl, label) {
    if (state.ocrIsRunning) return;
    if (!window.electron?.ipcRenderer) {
      showOCRPanel();
      showOCRResult('OCR requires the Electron desktop app context.');
      return;
    }

    state.ocrIsRunning = true;
    showOCRPanel();
    showOCRLoading(label || 'image');

    window.electron.ipcRenderer.invoke('ocr-image', dataUrl)
      .then((text) => {
        showOCRResult(text || '(No text detected)');
      })
      .catch((err) => {
        showOCRResult('OCR error: ' + (err && err.message ? err.message : 'Unknown error'));
      })
      .finally(() => {
        state.ocrIsRunning = false;
      });
  }

  function performOCROnRegion() {
    if (!state.refImage || !state.cropRect) return;

    const rect = state.cropRect;
    const xScale = state.refCanvasNaturalW / state.refCanvasDisplayW;
    const yScale = state.refCanvasNaturalH / state.refCanvasDisplayH;
    const srcX = Math.round(rect.x * xScale);
    const srcY = Math.round(rect.y * yScale);
    const srcW = Math.round(rect.w * xScale);
    const srcH = Math.round(rect.h * yScale);

    if (srcW < 1 || srcH < 1) return;

    const canvas = document.createElement('canvas');
    canvas.width = srcW;
    canvas.height = srcH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(state.refImage, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
    const dataUrl = canvas.toDataURL('image/png');

    performOCR(dataUrl, `${srcW}\u00d7${srcH} region`);
  }

  function showOCRPanel() {
    ocrSection.removeAttribute('hidden');
  }

  function showOCRLoading(label) {
    ocrTitle.textContent = '\u{1F4CB} OCR: ' + label;
    ocrLoading.removeAttribute('hidden');
    ocrText.value = '';
    ocrCopyBtn.disabled = true;
  }

  function showOCRResult(text) {
    ocrLoading.setAttribute('hidden', '');
    ocrText.value = text;
    ocrCopyBtn.disabled = !text;
  }

  function hideOCRPanel() {
    ocrSection.setAttribute('hidden', '');
    ocrText.value = '';
    ocrTitle.textContent = '\u{1F4CB} Extracted Text';
    ocrCopyBtn.disabled = true;
  }

  /* -----------------------------------------------------------------------
   * Bootstrap — wait for DOM to be ready
   * --------------------------------------------------------------------- */

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        injectSidebar();
        startCreatorModeWatcher();
      });
    } else {
      injectSidebar();
      startCreatorModeWatcher();
    }
  }

  init();

})();
