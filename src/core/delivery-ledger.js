'use strict';
const fs=require('node:fs'); const crypto=require('node:crypto');
const TTL=30*864e5;
function deliveryKey(channel,kind,id,scope='') { return crypto.createHash('sha256').update(JSON.stringify([channel,kind,id,scope])).digest('hex'); }
class DeliveryLedger {
  constructor(file, {now=()=>Date.now()}={}) {
    this.file=file;this.now=now;this.entries={};
    try { const j=JSON.parse(fs.readFileSync(file,'utf8')); if(!j||j.v!==1||!j.entries||typeof j.entries!=='object'||Array.isArray(j.entries)||Object.keys(j.entries).length>20000)throw new Error('Invalid delivery ledger'); for(const [k,e] of Object.entries(j.entries)) if(!/^[a-f0-9]{64}$/.test(k)||!e||typeof e!=='object'||!Number.isFinite(e.at)||e.at<0||e.at>this.now()+300000||!['pending','delivered','unknown'].includes(e.state))throw new Error('Invalid delivery record');this.entries=j.entries; }
    catch(e) { if(e.code!=='ENOENT') throw new Error('Delivery ledger unreadable; refusing to resend'); }
  }
  blocked(key) {const e=this.entries[key];return !!e&&this.now()-e.at<TTL;}
  save() {
    const kept=Object.entries(this.entries).filter(([,e])=>this.now()-e.at<TTL).sort((a,b)=>b[1].at-a[1].at);
    // Never silently evict recent reservations: fail closed instead.
    if(kept.length>20000)throw new Error('Delivery ledger capacity reached');
    this.entries=Object.fromEntries(kept); const tmp=this.file+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify({v:1,entries:this.entries}),{mode:0o600});fs.renameSync(tmp,this.file);
  }
  claim(keys) {
    if(keys.some(k=>this.blocked(k)))return false;
    const old={...this.entries};for(const k of keys)this.entries[k]={at:this.now(),state:'pending'};
    try{this.save();return true;}catch(e){this.entries=old;throw e;}
  }
  settle(keys,ok) {for(const k of keys)if(this.entries[k])this.entries[k].state=ok?'delivered':'unknown';this.save();}
}
module.exports={DeliveryLedger,deliveryKey,TTL};
