'use strict';
// OPML 导入 / 导出（RSS 阅读器通用格式）
const { XMLParser } = require('fast-xml-parser');
const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// groups: [{ title, items:[{ title, xmlUrl, htmlUrl }] }]
function toOPML(groups, title = '全网优惠雷达 订阅') {
  const body = groups.filter((g) => g.items.length).map((g) => `    <outline text="${xmlEsc(g.title)}" title="${xmlEsc(g.title)}">\n` + g.items.map((i) => `      <outline type="rss" text="${xmlEsc(i.title)}" title="${xmlEsc(i.title)}" xmlUrl="${xmlEsc(i.xmlUrl)}"${i.htmlUrl ? ` htmlUrl="${xmlEsc(i.htmlUrl)}"` : ''}/>`).join('\n') + '\n    </outline>').join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${xmlEsc(title)}</title><dateCreated>${new Date().toUTCString()}</dateCreated></head>\n  <body>\n${body}\n  </body>\n</opml>\n`;
}
function parseOPML(text) {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (n) => n === 'outline' }).parse(String(text).replace(/^\ufeff/, ''));
  if (!doc.opml || !doc.opml.body) throw new Error('不是有效的 OPML 文件');
  const out = [];
  const walk = (nodes, group) => { for (const n of nodes || []) { const t = n.title || n.text || ''; if (n.xmlUrl) out.push({ title: t || n.xmlUrl, xmlUrl: n.xmlUrl, htmlUrl: n.htmlUrl || '', group: group || '' }); if (n.outline) walk(n.outline, t || group); } };
  walk(doc.opml.body.outline, '');
  return out.filter((x) => /^https?:\/\//i.test(x.xmlUrl));
}
module.exports = { toOPML, parseOPML };
