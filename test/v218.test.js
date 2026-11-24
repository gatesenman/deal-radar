'use strict';
const {test}=require('node:test');const A=require('node:assert/strict');
const {parseDeadline}=require('../src/core/facts');const P=require('../src/core/v27');const V=require('../src/core/v26');
test('v218 invalid calendar and ambiguous numeric deadlines stay unknown',()=>{
 for(const text of ['until 2026-02-30','until Feb 29 2026','截止日期：2026年4月31日','until 03/04/2026']) A.equal(parseDeadline(text,Date.now()),0,text);
 A.ok(parseDeadline('until Feb 29 2028'));A.ok(parseDeadline('until 30/11/2026'));
});
test('v218 zoned deadline preserves its real instant',()=>{
 A.equal(parseDeadline('Offer ends 2026-11-30T23:30:00-08:00'),Date.parse('2026-12-01T07:30:00Z'));
 A.equal(parseDeadline('until 2026-02-30T10:00:00Z'),0);
});
test('v218 grouped prices, explicit regional currency, negative prices',()=>{
 A.equal(P.extractPrices(['Pro','$1,299.99 /month'])[0].amount,1299.99);
 A.equal(P.extractPrices(['Pro','€1.299,99 /month'])[0].amount,1299.99);
 A.equal(P.extractPrices(['Pro','JPY 3000 /month'])[0].currency,'JPY');
 A.equal(P.extractPrices(['Pro','¥3000 /month JPY'])[0].currency,'JPY');
 A.equal(P.extractPrices(['Pro','$30 /month'],{currencyHint:'CAD'})[0].currency,'CAD');
 A.equal(P.extractPrices(['Pro','-$20 /month']).length,0);
});
test('v218 currency switches start fresh history, not a fabricated cut',()=>{
 const book={};P.updatePriceBook(book,'s',{},[{plan:'Pro',period:'month',currency:'USD',amount:20}],1);
 A.deepEqual(P.updatePriceBook(book,'s',{},[{plan:'Pro',period:'month',currency:'JPY',amount:3000}],2),[]);
 A.deepEqual(book.s.plans['pro|month'].hist,[[2,3000]]);
 A.equal(P.toCNY(3000,'JPY'),null);
});
test('v218 soft-404 requires two checks and recovers on successful retry',async()=>{
 const now=Date.now();const d={id:'x',link:'https://example.com/',published:now,offerTypes:['free'],facts:{}};
 await V.recheckDeals([d],async()=>'<title>Page not found</title>',{now,hours:0});A.equal(d.recheck.gone,false);A.equal(d.recheck.suspect,true);
 await V.recheckDeals([d],async()=>'<h1>Current offer</h1>',{now:now+1,hours:0});A.equal(d.recheck.ok,true);
});
