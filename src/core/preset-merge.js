'use strict';
const legacy=require('./preset-baseline-v221.json');
const FIELDS=['url','opts','headers','ua','proxy','timeout','selector','keyword','include','exclude','regex','render','interval','maxItems','name'];
const eq=(a,b)=>JSON.stringify(a??'')===JSON.stringify(b??'');
function snapshot(def){return Object.fromEntries(FIELDS.filter(k=>k in def).map(k=>[k,structuredClone(def[k])]));}
function mergePreset(current,def,{brandId}={}){
 const prior=current._presetDefaults || (brandId ? (legacy.channels[brandId]||[]).find(c=>c.id===current.id) : legacy.sources.find(s=>s.id===current.id)) || {};
 const overrides=Object.fromEntries(FIELDS.filter(k=>k in current && !eq(current[k],prior[k]) && !eq(current[k],def[k])).map(k=>[k,current[k]]));
 // Credentials and explicitly customised fields never get replaced by built-in updates.
 const keep={enabled:current.enabled,userOff:current.userOff};
 return {...current,...structuredClone(def),...overrides,...keep,_presetDefaults:snapshot(def),presetOverrides:Object.keys(overrides)};
}
module.exports={mergePreset,snapshot,FIELDS};
