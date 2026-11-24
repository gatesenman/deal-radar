'use strict';
function safeURL(s){try{const u=new URL(s);for(const k of [...u.searchParams.keys()])if(/token|secret|key|state|code|auth|signature|nonce|session|credential|password|client_id|scope|redirect_uri|return_url/i.test(k))u.searchParams.set(k,'REDACTED');u.username='';u.password='';return u.href;}catch{return s;}}
function sanitize(value,key=''){if(Array.isArray(value))return value.map(v=>sanitize(v,key));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitize(v,k)]));if(typeof value==='string'&&/^(url|finalURL|location|discoveredURL|feedURL)$/i.test(key))return safeURL(value);return value;}
module.exports={sanitize,safeURL};
