'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/core/v28');
const d1 = { id: 'a', title: 'Claude Pro 学生 50% off', brandIds: ['anthropic'], offerTypes: ['student', 'discount'], link: 'https://claude.ai/x', discount: '5折', score: 80, fetchedAt: Date.now(), region: 'global' };

test('渠道：各家请求格式与签名', () => {
  const msg = V.buildMessage('new', [d1], { brandName: () => 'Claude' });
  assert.match(msg.text, /Claude Pro/); assert.equal(msg.count, 1);
  const wc = V.buildRequest(V.normalizeChannel({ type: 'wecom', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x' }), msg);
  assert.equal(JSON.parse(wc.body).msgtype, 'markdown');
  const fs = V.buildRequest(V.normalizeChannel({ type: 'feishu', url: 'https://open.feishu.cn/x', secret: 's' }), msg, 1700000000000);
  const fb = JSON.parse(fs.body); assert.equal(fb.timestamp, '1700000000'); assert.equal(fb.sign, V.signFeishu('s', 1700000000));
  const dt = V.buildRequest(V.normalizeChannel({ type: 'dingtalk', url: 'https://oapi.dingtalk.com/robot/send?access_token=t', secret: 'SEC' }), msg, 1700000000000);
  assert.match(dt.url, /&timestamp=1700000000000&sign=/);
  const tg = V.buildRequest(V.normalizeChannel({ type: 'telegram', token: '123:abcdefghijklmnopqrstuvwxyz', chatId: '42' }), msg);
  assert.match(tg.url, /api\.telegram\.org\/bot123:/); assert.equal(JSON.parse(tg.body).chat_id, '42');
  const sc = V.buildRequest(V.normalizeChannel({ type: 'serverchan', key: 'SCT12345abc' }), msg);
  assert.match(sc.url, /sctapi\.ftqq\.com\/SCT12345abc\.send/); assert.match(sc.body, /title=/);
  const nt = V.buildRequest(V.normalizeChannel({ type: 'ntfy', url: 'https://ntfy.sh/mytopic' }), msg);
  assert.equal(nt.url, 'https://ntfy.sh/'); assert.equal(JSON.parse(nt.body).topic, 'mytopic');
  assert.equal(V.validateChannel(V.normalizeChannel({ type: 'webhook', url: 'ftp://x' })), 'URL 无效');
  assert.equal(V.validateChannel(V.normalizeChannel({ type: 'telegram', token: 'bad', chatId: '' })).length > 0, true);
  const m = V.mask(V.normalizeChannel({ type: 'serverchan', key: 'SCT12345abcdef' })); assert.ok(!m.key.includes('45abcd'));
});
test('渠道：200 但带错误码判失败', async () => {
  assert.equal(V.checkResponse({ type: 'wecom' }, 200, '{"errcode":93000,"errmsg":"invalid webhook url"}'), '93000 invalid webhook url');
  assert.equal(V.checkResponse({ type: 'feishu' }, 200, '{"code":0}'), '');
  assert.match(V.checkResponse({ type: 'webhook' }, 500, 'boom'), /HTTP 500/);
  let got; const fake = async (url, o) => { got = { url, o }; return { status: 200, text: async () => '{"ok":true}' }; };
  await V.sendChannel(V.normalizeChannel({ type: 'webhook', url: 'http://127.0.0.1:1/h' }), V.buildMessage('test', []), fake);
  assert.equal(JSON.parse(got.o.body).kind, 'test');
});
test('视图匹配、摘要计划（本地日期）、试用到期、分享', () => {
  const v = V.normalizeView({ name: '学生', filters: { type: 'student', q: 'claude' } });
  assert.ok(V.matchView(v, d1)); assert.ok(!V.matchView(V.normalizeView({ filters: { brand: 'openai' } }), d1));
  const at = new Date(2026, 9, 21, 7, 30); // 本地 7:30
  assert.deepEqual(V.digestDue({ dailyDigest: true, digestTime: '07:00', lastDigestDay: '2026-10-20' }, at), { daily: true, weekly: false });
  assert.equal(V.digestDue({ dailyDigest: true, digestTime: '07:00', lastDigestDay: V.localDay(at) }, at).daily, false);
  const wed = new Date(2026, 9, 21, 10, 0);
  assert.equal(V.digestDue({ weeklyDigest: true, weeklyDay: 3, digestTime: '09:00' }, wed).weekly, true);
  assert.equal(V.digestDue({ weeklyDigest: true, weeklyDay: 3, digestTime: '09:00', lastWeeklyKey: V.isoWeek(wed) }, wed).weekly, false);
  const now = Date.now();
  const due = V.trialDue([{ id: 1, trialEnd: now + 1.5 * 864e5 }, { id: 2, trialEnd: now - 1000 }, { id: 3, trialEnd: now + 9 * 864e5 }, { id: 4, trialEnd: now + 864e5, trialNotified: ['soon'] }], now);
  assert.deepEqual(due.map((x) => [x.d.id, x.stage]), [[1, 'soon'], [2, 'today']]);
  const md = V.shareMarkdown({ ...d1, facts: { code: 'EDU50' } }, { brandName: () => 'Claude' });
  assert.match(md, /\*\*Claude Pro/); assert.match(md, /EDU50/); assert.match(md, /https:\/\/claude\.ai/);
  assert.equal(V.weeklyItems([d1, { ...d1, id: 'b', status: 'ignored' }]).length, 1);
});
test('main.js 不重复注册 IPC（重复会导致启动失败、窗口不出现）', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const names = [...src.matchAll(/handle\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});
