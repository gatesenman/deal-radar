'use strict';
const fs = require('fs');
const path = require('path');
const { refineOffer } = require('./offers');
const { extractFacts } = require('./facts');
const { AI_GROUPS, BRAND_GROUPS, VENDOR_CHANNELS, PRESET_BRANDS, DEFAULT_ENABLED, GOODS_DEFAULT_ENABLED, PRESET_SOURCES, DEFAULT_SETTINGS, DEFAULT_RULES } = require('./defaults');
const { PROTOCOLS } = require('./collectors');
const { normalizeRule } = require('./rules');

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '') || ('b' + Date.now());
}

// 读取 JSON；文件损坏时先备份为 *.corrupt-时间戳 再回退默认值，避免用户数据被静默覆盖
function readJSON(file, fallback) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return fallback; }
  try { return JSON.parse(raw.replace(/^\ufeff/, '')); } catch {
    try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch { /* 忽略 */ }
    return fallback;
  }
}

// 原子写入（tmp + rename）。Windows 上杀毒软件/索引服务偶尔占用目标文件导致 rename 失败（EPERM/EBUSY），
// 此时短暂重试，仍失败则直接覆盖写入；任何异常都不会抛到调用方（避免主进程崩溃）
function writeJSONAtomic(file, data) {
  const json = JSON.stringify(data);
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, json);
    for (let i = 0; i < 3; i++) {
      try { fs.renameSync(tmp, file); return true; } catch (e) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || i === 2) throw e;
        const until = Date.now() + 60; while (Date.now() < until) { /* 短暂等待 */ }
      }
    }
  } catch (e) {
    try { fs.writeFileSync(file, json); try { fs.unlinkSync(tmp); } catch { /* 忽略 */ } return true; } catch (e2) {
      console.error('[store] write failed', file, e2.message);
      return false;
    }
  }
  return false;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cfgFile = path.join(dir, 'config.json');
    this.dealsFile = path.join(dir, 'deals.json');
    this.pagesFile = path.join(dir, 'pages.json'); // 网页变化监控的快照
    const cfg = readJSON(this.cfgFile, null);
    this._rawSettings = cfg && cfg.settings ? { ...cfg.settings } : null;
    this.config = cfg && typeof cfg === 'object' ? this._migrate(cfg) : this._defaults();
    this.deals = readJSON(this.dealsFile, []);
    if (!Array.isArray(this.deals)) this.deals = [];
    this.deals = this.deals.filter((d) => d && typeof d === 'object' && d.id && d.title && d.link && Array.isArray(d.brandIds));
    this.pages = readJSON(this.pagesFile, {});
    if (!this.pages || typeof this.pages !== 'object' || Array.isArray(this.pages)) this.pages = {};
    this.healthFile = path.join(dir, 'health.json'); // 每个渠道最近 40 次运行记录
    this.health = readJSON(this.healthFile, {});
    if (!this.health || typeof this.health !== 'object' || Array.isArray(this.health)) this.health = {};
    // v2.7：价格表历史 / 反馈学习模型 / 汇率缓存
    this.pricesFile = path.join(dir, 'prices.json');
    this.prices = readJSON(this.pricesFile, {}); if (!this.prices || typeof this.prices !== 'object' || Array.isArray(this.prices)) this.prices = {};
    this.learnFile = path.join(dir, 'learn.json');
    this.learn = readJSON(this.learnFile, null); if (!this.learn || typeof this.learn !== 'object' || !this.learn.pos) this.learn = { pos: {}, neg: {}, np: 0, nn: 0, labels: {} };
    if (!Array.isArray(this.config.settings.rules)) this.config.settings.rules = DEFAULT_RULES.map((r) => ({ ...r }));
    this._migrateDeals();
    this._migrateI18n();
    this._migratePrecision(); this._migrateRecheck(); this._migrateCodeNoise(); this._migratePageNoise();
    this._timer = null;
    this.saveConfig();
  }

  // v2.4：多语言——旧版的中文译文（titleZh / aiNote）迁入按语言缓存的 d.tr['zh-CN']；界面语言默认 auto（跟随系统）
  _migrateI18n() {
    const st = this.config.settings;
    if ((Number(st.dealsSchema) || 0) >= 4) return;
    let n = 0;
    for (const d of this.deals) {
      if (d.titleZh && !(d.tr && d.tr['zh-CN'])) { d.tr = { ...(d.tr || {}), 'zh-CN': { title: d.titleZh, note: d.aiNote || '', at: d.enrichedAt || Date.now() } }; n++; }
    }
    if (!['auto', 'zh-CN', 'en'].includes(st.lang)) st.lang = 'auto';
    st.dealsSchema = 4; st.migratedI18n = n;
    if (n) writeJSONAtomic(this.dealsFile, this.deals);
  }

  // v2.7：2.6.1 之前已收录的「CSS 类名变化」页面变化条目，降级为噪音
  // v2.9：旧版产生的「有变化」误报（相对时间、Cookie 横幅、New 徽章等）——按新规则重判，归一化后增删内容相同的降级为噪音
  _migratePageNoise() {
    const st = this.config.settings;
    if ((Number(st.dealsSchema) || 0) >= 8) return;
    const V29 = require('./v29');
    let n = 0;
    for (const d of this.deals) {
      if (!d.pageDiff || d.fav || d.status === 'claimed' || d.feedback === 'noise') continue;
      const add = []; const rm = [];
      for (const l of String(d.summary || '').split('\n')) { if (/^\+ /.test(l)) add.push(l.slice(2)); else if (/^- /.test(l)) rm.push(l.slice(2)); }
      if (/另有 \d+ 行/.test(d.summary || '')) continue; // 片段被截断，无法确认
      const A = new Set(V29.cleanLines(add)); const R = new Set(V29.cleanLines(rm));
      if ([...A].every((x) => R.has(x)) && [...R].every((x) => A.has(x))) { d.offerTypes = []; d.feedback = 'noise'; d.status = 'ignored'; d.read = true; delete d.facts; n++; }
    }
    st.dealsSchema = 8; st.migratedPageNoise = n;
    if (n) writeJSONAtomic(this.dealsFile, this.deals);
  }

  _migrateCodeNoise() {
    const st = this.config.settings;
    if ((Number(st.dealsSchema) || 0) >= 7) return;
    const { isCodeNoise } = require('./monitor');
    let n = 0;
    for (const d of this.deals) { const m = /有变化[：:]\s*(.+)$/.exec(d.title || ''); if (m && isCodeNoise(m[1].replace(/…$/, '')) && !d.fav && d.status !== 'claimed') { d.offerTypes = []; d.feedback = 'noise'; d.status = 'ignored'; d.read = true; delete d.facts; n++; } }
    st.dealsSchema = 7;
    if (n) writeJSONAtomic(this.dealsFile, this.deals);
  }

  // v2.6.1：2.6.0 一次 404 就判「已过期」——把这类未确认的结果改为「待再次确认」，下次复查优先重查
  _migrateRecheck() {
    const st = this.config.settings;
    if ((Number(st.dealsSchema) || 0) >= 6) return;
    let n = 0;
    for (const d of this.deals) if (d.recheck && d.recheck.gone && /^http-/.test(d.recheck.reason || '') && !d.recheck.confirmed) { d.recheck = { ...d.recheck, gone: false, suspect: true }; n++; }
    st.dealsSchema = 6;
    if (n) writeJSONAtomic(this.dealsFile, this.deals);
  }

  // v2.5：用新精度规则重跑 refine（行业评论 / 播客 / 非 AI 购物等）；hideResellers 仅影响新抓取与列表过滤
  _migratePrecision() {
    const st = this.config.settings;
    if ((Number(st.dealsSchema) || 0) >= 5) return;
    const { refineOffer } = require('./offers');
    const kindOf = new Map(this.config.sources.map((s) => [s.id, s.kind]));
    let demoted = 0;
    for (const d of this.deals) {
      if (d.fav || d.status === 'claimed' || (d.offerTypes || []).includes('pricing')) continue;
      if (!(d.offerTypes || []).length) continue;
      const src = this.config.sources.find((s) => s.id === d.sourceId) || {};
      const next = refineOffer(d.title, d.offerTypes, { sub: d.sub || src.sub, kind: kindOf.get(d.sourceId) || src.kind, hideResellers: !!st.hideResellers, aiClass: d.aiClass });
      if (!next.length) { d.offerTypes = []; d.feedback = d.feedback || 'noise'; demoted++; }
      else d.offerTypes = next;
      if ((d.offerTypes || []).length) { try { d.facts = require('./facts').extractFacts(d); } catch {} }
    }
    st.dealsSchema = 5; st.migratedPrecisionDemoted = demoted;
    if (demoted) writeJSONAtomic(this.dealsFile, this.deals);
  }

  // v2.3：已有优惠数据迁移——按新的精度规则重新判定、补充结构化字段与处理状态（只执行一次，保留收藏/已读）
  _migrateDeals() {
    const st = this.config.settings;
    if ((Number(st.dealsSchema) || 0) >= 3) return;
    const kindOf = new Map(this.config.sources.map((s) => [s.id, s.kind]));
    let demoted = 0;
    for (const d of this.deals) {
      if (!d.status) d.status = 'new';
      if (d.category === 'ai' && (d.offerTypes || []).length && !d.fav) {
        const t = refineOffer(d.title, d.offerTypes, { sub: d.sub, kind: kindOf.get(d.sourceId) });
        if (!t.length) demoted++;
        d.offerTypes = t;
      }
      if ((d.offerTypes || []).length) d.facts = extractFacts(d);
    }
    st.dealsSchema = 3; st.migratedDealsDemoted = demoted;
    writeJSONAtomic(this.dealsFile, this.deals);
  }

  _presetChannels(id) {
    return (VENDOR_CHANNELS[id] || []).map(({ on, ...c }) => ({ ...c, enabled: on !== false, preset: true }));
  }

  _presetBrand(b) {
    return {
      id: b.id || slug(b.name), name: b.name, aliases: b.aliases.slice(), exclude: (b.exclude || []).slice(),
      category: b.category || 'ai', group: b.group || (b.category === 'goods' ? 'goods' : 'custom'), ...(b.cs ? { cs: true } : {}), ...(b.noName ? { noName: true } : {}),
      enabled: b.category === 'goods' ? false : DEFAULT_ENABLED.includes(b.name), notify: true, preset: true,
      channels: this._presetChannels(b.id || slug(b.name)),
    };
  }

  _defaults() {
    return {
      version: 5,
      brands: PRESET_BRANDS.map((b) => this._presetBrand(b)),
      sources: PRESET_SOURCES.map((s) => { const { defaultOn, ...rest } = s; return { ...rest, enabled: !!defaultOn, preset: true }; }),
      sourceStatus: {},
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  _migrate(cfg) {
    const d = this._defaults();
    const oldVersion = Number(cfg.version) || 1;
    cfg.settings = { ...d.settings, ...(cfg.settings || {}) };
    cfg.brands = Array.isArray(cfg.brands) ? cfg.brands : d.brands;
    cfg.sources = Array.isArray(cfg.sources) ? cfg.sources : d.sources;
    // 新版本新增的预设源自动补充
    const presetIds = new Set(d.sources.map((s) => s.id));
    cfg.sources = cfg.sources.filter((s) => !s.preset || presetIds.has(s.id)); // 移除已下线的预设源
    for (const s of d.sources) {
      const cur = cfg.sources.find((x) => x.id === s.id);
      if (!cur) cfg.sources.push(s);
      else Object.assign(cur, { ...s, enabled: cur.enabled }); // 预设源随版本更新地址/名称，保留启用状态
    }
    cfg.sourceStatus = cfg.sourceStatus && typeof cfg.sourceStatus === 'object' ? cfg.sourceStatus : {};
    cfg.brands = cfg.brands.filter((b) => b && b.id && b.name).map((b) => ({ ...b, aliases: Array.isArray(b.aliases) ? b.aliases : [], exclude: Array.isArray(b.exclude) ? b.exclude : [], notify: b.notify !== false }));
    // 预设品牌/厂商：补充新增项，并同步分类与匹配参数（保留用户的启用/通知状态和自定义关键词）
    for (const pb of d.brands) {
      const cur = cfg.brands.find((x) => x.id === pb.id) || cfg.brands.find((x) => x.name.toLowerCase() === pb.name.toLowerCase());
      if (!cur) cfg.brands.push({ ...pb, enabled: oldVersion < 4 ? false : pb.enabled });
      else {
        if (cur.preset) Object.assign(cur, { category: pb.category, group: pb.group, cs: pb.cs, noName: pb.noName });
        // 预设渠道：补充新增、同步地址，保留启用状态与用户自定义渠道
        const chs = Array.isArray(cur.channels) ? cur.channels : [];
        const ids = new Set(pb.channels.map((c) => c.id));
        cur.channels = chs.filter((c) => !c.preset || ids.has(c.id));
        for (const pc of pb.channels) { const cc = cur.channels.find((c) => c.id === pc.id); if (!cc) cur.channels.push(pc); else if (cc.preset) Object.assign(cc, { ...pc, enabled: cc.enabled }); }
      }
    }
    for (const b of cfg.brands) { if (!b.category) b.category = 'ai'; if (!b.group) b.group = b.category === 'goods' ? 'goods' : 'custom'; if (!Array.isArray(b.channels)) b.channels = []; }
    // v2.0 移除的小众预设厂商：未启用则删除，已启用则转为自定义厂商（保留用户数据）
    const presetBrandIds = new Set(d.brands.map((b) => b.id));
    cfg.brands = cfg.brands.filter((b) => !b.preset || presetBrandIds.has(b.id) || b.enabled);
    for (const b of cfg.brands) if (b.preset && !presetBrandIds.has(b.id)) { b.preset = false; b.channels = (b.channels || []).filter((c) => !c.preset); }
    // 已有配置升级：老用户视为已完成引导
    if (cfg.settings.onboarded === false && oldVersion === 1 && !('onboarded' in (this._rawSettings || {}))) cfg.settings.onboarded = true;
    if (oldVersion < 3) {
      // v1.2：主打 AI/软件厂商优惠。老用户保留实物商品监控（goodsEnabled），并重新显示欢迎页以选择 AI 厂商
      const hadGoods = cfg.brands.some((b) => b.category === 'goods' && b.enabled);
      cfg.settings.goodsEnabled = hadGoods;
      for (const s of cfg.sources) if (s.category === 'goods' && !hadGoods) s.enabled = false;
      cfg.settings.onboarded = false;
    }
    if (oldVersion < 5) {
      // v2.2：AI 大模型 / 智能体 / 创作工具类预设厂商一次性全部启用（用户安装后明确关闭的除外）
      let n = 0;
      for (const b of cfg.brands) if (b.preset && AI_GROUPS.includes(b.group) && !b.userOff && !b.enabled) { b.enabled = true; n++; }
      cfg.settings.migratedV5 = n;
    }
    cfg.version = 5;
    return cfg;
  }

  // 开关「实物商品」：同时启用/停用实物数据源；首次开启时启用默认实物品牌
  setGoodsEnabled(on) {
    on = !!on;
    this.config.settings.goodsEnabled = on;
    for (const s of this.config.sources) if (s.preset && s.category === 'goods') s.enabled = on;
    const goods = this.config.brands.filter((b) => b.category === 'goods');
    if (on && !goods.some((b) => b.enabled)) for (const b of goods) if (GOODS_DEFAULT_ENABLED.includes(b.name)) b.enabled = true;
    this.saveConfig();
    return this.config;
  }

  saveConfig() { writeJSONAtomic(this.cfgFile, this.config); }

  saveDealsSoon() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveDealsNow(), 500);
  }
  saveDealsNow() { clearTimeout(this._timer); writeJSONAtomic(this.dealsFile, this.deals); }

  // —— 品牌 ——
  upsertBrand(b) {
    const name = String(b.name || '').trim();
    if (!name) throw new Error('厂商/品牌名称不能为空');
    const aliases = (b.aliases || []).map((s) => String(s).trim()).filter(Boolean);
    const exclude = (b.exclude || []).map((s) => String(s).trim()).filter(Boolean);
    let brand = b.id && this.config.brands.find((x) => x.id === b.id);
    if (brand) {
      if (this.config.brands.find((x) => x.id !== brand.id && x.name.toLowerCase() === name.toLowerCase())) throw new Error('厂商/品牌已存在：' + name);
      Object.assign(brand, { name, aliases, exclude, enabled: b.enabled ?? brand.enabled, notify: b.notify ?? brand.notify ?? true, category: b.category === 'goods' || b.category === 'ai' ? b.category : (brand.category || 'ai') });
      if (b.enabled === false) brand.userOff = true; else if (b.enabled === true) brand.userOff = false;
      if (b.group && BRAND_GROUPS.some((g) => g.id === b.group)) brand.group = b.group;
    } else {
      if (this.config.brands.find((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error('厂商/品牌已存在：' + name);
      let id = slug(name); while (this.config.brands.find((x) => x.id === id)) id += '-1';
      brand = { id, name, aliases, exclude, category: b.category === 'goods' ? 'goods' : 'ai', group: BRAND_GROUPS.some((g) => g.id === b.group) ? b.group : (b.category === 'goods' ? 'goods' : 'custom'), enabled: b.enabled ?? true, notify: b.notify ?? true, preset: false };
      this.config.brands.push(brand);
    }
    this.saveConfig();
    return brand;
  }
  removeBrand(id) {
    this.config.brands = this.config.brands.filter((b) => b.id !== id);
    this.saveConfig();
  }
  setBrandNotify(id, notify) {
    const b = this.config.brands.find((x) => x.id === id); if (b) { b.notify = !!notify; this.saveConfig(); }
  }
  setBrandEnabled(id, enabled) {
    const b = this.config.brands.find((x) => x.id === id); if (b) { b.enabled = !!enabled; b.userOff = !enabled; this.saveConfig(); }
  }

  // v2.2：按分组批量启用/停用
  setGroupEnabled(group, enabled) {
    let n = 0;
    for (const b of this.config.brands) if ((b.group || 'custom') === group && b.enabled !== !!enabled) { b.enabled = !!enabled; b.userOff = !enabled; n++; }
    this.saveConfig(); return n;
  }

  // —— 厂商渠道 ——
  upsertChannel(brandId, c) {
    const b = this.config.brands.find((x) => x.id === brandId); if (!b) throw new Error('厂商不存在');
    b.channels = b.channels || [];
    const ch0 = normalizeChannel(c);
    let ch = c.id && b.channels.find((x) => x.id === c.id);
    if (ch) { const keep = { id: ch.id, enabled: ch.enabled, preset: ch.preset }; for (const k of Object.keys(ch)) delete ch[k]; Object.assign(ch, ch0, keep); }
    else {
      if (ch0.url && b.channels.some((x) => x.url === ch0.url && x.type === ch0.type)) throw new Error('该厂商已有相同地址的渠道');
      ch = { id: 'c' + Date.now().toString(36), ...ch0, enabled: true, preset: false }; b.channels.push(ch);
    }
    this.saveConfig(); return ch;
  }
  removeChannel(brandId, chId) {
    const b = this.config.brands.find((x) => x.id === brandId); if (!b) return;
    b.channels = (b.channels || []).filter((c) => c.id !== chId);
    delete this.config.sourceStatus[`ch-${brandId}-${chId}`]; delete this.pages[`ch-${brandId}-${chId}`];
    this.saveConfig(); this.savePages();
  }
  setChannelEnabled(brandId, chId, on) {
    const b = this.config.brands.find((x) => x.id === brandId); const c = b && (b.channels || []).find((x) => x.id === chId);
    if (c) { c.enabled = !!on; this.saveConfig(); }
  }
  savePages() { writeJSONAtomic(this.pagesFile, this.pages); }

  // —— 渠道健康度 ——
  recordHealth(id, st) {
    const h = this.health[id] = Array.isArray(this.health[id]) ? this.health[id] : [];
    h.push({ t: st.lastRun || Date.now(), ok: !!st.ok, ms: st.ms || 0, n: st.total || 0, m: st.matched || 0, e: st.ok ? '' : String(st.error || '').slice(0, 160), c: st.cached ? 1 : 0, note: st.note ? String(st.note).slice(0, 80) : undefined });
    if (h.length > 40) h.splice(0, h.length - 40);
  }
  saveHealth() { writeJSONAtomic(this.healthFile, this.health); }
  savePrices() { writeJSONAtomic(this.pricesFile, this.prices); }
  saveLearn() { writeJSONAtomic(this.learnFile, this.learn); }

  // —— 规则 ——
  saveRules(rules) { this.config.settings.rules = (rules || []).map(normalizeRule); this.saveConfig(); return this.config.settings.rules; }

  // —— 配置导入 / 导出 ——
  exportConfig() {
    const { windowBounds, ai, ...settings } = this.config.settings;
    if (ai) settings.ai = { provider: ai.provider, baseUrl: ai.baseUrl, model: ai.model }; // 导出不含 API Key
    return { app: 'DealRadar', format: 2, exportedAt: new Date().toISOString(), brands: this.config.brands, sources: this.config.sources, settings };
  }
  importConfig(obj) {
    if (!obj || obj.app !== 'DealRadar' || !Array.isArray(obj.brands)) throw new Error('不是全网优惠雷达的配置文件');
    const keep = { windowBounds: this.config.settings.windowBounds, onboarded: true };
    const curAi = this.config.settings.ai;
    if (obj.settings && obj.settings.ai) keep.ai = { provider: obj.settings.ai.provider, baseUrl: obj.settings.ai.baseUrl, model: obj.settings.ai.model, keyEnc: curAi && curAi.baseUrl === obj.settings.ai.baseUrl ? curAi.keyEnc : undefined };
    else if (curAi) keep.ai = curAi;
    const cfg = this._migrate({ version: 5, brands: obj.brands, sources: Array.isArray(obj.sources) ? obj.sources : [], settings: { ...(obj.settings || {}), ...keep }, sourceStatus: {} });
    this.config = cfg; if (!Array.isArray(cfg.settings.rules)) cfg.settings.rules = DEFAULT_RULES.map((r) => ({ ...r }));
    this.saveConfig(); return { brands: cfg.brands.length, sources: cfg.sources.length };
  }

  // —— 数据源 ——
  addSource(s) {
    const url = String(s.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('请输入以 http(s):// 开头的 RSS/Atom 地址');
    if (this.config.sources.find((x) => x.url === url && !s.allowDup)) throw new Error('该地址已存在');
    const src = {
      id: 'custom-' + Date.now().toString(36), name: String(s.name || '').trim() || new URL(url).hostname,
      platform: s.platform || '自定义', region: s.region || 'intl', country: s.country || '自定义',
      kind: url.includes('{q}') ? 'search' : (['vendor', 'community', 'deal', 'news'].includes(s.kind) ? s.kind : 'community'), url, enabled: true, preset: false,
      category: s.category === 'goods' || s.kind === 'deal' ? 'goods' : 'ai',
      ...(s.type && s.type !== 'rss' && PROTOCOLS[s.type] ? { type: s.type, opts: s.opts || {} } : {}),
    };
    this.config.sources.push(src); this.saveConfig(); return src;
  }
  removeSource(id) {
    this.config.sources = this.config.sources.filter((s) => s.id !== id || s.preset);
    delete this.config.sourceStatus[id]; this.saveConfig();
  }
  setSourceEnabled(id, enabled) {
    const s = this.config.sources.find((x) => x.id === id); if (s) { s.enabled = !!enabled; this.saveConfig(); }
  }

  updateSettings(patch) {
    const p = { ...(patch || {}) };
    if ('lang' in p && !['auto', 'zh-CN', 'en'].includes(p.lang)) delete p.lang;
    if ('hideResellers' in p) p.hideResellers = !!p.hideResellers;
    for (const k of ['hideExpired', 'notifyMineOnly', 'filterMine', 'adaptivePolling', 'learnEnabled']) if (k in p) p[k] = !!p[k];
    if ('recheckHours' in p) p.recheckHours = Math.min(168, Math.max(2, Number(p.recheckHours) || 12));
    if ('profile' in p) {
      const q = p.profile || {};
      p.profile = { region: ['any', 'cn', 'overseas'].includes(q.region) ? q.region : 'any', student: !!q.student, userType: ['any', 'new', 'existing'].includes(q.userType) ? q.userType : 'any',
        pay: [...new Set((Array.isArray(q.pay) ? q.pay : []).filter((x) => ['unionpay', 'alipay', 'wechat', 'card'].includes(x)))] };
    }
    if ('aiClassify' in p) p.aiClassify = !!p.aiClassify;
    if ('enrichLimit' in p) p.enrichLimit = Math.min(80, Math.max(10, Number(p.enrichLimit) || 40));
    // 数值类设置做边界保护，防止异常值导致疯狂轮询或清空数据
    if ('intervalMinutes' in p) p.intervalMinutes = Math.min(1440, Math.max(5, Number(p.intervalMinutes) || 15));
    if ('maxAgeDays' in p) p.maxAgeDays = Math.min(365, Math.max(1, Number(p.maxAgeDays) || 30));
    if ('notifyMax' in p) p.notifyMax = Math.min(20, Math.max(1, Number(p.notifyMax) || 5));
    if ('proxyUrl' in p) p.proxyUrl = String(p.proxyUrl || '').trim();
    if ('notifyMinConf' in p) p.notifyMinConf = Math.min(100, Math.max(0, Number(p.notifyMinConf) || 0));
    for (const k of ['quietStart', 'quietEnd', 'digestTime']) if (k in p && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(p[k]))) delete p[k];
    if ('noiseWords' in p) p.noiseWords = [...new Set((Array.isArray(p.noiseWords) ? p.noiseWords : []).map((w) => String(w).trim()).filter((w) => w.length >= 2))].slice(0, 200);
    delete p.channels; delete p.views; // v2.8：推送渠道（含密钥）/ 视图只能通过各自的接口修改
    for (const k of ['weeklyDigest']) if (k in p) p[k] = !!p[k];
    if ('weeklyDay' in p) p.weeklyDay = Math.min(6, Math.max(0, Math.floor(Number(p.weeklyDay)) || 0));
    delete p.ai; // AI 配置（含加密的 Key）只能通过 setAI 修改
    Object.assign(this.config.settings, p); this.saveConfig(); return this.config.settings;
  }

  setAI(ai) { this.config.settings.ai = ai; this.saveConfig(); return ai; }

  resetDefaults() {
    const deals = this.deals;
    const keep = { windowBounds: this.config.settings.windowBounds, trayHintShown: this.config.settings.trayHintShown, onboarded: true, proxyUrl: this.config.settings.proxyUrl };
    this.config = this._defaults(); Object.assign(this.config.settings, keep); this.saveConfig(); this.deals = deals;
  }
}

// 渠道配置校验与规范化（所有协议共用）
function normalizeChannel(c) {
  const type = PROTOCOLS[c.type] ? c.type : 'rss';
  const str = (v) => String(v ?? '').trim();
  const url = str(c.url); const keyword = str(c.keyword);
  const opts = {}; for (const [k, v] of Object.entries(c.opts || {})) { if (v !== '' && v != null && v !== false) opts[k] = typeof v === 'string' ? v.trim() : v; }
  const needUrl = ['rss', 'jsonfeed', 'json', 'html', 'page', 'render', 'sitemap', 'discourse'].includes(type);
  if (needUrl && !/^https?:\/\/\S+$/i.test(url)) throw new Error('请输入以 http(s):// 开头的地址');
  if (type === 'search' && !keyword) throw new Error('请填写搜索关键词');
  const need = { github: 'repo', reddit: 'sub', telegram: 'channel', bluesky: 'handle', youtube: 'channelId', appstore: 'appId', gplay: 'pkg', rsshub: 'route', hn: 'query', json: 'itemsPath', html: 'list' };
  if (need[type] && type !== 'json' && !opts[need[type]]) throw new Error('请填写「' + need[type] + '」');
  if (type === 'mastodon' && !opts.acct && !opts.tag) throw new Error('请填写 Mastodon 账号或话题');
  if (c.regex) { try { new RegExp(c.regex); } catch { throw new Error('正则表达式无效'); } }
  const label = PROTOCOLS[type].label.replace(/（.*$/, '');
  const auto = type === 'search' ? '搜索：' + keyword : url ? (() => { try { return new URL(url).hostname; } catch { return url; } })() : label + ' ' + (Object.values(opts)[0] || '');
  const out = { type, name: str(c.name) || auto, url, keyword, selector: str(c.selector), opts,
    sub: c.sub || (type === 'page' || type === 'render' ? 'pricing' : type === 'search' ? 'news' : type === 'appstore' || type === 'gplay' ? 'app' : ['bluesky', 'mastodon', 'telegram', 'rsshub'].includes(type) ? 'social' : type === 'github' ? 'github' : type === 'discourse' || type === 'hn' ? 'forum' : type === 'reddit' ? 'reddit' : 'blog') };
  if (c.region === 'cn') out.region = 'cn';
  for (const k of ['ua', 'headers', 'include', 'exclude', 'regex']) if (str(c[k])) out[k] = str(c[k]);
  for (const k of ['interval', 'timeout', 'maxItems']) if (Number(c[k]) > 0) out[k] = Math.min(k === 'interval' ? 1440 : k === 'timeout' ? 120 : 500, Number(c[k]));
  if (c.proxy === false) out.proxy = false;
  if (c.render) out.render = true;
  return out;
}

module.exports = { Store, slug, normalizeChannel };
