# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5] - 2026-08-31

### Changed
- 與 DevTools 對齊：僅顯示當前分頁主框架（`frameId===0`），`manifest` 改 `all_frames:false`，`background` 僅收主框架
- 導航自動清空：`tabs.onUpdated(status:loading)` / `webNavigation.onCommitted` 按 `tabId` 清除該分頁舊日誌（含同 URL 重整），新增 `CLEAR_LOGS_FOR_TAB`，`badge` 改按分頁獨立顯示

### Fixed
- 修復重整後仍大量：`tabs.onUpdated` 原僅 `changeInfo.url` 導致 reload 未清，現改 `status:loading` 全觸發
- 新增篩選與 DevTools 對齊：`僅 API (JSON/含 /api//graphql)` 預設勾選、`僅同源` 可選，`popup`/`fullpage` 皆支援，`filteredLogs` 先過 `isApiLog` 與 `domain===origin`
- UI 僅顯示 `tabId` 匹配當前分頁：`popup`/`sidepanel`/`floating` 自動解析 `currentTabId/origin`，`fullpage` 新增 `tabSelect` 下拉（全部/單一 tab），統計、域篩選、匯出、清空皆以可見為準

## [1.0.4] - 2026-08-31

### Fixed
- 修正 Logo 圓角被瀏覽器二次裁切：改回方角黑底（`corner alpha 255`），保留內層白框圓角，避免 Brave 擴充功能列的圓角遮擋內容，已重新生成 16/32/48/64/128/256/512/1024 方角版

## [1.0.3] - 2026-08-31

### Changed
- 更換全新 Logo：伺服器白框圓角 + 藍紅指示，上層藍左紅右、下層紅左藍右，黑色背景圓角外框（透明圓角），已生成 16/32/48/64/128/256/512/1024 全尺寸，`manifest.json` 同步更新 `icons` 與 `action.default_icon`

## [1.0.2] - 2026-08-31

### Added
- 懸浮面板（floating-panel）可拖曳移動、右下/右/下三向縮放、📌 固定置頂、最小化、重置
- 側邊欄新增 `懸浮` 與 `✕ 關閉` 按鈕，關閉後自動回到頁面懸浮
- `floating-panel.js/css` 透過 `chrome.scripting` 動態注入，支援 fallback 為 `windows.create` popup

### Fixed
- `popup` 展開到新標籤頁無作用：改為 `chrome.tabs.create` 直連並 `window.close()`，失敗才經 `background`
- 小面板大量卡片被壓縮：`flex-shrink:0; min-width:0` 與 `list{min-height:0}`
- 詳情 `Headers/Query` 顯示不完整、標題被遮：重構為 `section.collapsed` 僅收 `detail-body`，`kv` 改 `overflow-wrap:anywhere`
- 側欄/小面板文字溢出：新增 `max-width:100%` 與 `@media 360px` 縱向堆疊
- 單欄位超過半頁高度預設收合：`applyAutoCollapse` 依 `scrollHeight > 0.5*vh` 自動 `collapsed`

## [1.0.1] - 2026-08-31

### Fixed
- 詳情頁僅收內容不收標題，`detail-head` 加入 `chevron` 旋轉
- `fullpage.js` 防禦性 `?.` 綁定，避免 `sidepanel` 無 `methodSelect` 時崩潰
- RWD 窄版 320px 優化

## [1.0.0] - 2026-08-31

### Added
- 初始發布：`injected.js` 攔截 `fetch/XHR`，`content.js` 橋接，`background.js` 儲存與廣播
- `popup.html` 380×600 類 MetaMask 浮動面板，支援搜尋、篩選、詳情、cURL 複製
- `fullpage.html` RWD 雙欄 + Drawer，`sidepanel.html` 窄版複用
- 側邊欄 `chrome.sidePanel` 支援，徽章計數，`test.html` 測試頁
