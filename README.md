# 📈 股票庫存管理 PWA

> 一款輕量、離線優先的個人持股追蹤工具。採用 Neumorphism 設計語言，整合 Fugle API 即時報價，支援 PWA 安裝至手機桌面。

[![PWA](https://img.shields.io/badge/PWA-Ready-green?logo=googlechrome)]()
[![Version](https://img.shields.io/badge/version-3.5.4-blue)]()
[![License](https://img.shields.io/badge/license-MIT-orange)]()

## ✨ 功能特色

- **即時股價追蹤**：整合 Fugle MarketData API，自動更新持股損益
- **雙 Key 輪替機制**：支援主要/備用 API Key，降低限流風險
- **智慧請求佇列**：針對 Fugle 免費版優化，內建 429 退避與間隔控制
- **離線快取支援**：Service Worker 快取靜態資源，無網路仍可檢視上次報價
- **資料備份還原**：一鍵匯出/匯入 JSON，換裝置不丟失持股紀錄
- **Neumorphism UI**：柔和擬物化介面，支援深色模式擴充
- **PWA 原生體驗**：全螢幕啟動、自訂圖示、無需透過瀏覽器網址列操作

## 🚀 快速開始

### 線上體驗
👉 [GitHub Pages Demo](YOUR_GITHUB_PAGES_URL) （部署後替換此連結）

### 本機開發
```bash
git clone https://github.com/YOUR_USERNAME/stock-portfolio.git
cd stock-portfolio
# 使用任意靜態伺服器啟動（SW 需 HTTPS 或 localhost）
npx serve .
# 或
python3 -m http.server 8000
```

## 🔑 API 設定（必讀）

本專案使用 [Fugle MarketData API](https://developer.fugle.tw/) 取得即時報價。

### ⚠️ 安全警告
> **絕對不要將 API Key 提交至 Git 倉庫！**  
> 本專案所有 Key 僅儲存於瀏覽器 `localStorage`，不會寫入原始碼。  
> 若您不慎洩漏 Key，請立即至 Fugle 控制台重新產生。

### 設定步驟
1. 前往 [Fugle Developer Portal](https://developer.fugle.tw/docs/key/) 申請免費 API Key
2. 開啟 App → 點擊底部「▼」展開選單 → 「⚙️ 進階設定」
3. 填入主要 Key（必填）與備用 Key（選填）
4. 點擊「儲存設定並關閉」

### 免費版限制說明
| 項目 | 說明 |
|------|------|
| 每日請求總量 | ✅ 無限制 |
| 瞬時 Rate Limit | ⚠️ 有（約 30-60 req/min） |
| 建議持股數量 | ≤ 20 檔（避免輪詢觸發限流） |
| 非交易時段 | 自動暫停輪詢，不消耗請求 |

App 已內建請求佇列與指數退避機制，正常使用的狀況下不會觸發限流。若仍遇到 429 錯誤，請減少持股數量或拉長手動刷新間隔。

## 📱 PWA 安裝教學

### iOS Safari
1. 用 Safari 開啟網頁
2. 點擊底部分享按鈕 ↗️
3. 選擇「加入主畫面」

### Android Chrome
1. 用 Chrome 開啟網頁
2. 点击右上角選單 ⋮
3. 選擇「安裝應用程式」或「加到主畫面」

### Desktop Chrome / Edge
1. 開啟網頁後，網址列右側會出現安裝圖示 ➕
2. 點擊並確認安裝

## 💾 資料備份與還原

- **匯出**：進階設定 → 📥 匯出備份 → 下載 `stock-backup-YYYY-MM-DD.json`
- **匯入**：進階設定 → 📤 匯入還原 → 選擇先前匯出的 JSON 檔案
- **格式相容性**：v3.5.x 版本備份檔案可互相匯入

> ⚠️ 匯入會**覆蓋**現有持股資料，請先匯出備份再執行還原。

## 🏗️ 技術架構

| 模組 | 技術 | 說明 |
|------|------|------|
| 前端框架 | Vanilla JS | 零依賴，單一 HTML 檔案 |
| 樣式系統 | CSS Variables + Neumorphism | 統一設計令牌，易於主題切換 |
| 離線快取 | Service Worker (Cache-First) | 靜態資源快取，API 請求強制走網路 |
| API 管理 | 自研 Request Queue | 佇列化 + 429 指數退避 + 300ms 間隔 |
| 資料持久化 | localStorage | 持股與設定存於瀏覽器本地 |
| 圖示 | SVG + Maskable | 適配各平台 PWA 圖示裁切規範 |

## 📂 專案結構