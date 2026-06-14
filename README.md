# 📈 股票庫存管理

一個具備 Neumorphism（新擬態）3D 設計風格的台股庫存管理 PWA 工具，支援即時報價、損益計算、歷史記錄與資料備份。

## ✨ 功能特色

- 🎨 **7 種主題切換**：亮色、暗色、科技、深藍、淡藍、粉紅、水泥風
- 📊 **即時股價查詢**：支援 Fugle API（主要）與 Yahoo Finance（備用）
- 💰 **損益計算**：今日損益、總未實現損益、ROI 百分比
- 📑 **3 個分頁**：可自訂名稱，獨立管理不同投資組合
- 📜 **歷史記錄**：每日損益快照，最多保留 50 筆
- 📥📤 **備份還原**：一鍵匯出/匯入 JSON 備份檔（含 API Key）
- 🌐 **全球指數**：可自訂 Google 試表來源顯示大盤指數
- 📱 **PWA 支援**：加入主畫面，離線快取基本頁面

## 🚀 部署到 GitHub Pages

1. Fork 或 Clone 此專案
2. 將所有檔案推送到 `main` 分支
3. 前往 **Settings → Pages → Source** 選擇 `main` 分支
4. 等待部署完成，即可透過 `https://你的帳號.github.io/你的repo名/` 存取

## ⚙️ 初始設定

### 1. 申請 Fugle API Key（推薦）
- 前往 [Fugle API](https://developer.fugle.tw/docs/key/) 申請免費 API Key
- 在 App 內點擊「進階」按鈕，輸入 API Key
- 支援兩組 Key 輪替使用，避免流量限制

### 2. 自訂全球指數來源（選填）
- 建立一個 Google 試表，發布為 CSV 格式
- 修改 `index.html` 中的 `googleCsvUrl` 變數
- 試表格式：第一欄指數名稱、第二欄價格、第三欄漲跌幅(%)

### 3. 加入手機主畫面
- **iOS Safari**：點擊分享按鈕 → 加入主畫面
- **Android Chrome**：點擊選單 → 安裝應用程式

## 📁 檔案結構

