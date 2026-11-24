'use strict';
const net = require('node:net');
function privateIP(value) {
  const ip = String(value).replace(/^\[|\]$/g, '').toLowerCase();
  if (ip.includes(':')) {
    if (ip.startsWith('::ffff:')) return true;
    return ip === '::' || ip === '::1' || /^(f[cd]|fe[89ab]|ff)/.test(ip) || /^2001:db8:/.test(ip);
  }
  const a = ip.split('.').map(Number);
  if (a.length !== 4 || a.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  return [0, 10, 127].includes(a[0]) || a[0] >= 224 || a[0] === 169 && a[1] === 254 || a[0] === 172 && a[1] >= 16 && a[1] <= 31 || a[0] === 192 && a[1] === 168 || a[0] === 100 && a[1] >= 64 && a[1] <= 127;
}
async function assertPublicURL(value, { lookup } = {}) {
  let u; try { u = new URL(value); } catch { throw new Error('Unsafe source URL'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Unsafe source URL');
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || h === 'localhost' || /\.(localhost|local|internal)$/.test(h) || !h.includes('.') && !h.includes(':')) throw new Error('Private source address blocked');
  if (net.isIP(h)) { if (privateIP(h)) throw new Error('Private source address blocked'); }
  else if (lookup) {
    const answers = await lookup(h, { all: true, verbatim: true });
    if (!answers.length || answers.some((a) => privateIP(a.address))) throw new Error('Private source address blocked');
  }
  return u.href;
}
function isLoginURL(value) { try {const u=new URL(value);return /^(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|auth\.openai\.com)$/.test(u.hostname) || /\/(?:oauth2?authorize|oauth2?\/authorize|sign[ -]?in|login)(?:\/|$)/i.test(u.pathname);}catch{return false;} }
module.exports = { isLoginURL, privateIP, assertPublicURL };
