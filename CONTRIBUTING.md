# Contributing to Apii

感謝你考慮貢獻！本專案採用 MIT 授權，歡迎任何形式的貢獻。

## 開發環境

- 作業系統：macOS / Windows / Linux 皆可
- 瀏覽器：Brave（推薦）或 Chrome 115+（需支援 `chrome.sidePanel`）
- 無需編譯，純 Vanilla JS + Manifest V3

```bash
git clone https://github.com/<your-username>/Apii.git
cd Apii
# 用 Python 啟動測試頁
python3 -m http.server 8000
# 瀏覽器開啟 brave://extensions/ → 開發者模式 → 載入未封裝項目 → 選擇本資料夾
```

## 分支與提交

- `main` 為主分支，保持可發布狀態
- 功能分支命名：`feat/<scope>`、`fix/<scope>`、`docs/<scope>`
- 提交訊息遵循 Conventional Commits：`feat: 支援 HAR 匯出`、`fix: 修正 popup 卡片壓縮`

```bash
git checkout -b feat/har-export
git add .
git commit -m "feat: 支援 HAR 匯出"
git push origin feat/har-export
# 發 PR 到 main
```

## 程式碼規範

- 不引入框架，保持零依賴
- `read` 優先於 `bash`，`edit` 保持最小變更
- 檔案超過 400 行請考慮拆分
- 註解精簡，避免長篇 chain-of-thought
- 所有 `chrome.*` 調用需處理 `chrome.runtime.lastError`

## 測試

- 手動測試：開啟 `test.html` 點擊各按鈕，確認 popup / fullpage / sidepanel / floating-panel 皆能收到
- 大量日誌測試：`testMultiple()` 連續 50 條，確認卡片不壓縮、詳情可收合

```bash
# 語法檢查
node --check background.js && node --check content.js && node --check injected.js && node --check popup.js && node --check fullpage.js && node --check floating-panel.js
python3 -m json.tool manifest.json > /dev/null && echo "manifest ok"
```

## Pull Request 流程

1. Fork 並建立分支
2. 完成變更並通過手動測試
3. 更新 `CHANGELOG.md` 與 `README.md`（如涉及功能）
4. 提交 PR，描述清楚：動機、實作、截圖/GIF、測試步驟
5. 維護者審核後合併

## 回報問題

- 請使用 GitHub Issue 模板（Bug / Feature）
- 提供瀏覽器版本、manifest 版本、重現步驟、預期 vs 實際
- 盡量附上 `chrome://extensions` 錯誤日誌與截圖

## 行為準則

請遵守 `CODE_OF_CONDUCT.md`，保持尊重與專業。

## 授權

提交即表示你同意以 MIT 授權貢獻。
