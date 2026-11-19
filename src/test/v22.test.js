'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Store } = require('../src/core/store');
const D = require('../src/core/defaults');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dr22-'));

test('v2.2 presets: every brand has a known group; all AI-group vendors on, non-AI off', () => {
  const ids = new Set(D.BRAND_GROUPS.map((g) => g.id));
  for (const b of D.PRESET_BRANDS) {
    assert.ok(ids.has(b.group), b.id + ' group ' + b.group);
    assert.strictEqual(!!b.on, D.AI_GROUPS.includes(b.group), b.id);
  }
  for (const id of ['openai', 'anthropic', 'gemini', 'ms-copilot', 'xai', 'meta', 'mistral', 'perplexity', 'cursor', 'github-copilot', 'midjourney', 'deepseek', 'kimi', 'zhipu', 'qwen', 'doubao', 'ernie', 'hunyuan', 'spark', 'minimax', 'elevenlabs', 'runway', 'suno', 'devin', 'manus', 'coze', 'dify', 'langchain', 'n8n', 'genspark'])
    assert.ok(D.PRESET_BRANDS.find((b) => b.id === id && b.on), id);
  for (const id of ['notion', 'adobe', 'canva', 'figma', 'aws', 'gcp', 'azure', 'cloudflare']) assert.ok(D.PRESET_BRANDS.find((b) => b.id === id && !b.on), id);
  for (const id of ['devin', 'manus', 'coze', 'dify', 'langchain', 'n8n', 'genspark']) assert.ok(D.VENDOR_CHANNELS[id].length >= 3, id + ' ' + D.VENDOR_CHANNELS[id].length);
});

test('v2.2 fresh install enables AI groups', () => {
  const s = new Store(tmp());
  const on = s.config.brands.filter((b) => b.enabled).map((b) => b.id);
  assert.ok(on.includes('manus') && on.includes('suno') && on.includes('ernie') && !on.includes('notion') && !on.includes('aws') && !on.includes('Apple'.toLowerCase()));
  assert.strictEqual(s.config.version, 5);
});

test('v2.2 migration from v4: AI vendors switched on once, user-disabled kept off, non-AI untouched, idempotent', () => {
  const dir = tmp();
  const s0 = new Store(dir);
  // 模拟 v2.1 配置：大部分 AI 厂商关闭，用户明确关闭了 Midjourney，开启了 Notion
  const cfg = JSON.parse(JSON.stringify(s0.config));
  cfg.version = 4;
  for (const b of cfg.brands) { b.enabled = ['openai', 'notion', 'midjourney'].includes(b.id); delete b.group; delete b.userOff; }
  cfg.brands.find((b) => b.id === 'midjourney').enabled = false;
  cfg.brands.find((b) => b.id === 'midjourney').userOff = true;
  cfg.brands = cfg.brands.filter((b) => !['devin', 'manus'].includes(b.id)); // v2.1 没有这些厂商
  cfg.brands.push({ id: 'my', name: 'MyAI', aliases: ['MyAI'], exclude: [], category: 'ai', enabled: false, preset: false });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  const s = new Store(dir);
  const by = (id) => s.config.brands.find((b) => b.id === id);
  for (const id of ['anthropic', 'deepseek', 'ernie', 'suno', 'runway', 'devin', 'manus', 'coze']) assert.ok(by(id).enabled, id);
  assert.ok(!by('midjourney').enabled, 'user-disabled kept off');
  assert.ok(by('notion').enabled && !by('adobe').enabled && !by('aws').enabled);
  assert.ok(!by('my').enabled && by('my').group === 'custom');
  assert.strictEqual(s.config.version, 5);
  // 迁移只执行一次：之后关闭的厂商不会被再次打开
  s.setBrandEnabled('deepseek', false);
  const s2 = new Store(dir);
  assert.ok(!s2.config.brands.find((b) => b.id === 'deepseek').enabled);
});

test('v2.2 setGroupEnabled', () => {
  const s = new Store(tmp());
  assert.strictEqual(s.setGroupEnabled('cloud', true), 4);
  assert.ok(s.config.brands.filter((b) => b.group === 'cloud').every((b) => b.enabled));
  s.setGroupEnabled('agent', false);
  assert.ok(s.config.brands.filter((b) => b.group === 'agent').every((b) => !b.enabled && b.userOff));
});
