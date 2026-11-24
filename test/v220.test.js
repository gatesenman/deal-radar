'use strict';
const {test}=require('node:test'); const A=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {DeliveryLedger,deliveryKey}=require('../src/core/delivery-ledger');
function fx(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dr220-'));try{return fn(path.join(dir,'delivery.json'));}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('v220 reservations persist before send and survive process restart',()=>fx(file=>{
 const key=deliveryKey('channel','new','offer');let l=new DeliveryLedger(file);A.equal(l.claim([key]),true);
 l=new DeliveryLedger(file);A.equal(l.blocked(key),true);A.equal(l.claim([key]),false);l.settle([key],true);A.equal(l.entries[key].state,'delivered');
}));
test('v220 unknown acknowledgement does not cause duplicate POST',()=>fx(file=>{
 const key=deliveryKey('c','new','d');let n=0;const l=new DeliveryLedger(file);if(l.claim([key])){n++;l.settle([key],false);}
 const restart=new DeliveryLedger(file);if(restart.claim([key]))n++;
 A.equal(n,1);A.equal(restart.entries[key].state,'unknown');
}));
test('v220 channel, digest day/week and trial scope are independent',()=>{
 const keys=[deliveryKey('c','digest','x','daily:2026-11-24'),deliveryKey('c','digest','x','weekly:2026-W48'),deliveryKey('c2','digest','x','daily:2026-11-24'),deliveryKey('c','digest','x','daily:2026-11-25')];A.equal(new Set(keys).size,4);
});
test('v220 overlapping views only claim unsent offers',()=>fx(file=>{
 const l=new DeliveryLedger(file);const ids=['a','b','c'].map(id=>deliveryKey('c','new',id));l.claim(ids.slice(0,2));A.deepEqual(ids.filter(k=>!l.blocked(k)),[ids[2]]);
}));
test('v220 corrupt ledger fails closed rather than resending everything',()=>fx(file=>{fs.writeFileSync(file,'corrupt');A.throws(()=>new DeliveryLedger(file),/refusing to resend/);}));
