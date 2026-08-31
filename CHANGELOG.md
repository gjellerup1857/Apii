# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
