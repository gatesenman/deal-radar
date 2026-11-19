// 全量实测所有预设厂商渠道（含默认关闭、标记不稳定的渠道），按协议统计：
//   npx electron scripts/live-channels.js        （在 Electron 中运行，可检测 JS 渲染渠道）
//   node scripts/live-channels.js                （纯 Node，渲染渠道记为“需桌面应用”）
const path = require('path'); const fs = require('fs'); const os = require('os');
const { Store } = require('../src/core/store');
const { channelSources, runAll } = require('../src/core/monitor');
const { makeFetchText, HttpCache } = require('../src/core/http');
const { PROTOCOLS } = require('../src/core/collectors');
let electron = null; try { electron = require('electron'); if (typeof electron !== 'object' || !electron.app) electron = null; } catch { electron = null; }
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-live-'));
  const store = new Store(dir);
  const brands = store.config.brands.filter((b) => b.category === 'ai').map((b) => ({ ...b, enabled: true, channels: (b.channels || []).map((c) => ({ ...c, enabled: true })) }));
  const srcs = channelSources(brands, {}).map((s) => ({ ...s, enabled: true }));
  let renderText = null;
  if (electron) { const { renderHTML } = require('../src/render'); renderText = (u, o) => renderHTML(u, o); }
  const fetchText = makeFetchText((u, init) => globalThis.fetch(u, init), { cache: new HttpCache() });
  const t0 = Date.now();
  const res = await runAll(srcs, brands, { fetchText, renderText, concurrency: 6, hostGap: 1500, force: true });
  const by = {}; const rows = [];
  for (const { source: s, status: st } of res) {
    const t = s.type || 'rss'; const k = by[t] ||= { ok: 0, flaky: 0, fail: 0, fails: [] };
    const state = !st.ok ? 'fail' : s.flaky ? 'flaky' : 'ok'; k[state]++;
    if (!st.ok) k.fails.push(`${s.id}: ${String(st.error).slice(0, 90)}`);
    rows.push({ id: s.id, type: t, flaky: !!s.flaky, ok: st.ok, total: st.total, ms: st.ms, error: st.error || '', note: st.note || '' });
  }
  const tot = { ok: 0, flaky: 0, fail: 0 };
  console.log(`协议          正常  不稳定(可用)  失败`);
  for (const [t, k] of Object.entries(by).sort()) { console.log(`${(PROTOCOLS[t] ? t : t).padEnd(12)} ${String(k.ok).padStart(5)} ${String(k.flaky).padStart(8)} ${String(k.fail).padStart(8)}`); tot.ok += k.ok; tot.flaky += k.flaky; tot.fail += k.fail; }
  console.log(`合计 ${res.length} 个渠道：正常 ${tot.ok}，不稳定但本次可用 ${tot.flaky}，失败 ${tot.fail}，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const [t, k] of Object.entries(by)) for (const f of k.fails) console.log(`FAIL [${t}] ${f}`);
  fs.writeFileSync(path.join(__dirname, '../test/live-channels.json'), JSON.stringify(rows, null, 1));
}
if (electron) { electron.app.whenReady().then(main).then(() => electron.app.exit(0), (e) => { console.error(e); electron.app.exit(1); }); electron.app.on('window-all-closed', () => {}); }
else main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
