'use strict';
// OpenAI 兼容 LLM 客户端（/chat/completions）。只用于「辅助」：排序 / 分类候选渠道、生成别名、建议 CSS 选择器。
// 没有配置 AI 时，发现流程全部走启发式规则，照样可用。
const PROVIDERS = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  qwen: { label: '通义千问 / 阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  kimi: { label: 'Kimi / 月之暗面', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  zhipu: { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  doubao: { label: '豆包 / 火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-flash-250828' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { label: '自定义（OpenRouter / 本地 Ollama 等 OpenAI 兼容接口）', baseUrl: '', model: '' },
};

// 任何错误信息 / 日志都经过 redact，确保 API Key 不会泄露
function redact(s, key) {
  let out = String(s ?? '');
  if (key && key.length >= 4) out = out.split(key).join('***');
  return out.replace(/\b(sk|ak|pk)-[A-Za-z0-9_\-]{8,}/g, '$1-***').replace(/(Bearer\s+)[^\s"']+/gi, '$1***');
}

// 从 LLM 回复中取出 JSON（容忍 ```json 代码块和前后废话）
function extractJSON(text) {
  const t = String(text || '').replace(/^\uFEFF/, '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : t;
  try { return JSON.parse(body); } catch { /* 继续 */ }
  const s = body.search(/[{[]/);
  if (s < 0) throw new Error('AI 回复中没有 JSON');
  const open = body[s]; const close = open === '{' ? '}' : ']';
  let depth = 0; let inStr = false; let esc = false;
  for (let i = s; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === open) depth++; else if (c === close && --depth === 0) return JSON.parse(body.slice(s, i + 1));
  }
  throw new Error('AI 回复的 JSON 不完整');
}

function normalizeBase(u) { return String(u || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, ''); }

/**
 * makeLLM({ baseUrl, apiKey, model, rawFetch, timeout }) → { chat(messages, opts), json(messages, opts), info }
 * rawFetch(url, init) 返回 WHATWG Response（Electron net.fetch / Node fetch）
 */
function makeLLM({ baseUrl, apiKey, model, rawFetch = (u, i) => globalThis.fetch(u, i), timeout = 45000 } = {}) {
  const base = normalizeBase(baseUrl);
  if (!/^https?:\/\/\S+$/i.test(base)) throw new Error('AI 接口地址无效');
  if (!model) throw new Error('请填写模型名称');
  async function chat(messages, { json = false, signal, maxTokens = 1500, temperature = 0.1 } = {}) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeout);
    const onAbort = () => ctrl.abort(); if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const body = { model, messages, temperature, max_tokens: maxTokens };
    if (json) body.response_format = { type: 'json_object' };
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    try {
      let res = await rawFetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
      // 部分兼容接口不支持 response_format：去掉后重试一次
      if (!res.ok && json && (res.status === 400 || res.status === 422)) { delete body.response_format; res = await rawFetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal }); }
      const text = await res.text();
      if (!res.ok) {
        let msg = text.slice(0, 300); try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error.code)) || j.message || msg; } catch { /* 非 JSON */ }
        const hint = res.status === 401 || res.status === 403 ? '（API Key 无效或无权限）' : res.status === 404 ? '（接口地址或模型名不对）' : res.status === 429 ? '（额度不足或请求过快）' : '';
        throw new Error(redact(`AI 接口 HTTP ${res.status}${hint}：${msg}`, apiKey));
      }
      let j; try { j = JSON.parse(text); } catch { throw new Error('AI 接口返回的不是 JSON（地址是否正确？）'); }
      const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (typeof content !== 'string') throw new Error('AI 接口返回格式异常（缺少 choices[0].message.content）');
      return content;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(signal && signal.aborted ? '已取消' : `AI 请求超时（${Math.round(timeout / 1000)}s）`);
      throw new Error(redact(e.message, apiKey));
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
  }
  async function json(messages, opts = {}) { return extractJSON(await chat(messages, { ...opts, json: true })); }
  return { chat, json, info: { baseUrl: base, model } };
}

module.exports = { PROVIDERS, makeLLM, extractJSON, redact, normalizeBase };
