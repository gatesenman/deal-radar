'use strict';
const {test}=require('node:test');const A=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('v221 accessible modal/search, reduced motion and focus hooks remain installed',()=>{
 A.match(read('src/renderer/index.html'),/role="dialog" aria-modal="true"/);A.match(read('src/renderer/index.html'),/id="q" aria-label=/);
 A.match(read('src/renderer/app.js'),/modalReturnFocus/);A.match(read('src/renderer/app.js'),/e.shiftKey && i <= 0/);A.match(read('src/renderer/styles.css'),/prefers-reduced-motion/);
});
test('v221 source archive is tracked-only, scans contents and has a stable root',()=>{
 const script=read('scripts/pack-release.js');A.match(script,/ls-files/);A.match(script,/scanText/);A.match(script,/os.path.relpath\(p, root\)/);
});
test('v221 offline smoke uses isolated fixture data and no external push',()=>{
 const script=read('scripts/smoke-electron.js');A.match(script,/DEAL_RADAR_DATA:data/);A.match(script,/\['zh-CN','en'\]/);A.match(read('src/main.js'),/Network disabled in smoke/);
});
