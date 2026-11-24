'use strict';
const {PROTOCOLS}=require('./collectors');
const REQUIRED={rss:['url'],jsonfeed:['url'],json:['url'],html:['url','list'],page:['url'],render:['url'],sitemap:['url'],github:['repo'],hn:[],reddit:['sub'],discourse:['url'],telegram:['channel'],bluesky:['handle'],youtube:[],appstore:['appId'],gplay:['pkg'],rsshub:['route','rsshubBase']};
function capability(source,ctx={}){
 const type=source.type||'rss';const o=source.opts||{};const values={...source,...o,rsshubBase:ctx.rsshubBase};
 if(!PROTOCOLS[type])return {state:'unsupported',type,missing:[],hint:'Unsupported adapter'};
 const missing=(REQUIRED[type]||[]).filter(k=>!values[k]);
 if(type==='hn'&&!o.query&&!source.keyword)missing.push('query or keyword');
 if(type==='youtube'&&!o.channelId&&!source.url)missing.push('channelId or feed URL');
 if(type==='mastodon'&&!o.acct&&!o.tag)missing.push('acct or tag');
 if(type==='search'&&!source.keyword&&!source.url)missing.push('keyword');
 if(missing.length)return {state:'config-required',type,missing,hint:'Required: '+missing.join(', ')};
 return {state:type==='render'||source.render?'js-required':'ready',type,missing:[],hint:type==='rsshub'?'Use an explicitly configured public self-hosted RSSHub. No default instance.':type==='render'?'Desktop rendering required; challenges are not bypassed.':'Public GET adapter'};
}
module.exports={capability,REQUIRED};
