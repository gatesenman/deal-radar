'use strict';
// 本地模拟的 OpenAI 兼容接口（/v1/chat/completions），仅用于自动化测试（DEAL_RADAR_MOCK_LLM=1 或 node src/mock-llm.js）。
// 根据提示词类型返回确定性的 JSON，验证「AI 辅助添加」的完整链路，不需要真实的 API Key。
const http = require('http');
const KEY = 'sk-mock-test-0123456789';
const ALIASES = { mistral: ['Mistral AI', 'Le Chat', 'Mistral Large', 'Codestral'], kimi: ['Kimi', '月之暗面', 'Moonshot AI', 'Kimi K2'], anthropic: ['Claude', 'Anthropic', 'Claude Code'], perplexity: ['Perplexity', 'Perplexity Pro', 'Comet'] };
const EXCL = { mistral: ['mistral wind', '密史脱拉风'], kimi: ['Räikkönen', 'Raikkonen', 'F1'], anthropic: [], perplexity: [] };
function answer(prompt) {
  if (/Reply with exactly OK/i.test(prompt)) return 'OK';
  if (/Translate into concise, natural Simplified Chinese/.test(prompt) || /translate the title into concise natural Simplified Chinese/.test(prompt)) {
    const items = [...prompt.matchAll(/^(\d+)\. (.*)$/gm)].map(([, i, t]) => ({ i: Number(i), zh: '【译】' + t.split(' || ')[0].slice(0, 60), note: '模拟要点：' + (/(free|免费)/i.test(t) ? '免费福利' : '优惠信息') }));
    return JSON.stringify({ items });
  }
  if (/You classify AI-vendor deal headlines/.test(prompt)) {
    const items = [...prompt.matchAll(/^(\d+)\. (.*)$/gm)].map(([, i, t]) => {
      const noise = /价格战|price war|commentary|making .{0,20} better|VPS Free|Oakley|H&R Block|市值|资本开支|隐藏折扣|立省一个亿|ignites? battle|reading the .{0,20} release/i.test(t);
      return { i: Number(i), class: noise ? 'noise' : 'offer', why: noise ? 'industry/noise' : 'actionable offer' };
    });
    return JSON.stringify({ items });
  }
  if (/whether two deal headlines are the SAME event/.test(prompt)) {
    const items = [...prompt.matchAll(/^(\d+)\./gm)].map(([, i]) => ({ i: Number(i), same: false }));
    return JSON.stringify({ pairs: items });
  }
  if (/Translate into concise, natural English/.test(prompt) || /translate the Chinese title into concise natural English/.test(prompt)) {
    const items = [...prompt.matchAll(/^(\d+)\. (.*)$/gm)].map(([, i, t]) => ({ i: Number(i), text: '[EN] ' + t.split(' || ')[0].slice(0, 60), note: 'Mock note: ' + (/(free|免费)/i.test(t) ? 'free perk' : 'offer') }));
    return JSON.stringify({ items });
  }
  let m;
  if ((m = prompt.match(/Vendor the user typed: "([^"]+)"/))) {
    const name = m[1]; const k = name.toLowerCase().split(/\s/)[0];
    const doms = [...prompt.matchAll(/^- ([a-z0-9.-]+\.[a-z]{2,}):/gim)].map((x) => x[1]);
    return '```json\n' + JSON.stringify({ official_domains: doms.slice(0, 1), display_name: name, aliases: ALIASES[k] || [name], exclude: EXCL[k] || [], region: /[\u3400-\u9fff]/.test(name) || k === 'kimi' ? 'cn' : 'intl', is_mainstream: true, reason: 'mock' }) + '\n```';
  }
  if (/Candidate channels/.test(prompt)) {
    const rows = [...prompt.matchAll(/^(\d+) \| (\w+) \| (\w+) \| (.*?) \|/gm)];
    const dom = (prompt.match(/Official domains: ([^\s,]+)/) || [])[1] || '';
    const channels = rows.map(([, idx, type, sub, url]) => ({ idx: Number(idx), keep: !(type === 'page' && /\/(research|about)\b/.test(url)), sub, name: { rss: '官方博客 RSS', sitemap: '官网新页面', page: sub === 'pricing' ? '官方价格页' : '官网页面', github: 'GitHub 发布', youtube: 'YouTube 官方频道', appstore: 'iOS App', gplay: 'Android App', search: '新闻搜索', hn: 'Hacker News' }[type] || type, keyword: type === 'page' && sub === 'pricing' ? '$,¥,€,free,免费,month,月' : undefined }));
    const extra = dom ? [{ type: 'page', url: `https://${dom}/pricing`, sub: 'pricing', name: '价格页（AI 建议）', why: 'mock 建议' }, { type: 'page', url: 'https://evil.example.com/pricing', sub: 'pricing', name: '第三方（应被拒绝）', why: 'mock' }] : [];
    return JSON.stringify({ channels, extra, aliases: [], exclude: [], notes: '模拟 AI：已保留官方渠道' });
  }
  if (/CSS selectors/.test(prompt)) return JSON.stringify({ is_list: true, list: 'a[href*="/news/"]', title: '', link: '', date: '', reason: '模拟 AI：新闻链接' });
  if ((m = prompt.match(/Request: (.*)/))) {
    const req = m[1];
    if (/claude/i.test(req) && /(定价|价格|pricing|改价)/i.test(req)) return JSON.stringify({ url: 'https://claude.com/pricing', type: 'page', intent: 'pricing', keyword: '$,month,free', reason: 'Claude 官方定价页' });
    return JSON.stringify({ url: '', type: 'search', intent: 'news', keyword: req.slice(0, 40), reason: '模拟 AI：用新闻搜索' });
  }
  return '{}';
}
function startMockLLM(port = 0) {
  const srv = http.createServer((req, res) => {
    if (req.method !== 'POST' || !/\/v1\/chat\/completions$/.test(req.url)) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"not found"}}'); }
    if (req.headers.authorization !== 'Bearer ' + KEY) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"Incorrect API key provided"}}'); }
    let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
      let j; try { j = JSON.parse(b); } catch { res.writeHead(400); return res.end('{}'); }
      const prompt = (j.messages || []).map((x) => x.content).join('\n');
      const content = answer(prompt);
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'mock', model: j.model, choices: [{ index: 0, message: { role: 'assistant', content } }] })); }, 150);
    });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ server: srv, port: srv.address().port, baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, key: KEY })));
}
module.exports = { startMockLLM, MOCK_KEY: KEY };
if (require.main === module) startMockLLM(Number(process.argv[2]) || 18080).then((m) => console.log('mock LLM at', m.baseUrl, 'key', KEY));
