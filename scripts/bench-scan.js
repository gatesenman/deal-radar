// 首次扫描基准：全新配置（默认启用）下所有渠道抓取一遍。JS 渲染渠道在 Node 下跳过（应用内由隐藏浏览器渲染）
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Store } = require('../src/core/store');
const { runAll, channelSources, hostOf } = require('../src/core/monitor');
const { nodeFetchText } = require('../src/core/http');
const s = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-')));
const brands = s.config.brands.filter((b) => b.enabled && b.category !== 'goods');
const all = [...s.config.sources, ...channelSources(s.config.brands.filter((b) => b.category !== 'goods'), {})].filter((x) => x.enabled);
const hosts = {}; for (const x of all) { const h = x.type === 'render' ? 'render' : hostOf(x.url); hosts[h] = (hosts[h] || 0) + 1; }
console.log('enabled brands', brands.length, 'enabled sources', all.length, 'render', all.filter((x) => x.type === 'render').length);
console.log('top hosts', Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 8));
const conc = Number(process.env.CONC || 6), gap = Number(process.env.GAP || 1500);
const t0 = Date.now(); let done = 0;
runAll(all.filter((x) => x.type !== 'render'), brands, { fetchText: nodeFetchText, ctx: {}, pages: {}, concurrency: conc, hostGap: gap, force: true, onResult: (src, r) => { done++; if (process.env.V) console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', done, src.type, hostOf(src.url), r.status.ms + 'ms', r.status.ok ? 'ok' : r.status.error); } }).then((r) => {
  const ok = r.filter((x) => x.status.ok).length; const items = r.reduce((a, x) => a + x.items.length, 0);
  const slow = r.slice().sort((a, b) => b.status.ms - a.status.ms).slice(0, 5).map((x) => x.source.name + ' ' + x.status.ms + 'ms');
  console.log(JSON.stringify({ conc, gap, sources: r.length, ok, fail: r.length - ok, items, seconds: ((Date.now() - t0) / 1000).toFixed(1), slow }));
  for (const x of r.filter((x) => !x.status.ok)) console.log('FAIL', x.source.name, x.status.error);
});
