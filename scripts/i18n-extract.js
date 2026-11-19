#!/usr/bin/env node
// 提取全部可翻译文案 → src/locales/zh-CN.json（源语言目录，key=原文）；并检查各语言缺失项与「硬编码残留」。
// 用法：node scripts/i18n-extract.js [--check]   （--check：有缺失 / 残留时退出码 1）
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { RUN_SRC, HAS } = require('../src/renderer/i18n.js');
const ROOT = path.join(__dirname, '..');
const RUN = () => new RegExp(RUN_SRC, 'g');
const SUB = () => /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef](?:[\u3400-\u9fff\u3000-\u303f\uff00-\uffef\d \t·/、%+.\-:()#&!?,…—~*]*[\u3400-\u9fff\u3000-\u303f\uff00-\uffef])?/g;
const ui = new Set(); const data = new Set(); const leftovers = [];
const add = (set, s) => { s = s.trim(); if (s && HAS.test(s)) set.add(s); };
function parse(f) { const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); return { src, ast: acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, locations: true }) }; }
// 1) 界面代码：L('…') / t('…') 的 key；其余中文字面量视为残留（比较 / 正则 / 测试用例除外）
for (const f of ['src/renderer/app.js', 'src/main.js', 'src/core/digest.js']) {
  const { ast, src } = parse(f); const lines = src.split('\n');
  walk.fullAncestor(ast, (n, _s, anc) => {
    const p = anc[anc.length - 2];
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && ['L', 't'].includes(n.callee.name) && n.arguments[0] && n.arguments[0].type === 'Literal') add(ui, String(n.arguments[0].value));
    if (n.type === 'Literal' && typeof n.value === 'string' && HAS.test(n.value) && !n.regex) {
      const isKey = p && p.type === 'CallExpression' && p.callee.type === 'Identifier' && ['L', 't', 'tx'].includes(p.callee.name);
      const cmp = p && ((p.type === 'BinaryExpression') || (p.type === 'Property' && p.key === n) || (p.type === 'CallExpression' && p.callee.type === 'MemberExpression' && ['includes', 'test', 'startsWith', 'match', 'replace', 'split'].includes(p.callee.property.name)));
      const inTest = anc.some((a) => a.type === 'Property' && a.key && (a.key.name === '__test' || a.key.value === '__test')) || /__test|e2e/.test('');
      if (!isKey && !cmp && /i18n-ok/.test(lines[n.loc.start.line - 1])) { for (const m of n.value.matchAll(RUN())) add(data, m[0]); return; }
      if (!isKey && !cmp && f !== 'src/core/digest.js') leftovers.push(`${f}:${n.loc.start.line} ${n.value.slice(0, 50)}`);
    }
    if (n.type === 'TemplateLiteral' && f !== 'src/core/digest.js' && n.quasis.some((q) => HAS.test(q.value.raw))) leftovers.push(`${f}:${n.loc.start.line} \`${n.quasis.map((q) => q.value.raw).join('${}').slice(0, 50)}\``);
  });
}
// 2) 静态 HTML：文本节点与 title/placeholder 属性
{
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
  const texts = [...html.matchAll(/>([^<]+)</g)].map((m) => m[1]).concat([...html.matchAll(/(?:title|placeholder|aria-label|data-tip)="([^"]*)"/g)].map((m) => m[1]));
  for (const t of texts) for (const m of t.replace(/&[a-z]+;/g, ' ').matchAll(RUN())) add(ui, m[0]);
}
// 3) 核心数据文案（渠道名、分组、类型、事实字段、错误…）：显示时由 tx() 逐片段翻译
for (const f of fs.readdirSync(path.join(ROOT, 'src/core')).filter((x) => x.endsWith('.js') && !['brandmeta.js', 'matcher.js', 'dedupe.js'].includes(x))) {
  const { ast } = parse('src/core/' + f);
  walk.full(ast, (n) => {
    let texts = [];
    if (n.type === 'Literal' && typeof n.value === 'string' && !n.regex) texts = [n.value];
    if (n.type === 'TemplateLiteral') { texts = n.quasis.map((q) => q.value.cooked || ''); const joined = n.quasis.map((q, i) => (q.value.cooked || '') + (i < n.expressions.length ? '\u0001' : '')).join(''); for (const m of joined.matchAll(RUN())) { let k = 0; add(data, m[0].replace(/\u0001/g, () => `{${k++}}`)); } }
    for (const t of texts) { if (!HAS.test(t)) continue; for (const m of t.matchAll(RUN())) { let k = 0; add(data, m[0].replace(/\d+(?:[.,]\d+)*/g, (x) => (/^\d+$/.test(x) && x.length > 3 ? x : `{${k++}}`)).replace(/\{\d+\}/g, (x) => x)); add(data, m[0]); for (const s of m[0].matchAll(SUB())) add(data, s[0]); } }
  });
}
// 只保留真正显示的数据片段：过滤掉纯关键词（≤1 字）
for (const k of [...data]) if (k.replace(/[^\u3400-\u9fff]/g, '').length < 1) data.delete(k);
const all = [...new Set([...ui, ...data])].sort();
const zh = Object.fromEntries(all.map((k) => [k, k]));
fs.writeFileSync(path.join(ROOT, 'src/locales/zh-CN.json'), JSON.stringify(zh, null, 1) + '\n');
let bad = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'src/locales')).filter((x) => x.endsWith('.json') && x !== 'zh-CN.json')) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/locales', f), 'utf8'));
  const missUi = [...ui].filter((k) => !d[k]); const missData = [...data].filter((k) => !d[k] && !ui.has(k));
  const cjk = Object.entries(d).filter(([, v]) => HAS.test(v)).map(([k]) => k);
  console.log(`${f}: ${Object.keys(d).length} entries; missing UI ${missUi.length}, missing data ${missData.length}, values still Chinese ${cjk.length}`);
  if (process.argv.includes('--list')) { fs.writeFileSync(`/tmp/missing-${f}.txt`, [...missUi, '----DATA----', ...missData].join('\n')); }
  bad += missUi.length; if (cjk.length) console.log("  (values containing proper nouns in Chinese: " + cjk.length + ")");
}
console.log(`keys: ui ${ui.size}, data ${data.size}, total ${all.length}; hard-coded leftovers ${leftovers.length}`);
if (leftovers.length) console.log(leftovers.slice(0, 40).join('\n'));
if (process.argv.includes('--check') && (bad || leftovers.length)) process.exit(1);
