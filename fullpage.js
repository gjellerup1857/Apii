let allLogs = [];
let filterType = "all";
let searchQuery = "";
let domainFilter = "";
let methodFilter = "";
let selectedId = null;
let autoScroll = true;

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const badgeEl = document.getElementById("badge");
const detailEmpty = document.getElementById("detailEmpty");
const detailContent = document.getElementById("detailContent");
const mobileDrawer = document.getElementById("mobileDrawer");
const mobileDetail = document.getElementById("mobileDetail");
const domainSelect = document.getElementById("domainSelect");
const methodSelect = document.getElementById("methodSelect");
const searchInput = document.getElementById("searchInput");
const btnClearSearch = document.getElementById("btnClearSearch");
const enableToggle = document.getElementById("enableToggle");

// Init
function init() {
  loadLogs();
  bindEvents();
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NEW_LOG") {
      allLogs.push(msg.data);
      refresh();
      if (autoScroll && isMobile()) {
        // scroll list to top where newest is
        listEl.scrollTop = 0;
      }
    } else if (msg.type === "LOGS_CLEARED") {
      allLogs = [];
      selectedId = null;
      showEmptyDetail();
      refresh();
    } else if (msg.type === "LOGS_UPDATED") {
      allLogs = msg.data || [];
      refresh();
    } else if (msg.type === "ENABLED_CHANGED") {
      enableToggle.checked = !!msg.data;
    }
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.apiInspectorLogs) {
      allLogs = c.apiInspectorLogs.newValue || [];
      refresh();
    }
    if (c.apiInspectorEnabled) enableToggle.checked = !!c.apiInspectorEnabled.newValue;
  });
}

function loadLogs() {
  chrome.runtime.sendMessage({ type: "GET_LOGS" }, (res) => {
    if (chrome.runtime.lastError) {
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
  document.getElementById("btnClear")?.addEventListener("click", () => {
    if (!allLogs.length) return;
    if (!confirm("確定要清空所有記錄？")) return;
    chrome.runtime.sendMessage({ type: "CLEAR_LOGS" }, () => {
      allLogs = []; selectedId = null; showEmptyDetail(); refresh();
      toast("已清空");
    });
  });
  document.getElementById("btnExport")?.addEventListener("click", exportLogs);
  document.getElementById("btnSidePanel")?.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (chrome.sidePanel && tab) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        toast("已嘗試開啟側邊欄");
        return;
      }
    } catch (e) {
      console.warn(e);
    }
    toast("請手動點擊擴充功能圖示右鍵 → 開啟側邊欄");
  });
  enableToggle?.addEventListener("change", () => {
    chrome.runtime.sendMessage({ type: "TOGGLE_ENABLED", enabled: enableToggle.checked });
    toast(enableToggle.checked ? "已啟用監控" : "已暫停監控");
  });
  document.querySelectorAll("#filterTabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#filterTabs button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterType = btn.dataset.filter;
      refresh();
    });
  });
  domainSelect?.addEventListener("change", () => { domainFilter = domainSelect.value; refresh(); });
  methodSelect?.addEventListener("change", () => { methodFilter = methodSelect.value; refresh(); });
  searchInput?.addEventListener("input", () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    if (btnClearSearch) btnClearSearch.style.display = searchQuery ? "block" : "none";
    refresh();
  });
  btnClearSearch?.addEventListener("click", () => { if(searchInput) searchInput.value=""; searchQuery=""; btnClearSearch.style.display="none"; refresh(); });
  document.getElementById("autoScroll")?.addEventListener("change", (e) => autoScroll = e.target.checked);
  document.getElementById("btnCloseDrawer")?.addEventListener("click", closeMobileDrawer);
  document.getElementById("btnCopyCurl")?.addEventListener("click", copyCurl);
  // Detail pane: delegated copy handling only; head toggle handled by bindDetailSectionToggles (collapsed class)
  detailContent?.addEventListener("click", (e) => {
    if (e.target.matches("[data-action='copy-curl']")) copyCurl();
    if (e.target.matches("[data-action='copy']")) {
      const txt = e.target.getAttribute("data-copy");
      copyText(txt, e.target);
    }
  });
  mobileDetail?.addEventListener("click", (e) => {
    if (e.target.matches("[data-action='copy']")) {
      copyText(e.target.getAttribute("data-copy"), e.target);
    }
    if (e.target.matches("[data-action='copy-curl']")) copyCurl();
  });
}

function isMobile() { return window.innerWidth <= 768; }

function filteredLogs() {
  let logs = [...allLogs].reverse();
  if (filterType === "fetch") logs = logs.filter(l=>l.type==="fetch");
  else if (filterType==="xhr") logs = logs.filter(l=>l.type==="xhr");
  else if (filterType==="error") logs = logs.filter(l=>l.status>=400||l.status===0);
  else if (filterType==="success") logs = logs.filter(l=>l.status>=200&&l.status<300);
  if (domainFilter) logs = logs.filter(l=>l.domain===domainFilter);
  if (methodFilter) logs = logs.filter(l=>l.method===methodFilter);
  if (searchQuery) {
    logs = logs.filter(l=>{
      const hay = `${l.method} ${l.url} ${l.status} ${l.domain} ${JSON.stringify(l.requestBody||"")} ${JSON.stringify(l.responseBody||"")}`.toLowerCase();
      return hay.includes(searchQuery);
    });
  }
  return logs;
}

function refresh() {
  const logs = filteredLogs();
  badgeEl.textContent = `${allLogs.length} 條記錄 • 顯示 ${logs.length}`;
  document.getElementById("statOk").textContent = allLogs.filter(l=>l.status>=200&&l.status<300).length;
  document.getElementById("statErr").textContent = allLogs.filter(l=>l.status>=400||l.status===0).length;
  document.getElementById("statFetch").textContent = allLogs.filter(l=>l.type==="fetch").length;
  document.getElementById("statXhr").textContent = allLogs.filter(l=>l.type==="xhr").length;

  updateDomainOptions();
  renderList(logs);

  if (logs.length===0) {
    emptyEl.style.display="flex";
    listEl.style.display="none";
    if (allLogs.length===0) {
      emptyEl.querySelector(".empty-title").textContent="尚未擷取到任何請求";
    } else {
      emptyEl.querySelector(".empty-title").textContent="沒有符合條件的記錄";
    }
  } else {
    emptyEl.style.display="none";
    listEl.style.display="flex";
  }

  // if selectedId not in filtered, clear selection? Keep but highlight may not show
  if (selectedId && !logs.find(l=>l.id===selectedId)) {
    // keep detail but don't highlight
  }
  // update selection highlight
  document.querySelectorAll(".card").forEach(c=>{
    c.classList.toggle("selected", c.dataset.id===selectedId);
  });
}

function updateDomainOptions(){
  const domains = [...new Set(allLogs.map(l=>l.domain).filter(Boolean))].sort();
  const cur = domainSelect.value;
  domainSelect.innerHTML='<option value="">全部網域</option>';
  domains.forEach(d=>{
    const o=document.createElement("option"); o.value=d; o.textContent=d; if(d===cur) o.selected=true; domainSelect.appendChild(o);
  });
  if(!domains.includes(cur)) domainFilter="";
}

function renderList(logs){
  listEl.innerHTML="";
  logs.forEach(log=>{
    const card=document.createElement("div");
    card.className="card"+(log.id===selectedId?" selected":"");
    card.dataset.id=log.id;
    const urlPath=(()=>{ try{const u=new URL(log.url); return u.pathname+u.search+u.hash;}catch{return log.url;}})();
    const statusCls=log.status===0?"s0":log.status<300?"s2":log.status<400?"s3":log.status<500?"s4":"s5";
    const time=new Date(log.timestamp).toLocaleTimeString("zh-TW",{hour12:false});
    card.innerHTML=`
      <div class="card-header">
        <span class="method ${log.method}">${log.method}</span>
        <div class="url-wrap">
          <div class="url-path" title="${esc(log.url)}">${esc(urlPath)}</div>
          <div class="url-full">${esc(log.domain||"")}</div>
        </div>
        <span class="status ${statusCls}">${log.status||"ERR"}</span>
      </div>
      <div class="card-meta">
        <span class="type-badge">${log.type}</span>
        <span>${esc(log.responseBodyType||"")}</span>
        <span class="time">${time}</span>
        <span class="duration">${log.duration}ms</span>
        <button class="copy-btn" data-action="delete" data-id="${log.id}" style="margin-left:6px;font-size:10px;">刪除</button>
      </div>
    `;
    card.addEventListener("click", (e)=>{
      if(e.target.matches("[data-action='delete']")) {
        e.stopPropagation();
        deleteLog(log.id);
        return;
      }
      selectLog(log.id);
    });
    listEl.appendChild(card);
  });
}

function selectLog(id){
  selectedId=id;
  document.querySelectorAll(".card").forEach(c=>c.classList.toggle("selected", c.dataset.id===id));
  const log=allLogs.find(l=>l.id===id);
  if(!log) return;
  // desktop detail pane
  detailEmpty.style.display="none";
  detailContent.style.display="flex";
  detailContent.innerHTML=renderDetail(log, false);
  bindDetailSectionToggles(detailContent);
  applyAutoCollapse(detailContent);

  // mobile drawer
  if(isMobile()){
    mobileDetail.innerHTML=renderDetail(log, true);
    bindDetailSectionToggles(mobileDetail);
    applyAutoCollapse(mobileDetail);
    mobileDrawer.classList.add("open");
  } else {
    closeMobileDrawer();
  }
  // bind copy inside desktop handled via delegation
}

function bindDetailSectionToggles(container){
  if(!container) return;
  container.querySelectorAll(".detail-head").forEach(h=>{
    // avoid duplicate listeners: clone and replace or check flag
    if(h.dataset.bound==="1") return;
    h.dataset.bound="1";
    h.addEventListener("click", (e)=>{
      if(e.target.closest(".copy-btn")) return;
      const section = h.closest(".detail-section");
      if(section) section.classList.toggle("collapsed");
    });
  });
  container.querySelectorAll("[data-action='copy']").forEach(btn=>{
    if(btn.dataset.bound==="1") return;
    btn.dataset.bound="1";
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const txt = btn.getAttribute("data-copy");
      copyText(txt, btn);
    });
  });
  // stop propagation for copy buttons inside head
  container.querySelectorAll(".detail-head .copy-btn").forEach(btn=>{
    btn.addEventListener("click", (e)=> e.stopPropagation());
  });
}

function applyAutoCollapse(container){
  if(!container) return;
  const threshold = Math.max(260, (window.innerHeight || 800) * 0.5);
  // use rAF to measure after layout - include inner scroll heights
  requestAnimationFrame(()=>{
    container.querySelectorAll(".detail-section").forEach(section=>{
      const body = section.querySelector(".detail-body");
      if(!body) return;
      let h = body.scrollHeight;
      const jsonView = body.querySelector(".json-view");
      if(jsonView) h = Math.max(h, jsonView.scrollHeight);
      const inner = body.querySelector(".detail-body-inner");
      if(inner) h = Math.max(h, inner.scrollHeight);
      if(h > threshold){
        section.classList.add("collapsed");
      }
    });
  });
}

function showEmptyDetail(){
  detailEmpty.style.display="flex";
  detailContent.style.display="none";
  detailContent.innerHTML="";
}

function closeMobileDrawer(){
  mobileDrawer.classList.remove("open");
}

function deleteLog(id){
  chrome.runtime.sendMessage({type:"DELETE_LOG", id}, ()=>{
    allLogs=allLogs.filter(l=>l.id!==id);
    if(selectedId===id){ selectedId=null; showEmptyDetail(); closeMobileDrawer(); }
    refresh();
    toast("已刪除");
  });
}

function renderDetail(log, isMobileView){
  const reqBodyStr=formatBody(log.requestBody, log.requestBodyType);
  const resBodyStr=formatBody(log.responseBody, log.responseBodyType);
  const reqHeaders=log.requestHeaders||{};
  const resHeaders=log.responseHeaders||{};
  const query=log.queryParams||{};
  function kvRows(obj){
    const ent=Object.entries(obj||{});
    if(ent.length===0) return '<div style="color:#94a3b8;font-size:11px;padding:6px 0;">（無）</div>';
    return ent.map(([k,v])=>{
      let valStr;
      if(v && typeof v==="object"){ try{ valStr=JSON.stringify(v,null,2);}catch{ valStr=String(v);} }
      else {
        const s=String(v).trim();
        if((s.startsWith("{")&&s.endsWith("}"))||(s.startsWith("[")&&s.endsWith("]"))){
          try{ valStr=JSON.stringify(JSON.parse(s),null,2); }catch{ valStr=String(v); }
        } else valStr=String(v);
      }
      if(valStr.includes("\n")){
        return `<div class="kv kv-json"><span class="kv-key">${esc(k)}</span><span class="kv-val"><pre class="json-view" style="margin:4px 0;max-height:160px;">${esc(valStr)}</pre></span></div>`;
      }
      return `<div class="kv"><span class="kv-key">${esc(k)}</span><span class="kv-val">${esc(valStr)}</span></div>`;
    }).join("");
  }
  function jsonSection(obj){
    if(!obj || Object.keys(obj).length===0) return "";
    try{
      const jsonStr=JSON.stringify(obj,null,2);
      if(jsonStr.length>20){
        return `<details style="margin-top:8px;"><summary style="font-size:11px;color:#0ea5e9;cursor:pointer;">顯示為 JSON</summary>${renderJsonBlock(jsonStr)}</details>`;
      }
    }catch{}
    return "";
  }
  const timeline=`${new Date(log.timestamp).toLocaleString("zh-TW")} • ${log.duration}ms • ${log.type.toUpperCase()}`;
  const statusCls=log.status===0?"s0":log.status<300?"s2":log.status<400?"s3":log.status<500?"s4":"s5";
  const curlBtn = `<button class="copy-btn" data-action="copy-curl">複製 cURL</button>`;
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;max-width:100%;">
      <span class="method ${log.method}">${log.method}</span>
      <span class="status ${statusCls}">${log.status} ${esc(log.statusText||"")}</span>
      <span style="font-size:12px;color:#64748b;overflow-wrap:anywhere;word-break:break-word;min-width:0;">${esc(timeline)}</span>
      <span style="margin-left:auto;">${curlBtn}</span>
    </div>
    <div class="detail-url">${esc(log.url)}</div>
    ${log.pageUrl?`<div style="font-size:11px;color:#94a3b8;overflow-wrap:anywhere;word-break:break-word;max-width:100%;">來源頁面：${esc(log.pageUrl)}</div>`:""}
    <div style="font-size:11px;color:#64748b;display:flex;gap:12px;flex-wrap:wrap;min-width:0;"><span style="overflow-wrap:anywhere;">Domain: <b>${esc(log.domain)}</b></span><span>Tab: ${log.tabId||"-"}</span></div>

    <div class="detail-section">
      <div class="detail-head"><div class="detail-head-left"><span class="chevron">▼</span> 查詢參數 <span class="count">${Object.keys(query).length} 個</span></div></div>
      <div class="detail-body"><div class="detail-body-inner">${kvRows(query)}${jsonSection(query)}</div></div>
    </div>

    <div class="detail-section">
      <div class="detail-head"><div class="detail-head-left"><span class="chevron">▼</span> 請求 Headers <span class="count">${Object.keys(reqHeaders).length} 個</span></div></div>
      <div class="detail-body"><div class="detail-body-inner">${kvRows(reqHeaders)}${jsonSection(reqHeaders)}</div></div>
    </div>

    <div class="detail-section">
      <div class="detail-head"><div class="detail-head-left"><span class="chevron">▼</span> 請求 Body <span class="count">${esc(log.requestBodyType||"empty")}</span></div><div class="head-actions"><button class="copy-btn" data-action="copy" data-copy="${escAttr(reqBodyStr)}">複製 JSON</button></div></div>
      <div class="detail-body"><div class="detail-body-inner">${reqBodyStr ? (isJsonContent(log.requestBody, log.requestBodyType) ? renderJsonBlock(reqBodyStr) : `<pre class="json-view">${esc(reqBodyStr)}</pre>`) : '<div style="color:#94a3b8;font-size:12px;">（無 Body）</div>'}</div></div>
    </div>

    <div class="detail-section">
      <div class="detail-head"><div class="detail-head-left"><span class="chevron">▼</span> 回應 Headers <span class="count">${Object.keys(resHeaders).length} 個</span></div></div>
      <div class="detail-body"><div class="detail-body-inner">${kvRows(resHeaders)}${jsonSection(resHeaders)}</div></div>
    </div>

    <div class="detail-section">
      <div class="detail-head"><div class="detail-head-left"><span class="chevron">▼</span> 回應 Body <span class="count">${esc(log.responseBodyType||"")}</span></div><div class="head-actions"><button class="copy-btn" data-action="copy" data-copy="${escAttr(resBodyStr)}">複製 JSON</button></div></div>
      <div class="detail-body"><div class="detail-body-inner">${resBodyStr ? (isJsonContent(log.responseBody, log.responseBodyType) ? renderJsonBlock(resBodyStr) : `<pre class="json-view">${esc(resBodyStr)}</pre>`) : '<div style="color:#94a3b8;font-size:12px;">（無內容）</div>'}</div></div>
    </div>
  `;
}

function formatBody(body, type){
  if(body===null||body===undefined) return "";
  if(typeof body==="object"){ try{return JSON.stringify(body,null,2);}catch{return String(body);} }
  const str=String(body).trim();
  if(!str) return "";
  if((str.startsWith("{")&&str.endsWith("}"))||(str.startsWith("[")&&str.endsWith("]"))){
    try{ const p=JSON.parse(str); return JSON.stringify(p,null,2); }catch{}
  }
  return String(body);
}
function isJsonContent(body, type){
  if(type==="json") return true;
  if(body && typeof body==="object") return true;
  const s=String(body||"").trim();
  if(!s) return false;
  if((s.startsWith("{")&&s.endsWith("}"))||(s.startsWith("[")&&s.endsWith("]"))){
    try{ JSON.parse(s); return true;}catch{}
  }
  return false;
}
function renderJsonBlock(jsonStr){
  const escaped=esc(jsonStr);
  const highlighted=escaped
    .replace(/(&quot;(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\&quot;])*&quot;\s*:)/g,'<span style="color:#93c5fd">$1</span>')
    .replace(/:\s*(&quot;(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\&quot;])*&quot;)/g,': <span style="color:#86efac">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*(e[+-]?\d+)?)/g,': <span style="color:#fcd34d">$1</span>')
    .replace(/:\s*(true|false)/g,': <span style="color:#c4b5fd">$1</span>')
    .replace(/:\s*(null)/g,': <span style="color:#94a3b8">$1</span>');
  return `<pre class="json-view json-formatted">${highlighted}</pre>`;
}
function esc(s){ if(s===null||s===undefined) return ""; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escAttr(s){ return String(s||"").replace(/"/g,"&quot;").replace(/\n/g,"&#10;"); }
function copyText(txt, btn){
  navigator.clipboard.writeText(txt||"").then(()=>{
    toast("已複製");
    if(btn){ const old=btn.textContent; btn.textContent="已複製"; setTimeout(()=>btn.textContent=old,1200); }
  });
}
function copyCurl(){
  const log=allLogs.find(l=>l.id===selectedId);
  if(!log) return;
  let curl=`curl -X ${log.method} '${log.url}'`;
  Object.entries(log.requestHeaders||{}).forEach(([k,v])=>{ curl+=` \\\n  -H '${k}: ${v}'`; });
  if(log.requestBody && !["GET","HEAD"].includes(log.method)){
    let bodyStr=typeof log.requestBody==="object"?JSON.stringify(log.requestBody):String(log.requestBody);
    bodyStr=bodyStr.replace(/'/g,"'\\''");
    if(bodyStr) curl+=` \\\n  --data-raw '${bodyStr}'`;
  }
  copyText(curl, null);
}
function exportLogs(){
  const data=JSON.stringify(allLogs,null,2);
  const blob=new Blob([data],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=`api-inspector-${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.json`;
  a.click(); URL.revokeObjectURL(url); toast("已匯出 JSON");
}
function toast(msg){
  const t=document.getElementById("toast");
  t.textContent=msg; t.classList.add("show");
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.remove("show"),1800);
}

init();
window.addEventListener("resize", ()=>{
  if(!isMobile()) closeMobileDrawer();
});
