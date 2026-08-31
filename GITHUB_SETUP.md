# 發布到 GitHub 指引

本文件說明如何將 `brave-api-inspector` 推送到 GitHub 並完成開源發布。

## 1. 在 GitHub 上建立空倉庫

1. 登入 GitHub → https://github.com/new
2. **Repository name**：`brave-api-inspector`（或自訂）
3. **Description**：`Brave / Chrome 擴充功能：自動擷取 fetch/XHR 請求參數與回應，支援浮動、側欄、懸浮拖曳、RWD`
4. **Visibility**：Public（開源）
5. **不要勾選** `Add a README file` / `Add .gitignore` / `Choose a license`（我們已本地建立）
6. 點 **Create repository**

## 2. 本地推送

本專案已初始化為獨立 git repo（`brave-api-inspector/.git`），並完成首次提交 `f489e9b`。

在 `brave-api-inspector` 目錄下執行：

```bash
cd "/Users/user/Documents/Default Project/brave-api-inspector"

# 1. 替換為你的 GitHub 倉庫 URL（以下用 SSH 為例，HTTPS 亦可）
git remote add origin git@github.com:<your-username>/brave-api-inspector.git
# 或 HTTPS
# git remote add origin https://github.com/<your-username>/brave-api-inspector.git

# 2. 確認遠端
git remote -v

# 3. 推送 main 分支
git push -u origin main

# 4. 建立並推送版本標籤（觸發 Release workflow）
git tag v1.0.2
git push origin v1.0.2
```

> 若 `origin` 已存在，先 `git remote remove origin` 再添加。

## 3. 驗證 CI

推送後前往 GitHub → Actions 分頁，確認 `CI` 工作流通過：
- `Validate manifest`
- `Syntax check`
- `Build zip` 並上傳 artifact

## 4. 發布 Release

- **自動**：推送 `v*` 標籤後，`.github/workflows/release.yml` 會自動打包 `dist/brave-api-inspector-v*.zip` 並建立 GitHub Release。
- **手動**：GitHub → Releases → Draft a new release → 選擇 `v1.0.2` → 上傳 `dist/brave-api-inspector-v1.0.2.zip`（本地 `npm run build:release` 產生）→ 發布。

## 5. 更新 package.json 與 README 的倉庫連結

推送前請替換佔位符：

```bash
# 將 package.json 的 repository.url 與 README 的所有 `your-username` 替換為你的 GitHub 帳號
grep -r "your-username" --include="*.md" --include="*.json" .
# 手動編輯或用 sed
sed -i '' 's/<your-username>/your-real-username/g' package.json README.md docs/*.md
git add -A && git commit -m "docs: 更新倉庫連結" && git push
```

## 6. Chrome Web Store（可選）

如需上架：

```bash
npm run build:release
# 產生 dist/brave-api-inspector-v1.0.2.zip
# 前往 https://chrome.google.com/webstore/devconsole 上傳
```

## 7. 本地開發快速指令

```bash
npm run lint          # 語法檢查
npm run build         # 打包 dist/brave-api-inspector.zip
npm run build:release # 帶版本號
npm run dev:server    # http://localhost:8000/test.html
```

## 8. 常見問題

- **gh not found**：本環境未安裝 GitHub CLI，請用 `git remote add` + `git push` 手動推送。
- **推送被拒**：確認 GitHub 倉庫為空、分支為 `main`、SSH key 已配置（`ssh -T git@github.com`）。
- **zip 被忽略**：`dist/` 與 `*.zip` 由 `.gitignore` 忽略，僅透過 CI artifact 或手動上傳到 Release，不直接提交到 repo。

---

完成後，你的開源地址將為 `https://github.com/<your-username>/brave-api-inspector`。
