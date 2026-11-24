'use strict';
// v2.14：筛选持久化、升级说明、浅量状态推送、缓存统计。

const { cmpSemver } = require('./v213');

const SORTS = new Set(['pub', 'found', 'score', 'disc']);
const TYPES = new Set(['', 'free', 'discount', 'credits', 'student', 'startup', 'event', 'plan', 'pricing']);
const VALIDS = new Set(['', 'active', 'ending', 'expired', 'unknown', 'suspect']);

function normalizeFilters(f = {}) {
  const type = TYPES.has(f.type) ? f.type : '';
  const valid = VALIDS.has(f.valid) ? f.valid : '';
  const sort = SORTS.has(f.sort) ? f.sort : 'pub';
  const region = ['', 'cn', 'intl'].includes(f.region) ? f.region : '';
  const platform = String(f.platform || '').slice(0, 40);
  return { type, valid, sort, region, platform, news: !!f.news };
}

function notes() {
  return [
    { v: '2.10.0', items: ['补上 Mistral / Microsoft Copilot / Meta Llama API 官方源，粘贴网址可识别协议'] },
    { v: '2.11.0', items: ['更准的过期判断、截止日期和价格解析，减少误报'] },
    { v: '2.12.0', items: ['优惠可按原因反馈，详情显示证据链；备份导出自动去掉推送密钥和 AI Key'] },
    { v: '2.13.0', items: ['设置里可检查 GitHub 新版本（不会自动安装）；推送失败会自动重试'] },
    { v: '2.14.0', items: ['列表筛选重启后保留；升级后显示本版更新；可跟随系统深浅色；刷新时界面更跟得上'] },
    { v: '2.16.0', items: ['公开采集地址增加安全校验，避免读取本地网络资源。'] },
    { v: '2.17.0', items: ['备份导入前校验格式，写入失败可回滚，并保留本机密钥和试用提醒。'] },
    { v: '2.18.0', items: ['不再猜测有歧义的截止日期，修正分隔金额和跨币种价格历史。'] },
    { v: '2.19.0', items: ['尊重服务端限流等待时间，保留故障前最近成功检查的记录。'] },
    { v: '2.20.0', items: ['推送前持久化去重标记，避免重启后重复推送；结果未知时不再盲目重试。'] },
    { v: '2.21.0', items: ['弹窗支持键盘焦点循环与返回，增加无动画偏好和双语界面冒烟测试。'] },
  ];
}

/** 返回 (lastSeen, current] 之间的说明，不含 lastSeen 当条。 */
function notesSince(lastSeen, current) {
  const cur = String(current || '').replace(/^v/i, '');
  const last = String(lastSeen || '').replace(/^v/i, '');
  return notes().filter((n) => cmpSemver(n.v, last) > 0 && cmpSemver(n.v, cur) <= 0);
}

function shouldShowNotes({ onboarded, lastSeen, current, shot }) {
  if (shot || !onboarded) return false;
  if (!current) return false;
  return notesSince(lastSeen, current).length > 0;
}

function cacheStats(cache) {
  if (!cache || !cache.map) return { entries: 0, hits: 0, bytes: 0, savedBytes: 0 };
  let bytes = 0;
  for (const e of cache.map.values()) bytes += (e.body || '').length;
  return { entries: cache.map.size, hits: cache.hits || 0, bytes, savedBytes: cache.savedBytes || 0 };
}

function fmtBytes(n) {
  const x = Number(n) || 0;
  if (x < 1024) return x + ' B';
  if (x < 1024 * 1024) return (x / 1024).toFixed(1) + ' KB';
  return (x / (1024 * 1024)).toFixed(1) + ' MB';
}

/** 刷新中若没有新优惠，复用上一份完整状态，只覆盖运行时字段，避免反复装饰整表。 */
function refreshState(prev, live, { light, hasNew } = {}) {
  if (light && prev && !hasNew) return { ...prev, ...live };
  return null;
}

module.exports = { SORTS, TYPES, VALIDS, normalizeFilters, notes, notesSince, shouldShowNotes, cacheStats, fmtBytes, refreshState, cmpSemver };
