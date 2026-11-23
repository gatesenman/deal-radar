'use strict';
/* 全网优惠雷达 — 渲染进程 */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// —— i18n：词典由主进程同步注入（切换语言时重新加载界面，无需重启程序） ——
const I18D = window.i18nData || { lang: 'zh-CN', dict: {}, langs: [] };
I18N.set(I18D.lang, I18D.dict);
const L = I18N.t; const tx = I18N.tx; const LOC = I18N.locale(); const LANG = I18D.lang; const EN = LANG !== 'zh-CN';
document.documentElement.lang = LANG;
if (EN) document.addEventListener('DOMContentLoaded', () => { const sub = document.querySelector('.app-sub'); if (sub) sub.style.display = 'none'; document.title = L('全网优惠雷达'); });
const HAS_CJK = /[\u3400-\u9fff]/;
const fmtNum = (n) => Number(n || 0).toLocaleString(LOC);
/** 兜底：把界面里来自核心数据（渠道名、分组、错误、日志…）的中文片段按词典翻译；translate="no" 的内容（优惠标题等）不动 */
const TR_ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip'];
function trDom(root) {
  if (!EN || !root) return;
  const skip = (el) => el && el.closest && el.closest('[translate="no"],script,style,textarea');
  if (root.nodeType === 3) { if (HAS_CJK.test(root.nodeValue) && !skip(root.parentElement)) { const v = tx(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; } return; }
  if (root.nodeType !== 1 || skip(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = []; for (let n = w.nextNode(); n; n = w.nextNode()) if (HAS_CJK.test(n.nodeValue)) texts.push(n);
  for (const n of texts) if (!skip(n.parentElement)) { const v = tx(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
  const els = [root, ...root.querySelectorAll('[title],[placeholder],[aria-label],[data-tip]')];
  for (const el of els) for (const a of TR_ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && HAS_CJK.test(v) && !skip(el)) { const nv = tx(v); if (nv !== v) el.setAttribute(a, nv); } }
}
if (EN) {
  const go = () => {
    trDom(document.body);
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === 'attributes') { const el = m.target; const v = el.getAttribute(m.attributeName); if (v && HAS_CJK.test(v) && !el.closest('[translate="no"]')) { const nv = tx(v); if (nv !== v) el.setAttribute(m.attributeName, nv); } }
        else for (const n of m.addedNodes) trDom(n);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: TR_ATTRS });
  };
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
}
/** 当前语言下的标题 / AI 要点（zh：英文条目用 AI 中文译文；en：中文条目用 AI 英文译文；按语言缓存） */
function trOf(d) { const t = (d.tr || {})[LANG]; if (t) return t; if (LANG === 'zh-CN' && d.titleZh) return { title: d.titleZh, note: d.aiNote }; return null; }
function dTitle(d) { const t = trOf(d); const need = LANG === 'zh-CN' ? !HAS_CJK.test(d.title || '') : HAS_CJK.test(d.title || ''); return need && t && t.title ? t.title : d.title; }
function langSelect(id) {
  const pref = I18D.pref || 'auto';
  return `<select id="${id}" class="langsel" translate="no" title="${esc(L('界面语言'))} / Language"><option value="auto" ${pref === 'auto' ? 'selected' : ''}>${esc(L('跟随系统语言'))}</option>${(I18D.langs || []).map((l) => `<option value="${esc(l.id)}" ${pref === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`;
}
document.addEventListener('change', (e) => { const sel = e.target.closest && e.target.closest('select.langsel'); if (sel) window.api.call('settings:save', { lang: sel.value }).catch((err) => toast(tx(err.message), 'err')); });
/** 厂商简介：预置厂商按界面语言取内置中英文简介；自定义厂商用发现时记录的描述 */
function brandDesc(b) { const m = (S.state.brandDesc || {})[b.id]; return (m && (m[LANG] || m.en)) || (b.desc ? tx(b.desc) : ''); }
/** 当前语言下是否还需要 AI 翻译（与主进程 needsEnrich 一致） */
function needsTr(d) { if (!(d.offerTypes || []).length || d.status === 'ignored' || d.category !== 'ai' || d.pageDiff) return false; const cjk = HAS_CJK.test(d.title || ''); return LANG === 'zh-CN' ? !cjk && !d.enrichedAt && !(d.tr || {})['zh-CN'] : cjk && !(d.tr || {})[LANG]; }
function dNote(d) { const t = trOf(d); return t && t.note ? t.note : ''; }

const S = {
  state: null, view: 'home', sel: null, page: 1, PAGE: 120,
  f: { q: '', brand: '', platform: '', region: '', type: '', news: false, unread: false, sort: 'pub', status: '' },
  srcRegion: '', brandFilter: '', testing: new Set(), vendor: null, hl: { q: '', proto: '', state: '' },
};

const KIND = { deal: L('优惠社区'), news: L('资讯+优惠词'), search: L('按厂商搜索'), vendor: L('官方渠道'), community: L('社区+优惠词'), page: L('网页变化监控') };
// 优惠类型（与 core/offers.js 一致）
const OFFER = { free: [L('免费试用'), '#16a34a'], discount: [L('折扣降价'), '#dc2626'], credits: [L('赠送额度'), '#7c3aed'], student: [L('学生教育'), '#2563eb'], startup: [L('创业扶持'), '#0891b2'], event: [L('限时活动'), '#ea580c'], plan: [L('新套餐'), '#64748b'], pricing: [L('价格页变动'), '#db2777'] };
const CH_TYPE = { rss: 'RSS / Atom', page: L('网页变化监控'), search: L('搜索关键词') };
const CH_SUB = { blog: L('官方博客'), changelog: L('更新日志'), pricing: L('价格页'), status: L('状态公告'), app: L('应用商店'), social: L('官方社交'), youtube: 'YouTube', github: 'GitHub', forum: L('社区论坛'), reddit: 'Reddit', news: L('新闻搜索'), other: L('其它') };
const dealCat = (d) => d.category || 'goods';
const isOfferDeal = (d) => dealCat(d) !== 'ai' || (d.offerTypes || []).length > 0;
function offerTags(d) {
  if (dealCat(d) !== 'ai') return '';
  const t = d.offerTypes || [];
  if (!t.length) return ("<span class=\"tag news\" title=\"" + L('厂商普通动态（未识别到优惠）') + "\">" + L('资讯') + "</span>");
  return t.map((x) => OFFER[x] ? `<span class="tag ot" style="--c:${OFFER[x][1]}">${OFFER[x][0]}</span>` : '').join('');
}
function allSrc() { return [...S.state.sources, ...(S.state.channelSources || [])]; }
function activeSrc() { const g = !!S.state.settings.goodsEnabled; return allSrc().filter((s) => s.enabled && (s.category !== 'goods' || g)); }

// —— 工具 ——
function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360; return h; }
function brandColor(name) { return `hsl(${hue(name)},58%,46%)`; }
function brandOf(k) { const bs = (S.state && S.state.brands) || []; return bs.find((b) => b.id === k) || bs.find((b) => b.name === k) || null; }
/** 厂商头像：有 logo（打包 / 缓存）用图片，加载失败回退首字母色块 */
function avatar(k, tag = 'span', cls = 'av') {
  const b = brandOf(k); const name = b ? b.name : String(k || '?'); const url = b && ((S.state && S.state.logos) || {})[b.id];
  if (!url) return `<${tag} class="${cls}" style="background:${brandColor(name)}">${esc(initials(name))}</${tag}>`;
  return `<${tag} class="${cls} haslogo" data-ini="${esc(initials(name))}" data-bg="${brandColor(name)}"><img class="blogo" src="${esc(url)}" alt="${esc(name)}" draggable="false"></${tag}>`;
}
function initials(name) { const n = String(name).trim(); return /[\u3400-\u9fff]/.test(n[0]) ? n[0] : n.slice(0, 2).replace(/^./, (c) => c.toUpperCase()); }
function ago(ts) {
  if (!ts) return '—';
  const d = (Date.now() - ts) / 1000;
  if (d < 0) return L('刚刚');
  if (d < 60) return L('刚刚');
  if (d < 3600) return Math.floor(d / 60) + (" " + L('分钟前'));
  if (d < 86400) return Math.floor(d / 3600) + (" " + L('小时前'));
  if (d < 86400 * 30) return Math.floor(d / 86400) + (" " + L('天前'));
  return new Date(ts).toLocaleDateString(LOC);
}
function countdown(sec) {
  if (sec < 60) return sec + (" " + L('秒后'));
  const m = Math.floor(sec / 60); const s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)} ${L('小时 {0} 分后', m % 60)}`;
  return `${m} ${L('分')} ${String(s).padStart(2, '0')} ${L('秒后')}`;
}
function fmtTime(ts) { return ts ? new Date(ts).toLocaleString(LOC, { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; }
function brandById(id) { return S.state.brands.find((b) => b.id === id); }
function bname(id) { const b = brandById(id); return b ? b.name : id; }
function toast(msg, type = '') {
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3600);
}
async function call(ch, ...a) {
  try { return await window.api.call(ch, ...a); } catch (e) { toast(e.message, 'err'); throw e; }
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// —— 过滤 ——
function filteredDeals() {
  const { q, brand, platform, region, type, news, unread } = S.f;
  let list = S.state.deals;
  if (S.view === 'favs') list = list.filter((d) => d.fav);
  else if (S.view === 'goods') list = list.filter((d) => dealCat(d) === 'goods');
  else list = list.filter((d) => dealCat(d) === 'ai');
  if (S.view !== 'favs' && !news && !type) list = list.filter(isOfferDeal);
  if (S.state.settings.hideResellers) list = list.filter((d) => !(d.facts && (d.facts.elig || []).some((e) => /第三方中转/.test(e))) && !/中转|镜像站|代充|拼车|合租|号商/.test(d.title || ''));
  if (type) list = list.filter((d) => (d.offerTypes || []).includes(type));
  // v2.6：有效期 / 适用于我
  if (S.f.valid) list = list.filter((d) => d.vstat && d.vstat.status === S.f.valid);
  else if (!S.f.expired && S.state.settings.hideExpired !== false && S.view !== 'favs') list = list.filter((d) => !(d.vstat && d.vstat.status === 'expired'));
  if (S.f.mine) list = list.filter((d) => !d.mine || d.mine.ok);
  if (brand) list = list.filter((d) => d.brandIds.includes(brand));
  if (platform) list = list.filter((d) => d.platform === platform);
  if (region) list = list.filter((d) => d.region === region);
  if (unread) list = list.filter((d) => !d.read);
  const stf = S.f.status || '';
  if (stf === '') list = list.filter((d) => d.status !== 'ignored' && (S.view === 'favs' || d.feedback !== 'noise' || news));
  else if (stf !== 'all') list = list.filter((d) => (d.status || 'new') === stf || (stf === 'ignored' && d.feedback === 'noise'));
  if (q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter((d) => {
      const hay = (d.title + ' ' + d.summary + ' ' + d.platform + ' ' + d.sourceName + ' ' + d.brandIds.map((id) => { const b = brandById(id); return b ? b.name + ' ' + (b.aliases || []).join(' ') : id; }).join(' ')).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  if (S.f.sort === 'found') list = list.slice().sort((a, b) => (b.fetchedAt || 0) - (a.fetchedAt || 0) || (b.published || 0) - (a.published || 0));
  else if (S.f.sort === 'score') list = list.slice().sort((a, b) => liveScore(b) - liveScore(a) || (b.published || 0) - (a.published || 0));
  else if (S.f.sort === 'disc') list = list.slice().sort((a, b) => discNum(b.discount) - discNum(a.discount) || (b.published || 0) - (a.published || 0));
  return list;
}
function discNum(s) {
  if (!s) return 0;
  let m = s.match(/(\d+)%/); if (m) return Number(m[1]);
  m = s.match(/([\d.]+)折/); if (m) return Math.round(100 - Number(m[1]) * 10);
  return 0;
}

// —— 渲染：侧边栏 ——
function renderSide() {
  const st = S.state;
  const goodsOn = !!st.settings.goodsEnabled;
  const cat = S.view === 'goods' ? 'goods' : 'ai';
  const enabled = st.brands.filter((b) => b.enabled && (b.category || 'ai') === cat);
  const unreadBy = {}; const totalBy = {};
  const offers = st.deals.filter((d) => isOfferDeal(d) && dealCat(d) === cat);
  for (const d of offers) for (const b of d.brandIds) { totalBy[b] = (totalBy[b] || 0) + 1; if (!d.read) unreadBy[b] = (unreadBy[b] || 0) + 1; }
  $('#cntUnread').textContent = st.deals.filter((d) => !d.read && dealCat(d) === 'ai' && isOfferDeal(d)).length;
  $('#navGoods').style.display = goodsOn ? '' : 'none';
  $('#cntGoods').textContent = st.deals.filter((d) => !d.read && dealCat(d) === 'goods').length;
  $('#cntFav').textContent = st.deals.filter((d) => d.fav).length;
  const vis = st.brands.filter((b) => (b.category || 'ai') === 'ai' || goodsOn);
  $('#cntBrands').textContent = `${vis.filter((b) => b.enabled).length}/${vis.length}`;
  $('#cntSources').textContent = st.sources.filter((s) => s.enabled && (s.category !== 'goods' || goodsOn)).length;
  $('#sideTitle').innerHTML = (cat === 'goods' ? L('关注品牌') : L('关注厂商')) + (" <small>" + L('点击筛选') + "</small>");
  const all = `<div class="brand-item ${S.f.brand === '' ? 'active' : ''}" data-b=""><div class="av" style="background:var(--accent)">${L('全')}</div><span>${cat === 'goods' ? L('全部品牌') : L('全部厂商')}</span><em>${offers.length}</em></div>`;
  $('#sideBrands').innerHTML = all + (enabled.length ? enabled.map((b) => `
    <div class="brand-item ${S.f.brand === b.id ? 'active' : ''}" data-b="${esc(b.id)}" title="${esc(b.name)}">
      ${avatar(b.id, 'div')}
      <span title="${esc(brandDesc(b))}">${esc(b.name)}</span>${unreadBy[b.id] ? `<em class="u">${unreadBy[b.id]}</em>` : `<em>${totalBy[b.id] || 0}</em>`}
    </div>`).join('') : `<div class="brand-item" data-go="brands"><span style="color:var(--text3)">${L('尚未启用')}${cat === 'goods' ? L('品牌') : L('厂商')}${L('，去添加')} →</span></div>`);
}

function renderStatus() {
  const st = S.state; const rt = st.runtime;
  const stat = Object.values(st.sourceStatus);
  const on = activeSrc();
  const okN = on.filter((s) => st.sourceStatus[s.id] && st.sourceStatus[s.id].ok).length;
  const errN = on.filter((s) => st.sourceStatus[s.id] && !st.sourceStatus[s.id].ok).length;
  $('#stState').innerHTML = rt.polling ? ("<i class=\"dot run\"></i>" + L('正在刷新') + "…") : rt.paused ? ("<i class=\"dot\"></i>" + L('已暂停')) : ("<i class=\"dot ok\"></i>" + L('监控中'));
  $('#stLast').textContent = L('上次刷新：') + (rt.lastRunAt ? fmtTime(rt.lastRunAt) : '—');
  $('#stSrc').innerHTML = stat.length ? `${L('数据源：')}<b style="color:var(--ok)">${okN} ${L('正常')}</b>${errN ? ` · <b style="color:var(--err)">${errN} ${L('异常')}</b>` : ''} / ${on.length} ${L('启用')}` : `${L('数据源：{0} 启用', on.length)}`;
  $('#stTotal').textContent = `${L('共 {0} 条优惠 · {1} 条厂商资讯', st.deals.filter(isOfferDeal).length, st.deals.filter((d) => !isOfferDeal(d)).length)}`;
  $('#stVer').textContent = 'v' + st.version;
  const radar = $('.radar');
  radar.className = 'radar' + (rt.paused ? ' paused' : rt.polling ? ' busy' : '');
  $('#monState').textContent = rt.polling ? (L('正在扫描全网') + "…") : rt.paused ? L('监控已暂停') : L('实时监控中');
  tickNext();
  const btn = $('#btnRefresh');
  btn.disabled = rt.polling; btn.classList.toggle('busy', rt.polling); btn.setAttribute('aria-busy', rt.polling ? 'true' : 'false');
  $('span', btn).textContent = rt.polling ? (L('刷新中') + "…") : L('立即刷新');
  $('#btnTestAll').disabled = rt.polling;
}
function tickNext() {
  const rt = S.state && S.state.runtime; if (!rt) return;
  let txt = '—';
  if (rt.polling) txt = L('正在刷新');
  else if (rt.paused) txt = L('已暂停');
  else if (rt.nextRunAt) txt = countdown(Math.max(0, Math.round((rt.nextRunAt - Date.now()) / 1000)));
  $('#stNext').textContent = L('下次刷新：') + txt;
  $('#monNext').textContent = rt.polling ? `${activeSrc().length} ${L('个渠道/数据源并行抓取中')}` : rt.paused ? L('点击「设置」可恢复') : L('下次扫描：') + txt;
}

// —— 渲染：优惠 ——
function fillFilters() {
  const st = S.state;
  const fb = $('#fBrand'); const cur = S.f.brand;
  const cat = S.view === 'goods' ? 'goods' : 'ai';
  fb.innerHTML = `<option value="">${cat === 'goods' ? L('全部品牌') : L('全部厂商')}</option>` + st.brands.filter((b) => (S.view === 'favs' || (b.category || 'ai') === cat) && (b.enabled || st.deals.some((d) => d.brandIds.includes(b.id)))).map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  fb.value = cur; if (fb.value !== cur) { S.f.brand = ''; fb.value = ''; }
  const plats = [...new Set(allSrc().filter((s) => S.view === 'favs' || (s.category || 'goods') === cat).map((s) => s.platform))];
  const fp = $('#fPlatform'); const cp = S.f.platform;
  fp.innerHTML = ("<option value=\"\">" + L('全部平台') + "</option>") + plats.map((p) => `<option>${esc(p)}</option>`).join('');
  fp.value = cp; if (fp.value !== cp) { S.f.platform = ''; fp.value = ''; }
  $('#fType').value = S.f.type; $('#fNews').checked = S.f.news;
  $('#fType').style.display = $('#fNews').parentElement.style.display = S.view === 'goods' ? 'none' : '';
}

// —— v2.3：结构化字段 / 状态 ——
const STATUS = { new: L('未处理'), claimed: L('已领取'), ignored: L('已忽略') };
function deadlineChip(t) {
  const days = Math.ceil((t - Date.now()) / 86400000);
  if (days < 0) return `<span class="fc exp" title="${L('截止')} ${new Date(t).toLocaleDateString(LOC)}">${L('已截止')}</span>`;
  return `<span class="fc dl ${days <= 3 ? 'urgent' : ''}" title="${L('截止')} ${new Date(t).toLocaleDateString(LOC)}">${days === 0 ? L('今天截止') : days + (" " + L('天后截止'))}</span>`;
}
/** 力度文案本地化：英文界面把「8 折」换成 20% OFF、「100万」换成 1,000,000 */
function fmtAmount(a) { if (!a || !EN) return a; return tx(String(a).replace(/(\d(?:\.\d)?)\s*折/g, (m, n) => `${Math.round(100 - Number(n) * 10)}% OFF`).replace(/(\d+(?:\.\d+)?)\s*万/g, (m, n) => fmtNum(Number(n) * 10000))); }
function factsChips(d, max = 4) {
  const f = d.facts; if (!f) return '';
  const out = [];
  if (f.amount) out.push(`<span class="fc amt" title="${L('力度 / 金额')}">${esc(fmtAmount(f.amount))}</span>`);
  if (f.deadline && !(d.vstat && d.vstat.status !== 'active')) out.push(deadlineChip(f.deadline));
  for (const e of f.elig || []) out.push(`<span class="fc el ${e === '国内可用' ? 'cn' : /海外/.test(e) ? 'os' : /第三方/.test(e) ? 'rs' : ''}" title="${L('适用条件')}">${esc(e)}</span>`);
  return out.slice(0, max).join('');
}
function trustChip(d) { const t = d.facts && d.facts.trust; return t ? `<span class="fc tr t${t.level}" title="${L('来源可信度（可信度分')} ${d.facts.confidence || '—'}${L('）')}">${esc(t.label)}</span>` : ''; }
function statusChip(d) { return d.status && d.status !== 'new' ? `<span class="fc st ${d.status}">${STATUS[d.status]}</span>` : ''; }
function titleHtml(d, cls = 't') {
  const tt = dTitle(d);
  const badge = tt !== d.title ? `<span class="langb" title="${esc(L('已翻译'))}">${LANG === 'zh-CN' ? esc(L('译')) : 'EN'}</span>` : '';
  return tt !== d.title ? `<div class="${cls}" translate="no" title="${esc(d.title)}">${badge}${esc(tt)}</div><div class="t-orig" translate="no" title="${esc(d.title)}">${esc(d.title)}</div>` : `<div class="${cls}" translate="no" title="${esc(d.title)}">${esc(d.title)}</div>`;
}
const isExpired = (d) => !!(d.facts && d.facts.deadline && d.facts.deadline < Date.now());
function dealCard(d) {
  if (!d.image) return dealCardCompact(d);
  const brands = d.brandIds.map(bname);
  const img = d.image ? `<img loading="lazy" src="${esc(d.image)}" referrerpolicy="no-referrer" alt="">` : '';
  const ph = `<div class="ph" style="background:${brandColor(brands[0] || d.platform)}">${esc(initials(brands[0] || d.platform))}</div>`;
  return `<div class="card ${d.read ? 'read' : ''} ${S.sel === d.id ? 'sel' : ''} ${isOfferDeal(d) ? '' : 'newsy'} ${d.hl ? 'hl' : ''}" data-id="${d.id}" ${d.hl ? `style="--hl:${esc(d.hl)}"` : ''}>
    <div class="thumb">${img || ph}${d.brandIds[0] ? `<span class="tlogo">${avatar(d.brandIds[0])}</span>` : ''}${d.discount ? `<span class="disc">${esc(d.discount)}</span>` : ''}${d.read ? '' : ("<span class=\"unread-dot\" title=\"" + L('未读') + "\"></span>")}</div>
    <div class="cb">
      ${titleHtml(d)}
      ${d.facts ? `<div class="facts">${vBadge(d, { cards: true })}${mineBadge(d)}${factsChips(d)}${trustChip(d)}${statusChip(d)}</div>` : ''}
      <div class="meta">${scoreBadge(d)}${offerTags(d)}${d.price ? `<span class="price">${esc(d.price)}</span>` : ''}${heatTag(d)}${srcBadge(d)}${brands.map((b) => `<span class="tag brand">${esc(b)}</span>`).join('')}<span class="tag ${d.region}">${esc(d.platform)}</span></div>
      <div class="foot"><span title="${esc(d.sourceName)}">${d.origin ? `<span translate="no">${esc(d.origin)}</span>` : esc(d.sourceName)} · ${ago(d.published)}</span>
        <span class="acts">
          <button class="mini ${d.fav ? 'fav-on' : ''}" data-act="fav" title="${d.fav ? L('取消收藏') : L('收藏')}">${ic('star')}</button>
          <button class="mini" data-act="open" title="${L('在浏览器中打开')}">${ic('external')}</button>
        </span></div>
    </div></div>`;
}

// 无图卡片：不再用大色块占位，信息更紧凑（v2.3）
function dealCardCompact(d) {
  const brands = d.brandIds.map(bname); const n = brands[0] || d.platform;
  return `<div class="card compact ${d.read ? 'read' : ''} ${S.sel === d.id ? 'sel' : ''} ${isOfferDeal(d) ? '' : 'newsy'} ${d.hl ? 'hl' : ''} ${isExpired(d) || d.status === 'ignored' ? 'dim' : ''}" data-id="${d.id}" ${d.hl ? `style="--hl:${esc(d.hl)}"` : ''}>
    <div class="cbar">${avatar(n, 'span')}<b>${esc(brands.join(' / ') || d.platform)}</b>${d.discount ? `<span class="disc-i">${esc(d.discount)}</span>` : ''}<span class="grow"></span>${scoreBadge(d)}${d.read ? '' : ("<span class=\"unread-dot\" title=\"" + L('未读') + "\"></span>")}</div>
    <div class="cb">
      ${titleHtml(d)}
      ${dNote(d) ? `<div class="ainote" translate="no">${ic('sparkle')}${esc(dNote(d))}</div>` : ''}
      ${d.facts ? `<div class="facts">${vBadge(d, { cards: true })}${mineBadge(d)}${factsChips(d)}${trustChip(d)}${statusChip(d)}</div>` : ''}
      <div class="meta">${offerTags(d)}${d.price ? `<span class="price">${esc(d.price)}</span>` : ''}${heatTag(d)}${srcBadge(d)}<span class="tag ${d.region}">${esc(d.platform)}</span></div>
      <div class="foot"><span title="${esc(d.sourceName)}">${d.origin ? `<span translate="no">${esc(d.origin)}</span>` : esc(d.sourceName)} · ${ago(d.published)}</span>
        <span class="acts">
          ${isOfferDeal(d) && dealCat(d) === 'ai' ? `<button class="mini txt ${d.status === 'claimed' ? 'on' : ''}" data-act="claim" title="${L('标记为已领取（不会被自动清理）')}">${d.status === 'claimed' ? (ic('check') + L('已领取')) : L('领取')}</button><button class="mini txt" data-act="ignore" title="${d.status === 'ignored' ? L('恢复为未处理') : L('忽略：从列表隐藏')}">${d.status === 'ignored' ? L('恢复') : L('忽略')}</button>` : ''}
          <button class="mini ${d.fav ? 'fav-on' : ''}" data-act="fav" title="${d.fav ? L('取消收藏') : L('收藏')}">${ic('star')}</button>
          <button class="mini" data-act="open" title="${L('在浏览器中打开')}">${ic('external')}</button>
        </span></div>
    </div></div>`;
}

// —— v2.3：今日要点首页 ——
function homeRow(d, kind = '') {
  const brands = d.brandIds.map(bname); const n = brands[0] || d.platform;
  return `<div class="hrow ${d.read ? 'read' : ''} ${d.status === 'claimed' ? 'claimed' : ''}" data-id="${d.id}">
    ${avatar(n, 'span')}
    <div class="hmain">
      <div class="hb"><b>${esc(brands.join(' / '))}</b>${offerTags(d)}${scoreBadge(d)}<span class="when">${ago(d.published)}</span></div>
      ${titleHtml(d, 'ht')}
      ${dNote(d) ? `<div class="ainote" translate="no">${ic('sparkle')}${esc(dNote(d))}</div>` : ''}
      <div class="facts">${kind === 'pricing' ? ("<span class=\"fc amt\">" + L('价格页有改动') + "</span>") : factsChips(d, 5)}${trustChip(d)}${statusChip(d)}${srcBadge(d)}</div>
    </div>
    <div class="hacts">
      <button class="btn sm primary" data-act="open">${L('打开')}</button>
      ${kind === 'pricing' ? '' : `<button class="btn sm ${d.status === 'claimed' ? 'ok' : ''}" data-act="claim">${d.status === 'claimed' ? (ic('check') + L('已领取')) : L('已领取')}</button>`}
      <button class="btn sm ghost" data-act="ignore">${L('忽略')}</button>
      ${kind === 'pricing' ? '' : ("<button class=\"btn sm ghost\" data-act=\"notOffer\" title=\"" + L('不是优惠：降级为资讯，可添加屏蔽词') + "\">" + L('不是优惠') + "</button>")}
    </div></div>`;
}
function renderHome() {
  const st = S.state; const h = st.home || { top: [], pricing: [], expiring: [], stats: {}, vendors: [] };
  const by = new Map(st.deals.map((d) => [d.id, d]));
  const pick = (ids) => (ids || []).map((id) => by.get(id)).filter(Boolean);
  const top = pick(h.top), pricing = pick(h.pricing), expiring = pick(h.expiring);
  const s = h.stats || {};
  const okSrc = activeSrc().filter((x) => st.sourceStatus[x.id] && st.sourceStatus[x.id].ok).length;
  $('#cntHome').textContent = s.pending || 0;
  $('#homeSub').textContent = st.runtime.lastRunAt ? `${L('上次扫描 {0} · {1}/{2} 个渠道正常', fmtTime(st.runtime.lastRunAt), okSrc, activeSrc().length)}` : L('按重要度、可信度与新鲜度为你挑出最值得处理的优惠');
  const needAi = st.settings.ai && st.settings.ai.hasKey && st.settings.aiTranslate !== false && st.deals.some(needsTr);
  $('#btnHomeEnrich').style.display = needAi ? '' : 'none';
  const tile = (n, label, hint, act = '') => `<div class="tile" ${act ? `data-home="${act}"` : ''} title="${esc(hint)}"><b>${n ?? 0}</b><span>${label}</span></div>`;
  let html = `<div class="tiles">${tile(s.today, L('今日新优惠'), L('过去 24 小时新发现的优惠'), 'today')}${tile(s.pending, L('待处理'), L('未读且未处理的优惠'), 'pending')}${tile(expiring.length, L('即将截止'), ("14 " + L('天内截止')), 'expiring')}${tile(pricing.length, L('价格页变动'), L('近 7 天官方价格页的改动'), 'pricing')}${tile(s.claimed, L('已领取'), L('你标记为已领取的优惠'), 'claimed')}${tile(`${okSrc}<small>/${activeSrc().length}</small>`, L('渠道正常'), L('查看源健康'), 'health')}</div>`;
  if (!st.deals.length && (st.runtime.polling || !st.runtime.lastRunAt)) {
    html += `<div class="loading-banner"><div class="radar busy"><span></span></div><div><b>${L('正在从 {0} 个渠道扫描', activeSrc().length)} ${st.brands.filter((b) => b.enabled && (b.category || 'ai') === 'ai').length} ${L('个 AI 厂商')}…</b><p>${L('首次扫描约')} 1–2 ${L('分钟，重点优惠会自动出现在这里。')}</p></div></div>`;
  } else {
    html += `<div class="home-grid"><div class="hcol"><div class="hsec"><h3>${ic('star')} ${L('重点优惠')} <small>${L('过去 72 小时 · 按重要度')} × ${L('可信度')} × ${L('新鲜度')}</small></h3>${top.map((d) => homeRow(d)).join('') || `<div class="hempty">${L('过去 72 小时没有新的重点优惠。雷达仍在持续监控')}${st.runtime.nextRunAt ? `${L('（下次扫描 {0}）', fmtTime(st.runtime.nextRunAt))}` : ''}${L('。')}<a href="#" data-home="all">${L('查看全部优惠')} →</a></div>`}</div></div>
      <div class="hcol side">
        ${trialsHomeHtml()}
        ${judgeHtml()}
        <div class="hsec"><h3>${L('官方价格页变动')} <small>${L('近 7 天')}</small></h3>${pricing.map((d) => homeRow(d, 'pricing')).join('') || ("<div class=\"hempty\"><b>" + L('近 7 天官方价格页没有变化') + "</b><small>" + L('开启了价格页渠道的厂商出现改价、新套餐时会显示在这里') + "</small></div>")}</div>
        <div class="hsec"><h3>${L('即将截止')} <small>14 ${L('天内')}</small></h3>${expiring.map((d) => homeRow(d, 'expiring')).join('') || ("<div class=\"hempty\"><b>" + L('暂无即将截止的优惠') + "</b><small>" + L('标题或摘要里写明截止日期的优惠会出现在这里，方便优先领取') + "</small></div>")}</div>
        <div class="hsec"><h3>${L('本周最活跃厂商')}</h3><div class="vchips">${(h.vendors || []).map((v) => `<button class="vchip" data-vendor="${esc(v.id)}">${avatar(bname(v.id), 'span')}${esc(bname(v.id))}<em>${v.n}</em></button>`).join('') || ("<span class=\"hint\">" + L('暂无') + "</span>")}</div></div>
      </div></div>`;
  }
  $('#homeBody').innerHTML = html;
}
// 「不是优惠」：降级 + 可选学习
const STOP = new Set('the a an and or of for to in on with by from at is are was be new now get gets your you our its this that how why what free cheaper discount off price prices pricing plan plans offer offers deal deals ai app api users user'.split(' '));
function noiseCandidates(d) {
  const brandWords = new Set(d.brandIds.flatMap((id) => { const b = brandById(id); return b ? [b.name, ...b.aliases] : [id]; }).flatMap((x) => x.toLowerCase().split(/[\s/]+/)));
  const en = (d.title.match(/[A-Za-z][A-Za-z0-9+.'-]{2,}/g) || []).map((w) => w.toLowerCase()).filter((w) => !STOP.has(w) && !brandWords.has(w));
  const zh = (d.title.match(/[\u4e00-\u9fff]{2,6}/g) || []).filter((w) => !/免费|优惠|降价|折扣|限时|学生|额度/.test(w));
  return [...new Set([...zh, ...en])].slice(0, 8);
}
function notOfferModal(id) {
  const d = S.state.deals.find((x) => x.id === id); if (!d) return;
  const cands = noiseCandidates(d);
  const reasons = [['noise', L('不是优惠')], ['expired', L('已失效')], ['not-for-me', L('不适用于我')], ['duplicate', L('重复')], ['too-small', L('力度太小')]];
  openModal(`<div class="mh"><h3>${L('反馈这条优惠')}</h3><button class="mini" data-m="close" title="${L('关闭')}">${ic('x')}</button></div>
    <div class="mb"><p class="hint" style="margin-top:0">${L('「{0}」将从优惠列表隐藏。选「不是优惠」时还可让雷达学习屏蔽词。', esc(d.titleZh || d.title))}</p>
      <div class="field"><label>${L('反馈原因')}</label><div class="chips" id="fbReasons">${reasons.map(([k, lab], i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-reason="${k}">${lab}</button>`).join('')}</div></div>
      <div id="noWordWrap">
      <div class="field"><label>${L('屏蔽词（可选）：标题包含该词的条目以后不算优惠')}</label><input class="input" id="noWord" placeholder="${L('例如 code on sale、IPO、教程')}" />
        <div class="chips sm" id="noChips" style="margin-top:8px">${cands.map((w) => `<button class="chip" data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div></div>
      <label class="chk"><input type="checkbox" id="noPen" ${['reddit', 'forum'].includes(d.sub) || /V2EX|Reddit/.test(d.platform) ? 'checked' : ''}> ${L('降低来源「{0}」的权重（被标记 3 次后只保留带明确力度的条目）', esc(d.sourceName))}</label>
      </div>
    </div>
    <div class="mf"><button class="btn" data-m="close">${L('取消')}</button><button class="btn primary" data-m="notOfferGo" data-id="${esc(id)}">${L('确定')}</button></div>`, (m) => {
    $('#noChips', m).addEventListener('click', (e) => { const c = e.target.closest('[data-w]'); if (c) $('#noWord', m).value = c.dataset.w; });
    $('#fbReasons', m).addEventListener('click', (e) => {
      const c = e.target.closest('[data-reason]'); if (!c) return;
      $$('#fbReasons .chip', m).forEach((x) => x.classList.toggle('on', x === c));
      const wrap = $('#noWordWrap', m); if (wrap) wrap.style.display = c.dataset.reason === 'noise' ? '' : 'none';
    });
  });
}
async function submitNotOffer(id) {
  const word = ($('#noWord') && $('#noWord').value || '').trim(); const penalize = !!( $('#noPen') && $('#noPen').checked );
  const reasonBtn = $('#fbReasons .chip.on'); const reason = (reasonBtn && reasonBtn.dataset.reason) || 'noise';
  closeModal();
  const r = await call('deal:feedback', id, { reason, word: reason === 'noise' ? word : '', penalize: reason === 'noise' && penalize });
  if (S.sel === id) S.sel = null;
  const msg = { noise: word ? L('已降级 {0} 条，并学习屏蔽词「{1}」', r.affected, word) : L('已标记为不是优惠'), expired: L('已标记为已失效'), 'not-for-me': L('已标记为不适用于我'), duplicate: L('已标记为重复'), 'too-small': L('已标记为力度太小') };
  toast(msg[r.reason] || msg.noise, 'ok');
}
async function setStatus(id, status) {
  const d = S.state.deals.find((x) => x.id === id); if (!d) return;
  const next = d.status === status ? 'new' : status;
  patchDeal(id, { status: next, ...(next !== 'new' ? { read: true } : {}) }); renderAll();
  await call('deal:status', [id], next);
  toast(next === 'claimed' ? L('已标记为已领取，不会被自动清理') : next === 'ignored' ? L('已忽略（可在「处理状态」筛选里找回）') : L('已恢复为未处理'), next === 'new' ? '' : 'ok');
}
async function homeAct(e) {
  const t = e.target.closest('[data-home]'); if (t) {
    e.preventDefault(); const k = t.dataset.home;
    if (k === 'health') return go('health');
    S.f = { ...S.f, type: k === 'pricing' ? 'pricing' : '', unread: k === 'pending', status: k === 'claimed' ? 'claimed' : '', sort: k === 'today' ? 'found' : S.f.sort };
    $('#fType').value = S.f.type; $('#fUnread').checked = S.f.unread; $('#fStatus').value = S.f.status; $('#fSort').value = S.f.sort;
    return go('deals');
  }
  const v = e.target.closest('[data-vendor]'); if (v) { S.f.brand = v.dataset.vendor; return go('deals'); }
  const row = e.target.closest('.hrow'); if (!row) return;
  const id = row.dataset.id; const b = e.target.closest('[data-act]');
  if (b) {
    const a = b.dataset.act;
    if (a === 'open') return openDeal(id);
    if (a === 'claim') return setStatus(id, 'claimed');
    if (a === 'ignore') return setStatus(id, 'ignored');
    if (a === 'notOffer') return notOfferModal(id);
    return;
  }
  S.sel = id; go('deals'); call('deal:read', [id], true); patchDeal(id, { read: true });
}

const FLAME = ic('flame');
function heatTag(d) { return d.heat ? `<span class="tag heat ${d.heat >= 300 ? 'hot' : ''}" title="${L('社区热度（Pepper 系平台的投票温度）')}">${FLAME}${d.heat}°</span>` : ''; }
function dealRow(d) {
  return `<tr class="${d.read ? 'read' : 'unread'} ${S.sel === d.id ? 'sel' : ''}" data-id="${d.id}">
    <td style="width:28px">${d.read ? '' : '<i class="dot" style="background:var(--accent)"></i>'}</td>
    <td class="title"><div translate="no" title="${esc(d.title)}">${esc(dTitle(d))}</div></td>
    <td class="nw"><div class="tags">${scoreBadge(d)}${vBadge(d)}${offerTags(d)}${srcBadge(d)}${mineBadge(d)}</div></td>
    <td><div class="tags">${d.brandIds.map((b) => `<span class="tag brand wlogo">${avatar(b, 'span', 'av xs')}${esc(bname(b))}</span>`).join('')}</div></td>
    <td class="num nw"><span class="price" style="font-size:13px">${esc(d.price)}</span></td>
    <td class="nw"><div class="tags">${d.discount ? `<span class="tag" style="color:var(--err)">${esc(d.discount)}</span>` : ''}${heatTag(d)}</div></td>
    <td><div class="tags"><span class="tag ${d.region}">${esc(d.platform)}</span></div></td>
    <td style="color:var(--text3);white-space:nowrap">${ago(d.published)}</td>
    <td style="width:70px;white-space:nowrap"><button class="mini ${d.fav ? 'fav-on' : ''}" data-act="fav" title="${L('收藏')}">${ic('star')}</button><button class="mini" data-act="open" title="${L('打开')}">${ic('external')}</button></td>
  </tr>`;
}

function renderDeals() {
  const st = S.state;
  renderLookup();
  const list = filteredDeals();
  const view = ['table', 'timeline'].includes(st.settings.view) ? st.settings.view : 'cards';
  const el = $('#dealList');
  el.className = 'deal-list ' + view;
  $$('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
  const isFav = S.view === 'favs';
  const isGoods = S.view === 'goods';
  $('#dealsTitle').textContent = isFav ? L('我的收藏') : (S.f.brand ? bname(S.f.brand) + (" " + L('的优惠')) : isGoods ? L('实物商品优惠') : ("AI / " + L('软件厂商优惠')));
  const unread = list.filter((d) => !d.read).length;
  $('#dealsSub').textContent = `${list.length} ${L('条 · {0} 未读', unread)}`;

  if (!list.length) {
    let html;
    if (!st.deals.length && !isFav && (st.runtime.polling || !st.runtime.lastRunAt) && st.brands.some((b) => b.enabled)) {
      const banner = `<div class="loading-banner"><div class="radar busy"><span></span></div><div><b>${L('正在从 {0} 个渠道扫描', activeSrc().length)} ${st.brands.filter((b) => b.enabled && (b.category || 'ai') === 'ai').length} ${L('个厂商的最新优惠')}…</b><p>${L('官方博客、价格页、新闻搜索、Hacker News、Reddit、V2EX 等；首次扫描通常需要')} 20–60 ${L('秒，结果会自动显示在这里')}</p></div></div>`;
      html = banner + (view === 'table' ? '' : Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join(''));
    } else if (!st.brands.some((b) => b.enabled)) {
      html = emptyBox(L('还没有启用任何厂商'), L('前往「厂商与渠道」选择你关心的 AI / 软件厂商，开始监控。'), ("<button class=\"btn primary\" data-go=\"brands\">" + L('去选择厂商') + "</button>"));
    } else if (isFav) {
      html = emptyBox(L('暂无收藏'), (L('在优惠卡片上点击') + " ★ " + L('即可收藏，收藏的优惠不会被自动清理。')), '');
    } else if (!st.deals.length && Object.keys(st.sourceStatus).length && st.sources.filter((s) => s.enabled).every((s) => !st.sourceStatus[s.id] || !st.sourceStatus[s.id].ok)) {
      html = emptyBox(L('所有数据源都无法访问'), (L('可能是网络不通或代理设置有误。请到「设置') + " → " + L('网络代理」检查后重试，或在「数据源」页查看具体错误。')), ("<div class=\"btns\"><button class=\"btn primary\" data-go=\"settings\">" + L('检查代理 / 检测网络') + "</button><button class=\"btn\" data-go=\"sources\">" + L('查看数据源') + "</button><button class=\"btn\" data-act=\"refresh\">" + L('重试') + "</button></div>"));
    } else if (st.deals.length) {
      html = emptyBox(L('没有符合筛选条件的优惠'), S.f.news ? L('试试清除搜索词或筛选条件。') : L('试试清除筛选条件，或勾选「含厂商资讯」查看厂商的全部动态。'), ("<button class=\"btn\" data-act=\"clearFilters\">" + L('清除筛选') + "</button>"));
    } else {
      html = emptyBox(L('暂时还没有抓到优惠'), L('点击「立即刷新」开始扫描；若长时间为空，请检查网络/代理设置或数据源状态。'), ("<button class=\"btn primary\" data-act=\"refresh\">" + L('立即刷新') + "</button>"));
    }
    el.innerHTML = html;
    return;
  }
  const shown = list.slice(0, S.page * S.PAGE);
  const banner = isFav ? '' : netBanner();
  const more = list.length > shown.length ? `<div class="more-row"><button class="btn" data-act="more">${L('加载更多（还有 {0} 条）', list.length - shown.length)}</button></div>` : '';
  if (view === 'cards') el.innerHTML = banner + shown.map(dealCard).join('') + more;
  else if (view === 'timeline') el.innerHTML = banner + timelineHtml(shown) + more;
  else el.innerHTML = banner + `<table class="grid"><thead><tr><th></th><th>${L('标题')}</th><th>${L('类型')}</th><th>${L('厂商')}</th><th class="num">${L('价格')}</th><th>${L('折扣 / 热度')}</th><th>${L('平台')}</th><th>${L('时间')}</th><th></th></tr></thead><tbody>${shown.map(dealRow).join('')}</tbody></table>` + more;
}
// 境外源因网络原因失败（中国大陆未开代理的典型情况）时，在列表顶部给出明确指引
const NET_ERR_RE = /超时|连接|域名|代理|重置|SSL|网络|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed/i;
function netFailedSources() {
  const st = S.state;
  return st.sources.filter((s) => s.enabled && s.region === 'intl' && st.sourceStatus[s.id] && !st.sourceStatus[s.id].ok && (st.sourceStatus[s.id].failStreak || 1) >= 2 && NET_ERR_RE.test(st.sourceStatus[s.id].error || ''));
}
function netBanner() {
  if (S.netBannerHidden || S.state.runtime.polling) return '';
  const bad = netFailedSources();
  if (bad.length < 3) return '';
  const proxy = S.state.settings.proxyMode;
  return `<div class="notice warn">${ic('alert')}
    <div class="grow"><b>${bad.length} ${L('个境外数据源无法访问')}</b><p>${esc(bad.slice(0, 4).map((s) => s.platform).filter((v, i, a) => a.indexOf(v) === i).join(L('、')))} ${L('等连接失败。在中国大陆访问这些站点通常需要代理')}${proxy === 'custom' ? L('，请确认代理软件已启动且地址正确') : L('：请开启代理软件的「系统代理」，或在设置中填写代理地址（如 Clash 默认 http://127.0.0.1:7890）')}${L('。国内数据源不受影响。')}</p></div>
    <button class="btn primary sm" data-go="settings">${L('设置代理')}</button><button class="btn sm" data-act="hideNet">${L('忽略')}</button></div>`;
}
function emptyBox(h, p, act) {
  return `<div class="empty">${ic('tag')}<h4>${h}</h4><p>${p}</p>${act}</div>`;
}

function renderDetail() {
  const el = $('#detail');
  const d = S.sel && S.state.deals.find((x) => x.id === S.sel);
  if (!d) { el.classList.remove('open'); el.innerHTML = ''; el.dataset.key = ''; return; }
  // 内容未变化时不重绘，避免后台刷新打断用户在详情里选择/复制文字
  const key = [d.id, d.read, d.fav, d.status, d.titleZh, JSON.stringify(d.tr || null), (d.offerTypes || []).join(), d.heat, d.brandIds.join(), S.state.brands.length, Object.keys(S.state.logos || {}).length, (d.sources || []).length, d.vstat ? d.vstat.status + d.vstat.checkedAt : '', d.mine ? d.mine.ok : '', JSON.stringify(S.state.settings.profile || {}), d.trialEnd || 0, d.trialDone ? 1 : 0].join('|');
  if (el.dataset.key === key && el.classList.contains('open')) return;
  el.dataset.key = key;
  el.classList.add('open');
  el.innerHTML = `<div class="inner">
    <div class="dhead"><span>${L('优惠详情')}</span><button class="mini" data-act="closeDetail" title="${L('关闭')}">${ic('x')}</button></div>
    ${d.brandIds.length ? `<div class="dbrand">${d.brandIds.map((b) => `<span class="dbi">${avatar(b, 'span', 'av md')}<b>${esc(bname(b))}</b></span>`).join('')}</div>` : ''}
    ${d.image ? `<div class="dimg"><img src="${esc(d.image)}" referrerpolicy="no-referrer" alt=""></div>` : ''}
    <h3 translate="no">${esc(dTitle(d))}</h3>${dTitle(d) !== d.title ? `<div class="t-orig big" translate="no">${esc(d.title)}</div>` : ''}
    ${dNote(d) ? `<div class="ainote">${ic('sparkle')}AI ${L('要点：')}<span translate="no">${esc(dNote(d))}</span></div>` : ''}
    ${d.facts ? `<div class="fgrid">
      <b>${L('优惠类型')}</b><span class="tags">${offerTags(d)}</span>
      <b>${L('力度 / 金额')}</b><span>${esc(fmtAmount(d.facts.amount) || L('未识别'))}</span>
      <b>${L('适用对象')}</b><span>${esc((d.facts.audience || []).join(L('、')) || L('未说明（通常为所有用户）'))}</span>
      <b>${L('地区 / 资格')}</b><span>${(d.facts.elig || []).map((e) => `<span class="fc el ${e === '国内可用' ? 'cn' : /海外/.test(e) ? 'os' : ''}">${esc(e)}</span>`).join('') || '—'}${(d.facts.regions || []).length ? ` <small>${L('（提到：')}${esc(d.facts.regions.join(L('、')))}${L('）')}</small>` : ''}</span>
      <b>${L('有效期')}</b><span class="tags">${vBadge(d) || '—'}<small>${esc(vReason(d.vstat))}${d.vstat && d.vstat.checkedAt ? ' · ' + L('上次复查') + ' ' + fmtTime(d.vstat.checkedAt) : ''}</small></span>
      ${profileSet() && d.mine ? `<b>${L('适用于我')}</b><span class="tags">${mineBadge(d)}${d.mine.ok ? '' : `<small>${esc(d.mine.reasons.map((r) => MINE_REASON[r] || r).join(L('；')))}</small>`}</span>` : ''}
      <b>${L('截止时间')}</b><span>${d.facts.deadline ? `${new Date(d.facts.deadline).toLocaleDateString(LOC)} ${deadlineChip(d.facts.deadline)}` : L('未提及')}</span>
      <b>${L('领取方式')}</b><span>${esc(d.facts.claim || L('打开原文查看'))}</span>
      <b>${L('来源可信度')}</b><span>${trustChip(d)} <small>${L('可信度分')} ${d.facts.confidence}</small></span>
      ${d.evidence ? `<b>${L('证据')}</b><span>${d.evidence.official ? ("<span class=\"fc tr t3\">" + L('官方确认') + "</span> ") : ""}${L('已被 {0} 个来源证实', d.evidence.n)}</span>` : ''}
      ${typeof d.rel === 'number' ? `<b>${L('来源可靠度')}</b><span>${relChip(d.rel)}</span>` : ''}
      ${typeof d.learnP === 'number' ? `<b>${L('你可能感兴趣')}</b><span>${learnChip(d.learnP)}</span>` : ''}
      <b>${L('处理状态')}</b><span>${STATUS[d.status || 'new']}</span>
    </div>` : ''}
    ${guideHtml(d)}
    ${trialHtml(d)}
    <div class="meta">${offerTags(d)}${d.price ? `<span class="price">${esc(d.price)}</span>` : ''}${d.discount ? `<span class="tag" style="color:var(--err)">${esc(d.discount)}</span>` : ''}${heatTag(d)}${d.brandIds.map((b) => `<span class="tag brand">${esc(bname(b))}</span>`).join('')}</div>
    ${d.summary ? `<div translate="no" class="summary ${d.pageDiff ? 'diff' : ''}">${d.pageDiff ? esc(d.summary).replace(/^(\+ .*)$/gm, '<ins>$1</ins>').replace(/^(- .*)$/gm, '<del>$1</del>') : esc(d.summary)}</div>` : ''}
    <div class="kv">
      <b>${L('平台')}</b><span>${esc(d.platform)}${L('（')}${d.region === 'cn' ? L('中文') : L('国际')}${L('）')}</span>
      <b>${L('数据源')}</b><span>${esc(d.sourceName)}${d.sourceId && d.sourceId.startsWith('ch-') && d.brandIds[0] ? ` <a href="#" data-act="openVendor" data-b="${esc(d.brandIds[0])}">${L('查看厂商渠道')} →</a>` : ''}</span>
      ${d.origin ? `<b>${L('原始来源')}</b><span>${esc(d.origin)}</span>` : ''}
      <b>${L('发布时间')}</b><span>${d.published ? new Date(d.published).toLocaleString(LOC, { hour12: false }) : '—'}</span>
      <b>${L('发现时间')}</b><span>${new Date(d.fetchedAt).toLocaleString(LOC, { hour12: false })}</span>
      <b>${L('链接')}</b><span>${esc(d.link)}</span>
      <b>${L('重要度')}</b><span>${scoreBadge(d) || liveScore(d)}${d.rules ? (" · " + L('命中规则：')) + esc(d.rules.join(L('、'))) : ''}</span>
      ${(d.sources || []).length > 1 ? `<b>${d.sources.length} ${L('个来源')}</b><span class="srcs">${d.sources.map((x) => `<a href="#" data-act="openSrc" data-u="${esc(x.link)}">${esc(x.name)}</a>`).join('')}</span>` : ''}
    </div>
    <div class="dacts">
      <button class="btn primary" data-act="open">${L('在浏览器中打开')}</button>
      ${dealCat(d) === 'ai' && (d.offerTypes || []).length ? `<button class="btn ${d.status === 'claimed' ? 'ok' : ''}" data-act="claim">${d.status === 'claimed' ? (ic('check') + L('已领取')) : L('标记已领取')}</button><button class="btn ghost" data-act="ignore">${d.status === 'ignored' ? L('恢复') : L('忽略')}</button><button class="btn ghost" data-act="notOffer" title="${L('降级为资讯，并可学习屏蔽词')}">${L('不是优惠')}</button>` : ''}
      <button class="btn" data-act="fav">${ic('star')}${d.fav ? L('已收藏') : L('收藏')}</button>
      <button class="btn" data-act="copy">${L('复制链接')}</button>
      <button class="btn" data-act="shareMd" title="${L('复制为 Markdown（标题、厂商、优惠、截止、优惠码、链接）')}">${ic('share')}${L('分享')}</button>
      <button class="btn ghost" data-act="shareImg" title="${L('生成分享图片并复制到剪贴板')}">${ic('image')}${L('分享图片')}</button>
      <button class="btn ghost" data-act="shareSave" title="${L('生成分享图片并保存为 PNG')}">${ic('download')}PNG</button>
      <button class="btn ghost" data-act="toggleRead">${d.read ? L('标为未读') : L('标为已读')}</button>
      <button class="btn ghost" data-act="remove" title="${L('从列表中删除这条优惠')}">${L('删除')}</button>
    </div></div>`;
  el.dataset.id = d.id;
}

const BELL = ic('bell');
const BELL_OFF = ic('belloff');
// —— 渲染：厂商 ——
function brandCard(b, totalBy) {
  const chs = b.channels || []; const chOn = chs.filter((c) => c.enabled !== false).length;
  return `
    <div class="bcard ${b.enabled ? '' : 'off'}" data-id="${esc(b.id)}">
      <div class="bh">${avatar(b.id, 'div')}
        <div class="bn"><b>${esc(b.name)}</b><small>${b.preset ? L('预设') : L('自定义')} · ${chs.length ? `<span class="chn">${chOn} ${L('个官方渠道')}</span> · ` : ''}${b.aliases.length} ${L('个关键词')}${(b.exclude || []).length ? ` · <span title="${L('排除词：')}${esc(b.exclude.join(L('、')))}">${b.exclude.length} ${L('个排除词')}</span>` : ''}</small></div>
        <button class="mini bell ${b.notify === false ? 'off' : ''}" data-act="notifyBrand" title="${b.notify === false ? L('已静音：新优惠不弹通知（点击开启）') : L('新优惠弹出桌面通知（点击静音）')}">${b.notify === false ? BELL_OFF : BELL}</button>
        <label class="switch" title="${b.enabled ? L('停用') : L('启用')}${L('监控')}"><input type="checkbox" data-act="toggleBrand" ${b.enabled ? 'checked' : ''}><span></span></label></div>
      ${brandDesc(b) ? `<div class="bdesc" translate="no">${esc(brandDesc(b))}</div>` : ''}
      <div class="tags">${b.aliases.slice(0, 8).map((a) => `<span class="tag">${esc(a)}</span>`).join('')}${b.aliases.length > 8 ? `<span class="tag">+${b.aliases.length - 8}</span>` : ''}</div>
      <div class="bf"><span>${L('已发现')} <b style="color:var(--text)">${totalBy[b.id] || 0}</b> ${L('条优惠')}</span>
        <span>${(b.category || 'ai') === 'ai' ? ("<button class=\"btn sm\" data-act=\"vendorDetail\">" + L('渠道') + "</button> ") : ''}<button class="btn sm ghost" data-act="viewBrand">${L('查看')}</button> <button class="btn sm ghost" data-act="editBrand">${L('编辑')}</button> <button class="btn sm ghost del" data-act="delBrand">${L('删除')}</button></span></div>
    </div>`;
}
function groupOf(b) { return b.group || (b.category === 'goods' ? 'goods' : 'custom'); }
function renderBrands() {
  const st = S.state;
  const totalBy = {};
  for (const d of st.deals) if (isOfferDeal(d)) for (const b of d.brandIds) totalBy[b] = (totalBy[b] || 0) + 1;
  const f = S.brandFilter.toLowerCase();
  const list = st.brands.filter((b) => !f || (b.name + ' ' + b.aliases.join(' ')).toLowerCase().includes(f))
    .sort((a, b) => (b.enabled - a.enabled) || ((b.channels || []).length - (a.channels || []).length) || a.name.localeCompare(b.name));
  const goodsOn = !!st.settings.goodsEnabled;
  const groups = (st.brandGroups || []).filter((g) => g.id !== 'custom' || st.brands.some((b) => groupOf(b) === 'custom'));
  const all = st.brands; const tab = groups.some((g) => g.id === S.brandTab) ? S.brandTab : 'all';
  // 分类标签
  $('#brandTabs').innerHTML = `<button class="btab ${tab === 'all' ? 'on' : ''}" data-tab="all">${L('全部')} <small>${all.filter((b) => b.enabled).length}/${all.length}</small></button>` + groups.map((g) => { const gb = all.filter((b) => groupOf(b) === g.id); return `<button class="btab ${tab === g.id ? 'on' : ''} ${g.ai ? 'ai' : ''}" data-tab="${g.id}">${esc(g.name)} <small>${gb.filter((b) => b.enabled).length}/${gb.length}</small></button>`; }).join('');
  let html = '';
  for (const g of groups) {
    if (tab !== 'all' && tab !== g.id) continue;
    const gb = list.filter((b) => groupOf(b) === g.id); const on = gb.filter((b) => b.enabled).length;
    if (tab === 'all' && !gb.length && f) continue;
    if (g.id === 'goods') {
      html += `<div class="bgroup" data-group="goods"><b>${esc(g.name)}${L('（可选）')}</b><span>${goodsOn ? `${on} / ${gb.length} ${L('已启用')}` : L('实物商品监控未开启')}</span><label class="chk" style="margin-left:auto"><input type="checkbox" data-act="goodsToggle" ${goodsOn ? 'checked' : ''}> ${L('监控实物商品优惠')}</label></div>`;
      if (goodsOn) html += gb.map((b) => brandCard(b, totalBy)).join('') || ("<div class=\"bgroup-empty\">" + L('没有匹配的品牌') + "</div>");
      continue;
    }
    html += `<div class="bgroup" data-group="${g.id}"><b>${esc(g.name)}</b><span>${on} / ${gb.length} ${L('已启用')}${g.ai ? (" · AI " + L('类默认全部启用')) : (" · " + L('可选'))}</span><span class="grow"></span>
      <button class="btn ghost sm" data-act="groupOn" data-g="${g.id}" ${on === gb.length ? 'disabled' : ''}>${L('启用本类全部')}</button><button class="btn ghost sm" data-act="groupOff" data-g="${g.id}" ${!on ? 'disabled' : ''}>${L('停用本类')}</button></div>`
      + (gb.map((b) => brandCard(b, totalBy)).join('') || ("<div class=\"bgroup-empty\">" + L('没有匹配的厂商') + "</div>"));
  }
  $('#brandGrid').innerHTML = html;
}

// —— 渲染：厂商详情（渠道） ——
function chStatus(id, testing) {
  const ss = S.state.sourceStatus[id];
  if (testing) return ("<span class=\"status\"><i class=\"dot run\"></i>" + L('检测中') + "…</span>");
  if (!ss) return ("<span class=\"status\"><i class=\"dot\"></i>" + L('未检测') + "</span>");
  if (!ss.ok) return `<span class="status" style="color:var(--err)"><i class="dot err"></i>${L('失败')}</span><span class="err-text" title="${esc(ss.error)}">${esc(ss.error)}</span>`;
  if (ss.error) return `<span class="status" style="color:var(--warn)"><i class="dot warn"></i>${L('部分可用')}</span><span class="err-text" title="${esc(ss.error)}">${esc(ss.error)}</span>`;
  return `<span class="status" style="color:var(--ok)"><i class="dot ok"></i>${L('正常')}</span>${ss.note ? `<span class="err-text ok-note" title="${esc(ss.note)}">${esc(ss.note)}</span>` : ''}`;
}
function renderVendor() {
  const st = S.state; const b = brandById(S.vendor);
  if (!b) { go('brands'); return; }
  $('#vdAv').outerHTML = avatar(b.id, 'div', 'av big').replace('class="av big', 'id="vdAv" class="av big');
  $('#vdName').textContent = b.name;
  const chs = b.channels || [];
  const srcs = (st.channelSources || []).filter((x) => x.brandId === b.id);
  $('#vdSub').title = brandDesc(b);
  $('#vdSub').textContent = `${brandDesc(b) ? brandDesc(b) + ' · ' : ''}${chs.length} ${L('个渠道 · {0} 个启用', chs.filter((c) => c.enabled !== false).length)}${b.enabled ? '' : (" · " + L('厂商未启用（渠道不会自动抓取，可手动检测）'))}`;
  $('#vdEnabled').checked = !!b.enabled;
  $('#chTable tbody').innerHTML = chs.map((c) => {
    const sid = `ch-${b.id}-${c.id}`; const src = srcs.find((x) => x.id === sid) || {};
    const ss = st.sourceStatus[sid]; const testing = S.testing.has(sid) || (st.runtime.polling && src.enabled);
    const where = c.type === 'search' ? `${L('关键词：')}${c.keyword}` : (src.url || c.url || JSON.stringify(c.opts || {}));
    const extra = (c.type === 'page' || c.type === 'render') && (c.selector || c.keyword) ? `<small class="hint2">${c.selector ? (L('选择器') + " ") + esc(c.selector) : ''}${c.selector && c.keyword ? ' · ' : ''}${c.keyword ? L('只看含关键词的行：') + esc(c.keyword) : ''}</small>` : '';
    const hh = healthOf(sid);
    return `<tr data-ch="${esc(c.id)}" class="${c.enabled === false ? 'off' : ''}">
      <td><label class="switch"><input type="checkbox" data-act="toggleCh" ${c.enabled !== false ? 'checked' : ''}><span></span></label></td>
      <td class="src-name"><b>${esc(c.name)}${c.preset ? '' : (" <span class=\"tag\">" + L('自定义') + "</span>")}${c.flaky ? (" <span class=\"tag flaky\" title=\"" + L('实测偶发限流/5xx，已自动重试与退避') + "\">" + L('不稳定') + "</span>") : ''}${c.interval ? ` <span class="tag">${L('每 {0} 分钟', c.interval)}</span>` : ''}</b><small title="${esc(where)}">${esc(where)}</small>${extra}</td>
      <td class="nw">${esc(CH_SUB[c.sub] || c.sub || '—')}</td>
      <td class="nw"><span class="tag ${c.type === 'page' || c.type === 'render' ? 'pm' : ''}" title="${esc(protoLabel(c.type))}">${esc(protoLabel(c.type))}</span></td>
      <td>${chStatus(sid, testing)}</td>
      <td title="${L('成功率')} ${hh.rate == null ? '—' : Math.round(hh.rate * 100) + '%'}">${spark(hh.runs, 16)}</td>
      <td class="num">${ss ? `${ss.total} / <b>${ss.matched}</b>` : '—'}</td>
      <td style="color:var(--text3);white-space:nowrap">${ss ? `${ago(ss.lastRun)} · ${(ss.ms / 1000).toFixed(1)}s` : '—'}</td>
      <td style="text-align:right;white-space:nowrap">${(c.type === 'page' || c.type === 'render') && st.pages && st.pages[sid] ? ("<button class=\"btn sm ghost\" data-act=\"snapCh\">" + L('快照') + "</button>") : ''}<button class="btn sm ghost" data-act="testCh" ${testing ? 'disabled' : ''}>${L('检测')}</button><button class="btn sm ghost" data-act="logCh">${L('日志')}</button><button class="btn sm ghost" data-act="editCh">${L('编辑')}</button><button class="btn sm ghost del" data-act="delCh">${L('删除')}</button></td></tr>`;
  }).join('') || `<tr><td colspan="9" style="padding:18px;color:var(--text3)">${L('这个厂商还没有专属渠道。点击右上角「添加渠道」，可添加官方博客 RSS、价格页变化监控或搜索关键词。全网聚合源（新闻搜索、Hacker News、Reddit、V2EX…）仍会按厂商关键词监控。')}</td></tr>`;
  const aggOk = st.sources.filter((x) => x.enabled && x.category === 'ai');
  $('#vdAgg').innerHTML = `<b>${L('另外')}</b>${L('：{0} 个全网聚合数据源（Google/Bing 新闻、Hacker News、Reddit、V2EX、Slickdeals 等）会按关键词', aggOk.length)} <span class="tag">${b.aliases.slice(0, 5).map(esc).join('</span> <span class="tag">')}</span> ${L('搜索这个厂商的优惠。')}`;
  const deals = st.deals.filter((d) => d.brandIds.includes(b.id)).sort((x, y) => (y.published || 0) - (x.published || 0));
  const offers = deals.filter(isOfferDeal);
  $('#vdLatestSub').textContent = `${offers.length} ${L('条优惠 · {0} 条资讯（来自全部渠道）', deals.length - offers.length)}`;
  $('#vdLatest').innerHTML = deals.slice(0, 40).map((d) => `<div class="vd-item ${isOfferDeal(d) ? '' : 'newsy'}" data-id="${d.id}"><div class="vt">${offerTags(d)} <span translate="no" title="${esc(d.title)}">${esc(d.title)}</span></div><div class="vm">${esc(d.sourceName)} · ${ago(d.published)}</div></div>`).join('') || ("<div class=\"hint\" style=\"padding:12px\">" + L('暂无动态，点击「检测全部渠道」试试') + "</div>");
}

// —— 渲染：数据源 ——
function renderSources() {
  const st = S.state;
  const goodsOn = !!st.settings.goodsEnabled;
  const list = st.sources.filter((s) => (!S.srcRegion || s.region === S.srcRegion) && (s.category !== 'goods' || goodsOn));
  const on = st.sources.filter((s) => s.enabled && (s.category !== 'goods' || goodsOn));
  const chs = (st.channelSources || []).filter((x) => x.category !== 'goods');
  $('#srcChNote').innerHTML = `${L('这里是按关键词覆盖所有厂商的')}<b>${L('全网聚合源')}</b>${L('。每个厂商自己的官方渠道（博客、价格页变化监控、更新日志、状态页、YouTube、论坛…）共')} <b>${chs.length}</b> ${L('个、启用')} <b>${chs.filter((x) => x.enabled).length}</b> ${L('个，在')} <a href="#" data-go="brands">${L('厂商与渠道')} → ${L('渠道')}</a> ${L('中管理。')}`;
  const ok = on.filter((s) => st.sourceStatus[s.id] && st.sourceStatus[s.id].ok).length;
  $('#srcSub').textContent = `${st.sources.length} ${L('个数据源 · {0} 已启用 · {1} 正常', on.length, ok)}`;
  const groups = {};
  for (const s of list) (groups[(s.category === 'goods' ? (L('实物商品') + " · ") : ("AI / " + L('软件') + " · ")) + (s.region === 'cn' ? L('中文平台') : L('国际平台'))] ||= []).push(s);
  let html = '';
  for (const [g, arr] of Object.entries(groups)) {
    const allOn = arr.every((s) => s.enabled);
    html += `<tr class="grp-row"><td><label class="switch"><input type="checkbox" data-act="toggleGroup" data-ids="${arr.map((s) => s.id).join(',')}" ${allOn ? 'checked' : ''}><span></span></label></td><td colspan="8">${g}${L('（{0}）', arr.length)}</td></tr>`;
    for (const s of arr) {
      const ss = st.sourceStatus[s.id];
      const testing = S.testing.has(s.id) || (st.runtime.polling && s.enabled);
      let status = ("<span class=\"status\"><i class=\"dot\"></i>" + L('未检测') + "</span>");
      if (testing) status = ("<span class=\"status\"><i class=\"dot run\"></i>" + L('检测中') + "…</span>");
      else if (!s.enabled) status = ("<span class=\"status\" style=\"color:var(--text3)\"><i class=\"dot\"></i>" + L('已停用') + "</span>");
      else if (ss && ss.ok && ss.error) status = `<span class="status" style="color:var(--warn)"><i class="dot warn"></i>${L('部分可用')}</span><span class="err-text" title="${esc(ss.error)}">${esc(ss.error)}</span>`;
      else if (ss && ss.ok) status = ("<span class=\"status\" style=\"color:var(--ok)\"><i class=\"dot ok\"></i>" + L('正常') + "</span>");
      else if (ss) status = `<span class="status" style="color:var(--err)"><i class="dot err"></i>${L('失败')}</span><span class="err-text" title="${esc(ss.error)}">${esc(ss.error)}</span>`;
      html += `<tr data-id="${esc(s.id)}">
        <td><label class="switch"><input type="checkbox" data-act="toggleSource" ${s.enabled ? 'checked' : ''}><span></span></label></td>
        <td class="src-name"><b>${esc(s.name)}</b><small title="${esc(s.url)}">${esc(s.url)}</small></td>
        <td class="nw">${esc(s.platform)}</td><td class="nw">${esc(s.country)}</td><td class="nw"><span class="tag">${KIND[s.kind] || s.kind}</span></td>
        <td>${status}</td>
        <td class="num">${ss ? `${ss.total} / <b>${ss.matched}</b>` : '—'}</td>
        <td style="color:var(--text3);white-space:nowrap">${ss ? `${ago(ss.lastRun)} · ${(ss.ms / 1000).toFixed(1)}s` : '—'}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn sm ghost" data-act="testSource" ${testing ? 'disabled' : ''}>${L('检测')}</button>${s.preset ? '' : (" <button class=\"btn sm ghost del\" data-act=\"delSource\">" + L('删除') + "</button>")}</td></tr>`;
    }
  }
  $('#srcTable tbody').innerHTML = html;
  $('#unavail').innerHTML = `<b>${L('说明：')}</b>${L('以下平台已实测，但因需登录/反爬，无法免登录稳定抓取，未纳入默认数据源：')}<ul>${st.unavailable.map((u) => `<li>${esc(u.name)} — ${esc(u.reason)}</li>`).join('')}</ul>${L('你可以通过「自定义 RSS」添加任意 RSS/Atom 地址，或在厂商的「渠道」里添加网页变化监控（例如自建 RSSHub 的 X / 微博路由）。')}`;
}

// —— 渲染：设置 / 日志 ——
function renderSettings() {
  if (EN) setTimeout(() => trDom($('#view-settings') || document.body), 0);
  const s = S.state.settings;
  renderAISettings();
  $('#sInterval').value = String(s.intervalMinutes);
  if ($('#sInterval').value !== String(s.intervalMinutes)) { const o = new Option(`${L('每 {0} 分钟', s.intervalMinutes)}`, s.intervalMinutes); $('#sInterval').add(o); $('#sInterval').value = String(s.intervalMinutes); }
  $('#sAge').value = String(s.maxAgeDays);
  $('#sNotify').checked = !!s.notify;
  $('#sGoods').checked = !!s.goodsEnabled;
  $('#sNotifyMax').value = String(s.notifyMax);
  $('#sMinConf').value = String(s.notifyMinConf ?? 50);
  $('#sQuiet').checked = !!s.quietHours; $('#sQuietStart').value = s.quietStart || '23:00'; $('#sQuietEnd').value = s.quietEnd || '08:00';
  $('#sDigest').checked = s.dailyDigest !== false; $('#sDigestTime').value = s.digestTime || '09:00';
  $('#sAiTranslate').checked = s.aiTranslate !== false;
  if ($('#sHideResellers')) $('#sHideResellers').checked = !!s.hideResellers;
  if ($('#sAiClassify')) $('#sAiClassify').checked = s.aiClassify !== false;
  if ($('#sEnrichLimit')) $('#sEnrichLimit').value = String(s.enrichLimit || 40);
  const nw = s.noiseWords || []; const ns = Object.entries(s.noiseSources || {}).filter(([, n]) => n > 0);
  $('#sNoise').innerHTML = (nw.length ? nw.map((w) => `<span class="tag">${esc(w)} <a href="#" data-rmw="${esc(w)}" title="${L('移除')}">${ic('x')}</a></span>`).join('') : ("<span class=\"hint\" style=\"margin:0\">" + L('还没有屏蔽词') + "</span>")) + (ns.length ? `<div class="hint" style="margin-top:6px">${L('已降权来源：')}${ns.map(([id, n]) => `${esc((allSrc().find((x) => x.id === id) || {}).name || id)} ×${n}`).join(L('、'))} <a href="#" data-act="resetSrc">${L('重置')}</a></div>` : '');
  $('#sTray').checked = !!s.closeToTray;
  $('#sStartMin').checked = !!s.startMinimized;
  $('#sAutoStart').checked = !!s.autoStart;
  $('#sPaused').checked = !!S.state.runtime.paused;
  if (!$('#sLang')) $('#sLangBox').innerHTML = langSelect('sLang');
  $$('#sTheme button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.theme));
  $$('#sProxyMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.proxyMode));
  if (document.activeElement !== $('#sProxyUrl')) $('#sProxyUrl').value = s.proxyUrl || ''; // 正在输入时不被后台状态推送覆盖
  $('#sProxyUrl').disabled = s.proxyMode !== 'custom';
  $('#sDataDir').textContent = S.state.dataDir;
  $('#sConc').value = String(s.concurrency || 6); $('#sGap').value = String(s.hostGap ?? 1500);
  $('#sBackoff').checked = s.backoff !== false; $('#sCache').checked = s.httpCache !== false; $('#sRender').checked = s.renderEnabled !== false; $('#sDedupe').checked = s.dedupe !== false;
  if (document.activeElement !== $('#sRsshub')) $('#sRsshub').value = s.rsshubBase || '';
  $('#sCacheHits').textContent = S.state.cacheHits ? `${L('（本次运行已命中 {0} 次）', S.state.cacheHits)}` : '';
}
function renderLogs() {
  $('#logList').innerHTML = S.state.logs.slice().reverse().map((l) => `<div class="${l.level}"><time>${new Date(l.t).toLocaleTimeString(LOC, { hour12: false })}</time><span>${esc(l.msg)}</span></div>`).join('') || ("<div>" + L('暂无日志') + "</div>");
}

function applyTheme() { const light = S.state.settings.theme === 'light'; document.documentElement.dataset.theme = light ? 'light' : 'dark'; const tb = $('#btnTheme'); if (tb) { tb.innerHTML = ic(light ? 'moon' : 'sun'); tb.title = light ? L('切换到深色主题') : L('切换到浅色主题'); } }

function renderAll() {
  applyTheme(); renderSide(); renderStatus(); fillFilters();
  if (S.view === 'deals' || S.view === 'favs' || S.view === 'goods') { renderDeals(); renderDetail(); }
  if (S.view === 'home') renderHome(); else if (S.state.home) $('#cntHome').textContent = S.state.home.stats.pending || 0;
  if (S.view === 'brands') renderBrands();
  if (S.view === 'vendor') renderVendor();
  if (S.view === 'sources') renderSources();
  if (S.view === 'settings') renderSettings();
  if (S.view === 'logs') renderLogs();
  if (S.view === 'health') renderHealth();
  if (S.view === 'coverage') renderCoverage();
  if (S.view === 'prices') renderPrices();
  if (S.view === 'push') renderPush(); else if ($('#cntPush')) $('#cntPush').textContent = v28().channels.filter((c) => c.enabled).length || '';
  renderSideViews();
  if ($('#cntPrices')) $('#cntPrices').textContent = ((S.state.engine || {}).prices || { rows: [] }).rows.length || '';
  if (S.view === 'settings') { renderProfile(); renderEngineSettings(); if ($('#presetBox') && !$('#presetBox').children.length) $('#presetBox').innerHTML = presetChips('setPresets'); }
  { const cv = S.state.coverage || []; const bad = cv.filter((c) => c.level === 'down' || c.level === 'partial').length; if ($('#cntCoverage')) $('#cntCoverage').textContent = bad ? bad + ' ' + L('需关注') : cv.length; }
  if (S.view === 'rules') renderRules();
  if (S.view !== 'health') { const bad = allChannels().filter((x) => x.enabled && S.state.sourceStatus[x.id] && !S.state.sourceStatus[x.id].ok).length; $('#cntHealth').textContent = bad ? bad + (" " + L('异常')) : allChannels().filter((x) => x.enabled).length; $('#cntHealth').classList.toggle('warnb', bad > 0); }
  if (S.view !== 'rules') $('#cntRules').textContent = (S.state.settings.rules || []).filter((r) => r.enabled).length;
}

function go(view) {
  if (typeof view === 'string' && view.startsWith('view:')) { const v = v28().views.find((x) => x.id === view.slice(5)); if (v) return applyView(v); view = 'deals'; }
  if (view !== 'deals') S.curView = null;
  if (view !== S.view && (view === 'goods' || S.view === 'goods')) { S.f.brand = ''; S.f.platform = ''; S.sel = null; }
  S.view = view;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === (view === 'vendor' ? 'brands' : view)));
  const sec = view === 'favs' || view === 'goods' ? 'deals' : view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + sec));
  S.page = 1;
  renderAll();
}


// —— v2.1：AI 助手设置 ——
function renderAISettings() {
  const a = S.state.settings.ai || {}; const P = S.state.aiProviders || {};
  const sel = $('#aiProvider');
  if (!sel.options.length) sel.innerHTML = Object.entries(P).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#aiCard')) return;
  sel.value = a.provider || 'deepseek';
  $('#aiBase').value = a.baseUrl || ''; $('#aiBase').placeholder = (P[sel.value] || {}).baseUrl || 'https://…/v1';
  $('#aiModel').value = a.model || ''; $('#aiModel').placeholder = (P[sel.value] || {}).model || L('模型名称');
  $('#aiKey').placeholder = a.hasKey ? `${L('已保存：')}${a.keyHint || '••••'}${L('（留空则保留）')}` : 'sk-…';
  const on = aiReady();
  $('#aiState').textContent = on ? `${L('已启用')} · ${a.model}` : a.baseUrl ? (L('缺少') + " Key") : L('未配置（使用内置规则）');
  $('#aiState').className = 'tag ' + (on ? 'ok-tag' : '');
  $('#aiKeyHint').textContent = a.encAvailable === false ? L('当前系统不支持安全加密存储：Key 只在本次运行内有效，不会写入磁盘。') : `Key ${L('使用系统安全存储（Windows DPAPI）加密后保存在本机')}${a.encrypted ? L('（已加密保存）') : ''}${L('，不会出现在日志、导出的配置或界面中。')}`;
}
const aiReady = () => { const a = (S.state.settings || {}).ai || {}; return !!(a.baseUrl && a.model && (a.hasKey || /127\.0\.0\.1|localhost/.test(a.baseUrl))); };
function aiForm() { return { provider: $('#aiProvider').value, baseUrl: $('#aiBase').value.trim() || (S.state.aiProviders[$('#aiProvider').value] || {}).baseUrl || '', model: $('#aiModel').value.trim() || (S.state.aiProviders[$('#aiProvider').value] || {}).model || '', apiKey: $('#aiKey').value.trim() }; }

// —— v2.1：AI 辅助添加厂商（端到端） ——
const DV_STEPS = [['search', L('搜索官网与官方账号')], ['domain', L('确定官方域名')], ['crawl', L('发现订阅源 / 页面 / 社交账号')], ['ai', ("AI " + L('归类与补全别名'))], ['test', L('逐个实测')]];
const newJob = () => 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function discoverModal(prefill = '') {
  S.dv = { jobId: null, running: false, result: null, steps: {} };
  openModal(`<div class="mh"><h3>${ic('sparkle')} AI ${L('辅助添加厂商')}</h3><button class="mini" data-m="close">${ic('x')}</button></div>
    <div class="mb dv">
      <div class="dv-top"><input class="input" id="dvName" value="${esc(prefill)}" placeholder="${L('输入厂商或产品名，如 Mistral、Kimi、Perplexity、智谱')}" maxlength="40"><button class="btn primary" data-m="dvGo" id="dvGo">${L('开始发现')}</button></div>
      <p class="hint">${aiReady() ? `${L('将使用 AI（{0}）辅助归类；', esc(S.state.settings.ai.model))}` : (L('未配置 AI，使用内置规则发现（可在「设置') + " → AI " + L('助手」配置以获得别名补全、更准的分类）；'))}${L('只会添加标准协议渠道，每个渠道都会先实测，由你勾选确认后才保存。')}</p>
      <ol class="dv-steps" id="dvSteps"></ol>
      <div id="dvResult"></div>
    </div>
    <div class="mf"><span class="hint grow" id="dvFoot"></span><button class="btn" data-m="dvCancel" id="dvCancel">${L('取消')}</button><button class="btn primary" data-m="dvCommit" id="dvCommit" disabled>${L('添加')}</button></div>`);
  $('#modal').classList.add('xl');
  renderDvSteps();
}
function renderDvSteps() {
  const el = $('#dvSteps'); if (!el || !S.dv) return;
  const stIc = { run: '<i class="spin"></i>', ok: ic('check'), err: ic('alert'), skip: '–' };
  el.innerHTML = S.dv.running || Object.keys(S.dv.steps).length ? DV_STEPS.map(([id, label]) => { const st = S.dv.steps[id] || {}; return `<li class="${st.state || 'wait'}" data-step="${id}"><span class="ic">${stIc[st.state] || ''}</span><b>${label}</b><span class="dim">${esc(st.text || '')}</span></li>`; }).join('') : '';
}
async function startDiscover() {
  const name = $('#dvName').value.trim(); if (!name) { $('#dvName').focus(); return; }
  if (S.dv.running) return;
  Object.assign(S.dv, { jobId: newJob(), running: true, result: null, steps: {} });
  $('#dvResult').innerHTML = ''; $('#dvCommit').disabled = true; $('#dvGo').disabled = true; $('#dvCancel').textContent = L('停止'); $('#dvFoot').textContent = (L('通常需要') + " 10–60 " + L('秒') + "…");
  renderDvSteps();
  const job = S.dv.jobId;
  try {
    const r = await window.api.call('discover:vendor', job, name);
    if (!S.dv || S.dv.jobId !== job) return;
    S.dv.result = r; renderDvResult();
    const mb = $('#modal .mb'); const res = $('#dvResult'); if (mb && res) mb.scrollTop = res.offsetTop - 70;
  } catch (e) {
    if (!S.dv || S.dv.jobId !== job) return;
    $('#dvResult').innerHTML = `<div class="notice warn"><div class="grow"><b>${/已取消/.test(e.message) ? L('已停止') : L('没有完成')}</b><p>${esc(e.message)}</p></div></div>`;
  } finally {
    if (S.dv && S.dv.jobId === job) { S.dv.running = false; if (!$('#dvGo')) return; $('#dvGo').disabled = false; $('#dvGo').textContent = L('重新发现'); $('#dvCancel').textContent = L('取消'); renderDvSteps(); }
  }
}
function chSummary(c) {
  const o = c.opts || {};
  return c.url || (c.type === 'search' ? L('关键词：') + c.keyword : c.type === 'github' ? o.repo : c.type === 'youtube' ? o.channelId : c.type === 'appstore' ? 'App ID ' + o.appId : c.type === 'gplay' ? o.pkg : c.type === 'hn' ? ("HN" + L('：')) + o.query : c.type === 'bluesky' ? '@' + o.handle : c.type === 'mastodon' ? `@${o.acct}@${o.instance}` : c.type === 'telegram' ? 't.me/' + o.channel : JSON.stringify(o));
}
function renderDvResult() {
  const r = S.dv.result; const v = r.vendor;
  const nOk = r.candidates.filter((c) => c.test && c.test.ok).length;
  $('#dvResult').innerHTML = `
    ${r.existing ? `<div class="notice"><div class="grow"><b>${L('「{0}」已在厂商列表中', esc(r.existing.name))}</b><p>${L('勾选的渠道将添加到已有厂商（不会重复创建）。')}</p></div></div>` : ''}
    ${v.mainstream === false ? ("<div class=\"notice warn\"><div class=\"grow\"><b>AI " + L('判断这可能不是主流厂商') + "</b><p>" + L('本应用以主流厂商的官方渠道为主，请确认后再添加。') + "</p></div></div>") : ''}
    <div class="dv-vendor">
      <div class="field"><label>${L('厂商名称')}</label><input class="input" id="dvVName" value="${esc(v.name)}" ${r.existing ? 'disabled' : ''}></div>
      <div class="field"><label>${L('匹配关键词 / 别名')}</label><input class="input" id="dvAliases" value="${esc(v.aliases.join(', '))}" ${r.existing ? 'disabled' : ''}></div>
      <div class="field"><label>${L('排除词')}</label><input class="input" id="dvExclude" value="${esc(v.exclude.join(', '))}" placeholder="${L('无')}" ${r.existing ? 'disabled' : ''}></div>
      <div class="dv-meta"><span>${L('官网')} <b>${v.domains.map((d) => `<a href="#" data-open="https://${esc(d)}">${esc(d)}</a>`).join(L('、'))}</b></span>${v.wikidata ? `<span>Wikidata${L('：{0}（', esc(v.wikidata.label))}${esc(v.wikidata.description || '')}${L('）')}</span>` : ''}<span>${r.usedAI ? (ic('sparkle') + "AI " + L('已参与')) : L('规则发现（未用 AI）')}</span><span>${r.candidates.length} ${L('个候选，{0} 个实测可用', nOk)}</span></div>
      ${r.notes.length ? `<p class="hint">${r.notes.map(esc).join('<br>')}</p>` : ''}
    </div>
    <table class="grid compact dv-table"><thead><tr><th><input type="checkbox" id="dvAll"></th><th>${L('协议')}</th><th>${L('渠道')}</th><th>${L('地址 / 参数')}</th><th>${L('实测')}</th><th>${L('样例')}</th></tr></thead><tbody>
    ${r.candidates.map((c, i) => { const t = c.test || {}; const st = !c.test ? ("<span class=\"dim\">" + L('未测') + "</span>") : t.ok ? `<span class="ok-text">✓ ${t.total || t.lineCount || 0} ${c.type === 'page' || c.type === 'render' ? L('行') : L('条')}</span>` : `<span class="err-text" title="${esc(t.error || '')}">✗ ${esc(String(t.error || L('失败')).slice(0, 36))}</span>`;
      return `<tr data-i="${i}" class="${c.checked ? '' : 'off'}"><td><input type="checkbox" data-dv="${i}" ${c.checked ? 'checked' : ''}></td><td class="nw"><span class="tag">${esc(protoLabel(c.type))}</span></td>
        <td><b>${esc(c.name)}</b><small class="dim">${esc((S.state.subs || {})[c.sub] || c.sub)} · ${esc(c.origin || '')}${c.dupOf ? (" · " + L('与上一条内容重复')) : ''}</small></td>
        <td class="mono" title="${esc(c.why || '')}">${esc(chSummary(c)).slice(0, 90)}<small class="dim wrap">${esc(c.why || '')}</small></td><td class="nw">${st}</td>
        <td class="dv-sample">${(t.sample || []).slice(0, 2).map((x) => `<div>${esc(String(x).slice(0, 70))}</div>`).join('')}</td></tr>`; }).join('')}
    </tbody></table>`;
  updateDvFoot();
}
function updateDvFoot() {
  if (!S.dv || !S.dv.result) return;
  const n = S.dv.result.candidates.filter((c) => c.checked).length;
  $('#dvCommit').disabled = !n; $('#dvCommit').textContent = S.dv.result.existing ? `${L('添加 {0} 个渠道到「{1}」', n, S.dv.result.existing.name)}` : `${L('添加厂商和 {0} 个渠道', n)}`;
  $('#dvFoot').textContent = n ? L('添加后会立即抓取一次；之后可在厂商详情里管理。') : L('至少勾选一个渠道');
}
async function commitDiscover() {
  const r = S.dv && S.dv.result; if (!r) return;
  const split = (s) => s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
  const vendor = { ...r.vendor, name: r.existing ? r.vendor.name : $('#dvVName').value.trim(), aliases: split($('#dvAliases').value), exclude: split($('#dvExclude').value) };
  if (!vendor.name) { toast(L('厂商名称不能为空'), 'err'); return; }
  const channels = r.candidates.filter((c) => c.checked).map(({ test, checked, key, why, origin, aiKeep, dupOf, ...c }) => c);
  $('#dvCommit').disabled = true;
  try {
    const res = await call('discover:commit', { vendor, channels, existingId: r.existing ? r.existing.id : null });
    closeModal(); S.dv = null;
    toast(`${L('已添加 {0} 个渠道', res.added)}${res.errors.length ? `${L('，{0} 个跳过（重复）', res.errors.length)}` : ''}${L('，正在抓取')}…`, 'ok');
    openVendor(res.brandId);
  } catch { $('#dvCommit').disabled = false; }
}
function cancelDiscover() {
  if (S.dv && S.dv.running && S.dv.jobId) { window.api.call('discover:cancel', S.dv.jobId).catch(() => {}); S.dv.steps.test = { state: 'err', text: L('已停止') }; return true; }
  return false;
}

// —— v2.1：AI 辅助添加渠道 ——
async function smartChannel() {
  const m = $('#modal'); const input = $('#cmSmart').value.trim();
  if (S.cs && S.cs.running) { window.api.call('discover:cancel', S.cs.jobId).catch(() => {}); return; }
  if (!input) { $('#cmSmart').focus(); return; }
  S.cs = { jobId: newJob(), running: true };
  const btn = $('#cmSmartGo'); btn.textContent = L('停止'); $('#cmSmartNote').innerHTML = ("<i class=\"spin\"></i> " + L('正在识别（分析网页、自动发现订阅源')) + (aiReady() ? L('、AI 生成选择器') : '') + (L('）') + "…");
  const job = S.cs.jobId;
  try {
    const r = await window.api.call('discover:channel', job, input, m.dataset.brand);
    if (!$('#cmSmart') || !S.cs || S.cs.jobId !== job) return;
    fillChannelForm(r.channel);
    const alts = (r.alternatives || []).slice(0, 4);
    $('#cmSmartNote').innerHTML = `${r.warn ? ic('alert') : ic('check')} <b>${esc(protoLabel(r.channel.type))}</b>${L('：')}${esc(r.reason)}${r.usedAI ? (' <span class="tag">' + ic('sparkle') + 'AI</span>') : ''}${alts.length ? ("<br>" + L('其它可选：')) + alts.map((a, i) => `<a href="#" data-alt="${i}">${esc(protoLabel(a.type))} · ${esc((a.url || '').replace(/^https?:\/\//, '').slice(0, 50))}</a>`).join(L('　')) : ''}`;
    S.cs.alts = alts;
    await previewChannel();
  } catch (e) {
    if ($('#cmSmartNote')) $('#cmSmartNote').innerHTML = `<span class="err-text">${esc(/已取消/.test(e.message) ? L('已停止') : e.message)}</span>`;
  } finally { if (S.cs && S.cs.jobId === job) { S.cs.running = false; if ($('#cmSmartGo')) $('#cmSmartGo').textContent = L('识别'); } }
}
function fillChannelForm(c) {
  const p = $('#cmProto'); p.value = c.type; p.dispatchEvent(new Event('change'));
  const set = (id, v) => { const el = $('#' + id); if (el && v != null) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };
  for (const id of $$('#modal [id^=cf_]').map((x) => x.id)) { const el = $('#' + id); if (el.type === 'checkbox') el.checked = false; else if (el.tagName === 'INPUT') el.value = ''; }
  set('cf_url', c.url || ''); set('cf_keyword', c.keyword || ''); set('cf_selector', c.selector || '');
  for (const [k, v] of Object.entries(c.opts || {})) { if (k === 'what') set('cf_what', v); else if (k === 'engine') set('cf_engine', v); else if (k === 'api') set('cf_api', v); else if (k === 'query' && c.type === 'reddit') set('cf_rquery', v); else set('cf_' + k, v); }
  if (c.render) set('cf_render', true);
  if (c.name) $('#cmName').value = c.name;
  if (c.sub && $(`#cmSub option[value="${c.sub}"]`)) $('#cmSub').value = c.sub;
}

// —— v2.0：健康度 / 时间线 / 规则 / 快捷键 ——
function healthOf(id) {
  const h = (S.state.health || {})[id] || [];
  if (!h.length) return { n: 0, rate: null, avg: null, runs: h };
  const ok = h.filter((x) => x.ok);
  return { n: h.length, rate: ok.length / h.length, avg: ok.length ? ok.reduce((a, x) => a + x.ms, 0) / ok.length : null, runs: h, cached: h.filter((x) => x.c).length };
}
function spark(runs, max = 40) {
  return `<span class="spark">${runs.slice(-max).map((r) => `<i class="${r.ok ? (r.c ? 'c' : 'ok') : 'err'}" style="height:${r.ok ? Math.max(30, Math.min(100, 100 - Math.log10(Math.max(r.ms, 100)) * 18 + 40)) : 100}%" title="${esc(fmtTime(r.t))} · ${r.ok ? (r.c ? ("304 " + L('缓存')) : L('成功')) + ' ' + (r.ms / 1000).toFixed(1) + 's · ' + r.n + (" " + L('条')) : L('失败：') + r.e}"></i>`).join('')}</span>`;
}
function rateTag(hh) {
  if (hh.rate == null) return '<span class="dim">—</span>';
  const p = Math.round(hh.rate * 100); const c = p >= 90 ? 'var(--ok)' : p >= 60 ? 'var(--warn)' : 'var(--err)';
  return `<span class="rate"><b style="color:${c}">${p}%</b><i style="width:${p}%;background:${c}"></i></span>`;
}
const protoLabel = (t) => { const p = (S.state.protocols || {})[t || 'rss']; return p ? p.label.replace(/（.*$/, '') : (t || 'RSS'); };
function allChannels() {
  // 健康页：全部启用（或有运行记录）的渠道 + 聚合源
  const st = S.state; const g = !!st.settings.goodsEnabled;
  return [...(st.channelSources || []), ...st.sources.map((s) => ({ ...s, type: s.type || (s.format === 'hn' ? 'hn' : 'rss') }))]
    .filter((s) => (s.category !== 'goods' || g) && (s.enabled || (st.health || {})[s.id]));
}
function renderHealth() {
  const st = S.state; const all = allChannels();
  const rows = all.map((s) => ({ s, ss: st.sourceStatus[s.id], hh: healthOf(s.id) }));
  const ran = rows.filter((r) => r.ss);
  const okN = ran.filter((r) => r.ss.ok).length; const bad = ran.filter((r) => !r.ss.ok);
  const lat = ran.filter((r) => r.ss.ok && r.ss.ms).map((r) => r.ss.ms).sort((a, b) => a - b);
  const runs = rows.flatMap((r) => r.hh.runs); const okRuns = runs.filter((x) => x.ok).length;
  const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : 0; const p90 = lat.length ? lat[Math.floor(lat.length * 0.9)] : 0;
  const flaky = rows.filter((r) => r.s.flaky || (r.hh.n >= 3 && r.hh.rate < 0.9 && r.hh.rate > 0));
  $('#cntHealth').textContent = bad.length ? bad.length + (" " + L('异常')) : okN;
  $('#cntHealth').classList.toggle('warnb', bad.length > 0);
  $('#hlSub').textContent = `${all.length} ${L('个渠道/数据源 · {0} 正常 · {1} 异常 · {2} 不稳定', okN, bad.length, flaky.length)}`;
  $('#hlKpis').innerHTML = [
    [L('渠道总数'), all.length, `${new Set(all.map((s) => s.type || 'rss')).size} ${L('种协议')}`],
    [L('当前正常'), okN, ran.length ? Math.round(okN / ran.length * 100) + ("% " + L('可用')) : L('尚未运行'), 'ok'],
    [L('当前异常'), bad.length, bad.length ? L('点「异常」筛选查看') : L('全部正常'), bad.length ? 'err' : 'ok'],
    [L('历史成功率'), runs.length ? Math.round(okRuns / runs.length * 100) + '%' : '—', `${runs.length} ${L('次运行记录')}`],
    [(L('延迟') + " P50 / P90"), lat.length ? `${(p50 / 1000).toFixed(1)}s / ${(p90 / 1000).toFixed(1)}s` : '—', L('成功请求耗时')],
    [("304 " + L('缓存命中')), runs.filter((x) => x.c).length, `${L('本次运行 {0} 次', st.cacheHits || 0)}`],
  ].map(([k, v, sub, cls]) => `<div class="kpi ${cls || ''}"><span>${k}</span><b>${v}</b><small>${sub}</small></div>`).join('');
  // 按协议统计
  const byP = {};
  for (const r of rows) { const t = r.s.type || 'rss'; const e = (byP[t] ||= { n: 0, ok: 0, bad: 0 }); e.n++; if (r.ss) r.ss.ok ? e.ok++ : e.bad++; }
  $('#hlProtoBars').innerHTML = Object.entries(byP).sort((a, b) => b[1].n - a[1].n).map(([t, e]) => `<button class="pbar ${S.hl.proto === t ? 'on' : ''}" data-proto="${t}"><span>${esc(protoLabel(t))}</span><b>${e.n}</b><i><em class="ok" style="width:${e.ok / e.n * 100}%"></em><em class="err" style="width:${e.bad / e.n * 100}%"></em></i></button>`).join('');
  const sel = $('#hlProto'); const cur = S.hl.proto;
  sel.innerHTML = ("<option value=\"\">" + L('全部协议') + "</option>") + Object.keys(byP).map((t) => `<option value="${t}">${esc(protoLabel(t))}${L('（{0}）', byP[t].n)}</option>`).join(''); sel.value = cur;
  const f = S.hl.q.toLowerCase();
  let list = rows.filter((r) => (!S.hl.proto || (r.s.type || 'rss') === S.hl.proto) && (!f || (r.s.name + ' ' + r.s.url + ' ' + protoLabel(r.s.type)).toLowerCase().includes(f)));
  if (S.hl.state === 'bad') list = list.filter((r) => r.ss && !r.ss.ok);
  if (S.hl.state === 'flaky') list = list.filter((r) => flaky.includes(r));
  if (S.hl.state === 'slow') list = list.filter((r) => r.ss && r.ss.ok && r.ss.ms > 8000).sort((a, b) => b.ss.ms - a.ss.ms);
  else list.sort((a, b) => ((a.ss && !a.ss.ok) ? 0 : 1) - ((b.ss && !b.ss.ok) ? 0 : 1) || (a.hh.rate ?? 2) - (b.hh.rate ?? 2) || a.s.name.localeCompare(b.s.name));
  $('#hlTable tbody').innerHTML = list.slice(0, 400).map(({ s, ss, hh }) => {
    const testing = S.testing.has(s.id);
    const state = testing ? ("<span class=\"status\"><i class=\"dot run\"></i>" + L('检测中') + "</span>") : !ss ? ("<span class=\"status\"><i class=\"dot\"></i>" + L('未运行') + "</span>") : ss.ok ? `<span class="status" style="color:var(--ok)"><i class="dot ok"></i>${L('正常')}</span>` : `<span class="status" style="color:var(--err)"><i class="dot err"></i>${L('失败')}${ss.failStreak > 1 ? ' ×' + ss.failStreak : ''}</span>`;
    const lastErr = (hh.runs.slice().reverse().find((x) => !x.ok) || {}).e || '';
    const note = ss && !ss.ok ? ss.error : ss && ss.note ? ss.note : lastErr ? L('最近错误：') + lastErr : '';
    return `<tr data-id="${esc(s.id)}"><td class="src-name"><b title="${esc(s.name)}">${esc(s.name)}</b>${s.flaky ? ("<span class=\"tag flaky\" title=\"" + L('实测偶发限流/5xx，已自动重试与退避') + "\">" + L('不稳定') + "</span>") : ''}<small title="${esc(s.url)}">${esc(s.url)}</small></td>
      <td class="nw"><span class="tag">${esc(protoLabel(s.type))}</span></td><td class="nw">${state}</td><td class="num">${rateTag(hh)}</td>
      <td class="num nw">${hh.avg != null ? (hh.avg / 1000).toFixed(1) + 's' : '—'}</td><td>${spark(hh.runs)}</td>
      <td><span class="err-text ${ss && ss.ok ? 'ok-note' : ''}" title="${esc(note)}">${esc(note)}</span></td>
      <td class="nw dim">${ss ? ago(ss.lastRun) : '—'}</td>
      <td class="nw" style="text-align:right"><button class="btn sm ghost" data-act="hlTest" ${testing ? 'disabled' : ''}>${L('检测')}</button><button class="btn sm ghost" data-act="hlLog">${L('日志')}</button></td></tr>`;
  }).join('') || ("<tr><td colspan=\"9\" style=\"padding:18px;color:var(--text3)\">" + L('没有符合条件的渠道') + "</td></tr>");
}
function runLogModal(id) {
  const s = allChannels().find((x) => x.id === id) || allSrc().find((x) => x.id === id) || { name: id, url: '' };
  const hh = healthOf(id); const ss = S.state.sourceStatus[id];
  openModal(`<div class="mh"><h3>${L('运行日志')} · ${esc(s.name)}</h3><button class="mini" data-m="close">${ic('x')}</button></div>
    <div class="mb"><p class="hint mono">${esc(protoLabel(s.type))} · ${esc(s.url)}</p>
    <div class="kpis sm"><div class="kpi"><span>${L('成功率')}</span><b>${hh.rate == null ? '—' : Math.round(hh.rate * 100) + '%'}</b></div><div class="kpi"><span>${L('平均耗时')}</span><b>${hh.avg == null ? '—' : (hh.avg / 1000).toFixed(2) + 's'}</b></div><div class="kpi"><span>${L('记录')}</span><b>${hh.n}</b></div><div class="kpi"><span>${L('连续失败')}</span><b>${ss && !ss.ok ? ss.failStreak || 1 : 0}</b></div></div>
    <div style="margin:8px 0">${spark(hh.runs)}</div>
    <table class="grid compact"><thead><tr><th>${L('时间')}</th><th>${L('结果')}</th><th class="num">${L('耗时')}</th><th class="num">${L('条目/命中')}</th><th>${L('备注 / 错误')}</th></tr></thead><tbody>
    ${hh.runs.slice().reverse().map((r) => `<tr><td class="nw">${new Date(r.t).toLocaleString(LOC, { hour12: false })}</td><td>${r.ok ? (r.c ? ("<span style=\"color:var(--ok)\">304 " + L('缓存') + "</span>") : ("<span style=\"color:var(--ok)\">" + L('成功') + "</span>")) : ("<span style=\"color:var(--err)\">" + L('失败') + "</span>")}</td><td class="num">${(r.ms / 1000).toFixed(2)}s</td><td class="num">${r.n} / ${r.m || 0}</td><td class="wrap">${esc(r.ok ? (r.note || '') : r.e)}</td></tr>`).join('') || ("<tr><td colspan=\"5\" class=\"dim\">" + L('暂无运行记录') + "</td></tr>")}
    </tbody></table></div>
    <div class="mf"><button class="btn ghost" data-m="clearLog" data-id="${esc(id)}">${L('清除记录')}</button><button class="btn" data-m="close">${L('关闭')}</button></div>`);
  $('#modal').classList.add('wide');
}

// 时间线视图：按天分组 + 时间轴
function timelineHtml(list) {
  const days = new Map();
  for (const d of list) { const t = new Date(d.published || d.fetchedAt); const k = t.toLocaleDateString(LOC, { month: 'long', day: 'numeric', weekday: 'short' }); if (!days.has(k)) days.set(k, []); days.get(k).push(d); }
  return `<div class="timeline">${[...days].map(([k, arr]) => `<div class="tl-day"><div class="tl-date">${esc(k)}<small>${arr.length} ${L('条')}</small></div>${arr.map((d) => `<div class="tl-item ${d.read ? 'read' : ''} ${S.sel === d.id ? 'sel' : ''}" data-id="${d.id}" ${d.hl ? `style="--hl:${esc(d.hl)}"` : ''}><time>${new Date(d.published || d.fetchedAt).toLocaleTimeString(LOC, { hour12: false, hour: '2-digit', minute: '2-digit' })}</time>${d.brandIds[0] ? `<span class="tl-dot lg">${avatar(d.brandIds[0], 'span', 'av xs')}</span>` : `<i class="tl-dot" style="background:${brandColor(d.platform)}"></i>`}<div class="tl-body"><div class="t" translate="no">${esc(dTitle(d))}</div><div class="meta">${offerTags(d)}${d.brandIds.map((b) => `<span class="tag brand">${esc(bname(b))}</span>`).join('')}${srcBadge(d)}<span class="dim">${d.origin ? `<span translate="no">${esc(d.origin)}</span>` : esc(d.sourceName)}</span></div></div></div>`).join('')}</div>`).join('')}</div>`;
}
function srcBadge(d) { const n = (d.sources || []).length; return n > 1 ? `<span class="tag multi" title="${esc(d.sources.map((x) => x.name).join('\n'))}">${n} ${L('个来源')}</span>` : ''; }
function scoreBadge(d) { const s = liveScore(d); return s >= 50 ? `<span class="tag score ${s >= 70 ? 'hi' : ''}" title="${L('重要度 {0}（优惠类型、官方渠道、多来源、热度、新鲜度）', s)}">${ic('star')}${s}</span>` : ''; }
function liveScore(d) { const age = (Date.now() - (d.published || d.fetchedAt || 0)) / 3600000; return Math.round(Math.min(100, (d.score || 0) + Math.max(0, 15 - age / 4.8))); }

// 规则
const RULE_TYPES = Object.entries(OFFER);
function renderRules() {
  const rules = S.state.settings.rules || [];
  $('#cntRules').textContent = rules.filter((r) => r.enabled).length;
  $('#ruleList').innerHTML = rules.map((r, i) => {
    const hits = S.state.deals.filter((d) => matchRuleUI(r, d)).length;
    return `<div class="rule ${r.enabled ? '' : 'off'}" data-i="${i}" ${r.highlight ? `style="--hl:${esc(r.highlight)}"` : ''}>
      <label class="switch"><input type="checkbox" data-act="ruleToggle" ${r.enabled ? 'checked' : ''}><span></span></label>
      <div class="rb"><b>${esc(r.name)}</b><div class="rc">${r.vendors.length ? r.vendors.map((v) => `<span class="tag brand">${esc(bname(v))}</span>`).join('') : ("<span class=\"tag\">" + L('全部厂商') + "</span>")} ${r.types.length ? r.types.map((t) => OFFER[t] ? `<span class="tag ot" style="--c:${OFFER[t][1]}">${OFFER[t][0]}</span>` : '').join('') : ("<span class=\"tag\">" + L('全部优惠类型') + "</span>")} ${r.keywords.length ? ("<span class=\"tag\">" + L('含：')) + esc(r.keywords.join(' / ')) + '</span>' : ''} ${r.exclude.length ? ("<span class=\"tag\">" + L('排除：')) + esc(r.exclude.join(' / ')) + '</span>' : ''} ${r.minScore ? `<span class="tag score">${L('重要度')} ≥ ${r.minScore}</span>` : ''}</div></div>
      <div class="ra">${r.notify ? ("<span class=\"tag ok-tag\">" + L('通知') + "</span>") : ''}${r.sound ? ("<span class=\"tag ok-tag\">" + L('提示音') + "</span>") : ''}${r.highlight ? `<span class="tag" style="border-color:${esc(r.highlight)};color:${esc(r.highlight)}">${L('高亮')}</span>` : ''}<span class="dim" title="${L('现有数据中命中条数')}">${L('命中')} ${hits}</span></div>
      <div class="ra2"><button class="btn sm ghost" data-act="ruleEdit">${L('编辑')}</button><button class="btn sm ghost del" data-act="ruleDel">${L('删除')}</button></div></div>`;
  }).join('') || ("<div class=\"hint\" style=\"padding:16px\">" + L('还没有规则。没有任何规则时不会弹出通知。') + "</div>");
  $('#ruleNote').innerHTML = ("<b>" + L('规则如何生效：') + "</b>" + L('每轮刷新的新条目依次与启用的规则匹配（厂商') + " ∩ " + L('优惠类型') + " ∩ " + L('关键词，排除词优先，满足最低重要度）。命中「通知」规则才会弹出桌面通知；「提示音」播放一次提醒音；「高亮」在列表中以颜色标记。厂商卡片上的铃铛静音仍然有效。'));
}
function matchRuleUI(r, d) {
  if (!r.enabled) return false;
  if (r.offersOnly !== false && !isOfferDeal(d)) return false;
  if (r.vendors.length && !d.brandIds.some((b) => r.vendors.includes(b))) return false;
  if (r.types.length && !(d.offerTypes || []).some((t) => r.types.includes(t))) return false;
  const text = (d.title + ' ' + (d.summary || '')).toLowerCase();
  if (r.keywords.length && !r.keywords.some((k) => text.includes(k))) return false;
  if (r.exclude.some((k) => text.includes(k))) return false;
  if (r.minScore && (d.score || 0) < r.minScore) return false;
  return true;
}
function ruleModal(i) {
  const rules = S.state.settings.rules || []; const isEdit = i != null; const r = isEdit ? rules[i] : { name: '', vendors: [], types: [], keywords: [], exclude: [], minScore: 0, notify: true, sound: false, highlight: '' };
  const vendors = S.state.brands.filter((b) => (b.category || 'ai') === 'ai').sort((a, b) => b.enabled - a.enabled);
  openModal(`<div class="mh"><h3>${isEdit ? L('编辑规则') : L('新建提醒规则')}</h3><button class="mini" data-m="close">${ic('x')}</button></div>
    <div class="mb">
      <div class="field"><label>${L('规则名称')} *</label><input class="input" id="rmName" value="${esc(r.name)}" placeholder="${L('例如：Claude / Cursor 学生优惠')}"></div>
      <div class="field"><label>${L('厂商（不选')} = ${L('全部）')}</label><div class="chips sm" id="rmVendors">${vendors.map((b) => `<button class="chip ${r.vendors.includes(b.id) ? 'on' : ''}" data-v="${esc(b.id)}">${esc(b.name)}</button>`).join('')}</div></div>
      <div class="field"><label>${L('优惠类型（不选')} = ${L('全部）')}</label><div class="chips sm" id="rmTypes">${RULE_TYPES.map(([k, [l, c]]) => `<button class="chip ${r.types.includes(k) ? 'on' : ''}" data-v="${k}" style="--c:${c}">${l}</button>`).join('')}</div></div>
      <div class="row2"><div class="field"><label>${L('标题/摘要包含任一（逗号分隔）')}</label><input class="input" id="rmKw" value="${esc(r.keywords.join(', '))}" placeholder="student, ${L('学生, 免费')}"></div>
      <div class="field"><label>${L('排除词')}</label><input class="input" id="rmEx" value="${esc(r.exclude.join(', '))}" placeholder="enterprise, ${L('企业版')}"></div></div>
      <div class="row2"><div class="field"><label>${L('最低重要度（')}0–100${L('）')}</label><input class="input" id="rmScore" type="number" min="0" max="100" value="${r.minScore || 0}"></div>
      <div class="field"><label>${L('高亮颜色')}</label><div class="colors" id="rmColor">${['', '#16a34a', '#dc2626', '#7c3aed', '#2563eb', '#db2777', '#f59e0b'].map((c) => `<button class="${(r.highlight || '') === c ? 'on' : ''}" data-c="${c}" style="background:${c || 'transparent'}" title="${c || L('不高亮')}">${c ? '' : L('无')}</button>`).join('')}</div></div></div>
      <div class="field"><label>${L('动作')}</label><label class="chk"><input type="checkbox" id="rmNotify" ${r.notify ? 'checked' : ''}> ${L('桌面通知')}</label> <label class="chk"><input type="checkbox" id="rmSound" ${r.sound ? 'checked' : ''}> ${L('提示音')}</label></div>
      <p class="hint" id="rmPreview"></p><div class="form-err" id="rmErr"></div>
    </div>
    <div class="mf"><button class="btn" data-m="close">${L('取消')}</button><button class="btn primary" data-m="saveRule">${L('保存规则')}</button></div>`, (m) => {
    m.dataset.i = isEdit ? i : '';
    const upd = () => { const rr = readRule(); $('#rmPreview', m).textContent = `${L('按现有数据预览：命中 {0} 条', S.state.deals.filter((d) => matchRuleUI(rr, d)).length)}`; };
    const box = $('.mb', m); box.addEventListener('click', (e) => { const c = e.target.closest('.chips .chip'); if (c) { c.classList.toggle('on'); upd(); } const col = e.target.closest('#rmColor button'); if (col) { $$('#rmColor button', m).forEach((x) => x.classList.toggle('on', x === col)); } });
    box.addEventListener('input', upd); upd();
  });
}
function readRule() {
  const split = (v) => v.split(/[,，\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return { name: $('#rmName').value.trim(), enabled: true, vendors: $$('#rmVendors .chip.on').map((x) => x.dataset.v), types: $$('#rmTypes .chip.on').map((x) => x.dataset.v), keywords: split($('#rmKw').value), exclude: split($('#rmEx').value), minScore: Number($('#rmScore').value) || 0, notify: $('#rmNotify').checked, sound: $('#rmSound').checked, highlight: ($('#rmColor .on') || {}).dataset ? $('#rmColor .on').dataset.c : '' };
}
async function submitRule() {
  const r = readRule(); if (!r.name) { $('#rmErr').textContent = L('请填写规则名称'); return; }
  const rules = (S.state.settings.rules || []).slice(); const i = $('#modal').dataset.i;
  if (i !== '') rules[Number(i)] = { ...rules[Number(i)], ...r, enabled: rules[Number(i)].enabled }; else rules.push(r);
  await call('rules:save', rules); closeModal(); toast(L('规则已保存'), 'ok');
}
function keysModal() {
  const K = [['Ctrl + F', L('搜索')], ['F5 / Ctrl + R', L('立即刷新')], [("J / K " + L('或') + " ↓ / ↑"), L('下一条 / 上一条')], ['Enter / O', L('在浏览器打开当前条目')], ['S', L('收藏 / 取消收藏')], ['M', L('标记已读 / 未读')], ['Shift + A', L('当前列表全部已读')], ['V', L('切换 卡片 / 时间线 / 表格')], ['N', L('显示 / 隐藏厂商资讯')], ['1 – 7', ("AI " + L('优惠 / 收藏 / 厂商 / 源健康 / 规则 / 聚合源 / 设置'))], ['Esc', L('关闭详情 / 弹窗')], ['?', L('显示本帮助')]];
  openModal(`<div class="mh"><h3>${L('键盘快捷键')}</h3><button class="mini" data-m="close">${ic('x')}</button></div><div class="mb"><table class="grid compact keys">${K.map(([k, v]) => `<tr><td><kbd>${k.split(' ').map((x) => /^[+/–]|或$/.test(x) ? x : `<b>${esc(x)}</b>`).join(' ')}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table></div><div class="mf"><button class="btn" data-m="close">${L('关闭')}</button></div>`);
}
let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new AudioContext();
    const t = audioCtx.currentTime;
    [880, 1320].forEach((f, i) => { const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(0.0001, t + i * 0.16); g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.15); o.connect(g).connect(audioCtx.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.16); });
  } catch { /* 无音频设备 */ }
}
function moveSel(delta) {
  const list = filteredDeals().slice(0, S.page * S.PAGE); if (!list.length) return;
  let i = list.findIndex((d) => d.id === S.sel); i = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + delta));
  selectDeal(list[i].id);
  setTimeout(() => { const el = $(`#dealList [data-id="${list[i].id}"]`); el && el.scrollIntoView({ block: 'nearest' }); }, 30);
}

// —— 弹窗 ——
function openModal(html, onMount) {
  $('#modal').classList.remove('wide', 'xl'); $('#modal').innerHTML = html; $('#modalMask').classList.add('show');
  onMount && onMount($('#modal'));
  const first = $('#modal input:not([type=checkbox])'); first && setTimeout(() => first.focus(), 30);
}
function openVendor(id) { S.vendor = id; go('vendor'); $('#view-vendor .page-scroll').scrollTop = 0; }
function closeModal() { cancelDiscover(); if (S.cs && S.cs.running) window.api.call('discover:cancel', S.cs.jobId).catch(() => {}); S.cs = null; $('#modalMask').classList.remove('show'); $('#modal').innerHTML = ''; $('#modal').classList.remove('wide', 'xl'); }

// 快速添加：名称 → 默认关键词（含中文名，方便中文资讯源匹配）
const AI_IDEAS = { 'Grammarly': 'Grammarly', 'Zoom': 'Zoom AI Companion', 'Dropbox': 'Dropbox, Dropbox Dash', 'Slack': 'Slack AI', 'Atlassian': 'Atlassian, Jira, Confluence, Rovo', 'Salesforce': 'Salesforce, Agentforce', 'Apple Intelligence': 'Apple Intelligence', 'Samsung Galaxy AI': 'Galaxy AI', 'Stability AI': 'Stability AI, Stable Diffusion', 'NVIDIA': 'NVIDIA NIM, NVIDIA AI', 'Hugging Face': 'Hugging Face, HuggingFace', 'JetBrains': 'JetBrains, JetBrains AI, Junie', 'Vercel v0': 'v0.dev, v0 by Vercel', 'Replit': 'Replit', 'Windsurf': 'Windsurf, Codeium', 'Kling 可灵': ("Kling AI, " + L('可灵')), '百川智能': (L('百川智能') + ", Baichuan"), '零一万物': (L('零一万物') + ", Yi-Large"), '阶跃星辰': (L('阶跃星辰') + ", StepFun"), '昆仑天工': L('天工AI, 昆仑万维') };
const GOODS_IDEAS = { 'Puma': ("Puma, " + L('彪马')), 'New Balance': ("New Balance, " + L('新百伦')), 'Lululemon': ("Lululemon, " + L('露露乐蒙')), 'Canon': ("Canon, " + L('佳能')), 'Nikon': ("Nikon, " + L('尼康')), 'Fujifilm': ("Fujifilm, " + L('富士')), 'GoPro': 'GoPro', 'DJI': ("DJI, " + L('大疆')), 'Razer': ("Razer, " + L('雷蛇')), 'NVIDIA': ("NVIDIA, GeForce, RTX, " + L('英伟达')), 'AMD': ("AMD, Ryzen, Radeon, " + L('锐龙')), 'OnePlus': ("OnePlus, " + L('一加')), 'Kindle': 'Kindle', 'Garmin': ("Garmin, " + L('佳明')), 'Roborock': ("Roborock, " + L('石头科技')), 'Steam Deck': 'Steam Deck', 'IKEA': ("IKEA, " + L('宜家')) };
const PRESET_IDEAS = { ...AI_IDEAS, ...GOODS_IDEAS };
function brandModal(b, cat) {
  const isEdit = !!b; b = b || { name: '', aliases: [], exclude: [], category: cat || (S.view === 'goods' ? 'goods' : 'ai') };
  const existing = new Set(S.state.brands.map((x) => x.name.toLowerCase()));
  const ideas = (c) => Object.keys(c === 'goods' ? GOODS_IDEAS : AI_IDEAS).filter((n) => !existing.has(n.toLowerCase())).slice(0, 30).map((n) => `<button data-preset="${esc(n)}">${esc(n)}</button>`).join('');
  const c0 = b.category || 'ai';
  openModal(`<div class="mh"><h3>${isEdit ? L('编辑厂商 / 关键词') : L('添加厂商 / 关键词')}</h3><button class="mini" data-m="close">${ic('x')}</button></div>
    <div class="mb">
      <div class="field"><label>${L('类别')}</label><div class="seg" id="bmCat"><button data-v="ai" class="${c0 === 'ai' ? 'on' : ''}">AI / ${L('软件厂商')}</button><button data-v="goods" class="${c0 === 'goods' ? 'on' : ''}">${L('实物商品品牌')}</button></div></div>
      ${isEdit ? '' : `<div class="field"><label>${L('快速添加')}</label><div class="presets" id="bmIdeas">${ideas(c0)}</div></div>`}
      <div class="field"><label>${L('名称')} *</label><input class="input" id="bmName" value="${esc(b.name)}" placeholder="${L('厂商 / 产品名（如 Grammarly、Slack AI）或任意关键词（如 GPT-6、Claude Max）')}" maxlength="40"></div>
      <div class="field"><label>${L('匹配关键词 / 别名')}</label><input class="input" id="bmAliases" value="${esc(b.aliases.join(', '))}" placeholder="${L('用逗号分隔，例如：')}Grammarly, Grammarly Pro"><p class="hint">${L('标题中出现任一关键词即视为该厂商。英文按完整单词匹配（不区分大小写），末尾加 * 表示后面可接型号数字（如 GPT-* 可匹配 GPT-6）；中文按包含匹配。名称本身会自动作为关键词。')}</p></div>
      <div class="field"><label>${L('排除词（可选）')}</label><input class="input" id="bmExclude" value="${esc((b.exclude || []).join(', '))}" placeholder="${L('例如：mouse cursor, 光标')}"><p class="hint">${L('标题包含排除词时不算该厂商，用于减少误报。')}</p></div>
      <label class="chk"><input type="checkbox" id="bmNotify" ${b.notify === false ? '' : 'checked'}> ${L('有新优惠时弹出桌面通知')}</label>
      <div class="form-err" id="bmErr"></div>
    </div>
    <div class="mf"><button class="btn" data-m="close">${L('取消')}</button><button class="btn primary" data-m="saveBrand">${isEdit ? L('保存') : L('添加并启用')}</button></div>`, (m) => {
    m.dataset.id = isEdit ? b.id : '';
    $('#bmCat', m).addEventListener('click', (e) => { const x = e.target.closest('button'); if (!x) return; $$('#bmCat button', m).forEach((y) => y.classList.toggle('on', y === x)); const box = $('#bmIdeas', m); if (box) box.innerHTML = ideas(x.dataset.v); });
  });
}
// 厂商渠道：多协议采集（v2.0）
const F = {
  url: [(L('地址') + " *"), 'https://'], keyword: [L('关键词'), ''], selector: [("CSS " + L('选择器（可选）')), L('例如 main、#pricing、.plans（只比较这一部分，减少误报）')],
  itemsPath: [(L('条目数组') + " JSONPath *"), ("$.data.items " + L('或 items；根数组填') + " $")], titleField: [L('标题字段'), ("title" + L('（支持 a.b 路径或') + " {name} - {version} " + L('模板）'))], linkField: [L('链接字段'), 'url'], dateField: [L('日期字段'), 'published_at'], summaryField: [L('摘要字段（可选）'), 'description'], linkPrefix: [L('链接前缀（可选）'), 'https://example.com/post/'],
  list: [(L('列表项选择器') + " *"), 'article, .post-item, a[href*="/blog/"]'], title: [L('标题选择器（可选）'), ("h2, h3" + L('（默认整项文字）'))], link: [L('链接选择器（可选）'), ("a" + L('（默认第一个链接）'))], date: [L('日期选择器（可选）'), 'time'], summary: [L('摘要选择器（可选）'), 'p'],
  wait: [L('渲染等待（毫秒）'), '2500'], filter: [("URL " + L('过滤（只看包含此串的 URL）')), ("/blog/ " + L('或') + " /news/")],
  repo: [(L('仓库') + " *"), ("owner/repo" + L('，例如') + " openai/codex")], branch: [L('分支（提交）'), 'main'], query: [(L('搜索词') + " *"), (L('例如') + " Claude credits")], minPoints: [L('最低分数'), '20'],
  sub: [(L('版块名') + " *"), L('例如 OpenAI（不带 r/）')], rquery: [L('版内搜索（可选）'), 'free OR discount'], category: [L('分类 slug（可选）'), 'announcements'], channel: [(L('频道名') + " *"), L('例如 durov（t.me/s/ 后面的部分）')],
  instance: [L('实例域名'), 'mastodon.social'], acct: [L('账号'), ("Mozilla " + L('或') + " user@instance")], tag: [L('或 话题'), ("chatgpt" + L('（不带 #）'))], handle: [("Bluesky " + L('账号') + " *"), (L('例如 github.com、') + "notion.com")],
  channelId: [("YouTube " + L('频道') + " ID *"), ("UC " + L('开头的 24 位') + " ID")], appId: [("App Store " + L('应用') + " ID *"), (L('数字，如 ChatGPT 为') + " 6448311069")], country: [L('国家/地区'), 'us / cn / jp'], pkg: [("Google Play " + L('包名') + " *"), (L('如') + " com.openai.chatgpt")], route: [("RSSHub " + L('路由') + " *"), ("/twitter/user/OpenAI" + L('、') + "/weibo/user/…")],
};
const PROTO_FIELDS = {
  rss: ['url'], jsonfeed: ['url'], producthunt: ['url'], json: ['url', 'itemsPath', 'titleField', 'linkField', 'dateField', 'summaryField', 'linkPrefix'],
  html: ['url', 'list', 'title', 'link', 'date', 'summary', '#render'], page: ['url', 'selector', 'keyword', '#render'], render: ['url', 'selector', 'keyword', 'wait'], sitemap: ['url', 'filter'],
  github: ['repo', '@what', 'branch', '#api'], hn: ['query', 'minPoints'], reddit: ['sub', 'rquery'], discourse: ['url', 'category'], telegram: ['channel'], mastodon: ['instance', 'acct', 'tag'],
  bluesky: ['handle'], youtube: ['channelId'], appstore: ['appId', 'country'], gplay: ['pkg'], rsshub: ['route'], search: ['keyword', '@engine'],
};
const PROTO_HINT = {
  rss: ("RSS 2.0 / Atom / RDF" + L('（RSS 1.0），也自动识别 JSON Feed。官方博客、更新日志、状态页、GitHub …/releases.atom 等。')),
  jsonfeed: ("JSON Feed 1.0/1.1" + L('（jsonfeed.org）。')), producthunt: ("Product Hunt " + L('官方 RSS（可加') + " ?category=artificial-intelligence" + L('）。')),
  json: L('任意返回 JSON 的接口：用 JSONPath 指定条目数组，再映射标题 / 链接 / 日期字段。可在「高级」里加请求头（如 Authorization）。'),
  html: L('没有 RSS 的列表页：用 CSS 选择器指定每一项及其标题 / 链接 / 日期。动态页面可勾选 JS 渲染。'),
  page: L('定时抓取网页文字并与上次对比，变化时生成一条动态并附 +/- 差异。首次只建立基线。适合价格页、活动页。'),
  render: L('用隐藏的浏览器打开页面、执行 JS 后再对比文字。可监控 Perplexity、x.ai、Midjourney、Canva 等普通请求被拦截或内容由 JS 生成的页面（较慢）。'),
  sitemap: L('读取网站 sitemap.xml（自动展开 sitemap 索引），出现新 URL 时提醒——发现官网新发布的博客 / 公告页最快的办法之一。'),
  github: L('仓库的 Releases / Tags / Commits（默认 Atom 订阅，无频率限制）；勾选 API 模式可配合 Token 使用 GitHub REST API。'),
  hn: ("Hacker News" + L('（Algolia 搜索 API），可设最低分数过滤噪音。')), reddit: ("Reddit " + L('版块最新帖子或版内搜索（RSS）。匿名访问有频率限制。')),
  discourse: ("Discourse " + L('论坛（community.openai.com、forum.cursor.com、discuss.ai.google.dev …）的最新话题 JSON。')),
  telegram: ("Telegram " + L('公开频道网页预览 t.me/s/频道名（无需登录）。')), mastodon: ("Mastodon " + L('公开 API：指定账号（acct）或话题（tag）。')),
  bluesky: ("Bluesky " + L('公开 API（public.api.bsky.app），账号的最新帖子（不含回复/转发）。')), youtube: ("YouTube " + L('频道视频 RSS。')),
  appstore: ("App Store " + L('应用新版本（iTunes Lookup API），每个新版本一条，附更新说明。')), gplay: ("Google Play " + L('应用更新日期变化。')),
  rsshub: (L('使用你在「设置') + " → " + L('采集引擎」中填写的自建 RSSHub 实例，支持 X / 微博 / 公众号 / B 站等数千条路由。')), search: ("Google " + L('新闻或 Bing 资讯搜索这个关键词（近 30 天）。')),
};
function protoOptions(sel) {
  const P = S.state.protocols || {}; const groups = {};
  for (const [k, v] of Object.entries(P)) (groups[v.group] ||= []).push([k, v.label]);
  return Object.entries(groups).map(([g, arr]) => `<optgroup label="${esc(g)}">${arr.map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`).join('');
}
function channelModal(b, c) {
  const isEdit = !!c; c = c || { type: 'rss', name: '', url: '', keyword: '', selector: '', sub: 'blog', opts: {} };
  const o = c.opts || {};
  const subs = Object.entries(S.state.subs || CH_SUB).map(([k, v]) => `<option value="${k}" ${c.sub === k ? 'selected' : ''}>${v}</option>`).join('');
  const val = (k) => (k === 'url' || k === 'keyword' || k === 'selector') ? (c[k] || '') : k === 'rquery' ? (o.query || '') : (o[k] ?? '');
  const fields = Object.entries(F).map(([k, [l, ph]]) => `<div class="field cmf" data-f="${k}"><label>${l}</label><input class="input" id="cf_${k}" value="${esc(val(k))}" placeholder="${esc(ph)}"></div>`).join('');
  openModal(`<div class="mh"><h3>${isEdit ? L('编辑渠道') : L('添加渠道')} · ${esc(b.name)}</h3><button class="mini" data-m="close">${ic('x')}</button></div>
    <div class="mb cm-grid">
      <div class="cm-left">
        <div class="field smart"><label>${ic('sparkle')} ${L('智能识别')} <span class="hint">${L('粘贴网址，或用一句话描述，如「Claude 的定价页改价提醒」')}</span></label><div class="smart-row"><input class="input" id="cmSmart" placeholder="https://… ${L('或 自然语言描述')}"><button class="btn ai" data-m="smartChannel" id="cmSmartGo">${L('识别')}</button></div><p class="hint" id="cmSmartNote">${aiReady() ? L('将使用 AI 辅助识别协议与 CSS 选择器。') : L('未配置 AI：使用内置规则识别（订阅源自动发现、JSON 字段猜测、列表选择器推断）。')}</p></div>
        <div class="field"><label>${L('采集协议')}</label><select id="cmProto">${protoOptions(c.type)}</select><p class="hint" id="cmHint"></p></div>
        ${fields}
        <div class="field cmf" data-f="@what"><label>${L('类型')}</label><select id="cf_what"><option value="releases" ${o.what !== 'tags' && o.what !== 'commits' ? 'selected' : ''}>Releases ${L('发布')}</option><option value="tags" ${o.what === 'tags' ? 'selected' : ''}>Tags ${L('标签')}</option><option value="commits" ${o.what === 'commits' ? 'selected' : ''}>Commits ${L('提交')}</option></select></div>
        <div class="field cmf" data-f="@engine"><label>${L('搜索引擎')}</label><select id="cf_engine"><option value="google">Google ${L('新闻')}</option><option value="bing" ${o.engine === 'bing' ? 'selected' : ''}>Bing ${L('资讯')}</option></select></div>
        <label class="chk cmf" data-f="#render"><input type="checkbox" id="cf_render" ${c.render || o.render ? 'checked' : ''}> ${L('使用 JS 渲染（隐藏浏览器，适合动态页面 / 反爬页面）')}</label>
        <label class="chk cmf" data-f="#api"><input type="checkbox" id="cf_api" ${o.api ? 'checked' : ''}> ${L('使用 GitHub REST API（匿名 60 次/小时；在高级里加 Authorization 请求头可提高额度）')}</label>
        <div class="row2"><div class="field"><label>${L('名称')}</label><input class="input" id="cmName" value="${esc(c.name || '')}" placeholder="${L('留空自动生成')}"></div>
        <div class="field"><label>${L('类别')}</label><select id="cmSub">${subs}</select></div></div>
        <details class="adv" ${c.interval || c.timeout || c.ua || c.headers || c.include || c.exclude || c.regex || c.proxy === false ? 'open' : ''}><summary>${L('高级选项：周期 / 超时 / 请求头 / 代理 / 过滤')}</summary>
          <div class="row2"><div class="field"><label>${L('独立刷新周期（分钟）')}</label><input class="input" id="cmInterval" type="number" min="0" value="${esc(c.interval || '')}" placeholder="0 = ${L('跟随全局')}"></div>
          <div class="field"><label>${L('超时（秒）')}</label><input class="input" id="cmTimeout" type="number" min="0" value="${esc(c.timeout || '')}" placeholder="20"></div></div>
          <div class="field"><label>User-Agent${L('（可选）')}</label><input class="input" id="cmUA" value="${esc(c.ua || '')}" placeholder="${L('默认模拟')} Chrome"></div>
          <div class="field"><label>${L('自定义请求头（每行一个）')}</label><textarea class="input" id="cmHeaders" rows="2" placeholder="Authorization: Bearer xxx&#10;Accept-Language: zh-CN">${esc(c.headers || '')}</textarea></div>
          <label class="chk"><input type="checkbox" id="cmProxy" ${c.proxy === false ? '' : 'checked'}> ${L('走应用代理设置（取消则此渠道直连，适合国内站点）')}</label>
          <div class="row2"><div class="field"><label>${L('只保留包含（逗号分隔）')}</label><input class="input" id="cmInclude" value="${esc(c.include || '')}" placeholder="free, discount, ${L('免费')}"></div>
          <div class="field"><label>${L('排除包含')}</label><input class="input" id="cmExclude" value="${esc(c.exclude || '')}" placeholder="hiring, ${L('招聘')}"></div></div>
          <div class="field"><label>${L('标题正则（可选）')}</label><input class="input" id="cmRegex" value="${esc(c.regex || '')}" placeholder="(?i)(free|\\d+% off)"></div>
        </details>
        <div class="form-err" id="cmErr"></div>
      </div>
      <div class="cm-right"><div class="pv-head"><b>${L('测试预览')}</b><button class="btn sm" data-m="previewChannel">${ic('play')}${L('测试')}</button></div><div class="pv" id="cmPreview"><p class="hint">${L('填写后点「测试」，不保存即可看到抓取结果。')}</p></div></div>
    </div>
    <div class="mf"><button class="btn" data-m="close">${L('取消')}</button><button class="btn primary" data-m="saveChannel">${isEdit ? L('保存并检测') : L('添加并检测')}</button></div>`, (m) => {
    m.dataset.brand = b.id; m.dataset.ch = isEdit ? c.id : '';
    const sync = () => {
      const t = $('#cmProto', m).value; const fs = PROTO_FIELDS[t] || ['url'];
      $$('.cmf', m).forEach((el) => { el.style.display = fs.includes(el.dataset.f) ? '' : 'none'; });
      $('#cmHint', m).textContent = PROTO_HINT[t] || '';
      const kl = $('.cmf[data-f=keyword] label', m); if (kl) kl.textContent = t === 'search' ? (L('搜索关键词') + " *") : L('只关注包含这些词的行（可选，逗号分隔）');
      if (!isEdit) $('#cmSub', m).value = { page: 'pricing', render: 'pricing', search: 'news', appstore: 'app', gplay: 'app', bluesky: 'social', mastodon: 'social', telegram: 'social', rsshub: 'social', github: 'github', discourse: 'forum', hn: 'forum', reddit: 'reddit', youtube: 'youtube' }[t] || 'blog';
    };
    $('#cmProto', m).addEventListener('change', sync); sync();
    const detectPaste = async (url, announce) => {
      const d = await call('channel:detect', url).catch(() => null);
      if (!d || !$('#cmProto')) return;
      fillChannelForm(d);
      if (announce && $('#cmSmartNote')) $('#cmSmartNote').innerHTML = ic('check') + ' ' + esc(L('已根据网址识别为 {0} · {1}。点「识别」可再抓取页面、发现订阅源。', protoLabel(d.type), L(d.reason)));
    };
    const onPasteUrl = (el, announce) => (e) => {
      const clip = (e.clipboardData && e.clipboardData.getData('text')) || '';
      setTimeout(() => { const v = (el.value || clip || '').trim(); if (v) detectPaste(v, announce); }, 0);
    };
    if ($('#cmSmart', m)) $('#cmSmart', m).addEventListener('paste', onPasteUrl($('#cmSmart', m), true));
    if ($('#cf_url', m)) {
      $('#cf_url', m).addEventListener('paste', onPasteUrl($('#cf_url', m), false));
      $('#cf_url', m).addEventListener('blur', () => { const v = ($('#cf_url') && $('#cf_url').value || '').trim(); if (v) detectPaste(v, false); });
    }
  });
  $('#modal').classList.add('wide');
}
function readChannelForm() {
  const m = $('#modal'); const t = $('#cmProto').value; const fs = PROTO_FIELDS[t] || ['url'];
  const c = { id: m.dataset.ch || undefined, type: t, name: $('#cmName').value.trim(), sub: $('#cmSub').value, opts: {} };
  for (const f of fs) {
    if (f === '@what') c.opts.what = $('#cf_what').value; else if (f === '@engine') c.opts.engine = $('#cf_engine').value;
    else if (f === '#render') c.render = $('#cf_render').checked; else if (f === '#api') c.opts.api = $('#cf_api').checked;
    else if (f === 'url' || f === 'keyword' || f === 'selector') c[f] = $('#cf_' + f).value.trim();
    else if (f === 'rquery') c.opts.query = $('#cf_rquery').value.trim();
    else c.opts[f] = $('#cf_' + f).value.trim();
  }
  if (c.opts.minPoints) c.opts.minPoints = Number(c.opts.minPoints) || 0;
  if (c.opts.wait) c.opts.wait = Number(c.opts.wait) || 2500;
  Object.assign(c, { interval: Number($('#cmInterval').value) || 0, timeout: Number($('#cmTimeout').value) || 0, ua: $('#cmUA').value.trim(), headers: $('#cmHeaders').value.trim(), proxy: $('#cmProxy').checked ? undefined : false, include: $('#cmInclude').value.trim(), exclude: $('#cmExclude').value.trim(), regex: $('#cmRegex').value.trim() });
  return c;
}
async function previewChannel() {
  const box = $('#cmPreview'); const btn = $('#modal [data-m=previewChannel]');
  let c; try { c = readChannelForm(); } catch (e) { $('#cmErr').textContent = e.message; return; }
  btn.disabled = true; box.innerHTML = `<span class="status"><i class="dot run"></i>${L('正在抓取')}${c.type === 'render' || c.render ? (L('（JS 渲染约需') + " 5–20 " + L('秒）')) : ''}…</span>`;
  try {
    const r = await window.api.call('channel:preview', $('#modal').dataset.brand, c);
    const st = r.status;
    let html = `<div class="status" style="color:${st.ok ? 'var(--ok)' : 'var(--err)'}"><i class="dot ${st.ok ? 'ok' : 'err'}"></i>${st.ok ? L('成功') : L('失败')} · ${(r.ms / 1000).toFixed(1)}s${st.ok ? ` · ${r.kind === 'page' ? `${r.lineCount || st.total} ${L('行')}` : `${st.total} ${L('条')}`}` : ''}</div>${st.error ? `<p class="err-text wrap">${esc(st.error)}</p>` : ''}${st.note ? `<p class="hint">${esc(st.note)}</p>` : ''}<p class="hint mono" title="${esc(r.url)}">${esc(r.url)}</p>`;
    if (r.lines) html += `<pre class="snap sm">${esc(r.lines.join('\n'))}</pre>`;
    else html += r.items.map((it) => `<div class="pv-item"><span class="tags">${offerTags({ category: 'ai', offerTypes: it.offerTypes })}</span> <span>${esc(it.title)}</span><small>${it.published ? fmtTime(it.published) : ''}</small></div>`).join('') || (st.ok ? ("<p class=\"hint\">0 " + L('条（过滤条件太严或该渠道暂无内容）') + "</p>") : '');
    box.innerHTML = html;
  } catch (e) { box.innerHTML = `<p class="err-text wrap">${esc(e.message)}</p>`; } finally { btn.disabled = false; }
}
function snapshotModal(b, c) {
  const sid = `ch-${b.id}-${c.id}`; const p = S.state.pages[sid] || {};
  openModal(`<div class="mh"><h3>${L('页面快照')} · ${esc(b.name)} · ${esc(c.name)}</h3><button class="mini" data-m="close">${ic('x')}</button></div>
    <div class="mb"><p class="hint">${L('共 {0} 行 · 基线/上次检测', p.lines || 0)} ${p.at ? fmtTime(p.at) : '—'}${p.changedAt ? (" · " + L('上次变化') + " ") + fmtTime(p.changedAt) : (" · " + L('尚未检测到变化'))}${L('。下面是提取到的前 40 行文字，内容变化时会生成一条「价格页变动」动态。')}</p>
    <pre class="snap">${esc((p.preview || []).join('\n'))}</pre></div>
    <div class="mf"><button class="btn" data-m="close">${L('关闭')}</button></div>`);
  $('#modal').classList.add('wide');
}
function sourceModal() {
  openModal(`<div class="mh"><h3>${L('添加自定义聚合数据源')}</h3><button class="mini" data-m="close">${ic('x')}</button></div>
    <div class="mb">
      <div class="field"><label>RSS / Atom ${L('地址')} *</label><input class="input" id="smUrl" placeholder="https://example.com/feed.xml"><p class="hint">${L('支持 RSS 2.0 / Atom / RSS 1.0。地址中包含')} <code>{q}</code> ${L('时会作为「按厂商搜索」模板，每个厂商各请求一次。')}</p></div>
      <div class="field"><label>${L('名称')}</label><input class="input" id="smName" placeholder="${L('留空则使用网站域名')}"></div>
      <div class="field"><label>${L('平台/分组')}</label><input class="input" id="smPlatform" placeholder="${L('例如：我的订阅')}" value="${L('自定义')}"></div>
      <div class="field"><label>${L('地区')}</label><div class="seg" id="smRegion"><button data-v="intl" class="on">${L('国际')}</button><button data-v="cn">${L('中文')}</button></div></div>
      <div class="field"><label>${L('内容类型')}</label><div class="seg" id="smKind"><button data-v="community" class="on">AI/${L('软件 社区或资讯（需含厂商 + 优惠特征）')}</button><button data-v="deal">${L('实物优惠站（仅匹配品牌）')}</button></div><p class="hint">${L('只属于某一个厂商的官方博客/更新日志，建议在「厂商与渠道')} → ${L('渠道」中添加，所有条目都会归属该厂商。')}</p></div>
      <div class="form-err" id="smErr"></div>
    </div>
    <div class="mf"><button class="btn" data-m="close">${L('取消')}</button><button class="btn primary" data-m="saveSource">${L('添加并检测')}</button></div>`, (m) => {
    m.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }));
  });
}
// 首次启动引导：选择 AI 厂商 + 可选实物商品 + 网络提示
function welcomeModal() {
  const st = S.state;
  const ai = st.brands.filter((b) => (b.category || 'ai') === 'ai');
  const aiGroups = (st.brandGroups || []).filter((g) => g.ai).map((g) => g.id);
  // v2.2：AI 大模型 / 智能体 / 创作工具类默认全部勾选
  const chosen = new Set(ai.filter((b) => b.enabled || aiGroups.includes(groupOf(b))).map((b) => b.id));
  const nCh = ai.reduce((a, b) => a + (b.channels || []).length, 0);
  const chip = (b) => `<button class="chip ${chosen.has(b.id) ? 'on' : ''}" data-wb="${esc(b.id)}">${avatar(b.id, 'span')}${esc(b.name)}</button>`;
  const chips = () => (st.brandGroups || []).filter((g) => g.id !== 'goods').map((g) => { const gb = ai.filter((b) => groupOf(b) === g.id); return gb.length ? `<div class="wgroup"><div class="wgh"><b>${esc(g.name)}</b>${g.ai ? ("<span class=\"tag\">" + L('默认全选') + "</span>") : ''}<button class="mini" data-wg="${g.id}">${L('全选 / 全不选')}</button></div>${gb.map(chip).join('')}</div>` : ''; }).join('');
  openModal(`<div class="wz-lang">${langSelect('wzLang')}</div><div class="welcome-hero"><img src="../../assets/icon.png" alt=""><div><h3>${L('欢迎使用全网优惠雷达')}</h3><p>${L('实时监控 ChatGPT、Claude、Gemini、Cursor、DeepSeek 等 AI / 软件厂商的最新优惠：免费试用、学生优惠、API 赠送额度、降价、新用户优惠、黑五、创业扶持计划。每个厂商有自己的官方渠道（博客、价格页变化监控、更新日志、社区，共 {0} 个），再加上', nCh)} ${st.sources.filter((s) => s.category === 'ai').length} ${L('个全网聚合源。')}</p></div></div>
    <div class="mb">
      <div class="field"><label>1. ${L('选择要监控的厂商')} <span class="hint" id="wbCount"></span></label><div class="chips" id="wbChips">${chips()}</div><p class="hint">${L('没有你要的？稍后在「厂商与渠道')} → ${L('添加」里可以添加任意厂商或关键词（如 Grammarly、GPT-6），并为它添加渠道。')}</p></div>
      <div class="field"><label>${L('快速预设（可选，可多选）')}</label>${presetChips('wzPresets')}<p class="hint">${L('预设会补充「适用于我」画像、启用相关厂商分组并新增一条提醒规则，不会删除你的现有设置。')}</p></div>
      <div class="field"><label>2. ${L('实物商品优惠（可选）')}</label><label class="chk"><input type="checkbox" id="wbGoods" ${st.settings.goodsEnabled ? 'checked' : ''}> ${L('同时监控 Apple、Nike、Dyson 等实物商品的打折信息')}</label></div>
      <div class="field"><label>3. ${L('网络')}</label><div class="seg" id="wbProxy"><button data-v="system" class="${st.settings.proxyMode !== 'direct' && st.settings.proxyMode !== 'custom' ? 'on' : ''}">${L('跟随系统代理（推荐）')}</button><button data-v="direct" class="${st.settings.proxyMode === 'direct' ? 'on' : ''}">${L('不使用代理')}</button></div>
        <p class="hint">OpenAI${L('、Google、Reddit、Hacker News 等境外站点在中国大陆需要代理才能访问。若你使用 Clash / v2rayN 等，请开启其「系统代理」；也可稍后在「设置')} → ${L('网络代理」中填写地址。V2EX、IT之家、少数派等中文源通常无需代理。')}</p></div>
    </div>
    <div class="mf"><span class="grow hint" style="margin:0">${L('之后可随时在「厂商与渠道」「设置」中修改')}</span><button class="btn primary" data-m="welcomeDone">${L('开始监控')}</button></div>`, (m) => {
    const count = () => { $('#wbCount', m).textContent = `${L('已选 {0} 个', chosen.size)}`; };
    count();
    $('#wbChips', m).addEventListener('click', (e) => { const wg = e.target.closest('[data-wg]'); if (wg) { const ids = ai.filter((b) => groupOf(b) === wg.dataset.wg).map((b) => b.id); const allOn = ids.every((id) => chosen.has(id)); for (const id of ids) allOn ? chosen.delete(id) : chosen.add(id); $('#wbChips', m).innerHTML = chips(); count(); return; } const c = e.target.closest('[data-wb]'); if (!c) return; const id = c.dataset.wb; chosen.has(id) ? chosen.delete(id) : chosen.add(id); c.classList.toggle('on', chosen.has(id)); count(); });
    $('#wbProxy', m).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('#wbProxy button', m).forEach((x) => x.classList.toggle('on', x === b)); });
    S.welcome = { chosen };
  });
  $('#modal').classList.add('wide');
}
async function finishWelcome() {
  const chosen = [...S.welcome.chosen];
  if (!chosen.length) { toast(L('请至少选择一个厂商'), 'err'); return; }
  const before = S.state.brands.filter((b) => b.enabled && (b.category || 'ai') === 'ai').map((b) => b.id).sort().join();
  const proxyMode = $('#wbProxy .on').dataset.v;
  const goods = $('#wbGoods').checked;
  closeModal(); $('#modal').classList.remove('wide');
  await call('brand:enableOnly', chosen, 'ai');
  if (goods !== !!S.state.settings.goodsEnabled) await call('goods:set', goods);
  await saveSetting({ onboarded: true, ...(proxyMode !== S.state.settings.proxyMode ? { proxyMode } : {}) });
  if (before !== chosen.slice().sort().join()) refreshNow(true);
  toast(`${L('已开始监控 {0} 个厂商', chosen.length)}`, 'ok');
}
function confirmModal(title, text, okText, danger = true) {
  return new Promise((resolve) => {
    openModal(`<div class="mh"><h3>${esc(title)}</h3></div><div class="mb"><div>${esc(text)}</div></div>
      <div class="mf"><button class="btn" data-m="cancel">${L('取消')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-m="ok">${esc(okText)}</button></div>`);
    S.confirmResolve = resolve;
  });
}

// —— 操作 ——
async function refreshNow(quiet) {
  const r = await call('poll:now');
  if (r && r.busy) { if (!quiet) toast(r.queued ? L('正在刷新中，本轮结束后会自动再扫描一次') : L('正在刷新中，请稍候')); return; }
  else if (r) toast(r.added ? `${L('刷新完成，新增 {0} 条优惠', r.added)}` : L('刷新完成，暂无新优惠'), 'ok');
}
// 本地乐观更新：记录最近的修改，避免在途的旧状态推送把它覆盖回去
const pending = new Map();
function patchDeal(id, patch) {
  const d = S.state.deals.find((x) => x.id === id);
  if (d) { Object.assign(d, patch); if (Object.keys(patch).length) pending.set(id, { ...(pending.get(id) || {}), ...patch, _t: Date.now() }); }
  return d;
}
function applyPending(deals) {
  const now = Date.now();
  for (const [id, p] of pending) { if (now - p._t > 5000) { pending.delete(id); continue; } const d = deals.find((x) => x.id === id); if (d) { const { _t, ...rest } = p; Object.assign(d, rest); } }
}
async function toggleFav(id) { const cur = S.state.deals.find((x) => x.id === id); if (!cur) return; const d = patchDeal(id, { fav: !cur.fav }); await call('deal:fav', id, d.fav); renderAll(); }
async function openDeal(id) { const d = patchDeal(id, { read: true }); if (!d) return; await call('deal:open', d.link); call('deal:read', [id], true); renderAll(); }
async function selectDeal(id) {
  S.sel = id; const d = patchDeal(id, {});
  if (d && !d.read) { patchDeal(id, { read: true }); call('deal:read', [id], true); }
  renderAll();
}
async function exportCSV() {
  const list = filteredDeals();
  if (!list.length) { toast(L('当前列表为空，无可导出内容'), 'err'); return null; }
  const r = await call('deal:export', list.map((d) => d.id));
  if (r) toast(`${L('已导出 {0} 条到', r.count)} ${r.path}`, 'ok');
  return r;
}
async function netCheck() {
  const box = $('#netResult'); const btn = $('#btnNetCheck');
  btn.disabled = true; box.innerHTML = ("<span class=\"status\"><i class=\"dot run\"></i>" + L('正在检测网络连通性') + "…</span>");
  try {
    const r = await call('net:check');
    const intlBad = r.slice(1).every((x) => !x.ok);
    box.innerHTML = r.map((x) => `<div class="status" style="color:${x.ok ? 'var(--ok)' : 'var(--err)'}"><i class="dot ${x.ok ? 'ok' : 'err'}"></i>${esc(x.name)}${L('：')}${x.ok ? `${L('可访问（{0} ms）', x.ms)}` : esc(x.error)}</div>`).join('')
      + (r[0].ok && intlBad ? ("<p class=\"hint\">" + L('国内正常、境外不通：需要代理。开启代理软件的「系统代理」后选「跟随系统」，或直接点上方常用端口。') + "</p>") : r.every((x) => x.ok) ? ("<p class=\"hint\">" + L('网络正常，所有数据源都可以访问。') + "</p>") : '');
  } catch { box.innerHTML = ''; } finally { btn.disabled = false; }
}
async function saveSetting(patch) { S.state.settings = await call('settings:save', patch); renderAll(); }

// —— 事件绑定 ——
function bind() {
  $('#wMin').onclick = () => call('win:min');
  $('.titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('input,button,.search')) call('win:max'); });
  $('#wMax').onclick = () => call('win:max');
  $('#wClose').onclick = () => call('win:close');
  $('#btnTheme').onclick = () => saveSetting({ theme: S.state.settings.theme === 'light' ? 'dark' : 'light' });

  $$('.nav-item').forEach((n) => n.addEventListener('click', () => go(n.dataset.view)));
  $('#sideBrands').addEventListener('click', (e) => {
    const it = e.target.closest('.brand-item'); if (!it) return;
    if (it.dataset.go) return go(it.dataset.go);
    S.f.brand = it.dataset.b; S.page = 1; if (S.view !== 'deals' && S.view !== 'favs' && S.view !== 'goods') go('deals'); else renderAll();
  });

  const onQ = debounce(() => { S.f.q = $('#q').value.trim(); S.page = 1; if (S.f.q && S.view !== 'deals' && S.view !== 'favs' && S.view !== 'goods') go('deals'); else renderAll(); }, 180);
  $('#q').addEventListener('input', onQ);
  $('#fBrand').onchange = (e) => { S.f.brand = e.target.value; S.page = 1; renderAll(); };
  $('#fPlatform').onchange = (e) => { S.f.platform = e.target.value; S.page = 1; renderAll(); };
  $('#fType').onchange = (e) => { S.f.type = e.target.value; S.page = 1; renderAll(); };
  $('#fNews').onchange = (e) => { S.f.news = e.target.checked; S.page = 1; renderAll(); };
  $('#fUnread').onchange = (e) => { S.f.unread = e.target.checked; S.page = 1; renderAll(); };
  $('#fSort').onchange = (e) => { S.f.sort = e.target.value; S.page = 1; renderAll(); };
  $('#fStatus').onchange = (e) => { S.f.status = e.target.value; S.page = 1; renderAll(); };
  // 今日要点
  $('#homeBody').addEventListener('click', homeAct);
  $('#btnHomeAll').onclick = () => { S.f = { ...S.f, type: '', unread: false, status: '' }; $('#fType').value = ''; $('#fUnread').checked = false; $('#fStatus').value = ''; go('deals'); };
  $('#btnHomeRefresh').onclick = () => refreshNow();
  $('#btnHomeEnrich').onclick = async () => { const b = $('#btnHomeEnrich'); b.disabled = true; b.textContent = (L('翻译中') + "…"); try { const n = await call('ai:enrich'); toast(n ? `AI ${L('已翻译 {0} 条优惠', n)}` : L('没有需要翻译的优惠'), 'ok'); } catch (e) { toast(("AI " + L('翻译失败：')) + e.message, 'err'); } finally { b.disabled = false; b.innerHTML = ic('sparkle') + esc(L('翻译成中文')); } };
  // v2.3 通知设置
  $('#sMinConf').onchange = (e) => saveSetting({ notifyMinConf: Number(e.target.value) });
  $('#sQuiet').onchange = (e) => saveSetting({ quietHours: e.target.checked });
  $('#sQuietStart').onchange = (e) => saveSetting({ quietStart: e.target.value });
  $('#sQuietEnd').onchange = (e) => saveSetting({ quietEnd: e.target.value });
  $('#sDigest').onchange = (e) => saveSetting({ dailyDigest: e.target.checked });
  $('#sDigestTime').onchange = (e) => saveSetting({ digestTime: e.target.value });
  $('#sAiTranslate').onchange = (e) => saveSetting({ aiTranslate: e.target.checked });
  if ($('#sHideResellers')) $('#sHideResellers').onchange = (e) => saveSetting({ hideResellers: e.target.checked });
  if ($('#sAiClassify')) $('#sAiClassify').onchange = (e) => saveSetting({ aiClassify: e.target.checked });
  if ($('#sEnrichLimit')) $('#sEnrichLimit').onchange = (e) => saveSetting({ enrichLimit: Number(e.target.value) });
  $('#btnDigestNow').onclick = async () => { const dg = await call('digest:now'); toast(dg ? dg.title : L('已推送'), 'ok'); };
  $('#sNoise').addEventListener('click', async (e) => { const x = e.target.closest('[data-rmw]'); if (x) { await call('feedback:removeWord', x.dataset.rmw); toast(L('已移除屏蔽词')); } if (e.target.closest('[data-act=resetSrc]')) { await call('feedback:resetSources'); toast(L('已重置来源权重')); } });
  $('#fRegion').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.f.region = b.dataset.v; $$('#fRegion button').forEach((x) => x.classList.toggle('on', x === b)); S.page = 1; renderAll(); });
  $('#viewSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) saveSetting({ view: b.dataset.v }); });
  $('#btnRefresh').onclick = () => refreshNow();
  $('#btnExport').onclick = exportCSV;
  $('#btnReadAll').onclick = async () => {
    const ids = filteredDeals().filter((d) => !d.read).map((d) => d.id);
    if (!ids.length) return toast(L('没有未读的优惠'));
    ids.forEach((id) => patchDeal(id, { read: true })); await call('deal:read', ids, true); renderAll(); toast(`${L('已将 {0} 条标为已读', ids.length)}`, 'ok');
  };

  // 列表点击（事件委托）
  $('#dealList').addEventListener('click', (e) => {
    const actBtn = e.target.closest('[data-act]');
    const item = e.target.closest('[data-id]');
    if (actBtn) {
      const a = actBtn.dataset.act;
      if (a === 'more') { S.page++; renderDeals(); return; }
      if (a === 'refresh') return refreshNow();
      if (a === 'hideNet') { S.netBannerHidden = true; renderDeals(); return; }
      if (a === 'clearFilters') { S.curView = null; S.f = { q: '', brand: '', platform: '', region: '', type: '', news: S.f.news, unread: false, sort: S.f.sort }; $('#q').value = ''; $('#fUnread').checked = false; if ($('#fValid')) { $('#fValid').value = ''; $('#fExpired').checked = false; $('#fMine').checked = false; } if (S.state.settings.filterMine) call('settings:save', { filterMine: false }).then((x) => { S.state.settings = x; }); $('#fType').value = ''; $$('#fRegion button').forEach((x, i) => x.classList.toggle('on', i === 0)); renderAll(); return; }
      if (item && a === 'fav') { e.stopPropagation(); return toggleFav(item.dataset.id); }
      if (item && a === 'open') { e.stopPropagation(); return openDeal(item.dataset.id); }
      if (item && a === 'claim') { e.stopPropagation(); return setStatus(item.dataset.id, 'claimed'); }
      if (item && a === 'ignore') { e.stopPropagation(); return setStatus(item.dataset.id, 'ignored'); }
    }
    if (e.target.closest('[data-go]')) return go(e.target.closest('[data-go]').dataset.go);
    if (item) selectDeal(item.dataset.id);
  });
  $('#dealList').addEventListener('dblclick', (e) => { const item = e.target.closest('[data-id]'); if (item && !e.target.closest('[data-act]')) openDeal(item.dataset.id); });
  // 图片加载失败时显示占位
  document.addEventListener('error', (e) => {
    const img = e.target; if (img.tagName !== 'IMG' || img.classList.contains('logo')) return;
    if (img.classList.contains('blogo')) { const av = img.parentElement; av.classList.remove('haslogo'); av.style.background = av.dataset.bg; av.textContent = av.dataset.ini; return; }
    const th = img.closest('.thumb');
    if (th) { const card = img.closest('.card'); const d = card && S.state.deals.find((x) => x.id === card.dataset.id); const n = d ? (d.brandIds.map(bname)[0] || d.platform) : '?'; img.outerHTML = `<div class="ph" style="background:${brandColor(n)}">${esc(initials(n))}</div>`; }
    else { const box = img.closest('.dimg'); if (box) box.remove(); else img.remove(); }
  }, true);

  $('#detail').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = $('#detail').dataset.id; const d = S.state.deals.find((x) => x.id === id);
    const a = b.dataset.act;
    if (a === 'closeDetail') { S.sel = null; renderAll(); }
    if (a === 'openVendor') { e.preventDefault(); S.sel = null; openVendor(b.dataset.b); return; }
    if (a === 'openSrc') { e.preventDefault(); call('deal:open', b.dataset.u); return; }
    if (a === 'copyCode') { await call('clipboard:write', b.dataset.code); toast(L('优惠码已复制：') + b.dataset.code, 'ok'); return; }
    if (!d) return;
    if (a === 'open') openDeal(id);
    if (a === 'fav') toggleFav(id);
    if (a === 'copy') { await call('clipboard:write', d.link); toast(L('链接已复制'), 'ok'); }
    if (a === 'toggleRead') { patchDeal(id, { read: !d.read }); await call('deal:read', [id], d.read); renderAll(); }
    if (a === 'claim') setStatus(id, 'claimed');
    if (a === 'ignore') setStatus(id, 'ignored');
    if (a === 'notOffer') notOfferModal(id);
    if (a === 'remove') { S.sel = null; S.state.deals = S.state.deals.filter((x) => x.id !== id); renderAll(); await call('deal:remove', [id]); toast(L('已删除这条优惠')); }
  });

  // 品牌
  $('#btnAddBrand').onclick = () => brandModal();
  $('#brandFilter').addEventListener('input', debounce((e) => { S.brandFilter = e.target.value.trim(); renderBrands(); }, 120));
  const visBrands = () => S.state.brands.filter((x) => (x.category || 'ai') === 'ai' || S.state.settings.goodsEnabled);
  $('#btnBrandAllOn').onclick = async () => { for (const b of visBrands().filter((x) => !x.enabled)) await call('brand:toggle', b.id, true); toast(L('已启用全部厂商'), 'ok'); };
  $('#btnBrandAllOff').onclick = async () => { for (const b of visBrands().filter((x) => x.enabled)) await call('brand:toggle', b.id, false); toast(L('已停用全部厂商')); };
  $('#brandTabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (!t) return; S.brandTab = t.dataset.tab; renderBrands(); });
  $('#brandGrid').addEventListener('click', async (e) => {
    const ga = e.target.closest('[data-act=groupOn],[data-act=groupOff]');
    if (ga) { const on = ga.dataset.act === 'groupOn'; const n = await call('brand:group', ga.dataset.g, on); const g = (S.state.brandGroups || []).find((x) => x.id === ga.dataset.g); toast(on ? `${L('已启用「')}${g ? g.name : ''}${L('」全部 {0} 个厂商，正在扫描', n)}…` : `${L('已停用「')}${g ? g.name : ''}${L('」{0} 个厂商', n)}`, on ? 'ok' : ''); if (on && n) refreshNow(true); return; }
    const gt = e.target.closest('[data-act=goodsToggle]'); if (gt) { await setGoods(gt.checked); return; }
    const card = e.target.closest('.bcard'); const a = e.target.closest('[data-act]');
    if (card && !a && !e.target.closest('label,button,input')) { const bb = brandById(card.dataset.id); if (bb && (bb.category || 'ai') === 'ai') openVendor(bb.id); return; }
    if (!card || !a) return;
    const b = brandById(card.dataset.id); if (!b) return;
    if (a.dataset.act === 'notifyBrand') { const on = b.notify === false; await call('brand:notify', b.id, on); toast(on ? `${b.name}${L('：有新优惠时会弹出通知')}` : `${b.name}${L('：已静音，新优惠仍会显示在列表中')}`); }
    if (a.dataset.act === 'toggleBrand') { await call('brand:toggle', b.id, a.checked); toast(a.checked ? `${L('已启用 {0}，下次刷新生效', b.name)}` : `${L('已停用')} ${b.name}`); }
    if (a.dataset.act === 'editBrand') brandModal(b);
    if (a.dataset.act === 'vendorDetail') openVendor(b.id);
    if (a.dataset.act === 'viewBrand') { S.f.brand = b.id; go('deals'); }
    if (a.dataset.act === 'delBrand') { if (await confirmModal(L('删除厂商'), `${L('确定删除「{0}」及其 {1} 个渠道吗？已抓取的优惠会保留。', b.name, (b.channels || []).length)}`, L('删除'))) { await call('brand:remove', b.id); toast(`${L('已删除')} ${b.name}`); } }
  });

  // 厂商详情 / 渠道
  $('#btnVendorBack').onclick = () => go('brands');
  $('#btnAddChannel').onclick = () => { const b = brandById(S.vendor); if (b) channelModal(b); };
  $('#btnVendorEdit').onclick = () => { const b = brandById(S.vendor); if (b) brandModal(b); };
  $('#vdEnabled').onchange = async (e) => { await call('brand:toggle', S.vendor, e.target.checked); toast(e.target.checked ? (L('已启用，正在扫描该厂商') + "…") : L('已停用该厂商')); if (e.target.checked) refreshNow(true); };
  $('#btnVendorTestAll').onclick = async () => { const b = brandById(S.vendor); if (!b) return; const ids = (b.channels || []).filter((c) => c.enabled !== false).map((c) => `ch-${b.id}-${c.id}`); if (!ids.length) return toast(L('没有启用的渠道')); await Promise.all(ids.map((id) => testSource(id, true))); toast(`${L('已检测 {0} 个渠道', ids.length)}`, 'ok'); };
  $('#chTable').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]'); const row = e.target.closest('tr[data-ch]'); if (!a || !row) return;
    const b = brandById(S.vendor); const c = b && (b.channels || []).find((x) => x.id === row.dataset.ch); if (!c) return;
    const sid = `ch-${b.id}-${c.id}`;
    if (a.dataset.act === 'toggleCh') { await call('channel:toggle', b.id, c.id, a.checked); toast(a.checked ? `${L('已启用渠道「{0}」', c.name)}` : `${L('已停用渠道「{0}」', c.name)}`); }
    if (a.dataset.act === 'testCh') await testSource(sid);
    if (a.dataset.act === 'editCh') channelModal(b, c);
    if (a.dataset.act === 'snapCh') snapshotModal(b, c);
    if (a.dataset.act === 'logCh') runLogModal(sid);
    if (a.dataset.act === 'delCh') { if (await confirmModal(L('删除渠道'), `${L('确定删除「{0} · {1}」吗？', b.name, c.name)}`, L('删除'))) { await call('channel:remove', b.id, c.id); toast(L('已删除渠道')); } }
  });
  $('#vdLatest').addEventListener('click', (e) => { const it = e.target.closest('[data-id]'); if (!it) return; S.f.news = true; go('deals'); selectDeal(it.dataset.id); });
  $('#srcChNote').addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); } });
  $('#sGoods').onchange = (e) => setGoods(e.target.checked);

  // 数据源
  $('#btnAddSource').onclick = sourceModal;
  $('#srcRegion').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.srcRegion = b.dataset.v; $$('#srcRegion button').forEach((x) => x.classList.toggle('on', x === b)); renderSources(); });
  $('#btnTestAll').onclick = () => refreshNow();
  $('#srcTable').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'toggleGroup') { await call('source:toggleAll', a.dataset.ids.split(','), a.checked); return; }
    const row = e.target.closest('tr[data-id]'); if (!row) return; const id = row.dataset.id;
    const src = S.state.sources.find((s) => s.id === id);
    if (a.dataset.act === 'toggleSource') await call('source:toggle', id, a.checked);
    if (a.dataset.act === 'testSource') await testSource(id);
    if (a.dataset.act === 'delSource' && src) { if (await confirmModal(L('删除数据源'), `${L('确定删除「{0}」吗？', src.name)}`, L('删除'))) await call('source:remove', id); }
  });

  // 弹窗
  $('#modalMask').addEventListener('mousedown', (e) => { if (e.target.id === 'modalMask' && $('#modal [data-m=saveChannel]')) return; if (e.target.id === 'modalMask' && !$('#wbChips')) { if (S.confirmResolve) { S.confirmResolve(false); S.confirmResolve = null; } closeModal(); } });
  $('#modal').addEventListener('click', async (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) { $('#bmName').value = p.dataset.preset.replace(/ [\u3400-\u9fff].*$/, ''); $('#bmAliases').value = PRESET_IDEAS[p.dataset.preset] || p.dataset.preset; $$('#modal [data-preset]').forEach((x) => x.classList.toggle('on', x === p)); $('#bmName').focus(); return; }
    const dvc = e.target.closest('input[data-dv]');
    if (dvc && S.dv && S.dv.result) { S.dv.result.candidates[Number(dvc.dataset.dv)].checked = dvc.checked; dvc.closest('tr').classList.toggle('off', !dvc.checked); updateDvFoot(); return; }
    if (e.target.id === 'dvAll' && S.dv && S.dv.result) { S.dv.result.candidates.forEach((c) => { c.checked = e.target.checked && !!(c.test && c.test.ok); }); renderDvResult(); $('#dvAll').checked = e.target.checked; return; }
    const op = e.target.closest('[data-open]'); if (op) { e.preventDefault(); window.api.call('deal:open', op.dataset.open); return; }
    const alt = e.target.closest('[data-alt]'); if (alt && S.cs && S.cs.alts) { e.preventDefault(); fillChannelForm(S.cs.alts[Number(alt.dataset.alt)]); await previewChannel(); return; }
    const m = e.target.closest('[data-m]'); if (!m) return;
    const act = m.dataset.m;
    if (act === 'close') closeModal();
    if (act === 'ok' || act === 'cancel') { const r = S.confirmResolve; S.confirmResolve = null; closeModal(); r && r(act === 'ok'); }
    if (act === 'saveBrand') await submitBrand();
    if (act === 'saveSource') await submitSource();
    if (act === 'saveChannel') await submitChannel();
    if (act === 'previewChannel') await previewChannel();
    if (act === 'smartChannel') await smartChannel();
    if (act === 'dvGo') await startDiscover();
    if (act === 'dvCancel') { if (!cancelDiscover()) closeModal(); }
    if (act === 'dvCommit') await commitDiscover();
    if (act === 'saveRule') await submitRule();
    if (act === 'welcomeDone') await finishWelcome();
    if (act === 'notOfferGo') await submitNotOffer(e.target.closest('[data-m]').dataset.id);
  });
  $('#modal').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'dvName') { e.preventDefault(); e.stopPropagation(); startDiscover(); return; }
    if (e.key === 'Enter' && e.target.id === 'cmSmart') { e.preventDefault(); e.stopPropagation(); smartChannel(); return; }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const pri = $('#modal .mf .btn.primary'); pri && pri.click(); }
  });

  // 设置
  $('#sInterval').onchange = (e) => saveSetting({ intervalMinutes: Number(e.target.value) });
  $('#sAge').onchange = (e) => saveSetting({ maxAgeDays: Number(e.target.value) });
  $('#sNotify').onchange = (e) => saveSetting({ notify: e.target.checked });
  $('#sNotifyMax').onchange = (e) => saveSetting({ notifyMax: Number(e.target.value) });
  $('#sTray').onchange = (e) => saveSetting({ closeToTray: e.target.checked });
  $('#sStartMin').onchange = (e) => saveSetting({ startMinimized: e.target.checked });
  $('#sAutoStart').onchange = (e) => saveSetting({ autoStart: e.target.checked });
  $('#sPaused').onchange = async (e) => { S.state.runtime = await call('poll:pause', e.target.checked); renderAll(); };
  $('#sTheme').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) saveSetting({ theme: b.dataset.v }); });
  $('#sProxyMode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) saveSetting({ proxyMode: b.dataset.v }); });
  $('#sProxyUrl').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (v && !/^(https?|socks[45]?):\/\/[^\s]+:\d+$/i.test(v)) { toast(L('代理地址格式应为 http://主机:端口 或 socks5://主机:端口'), 'err'); return; }
    saveSetting({ proxyUrl: v }); toast(L('代理已更新'), 'ok');
  });
  $('#btnOpenDir').onclick = () => call('data:openDir');
  $('#btnTestNotify').onclick = async () => { try { await call('notify:test'); toast(L('已发送测试通知，请留意屏幕右下角'), 'ok'); } catch { /* 已提示 */ } };
  $('#btnNetCheck').onclick = netCheck;
  $('#proxyPresets').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-proxy]'); if (!b) return;
    await saveSetting({ proxyMode: 'custom', proxyUrl: b.dataset.proxy }); toast((L('已切换为自定义代理') + " ") + b.dataset.proxy + L('，正在重新扫描'), 'ok');
  });
  $('#btnClear').onclick = async () => { if (await confirmModal(L('清空优惠'), L('将删除所有已抓取的优惠（收藏的除外），确定继续？'), L('清空'))) { await call('deal:clear'); toast(L('已清空'), 'ok'); } };
  $('#btnReset').onclick = async () => { if (await confirmModal(L('恢复默认'), L('品牌、数据源和设置将恢复为默认值（已抓取的优惠保留），确定继续？'), L('恢复默认'))) { await call('settings:reset'); toast(L('已恢复默认配置'), 'ok'); } };

  // v2.0：源健康
  $('#hlFilter').addEventListener('input', debounce((e) => { S.hl.q = e.target.value.trim(); renderHealth(); }, 150));
  $('#hlProto').onchange = (e) => { S.hl.proto = e.target.value; renderHealth(); };
  $('#hlProtoBars').addEventListener('click', (e) => { const b = e.target.closest('[data-proto]'); if (!b) return; S.hl.proto = S.hl.proto === b.dataset.proto ? '' : b.dataset.proto; renderHealth(); });
  $('#hlState').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.hl.state = b.dataset.v; $$('#hlState button').forEach((x) => x.classList.toggle('on', x === b)); renderHealth(); });
  $('#btnHlRefresh').onclick = () => refreshNow();
  $('#btnHlRetest').onclick = async () => {
    const ids = allChannels().filter((x) => S.state.sourceStatus[x.id] && !S.state.sourceStatus[x.id].ok).map((x) => x.id);
    if (!ids.length) return toast(L('没有异常渠道'), 'ok');
    ids.forEach((id) => S.testing.add(id)); renderHealth(); toast(`${L('正在重测 {0} 个异常渠道', ids.length)}…`);
    try { const r = await call('source:testMany', ids); toast(`${L('重测完成：{0}/{1} 恢复正常', r.ok, r.total)}`, r.ok ? 'ok' : ''); } finally { ids.forEach((id) => S.testing.delete(id)); renderAll(); }
  };
  $('#hlTable').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]'); const row = e.target.closest('tr[data-id]'); if (!a || !row) return;
    if (a.dataset.act === 'hlLog') runLogModal(row.dataset.id);
    if (a.dataset.act === 'hlTest') await testSource(row.dataset.id);
  });
  // v2.0：规则
  $('#btnAddRule').onclick = () => ruleModal();
  $('#btnRuleTest').onclick = () => { const rules = (S.state.settings.rules || []).filter((r) => r.enabled); const hit = S.state.deals.filter((d) => rules.some((r) => matchRuleUI(r, d))); toast(`${L('试运行：现有 {0} 条中，{1} 条会命中启用的规则', S.state.deals.length, hit.length)}`, 'ok'); };
  $('#ruleList').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]'); const row = e.target.closest('.rule'); if (!a || !row) return;
    const i = Number(row.dataset.i); const rules = (S.state.settings.rules || []).slice();
    if (a.dataset.act === 'ruleToggle') { rules[i] = { ...rules[i], enabled: a.checked }; await call('rules:save', rules); }
    if (a.dataset.act === 'ruleEdit') ruleModal(i);
    if (a.dataset.act === 'ruleDel') { if (await confirmModal(L('删除规则'), `${L('确定删除规则「{0}」吗？', rules[i].name)}`, L('删除'))) { rules.splice(i, 1); await call('rules:save', rules); toast(L('已删除规则')); } }
  });
  // v2.0：采集引擎设置 / 导入导出
  $('#sConc').onchange = (e) => saveSetting({ concurrency: Number(e.target.value) });
  $('#sGap').onchange = (e) => saveSetting({ hostGap: Number(e.target.value) });
  $('#sBackoff').onchange = (e) => saveSetting({ backoff: e.target.checked });
  $('#sCache').onchange = (e) => saveSetting({ httpCache: e.target.checked });
  $('#sRender').onchange = (e) => saveSetting({ renderEnabled: e.target.checked });
  $('#sDedupe').onchange = (e) => saveSetting({ dedupe: e.target.checked });
  $('#sRsshub').addEventListener('change', (e) => { const v = e.target.value.trim(); if (v && !/^https?:\/\/\S+$/i.test(v)) { toast(("RSSHub " + L('地址应以 http(s):// 开头')), 'err'); return; } saveSetting({ rsshubBase: v.replace(/\/$/, '') }); toast(v ? ("RSSHub " + L('实例已保存')) : L('已清除 RSSHub 实例'), 'ok'); });
  $('#btnOpmlExport').onclick = async () => { const r = await call('opml:export'); if (r) toast(`${L('已导出 {0} 个订阅到', r.count)} ${r.path}`, 'ok'); };
  $('#btnOpmlImport').onclick = async () => { const r = await call('opml:import', '__sources'); if (r) toast(`OPML ${L('导入：新增 {0} 个，跳过 {1} 个', r.added, r.dup)}`, 'ok'); };
  $('#btnVendorOpml').onclick = async () => { const r = await call('opml:import', S.vendor); if (r) toast(`${L('已导入 {0} 个渠道到 {1}（跳过 {2}）', r.added, bname(S.vendor), r.dup)}`, 'ok'); };
  $('#btnCfgExport').onclick = async () => { const r = await call('config:export'); if (r) toast((L('配置已导出到') + " ") + r.path, 'ok'); };
  $('#btnCfgImport').onclick = async () => { if (!(await confirmModal(L('导入配置'), L('导入会替换当前的厂商、渠道、聚合源、规则和设置（已抓取的优惠保留），确定继续？'), L('选择文件并导入'), false))) return; const r = await call('config:import'); if (r) toast(`${L('已导入：{0} 个厂商、{1} 个聚合源', r.brands, r.sources)}`, 'ok'); };
  $('#btnBackupExport').onclick = async () => { const r = await call('backup:export'); if (r) toast(L('备份已导出到') + ' ' + r.path + '（' + L('{0} 条优惠', r.deals) + '）', 'ok'); };
  $('#btnBackupImport').onclick = async () => { if (!(await confirmModal(L('导入完整备份'), L('将合并备份中的优惠与配置。推送密钥不会被覆盖（备份里本来也没有）。确定继续？'), L('选择文件并导入'), false))) return; const r = await call('backup:import'); if (r) toast(L('已导入备份：{0} 个厂商，{1} 条优惠（推送密钥未包含，需在本机重填）', r.brands, r.deals), 'ok'); };
  $('#btnKeys').onclick = keysModal;
  $('#modal').addEventListener('click', async (e) => { const m = e.target.closest('[data-m=clearLog]'); if (m) { await call('health:reset', m.dataset.id); closeModal(); toast(L('已清除运行记录')); } });

  // 快捷键
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '') || $('#modalMask').classList.contains('show');
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const inList = ['deals', 'favs', 'goods'].includes(S.view);
      const k = e.key;
      if (k === '?') { e.preventDefault(); keysModal(); return; }
      const NAV = { 1: 'deals', 2: 'favs', 3: 'brands', 4: 'health', 5: 'rules', 6: 'sources', 7: 'settings' };
      if (NAV[k]) { e.preventDefault(); go(NAV[k]); return; }
      if (inList && (k === 'j' || k === 'ArrowDown')) { e.preventDefault(); moveSel(1); return; }
      if (inList && (k === 'k' || k === 'ArrowUp')) { e.preventDefault(); moveSel(-1); return; }
      if (inList && S.sel && (k === 'o' || k === 'Enter')) { e.preventDefault(); openDeal(S.sel); return; }
      if (inList && S.sel && k === 's') { e.preventDefault(); toggleFav(S.sel); return; }
      if (inList && S.sel && k === 'm') { e.preventDefault(); const d = S.state.deals.find((x) => x.id === S.sel); if (d) { patchDeal(d.id, { read: !d.read }); call('deal:read', [d.id], d.read); renderAll(); } return; }
      if (inList && k === 'A' && e.shiftKey) { e.preventDefault(); $('#btnReadAll').click(); return; }
      if (inList && k === 'v') { e.preventDefault(); const order = ['cards', 'timeline', 'table']; const cur = order.indexOf(S.state.settings.view); saveSetting({ view: order[(cur + 1) % 3] }); return; }
      if (inList && k === 'n') { e.preventDefault(); S.f.news = !S.f.news; renderAll(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); refreshNow(); }
    if (e.key === 'F5') { e.preventDefault(); refreshNow(); }
    if (e.key === 'Escape') {
      if ($('#wbChips')) { /* 引导页需点「开始监控」 */ } else if ($('#modalMask').classList.contains('show')) { if (S.confirmResolve) { S.confirmResolve(false); S.confirmResolve = null; } closeModal(); }
      else if (S.sel) { S.sel = null; renderAll(); }
      else if (document.activeElement === $('#q') && $('#q').value) { $('#q').value = ''; S.f.q = ''; renderAll(); }
    }
  });
}

async function submitBrand() {
  const id = $('#modal').dataset.id || undefined;
  const name = $('#bmName').value.trim();
  const split = (v) => v.split(/[,，;；\n]/).map((s) => s.trim()).filter(Boolean);
  if (!name) { $('#bmErr').textContent = L('请填写名称'); return; }
  const aliases = split($('#bmAliases').value);
  if (!aliases.some((a) => a.toLowerCase() === name.toLowerCase())) aliases.unshift(name);
  try {
    const category = $('#bmCat .on') ? $('#bmCat .on').dataset.v : 'ai';
    if (category === 'goods' && !S.state.settings.goodsEnabled) await call('goods:set', true);
    await window.api.call('brand:save', { id, name, aliases, exclude: split($('#bmExclude').value), enabled: id ? undefined : true, notify: $('#bmNotify').checked, category });
    closeModal(); toast(id ? L('已保存，下次刷新按新关键词匹配') : `${L('已添加「{0}」，正在扫描', name)}…`, 'ok');
    if (!id) refreshNow(true);
  } catch (e) { $('#bmErr').textContent = e.message; }
}
async function submitSource() {
  const url = $('#smUrl').value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) { $('#smErr').textContent = L('请输入有效的 http(s) 地址'); return; }
  const btn = $('#modal [data-m=saveSource]'); btn.disabled = true; btn.textContent = (L('添加中') + "…");
  try {
    const kind = $('#smKind .on').dataset.v;
    const src = await window.api.call('source:add', { url, name: $('#smName').value, platform: $('#smPlatform').value.trim() || L('自定义'), region: $('#smRegion .on').dataset.v, kind, category: kind === 'deal' ? 'goods' : 'ai' });
    closeModal(); toast(`${L('已添加「{0}」，正在检测', src.name)}…`);
    await testSource(src.id);
  } catch (e) { $('#smErr').textContent = e.message; btn.disabled = false; btn.textContent = L('添加并检测'); }
}
async function submitChannel() {
  const m = $('#modal'); const brandId = m.dataset.brand;
  let c; try { c = readChannelForm(); } catch (e) { $('#cmErr').textContent = e.message; return; }
  try {
    const ch = await window.api.call('channel:save', brandId, c);
    closeModal(); toast(`${L('已')}${c.id ? L('保存') : L('添加')}${L('渠道「{0}」，正在检测', ch.name)}…`);
    await testSource(`ch-${brandId}-${ch.id}`);
  } catch (e) { $('#cmErr').textContent = e.message; }
}
async function setGoods(on) {
  S.state.settings = await call('goods:set', on);
  toast(on ? L('已开启实物商品优惠监控，侧边栏新增「实物优惠」') : L('已关闭实物商品优惠监控'), 'ok');
  renderAll();
}
async function testSource(id, quiet) {
  S.testing.add(id); if (S.view === 'vendor') renderVendor(); else renderSources();
  try {
    const r = await call('source:test', id);
    const st = r.status;
    if (quiet) return r;
    if (st.ok) toast(st.note ? `${L('检测成功：')}${st.note}` : `${L('检测成功：抓取 {0} 条，命中 {1} 条', st.total, st.matched)}`, 'ok');
    else toast(L('检测失败：') + st.error, 'err');
    return r;
  } catch (e) { /* toast 已显示 */ } finally { S.testing.delete(id); renderAll(); }
}

// —— 测试钩子（自动截图/自测用） ——
window.__test = {
  dv: () => S.dv, discoverModal, aiReady,
  go, setView: (v) => saveSetting({ view: v }), setTheme: (t) => saveSetting({ theme: t }),
  filterBrand: (b) => { S.f.brand = b; renderAll(); },
  setNews: (v) => { S.f.news = !!v; renderAll(); }, filterType: (t) => { S.f.type = t; renderAll(); }, openVendor, channelModal: (id) => channelModal(brandById(id)),
  snapshot: (bid, cid) => { const b = brandById(bid); const c = b && b.channels.find((x) => x.id === cid); if (c) snapshotModal(b, c); },
  offerSample: () => { const o = S.state.deals.filter((d) => dealCat(d) === 'ai'); const by = {}; for (const d of o) for (const t of d.offerTypes || []) by[t] = (by[t] || 0) + 1; return { ai: o.length, offers: o.filter(isOfferDeal).length, news: o.filter((d) => !isOfferDeal(d)).length, byType: by, chSources: (S.state.channelSources || []).filter((x) => x.enabled).length, chOk: (S.state.channelSources || []).filter((x) => x.enabled && S.state.sourceStatus[x.id] && S.state.sourceStatus[x.id].ok).length, sample: o.filter(isOfferDeal).slice(0, 25).map((d) => `[${(d.offerTypes || []).map((t) => OFFER[t] ? OFFER[t][0] : t).join('/')}] ${d.brandIds.map(bname).join(',')} | ${d.title.slice(0, 90)} | ${d.sourceName}`) }; },
  state: () => S.state, select: (id) => selectDeal(id), notOfferModal: (id) => notOfferModal(id),
  selectFirst: () => { const d = filteredDeals().find((x) => x.image) || filteredDeals()[0]; if (d) selectDeal(d.id); },
  closeDetail: () => { S.sel = null; renderAll(); },
  openBrandModal: () => brandModal(), openSourceModal: () => sourceModal(), closeModal, welcomeModal,
  showNetBanner: () => { S.netBannerHidden = false; renderAll(); },
  exportCSV,
  summary: () => ({ deals: S.state.deals.length, offers: S.state.deals.filter(isOfferDeal).length, brands: S.state.brands.filter((b) => b.enabled).length, channels: (S.state.channelSources || []).filter((x) => x.enabled).length, sourcesOk: Object.values(S.state.sourceStatus).filter((s) => s.ok).length, sourcesTotal: Object.keys(S.state.sourceStatus).length, withImage: S.state.deals.filter((d) => d.image).length, errors: window.__errors || [] }),
};
// 端到端交互自测：通过真实 DOM 操作驱动界面
window.__test.e2e = async () => {
  const out = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = (name, ok, info) => out.push({ name, ok: !!ok, info });
  try {
    go('deals'); await wait(200);
    check('deal list renders cards', $$('#dealList .card').length > 0, $$('#dealList .card').length + ' cards');
    // 搜索
    // v1.2：默认只显示优惠；勾选「含厂商资讯」显示全部；按优惠类型筛选
    const nOffers = filteredDeals().length;
    check('default list shows only AI offers', nOffers > 0 && filteredDeals().every((d) => dealCat(d) === 'ai' && isOfferDeal(d)), nOffers + ' offers');
    check('offer-type tags on cards', $$('#dealList .card .tag.ot').length > 0);
    $('#fNews').click(); await wait(150);
    const nAll = filteredDeals().length; check('vendor-news toggle shows more items', nAll > nOffers, `${nOffers} -> ${nAll}`);
    $('#fNews').click(); await wait(150);
    const ft = $('#fType'); ft.value = 'free'; ft.dispatchEvent(new Event('change')); await wait(150);
    check(("offer type filter (" + L('免费试用') + ")"), filteredDeals().length > 0 && filteredDeals().every((d) => d.offerTypes.includes('free')), filteredDeals().length + ' free offers');
    ft.value = ''; ft.dispatchEvent(new Event('change')); await wait(150);
    const q = $('#q'); q.value = 'claude'; q.dispatchEvent(new Event('input')); await wait(400);
    const n1 = filteredDeals().length; check('search filter narrows list', n1 > 0 && n1 < nOffers, n1 + ' results');
    q.value = 'zzzz-no-match-xyz'; q.dispatchEvent(new Event('input')); await wait(400);
    check('no-match search shows empty state', !!$('#dealList .empty'));
    q.value = ''; q.dispatchEvent(new Event('input')); await wait(400);
    // 区域筛选
    $('#fRegion button[data-v=cn]').click(); await wait(100);
    check('region filter cn', filteredDeals().length > 0 && filteredDeals().every((d) => d.region === 'cn'), filteredDeals().length + ' cn deals');
    $('#fRegion button[data-v=""]').click(); await wait(100);
    // 收藏
    const firstCard = $('#dealList .card'); const id = firstCard.dataset.id;
    firstCard.querySelector('[data-act=fav]').click(); await wait(300);
    check('favourite toggles', S.state.deals.find((d) => d.id === id).fav);
    go('favs'); await wait(150); check('favourites view lists it', $$('#dealList .card').length === 1);
    go('deals');
    // 选择 -> 已读 + 详情
    const second = $$('#dealList .card')[1]; second.click(); await wait(250);
    check('select opens detail & marks read', $('#detail').classList.contains('open') && S.state.deals.find((d) => d.id === second.dataset.id).read);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(100);
    check('Esc closes detail', !$('#detail').classList.contains('open'));
    // 表格视图
    $('#viewSeg button[data-v=table]').click(); await wait(400);
    check('table view', $$('#dealList table tbody tr').length > 0);
    $('#viewSeg button[data-v=cards]').click(); await wait(400);
    // 添加品牌（通过弹窗）
    go('brands'); $('#btnAddBrand').click(); await wait(150);
    $('#modal [data-preset="Grammarly"]').click(); $('#bmAliases').value = 'Grammarly, Grammarly Pro'; $('#modal [data-m=saveBrand]').click(); await wait(600);
    check('add vendor via modal', S.state.brands.some((b) => b.name === 'Grammarly' && b.enabled && b.category === 'ai'));
    // 重复品牌校验
    $('#btnAddBrand').click(); await wait(100); $('#bmName').value = 'grammarly'; $('#modal [data-m=saveBrand]').click(); await wait(300);
    check('duplicate brand rejected with message', /已存在/.test($('#bmErr').textContent), $('#bmErr').textContent);
    closeModal();
    // 编辑品牌
    const puma = S.state.brands.find((b) => b.name === 'Grammarly');
    $(`.bcard[data-id="${puma.id}"] [data-act=editBrand]`).click(); await wait(100);
    $('#bmExclude').value = 'grammarly keyboard'; $('#modal [data-m=saveBrand]').click(); await wait(400);
    check('edit brand exclude words', (S.state.brands.find((b) => b.id === puma.id).exclude || []).includes('grammarly keyboard'));
    // 停用/启用品牌
    $(`.bcard[data-id="${puma.id}"] [data-act=toggleBrand]`).click(); await wait(300);
    check('toggle brand off', !S.state.brands.find((b) => b.id === puma.id).enabled);
    $(`.bcard[data-id="${puma.id}"] [data-act=toggleBrand]`).click(); await wait(300);
    // 数据源：自定义 RSS
    go('sources'); $('#btnAddSource').click(); await wait(100);
    $('#smUrl').value = 'not a url'; $('#modal [data-m=saveSource]').click(); await wait(100);
    check('invalid RSS url rejected', /有效/.test($('#smErr').textContent));
    $('#smUrl').value = 'https://9to5mac.com/feed/'; $('#smName').value = '9to5Mac'; $('#modal [data-m=saveSource]').click();
    for (let i = 0; i < 60 && !(S.state.sources.find((x) => x.name === '9to5Mac') && !S.testing.size); i++) await wait(250);
    const cs = S.state.sources.find((x) => x.name === '9to5Mac');
    check('add custom RSS & auto test', cs && S.state.sourceStatus[cs.id] && S.state.sourceStatus[cs.id].ok, cs && JSON.stringify(S.state.sourceStatus[cs.id] || {}).slice(0, 120));
    // 停用某个数据源
    $('tr[data-id="slickdeals-ai"] [data-act=toggleSource]').click(); await wait(300);
    check('toggle source off', !S.state.sources.find((x) => x.id === 'slickdeals-ai').enabled);
    $('tr[data-id="slickdeals-ai"] [data-act=toggleSource]').click(); await wait(300);
    // v1.2：厂商渠道
    go('brands'); await wait(100);
    $('.bcard[data-id="cursor"] [data-act=vendorDetail]').click(); await wait(200);
    check('vendor detail lists channels', S.view === 'vendor' && $$('#chTable tbody tr[data-ch]').length >= 4, $$('#chTable tbody tr[data-ch]').length + ' channels');
    check('page-monitor channel has baseline status', /基线|无变化|变化/.test($('#chTable tr[data-ch="pricing"]').textContent), $('#chTable tr[data-ch="pricing"] .err-text') && $('#chTable tr[data-ch="pricing"] .err-text').textContent);
    $('#btnAddChannel').click(); await wait(100);
    $('#cmProto').value = 'page'; $('#cmProto').dispatchEvent(new Event('change')); $('#cf_url').value = 'https://api-docs.deepseek.com/quick_start/pricing'; $('#cmName').value = L('测试价格页'); $('#cf_keyword').value = '$'; $('#modal [data-m=saveChannel]').click();
    let nc; for (let i = 0; i < 80; i++) { await wait(250); nc = (brandById('cursor').channels || []).find((x) => x.name === '测试价格页'); if (nc && S.state.sourceStatus['ch-cursor-' + nc.id] && !S.testing.size) break; }
    const ncs = nc && S.state.sourceStatus['ch-cursor-' + nc.id];
    check('add page-monitor channel & baseline', ncs && ncs.ok && /基线/.test(ncs.note || ''), ncs && (ncs.note || ncs.error));
    $(`#chTable tr[data-ch="${nc.id}"] [data-act=snapCh]`).click(); await wait(150);
    check('page snapshot modal', /\$/.test(($('#modal pre.snap') || {}).textContent || ''));
    closeModal();
    $(`#chTable tr[data-ch="${nc.id}"] [data-act=delCh]`).click(); await wait(150); $('#modal [data-m=ok]').click(); await wait(300);
    check('delete channel', !(brandById('cursor').channels || []).some((x) => x.id === nc.id));
    // v1.2：实物商品（可选，默认关闭）
    check('goods off by default', !S.state.settings.goodsEnabled && $('#navGoods').style.display === 'none');
    go('settings'); $('#sGoods').click(); await wait(400);
    check(("enable goods shows " + L('实物优惠') + " nav & sources"), S.state.settings.goodsEnabled && $('#navGoods').style.display === '' && S.state.sources.filter((x) => x.category === 'goods').every((x) => x.enabled));
    $('#sGoods').click(); await wait(400);
    check('disable goods', !S.state.settings.goodsEnabled && S.state.sources.filter((x) => x.category === 'goods').every((x) => !x.enabled));
    go('sources'); await wait(100);
    // 删除自定义源（确认框）
    $(`tr[data-id="${cs.id}"] [data-act=delSource]`).click(); await wait(150); $('#modal [data-m=ok]').click(); await wait(400);
    check('delete custom source via confirm', !S.state.sources.find((x) => x.id === cs.id));
    // 设置
    go('settings'); $('#sInterval').value = '30'; $('#sInterval').dispatchEvent(new Event('change')); await wait(300);
    check('change interval', S.state.settings.intervalMinutes === 30 && S.state.runtime.nextRunAt - Date.now() > 29 * 60000);
    $('#sTheme button[data-v=light]').click(); await wait(300);
    check('theme light', document.documentElement.dataset.theme === 'light');
    $('#sTheme button[data-v=dark]').click(); await wait(300);
    $('#sProxyUrl').disabled = false; $('#sProxyUrl').value = 'bad proxy'; $('#sProxyUrl').dispatchEvent(new Event('change')); await wait(100);
    check('invalid proxy rejected', S.state.settings.proxyUrl === '');
    // 全部已读
    for (let i = 0; i < 120 && S.state.runtime.polling; i++) await wait(250); // 等待添加品牌触发的刷新结束
    go('deals'); $('#btnReadAll').click(); await wait(800);
    check('mark all read (current list)', filteredDeals().every((d) => d.read), filteredDeals().filter((d) => !d.read).length + ' unread left');
    // 加载更多
    if (filteredDeals().length > S.PAGE) { const before = $$('#dealList .card').length; $('#dealList [data-act=more]').click(); await wait(200); check('load more', $$('#dealList .card').length > before); }
    // 导出
    const r = await exportCSV(); check('export CSV', r && r.count > 0, r && r.path);
    // v1.1：品牌通知静音开关
    go('brands'); await wait(100);
    const pm = S.state.brands.find((b) => b.name === 'Grammarly');
    $(`.bcard[data-id="${pm.id}"] [data-act=notifyBrand]`).click(); await wait(300);
    check('per-brand notify toggle (mute)', S.state.brands.find((b) => b.id === pm.id).notify === false);
    // v1.1：详情删除
    go('deals'); await wait(100);
    const victim = $$('#dealList .card').find((c) => !S.state.deals.find((d) => d.id === c.dataset.id).fav); const vid = victim.dataset.id; victim.click(); await wait(200);
    $('#detail [data-act=remove]').click(); await wait(500);
    check('remove deal from detail panel', !S.state.deals.some((d) => d.id === vid) && !$('#detail').classList.contains('open'));
    // v1.1：境外源网络失败提示条
    const realStatus = S.state.sourceStatus;
    S.state.sourceStatus = { ...realStatus };
    const intlIds = S.state.sources.filter((x) => x.enabled && x.region === 'intl').slice(0, 4).map((x) => x.id);
    for (const id of intlIds) S.state.sourceStatus[id] = { ok: false, failStreak: 2, error: L('连接超时（可能需要代理）'), total: 0, matched: 0, ms: 0, lastRun: Date.now() };
    S.state.sourceStatus[intlIds[3]] = { ...S.state.sourceStatus[intlIds[3]], failStreak: 1 };
    const wasPolling = S.state.runtime.polling; S.state.runtime.polling = false; S.netBannerHidden = false; renderDeals(); await wait(50);
    check('banner ignores one-off failures (3 sources ≥2 streak still shows)', /3 个境外/.test(($('#dealList .notice b') || {}).textContent || ''));
    check('proxy guidance banner when overseas sources fail', !!$('#dealList .notice.warn'), $('#dealList .notice b') && $('#dealList .notice b').textContent);
    $('#dealList [data-act=hideNet]').click(); await wait(50);
    check('banner can be dismissed', !$('#dealList .notice.warn'));
    S.state.sourceStatus = realStatus; S.state.runtime.polling = wasPolling; renderAll();
    // v1.1：首次启动引导
    welcomeModal(); await wait(150);
    const chip = $('#wbChips .chip.on'); chip.click(); chip.click();
    check('welcome shows AI vendor chips', $$('#wbChips .chip').length >= 30 && /已选/.test($('#wbCount').textContent));
    // v2.2：欢迎页按分组显示，AI 分组默认全选
    const aiG = (S.state.brandGroups || []).filter((g) => g.ai).map((g) => g.id);
    check('v2.2 welcome groups & AI groups pre-checked', $$('#wbChips .wgroup').length >= 4 && S.state.brands.filter((b) => aiG.includes(b.group)).every((b) => S.welcome.chosen.has(b.id)) && !S.welcome.chosen.has('aws'), `${S.welcome.chosen.size} chosen`);
    const wg = $('#wbChips [data-wg=cloud]'); wg.click(); await wait(50);
    check('v2.2 welcome group select-all', ['aws', 'gcp', 'azure', 'cloudflare'].every((id) => S.welcome.chosen.has(id)));
    $('#wbChips [data-wg=cloud]').click(); await wait(50);
    $('#modal [data-m=welcomeDone]').click(); await wait(500);
    check('welcome completes & closes', S.state.settings.onboarded === true && !$('#modalMask').classList.contains('show'));
    check('v2.2 all AI-group vendors enabled after welcome', S.state.brands.filter((b) => aiG.includes(b.group)).every((b) => b.enabled) && ['devin', 'manus', 'coze', 'dify', 'langchain', 'n8n', 'genspark'].every((id) => brandById(id)), S.state.brands.filter((b) => b.enabled).length + ' on');
    // v2.2：厂商页分类标签 + 本类全部启用
    go('brands'); await wait(150);
    check('v2.2 brand category tabs', $$('#brandTabs .btab').length >= 6 && !!$('#brandTabs [data-tab=agent]'));
    $('#brandTabs [data-tab=agent]').click(); await wait(100);
    const agentCards = $$('#brandGrid .bcard').map((c) => c.dataset.id);
    check('v2.2 agent tab filters', agentCards.includes('manus') && agentCards.includes('cursor') && !agentCards.includes('openai'), agentCards.join(','));
    $('#brandTabs [data-tab=cloud]').click(); await wait(100);
    $('#brandGrid [data-act=groupOn][data-g=cloud]').click(); await wait(600);
    check('v2.2 enable all in category', ['aws', 'gcp', 'azure', 'cloudflare'].every((id) => brandById(id).enabled));
    $('#brandGrid [data-act=groupOff][data-g=cloud]').click(); await wait(600);
    check('v2.2 disable category', ['aws', 'gcp', 'azure', 'cloudflare'].every((id) => !brandById(id).enabled && brandById(id).userOff));
    $('#brandTabs [data-tab=all]').click(); await wait(100);
    // 「启用本类全部」会触发一次扫描：等它结束，避免后续「全部已读」等检查与新到数据竞争
    await wait(1000); for (let t = Date.now(); S.state.runtime.polling && Date.now() - t < 240000;) await wait(500);
    // v1.1：测试通知按钮
    go('settings'); await wait(100);
    $('#btnTestNotify').click(); await wait(400);
    const lastToast = ($$('#toasts .toast').pop() || {}).textContent || '';
    check('test notification button responds', /测试通知|不支持/.test(lastToast), lastToast);
    check('countdown text is human readable', /秒后|分|小时|正在刷新/.test($('#stNext').textContent), $('#stNext').textContent);
    // v2.0：协议适配器 / 测试预览
    go('brands'); await wait(100); $('.bcard[data-id="cursor"] [data-act=vendorDetail]').click(); await wait(200);
    $('#btnAddChannel').click(); await wait(150);
    check('channel modal lists ≥18 protocols', $$('#cmProto option').length >= 18, $$('#cmProto option').length + ' protocols');
    $('#cmProto').value = 'hn'; $('#cmProto').dispatchEvent(new Event('change')); await wait(50);
    check('protocol switch shows matching fields', $('.cmf[data-f=query]').style.display === '' && $('.cmf[data-f=url]').style.display === 'none');
    $('#cf_query').value = 'Cursor'; $('#modal [data-m=previewChannel]').click();
    for (let i = 0; i < 80 && !/条|失败|错误/.test($('#cmPreview').textContent); i++) await wait(250);
    check('channel preview (HN Algolia) without saving', $$('#cmPreview .pv-item').length > 0, $('#cmPreview').textContent.slice(0, 80));
    closeModal(); await wait(100);
    // v2.0：源健康
    go('health'); await wait(300);
    check('health dashboard KPIs & table', $$('#hlKpis .kpi').length >= 4 && $$('#hlTable tbody tr').length > 20, $$('#hlTable tbody tr').length + ' rows');
    check('health protocol bars', $$('#hlProtoBars .pbar').length >= 5, $$('#hlProtoBars .pbar').length + ' protocols');
    const p0 = $('#hlProtoBars .pbar'); p0.click(); await wait(150);
    check('health filter by protocol', $$('#hlTable tbody tr').length > 0 && S.hl.proto === p0.dataset.proto);
    p0.click(); await wait(100);
    $('#hlTable tbody tr[data-id] [data-act=hlLog]').click(); await wait(150);
    check('per-channel run log modal', $('#modalMask').classList.contains('show') && /运行记录|日志/.test($('#modal').textContent));
    closeModal();
    // v2.0：规则
    go('rules'); await wait(150);
    const nr = (S.state.settings.rules || []).length;
    check('default rules listed', $$('#ruleList .rule').length === nr && nr >= 3, nr + ' rules');
    $('#btnAddRule').click(); await wait(150);
    $('#rmName').value = ("E2E " + L('学生优惠')); $('#rmKw').value = ("student, " + L('学生')); $('#modal [data-m=saveRule]').click(); await wait(500);
    check('add rule', (S.state.settings.rules || []).some((r) => r.name === 'E2E 学生优惠'));
    const ri = S.state.settings.rules.findIndex((r) => r.name === 'E2E 学生优惠');
    $(`#ruleList .rule[data-i="${ri}"] [data-act=ruleToggle]`).click(); await wait(400);
    check('toggle rule', S.state.settings.rules[ri].enabled === false);
    $(`#ruleList .rule[data-i="${ri}"] [data-act=ruleDel]`).click(); await wait(150); $('#modal [data-m=ok]').click(); await wait(400);
    check('delete rule', !S.state.settings.rules.some((r) => r.name === 'E2E 学生优惠'));
    // v2.0：时间线 / 重要度 / 快捷键
    go('deals'); await wait(100);
    $('#viewSeg button[data-v=timeline]').click(); await wait(400);
    check('timeline view groups by day', $$('#dealList .tl-day').length > 0 && $$('#dealList .tl-item').length > 0);
    $('#viewSeg button[data-v=cards]').click(); await wait(300);
    const so = $('#fSort'); if (so) { so.value = 'score'; so.dispatchEvent(new Event('change')); await wait(200); const sc = filteredDeals().map((d) => liveScore(d)); check('sort by importance score', sc.every((v, i) => !i || sc[i - 1] >= v)); so.value = 'pub'; so.dispatchEvent(new Event('change')); await wait(100); }
    S.sel = null; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); await wait(250);
    check('keyboard J selects next item', !!S.sel);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(100);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4' })); await wait(200);
    check(("keyboard 4 → " + L('源健康')), S.view === 'health');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })); await wait(150);
    check('? shows shortcut help', /快捷键/.test($('#modal').textContent)); closeModal();
    // v2.0：OPML / 配置导出、引擎设置
    go('settings'); await wait(100);
    const op = await call('opml:export'); check('OPML export', op && op.count > 50, op && op.count + ' feeds');
    const ce = await call('config:export'); check('config export', ce && ce.path, ce && ce.path);
    $('#sConc').value = '4'; $('#sConc').dispatchEvent(new Event('change')); await wait(300);
    check('engine concurrency setting', S.state.settings.concurrency === 4);
    $('#sRsshub').value = 'ftp://bad'; $('#sRsshub').dispatchEvent(new Event('change')); await wait(200);
    check('invalid RSSHub base rejected', !S.state.settings.rsshubBase);
    check('cross-source merge badge present or dedupe on', S.state.settings.dedupe !== false);
    // v2.1：AI 助手 + AI 辅助添加（本地模拟 OpenAI 兼容接口）
    if (window.__mock) {
      const waitFor = async (fn, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (fn()) return true; } catch { /* 继续等 */ } await wait(400); } return false; };
      go('settings'); await wait(150);
      check('AI settings card lists providers', $$('#aiProvider option').length >= 7 && !aiReady(), $$('#aiProvider option').length + ' providers');
      $('#aiProvider').value = 'deepseek'; $('#aiProvider').dispatchEvent(new Event('change'));
      check('provider preset fills base URL & model', $('#aiBase').value === 'https://api.deepseek.com/v1' && $('#aiModel').value === 'deepseek-chat');
      $('#aiProvider').value = 'custom'; $('#aiProvider').dispatchEvent(new Event('change'));
      $('#aiBase').value = window.__mock.baseUrl; $('#aiModel').value = 'mock-gpt'; $('#aiKey').value = 'sk-wrong-key-123456789';
      $('#btnAiTest').click(); await waitFor(() => /✓|✗/.test($('#aiTestRes').textContent), 15000);
      const wrong = $('#aiTestRes').textContent;
      check('test connection with wrong key fails clearly (no key echoed)', /401|Key/.test(wrong) && !wrong.includes('sk-wrong-key-123456789'), wrong);
      $('#aiKey').value = window.__mock.key; $('#btnAiSave').click(); await wait(500);
      check('save AI config (key encrypted, never sent to UI)', S.state.settings.ai.hasKey && aiReady() && !JSON.stringify(S.state).includes(window.__mock.key) && $('#aiKey').value === '', JSON.stringify(S.state.settings.ai));
      $('#btnAiTest').click(); await waitFor(() => /✓|✗/.test($('#aiTestRes').textContent), 15000);
      check('test connection OK with saved key', /✓ 连接成功/.test($('#aiTestRes').textContent), $('#aiTestRes').textContent);
      // AI 辅助添加厂商：取消
      go('brands'); $('#btnAiBrand').click(); await wait(150);
      $('#dvName').value = 'Perplexity'; $('#dvGo').click(); await wait(1200);
      $('#dvCancel').click(); await waitFor(() => !S.dv.running, 30000);
      check('cancel discovery', !S.dv.running && /已停止|已取消/.test($('#dvResult').textContent), $('#dvResult').textContent.slice(0, 60));
      // 端到端：Hugging Face
      $('#dvName').value = 'Hugging Face'; $('#dvGo').click();
      await waitFor(() => S.dv && S.dv.result, 150000);
      const r = S.dv && S.dv.result;
      check('discover vendor end-to-end (progress steps)', r && $$('#dvSteps li.ok').length >= 4, $$('#dvSteps li').map((li) => li.className + ':' + li.textContent.slice(0, 30)).join(' | '));
      check('found official domain & tested candidates', r && r.vendor.domains.includes('huggingface.co') && r.candidates.filter((c) => c.test && c.test.ok).length >= 5, r && `${r.vendor.domains} ${r.candidates.length} cand`);
      check('AI used: aliases / names applied, off-domain AI suggestion rejected', r && r.usedAI && !r.candidates.some((c) => /evil\.example/.test(c.url || '')), r && r.vendor.aliases.join(','));
      check('review table with checkboxes & samples', $$('#dvResult tr[data-i]').length === (r ? r.candidates.length : -1) && $$('#dvResult .dv-sample div').length > 3);
      const firstOn = $('#dvResult input[data-dv]:checked'); firstOn.click(); await wait(100);
      const nSel = r.candidates.filter((c) => c.checked).length;
      check('uncheck updates commit button', new RegExp((L('和') + " ") + nSel + (" " + L('个渠道'))).test($('#dvCommit').textContent), $('#dvCommit').textContent);
      $('#dvCommit').click(); await waitFor(() => { const x = S.state.brands.find((b) => b.name === 'Hugging Face'); return x && (x.channels || []).length >= nSel && S.view === 'vendor'; }, 20000); await wait(400);
      const hf = S.state.brands.find((b) => b.name === 'Hugging Face');
      check('vendor + channels added after confirm', hf && hf.enabled && (hf.channels || []).length >= Math.min(3, nSel) && S.view === 'vendor', hf && (hf.channels || []).length + ' channels (want ≥' + Math.min(3, nSel) + ')');
      // AI 辅助添加渠道：自然语言
      $('#btnAddChannel').click(); await wait(150);
      $('#cmSmart').value = ("Claude " + L('的定价页改价提醒')); $('#cmSmartGo').click();
      await waitFor(() => !S.cs.running && /条|行|失败|错误/.test($('#cmPreview').textContent), 60000);
      check('natural-language channel → pricing page monitor', $('#cmProto').value === 'page' && /claude\.com\/pricing/.test($('#cf_url').value), $('#cmProto').value + ' ' + $('#cf_url').value + ' ' + $('#cmSmartNote').textContent.slice(0, 60));
      check('auto preview after smart fill', /成功|失败/.test($('#cmPreview').textContent), $('#cmPreview').textContent.slice(0, 60));
      // 粘贴网址：RSS 自动发现
      $('#cmSmart').value = 'https://huggingface.co/blog'; $('#cmSmartGo').click();
      await waitFor(() => !S.cs.running, 60000);
      check('URL → feed autodiscovery', $('#cmProto').value === 'rss' && /feed\.xml/.test($('#cf_url').value), $('#cmProto').value + ' ' + $('#cf_url').value);
      $('#cmSmart').value = 'https://github.com/huggingface/transformers'; $('#cmSmartGo').click();
      await waitFor(() => !S.cs.running, 30000);
      check('URL → GitHub protocol', $('#cmProto').value === 'github' && $('#cf_repo').value === 'huggingface/transformers');
      closeModal();
      check('API key never appears in logs', !S.state.logs.some((l) => JSON.stringify(l).includes(window.__mock.key)));
    }
    // —— v2.3 产品优化 ——
    go('home'); await wait(300);
    check('v2.3 home: stat tiles & sections', $$('#homeBody .tile').length === 6 && $$('#homeBody .hsec').length >= 3, $$('#homeBody .hsec h3').map((h) => h.textContent.slice(0, 8)).join('|'));
    const offers23 = S.state.deals.filter((d) => d.category === 'ai' && (d.offerTypes || []).length);
    check('v2.3 structured facts on offers', offers23.length && offers23.filter((d) => d.facts && d.facts.trust).length / offers23.length >= 0.95, `${offers23.filter((d) => d.facts).length}/${offers23.length}`);
    check('v2.3 home top list from digest', (S.state.home.top || []).length === $$('#homeBody .hcol:not(.side) .hrow').length, (S.state.home.top || []).length + ' top');
    const tgt = offers23.find((d) => d.status !== 'claimed' && !d.fav);
    if (tgt) {
      await setStatus(tgt.id, 'claimed'); await wait(400);
      check('v2.3 mark claimed (persisted state)', S.state.deals.find((d) => d.id === tgt.id).status === 'claimed');
      go('deals'); $('#fStatus').value = 'claimed'; $('#fStatus').dispatchEvent(new Event('change')); await wait(150);
      check('v2.3 status filter: claimed', filteredDeals().some((d) => d.id === tgt.id) && filteredDeals().every((d) => d.status === 'claimed'));
      $('#fStatus').value = ''; $('#fStatus').dispatchEvent(new Event('change'));
      await setStatus(tgt.id, 'new'); await wait(300);
    }
    const ig = offers23.filter((d) => d.status !== 'claimed' && !d.fav)[1];
    if (ig) {
      await setStatus(ig.id, 'ignored'); await wait(400);
      check('v2.3 ignored hidden from default list', !filteredDeals().some((d) => d.id === ig.id) && S.state.home.top.indexOf(ig.id) < 0);
    }
    const no = S.state.deals.filter((d) => d.category === 'ai' && (d.offerTypes || []).length && !(d.offerTypes || []).includes('pricing') && !d.fav && d.status !== 'claimed')[2];
    if (no) {
      notOfferModal(no.id); await wait(150);
      check('v2.3 not-offer modal suggests words', $$('#noChips .chip').length > 0 || !!$('#noWord'));
      $('#noWord').value = 'zzqq-e2e-word'; $('#noPen').checked = true;
      $('#modal [data-m=notOfferGo]').click(); await wait(700);
      const nd = S.state.deals.find((d) => d.id === no.id);
      check('v2.3 not-offer: demoted + learned + source penalised', nd && !(nd.offerTypes || []).length && nd.feedback === 'noise' && S.state.settings.noiseWords.includes('zzqq-e2e-word') && (S.state.settings.noiseSources[no.sourceId] || 0) >= 1);
      go('settings'); await wait(200);
      check('v2.3 learned words listed in settings', /zzqq-e2e-word/.test($('#sNoise').textContent));
      $('#sNoise [data-rmw="zzqq-e2e-word"]').click(); await wait(500);
      check('v2.3 remove learned word', !S.state.settings.noiseWords.includes('zzqq-e2e-word'));
    }
    go('settings'); await wait(100);
    $('#sQuiet').checked = true; $('#sQuiet').dispatchEvent(new Event('change')); await wait(250);
    $('#sMinConf').value = '70'; $('#sMinConf').dispatchEvent(new Event('change')); await wait(250);
    check('v2.3 quiet hours & notify threshold saved', S.state.settings.quietHours === true && S.state.settings.notifyMinConf === 70);
    $('#sQuiet').checked = false; $('#sQuiet').dispatchEvent(new Event('change')); $('#sMinConf').value = '50'; $('#sMinConf').dispatchEvent(new Event('change')); await wait(250);
    const dg = await call('digest:now');
    check('v2.3 daily digest builds', dg && /今日要点/.test(dg.title) && Array.isArray(dg.lines), dg && dg.title);
    if (window.__mock) {
      await call('ai:save', { provider: 'custom', baseUrl: window.__mock.baseUrl, model: 'mock-model', apiKey: window.__mock.key });
      const n = await call('ai:enrich'); await wait(400);
      const zh = S.state.deals.filter((d) => /^【译】/.test(d.titleZh || ''));
      check('v2.3 AI translation + note (mock LLM, cached)', n > 0 && zh.length === n && zh.every((d) => d.aiNote && d.enrichedAt), `${n} translated`);
      const n2 = await call('ai:enrich');
      check('v2.3 AI enrichment cached (no re-translate)', zh.every((d) => S.state.deals.find((x) => x.id === d.id).titleZh === d.titleZh) && n2 <= 30, n2 + ' second pass');
      go('home'); await wait(300);
      check('v2.3 Chinese titles shown on home', !zh.length || $$('#homeBody .t-orig').length > 0 || !(S.state.home.top || []).some((id) => zh.some((d) => d.id === id)));
    }
    check('v2.5 hideResellers setting exists', 'hideResellers' in (S.state.settings || {}));
    check('v2.5 aiClassify setting default on', S.state.settings.aiClassify !== false);
    { const before = filteredDeals().length; S.state.settings.hideResellers = true; const hid = filteredDeals().length; S.state.settings.hideResellers = false; check('v2.5 hideResellers filter runs', hid <= before, before + '→' + hid); }
    check('no renderer errors', !window.__errors.length, window.__errors.join(' | '));
  } catch (e) { check('e2e exception', false, e.stack); }
  return out;
};
window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message) + (e.error && e.error.stack ? ' @ ' + String(e.error.stack).split('\n').slice(1, 3).join(' ') : '')));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message || e.reason)));

// —— 启动 ——
(async function init() {
  bind();
  S.state = await window.api.call('state:get');
  bindV26(); bindV27(); bindV28();
  if (window.api.platform === 'darwin') $('.win-ctrls').style.display = 'none';
  renderAll();
  window.api.on('state', (st) => { applyPending(st.deals); S.state = st; renderAll(); });
  window.api.on('runtime', (rt) => { if (!S.state) return; S.state.runtime = rt; renderStatus(); if (S.view === 'sources') renderSources(); if ((S.view === 'deals') && !S.state.deals.length) renderDeals(); if (S.view === 'home' && !S.state.deals.length) renderHome(); });
  window.api.on('sound', () => beep());
  window.api.on('go', (v) => { if (S.state) go(v); });
  window.api.on('discover:progress', (p) => { if (!S.dv || p.jobId !== S.dv.jobId) return; S.dv.steps[p.id] = { state: p.state, text: p.text }; renderDvSteps(); });
  $('#btnAiBrand').onclick = () => discoverModal();
  $('#aiProvider').onchange = (e) => { const P = S.state.aiProviders[e.target.value] || {}; if (e.target.value !== 'custom') { $('#aiBase').value = P.baseUrl; $('#aiModel').value = P.model; } else { $('#aiBase').value = ''; $('#aiModel').value = ''; } $('#aiBase').focus(); };
  $('#btnAiSave').onclick = async () => { const f = aiForm(); if (!f.baseUrl || !f.model) return toast(L('请填写接口地址和模型'), 'err'); await call('ai:save', f); $('#aiKey').value = ''; document.activeElement.blur(); renderAISettings(); toast(("AI " + L('助手设置已保存')), 'ok'); };
  $('#btnAiClear').onclick = async () => { await call('ai:save', { ...aiForm(), apiKey: '', clearKey: true }); $('#aiKey').value = ''; toast((L('已清除') + " API Key")); };
  $('#btnAiTest').onclick = async () => {
    const f = aiForm(); const el = $('#aiTestRes'); el.className = 'hint'; el.innerHTML = ("<i class=\"spin\"></i> " + L('测试中') + "…");
    try { const r = await window.api.call('ai:test', f.apiKey ? f : null); el.className = 'hint ok-text'; el.textContent = `✓ ${L('连接成功：{0}，', r.model)}${r.ms} ms`; }
    catch (e) { el.className = 'hint err-text'; el.textContent = '✗ ' + e.message; }
  };
  window.api.on('log', (l) => { if (!S.state) return; S.state.logs.push(l); if (S.state.logs.length > 500) S.state.logs.shift(); if (S.view === 'logs') renderLogs(); });
  const setMax = (m) => { $('#wMax').title = m ? L('还原') : L('最大化'); $('#wMax').innerHTML = m ? ic('restore') : ic('maximize'); };
  window.api.on('win:max', setMax);
  window.api.call('win:isMax').then(setMax).catch(() => {});
  if (!S.state.settings.onboarded) welcomeModal();
  setInterval(tickNext, 1000);
})();

// —— v2.6：有效期状态 / 适用于我 / 厂商快速查询 / 领取指南 / 覆盖透明度 ——
const VSTAT = { active: [L('进行中'), 'check'], ending: [L('即将截止'), 'clock'], expired: [L('已过期'), 'x'], unknown: [L('状态未知'), 'help'] };
const VREASON = { 'deadline-passed': L('已过截止日期'), 'deadline-soon': L('3 天内截止'), 'deadline-future': L('截止日期未到'), 'landing-ok': L('最近复查：落地页仍有效'), 'recent-official': L('官方近期发布，未发现结束迹象'), stale: L('发布较久且没有截止日期，建议打开原文确认'), 'no-deadline': L('原文未写截止日期'), 'landing-gone': L('落地页已下线'), error: L('复查失败') };
function vReason(v) { if (!v) return ''; const r = v.reason || ''; if (/^http-4(04|10)$/.test(r)) return L('落地页已下线') + ` (${r.slice(5)})`; if (r.startsWith('text:')) return L('落地页显示活动已结束：') + r.slice(5); return VREASON[r] || r; }
function vBadge(d, opts = {}) {
  const v = d.vstat; if (!v || !VSTAT[v.status]) return '';
  if (opts.cards && v.reason === 'deadline-future') return '';
  const [label, icn] = VSTAT[v.status];
  const extra = v.status === 'ending' && v.daysLeft != null ? ` · ${v.daysLeft === 0 ? L('今天') : v.daysLeft + ' ' + L('天')}` : '';
  const tip = vReason(v) + (v.checkedAt ? ` · ${L('上次复查')} ${fmtTime(v.checkedAt)}` : '');
  return `<span class="tag vs vs-${v.status}" title="${esc(tip)}">${ic(icn)}${label}${extra}</span>`;
}
const MINE_REASON = { 'student-only': L('仅限学生'), 'new-users-only': L('仅限新用户'), 'needs-intl-card': L('可能需要海外账号 / Visa、Mastercard'), 'region-limited': L('限定海外地区'), 'needs-cn-payment': L('需要国内支付方式') };
function profileSet() { const p = S.state.settings.profile || {}; return (p.region && p.region !== 'any') || p.student || (p.userType && p.userType !== 'any') || (p.pay || []).length; }
function mineBadge(d) {
  if (!d.mine || !profileSet()) return '';
  return d.mine.ok ? `<span class="tag mine ok" title="${L('按「设置 → 适用于我」判断')}">${ic('user')}${L('适用于我')}</span>`
    : `<span class="tag mine no" title="${esc(d.mine.reasons.map((r) => MINE_REASON[r] || r).join(L('；')))}">${ic('eyeoff')}${L('可能不适用')}</span>`;
}

// 厂商快速查询（名称 / 别名 / 中文名）
function matchVendors(q) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s/·._-]+/g, '').replace(/\*/g, '');
  const n = norm(q); if (n.length < 2) return [];
  const out = [];
  for (const b of S.state.brands) {
    if ((b.category || 'ai') !== 'ai' && !S.state.settings.goodsEnabled) continue;
    let s = 0;
    for (const x of [b.name, b.id, ...(b.aliases || [])].map(norm).filter(Boolean)) { if (x === n) s = Math.max(s, 3); else if (x.startsWith(n)) s = Math.max(s, 2); else if (n.length >= 3 && x.includes(n)) s = Math.max(s, 1); }
    if (s) out.push([s + (b.enabled ? 0.5 : 0), b]);
  }
  return out.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}
function renderLookup() {
  const el = $('#vLookup'); if (!el) return;
  const q = S.f.q; const hits = q && S.view === 'deals' ? matchVendors(q) : [];
  if (!hits.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  const b = hits[0]; const vi = (S.state.vendorInfo || {})[b.id] || {}; const cov = (S.state.coverage || []).find((c) => c.id === b.id);
  const offers = S.state.deals.filter((d) => d.brandIds.includes(b.id) && isOfferDeal(d) && d.status !== 'ignored' && d.feedback !== 'noise' && (!d.vstat || d.vstat.status !== 'expired'))
    .sort((x, y) => ({ ending: 0, active: 1, unknown: 2 }[(x.vstat || {}).status] ?? 3) - ({ ending: 0, active: 1, unknown: 2 }[(y.vstat || {}).status] ?? 3) || liveScore(y) - liveScore(x));
  const act = offers.filter((d) => d.vstat && ['active', 'ending'].includes(d.vstat.status)).length;
  const desc = (S.state.brandDesc || {})[b.id]; const dtxt = desc ? (EN ? desc.en : desc['zh-CN']) : '';
  el.style.display = '';
  el.innerHTML = `<div class="vl-card">
    <div class="vl-head">${avatar(b.id, 'span', 'av md')}<div class="vl-t"><b>${esc(b.name)}</b>${dtxt ? `<small>${esc(dtxt)}</small>` : ''}</div>
      <div class="tags vl-stats"><span class="tag vs vs-active">${ic('check')}${act} ${L('条进行中')}</span><span class="tag">${offers.length} ${L('条未过期优惠')}</span>${b.enabled ? '' : `<span class="tag vs vs-unknown">${L('未启用监控')}</span>`}</div>
      <span class="grow"></span>
      <div class="tags">${vi.pricingUrl ? `<button class="btn sm primary" data-lk="open" data-u="${esc(vi.pricingUrl)}" title="${esc(vi.pricingUrl)}">${ic('external')}${L('官方价格页')}</button>` : ''}<button class="btn sm" data-lk="brand" data-b="${esc(b.id)}">${ic('tag')}${L('只看该厂商')}</button><button class="btn sm ghost" data-lk="vendor" data-b="${esc(b.id)}">${ic('rss')}${L('厂商渠道')}</button></div>
    </div>
    <div class="vl-meta">${ic('clock')}${L('最近一次检查')} <b>${cov && cov.lastCheck ? fmtTime(cov.lastCheck) : L('尚未检查')}</b>${cov ? ` · ${L('最近成功')} <b>${cov.lastOk ? ago(cov.lastOk) : '—'}</b> · ${L('渠道')} ${cov.ok}/${cov.total} ${L('正常')}${cov.failing ? ` · <span class="err-text">${cov.failing} ${L('个失败')}</span>` : ''}` : ''}${hits.length > 1 ? ` · ${L('其他匹配：')}${hits.slice(1, 4).map((x) => `<a href="#" data-lk="pick" data-b="${esc(x.id)}">${esc(x.name)}</a>`).join(L('、'))}` : ''}</div>
    <div class="vl-list">${offers.slice(0, 6).map((d) => `<div class="vl-item" data-lk="deal" data-id="${d.id}"><div class="tags">${vBadge(d)}${offerTags(d)}</div><span class="vl-title" translate="no">${esc(dTitle(d))}</span><small>${ago(d.published)}</small></div>`).join('') || `<p class="hint">${L('暂无未过期的优惠。可以打开官方价格页确认当前价格。')}</p>`}</div>
  </div>`;
}

// 领取指南
const GSTEP = {
  'open-official': L('打开官方页面（下方按钮直达）'), 'sign-in': L('登录或注册账号'), 'enter-code': L('在结算 / 兑换页输入优惠码'), 'confirm-price': L('付款前确认最终价格与扣费周期'),
  'check-eligibility': L('确认自己符合申请条件'), 'submit-application': L('填写并提交申请表'), 'wait-review': L('等待审核（通常需要几天，留意邮件）'),
  'check-partner': L('确认自己是合作方用户（设备 / 运营商 / 支付平台）'), 'open-partner': L('在合作方 App 或活动页领取'), 'link-account': L('按提示绑定厂商账号'),
  'auto-applied': L('优惠会自动生效，无需额外操作'), 'verify-student': L('用学校邮箱或学生证完成学生认证'), 'find-offer': L('在价格页 / 活动页找到对应优惠'),
};
const GWARN = { 'needs-card': L('可能需要绑定信用卡，试用结束可能自动扣费'), 'auto-renew': L('可能自动续费：到期或首期后按原价扣费，记得提前取消'), 'intl-account': L('可能需要海外账号或境外支付方式'), reseller: L('第三方中转 / 转售，并非官方渠道，注意风险'), 'news-link': L('原文是新闻报道，按钮已改为官方页面') };
function guideHtml(d) {
  const g = d.guide; if (!g || !isOfferDeal(d) || dealCat(d) !== 'ai') return '';
  return `<div class="guide"><h4>${ic('gift')}${L('如何领取')}</h4>
    <ol>${g.steps.map((k) => `<li>${esc(GSTEP[k] || k)}</li>`).join('')}</ol>
    <div class="tags gacts">${g.claimUrl ? `<button class="btn sm primary" data-act="openSrc" data-u="${esc(g.claimUrl)}" title="${esc(g.claimUrl)}">${ic('external')}${g.claimUrlOfficial ? L('打开官方领取页') : L('打开原文')}</button>` : ''}
      ${g.code ? `<span class="code" translate="no">${esc(g.code)}</span><button class="btn sm" data-act="copyCode" data-code="${esc(g.code)}" title="${L('复制优惠码')}">${ic('copy')}${L('复制优惠码')}</button>` : ''}</div>
    ${g.warnings.length ? `<ul class="gwarn">${g.warnings.map((w) => `<li>${ic('alert')}${esc(GWARN[w] || w)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

// 覆盖透明度
const BLIND = {
  x: L('X / Twitter（需登录，免登录接口不稳定）'), linkedin: L('LinkedIn（需登录）'), discord: L('Discord 社区公告（需登录）'), 'wechat-mp': L('微信公众号（无公开订阅接口）'), 'in-app': L('App 内弹窗 / 站内信（只对登录用户可见）'),
  'help-center': L('官方帮助中心（反爬，部分文章抓不到）'), 'forum-login': L('官方论坛部分版块需登录'), 'x-primary': L('该厂商优惠主要在 X 上发布'), 'sitemap-403': L('官网 sitemap 拒绝程序访问'), 'email-only': L('部分优惠只通过邮件通知'),
  'in-app-cn': L('国内 App 内活动 / 小程序（无公开网页）'), 'carrier-region': L('运营商 / 地区合作活动（如印度 Jio）'), 'partner-region': L('合作方地区活动（如运营商、PayPal）'),
};
const COVLV = { good: [L('覆盖良好'), 'ok'], partial: [L('部分失败'), 'warn'], down: [L('全部失败'), 'err'], pending: [L('尚未检查'), 'muted'], none: [L('没有渠道'), 'muted'] };
function renderCoverage() {
  const rows = (S.state.coverage || []).slice().sort((a, b) => ({ down: 0, partial: 1, pending: 2, none: 3, good: 4 }[a.level] - { down: 0, partial: 1, pending: 2, none: 3, good: 4 }[b.level]) || b.failing - a.failing);
  const cnt = (lv) => rows.filter((r) => r.level === lv).length;
  const tot = rows.reduce((m, r) => m + r.total, 0); const ok = rows.reduce((m, r) => m + r.ok, 0);
  $('#covSub').textContent = `${rows.length} ${L('个厂商')} · ${L('渠道')} ${ok}/${tot} ${L('正常')} · ${L('上次落地页复查')} ${S.state.lastRecheck ? fmtTime(S.state.lastRecheck) : '—'}`;
  $('#covBody').innerHTML = `<div class="cov-sum tags"><span class="tag vs vs-active">${ic('check')}${L('覆盖良好')} ${cnt('good')}</span><span class="tag vs vs-ending">${ic('alert')}${L('部分失败')} ${cnt('partial')}</span><span class="tag vs vs-expired">${ic('x')}${L('全部失败')} ${cnt('down')}</span><span class="tag vs vs-unknown">${ic('help')}${L('尚未检查')} ${cnt('pending')}</span></div>
  <div class="notice info">${ic('eyeoff')}<div><b>${L('已知盲区')}</b><p>${L('本应用只使用免登录的公开来源（官网、博客、RSS、价格页、新闻搜索、公开社区）。以下渠道无法可靠监控，相关优惠可能漏报或延迟：')}</p><div class="tags">${['x', 'linkedin', 'discord', 'wechat-mp', 'in-app'].map((k) => `<span class="tag">${esc(BLIND[k])}</span>`).join('')}</div></div></div>
  <table class="grid cov"><thead><tr><th>${L('厂商名称')}</th><th>${L('覆盖状态')}</th><th>${L('渠道')}</th><th>${L('上次成功检查')}</th><th>${L('失败的源')}</th><th>${L('该厂商额外盲区')}</th></tr></thead><tbody>
  ${rows.map((r) => { const [lab, cls] = COVLV[r.level]; const extra = r.blind.filter((k) => !['x', 'linkedin', 'discord', 'wechat-mp', 'in-app'].includes(k)); return `<tr data-b="${esc(r.id)}">
    <td><div class="tags">${avatar(r.id, 'span', 'av xs')}<a href="#" data-cov="vendor" data-b="${esc(r.id)}">${esc(r.name)}</a></div></td>
    <td><span class="tag vs vs-${cls === 'ok' ? 'active' : cls === 'warn' ? 'ending' : cls === 'err' ? 'expired' : 'unknown'}">${lab}</span></td>
    <td class="nw"><div class="tags"><span class="tag" title="${L('正常')}">${ic('check')}${r.ok}</span>${r.failing ? `<span class="tag err" title="${L('失败')}">${ic('x')}${r.failing}</span>` : ''}${r.pending ? `<span class="tag" title="${L('尚未检查')}">${ic('help')}${r.pending}</span>` : ''}<small>/ ${r.total}</small></div></td>
    <td class="nw ${r.stale ? 'err-text' : ''}" title="${r.lastOk ? fmtTime(r.lastOk) : ''}">${r.lastOk ? ago(r.lastOk) : '—'}</td>
    <td>${r.failingList.length ? `<div class="tags">${r.failingList.map((f) => `<span class="tag err" title="${esc(f.error)}">${esc(f.name.split(' · ').slice(1).join(' · ') || f.name)}</span>`).join('')}</div>` : `<span class="dim">${L('无')}</span>`}</td>
    <td>${extra.length ? `<div class="tags">${extra.map((k) => `<span class="tag">${esc(BLIND[k] || k)}</span>`).join('')}</div>` : `<span class="dim">—</span>`}</td></tr>`; }).join('')}
  </tbody></table>${engineHtml()}`;
}
function renderProfile() {
  const p = S.state.settings.profile || {}; const s = S.state.settings;
  if (!$('#pRegion')) return;
  $('#pRegion').value = p.region || 'any'; $('#pStudent').checked = !!p.student; $('#pUser').value = p.userType || 'any';
  $$('#pPay input').forEach((i) => { i.checked = (p.pay || []).includes(i.value); i.parentElement.classList.toggle('on', i.checked); });
  $('#sNotifyMine').checked = !!s.notifyMineOnly; $('#sHideExpired').checked = s.hideExpired !== false; $('#sRecheck').value = String(s.recheckHours || 12);
  $('#profState').textContent = profileSet() ? L('已设置') : L('未设置'); $('#profState').className = 'tag' + (profileSet() ? ' ok' : '');
}
function readProfile() { return { region: $('#pRegion').value, student: $('#pStudent').checked, userType: $('#pUser').value, pay: $$('#pPay input').filter((i) => i.checked).map((i) => i.value) }; }
function bindV26() {
  const ps = () => saveSetting({ profile: readProfile() });
  ['#pRegion', '#pStudent', '#pUser'].forEach((k) => { $(k).onchange = ps; });
  $$('#pPay input').forEach((i) => { i.onchange = ps; });
  $('#sNotifyMine').onchange = (e) => saveSetting({ notifyMineOnly: e.target.checked });
  $('#sHideExpired').onchange = (e) => saveSetting({ hideExpired: e.target.checked });
  $('#sRecheck').onchange = (e) => saveSetting({ recheckHours: Number(e.target.value) });
  $('#fValid').onchange = (e) => { S.f.valid = e.target.value; S.page = 1; renderAll(); };
  $('#fExpired').onchange = (e) => { S.f.expired = e.target.checked; S.page = 1; renderAll(); };
  $('#fMine').onchange = (e) => { S.f.mine = e.target.checked; S.page = 1; renderAll(); saveSetting({ filterMine: e.target.checked }); };
  S.f.mine = !!S.state.settings.filterMine; $('#fMine').checked = S.f.mine;
  $('#btnRecheck').onclick = async () => { const b = $('#btnRecheck'); b.disabled = true; b.classList.add('busy'); try { const r = await call('deals:recheck'); toast(r ? L('已复查 {0} 条优惠落地页，{1} 条疑似已结束', r.checked, r.gone) : L('复查正在进行中'), 'ok'); } finally { b.disabled = false; b.classList.remove('busy'); } };
  $('#btnCovRefresh').onclick = () => refreshNow();
  $('#covBody').addEventListener('click', (e) => { const a = e.target.closest('[data-cov]'); if (!a) return; e.preventDefault(); openVendor(a.dataset.b); });
  $('#vLookup').addEventListener('click', (e) => {
    const a = e.target.closest('[data-lk]'); if (!a) return; e.preventDefault();
    const k = a.dataset.lk;
    if (k === 'open') call('deal:open', a.dataset.u);
    else if (k === 'brand') { S.f.brand = a.dataset.b; S.f.q = ''; $('#q').value = ''; S.page = 1; renderAll(); }
    else if (k === 'vendor') openVendor(a.dataset.b);
    else if (k === 'pick') { const b = brandById(a.dataset.b); if (b) { $('#q').value = b.name; S.f.q = b.name; renderAll(); } }
    else if (k === 'deal') { S.sel = a.dataset.id; renderAll(); }
  });
}

// —— v2.7：价格表 / 智能引擎 / 反馈学习 ——
const PERIOD_L = () => ({ month: L('/月'), year: L('/年'), 'seat-month': L('/人/月'), mtok: L('/百万 tokens') });
const CURSYM = { USD: '$', CNY: '¥', EUR: '€', GBP: '£', HKD: 'HK$', SGD: 'S$', INR: '₹', AUD: 'A$', CAD: 'C$', TWD: 'NT$' };
function money(v, cur) { if (v === null || v === undefined || !Number.isFinite(v)) return '—'; return (CURSYM[cur] || cur + ' ') + (Math.round(v * 100) / 100).toLocaleString(LOC); }
function spark(hist) {
  if (!hist || hist.length < 2) return `<span class="dim">${L('暂无变化')}</span>`;
  const xs = hist.map((h) => h[0]); const ys = hist.map((h) => h[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pt = (h) => `${(((h[0] - x0) / ((x1 - x0) || 1)) * 96 + 2).toFixed(1)},${(22 - ((h[1] - y0) / ((y1 - y0) || 1)) * 18).toFixed(1)}`;
  const d = hist.map((h, i) => (i ? 'L' : 'M') + pt(h)).join(' ');
  const down = ys[ys.length - 1] < ys[0];
  return `<svg class="spark ${down ? 'down' : 'up'}" viewBox="0 0 100 24" width="100" height="24" role="img" aria-label="${esc(ys.join(' → '))}"><path d="${d}"/></svg>`;
}
function renderPrices() {
  const pt = (S.state.engine || {}).prices || { rows: [], fx: {} };
  const fx = pt.fx || {};
  const vSel = $('#prVendor'); const cur = vSel.value;
  const vendors = [...new Set(pt.rows.map((r) => r.brandId))].filter(Boolean);
  vSel.innerHTML = `<option value="">${L('全部厂商')}</option>` + vendors.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(bname(v))}</option>`).join('');
  const per = $('#prPeriod').value;
  const rows = pt.rows.filter((r) => (!vSel.value || r.brandId === vSel.value) && (!per || r.period === per))
    .sort((a, b) => (b.changedAt || 0) - (a.changedAt || 0) || bname(a.brandId).localeCompare(bname(b.brandId)) || (a.cny || 0) - (b.cny || 0));
  $('#prSub').textContent = `${pt.rows.length} ${L('个套餐价格')} · ${vendors.length} ${L('个厂商')} · ${L('汇率')} 1 USD ≈ ¥${fx.usd}${fx.estimated ? ' (' + L('估算') + ')' : ' · ' + esc(fx.src || '') + ' · ' + fmtTime(fx.at)}`;
  if (!pt.rows.length) { $('#prBody').innerHTML = `<div class="empty">${ic('chart')}<b>${L('还没有识别到价格')}</b><p>${L('刷新后会从各厂商的官方价格页自动识别套餐价格；需要开启厂商的「价格页」渠道。')}</p></div>`; return; }
  const P = PERIOD_L();
  $('#prBody').innerHTML = `<div class="notice info">${ic('help')}<div><p>${L('价格由程序从官方价格页文字中自动识别（套餐名 + 金额 + 计费周期），可能有遗漏或误识别，以官网为准。人民币为按汇率换算的参考价，不含税费。')}</p></div></div>
  <table class="grid pr-t"><thead><tr><th>${L('厂商名称')}</th><th>${L('套餐')}</th><th class="r">${L('价格')}</th><th class="r">${L('约合人民币')}</th><th>${L('变化')}</th><th>${L('历史走势')}</th><th>${L('上次检查')}</th></tr></thead><tbody>
  ${rows.map((r) => { const chg = r.prev !== null && r.prev !== undefined ? r.amount - r.prev : 0; return `<tr>
    <td><div class="tags">${avatar(r.brandId, 'span', 'av xs')}<a href="#" data-open="${esc(r.url)}" title="${esc(r.url)}">${esc(bname(r.brandId) || r.vendor)}</a></div></td>
    <td><b>${esc(r.plan)}</b></td>
    <td class="r nw">${r.was ? `<s class="dim" title="${L('页面上的划线原价（通常是按年付费的折扣）')}">${money(r.was, r.currency)}</s> ` : ''}${money(r.amount, r.currency)}<small class="dim">${esc(P[r.period] || '')}</small></td>
    <td class="r nw">${r.currency === 'CNY' ? '—' : money(r.cny, 'CNY')}</td>
    <td class="nw">${chg ? `<span class="tag ${chg < 0 ? 'ok' : 'err'}">${ic(chg < 0 ? 'down' : 'up')}${money(r.prev, r.currency)} → ${money(r.amount, r.currency)}</span><small class="dim"> ${ago(r.changedAt)}</small>` : `<span class="dim">${L('无变化')}</span>`}</td>
    <td>${spark(r.hist)}</td>
    <td class="nw dim">${r.seen ? ago(r.seen) : '—'}</td></tr>`; }).join('')}
  </tbody></table>`;
}
function relChip(v) { const c = v >= 0.7 ? 'ok' : v >= 0.45 ? '' : 'err'; return `<span class="tag ${c}" title="${L('综合你的反馈（收藏 / 已领取 vs 忽略 / 不是优惠）、最近抓取成功率与是否官方渠道')}">${ic('shield')}${Math.round(v * 100)}</span>`; }
function learnChip(p) { const c = p >= 0.7 ? 'ok' : p <= 0.3 ? 'err' : ''; return `<span class="tag ${c}" title="${L('根据你过去的反馈在本机学习得出')}">${ic(p >= 0.5 ? 'thumbup' : 'thumbdown')}${Math.round(p * 100)}%</span>`; }
function judgeHtml() {
  const e = S.state.engine || {}; const lr = e.learn || {}; if (!lr.on) return '';
  const by = new Map(S.state.deals.map((d) => [d.id, d])); const list = (lr.uncertain || []).map((id) => by.get(id)).filter(Boolean).slice(0, 4);
  const head = `<h3>${ic('cpu')} ${L('帮我判断')} <small>${lr.ready ? L('已学习 {0} 条反馈', lr.labeled) : L('再标注 {0} 条即可开始学习', Math.max(0, 12 - (lr.pos + lr.neg)))}</small></h3>`;
  const seenT = new Set();
  const cands = list.length ? list : S.state.deals.filter((d) => (d.offerTypes || []).length && d.status === 'new' && !d.fav && !d.learned && d.lab === undefined && !seenT.has(d.title) && seenT.add(d.title)).slice(0, lr.ready ? 0 : 3);
  if (!cands.length) return lr.ready ? `<div class="hsec judge">${head}<div class="hempty"><small>${L('暂时没有拿不准的条目')}</small></div></div>` : '';
  return `<div class="hsec judge">${head}${cands.map((d) => `<div class="jrow" data-jid="${d.id}"><a href="#" data-jopen="${d.id}" title="${esc(d.title)}">${esc(dTitle(d))}</a><div class="tags">${typeof d.learnP === 'number' ? learnChip(d.learnP) : ''}<button class="mini" data-judge="1" title="${L('感兴趣')}">${ic('thumbup')}</button><button class="mini" data-judge="0" title="${L('不感兴趣')}">${ic('thumbdown')}</button></div></div>`).join('')}</div>`;
}
function engineHtml() {
  const e = S.state.engine || {}; if (!e.reliability) return '';
  const slow = (e.adaptive || []).filter((a) => a.iv > e.base).sort((a, b) => b.iv - a.iv).slice(0, 8);
  const low = (e.reliability || []).filter((r) => r.n >= 3).slice(0, 6);
  const lr = e.learn || {};
  return `<h3 class="cov-h">${ic('cpu')} ${L('智能引擎')}</h3>
  <div class="eng-grid">
    <div class="eng-card"><b>${L('自适应轮询')}</b><p>${e.adaptiveOn ? L('{0} 个渠道变化较少，已自动拉长检查间隔（基础 {1} 分钟，上限 {2} 分钟）', e.saved, e.base, e.max) : L('已关闭')}</p>
      ${slow.length ? `<table class="grid eng-t"><tbody>${slow.map((a) => `<tr><td title="${esc(a.name)}">${esc(a.name)}</td><td class="r dim">${L('{0} 次检查 / {1} 次有变化', a.n, a.changes)}</td><td class="r nw">${L('每 {0} 分钟', a.iv)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
    <div class="eng-card"><b>${L('来源可靠度（最低）')}</b><p>${L('综合你的反馈、最近抓取成功率和是否官方渠道；有足够反馈且低于 30 的来源不再弹通知')}</p>
      ${low.length ? `<table class="grid eng-t"><tbody>${low.map((r) => `<tr><td title="${esc(r.name)}">${esc(r.name)}</td><td class="r nw">${L('{0} 条反馈', r.n)}</td><td class="r">${relChip(r.score)}</td></tr>`).join('')}</tbody></table>` : `<p class="dim">${L('反馈还不够，暂无评估')}</p>`}</div>
    <div class="eng-card"><b>${L('偏好学习')}</b><p>${!lr.on ? L('已关闭') : lr.ready ? L('已学习 {0} 条反馈（感兴趣 {1} / 不感兴趣 {2}）', lr.labeled, lr.pos, lr.neg) : L('已学习 {0} 条反馈；至少需要 12 条且两类都有才开始预测', lr.labeled)}</p></div>
  </div>`;
}
function renderEngineSettings() {
  const s = S.state.settings; if (!$('#sAdaptive')) return;
  $('#sAdaptive').checked = s.adaptivePolling !== false; $('#sAdaptiveMax').value = String(s.adaptiveMaxMin || 360);
  $('#sLearn').checked = s.learnEnabled !== false; $('#sPricePct').value = String(s.priceAlertPct || 0);
}
function bindV27() {
  $('#sAdaptive').onchange = (e) => saveSetting({ adaptivePolling: e.target.checked });
  $('#sAdaptiveMax').onchange = (e) => saveSetting({ adaptiveMaxMin: Number(e.target.value) });
  $('#sLearn').onchange = (e) => saveSetting({ learnEnabled: e.target.checked });
  $('#sPricePct').onchange = (e) => saveSetting({ priceAlertPct: Number(e.target.value) });
  $('#prVendor').onchange = () => renderPrices(); $('#prPeriod').onchange = () => renderPrices();
  $('#btnFx').onclick = async () => { const b = $('#btnFx'); b.disabled = true; b.classList.add('busy'); try { const r = await call('fx:refresh'); toast(r && r.at ? L('汇率已更新：1 USD ≈ ¥{0}', r.rates.USD) : L('汇率获取失败，使用估算汇率'), r && r.at ? 'ok' : 'warn'); } finally { b.disabled = false; b.classList.remove('busy'); } };
  $('#prBody').addEventListener('click', (e) => { const a = e.target.closest('[data-open]'); if (a) { e.preventDefault(); call('deal:open', a.dataset.open); } });
  $('#homeBody').addEventListener('click', async (e) => {
    const j = e.target.closest('[data-judge]'); const o = e.target.closest('[data-jopen]');
    if (o) { e.preventDefault(); S.sel = o.dataset.jopen; go('deals'); return; }
    if (!j) return; e.preventDefault(); e.stopPropagation();
    const id = j.closest('.jrow').dataset.jid; const d = S.state.deals.find((x) => x.id === id); if (d) d.learned = true;
    await call('learn:label', id, j.dataset.judge === '1'); toast(j.dataset.judge === '1' ? L('已记住：你对这类优惠感兴趣') : L('已记住：以后少推这类'), 'ok');
  });
}

// —— v2.8：推送渠道 / 保存的视图 / 分享 / 上手预设 / 试用到期 ——
const PUSH_FIELDS = () => ({ url: L('Webhook 地址'), secret: L('加签密钥（可选）'), token: L('Bot Token'), chatId: L('Chat ID'), key: L('SendKey') });
const PUSH_HINT = () => ({
  webhook: L('收到 POST JSON：{ title, text, plain, kind, count }，可接 n8n / Zapier / 自建服务'),
  wecom: L('群聊 → 右上角 … → 添加群机器人，复制 Webhook 地址'),
  feishu: L('群设置 → 群机器人 → 添加自定义机器人；开启「签名校验」时填写密钥'),
  dingtalk: L('群设置 → 机器人 → 自定义（Webhook），安全设置选「加签」时填写 SEC 开头的密钥'),
  telegram: L('找 @BotFather 创建机器人得到 Token；给机器人发一条消息后，用 getUpdates 查到 Chat ID'),
  serverchan: L('在 sct.ftqq.com 登录后复制 SendKey，消息推送到微信'),
  ntfy: L('手机安装 ntfy 并订阅一个不易猜到的主题，填写 https://ntfy.sh/你的主题'),
});
const PUSH_KIND = () => ({ new: L('新优惠'), digest: L('摘要'), trial: L('试用到期'), test: L('测试') });
function v28() { return S.state.v28 || { channels: [], views: [], types: {}, presets: {} }; }
function pushCard(c) {
  const T = v28().types; const last = c.last;
  const st = last ? (last.ok ? `<span class="tag ok">${ic('check')}${L('上次推送成功')} · ${PUSH_KIND()[last.kind] || ''} · ${ago(last.at)}</span>` : `<span class="tag err" title="${esc(last.err || '')}">${ic('alert')}${L('上次推送失败')} · ${ago(last.at)}</span><small class="dim">${esc(last.err || '')}</small>`) : `<span class="dim">${L('还没有推送过')}</span>`;
  const views = v28().views;
  return `<div class="pcard ${c.enabled ? '' : 'off'}" data-pid="${esc(c.id)}">
    <div class="ph"><b>${ic('send')} ${esc(c.name)}</b><span class="tag">${esc(L((T[c.type] || {}).name || c.type))}</span><span class="grow"></span>
      <label class="switch" title="${L('启用')}"><input type="checkbox" data-pf="enabled" ${c.enabled ? 'checked' : ''}><span></span></label></div>
    <div class="tags pst">${st}</div>
    <div class="pchecks">
      <label class="chk"><input type="checkbox" data-pf="instant" ${c.instant ? 'checked' : ''}> ${L('新优惠即时推送')}</label>
      <label class="chk"><input type="checkbox" data-pf="digest" ${c.digest ? 'checked' : ''}> ${L('每日 / 每周摘要')}</label>
      <label class="chk"><input type="checkbox" data-pf="trial" ${c.trial ? 'checked' : ''}> ${L('试用到期提醒')}</label>
    </div>
    <div class="prow"><span>${L('只推送')}</span><select data-pf="viewId"><option value="">${L('命中提醒规则的新优惠')}</option>${views.map((v) => `<option value="${esc(v.id)}" ${c.viewId === v.id ? 'selected' : ''}>${L('视图：')}${esc(v.name)}</option>`).join('')}</select>
      <span>${L('最低重要度')}</span><select data-pf="minScore">${[0, 50, 60, 70, 80].map((n) => `<option value="${n}" ${Number(c.minScore) === n ? 'selected' : ''}>${n ? '≥ ' + n : L('不限')}</option>`).join('')}</select></div>
    <div class="pacts"><button class="btn" data-pa="test">${ic('send')}${L('发送测试')}</button><button class="btn ghost" data-pa="edit">${ic('edit')}${L('编辑')}</button><button class="btn ghost" data-pa="del">${ic('trash')}${L('删除')}</button></div>
  </div>`;
}
function renderPush() {
  const chs = v28().channels; const st = S.state.settings;
  const days = [L('周日'), L('周一'), L('周二'), L('周三'), L('周四'), L('周五'), L('周六')];
  $('#pushBody').innerHTML = `
    <div class="notice info">${ic('help')}<div><p>${L('推送由本机直接发到你配置的机器人 / 服务，不经过任何第三方服务器；密钥只保存在本机配置文件中。免打扰时段内不推送即时消息。')}</p></div></div>
    <div class="pgrid">${chs.map(pushCard).join('') || `<div class="empty">${ic('send')}<b>${L('还没有推送渠道')}</b><p>${L('支持企业微信 / 飞书 / 钉钉群机器人、Telegram、Server酱（微信）、ntfy（手机推送）和通用 Webhook。')}</p><button class="btn primary" data-pa="add">${ic('plus')}${L('添加渠道')}</button></div>`}</div>
    <div class="scard"><h3>${ic('clock')} ${L('摘要')}</h3>
      <div class="srow"><label class="chk"><input type="checkbox" id="pDaily" ${st.dailyDigest ? 'checked' : ''}> ${L('每日要点')}</label><span>${L('时间')}</span><input type="time" id="pTime" value="${esc(st.digestTime || '09:00')}"><button class="btn ghost" id="pDailyNow">${L('立即发送一次')}</button></div>
      <div class="srow"><label class="chk"><input type="checkbox" id="pWeekly" ${st.weeklyDigest ? 'checked' : ''}> ${L('每周周报')}</label><select id="pWeekday">${days.map((d, i) => `<option value="${i}" ${Number(st.weeklyDay ?? 1) === i ? 'selected' : ''}>${d}</option>`).join('')}</select><button class="btn ghost" id="pWeeklyNow">${L('立即发送一次')}</button></div>
      <p class="hint">${L('摘要同时以系统通知和推送渠道（勾选了「每日 / 每周摘要」的）发送。')}</p></div>`;
  if ($('#cntPush')) $('#cntPush').textContent = chs.filter((c) => c.enabled).length || '';
}
function pushModal(c) {
  const T = v28().types; const F = PUSH_FIELDS(); const H = PUSH_HINT(); const isEdit = !!c; c = c || { type: 'wecom', instant: true, digest: true, trial: true, enabled: true };
  const fields = (type) => (T[type] || { fields: [] }).fields.map((f) => `<div class="field"><label>${F[f]}</label><input id="pf_${f}" value="${esc(c[f] || '')}" spellcheck="false" ${f === 'secret' || f === 'token' || f === 'key' ? 'autocomplete="off"' : ''} placeholder="${f === 'url' ? 'https://…' : ''}"></div>`).join('') + `<p class="hint">${esc(H[type] || '')}</p>`;
  openModal(`<div class="mh"><h3>${ic('send')} ${isEdit ? L('编辑推送渠道') : L('添加推送渠道')}</h3><button class="mini" data-m="close">${ic('x')}</button></div>
    <div class="mb"><div class="field"><label>${L('类型')}</label><select id="pfType" ${isEdit ? 'disabled' : ''}>${Object.entries(T).map(([k, v]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${esc(L(v.name))}</option>`).join('')}</select></div>
      <div class="field"><label>${L('名称')}</label><input id="pfName" value="${esc(c.name || '')}" placeholder="${L('例如：我的手机')}"></div>
      <div id="pfFields">${fields(c.type)}</div></div>
    <div class="mf"><button class="btn" data-m="close">${L('取消')}</button><button class="btn" id="pfSaveTest">${L('保存并发送测试')}</button><button class="btn primary" id="pfSave">${L('保存')}</button></div>`, (m) => {
    $('#pfType', m).onchange = (e) => { $('#pfFields', m).innerHTML = fields(e.target.value); };
    const save = async (test) => {
      const type = $('#pfType', m).value; const o = { ...(isEdit ? { id: c.id } : {}), type, name: $('#pfName', m).value, enabled: c.enabled !== false, instant: c.instant !== false, digest: c.digest !== false, trial: c.trial !== false, minScore: c.minScore || 0, viewId: c.viewId || '' };
      for (const f of (T[type] || { fields: [] }).fields) o[f] = $('#pf_' + f, m).value.trim();
      const r = await call('push:save', o); closeModal(); toast(L('推送渠道已保存'), 'ok');
      if (test) testPush(r.id);
    };
    $('#pfSave', m).onclick = () => save(false); $('#pfSaveTest', m).onclick = () => save(true);
  });
}
async function testPush(id) {
  toast(L('正在发送测试消息…'));
  const r = await call('push:test', id);
  toast(r.ok ? L('测试消息已发送，请在手机 / 群聊里查看') : L('发送失败：{0}', (r.last && r.last.err) || ''), r.ok ? 'ok' : 'err');
}
// 视图
function curFilters() { return { q: S.f.q || '', brand: S.f.brand || '', type: S.f.type || '', region: S.f.region || '', platform: S.f.platform || '', mine: !!S.f.mine, valid: S.f.valid || '' }; }
function viewDesc(f) {
  const parts = []; if (f.brand) parts.push(bname(f.brand)); if (f.type) parts.push(((OFFER[f.type] || [])[0] || f.type)); if (f.q) parts.push('“' + f.q + '”'); if (f.region) parts.push(f.region === 'cn' ? L('中文') : L('国际')); if (f.mine) parts.push(L('适用于我')); if (f.valid) parts.push(L('有效期'));
  return parts.join(' · ') || L('全部优惠');
}
function renderSideViews() {
  const vs = v28().views; const el = $('#sideViews'); if (!el) return;
  el.innerHTML = vs.length ? `<div class="nav-title">${L('我的视图')} <small>${L('铃铛 = 有新条目时提醒')}</small></div><div class="nav-group">${vs.map((v) => `<a class="nav-item vitem ${S.curView === v.id ? 'active' : ''}" data-vid="${esc(v.id)}" title="${esc(viewDesc(v.filters))}"><i>${ic('bookmark')}</i><span>${esc(v.name)}</span><button class="mini vbell ${v.alert ? 'on' : ''}" data-valert="${esc(v.id)}" title="${v.alert ? L('关闭提醒') : L('有新条目时提醒')}">${v.alert ? ic('bell') : ic('belloff')}</button><button class="mini vdel" data-vdel="${esc(v.id)}" title="${L('删除视图')}">${ic('x')}</button></a>`).join('')}</div>` : '';
}
function applyView(v) {
  const f = v.filters || {};
  S.f = { ...S.f, q: f.q, brand: f.brand, type: f.type, region: f.region, platform: f.platform, mine: f.mine, valid: f.valid, status: '', unread: false };
  $('#q').value = f.q || ''; $('#fType').value = f.type || ''; if ($('#fMine')) $('#fMine').checked = !!f.mine; if ($('#fValid')) $('#fValid').value = f.valid || '';
  S.curView = v.id; S.page = 1; go('deals');
}
function saveViewModal() {
  const f = curFilters();
  openModal(`<div class="mh"><h3>${ic('bookmark')} ${L('保存为视图')}</h3><button class="mini" data-m="close">${ic('x')}</button></div>
    <div class="mb"><div class="field"><label>${L('名称')}</label><input id="vName" value="${esc(f.brand ? bname(f.brand) : f.q || '')}" placeholder="${L('例如：Claude 学生优惠')}"></div>
      <p class="hint">${L('当前筛选：')}${esc(viewDesc(f))}</p>
      <label class="chk"><input type="checkbox" id="vAlert" checked> ${L('有符合这个视图的新优惠时提醒我（系统通知；推送渠道可选择只推送这个视图）')}</label></div>
    <div class="mf"><button class="btn" data-m="close">${L('取消')}</button><button class="btn primary" id="vSave">${L('保存')}</button></div>`, (m) => {
    $('#vSave', m).onclick = async () => { const name = $('#vName', m).value.trim(); if (!name) { toast(L('请填写名称'), 'err'); return; } const v = await call('view:save', { name, filters: f, alert: $('#vAlert', m).checked }); S.curView = v.id; closeModal(); toast(L('已保存视图「{0}」', name), 'ok'); };
  });
}
// 分享卡片：Canvas 绘制 PNG（深浅主题一致的品牌配色）
function wrapText(ctx, text, maxW) { const out = []; let line = ''; for (const ch of String(text)) { const t = line + ch; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = ch; } else line = t; } if (line) out.push(line); return out; }
function shareCanvas(d) {
  const W = 720; const c = document.createElement('canvas'); const ctx = c.getContext('2d'); const font = '"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif';
  ctx.font = `bold 30px ${font}`; const tl = wrapText(ctx, dTitle(d), W - 96).slice(0, 4);
  const f = d.facts || {}; const rows = [[L('厂商名称'), d.brandIds.map(bname).join(' / ')], [L('优惠力度'), [d.price, d.discount, fmtAmount(f.amount)].filter(Boolean).join(' ')], [L('截止'), f.deadline ? new Date(f.deadline).toLocaleDateString(LOC) : ''], [L('优惠码'), f.code || ''], [L('来源'), d.sourceName || '']].filter((r) => r[1]);
  const H = 150 + tl.length * 42 + rows.length * 34 + 70; c.width = W * 2; c.height = H * 2; ctx.scale(2, 2);
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1d4ed8'); g.addColorStop(1, '#7c3aed'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(24, 24, W - 48, H - 48, 18); ctx.fill();
  ctx.fillStyle = '#2563eb'; ctx.font = `bold 15px ${font}`; ctx.fillText(L('全网优惠雷达') === 'AI Deal Radar' ? 'AI Deal Radar' : L('全网优惠雷达') + ' · AI Deal Radar', 48, 64);
  const tags = (d.offerTypes || []).map((t) => ((OFFER[t] || [])[0] || t)).join(' · '); ctx.fillStyle = '#7c3aed'; ctx.font = `13px ${font}`; ctx.fillText(tags, 48, 90);
  ctx.fillStyle = '#0f172a'; ctx.font = `bold 30px ${font}`; tl.forEach((l, i) => ctx.fillText(l, 48, 132 + i * 42));
  let y = 132 + tl.length * 42 + 8; ctx.font = `16px ${font}`;
  for (const [k, v] of rows) { ctx.fillStyle = '#64748b'; ctx.fillText(k, 48, y); ctx.fillStyle = '#0f172a'; ctx.fillText(wrapText(ctx, v, W - 240)[0], 160, y); y += 34; }
  ctx.fillStyle = '#94a3b8'; ctx.font = `12px ${font}`; ctx.fillText(wrapText(ctx, d.link || '', W - 96)[0], 48, H - 44);
  return c.toDataURL('image/png');
}
async function shareImage(d, save) { const r = await call('share:image', shareCanvas(d), save ? dTitle(d) : ''); toast(r.path ? L('图片已保存并复制到剪贴板') : L('分享图片已复制到剪贴板'), 'ok'); }
// 试用到期
function trialHtml(d) {
  if (!(d.status === 'claimed' && (d.offerTypes || []).some((t) => t === 'free' || t === 'student' || t === 'credits'))) return '';
  const end = d.trialEnd ? new Date(d.trialEnd) : null; const v = end ? `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}` : '';
  const left = end ? Math.ceil((d.trialEnd - Date.now()) / 864e5) : null;
  return `<div class="trialbox">${ic('hourglass')}<b>${L('试用到期提醒')}</b>
    ${d.trialDone ? `<span class="tag ok">${L('已处理')}</span>` : end ? `<span class="tag ${left <= 2 ? 'err' : ''}">${left <= 0 ? L('今天到期') : L('还有 {0} 天', left)}</span>` : `<small class="dim">${L('领了试用？设置到期日，提前 2 天和当天提醒你取消或续费')}</small>`}
    <div class="tags"><input type="date" id="trialDate" value="${v}">${[7, 14, 30].map((n) => `<button class="mini" data-trial="${n}">${L('{0} 天', n)}</button>`).join('')}${end ? `<button class="mini" data-act="trialClear" title="${L('取消提醒')}">${ic('x')}</button>${d.trialDone ? '' : `<button class="mini" data-act="trialDone">${ic('check')}${L('已处理')}</button>`}` : ''}</div></div>`;
}
function trialsHomeHtml() {
  const list = S.state.deals.filter((d) => d.trialEnd && !d.trialDone).sort((a, b) => a.trialEnd - b.trialEnd).slice(0, 5);
  if (!list.length) return '';
  return `<div class="hsec"><h3>${ic('hourglass')} ${L('试用到期')}</h3>${list.map((d) => { const n = Math.ceil((d.trialEnd - Date.now()) / 864e5); return `<div class="jrow"><a href="#" data-jopen="${d.id}">${esc(dTitle(d))}</a><span class="tag ${n <= 2 ? 'err' : ''}">${n <= 0 ? L('今天到期') : L('还有 {0} 天', n)}</span></div>`; }).join('')}</div>`;
}
// 上手预设
function presetChips(id) { return `<div class="chips" id="${id}">${Object.entries(v28().presets).map(([k, p]) => `<button class="chip" data-preset="${k}" title="${esc(L(p.desc))}">${ic('wand')}${esc(L(p.name))}<small>${esc(L(p.desc))}</small></button>`).join('')}</div>`; }
async function applyPreset(k) { const r = await call('preset:apply', k); toast(L('已套用预设：新增提醒规则「{0}」', r.rule), 'ok'); }
function bindV28() {
  $('#btnAddPush').onclick = () => pushModal();
  $('#btnSaveView').onclick = saveViewModal;
  $('#pushBody').addEventListener('change', async (e) => {
    const t = e.target; if (t.id === 'pDaily') return saveSetting({ dailyDigest: t.checked }); if (t.id === 'pTime') return saveSetting({ digestTime: t.value });
    if (t.id === 'pWeekly') return saveSetting({ weeklyDigest: t.checked }); if (t.id === 'pWeekday') return saveSetting({ weeklyDay: Number(t.value) });
    const pf = t.dataset.pf; const card = t.closest('[data-pid]'); if (!pf || !card) return;
    const c = v28().channels.find((x) => x.id === card.dataset.pid); if (!c) return;
    await call('push:save', { ...c, [pf]: t.type === 'checkbox' ? t.checked : pf === 'minScore' ? Number(t.value) : t.value });
  });
  $('#pushBody').addEventListener('click', async (e) => {
    if (e.target.closest('#pDailyNow')) { const r = await call('digest:now'); toast(r ? r.title : L('暂无内容'), 'ok'); return; }
    if (e.target.closest('#pWeeklyNow')) { const r = await call('digest:weekly'); toast(r.title, 'ok'); return; }
    const a = e.target.closest('[data-pa]'); if (!a) return; const card = a.closest('[data-pid]'); const id = card && card.dataset.pid;
    if (a.dataset.pa === 'add') return pushModal();
    if (a.dataset.pa === 'test') { a.disabled = true; try { await testPush(id); } finally { a.disabled = false; } }
    if (a.dataset.pa === 'edit') pushModal(v28().channels.find((x) => x.id === id));
    if (a.dataset.pa === 'del' && await confirmModal(L('删除推送渠道'), L('确定删除这个推送渠道吗？'), L('删除'))) { await call('push:delete', id); toast(L('已删除'), 'ok'); }
  });
  $('#sideViews').addEventListener('click', async (e) => {
    const al = e.target.closest('[data-valert]'); const dl = e.target.closest('[data-vdel]'); const it = e.target.closest('[data-vid]');
    if (al) { e.stopPropagation(); const v = v28().views.find((x) => x.id === al.dataset.valert); await call('view:save', { ...v, alert: !v.alert }); toast(!v.alert ? L('已开启提醒：有符合「{0}」的新优惠时通知你', v.name) : L('已关闭「{0}」的提醒', v.name), 'ok'); return; }
    if (dl) { e.stopPropagation(); if (await confirmModal(L('删除视图'), L('确定删除这个视图吗？'), L('删除'))) { await call('view:delete', dl.dataset.vdel); if (S.curView === dl.dataset.vdel) S.curView = null; } return; }
    if (it) { e.preventDefault(); const v = v28().views.find((x) => x.id === it.dataset.vid); if (v) applyView(v); }
  });
  $('#detail').addEventListener('click', async (e) => {
    const d = S.sel && S.state.deals.find((x) => x.id === S.sel); if (!d) return;
    const tb = e.target.closest('[data-trial]'); if (tb) { await call('deal:trial', d.id, Date.now() + Number(tb.dataset.trial) * 864e5); toast(L('已设置：到期前 2 天和当天提醒你'), 'ok'); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'shareMd') { await call('share:markdown', d.id); toast(L('已复制 Markdown，可直接粘贴到群聊 / 笔记'), 'ok'); }
    if (a.dataset.act === 'shareImg') await shareImage(d, false);
    if (a.dataset.act === 'shareSave') await shareImage(d, true);
    if (a.dataset.act === 'trialClear') await call('deal:trial', d.id, 0);
    if (a.dataset.act === 'trialDone') await call('deal:trialDone', d.id);
  });
  $('#detail').addEventListener('change', async (e) => { if (e.target.id !== 'trialDate' || !e.target.value) return; const [y, m, dd] = e.target.value.split('-').map(Number); await call('deal:trial', S.sel, new Date(y, m - 1, dd, 10, 0).getTime()); toast(L('已设置：到期前 2 天和当天提醒你'), 'ok'); });
  document.addEventListener('click', (e) => { const p = e.target.closest('[data-preset]'); if (p) { e.preventDefault(); applyPreset(p.dataset.preset).then(() => p.classList.add('on')); } });
  window.api.on('select', (id) => { if (!S.state) return; S.sel = id; go('deals'); });
}
