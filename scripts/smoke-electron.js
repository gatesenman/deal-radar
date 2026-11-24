#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'); const output=process.env.SMOKE_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'dealradar-smoke-'));
const app=process.env.SMOKE_APP||path.join(root,'node_modules/electron/dist/electron');
for(const lang of ['zh-CN','en']){
 const data=path.join(output,lang);fs.mkdirSync(data,{recursive:true});
 fs.writeFileSync(path.join(data,'config.json'),JSON.stringify({version:5,brands:[],sources:[],settings:{lang,onboarded:true,notify:false,channels:[],filterMine:false,intervalMinutes:30},sourceStatus:{}}));
 fs.writeFileSync(path.join(data,'deals.json'),JSON.stringify([{id:'upgrade-fixture',title:'OpenAI free trial',link:'https://openai.com/',brandIds:['openai'],category:'ai',offerTypes:['free'],fav:true,status:'claimed',published:Date.now(),fetchedAt:Date.now(),facts:{trust:{level:3}}}]));
 const args=process.env.SMOKE_APP?['--no-sandbox']:[root,'--no-sandbox'];
 const r=spawnSync('xvfb-run',['-a',app,...args],{cwd:root,env:{...process.env,DEAL_RADAR_DATA:data,DEAL_RADAR_SHOT:path.join(data,'shots'),DEAL_RADAR_SHOT_SET:'smoke'},encoding:'utf8',timeout:60000});
 fs.writeFileSync(path.join(data,'process.log'),(r.stdout||'')+(r.stderr||''));
 console.log(lang, r.stdout||'', r.error?r.error.message:'');
 if(r.status!==0){console.error(r.stderr);process.exit(1);}
 const saved=JSON.parse(fs.readFileSync(path.join(data,'config.json'),'utf8'));
 if(saved.settings.listFilters.type!=='free')throw new Error('Filter not on disk');
 const deals=JSON.parse(fs.readFileSync(path.join(data,'deals.json'),'utf8'));if(!deals.some(d=>d.fav&&d.status==='claimed'))throw new Error('Upgrade data lost');
}
console.log('Smoke output:',output);
