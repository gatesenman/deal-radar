'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, shell, dialog, nativeImage, nativeTheme, net, session, clipboard, powerMonitor, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./core/store');
const { runAll, fetchSource, mergeDeals, toCSV, UA, channelSources, channelSource, backoffUntil, hashId } = require('./core/monitor');
const { KNOWN_UNAVAILABLE, CHANNEL_SUBS, BRAND_GROUPS } = require('./core/defaults');
const { makeFetchText, HttpCache } = require('./core/http');
const { PROTOCOLS, STATEFUL } = require('./core/collectors');
const { applyRules } = require('./core/rules');
const { toOPML, parseOPML } = require('./core/opml');
const { PROVIDERS, makeLLM, redact, normalizeBase } = require('./core/ai');
const { discoverVendor, discoverChannel } = require('./core/discover');
const { normalizeChannel } = require('./core/store');
let renderHTML = null; try { ({ renderHTML } = require('./render')); } catch { /* 无渲染模块 */ }
const { OFFER_LABELS } = require('./core/offers');
const { extractFacts } = require('./core/facts');
const V26 = require('./core/v26');
const V27 = require('./core/v27');
const V28 = require('./core/v28');
const V210 = require('./core/v210');
const V212 = require('./core/v212');
const V213 = require('./core/v213');
const V214 = require('./core/v214');
const I18N = require('./renderer/i18n');
const L = I18N.t; const tx = I18N.tx;
const { fetchLogo, dataUrl, NOT_VENDOR } = require('./core/logo');
const { BRAND_META } = require('./core/brandmeta');
// —— 厂商 logo：预置厂商打包在 assets/logos；用户添加的抓取后缓存在 userData/logos ——
const BUNDLED_LOGOS = new Set((() => { try { return fs.readdirSync(path.join(__dirname, '..', 'assets', 'logos')).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)); } catch { return []; } })());
let logoCache = null;
function logoDir() { return path.join(app.getPath('userData'), 'logos'); }
function logosMap() {
  const key = store.config.brands.map((b) => b.id + ':' + (b.logo || '')).join('|');
  if (logoCache && logoCache.key === key) return logoCache.m;
  const m = {};
  for (const b of store.config.brands) {
    if (b.logo) { const u = dataUrl(logoDir(), b.logo); if (u) { m[b.id] = u; continue; } }
    if (BUNDLED_LOGOS.has(b.id)) m[b.id] = `../../assets/logos/${b.id}.png`;
  }
  logoCache = { key, m }; return m;
}
const logoJobs = new Set();
async function ensureLogo(brand, domain) {
  if (!brand || !domain || logoJobs.has(brand.id) || (brand.preset && BUNDLED_LOGOS.has(brand.id))) return null;
  logoJobs.add(brand.id);
  try {
    const r = await fetchLogo(domain, logoDir(), brand.id);
    if (r) { brand.logo = r.file; brand.domain = String(domain).replace(/^https?:\/\//, '').split('/')[0]; store.saveConfig(); logoCache = null; send('state', publicState()); }
    return r;
  } catch { return null; } finally { logoJobs.delete(brand.id); }
}
const { digestOf, inQuiet, enrichPrompt, parseEnrich, needsEnrich } = require('./core/digest');

const APP_NAME = '全网优惠雷达'; // i18n-ok 固定：决定 userData 目录与快捷方式名，不随界面语言变化
const appName = () => L(APP_NAME);
// —— 界面语言：settings.lang = 'auto' | 'zh-CN' | 'en'；auto 时按系统语言（中文 → zh-CN，其余 → en）；环境变量 DEAL_RADAR_LANG 可覆盖（测试用） ——
function effectiveLang() { const pref = (store && store.config.settings.lang) || 'auto'; return I18N.resolve(pref !== 'auto' ? pref : (process.env.DEAL_RADAR_LANG || 'auto'), app.getLocale ? app.getLocale() : 'zh-CN'); }
function loadDict(lang) { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${lang}.json`), 'utf8')); } catch { return {}; } }
function applyLang() { const l = effectiveLang(); I18N.set(l, l === 'zh-CN' ? {} : loadDict(l)); return l; }
app.setName(APP_NAME);
if (process.env.DEAL_RADAR_DATA) app.setPath('userData', process.env.DEAL_RADAR_DATA);
if (process.platform === 'win32') app.setAppUserModelId('com.gaosichun.dealradar');

const SHOT_DIR = process.env.DEAL_RADAR_SHOT || '';
if (SHOT_DIR) { app.commandLine.appendSwitch('disable-gpu'); app.commandLine.appendSwitch('no-sandbox'); }

if (!app.requestSingleInstanceLock()) { console.log('[instance] another instance is running, focusing it'); app.quit(); process.exit(0); }

// 主进程兜底：任何未捕获异常只写日志，不弹出 Electron 的崩溃对话框、不中断后台监控
process.on('uncaughtException', (e) => { try { log(L('内部错误（已忽略）：') + (e && e.stack || e), 'error'); } catch { console.error(e); } });
process.on('unhandledRejection', (e) => { try { log(L('内部错误（已忽略）：') + (e && e.message || e), 'error'); } catch { console.error(e); } });

// 便携版运行时 exe 被解压到临时目录，开机自启/快捷方式必须指向原始便携 exe
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE || '';

let win = null; let tray = null; let store = null;
let quitting = false; let polling = false; let paused = false;
let timer = null; let nextRunAt = 0; let lastRunAt = 0; let firstRunDone = false;
const logs = [];

function log(msg, level = 'info') {
  const e = { t: Date.now(), level, msg: String(msg).slice(0, 2000) };
  logs.push(e); if (logs.length > 500) logs.shift();
  send('log', e);
}
function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }

// 打包后 assets 被解包到 app.asar.unpacked，保证系统通知等外部组件能读取图标文件
function asset(name) {
  const p = path.join(__dirname, '..', 'assets', name);
  const unpacked = p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  return unpacked !== p && fs.existsSync(unpacked) ? unpacked : p;
}

// —— 网络：使用 Chromium 网络栈（跟随系统代理/自定义代理）；渠道关闭代理时走直连会话 ——
const httpCache = new HttpCache(500);
// v2.9：条件请求缓存落盘，重启后第一次检查也能拿到 304
const httpCacheFile = () => path.join(app.getPath('userData'), 'httpcache.json.gz');
let httpCacheDirty = false;
function loadHttpCache() { try { if (fs.existsSync(httpCacheFile())) { const n = httpCache.load(fs.readFileSync(httpCacheFile())); if (n) log(L('已载入 {0} 条网页缓存（重启后仍可用「未修改」快速检查）', n), 'info'); } } catch { /* 损坏则忽略 */ } }
function saveHttpCache() { if (!httpCacheDirty || !store || store.config.settings.httpCache === false) return; httpCacheDirty = false; try { const tmp = httpCacheFile() + '.tmp'; fs.writeFileSync(tmp, httpCache.serialize()); fs.renameSync(tmp, httpCacheFile()); } catch { /* 写失败不影响抓取 */ } }
let directSession = null;
function getDirect() {
  if (!directSession) { directSession = session.fromPartition('persist:direct'); directSession.setProxy({ mode: 'direct' }).catch(() => {}); }
  return directSession;
}
const fetchText = makeFetchText((url, init, o = {}) => {
  const useCache = store && store.config.settings.httpCache !== false;
  if (!useCache) { delete init.headers['If-None-Match']; delete init.headers['If-Modified-Since']; }
  return o.proxy === false ? getDirect().fetch(url, init) : net.fetch(url, init);
}, { cache: httpCache, friendly: (m) => friendlyNetError(m) });
function renderText(url, o = {}) {
  if (!renderHTML) return Promise.reject(new Error(L('当前环境不支持 JS 渲染')));
  if (store.config.settings.renderEnabled === false) return Promise.reject(new Error(("JS " + L('渲染已在设置中关闭'))));
  return renderHTML(url, o);
}
function chCtx() { return { rsshubBase: store.config.settings.rsshubBase || '' }; }

const NET_ERR = {
  ERR_PROXY_CONNECTION_FAILED: '代理连接失败，请检查代理设置', ERR_TUNNEL_CONNECTION_FAILED: '代理隧道连接失败', // i18n-ok
  ERR_NAME_NOT_RESOLVED: '域名解析失败（网络不通或被屏蔽）', ERR_INTERNET_DISCONNECTED: '网络已断开', // i18n-ok
  ERR_CONNECTION_TIMED_OUT: '连接超时（可能需要代理）', ERR_CONNECTION_REFUSED: '连接被拒绝', ERR_CONNECTION_RESET: '连接被重置（ECONNRESET，可能被屏蔽）', // i18n-ok
  ERR_CONNECTION_CLOSED: '连接被关闭', ERR_ADDRESS_UNREACHABLE: '地址不可达', ERR_CERT_AUTHORITY_INVALID: 'HTTPS 证书无效', ERR_SSL_PROTOCOL_ERROR: 'SSL 协议错误（可能被屏蔽）', // i18n-ok
  ERR_TIMED_OUT: '请求超时', ERR_NETWORK_CHANGED: '网络发生变化，请重试', // i18n-ok
};
function friendlyNetError(msg) {
  const m = String(msg).match(/ERR_[A-Z_]+/);
  return m ? (tx(NET_ERR[m[0]]) || (L('网络错误') + " ") + m[0]) : String(msg);
}

function applyAutoStart() {
  if (SHOT_DIR || !app.isPackaged || process.platform === 'linux') return;
  try {
    const opts = { openAtLogin: !!store.config.settings.autoStart, args: ['--hidden'] };
    if (PORTABLE_EXE) opts.path = PORTABLE_EXE;
    app.setLoginItemSettings(opts);
  } catch (e) { log(L('设置开机自启失败：') + e.message, 'warn'); }
}

async function applyProxy() {
  const s = store.config.settings;
  try {
    if (s.proxyMode === 'direct') await session.defaultSession.setProxy({ mode: 'direct' });
    else if (s.proxyMode === 'custom' && s.proxyUrl) await session.defaultSession.setProxy({ proxyRules: s.proxyUrl.trim(), proxyBypassRules: '<local>' });
    else await session.defaultSession.setProxy({ mode: 'system' });
  } catch (e) { log(L('代理设置失败：') + e.message, 'error'); }
  // 预热：等待代理解析（Windows 的 WPAD 自动检测可能让最初几个请求卡住）
  try {
    const t0 = Date.now();
    const r = await Promise.race([session.defaultSession.resolveProxy('https://slickdeals.net/'), new Promise((res) => setTimeout(() => res(L('超时')), 8000))]);
    log(`${L('网络代理：')}${s.proxyMode === 'custom' ? s.proxyUrl : s.proxyMode === 'direct' ? L('直连') : L('跟随系统')}${L('（解析结果 {0}，{1}ms）', r, Date.now() - t0)}`);
  } catch { /* 忽略 */ }
}

// 记录连续失败次数：界面只在「连续失败 ≥2 次」时提示代理问题，避免开机网络未就绪等偶发超时引起误报
function setStatus(id, st) {
  const prev = store.config.sourceStatus[id];
  st.failStreak = st.ok ? 0 : ((prev && !prev.ok && prev.failStreak) || 0) + 1;
  if (prev && prev.chg) st.chg = prev.chg; // v2.7：保留变化历史（自适应轮询）
  store.config.sourceStatus[id] = st;
  store.recordHealth(id, st);
}
function enabledBrands() { return store.config.brands.filter((b) => b.enabled && (b.category !== 'goods' || store.config.settings.goodsEnabled)); }
// 是否算「优惠」：实物商品一律算；AI/软件需识别出优惠类型（纯厂商资讯不弹通知）
function isOfferDeal(d) { return d.category !== 'ai' || (d.offerTypes || []).length > 0; }
function brandName(id) { const b = store.config.brands.find((x) => x.id === id); return b ? b.name : id; }

// 全部抓取单元：全局聚合源 + 各厂商自己的渠道（渠道随厂商启用）
function allSources() {
  const goodsOn = !!store.config.settings.goodsEnabled;
  const brands = store.config.brands.filter((b) => b.category !== 'goods' || goodsOn);
  return [...store.config.sources, ...channelSources(brands, chCtx())];
}
let lastPublic = null;
function publicState(opts = {}) {
  const light = !!(opts && opts.light);
  const live = {
    runtime: runtime(),
    cacheHits: httpCache.hits,
    cacheStats: V214.cacheStats(httpCache),
    sourceStatus: store.config.sourceStatus,
    health: store.health,
    logs,
    settings: publicSettings(),
    engine: engineState(),
    update: { current: app.getVersion(), latest: (store.config.settings.latestUpdate || null), checkedAt: store.config.settings.lastUpdateCheck || 0 },
    v214: { notes: V214.notes(), lastSeen: store.config.settings.lastSeenVersion || '' },
  };
  const reused = V214.refreshState(lastPublic, live, { light, hasNew: !!opts.hasNew });
  if (reused) { lastPublic = reused; return reused; }
  lastPublic = {
    brands: store.config.brands,
    logos: logosMap(),
    brandDesc: Object.fromEntries(Object.entries(BRAND_META).map(([k, v]) => [k, v.desc])),
    sources: store.config.sources,
    channelSources: channelSources(store.config.brands, chCtx()),
    health: store.health,
    protocols: PROTOCOLS,
    subs: CHANNEL_SUBS,
    cacheHits: httpCache.hits,
    pages: Object.fromEntries(Object.entries(store.pages).map(([k, v]) => [k, { at: v.at, changedAt: v.changedAt, lines: (v.lines || []).length, preview: (v.lines || []).slice(0, 40) }])),
    sourceStatus: store.config.sourceStatus,
    settings: live.settings,
    aiProviders: PROVIDERS,
    brandGroups: BRAND_GROUPS,
    home: digestOf(store.deals, { brandName: (id) => tx(brandName(id)), t: L, titleOf: noteTitle, locale: I18N.locale() }),
    deals: decorateDeals(store.deals),
    coverage: V26.coverage(store.config.brands.filter((b) => b.category !== 'goods' || store.config.settings.goodsEnabled), channelSources(store.config.brands, chCtx()), store.config.sourceStatus),
    vendorInfo: Object.fromEntries(store.config.brands.map((b) => [b.id, vendorInfo(b)])),
    lastRecheck,
    v28: { channels: (store.config.settings.channels || []).map(V28.mask), views: store.config.settings.views || [], types: V28.CHANNEL_TYPES, presets: Object.fromEntries(Object.entries(V28.PRESETS).map(([k, v]) => [k, { name: v.name, desc: v.desc }])) },
    unavailable: KNOWN_UNAVAILABLE,
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    ...live,
  };
  return lastPublic;
}
function systemDark() { try { return !!nativeTheme.shouldUseDarkColors; } catch { return true; } }
function runtime() { return { polling, paused, nextRunAt, lastRunAt, shot: !!SHOT_DIR, dark: systemDark() }; }

// —— AI 助手：API Key 用 Electron safeStorage（Windows DPAPI）加密后保存，渲染进程永远拿不到明文 ——
let sessionKey = ''; // safeStorage 不可用时只在本次运行内保存在内存中，不落盘
// —— v2.6：有效期 / 适用于我 / 领取指南（时间相关字段在推送状态时实时计算） ——
let lastRecheck = 0; let rechecking = false;
function vendorInfo(b) {
  const chs = b.channels || [];
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const meta = BRAND_META[b.id];
  const domains = [...new Set([meta && meta.domain, ...chs.filter((c) => ['pricing', 'blog', 'changelog', 'docs'].includes(c.sub) && /^https?:/.test(c.url || '')).map((c) => host(c.url))].filter(Boolean).filter((h) => !/google\.com$|reddit|github\.com$|youtube|apple\.com$/.test(h) || (meta && h.endsWith(meta.domain))))];
  const pricing = chs.filter((c) => c.sub === 'pricing' && /^https?:/.test(c.url || ''));
  const main = pricing.find((c) => c.id === 'pricing') || pricing.find((c) => !/student|educat|startup|jio/i.test(c.id + c.url)) || pricing[0];
  return { domains, pricingUrl: main ? main.url : (meta ? `https://${meta.domain}/` : ''), promoUrls: pricing.map((c) => c.url) };
}
// —— v2.7：价格表 / 汇率 / 来源可靠度 / 反馈学习 ——
let fxBusy = false;
async function refreshFx(force = false) {
  const fx = store.config.fx || {};
  if (!force && fx.at && Date.now() - fx.at < 12 * 3600000) return fx;
  if (fxBusy || SHOT_DIR) return fx; fxBusy = true;
  try {
    let rates = null; let src = '';
    try {
      const j = JSON.parse(await fetchText('https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD&quotes=CNY,EUR,GBP,HKD,JPY,SGD,INR,AUD,CAD', { timeout: 15000, cache: false }));
      const usd = (Array.isArray(j) ? j : []).find((r) => r.quote === 'CNY'); if (usd) { rates = { USD: usd.rate, CNY: 1 }; for (const r of j) if (r.quote !== 'CNY' && r.rate) rates[r.quote] = Math.round((usd.rate / r.rate) * 10000) / 10000; src = 'frankfurter.dev (ECB)'; }
    } catch { /* 备用源 */ }
    if (!rates) { const j = JSON.parse(await fetchText('https://open.er-api.com/v6/latest/USD', { timeout: 15000, cache: false })); rates = V27.parseFx(j); src = 'open.er-api.com'; }
    store.config.fx = { rates, at: Date.now(), src }; store.saveConfig();
  } catch (e) { log(L('汇率获取失败，使用内置估算汇率：') + e.message, 'warn'); } finally { fxBusy = false; }
  return store.config.fx || {};
}
const periodL = (p) => ({ month: L('/月'), year: L('/年'), 'seat-month': L('/人/月'), mtok: L('/百万 tokens') }[p] || '');
async function updatePrices(sources) {
  await refreshFx().catch(() => {});
  const items = []; const now = Date.now(); const pct = Number(store.config.settings.priceAlertPct) || 0;
  for (const src of sources) {
    if (src.sub !== 'pricing' || !store.pages[src.id] || !(store.pages[src.id].lines || []).length) continue;
    const pg = store.pages[src.id];
    const prev = store.prices[src.id]; if (prev && prev.pageAt === pg.at) continue; // 页面没重新抓就不重复解析
    const list = V27.extractPrices(pg.lines);
    if (!list.length) { if (prev) prev.pageAt = pg.at; continue; }
    const changes = V27.updatePriceBook(store.prices, src.id, { name: src.name, brandId: src.vendor || src.brandId, url: src.url }, list, now);
    store.prices[src.id].pageAt = pg.at;
    for (const c of changes) {
      const p = c.from ? Math.abs(c.to - c.from) / c.from * 100 : 100; if (p < pct) continue;
      const sym = c.currency === 'USD' ? '$' : c.currency === 'CNY' ? '¥' : c.currency + ' ';
      const down = c.to < c.from;
      const args = [src.name.split(' · ')[0], c.plan, sym + c.from, sym + c.to, periodL(c.period)];
      const title = down ? L('{0} {1} 降价：{2} → {3}{4}', ...args) : L('{0} {1} 涨价：{2} → {3}{4}', ...args);
      items.push({ id: hashId(src.url + '#price#' + c.plan + c.period + c.to), titleKey: title.toLowerCase(), title, heat: 0, category: src.category || 'ai', offerTypes: down ? ['pricing', 'discount'] : ['pricing'], link: src.url, summary: title, image: '', price: `${sym}${c.to}`, discount: down ? `-${Math.round(p)}%` : '', published: now, fetchedAt: now, brandIds: src.vendor ? [src.vendor] : [], sourceId: src.id, sourceName: src.name, platform: src.platform, region: src.region, origin: L('价格表'), read: false, fav: false, sub: 'pricing', status: 'new', priceChange: c });
    }
  }
  store.savePrices();
  for (const it of items) it.facts = extractFacts(it);
  return items;
}
function priceTable() {
  const fx = store.config.fx || {}; const rows = [];
  for (const [id, b] of Object.entries(store.prices)) for (const p of Object.values(b.plans || {})) {
    if (b.at && p.seen && p.seen < b.at) continue; // 最近一次解析已不存在的套餐（下架或之前误识别）不再展示
    const h = p.hist || []; const last = h[h.length - 1] || []; const prev = h.length > 1 ? h[h.length - 2] : null;
    rows.push({ sourceId: id, brandId: b.brandId, vendor: b.name, url: b.url, plan: p.plan, period: p.period, currency: p.currency, amount: last[1], was: p.was || null, cny: V27.toCNY(last[1], p.currency, fx), prev: prev ? prev[1] : null, changedAt: h.length > 1 ? last[0] : 0, seen: p.seen || last[2] || last[0], hist: h.slice(-30).map((x) => [x[0], x[1]]) });
  }
  return { rows, fx: { at: fx.at || 0, src: fx.src || '', usd: (fx.rates || {}).USD || V27.FX_FALLBACK.USD, estimated: !fx.at } };
}
let relCache = { at: 0, map: {} };
function reliabilityMap() {
  if (Date.now() - relCache.at < 20000) return relCache.map;
  const agg = {};
  for (const d of store.deals) { if (!d.sourceId) continue; const a = agg[d.sourceId] = agg[d.sourceId] || { pos: 0, neg: 0 }; if (d.fav || d.status === 'claimed' || store.learn.labels[d.id] === true) a.pos++; else if (d.status === 'ignored' || d.feedback === 'noise' || store.learn.labels[d.id] === false) a.neg++; }
  const map = {}; const ids = new Set([...Object.keys(agg), ...Object.keys(store.health)]);
  for (const id of ids) { const h = store.health[id] || []; const a = agg[id] || {}; map[id] = V27.sourceReliability({ pos: a.pos || 0, neg: a.neg || 0, runs: h.length, okRuns: h.filter((x) => x.ok).length, official: /^ch-/.test(id) }); }
  relCache = { at: Date.now(), map }; return map;
}
function engineState() {
  const s = store.config.settings; const base = Number(s.intervalMinutes) || 15; const max = Number(s.adaptiveMaxMin) || 360;
  const rel = reliabilityMap(); const names = {}; for (const x of allSources()) names[x.id] = x.name;
  const adaptive = Object.entries(store.config.sourceStatus).filter(([, st]) => Array.isArray(st.chg) && st.chg.length >= 3).map(([id, st]) => ({ id, name: names[id] || id, iv: V27.adaptiveInterval(st.chg, { base, max }), rate: V27.estimateRate(st.chg), n: st.chg.length, changes: st.chg.filter((x) => x[1]).length }));
  const m = store.learn; const labeled = Object.keys(m.labels || {}).length;
  const unc = V27.uncertain(store.deals.filter((d) => (d.offerTypes || []).length && d.learnP !== undefined), m, { limit: 6 }).map((d) => d.id);
  return { adaptiveOn: s.adaptivePolling !== false, base, max, adaptive, saved: adaptive.filter((a) => a.iv > base).length,
    reliability: Object.entries(rel).filter(([id]) => names[id]).map(([id, r]) => ({ id, name: names[id], ...r })).sort((a, b) => a.score - b.score),
    learn: { on: s.learnEnabled !== false, labeled, pos: m.np, neg: m.nn, ready: m.np + m.nn >= 12 && m.np > 0 && m.nn > 0, uncertain: unc }, prices: priceTable() };
}
function learnFrom(d, label) {
  if (!d || store.config.settings.learnEnabled === false) return;
  V27.learn(store.learn, d.id, d.title + ' ' + (d.summary || '').slice(0, 200), label); relCache.at = 0; store.saveLearn();
}

function decorateDeals(deals) {
  const now = Date.now(); const prof = store.config.settings.profile; const vi = {};
  const learnOn = store.config.settings.learnEnabled !== false; const rel = learnOn ? reliabilityMap() : {};
  for (const d of deals) {
    d.evidence = V212.evidenceOf(d);
    if (learnOn && (d.offerTypes || []).length) { d.learnP = V27.predict(store.learn, d.title + ' ' + (d.summary || '').slice(0, 200)); const r = rel[d.sourceId]; d.rel = r ? r.score : undefined; const lb = store.learn.labels[d.id]; if (lb !== undefined) d.lab = lb ? 1 : 0; else delete d.lab; } else { delete d.learnP; delete d.rel; delete d.lab; }
    if (!d.facts || !(d.offerTypes || []).length) { delete d.vstat; delete d.mine; delete d.guide; continue; }
    d.vstat = V26.validity(d, now);
    d.mine = V26.appliesToMe(d, prof);
    const b = (d.brandIds || [])[0]; const brand = b && store.config.brands.find((x) => x.id === b);
    d.guide = V26.claimGuide(d, brand ? (vi[b] = vi[b] || vendorInfo(brand)) : {});
  }
  return deals;
}
async function recheckLanding(force = false) {
  if (rechecking || SHOT_DIR && !force) return null;
  rechecking = true;
  try {
    const s = store.config.settings;
    const r = await V26.recheckDeals(store.deals, fetchText, { hours: force ? 0 : (Number(s.recheckHours) || 12), limit: force ? 40 : 15 });
    lastRecheck = Date.now();
    if (r.checked) { log(L('落地页复查：检查 {0} 条，{1} 条疑似已结束', r.checked, r.gone)); store.saveDealsSoon(); send('state', publicState()); }
    return r;
  } catch (e) { log(L('落地页复查失败：') + e.message, 'warn'); return null; } finally { rechecking = false; }
}
function publicSettings() {
  const { ai, ...rest } = store.config.settings;
  const a = ai || {};
  return { ...rest, ai: { provider: a.provider || '', baseUrl: a.baseUrl || '', model: a.model || '', hasKey: !!(a.keyEnc || sessionKey), keyHint: a.keyHint || '', encrypted: !!a.keyEnc, encAvailable: encAvailable() } };
}
function encAvailable() { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } }
function aiKey() {
  const a = store.config.settings.ai || {};
  if (a.keyEnc) { try { return safeStorage.decryptString(Buffer.from(a.keyEnc, 'base64')); } catch { log(("AI Key " + L('解密失败（可能换了电脑或系统账户），请重新填写')), 'warn'); return ''; } }
  return sessionKey;
}
const llmFetch = (u, init) => net.fetch(u, { ...init, bypassCustomProtocolHandlers: true });
function getLLM(override) {
  const a = { ...(store.config.settings.ai || {}), ...(override || {}) };
  if (!a.baseUrl || !a.model) return null;
  const key = override && override.apiKey !== undefined && override.apiKey !== '' ? override.apiKey : aiKey();
  return makeLLM({ baseUrl: a.baseUrl, apiKey: key, model: a.model, rawFetch: llmFetch, timeout: 60000 });
}
function saveAI({ provider, baseUrl, model, apiKey, clearKey }) {
  const cur = store.config.settings.ai || {};
  const base = normalizeBase(baseUrl || (PROVIDERS[provider] || {}).baseUrl || '');
  if (base && !/^https?:\/\/\S+$/i.test(base)) throw new Error(L('接口地址应以 http(s):// 开头'));
  const next = { provider: PROVIDERS[provider] ? provider : 'custom', baseUrl: base, model: String(model || '').trim().slice(0, 120), keyEnc: cur.keyEnc, keyHint: cur.keyHint };
  if (clearKey) { next.keyEnc = undefined; next.keyHint = ''; sessionKey = ''; }
  if (apiKey) {
    const k = String(apiKey).trim();
    next.keyHint = k.length > 8 ? k.slice(0, 3) + '…' + k.slice(-4) : L('已设置');
    if (encAvailable()) { next.keyEnc = safeStorage.encryptString(k).toString('base64'); sessionKey = ''; }
    else { next.keyEnc = undefined; sessionKey = k; log(L('系统不支持安全加密存储，API Key 只在本次运行内有效（不会写入磁盘）'), 'warn'); }
  }
  store.setAI(next);
  log(`AI ${L('助手已配置：')}${next.provider} · ${next.model || L('未填模型')} · Key ${next.keyHint || L('未设置')}`);
  return publicSettings().ai;
}
// 发现任务（可取消）
const jobs = new Map();
function startJob() { const id = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); const ctrl = new AbortController(); jobs.set(id, ctrl); return { id, ctrl }; }
async function testCandidate(c, signal) {
  if (signal && signal.aborted) throw new Error(L('已取消'));
  const b = { id: 'discover', name: L('发现'), category: 'ai', enabled: true };
  const ch = { ...normalizeChannel(c), id: 'probe' };
  const src = { ...channelSource(b, ch, chCtx()), id: 'probe-' + Math.random().toString(36).slice(2) };
  const pages = {};
  const r = await fetchSource(src, [b], { fetchText, renderText, ctx: chCtx(), pages, retryDelay: 1000 });
  const pg = pages[src.id];
  return { ok: r.status.ok, error: redact(r.status.error || ''), total: r.status.total, ms: r.status.ms, lineCount: pg ? (pg.lines || []).length : r.status.total,
    sample: pg ? (pg.lines || []).slice(0, 4) : r.items.slice(0, 4).map((d) => d.title), url: src.url };
}

// —— 轮询 ——
let retryTimer = null;
let queued = false;
async function poll(reason = L('定时'), onlyIds = null, force = false) {
  if (polling) {
    // 刷新进行中又有新请求（如刚添加厂商）：排队，本轮结束后立即补一轮，保证新品牌不用等下一个周期
    if (!onlyIds && reason !== L('定时')) queued = true;
    return { busy: true, queued };
  }
  if (!onlyIds) clearTimeout(retryTimer);
  const brands = enabledBrands();
  if (!brands.length) { log(L('未启用任何厂商/品牌，跳过本次刷新'), 'warn'); if (!onlyIds) schedule(); return { added: 0 }; }
  polling = true; send('runtime', runtime()); updateTray();
  const t0 = Date.now();
  const all = allSources();
  const sources = onlyIds ? all.filter((x) => onlyIds.includes(x.id)) : all;
  log(`${L('开始刷新（{0}）：{1} 个厂商/品牌，{2} 个数据源', reason, brands.length, sources.filter((x) => x.enabled).length)}`);
  const added = [];
  const hadDeals = store.deals.length > 0;
  let pushTimer = null; let dirtyDeals = false;
  const pushSoon = () => { if (!pushTimer) pushTimer = setTimeout(() => { pushTimer = null; const full = dirtyDeals; dirtyDeals = false; send('state', publicState(full ? {} : { light: true })); }, 600); };
  try {
    const s = store.config.settings;
    // 每个数据源完成后立即合并并推送到界面（边抓边显示）
    const onResult = (src, r) => {
      let newN = 0;
      setStatus(src.id, r.status);
      if (!r.status.ok) log(`${L('数据源失败：')}${src.name} — ${r.status.error}`, 'error');
      else if (r.status.error) log(`${L('数据源部分失败：')}${src.name} — ${r.status.error}`, 'warn');
      if (r.items.length) {
        for (const it of r.items) { it.status = 'new'; if ((it.offerTypes || []).length) it.facts = extractFacts(it); }
        const merged = mergeDeals(store.deals, r.items, { maxDeals: s.maxDeals, maxAgeDays: s.maxAgeDays, dedupe: s.dedupe !== false, onUpdate: (d) => { if ((d.offerTypes || []).length) d.facts = extractFacts(d); } });
        store.deals = merged.all; added.push(...merged.added); newN = merged.added.length; if (newN) dirtyDeals = true;
      }
      // v2.7：记录本次检查是否「有变化」，用于估计该渠道的变化频率
      if (r.status.ok) { const stt = store.config.sourceStatus[src.id]; if (stt) stt.chg = V27.recordCheck(stt.chg, newN > 0 || /检测到变化|发现 \d+ 个新页面/.test(r.status.note || ''), Date.now()); }
      pushSoon();
    };
    const results = await runAll(sources, brands, { fetchText, renderText, ctx: chCtx(), feedback: { words: s.noiseWords || [], sources: s.noiseSources || {}, hideResellers: !!s.hideResellers }, concurrency: Math.max(1, Math.min(16, Number(s.concurrency) || 6)), hostGap: Math.max(0, Number(s.hostGap) || 1500), onResult, pages: store.pages,
      status: store.config.sourceStatus, backoff: s.backoff !== false, force: force || !!onlyIds, baseMin: Number(s.intervalMinutes) || 15, adaptive: s.adaptivePolling !== false && !SHOT_DIR, adaptiveMax: Number(s.adaptiveMaxMin) || 360 });
    if (results.skipped && results.skipped.length) log(`${L('跳过 {0} 个渠道（自定义周期未到 / 失败退避中）：', results.skipped.length)}` + results.skipped.slice(0, 6).map((x) => x.source.name + L('（') + x.why + L('）')).join(L('；')) + (results.skipped.length > 6 ? ' …' : ''));
    store.savePages(); store.saveHealth(); httpCacheDirty = true; saveHttpCache();
    clearTimeout(pushTimer); pushTimer = null;
    store.saveConfig(); store.saveDealsSoon();
    const okN = results.filter((r) => r.status.ok).length;
    log(`${L('刷新完成：{0}/{1} 个数据源正常，新增 {2} 条，用时', okN, results.length, added.length)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    // 失败的数据源 90 秒后单独重试一次（应对启动时网络未就绪、偶发超时/限流）
    const failed = results.filter((r) => !r.status.ok).map((r) => r.source.id);
    if (failed.length && !onlyIds && !paused && !SHOT_DIR) {
      retryTimer = setTimeout(() => poll(L('重试失败的数据源'), failed), 90000);
      log(`${failed.length} ${L('个数据源失败，将在 90 秒后自动重试')}`, 'warn');
    }
    // v2.7：价格页结构化抽取 → 价格表历史；套餐价格变化生成一条「价格变动」
    try { const pi = await updatePrices(sources); if (pi.length) { const m2 = mergeDeals(store.deals, pi, { maxDeals: s.maxDeals, maxAgeDays: s.maxAgeDays, dedupe: false }); store.deals = m2.all; added.push(...m2.added); } } catch (e) { log(L('价格表更新失败：') + e.message, 'warn'); }
    // 规则引擎：命中规则的条目高亮 / 通知 / 提示音
    const fresh = added.filter((d) => store.deals.includes(d));
    const ruled = applyRules(s.rules, fresh);
    if (firstRunDone || hadDeals) {
      notifyNew(ruled.notify.sort((a, b) => (b.score || 0) - (a.score || 0) || (b.published || 0) - (a.published || 0)));
      if (ruled.sound && s.notify) send('sound', { count: ruled.notify.length });
      pushNew(ruled.notify, fresh).catch((e) => log(L('推送失败：') + e.message, 'warn'));
    }
    recheckLanding().catch(() => {});
    enrichDeals().catch((e) => log(("AI " + L('翻译 / 要点生成失败：')) + redact(e.message, aiKey()), 'warn'));
    classifyDeals().catch((e) => log(("AI " + L('优惠分类失败：')) + redact(e.message, aiKey()), 'warn'));
  } catch (e) {
    log(L('刷新出错：') + e.message, 'error');
  } finally {
    polling = false; lastRunAt = Date.now(); firstRunDone = true;
    // 仅重试失败源时不重置主定时器，避免把下一次完整刷新无限推迟
    if (!onlyIds || !timer) schedule();
    if (queued) { queued = false; setTimeout(() => poll(L('补充刷新')), 1500); }
    send('state', publicState());
    updateTray();
  }
  return { added: added.length };
}

function schedule() {
  clearTimeout(timer);
  if (paused) { nextRunAt = 0; send('runtime', runtime()); return; }
  const min = Math.max(1, Number(store.config.settings.intervalMinutes) || 15);
  nextRunAt = Date.now() + min * 60000;
  timer = setTimeout(() => { timer = null; poll(L('定时')); }, min * 60000);
  send('runtime', runtime());
}

// Windows 上 Notification 对象若被垃圾回收，点击回调会丢失——保留引用直到关闭/点击（最多 50 个）
const liveNotes = new Set();
function showNote(opts, onClick) {
  const n = new Notification({ icon: asset('icon.png'), ...opts });
  liveNotes.add(n);
  const drop = () => liveNotes.delete(n);
  n.on('click', () => { drop(); try { onClick && onClick(); } catch (e) { log(L('通知点击处理失败：') + e.message, 'warn'); } });
  n.on('close', drop); n.on('failed', (_e, err) => { drop(); log(L('系统通知发送失败：') + err, 'warn'); });
  if (liveNotes.size > 50) liveNotes.delete(liveNotes.values().next().value);
  n.show();
  return n;
}

function notifyNew(all) {
  // 只对开启了「通知」的厂商弹窗（厂商卡片上的铃铛开关）
  const quiet = new Set(store.config.brands.filter((b) => b.notify === false).map((b) => b.id));
  const st = store.config.settings; const minConf = Number(st.notifyMinConf) || 0;
  // v2.3：低可信度 / 已截止 / 已忽略的不打扰
  const relM = reliabilityMap();
  const added = all.filter((d) => !(relM[d.sourceId] && relM[d.sourceId].n >= 6 && relM[d.sourceId].score < 0.3) && !(typeof d.learnP === 'number' && d.learnP < 0.1) && d.brandIds.some((id) => !quiet.has(id)) && d.status !== 'ignored' && (!d.facts || ((d.facts.confidence || 0) >= minConf && V26.validity(d).status !== 'expired' && (!st.notifyMineOnly || V26.appliesToMe(d, st.profile).ok))));
  if (!added.length || !st.notify || !Notification.isSupported()) return;
  // 免打扰时段：先攒着，结束后合并成一条提醒
  if (inQuiet(st)) { pendingQuiet.push(...added.map((d) => d.id)); log(`${L('免打扰中：{0} 条新优惠将在 {1} 后合并提醒', added.length, st.quietEnd)}`); return; }
  const max = Math.max(0, Number(store.config.settings.notifyMax) || 0);
  const list = added.slice(0, max);
  if (added.length > max) {
    showNote({ title: `${appName()}${L('：发现 {0} 条新优惠', added.length)}`, body: added.slice(0, 3).map((d) => `${L('【')}${d.brandIds.map((b) => tx(brandName(b))).join('/')}${L('】')}${d.title}`).join('\n') }, showWindow);
  } else {
    for (const d of list) {
      const kinds = (d.offerTypes || []).map((t) => OFFER_LABELS[t]).filter(Boolean).join(' · ');
      showNote({ title: `${L('【')}${d.brandIds.map((b) => tx(brandName(b))).join('/')}${L('】')}${[tx(kinds), d.price, d.discount].filter(Boolean).join(' ') || L('新优惠')} · ${tx(d.platform)}`, body: d.title }, () => { if (/^https?:\/\//i.test(d.link)) shell.openExternal(d.link); markRead([d.id], true); send('state', publicState()); });
    }
  }
  send('notified', { count: added.length });
}

// —— v2.3：免打扰合并提醒 / 每日要点 ——
let pendingQuiet = [];
function noteTitle(d) {
  const t = (d.tr || {})[I18N.lang]; const cjk = /[\u4e00-\u9fff]/.test(d.title || '');
  if (I18N.lang === 'zh-CN') return (!cjk && (t && t.title || d.titleZh)) || d.title;
  return (cjk && t && t.title) || d.title;
}
function flushQuiet() {
  const st = store.config.settings;
  if (!pendingQuiet.length || inQuiet(st) || !st.notify || !Notification.isSupported()) return;
  const set = new Set(pendingQuiet); pendingQuiet = [];
  const list = store.deals.filter((d) => set.has(d.id) && d.status !== 'ignored').sort((a, b) => (b.score || 0) - (a.score || 0));
  if (!list.length) return;
  showNote({ title: `${appName()}${L('：免打扰期间发现 {0} 条新优惠', list.length)}`, body: list.slice(0, 3).map((d) => `${L('【')}${d.brandIds.map((b) => tx(brandName(b))).join('/')}${L('】')}${noteTitle(d)}`).join('\n') }, () => { showWindow(); send('go', 'home'); });
}
function dailyDigest(force) {
  const st = store.config.settings; const now = new Date();
  const due = force ? { daily: true, weekly: false } : V28.digestDue(st, now);
  if (!due.daily && !due.weekly) return null;
  if (!force && inQuiet(st)) return null;
  const dg = digestOf(store.deals, { now: Date.now(), brandName: (id) => tx(brandName(id)), t: L, titleOf: noteTitle, locale: I18N.locale() });
  if (due.daily) {
    if (!force) store.updateSettings({ lastDigestDay: V28.localDay(now) }); // v2.8：用本地日期（之前用 UTC，东八区 8 点前的摘要会一天两次）
    if (Notification.isSupported() && st.notify && (dg.top.length || dg.pricing.length || dg.expiring.length)) showNote({ title: dg.title, body: dg.lines.slice(0, 4).join('\n') }, () => { showWindow(); send('go', 'home'); });
    const by = new Map(store.deals.map((d) => [d.id, d]));
    const items = [...dg.top, ...dg.pricing, ...dg.expiring].map((id) => by.get(id)).filter(Boolean).filter((d, k, a) => a.indexOf(d) === k);
    pushChannels('digest', items, { title: dg.title }).catch(() => {});
  }
  if (due.weekly) {
    store.updateSettings({ lastWeeklyKey: V28.isoWeek(now) });
    const items = V28.weeklyItems(decorateDeals(store.deals));
    const title = L('每周优惠周报：本周 {0} 条值得关注', items.length);
    if (Notification.isSupported() && st.notify && items.length) showNote({ title, body: items.slice(0, 3).map((d) => noteTitle(d)).join('\n') }, () => { showWindow(); send('go', 'home'); });
    pushChannels('digest', items, { title }).catch(() => {});
    dg.weekly = { title, n: items.length };
  }
  return dg;
}
// —— v2.8：推送渠道 ——
function channelFetch(url, opts) { return net.fetch(url, { ...opts, bypassCustomProtocolHandlers: true }); }
async function sendTo(c, msg) {
  const ch = (store.config.settings.channels || []).find((x) => x.id === c.id) || c;
  try {
    await V213.withRetry(() => V28.sendChannel(ch, msg, channelFetch), { tries: 3, delays: [400, 1200] });
    ch.last = { at: Date.now(), ok: true, kind: msg.kind, n: msg.count, tries: 1 };
    return true;
  } catch (e) {
    ch.last = { at: Date.now(), ok: false, kind: msg.kind, err: String(e.message || e).slice(0, 200) };
    log(L('推送到「{0}」失败：{1}', ch.name, ch.last.err), 'warn');
    return false;
  } finally { store.saveConfig(); }
}

async function checkForUpdate({ force = false, notify = false } = {}) {
  const now = Date.now();
  const st = store.config.settings;
  if (!force && !V213.shouldCheck(st.lastUpdateCheck, now)) {
    return { current: app.getVersion(), latest: st.latestUpdate || null, skipped: true };
  }
  const res = await channelFetch(V213.RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DealRadar/' + app.getVersion() } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const info = V213.parseRelease(await res.json());
  store.updateSettings({ lastUpdateCheck: now, latestUpdate: info });
  const newer = V213.isNewer(info.version, app.getVersion());
  if (notify && newer && st.dismissedUpdate !== info.tag && Notification.isSupported()) {
    showNote({ title: L('发现新版本 {0}', info.version), body: L('当前版本 {0}。点击查看下载页（不会自动安装）。', app.getVersion()) }, () => shell.openExternal(info.url));
  }
  return { current: app.getVersion(), latest: info, newer };
}
const pushT = (k, ...a) => L(k, ...a);
async function pushChannels(kind, items, { title, viewId } = {}) {
  const chs = (store.config.settings.channels || []).filter((c) => c.enabled && (kind === 'digest' ? c.digest : kind === 'trial' ? c.trial : c.instant) && (!viewId || !c.viewId || c.viewId === viewId));
  if (!chs.length || (!items.length && kind !== 'test')) return 0;
  let n = 0;
  for (const c of chs) {
    const list = kind === 'new' ? items.filter((d) => (d.score || 0) >= (c.minScore || 0) && (!c.viewId || c.viewId === viewId)) : items;
    if (!list.length) continue;
    const msg = V28.buildMessage(kind, list.map((d) => ({ ...d, title: noteTitle(d) })), { t: pushT, title, brandName: (id) => tx(brandName(id)) });
    if (await sendTo(c, msg)) n++;
  }
  return n;
}
async function pushNew(ruledNotify, fresh) {
  const st = store.config.settings; const offers = decorateDeals(fresh).filter((d) => (d.offerTypes || []).length && d.status !== 'ignored' && !(d.vstat && d.vstat.status === 'expired'));
  if (ruledNotify.length) await pushChannels('new', ruledNotify.filter((d) => offers.includes(d)));
  for (const v of (st.views || []).filter((x) => x.alert)) {
    const hit = offers.filter((d) => V28.matchView(v, d, { brandText: (id) => brandName(id) }));
    if (!hit.length) continue;
    const title = L('视图「{0}」有 {1} 条新优惠', v.name, hit.length);
    if (Notification.isSupported() && st.notify && !inQuiet(st)) showNote({ title, body: hit.slice(0, 3).map((d) => noteTitle(d)).join('\n') }, () => { showWindow(); send('go', 'view:' + v.id); });
    if ((st.channels || []).some((c) => c.viewId === v.id)) await pushChannels('new', hit, { title, viewId: v.id });
  }
}
function trialCheck() {
  const due = V28.trialDue(store.deals); if (!due.length) return;
  const st = store.config.settings;
  for (const { d, stage, days } of due) {
    const title = stage === 'today' ? L('试用今天到期：{0}', noteTitle(d)) : (days === 1 ? L('试用明天到期：{0}', noteTitle(d)) : L('试用还有 {0} 天到期：{1}', days, noteTitle(d)));
    if (Notification.isSupported() && st.notify) showNote({ title, body: L('不打算续费的话，记得取消订阅或解绑付款方式') }, () => { showWindow(); send('select', d.id); });
    pushChannels('trial', [d], { title }).catch(() => {});
    d.trialNotified = [...(d.trialNotified || []), stage];
  }
  store.saveDealsSoon(); send('state', publicState());
}
setInterval(() => { if (!store) return; try { flushQuiet(); dailyDigest(false); trialCheck(); } catch (e) { log(L('摘要提醒失败：') + e.message, 'warn'); } }, 60000);

// —— v2.3：AI 中文翻译 + 一句话要点（配置了 AI 时；结果缓存在 deal 上，每轮最多 20 条）——
let enriching = false;
let classifying = false;
const { needsClassify, classifyPrompt, parseClassify } = require('./core/classify');
async function classifyDeals(limit = 30) {
  const st = store.config.settings;
  if (classifying || st.aiClassify === false) return 0;
  let llm; try { llm = getLLM(); } catch { return 0; }
  if (!llm || !aiKey()) return 0;
  const list = store.deals.filter(needsClassify).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
  if (!list.length) return 0;
  classifying = true;
  try {
    const out = parseClassify(await llm.chat([{ role: 'user', content: classifyPrompt(list) }], { json: true, maxTokens: 1800 }));
    let n = 0;
    for (const r of out) {
      const d = list[r.i]; if (!d) continue;
      d.aiClass = r.class; d.aiClassWhy = r.why || ''; d.aiClassAt = Date.now();
      if (r.class === 'noise' && d.feedback !== 'noise' && !(d.offerTypes || []).includes('pricing')) {
        d.offerTypes = []; d.feedback = d.feedback || 'noise'; d.facts = extractFacts(d);
      } else if (r.class === 'offer') {
        d.facts = extractFacts(d);
      }
      n++;
    }
    for (const d of list) if (!d.aiClass) { d.aiClass = 'offer'; d.aiClassAt = Date.now(); } // 解析失败的不反复打
    store.saveDealsSoon(); send('state', publicState());
    log(`AI ${L('已分类 {0} 条优惠 / 噪声', n)}`);
    return n;
  } catch (e) { log(("AI " + L('优惠分类失败：')) + redact(e.message, aiKey()), 'warn'); return 0; }
  finally { classifying = false; }
}
async function enrichDeals(limit) {
  const st = store.config.settings;
  if (limit == null) limit = Math.min(80, Math.max(10, Number(st.enrichLimit) || 40));
  if (enriching || st.aiTranslate === false) return 0;
  const llm = getLLM(); if (!llm || !aiKey()) return 0;
  const lang = I18N.lang;
  const list = store.deals.filter((d) => needsEnrich(d, lang)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
  if (!list.length) return 0;
  enriching = true;
  try {
    const out = parseEnrich(await llm.chat([{ role: 'user', content: enrichPrompt(list, lang) }], { json: true, maxTokens: 2400 }));
    let n = 0;
    for (const r of out) {
      const d = list[r.i]; if (!d) continue;
      const title = String(r.text || '').slice(0, 200); const note = String(r.note || '').slice(0, 200);
      d.tr = { ...(d.tr || {}), [lang]: { title, note, at: Date.now() } };
      if (lang === 'zh-CN') { if (title) d.titleZh = title; if (note) d.aiNote = note; d.enrichedAt = Date.now(); d.facts = extractFacts(d); }
      n++;
    }
    for (const d of list) if (!(d.tr || {})[lang]) d.tr = { ...(d.tr || {}), [lang]: { title: '', note: '', at: Date.now() } }; // 失败的也不反复重试
    for (const d of list) if (lang === 'zh-CN' && !d.enrichedAt) d.enrichedAt = Date.now();
    store.saveDealsSoon(); send('state', publicState());
    log(`AI ${L('已翻译 / 总结 {0} 条优惠', n)}`);
    return n;
  } finally { enriching = false; }
}

function markRead(ids, read) {
  const set = new Set(ids);
  for (const d of store.deals) if (set.has(d.id)) d.read = read;
  store.saveDealsSoon(); updateTray();
}

// —— 窗口 / 托盘 ——
function createWindow() {
  const s = store.config.settings;
  let wb = s.windowBounds || {};
  try { // 保存的位置不在任何显示器内时（如拔掉副屏）回到默认居中
    const { screen } = require('electron');
    if (wb.x != null && !screen.getAllDisplays().some((d) => wb.x >= d.workArea.x - 50 && wb.y >= d.workArea.y - 50 && wb.x < d.workArea.x + d.workArea.width - 100 && wb.y < d.workArea.y + d.workArea.height - 100)) wb = { width: wb.width, height: wb.height };
  } catch { wb = {}; }
  if (SHOT_DIR) wb = {};
  win = new BrowserWindow({
    width: wb.width || 1360, height: wb.height || 860, x: wb.x, y: wb.y, minWidth: 1060, minHeight: 660,
    frame: false, show: false, title: appName(),
    backgroundColor: s.theme === 'light' ? '#f4f6fa' : '#15171c',
    icon: asset('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  const hidden = (s.startMinimized || process.argv.includes('--hidden')) && !SHOT_DIR;
  win.once('ready-to-show', () => { if (!hidden || !tray) win.show(); });
  win.on('close', (e) => {
    if (!quitting && store.config.settings.closeToTray && tray && !SHOT_DIR) {
      e.preventDefault(); win.hide();
      if (!store.config.settings.trayHintShown && Notification.isSupported()) {
        showNote({ title: appName() + (" " + L('仍在后台运行')), body: L('已最小化到系统托盘，继续为你监控优惠。右键托盘图标可退出。') }, showWindow);
        store.updateSettings({ trayHintShown: true });
      }
    }
  });
  if (wb.maximized) win.maximize();
  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const b = win.getNormalBounds();
    store.config.settings.windowBounds = { ...b, maximized: win.isMaximized() };
  };
  win.on('resize', saveBounds); win.on('move', saveBounds);
  win.on('maximize', saveBounds); win.on('unmaximize', saveBounds);
  win.on('maximize', () => send('win:max', true));
  win.on('unmaximize', () => send('win:max', false));
  // 渲染进程意外退出（显卡驱动问题等）时自动重新加载界面，后台监控不受影响
  win.webContents.on('render-process-gone', (_e, d) => {
    log(`${L('界面进程异常退出（{0}），正在重新加载', d.reason)}`, 'error');
    if (d.reason !== 'clean-exit' && !quitting) setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 1000);
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}

function showWindow() {
  if (!store) return; // 尚未初始化完成（第二实例过早唤起）
  if (!win || win.isDestroyed()) createWindow();
  win.show(); if (win.isMinimized()) win.restore(); win.focus();
}

// 便携版没有开始菜单快捷方式，Windows 可能不显示 Toast 通知：为其创建带 AppUserModelId 的开始菜单快捷方式
function ensurePortableShortcut() {
  if (process.platform !== 'win32' || !PORTABLE_EXE || SHOT_DIR) return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', APP_NAME + '（便携版）.lnk');
    const ok = shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'update' : 'create', { target: PORTABLE_EXE, appUserModelId: 'com.gaosichun.dealradar', description: APP_NAME, icon: PORTABLE_EXE, iconIndex: 0 });
    if (!ok) log(L('创建通知所需的开始菜单快捷方式失败'), 'warn');
  } catch (e) { log(L('创建开始菜单快捷方式失败：') + e.message, 'warn'); }
}

function updateTray() {
  if (!tray) return;
  const unread = store.deals.filter((d) => !d.read && isOfferDeal(d) && ((d.category || 'goods') !== 'goods' || store.config.settings.goodsEnabled)).length;
  tray.setToolTip(`${appName()} · ${polling ? (L('正在刷新') + "…") : paused ? L('已暂停监控') : L('监控中')} · ${L('未读 {0} 条', unread)}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${L('打开')} ${appName()}`, click: showWindow },
    { label: polling ? (L('正在刷新') + "…") : L('立即刷新'), enabled: !polling, click: () => poll(L('手动')) },
    { label: paused ? L('恢复监控') : L('暂停监控'), click: () => setPaused(!paused) },
    { type: 'separator' },
    { label: `${L('未读优惠：')}${unread}`, enabled: false },
    { type: 'separator' },
    { label: L('退出'), click: () => { quitting = true; app.quit(); } },
  ]));
}

function setPaused(p) {
  paused = !!p;
  log(paused ? L('已暂停自动监控') : L('已恢复自动监控'));
  if (paused) { clearTimeout(timer); clearTimeout(retryTimer); } schedule(); updateTray();
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(asset('tray.png')); // 自动加载 tray@2x.png 适配高 DPI
    tray = new Tray(img);
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    updateTray();
  } catch (e) { log(L('托盘创建失败：') + e.message, 'warn'); tray = null; }
}

// —— IPC ——
function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

ipcMain.on('i18n:sync', (e) => { e.returnValue = { lang: I18N.lang, dict: I18N.lang === 'zh-CN' ? {} : loadDict(I18N.lang), langs: I18N.LANGS, pref: (store && store.config.settings.lang) || 'auto', forced: !!process.env.DEAL_RADAR_LANG }; });
function registerIPC() {
  handle('state:get', () => publicState());
  handle('poll:now', () => poll(L('手动'), null, true));
  handle('poll:pause', (p) => { setPaused(p); return runtime(); });

  handle('brand:save', (b) => { const r = store.upsertBrand(b); logoCache = null; send('state', publicState()); return r; });
  handle('brand:remove', (id) => { store.removeBrand(id); logoCache = null; send('state', publicState()); });
  handle('brand:toggle', (id, en) => { store.setBrandEnabled(id, en); send('state', publicState()); });
  handle('brand:group', (group, en) => { const n = store.setGroupEnabled(group, en); send('state', publicState()); return n; });
  handle('brand:notify', (id, on) => { store.setBrandNotify(id, on); send('state', publicState()); });
  handle('brand:enableOnly', (ids, category) => { const set = new Set(ids); for (const b of store.config.brands) if (!category || (b.category || 'ai') === category) { b.enabled = set.has(b.id); b.userOff = !b.enabled; } store.saveConfig(); send('state', publicState()); });
  handle('channel:save', (brandId, c) => { const r = store.upsertChannel(brandId, c);
    const b = store.config.brands.find((x) => x.id === brandId);
    if (b && !b.logo && !BUNDLED_LOGOS.has(b.id)) { try { const h = new URL(c.url).hostname.replace(/^(www|blog|news|rss|feeds?)\./, ''); if (!NOT_VENDOR.test(h) && ['blog', 'pricing', 'changelog', 'official'].includes(c.sub || 'blog')) ensureLogo(b, h); } catch {} } send('state', publicState()); return r; });
  handle('channel:remove', (brandId, chId) => { store.removeChannel(brandId, chId); send('state', publicState()); });
  handle('channel:toggle', (brandId, chId, on) => { store.setChannelEnabled(brandId, chId, on); send('state', publicState()); });
  // 添加渠道前「测试」：不保存，直接按配置抓取并返回预览
  handle('channel:preview', async (brandId, c) => {
    const b = store.config.brands.find((x) => x.id === brandId) || { id: brandId || 'preview', name: L('预览'), category: 'ai', enabled: true };
    const ch = { ...normalizeChannel(c), id: 'preview' };
    const src = { ...channelSource({ ...b, enabled: true }, ch, chCtx()), id: 'preview-' + Date.now() };
    const pages = {};
    const t0 = Date.now();
    const r = await fetchSource(src, [{ ...b, enabled: true }], { fetchText, renderText, ctx: chCtx(), pages, retryDelay: 1500 });
    const pg = pages[src.id];
    return { status: r.status, url: src.url, ms: Date.now() - t0, kind: src.kind, lines: pg ? (pg.lines || []).slice(0, 60) : null, lineCount: pg ? (pg.lines || []).length : 0,
      items: r.items.slice(0, 25).map((d) => ({ title: d.title, link: d.link, published: d.published, offerTypes: d.offerTypes })) };
  });
  // —— AI 助手 ——
  handle('ai:save', (cfg) => { const r = saveAI(cfg || {}); send('state', publicState()); return r; });
  handle('ai:test', async (cfg) => {
    const llm = getLLM(cfg && cfg.baseUrl ? cfg : null);
    if (!llm) throw new Error(L('请先填写接口地址和模型'));
    const t0 = Date.now();
    try {
      const reply = await llm.chat([{ role: 'user', content: 'Reply with exactly OK' }], { maxTokens: 8 });
      log(`AI ${L('连接测试成功：{0}，', llm.info.model)}${Date.now() - t0}ms`);
      return { ok: true, ms: Date.now() - t0, model: llm.info.model, reply: String(reply).slice(0, 40) };
    } catch (e) { const msg = redact(e.message, aiKey()); log(("AI " + L('连接测试失败：')) + msg, 'warn'); throw new Error(msg); }
  });
  handle('discover:cancel', (id) => { const j = jobs.get(id); if (j) { j.abort(); jobs.delete(id); } return true; });
  handle('discover:vendor', async (jobId, name) => {
    const ctrl = new AbortController(); jobs.set(jobId, ctrl);
    const key = aiKey();
    let llm = null; try { llm = getLLM(); } catch (e) { log(("AI " + L('配置无效，改用规则发现：')) + e.message, 'warn'); }
    const exist = store.config.brands.find((b) => b.name.toLowerCase() === String(name).trim().toLowerCase() || (b.aliases || []).some((a) => a.toLowerCase() === String(name).trim().toLowerCase()));
    log(`AI ${L('辅助添加厂商：{0}（', name)}${llm ? ("AI" + L('：')) + llm.info.model : L('未配置 AI，使用规则')}${L('）')}`);
    try {
      const r = await discoverVendor(name, { fetchText, llm, testChannel: testCandidate, signal: ctrl.signal, canRender: !!renderHTML && store.config.settings.renderEnabled !== false, onStep: (st) => send('discover:progress', { jobId, ...st, text: redact(st.text, key) }) });
      r.existing = exist ? { id: exist.id, name: exist.name, enabled: exist.enabled } : null;
      log(`${L('发现完成：{0}，{1} 个候选，{2} 个可用', r.vendor.name, r.candidates.length, r.candidates.filter((c) => c.test && c.test.ok).length)}`);
      r.notes = r.notes.map((n) => redact(n, key));
      return r;
    } catch (e) { const msg = redact(e.message, key); log(L('发现失败：') + msg, 'warn'); throw new Error(msg); } finally { jobs.delete(jobId); }
  });
  handle('discover:commit', (payload) => {
    const { vendor, channels, existingId } = payload || {};
    let brand;
    if (existingId) { brand = store.config.brands.find((b) => b.id === existingId); if (!brand) throw new Error(L('厂商不存在')); if (!brand.enabled) store.setBrandEnabled(brand.id, true); }
    else brand = store.upsertBrand({ name: vendor.name, aliases: vendor.aliases || [], exclude: vendor.exclude || [], category: 'ai', enabled: true });
    let added = 0; const errors = [];
    for (const c of channels || []) {
      try { store.upsertChannel(brand.id, { type: c.type, name: c.name, url: c.url, keyword: c.keyword, selector: c.selector, sub: c.sub, opts: c.opts, region: c.region, render: c.render }); added++; } catch (e) { errors.push(`${c.name}${L('：')}${e.message}`); }
    }
    if (vendor && vendor.region === 'cn' && !existingId) { brand.region = 'cn'; store.saveConfig(); }
    if (vendor && !brand.logo) { const dom = (vendor.domains || [])[0] || vendor.domain; if (dom) ensureLogo(brand, dom); }
    if (vendor && vendor.description && !brand.desc) { brand.desc = String(vendor.description).slice(0, 120); store.saveConfig(); }
    log(`${L('已添加厂商 {0}，{1} 个渠道', brand.name, added)}${errors.length ? `${L('（{0} 个跳过）', errors.length)}` : ''}`);
    send('state', publicState());
    setTimeout(() => poll(L('新厂商'), channelSources([brand], chCtx()).map((x) => x.id), true), 300);
    return { brandId: brand.id, added, errors };
  });
  handle('channel:detect', (url) => V210.detectFromUrl(url));
  handle('discover:channel', async (jobId, input, brandId) => {
    const ctrl = new AbortController(); jobs.set(jobId, ctrl);
    const key = aiKey();
    let llm = null; try { llm = getLLM(); } catch { llm = null; }
    const brand = store.config.brands.find((b) => b.id === brandId) || null;
    try {
      const r = await discoverChannel(input, { fetchText, llm, brand, signal: ctrl.signal });
      r.reason = redact(r.reason, key);
      log(`AI ${L('辅助添加渠道：')}${String(input).slice(0, 60)} → ${r.channel.type}${r.usedAI ? L('（AI）') : ''}`);
      return r;
    } catch (e) { throw new Error(redact(e.message, key)); } finally { jobs.delete(jobId); }
  });
  handle('rules:save', (rules) => { const r = store.saveRules(rules); send('state', publicState()); return r; });
  handle('health:reset', (id) => { if (id) delete store.health[id]; else store.health = {}; store.saveHealth(); send('state', publicState()); });
  handle('opml:export', async () => {
    const groups = [];
    const rssLike = (s) => !s.kind || s.kind !== 'page';
    const chs = channelSources(store.config.brands, chCtx()).filter((x) => rssLike(x) && /^https?:/.test(x.url) && ['rss', 'youtube', 'reddit', 'github', 'producthunt', 'search', 'rsshub'].includes(x.type));
    for (const b of store.config.brands) { const items = chs.filter((x) => x.brandId === b.id).map((x) => ({ title: x.name, xmlUrl: x.url })); if (items.length) groups.push({ title: b.name, items }); }
    groups.push({ title: L('聚合数据源'), items: store.config.sources.filter((x) => !x.url.includes('{q}') && (!x.type || x.type === 'rss' || x.type === 'producthunt')).map((x) => ({ title: x.name, xmlUrl: x.url })) });
    const xml = toOPML(groups);
    const file = SHOT_DIR ? path.join(SHOT_DIR, 'export-subscriptions.opml') : (await dialog.showSaveDialog(win, { title: (L('导出') + " OPML"), defaultPath: path.join(app.getPath('downloads'), (L('优惠雷达订阅') + ".opml")), filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }] })).filePath;
    if (!file) return null;
    fs.writeFileSync(file, xml); return { path: file, count: groups.reduce((n, g) => n + g.items.length, 0) };
  });
  handle('opml:import', async (target, filePath) => {
    const file = filePath || (SHOT_DIR ? null : (await dialog.showOpenDialog(win, { title: (L('导入') + " OPML"), filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }], properties: ['openFile'] })).filePaths[0]);
    if (!file) return null;
    const list = parseOPML(fs.readFileSync(file, 'utf8'));
    let added = 0; let dup = 0;
    for (const it of list) {
      try {
        if (target && target !== '__sources') store.upsertChannel(target, { type: 'rss', name: it.title, url: it.xmlUrl, sub: 'blog' });
        else store.addSource({ url: it.xmlUrl, name: it.title, kind: 'community', category: 'ai' });
        added++;
      } catch { dup++; }
    }
    log(`OPML ${L('导入：新增 {0} 个，跳过 {1} 个（重复或无效）', added, dup)}`);
    send('state', publicState()); return { total: list.length, added, dup };
  });
  handle('config:export', async () => {
    const data = JSON.stringify(store.exportConfig(), null, 2);
    const file = SHOT_DIR ? path.join(SHOT_DIR, 'export-config.json') : (await dialog.showSaveDialog(win, { title: L('导出配置'), defaultPath: path.join(app.getPath('downloads'), (L('优惠雷达配置') + ".json")), filters: [{ name: 'JSON', extensions: ['json'] }] })).filePath;
    if (!file) return null;
    fs.writeFileSync(file, data); return { path: file };
  });
  handle('config:import', async (filePath) => {
    const file = filePath || (await dialog.showOpenDialog(win, { title: L('导入配置'), filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })).filePaths[0];
    if (!file) return null;
    const r = store.importConfig(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '')));
    await applyProxy(); schedule(); log(`${L('已导入配置：{0} 个厂商，{1} 个聚合源', r.brands, r.sources)}`);
    send('state', publicState()); return r;
  });
  handle('goods:set', (on) => {
    store.setGoodsEnabled(on);
    log(on ? L('已开启实物商品优惠监控（可在「厂商与品牌」中选择品牌）') : L('已关闭实物商品优惠监控'));
    send('state', publicState());
    if (on && !SHOT_DIR) poll(L('开启实物商品'));
    return store.config.settings;
  });
  handle('notify:test', () => {
    if (!Notification.isSupported()) throw new Error(L('当前系统不支持桌面通知'));
    showNote({ title: `${L('【测试】{0} 通知正常', appName())}`, body: L('发现新优惠时会这样提醒你，点击通知可直接打开优惠页面。') }, showWindow);
    return true;
  });
  handle('net:check', async () => {
    // 检测国内/境外连通性，帮助判断是否需要代理
    const probe = async (name, url) => { const t0 = Date.now(); try { await fetchText(url, { timeout: 8000 }); return { name, ok: true, ms: Date.now() - t0 }; } catch (e) { return { name, ok: false, error: e.message }; } };
    return Promise.all([probe(L('国内站点（IT之家）'), 'https://www.ithome.com/rss/'), probe(L('境外站点（Google 新闻）'), 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en'), probe(L('境外站点（Reddit）'), 'https://www.reddit.com/r/deals/.rss?limit=1')]);
  });

  handle('source:add', (s) => { const r = store.addSource(s); send('state', publicState()); return r; });
  handle('source:remove', (id) => { store.removeSource(id); send('state', publicState()); });
  handle('source:toggle', (id, en) => { store.setSourceEnabled(id, en); send('state', publicState()); });
  handle('source:toggleAll', (ids, en) => { for (const id of ids) store.setSourceEnabled(id, en); send('state', publicState()); });
  handle('source:test', async (id) => {
    const src = allSources().find((s) => s.id === id); if (!src) throw new Error(L('数据源不存在'));
    const brands = enabledBrands().filter((b) => !src.category || (b.category || 'ai') === src.category);
    const vb = src.brandId && store.config.brands.find((b) => b.id === src.brandId); if (vb && !brands.includes(vb)) brands.push(vb); // 测试停用厂商的渠道
    const r = await fetchSource(src, src.kind === 'search' ? brands.slice(0, 2) : brands, { fetchText, renderText, ctx: chCtx(), pages: store.pages });
    setStatus(id, r.status); store.saveConfig(); store.savePages(); store.saveHealth();
    if (r.items.length) { const m = mergeDeals(store.deals, r.items, { maxDeals: store.config.settings.maxDeals, maxAgeDays: store.config.settings.maxAgeDays }); store.deals = m.all; store.saveDealsSoon(); }
    send('state', publicState());
    return { status: r.status, sample: r.items.slice(0, 5).map((d) => d.title) };
  });
  handle('source:testMany', async (ids) => {
    const set = new Set(ids); const srcs = allSources().filter((s) => set.has(s.id)).map((s) => ({ ...s, enabled: true }));
    const brands = store.config.brands.filter((b) => b.enabled || srcs.some((s) => s.brandId === b.id));
    const res = await runAll(srcs, brands, { fetchText, renderText, ctx: chCtx(), pages: store.pages, force: true, concurrency: 6, onResult: (src, r) => { setStatus(src.id, r.status); send('state', publicState()); } });
    store.saveConfig(); store.savePages(); store.saveHealth(); send('state', publicState());
    return { ok: res.filter((r) => r.status.ok).length, total: res.length };
  });

  handle('settings:save', async (patch) => {
    const before = { ...store.config.settings };
    const s = store.updateSettings(patch);
    if (before.lang !== s.lang) { const old = I18N.lang; const l = applyLang(); if (l !== old) { updateTray(); log(L('界面语言已切换为 {0}', (I18N.LANGS.find((x) => x.id === l) || {}).name || l)); if (win && !win.isDestroyed()) setTimeout(() => win.webContents.reload(), 50); } }
    if (before.intervalMinutes !== s.intervalMinutes) schedule();
    if (before.proxyMode !== s.proxyMode || before.proxyUrl !== s.proxyUrl) { await applyProxy(); log(L('网络代理已更改，立即重新刷新')); setTimeout(() => poll(L('代理已更改')), 300); }
    if (before.autoStart !== s.autoStart) applyAutoStart();
    if (win && before.theme !== s.theme) win.setBackgroundColor(s.theme === 'light' ? '#f4f6fa' : '#15171c');
    send('state', publicState());
    return s;
  });
  handle('deals:recheck', async () => recheckLanding(true));
  // —— v2.8 ——
  const chList = () => (store.config.settings.channels = store.config.settings.channels || []);
  handle('push:save', (c) => {
    const list = chList(); const old = list.find((x) => x.id === c.id);
    // 界面只拿到打码后的密钥：没改动就沿用旧值
    const merged = { ...(old || {}), ...c }; for (const k of ['secret', 'token', 'key']) if (old && (c[k] === undefined || /••••|…/.test(c[k] || ''))) merged[k] = old[k];
    const n = V28.normalizeChannel(merged); const err = V28.validateChannel(n); if (err) throw new Error(L(err));
    if (old) Object.assign(old, n); else list.push(n);
    store.saveConfig(); send('state', publicState()); return V28.mask(n);
  });
  handle('push:delete', (id) => { store.config.settings.channels = chList().filter((x) => x.id !== id); store.saveConfig(); send('state', publicState()); return true; });
  handle('push:test', async (id) => {
    const c = chList().find((x) => x.id === id); if (!c) throw new Error(L('渠道不存在'));
    const sample = store.deals.filter((d) => (d.offerTypes || []).length && d.status !== 'ignored').sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 2);
    const msg = V28.buildMessage('test', sample.map((d) => ({ ...d, title: noteTitle(d) })), { t: pushT, title: L('全网优惠雷达：测试消息'), brandName: (bid) => tx(brandName(bid)), extra: [L('收到这条说明推送渠道配置成功。下面是当前最值得关注的优惠示例：')] });
    const ok = await sendTo(c, msg); send('state', publicState()); return { ok, last: c.last };
  });
  handle('view:save', (v) => { const list = (store.config.settings.views = store.config.settings.views || []); const n = V28.normalizeView(v); const i = list.findIndex((x) => x.id === n.id); if (i >= 0) list[i] = { ...n, created: list[i].created }; else list.push(n); store.saveConfig(); send('state', publicState()); return n; });
  handle('view:delete', (id) => { store.config.settings.views = (store.config.settings.views || []).filter((x) => x.id !== id); for (const c of chList()) if (c.viewId === id) c.viewId = ''; store.saveConfig(); send('state', publicState()); return true; });
  handle('deal:trial', (id, end) => { const d = store.deals.find((x) => x.id === id); if (!d) throw new Error(L('条目不存在')); const t = Number(end) || 0; if (t) { d.trialEnd = t; d.trialNotified = []; delete d.trialDone; } else { delete d.trialEnd; delete d.trialNotified; } store.saveDealsSoon(); send('state', publicState()); return true; });
  handle('deal:trialDone', (id) => { const d = store.deals.find((x) => x.id === id); if (d) { d.trialDone = true; store.saveDealsSoon(); send('state', publicState()); } return true; });
  handle('share:markdown', (id) => { const d = store.deals.find((x) => x.id === id); if (!d) throw new Error(L('条目不存在')); const md = V28.shareMarkdown({ ...d, title: noteTitle(d), facts: d.facts || extractFacts(d) }, { brandName: (b) => tx(brandName(b)), t: L }); clipboard.writeText(md); return md; });
  handle('share:image', async (dataUrlStr, name) => {
    const img = nativeImage.createFromDataURL(String(dataUrlStr || '')); if (img.isEmpty()) throw new Error(L('图片生成失败'));
    clipboard.writeImage(img);
    if (!name) return { copied: true };
    const r = await dialog.showSaveDialog(win, { defaultPath: String(name).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled || !r.filePath) return { copied: true };
    fs.writeFileSync(r.filePath, img.toPNG()); return { copied: true, path: r.filePath };
  });
  handle('preset:apply', async (key) => {
    const pr = V28.PRESETS[key]; if (!pr) throw new Error('preset');
    const st = store.config.settings; const patch = {};
    if (pr.profile && Object.keys(pr.profile).length) patch.profile = { ...st.profile, ...pr.profile, pay: [...new Set([...(st.profile.pay || []), ...(pr.profile.pay || [])])] };
    const rules = (st.rules || []).slice(); const rname = L(pr.rule.name);
    if (!rules.some((r) => r.id === 'p-' + key)) { rules.push({ ...pr.rule, name: rname, id: 'p-' + key }); store.saveRules(rules); }
    if (pr.groups) for (const b of store.config.brands) if ((b.category || 'ai') === 'ai' && pr.groups.includes(b.group)) b.enabled = true;
    store.updateSettings(patch); send('state', publicState()); return { rule: rname, groups: pr.groups || [] };
  });
  handle('digest:weekly', () => { const st = store.config.settings; const items = V28.weeklyItems(decorateDeals(store.deals)); const title = L('每周优惠周报：本周 {0} 条值得关注', items.length); if (Notification.isSupported() && st.notify && items.length) showNote({ title, body: items.slice(0, 3).map((d) => noteTitle(d)).join('\n') }, () => showWindow()); return pushChannels('digest', items, { title }).then((n) => ({ title, n: items.length, pushed: n })); });
  handle('settings:reset', () => { store.resetDefaults(); applyProxy(); schedule(); send('state', publicState()); });

  handle('deal:read', (ids, read) => { markRead(ids, read); });
  handle('deal:status', (ids, status) => {
    if (!['new', 'claimed', 'ignored'].includes(status)) throw new Error(L('未知状态'));
    const set = new Set(ids); for (const d of store.deals) if (set.has(d.id)) { d.status = status; if (status !== 'new') d.read = true; if (status === 'claimed') learnFrom(d, true); else if (status === 'ignored') learnFrom(d, false); }
    store.saveDealsSoon(); updateTray(); send('state', publicState()); return true;
  });
  // 「不是优惠」：降级为资讯 + 忽略；可选学习屏蔽词 / 降低来源权重，并对已有数据立即生效
  handle('deal:notOffer', (id, { word = '', penalize = false } = {}) => {
    const d = store.deals.find((x) => x.id === id); if (!d) throw new Error(L('条目不存在'));
    const st = store.config.settings; const patch = {};
    learnFrom(d, false);
    Object.assign(d, { offerTypes: [], feedback: 'noise', status: 'ignored', read: true }); delete d.facts;
    let affected = 1;
    const w = String(word || '').trim();
    if (w.length >= 2) {
      patch.noiseWords = [...(st.noiseWords || []), w];
      for (const x of store.deals) if (x !== d && (x.offerTypes || []).length && !x.offerTypes.includes('pricing') && !x.fav && x.status !== 'claimed' && x.title.toLowerCase().includes(w.toLowerCase())) { x.offerTypes = []; x.feedback = 'noise'; delete x.facts; affected++; }
    }
    if (penalize && d.sourceId) patch.noiseSources = { ...(st.noiseSources || {}), [d.sourceId]: ((st.noiseSources || {})[d.sourceId] || 0) + 1 };
    if (Object.keys(patch).length) store.updateSettings(patch);
    store.saveDealsSoon(); updateTray(); send('state', publicState());
    return { affected };
  });
  handle('deal:feedback', (id, { reason = 'noise', word = '', penalize = false } = {}) => {
    const d = store.deals.find((x) => x.id === id); if (!d) throw new Error(L('条目不存在'));
    const r = V212.FEEDBACK_REASONS.includes(reason) ? reason : 'noise';
    if (V212.learnsNegative(r)) learnFrom(d, false);
    Object.assign(d, V212.applyFeedback(d, r));
    const st = store.config.settings; const patch = {}; let affected = 1;
    const w = String(word || '').trim();
    if (V212.learnsWord(r) && w.length >= 2) {
      patch.noiseWords = [...(st.noiseWords || []), w];
      for (const x of store.deals) if (x !== d && (x.offerTypes || []).length && !x.offerTypes.includes('pricing') && !x.fav && x.status !== 'claimed' && x.title.toLowerCase().includes(w.toLowerCase())) { Object.assign(x, V212.applyFeedback(x, 'noise')); affected++; }
    }
    if (penalize && d.sourceId) patch.noiseSources = { ...(st.noiseSources || {}), [d.sourceId]: ((st.noiseSources || {})[d.sourceId] || 0) + 1 };
    if (Object.keys(patch).length) store.updateSettings(patch);
    store.saveDealsSoon(); updateTray(); send('state', publicState());
    return { affected, reason: r };
  });
  handle('update:check', async (force) => {
    const r = await checkForUpdate({ force: force !== false, notify: false });
    send('state', publicState());
    return r;
  });
  handle('update:open', () => {
    const u = (store.config.settings.latestUpdate || {}).url;
    if (u) shell.openExternal(u);
    return !!u;
  });
  handle('update:dismiss', () => {
    const tag = (store.config.settings.latestUpdate || {}).tag;
    if (tag) store.updateSettings({ dismissedUpdate: tag });
    send('state', publicState());
    return true;
  });
  handle('backup:export', async () => {
    const data = JSON.stringify(V212.exportBackup({ config: store.config, deals: store.deals, views: store.config.settings.views, prices: store.prices }), null, 2);
    const file = SHOT_DIR ? path.join(SHOT_DIR, 'export-backup.json') : (await dialog.showSaveDialog(win, { title: L('导出完整备份'), defaultPath: path.join(app.getPath('downloads'), (L('优惠雷达备份') + ".json")), filters: [{ name: 'JSON', extensions: ['json'] }] })).filePath;
    if (!file) return null;
    fs.writeFileSync(file, data);
    return { path: file, deals: store.deals.length };
  });
  handle('backup:import', async (filePath) => {
    const file = filePath || (SHOT_DIR ? null : (await dialog.showOpenDialog(win, { title: L('导入完整备份'), filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })).filePaths[0]);
    if (!file) return null;
    const obj = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''));
    const err = V212.validateBackup(obj); if (err) throw new Error(L(err));
    if (obj.format === 2 || !obj.deals) {
      const r = store.importConfig(obj);
      await applyProxy(); schedule(); send('state', publicState());
      return { ...r, deals: 0, format: 2 };
    }
    const r = store.importConfig({ app: 'DealRadar', format: 2, brands: obj.brands, sources: obj.sources, settings: obj.settings });
    if (Array.isArray(obj.views)) { store.config.settings.views = obj.views; store.saveConfig(); }
    store.deals = V212.mergeDeals(store.deals, obj.deals);
    if (obj.prices && typeof obj.prices === 'object') { store.prices = obj.prices; store.savePrices(); }
    store.saveDealsSoon(); await applyProxy(); schedule(); send('state', publicState());
    log(L('已导入备份：{0} 个厂商，{1} 条优惠（推送密钥未包含，需在本机重填）', r.brands, store.deals.length));
    return { brands: r.brands, sources: r.sources, deals: store.deals.length, format: 3 };
  });
    handle('feedback:removeWord', (w) => { store.updateSettings({ noiseWords: (store.config.settings.noiseWords || []).filter((x) => x !== w) }); send('state', publicState()); });
  handle('feedback:resetSources', () => { store.updateSettings({ noiseSources: {} }); send('state', publicState()); });
  handle('digest:now', () => dailyDigest(true));
  handle('ai:enrich', async () => enrichDeals(30));
  handle('ai:classify', async () => classifyDeals(40));
  handle('deal:fav', (id, fav) => { const d = store.deals.find((x) => x.id === id); if (d) { d.fav = !!fav; store.saveDealsSoon(); if (fav) learnFrom(d, true); } });
  handle('learn:label', (id, label) => { const d = store.deals.find((x) => x.id === id); if (!d) throw new Error(L('条目不存在')); learnFrom(d, !!label); if (!label && d.status === 'new') { d.status = 'ignored'; d.read = true; store.saveDealsSoon(); } send('state', publicState()); return true; });
  handle('fx:refresh', async () => { await refreshFx(true); send('state', publicState()); return store.config.fx || null; });
  handle('deal:remove', (ids) => { const set = new Set(ids); store.deals = store.deals.filter((d) => !set.has(d.id)); store.saveDealsSoon(); send('state', publicState()); updateTray(); });
  handle('deal:clear', () => { store.deals = store.deals.filter((d) => d.fav); store.saveDealsNow(); send('state', publicState()); updateTray(); });
  handle('deal:open', (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
  handle('clipboard:write', (t) => clipboard.writeText(String(t)));
  handle('deal:export', async (ids) => {
    const set = ids ? new Set(ids) : null;
    const list = set ? store.deals.filter((d) => set.has(d.id)) : store.deals;
    const n = new Date(); const stamp = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}-${String(n.getHours()).padStart(2, '0')}${String(n.getMinutes()).padStart(2, '0')}`;
    const r = SHOT_DIR ? { canceled: false, filePath: path.join(SHOT_DIR, `export-test-${stamp}.csv`) }
      : await dialog.showSaveDialog(win, { title: (L('导出') + " CSV"), defaultPath: path.join(app.getPath('downloads'), `${L('优惠雷达')}-${stamp}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return null;
    try { fs.writeFileSync(r.filePath, toCSV(list, brandName)); } catch (e) { throw new Error(L('写入失败：') + (e.code === 'EBUSY' || e.code === 'EPERM' ? L('文件被占用（是否已在 Excel 中打开？）') : e.message)); }
    return { path: r.filePath, count: list.length };
  });
  handle('data:openDir', () => shell.openPath(app.getPath('userData')));

  handle('win:min', () => win && win.minimize());
  handle('win:max', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
  handle('win:close', () => win && win.close());
  handle('win:isMax', () => !!(win && win.isMaximized()));
}

// —— 自动截图测试模式（仅开发测试用：DEAL_RADAR_SHOT=目录） ——
let mockInfo = null;
async function shotMode() {
  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shoot = async (name) => { await wait(1200); const img = await wc.capturePage(); fs.writeFileSync(path.join(SHOT_DIR, name), img.toPNG()); console.log('[shot]', name); };
  const js = (code) => wc.executeJavaScript(code);
  // 本地模拟 OpenAI 兼容接口：自动化测试 AI 辅助添加（无需真实 Key）
  if (process.env.DEAL_RADAR_MOCK_LLM) {
    const { startMockLLM } = require('./mock-llm');
    const mock = await startMockLLM(0); mockInfo = mock;
    await js(`window.__mock = ${JSON.stringify({ baseUrl: mock.baseUrl, key: mock.key })}`);
    console.log('[mock-llm]', mock.baseUrl);
  }
  if (process.env.DEAL_RADAR_SHOT_SET === 'offline') {
    await shoot('20-first-launch-loading.png');
    await poll(L('测试'));
    await js(`window.__test.go('deals')`); await shoot('21-offline-deals.png');
    await js(`window.__test.go('sources')`); await shoot('22-offline-sources.png');
    console.log('[summary]', JSON.stringify(await js(`window.__test.summary()`)));
    quitting = true; app.quit(); return;
  }
  if (process.env.DEAL_RADAR_SHOT_SET === 'v26') {
    // v2.6：新功能截图（中文界面）+ 冒烟检查
    const R = {};
    { const rl = new Promise((res) => { wc.once('did-finish-load', res); setTimeout(res, 8000); }); await js(`window.api.call('settings:save', { lang: 'zh-CN' })`); await rl; await wait(1200); }
    await poll(L('测试'));
    R.recheck = await recheckLanding(true);
    await js(`window.__test.go('deals')`); await js(`document.querySelector('#viewSeg [data-v=table]').click()`); await wait(400);
    R.vbadges = await js(`document.querySelectorAll('#dealList .tag.vs').length`);
    await shoot('v26-1-validity-table.png');
    await js(`(() => { const s = document.querySelector('#fValid'); s.value = 'expired'; s.dispatchEvent(new Event('change')); })()`); await wait(300);
    R.expiredShown = await js(`document.querySelectorAll('#dealList tbody tr').length`);
    await shoot('v26-1b-validity-expired-filter.png');
    await js(`(() => { const s = document.querySelector('#fValid'); s.value = ''; s.dispatchEvent(new Event('change')); })()`);
    await js(`window.api.call('settings:save', { profile: { region: 'cn', student: false, userType: 'existing', pay: ['alipay', 'wechat'] } })`); await wait(800);
    await js(`window.__test.go('settings')`); await wait(300); await js(`document.querySelector('#profileCard').scrollIntoView()`); await shoot('v26-2-profile-settings.png');
    await js(`window.__test.go('deals')`); const before = await js(`document.querySelectorAll('#dealList tbody tr').length`);
    await js(`document.querySelector('#fMine').click()`); await wait(300); R.mine = [before, await js(`document.querySelectorAll('#dealList tbody tr').length`)];
    await shoot('v26-2b-applies-to-me-filter.png');
    await js(`document.querySelector('#fMine').click()`);
    await js(`(() => { const q = document.querySelector('#q'); q.value = 'claude'; q.dispatchEvent(new Event('input')); })()`); await wait(600);
    R.lookup = await js(`(() => { const c = document.querySelector('#vLookup .vl-card'); return c ? c.querySelector('.vl-t b').textContent : null; })()`);
    await shoot('v26-3-vendor-lookup-claude.png');
    await js(`(() => { const q = document.querySelector('#q'); q.value = window.__test.state().brands.find((b) => b.id === 'aws').aliases.slice(-1)[0]; q.dispatchEvent(new Event('input')); })()`); await wait(600);
    R.lookupZh = await js(`(() => { const c = document.querySelector('#vLookup .vl-card'); return c ? c.querySelector('.vl-t b').textContent : null; })()`);
    await shoot('v26-3b-vendor-lookup-zh-alias.png');
    await js(`(() => { const q = document.querySelector('#q'); q.value = ''; q.dispatchEvent(new Event('input')); })()`); await wait(500);
    // 选一条带注意事项 / 优惠码的优惠打开详情
    R.guide = await js(`(() => { const ds = window.__test.state().deals.filter((d) => d.guide && (d.offerTypes || []).length && !(d.vstat && d.vstat.status === 'expired')); const best = ds.find((d) => d.guide.code) || ds.find((d) => d.guide.warnings.length >= 2) || ds.find((d) => d.guide.warnings.length) || ds[0]; if (!best) return null; window.__test.select(best.id); return { id: best.id, kind: best.guide.kind, w: best.guide.warnings, code: best.guide.code, url: best.guide.claimUrl }; })()`);
    await wait(600); R.guideShown = await js(`!!document.querySelector('#detail .guide')`);
    await js(`(() => { const g = document.querySelector('#detail .guide'); if (g) g.scrollIntoView({ block: 'center' }); })()`); await wait(300);
    await shoot('v26-4-claim-guide-dark.png');
    await js(`document.querySelector('#btnTheme').click()`); await wait(700); await shoot('v26-4b-claim-guide-light.png');
    await js(`window.__test.go('coverage')`); await wait(500);
    R.coverage = await js(`document.querySelectorAll('#covBody tbody tr').length`);
    await shoot('v26-5-coverage-light.png');
    await js(`document.querySelector('#btnTheme').click()`); await wait(700); await shoot('v26-5b-coverage-dark.png');
    await js(`window.api.call('settings:save', { profile: { region: 'any', student: false, userType: 'any', pay: [] } })`); await wait(500);
    console.log('[v26]', JSON.stringify(R));
    quitting = true; app.quit(); return;
  }
  if (process.env.DEAL_RADAR_SHOT_SET === 'gaps') {
    // v2.5.2：标签间距回归截图（英文界面、表格视图、详情面板、深/浅色）
    const pre = process.env.DEAL_RADAR_SHOT_PREFIX || 'g';
    await poll(L('测试'));
    const rl = new Promise((res) => { wc.once('did-finish-load', res); setTimeout(res, 8000); }); await js(`window.api.call('settings:save', { lang: 'en' })`); await rl; await wait(1500);
    await js(`window.__test.go('deals')`); await js(`document.querySelector('#viewSeg [data-v=table]').click()`); await shoot(pre + '-table-dark.png');
    await js(`document.querySelector('.grid tbody tr') && document.querySelector('.grid tbody tr').click()`); await shoot(pre + '-detail-dark.png');
    await js(`document.querySelector('#btnTheme').click()`); await wait(800); await shoot(pre + '-detail-light.png');
    await js(`document.querySelector('#viewSeg [data-v=cards]').click()`); await shoot(pre + '-cards-light.png');
    console.log('[gaps]', await js(`(() => { const c = document.querySelector('.grid td.nw .tags') || document.querySelector('.grid td.nw'); return c ? getComputedStyle(c).display + ' gap=' + getComputedStyle(c).columnGap : 'n/a'; })()`));
    await js(`document.querySelector('#btnTheme').click()`); await js(`window.api.call('settings:save', { lang: 'zh-CN' })`); await wait(1500);
    quitting = true; app.quit(); return;
  }
  if (process.env.DEAL_RADAR_SHOT_SET === 'icons') {
    // v2.5.1：图标渲染回归截图（深/浅色、刷新中状态、复现旧 bug）
    await poll(L('测试'));
    await js(`window.__test.go('deals')`); await js(`document.querySelector('#viewSeg [data-v=table]').click()`);
    await js(`(() => { const b = document.querySelector('#btnRefresh'); b.classList.add('spin'); b.disabled = true; })()`); await shoot('i0-before-spin-bug.png');
    await js(`(() => { const b = document.querySelector('#btnRefresh'); b.classList.remove('spin'); b.classList.add('busy'); b.querySelector('span').textContent = '${L('刷新中')}…'; })()`); await shoot('i1-after-refreshing-dark.png');
    await js(`(() => { const b = document.querySelector('#btnRefresh'); b.classList.remove('busy'); b.disabled = false; b.querySelector('span').textContent = '${L('立即刷新')}'; })()`); await shoot('i2-after-dark.png');
    await js(`document.querySelector('#btnTheme').click()`); await wait(800); await shoot('i3-after-light.png');
    const r = await js(`({ svgs: document.querySelectorAll('svg.i').length, legacy: document.querySelectorAll('svg:not(.i)').length, ph: document.querySelectorAll('i[data-ic]').length, logos: [...document.querySelectorAll('img.blogo')].filter((i) => !(i.complete && i.naturalWidth >= 64)).length, emoji: (document.body.innerText.match(/[\u2728\u2605\u2606\u2715\u25B6\u26A0\u{1F310}]/gu) || []).length, btn: (() => { const r = document.querySelector('#btnRefresh').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() })`);
    console.log('[icons]', JSON.stringify(r));
    await js(`document.querySelector('#btnTheme').click()`); await wait(500);
    quitting = true; app.quit(); return;
  }
  if (!process.env.DEAL_RADAR_SHOT_SET) { await js(`window.__test.welcomeModal()`); await shoot('00-welcome.png'); await js(`window.__test.closeModal()`); }
  await poll(L('测试'));
  if (process.env.DEAL_RADAR_SHOT_SET === 'e2e') {
    const results = await js(`window.__test.e2e()`);
    for (const r of results) console.log(r.ok ? '[e2e] PASS' : '[e2e] FAIL', r.name, r.info || '');
    await shoot('30-e2e-final.png');
    store.saveDealsNow();
    // 重新读取磁盘，验证持久化
    const { Store } = require('./core/store');
    const s2 = new Store(app.getPath('userData'));
    console.log(s2.config.brands.find((b) => b.name === 'Grammarly') ? '[e2e] PASS' : '[e2e] FAIL', 'persisted brand on disk');
    console.log(s2.deals.some((d) => d.fav) ? '[e2e] PASS' : '[e2e] FAIL', 'persisted favourite on disk');
    // v2.4：运行中切换界面语言（不重启程序，界面重新加载）
    const reloaded = () => new Promise((res) => { wc.once('did-finish-load', res); setTimeout(res, 8000); });
    let rl = reloaded(); await js(`window.api.call('settings:save', { lang: 'en' })`); await rl; await wait(1500);
    const en1 = await js(`({ lang: document.documentElement.lang, nav: document.querySelector('[data-view=home]').textContent.trim(), set: document.querySelector('#sLang') ? 1 : 0 })`);
    console.log(en1.lang === 'en' && /Today/.test(en1.nav) ? '[e2e] PASS' : '[e2e] FAIL', 'v2.4 live switch to English (no restart)', JSON.stringify(en1));
    console.log(I18N.lang === 'en' && appName() === 'AI Deal Radar' ? '[e2e] PASS' : '[e2e] FAIL', 'v2.4 main process language (tray/notifications) =', I18N.lang);
    await js(`window.__test.go('home')`); await shoot('e2e-lang-en.png');
    rl = reloaded(); await js(`window.api.call('settings:save', { lang: 'zh-CN' })`); await rl; await wait(1500);
    const zh1 = await js(`({ lang: document.documentElement.lang, nav: document.querySelector('[data-view=home]').textContent.trim() })`);
    console.log(zh1.lang === 'zh-CN' && /今日要点/.test(zh1.nav) ? '[e2e] PASS' : '[e2e] FAIL', 'v2.4 switch back to Chinese', JSON.stringify(zh1));
    console.log(new Store(app.getPath('userData')).config.settings.lang === 'zh-CN' ? '[e2e] PASS' : '[e2e] FAIL', 'v2.4 language persisted');
    quitting = true; app.quit(); return;
  }
  if (process.env.DEAL_RADAR_SHOT_SET === 'en') {
    // v2.4：英文界面截图 + 硬编码中文残留扫描（translate="no" 的内容区除外）
    const leftover = async (view) => { const r = await js(`(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const el = n.parentElement; if (!el || !el.offsetParent && el.tagName !== 'OPTION' || el.closest('[translate="no"],script,style')) continue; if (/[\u3400-\u9fff]/.test(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 40)); } return out; })()`); console.log(r.length ? '[i18n] LEFT' : '[i18n] CLEAN', view, r.length, JSON.stringify([...new Set(r)].slice(0, 12))); return r.length; };
    let left = 0;
    await js(`window.__test.welcomeModal()`); await shoot('en-00-welcome.png'); left += await leftover('welcome'); await js(`window.__test.closeModal()`);
    await js(`window.__test.go('home')`); await shoot('en-01-home.png'); left += await leftover('home');
    await js(`window.__test.go('deals')`); await shoot('en-02-deals-cards.png'); left += await leftover('deals');
    await js(`(() => { const d = window.__test.state().deals.find((x) => x.facts && x.facts.amount && x.facts.trust); if (d) window.__test.select(d.id); })()`); await shoot('en-03-detail-facts.png'); left += await leftover('detail');
    await js(`window.__test.closeDetail(); window.__test.setView('table')`); await shoot('en-04-deals-table.png'); left += await leftover('table');
    await js(`window.__test.setView('timeline')`); await shoot('en-05-timeline.png'); await js(`window.__test.setView('cards')`);
    await js(`window.__test.go('brands')`); await shoot('en-06-brands.png'); left += await leftover('brands');
    await js(`window.__test.openVendor('openai')`); await shoot('en-07-vendor-openai.png'); left += await leftover('vendor');
    await js(`window.__test.go('health')`); await shoot('en-08-health.png'); left += await leftover('health');
    await js(`window.__test.go('rules')`); await shoot('en-09-rules.png'); left += await leftover('rules');
    await js(`window.__test.go('settings')`); await shoot('en-10-settings.png'); left += await leftover('settings');
    await js(`window.__test.go('logs')`); await shoot('en-13-logs.png'); left += await leftover('logs');
    if (mockInfo) {
      saveAI({ provider: 'custom', baseUrl: mockInfo.baseUrl, model: 'mock-model', apiKey: mockInfo.key });
      let n = 0; for (let k = 0; k < 6; k++) { const m = await enrichDeals(20); n += m; if (!m) break; } await wait(300);
      const zhDeal = store.deals.find((d) => d.tr && d.tr.en && d.tr.en.title);
      console.log(n > 0 && zhDeal ? '[e2e] PASS' : '[e2e] FAIL', 'v2.4 Chinese offers AI-translated to English (cached per language)', n);
      await js(`window.__test.go('home')`); await shoot('en-11-home-ai-translated.png');
      await js(`window.__test.go('deals'); window.__test.filterBrand('deepseek')`); await shoot('en-12-deals-cn-vendor-translated.png'); await js(`window.__test.filterBrand('')`);
    }
    const logos = await js(`(() => { const imgs = [...document.querySelectorAll('img.blogo')]; return { n: imgs.length, ok: imgs.filter((i) => i.complete && i.naturalWidth >= 64).length }; })()`);
    console.log(logos.n > 10 && logos.ok === logos.n ? '[e2e] PASS' : '[e2e] FAIL', 'v2.4 brand logos render', JSON.stringify(logos));
    console.log('[i18n] total leftovers', left);
    console.log('[summary]', JSON.stringify(await js(`window.__test.summary()`)));
    quitting = true; app.quit(); return;
  }
  await js(`window.__test.go('home')`); await shoot('h1-home.png');
  await js(`window.__test.go('deals')`); await shoot('01-deals-cards-dark.png');
  console.log('[offers]', JSON.stringify(await js(`window.__test.offerSample()`)));
  await js(`window.__test.selectFirst()`); await shoot('02-deal-detail.png');
  await js(`(() => { const d = window.__test.state().deals.find((x) => x.facts && x.facts.amount && x.facts.trust); if (d) window.__test.select(d.id); })()`); await shoot('h2-detail-facts.png');
  await js(`(() => { const d = window.__test.state().deals.find((x) => (x.offerTypes || []).length && !(x.offerTypes || []).includes('pricing')); if (d) window.__test.notOfferModal(d.id); })()`); await shoot('h3-not-offer-modal.png');
  await js(`window.__test.closeModal()`);
  if (mockInfo) {
    saveAI({ provider: 'custom', baseUrl: mockInfo.baseUrl, model: 'mock-model', apiKey: mockInfo.key });
    await enrichDeals(20); await wait(300);
    await js(`window.__test.go('home')`); await shoot('h4-home-ai-zh.png');
    await js(`window.__test.go('deals')`);
  }
  await js(`window.__test.go('settings'); document.querySelector('#sMinConf').scrollIntoView({ block: 'center' })`); await shoot('h5-settings-notify.png');
  await js(`document.querySelector('#sHideResellers') && document.querySelector('#sHideResellers').closest('.row').scrollIntoView({ block: 'center' })`); await shoot('h6-settings-v25.png');
  await js(`window.__test.go('home')`); await shoot('h7-home-empty-hints.png');
  await js(`window.__test.go('deals')`);
  await js(`window.__test.closeDetail(); window.__test.setView('table')`); await shoot('03-deals-table.png');
  await js(`window.__test.filterBrand('openai')`); await shoot('04-filter-brand-openai.png');
  await js(`window.__test.filterBrand(''); window.__test.setNews(true)`); await shoot('04b-with-vendor-news.png');
  await js(`window.__test.setNews(false); window.__test.filterType('free')`); await shoot('04c-type-free.png');
  await js(`window.__test.filterType('')`);
  await js(`window.__test.filterBrand(''); window.__test.go('brands')`); await shoot('05-brands.png');
  await js(`document.querySelector('#brandTabs [data-tab=agent]').click()`); await shoot('05g-brands-tab-agent.png');
  await js(`document.querySelector('#brandTabs [data-tab=cloud]').click()`); await shoot('05h-brands-tab-cloud.png');
  await js(`document.querySelector('#brandTabs [data-tab=all]').click()`);
  await js(`window.__test.openVendor('manus')`); await shoot('05i-vendor-manus-channels.png');
  await js(`window.__test.openVendor('cursor')`); await shoot('05b-vendor-cursor-channels.png');
  await js(`window.__test.openVendor('openai')`); await shoot('05c-vendor-openai-channels.png');
  await js(`window.__test.snapshot('cursor', 'pricing')`); await shoot('05d-page-snapshot.png');
  await js(`window.__test.closeModal(); window.__test.openVendor('cursor'); window.__test.channelModal('cursor'); const p = document.querySelector('#cmProto'); p.value = 'hn'; p.dispatchEvent(new Event('change')); document.querySelector('#cf_query').value = 'Cursor'; document.querySelector('[data-m=previewChannel]').click()`); await wait(5000); await shoot('05e-channel-add-modal.png');
  await js(`(() => { const p = document.querySelector('#cmProto'); p.value = 'json'; p.dispatchEvent(new Event('change')); })()`); await shoot('05f-channel-protocol-json.png');
  await js(`window.__test.closeModal(); window.__test.go('brands')`);
  if (process.env.DEAL_RADAR_DEMO_DIFF) {
    // 演示用（模拟）：把 Cursor 价格页的基线快照改成“旧价格”，再检测一次，生成价格页变动动态
    const id = 'ch-cursor-pricing'; const pg = store.pages[id];
    if (pg) {
      pg.lines = pg.lines.map((l) => l.replace(/^\$20$/, '$25')).filter((l) => !/^Pro\+?$/.test(l) || Math.random() < 2).concat(['Limited-time: first month $10']); pg.hash = 'demo';
      const src = allSources().find((x) => x.id === id);
      const r = await fetchSource(src, enabledBrands(), { fetchText, pages: store.pages });
      const m = mergeDeals(store.deals, r.items, {}); store.deals = m.all; setStatus(id, r.status); send('state', publicState());
      console.log('[demo-diff]', JSON.stringify(r.status), r.items.map((d) => d.title).join(' | '));
      await wait(500);
      await js(`window.__test.go('deals'); window.__test.filterType('pricing')`); await js(`window.__test.selectFirst()`); await shoot('13-demo-simulated-price-change.png');
      await js(`window.__test.closeDetail(); window.__test.filterType('')`);
    }
  }
  await js(`window.__test.openBrandModal()`); await shoot('06-brand-add-modal.png');
  await js(`window.__test.closeModal(); window.__test.go('sources')`); await shoot('07-sources.png');
  await js(`window.__test.openSourceModal()`); await shoot('08-source-add-modal.png');
  await js(`window.__test.closeModal(); window.__test.go('settings')`); await shoot('09-settings.png');
  await js(`document.querySelector('#sProxyUrl').scrollIntoView({ block: 'center' }); document.querySelector('#btnNetCheck').click()`); await wait(7000); await shoot('09b-settings-proxy.png');
  await js(`document.querySelector('#sConc').scrollIntoView({ block: 'start' })`); await shoot('09c-settings-engine.png');
  await js(`window.__test.go('health')`); await shoot('14-health.png');
  await js(`document.querySelector('#hlTable tbody tr[data-id] [data-act=hlLog]').click()`); await shoot('14b-health-runlog.png');
  await js(`window.__test.closeModal(); window.__test.go('rules')`); await shoot('15-rules.png');
  await js(`document.querySelector('#btnAddRule').click()`); await shoot('15b-rule-modal.png');
  await js(`window.__test.closeModal(); window.__test.go('deals'); window.__test.setView('timeline')`); await shoot('16-timeline.png');
  await js(`window.__test.setView('cards'); document.querySelector('#fSort').value = 'score'; document.querySelector('#fSort').dispatchEvent(new Event('change'))`); await shoot('17-sort-score.png');
  await js(`document.querySelector('#fSort').value = 'pub'; document.querySelector('#fSort').dispatchEvent(new Event('change')); document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))`); await shoot('18-shortcuts.png');
  if (process.env.DEAL_RADAR_MOCK_LLM) {
    await js(`window.__test.closeModal(); window.__test.go('settings'); document.querySelector('#aiProvider').value = 'custom'; document.querySelector('#aiBase').value = window.__mock.baseUrl; document.querySelector('#aiModel').value = 'mock-gpt'; document.querySelector('#aiKey').value = window.__mock.key; document.querySelector('#btnAiSave').click()`);
    await wait(600); await js(`document.querySelector('#btnAiTest').click(); document.querySelector('#aiCard').scrollIntoView({ block: 'start' })`); await wait(1500); await shoot('19-ai-settings.png');
    await js(`window.__test.go('brands'); document.querySelector('#btnAiBrand').click(); document.querySelector('#dvName').value = 'Hugging Face'; document.querySelector('#dvGo').click()`);
    await wait(500); await wc.capturePage().then((img) => fs.writeFileSync(path.join(SHOT_DIR, '19b-ai-discover-progress.png'), img.toPNG())); console.log('[shot]', '19b-ai-discover-progress.png');
    for (let i = 0; i < 90 && !(await js(`!!(window.__test.dv() && window.__test.dv().result)`)); i++) await wait(1000);
    await shoot('19c-ai-discover-review.png');
    await js(`window.__test.closeModal(); window.__test.openVendor('anthropic'); window.__test.channelModal('anthropic'); document.querySelector('#cmSmart').value = 'Claude ${L('的定价页改价提醒')}'; document.querySelector('#cmSmartGo').click()`);
    for (let i = 0; i < 40 && !(await js(`/${L('条')}|${L('行')}|${L('失败')}/.test((document.querySelector('#cmPreview') || {}).textContent || '') && !/${L('识别中')}|${L('正在识别')}/.test(document.querySelector('#cmSmartNote').textContent)`)); i++) await wait(1000);
    await shoot('19d-ai-channel-smart.png');
    await js(`document.querySelector('#cmSmart').value = 'https://huggingface.co/blog'; document.querySelector('#cmSmartGo').click()`);
    for (let i = 0; i < 40 && !(await js(`/RSS|${L('列表')}|${L('变化')}/.test(document.querySelector('#cmSmartNote').textContent) && /${L('条')}|${L('行')}|${L('失败')}/.test(document.querySelector('#cmPreview').textContent)`)); i++) await wait(1000);
    await wait(1500); await shoot('19e-ai-channel-url.png');
    await js(`window.__test.closeModal()`);
  }
  await js(`window.__test.closeModal(); window.__test.go('logs')`); await shoot('10-logs.png');
  await js(`window.__test.setTheme('light'); window.__test.setView('cards'); window.__test.go('deals')`); await shoot('11-deals-cards-light.png');
  await js(`window.__test.go('sources')`); await shoot('12-sources-light.png');
  const res = await js(`window.__test.exportCSV()`);
  console.log('[export]', JSON.stringify(res));
  const summary = await js(`window.__test.summary()`);
  console.log('[summary]', JSON.stringify(summary));
  await js(`window.__test.setTheme('dark'); window.__test.setView('cards')`);
  quitting = true; store.saveDealsNow(); app.quit();
}

app.on('second-instance', showWindow);
app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  loadHttpCache();
  applyLang();
  await applyProxy();
  registerIPC();
  if (SHOT_DIR && process.env.DEAL_RADAR_SHOT_SET !== 'onboarding') store.updateSettings({ onboarded: true });
  createWindow();
  try { nativeTheme.on('updated', () => { if (store && store.config.settings.theme === 'system') { send('runtime', runtime()); send('state', publicState({ light: true })); } }); } catch { /* tests */ }
  createTray();
  applyAutoStart();
  ensurePortableShortcut();
  log(`${appName()} v${app.getVersion()} ${L('已启动')}${PORTABLE_EXE ? L('（便携版）') : ''}${L('，数据目录：')}${app.getPath('userData')}`);
  // 睡眠唤醒 / 解锁后：若已错过计划时间，稍等网络恢复后立即刷新
  const wake = () => { if (!paused && !polling && nextRunAt && Date.now() > nextRunAt - 5000) setTimeout(() => poll(L('唤醒后补刷新')), 15000); };
  try { powerMonitor.on('resume', wake); powerMonitor.on('unlock-screen', wake); } catch { /* 忽略 */ }
  if (SHOT_DIR) { fs.mkdirSync(SHOT_DIR, { recursive: true }); win.webContents.once('did-finish-load', () => shotMode().catch((e) => { console.error(e); app.exit(1); })); return; }
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => poll(L('启动')), 200);
    if (!SHOT_DIR) setTimeout(() => checkForUpdate({ force: false, notify: true }).then((r) => { if (r && r.newer) send('state', publicState()); }).catch((e) => log(L('检查更新失败：') + e.message, 'warn')), 8000);
  });
});
app.on('before-quit', () => { quitting = true; if (store) { store.saveDealsNow(); store.saveConfig(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && (quitting || !tray)) app.quit(); });
