#!/usr/bin/env node
// 一次性 codemod：把源码中的中文界面文案包进 L('…', args)。可重复运行（已包裹的不再处理）。
// 用法：node scripts/i18n-rewrite.js src/renderer/app.js src/main.js
'use strict';
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { RUN_SRC, HAS } = require('../src/renderer/i18n.js');
const RUN = new RegExp(RUN_SRC, 'g');
const SKIP_CALLS = new Set(['includes', 'indexOf', 'startsWith', 'endsWith', 'test', 'match', 'split', 'replace', 'querySelector', 'querySelectorAll', 'closest', 'has', 'get', 'delete', 'L', 'tx', 'call', 'invoke', 'handle', 'send', 'on', 'RegExp', 'require', 'getElementById']);
const CMP = new Set(['===', '!==', '==', '!=', 'in']);
function rewrite(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const edits = []; const keys = new Set(); const skipped = [];
  const isSimple = (n) => { const s = src.slice(n.start, n.end); return s.length < 90 && !/[`<'"]/.test(s) && !HAS.test(s); };
  walk.fullAncestor(ast, (node, _st, anc) => {
    const parent = anc[anc.length - 2];
    if (node.type === 'Literal' && typeof node.value === 'string' && HAS.test(node.value)) {
      if (node.regex) return;
      const why = skipReason(node, parent, anc);
      if (why) { skipped.push(`${file}:${lineOf(src, node.start)} [${why}] ${node.value.slice(0, 40)}`); return; }
      const v = node.value; const parts = []; let last = 0; let m; RUN.lastIndex = 0;
      while ((m = RUN.exec(v))) { if (m.index > last) parts.push(JSON.stringify(v.slice(last, m.index))); parts.push(`L(${q(m[0])})`); keys.add(m[0]); last = m.index + m[0].length; }
      if (last < v.length) parts.push(JSON.stringify(v.slice(last)));
      const out = parts.length === 1 ? parts[0] : `(${parts.join(' + ')})`;
      const needParen = parent && parent.type === 'Property' && parent.value === node; // 值位置可以直接替换
      edits.push([node.start, node.end, needParen ? out : out]);
    }
    if (node.type === 'TemplateLiteral' && node.quasis.some((qq) => HAS.test(qq.value.raw))) {
      if (parent && parent.type === 'TaggedTemplateExpression') return;
      const why = skipReason(node, parent, anc); if (why) { skipped.push(`${file}:${lineOf(src, node.start)} [${why}] template`); return; }
      // 拼成一串：文字原样，简单表达式 → \u0001，复杂表达式 → \u0002（打断片段）
      let comb = ''; const pos = []; const ex = [];
      node.quasis.forEach((qq, i) => {
        const raw = qq.value.raw; for (let k = 0; k < raw.length; k++) { comb += raw[k]; pos.push(qq.start + k); }
        if (i < node.expressions.length) { const e = node.expressions[i]; comb += isSimple(e) ? '\u0001' : '\u0002'; pos.push(-1 - i); ex.push(e); }
      });
      let m; RUN.lastIndex = 0;
      while ((m = RUN.exec(comb))) {
        const run = m[0]; if (/\\/.test(run)) continue;
        const args = []; let key = ''; let k = m.index;
        for (const ch of run) { if (ch === '\u0001') { const ei = -1 - pos[k]; key += `{${args.length}}`; args.push(src.slice(ex[ei].start, ex[ei].end)); } else key += ch; k++; }
        const s = pos[m.index]; const e = pos[m.index + run.length - 1] + 1;
        keys.add(key);
        edits.push([s, e, '${L(' + q(key) + (args.length ? ', ' + args.join(', ') : '') + ')}']);
      }
    }
  });
  edits.sort((a, b) => b[0] - a[0]);
  let out = src; let prev = Infinity;
  for (const [s, e, r] of edits) { if (e > prev) continue; out = out.slice(0, s) + r + out.slice(e); prev = s; }
  return { out, keys, skipped, n: edits.length };
}
function q(s) { return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
function lineOf(src, i) { return src.slice(0, i).split('\n').length; }
function skipReason(node, parent, anc) {
  if (!parent) return null;
  if (parent.type === 'Property' && parent.key === node && !parent.computed) return 'key';
  if (parent.type === 'BinaryExpression' && CMP.has(parent.operator)) return 'cmp';
  if (parent.type === 'SwitchCase' && parent.test === node) return 'case';
  if (parent.type === 'MemberExpression' && parent.object === node) return 'member';
  if (parent.type === 'ImportDeclaration') return 'import';
  if ((parent.type === 'CallExpression' || parent.type === 'NewExpression') && parent.arguments.includes(node)) {
    const c = parent.callee; const name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : '';
    if (SKIP_CALLS.has(name)) return 'call:' + name;
  }
  // 位于 ['…','…'].includes(x) 这类数组里
  const gp = anc[anc.length - 3];
  if (parent.type === 'ArrayExpression' && gp && gp.type === 'MemberExpression' && gp.object === parent) return 'array-member';
  return null;
}
if (require.main === module) {
  const all = new Set(); const sk = [];
  for (const f of process.argv.slice(2)) { const r = rewrite(f); fs.writeFileSync(f, r.out); r.keys.forEach((k) => all.add(k)); sk.push(...r.skipped); console.log(f, 'edits', r.n, 'keys', r.keys.size); }
  fs.writeFileSync('/tmp/i18n-skipped.txt', sk.join('\n'));
  console.log('skipped', sk.length);
}
module.exports = { rewrite };
