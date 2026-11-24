'use strict';
const {app,net,session}=require('electron');const http=require('node:http');const assert=require('node:assert/strict');const {makeFetchText}=require('../src/core/http');const {electronTransport}=require('../src/core/electron-transport');
app.commandLine.appendSwitch('no-sandbox');app.whenReady().then(async()=>{let requests=0;
const server=http.createServer((q,r)=>{requests++;if(q.url==='/redirect'){r.writeHead(302,{Location:'/feed'});r.end();}else if(q.url==='/blocked'){r.writeHead(302,{Location:'http://127.0.0.2/private'});r.end();}else{r.writeHead(200,{'content-type':'application/rss+xml; charset=utf-8'});r.end('<rss><channel><title>中文 Redirect ✓</title></channel></rss>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
try{const checked=[];const f=makeFetchText((u,i)=>electronTransport(u,i,{net,session:session.defaultSession}),{validateUrl:u=>{checked.push(u);if(!u.startsWith(base+'/'))throw new Error('fixture policy rejected redirect');}});
assert.match(await f(base+'/redirect'),/中文 Redirect ✓/);assert.equal(requests,2);assert.deepEqual(checked,[base+'/redirect',base+'/feed']);console.log('PASS real Electron manual redirect + UTF-8 + each-hop validation');
await assert.rejects(electronTransport(base+'/feed',{method:'POST'},{net,session:session.defaultSession}),/GET only/);assert.equal(requests,2);console.log('PASS non-GET rejected before network request');
await assert.rejects(f(base+'/blocked'),/fixture policy rejected/);assert.equal(requests,3);console.log('PASS rejected redirect never requested');server.close();app.exit(0);}catch(e){console.error(e);server.close();app.exit(1);}
});
