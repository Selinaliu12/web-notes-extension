# 網頁筆記 (Safari / Chrome 擴充功能)

在網頁上選取文字 → 螢光標記 + 註解 + 標籤;每頁可寫整頁筆記;所有資料只存本機,在「複習頁」集中搜尋、篩選、匯出。

## 安裝到 Safari(需要完整 Xcode)

1. 從 App Store 安裝 **Xcode**(只裝 Command Line Tools 不夠),開啟一次並同意授權。
2. 切換開發者工具,並轉換擴充功能:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcrun safari-web-extension-converter extension --app-name "網頁筆記" --macos-only
```

3. 在跳出的 Xcode 專案按 ▶ 執行(可用免費 Apple ID 做 Personal Team 簽署)。
4. Safari → 設定 → 進階 → 勾選「在選單列中顯示開發/功能表」→ 開發 → 勾選「允許未簽署的延伸功能」(每次重開 Safari 需重勾)。
5. Safari → 設定 → 延伸功能 → 啟用「網頁筆記」,並把網站權限設為「所有網站:允許」。

## 先用 Chrome 試用(不需 Xcode)

chrome://extensions → 開啟開發人員模式 → 載入未封裝項目 → 選 `extension` 資料夾。

## 使用

- 選取文字 → 按「✎ 標記 / 筆記」→ 寫註解、加標籤、選顏色 → 儲存
- 點已標記的文字可編輯/刪除
- 右下角 ✎ 或工具列圖示 → 本頁筆記欄(整頁筆記、本頁標記列表)
- 工具列圖示 → 開啟複習頁(搜尋、標籤篩選、匯出 Markdown、備份 JSON)
