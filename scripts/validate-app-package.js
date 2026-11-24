#!/usr/bin/env node
'use strict';
// Offline runtime/payload verification. Does not execute Windows binaries.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const asar=require('@electron/asar'),V=require('../src/core/v215');
const [winDir,linuxDir,embeddedAsar,output]=process.argv.slice(2);
if(!output)throw new Error('Usage: node scripts/validate-app-package.js <win-dir> <linux-dir> <extracted-installer-asar> <output.json>');
const root=path.join(__dirname,'..'),version=require('../package.json').version;
const tracked=execFileSync('git',['ls-files','-z','--','src','assets','README.md','LICENSE'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const results=[];
for(const [platform,dir] of [['win',winDir],['linux',linuxDir]]){
 const file=path.join(dir,'resources/app.asar'),members=asar.listPackage(file),pkg=JSON.parse(asar.extractFile(file,'package.json'));
 if(pkg.version!==version)throw new Error('Packaged version mismatch');
 for(const f of tracked)if(!asar.extractFile(file,f).equals(fs.readFileSync(path.join(root,f))))throw new Error('Packaged source mismatch: '+platform+' '+f);
 const forbidden=members.filter(f=>/^\/(?:\.git|coverage|release|build|dist|userData|config\.json|deals\.json|pages\.json|test|source-audit)(?:\/|$)/i.test(f)||/(?:^|\/)\.env(?:\.|\/|$)/i.test(f));
 if(forbidden.length)throw new Error('Forbidden package paths');
 let scanned=0;
 for(const f of members.filter(f=>/\.(js|json|md|html|css|ya?ml)$/.test(f))){if(!V.scanText(asar.extractFile(file,f.slice(1)).toString()).ok)throw new Error('Secret pattern in '+f);scanned++;}
 results.push({platform,version:pkg.version,trackedRuntimeAssetsAndDocsMatched:tracked.length,runtimeFilesMatched:tracked.filter(f=>f.startsWith('src/')).length,asarSHA256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),memberCount:members.length,secretScannedTextFiles:scanned,forbiddenPaths:forbidden,productionDependencies:Object.keys(pkg.dependencies)});
}
if(!fs.readFileSync(embeddedAsar).equals(fs.readFileSync(path.join(winDir,'resources/app.asar'))))throw new Error('Embedded NSIS ASAR mismatch');
const exe=fs.readFileSync(path.join(winDir,'全网优惠雷达.exe')),pe=exe.readUInt32LE(0x3c);
if(exe.readUInt16LE(0)!==0x5a4d||exe.readUInt32LE(pe)!==0x4550||exe.readUInt16LE(pe+4)!==0x8664)throw new Error('Not an AMD64 Windows PE application');
const report={version,results,installer:{format:'NSIS',applicationArchitecture:'Windows x64 (PE AMD64)',embeddedAsarMatches:true,signed:false,nativeExecutionTested:false},limitations:['Production dependency node-html-parser/dist is required runtime code, not project build output.','Native Windows installer execution/upgrade, signing and SmartScreen are not tested.']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
