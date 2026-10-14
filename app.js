/* ========================================================= 🔧 工具與字典 ========================================================= */
const $ = id => document.getElementById(id);
const ESC_MAP = {'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'};
const escapeHTML = str => String(str).replace(/[&<>'"]/g, c => ESC_MAP[c]);

/* 資料清理：讀取本機資料或還原備份時強制欄位型別，避免畸形資料被拼進 HTML / onclick */
const cleanId = v => String(v ?? '').replace(/[^\w-]/g, '');
const toNum = v => Number.isFinite(+v) ? +v : 0;
function sanitizeStocks(a) {
  if (!Array.isArray(a)) return [];
  return a.filter(s => s && typeof s === 'object').map((s, i) => ({ ...s,
    id: cleanId(s.id) || 's_' + Date.now() + '_' + i,
    symbol: String(s.symbol ?? ''), name: String(s.name ?? ''),
    displayQty: toNum(s.displayQty), displayUnit: String(s.displayUnit ?? '張') }));
}
function sanitizeRecords(a) {
  if (!Array.isArray(a)) return [];
  return a.filter(r => r && typeof r === 'object').map(r => ({ ...r,
    date: String(r.date ?? ''), time: String(r.time ?? ''),
    totalPnl: toNum(r.totalPnl), totalAsset: toNum(r.totalAsset), timestamp: toNum(r.timestamp) }));
}

// 🕒 嚴格獲取台灣時區時間 (UTC+8)
const getTWTime = () => new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Taipei"}));
const twDateStr = (d = getTWTime()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// 清除超過 2 天的每日快取與 API 用量紀錄（避免 localStorage 越積越多）
function cleanupOldKeys() {
  try {
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const re = /^(?:tw_hist_cache_v1_|api_usage_)(\d{4}-\d{2}-\d{2})/;
    const dead = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), m = k && re.exec(k);
      if (m && m[1] < cutoff) dead.push(k);
    }
    dead.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

const STOCK_DICT = {'0050':'元大台灣50','0056':'元大高股息','00878':'國泰永續高股息','00929':'復華台灣科技優息','00919':'群益台灣精選高息','00713':'元大台灣高息低波','006208':'富邦台50','00940':'元大台灣價值高息','00939':'統一台灣高息動能','00679B':'元大美債20年','00687B':'國泰20年美債','00937B':'群益ESG投等債20+','00720B':'元大投資級公司債','00881':'國泰台灣5G+','00891':'中信關鍵半導體','00830':'國泰費城半導體','00715L':'期街口布蘭特正2','00632R':'元大台灣50反1','00915':'凱基優選高股息30','00900':'富邦特選高股息30','2330':'台積電','2317':'鴻海','2454':'聯發科','2308':'台達電','2382':'廣達','2881':'富邦金','2882':'國泰金'};
const DEFAULT_INDICES = [{symbol:'^DJI',name:'🇺🇸 道瓊工業指數'},{symbol:'^IXIC',name:'🇺🇸 那斯達克指數'},{symbol:'^GSPC',name:'🇺🇸 標普500指數'},{symbol:'^SOX',name:'🇺🇸 費城半導體指數'},{symbol:'TSM',name:'🇹🇼 台積電 ADR'},{symbol:'^N225',name:'🇯🇵 日經225指數'},{symbol:'^KS11',name:'🇰🇷 韓國綜合指數'}];
const PROXY_LIST = ['https://api.allorigins.win/raw?url=', 'https://corsproxy.io/?', 'https://api.codetabs.com/v1/proxy?quest=', 'https://thingproxy.freeboard.io/fetch/'];
const API_TIMEOUT = 5000;
const CF_WORKER_URL = 'https://yahoo-index-proxy.denis0521.workers.dev';
const FUT_WORKER_URL = 'https://taifex-quote.denis0521.workers.dev/';
const FUGLE_API = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/';
const TICKER_API = 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/';

/* LocalStorage 統一管理 */
const LS = {
  KEYS: {
    FK: 'tw_fugle_key', SFK: 'tw_second_fugle_key', THEME: 'tw_theme',
    CUR_TAB: 'tw_current_tab', TAB_NAMES: 'tw_tab_names', TAB_COUNT: 'tw_tab_count',
    TICKER: 'tw_show_ticker', FLASH: 'tw_show_flash', IDX_MARQUEE: 'tw_idx_marquee', NOTICE_IDX: 'tw_notice_stock_features_v1', FOREIGN_IDX: 'tw_custom_foreign_indices',
    CACHE_IDX: 'tw_cached_indices', CACHE_TWII: 'tw_cached_twii', CACHE_FUT: 'tw_cached_fut', HIST_CACHE: 'tw_hist_cache_v1',
    STOCK: i => `tw_stock_portfolio_tab_${i}`, RECORD: i => `tw_records_tab_${i}`
  },
  get: (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch(e){ return def; } },
  getStr: (k, def='') => localStorage.getItem(k) ?? def,
  set: (k, v) => { try { localStorage.setItem(k, typeof v === 'object' ? JSON.stringify(v) : v); } catch(e){} }
};

/* ========================================================= 📊 核心狀態 ========================================================= */
let currentTab = 0, tabCount = 3, showTicker = true, enableFlash = true, idxMarquee = true, currentInterval = 8000;
let tabStocks = Array.from({length: 5}, () => []), tabRecords = Array.from({length: 5}, () => []), tabNames = [];
let fugleKey='', secondFugleKey='', availableIndices = [], cachedGlobalIndices = [], histCache = {}; 
let showHistCols = false;

const tickerCache = new Map();

class KeyRotator {
  constructor(keys) { this.keys = keys.filter(k => k && k.trim() !== ''); this.index = 0; }
  next() { return this.keys.length ? this.keys[this.index++ % this.keys.length] : null; }
  get count() { return this.keys.length; }
}
let globalKeyRotator = null;
const getKeyRotator = () => {
  const keys = [fugleKey, secondFugleKey].filter(Boolean);
  if (!globalKeyRotator || globalKeyRotator.count !== keys.length) globalKeyRotator = new KeyRotator(keys);
  return globalKeyRotator;
};

/* ========================================================= 🛠 初始化與生命週期 ========================================================= */
function loadState(){
  availableIndices = LS.get(LS.KEYS.FOREIGN_IDX, DEFAULT_INDICES);
  fugleKey = LS.getStr(LS.KEYS.FK);
  secondFugleKey = LS.getStr(LS.KEYS.SFK);
  currentTab = parseInt(LS.getStr(LS.KEYS.CUR_TAB, '0'));
  tabCount = parseInt(LS.getStr(LS.KEYS.TAB_COUNT, '3'));
  showTicker = LS.getStr(LS.KEYS.TICKER, 'true') === 'true';
  enableFlash = LS.getStr(LS.KEYS.FLASH, 'true') === 'true';
  idxMarquee = LS.getStr(LS.KEYS.IDX_MARQUEE, 'true') === 'true';

  const defaultTabNames = ['分頁 1', '分頁 2', '分頁 3', '分頁 4', '分頁 5'];
  const storedNames = LS.get(LS.KEYS.TAB_NAMES, defaultTabNames);
  tabNames = Array.from({length: 5}, (_, i) => storedNames[i] || defaultTabNames[i]);

  if(currentTab >= (tabCount === 0 ? 1 : tabCount)) currentTab = 0;

  for(let i=0; i<5; i++){
    tabStocks[i] = sanitizeStocks(LS.get(LS.KEYS.STOCK(i), []));
    tabRecords[i] = sanitizeRecords(LS.get(LS.KEYS.RECORD(i), []));
  }

  applyThemeText(LS.getStr(LS.KEYS.THEME, 'light'));
  
  cachedGlobalIndices = LS.get(LS.KEYS.CACHE_IDX, []);
  if(cachedGlobalIndices.length) renderGlobalIndices(cachedGlobalIndices, true);

  const cachedTwii = LS.get(LS.KEYS.CACHE_TWII, null);
  if (cachedTwii) updateTwiiDOM(cachedTwii, true);
  const cachedFut = LS.get(LS.KEYS.CACHE_FUT, null);
  if (cachedFut) updateFutDOM(cachedFut, true);

  $('tickerContainer').style.display = showTicker ? 'flex' : 'none';
  applyIdxMarquee();
  $('idxScrollContainer').addEventListener('click', toggleIdxPause);
  if (LS.getStr(LS.KEYS.NOTICE_IDX, '') !== '1') $('noticeOverlay').classList.add('show');
  renderTabs(); renderApiStats();
  
  showHistCols = LS.getStr('tw_show_hist', 'false') === 'true';
  applyHistColsState();
  
  triggerAutoSave();
  setInterval(checkAutoSave, 60000);
}

function applyThemeText(t){
  const body = document.body;
  body.className = '';
  const themes = {
    'tech': { emoji: '🏦', color: '#07101F' },
    'blue-light': { emoji: '🌊', color: '#B9D0F0' },
    'purple-light': { emoji: '🔮', color: '#E5DEF2' },
    'pink': { emoji: '🪵', color: '#E6D2B0' },
    'gray-light': { emoji: '🌫️', color: '#C5D0DC' },
    'light': { emoji: '🏺', color: '#D3D9E0' }
  };
  if(!themes[t]) t = 'light';
  const theme = themes[t];
  if(t !== 'light') body.classList.add(t);
  $('themeBtn').textContent = theme.emoji;
  $('themeColorMeta').content = theme.color;
  document.documentElement.style.setProperty('--status-bg', theme.color);
  applyHistColsState();
}

function toggleTheme(){
  const modes = ['light', 'tech', 'blue-light', 'purple-light', 'pink', 'gray-light'];
  let current = modes.find(m => document.body.classList.contains(m)) || 'light';
  let next = modes[(modes.indexOf(current) + 1) % modes.length];
  applyThemeText(next); LS.set(LS.KEYS.THEME, next);
}

function toggleTicker() {
  showTicker = !showTicker;
  $('tickerContainer').style.display = showTicker ? 'flex' : 'none';
  $('tickerToggleBtn').textContent = `📰 財經新聞列：${showTicker ? '已開啟' : '已關閉'}`;
  LS.set(LS.KEYS.TICKER, showTicker);
}

/* ===== 指數列跑馬燈（實驗性）：內容複製一份接在後面，位移 -50% 即無縫循環 ===== */
let idxCloneRaf = 0, idxObserver = null;
function syncIdxClone() {
  if (!idxMarquee) return;
  const src = $('idxCards'), box = $('idxScrollContainer');
  $('idxClone').innerHTML = src.innerHTML.replace(/\sid="[^"]*"/g, '').replace(/\sdraggable="[^"]*"/g, '');
  box.style.setProperty('--idx-vw', box.clientWidth + 'px');
  box.style.setProperty('--idx-dur', Math.max(14, (src.offsetWidth || 1) / 45) + 's');
}
function scheduleIdxClone() { if (!idxMarquee) return; cancelAnimationFrame(idxCloneRaf); idxCloneRaf = requestAnimationFrame(syncIdxClone); }
function applyIdxMarquee() {
  const box = $('idxScrollContainer');
  box.classList.toggle('idx-marquee', idxMarquee);
  $('idxCards').querySelectorAll('.draggable-card').forEach(c => c.setAttribute('draggable', idxMarquee ? 'false' : 'true'));
  if (idxMarquee) {
    box.scrollLeft = 0;
    if (!idxObserver) {
      idxObserver = new MutationObserver(scheduleIdxClone);
      idxObserver.observe($('idxCards'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
      window.addEventListener('resize', scheduleIdxClone);
    }
    syncIdxClone();
  } else {
    $('idxClone').innerHTML = '';
    box.classList.remove('idx-paused');
    box.style.removeProperty('--idx-vw'); box.style.removeProperty('--idx-dur');
  }
}
function toggleIdxPause(e) {
  if (!idxMarquee) return;
  if (e && e.target instanceof Element && e.target.closest('a,button,input,[data-twii],.fut-card,.draggable-card')) return;
  $('idxScrollContainer').classList.toggle('idx-paused');
}
function dismissIdxNotice() {
  LS.set(LS.KEYS.NOTICE_IDX, '1');
  closeModalById('noticeOverlay');
}
function toggleIdxMarquee() {
  idxMarquee = !idxMarquee;
  $('idxMarqueeToggleBtn').textContent = `📊 指數列跑馬燈：${idxMarquee ? '已開啟' : '已關閉'}`;
  LS.set(LS.KEYS.IDX_MARQUEE, idxMarquee);
  applyIdxMarquee();
}

function toggleFlash() {
  enableFlash = !enableFlash;
  $('flashToggleBtn').textContent = `💡 報價閃爍提醒：${enableFlash ? '已開啟' : '已關閉'}`;
  LS.set(LS.KEYS.FLASH, enableFlash);
}

function applyHistColsState() {
  const btn = $('histToggleBtnAdvanced');
  document.body.classList.toggle('show-hist', showHistCols);
  if (btn) btn.textContent = `📊 漲跌幅 (歷史)：${showHistCols ? '已開啟' : '已關閉'}`;
}

function toggleHistCols() {
  showHistCols = !showHistCols;
  LS.set('tw_show_hist', String(showHistCols));
  applyHistColsState();
  if (showHistCols) ensureHistory([...new Set(tabStocks[currentTab].map(s => s.symbol))]);
}

function switchTab(idx){
  if(currentTab === idx || tabCount === 0) return;
  currentTab = idx; LS.set(LS.KEYS.CUR_TAB, idx);
  renderTabs(); renderAll(); forceRefresh();
}

function renameTab(idx) {
  const newName = prompt('請輸入此分頁的新名稱：', tabNames[idx]);
  if (newName !== null) {
    tabNames[idx] = newName.trim() || `分頁 ${idx + 1}`;
    LS.set(LS.KEYS.TAB_NAMES, tabNames);
    renderTabs(); showToast(`已更名為「${tabNames[idx]}」`);
  }
}

function renderTabs() {
  const container = $('tabsBarContainer');
  if (tabCount === 0) { container.style.display = 'none'; return; }
  container.style.display = 'flex';
  container.innerHTML = tabNames.slice(0, tabCount).map((name, i) => 
    `<div class="tab-btn ${i === currentTab ? 'active' : ''}" onclick="switchTab(${i})" ondblclick="renameTab(${i})">${escapeHTML(name)}</div>`
  ).join('');
  const fontSize = tabCount === 5 ? '13px' : (tabCount === 4 ? '15px' : (tabCount === 3 ? '16px' : '18px'));
  container.querySelectorAll('.tab-btn').forEach(b => b.style.fontSize = fontSize);
}

/* ========================================================= 🖥 核心業務邏輯與渲染 ========================================================= */
const formatPrice = p => p == null ? '—' : (Math.abs(p) >= 1000 ? p.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : p.toFixed(2));
const getSign = n => n >= 0 ? '+' : '';
const getColorCls = n => n > 0 ? 'up' : (n < 0 ? 'down' : '');

function calcStockInfo(s) {
  const shares = s.displayUnit === '張' ? s.displayQty * 1000 : s.displayQty;
  const p = s.price, chg = s.change ?? 0;
  const mktValue = p != null ? Math.round(shares * p) : 0;
  const todayPnl = (p != null || s.change != null) ? Math.round(shares * chg) : 0;
  
  let cost = 0, unPnl = 0, roi = 0, hasCost = false;
  if (s.buyPrice > 0 && p != null) {
    hasCost = true;
    cost = s.buyPrice * shares;
    unPnl = Math.round(mktValue - cost);
    roi = ((mktValue - cost) / cost) * 100;
  }
  return { shares, mktValue, todayPnl, cost, unPnl, roi, hasCost };
}

function getStockHtmlInner(s) {
  const info = calcStockInfo(s), p = s.price, chg = s.change ?? 0;
  
  let totalHtml = '—', totalValForClass = 0;
  if (p != null) {
    if (info.hasCost) {
      totalValForClass = info.unPnl;
      totalHtml = `<div class="total-main">${getSign(info.unPnl)}${info.unPnl.toLocaleString()}</div>
      <div class="total-sub">${getSign(info.roi)}${info.roi.toFixed(2)}%</div>`;
    } else {
      totalHtml = `<div class="total-main neutral">—</div><div class="total-sub neutral">點擊 ✎ 設均價</div>`;
    }
  }

  const pClass = p != null ? getColorCls(chg) : '';
  let limitClass = '';
  if (p != null && s.limitUp != null && s.limitUp > 0 && Math.abs(p - s.limitUp) < 0.005) limitClass = 'limit-up';
  else if (p != null && s.limitDown != null && s.limitDown > 0 && Math.abs(p - s.limitDown) < 0.005) limitClass = 'limit-down';
  
  const priceHtml = p != null ? `<div class="price-container"><div class="price ${pClass} ${limitClass}">${formatPrice(p)}</div><div class="price-sub">${info.mktValue.toLocaleString()}</div></div>` : '—';
  const changeHtml = (s.change != null && s.changePercent != null) ? `<div class="change-container"><div class="chg ${pClass}">${getSign(chg)}${chg.toFixed(2)}</div><div class="change-sub ${pClass}">(${getSign(s.changePercent)}${s.changePercent.toFixed(2)}%)</div></div>` : '—';
  const safeName = escapeHTML(s.name || '');
  const nameHtml = safeName ? `<div class="sym-name">${safeName}</div>` : '';
  const genPctStr = val => val != null && !isNaN(val) ? `${getSign(val)}${val.toFixed(2)}%` : '—';
  const genPctCls = val => val != null && !isNaN(val) ? getColorCls(val) : '';

  return `
    <div class="sym-container"><div class="sym">${escapeHTML(s.symbol)}</div>${nameHtml}</div>
    <div class="qty-cell">
      <div class="qty-main">${escapeHTML(s.displayQty)} ${escapeHTML(s.displayUnit)}</div>
      <div class="qty-sub" title="${s.buyPrice ? '均價 '+s.buyPrice : '未設均價'}">${s.buyPrice ? '均價 '+s.buyPrice : '未設均價'}</div>
    </div>
    <div style="width:100%; display:flex; flex-direction:column; align-items:flex-end; justify-content:center;">${priceHtml}</div>
    <div style="width:100%; display:flex; flex-direction:column; align-items:flex-end; justify-content:center;">${changeHtml}</div>
    <div class="today-pnl ${getColorCls(info.todayPnl)}">${s.change != null ? getSign(info.todayPnl) + info.todayPnl.toLocaleString() : '—'}</div>
    <div class="total ${getColorCls(totalValForClass)}">${totalHtml}</div>
    <div class="hist-col ${genPctCls(s.pct5)}" style="font-weight:800; font-size:16px;">${genPctStr(s.pct5)}</div>
    <div class="hist-col ${genPctCls(s.pct20)}" style="font-weight:800; font-size:16px;">${genPctStr(s.pct20)}</div>
    <div class="hist-col ${genPctCls(s.pct60)}" style="font-weight:800; font-size:16px;">${genPctStr(s.pct60)}</div>
    <div class="hist-col ${genPctCls(s.pct120)}" style="font-weight:800; font-size:16px;">${genPctStr(s.pct120)}</div>
    <div class="act">
      <button type="button" class="btn-glass-circle edit" onclick="openEditModal('${s.id}')">✎</button>
      <button type="button" class="btn-glass-circle del" onclick="deleteStock('${s.id}')">✕</button>
    </div>`;
}

function renderAll(){
  const body = $('listBody'), empty = $('emptyState');
  const uiEls = ['tableScroll', 'summaryArea', 'historyBtn'].map($);
  const stocks = tabStocks[currentTab];
  
  if(stocks.length === 0){ 
    body.innerHTML = ''; empty.style.display = 'block'; 
    uiEls.forEach(e => e.style.display = 'none'); 
    return; 
  }
  
  empty.style.display = 'none'; 
  uiEls.forEach(e => e.style.display = 'block');
  body.innerHTML = stocks.map(s => `<div class="srow" data-id="${s.id}">${getStockHtmlInner(s)}</div>`).join('');
  updateSummary();
}

function renderRow(s, oldPrice = null) {
  const el = document.querySelector(`.srow[data-id="${s.id}"]`);
  if(el) {
    const html = getStockHtmlInner(s);
    if (el._h !== html) { el.innerHTML = html; el._h = html; } // 內容沒變就不動 DOM
    if (enableFlash && oldPrice != null && s.price != null && oldPrice !== s.price) {
      const priceEl = el.querySelector('.price');
      if (priceEl) {
        const flashClass = s.price > oldPrice ? 'flash-up' : 'flash-down';
        priceEl.classList.add(flashClass);
        setTimeout(() => priceEl.classList.remove(flashClass), 500);
      }
    }
  }
}

function updateSummary(){
  let pnl = 0, asset = 0, totalUnPnl = 0, hasUnPnl = false;
  tabStocks[currentTab].forEach(s => {
    const info = calcStockInfo(s);
    pnl += info.todayPnl; asset += info.mktValue;
    if (info.hasCost) { totalUnPnl += info.unPnl; hasUnPnl = true; }
  });
  
  const setHtml = (id, val, cls) => { const e = $(id); e.textContent = val; e.className = `val ${cls}`; };
  setHtml('totalPnl', getSign(pnl) + pnl.toLocaleString(), getColorCls(pnl));
  setHtml('totalAsset', getSign(asset) + asset.toLocaleString(), 'neutral');
  setHtml('totalUnrealized', hasUnPnl ? getSign(totalUnPnl) + totalUnPnl.toLocaleString() : '—', hasUnPnl ? getColorCls(totalUnPnl) : 'neutral');
}

/* ========================================================= 📡 網路請求與資料流 ========================================================= */
function trackApiUsage(source) {
  const k = `api_usage_${new Date().toISOString().split('T')[0]}_${source}`;
  const c = parseInt(LS.getStr(k, '0')) + 1;
  LS.set(k, String(c)); return c;
}

function renderApiStats() {
  const d = new Date().toISOString().split('T')[0];
  const f = parseInt(LS.getStr(`api_usage_${d}_Fugle`, '0'));
  const y = parseInt(LS.getStr(`api_usage_${d}_Yahoo`, '0'));
  const el = $('apiStatsBox');
  if (el) el.innerHTML = `<div style="display:flex;justify-content:space-around;text-align:center;font-size:13px;color:var(--t-muted);text-shadow:-1px -1px 1px var(--protrude-l), 1px 1px 1px var(--protrude-d);">
    <div><div style="font-size:18px;font-weight:800;color:var(--t-main);">${f}</div><div>Fugle</div></div>
    <div><div style="font-size:18px;font-weight:800;color:var(--t-main);">${y}</div><div>Yahoo</div></div></div>`;
}

let proxyStart = 0; // 優先使用上次成功的代理
async function fetchWithProxy(url) {
  const n = PROXY_LIST.length;
  for (let k = 0; k < n; k++) {
    const i = (proxyStart + k) % n;
    try {
      const res = await fetch(PROXY_LIST[i] + encodeURIComponent(url), { signal: AbortSignal.timeout(API_TIMEOUT), cache: 'no-store' });
      if (res.ok) { proxyStart = i; return res; }
    } catch (e) {}
  }
  return null;
}

async function getTickerInfo(sym, currentPrice) {
  const now = Date.now();
  const cached = tickerCache.get(sym);
  const cacheExpiry = 5 * 60 * 1000;
  
  let forceUpdate = false;
  if (cached && currentPrice != null) {
    const isAtLimit = (cached.limitUp != null && Math.abs(currentPrice - cached.limitUp) < 0.005) ||
                      (cached.limitDown != null && Math.abs(currentPrice - cached.limitDown) < 0.005);
    if (isAtLimit && cached.priceAtFetch != null && Math.abs(currentPrice - cached.priceAtFetch) > 0.001) forceUpdate = true;
  }
  if (cached && !forceUpdate && (now - cached.timestamp < cacheExpiry)) return cached;
  
  const kr = getKeyRotator();
  if (kr.count === 0) return null;
  
  for (let i = 0; i < kr.count; i++) {
    try {
      const res = await fetch(TICKER_API + encodeURIComponent(sym), { headers: { 'X-API-KEY': kr.next() }, signal: AbortSignal.timeout(API_TIMEOUT) });
      if (res.ok) {
        const data = await res.json();
        tickerCache.set(sym, { limitUp: data.limitUpPrice ?? null, limitDown: data.limitDownPrice ?? null, timestamp: now, priceAtFetch: currentPrice ?? null });
        return tickerCache.get(sym);
      }
    } catch (e) {}
  }
  return null;
}

async function fetchFugle(sym){
  const kr = getKeyRotator(); if (kr.count === 0) return null;
  let quoteData = null;
  for (let i = 0; i < kr.count; i++){
    try {
      const res = await fetch(FUGLE_API + encodeURIComponent(sym), { headers: {'X-API-KEY': kr.next()}, signal: AbortSignal.timeout(API_TIMEOUT) });
      if (res.ok) { quoteData = await res.json(); break; }
    } catch(e) {}
  }
  if (!quoteData) return null;

  const p = quoteData.lastPrice ?? quoteData.closePrice ?? quoteData.previousClose ?? quoteData.referencePrice ?? quoteData.price;
  if (p == null) return null;
  const tickerInfo = await getTickerInfo(sym, p);
  
  trackApiUsage('Fugle'); 
  return {
    price: p, change: quoteData.change ?? 0, changePercent: quoteData.changePercent ?? 0,
    volume: quoteData.total ? (quoteData.total.tradeValue || quoteData.total.tradeVolume || 0) : 0,
    source: 'Fugle', name: quoteData.name || '', limitUp: tickerInfo?.limitUp ?? null, limitDown: tickerInfo?.limitDown ?? null
  };
}

const suffixCache = new Map(); // 記住每檔股票是上市(.TW)還是上櫃(.TWO)
async function tryTwSuffixes(sym, fn) {
  const order = suffixCache.get(sym) === '.TWO' ? ['.TWO', '.TW'] : ['.TW', '.TWO'];
  for (const sfx of order) {
    const r = await fn(sfx);
    if (r) { suffixCache.set(sym, sfx); return r; }
  }
  return null;
}

async function fetchYahooQuote(ySym) {
  try {
    const t = Math.floor(Date.now() / 1000);
    // 抓近 10 天：遇到連假也一定包含「前一個交易日」的收盤價
    const res = await fetchWithProxy(`https://query1.finance.yahoo.com/v7/finance/download/${encodeURIComponent(ySym)}?period1=${t - 864000}&period2=${t}&interval=1d&events=history`);
    if (!res) return null;
    const rows = (await res.text()).trim().split('\n').slice(1).map(r => r.split(',')); // 去掉標題列
    const cols = rows[rows.length - 1];
    if (!cols || cols.length < 6 || cols[4] === 'null' || cols[1] === 'null') return null;
    const p = parseFloat(cols[4]), o = parseFloat(cols[1]), v = parseFloat(cols[6] || 0);
    // 漲跌 = 現價 − 前一交易日收盤價（與 Fugle 定義一致）；找不到前一日才退回以開盤價估算
    let prevClose = null;
    for (let k = rows.length - 2; k >= 0; k--) {
      const c = rows[k], pc = parseFloat(c[4]);
      if (c.length >= 6 && c[4] !== 'null' && !isNaN(pc)) { prevClose = pc; break; }
    }
    const base = prevClose ?? o, chg = +(p - base).toFixed(2);
    trackApiUsage('Yahoo');
    return { price: p, change: chg, changePercent: +((chg / base) * 100).toFixed(2), volume: v, source: 'Yahoo', name: '' };
  } catch (e) { return null; }
}

const fetchYahoo = sym => tryTwSuffixes(sym, sfx => fetchYahooQuote(sym + sfx));

async function fetchHistoryData(sym) {
  const cacheKey = `${LS.KEYS.HIST_CACHE}_${twDateStr()}`;
  const cached = LS.get(cacheKey, {})[sym];
  if (cached) return cached;

  const res = await tryTwSuffixes(sym, async sfx => {
    try {
      const resp = await fetchWithProxy(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}${sfx}?interval=1d&range=1y`);
      if (!resp) return null;
      const d = await resp.json(); if (!d.chart.result) return null;
      const closes = d.chart.result[0].indicators.quote[0].close.filter(c => c != null);
      const L = closes.length; if (L === 0) return null;
      return { d5: L > 5 ? closes[L - 1 - 5] : null, d20: L > 20 ? closes[L - 1 - 20] : null, d60: L > 60 ? closes[L - 1 - 60] : null, d120: L > 120 ? closes[L - 1 - 120] : null };
    } catch (e) { return null; }
  });
  if (res) { const dayCache = LS.get(cacheKey, {}); dayCache[sym] = res; LS.set(cacheKey, dayCache); } // 寫入前重讀，避免併發覆蓋
  return res;
}

function updateTwiiDOM(res, isOffline = false) {
  if(!res) return;
  const titleBox = $('idxTitle');
  if(titleBox) titleBox.innerHTML = `🇹🇼 臺灣加權指數${isOffline ? '<span style="color:var(--t-muted); font-size:12px; margin-left:6px; opacity:0.8;">(離線)</span>' : ''}`;
  
  const els = { p: $('idxPrice'), c: $('idxChange'), pct: $('idxPct'), v: $('idxVolume'), s: $('idxSource') };
  if(els.p) els.p.textContent = res.price.toLocaleString('en-US',{maximumFractionDigits:0});
  if(els.v) {
    if (res.volume > 0) {
      const vol100m = Math.round(res.volume / 100000000);
      els.v.textContent = `(${vol100m > 0 ? vol100m.toLocaleString() + ' 億' : res.volume.toLocaleString()})`;
    } else { els.v.textContent = `(—)`; }
  }

  if(els.c) { els.c.textContent = getSign(res.change) + res.change.toFixed(2); els.c.className = getColorCls(res.change); }
  if(els.pct) { els.pct.textContent = `(${getSign(res.changePercent)}${res.changePercent.toFixed(2)}%)`; els.pct.className = getColorCls(res.changePercent); }
  if(els.s) els.s.textContent = `via ${res.source} ${isOffline ? '(快取)' : new Date().toLocaleTimeString('zh-TW',{hour12:false, hour:'2-digit',minute:'2-digit'})}`;
}

/* 臺灣指數期貨（近月）：資料來自自己的 Worker，含日盤與夜盤 */
function updateFutDOM(d, isOffline = false) {
  const f = d && d.near; if (!f || f.price == null) return;
  const sess = d.session === 'night' ? '夜盤' : d.session === 'day' ? '日盤' : '';
  const tag = isOffline ? '(離線)' : sess;
  const titleBox = $('futTitle');
  if (titleBox) titleBox.innerHTML = `🇹🇼 臺灣指數期貨${tag ? `<span style="color:var(--t-muted); font-size:12px; margin-left:6px; opacity:0.8;">${tag}</span>` : ''}`;
  const els = { p: $('futPrice'), c: $('futChange'), pct: $('futPct'), v: $('futVolume'), s: $('futSource') };
  if (els.p) els.p.textContent = f.price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (els.v) els.v.textContent = f.volume > 0 ? `(${f.volume.toLocaleString()} 口)` : '(—)';
  if (els.c && f.change != null) { els.c.textContent = getSign(f.change) + f.change.toFixed(0); els.c.className = getColorCls(f.change); }
  if (els.pct && f.pct != null) { els.pct.textContent = `(${getSign(f.pct)}${f.pct.toFixed(2)}%)`; els.pct.className = getColorCls(f.pct); }
  if (els.s) els.s.textContent = isOffline ? 'via Yahoo (快取)' : `via Yahoo ${f.time ? f.time.slice(0, 5) : new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
}

async function refreshFut() {
  try {
    const res = await fetch(FUT_WORKER_URL + '?_=' + Date.now(), { signal: AbortSignal.timeout(API_TIMEOUT), cache: 'no-store' });
    if (!res.ok) return;
    const d = await res.json();
    if (!d || !d.near || d.near.price == null) return;
    updateFutDOM(d); setIfChanged(LS.KEYS.CACHE_FUT, d);
    futTickAdd(d.near.price, d.near.volume, d.session); futDailyUpdate(d);
  } catch (e) {}
}

/* 內容沒變就不寫入 localStorage */
const lsCache = new Map();
const setIfChanged = (k, v) => { const str = JSON.stringify(v); if (lsCache.get(k) === str) return; lsCache.set(k, str); LS.set(k, str); };

// 設定視窗沒開時，不必每輪重畫 API 用量
const maybeRenderApiStats = () => { if ($('modalOverlay').classList.contains('show')) renderApiStats(); };

// 輪詢間隔：雙 Key 8 秒/次，其餘 15 秒/次（實際套用在每輪結束後重新計時）
function syncInterval() { currentInterval = getKeyRotator().count === 2 ? 8000 : 15000; }

// 每輪更新「結束後」才重新計時：下一輪 = 結束時間 + 間隔，更新較慢時請求不會堆疊
function restartHeartbeat() {
  if (window.heartbeatWorker && document.visibilityState === 'visible') heartbeatWorker.postMessage({ action: 'start', interval: currentInterval });
}

async function refreshTwii() {
  const r = await fetchFugle('IX0001') || await fetchYahooQuote('^TWII');
  if (r) { updateTwiiDOM(r); setIfChanged(LS.KEYS.CACHE_TWII, r); }
}

async function refreshGlobalIndices() {
  const syms = availableIndices.map(i => i.symbol).join(',');
  if (!syms) return renderGlobalIndices([]);
  try {
    const res = await fetch(`${CF_WORKER_URL}/indices?symbols=${encodeURIComponent(syms)}&_=${Date.now()}`, { signal: AbortSignal.timeout(API_TIMEOUT) });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.indices) return;
    cachedGlobalIndices = data.indices.map(item => ({
      symbol: item.symbol, name: item.name || item.symbol,
      price: item.price ?? item.regularMarketPrice ?? item.previousClose ?? 0,
      changeAmt: item.change ?? item.regularMarketChange ?? 0,
      pct: item.changePercent ?? item.regularMarketChangePercent ?? 0
    })).sort((a, b) => syms.indexOf(a.symbol) - syms.indexOf(b.symbol));
    setIfChanged(LS.KEYS.CACHE_IDX, cachedGlobalIndices); trackApiUsage('Yahoo');
    cachedGlobalIndices.forEach(it => idxTickAdd(it.symbol, it.price)); // 本機每分鐘記錄，Yahoo 即時資料點不足時用來補圖
    renderGlobalIndices(cachedGlobalIndices, false);
  } catch (e) {}
}

function applyHist(s, h) {
  if (!h || s.price == null) return;
  const f = d => d != null ? ((s.price - d) / d) * 100 : null;
  s.pct5 = f(h.d5); s.pct20 = f(h.d20); s.pct60 = f(h.d60); s.pct120 = f(h.d120);
}

// 歷史漲跌幅：只在欄位開啟時抓取、不阻擋報價、失敗後 5 分鐘內不重試
const histFailUntil = new Map(), histInflight = new Set();
async function ensureHistory(syms) {
  if (!showHistCols) return;
  const day = twDateStr(), now = Date.now();
  const need = syms.filter(sym => histCache[sym]?.day !== day && !histInflight.has(sym) && (histFailUntil.get(sym) || 0) < now);
  if (!need.length) return;
  need.forEach(sym => histInflight.add(sym));
  const dirty = new Set();
  for (let i = 0; i < need.length; i += 3) {
    const batch = need.slice(i, i + 3);
    await Promise.all(batch.map(async sym => {
      try {
        const h = await fetchHistoryData(sym);
        if (!h) { histFailUntil.set(sym, Date.now() + 300000); return; }
        histCache[sym] = { day, data: h };
        tabStocks.forEach((list, idx) => list.forEach(s => { if (s.symbol === sym) { applyHist(s, h); dirty.add(idx); } }));
      } catch (e) { histFailUntil.set(sym, Date.now() + 300000); }
      finally { histInflight.delete(sym); }
    }));
    tabStocks[currentTab].forEach(s => { if (batch.includes(s.symbol)) renderRow(s); });
  }
  dirty.forEach(i => LS.set(LS.KEYS.STOCK(i), tabStocks[i]));
}

const quoteOkAt = new Map(), quoteTryAt = new Map(); // 代號 -> 最近「成功」/「嘗試」取價的時間
const QUOTE_FRESH_MS = 120000, QUOTE_RETRY_MS = 180000;
const isQuoteFresh = sym => Date.now() - (quoteOkAt.get(sym) || 0) < QUOTE_FRESH_MS;
const persistTabs = dirty => dirty.forEach(i => LS.set(LS.KEYS.STOCK(i), tabStocks[i]));

// 取得一批代號的最新報價，套用到所有分頁中同代號的持股；回傳是否有更新
async function fetchAndApplyQuotes(syms, dirty, shouldAbort = () => false) {
  let hasUpdates = false;
  // 批次併發抓取（每批 5 檔）
  for (let i = 0; i < syms.length; i += 5) {
    if (shouldAbort()) break;
    const batch = syms.slice(i, i + 5);
    batch.forEach(sym => quoteTryAt.set(sym, Date.now()));
    const results = await Promise.allSettled(batch.map(async sym => ({ sym, r: await fetchFugle(sym) || await fetchYahoo(sym) })));

    for (const res of results) {
      if (res.status !== 'fulfilled' || !res.value.r) continue;
      const { sym, r } = res.value;
      const lu = r.limitUp ?? null, ld = r.limitDown ?? null, h = histCache[sym]?.data;
      hasUpdates = true;
      quoteOkAt.set(sym, Date.now());
      for (let idx = 0; idx < 5; idx++) {
        for (const s of tabStocks[idx]) {
          if (s.symbol !== sym) continue;
          const oldPrice = s.price;
          if (s.price !== r.price || s.change !== r.change || s.changePercent !== r.changePercent || s.limitUp !== lu || s.limitDown !== ld) dirty.add(idx);
          s.price = r.price; s.change = r.change; s.changePercent = r.changePercent;
          if (r.name && !s.name) { s.name = r.name; dirty.add(idx); }
          s.limitUp = lu; s.limitDown = ld;
          applyHist(s, h);
          // 只在價格真正變動或初次渲染時重繪 DOM
          if (idx === currentTab && (oldPrice !== s.price || oldPrice == null)) renderRow(s, oldPrice);
        }
      }
    }
  }
  return hasUpdates;
}

// 自動記錄前呼叫：把「久沒開」（報價過舊）的其他分頁也更新一次，避免用舊價格算損益
async function ensureFreshQuotes() {
  if (!navigator.onLine) return;
  const now = Date.now();
  const stale = [...new Set(tabStocks.flat().map(s => s.symbol))]
    .filter(sym => !isQuoteFresh(sym) && now - (quoteTryAt.get(sym) || 0) > QUOTE_RETRY_MS); // 剛失敗過的先不重試
  if (!stale.length) return;
  const dirty = new Set();
  if (await fetchAndApplyQuotes(stale, dirty)) updateSummary();
  persistTabs(dirty);
}

async function refreshStocks() {
  const tab = currentTab;
  if (tabStocks[tab].length === 0) return;
  const uniqueSyms = [...new Set(tabStocks[tab].map(s => s.symbol))];
  const dirty = new Set();
  // 中途切換分頁就不必再抓舊分頁，新分頁會另外觸發更新
  const hasUpdates = await fetchAndApplyQuotes(uniqueSyms, dirty, () => tab !== currentTab);
  persistTabs(dirty); // 只寫入有變動的分頁
  if (hasUpdates) updateSummary();
  ensureHistory(uniqueSyms).catch(() => {});
}

async function refreshPrices(){
  if (!navigator.onLine) { showToast('處於離線狀態，顯示快取資料'); return; }
  // 大盤、期貨、國外指數、個股彼此獨立，平行抓取
  await Promise.allSettled([refreshTwii(), refreshFut(), refreshGlobalIndices(), refreshStocks()]);
  syncInterval();
  maybeRenderApiStats();
}

/* ========================================================= 🔀 指數卡片拖拽排序功能 ========================================================= */
let draggedIdxSymbol = null, lastIdxHtml = null;

function renderGlobalIndices(indices, isOffline = false) {
  if (draggedIdxSymbol) return; // 拖曳中不重建，避免打斷操作
  const html = indices.map(item => {
    const matched = availableIndices.find(idx => idx.symbol === item.symbol);
    const name = matched ? matched.name : item.name;
    const cls = getColorCls(item.pct);
    return `<div class="idx-card-box draggable-card" draggable="${idxMarquee ? 'false' : 'true'}" data-symbol="${escapeHTML(item.symbol)}">
      <div class="idx-box-name">${escapeHTML(name)}${isOffline ? '<span style="color:var(--t-muted);font-size:12px;margin-left:6px;opacity:0.8;">(離線)</span>' : ''}</div>
      <div class="idx-data-row">
        <div class="idx-box-price-wrap"><span class="idx-box-price">${item.price.toLocaleString('en-US', {maximumFractionDigits:2})}</span></div>
      </div>
      <div class="idx-data-row">
        <div class="idx-box-change-row ${cls}">
          <span>${getSign(item.changeAmt)}${item.changeAmt.toFixed(2)}</span>
          <span>(${getSign(item.pct)}${item.pct.toFixed(2)}%)</span>
        </div>
      </div>
      <div class="idx-box-src">via Yahoo ${isOffline ? 'Cache' : ''}</div>
    </div>`;
  }).join('');
  if (html === lastIdxHtml) return; // 內容沒變就不動 DOM
  lastIdxHtml = html;
  const container = $('idxScrollContainer'), cards = $('idxCards'), sl = container.scrollLeft;
  cards.querySelectorAll('.idx-card-box.draggable-card').forEach(e => e.remove());
  cards.insertAdjacentHTML('beforeend', html);
  container.scrollLeft = sl; // 保留使用者的橫向捲動位置
}

// 拖曳事件只在容器綁一次（事件委派），不必每次重繪都重新綁定
function initIdxDrag() {
  const c = $('idxScrollContainer');
  const cardOf = e => (e.target instanceof Element) ? e.target.closest('.idx-card-box.draggable-card') : null;

  c.addEventListener('dragstart', e => {
    const el = cardOf(e); if (!el) return;
    draggedIdxSymbol = el.dataset.symbol; el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', draggedIdxSymbol);
  });
  c.addEventListener('dragover', e => {
    const el = cardOf(e); if (!el) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (el.dataset.symbol !== draggedIdxSymbol) el.classList.add('drag-over');
  });
  c.addEventListener('dragleave', e => { const el = cardOf(e); if (el) el.classList.remove('drag-over'); });
  c.addEventListener('drop', e => {
    const el = cardOf(e); if (!el) return;
    e.preventDefault(); e.stopPropagation();
    const from = draggedIdxSymbol, to = el.dataset.symbol;
    draggedIdxSymbol = null;
    if (!from || !to || from === to) { handleDragEnd(); return; }
    const fromIndex = availableIndices.findIndex(item => item.symbol === from);
    const toIndex = availableIndices.findIndex(item => item.symbol === to);
    if (fromIndex !== -1 && toIndex !== -1) {
      const [movedItem] = availableIndices.splice(fromIndex, 1);
      availableIndices.splice(toIndex, 0, movedItem);
      LS.set(LS.KEYS.FOREIGN_IDX, availableIndices);

      const cachedFrom = cachedGlobalIndices.findIndex(item => item.symbol === from);
      const cachedTo = cachedGlobalIndices.findIndex(item => item.symbol === to);
      if (cachedFrom !== -1 && cachedTo !== -1) {
        const [movedCached] = cachedGlobalIndices.splice(cachedFrom, 1);
        cachedGlobalIndices.splice(cachedTo, 0, movedCached);
        setIfChanged(LS.KEYS.CACHE_IDX, cachedGlobalIndices);
      }
      renderGlobalIndices(cachedGlobalIndices, false); showToast('已更新指數順序');
    }
  });
  c.addEventListener('dragend', () => { draggedIdxSymbol = null; handleDragEnd(); });
}
function handleDragEnd() { document.querySelectorAll('.idx-card-box').forEach(card => card.classList.remove('dragging', 'drag-over')); }
initIdxDrag();

/* ========================================================= 🖱 互動與資料修改 ========================================================= */
const closeModalById = id => $(id).classList.remove('show');
let toastTimer = null;
const showToast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2000); };

function toggleSummary(e) {
  if(e) e.stopPropagation();
  const d = $('summaryDetails'), b = $('sumToggleBtn');
  const isHidden = d.style.display === 'none';
  d.style.display = isHidden ? 'block' : 'none'; b.style.display = isHidden ? 'none' : 'block';
}

function openAddModal() { $('addModalOverlay').classList.add('show'); setTimeout(() => $('symInput').focus(), 100); }

function addStock(){
  const sym = $('symInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const qty = parseInt($('qtyInput').value);
  const unit = $('unitSelect').value;
  const bp = parseFloat($('buyPriceInput').value);
  if(!sym || !qty || qty < 1) return showToast('請輸入代號與數量');
  if(tabStocks[currentTab].some(s => s.symbol === sym)) return showToast('該股票已存在於此分頁');
  
  tabStocks[currentTab].push({
    id: 's_'+Date.now()+'_'+Math.random().toString(36).slice(2,6), symbol: sym, name: STOCK_DICT[sym] || '',
    displayQty: qty, displayUnit: unit, buyPrice: isNaN(bp) || bp <= 0 ? null : bp,
    shares: unit === '張' ? qty * 1000 : qty, price: null, change: null, changePercent: null,
    limitUp: null, limitDown: null
  });
  LS.set(LS.KEYS.STOCK(currentTab), tabStocks[currentTab]); renderAll();
  ['symInput', 'qtyInput', 'buyPriceInput'].forEach(id => $(id).value = '');
  showToast(`已新增 ${sym}`); closeModalById('addModalOverlay'); forceRefresh();
}

function deleteStock(id){
  if(!confirm('確定刪除？')) return;
  tabStocks[currentTab] = tabStocks[currentTab].filter(s => s.id !== id);
  LS.set(LS.KEYS.STOCK(currentTab), tabStocks[currentTab]); renderAll(); showToast('記錄已刪除');
}

function openEditModal(id) {
  const s = tabStocks[currentTab].find(x => x.id === id); if (!s) return;
  $('editId').value = s.id; $('editSymInput').value = s.symbol;
  $('editNameInput').value = s.name || ''; $('editQtyInput').value = s.displayQty;
  $('editUnitSelect').value = s.displayUnit; $('editBuyPriceInput').value = s.buyPrice || '';
  $('editModalOverlay').classList.add('show');
}

function saveEditStock() {
  const s = tabStocks[currentTab].find(x => x.id === $('editId').value); if (!s) return;
  const sym = $('editSymInput').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (sym && sym !== s.symbol) { s.symbol = sym; s.price = s.change = s.changePercent = null; }
  s.name = $('editNameInput').value.trim();
  const nq = parseInt($('editQtyInput').value);
  if (nq > 0) s.displayQty = nq;
  s.displayUnit = $('editUnitSelect').value;
  s.shares = s.displayUnit === '張' ? s.displayQty * 1000 : s.displayQty;
  const bp = parseFloat($('editBuyPriceInput').value);
  s.buyPrice = isNaN(bp) || bp <= 0 ? null : bp;
  LS.set(LS.KEYS.STOCK(currentTab), tabStocks[currentTab]); renderAll(); closeModalById('editModalOverlay'); showToast('已修改'); forceRefresh();
}

// 💾 自動儲存機制：台灣時區 13:40 (支援當日重複更新)
let autoSaveTimer = null;
function triggerAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(checkAutoSave, 20000); // 喚醒後20秒更新
}

let autoSaving = false;
async function checkAutoSave() {
  const inWindow = t => { const d = t.getDay(), h = t.getHours(), m = t.getMinutes(); return d >= 1 && d <= 5 && (h > 13 || (h === 13 && m >= 40)); };
  // 符合時間：營業日 (週一至週五) 且時間過 13:40
  if (autoSaving || !inWindow(getTWTime())) return;
  autoSaving = true;
  try {
    await ensureFreshQuotes(); // 先確保所有分頁都是最新報價

    const twTime = getTWTime();
    const todayStr = twDateStr(twTime);
    const ts = `${String(twTime.getHours()).padStart(2,'0')}:${String(twTime.getMinutes()).padStart(2,'0')}`;
    let savedAny = false;

    for (let i = 0; i < 5; i++) {
      if (tabStocks[i].length === 0) continue;
      // 有報價的持股若仍是舊價格（取價失敗）：這次不記錄，等下一分鐘重試，避免寫入錯誤損益
      if (!tabStocks[i].every(s => s.price == null || isQuoteFresh(s.symbol))) continue;

      let pnl = 0, asset = 0;
      tabStocks[i].forEach(s => { const info = calcStockInfo(s); pnl += info.todayPnl; asset += info.mktValue; });

      const recs = tabRecords[i];
      const existingIdx = recs.findIndex(r => r.date === todayStr);
      if (existingIdx !== -1 && recs[existingIdx].totalPnl === pnl && recs[existingIdx].totalAsset === asset) continue; // 沒變化：不重寫

      const rec = {date: todayStr, time: ts, totalPnl: pnl, totalAsset: asset, timestamp: twTime.getTime()};
      if (existingIdx !== -1) recs[existingIdx] = rec; else recs.unshift(rec);
      if (recs.length > 10) recs.length = 10;
      LS.set(LS.KEYS.RECORD(i), recs);
      savedAny = true;
    }
    if (savedAny && $('historyModalOverlay').classList.contains('show')) renderHistory();
  } catch (e) {} finally { autoSaving = false; }
}

function fitHistoryBody(){
  const hb = $('historyBody'); if(!hb) return;
  const items = hb.querySelectorAll('.hist-item');
  hb.style.maxHeight = 'none';
  if(items.length <= 10) return;
  const it = items[9];
  const h = it.offsetTop + it.offsetHeight + 4;
  if(h > 20) hb.style.maxHeight = h + 'px';
}
function openHistoryModal() { renderHistory(); $('historyModalOverlay').classList.add('show'); requestAnimationFrame(fitHistoryBody); }

function clearAllHistory() {
  if(!confirm('確定要清空目前分頁的所有歷史記錄嗎？')) return;
  tabRecords[currentTab] = [];
  LS.set(LS.KEYS.RECORD(currentTab), tabRecords[currentTab]);
  renderHistory(); showToast('已清空全部記錄');
}

function deleteHistory(ts) {
  if(!confirm('確定刪除此筆記錄？')) return;
  tabRecords[currentTab] = tabRecords[currentTab].filter(r => r.timestamp !== ts);
  LS.set(LS.KEYS.RECORD(currentTab), tabRecords[currentTab]); renderHistory(); showToast('記錄已刪除');
}

function renderHistory(){
  const hb = $('historyBody'); if(!hb) return;
  const recs = tabRecords[currentTab];
  if(recs.length === 0) return hb.innerHTML = '<div class="hist-empty">尚無記錄</div>';
  hb.innerHTML = recs.map(r => `
    <div class="hist-item" style="border: 1px solid var(--protrude-d); border-top: 1px solid var(--protrude-l); border-left: 1px solid var(--protrude-l);">
      <div class="hist-item-left"><span class="hdate">${escapeHTML(r.date)} ${escapeHTML(r.time)}</span><span class="hval ${getColorCls(r.totalPnl)}">${getSign(r.totalPnl)}${r.totalPnl.toLocaleString()}</span></div>
      <button type="button" class="btn-glass-circle del" onclick="deleteHistory(${r.timestamp})">✕</button>
    </div>`).join('');
  requestAnimationFrame(fitHistoryBody);
}

// ===== API Key 指示燈（以 Fugle 個股基本資料端點驗證）=====
const KEY_LED_SEQ = {};
function setKeyLed(ledId, state, tip){ const el=$(ledId); if(!el) return; el.className='key-led '+state; el.title=tip||''; }
async function checkKeyLed(inputId, ledId){
  const key = $(inputId).value.trim();
  const seq = KEY_LED_SEQ[ledId] = (KEY_LED_SEQ[ledId]||0) + 1;
  if(!key){ setKeyLed(ledId,'off','尚未輸入 Key'); return; }
  setKeyLed(ledId,'checking','驗證中…');
  try{
    const res = await fetch(TICKER_API + '2330', { headers: {'X-API-KEY': key}, signal: AbortSignal.timeout(8000) });
    if(seq !== KEY_LED_SEQ[ledId]) return;
    if(res.ok || res.status === 429) setKeyLed(ledId,'ok', res.ok ? 'Key 有效' : 'Key 有效（目前達到流量上限）');
    else if(res.status === 401 || res.status === 403) setKeyLed(ledId,'bad','Key 無效');
    else setKeyLed(ledId,'off','無法確認（伺服器回應 '+res.status+'）');
  }catch(e){
    if(seq !== KEY_LED_SEQ[ledId]) return;
    setKeyLed(ledId,'off','無法確認（網路或逾時）');
  }
}
function bindKeyLeds(){
  if(window._keyLedBound) return; window._keyLedBound = true;
  [['fugleKeyInput','fugleKeyLed'],['secondFugleKeyInput','secondFugleKeyLed']].forEach(([inp,led])=>{
    let t; $(inp).addEventListener('input', ()=>{ clearTimeout(t); setKeyLed(led, $(inp).value.trim()?'checking':'off', ''); t=setTimeout(()=>checkKeyLed(inp,led), 700); });
  });
}

function openModal(){
  $('fugleKeyInput').value = fugleKey; $('secondFugleKeyInput').value = secondFugleKey;
  $('tabCountSelect').value = tabCount;
  $('tickerToggleBtn').textContent = `📰 財經新聞列：${showTicker ? '已開啟' : '已關閉'}`;
  $('flashToggleBtn').textContent = `💡 報價閃爍提醒：${enableFlash ? '已開啟' : '已關閉'}`;
  $('appVerBox').textContent = '版本：' + APP_VER;
  $('idxMarqueeToggleBtn').textContent = `📊 指數列跑馬燈：${idxMarquee ? '已開啟' : '已關閉'}`;
  applyHistColsState(); 
  ['fugleKey','secondFugleKey'].forEach((id, i) => {
    const el = $(`${id}Status`), val = i===0 ? fugleKey : secondFugleKey;
    el.textContent = val ? '✓ 已設定' : '未設定'; el.className = `key-status ${val ? 'ok' : 'none'}`;
  });
  renderApiStats(); $('modalOverlay').classList.add('show');
  bindKeyLeds(); checkKeyLed('fugleKeyInput','fugleKeyLed'); checkKeyLed('secondFugleKeyInput','secondFugleKeyLed');
}

function saveAndCloseModal(){
  fugleKey = $('fugleKeyInput').value.trim(); LS.set(LS.KEYS.FK, fugleKey);
  secondFugleKey = $('secondFugleKeyInput').value.trim(); LS.set(LS.KEYS.SFK, secondFugleKey);
  globalKeyRotator = null;
  const newCount = parseInt($('tabCountSelect').value);
  if(newCount !== tabCount) {
    tabCount = newCount; LS.set(LS.KEYS.TAB_COUNT, tabCount);
    if(currentTab >= (tabCount || 1)) { currentTab = 0; LS.set(LS.KEYS.CUR_TAB, 0); }
    renderTabs(); renderAll(); 
  }
  closeModalById('modalOverlay'); showToast('設定已儲存'); forceRefresh();
}

function toggleKeyVisibility(inId, btnId) {
  const i = $(inId), b = $(btnId);
  i.classList.toggle('pwd-mask'); b.textContent = i.classList.contains('pwd-mask') ? '👁' : '🙈';
}

function openForeignIdxModal() { renderForeignIdxConfigList(); $('foreignIdxOverlay').classList.add('show'); }
function closeForeignIdxModal() { closeModalById('foreignIdxOverlay'); availableIndices = LS.get(LS.KEYS.FOREIGN_IDX, DEFAULT_INDICES); forceRefresh(); }

function renderForeignIdxConfigList() {
  const c = $('foreignIdxListContainer');
  if(!availableIndices.length) return c.innerHTML = '<div style="text-align:center; color:var(--t-muted); font-weight:600; padding:20px; font-size:14px;">無自選指數</div>';
  c.innerHTML = availableIndices.map((idx, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; margin-bottom:8px; background:var(--bg-card); box-shadow:var(--shadow-soft); border-radius:8px; border:1px solid var(--border-light);">
      <div style="text-align:left; flex:1; min-width:0; padding-right:8px;"><div style="font-weight:700; color:var(--t-main); font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(idx.name)}</div><div style="font-size:12px; color:var(--t-muted); font-weight:600;">${escapeHTML(idx.symbol)}</div></div>
      <button type="button" class="btn-glass-circle del" style="width:28px!important; height:28px!important; font-size:14px!important;" onclick="deleteForeignIdx(${i})">✕</button>
    </div>`).join('');
}

function addForeignIdx() {
  let sym = $('newIdxSymbol').value.trim().toUpperCase(), name = $('newIdxName').value.trim();
  if(!sym || !name) return showToast('請輸入代號與名稱');
  if(['DJI','IXIC','GSPC','SOX','N225','KS11'].includes(sym)) sym = '^' + sym;
  if(availableIndices.some(i => i.symbol === sym)) return showToast('已存在清單中');
  availableIndices.push({symbol: sym, name}); LS.set(LS.KEYS.FOREIGN_IDX, availableIndices);
  $('newIdxSymbol').value = ''; $('newIdxName').value = '';
  renderForeignIdxConfigList(); showToast(`已新增 ${name}`);
}

function deleteForeignIdx(i) {
  if(!confirm(`確定要刪除「${availableIndices[i].name}」嗎？`)) return;
  availableIndices.splice(i, 1); LS.set(LS.KEYS.FOREIGN_IDX, availableIndices); renderForeignIdxConfigList(); showToast('已刪除');
}

function exportData() {
  const d = { 
    tabStocks: Array.from({length: 5}, (_, i) => LS.get(LS.KEYS.STOCK(i), [])),
    tabRecords: Array.from({length: 5}, (_, i) => LS.get(LS.KEYS.RECORD(i), [])),
    tabNames: LS.get(LS.KEYS.TAB_NAMES, ['分頁 1', '分頁 2', '分頁 3', '分頁 4', '分頁 5']),
    fugleKey, secondFugleKey, theme: LS.getStr(LS.KEYS.THEME, 'light'), 
    tabCount, customForeignIndices: availableIndices, enableFlash, idxMarquee 
  };
  
  const a = document.createElement('a'); 
  a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], {type:"application/json"}));
  const date = getTWTime(); 
  a.download = `stock_backup_${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}.json`;
  a.click(); URL.revokeObjectURL(a.href); showToast('✅ 備份已下載');
}

function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if(!confirm('⚠️ 將覆蓋所有資料，確定還原？')) return;
      if (d.tabStocks) d.tabStocks.slice(0, 5).forEach((v, i) => LS.set(LS.KEYS.STOCK(i), sanitizeStocks(typeof v === 'string' ? JSON.parse(v) : v)));
      if (d.tabRecords) d.tabRecords.slice(0, 5).forEach((v, i) => LS.set(LS.KEYS.RECORD(i), sanitizeRecords(typeof v === 'string' ? JSON.parse(v) : v)));
      if (d.tabNames) LS.set(LS.KEYS.TAB_NAMES, typeof d.tabNames === 'string' ? JSON.parse(d.tabNames) : d.tabNames);
      if (d.fugleKey !== undefined) LS.set(LS.KEYS.FK, d.fugleKey);
      if (d.secondFugleKey !== undefined) LS.set(LS.KEYS.SFK, d.secondFugleKey);
      if (d.theme) LS.set(LS.KEYS.THEME, d.theme);
      if (d.tabCount !== undefined) LS.set(LS.KEYS.TAB_COUNT, d.tabCount);
      if (d.customForeignIndices) LS.set(LS.KEYS.FOREIGN_IDX, typeof d.customForeignIndices === 'string' ? JSON.parse(d.customForeignIndices) : d.customForeignIndices);
      if (d.enableFlash !== undefined) LS.set(LS.KEYS.FLASH, d.enableFlash);
      if (d.idxMarquee !== undefined) LS.set(LS.KEYS.IDX_MARQUEE, d.idxMarquee);
      alert('🎉 還原成功！'); location.reload();
    } catch(err) { alert('❌ 檔案格式錯誤。'); console.error(err); }
    $('importFile').value = '';
  };
  r.readAsText(file);
}

/* ========================================================= 🔄 後台輪詢與生命週期 ========================================================= */
let lastRefreshTime = 0, isRefreshing = false, lastSuccessTime = 0, pendingRefresh = false, lastWakeTime = 0;
const workerBlob = new Blob([`let t=null;self.onmessage=e=>{if(e.data.action==='start'){clearInterval(t);t=setInterval(()=>self.postMessage('tick'),e.data.interval)}else if(e.data.action==='stop')clearInterval(t)};`], {type:'application/javascript'});
window.heartbeatWorker = new Worker(URL.createObjectURL(workerBlob));
heartbeatWorker.onmessage = () => refresh();

// 手動觸發（新增/編輯/切換分頁/儲存設定）：若正在更新，等它結束後立刻再跑一次，而不是同時跑兩輪
function forceRefresh() {
  if (isRefreshing && Date.now() - lastRefreshTime < 15000) { pendingRefresh = true; return; }
  isRefreshing = false; lastRefreshTime = 0; refresh();
}
async function refresh() {
  const now = Date.now();
  if (isRefreshing && now - lastRefreshTime > 15000) isRefreshing = false;
  if (isRefreshing || now - lastRefreshTime < 2000) return;
  isRefreshing = true; lastRefreshTime = now;
  try { await refreshPrices(); lastSuccessTime = Date.now(); } catch(e){} finally {
    isRefreshing = false;
    restartHeartbeat();
    if (pendingRefresh) { pendingRefresh = false; lastRefreshTime = 0; refresh(); }
  }
}

// 回到前景時 focus / pageshow / visibilitychange 會連續觸發，1.5 秒內只處理一次
function wake() {
  const n = Date.now();
  if (n - lastWakeTime < 1500) return;
  lastWakeTime = n;
  forceRefresh(); triggerAutoSave();
}

const handleTouchWakeup = () => { if(Date.now() - lastSuccessTime > 15000 && !isRefreshing) wake(); };
document.addEventListener('touchend', handleTouchWakeup, {passive: true});
document.addEventListener('click', handleTouchWakeup, {passive: true});

const NEWS_KEY = 'tw_news_cache';
function renderNews(data) {
  const c = $('js-ticker');
  if (!Array.isArray(data) || !data.length) return false;
  const html = data.map(i => `<a href="${/^https?:\/\//i.test(i.link) ? escapeHTML(i.link) : '#'}" target="_blank" rel="noopener noreferrer" class="ticker-item"><span class="ticker-source">${escapeHTML(i.source)}</span>${escapeHTML(i.title)}</a>`).join('');
  c.innerHTML = html + html;
  c.style.animationDuration = `${c.textContent.length * 0.18}s`;
  return true;
}
/* 先用本機快取立刻開跑，再於背景更新；新聞 API 較慢時也不會空等 */
async function loadFinanceNews() {
  const c = $('js-ticker');
  let shown = false;
  try { shown = renderNews(JSON.parse(localStorage.getItem(NEWS_KEY) || 'null')); } catch(e) {}
  try {
    const res = await fetch('https://finance-news-api.denis0521.workers.dev/');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.length) { if (!shown) c.innerHTML = '<span class="ticker-item">目前暫無新聞</span>'; return; }
    try { localStorage.setItem(NEWS_KEY, JSON.stringify(data)); } catch(e) {}
    if (!shown) renderNews(data); // 已在播放舊新聞就不打斷，下次開啟自動使用新內容
  } catch(e) {
    if (!shown) c.innerHTML = '<span class="ticker-item" style="color:var(--t-muted);">無法載入即時新聞，請稍後再試</span>';
  }
}

/* ========================================================= ↕ 長按代號拖曳排序 ========================================================= */
(function initRowDrag() {
  const body = $('listBody');
  const HOLD_MS = 350, MOVE_TOL = 8, EDGE = 80;
  let st = null;

  const getScroller = () => {
    for (let el = body.parentElement; el && el !== document.body; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    }
    return null;
  };

  const cleanup = () => {
    if (!st) return;
    clearTimeout(st.timer); cancelAnimationFrame(st.raf);
    st.row.classList.remove('dragging');
    document.body.classList.remove('row-sorting');
    st = null;
  };

  const reorderTo = y => {
    const row = st.row;
    for (const r of body.children) {
      if (r === row) continue;
      const b = r.getBoundingClientRect();
      if (y < b.top + b.height / 2) { if (row.nextElementSibling !== r) body.insertBefore(row, r); return; }
    }
    if (body.lastElementChild !== row) body.appendChild(row);
  };

  const tick = () => {
    if (!st || !st.active) return;
    const vh = window.innerHeight;
    let dy = 0;
    if (st.y < EDGE) dy = -Math.ceil((EDGE - st.y) / 6);
    else if (st.y > vh - EDGE) dy = Math.ceil((st.y - (vh - EDGE)) / 6);
    if (dy) { (st.scroller || window).scrollBy(0, dy); reorderTo(st.y); }
    st.raf = requestAnimationFrame(tick);
  };

  const commit = () => {
    if (!st.row.isConnected || currentTab !== st.tab) return;
    const list = tabStocks[st.tab];
    const map = new Map(list.map(s => [String(s.id), s]));
    const next = [...body.children].map(r => map.get(r.dataset.id)).filter(Boolean);
    if (next.length !== list.length) { renderAll(); return; }
    if (next.every((s, i) => s === list[i])) return;
    list.splice(0, list.length, ...next);
    LS.set(LS.KEYS.STOCK(st.tab), list);
    showToast('已調整順序');
  };

  body.addEventListener('pointerdown', e => {
    if (st || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const handle = e.target.closest('.sym-container');
    const row = handle && handle.closest('.srow');
    if (!row) return;
    st = { row, id: e.pointerId, x: e.clientX, y: e.clientY, active: false, tab: currentTab, scroller: null, raf: 0 };
    st.timer = setTimeout(() => {
      if (!st) return;
      st.active = true; st.scroller = getScroller();
      row.classList.add('dragging'); document.body.classList.add('row-sorting');
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
      st.raf = requestAnimationFrame(tick);
    }, HOLD_MS);
  });

  document.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    if (!st.active) {
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > MOVE_TOL) cleanup(); // 想捲動就取消長按
      return;
    }
    st.y = e.clientY; reorderTo(st.y);
  });

  document.addEventListener('pointerup', e => {
    if (!st || e.pointerId !== st.id) return;
    if (st.active) { commit(); lastRowDragAt = Date.now(); }
    cleanup();
  });

  document.addEventListener('pointercancel', e => {
    if (!st || e.pointerId !== st.id) return;
    const was = st.active; cleanup();
    if (was) renderAll(); // 被系統中斷：還原顯示
  });

  // 拖曳中禁止頁面捲動；長按時不要跳出選單
  document.addEventListener('touchmove', e => { if (st && st.active && e.cancelable) e.preventDefault(); }, { passive: false });
  body.addEventListener('contextmenu', e => { if (e.target.closest('.sym-container')) e.preventDefault(); });
})();

/* ========================================================= 📈 K 線圖彈窗（Fugle 自繪；非台股代號改用 TradingView） ========================================================= */
let lastRowDragAt = 0, chartOpenSeq = 0, chartTf = 'D', chartCur = null;
const CHART_TFS = [['5', '5分'], ['D', '日'], ['W', '週'], ['M', '月']];
const CHART_UP = '#E5484D', CHART_DN = '#1FA971';
const CHART_INDS = ['vol', 'kd', 'macd', 'rsi'], IND_LABEL = { vol: '副圖：量', kd: '副圖：KD', macd: '副圖：MACD', rsi: '副圖：RSI' };
let chartInd = LS.getStr('tw_chart_ind', 'vol'); if (!CHART_INDS.includes(chartInd)) chartInd = 'vol';
function cycleChartInd() {
  chartInd = CHART_INDS[(CHART_INDS.indexOf(chartInd) + 1) % CHART_INDS.length]; LS.set('tw_chart_ind', chartInd);
  $('chartIndBtn').textContent = IND_LABEL[chartInd];
  $('chartModalOverlay').querySelector('.chart-modal').classList.toggle('ind', chartInd !== 'vol');
  drawChart(); chartInfoUpdate();
}
const FUGLE_STOCK = 'https://api.fugle.tw/marketdata/v1.0/stock/';
$('appVerBox').textContent = '版本：' + APP_VER;

const twToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
function isTwTradingNow() {
  const t = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const m = t.getHours() * 60 + t.getMinutes();
  return t.getDay() > 0 && t.getDay() < 6 && m >= 535 && m <= 815;
}
function isDarkUi() {
  const m = (getComputedStyle(document.body).backgroundColor || '').match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return false;
  return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) < 110;
}
const chartMsg = txt => {
  const body = $('chartBody'); let m = body.querySelector('.chart-msg');
  if (!txt) { if (m) m.remove(); return; }
  if (!m) { m = document.createElement('div'); m.className = 'chart-msg'; body.appendChild(m); }
  m.textContent = txt;
};

/* ---------- Fugle 資料 ---------- */
async function fugleGet(path) {
  const kr = getKeyRotator(); if (kr.count === 0) throw new Error('nokey');
  let err = new Error('fail');
  for (let i = 0; i < kr.count; i++) {
    try {
      const res = await fetch(FUGLE_STOCK + path, { headers: { 'X-API-KEY': kr.next() }, signal: AbortSignal.timeout(8000) });
      if (res.ok) { trackApiUsage('Fugle'); return await res.json(); }
      err = new Error('http' + res.status);
    } catch (e) { err = e; }
  }
  throw err;
}
const validBar = d => d && [d.o, d.h, d.l, d.c].every(v => typeof v === 'number' && isFinite(v));
async function fugleHistRows(sym, tf) {
  const enc = encodeURIComponent(sym);
  const years = tf === 'D' ? 1 : tf === 'W' ? 3 : 6;
  const from = new Date(Date.now() - years * 365 * 864e5 + 8 * 3600e3).toISOString().slice(0, 10);
  const q = `historical/candles/${enc}?timeframe=${tf}&fields=open,high,low,close,volume&sort=asc`;
  let j;
  try { j = await fugleGet(`${q}&from=${from}&to=${twToday()}`); }
  catch (e) { if (e.message === 'nokey') throw e; j = await fugleGet(q); }
  return (j.data || []).map(d => ({ t: d.date, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volume || 0 })).filter(validBar);
}
// 同時向所有代理發出請求，最快成功的優先；全部失敗才算失敗
// 一次同時發出：Yahoo 直連 ＋ (query1/query2 × 所有代理)，最快回應的優先，不再逐一重試
function yahooChartRace(path) {
  const ok = j => { if (!j || !j.chart) throw new Error('bad'); return j; };
  const get = async (url, ms) => { const r = await fetch(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' }); if (!r.ok) throw new Error('http' + r.status); return ok(await r.json()); };
  const tasks = [];
  for (const host of ['query1', 'query2']) {
    const u = `https://${host}.finance.yahoo.com/${path}`;
    tasks.push(get(u, 6000));
    PROXY_LIST.forEach(px => tasks.push(get(px + encodeURIComponent(u), 8000)));
  }
  return Promise.any(tasks).catch(() => null);
}
function proxyJson(url) {
  const tasks = PROXY_LIST.map(px => (async () => {
    const res = await fetch(px + encodeURIComponent(url), { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) throw new Error('http' + res.status);
    const j = await res.json();
    if (!j || !j.chart) throw new Error('bad');
    return j;
  })());
  return Promise.any(tasks).catch(() => null);
}
async function yahooHistRows(sym, tf, yOnly = false) {
  const [range, itv] = tf === 'D' ? ['1y', '1d'] : tf === 'W' ? ['5y', '1wk'] : ['10y', '1mo'];
  const isIdx = sym === 'IX0001' || yOnly, ysym = sym === 'IX0001' ? '^TWII' : sym;
  const order = isIdx ? [''] : suffixCache.get(sym) === '.TWO' ? ['.TWO', '.TW'] : ['.TW', '.TWO'];
  let log = '代理伺服器無回應';
  for (const sfx of order) {
    const j = await yahooChartRace(`v8/finance/chart/${encodeURIComponent(ysym)}${sfx}?interval=${itv}&range=${range}`);
    if (!j) return { rows: null, log };
    const res = j.chart.result && j.chart.result[0];
    if (!res || !res.timestamp) { log = '查無此代號資料'; continue; }
    const q = res.indicators.quote[0];
    const rows = res.timestamp.map((t, i) => ({ t: new Date(t * 1000 + 8 * 3600e3).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 })).filter(validBar);
    if (rows.length) { if (!isIdx) suffixCache.set(sym, sfx); return { rows, log: '' }; }
  }
  return { rows: null, log };
}
// 本機累積：Fugle 每次只給近期資料，每次開圖就把新資料合併存起來，歷史會越存越長
const histKey = (sym, tf) => `tw_chart_hist_v1_${tf}_${sym}`;
function histCacheGet(sym, tf) {
  try { const j = JSON.parse(localStorage.getItem(histKey(sym, tf)) || 'null'); return j && Array.isArray(j.rows) ? j.rows.map(a => ({ t: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })) : []; } catch (e) { return []; }
}
function histCacheSet(sym, tf, rows) {
  try { localStorage.setItem(histKey(sym, tf), JSON.stringify({ rows: rows.slice(-520).map(r => [r.t, r.o, r.h, r.l, r.c, r.v]) })); } catch (e) {}
}
async function workerGet(path) {
  const r = await fetch(CF_WORKER_URL + path, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('http' + r.status);
  return r.json();
}
async function chartHistRows(c) {
  const { sym, tf } = c, diag = [], need = tf === 'D' ? 120 : tf === 'W' ? 60 : 36;
  let fRows = [], err = null;
  try { fRows = await fugleHistRows(sym, tf); diag.push(`Fugle ${fRows.length} 根${fRows.length ? '（最早 ' + fRows[0].t + '）' : ''}`); }
  catch (e) { err = e; if (e.message === 'nokey') throw e; diag.push('Fugle 取得失敗'); }
  const cRows = histCacheGet(sym, tf);
  let yRows = null;
  if (!c.isIndex && fRows.length < need && cRows.length < need) {
    let wlog = '';
    try {
      const j = await workerGet(`/hist?symbol=${encodeURIComponent(sym)}&tf=${tf}`);
      if (Array.isArray(j.rows)) yRows = j.rows.map(a => ({ t: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })).filter(validBar);
      else wlog = 'Worker 尚未更新';
    } catch (e) { wlog = e.message === 'http404' ? '查無此代號' : '連線失敗'; }
    if (yRows && yRows.length) diag.push(`Worker ${yRows.length} 根`);
    else {
      yRows = null; diag.push(`Worker 失敗（${wlog || '無資料'}）`);
      const y = await yahooHistRows(sym, tf);
      yRows = y.rows; diag.push(yRows ? `Yahoo ${yRows.length} 根` : `Yahoo 失敗（${y.log}）`);
    }
  }
  let rows;
  if (tf === 'D') {
    const m = new Map(); cRows.forEach(r => m.set(r.t, r)); (yRows || []).forEach(r => m.set(r.t, r)); fRows.forEach(r => m.set(r.t, r));
    rows = [...m.values()].sort((a, b) => a.t < b.t ? -1 : 1);
    if (cRows.length) diag.push(`本機累積 ${cRows.length} 根`);
  } else rows = yRows && yRows.length > fRows.length ? yRows : cRows.length > fRows.length ? cRows : fRows;
  if (rows.length) histCacheSet(sym, tf, rows);
  c.diag = diag.join('；');
  if (!rows.length && err) throw err;
  return rows;
}
async function fugleIntradayRows(sym) {
  const j = await fugleGet(`intraday/candles/${encodeURIComponent(sym)}?timeframe=5`);
  return (j.data || []).map(d => ({ t: d.date, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volume || 0 }))
    .filter(validBar).sort((a, b) => a.t < b.t ? -1 : 1);
}
const fugleQuote = sym => fugleGet(`intraday/quote/${encodeURIComponent(sym)}`).catch(() => null);
function mergeLiveQuote(rows, q, isIdx) {
  if (!q) return;
  const today = twToday(), last = q.lastPrice ?? q.closePrice;
  if (last == null || q.openPrice == null || (q.date && q.date !== today)) return;
  const bar = { t: today, o: q.openPrice, h: q.highPrice ?? last, l: q.lowPrice ?? last, c: last, v: (q.total && q.total.tradeVolume || 0) * 1000 };
  const prev = rows[rows.length - 1];
  if (isIdx) bar.v = prev && prev.t === today ? prev.v : 0; // 指數沒有「張」，保留資料源原本的量
  if (prev && prev.t === today) Object.assign(prev, bar);
  else if (!prev || prev.t < today) rows.push(bar);
}
function calcMA(rows, n) {
  const out = []; let sum = 0;
  rows.forEach((r, i) => { sum += r.c; if (i >= n) sum -= rows[i - n].c; out.push(i >= n - 1 ? sum / n : null); });
  return out;
}
function emaArr(vals, n) {
  const k = 2 / (n + 1); let prev = null;
  return vals.map(v => { if (v == null) return null; prev = prev == null ? v : v * k + prev * (1 - k); return prev; });
}
function rsiArr(cl, n) {
  const out = cl.map(() => null); if (cl.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const ch = cl[i] - cl[i - 1]; if (ch >= 0) g += ch; else l -= ch; }
  let ag = g / n, al = l / n; out[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = n + 1; i < cl.length; i++) {
    const ch = cl[i] - cl[i - 1];
    ag = (ag * (n - 1) + Math.max(ch, 0)) / n; al = (al * (n - 1) + Math.max(-ch, 0)) / n;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function calcInd(rows) {
  const n = rows.length, cl = rows.map(r => r.c), k = [], d = [];
  let pk = 50, pd = 50;
  for (let i = 0; i < n; i++) {
    if (i < 8) { k.push(null); d.push(null); continue; }
    let hh = -Infinity, ll = Infinity;
    for (let j = i - 8; j <= i; j++) { hh = Math.max(hh, rows[j].h); ll = Math.min(ll, rows[j].l); }
    const rsv = hh === ll ? 50 : (rows[i].c - ll) / (hh - ll) * 100;
    pk = pk * 2 / 3 + rsv / 3; pd = pd * 2 / 3 + pk / 3; k.push(pk); d.push(pd);
  }
  const e12 = emaArr(cl, 12), e26 = emaArr(cl, 26);
  const dif = cl.map((_, i) => i >= 25 ? e12[i] - e26[i] : null), dea = emaArr(dif, 9);
  const osc = dif.map((v, i) => v != null && dea[i] != null ? v - dea[i] : null);
  return { k, d, dif, dea, osc, r6: rsiArr(cl, 6), r14: rsiArr(cl, 14) };
}
function chartRecalc(c) { c.ma = [5, 20, 60].map(n => calcMA(c.data, n)); calcYear(c); c.ind = calcInd(c.data); }
function calcYear(c) {
  if (c.tf !== 'D' || !c.data.length) return;
  const rows = c.data.slice(-245);
  c.year = { hi: Math.max(...rows.map(r => r.h)), lo: Math.min(...rows.map(r => r.l)) };
}

async function loadFugleChart(c) {
  if (c.src) return loadAltChart(c);
  const seq = ++chartOpenSeq; clearTimeout(c.timer);
  c.data = []; c.sel = null; c.off = 0; drawChart(); chartInfoUpdate();
  chartMsg('圖表載入中…');
  try {
    const rowsP = c.tf === '5' ? fugleIntradayRows(c.sym) : chartHistRows(c);
    const [rows, q] = await Promise.all([rowsP, fugleQuote(c.sym)]);
    if (q) c.quote = q;
    if (c.tf === 'D') mergeLiveQuote(rows, c.quote, c.isIndex);
    if (seq !== chartOpenSeq || chartCur !== c) return;
    renderChartPanel();
    if (!rows.length) { chartMsg(c.tf === '5' ? '目前沒有當日分K資料（非交易時段或休市）' : '沒有取得K線資料'); return; }
    c.data = rows; c.vis = { '5': 54, D: 60, W: 52, M: 48 }[c.tf];
    chartRecalc(c);
    chartMsg(''); drawChart(); chartInfoUpdate(); renderChartPanel(); scheduleChartRefresh(c, seq);
    if (c.isIndex && c.tf !== '5') extendIndexHistory(c, seq);
  } catch (e) {
    if (seq !== chartOpenSeq || chartCur !== c) return;
    chartMsg(e.message === 'nokey' ? '尚未設定 Fugle Key，請到「進階」輸入 Key'
      : '無法取得 Fugle K線資料（可能是方案權限或流量限制）');
  }
}
/* 指數歷史補抓：Fugle 對 IX0001 只回傳近期資料，先畫圖，再於背景用 Worker／Yahoo 並行補抓更長的歷史 */
async function extendIndexHistory(c, seq) {
  const tf = c.tf, need = tf === 'D' ? 120 : tf === 'W' ? 60 : 36;
  if (c.data.length >= need) return;
  const base = c.diag || '';
  const note = t => { if (seq === chartOpenSeq && chartCur === c && c.tf === tf) { c.diag = base + '；' + t; renderChartPanel(); } };
  note('補抓更長歷史中…');
  const fromWorker = async () => {
    for (const s of ['%5ETWII', 'TWII']) {
      try {
        const j = await workerGet(`/hist?symbol=${s}&tf=${tf}`);
        const rows = Array.isArray(j.rows) ? j.rows.map(a => ({ t: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })).filter(validBar) : [];
        if (rows.length) return rows;
      } catch (e) {}
    }
    throw new Error('worker');
  };
  const fromYahoo = async () => { const y = await yahooHistRows('IX0001', tf); if (y.rows && y.rows.length) return y.rows; throw new Error('yahoo'); };
  const rows = await Promise.any([fromWorker(), fromYahoo()]).catch(() => null);
  if (seq !== chartOpenSeq || chartCur !== c || c.tf !== tf) return;
  if (!rows || rows.length <= c.data.length) { note('無法補抓更長歷史（Worker 與 Yahoo 皆失敗），之後每次開啟會自動累積'); return; }
  const m = new Map(); rows.forEach(r => m.set(r.t, r));
  c.data.forEach(r => { const y = m.get(r.t); m.set(r.t, y && y.v > 0 ? { ...r, v: y.v } : r); }); // 重疊日期沿用補抓來源的量，避免兩個來源單位不同造成量柱落差
  c.data = [...m.values()].sort((a, b) => a.t < b.t ? -1 : 1);
  histCacheSet(c.sym, tf, c.data);
  c.diag = base + `；已補抓至 ${c.data.length} 根（最早 ${c.data[0].t}）`;
  chartRecalc(c); drawChart(); chartInfoUpdate(); renderChartPanel();
}
/* ---------- 自選國外指數／臺灣指數期貨 K 線（資料不走 Fugle） ---------- */
const rowsOf = j => Array.isArray(j && j.rows) ? j.rows.map(a => ({ t: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })).filter(validBar) : [];
// 台指期日 K 本機累積：Worker 沒有歷史資料時，App 每次取得報價就更新當日這一根
const FUT_DAILY_KEY = 'tw_fut_daily_v1';
function futDailyGet() {
  try { return tickStore.load(FUT_DAILY_KEY).map(a => ({ t: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] || 0 })).filter(validBar); } catch (e) { return []; }
}
function futDailyUpdate(d) {
  const n = d && d.near; if (!n || !numOk(n.price)) return;
  if (d.session !== 'day' && d.session !== 'night') return;
  try {
    const tw = new Date(Date.now() + 28800e3); // 台北時間
    if (d.session === 'night' && tw.getUTCHours() >= 15) tw.setUTCDate(tw.getUTCDate() + 1); // 夜盤歸屬下一個交易日
    while (tw.getUTCDay() === 0 || tw.getUTCDay() === 6) tw.setUTCDate(tw.getUTCDate() + 1);
    const day = tw.toISOString().slice(0, 10), a = tickStore.load(FUT_DAILY_KEY).slice(), i = a.findIndex(x => x[0] === day);
    const p = n.price, o = numOk(n.open) ? n.open : p, h = Math.max(numOk(n.high) ? n.high : p, p), l = Math.min(numOk(n.low) ? n.low : p, p);
    if (i < 0) a.push([day, o, h, l, p, n.volume || 0]);
    else { const x = a[i]; x[2] = Math.max(x[2], h); x[3] = Math.min(x[3], l); x[4] = p; if (numOk(n.volume)) x[5] = n.volume; }
    a.sort((x, y) => x[0] < y[0] ? -1 : 1);
    tickStore.save(FUT_DAILY_KEY, a.slice(-500));
  } catch (e) {}
}
async function altHistRows(c) {
  if (c.src === 'fut') {
    let w = [];
    try { const r = await fetch(FUT_WORKER_URL + 'hist?tf=D&_=' + Date.now(), { signal: AbortSignal.timeout(12000) }); if (r.ok) w = rowsOf(await r.json()); } catch (e) {}
    const m = new Map(); futDailyGet().forEach(r => m.set(r.t, r)); w.forEach(r => m.set(r.t, r)); // Worker 資料優先，本機補足缺的日期
    return [...m.values()].sort((a, b) => a.t < b.t ? -1 : 1);
  }
  // 自家 Worker /hist 優先（有邊緣快取），Yahoo 競速為後備
  const fromWorker = async path => { const rows = rowsOf(await workerGet(path)); if (rows.length) return rows; throw new Error('w'); };
  const fromYahoo = async () => { const y = await yahooHistRows(c.sym, c.tf, true); if (y.rows && y.rows.length) return y.rows; throw new Error('y'); };
  const q = `symbol=${encodeURIComponent(c.sym)}&tf=${c.tf}`;
  const rows = await Promise.any([fromWorker('/hist?' + q), fromYahoo()]).catch(() => []);
  if (rows.length) histCacheSet(c.sym, c.tf, rows);
  return rows;
}
async function altLive(c) {
  if (c.src === 'fut') {
    const r = await fetch(FUT_WORKER_URL + '?_=' + Date.now(), { signal: AbortSignal.timeout(API_TIMEOUT), cache: 'no-store' });
    c.futData = r.ok ? await r.json() : c.futData;
    futDailyUpdate(c.futData);
    const n = c.futData && c.futData.near;
    return n && n.price != null ? { last: n.price, prev: n.ref } : null;
  }
  const it = cachedGlobalIndices.find(x => x.symbol === c.sym);
  return it ? { last: it.price, prev: it.price - it.changeAmt } : null;
}
function altApply(c, live) {
  const last = c.data[c.data.length - 1];
  if (live && last) { last.c = live.last; last.h = Math.max(last.h, live.last); last.l = Math.min(last.l, live.last); }
  const d = c.data[c.data.length - 1] || {}, prev = live && live.prev != null ? live.prev : (c.data.length > 1 ? c.data[c.data.length - 2].c : null);
  if (c.src !== 'fut') c.quote = { date: d.t, previousClose: prev, openPrice: d.o, highPrice: d.h, lowPrice: d.l, lastPrice: d.c, amplitude: prev ? (d.h - d.l) / prev * 100 : null, total: {} };
}
async function loadAltChart(c) {
  if (c.tf === 'T') return loadLiveChart(c);
  const seq = ++chartOpenSeq; clearTimeout(c.timer);
  c.data = []; c.sel = null; c.off = 0; drawChart(); chartInfoUpdate(); chartMsg('圖表載入中…');
  // 先用本機快取立刻畫出（國外指數），再背景更新；不必等網路
  if (c.src !== 'fut') {
    const cached = histCacheGet(c.sym, c.tf);
    if (cached.length) {
      const l0 = await altLive(c).catch(() => null);
      c.data = cached; c.vis = { D: 60, W: 52, M: 48 }[c.tf]; altApply(c, l0); chartRecalc(c);
      chartMsg(''); drawChart(); chartInfoUpdate(); renderChartPanel();
    }
  }
  const [rows, live] = await Promise.all([altHistRows(c).catch(() => []), altLive(c).catch(() => null)]);
  if (seq !== chartOpenSeq || chartCur !== c) return;
  renderChartPanel();
  if (!rows.length && c.data.length) { altApply(c, live); chartRecalc(c); drawChart(); chartInfoUpdate(); renderChartPanel(); return; }
  if (!rows.length) { chartMsg(c.src === 'fut' ? '期貨 K 線資料累積中：App 開著且在交易時段時會自動記錄日 K，之後每個交易日新增一根' : '沒有取得 K 線資料'); return; }
  c.data = rows; c.vis = { D: 60, W: 52, M: 48 }[c.tf]; altApply(c, live); chartRecalc(c);
  chartMsg(''); drawChart(); chartInfoUpdate(); renderChartPanel();
  const tick = async () => {
    if (seq !== chartOpenSeq || chartCur !== c) return;
    if (document.visibilityState === 'visible') { try { altApply(c, await altLive(c)); chartRecalc(c); drawChart(); chartInfoUpdate(); renderChartPanel(); } catch (e) {} }
    c.timer = setTimeout(tick, 15000);
  };
  c.timer = setTimeout(tick, 15000);
}
/* ---------- 即時走勢（分時線）：國外指數用 Yahoo 1 分鐘資料；台指期優先用 Worker /intraday，沒有就用 App 本機記錄 ---------- */
/* 高頻資料（tick / 日K）：記憶體為主、延遲合併寫入 localStorage，避免每次輪詢都整包 parse + stringify */
const tickStore = {
  mem: {}, dirty: new Set(), timer: null,
  load(key) {
    if (!(key in this.mem)) { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); this.mem[key] = Array.isArray(v) ? v : []; } catch (e) { this.mem[key] = []; } }
    return this.mem[key];
  },
  save(key, arr) { this.mem[key] = arr; this.dirty.add(key); if (!this.timer) this.timer = setTimeout(() => this.flush(), 15000); },
  flush() {
    clearTimeout(this.timer); this.timer = null;
    this.dirty.forEach(k => { try { localStorage.setItem(k, JSON.stringify(this.mem[k])); } catch (e) {} });
    this.dirty.clear();
  }
};
window.addEventListener('pagehide', () => tickStore.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tickStore.flush(); });
const FUT_TICK_KEY = 'tw_fut_ticks_v1';
const tickRow = (ts, p) => ({ ts, t: new Date((ts + 28800) * 1000).toISOString().slice(0, 16), o: p, h: p, l: p, c: p, v: 0 });
function futTicksGet() {
  try {
    const cut = Date.now() / 1000 - 20 * 3600;
    return tickStore.load(FUT_TICK_KEY).filter(x => x[0] > cut && numOk(x[1])).map(x => tickRow(x[0], x[1]));
  } catch (e) { return []; }
}
function futTickAdd(price, vol, session) {
  if (!numOk(price) || (session !== 'day' && session !== 'night')) return; // 非交易時段不記錄，避免畫出一條平線
  try {
    const now = Math.floor(Date.now() / 1000), min = Math.floor(now / 60) * 60, cut = now - 20 * 3600;
    const a = tickStore.load(FUT_TICK_KEY).filter(x => x[0] > cut), last = a[a.length - 1];
    if (last && last[0] === min) { last[1] = price; last[2] = vol; }
    else if (!last || !numOk(vol) || last[2] !== vol) a.push([min, price, vol]); // 成交量沒變＝沒有新成交，不新增
    tickStore.save(FUT_TICK_KEY, a.slice(-1300));
  } catch (e) {}
}
// 台指期交易時段框：日盤 08:45–13:45、夜盤 15:00–次日 05:00（台北時間）
function futFrame(rows) {
  if (!rows.length) return null;
  const lastTs = rows[rows.length - 1].ts, tw = new Date((lastTs + 28800) * 1000), mins = tw.getUTCHours() * 60 + tw.getUTCMinutes();
  const day0 = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) / 1000 - 28800;
  if (mins >= 525 && mins <= 830) return [day0 + 525 * 60, day0 + 825 * 60];
  if (mins >= 900) return [day0 + 900 * 60, day0 + 86400 + 300 * 60];
  if (mins < 300) return [day0 - 86400 + 900 * 60, day0 + 300 * 60];
  return null;
}
function parseYahooIntraday(j) {
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp || !res.indicators) return null;
  const q = res.indicators.quote[0], m = res.meta || {}, off = m.gmtoffset || 0, rows = [];
  res.timestamp.forEach((ts, i) => { const p = q.close[i]; if (numOk(p)) rows.push({ ts, t: new Date((ts + 28800) * 1000).toISOString().slice(0, 16), o: p, h: p, l: p, c: p, v: 0 }); });
  const rg = m.currentTradingPeriod && m.currentTradingPeriod.regular;
  return rows.length ? { rows, prev: m.chartPreviousClose ?? m.previousClose, off, frame: rg && rg.start && rg.end ? [rg.start, rg.end] : null } : null;
}
// 同時競速：自家 Worker（/intraday、/yahoo）＋ Yahoo 直連 ＋ 所有公開代理，最快有資料的優先
async function yahooIntraday(sym) {
  const path = `v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d`;
  const get = async (url, ms) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' });
    if (!r.ok) throw new Error('http' + r.status);
    return r.json();
  };
  const tasks = [
    // Worker 若已提供 /intraday?symbol=（回傳 Yahoo chart 格式或 {rows:[[ts,price],...]}）
    (async () => {
      const j = await get(`${CF_WORKER_URL}/intraday?symbol=${encodeURIComponent(sym)}&_=${Date.now()}`, 8000);
      const y = parseYahooIntraday(j);
      if (y) return y;
      if (Array.isArray(j && j.rows)) {
        const rows = j.rows.map(a => tickRow(a[0] > 1e12 ? Math.floor(a[0] / 1000) : a[0], a[1])).filter(x => numOk(x.c));
        if (rows.length) return { rows, prev: j.prev ?? j.previousClose, off: j.off || 28800, frame: j.frame || null };
      }
      throw new Error('empty');
    })(),
    // Yahoo 直連（部分網路／瀏覽器允許 CORS）
    ...['query1', 'query2'].map(host => (async () => { const y = parseYahooIntraday(await get(`https://${host}.finance.yahoo.com/${path}`, 8000)); if (!y) throw new Error('empty'); return y; })()),
    // 公開代理
    ...['query1', 'query2'].flatMap(host => PROXY_LIST.map(px => (async () => { const y = parseYahooIntraday(await get(px + encodeURIComponent(`https://${host}.finance.yahoo.com/${path}`), 10000)); if (!y) throw new Error('empty'); return y; })()))
  ];
  return Promise.any(tasks).catch(() => null);
}
// 後備：所有外部來源都失敗時，用 App 本機每分鐘記錄的報價畫即時走勢
const IDX_TICK_KEY = 'tw_idx_ticks_v1_';
function idxTicksGet(sym) {
  try { const cut = Date.now() / 1000 - 26 * 3600; return tickStore.load(IDX_TICK_KEY + sym).filter(x => x[0] > cut && numOk(x[1])).map(x => tickRow(x[0], x[1])); } catch (e) { return []; }
}
// 國外指數交易時段（取自 Yahoo meta 的 regular 時段，依「日」平移到今天）；盤後不記錄、不輪詢
const IDX_FRAME_KEY = 'tw_idx_frames_v1';
function idxFrameSet(sym, frame, off) {
  if (!frame || !(frame[1] > frame[0])) return;
  try { const m = JSON.parse(localStorage.getItem(IDX_FRAME_KEY) || '{}'); m[sym] = { f: frame, off: off || 0 }; localStorage.setItem(IDX_FRAME_KEY, JSON.stringify(m)); } catch (e) {}
}
function idxInSession(sym) {
  try {
    const e = (JSON.parse(localStorage.getItem(IDX_FRAME_KEY) || '{}'))[sym];
    if (!e) return true; // 還不知道交易時段：照舊（靠價格沒變就不新增擋掉平線）
    const now = Date.now() / 1000, len = e.f[1] - e.f[0];
    const wd = new Date((now + e.off) * 1000).getUTCDay();
    if (wd === 0 || wd === 6) return false;
    const s0 = e.f[0] + Math.floor((now - e.f[0]) / 86400) * 86400;
    return now >= s0 - 60 && now <= s0 + len + 120; // 收盤後多留 2 分鐘抓最後幾筆
  } catch (e) { return true; }
}
function idxTickAdd(sym, price) {
  if (!numOk(price) || !idxInSession(sym)) return;
  try {
    const now = Math.floor(Date.now() / 1000), min = Math.floor(now / 60) * 60, cut = now - 26 * 3600;
    const a = tickStore.load(IDX_TICK_KEY + sym).filter(x => x[0] > cut), last = a[a.length - 1];
    if (last && last[0] === min) last[1] = price; else if (!last || last[1] !== price) a.push([min, price]);
    tickStore.save(IDX_TICK_KEY + sym, a.slice(-1500));
  } catch (e) {}
}
async function altIntraday(c) {
  if (c.src === 'fut') {
    await altLive(c).catch(() => null); // 更新 c.futData
    const d = c.futData, near = d && d.near;
    if (near && near.price != null) futTickAdd(near.price, near.volume, d.session);
    let rows = [], src = 'worker';
    try {
      const r = await fetch(FUT_WORKER_URL + 'intraday?_=' + Date.now(), { signal: AbortSignal.timeout(8000), cache: 'no-store' });
      if (r.ok) { const j = await r.json(); rows = (Array.isArray(j.rows) ? j.rows : []).map(a => tickRow(a[0] > 1e12 ? Math.floor(a[0] / 1000) : a[0], a[1])).filter(x => numOk(x.c)); }
    } catch (e) {}
    const local = futTicksGet();
    if (rows.length < 2 || rows.length < local.length) { rows = local; src = 'local'; }
    const frame = futFrame(rows);
    if (frame) rows = rows.filter(r => r.ts >= frame[0] - 60 && r.ts <= frame[1] + 60);
    return { rows, live: { prev: near ? near.ref : null, off: 28800, frame, src } };
  }
  const y = await yahooIntraday(c.sym);
  if (y) idxFrameSet(c.sym, y.frame, y.off);
  const it = cachedGlobalIndices.find(x => x.symbol === c.sym);
  if (it) idxTickAdd(c.sym, it.price);
  const local = idxTicksGet(c.sym);
  if (y) {
    // 收盤時間：優先用這次回傳的時段，沒有就用本機記下的時段；依資料所在的那一天平移
    let fr = y.frame;
    if (!fr) { try { const e = (JSON.parse(localStorage.getItem(IDX_FRAME_KEY) || '{}'))[c.sym]; if (e) fr = e.f; } catch (e) {} }
    let [s0, s1] = fr || [0, 0], cut = Infinity;
    if (fr) { const sh = Math.round((y.rows[0].ts - s0) / 86400) * 86400; s0 += sh; s1 += sh; cut = s1 + 120; }
    let yr = y.rows.filter(r => r.ts <= cut); // 收盤後的資料一律丟掉，曲線停在收盤
    if (!yr.length) yr = y.rows;
    // 開盤初期 Yahoo 常只回 1~2 個點（或比實際報價落後）：把本機記錄且比 Yahoo 最後一點新的報價接在後面
    const lastTs = yr[yr.length - 1].ts;
    const extra = local.filter(r => r.ts > lastTs + 30 && r.ts - lastTs < 8 * 3600 && r.ts <= cut);
    let rows = extra.length ? yr.concat(extra) : yr;
    if (!fr) { // 查不到時段：尾端「價格都沒變」超過 5 分鐘的平線視為盤後，截掉
      let k = rows.length - 1; while (k > 0 && rows[k - 1].c === rows[rows.length - 1].c) k--;
      if (rows[rows.length - 1].ts - rows[k].ts > 300) rows = rows.slice(0, k + 1);
    }
    return { rows, live: { prev: y.prev, off: y.off, frame: fr ? [s0, s1] : null, src: 'yahoo' } };
  }
  return local.length >= 20 ? { rows: local, live: { prev: it ? it.price - it.changeAmt : null, off: 28800, frame: null, src: 'local' } } : null;
}
async function loadLiveChart(c) {
  const seq = ++chartOpenSeq; clearTimeout(c.timer);
  c.data = []; c.sel = null; c.off = 0; c.live = null; drawChart(); chartInfoUpdate(); chartMsg('即時走勢載入中…');
  const run = async () => {
    const got = await altIntraday(c).catch(() => null);
    if (seq !== chartOpenSeq || chartCur !== c || c.tf !== 'T') return;
    if (got && got.rows.length) {
      c.data = got.rows; c.live = got.live;
      if (c.src !== 'fut') {
        const cl = got.rows.map(r => r.c), pv = got.live.prev, hi = Math.max(...cl), lo = Math.min(...cl);
        c.quote = { date: got.rows[got.rows.length - 1].t.slice(0, 10), previousClose: pv, openPrice: cl[0], highPrice: hi, lowPrice: lo, lastPrice: cl[cl.length - 1], amplitude: pv ? (hi - lo) / pv * 100 : null, total: {} };
      }
    }
    renderChartPanel();
    if (c.data.length === 1 && c.src !== 'fut') { chartMsg('剛開盤，目前只有 1 筆即時資料，累積中（每 30 秒自動更新）。可先切到「日」查看日 K'); return; }
    if (c.data.length < 2) { chartMsg(c.src === 'fut' ? '台指期即時走勢累積中：雲端每 2.5 分鐘記錄一點（交易時段），稍後再看，或切到「日」看日 K' : '即時走勢載入失敗：所有資料來源都沒有回應，每 30 秒自動重試。可先切到「日」查看日 K'); return; }
    chartMsg(''); drawChart(); chartInfoUpdate();
  };
  await run();
  const gap = c.src === 'fut' ? 15000 : 30000;
  const tick = async () => {
    if (seq !== chartOpenSeq || chartCur !== c || c.tf !== 'T') return;
    let wait = gap;
    if (c.src !== 'fut' && c.data.length > 1 && !idxInSession(c.sym)) wait = 60000; // 國外指數盤後：不再抓即時資料，只每分鐘檢查是否開盤
    else if (document.visibilityState === 'visible') await run();
    if (seq === chartOpenSeq && chartCur === c && c.tf === 'T') c.timer = setTimeout(tick, wait);
  };
  c.timer = setTimeout(tick, gap);
}
function liveSelect(c, e, cv, toggle) {
  const L = c.LT; if (!L || !c.data.length) return;
  const r = cv.getBoundingClientRect(), ts = L.t0 + (e.clientX - r.left) / L.plotW * (L.t1 - L.t0);
  let best = 0, bd = Infinity;
  c.data.forEach((d, i) => { const dd = Math.abs(d.ts - ts); if (dd < bd) { bd = dd; best = i; } });
  c.sel = toggle && c.sel === best ? null : best; drawChart(); chartInfoUpdate();
}
function drawLive(c, g, W, H) {
  const data = c.data, lv = c.live || {}, cs = getComputedStyle(document.body);
  const cMuted = cs.getPropertyValue('--t-muted').trim() || '#888', cGrid = cs.getPropertyValue('--border-light').trim() || '#ddd', cMain = cs.getPropertyValue('--t-main').trim() || '#222';
  const padR = 58, padT = 10, padB = 20, plotW = W - padR, plotH = H - padT - padB;
  const first = data[0], last = data[data.length - 1], prev = numOk(lv.prev) ? lv.prev : first.c;
  let t0 = first.ts, t1 = last.ts;
  if (lv.frame) {
    let [f0, f1] = lv.frame;
    // Yahoo 收盤後會把「目前交易時段」跳到下一個交易日；若與資料不在同一天，整天平移回資料所在的那一天，避免軸線被拉成 30 小時
    if (f0 > last.ts || f1 < first.ts) { const sh = Math.round((first.ts - f0) / 86400) * 86400; f0 += sh; f1 += sh; }
    t0 = Math.min(f0, t0); t1 = Math.max(f1, t1);
  }
  if (t1 - t0 < 1800) t1 = t0 + 1800;
  let mx = 0; data.forEach(d => { mx = Math.max(mx, Math.abs(d.c - prev)); });
  const span = (mx || prev * 0.002) * 1.15, hi = prev + span, lo = prev - span;
  const xAt = ts => (ts - t0) / (t1 - t0) * plotW, yAt = v => padT + (hi - v) / (hi - lo) * plotH;
  g.font = '11px sans-serif'; g.lineWidth = 1; g.textAlign = 'left';
  for (let k = 0; k <= 4; k++) { // 水平線：中間那條是昨收；右側價格、左側漲跌幅
    const v = hi - (hi - lo) * k / 4, y = Math.round(yAt(v)) + 0.5, pc = (v - prev) / prev * 100;
    g.strokeStyle = cGrid; g.setLineDash(k === 2 ? [4, 3] : []); g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.setLineDash([]);
    g.textBaseline = k === 0 ? 'top' : k === 4 ? 'bottom' : 'middle';
    g.fillStyle = cMuted; g.fillText(fmtP(v), plotW + 4, y);
    g.fillStyle = pc > 0.005 ? CHART_UP : pc < -0.005 ? CHART_DN : cMuted; g.fillText((pc > 0 ? '+' : '') + pc.toFixed(2) + '%', 4, y);
  }
  g.textBaseline = 'alphabetic'; g.fillStyle = cMuted;
  for (let k = 0; k <= 4; k++) { g.textAlign = k === 0 ? 'left' : k === 4 ? 'right' : 'center'; g.fillText(new Date((t0 + (t1 - t0) * k / 4 + 28800) * 1000).toISOString().slice(11, 16), xAt(t0 + (t1 - t0) * k / 4), H - 5); }
  const col = last.c > prev ? CHART_UP : last.c < prev ? CHART_DN : '#8A94A6';
  const grad = g.createLinearGradient(0, padT, 0, padT + plotH); grad.addColorStop(0, col + '45'); grad.addColorStop(1, col + '00');
  g.beginPath(); data.forEach((d, i) => { const x = xAt(d.ts), y = yAt(d.c); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
  g.strokeStyle = col; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
  g.lineTo(xAt(last.ts), padT + plotH); g.lineTo(xAt(first.ts), padT + plotH); g.closePath(); g.fillStyle = grad; g.fill(); g.lineWidth = 1;
  const ly = yAt(last.c); // 最新價標籤
  g.strokeStyle = col; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, ly); g.lineTo(plotW, ly); g.stroke(); g.setLineDash([]);
  g.fillStyle = col; g.fillRect(plotW, ly - 8, padR, 16); g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fmtP(last.c), plotW + 4, ly);
  if (c.sel != null && data[c.sel]) {
    const d = data[c.sel], x = xAt(d.ts), y = yAt(d.c);
    g.strokeStyle = cMain; g.globalAlpha = 0.5; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(Math.round(x) + 0.5, padT); g.lineTo(Math.round(x) + 0.5, padT + plotH); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(plotW, Math.round(y) + 0.5); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    g.fillStyle = col; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
  }
  if (lv.src === 'local') { g.fillStyle = cMuted; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText('走勢由 App 開啟期間記錄', plotW / 2, padT + 2); }
  c.LT = { t0, t1, plotW };
}
function panelFutHTML(c) {
  const d = c.futData, n = d && d.near; if (!n) return '';
  const x = d.next, f = v => numOk(v) ? fmtP(v) : '—', iv = v => numOk(v) ? Math.round(v).toLocaleString() : '—';
  return `<div class="cp-title">近月行情${d.session === 'night' ? '（夜盤）' : d.session === 'day' ? '（日盤）' : ''}</div><div class="cp-grid">` +
    cpRow('參考價', f(n.ref)) + cpRow('開盤', f(n.open), upDnStyle(n.open, n.ref)) + cpRow('最高', f(n.high), upDnStyle(n.high, n.ref)) + cpRow('最低', f(n.low), upDnStyle(n.low, n.ref)) +
    cpRow('成交量', iv(n.volume) + ' 口') + cpRow('未平倉', iv(n.oi) + ' 口') + cpRow('買價', f(n.bid)) + cpRow('賣價', f(n.ask)) +
    cpRow('近月減現貨', numOk(d.basis) ? (d.basis > 0 ? '+' : '') + fmtP(d.basis) : '—') + (x ? cpRow('近二', f(x.price) + (numOk(x.change) ? `（${x.change > 0 ? '+' : ''}${fmtP(x.change)}）` : '')) : '') + `</div>`;
}
function openAltChart(s) {
  $('chartTitle').innerHTML = `${escapeHTML(s.symbol)}<small>${escapeHTML(s.name)}</small>`;
  $('chartModalOverlay').classList.add('show');
  if (!(history.state && history.state.chart)) history.pushState({ chart: 1 }, '');
  startChart({ sym: s.symbol, stock: null, engine: 'fugle', src: s.src, isIndex: true, tf: 'T', data: [], ma: [[], [], []], vis: 60, live: null, off: 0, sel: null, timer: 0, quote: null, futData: null, year: null, ptab: 'quote', vol: null, trades: null, div: null, hold: null, ind: null });
}
function scheduleChartRefresh(c, seq) {
  clearTimeout(c.timer);
  c.timer = setTimeout(async () => {
    if (seq !== chartOpenSeq || chartCur !== c) return;
    if (document.visibilityState === 'visible' && isTwTradingNow()) {
      try {
        const [q, rows] = await Promise.all([fugleQuote(c.sym), c.tf === '5' ? fugleIntradayRows(c.sym).catch(() => null) : null]);
        if (seq !== chartOpenSeq || chartCur !== c) return;
        if (q) c.quote = q;
        if (rows && rows.length) c.data = rows; else if (c.tf === 'D') mergeLiveQuote(c.data, c.quote, c.isIndex);
        chartRecalc(c);
        if (c.ptab === 'vol') loadVolTab(c, true); else if (c.ptab === 'trades') loadTradesTab(c, true);
        drawChart(); chartInfoUpdate(); renderChartPanel();
      } catch (e) {}
    }
    scheduleChartRefresh(c, seq);
  }, 15000);
}

/* ---------- 繪圖 ---------- */
const fmtP = v => (+Number(v).toFixed(2)).toString();
const fmtV = (c, v) => c.isIndex ? (v >= 1e8 ? (v / 1e8).toFixed(1) + ' 億' : Math.round(v).toLocaleString()) : c.tf === '5' ? Math.round(v).toLocaleString() + ' 張' : Math.round(v / 1000).toLocaleString() + ' 張';
function drawChart() {
  const cv = $('chartCanvas'); if (!cv || !chartCur) return;
  const c = chartCur, W = cv.parentElement.clientWidth, H = cv.parentElement.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const data = c.data; if (!data || !data.length) return;
  if (c.tf === 'T') { drawLive(c, g, W, H); return; }
  const cs = getComputedStyle(document.body);
  const cMuted = cs.getPropertyValue('--t-muted').trim() || '#888', cGrid = cs.getPropertyValue('--border-light').trim() || '#ddd', cMain = cs.getPropertyValue('--t-main').trim() || '#222';
  const padR = 52, padT = 8, padB = 20, gap = 8;
  const hasInd = chartInd !== 'vol', avail = H - padT - padB;
  const indH = hasInd ? Math.round(avail * 0.27) : 0, volH = Math.round(avail * (hasInd ? 0.13 : 0.22));
  const priceH = avail - volH - indH - gap * (hasInd ? 2 : 1), bottomY = padT + priceH + gap + volH + (hasInd ? gap + indH : 0);
  const ind = c.ind || calcInd([]);
  const vis = Math.max(Math.min(c.vis, data.length), Math.min(30, c.vis)); // 資料太少時保留空位，K 棒不會變得又寬又大
  const end = data.length - c.off, start = Math.max(0, end - vis);
  const slice = data.slice(start, end), n = slice.length;
  const plotW = W - padR, step = plotW / vis, bw = Math.max(1, Math.min(step * 0.68, 18));
  const xAt = i => plotW - (n - i - 0.5) * step;
  let hi = -Infinity, lo = Infinity, vmax = 0;
  slice.forEach(d => { hi = Math.max(hi, d.h); lo = Math.min(lo, d.l); vmax = Math.max(vmax, d.v); });
  c.ma.forEach(arr => { for (let i = start; i < end; i++) { const v = arr[i]; if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } } });
  const pd = (hi - lo) * 0.06 || hi * 0.01; hi += pd; lo -= pd;
  const yP = v => padT + (hi - v) / (hi - lo) * priceH, yV = v => padT + priceH + gap + volH - (vmax ? v / vmax * volH : 0);
  g.font = '11px sans-serif'; g.textBaseline = 'middle'; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4, y = Math.round(yP(v)) + 0.5;
    g.strokeStyle = cGrid; g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke();
    g.fillStyle = cMuted; g.textAlign = 'left'; g.fillText(fmtP(v), plotW + 4, y);
  }
  g.textBaseline = 'alphabetic'; g.textAlign = 'center'; g.fillStyle = cMuted;
  const lab = d => c.tf === '5' ? d.t.slice(11, 16) : c.tf === 'M' ? d.t.slice(0, 7) : d.t.slice(5);
  const every = Math.max(1, Math.round(n / 4));
  for (let i = 0; i < n; i += every) { const x = xAt(i); if (x > 18 && x < plotW - 18) g.fillText(lab(slice[i]), x, H - 5); }
  slice.forEach((d, i) => {
    const x = xAt(i), col = d.c > d.o ? CHART_UP : d.c < d.o ? CHART_DN : cMuted;
    g.fillStyle = col; g.strokeStyle = col;
    g.globalAlpha = 0.45; g.fillRect(x - bw / 2, yV(d.v), bw, padT + priceH + gap + volH - yV(d.v)); g.globalAlpha = 1;
    g.beginPath(); g.moveTo(Math.round(x) + 0.5, yP(d.h)); g.lineTo(Math.round(x) + 0.5, yP(d.l)); g.stroke();
    const top = yP(Math.max(d.o, d.c)), bh = Math.max(1, Math.abs(yP(d.o) - yP(d.c)));
    g.fillRect(x - bw / 2, top, bw, bh);
  });
  ['#F59E0B', '#3B82F6', '#A855F7'].forEach((col, mi) => {
    g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); let started = false;
    for (let i = start; i < end; i++) { const v = c.ma[mi][i]; if (v == null) continue; const x = xAt(i - start), y = yP(v); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y); }
    g.stroke();
  });
  g.lineWidth = 1;
  if (hasInd) { // 技術指標副圖
    const top = padT + priceH + gap + volH + gap, ih = indH - 4;
    let lo2 = 0, hi2 = 100, lines = [], refs = [], hist = null, name = '';
    if (chartInd === 'kd') { lines = [[ind.k, '#F59E0B'], [ind.d, '#3B82F6']]; refs = [20, 50, 80]; name = 'KD(9,3,3)'; }
    else if (chartInd === 'rsi') { lines = [[ind.r6, '#F59E0B'], [ind.r14, '#3B82F6']]; refs = [30, 50, 70]; name = 'RSI(6,14)'; }
    else {
      let m = 0; for (let i = start; i < end; i++) [ind.dif[i], ind.dea[i], ind.osc[i]].forEach(v => { if (v != null) m = Math.max(m, Math.abs(v)); });
      m = (m || 1) * 1.1; lo2 = -m; hi2 = m; lines = [[ind.dif, '#F59E0B'], [ind.dea, '#3B82F6']]; hist = ind.osc; refs = [0]; name = 'MACD(12,26,9)';
    }
    const yI = v => top + 2 + (hi2 - v) / (hi2 - lo2) * ih;
    g.strokeStyle = cGrid; g.beginPath(); g.moveTo(0, top - gap / 2 + 0.5); g.lineTo(plotW, top - gap / 2 + 0.5); g.stroke();
    g.textBaseline = 'middle'; g.textAlign = 'left';
    refs.forEach(v => {
      const y = Math.round(yI(v)) + 0.5; g.strokeStyle = cGrid; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = cMuted; g.fillText(String(v), plotW + 4, y);
    });
    const any = lines.some(([arr]) => arr.slice(start, end).some(v => v != null));
    if (hist) slice.forEach((_, i) => {
      const v = hist[start + i]; if (v == null) return; const x = xAt(i), y0 = yI(0), y1 = yI(v);
      g.fillStyle = v >= 0 ? CHART_UP : CHART_DN; g.globalAlpha = 0.7; g.fillRect(x - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0))); g.globalAlpha = 1;
    });
    lines.forEach(([arr, col]) => {
      g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); let st2 = false;
      for (let i = start; i < end; i++) { const v = arr[i]; if (v == null) continue; const x = xAt(i - start), y = yI(v); if (!st2) { g.moveTo(x, y); st2 = true; } else g.lineTo(x, y); }
      g.stroke();
    });
    g.lineWidth = 1; g.fillStyle = cMuted; g.textBaseline = 'top'; g.fillText(name, 4, top + 2);
    if (!any) { g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('資料不足，無法計算', plotW / 2, top + ih / 2); }
  }
  const lastBar = data[data.length - 1];
  if (c.off === 0) {
    const y = yP(lastBar.c), col = lastBar.c >= lastBar.o ? CHART_UP : CHART_DN;
    g.strokeStyle = col; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.setLineDash([]);
    g.fillStyle = col; g.fillRect(plotW, y - 8, padR, 16);
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(fmtP(lastBar.c), plotW + 4, y);
  }
  if (c.sel != null && c.sel >= start && c.sel < end) {
    const x = xAt(c.sel - start); g.strokeStyle = cMain; g.globalAlpha = 0.5; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(Math.round(x) + 0.5, padT); g.lineTo(Math.round(x) + 0.5, bottomY); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  }
  c.L = { step, plotW, start, n, vis };
}
function indInfoHTML(c, i) {
  const ind = c.ind; if (!ind || chartInd === 'vol') return '';
  const f = (v, d = 1) => v != null ? v.toFixed(d) : '—', sp = (col, t) => `<span style="color:${col}">${t}</span>`;
  if (chartInd === 'kd') return '<br>' + sp('#F59E0B', 'K ' + f(ind.k[i])) + '　' + sp('#3B82F6', 'D ' + f(ind.d[i]));
  if (chartInd === 'rsi') return '<br>' + sp('#F59E0B', 'RSI6 ' + f(ind.r6[i])) + '　' + sp('#3B82F6', 'RSI14 ' + f(ind.r14[i]));
  const o = ind.osc[i];
  return '<br>' + sp('#F59E0B', 'DIF ' + f(ind.dif[i], 2)) + '　' + sp('#3B82F6', 'DEA ' + f(ind.dea[i], 2)) + '　' + sp(o == null ? 'inherit' : o >= 0 ? CHART_UP : CHART_DN, 'OSC ' + f(o, 2));
}
function chartInfoUpdate() {
  const el = $('chartInfo'), c = chartCur;
  if (!c || !c.data || !c.data.length) { el.innerHTML = ''; return; }
  const i = c.sel != null && c.sel < c.data.length ? c.sel : c.data.length - 1;
  if (c.tf === 'T') { // 即時走勢：顯示時間、價格、漲跌與當日高低
    const lv = c.live || {}, p0 = lv.prev, pt = c.data[i], cl = c.data.map(r => r.c), dh = Math.max(...cl), dl = Math.min(...cl);
    const ch = numOk(p0) ? pt.c - p0 : null, cc = ch > 0 ? CHART_UP : ch < 0 ? CHART_DN : 'inherit';
    el.innerHTML = `${escapeHTML(pt.t.replace('T', ' ').slice(5, 16))}　價 <b style="color:${cc}">${fmtP(pt.c)}</b>` +
      (ch != null ? ` <b style="color:${cc}">${ch > 0 ? '+' : ''}${fmtP(ch)} (${ch > 0 ? '+' : ''}${(ch / p0 * 100).toFixed(2)}%)</b>` : '') +
      `<br>昨收 ${numOk(p0) ? fmtP(p0) : '—'}　高 <b style="color:${CHART_UP}">${fmtP(dh)}</b>　低 <b style="color:${CHART_DN}">${fmtP(dl)}</b>`;
    return;
  }
  const d = c.data[i], pc = i > 0 ? c.data[i - 1].c : null;
  const chg = pc != null ? d.c - pc : null, col = v => v > 0 ? CHART_UP : v < 0 ? CHART_DN : 'inherit';
  const chgTxt = chg != null ? ` <b style="color:${col(chg)}">${chg > 0 ? '+' : ''}${fmtP(chg)} (${chg > 0 ? '+' : ''}${(chg / pc * 100).toFixed(2)}%)</b>` : '';
  el.innerHTML = `${escapeHTML(d.t.replace('T', ' ').slice(0, 16))}　開 <b>${fmtP(d.o)}</b> 高 <b style="color:${CHART_UP}">${fmtP(d.h)}</b> 低 <b style="color:${CHART_DN}">${fmtP(d.l)}</b> 收 <b>${fmtP(d.c)}</b>${chgTxt}　量 ${fmtV(c, d.v)}<br>` +
    `<span style="color:#F59E0B">MA5 ${c.ma[0][i] != null ? fmtP(c.ma[0][i]) : '—'}</span>　<span style="color:#3B82F6">MA20 ${c.ma[1][i] != null ? fmtP(c.ma[1][i]) : '—'}</span>　<span style="color:#A855F7">MA60 ${c.ma[2][i] != null ? fmtP(c.ma[2][i]) : '—'}</span>` + indInfoHTML(c, i);
}

/* ---------- 下方資訊面板 ---------- */
const numOk = v => typeof v === 'number' && isFinite(v);
const upDnStyle = (v, ref = 0) => !numOk(v) || !numOk(ref) ? '' : v > ref ? `style="color:${CHART_UP}"` : v < ref ? `style="color:${CHART_DN}"` : '';
const cpRow = (k, v, extra = '') => `<div><span>${k}</span><b ${extra}>${v}</b></div>`;

function panelQuoteHTML(c) {
  const q = c.quote; let html = '';
  if (q) {
    const t = q.total || {}, prev = q.previousClose ?? q.referencePrice;
    const yi = v => numOk(v) ? (v >= 1e8 ? (v / 1e8).toFixed(2) + ' 億' : Math.round(v / 1e4).toLocaleString() + ' 萬') : '—';
    const askV = t.tradeVolumeAtAsk, bidV = t.tradeVolumeAtBid;
    html += `<div class="cp-title">今日行情${q.date ? `（${escapeHTML(String(q.date))}）` : ''}</div><div class="cp-grid">` +
      cpRow('昨收', numOk(prev) ? fmtP(prev) : '—') +
      cpRow('開盤', numOk(q.openPrice) ? fmtP(q.openPrice) : '—', upDnStyle(q.openPrice, prev)) +
      cpRow('最高', numOk(q.highPrice) ? fmtP(q.highPrice) : '—', upDnStyle(q.highPrice, prev)) +
      cpRow('最低', numOk(q.lowPrice) ? fmtP(q.lowPrice) : '—', upDnStyle(q.lowPrice, prev)) +
      (c.isIndex ? '' : cpRow('均價', numOk(q.avgPrice) ? fmtP(q.avgPrice) : '—', upDnStyle(q.avgPrice, prev))) +
      cpRow('振幅', numOk(q.amplitude) ? q.amplitude.toFixed(2) + '%' : '—') +
      (c.isIndex ? '' : cpRow('成交量', numOk(t.tradeVolume) ? Math.round(t.tradeVolume).toLocaleString() + ' 張' : '—')) +
      cpRow('成交金額', yi(t.tradeValue)) +
      (c.isIndex ? '' : cpRow('成交筆數', numOk(t.transaction) ? t.transaction.toLocaleString() : '—')) +
      (c.isIndex ? '' : cpRow('內盤/外盤', numOk(bidV) && numOk(askV) && bidV + askV > 0 ? `${(bidV / (bidV + askV) * 100).toFixed(0)}% / ${(askV / (bidV + askV) * 100).toFixed(0)}%` : '—')) + `</div>`;
    const bids = (q.bids || []).slice(0, 5), asks = (q.asks || []).slice(0, 5);
    if (bids.length || asks.length) {
      let book = '';
      for (let i = 0; i < Math.max(bids.length, asks.length); i++) {
        const b = bids[i], a = asks[i];
        book += `<div><span ${upDnStyle(b && b.price, prev)}>${b ? fmtP(b.price) : '—'}</span><span>${b ? b.size : ''}</span></div>` +
                `<div><span ${upDnStyle(a && a.price, prev)}>${a ? fmtP(a.price) : '—'}</span><span>${a ? a.size : ''}</span></div>`;
      }
      html += `<div class="cp-title">五檔報價（買 ／ 賣，單位：張）</div><div class="cp-book">${book}</div>`;
    }
  }
  if (c.year) {
    const last = c.data.length ? c.data[c.data.length - 1].c : null;
    html += `<div class="cp-title">近一年區間</div><div class="cp-grid">` +
      cpRow('最高', fmtP(c.year.hi), `style="color:${CHART_UP}"`) + cpRow('最低', fmtP(c.year.lo), `style="color:${CHART_DN}"`) +
      (last != null ? cpRow('距高點', ((last / c.year.hi - 1) * 100).toFixed(2) + '%') + cpRow('距低點', '+' + ((last / c.year.lo - 1) * 100).toFixed(2) + '%') : '') + `</div>`;
  }
  if (c.diag) html += `<div class="cp-small">K 線資料來源：${escapeHTML(c.diag)}</div>`;
  return html || '<div class="cp-note">暫無資料</div>';
}

const failState = e => e.message === 'nokey' ? 'nokey' : /^http40[13]$/.test(e.message) ? 'plan' : 'err';
const failNote = st => ({ loading: '載入中…', nokey: '尚未設定 Fugle Key，請到「進階」輸入 Key。', plan: '目前的 Fugle 方案沒有這項資料的權限。', empty: '目前沒有資料（非交易時段，或今天尚未成交）。', err: '資料取得失敗，請稍後再試。' }[st] || '');
const timeOf = t => { if (!numOk(t)) return '—'; const ms = t > 1e14 ? t / 1000 : t > 1e11 ? t : t * 1000; return new Date(ms + 8 * 3600e3).toISOString().slice(11, 19); };

async function loadVolTab(c, silent) {
  if (c.volBusy) return; c.volBusy = true;
  if (!silent && !c.vol) { c.vol = { state: 'loading' }; renderChartPanel(); }
  try {
    const j = await fugleGet(`intraday/volumes/${encodeURIComponent(c.sym)}`);
    const rows = (j.data || []).filter(x => numOk(x.price) && numOk(x.volume));
    c.vol = rows.length ? { state: 'ok', rows } : { state: 'empty' };
  } catch (e) { if (!(c.vol && c.vol.state === 'ok')) c.vol = { state: failState(e) }; }
  c.volBusy = false;
  if (chartCur === c && c.ptab === 'vol') renderChartPanel();
}
async function loadTradesTab(c, silent) {
  if (c.trBusy) return; c.trBusy = true;
  if (!silent && !c.trades) { c.trades = { state: 'loading' }; renderChartPanel(); }
  try {
    const j = await fugleGet(`intraday/trades/${encodeURIComponent(c.sym)}?limit=60`);
    const rows = (j.data || []).filter(x => numOk(x.price)).map(x => ({ p: x.price, s: x.size ?? x.volume ?? 0, bid: x.bid, ask: x.ask, t: x.time }))
      .sort((a, b) => (numOk(b.t) ? b.t : 0) - (numOk(a.t) ? a.t : 0)).slice(0, 60);
    c.trades = rows.length ? { state: 'ok', rows } : { state: 'empty' };
  } catch (e) { if (!(c.trades && c.trades.state === 'ok')) c.trades = { state: failState(e) }; }
  c.trBusy = false;
  if (chartCur === c && c.ptab === 'trades') renderChartPanel();
}
function panelVolHTML(c) {
  const v = c.vol; if (!v || v.state !== 'ok') return `<div class="cp-note">${failNote(v ? v.state : 'loading')}</div>`;
  let rows = v.rows.slice();
  if (rows.length > 80) rows = rows.sort((a, b) => b.volume - a.volume).slice(0, 80);
  rows.sort((a, b) => b.price - a.price);
  const vmax = Math.max(...rows.map(r => r.volume)) || 1, total = v.rows.reduce((a, r) => a + r.volume, 0);
  const top = v.rows.reduce((m, r) => r.volume > m.volume ? r : m, v.rows[0]);
  const prev = c.quote ? (c.quote.previousClose ?? c.quote.referencePrice) : null;
  const last = c.quote && numOk(c.quote.lastPrice) ? c.quote.lastPrice : (c.data.length ? c.data[c.data.length - 1].c : null);
  const askT = v.rows.reduce((a, r) => a + (r.volumeAtAsk || 0), 0), bidT = v.rows.reduce((a, r) => a + (r.volumeAtBid || 0), 0);
  const body = rows.map(r => {
    const b = (r.volumeAtBid || 0) / vmax * 100, a = (r.volumeAtAsk || 0) / vmax * 100, o = Math.max(0, r.volume / vmax * 100 - a - b);
    return `<div class="cp-vol${last != null && Math.abs(r.price - last) < 1e-6 ? ' now' : ''}"><span ${upDnStyle(r.price, prev)}><b>${fmtP(r.price)}</b></span>` +
      `<span class="bar"><i style="width:${b.toFixed(1)}%;background:${CHART_DN}"></i><i style="width:${a.toFixed(1)}%;background:${CHART_UP}"></i><i style="width:${o.toFixed(1)}%;background:var(--t-muted);opacity:.5"></i></span>` +
      `<b>${Math.round(r.volume).toLocaleString()}</b></div>`;
  }).join('');
  return `<div class="cp-title">分價量表（今日）</div><div class="cp-grid" style="margin-bottom:6px">` +
    cpRow('量最大價位', `${fmtP(top.price)}（${Math.round(top.volume).toLocaleString()}）`) + cpRow('總量', Math.round(total).toLocaleString() + ' 張') +
    (askT + bidT > 0 ? cpRow('外盤', (askT / (askT + bidT) * 100).toFixed(0) + '%', `style="color:${CHART_UP}"`) + cpRow('內盤', (bidT / (askT + bidT) * 100).toFixed(0) + '%', `style="color:${CHART_DN}"`) : '') + `</div>` +
    body + `<div class="cp-small">長條：<span style="color:${CHART_UP}">紅＝外盤</span>、<span style="color:${CHART_DN}">綠＝內盤</span>、灰＝未分類；亮底為目前成交價。</div>`;
}
function panelTradesHTML(c) {
  const v = c.trades; if (!v || v.state !== 'ok') return `<div class="cp-note">${failNote(v ? v.state : 'loading')}</div>`;
  const prev = c.quote ? (c.quote.previousClose ?? c.quote.referencePrice) : null;
  const body = v.rows.map(r => {
    const tag = numOk(r.ask) && r.p >= r.ask ? `<span style="color:${CHART_UP}">外</span>` : numOk(r.bid) && r.p <= r.bid ? `<span style="color:${CHART_DN}">內</span>` : '<span></span>';
    return `<div class="cp-tr"><span>${timeOf(r.t)}</span><span ${upDnStyle(r.p, prev)}><b>${fmtP(r.p)}</b></span><span>${Math.round(r.s).toLocaleString()}</span>${tag}</div>`;
  }).join('');
  return `<div class="cp-title">最近成交明細（最新 ${v.rows.length} 筆）</div><div class="cp-tr hd"><span>時間</span><span>成交價</span><span>單量</span><span></span></div>${body}` +
    `<div class="cp-small">外＝成交價在賣價以上（主動買），內＝成交價在買價以下（主動賣）。</div>`;
}
const isEtfSym = sym => /^00\d/.test(sym);
async function loadDivTab(c) {
  if (c.div) return;
  c.div = { state: 'loading' }; renderChartPanel();
  const [y, m] = await Promise.allSettled([
    workerGet(`/div?symbol=${encodeURIComponent(c.sym)}`),
    isEtfSym(c.sym) ? workerGet(`/divinfo?symbol=${encodeURIComponent(c.sym)}`) : Promise.reject(new Error('skip'))
  ]);
  const list = y.status === 'fulfilled' && Array.isArray(y.value.dividends) ? y.value.dividends : null;
  const info = m.status === 'fulfilled' && Array.isArray(m.value.dividends) ? m.value.dividends : null;
  const noworker = y.status === 'fulfilled' && !Array.isArray(y.value.dividends);
  const hasAny = (list && list.length) || (info && info.length);
  c.div = { state: hasAny ? 'ok' : noworker ? 'noworker' : (y.status === 'rejected' && y.reason.message !== 'http404') ? 'err' : 'empty', list: list || [], info };
  if (chartCur === c) renderChartPanel();
}
async function loadHoldTab(c) {
  if (c.hold) return;
  c.hold = { state: 'loading' }; renderChartPanel();
  try {
    const j = await workerGet(`/holdings?symbol=${encodeURIComponent(c.sym)}`);
    c.hold = Array.isArray(j.holdings) && j.holdings.length ? { state: 'ok', date: j.date, src: j.source, list: j.holdings } : { state: Array.isArray(j.holdings) ? 'empty' : 'noworker' };
  } catch (e) { c.hold = { state: e.message === 'http404' ? 'empty' : 'err' }; }
  if (chartCur === c) renderChartPanel();
}
const workerNote = st => ({ noworker: '需要先更新 Cloudflare Worker 才能取得這項資料。', empty: '查無資料（可能尚未配息，或來源網站沒有這檔）。' }[st] || failNote(st));
const fmtD = v => (+Number(v).toFixed(4)).toString(); // 配息金額保留到小數 4 位（例如 0.866）
function panelDivHTML(c) {
  const v = c.div; if (!v || v.state !== 'ok') return `<div class="cp-note">${workerNote(v ? v.state : 'loading')}</div>`;
  const today = twToday(), dayN = d => Math.round((Date.parse(d + 'T00:00:00+08:00') - Date.parse(today + 'T00:00:00+08:00')) / 864e5);
  const shares = c.stock ? calcStockInfo(c.stock).shares : 0;
  const info = (v.info || []).filter(x => x.ex);
  let html = '';
  const upcoming = info.filter(x => x.ex >= today || (x.pay && x.pay >= today)).sort((a, b) => a.ex < b.ex ? -1 : 1);
  if (upcoming.length) {
    html += `<div class="cp-title">即將除息／發放（投信已公告）</div>` + upcoming.map(x => {
      const dEx = dayN(x.ex), tag = dEx > 0 ? `還有 ${dEx} 天除息` : dEx === 0 ? '今天除息' : '已除息，待發放';
      const est = numOk(x.amount) && shares > 0 ? `　預計入帳約 ${Math.round(shares * x.amount).toLocaleString()} 元` : '';
      return `<div class="cp-up"><div><b>除息日 ${escapeHTML(x.ex)}</b><span>${tag}</span></div>` +
        `<div>發放日 ${x.pay ? escapeHTML(x.pay) : '尚未公布'}　每單位 ${numOk(x.amount) ? fmtD(x.amount) + ' 元' : '—'}${est}</div></div>`;
    }).join('') + `<div class="cp-small">第一階段公告的金額可能是預估值，以投信第二階段公告為準。</div>`;
  } else if (isEtfSym(c.sym)) {
    html += `<div class="cp-small" style="margin-top:10px">${v.info ? '目前沒有已公告、尚未發放的配息。' : '未取得投信公告的除息／發放日（來源網站沒有這檔，或 Worker 尚未更新）。'}</div>`;
  }
  const past = info.length ? info.filter(x => x.ex <= today && numOk(x.amount)).map(x => ({ date: x.ex, amount: x.amount, pay: x.pay })) : v.list;
  if (past.length) {
    const yearAgo = new Date(Date.now() + 8 * 3600e3 - 365 * 864e5).toISOString().slice(0, 10);
    const yr = past.filter(x => x.date >= yearAgo), sum = yr.reduce((a, x) => a + x.amount, 0);
    const price = c.quote && numOk(c.quote.lastPrice) ? c.quote.lastPrice : (c.stock && numOk(c.stock.price) ? c.stock.price : null);
    html += `<div class="cp-title">近一年配息</div><div class="cp-grid">` +
      cpRow('合計', fmtD(sum) + ' 元') + cpRow('次數', yr.length + ' 次') +
      cpRow('現價殖利率', price && sum ? (sum / price * 100).toFixed(2) + '%' : '—') + cpRow('最近除息', escapeHTML(past[0].date)) + `</div>`;
    if (shares > 0 && sum > 0) html += `<div class="cp-small">以目前持有 ${shares.toLocaleString()} 股估算，近一年配息約 ${Math.round(shares * sum).toLocaleString()} 元（過去配息不代表未來）。</div>`;
    html += `<div class="cp-title">歷史配息（每單位）</div><div class="cp-list">` +
      past.slice(0, 16).map(x => `<div><span>${escapeHTML(x.date)}${x.pay ? `　發放 ${escapeHTML(x.pay.slice(5))}` : ''}</span><b>${fmtD(x.amount)} 元</b></div>`).join('') + `</div>`;
  }
  return html || '<div class="cp-note">查無資料。</div>';
}
function panelHoldHTML(c) {
  const v = c.hold; if (!v || v.state !== 'ok') return `<div class="cp-note">${workerNote(v ? v.state : 'loading')}</div>`;
  const top = v.list.slice(0, 10), max = Math.max(...top.map(x => Math.abs(x.weight))) || 1, sum = top.reduce((a, x) => a + x.weight, 0);
  const rows = top.map((x, i) => `<div class="cp-hold"><span class="rk">${i + 1}</span><span class="nm">${escapeHTML(x.name || x.symbol)}${x.symbol ? `<small>${escapeHTML(x.symbol.replace(/\.(TW|TWO)$/i, ''))}</small>` : ''}</span>` +
    `<span class="bar"><i style="width:${(Math.abs(x.weight) / max * 100).toFixed(0)}%"></i></span><b>${x.weight.toFixed(2)}%</b></div>`).join('');
  return `<div class="cp-title">前十大持股${v.date ? `（資料日 ${escapeHTML(String(v.date))}）` : ''}</div>` +
    `<div class="cp-grid" style="margin-bottom:6px">${cpRow('前十大合計', sum.toFixed(2) + '%')}${cpRow('揭露檔數', v.list.length + (v.list.length >= 30 ? '+' : '') + ' 檔')}</div>${rows}` +
    `<div class="cp-small">資料來源：${escapeHTML(v.src || '')}，僅供參考；持股可能和最新揭露有時間差。</div>`;
}
function renderChartPanel() {
  const c = chartCur, el = $('chartPanel'), tabs = $('chartPtabs');
  if (!c || c.engine !== 'fugle') { el.innerHTML = ''; tabs.innerHTML = ''; return; }
  if (c.src === 'fut') { tabs.innerHTML = ''; el.innerHTML = panelFutHTML(c); return; }
  if (c.isIndex) { c.ptab = 'quote'; tabs.innerHTML = ''; el.innerHTML = panelQuoteHTML(c); return; }
  tabs.innerHTML = [['quote', '行情'], ['vol', '分價量'], ['trades', '成交明細'], ['div', '配息'], ...(isEtfSym(c.sym) ? [['hold', '成分股']] : [])]
    .map(([k, n]) => `<button type="button" class="${k === c.ptab ? 'on' : ''}" data-ptab="${k}">${n}</button>`).join('');
  const top = el.scrollTop;
  el.innerHTML = c.ptab === 'vol' ? panelVolHTML(c) : c.ptab === 'trades' ? panelTradesHTML(c) : c.ptab === 'div' ? panelDivHTML(c) : c.ptab === 'hold' ? panelHoldHTML(c) : panelQuoteHTML(c);
  el.scrollTop = top;
}

function bindChartCanvas(cv) {
  const ptrs = new Map(); let st = null;
  cv.addEventListener('pointerdown', e => {
    const c = chartCur; if (!c || !c.data.length) return;
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e.clientX);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; st = { pinch: true, d0: Math.abs(a - b) || 1, vis0: c.L ? c.L.vis : c.vis }; }
    else if (ptrs.size === 1) st = { x0: e.clientX, off0: c.off, moved: false };
  });
  cv.addEventListener('pointermove', e => {
    const c = chartCur; if (!c || !st || !ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, e.clientX);
    if (c.tf === 'T') { // 即時走勢：按住拖曳＝十字游標，不縮放、不平移
      if (!st.pinch) { if (Math.abs(e.clientX - st.x0) > 6) st.moved = true; if (st.moved) liveSelect(c, e, cv, false); }
      return;
    }
    if (st.pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.abs(a - b) || 1;
      c.vis = Math.max(15, Math.min(240, Math.round(st.vis0 * st.d0 / d))); c.sel = null;
      drawChart(); chartInfoUpdate();
    } else if (!st.pinch) {
      const dx = e.clientX - st.x0; if (Math.abs(dx) > 6) st.moved = true;
      if (st.moved && c.L) { c.off = Math.max(0, Math.min(Math.max(0, c.data.length - 10), st.off0 + Math.round(dx / c.L.step))); c.sel = null; drawChart(); chartInfoUpdate(); }
    }
  });
  const up = e => {
    const c = chartCur; const wasTap = st && !st.pinch && !st.moved && ptrs.size === 1;
    ptrs.delete(e.pointerId);
    if (wasTap && c && c.tf === 'T') liveSelect(c, e, cv, true);
    else if (wasTap && c && c.L) {
      const r = cv.getBoundingClientRect(), L = c.L;
      let k = Math.round((e.clientX - r.left - (L.plotW - L.n * L.step)) / L.step - 0.5);
      k = Math.max(0, Math.min(L.n - 1, k)); const idx = L.start + k;
      c.sel = c.sel === idx ? null : idx; drawChart(); chartInfoUpdate();
    }
    if (ptrs.size === 0) st = null;
    else if (ptrs.size === 1 && st && st.pinch) st = { x0: [...ptrs.values()][0], off0: chartCur ? chartCur.off : 0, moved: true };
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}
window.addEventListener('resize', () => { if (chartCur && chartCur.engine === 'fugle') drawChart(); });

/* ---------- TradingView（僅用於非台股代號，例如美股） ---------- */
async function resolveTvSymbol(sym) {
  if (!/^\d/.test(sym)) return sym;
  let sfx = suffixCache.get(sym);
  if (!sfx) { try { await fetchYahoo(sym); } catch (_) {} sfx = suffixCache.get(sym); }
  return (sfx === '.TWO' ? 'TPEX:' : 'TWSE:') + sym;
}
async function loadTvChart(c) {
  const seq = ++chartOpenSeq, body = $('chartBody');
  clearTimeout(c.timer); body.innerHTML = ''; chartMsg('圖表載入中…');
  const tvSym = await resolveTvSymbol(c.sym);
  if (seq !== chartOpenSeq || chartCur !== c) return;
  const dark = isDarkUi();
  const box = document.createElement('div');
  box.className = 'tradingview-widget-container';
  box.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
  const sc = document.createElement('script');
  sc.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
  sc.async = true;
  sc.onerror = () => { if (seq === chartOpenSeq) chartMsg('圖表載入失敗，請檢查網路後再試'); };
  sc.text = JSON.stringify({
    autosize: true, symbol: tvSym, interval: 'D', timezone: 'Asia/Taipei', locale: 'zh_TW',
    theme: dark ? 'dark' : 'light', style: '1', allow_symbol_change: false, hide_side_toolbar: true,
    withdateranges: true, save_image: false, calendar: false, support_host: 'https://www.tradingview.com',
    backgroundColor: dark ? '#1E2330' : '#FFFFFF',
    overrides: { 'mainSeriesProperties.candleStyle.upColor': CHART_UP, 'mainSeriesProperties.candleStyle.downColor': CHART_DN,
      'mainSeriesProperties.candleStyle.borderUpColor': CHART_UP, 'mainSeriesProperties.candleStyle.borderDownColor': CHART_DN,
      'mainSeriesProperties.candleStyle.wickUpColor': CHART_UP, 'mainSeriesProperties.candleStyle.wickDownColor': CHART_DN }
  });
  box.appendChild(sc); body.appendChild(box);
  let tries = 0;
  const iv = setInterval(() => {
    if (seq !== chartOpenSeq) return clearInterval(iv);
    if (++tries > 48 && !body.querySelector('iframe')) { clearInterval(iv); chartMsg('圖表載入逾時，請檢查網路後再試'); return; }
    if (body.querySelector('iframe')) { chartMsg(''); clearInterval(iv); }
  }, 250);
}

/* ---------- 彈窗控制 ---------- */
function renderChartTools() {
  const c = chartCur;
  $('chartIndBtn').style.display = c.tf === 'T' ? 'none' : ''; // 即時走勢沒有副圖
  $('chartTfs').innerHTML = c.engine === 'fugle'
    ? (c.src ? [['T', '即時']] : []).concat(CHART_TFS.filter(([k]) => !c.src || (k !== '5' && (c.src !== 'fut' || k === 'D')))).map(([k, n]) => `<button type="button" class="${k === c.tf ? 'on' : ''}" data-tf="${k}">${n}</button>`).join('') : '';
}
function startChart(c) {
  const body = $('chartBody'); clearTimeout(c.timer); chartCur = c; ++chartOpenSeq;
  body.innerHTML = ''; $('chartInfo').innerHTML = ''; $('chartPanel').innerHTML = ''; $('chartPtabs').innerHTML = '';
  const mdl = $('chartModalOverlay').querySelector('.chart-modal'); mdl.classList.toggle('tv', c.engine === 'tv'); mdl.classList.toggle('ind', chartInd !== 'vol');
  $('chartIndBtn').textContent = IND_LABEL[chartInd];
  renderChartTools();
  if (c.engine === 'fugle') {
    const cv = document.createElement('canvas'); cv.id = 'chartCanvas'; body.appendChild(cv); bindChartCanvas(cv);
    renderChartPanel(); loadFugleChart(c);
  } else loadTvChart(c);
}
function openChartModal(s) {
  $('chartTitle').innerHTML = `${escapeHTML(s.symbol)}${s.name ? `<small>${escapeHTML(s.name)}</small>` : ''}`;
  $('chartModalOverlay').classList.add('show');
  if (!(history.state && history.state.chart)) history.pushState({ chart: 1 }, '');
  startChart({ sym: s.symbol, stock: s, engine: (s.isIndex || /^\d/.test(s.symbol)) ? 'fugle' : 'tv', isIndex: !!s.isIndex, tf: chartTf, data: [], ma: [[], [], []], vis: 60, off: 0, sel: null, timer: 0, quote: null, year: null, ptab: 'quote', vol: null, trades: null, div: null, hold: null, ind: null });
}
function teardownChart() {
  chartOpenSeq++;
  if (chartCur) clearTimeout(chartCur.timer);
  chartCur = null;
  $('chartModalOverlay').classList.remove('show');
  $('chartBody').innerHTML = ''; $('chartInfo').innerHTML = ''; $('chartPanel').innerHTML = ''; $('chartPtabs').innerHTML = ''; // 移除圖表，不在背景繼續佔資源
}
function closeChartModal() {
  if (history.state && history.state.chart) history.back(); else teardownChart();
}
window.addEventListener('popstate', () => { if ($('chartModalOverlay').classList.contains('show')) teardownChart(); });
$('chartModalOverlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeChartModal(); });
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.matches('[data-twii]')) { e.preventDefault(); openTwiiChart(); } });
$('chartTfs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tf]'); if (!b || !chartCur || chartCur.engine !== 'fugle') return;
  chartCur.tf = b.dataset.tf; if (b.dataset.tf !== 'T') chartTf = b.dataset.tf; // 「即時」只屬於指數／期貨，不影響個股預設週期
  renderChartTools(); loadFugleChart(chartCur);
});
$('chartPtabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-ptab]'); if (!b || !chartCur || chartCur.engine !== 'fugle') return;
  const c = chartCur; c.ptab = b.dataset.ptab; renderChartPanel(); $('chartPanel').scrollTop = 0;
  if (c.ptab === 'vol') loadVolTab(c); else if (c.ptab === 'trades') loadTradesTab(c); else if (c.ptab === 'div') loadDivTab(c); else if (c.ptab === 'hold') loadHoldTab(c);
});
function openTwiiChart() { openChartModal({ symbol: 'IX0001', name: '臺灣加權指數', isIndex: true }); }
document.addEventListener('click', e => {
  if (e.target instanceof Element && e.target.closest('[data-twii]')) { openTwiiChart(); return; }
  if (e.target instanceof Element && e.target.closest('.fut-card')) { openAltChart({ symbol: 'WTX&', name: '🇹🇼 臺灣指數期貨', src: 'fut' }); return; }
  const ic = e.target instanceof Element && e.target.closest('.idx-card-box.draggable-card');
  if (ic && ic.dataset.symbol && !draggedIdxSymbol) { const m = availableIndices.find(x => x.symbol === ic.dataset.symbol); openAltChart({ symbol: ic.dataset.symbol, name: m ? m.name : ic.dataset.symbol, src: 'yahoo' }); return; }
  const h = e.target.closest('.srow .sym-container');
  if (!h) return;
  if (Date.now() - lastRowDragAt < 500) return; // 長按拖曳排序後放開，不要誤開圖表
  const row = h.closest('.srow');
  const st = (tabStocks[currentTab] || []).find(x => String(x.id) === row.dataset.id);
  if (st) openChartModal(st);
});

/* ========================================================= 🚀 啟動與休眠優化 ========================================================= */
loadFinanceNews(); // 腳本位於頁面底部，DOM 已就緒，不必等 DOMContentLoaded
loadState(); renderAll();
setTimeout(wake, 500);
setTimeout(cleanupOldKeys, 3000);
heartbeatWorker.postMessage({action: 'start', interval: currentInterval});

['focus', 'pageshow'].forEach(e => window.addEventListener(e, wake));

document.addEventListener('visibilitychange', () => { 
  const isVis = document.visibilityState === 'visible';
  heartbeatWorker.postMessage({ action: isVis ? 'start' : 'stop', interval: currentInterval });
  if (isVis) wake();
});


const kd = (id, next, action) => { $(id).addEventListener('keydown', e => { if(e.key === 'Enter') { e.preventDefault(); if(next) $(next).focus(); else if(action) action(); } }); };
kd('symInput', 'qtyInput'); kd('qtyInput', 'buyPriceInput'); kd('buyPriceInput', null, addStock);

['addModalOverlay', 'modalOverlay', 'manualOverlay', 'editModalOverlay', 'foreignIdxOverlay', 'historyModalOverlay'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('click', function(e) { 
    if(e.target === this) {
      if (id === 'foreignIdxOverlay') closeForeignIdxModal();
      else this.classList.remove('show'); 
    }
  });
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=' + APP_VER).catch(()=>{}));
// ==================== PWA 安裝提示 ====================
(function () {
  const banner = document.getElementById('installBanner');
  if (!banner) return;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isStandalone) return; // 已安裝/以 App 開啟，不顯示
  let deferredPrompt = null;
  const hide = () => { banner.style.display = 'none'; };
  const show = () => { banner.style.display = 'flex'; };
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    show();
  });
  document.getElementById('installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    hide();
  });
  document.getElementById('installClose').addEventListener('click', hide);
  window.addEventListener('appinstalled', hide);
  // iOS Safari 沒有安裝事件，顯示手動說明
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !/Line\//i.test(navigator.userAgent)) {
    document.getElementById('installText').textContent = '點下方「分享」→「加入主畫面」即可安裝';
    document.getElementById('installBtn').style.display = 'none';
    show();
  }
})();

console.log(`股票庫存管理 ${APP_VER} 已啟動`);
