#!/usr/bin/env node
'use strict';
// Full inventory pass through the production fetchSource/HTTP/render/normalization pipeline.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {app,net,session}=require('electron');const {Store}=require('../src/core/store');const M=require('../src/core/monitor');
const C=require('../src/core/collectors');const {makeFetchText}=require('../src/core/http');const {assertPublicURL}=require('../src/core/network-policy');
const V27=require('../src/core/v27');const {extractFacts}=require('../src/core/facts');
const {renderHTML}=require('../src/render');
const {sanitize}=require('./lib/audit-sanitize');
const sourceStops=new Map();
const root=path.join(__dirname,'..');const dir=path.join(root,'source-audit');fs.mkdirSync(dir,{recursive:true});
app.on('window-all-closed',()=>{});
const data=fs.mkdtempSync(path.join(os.tmpdir(),'dr-live-audit-'));app.setPath('userData',data);app.commandLine.appendSwitch('no-sandbox');app.commandLine.appendSwitch('disable-gpu');
const localTime=()=>new Date(Date.now()+8*36e5).toISOString().replace('Z','+08:00');
const safeHeaders=h=>Object.fromEntries([...h.entries()].filter(([k])=>/^(content-type|location|retry-after|etag|last-modified)$/i.test(k)));
const schemaURL=(s)=>s.url||'';const limiter=new Map();const stops=new Map();let next=0;let completed=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function hostWait(url){const h=new URL(url).hostname;const old=limiter.get(h)||Promise.resolve();let unlock;const p=new Promise(r=>unlock=r);limiter.set(h,p);await old;await sleep(1100);return unlock;}
function classify(r,records,pg,prices){
 const err=r.status.error||'';const last=records[records.length-1]||{};const code=records.find(x=>[401,403,429].includes(x.status))?.status;
 if(code===401||/HTTP 401|login.required|sign.in.required/i.test(err))return ['login-required','Authentication required; not attempted'];
 if(code===429||/HTTP 429|Retry-After|rate.limit/i.test(err))return ['rate-limited',err||'Server rate limit; no early retry'];
 if(code===403||/SOURCE_BLOCKED|反爬|challenge|captcha|HTTP 403|host blocked/i.test(err))return ['blocked',err||'HTTP 403; stopped without bypass'];
 if(code===429||/Retry-After|rate.limit/i.test(err))return ['rate-limited',err||'Server rate limit; no early retry'];
 if(/missing|请填写|RSSHub|自建|未设置/i.test(err))return ['config-required',err];
 if(/coverage-mismatch/i.test(err))return ['coverage-mismatch',err];
 if(/No pricing evidence/i.test(err))return ['empty-parse',err];
 if(/JS 渲染|需要 JS|javascript required|enable javascript/i.test(err))return ['js-only',err];
 if(!r.status.ok)return [/HTTP 404|HTTP 410/.test(err)?'not-found':/HTTP [45]|ENOTFOUND|超时|ERR_|timeout|fetch failed|certificate|TLS/i.test(err)?'unreachable':'parse-error',err||'Adapter failed'];
 if(r.status.ok&&r.status.error)return ['partial',r.status.error];
 if(r.status.total>0)return ['parsed',prices.length?'Parsed content and structured pricing':pg?'Meaningful page/sitemap baseline; zero changes is expected':'Parsed public items; zero matching deals does not mean broken'];
 if(r.status.validEmpty)return ['valid-empty','Recognized feed/API schema with an explicitly empty collection'];
 return ['empty-parse','No parsed data; not counted healthy'];
}
async function audit(source,cfg,pages){
 const records=[];const fixture=[];const started=localTime();let lastBody='';let suppressed=null;const parsedSamples=[];
 const raw=async(url,init,o={})=>{
  const host=new URL(url).hostname;const stop=sourceStops.get(source.id)||stops.get(host);if(stop){suppressed=typeof stop==='string'?{reason:stop}:stop;throw new Error('host blocked: '+suppressed.reason);}
  const unlock=await hostWait(url);
  try{
   const res=await require('../src/core/electron-transport').electronTransport(url,init,{net,session:session.defaultSession,maxBytes:Math.min(32*1024*1024,Math.max(32768,Number(o.maxBytes)||8*1024*1024))});
   const entry={url,status:res.status,headers:safeHeaders(res.headers),finalURL:res.url||url,at:localTime()};records.push(entry);
   if([401,403,429].includes(res.status))stops.set(host,{reason:'HTTP '+res.status,sourceId:source.id,at:entry.at,evidence:entry});
   return res;
  }finally{unlock();}
 };
 const fetch=makeFetchText(raw,{validateUrl:u=>assertPublicURL(u,{lookup:require('node:dns').promises.lookup})});
 const ft=async(u,o={})=>{const text=await fetch(u,{...o,timeout:12000,cache:false});lastBody=text;const rec=records[records.length-1];if(rec){rec.bytes=Buffer.byteLength(text);rec.sha256=crypto.createHash('sha256').update(text).digest('hex');rec.preview=text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,180);}return text;};
 const render=async(u,o)=>{
  // A public GET first prevents opening an explicit HTTP block in the renderer.
  const pre=await ft(u);if(require('../src/core/page').isBlocked(pre))throw new Error('SOURCE_BLOCKED: challenge page');
  return renderHTML(u,{...o,timeout:18000,wait:1200,partition:'audit-'+source.id,observe:x=>{records.push({...x,render:true,at:localTime()});o.observe?.(x);}});
 };
 let brands=cfg.brands;
 if(source.kind==='search'&&!source.channel){brands=brands.filter(b=>b.id===(source.category==='goods'?'apple':'openai'));}
 let result;
 try{result=await M.fetchSource({...source,timeout:12},brands,{fetchText:ft,renderText:render,pages,retryDelay:0,searchGap:1100,ctx:{},onParsed:items=>{for(const it of items.slice(0,2))if(parsedSamples.length<2)parsedSamples.push({title:it.title,link:it.link,published:it.published,summary:(it.summary||'').slice(0,160)});}});}catch(e){result={items:[],status:{ok:false,total:0,error:e.message}};}
 const prices=source.sub==='pricing'&&pages[source.id]?V27.extractPrices(pages[source.id].lines):[];
 let status=classify(result,records,pages[source.id],prices);
 if(!records.length&&/host blocked/.test(result.status.error||''))status=[/401/.test(result.status.error)?'login-required':/429/.test(result.status.error)?'rate-limited':'blocked',result.status.error];
 if(status[0]==='blocked')for(const rec of records)stops.set(new URL(rec.url).hostname,{reason:'SOURCE_BLOCKED: '+status[1],sourceId:source.id,at:rec.at,evidence:rec});
 const cap=require('../src/core/source-capabilities').capability(source,{});
 // Preserve tiny real response fragments for offline adapter regressions, never whole pages.
 if(status[0]==='parsed'&&lastBody&&source.type!=='render'){
  const match=lastBody.match(/<(item|entry)\b[\s\S]*?<\/\1>/i);
  if(match&&match[0].length<18000){const kind=match[1].toLowerCase();const text=kind==='item'?'<rss version="2.0"><channel><title>Public audit fixture</title>'+match[0]+'</channel></rss>':'<feed xmlns="http://www.w3.org/2005/Atom">'+match[0]+'</feed>';fixture.push({id:source.id,url:source.url,at:started,format:'rss',body:text});}
 }
 const row={id:source.id,vendor:source.vendor||null,name:source.name,url:schemaURL(source),protocol:source.type||'rss',adapter:source.type||source.format||'rss',category:source.category,enabled:!!source.enabled,configuredEnabled:source.configuredEnabled??!!source.enabled,brandEnabled:source.brandEnabled??null,requires:cap.missing,capability:cap,liveAttempted:records.length>0,checkedAt:started,finishedAt:localTime(),status:status[0],reason:status[1],parsedCount:result.status.total||0,matchedCount:result.items.length,dealCount:result.items.filter(d=>(d.offerTypes||[]).length).length,priceCount:prices.length,sitemapStats:result.status.sitemapStats||null,suppressedBy:suppressed,parsedSamples,samples:result.items.slice(0,2).map(d=>({title:d.title,link:d.link,published:d.published,offerTypes:d.offerTypes,facts:extractFacts(d)})),prices:prices.slice(0,3),baseline:(pages[source.id]?.lines||[]).slice(0,3),http:records,requestScope:source.kind==='search'&&!source.channel?'One representative vendor (OpenAI or Apple), not every vendor/query combination':'Built-in source configuration'};
 if(fixture.length){fs.mkdirSync(path.join(dir,'fixtures'),{recursive:true});fs.writeFileSync(path.join(dir,'fixtures',source.id+'.json'),JSON.stringify(fixture[0],null,2));row.fixture='fixtures/'+source.id+'.json';}
 return sanitize(row);
}
app.whenReady().then(async()=>{
 const store=new Store(data),cfg=store.config;const sources=[...cfg.sources,...M.channelSources(cfg.brands,{})];
 const original=JSON.parse(fs.readFileSync(path.join(dir,'original-v2.21.1.json')));
 const brandsBy=new Map(cfg.brands.map(b=>[b.id,b]));for(const s of sources)s.brandEnabled=s.vendor?brandsBy.get(s.vendor)?.enabled:null;
 let rows=[];const out=process.env.AUDIT_OUTPUT||'results.json';
 if(process.env.AUDIT_RESUME&&fs.existsSync(path.join(dir,out)))rows=JSON.parse(fs.readFileSync(path.join(dir,out))).sources;
 if(process.env.AUDIT_PRIOR){const prior=JSON.parse(fs.readFileSync(path.join(dir,process.env.AUDIT_PRIOR)));for(const r of prior.sources){if(!['blocked','login-required','rate-limited'].includes(r.status))continue;const evidence=(r.http||[]).find(h=>[401,403,429].includes(h.status)) || (r.http||[]).at(-1);if(evidence)stops.set(new URL(evidence.url).hostname,{reason:r.reason,sourceId:r.id,at:r.checkedAt,evidence});}
  const gaps=JSON.parse(fs.readFileSync(path.join(dir,'gap-inspection.json')));for(const g of gaps)if(/unavailable in region/i.test(g.title||''))sourceStops.set(g.id,{reason:'SOURCE_BLOCKED: Regional restriction; no bypass',sourceId:g.id,at:prior.at,evidence:{url:g.url,status:200,title:g.title}});
 }
 const pending=sources.filter(s=>!rows.some(r=>r.id===s.id));const pages={};
 function save(){const counts=rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});fs.writeFileSync(path.join(dir,out),JSON.stringify(sanitize({version:require('../package.json').version,at:localTime(),transport:'Electron ClientRequest + production makeFetchText/fetchSource/renderHTML/extractPrices/extractFacts',concurrency:4,minHostGapMs:1100,originalCount:original.sources.length,total:sources.length,completed:rows.length,counts,sources:rows}),null,2));}
 save();
 await Promise.all(Array.from({length:4},async()=>{for(;;){const i=next++;if(i>=pending.length)break;const s=pending[i];const row=await audit(s,cfg,pages);rows.push(row);completed++;save();console.log('['+rows.length+'/'+sources.length+']',row.status,row.id,row.parsedCount,row.reason.slice(0,120));}}));
 save();fs.rmSync(data,{recursive:true,force:true});app.exit(0);
}).catch(e=>{console.error(e);app.exit(1);});
