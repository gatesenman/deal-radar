// 全新默认配置做一次真实扫描，把合并后的条目写到 JSON（用于离线评估优惠识别精度）
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Store } = require('../src/core/store');
const { runAll, channelSources, mergeDeals } = require('../src/core/monitor');
const { nodeFetchText } = require('../src/core/http');
const out = process.argv[2] || '/workspace/eval/live-deals.json';
const s = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'scan-')));
const brands = s.config.brands.filter((b) => b.enabled && b.category !== 'goods');
const all = [...s.config.sources, ...channelSources(s.config.brands.filter((b) => b.category !== 'goods'), {})].filter((x) => x.enabled && x.type !== 'render');
let deals = []; const t0 = Date.now();
runAll(all, brands, { fetchText: nodeFetchText, ctx: {}, pages: {}, concurrency: 8, hostGap: 1500, force: true, onResult: (src, r) => { if (r.items.length) deals = mergeDeals(deals, r.items, { maxDeals: 5000, maxAgeDays: 30, dedupe: true }).all; } }).then((r) => {
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(deals));
  console.log(JSON.stringify({ sources: r.length, ok: r.filter((x) => x.status.ok).length, deals: deals.length, offers: deals.filter((d) => (d.offerTypes || []).length).length, sec: ((Date.now() - t0) / 1000).toFixed(0) }));
});
