// 实测「AI 辅助添加厂商」发现流程：node scripts/discover-live.js Anthropic Mistral Kimi
//   设置 LLM_BASE / LLM_KEY / LLM_MODEL 环境变量即使用 AI（可指向本地 mock：node test/mock-llm.js）
const { discoverVendor } = require('../src/core/discover');
const { makeLLM } = require('../src/core/ai');
const { nodeFetchText } = require('../src/core/http');
const { normalizeChannel } = require('../src/core/store');
const { channelSource, fetchSource } = require('../src/core/monitor');
const testChannel = async (c) => {
  const ch = { ...normalizeChannel(c), id: 'probe' };
  const b = { id: 'probe', name: 'probe', category: 'ai', enabled: true };
  const r = await fetchSource({ ...channelSource(b, ch, {}), id: 'probe-' + Math.random() }, [b], { fetchText: nodeFetchText, pages: {}, retryDelay: 1000 });
  return { ok: r.status.ok, error: r.status.error, total: r.status.total, lineCount: r.status.total, sample: r.items.slice(0, 3).map((d) => d.title) };
};
(async () => {
  const llm = process.env.LLM_BASE ? makeLLM({ baseUrl: process.env.LLM_BASE, apiKey: process.env.LLM_KEY || '', model: process.env.LLM_MODEL || 'mock' }) : null;
  const out = {};
  for (const name of process.argv.slice(2)) {
    const t0 = Date.now();
    try {
      const r = await discoverVendor(name, { fetchText: nodeFetchText, llm, testChannel, onStep: (s) => process.env.V && console.log('  ', s.id, s.state, s.text) });
      const ok = r.candidates.filter((c) => c.test && c.test.ok);
      console.log(`\n## ${name} → ${r.vendor.name} | 官网 ${r.vendor.domains.join(', ')} | 别名 ${r.vendor.aliases.join(', ')} | 排除 ${r.vendor.exclude.join(', ')} | AI ${r.usedAI} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      for (const c of r.candidates) console.log(`  ${c.checked ? '[x]' : '[ ]'} ${(c.test && c.test.ok ? 'OK ' : 'ERR').padEnd(3)} ${c.type.padEnd(9)} ${c.sub.padEnd(9)} ${(c.url || c.keyword || JSON.stringify(c.opts)).slice(0, 80)}  ${c.test && !c.test.ok ? '— ' + String(c.test.error).slice(0, 60) : c.test ? `(${c.test.total})` : ''}`);
      if (r.notes.length) console.log('  notes:', r.notes.join(' | '));
      out[name] = { domains: r.vendor.domains, candidates: r.candidates.length, ok: ok.length, checked: r.candidates.filter((c) => c.checked).length };
    } catch (e) { console.log(`\n## ${name} FAILED: ${e.message}`); out[name] = { error: e.message }; }
  }
  console.log('\nSUMMARY', JSON.stringify(out));
  process.exit(0);
})();
