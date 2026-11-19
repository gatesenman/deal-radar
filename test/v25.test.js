'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { refineOffer, COMMENTARY, RESELLER } = require('../src/core/offers');
const { sameStory, anchors } = require('../src/core/cluster');
const { needsClassify, classifyPrompt, parseClassify } = require('../src/core/classify');
const { needsEnrich, enrichPrompt, parseEnrich, digestOf } = require('../src/core/digest');
const { mergeDeals } = require('../src/core/monitor');
const fs = require('fs');
const path = require('path');

test('v2.5 precision: industry commentary / how-to / reseller / non-AI shopping dropped', () => {
  const drop = [
    ['中国AI竞争从争夺算力转向经营算力：数据中心扩张、模型降价与阿里资本开支', ['discount']],
    ['什么？GPT比DeepSeek还便宜了？大模型价格战卷出新高度', ['discount']],
    ['Anthropic and OpenAI release cheaper models as price war intensifies', ['discount']],
    ['9 Best VPS Free Trials (Oct. 2026) - HostingAdvice.com', ['free']],
    ["There's up to 25% off with these Oakley discount codes for October", ['discount']],
    ['Week four panic? Here\'s how to turn your Gemini free trial into an academic comeback', ['free']],
    ['2026年GLM-5.3 API哪里最便宜？实测三大渠道价格差距', ['discount']],
    ['DeepSeek产品部！1.3亿人免费用的AI变现模式参考', ['free']],
  ];
  for (const [t, types] of drop) assert.deepEqual(refineOffer(t, types, {}), [], t);
  const keep = [
    ['Anthropic is giving startups a free year of Claude Team and $1,000 in credits', ['free', 'startup', 'credits']],
    ['Google Gemini 4 Unveils Limited-Time 50% Off APIs', ['discount', 'event']],
    ['OpenAI Is Offering Free ChatGPT Plus in India: How To Get It Now?', ['free']],
    ['豆包开学季学生优惠 送大学生3个月免费订阅权益', ['discount', 'student']],
  ];
  for (const [t, types] of keep) assert.ok(refineOffer(t, types, {}).length, t);
  assert.ok(RESELLER.test('芒果 AI｜ DeepSeek 全线 0.05 折！百亿 Token 自由不是梦'));
  assert.deepEqual(refineOffer('claude 中转 95%OFF', ['discount'], { hideResellers: true }), []);
  assert.ok(refineOffer('claude 中转 95%OFF', ['discount'], { hideResellers: false }).length);
});

test('v2.5 cross-language / same-story clustering', () => {
  assert.ok(sameStory(
    { title: 'Anthropic is giving startups a free year of Claude Team and $1,000 in credits', brandIds: ['anthropic'] },
    { title: 'Anthropic升级初创企业支持计划：Claude Team免费使用1年，另送1000美元API额度', brandIds: ['anthropic'] }
  ));
  assert.ok(sameStory(
    { title: 'DeepSeek made its 75% discount permanent. The AI price war just escalated.', brandIds: ['deepseek'] },
    { title: 'DeepSeek to make a 75% permanent discount on new V4 Pro AI model', brandIds: ['deepseek'] }
  ));
  assert.ok(sameStory(
    { title: 'Google Gemini 4 Unveils Limited-Time 50% Off APIs', brandIds: ['gemini'] },
    { title: '刚刚，Gemini 4终于来了：谷歌重回御三家，API限时半价', brandIds: ['gemini'] }
  ));
  assert.ok(!sameStory(
    { title: 'DeepSeek made its 75% discount permanent. The AI price war just escalated.', brandIds: ['deepseek'] },
    { title: '什么？GPT比DeepSeek还便宜了？大模型价格战卷出新高度', brandIds: ['deepseek', 'openai'] }
  ));
  assert.ok(anchors('半价 API', ['gemini']).has('p:50'));
});

test('v2.5 mergeDeals uses cross-lang clustering (N sources)', () => {
  const now = Date.now();
  const a = { id: 'a', title: 'Anthropic is giving startups a free year of Claude Team and $1,000 in credits', titleKey: 'a', sourceId: 'en', sourceName: 'EN', link: 'https://a.com/1', brandIds: ['anthropic'], offerTypes: ['free'], fetchedAt: now, published: now };
  const b = { id: 'b', title: 'Anthropic升级初创企业支持计划：Claude Team免费使用1年，另送1000美元API额度', titleKey: 'b', sourceId: 'zh', sourceName: 'ZH', link: 'https://b.com/1', brandIds: ['anthropic'], offerTypes: ['free', 'credits'], fetchedAt: now, published: now };
  const m = mergeDeals([a], [b], { now, dedupe: true });
  assert.equal(m.added.length, 0);
  assert.ok((m.all[0].sources || []).length >= 2);
});

test('v2.5 AI classifier prompt / parser / selection', () => {
  const d = { title: '大模型价格战卷出新高度', offerTypes: ['discount'], sub: 'news', platform: '媒体' };
  assert.ok(needsClassify(d));
  assert.ok(!needsClassify({ ...d, aiClass: 'offer' }));
  assert.ok(!needsClassify({ title: '50% off Claude API', offerTypes: ['discount'], platform: '厂商渠道', sub: 'blog' }));
  const out = parseClassify('{"items":[{"i":0,"class":"noise","why":"price war"},{"i":1,"class":"offer"}]}');
  assert.deepEqual(out, [{ i: 0, class: 'noise', why: 'price war' }, { i: 1, class: 'offer', why: '' }]);
  assert.match(classifyPrompt([d]), /REAL actionable offer/);
});

test('v2.5 translation prompts improved + higher default enrich limit', () => {
  const list = [{ title: '豆包开学季学生优惠', summary: '送三个月' }];
  assert.match(enrichPrompt(list, 'en'), /Keep product names/);
  assert.match(enrichPrompt([{ title: 'Free Claude for students' }], 'zh-CN'), /Keep product names/);
  assert.ok(needsEnrich({ title: '豆包开学季', category: 'ai', offerTypes: ['student'], status: 'new' }, 'en'));
});

test('v2.5 fresh eval sample precision ≥ 80% under gold labels', { skip: !fs.existsSync('/workspace/eval/sample50-v25.json') && 'eval fixture missing' }, () => {
  const sample = JSON.parse(fs.readFileSync(path.join('/workspace/eval/sample50-v25.json'), 'utf8'));
  const NOISE = new Set([7, 13, 14, 25, 30, 37]); // human gold on this independent scan
  let tp = 0, fp = 0;
  sample.forEach((x, i) => {
    const kept = refineOffer(x.title, x.offerTypes || [], { sub: x.sub }).length > 0;
    const should = !NOISE.has(i + 1);
    if (kept && should) tp++;
    if (kept && !should) fp++;
  });
  const prec = tp / (tp + fp);
  assert.ok(prec >= 0.8, `precision ${prec}`);
  assert.equal(fp, 0);
});
