'use strict';
const {parse}=require('node-html-parser');const {PRICE_RE,parseAmount}=require('./v27');
const SYMBOL={'$':'USD','US$':'USD','€':'EUR','£':'GBP','¥':'CNY','￥':'CNY','HK$':'HKD','NT$':'TWD','S$':'SGD','A$':'AUD','C$':'CAD','₹':'INR'};
// Public tables whose price cell explicitly states its billing unit. Never invent a monthly plan.
function tableUnitPrices(html,{max=24}={}){
 const out=[],seen=new Set();for(const tr of parse(html).querySelectorAll('tr')){
  const cells=tr.querySelectorAll('td');if(cells.length<2)continue;const label=cells[0].text.replace(/\s+/g,' ').trim();if(!label||label.length>100||PRICE_RE.test(label))continue;
  for(const cell of cells.slice(1)){const text=cell.text.replace(/\s+/g,' ').trim();const unit=text.match(/(?:per|\/)\s*(?:successful\s+)?(invocation|request)\b/i);const m=text.match(PRICE_RE);if(!unit||!m)continue;
   const amount=parseAmount(m[2]||m[4]||m[5]);const currency=(text.match(/\b(USD|EUR|GBP|CNY|JPY|CAD|AUD|SGD|HKD|TWD)\b/)||[])[1] || SYMBOL[m[1]] || m[3];const period=unit[1].toLowerCase();const key=label.toLowerCase()+'|'+period;
   if(!currency||!Number.isFinite(amount)||amount<0||seen.has(key))continue;seen.add(key);out.push({plan:label,amount,currency,period});break;
  }if(out.length>=max)break;
 }return out;
}
module.exports={tableUnitPrices};
