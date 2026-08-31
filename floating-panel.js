(() => {
  if (window.top !== window.self) return; // only top frame
  if (window.__API_INSPECTOR_FLOATING_LOADED__) return;
  window.__API_INSPECTOR_FLOATING_LOADED__ = true;

  const STORAGE_KEY = "apiInspectorFloating";
  const DEFAULT_RECT = { top: 64, right: 24, width: 400, height: 600, pinned: false, minimized: false };

  let root = null;
  let headerEl = null;
  let iframe = null;
  let isDragging = false;
  let isResizing = false;
  let dragStart = { x: 0, y: 0, left: 0, top: 0 };
  let resizeStart = { x: 0, y: 0, w: 0, h: 0, dir: "br" };
  let state = { ...DEFAULT_RECT, visible: false };

  function loadState() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([STORAGE_KEY], res => {
          const s = res[STORAGE_KEY];
          if (s && typeof s === "object") {
            state = { ...DEFAULT_RECT, ...s };
            // visible default false if not set
            if (typeof s.visible !== "boolean") state.visible = false;
          } else {
            state.visible = false;
          }
          resolve(state);
        });
      } catch { resolve(state); }
    });
  }

  function saveState() {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: state });
    } catch {}
  }

  function createPanel() {
    if (root) return root;
    if (!document.body) return null;

    root = document.createElement("div");
    root.id = "api-inspector-floating-root";
    if (state.pinned) root.classList.add("pinned");
    else root.classList.add("unpinned");
    if (state.minimized) root.classList.add("minimized");
    // position: right-based to fixed, but we store left/top for drag
    // If we have stored left, use left, otherwise use right
    const hasLeft = typeof state.left === "number";
    root.style.width = (state.width || 400) + "px";
    root.style.height = (state.height || 600) + "px";
    if (hasLeft) {
      root.style.left = state.left + "px";
      root.style.right = "auto";
      root.style.top = (state.top || 64) + "px";
    } else {
      root.style.top = (state.top || 64) + "px";
      root.style.right = (state.right || 24) + "px";
      root.style.left = "auto";
    }

    root.innerHTML = `
      <div class="api-floating-header" data-drag-handle>
        <div class="api-floating-header-left">
          <div class="api-floating-logo">
            <svg width="16" height="16" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="6" fill="white" fill-opacity="0.9"/><path d="M7 14h14M14 7v14M9 9l10 10M19 9L9 19" stroke="#0ea5e9" stroke-width="1.6" stroke-linecap="round"/><circle cx="14" cy="14" r="3" fill="#0ea5e9"/></svg>
          </div>
          <div>
            <div class="api-floating-title">Apii</div>
            <div class="api-floating-subtitle" style="font-size:10px; opacity:.85;">懸浮 • 可拖曳縮放</div>
          </div>
        </div>
        <div class="api-floating-controls">
          <button class="api-floating-btn" data-action="pin" title="點擊解鎖以自由拖動、縮放（目前已鎖定）">🔒</button>
          <button class="api-floating-btn" data-action="minimize" title="最小化">−</button>
          <button class="api-floating-btn" data-action="expand" title="在新標籤頁展開">↗</button>
          <button class="api-floating-btn" data-action="sidepanel" title="移到側邊欄">⇥</button>
          <button class="api-floating-btn close" data-action="close" title="關閉懸浮">✕</button>
        </div>
      </div>
      <div class="api-floating-toolbar">
        <span style="color:#64748b;">拖曳標題可移動 • 右下角可縮放</span>
        <span class="spacer"></span>
        <button data-action="reset-pos" title="重置位置大小">重置</button>
      </div>
      <div class="api-floating-body">
        <iframe class="api-floating-iframe" src="${chrome.runtime.getURL("popup.html")}" allow="clipboard-read; clipboard-write"></iframe>
      </div>
      <div class="api-floating-resize api-floating-resize-r" data-resize="r"></div>
      <div class="api-floating-resize api-floating-resize-b" data-resize="b"></div>
      <div class="api-floating-resize api-floating-resize-br" data-resize="br"></div>
    `;

    document.documentElement.appendChild(root);
    headerEl = root.querySelector("[data-drag-handle]");
    iframe = root.querySelector("iframe");

    bindEvents();
    applyPinState();
    return root;
  }

  function bindEvents() {
    if (!root) return;
    const pinBtn = root.querySelector('[data-action="pin"]');
    const minBtn = root.querySelector('[data-action="minimize"]');
    const expandBtn = root.querySelector('[data-action="expand"]');
    const sideBtn = root.querySelector('[data-action="sidepanel"]');
    const closeBtn = root.querySelector('[data-action="close"]');
    const resetBtn = root.querySelector('[data-action="reset-pos"]');

    pinBtn?.addEventListener("click", (e) => { e.stopPropagation(); togglePin(); });
    minBtn?.addEventListener("click", (e) => { e.stopPropagation(); toggleMinimize(); });
    expandBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = chrome.runtime.getURL("fullpage.html");
      try { chrome.runtime.sendMessage({ type: "OPEN_FULLPAGE" }); } catch {}
      try { window.open(url, "_blank"); } catch {}
    });
    sideBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      try { chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" }); } catch {}
    });
    closeBtn?.addEventListener("click", (e) => { e.stopPropagation(); hidePanel(); });
    resetBtn?.addEventListener("click", (e) => { e.stopPropagation(); resetPosition(); });

    // Drag
    headerEl?.addEventListener("mousedown", onDragStart);
    // Also allow double click header to toggle minimize/pin
    headerEl?.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      toggleMinimize();
    });

    // Resize
    root.querySelectorAll("[data-resize]").forEach(handle => {
      handle.addEventListener("mousedown", (e) => onResizeStart(e, handle.getAttribute("data-resize")));
    });

    // Prevent iframe from capturing drag when pinned? No.

    // Global listeners for drag/resize
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    window.addEventListener("resize", onWindowResize);
  }

  function togglePin() {
    state.pinned = !state.pinned;
    applyPinState();
    saveState();
    const btn = root?.querySelector('[data-action="pin"]');
    if (btn) {
      btn.classList.toggle("active", state.pinned);
      btn.title = state.pinned ? "已固定在最前（點擊取消）" : "固定在最前";
    }
  }

  function applyPinState() {
    if (!root) return;
    root.classList.toggle("pinned", !!state.pinned);
    root.classList.toggle("unpinned", !state.pinned);
    const btn = root.querySelector('[data-action="pin"]');
    if (btn) {
      btn.classList.toggle("active", !!state.pinned);
      btn.title = state.pinned ? "已解除固定（可自由拖動縮放）→ 點擊鎖定" : "點擊解鎖以自由拖動、縮放（目前已鎖定）";
      btn.textContent = state.pinned ? "🔓" : "🔒";
    }
    // 更新 header 游標與縮放手柄可見性
    if (headerEl) headerEl.style.cursor = state.pinned ? "grab" : "default";
    root.querySelectorAll("[data-resize]").forEach(h => {
      h.style.display = state.pinned ? "block" : "none";
    });
  }

  function toggleMinimize() {
    state.minimized = !state.minimized;
    root?.classList.toggle("minimized", state.minimized);
    saveState();
  }

  function resetPosition() {
    state.top = DEFAULT_RECT.top;
    state.right = DEFAULT_RECT.right;
    delete state.left;
    state.width = DEFAULT_RECT.width;
    state.height = DEFAULT_RECT.height;
    state.minimized = false;
    if (root) {
      root.style.top = state.top + "px";
      root.style.right = state.right + "px";
      root.style.left = "auto";
      root.style.width = state.width + "px";
      root.style.height = state.height + "px";
      root.classList.remove("minimized");
    }
    saveState();
  }

  function onDragStart(e) {
    if (!state.pinned) {
      // 未解鎖時不可拖動，提示解鎖
      const t = root?.querySelector('[data-action="pin"]');
      if (t) { t.animate([{ transform: "scale(1)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }], { duration: 300 }); }
      return;
    }
    if (e.target.closest("button")) return;
    if (state.minimized) {
      // allow drag even when minimized
    }
    isDragging = true;
    root.classList.add("dragging");
    if (iframe) iframe.style.pointerEvents = "none";
    const rect = root.getBoundingClientRect();
    dragStart = {
      x: e.clientX,
      y: e.clientY,
      left: rect.left,
      top: rect.top
    };
    e.preventDefault();
  }

  function onResizeStart(e, dir) {
    if (!state.pinned) return;
    isResizing = true;
    root.classList.add("resizing");
    if (iframe) iframe.style.pointerEvents = "none";
    const rect = root.getBoundingClientRect();
    resizeStart = {
      x: e.clientX,
      y: e.clientY,
      w: rect.width,
      h: rect.height,
      dir: dir || "br"
    };
    e.preventDefault();
    e.stopPropagation();
  }

  function onMouseMove(e) {
    if (isDragging && root) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      let newLeft = dragStart.left + dx;
      let newTop = dragStart.top + dy;

      // keep within viewport with margin 8
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = root.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      newLeft = Math.max(4, Math.min(newLeft, vw - w - 4));
      newTop = Math.max(4, Math.min(newTop, vh - 32 - 4));

      root.style.left = newLeft + "px";
      root.style.top = newTop + "px";
      root.style.right = "auto";
      // save
      state.left = newLeft;
      state.top = newTop;
      delete state.right;
    }
    if (isResizing && root) {
      const dx = e.clientX - resizeStart.x;
      const dy = e.clientY - resizeStart.y;
      let newW = resizeStart.w;
      let newH = resizeStart.h;
      if (resizeStart.dir === "br" || resizeStart.dir === "r") {
        newW = resizeStart.w + dx;
      }
      if (resizeStart.dir === "br" || resizeStart.dir === "b") {
        newH = resizeStart.h + dy;
      }
      // constraints
      newW = Math.max(320, Math.min(newW, window.innerWidth * 0.96));
      newH = Math.max(380, Math.min(newH, window.innerHeight * 0.92));
      root.style.width = newW + "px";
      root.style.height = newH + "px";
      state.width = newW;
      state.height = newH;
      if (state.minimized) {
        // if resizing while minimized, unminimize
        state.minimized = false;
        root.classList.remove("minimized");
      }
    }
  }

  function onMouseUp() {
    if (isDragging || isResizing) {
      saveState();
    }
    if (isDragging) root?.classList.remove("dragging");
    if (isResizing) root?.classList.remove("resizing");
    if (iframe) iframe.style.pointerEvents = "";
    isDragging = false;
    isResizing = false;
  }

  function onWindowResize() {
    if (!root || root.classList.contains("hidden")) return;
    // keep within viewport
    const rect = root.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left;
    let top = rect.top;
    let changed = false;
    if (left + rect.width > vw - 4) {
      left = vw - rect.width - 4;
      changed = true;
    }
    if (top + rect.height > vh - 4) {
      top = vh - rect.height - 4;
      changed = true;
    }
    if (left < 4) { left = 4; changed = true; }
    if (top < 4) { top = 4; changed = true; }
    if (changed) {
      root.style.left = left + "px";
      root.style.top = top + "px";
      root.style.right = "auto";
      state.left = left;
      state.top = top;
      delete state.right;
      saveState();
    }
  }

  function showPanel() {
    if (!root) createPanel();
    if (!root) return;
    root.classList.remove("hidden");
    root.style.display = "flex";
    state.visible = true;
    saveState();
    // ensure within viewport
    onWindowResize();
  }

  function hidePanel() {
    if (root) {
      root.classList.add("hidden");
      root.style.display = "none";
    }
    state.visible = false;
    saveState();
  }

  function togglePanel() {
    if (state.visible && root && !root.classList.contains("hidden")) hidePanel();
    else showPanel();
  }

  // Message handling
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "SHOW_FLOATING") {
      showPanel();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "HIDE_FLOATING") {
      hidePanel();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "TOGGLE_FLOATING") {
      togglePanel();
      sendResponse({ visible: state.visible });
      return true;
    }
    if (msg.type === "GET_FLOATING_STATE") {
      sendResponse({ visible: state.visible, pinned: state.pinned });
      return true;
    }
  });

  // Also listen for storage changes to sync across tabs? Not needed.

  // Initialize: check stored visible, but don't auto-show on every page load if user hasn't requested?
  // We will auto-show only if previously visible and not explicitly hidden in this session?
  // For now, load and if visible==true, show after DOM ready.
  function init() {
    loadState().then(() => {
      if (state.visible) {
        // delay until body exists
        const tryShow = () => {
          if (document.body) showPanel();
          else setTimeout(tryShow, 200);
        };
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", () => tryShow());
        } else {
          tryShow();
        }
      }
    });
  }

  init();

  // Expose for debugging and for window messages
  window.__API_INSPECTOR_FLOATING__ = { showPanel, hidePanel, togglePanel, togglePin, resetPosition };

  // Also handle keyboard: Esc to hide? Not needed.

  // Handle click outside to auto-hide when not pinned? Optional.
  document.addEventListener("mousedown", (e) => {
    if (!root || root.classList.contains("hidden") || state.pinned) return;
    if (root.contains(e.target)) return;
    // if click outside and not pinned, maybe keep? No auto-hide to avoid annoyance.
  });
})();
