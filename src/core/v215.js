'use strict';
// v2.15：发布清单与打包安全检查（不把密钥、用户数据、构建产物打进源码包）。

const EXCLUDE = [
  'node_modules', 'dist', 'build', 'release', 'coverage', '.git',
  '.env', '.env.local', '.cache', 'httpcache.json.gz', 'config.json',
  'deals.json', 'pages.json', 'health.json', 'prices.json', 'learn.json',
];
const BLOCK_NAME = /(\.env(\.|$)|credentials|id_rsa|id_ed25519|\.pem$|\.pfx$|secret|httpcache|userData)/i;
const BLOCK_TEXT = /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[\w-]{20,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/;

function shouldPack(rel) {
  const n = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!n || n.endsWith('/')) return false;
  const parts = n.split('/');
  if (parts.some((p) => EXCLUDE.includes(p) || p === '.git')) return false;
  if (BLOCK_NAME.test(parts[parts.length - 1]) || BLOCK_NAME.test(n)) return false;
  return true;
}

function scanText(text) {
  const s = String(text || '');
  const m = s.match(BLOCK_TEXT);
  return { ok: !m, match: m ? m[0].slice(0, 8) + '…' : '' };
}

function versionStamp({ pkgVersion, changelog, tag }) {
  const v = String(pkgVersion || '').trim();
  const tagV = String(tag || '').replace(/^v/i, '');
  const head = String(changelog || '').split(/\n/).find((l) => /^##\s+\d+\.\d+\.\d+/.test(l)) || '';
  const clV = (head.match(/##\s+(\d+\.\d+\.\d+)/) || [])[1] || '';
  return { ok: !!v && v === tagV && v === clV, version: v, tag: tagV, changelog: clV };
}

function nsisName(version) { return 'DealRadar-Setup-' + version + '-x64.exe'; }
function portableName(version) { return 'DealRadar-Portable-' + version + '-x64.exe'; }
function sourceZipName(version) { return 'DealRadar-' + version + '-source.zip'; }

module.exports = { EXCLUDE, shouldPack, scanText, versionStamp, nsisName, portableName, sourceZipName };
