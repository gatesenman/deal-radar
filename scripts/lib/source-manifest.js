
'use strict';
const V215=require('../../src/core/v215');
// Keep README product screenshots, not historical UI/E2E runs.
function sourcePolicy(readme=''){
 const documented=new Set([...readme.matchAll(/!\[[^\]]*\]\((screenshots\/[^)\s]+)\)/g)].map(m=>m[1]));
 return rel=>{const f=String(rel).replace(/\\/g,'/');return V215.shouldPack(f)&&(!f.startsWith('screenshots/')||documented.has(f))&&!/(?:^|\/)(?:e2e-shots|playwright-report|test-results)(?:\/|$)/.test(f)&&!(/\.(?:exe|msi|blockmap|dmg|AppImage|deb|rpm|7z|tgz|zip)$/i.test(f));};
}
module.exports={sourcePolicy};
