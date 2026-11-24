'use strict';
const {test} = require('node:test');const A=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/core/store'); const V=require('../src/core/v212');const B=require('../src/core/backup');
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dr217-'));const s=new Store(dir);return {s,dir,close:()=>fs.rmSync(dir,{recursive:true,force:true})};}
test('v217 restore roundtrip retains trials, local credentials and merges prices',()=>{const {s,dir,close}=fixture();try{
 s.config.settings.channels=[{id:'local',url:'https://secret.example/hook'}];s.config.settings.ai={keyEnc:'local-encrypted'};
 s.prices={local:{plans:{}}}; s.deals=[{id:'x',title:'Offer',link:'https://example.com/',brandIds:['openai'],fav:true,trialEnd:1234,trialDone:true,trialNotified:['soon']}];
 const backup=V.exportBackup({config:s.config,deals:s.deals,prices:{imported:{plans:{}}}});
 A.ok(!JSON.stringify(backup).includes('secret.example'));A.ok(!JSON.stringify(backup).includes('local-encrypted'));
 s.deals=[];s.restoreBackup(backup);const re=new Store(dir);
 A.equal(re.deals[0].trialEnd,1234);A.equal(re.deals[0].trialDone,true);A.equal(re.config.settings.channels[0].id,'local');A.equal(re.config.settings.ai.keyEnc,'local-encrypted');A.ok(re.prices.local&&re.prices.imported);
}finally{close();}});
test('v217 malformed or prototype backup fails before mutation',()=>{const {s,dir,close}=fixture();try{const before=fs.readFileSync(path.join(dir,'config.json'),'utf8');
 for(const b of [{app:'DealRadar',format:3,brands:[],deals:[{id:'bad'}]},JSON.parse('{"app":"DealRadar","format":3,"brands":[],"settings":{"__proto__":{"polluted":true}}}')])A.throws(()=>s.restoreBackup(b));
 A.equal(fs.readFileSync(path.join(dir,'config.json'),'utf8'),before); A.equal({}.polluted,undefined);
}finally{close();}});
test('v217 staged restore rolls back all files after rename failure',()=>{const {s,dir,close}=fixture();try{
 fs.writeFileSync(path.join(dir,'deals.json'),'[]');const config=fs.readFileSync(path.join(dir,'config.json'),'utf8');let n=0;
 A.throws(()=>B.commitFiles(dir,{'config.json':{replacement:true},'deals.json':[{id:'x'}]}, {rename:(...args)=>{if(++n===4)throw new Error('disk failure');fs.renameSync(...args);}}),/disk failure/);
 A.equal(fs.readFileSync(path.join(dir,'config.json'),'utf8'),config);A.equal(fs.readFileSync(path.join(dir,'deals.json'),'utf8'),'[]');
}finally{close();}});
test('v217 nested secret export cannot leak beyond recursion depth',()=>{let x={Authorization:'private',access_token:'private',ok:1};for(let i=0;i<20;i++)x={nested:x};A.ok(!JSON.stringify(V.stripSecrets(x)).includes('private'));});

test('v217 config export removes generic source URL credentials and mixed-case keys',()=>{ const out=V.stripSecrets({URL:'https://user:pass@example.com/',url:'https://example.com/?api_key=private',Token:'private',safe:'ok'}); A.ok(!JSON.stringify(out).includes('private')); A.ok(!JSON.stringify(out).includes('pass')); });
