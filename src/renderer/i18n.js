/* 全网优惠雷达 i18n 运行时（主进程 require / 渲染进程 <script> 共用）
 * 采用 gettext 风格：源语言（简体中文）原文即 key，locales/<lang>.json 提供译文；缺失时回退原文。
 * t(key, ...args)：界面文案，{0}{1}… 为占位符；tx(text)：对运行期数据（渠道名、错误信息、日志…）按「中文片段」逐段查表翻译。 */
(function (root, factory) { const m = factory(); if (typeof module === 'object' && module.exports) module.exports = m; else root.I18N = m; })(typeof self !== 'undefined' ? self : this, function () {
  const C = '\\u3400-\\u9fff\\u3000-\\u303f\\uff00-\\uffef';
  // 「片段」：首尾为中文字符（含全角标点），中间可夹空格、ASCII 字母数字与少量标点、\u0001（占位）
  const RUN_SRC = `[${C}](?:[${C}\\w \\t·/、%+.\\-:()#&!?,…—~*\\u0001]*[${C}])?`;
  const RUN = new RegExp(RUN_SRC, 'g');
  const HAS = new RegExp(`[${C}]`);
  const LANGS = [{ id: 'zh-CN', name: '简体中文' }, { id: 'en', name: 'English' }];
  let lang = 'zh-CN'; let dict = {};
  const fmt = (s, a) => (a.length ? String(s).replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? a[i] : m)) : s);
  function t(key, ...args) { const v = dict[key]; return fmt(v !== undefined && v !== '' ? v : key, args); }
  function one(seg) {
    if (dict[seg]) return dict[seg];
    const nums = []; const norm = seg.replace(/\d+(?:[.,]\d+)*/g, (m) => { nums.push(m); return `{${nums.length - 1}}`; });
    if (nums.length && dict[norm]) return fmt(dict[norm], nums);
    return null;
  }
  function tx(text) {
    if (lang === 'zh-CN' || text == null) return text;
    const s = String(text); if (!HAS.test(s)) return s;
    return s.replace(RUN, (run) => {
      const w = one(run); if (w != null) return w;
      // 回退 1：按分隔符（, ， · / | ； 空格）切开，贪心匹配最长的可翻译片段；回退 2：逐个中文词 / 全角标点查表
      const tok = run.split(/(\s*[,，·/|;；、]\s*|\s+)/);
      let out = '';
      for (let i = 0; i < tok.length;) {
        let hit = false;
        for (let j = tok.length - 1; j >= i; j--) {
          const seg = tok.slice(i, j + 1).join(''); const core = seg.trim();
          if (!core || !HAS.test(core)) continue;
          const x = one(core);
          if (x != null) { out += seg.replace(core, x); i = j + 1; hit = true; break; }
        }
        if (!hit) { out += tok[i].replace(/[\u3400-\u9fff]+|[\uff08\uff09\uff1a\uff0c]/g, (wd) => { const y = one(wd); return y != null ? y : wd; }); i++; }
      }
      return out;
    });
  }
  function set(l, d) { lang = l || 'zh-CN'; dict = d || {}; }
  function locale() { return lang === 'zh-CN' ? 'zh-CN' : lang === 'en' ? 'en-US' : lang; }
  function resolve(pref, sys) { if (pref && pref !== 'auto' && LANGS.some((x) => x.id === pref)) return pref; return /^zh/i.test(sys || '') ? 'zh-CN' : 'en'; }
  return { t, tx, set, get lang() { return lang; }, locale, resolve, LANGS, RUN, RUN_SRC, HAS };
});
