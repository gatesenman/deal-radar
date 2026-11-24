'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const C=require('../src/core/collectors');const M=require('../src/core/monitor');const {Store}=require('../src/core/store');const {capability}=require('../src/core/source-capabilities');const {parseFeed,parseOrDiscoverFeed}=require('../src/core/feed');const {mergePreset}=require('../src/core/preset-merge');
test('v222: immutable inventory keeps every original built-in mapped to a supported adapter',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dr-inventory-'));try{const cfg=new Store(dir).config;const now=[...cfg.sources,...M.channelSources(cfg.brands,{})];const original=require('../source-audit/original-v2.21.1.json').sources;assert.equal(original.length,367);assert.deepEqual(now.map(s=>s.id).sort(),original.map(s=>s.id).sort());for(const s of now){assert.ok(C.PROTOCOLS[s.type||'rss'],s.id);assert.ok(['ready','js-required','config-required'].includes(capability(s,{}).state),s.id);}}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('v222: all registry protocols expose actionable requirements; RSSHub never defaults to a public service',()=>{
 for(const type of Object.keys(C.PROTOCOLS)){const c=capability({type},{});assert.equal(c.type,type);assert.ok(c.hint);assert.ok(c.missing.length>0 || type==='producthunt',type+' needs config or a public default');}
 assert.ok(capability({type:'rsshub',opts:{route:'/twitter/user/OpenAI'}},{}).missing.includes('rsshubBase'));
 assert.equal(capability({type:'rsshub',opts:{route:'/twitter/user/OpenAI'}},{rsshubBase:'https://rss.example.org'}).state,'ready');
 assert.equal(capability({type:'unknown'},{}).state,'unsupported');
});
test('v222: preset update preserves URL, headers, credentials, options and enabled preferences',()=>{
 const baseline=require('../src/core/preset-baseline-v221.json');const def=baseline.sources[0];const old={...def,url:'https://custom.example.org/feed',headers:{Authorization:'Bearer TEST_ONLY_NOT_A_SECRET'},enabled:false,userOff:true};const newDef={...def,url:'https://official.example.org/repaired-feed'};const merged=mergePreset(old,newDef);
 assert.equal(merged.url,old.url);assert.deepEqual(merged.headers,old.headers);assert.equal(merged.enabled,false);assert.equal(merged.userOff,true);assert.equal(merged._presetDefaults.headers,undefined);
 assert.equal(mergePreset({...def,enabled:true},newDef).url,newDef.url);
 const raw=baseline.channels.openai[0];const custom={...raw,opts:{...raw.opts,custom:'keep'},enabled:false};assert.deepEqual(mergePreset(custom,{...raw,opts:{region:'new'}},{brandId:'openai'}).opts,custom.opts);
 const again=mergePreset(merged,{...newDef,url:'https://official.example.org/next'});assert.equal(again.url,old.url);
});
test('v222: feed normalization resolves xml:base/relative image safely, rejects malformed empty records',()=>{
 const xml='<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://official.example.org/news/"><title>Official</title><entry><title>Update</title><link href="../update"/><content>&lt;img src="/logo.png"&gt;</content></entry></feed>';
 const f=parseFeed(xml,{baseURL:'https://official.example.org/feed'});assert.equal(f.items[0].link,'https://official.example.org/update');assert.equal(f.items[0].image,'https://official.example.org/logo.png');
 assert.equal(parseFeed('<rss><channel><title>Empty</title></channel></rss>').validEmpty,true);
 assert.throws(()=>parseFeed('<rss><channel><item><title>Broken link</title></item></channel></rss>',{baseURL:'https://official.example.org/rss'}),/no usable/);
 assert.equal(C.parseHtmlList('<a class="item">Missing href</a>',{opts:{list:'.item'}},'https://official.example.org/').length,0);
 assert.equal(C.parseHtmlList('<a class="item" href="javascript:alert(1)">Unsafe href</a>',{opts:{list:'.item'}},'https://official.example.org/').length,0);
});
test('v222: feed autodiscovery uses same official origin and refuses challenges before fetching',async()=>{
 let calls=[];const get=async u=>{calls.push(u);return '<rss><channel><title>News</title><item><title>Update</title><link>/post</link></item></channel></rss>';};
 const f=await parseOrDiscoverFeed('<html><head><link rel="alternate" type="application/rss+xml" href="/news/feed.xml"></head></html>','https://official.example.org/blog',get);
 assert.deepEqual(calls,['https://official.example.org/news/feed.xml']);assert.equal(f.items[0].link,'https://official.example.org/post');assert.equal(f.discoveredURL,calls[0]);
 await assert.rejects(parseOrDiscoverFeed('<html><title>Just a moment...</title></html>','https://official.example.org/',get),/SOURCE_BLOCKED/);assert.equal(calls.length,1);
 await assert.rejects(parseOrDiscoverFeed('<html><link rel="alternate" type="application/rss+xml" href="https://unrelated.example.net/feed"></html>','https://official.example.org/',get));assert.equal(calls.length,1);
});
test('v222: valid empty API and filtered news are healthy, empty HTML or challenge never are',async()=>{
 const b={id:'openai',name:'OpenAI',aliases:[],category:'ai'};const base={id:'x',type:'discourse',kind:'vendor',url:'https://official.example.org/latest.json',vendor:'openai',category:'ai'};
 const r=await M.fetchSource(base,[b],{fetchText:async()=>'{"topic_list":{"topics":[]}}'});assert.equal(r.status.ok,true);assert.equal(r.status.validEmpty,true);assert.equal(r.status.outcome,'valid-empty');
 const challenged=await M.fetchSource(base,[b],{fetchText:async()=>'<html><title>Vercel Security Checkpoint</title></html>'});assert.equal(challenged.status.ok,false);assert.match(challenged.status.error,/SOURCE_BLOCKED/);
 const f=await M.fetchSource({...base,type:'rss',include:'impossible'},[b],{fetchText:async()=>'<rss><channel><title>Official</title><item><title>Unrelated official update</title><link>/post</link></item></channel></rss>'});assert.equal(f.status.ok,true);assert.equal(f.status.total,1);assert.equal(f.status.matched,0);
});
test('v222: branch and tag encoding, category JSON links resolve at origin',()=>{
 assert.match(C.requestUrl({type:'github',opts:{repo:'openai/openai-python',what:'commits',branch:'feature/a b'}}),/feature%2Fa%20b/);
 const d=C.parseDiscourse('{"topic_list":{"topics":[{"id":7,"title":"News","slug":"a b"}]}}','https://forum.example.org/c/api/5.json');assert.equal(d[0].link,'https://forum.example.org/t/a%20b/7');
});
test('v222: every protocol traverses the actual fetch/parse/normalization pipeline with explicit mock responses',async()=>{
 const rss='<rss><channel><title>Official</title><item><title>Public release</title><link>https://official.example.org/release</link><pubDate>Tue, 24 Nov 2026 02:00:00 GMT</pubDate></item></channel></rss>';
 const page='<html><main><h1>Official Pricing</h1><h2>Pro</h2><p>$20 per month</p></main></html>';
 const configs={
 rss:{body:rss},jsonfeed:{body:JSON.stringify({version:'https://jsonfeed.org/version/1.1',items:[{id:'1',title:'Release',url:'/release'}]})},
 json:{opts:{itemsPath:'data',titleField:'name',linkField:'href'},body:'{"data":[{"name":"Release","href":"/release"}]}'},
 html:{opts:{list:'.entry',title:'h2',link:'a'},body:'<div class="entry"><h2>Release</h2><a href="/release">Details</a></div>'},
 page:{body:page},render:{body:page},sitemap:{body:'<urlset><url><loc>https://official.example.org/release</loc></url></urlset>'},
 github:{opts:{repo:'openai/openai-python'},body:rss},hn:{opts:{query:'OpenAI'},body:'{"hits":[{"objectID":"1","title":"Public release","created_at_i":1795485600}]}'},
 reddit:{opts:{sub:'OpenAI'},body:rss},discourse:{body:'{"topic_list":{"topics":[{"id":1,"title":"Public release","slug":"release"}]}}'},
 telegram:{opts:{channel:'public_example'},body:'<div class="tgme_widget_message" data-post="public_example/1"><div class="tgme_widget_message_text">Public release</div><time datetime="2026-11-24T02:00:00Z"></time></div>'},
 mastodon:{opts:{tag:'release'},body:'[{"id":"1","uri":"https://social.example.org/1","url":"https://social.example.org/1","content":"Public release"}]'},
 bluesky:{opts:{handle:'example.org'},body:'{"feed":[{"post":{"uri":"at://did:plc:example/app.bsky.feed.post/1","author":{"handle":"example.org"},"record":{"text":"Public release","createdAt":"2026-11-24T02:00:00Z"}}}]}'},
 youtube:{opts:{channelId:'EXAMPLE'},body:rss},producthunt:{body:rss},
 appstore:{opts:{appId:'1'},body:'{"results":[{"trackId":1,"trackName":"Public App","trackViewUrl":"https://apps.apple.com/app/id1","version":"1.0","formattedPrice":"Free"}]}'},
 gplay:{opts:{pkg:'org.example.app'},body:'<h1><span>Public App</span></h1><div>Updated on</div><div>Nov 24, 2026</div>'},
 rsshub:{opts:{route:'/example/public'},body:rss},search:{keyword:'OpenAI',body:rss}
 };
 assert.deepEqual(Object.keys(configs).sort(),Object.keys(C.PROTOCOLS).sort());
 for(const [type,c]of Object.entries(configs)){const source={id:'fixture-'+type,type,kind:C.STATEFUL.has(type)?'page':'vendor',vendor:'openai',category:'ai',url:'https://official.example.org/feed',...c};delete source.body;
 const r=await M.fetchSource(source,[{id:'openai',name:'OpenAI',aliases:[],category:'ai'}],{ctx:{rsshubBase:'https://rss.example.org'},fetchText:async()=>c.body,renderText:async()=>c.body});assert.equal(r.status.ok,true,type+': '+r.status.error);assert.ok(r.status.total>0,type);}
});
test('v222: actual public feed regression fragments retain meaningful normalized items',()=>{
 const dir=path.join(__dirname,'../source-audit/fixtures');const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json'));assert.ok(files.length>30);
 for(const file of files){const f=JSON.parse(fs.readFileSync(path.join(dir,file)));if(f.format!=='rss')continue;const parsed=parseFeed(f.body,{baseURL:f.url});assert.ok(parsed.items.length>0,f.id);assert.match(parsed.items[0].link,/^https?:\/\//,f.id);assert.ok(parsed.items[0].title,f.id);}
});
test('v222: authentication redirects are stopped before a login request, metadata is sanitized',async()=>{
 let calls=0;const {makeFetchText}=require('../src/core/http');const f=makeFetchText(async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://accounts.google.com/o/oauth2/v2/auth?state=MOCK_STATE'}});},{validateUrl:async()=>{}});
 await assert.rejects(f('https://official.example.org/feed'),/login-required/);assert.equal(calls,1);
 const {safeURL}=require('../scripts/lib/audit-sanitize');assert.equal(new URL(safeURL('https://example.org/?state=MOCK_STATE&q=public')).searchParams.get('state'),'REDACTED');
 assert.match(C.parseAppStore('{"results":[{"trackId":1,"trackName":"App","version":"1","trackViewUrl":"https://apps.apple.com/app/id1"}]}')[0].summary,/价格未知/);
 assert.throws(()=>C.parseGplay('<h1>App</h1><div>Updated on</div><div>not a date</div>',{opts:{pkg:'org.example.app'}},'https://play.google.com/'),/未能识别/);
});
test('v222: nested sitemap traversal resolves encoded URLs and reports sampling and child failures',async()=>{
 const f=async u=>u.endsWith('/root.xml')?'<sitemapindex><sitemap><loc>child.xml</loc></sitemap><sitemap><loc>missing.xml</loc></sitemap></sitemapindex>':u.endsWith('/missing.xml')?Promise.reject(new Error('HTTP 503')):'<urlset><url><loc><![CDATA[https://official.example.org/news?a=1&amp;b=2]]></loc></url></urlset>';
 const urls=await C.sitemapUrls({url:'https://official.example.org/root.xml'},f);assert.equal(urls[0],'https://official.example.org/news?a=1&b=2');assert.deepEqual(urls.warnings,['HTTP 503']);assert.equal(urls.stats.fetchedMaps,3);
});
test('v222: real per-invocation public table prices retain tiny amounts and explicit units',()=>{
 const {tableUnitPrices}=require('../src/core/pricing-quotes');const fixture=require('../source-audit/fixtures/perplexity-pricing-table.json');const quotes=tableUnitPrices(fixture.body);assert.equal(quotes[0].amount,0.0025);assert.equal(quotes[0].currency,'USD');assert.equal(quotes[0].period,'invocation');
 assert.deepEqual(tableUnitPrices('<table><tr><td>Search</td><td>$10 credits</td></tr></table>'),[]);
 const vm=require('node:vm'),src=fs.readFileSync(path.join(__dirname,'../src/renderer/app.js'),'utf8');const func=src.match(/function money\(v, cur\) \{[^\n]+/)[0];const format=vm.runInNewContext('('+func+')',{CURSYM:{USD:'$'},LOC:'en-US'});assert.equal(format(0.0025,'USD'),'$0.0025');
});
test('v222: public student/activity content is not rejected for lacking a monthly price',async()=>{
 const source={id:'student',kind:'page',type:'page',sub:'pricing',name:'Student official offer',url:'https://official.example.org/students'};
 const r=await M.fetchSource(source,[],{fetchText:async()=>'<main><h1>Students</h1><p>Get started for free today.</p><p>See official eligibility details.</p></main>'});assert.equal(r.status.ok,true);
 const api=await M.fetchSource({...source,url:'https://official.example.org/pricing',name:'API pricing'},[],{fetchText:async()=>'<main><h1>Tool pricing</h1><table><tr><td>web_search</td><td>$0.0025 per invocation</td></tr></table></main>'});assert.equal(api.status.ok,true);
});
test('v222: public rendering is GET-only and cannot submit automatic site POSTs',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/render.js'),'utf8');assert.match(source,/if\(details\.method !== 'GET'\)\{cb\(\{cancel:true\}\);return;\}/);
});
test('v222: preset protocol selections are preserved, unchanged Adobe defaults move to rendering',()=>{
 const b=require('../src/core/preset-baseline-v221.json').channels.adobe.find(c=>c.id==='firefly');
 assert.equal(mergePreset({...b,enabled:true},{...b,type:'render'},{brandId:'adobe'}).type,'render');
 assert.equal(mergePreset({...b,type:'html',enabled:false},{...b,type:'render'},{brandId:'adobe'}).type,'html');
 const oldSnapshot={url:b.url,name:b.name};assert.equal(mergePreset({...b,_presetDefaults:oldSnapshot,enabled:true},{...b,type:'render'},{brandId:'adobe'}).type,'render');
});
test('v222: actual Chinese yen-denominated plan fragments survive built-in keyword filtering',()=>{
 const rows=require('../source-audit/gap-inspection.json');const row=rows.find(r=>r.id==='ch-qwen-coding-plan');assert.ok(row.inlinePriceFragments.length);
 const html='<main>'+row.inlinePriceFragments.join('')+'</main>';const ch=require('../src/core/defaults').VENDOR_CHANNELS.qwen.find(c=>c.id==='coding-plan');const lines=require('../src/core/page').extractLines(html,{keyword:ch.keyword});assert.ok(lines.some(l=>/¥\s*200/.test(l)));assert.ok(require('../src/core/v29').priceFacts(lines).prices.size>0);
});
test('v222: official Kimi usage-billing text is valid parsed content, not an invented numeric rate',async()=>{
 const g=require('../source-audit/gap-inspection.json').find(r=>r.id==='ch-kimi-pricing');const line=g.text.find(x=>x.includes('按量计费'));assert.ok(line);
 const pages={};const r=await M.fetchSource({id:'kimi-billing',kind:'page',type:'page',sub:'pricing',name:'Kimi API 价格页',url:'https://platform.kimi.com/docs/pricing/chat'},[],{pages,fetchText:async()=>'<main><h1>模型推理定价</h1><p>'+line+'</p></main>'});assert.equal(r.status.ok,true);assert.equal(require('../src/core/v27').extractPrices(pages['kimi-billing'].lines).length,0);
});
test('v222: final sanitized audit contains one outcome for every original source, with exact totals',()=>{
 const audit=require('../source-audit/results.json');const original=require('../source-audit/original-v2.21.1.json');assert.equal(audit.completed,367);assert.equal(audit.total,367);assert.equal(Object.values(audit.counts).reduce((a,n)=>a+n,0),367);assert.equal(audit.liveAttemptSourceCount+audit.suppressedSourceCount,367);assert.deepEqual(audit.sources.map(s=>s.id).sort(),original.sources.map(s=>s.id).sort());
 for(const r of audit.sources){assert.ok(r.checkedAt.endsWith('+08:00'));assert.ok(C.PROTOCOLS[r.protocol]);assert.ok(r.reason);assert.ok(r.checkedCodeSHA256);if(r.status==='parsed')assert.ok(r.parsedCount>0,r.id);if(!r.liveAttempted)assert.ok(r.suppressedBy,r.id);}
 assert.equal(require('../source-audit/protocols.json').count,Object.keys(C.PROTOCOLS).length);
});
