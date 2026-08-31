# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Privacy

- 本擴充功能所有擷取僅存於 `chrome.storage.local`，不會上傳至任何伺服器
- 不注入第三方腳本，不收集識別資訊
- `host_permissions: <all_urls>` 僅用於注入 `fetch/XHR` 攔截，不會主動讀取頁面 DOM 以外內容

## Reporting a Vulnerability

請勿公開提交安全漏洞。請透過以下方式私下回報：

1. GitHub → Security → Report a vulnerability（若已啟用）
2. 或開 private Issue 並標註 `security`
3. 或直接聯繫維護者（在 GitHub Profile 留有聯絡方式）

我們會在 72 小時內回應，14 天內提供修復或緩解方案。修復後會以 `SECURITY` 標籤發布並更新 `CHANGELOG.md`。

## 最佳實踐

- 安裝後請確認來源為官方 GitHub Release 的 `.zip` 或 Chrome Web Store（若上架）
- 如需處理敏感 API（含 Token），建議在測試環境使用，或關閉「監控」開關
