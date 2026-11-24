'use strict';
// Electron fetch rejects manual redirects without exposing the 3xx response.
// Surface the ClientRequest redirect event as a Response; makeFetchText validates each hop.
function electronTransport(url, init = {}, { net, session, maxBytes = 8 * 1024 * 1024 } = {}) {
  if(init.method && init.method !== 'GET')return Promise.reject(new Error('Public source transport permits GET only'));
  net = net || require('electron').net;
  return new Promise((resolve, reject) => {
    let settled=false;let request;
    const finish=(err,value)=>{if(settled)return;settled=true;init.signal?.removeEventListener('abort',abort);err?reject(err):resolve(value);};
    const abort=()=>{finish(Object.assign(new Error('Request aborted'),{name:'AbortError'}));request?.abort();};
    const headers=(raw)=>{const h=new Headers();for(const [k,vs]of Object.entries(raw||{}))for(const v of Array.isArray(vs)?vs:[vs])h.append(k,String(v));return h;};
    try {
      request=net.request({url,method:init.method||'GET',redirect:'manual',session,credentials:'omit',useSessionCookies:false,headers:init.headers||{}});
      request.on('login',(_,cb)=>cb()); // Never prompt for or reuse site credentials.
      request.on('redirect',(status,method,next,raw)=>{const h=headers(raw);h.set('location',next);const r=new Response(null,{status,headers:h});Object.defineProperty(r,'url',{value:url});finish(null,r);request.abort();});
      request.on('response',(res)=>{const chunks=[];let bytes=0;
        res.on('data',(chunk)=>{bytes+=chunk.length;if(bytes>maxBytes){finish(new Error('Source response exceeds '+maxBytes+' bytes'));request.abort();}else chunks.push(chunk);});
        res.on('error',e=>finish(e));
        res.on('end',()=>{if(settled)return;const h=headers(res.headers);const buf=Buffer.concat(chunks);const r=new Response([204,205,304].includes(res.statusCode)?null:buf,{status:res.statusCode,headers:h});Object.defineProperty(r,'url',{value:url});
          const charset=(h.get('content-type')||'').match(/charset=["']?([^;\s"']+)/i)?.[1] || (buf.subarray(0,200).toString().match(/encoding=["']([^"']+)/i)||[])[1] || 'utf-8';
          r.text=async()=>{try{return new TextDecoder(charset).decode(buf);}catch{return buf.toString('utf8');}};finish(null,r);});
      });
      request.on('error',e=>finish(e));
      if(init.signal?.aborted){abort();return;}
      init.signal?.addEventListener('abort',abort,{once:true});
      request.end(init.body);
    }catch(e){finish(e);}
  });
}
module.exports={electronTransport};
