#!/usr/bin/env node
'use strict';
// 打一份不含 node_modules / 构建产物 / 密钥的源码 zip，并打印 SHA256。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const V215 = require('../src/core/v215');
const { sourcePolicy } = require('./lib/source-manifest');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outDir = process.argv[2] || path.join(root, 'release', 'v' + pkg.version.replace(/\./g, ''));
fs.mkdirSync(outDir, { recursive: true });
const zipName = V215.sourceZipName(pkg.version);
const zipPath = path.join(outDir, zipName);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (V215.EXCLUDE.includes(name)) continue;
    const p = path.join(dir, name);
    let st; try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, out);
    else out.push(path.relative(root, p));
  }
  return out;
}
const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
if (tracked.status !== 0) throw new Error('Source packaging requires a git checkout');
const include = sourcePolicy(fs.readFileSync(path.join(root, 'README.md'), 'utf8'));
const files = tracked.stdout.split('\0').filter(Boolean).filter((f) => include(f) && fs.existsSync(path.join(root, f)) && fs.lstatSync(path.join(root, f)).isFile()).sort();
for (const f of files.filter((x) => /\.(js|json|md|html|css|ya?ml)$/.test(x) && !x.startsWith('test/'))) {
  if (!V215.scanText(fs.readFileSync(path.join(root, f), 'utf8')).ok) throw new Error('Secret pattern in ' + f);
}
const listFile = path.join(outDir, 'source-files.txt');
fs.writeFileSync(listFile, files.join('\n') + '\n');
const staging = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dr-src-'));
for (const f of files) {
  const dest = path.join(staging, 'DealRadar-' + pkg.version, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, f), dest);
}
try { fs.unlinkSync(zipPath); } catch {}
const py = 'import os,sys,zipfile\nroot=sys.argv[1]; out=sys.argv[2]\nwith zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:\n  for dp, dns, fns in os.walk(root):\n    for fn in fns:\n      p=os.path.join(dp,fn); z.write(p, os.path.relpath(p, root))\n'
const r = spawnSync('python3', ['-c', py, staging, zipPath], { stdio: 'inherit' });
fs.rmSync(staging, { recursive: true, force: true });
if (r.status !== 0) process.exit(r.status || 1);
const buf = fs.readFileSync(zipPath);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
fs.writeFileSync(zipPath + '.sha256', sha + '  ' + zipName + '\n');
console.log(zipPath);
console.log('SHA256  ' + sha);
console.log('files   ' + files.length);
console.log('bytes   ' + buf.length);
