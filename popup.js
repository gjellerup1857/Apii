let allLogs = [];
let filterType = "all";
let searchQuery = "";
let domainFilter = "";
let methodFilter = "";
let selectedId = null;

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const statOk = document.getElementById("statOk");
const statErr = document.getElementById("statErr");
const statFetch = document.getElementById("statFetch");
const statXhr = document.getElementById("statXhr");
const domainSelect = document.getElementById("domainSelect");
const methodSelect = document.getElementById("methodSelect");
const searchInput = document.getElementById("searchInput");
const btnClearSearch = document.getElementById("btnClearSearch");
const enableToggle = document.getElementById("enableToggle");
const subtitle = document.getElementById("subtitle");

function init() {
  loadLogs();
  bindEvents();
  // Listen for new logs in real time
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NEW_LOG") {
      allLogs.push(msg.data);
      refresh();
    } else if (msg.type === "LOGS_CLEARED") {
      allLogs = [];
      refresh();
    } else if (msg.type === "LOGS_UPDATED") {
      allLogs = msg.data || [];
      refresh();
    } else if (msg.type === "ENABLED_CHANGED") {
      enableToggle.checked = !!msg.data;
      updateSubtitle();
    }
  });
  // also poll via storage changes (sidepanel/fullpage may update directly)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.apiInspectorLogs) {
      allLogs = changes.apiInspectorLogs.newValue || [];
      refresh();
    }
  });
}

function loadLogs() {
  chrome.runtime.sendMessage({ type: "GET_LOGS" }, (res) => {
    if (chrome.runtime.lastError) {
      // fallback storage
      chrome.storage.local.get(["apiInspectorLogs", "apiInspectorEnabled"], (r) => {
        allLogs = r.apiInspectorLogs || [];
        if (typeof r.apiInspectorEnabled === "boolean") enableToggle.checked = r.apiInspectorEnabled;
        refresh();
      });
      return;
    }
    allLogs = res?.logs || [];
    if (typeof res?.enabled === "boolean") enableToggle.checked = res.enabled;
    refresh();
  });
}

function bindEvents() {
  document.getElementById("btnExpand").addEventListener("click", async () => {
    const url = chrome.runtime.getURL("fullpage.html");
    try {
      if (chrome.tabs && chrome.tabs.create) {
        await chrome.tabs.create({ url });
        window.close();
        return;
      }
    } catch (e) { console.warn("tabs.create failed, fallback to bg", e); }
    chrome.runtime.sendMessage({ type: "OPEN_FULLPAGE" }, (res) => {
      if (chrome.runtime.lastError) {
        // final fallback: open via window.open
        window.open(url, "_blank");
      }
      window.close();
    });
  });
  // 懸浮面板：可拖曳縮放固定
  const btnFloat = document.getElementById("btnFloat");
  if (btnFloat) {
    btnFloat.addEventListener("click", async () => {
      // Prefer background handler which injects via scripting if needed
      chrome.runtime.sendMessage({ type: "SHOW_FLOATING" }, (res) => {
        if (chrome.runtime.lastError) {
          // fallback direct
          (async () => {
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tab && tab.id) {
                try { await chrome.tabs.sendMessage(tab.id, { type: "SHOW_FLOATING" }); window.close(); return; } catch {}
              }
            } catch {}
            const url = chrome.runtime.getURL("popup.html");
            try { await chrome.windows.create({ url, type: "popup", width: 420, height: 640 }); } catch { window.open(url, "_blank"); }
            window.close();
          })();
          return;
        }
        window.close();
      });
    });
  }
  document.getElementById("btnSidePanel").addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && chrome.sidePanel) {
        try {
          await chrome.sidePanel.open({ windowId: tab.windowId });
          window.close();
          return;
        } catch (e) {
          // try via background
          chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL", windowId: tab.windowId }, () => {
            if (!chrome.runtime.lastError) window.close();
          });
          return;
        }
      }
    } catch (e) { console.warn(e); }
    // fallback: try background open then fullpage
    chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" }, () => {
      if (chrome.runtime.lastError) chrome.runtime.sendMessage({ type: "OPEN_FULLPAGE" });
      window.close();
    });
    setTimeout(() => { try { chrome.runtime.sendMessage({ type: "OPEN_FULLPAGE" }); } catch {} }, 400);
  });
  document.getElementById("btnClear").addEventListener("click", () => {
    if (allLogs.length === 0) return;
    chrome.runtime.sendMessage({ type: "CLEAR_LOGS" }, () => {
      allLogs = [];
      refresh();
    });
  });
  document.getElementById("btnExport").addEventListener("click", exportLogs);
  document.getElementById("btnBack").addEventListener("click", closeDrawer);
  document.getElementById("btnCopyCurl").addEventListener("click", copyCurl);
  document.getElementById("btnHelp").addEventListener("click", () => {
    alert("使用方式：\n1. 開啟開關後，重新整理目標網頁\n2. 在網頁操作觸發 API，擴充功能會自動記錄\n3. 點擊卡片查看請求參數與回應\n4. 點擊右上角「展開」可在獨立標籤頁查看，方便加入側邊欄\n5. 側邊欄按鈕可在 360px 窄版下正常使用（已做 RWD）");
  });

  enableToggle.addEventListener("change", () => {
    const enabled = enableToggle.checked;
    chrome.runtime.sendMessage({ type: "TOGGLE_ENABLED", enabled });
    updateSubtitle();
  });

  document.querySelectorAll("#filterTabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#filterTabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterType = btn.dataset.filter;
      refresh();
    });
  });

  domainSelect.addEventListener("change", () => { domainFilter = domainSelect.value; refresh(); });
  methodSelect.addEventListener("change", () => { methodFilter = methodSelect.value; refresh(); });

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    btnClearSearch.style.display = searchQuery ? "block" : "none";
    refresh();
  });
  btnClearSearch.addEventListener("click", () => {
    searchInput.value = ""; searchQuery = ""; btnClearSearch.style.display = "none"; refresh();
  });
}

function updateSubtitle() {
  const enabled = enableToggle.checked;
  subtitle.innerHTML = `${enabled ? "監控中" : "已暫停"} • <span id="count">${filteredLogs().length}</span> 條`;
  // badge title update handled in background
}

function filteredLogs() {
  let logs = [...allLogs].reverse(); // newest first
  if (filterType === "fetch") logs = logs.filter(l => l.type === "fetch");
  else if (filterType === "xhr") logs = logs.filter(l => l.type === "xhr");
  else if (filterType === "error") logs = logs.filter(l => l.status >= 400 || l.status === 0);
  else if (filterType === "success") logs = logs.filter(l => l.status >= 200 && l.status < 300);

  if (domainFilter) logs = logs.filter(l => l.domain === domainFilter);
  if (methodFilter) logs = logs.filter(l => l.method === methodFilter);
  if (searchQuery) {
    logs = logs.filter(l => {
      const hay = `${l.method} ${l.url} ${l.status} ${l.domain} ${JSON.stringify(l.requestBody || "")} ${JSON.stringify(l.responseBody || "")}`.toLowerCase();
      return hay.includes(searchQuery);
    });
  }
  return logs;
}

function refresh() {
  const logs = filteredLogs();
  // stats on allLogs (not filtered? show total) - but filtered count for subtitle
  const total = allLogs.length;
  countEl.textContent = logs.length;
  // subtitle via function
  updateSubtitle();
  // fix subtitle count element we just set? we overwrote innerHTML so need re-get
  // Instead just update countEl again after
  document.getElementById("count").textContent = logs.length;

  statOk.textContent = allLogs.filter(l => l.status >=200 && l.status <300).length;
  statErr.textContent = allLogs.filter(l => l.status >=400 || l.status===0).length;
  statFetch.textContent = allLogs.filter(l => l.type==="fetch").length;
  statXhr.textContent = allLogs.filter(l => l.type==="xhr").length;

  updateDomainOptions();
  renderList(logs);

  // empty state
  if (logs.length === 0) {
    emptyEl.style.display = "flex";
    listEl.style.display = "none";
    if (allLogs.length === 0) {
      emptyEl.querySelector(".empty-title").textContent = "尚未擷取到任何請求";
      emptyEl.querySelector(".empty-desc").textContent = "在網頁中觸發 API（切換頁面、點擊按鈕、送出表單）後，這裡會即時顯示請求參數與回應內容。";
    } else {
      emptyEl.querySelector(".empty-title").textContent = "沒有符合條件的記錄";
      emptyEl.querySelector(".empty-desc").textContent = "試試調整搜尋關鍵字或篩選條件。";
    }
  } else {
    emptyEl.style.display = "none";
    listEl.style.display = "flex";
  }
}

function updateDomainOptions() {
  const domains = [...new Set(allLogs.map(l => l.domain).filter(Boolean))].sort();
  const current = domainSelect.value;
  domainSelect.innerHTML = '<option value="">全部網域</option>';
  domains.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d; opt.textContent = d;
    if (d === current) opt.selected = true;
    domainSelect.appendChild(opt);
  });
  if (!domains.includes(current)) domainFilter = "";
}

function renderList(logs) {
  listEl.innerHTML = "";
  logs.forEach(log => {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = log.id;
    const urlPath = (() => {
      try { const u = new URL(log.url); return u.pathname + u.search + u.hash; } catch { return log.url; }
    })();
    const statusCls = log.status === 0 ? "s0" : log.status <300 ? "s2" : log.status <400 ? "s3" : log.status <500 ? "s4" : "s5";
    const time = new Date(log.timestamp).toLocaleTimeString("zh-TW", { hour12:false });
    card.innerHTML = `
      <div class="card-header">
        <span class="method ${log.method}">${log.method}</span>
        <div class="url-wrap">
          <div class="url-path" title="${escapeHtml(log.url)}">${escapeHtml(urlPath)}</div>
          <div class="url-full">${escapeHtml(log.domain || "")}</div>
        </div>
        <span class="status ${statusCls}">${log.status || "ERR"}</span>
      </div>
      <div class="card-meta">
        <span class="type-badge">${log.type}</span>
        <span>${escapeHtml(log.responseBodyType || "")}</span>
        <span class="meta-dot"></span>
        <span class="time">${time}</span>
        <span class="duration">${log.duration}ms</span>
      </div>
    `;
    card.addEventListener("click", () => openDrawer(log.id));
    listEl.appendChild(card);
  });
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let currentDetail = null;
function openDrawer(id) {
  const log = allLogs.find(l => l.id === id);
  if (!log) return;
  currentDetail = log;
  selectedId = id;
  const drawer = document.getElementById("drawer");
  const content = document.getElementById("drawerContent");
  content.innerHTML = renderDetail(log);
  drawer.classList.add("open");
  // bind copy buttons inside
  content.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const txt = btn.getAttribute("data-copy");
      navigator.clipboard.writeText(txt).then(() => {
        const old = btn.textContent;
        btn.textContent = "已複製";
        setTimeout(() => btn.textContent = old, 1200);
      });
    });
  });
  // toggle sections - only collapse body, keep header fully visible
  content.querySelectorAll(".detail-head").forEach(h => {
    h.addEventListener("click", (e) => {
      if (e.target.closest(".copy-btn")) return;
      const section = h.closest(".detail-section");
      if (section) section.classList.toggle("collapsed");
    });
  });
  applyAutoCollapse(content);
}

function applyAutoCollapse(container) {
  const threshold = Math.max(240, (window.innerHeight || 600) * 0.5);
  container.querySelectorAll(".detail-section").forEach(section => {
    const body = section.querySelector(".detail-body");
    if (!body) return;
    // measure after layout - include json-view full scrollHeight if present
    requestAnimationFrame(() => {
      let h = body.scrollHeight;
      const jsonView = body.querySelector(".json-view");
      if (jsonView) h = Math.max(h, jsonView.scrollHeight);
      const inner = body.querySelector(".detail-body-inner");
      if (inner) h = Math.max(h, inner.scrollHeight);
      if (h > threshold) {
        section.classList.add("collapsed");
      }
    });
  });
}

function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  currentDetail = null;
}

function renderDetail(log) {
  const reqBodyStr = formatBody(log.requestBody, log.requestBodyType);
  const resBodyStr = formatBody(log.responseBody, log.responseBodyType);
  const reqHeaders = log.requestHeaders || {};
  const resHeaders = log.responseHeaders || {};
  const query = log.queryParams || {};

  function kvRows(obj) {
    const entries = Object.entries(obj || {});
    if (entries.length === 0) return '<div style="color:#94a3b8;font-size:11px;padding:6px 0;">（無）</div>';
    return entries.map(([k,v]) => `<div class="kv"><span class="kv-key">${escapeHtml(k)}</span><span class="kv-val">${escapeHtml(typeof v==='object'?JSON.stringify(v):String(v))}</span></div>`).join("");
  }

  const timeline = `${new Date(log.timestamp).toLocaleString("zh-TW")} • ${log.duration}ms • ${log.type.toUpperCase()}`;
  const statusCls = log.status===0?"s0":log.status<300?"s2":log.status<400?"s3":log.status<500?"s4":"s5";

  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;max-width:100%;">
      <span class="method ${log.method}">${log.method}</span>
      <span class="status ${statusCls}">${log.status} ${escapeHtml(log.statusText||"")}</span>
      <span style="font-size:11px;color:#64748b;overflow-wrap:anywhere;word-break:break-word;min-width:0;">${escapeHtml(timeline)}</span>
    </div>
    <div class="detail-url">${escapeHtml(log.url)}</div>
    ${log.pageUrl ? `<div style="font-size:10px;color:#94a3b8;overflow-wrap:anywhere;word-break:break-word;max-width:100%;">來源頁面：${escapeHtml(log.pageUrl)}</div>` : ""}

    <div class="detail-section">
      <div class="detail-head"><div class="detail-head-left"><span class="chevron">▼</span> 查詢參數 <span class="count">${Object.keys(query).length} 個</span></div></div>
      <div class="detail-body"><div class="detail-body-inner">${kvRows(query)}</div></div>
    </div>

    <div class="detail-section">
      <div class="detail-head"><div class="detail-head-left"><span class="chevron">▼</span> 請求 Headers <span class="count">${Object.keys(reqHeaders).length} 個</span></div></div>
      <div class="detail-body"><div class="detail-body-inner">${kvRows(reqHeaders)}</div></div>
    </div>

    <div class="detail-section">
      <div class="detail-head"><div class="detail-head-left"><span class="chevron">▼</span> 請求 Body <span class="count">${escapeHtml(log.requestBodyType||"empty")}</span></div><div class="head-actions"><button class="copy-btn" data-copy="${escapeAttr(reqBodyStr)}">複製</button></div></div>
      <div class="detail-body"><div class="detail-body-inner">
        ${reqBodyStr ? `<pre class="json-view">${escapeHtml(reqBodyStr)}</pre>` : '<div style="color:#94a3b8;font-size:11px;">（無 Body）</div>'}
      </div></div>
    </div>

    <div class="detail-section">
      <div class="detail-head"><div class="detail-head-left"><span class="chevron">▼</span> 回應 Headers <span class="count">${Object.keys(resHeaders).length} 個</span></div></div>
      <div class="detail-body"><div class="detail-body-inner">${kvRows(resHeaders)}</div></div>
    </div>

    <div class="detail-section">
      <div class="detail-head"><div class="detail-head-left"><span class="chevron">▼</span> 回應 Body <span class="count">${escapeHtml(log.responseBodyType||"")}</span></div><div class="head-actions"><button class="copy-btn" data-copy="${escapeAttr(resBodyStr)}">複製</button></div></div>
      <div class="detail-body"><div class="detail-body-inner">
        ${resBodyStr ? `<pre class="json-view">${escapeHtml(resBodyStr)}</pre>` : '<div style="color:#94a3b8;font-size:11px;">（無內容）</div>'}
      </div></div>
    </div>
  `;
}

function formatBody(body, type) {
  if (body === null || body === undefined) return "";
  if (typeof body === "object") {
    try { return JSON.stringify(body, null, 2); } catch { return String(body); }
  }
  return String(body);
}
function escapeAttr(s) { return String(s||"").replace(/"/g, "&quot;").replace(/\n/g, "&#10;"); }

function exportLogs() {
  const data = JSON.stringify(allLogs, null, 2);
  const blob = new Blob([data], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `api-inspector-${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function copyCurl() {
  if (!currentDetail) return;
  const l = currentDetail;
  let curl = `curl -X ${l.method} '${l.url}'`;
  Object.entries(l.requestHeaders||{}).forEach(([k,v]) => {
    curl += ` \\\n  -H '${k}: ${v}'`;
  });
  if (l.requestBody && l.method !== "GET" && l.method !== "HEAD") {
    let bodyStr = typeof l.requestBody === "object" ? JSON.stringify(l.requestBody) : String(l.requestBody);
    bodyStr = bodyStr.replace(/'/g, "'\\''");
    curl += ` \\\n  --data-raw '${bodyStr}'`;
  }
  navigator.clipboard.writeText(curl).then(() => {
    const btn = document.getElementById("btnCopyCurl");
    const old = btn.textContent; btn.textContent = "已複製";
    setTimeout(() => btn.textContent = old, 1200);
  });
}

init();
