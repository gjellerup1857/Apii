# Development Guide

## 環境準備

- Node 20+（僅用於語法檢查，非必需）
- Python3（跑 `test.html`）
- Brave 1.60+ 或 Chrome 115+

## 本地開發

```bash
git clone <repo>
cd Apii
python3 -m http.server 8000
# 開 http://localhost:8000/test.html
```

1. `brave://extensions` → 開發者模式 → 載入未封裝項目 → 選 `Apii/`
2. 改檔後點 `重新載入`（或用 `chrome.runtime.reload()`）
3. 測試按鈕（`test.html`）：
   - Fetch GET / POST / Query / 404
   - XHR GET / POST FormData
   - 連續 5/50 條

## 除錯

- `background`：`brave://extensions` → `Service Worker` 檢查
- `content/injected`：頁面 Console → `VM` 或 `Sources`
- `popup/sidepanel/fullpage`：對該頁右鍵 → 檢查
- `floating-panel`：頁面檢查 `#api-inspector-floating-root` 與 `iframe`

```bash
# 快速語法檢查
node --check background.js && node --check content.js && node --check injected.js && node --check popup.js && node --check fullpage.js && node --check floating-panel.js && echo ok
python3 -m json.tool manifest.json > /dev/null && echo "manifest ok"
```

## 專案約定

- 零依賴，Vanilla JS
- `manifest_version: 3`，`action.default_popup` 與 `side_panel` 共存
- 樣式以手寫 CSS 為主，RWD 斷點 1024 / 768 / 420 / 360

## 發布

```bash
# 更新 version 於 manifest.json 與 CHANGELOG.md
zip -r dist/Apii-v1.0.2.zip . -x "*.git*" "*.DS_Store" "dist/*" "*.zip"
# 上傳到 GitHub Release（或 Chrome Web Store）
git tag v1.0.2 && git push origin v1.0.2
# GitHub Actions 會自動建置並發布 Release
```

## 常見問題

- **展開無作用**：確認 `permissions: tabs`，`popup` 需以 `chrome.tabs.create` 直連，避免僅走 `runtime.sendMessage`
- **側邊欄無法開啟**：`chrome.sidePanel.open` 需使用者手勢（點擊），非同步 `await` 需在點擊同步鏈中
- **懸浮 iframe 空白**：確認 `web_accessible_resources` 含 `popup.html`，且未被頁面 CSP 攔截（`allow="clipboard-read"` 已設）
- **儲存爆量**：`injected.js` 已截斷 `MAX_BODY_LENGTH=50000`，`background` 配額滿縮至 500 筆

## 目錄

```
Apii/
├─ manifest.json
├─ background.js
├─ content.js / injected.js
├─ floating-panel.js / .css
├─ popup.* / fullpage.* / sidepanel.html
├─ icons/
├─ docs/
├─ .github/
└─ test.html
```
