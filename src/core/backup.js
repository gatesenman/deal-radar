'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS } = require('./defaults');
const { normalizeView } = require('./v28');
function validate(obj) {
  if (!obj || obj.app !== 'DealRadar' || ![2, 3].includes(obj.format) || !Array.isArray(obj.brands)) throw new Error('Invalid DealRadar backup');
  const walk = (x, depth = 0) => {
    if (depth > 18) throw new Error('Backup nesting limit');
    if (!x || typeof x !== 'object') return;
    for (const k of Object.keys(x)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k)) throw new Error('Unsafe backup property');
      walk(x[k], depth + 1);
    }
  };
  walk(obj);
  if (obj.brands.length > 2000 || (obj.sources || []).length > 5000 || (obj.deals || []).length > 20000) throw new Error('Backup count limit');
  const urlOK = (u) => { try { const p = new URL(u); return ['http:', 'https:'].includes(p.protocol) && !p.username && !p.password; } catch { return false; } };
  for (const b of obj.brands) if (!b || typeof b.id !== 'string' || typeof b.name !== 'string' || b.channels && !Array.isArray(b.channels)) throw new Error('Invalid backup brand');
  if (obj.sources && !Array.isArray(obj.sources)) throw new Error('Invalid backup sources');
  if (obj.settings && (Array.isArray(obj.settings) || typeof obj.settings !== 'object')) throw new Error('Invalid backup settings');
  if (obj.deals && !Array.isArray(obj.deals)) throw new Error('Invalid backup deals');
  for (const d of obj.deals || []) if (!d || typeof d.id !== 'string' || typeof d.title !== 'string' || !urlOK(d.link) || !Array.isArray(d.brandIds) || d.brandIds.some((x) => typeof x !== 'string')) throw new Error('Invalid backup deal');
  if (obj.prices && (typeof obj.prices !== 'object' || Array.isArray(obj.prices))) throw new Error('Invalid backup prices');
  if (obj.views && !Array.isArray(obj.views)) throw new Error('Invalid backup views');
  return obj;
}
function settingsForImport(incoming, local) {
  const safe = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (Object.hasOwn(incoming || {}, k) && !['ai', 'channels', 'views', 'autoStart', 'proxyUrl', 'proxyMode', 'windowBounds'].includes(k)) safe[k] = incoming[k];
  // Device-specific credentials/endpoints never come from a portable backup.
  for (const k of ['ai', 'channels', 'autoStart', 'proxyMode', 'proxyUrl', 'windowBounds']) if (k in local) safe[k] = local[k];
  safe.onboarded = true;
  return safe;
}
function viewsForImport(views) { return (views || []).slice(0, 100).map(normalizeView); }
/** All files staged before any replacement. On failure restore originals (same filesystem). */
function commitFiles(dir, entries, { rename = fs.renameSync } = {}) {
  const stage = fs.mkdtempSync(path.join(dir, 'restore-'));
  const changed = [];
  try {
    for (const [name, value] of Object.entries(entries)) fs.writeFileSync(path.join(stage, name), JSON.stringify(value), { mode: 0o600 });
    for (const name of Object.keys(entries)) {
      const target = path.join(dir, name), old = path.join(stage, name + '.old');
      const existed = fs.existsSync(target);
      if (existed) rename(target, old);
      changed.push({ target, old, existed });
      rename(path.join(stage, name), target);
    }
  } catch (e) {
    for (const c of changed.reverse()) {
      if (fs.existsSync(c.target)) fs.unlinkSync(c.target);
      if (c.existed) fs.renameSync(c.old, c.target);
    }
    throw e;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
module.exports = { validate, settingsForImport, viewsForImport, commitFiles };
