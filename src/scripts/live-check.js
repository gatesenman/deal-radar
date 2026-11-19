// 实时检测预设数据源（与应用相同的调度逻辑）：node scripts/live-check.js [ai|goods|all]
const { PRESET_SOURCES, PRESET_BRANDS, DEFAULT_ENABLED, GOODS_DEFAULT_ENABLED } = require('../src/core/defaults');
const { runAll } = require('../src/core/monitor');
const { OFFER_LABELS } = require('../src/core/offers');
const { slug } = require('../src/core/store');
const which = process.argv[2] || 'ai';
const brands = PRESET_BRANDS.filter((b) => (b.category === 'ai' ? DEFAULT_ENABLED : GOODS_DEFAULT_ENABLED).includes(b.name)).map((b) => ({ ...b, id: b.id || slug(b.name) }));
(async () => {
  const t0 = Date.now();
  const srcs = PRESET_SOURCES.filter((s) => which === 'all' || s.category === which).map((s) => ({ ...s, enabled: true }));
  const rows = await runAll(srcs, brands, {});
  let fail = 0; let offers = 0;
  for (const { source: s, status: st, items } of rows) {
    if (!st.ok) fail++;
    const off = items.filter((d) => d.category !== 'ai' || d.offerTypes.some((t) => t !== 'plan')).length; offers += off;
    console.log(`${st.ok ? (st.error ? 'PART' : 'OK  ') : 'FAIL'} ${s.id.padEnd(20)} items=${String(st.total).padStart(4)} matched=${String(st.matched).padStart(3)} offers=${String(off).padStart(3)} ${String(st.ms).padStart(5)}ms ${st.error}`);
    if (process.env.V) items.filter((d) => d.offerTypes.length).slice(0, +process.env.V || 3).forEach((d) => console.log('      -', d.brandIds.join(','), '|', d.offerTypes.map((t) => OFFER_LABELS[t]).join('/'), '|', d.title.slice(0, 110)));
  }
  console.log(`\n${rows.length - fail}/${rows.length} sources OK, matched ${rows.reduce((a, r) => a + r.items.length, 0)}, offers ${offers}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  require('fs').writeFileSync(__dirname + '/../test/live-result.json', JSON.stringify(rows.map((r) => ({ id: r.source.id, name: r.source.name, ...r.status })), null, 1));
  process.exit(0);
})();
