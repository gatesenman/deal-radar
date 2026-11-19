'use strict';
// v2.8：推送渠道（Webhook / 企业微信 / 飞书 / 钉钉 / Telegram / Server酱 / ntfy）、每日 / 每周摘要、
// 保存的视图（可作为提醒规则）、分享卡片 Markdown、上手预设、试用到期提醒
// 参考：Apprise 的「一个 URL 一个渠道」模型、Huginn DigestAgent（见 RESEARCH.md）
const crypto = require('crypto');
const fmt = (k, ...a) => String(k).replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? a[i] : m));

const CHANNEL_TYPES = {
  webhook: { name: 'Webhook（JSON）', fields: ['url'] },
  wecom: { name: '企业微信群机器人', fields: ['url'] },
  feishu: { name: '飞书群机器人', fields: ['url', 'secret'] },
  dingtalk: { name: '钉钉群机器人', fields: ['url', 'secret'] },
  telegram: { name: 'Telegram Bot', fields: ['token', 'chatId'] },
  serverchan: { name: 'Server酱（微信）', fields: ['key'] },
  ntfy: { name: 'ntfy（手机推送）', fields: ['url'] },
};

function normalizeChannel(c = {}) {
  const type = CHANNEL_TYPES[c.type] ? c.type : 'webhook';
  const s = (v, n = 500) => String(v || '').trim().slice(0, n);
  return {
    id: c.id || 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    type, name: s(c.name, 60) || CHANNEL_TYPES[type].name, enabled: c.enabled !== false,
    url: s(c.url), secret: s(c.secret, 200), token: s(c.token, 200), chatId: s(c.chatId, 100), key: s(c.key, 200),
    instant: c.instant !== false, digest: c.digest !== false, trial: c.trial !== false,
    minScore: Math.max(0, Math.min(100, Number(c.minScore) || 0)), viewId: s(c.viewId, 40),
    last: c.last || null,
  };
}
function validateChannel(c) {
  const isUrl = (u) => /^https?:\/\/[^\s]+$/i.test(u || '');
  if (['webhook', 'wecom', 'feishu', 'dingtalk', 'ntfy'].includes(c.type) && !isUrl(c.url)) return 'URL 无效';
  if (c.type === 'telegram' && (!/^\d+:[\w-]{20,}$/.test(c.token) || !c.chatId)) return 'Telegram Bot Token 或 Chat ID 无效';
  if (c.type === 'serverchan' && !/^[\w-]{8,}$/.test(c.key)) return 'SendKey 无效';
  return '';
}
function mask(c) { // 给界面看的：不回传完整密钥
  const m = (v) => (v ? v.slice(0, 4) + '…' + v.slice(-3) : '');
  return { ...c, secret: c.secret ? '••••' : '', token: m(c.token), key: m(c.key), hasSecret: !!c.secret, hasToken: !!c.token, hasKey: !!c.key };
}

// 统一消息 → {title, text(markdown), plain, link}
function buildMessage(kind, items, { t = fmt, title, brandName = (x) => x, extra = [] } = {}) {
  const lines = items.slice(0, 10).map((d) => {
    const b = (d.brandIds || []).map(brandName).join('/');
    const tags = [d.price, d.discount].filter(Boolean).join(' ');
    return { md: `- **${b ? '【' + b + '】' : ''}${mdEsc(d.title)}**${tags ? ' ' + tags : ''}${d.link ? `\n  ${d.link}` : ''}`, plain: `${b ? '【' + b + '】' : ''}${d.title}${tags ? ' ' + tags : ''}${d.link ? '\n' + d.link : ''}` };
  });
  const more = items.length > 10 ? t('…另有 {0} 条', items.length - 10) : '';
  const head = title || (kind === 'test' ? t('全网优惠雷达：测试消息') : t('全网优惠雷达：{0} 条新优惠', items.length));
  const text = [`### ${head}`, ...extra, ...lines.map((l) => l.md), more].filter(Boolean).join('\n');
  const plain = [head, ...extra, ...lines.map((l) => l.plain), more].filter(Boolean).join('\n\n');
  return { kind, title: head, text, plain, link: (items[0] && items[0].link) || '', count: items.length };
}
function mdEsc(s) { return String(s || '').replace(/([*_`\[\]])/g, '\\$1'); }

function signFeishu(secret, ts) { return crypto.createHmac('sha256', `${ts}\n${secret}`).update('').digest('base64'); }
function signDingtalk(secret, ts) { return crypto.createHmac('sha256', secret).update(`${ts}\n${secret}`).digest('base64'); }

/** 把消息变成 HTTP 请求 {url, method, headers, body}，便于测试和统一发送 */
function buildRequest(c, msg, now = Date.now()) {
  const J = { 'Content-Type': 'application/json; charset=utf-8' };
  switch (c.type) {
    case 'wecom': return { url: c.url, headers: J, body: JSON.stringify({ msgtype: 'markdown', markdown: { content: msg.text.slice(0, 4000) } }) };
    case 'feishu': {
      const body = { msg_type: 'text', content: { text: msg.plain.slice(0, 4000) } };
      if (c.secret) { const ts = Math.floor(now / 1000); body.timestamp = String(ts); body.sign = signFeishu(c.secret, ts); }
      return { url: c.url, headers: J, body: JSON.stringify(body) };
    }
    case 'dingtalk': {
      let url = c.url;
      if (c.secret) { const ts = now; url += (url.includes('?') ? '&' : '?') + `timestamp=${ts}&sign=${encodeURIComponent(signDingtalk(c.secret, ts))}`; }
      return { url, headers: J, body: JSON.stringify({ msgtype: 'markdown', markdown: { title: msg.title.slice(0, 60), text: msg.text.slice(0, 4000) } }) };
    }
    case 'telegram': return { url: `https://api.telegram.org/bot${c.token}/sendMessage`, headers: J, body: JSON.stringify({ chat_id: c.chatId, text: msg.plain.slice(0, 4000), disable_web_page_preview: msg.count > 1 }) };
    case 'serverchan': {
      const host = /^sctp(\d+)t/i.test(c.key) ? `https://${c.key.match(/^sctp(\d+)t/i)[1]}.push.ft07.com/send/${c.key}.send` : `https://sctapi.ftqq.com/${c.key}.send`;
      return { url: host, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ title: msg.title.slice(0, 32), desp: msg.text.slice(0, 30000) }).toString() };
    }
    case 'ntfy': { // JSON 发布到服务根地址：https://ntfy.sh/<topic> → POST https://ntfy.sh {topic,...}
      const u = new URL(c.url); const topic = u.pathname.replace(/^\/+|\/+$/g, '');
      return { url: u.origin + '/', headers: J, body: JSON.stringify({ topic, title: msg.title, message: msg.plain.slice(0, 4000), ...(msg.link ? { click: msg.link } : {}), tags: ['moneybag'] }) };
    }
    default: return { url: c.url, headers: J, body: JSON.stringify({ app: 'DealRadar', kind: msg.kind, title: msg.title, text: msg.text, plain: msg.plain, count: msg.count }) };
  }
}
/** 判断渠道返回是否成功（各家机器人 HTTP 200 也可能带错误码） */
function checkResponse(c, status, body) {
  if (status < 200 || status >= 300) return `HTTP ${status}${body ? '：' + String(body).slice(0, 120) : ''}`;
  let j = null; try { j = JSON.parse(body); } catch { /* 非 JSON */ }
  if (!j) return '';
  if (c.type === 'wecom' || c.type === 'dingtalk') return j.errcode ? `${j.errcode} ${j.errmsg || ''}` : '';
  if (c.type === 'feishu') return j.code ? `${j.code} ${j.msg || ''}` : '';
  if (c.type === 'telegram') return j.ok === false ? String(j.description || 'error') : '';
  if (c.type === 'serverchan') return j.code ? `${j.code} ${j.message || ''}` : '';
  return '';
}
async function sendChannel(c, msg, fetchImpl, now = Date.now()) {
  const r = buildRequest(c, msg, now);
  const res = await fetchImpl(r.url, { method: 'POST', headers: r.headers, body: r.body });
  const body = await res.text().catch(() => '');
  const err = checkResponse(c, res.status, body);
  if (err) throw new Error(err);
  return true;
}

// —— 保存的视图 ——
function normalizeView(v = {}) {
  const f = v.filters || {};
  return {
    id: v.id || 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: String(v.name || '未命名视图').slice(0, 40),
    filters: { q: String(f.q || '').slice(0, 100), brand: String(f.brand || ''), type: String(f.type || ''), region: String(f.region || ''), platform: String(f.platform || ''), mine: !!f.mine, valid: String(f.valid || '') },
    alert: !!v.alert, created: v.created || Date.now(),
  };
}
/** 视图是否命中某条优惠（与列表筛选同口径的子集；搜索词全部包含） */
function matchView(v, d, { brandText = () => '' } = {}) {
  const f = v.filters || {};
  if (!(d.offerTypes || []).length) return false;
  if (f.brand && !(d.brandIds || []).includes(f.brand)) return false;
  if (f.type && !(d.offerTypes || []).includes(f.type)) return false;
  if (f.region && d.region !== f.region) return false;
  if (f.platform && d.platform !== f.platform) return false;
  if (f.mine && d.mine && !d.mine.ok) return false;
  if (f.valid && !(d.vstat && d.vstat.status === f.valid)) return false;
  if (f.q) { const hay = (d.title + ' ' + (d.summary || '') + ' ' + (d.platform || '') + ' ' + (d.brandIds || []).map(brandText).join(' ')).toLowerCase(); if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((x) => hay.includes(x))) return false; }
  return true;
}

// —— 摘要计划 ——
function localDay(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function isoWeek(date = new Date()) { const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); const n = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - n); const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - y) / 864e5 + 1) / 7)).padStart(2, '0')}`; }
/** 到点了吗：daily 用本地日期（修复：之前用 UTC 日期，东八区早于 8 点的摘要会一天发两次） */
function digestDue(st, now = new Date()) {
  const [h, m] = String(st.digestTime || '09:00').split(':').map(Number); const after = now.getHours() * 60 + now.getMinutes() >= (h || 0) * 60 + (m || 0);
  const daily = !!st.dailyDigest && after && st.lastDigestDay !== localDay(now);
  const wd = Number(st.weeklyDay === undefined ? 1 : st.weeklyDay); // 0=周日
  const weekly = !!st.weeklyDigest && after && now.getDay() === wd && st.lastWeeklyKey !== isoWeek(now);
  return { daily, weekly };
}
function weeklyItems(deals, now = Date.now()) {
  const W = 7 * 864e5;
  return deals.filter((d) => (d.offerTypes || []).length && d.status !== 'ignored' && d.feedback !== 'noise' && now - (d.fetchedAt || d.published || 0) <= W && !(d.vstat && d.vstat.status === 'expired'))
    .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 15);
}

// —— 分享卡片 ——
function shareMarkdown(d, { brandName = (x) => x, t = fmt } = {}) {
  const b = (d.brandIds || []).map(brandName).join(' / ');
  const f = d.facts || {};
  const rows = [
    [t('厂商名称'), b], [t('优惠力度'), [d.price, d.discount].filter(Boolean).join(' ')],
    [t('截止'), f.deadline ? new Date(f.deadline).toISOString().slice(0, 10) : ''],
    [t('优惠码'), f.code || d.code || ''], [t('来源'), d.sourceName || ''],
  ].filter((r) => r[1]);
  return [`**${d.title}**`, '', ...rows.map(([k, v]) => '- ' + t('{0}：{1}', k, v)), '', d.link || '', '', `— ${t('来自全网优惠雷达')}`].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// —— 上手预设 ——
const PRESETS = {
  student: { name: '学生党', desc: '学生优惠、免费额度、教育计划优先', profile: { student: true }, rule: { name: '学生 / 免费', types: ['student', 'free'], notify: true }, groups: ['llm', 'agent', 'creative'] },
  dev: { name: '开发者 / API', desc: 'API 赠送额度、降价、编程工具', profile: {}, rule: { name: 'API 额度 / 降价', types: ['credits', 'pricing', 'discount', 'startup'], notify: true }, groups: ['llm', 'agent', 'cloud', 'software'] },
  cn: { name: '国内用户', desc: '国内可用、支付宝 / 微信支付、中文厂商', profile: { region: 'cn', pay: ['alipay', 'wechat'] }, rule: { name: '国内可用', keywords: ['国内', '免费', '限免', '新用户'], notify: true }, groups: null },
  saver: { name: '只要大额折扣', desc: '只提醒重要度高的折扣与免费', profile: {}, rule: { name: '高价值优惠', types: ['discount', 'free'], minScore: 70, notify: true }, groups: null },
};

// —— 试用到期 ——
/** 返回需要提醒的 [{d, stage:'soon'|'today', days}]；stage 已提醒过不重复 */
function trialDue(deals, now = Date.now(), soonDays = 2) {
  const out = [];
  for (const d of deals) {
    const end = d.trialEnd; if (!end || d.trialDone) continue;
    const days = Math.ceil((end - now) / 864e5);
    const stage = days <= 0 ? 'today' : days <= soonDays ? 'soon' : '';
    if (!stage) continue;
    if ((d.trialNotified || []).includes(stage)) continue;
    out.push({ d, stage, days: Math.max(0, days) });
  }
  return out;
}

module.exports = { CHANNEL_TYPES, normalizeChannel, validateChannel, mask, buildMessage, buildRequest, checkResponse, sendChannel, signFeishu, signDingtalk, normalizeView, matchView, localDay, isoWeek, digestDue, weeklyItems, shareMarkdown, PRESETS, trialDue };
