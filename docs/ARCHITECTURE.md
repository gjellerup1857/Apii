# Architecture

## 總覽

```
頁面 (example.com)
  ├─ MAIN world: injected.js ──► window.postMessage(API_INSPECTOR_LOG)
  │     patch fetch / XHR, clone response
  │
  └─ ISOLATED world: content.js ──► chrome.runtime.sendMessage(API_LOG)
        注入 injected.js + 橋接
                │
                ▼
        background.js (Service Worker)
        ├─ 儲存: chrome.storage.local (logs, enabled, floating)
        ├─ 廣播: chrome.runtime.sendMessage(NEW_LOG)
        └─ 徽章: chrome.action.setBadgeText

  呈現層 (皆訂閱 background / storage)
  ├─ popup.html (380x600, action.default_popup)
  ├─ fullpage.html (RWD 雙欄, tabs.create)
  ├─ sidepanel.html (chrome.sidePanel, 複用 fullpage)
  └─ floating-panel (content_scripts 注入, iframe→popup.html, 可拖曳縮放置頂)
```

## 攔截層

- **為何雙 world**：`fetch/XHR` 完整 `body/headers/response` 只能在 `MAIN` world 取得；`content.js` 為 `ISOLATED`，故動態插入 `<script src=chrome.runtime.getURL("injected.js")>`，以 `window.postMessage` 跨 world，再由 `content.js` 轉 `chrome.runtime.sendMessage` 到 background。
- **fetch**：包裹 `window.fetch`，處理 `Request` / `init`，`performance.now()` 計時，`clone().text()` → `JSON.parse` 嘗試，`>50KB` 截斷，忽略 `chrome-extension://`
- **XHR**：覆寫 `open/send/setRequestHeader/getAllResponseHeaders`，記錄 `_apiInspector`，`loadend` 事件收集 `status/responseText`，支援 `json/blob/arraybuffer`

## 儲存與同步

- `background.js` 維護 `logs[]`（最多 1000，`MAX_LOGS`），`persist()` → `chrome.storage.local.set({apiInspectorLogs})`，配額滿時縮至 500。
- `broadcast("NEW_LOG")` 透過 `chrome.runtime.sendMessage`，各 UI 同時監聽 `onMessage` 與 `storage.onChanged`。
- `enabled` 與 `floating` 狀態同樣存 `storage.local`，`content.js` 透過 `storage.onChanged` 同步 `postMessage({enabled})` 到 `injected.js`。

## UI 層

- **popup**：`popup.html/css/js`，`flex:1` + `overflow-y:auto` + `card{flex-shrink:0}` 避免壓縮，`drawer` 滑入，`detail-section.collapsed` 僅收 `detail-body`，`applyAutoCollapse` 以 `scrollHeight > 0.5*vh` 自動收合，`overflow-wrap:anywhere` 防止橫向溢出。
- **fullpage**：`grid: 420px 1fr` → `@media 768px` 單欄 + `mobile-drawer`，`detail-content` 與 popup 同步邏輯。
- **sidepanel**：複用 `fullpage`，`sidepanel.html` 覆蓋窄版樣式，`chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false})`。
- **floating-panel**：`floating-panel.js/css` 於 `content_scripts: document_idle` 注入，`div#api-inspector-floating-root{position:fixed; z-index:2147483646}` 含 header（拖曳）、`iframe→popup.html`、`resize` 句柄，`pinned` 切 `z-index:2147483647` 與 `chrome.storage`，`drag/resize` 透過 `mousedown→mousemove→mouseup` 並 `pointerEvents:none` 於 iframe。

## 訊息協定

| Type | 方向 | 說明 |
|------|------|------|
| `API_LOG` | injected→content→background | 單筆日誌 |
| `GET_LOGS/GET_ENABLED` | UI→background | 拉取全量 |
| `NEW_LOG/LOGS_CLEARED/ENABLED_CHANGED` | background→UI | 廣播 |
| `TOGGLE_ENABLED` | UI→background | 切啟用 |
| `OPEN_FULLPAGE` | UI→background | `tabs.create(fullpage.html)` |
| `OPEN_SIDEPANEL` | UI→background | `sidePanel.open({windowId})` |
| `SHOW/HIDE/TOGGLE_FLOATING` | UI→content | 懸浮控制 |

## 權限

`permissions: storage,tabs,sidePanel,activeTab,scripting` + `host_permissions: <all_urls>`。僅 `activeTab` 用於查詢當前分頁，`scripting` 用於 fallback 注入懸浮面板。

## 效能與限制

- 截斷 50KB 避免 `storage` 爆量（Chrome `storage.local` 約 10MB）
- `chrome.action.setBadgeText` 每秒更新，顯示 `999+`
- `all_frames:true` 於 `content.js` 確保 iframe 內 API 亦捕獲
