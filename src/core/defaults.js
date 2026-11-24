'use strict';
// 预设品牌与数据源。所有数据源均已在 2026-10 从公网实测（无需登录）。

const GOODS_BRANDS = [
  { name: 'Apple', aliases: ['Apple', 'iPhone', 'iPad', 'MacBook', 'AirPods', 'Apple Watch', 'iMac', '苹果'], exclude: ['apple juice', 'apple cider', 'caramel apple', 'apple pops', 'apple sauce', 'applesauce', 'apple pie', 'big apple', '苹果汁', '苹果醋', '红富士'] },
  { name: 'Samsung', aliases: ['Samsung', 'Galaxy S*', 'Galaxy Z*', 'Galaxy A*', 'Galaxy Tab', 'Galaxy Watch', 'Galaxy Buds', 'Galaxy Book', '三星'], exclude: [] },
  { name: 'Sony', aliases: ['Sony', 'PlayStation', 'PS5', 'WH-1000XM*', 'WF-1000XM*', '索尼'], exclude: ['Sony-E', 'Sony E-Mount)', '(Sony E)'] },
  { name: 'Nike', aliases: ['Nike', 'Air Jordan', 'Jordan', '耐克'], exclude: [] },
  { name: 'Adidas', aliases: ['Adidas', '阿迪达斯'], exclude: [] },
  { name: 'Dyson', aliases: ['Dyson', '戴森'], exclude: [] },
  { name: 'Lenovo', aliases: ['Lenovo', 'ThinkPad', 'Legion', '联想', '拯救者'], exclude: [] },
  { name: 'Xiaomi', aliases: ['Xiaomi', 'Redmi', '小米', '红米'], exclude: [] },
  { name: 'Huawei', aliases: ['Huawei', '华为', 'Mate 70', 'Mate70'], exclude: [] },
  { name: 'Microsoft', aliases: ['Microsoft', 'Xbox', 'Surface', '微软'], exclude: [] },
  { name: 'Nintendo', aliases: ['Nintendo', 'Switch 2', 'Nintendo Switch', '任天堂'], exclude: [] },
  { name: 'Logitech', aliases: ['Logitech', '罗技'], exclude: [] },
  { name: 'Dell', aliases: ['Dell', 'Alienware', '戴尔'], exclude: [] },
  { name: 'ASUS', aliases: ['ASUS', 'ROG', '华硕'], exclude: [] },
  { name: 'LG', aliases: ['LG OLED', 'LG UltraGear', 'LG Gram', 'LG '], exclude: [] },
  { name: 'Bose', aliases: ['Bose'], exclude: [] },
  { name: 'Anker', aliases: ['Anker', 'Soundcore', 'eufy', '安克'], exclude: [] },
  { name: 'DJI', aliases: ['DJI', '大疆'], exclude: [] },
  { name: 'Lego', aliases: ['LEGO', '乐高'], exclude: [] },
  { name: 'Uniqlo', aliases: ['Uniqlo', '优衣库'], exclude: [] },
];


// —— AI / 软件厂商（主分类，v2.0 只保留主流头部厂商）——
// cs: 区分大小写匹配（Cursor、Notion、Grok 等是常见英文单词）；noName: 名称本身不作为关键词
// q: 搜索渠道使用的关键词
const AI_BRANDS = [
  { name: 'OpenAI / ChatGPT', id: 'openai', aliases: ['OpenAI', 'ChatGPT', 'ChatGPT Plus', 'ChatGPT Go', 'Sora', 'Codex', 'Codex CLI', 'ChatGPT Agent', 'GPT-5*', 'GPT-6*'], exclude: [], noName: true, group: 'llm', on: true, q: 'ChatGPT OR OpenAI' },
  { name: 'Anthropic / Claude', id: 'anthropic', aliases: ['Anthropic', 'Claude', 'Claude Code', 'Claude Pro'], exclude: ['Claude Monet', 'Monet', 'Debussy', 'Van Damme', 'Makelele'], noName: true, group: 'llm', on: true, q: 'Claude OR Anthropic' },
  { name: 'Google Gemini', id: 'gemini', aliases: ['Gemini', 'Google AI Pro', 'Google AI Ultra', 'NotebookLM', 'Google One AI', 'AI Studio', '谷歌 Gemini'], exclude: ['Gemini Exchange', 'Gemini crypto', 'Gemini Trust', 'Winklevoss', 'Gemini Man', 'Gemini horoscope', '双子座'], group: 'llm', on: true, q: '"Google Gemini" OR "Google AI Pro"' },
  { name: 'Microsoft Copilot', id: 'ms-copilot', aliases: ['Microsoft Copilot', 'Copilot Pro', 'Microsoft 365', 'M365 Copilot', '微软 Copilot'], exclude: ['GitHub Copilot', 'keyboard', 'mouse', 'laptop', 'notebook', 'Copilot+ PC', 'Copilot key', '键盘', '笔记本'], group: 'agent', on: true, q: '"Microsoft Copilot" OR "Microsoft 365"' },
  { name: 'xAI / Grok', id: 'xai', aliases: ['xAI', 'Grok', 'SuperGrok'], exclude: [], cs: true, noName: true, group: 'llm', on: true, q: 'Grok OR xAI' },
  { name: 'Meta AI / Llama', id: 'meta', aliases: ['Meta AI', 'Llama 4', 'Llama 5', 'Llama API', 'Muse Spark', 'Muse Wonder'], exclude: [], noName: true, group: 'llm', on: true, q: '"Meta AI" OR Llama OR "Muse Spark"' },
  { name: 'Mistral AI', id: 'mistral', aliases: ['Mistral AI', 'Le Chat', 'Mistral'], exclude: [], cs: true, group: 'llm', on: true, q: '"Mistral AI"' },
  { name: 'Perplexity', id: 'perplexity', aliases: ['Perplexity', 'Perplexity Pro', 'Comet browser'], exclude: [], cs: true, group: 'agent', on: true, q: 'Perplexity' },
  { name: 'Cursor', id: 'cursor', aliases: ['Cursor AI', 'Cursor Pro', 'Cursor IDE', 'Cursor editor', 'Anysphere', 'Cursor 编辑器'], exclude: [], cs: true, noName: true, group: 'agent', on: true, q: '"Cursor AI" OR "Cursor Pro"' },
  { name: 'GitHub Copilot', id: 'github-copilot', aliases: ['GitHub Copilot', 'Copilot Pro+', 'GitHub Education', 'GitHub Student'], exclude: [], group: 'agent', on: true, q: '"GitHub Copilot"' },
  // —— v2.2：主流 AI 智能体 / 编程助手（2026-10-13 实测渠道）——
  { name: 'Devin (Cognition)', id: 'devin', aliases: ['Devin AI', 'Cognition AI', 'Devin', 'Windsurf'], exclude: ['Devin Booker', 'Devin Haney', 'Devin White', 'Devin Williams', 'Devin Vassell', 'NBA', 'NFL'], cs: true, noName: true, group: 'agent', on: true, q: '"Devin AI" OR "Cognition AI"' },
  { name: 'Manus', id: 'manus', aliases: ['Manus AI', 'Manus agent', 'Manus'], exclude: ['Manus Island', 'manuscript'], cs: true, group: 'agent', on: true, q: '"Manus AI"' },
  { name: 'Coze / 扣子', id: 'coze', aliases: ['Coze', '扣子'], exclude: ['纽扣', '扣子哥'], cs: true, noName: true, group: 'agent', on: true, q: 'Coze OR 扣子AI' },
  { name: 'Dify', id: 'dify', aliases: ['Dify', 'Dify.AI'], exclude: [], cs: true, group: 'agent', on: true, q: 'Dify' },
  { name: 'LangChain', id: 'langchain', aliases: ['LangChain', 'LangGraph', 'LangSmith'], exclude: [], group: 'agent', on: true, q: 'LangChain' },
  { name: 'n8n', id: 'n8n', aliases: ['n8n'], exclude: [], group: 'agent', on: true, q: 'n8n' },
  { name: 'Genspark', id: 'genspark', aliases: ['Genspark'], exclude: [], group: 'agent', on: true, q: 'Genspark' },
  { name: 'Midjourney', id: 'midjourney', aliases: ['Midjourney'], exclude: [], group: 'creative', on: true, q: 'Midjourney' },
  { name: 'DeepSeek', id: 'deepseek', aliases: ['DeepSeek', '深度求索'], exclude: [], group: 'llm', on: true, q: 'DeepSeek' },
  { name: 'Kimi / 月之暗面', id: 'kimi', aliases: ['Kimi', 'Moonshot AI', '月之暗面'], exclude: ['Räikkönen', 'Raikkonen', 'Antonelli', 'Kimi Raikkonen', 'F1'], cs: true, noName: true, group: 'llm', on: true, q: 'Kimi OR 月之暗面' },
  { name: '智谱 GLM', id: 'zhipu', aliases: ['智谱', 'Zhipu', 'ChatGLM', 'GLM-*', 'GLM Coding Plan', 'Z.ai', '智谱清言', 'AutoGLM', 'AutoClaw'], exclude: [], noName: true, group: 'llm', on: true, q: '智谱 OR GLM OR AutoClaw' },
  { name: '通义千问 / 阿里云百炼', id: 'qwen', aliases: ['通义千问', '通义', '千问', 'Qwen', '阿里云百炼', '百炼'], exclude: [], noName: true, group: 'llm', on: true, q: '通义千问 OR 千问 OR Qwen OR 阿里云百炼' },
  { name: '豆包 / 火山方舟', id: 'doubao', aliases: ['豆包', 'Doubao', '火山引擎', 'Volcengine', '火山方舟'], exclude: ['汽车', '君越', '车型', '新车', '万元起', '上市'], noName: true, group: 'llm', on: true, q: '豆包 OR 火山方舟' },
  { name: '文心一言 / 百度千帆', id: 'ernie', aliases: ['文心一言', '文心', 'ERNIE', '百度千帆', '千帆'], exclude: [], noName: true, group: 'llm', on: true, q: '文心 OR ERNIE OR 百度千帆' },
  { name: '腾讯元宝 / 混元', id: 'hunyuan', aliases: ['腾讯元宝', '元宝', '混元', 'Hunyuan'], exclude: [], noName: true, group: 'llm', on: true, q: '腾讯元宝 OR 腾讯混元' },
  { name: '讯飞星火', id: 'spark', aliases: ['讯飞星火', '星火大模型', 'iFlytek Spark', '讯飞 Spark', 'Spark X*', '星火'], exclude: [], noName: true, group: 'llm', on: true, q: '讯飞星火 OR "讯飞 Spark" OR "iFlytek Spark"' },
  { name: 'MiniMax / 海螺', id: 'minimax', aliases: ['MiniMax', '海螺AI', '海螺 AI'], exclude: [], noName: true, group: 'llm', on: true, q: 'MiniMax OR 海螺AI' },
  { name: 'Notion', id: 'notion', aliases: ['Notion', 'Notion AI'], exclude: [], cs: true, group: 'software', on: false, q: '"Notion AI" OR Notion' },
  { name: 'Adobe', id: 'adobe', aliases: ['Adobe', 'Photoshop', 'Creative Cloud', 'Firefly', 'Acrobat', 'Lightroom'], exclude: [], group: 'software', on: false, q: 'Adobe Creative Cloud OR Firefly' },
  { name: 'Canva', id: 'canva', aliases: ['Canva', 'Canva Pro'], exclude: [], group: 'software', on: false, q: 'Canva Pro' },
  { name: 'Figma', id: 'figma', aliases: ['Figma'], exclude: [], group: 'software', on: false, q: 'Figma' },
  { name: 'ElevenLabs', id: 'elevenlabs', aliases: ['ElevenLabs', 'Eleven Labs'], exclude: [], group: 'creative', on: true, q: 'ElevenLabs' },
  { name: 'Runway', id: 'runway', aliases: ['Runway ML', 'RunwayML', 'Runway Gen-*', 'Runway AI'], exclude: [], noName: true, group: 'creative', on: true, q: '"Runway AI" OR RunwayML OR "Runway ML" OR "Runway Gen"' },
  { name: 'Suno', id: 'suno', aliases: ['Suno', 'Suno AI'], exclude: [], cs: true, group: 'creative', on: true, q: '"Suno AI"' },
  { name: 'AWS', id: 'aws', aliases: ['AWS', 'Amazon Web Services', 'Amazon Bedrock', '亚马逊云科技'], exclude: [], cs: true, group: 'cloud', on: false, q: 'AWS credits OR "Amazon Bedrock"' },
  { name: 'Google Cloud', id: 'gcp', aliases: ['Google Cloud', 'GCP', 'Vertex AI', '谷歌云'], exclude: [], group: 'cloud', on: false, q: '"Google Cloud" credits OR "Vertex AI"' },
  { name: 'Microsoft Azure', id: 'azure', aliases: ['Azure', 'Azure OpenAI', 'Azure AI Foundry'], exclude: [], cs: true, group: 'cloud', on: false, q: 'Azure OpenAI OR "Azure credits"' },
  { name: 'Cloudflare', id: 'cloudflare', aliases: ['Cloudflare'], exclude: [], group: 'cloud', on: false, q: 'Cloudflare Workers AI' },
];

// 实物模式开启时默认启用的品牌
const GOODS_DEFAULT_ENABLED = ['Apple', 'Samsung', 'Sony', 'Nike', 'Dyson', 'Xiaomi', 'Lenovo', 'Adidas'];

// kind:
//   deal   —— 优惠社区/优惠站：条目本身就是优惠，只需匹配品牌
//   news   —— 资讯/新闻：需同时命中品牌 + 优惠关键词
//   search —— 按品牌搜索的模板（{q} 会替换为品牌搜索词），每个启用品牌各请求一次
// region: intl / cn
const GOODS_SOURCES = [
  // —— 国际优惠社区 ——
  { id: 'slickdeals', name: 'Slickdeals 首页精选', platform: 'Slickdeals', region: 'intl', country: '美国', kind: 'deal', url: 'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1' },
  { id: 'dealnews', name: 'DealNews', platform: 'DealNews', region: 'intl', country: '美国', kind: 'deal', url: 'https://www.dealnews.com/?rss=1' },
  { id: 'bensbargains', name: "Ben's Bargains", platform: "Ben's Bargains", region: 'intl', country: '美国', kind: 'deal', url: 'https://bensbargains.com/rss/' },
  { id: 'techbargains', name: 'TechBargains', platform: 'TechBargains', region: 'intl', country: '美国', kind: 'deal', ua: 'Mozilla/5.0', url: 'https://www.techbargains.com/rss.xml' },
  { id: '9to5toys', name: '9to5Toys', platform: '9to5Toys', region: 'intl', country: '美国', kind: 'deal', url: 'https://9to5toys.com/feed/' },
  { id: 'reddit-multi', name: 'Reddit 优惠合集（r/deals、r/buildapcsales、r/GameDeals、r/frugalmalefashion）', platform: 'Reddit', region: 'intl', country: '全球', kind: 'deal', url: 'https://www.reddit.com/r/deals+buildapcsales+GameDeals+frugalmalefashion/new/.rss?limit=100' },
  { id: 'hukd-hot', name: 'HotUKDeals 热门', platform: 'HotUKDeals', region: 'intl', country: '英国', kind: 'deal', url: 'https://www.hotukdeals.com/rss/hot' },
  { id: 'hukd-new', name: 'HotUKDeals 最新', platform: 'HotUKDeals', region: 'intl', country: '英国', kind: 'deal', url: 'https://www.hotukdeals.com/rss/new' },
  { id: 'mydealz-hot', name: 'mydealz 热门', platform: 'mydealz', region: 'intl', country: '德国', kind: 'deal', url: 'https://www.mydealz.de/rss/hot' },
  { id: 'dealabs-hot', name: 'Dealabs 热门', platform: 'Dealabs', region: 'intl', country: '法国', kind: 'deal', url: 'https://www.dealabs.com/rss/hot' },
  { id: 'pepper-nl', name: 'Pepper.com NL 最新', platform: 'Pepper NL', region: 'intl', country: '荷兰', kind: 'deal', url: 'https://nl.pepper.com/rss/nieuw' },
  { id: 'chollometro', name: 'Chollometro 最新', platform: 'Chollometro', region: 'intl', country: '西班牙', kind: 'deal', url: 'https://www.chollometro.com/rss/nuevos' },
  { id: 'preisjaeger', name: 'Preisjäger', platform: 'Preisjäger', region: 'intl', country: '奥地利', kind: 'deal', url: 'https://www.preisjaeger.at/rss/alle' },
  { id: 'pepper-pl', name: 'Pepper.pl', platform: 'Pepper.pl', region: 'intl', country: '波兰', kind: 'deal', url: 'https://www.pepper.pl/rss/wszystkie' },
  { id: 'ozbargain', name: 'OzBargain', platform: 'OzBargain', region: 'intl', country: '澳大利亚', kind: 'deal', url: 'https://www.ozbargain.com.au/deals/feed' },
  { id: 'rfd', name: 'RedFlagDeals 热门优惠', platform: 'RedFlagDeals', region: 'intl', country: '加拿大', kind: 'deal', url: 'https://forums.redflagdeals.com/feed/forum/9' },
  { id: 'androidpolice-deals', name: 'Android Police 优惠', platform: 'Android Police', region: 'intl', country: '美国', kind: 'deal', url: 'https://www.androidpolice.com/feed/deals/' },
  { id: 'cheapshark', name: 'CheapShark 游戏折扣', platform: 'CheapShark', region: 'intl', country: '全球', kind: 'deal', format: 'cheapshark', ua: 'DealRadar/1.0 (desktop deal monitor; +https://github.com)', url: 'https://www.cheapshark.com/api/1.0/deals?pageSize=60&sortBy=recent' },
  // —— 品牌官方 ——
  { id: 'apple-newsroom', name: 'Apple Newsroom 官方', platform: '品牌官方', region: 'intl', country: '全球', kind: 'news', url: 'https://www.apple.com/newsroom/rss-feed.rss' },
  { id: 'samsung-newsroom', name: 'Samsung Newsroom 官方', platform: '品牌官方', region: 'intl', country: '全球', kind: 'news', url: 'https://news.samsung.com/global/feed' },
  // —— 中文 ——
  { id: 'smzdm-post', name: '什么值得买 原创/好文', platform: '什么值得买', region: 'cn', country: '中国', kind: 'news', url: 'https://post.smzdm.com/feed' },
  { id: 'ithome', name: 'IT之家', platform: 'IT之家', region: 'cn', country: '中国', kind: 'news', url: 'https://www.ithome.com/rss/' },
  { id: 'mydrivers', name: '快科技（驱动之家）', platform: '快科技', region: 'cn', country: '中国', kind: 'news', url: 'https://rss.mydrivers.com/rss.aspx?Tid=1' },
  { id: 'cnbeta', name: 'cnBeta', platform: 'cnBeta', region: 'cn', country: '中国', kind: 'news', url: 'https://rss.cnbeta.com.tw/' },
  { id: 'v2ex-deals', name: 'V2EX 交易', platform: 'V2EX', region: 'cn', country: '中国', kind: 'deal', skip: '^\\s*[【\\[(（]?\\s*(收|求|求购|回收)|拼车|合租', url: 'https://www.v2ex.com/feed/tab/deals.xml' },
  // —— 按品牌全网搜索 ——
  { id: 'gnews-en', name: 'Google 新闻（英文）品牌优惠搜索', platform: 'Google News', region: 'intl', country: '全球', kind: 'search', searchSuffix: '(sale OR deal OR discount OR "% off")', url: 'https://news.google.com/rss/search?q={q}+when:7d&hl=en-US&gl=US&ceid=US:en' },
  { id: 'gnews-zh', name: 'Google 新闻（中文）品牌优惠搜索', platform: 'Google News', region: 'cn', country: '中国', kind: 'search', searchSuffix: '(优惠 OR 降价 OR 促销 OR 折扣 OR 国补)', url: 'https://news.google.com/rss/search?q={q}+when:7d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
  { id: 'bing-en', name: 'Bing 资讯（英文）品牌优惠搜索', platform: 'Bing News', region: 'intl', country: '全球', kind: 'search', searchSuffix: 'sale deal discount', url: 'https://www.bing.com/news/search?q={q}&format=rss&setlang=en-us' },
  { id: 'bing-zh', name: '必应资讯（中文）品牌优惠搜索', platform: 'Bing News', region: 'cn', country: '中国', kind: 'search', searchSuffix: '优惠 降价', url: 'https://www.bing.com/news/search?q={q}&format=rss&setlang=zh-cn' },
];


// —— AI / 软件聚合数据源（2026-10 实测，无需登录）——
// kind: vendor（官方，全部保留）| search（按厂商搜索 {q}）| community / news（标题须含厂商且识别出优惠类型）
// type: 采集协议（默认 rss），见 collectors.js
const PROMO_EN = '(free OR discount OR "% off" OR credits OR "free trial" OR students OR promo OR cheaper)';
const PROMO_ZH = '(免费 OR 优惠 OR 降价 OR 折扣 OR 限时 OR 学生 OR 额度 OR 限免)';
const AI_SOURCES = [
  // 官方
  { id: 'google-ai-blog', name: 'Google AI 官方博客', platform: '厂商官方', region: 'intl', country: '美国', kind: 'vendor', url: 'https://blog.google/technology/ai/rss/' },
  { id: 'microsoft-blog', name: 'Microsoft 官方博客', platform: '厂商官方', region: 'intl', country: '美国', kind: 'vendor', url: 'https://blogs.microsoft.com/feed/' },
  { id: 'github-blog', name: 'GitHub 官方博客', platform: '厂商官方', region: 'intl', country: '美国', kind: 'vendor', url: 'https://github.blog/feed/' },
  // 按厂商搜索
  { id: 'ai-gnews-zh', name: 'Google 新闻（中文）厂商优惠搜索', platform: 'Google News', region: 'cn', country: '中国', kind: 'search', interval: 60, searchSuffix: PROMO_ZH, url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
  { id: 'ai-bing-en', interval: 120, name: 'Bing 资讯（英文）厂商优惠搜索', platform: 'Bing News', region: 'intl', country: '全球', kind: 'search', searchSuffix: 'free discount credits trial', url: 'https://www.bing.com/news/search?q={q}&format=rss&setlang=en-us' },
  { id: 'ai-bing-zh', interval: 120, name: '必应资讯（中文）厂商优惠搜索', platform: 'Bing News', region: 'cn', country: '中国', kind: 'search', searchSuffix: '免费 优惠', url: 'https://www.bing.com/news/search?q={q}&format=rss&setlang=zh-cn' },
  // —— v2.6 覆盖率：Google 新闻地区版（主流新闻聚合，按厂商搜索；每 2 小时一次以控制请求量）——
  { id: 'ai-gnews-ja', name: 'Google 新闻（日本）厂商优惠搜索', platform: 'Google News', region: 'intl', country: '日本', kind: 'search', interval: 120, searchSuffix: '(無料 OR 割引 OR 学割 OR 値下げ OR キャンペーン OR クレジット)', url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=ja&gl=JP&ceid=JP:ja' },
  { id: 'ai-gnews-ko', name: 'Google 新闻（韩国）厂商优惠搜索', platform: 'Google News', region: 'intl', country: '韩国', kind: 'search', interval: 120, searchSuffix: '(무료 OR 할인 OR 학생 OR 인하 OR 프로모션 OR 크레딧)', url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=ko&gl=KR&ceid=KR:ko' },
  { id: 'ai-gnews-tw', name: 'Google 新闻（台湾/香港繁体）厂商优惠搜索', platform: 'Google News', region: 'intl', country: '中国台湾', kind: 'search', interval: 240, searchSuffix: '(免費 OR 優惠 OR 降價 OR 學生 OR 折扣)', url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant' },
  { id: 'ai-gnews-in', name: 'Google 新闻（印度）厂商优惠搜索', platform: 'Google News', region: 'intl', country: '印度', kind: 'search', interval: 120, searchSuffix: PROMO_EN, url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=en-IN&gl=IN&ceid=IN:en' },
  { id: 'ai-gnews-id', name: 'Google 新闻（印尼/东南亚）厂商优惠搜索', platform: 'Google News', region: 'intl', country: '印度尼西亚', kind: 'search', interval: 120, searchSuffix: '(gratis OR diskon OR promo OR mahasiswa OR kredit OR free)', url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=id&gl=ID&ceid=ID:id' },
  { id: 'ai-gnews-br', name: 'Google 新闻（巴西）厂商优惠搜索', platform: 'Google News', region: 'intl', country: '巴西', kind: 'search', interval: 120, searchSuffix: '(grátis OR desconto OR promoção OR estudantes OR créditos OR "de graça")', url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=pt-BR&gl=BR&ceid=BR:pt-419' },
  { id: 'ai-gnews-latam', name: 'Google 新闻（拉美西语）厂商优惠搜索', platform: 'Google News', region: 'intl', country: '墨西哥', kind: 'search', interval: 240, searchSuffix: '(gratis OR descuento OR promoción OR estudiantes OR créditos)', url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=es-419&gl=MX&ceid=MX:es-419' },
  { id: 'ai-gnews-de', name: 'Google 新闻（德国）厂商优惠搜索', platform: 'Google News', region: 'intl', country: '德国', kind: 'search', interval: 240, searchSuffix: '(kostenlos OR Rabatt OR Studenten OR günstiger OR Aktion)', url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=de&gl=DE&ceid=DE:de' },
  { id: 'ai-gnews-fr', name: 'Google 新闻（法国）厂商优惠搜索', platform: 'Google News', region: 'intl', country: '法国', kind: 'search', interval: 240, searchSuffix: '(gratuit OR réduction OR étudiants OR promo OR crédits)', url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=fr&gl=FR&ceid=FR:fr' },
  { id: 'ai-gnews-ar', name: 'Google 新闻（中东阿语）厂商优惠搜索', platform: 'Google News', region: 'intl', country: '沙特阿拉伯', kind: 'search', interval: 240, searchSuffix: '(مجانا OR مجاني OR خصم OR عرض OR طلاب)', url: 'https://news.google.com/rss/search?q={q}+when:14d&hl=ar&gl=SA&ceid=SA:ar' },
  { id: 'hn-search', name: 'Hacker News 厂商搜索', platform: 'Hacker News', region: 'intl', country: '全球', kind: 'search', format: 'hn', url: 'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=40&query={q}' },
  { id: 'slickdeals-ai', name: 'Slickdeals 厂商搜索（软件/订阅优惠）', platform: 'Slickdeals', region: 'intl', country: '美国', kind: 'search', url: 'https://slickdeals.net/newsearch.php?q={q}&searcharea=deals&searchin=first&rss=1' },
  // 优惠社区
  { id: 'slickdeals-software', name: 'Slickdeals 软件订阅优惠', platform: 'Slickdeals', region: 'intl', country: '美国', kind: 'community', url: 'https://slickdeals.net/newsearch.php?q=software+subscription&searcharea=deals&searchin=first&rss=1' },
  { id: 'hukd-software', name: 'HotUKDeals 软件', platform: 'HotUKDeals', region: 'intl', country: '英国', kind: 'community', url: 'https://www.hotukdeals.com/rss/tag/software' },
  { id: 'reddit-ai', name: 'Reddit AI 社区（r/ChatGPT、r/OpenAI、r/ClaudeAI、r/GeminiAI、r/cursor、r/SaaS、r/AppSumo）', platform: 'Reddit', region: 'intl', country: '全球', kind: 'community', flaky: true, url: 'https://www.reddit.com/r/ChatGPT+OpenAI+ClaudeAI+GeminiAI+cursor+SaaS+AppSumo/search.rss?q=free+OR+discount+OR+promo+OR+trial+OR+credits+OR+offer&restrict_sr=on&sort=new&limit=100' },
  { id: 'producthunt', name: 'Product Hunt 新品', platform: 'Product Hunt', region: 'intl', country: '全球', kind: 'community', type: 'producthunt', url: 'https://www.producthunt.com/feed' },
  { id: 'producthunt-ai', name: 'Product Hunt · AI 分类', platform: 'Product Hunt', region: 'intl', country: '全球', kind: 'community', type: 'producthunt', url: 'https://www.producthunt.com/feed?category=artificial-intelligence' },
  { id: 'v2ex-openai', name: 'V2EX OpenAI 节点', platform: 'V2EX', region: 'cn', country: '中国', kind: 'community', url: 'https://www.v2ex.com/feed/openai.xml' },
  { id: 'v2ex-promotions', name: 'V2EX 推广区', platform: 'V2EX', region: 'cn', country: '中国', kind: 'community', url: 'https://www.v2ex.com/feed/promotions.xml' },
  { id: 'v2ex-create', name: 'V2EX 分享创造', platform: 'V2EX', region: 'cn', country: '中国', kind: 'community', url: 'https://www.v2ex.com/feed/create.xml' },
  // 主流科技媒体
  { id: 'techcrunch-ai', name: 'TechCrunch AI', platform: 'TechCrunch', region: 'intl', country: '美国', kind: 'news', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { id: 'verge-ai', name: 'The Verge AI', platform: 'The Verge', region: 'intl', country: '美国', kind: 'news', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { id: 'ars-ai', name: 'Ars Technica AI', platform: 'Ars Technica', region: 'intl', country: '美国', kind: 'news', url: 'https://arstechnica.com/ai/feed/' },
  { id: 'techradar-software', name: 'TechRadar 软件', platform: 'TechRadar', region: 'intl', country: '英国', kind: 'news', url: 'https://www.techradar.com/feeds/tag/software' },
  // —— v2.6 覆盖率：各地区主流科技媒体 / 开发者社区（标题须含厂商且识别出优惠类型）——
  { id: 'geeknews', name: 'GeekNews（韩国 news.hada.io）', platform: 'GeekNews', region: 'intl', country: '韩国', kind: 'community', url: 'https://news.hada.io/rss/news' },
  { id: 'itmedia-aiplus', name: 'ITmedia AI+', platform: 'ITmedia', region: 'intl', country: '日本', kind: 'news', url: 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml' },
  { id: 'gigazine', name: 'GIGAZINE', platform: 'GIGAZINE', region: 'intl', country: '日本', kind: 'news', url: 'https://gigazine.net/news/rss_2.0/' },
  { id: 'zenn-ai', name: 'Zenn · AI 话题', platform: 'Zenn', region: 'intl', country: '日本', kind: 'community', url: 'https://zenn.dev/topics/ai/feed' },
  { id: 'qiita-popular', name: 'Qiita 热门文章', platform: 'Qiita', region: 'intl', country: '日本', kind: 'community', url: 'https://qiita.com/popular-items/feed' },
  { id: 'techinasia', name: 'Tech in Asia', platform: 'Tech in Asia', region: 'intl', country: '新加坡', kind: 'news', url: 'https://www.techinasia.com/feed' },
  { id: 'inc42', name: 'Inc42（印度）', platform: 'Inc42', region: 'intl', country: '印度', kind: 'news', url: 'https://www.inc42.com/feed/' },
  { id: 'yourstory', name: 'YourStory（印度）', platform: 'YourStory', region: 'intl', country: '印度', kind: 'news', url: 'https://yourstory.com/feed' },
  { id: 'xataka', name: 'Xataka（西语）', platform: 'Xataka', region: 'intl', country: '西班牙', kind: 'news', url: 'https://www.xataka.com/feedburner.xml' },
  { id: 'genbeta', name: 'Genbeta（西语软件）', platform: 'Genbeta', region: 'intl', country: '西班牙', kind: 'news', url: 'https://www.genbeta.com/feedburner.xml' },
  { id: 'tecmundo', name: 'TecMundo（巴西）', platform: 'TecMundo', region: 'intl', country: '巴西', kind: 'news', url: 'https://rss.tecmundo.com.br/feed' },
  { id: 'tecnoblog', name: 'Tecnoblog（巴西）', platform: 'Tecnoblog', region: 'intl', country: '巴西', kind: 'news', url: 'https://tecnoblog.net/feed/' },
  { id: 'heise', name: 'heise online（德国）', platform: 'heise', region: 'intl', country: '德国', kind: 'news', url: 'https://www.heise.de/rss/heise-atom.xml' },
  { id: '01net', name: '01net（法国）', platform: '01net', region: 'intl', country: '法国', kind: 'news', url: 'https://www.01net.com/actualites/feed/' },
  { id: 'aitnews', name: 'AITNews 阿拉伯科技新闻（中东）', platform: 'AITNews', region: 'intl', country: '沙特阿拉伯', kind: 'news', url: 'https://aitnews.com/feed/' },
  { id: 'skt-news', name: 'SK Telecom 官方新闻（韩国运营商）', platform: '运营商官方', region: 'intl', country: '韩国', kind: 'news', interval: 240, url: 'https://news.sktelecom.com/feed' },
  { id: 'docomo-news', name: 'NTT docomo 新闻稿（日本运营商）', platform: '运营商官方', region: 'intl', country: '日本', kind: 'news', interval: 240, url: 'https://www.docomo.ne.jp/info/rss/news_release.rdf' },
  { id: 'vodafone-de', name: 'Vodafone Deutschland 新闻（德国运营商）', platform: '运营商官方', region: 'intl', country: '德国', kind: 'news', interval: 240, url: 'https://www.vodafone.de/newsroom/feed/' },
  { id: 'ithome-tw', name: 'iThome 台湾', platform: 'iThome TW', region: 'intl', country: '中国台湾', kind: 'news', url: 'https://www.ithome.com.tw/rss' },
  { id: 'ai-ithome', name: 'IT之家', platform: 'IT之家', region: 'cn', country: '中国', kind: 'news', url: 'https://www.ithome.com/rss/' },
  { id: 'ai-smzdm', name: '什么值得买 原创/好文', platform: '什么值得买', region: 'cn', country: '中国', kind: 'news', url: 'https://post.smzdm.com/feed' },
  { id: 'sspai', name: '少数派', platform: '少数派', region: 'cn', country: '中国', kind: 'news', url: 'https://sspai.com/feed' },
  { id: 'qbitai', name: '量子位', platform: '量子位', region: 'cn', country: '中国', kind: 'news', url: 'https://www.qbitai.com/feed' },
  { id: '36kr', name: '36氪 快讯', platform: '36氪', region: 'cn', country: '中国', kind: 'news', url: 'https://www.36kr.com/feed-newsflash' },
  { id: 'ifanr', name: '爱范儿', platform: '爱范儿', region: 'cn', country: '中国', kind: 'news', url: 'https://www.ifanr.com/feed' },
];

// —— 每个厂商的信息渠道（v2.0：多协议）——
// type: 采集协议（rss/page/render/sitemap/github/discourse/reddit/youtube/bluesky/appstore/gplay/search/hn/html…）
// sub: 渠道类别；flaky: 实测偶发失败（限流/5xx），保留但标注
// 以下渠道均于 2026-10-12 实测可免登录抓取
const yt = (id) => ({ type: 'youtube', opts: { channelId: id } });
const PRICE_KW = '$,free,month,trial,student,% off,credit,discount,contact sales,contact us,custom pricing,pay as you go,免费,联系销售';
const ZH_KW = '免费,元,¥,￥,$,CNY,USD,折,额度,优惠,特惠,首月,套餐,限时,赠,价格';
const VENDOR_CHANNELS = {
  openai: [
    { id: 'news', sub: 'blog', type: 'rss', name: '官方新闻', url: 'https://openai.com/news/rss.xml', maxItems: 120 },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'ChatGPT 价格页', url: 'https://chatgpt.com/pricing', keyword: PRICE_KW },
    { id: 'api-pricing', sub: 'pricing', type: 'page', name: 'API 价格（开发者文档）', url: 'https://platform.openai.com/docs/pricing', keyword: '$' },
    { id: 'biz-pricing', sub: 'pricing', type: 'render', name: 'openai.com 价格页（JS 渲染）', url: 'https://openai.com/api/pricing/', keyword: PRICE_KW },
    { id: 'students', sub: 'pricing', type: 'page', name: 'ChatGPT 学生优惠页', url: 'https://chatgpt.com/students', keyword: PRICE_KW },
    { id: 'release-notes', sub: 'changelog', type: 'page', name: 'ChatGPT 发布说明', url: 'https://help.openai.com/en/articles/6825453-chatgpt-release-notes' },
    { id: 'help-chatgpt', sub: 'changelog', type: 'render', name: '帮助中心 · ChatGPT 文章目录（新优惠/活动说明，JS 渲染）', url: 'https://help.openai.com/en/collections/3742473-chatgpt', interval: 120 },
    { id: 'students-page', sub: 'pricing', type: 'render', name: 'ChatGPT 学生页（JS 渲染）', url: 'https://chatgpt.com/use-cases/students', keyword: PRICE_KW, interval: 240 },
    { id: 'sitemap', sub: 'blog', type: 'sitemap', name: '官网新页面（sitemap）', url: 'https://openai.com/sitemap.xml' },
    { id: 'status', sub: 'status', type: 'rss', name: '服务状态', url: 'https://status.openai.com/history.rss', maxItems: 15 },
    { id: 'community', sub: 'forum', type: 'discourse', name: '开发者社区（Discourse）', url: 'https://community.openai.com' },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/OpenAI', opts: { sub: 'OpenAI' }, flaky: true },
    { id: 'reddit-chatgpt', sub: 'reddit', type: 'reddit', name: 'r/ChatGPT 优惠讨论', opts: { sub: 'ChatGPT', query: 'free OR discount OR promo OR trial' }, flaky: true },
    { id: 'youtube', sub: 'youtube', ...yt('UCXZCJLdBC09xxGZ6gcdrc6A'), name: 'YouTube 官方频道' },
    { id: 'codex', sub: 'github', type: 'github', name: 'GitHub：Codex 发布', opts: { repo: 'openai/codex', what: 'releases' }, on: false, flaky: true },
    { id: 'sdk', sub: 'github', type: 'github', name: 'GitHub：openai-python 发布', opts: { repo: 'openai/openai-python', what: 'releases' }, on: false, flaky: true },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：ChatGPT', opts: { appId: '6448311069' } },
    { id: 'android', sub: 'app', type: 'gplay', name: 'Google Play：ChatGPT', opts: { pkg: 'com.openai.chatgpt' } },
  ],
  anthropic: [
    { id: 'news', sub: 'blog', type: 'page', name: '官方新闻页', url: 'https://www.anthropic.com/news' },
    { id: 'sitemap', sub: 'blog', type: 'sitemap', name: '新闻新页面（sitemap）', url: 'https://www.anthropic.com/sitemap.xml', opts: { filter: '/news/' } },
    { id: 'blog', sub: 'blog', type: 'page', name: 'Claude 博客', url: 'https://claude.com/blog' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Claude 价格页', url: 'https://claude.com/pricing' },
    { id: 'api-pricing', sub: 'pricing', type: 'page', name: 'Claude API 价格', url: 'https://docs.anthropic.com/en/docs/about-claude/pricing', keyword: '$,free,discount,batch,credit' },
    { id: 'education', sub: 'pricing', type: 'page', name: 'Claude 教育计划', url: 'https://www.anthropic.com/education' },
    { id: 'release-notes', sub: 'changelog', type: 'page', name: '平台发布说明', url: 'https://docs.anthropic.com/en/release-notes/overview' },
    { id: 'status', sub: 'status', type: 'rss', name: '服务状态', url: 'https://status.claude.com/history.rss', maxItems: 15 },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/ClaudeAI', opts: { sub: 'ClaudeAI' }, flaky: true },
    { id: 'youtube', sub: 'youtube', ...yt('UCrDwWp7EBBv4NwvScIpBDOA'), name: 'YouTube 官方频道' },
    { id: 'claude-code', sub: 'github', type: 'github', name: 'GitHub：Claude Code 发布', opts: { repo: 'anthropics/claude-code', what: 'releases' }, on: false },
    { id: 'sdk', sub: 'github', type: 'github', name: 'GitHub：Python SDK 发布', opts: { repo: 'anthropics/anthropic-sdk-python', what: 'releases' }, on: false },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Claude', opts: { appId: '6473753684' } },
    { id: 'android', sub: 'app', type: 'gplay', name: 'Google Play：Claude', opts: { pkg: 'com.anthropic.claude' } },
  ],
  gemini: [
    { id: 'blog', sub: 'blog', type: 'rss', name: 'Gemini 官方博客', url: 'https://blog.google/products/gemini/rss/' },
    { id: 'deepmind', sub: 'blog', type: 'rss', name: 'Google DeepMind 博客', url: 'https://deepmind.google/blog/rss.xml', maxItems: 40 },
    { id: 'devblog', sub: 'blog', type: 'rss', name: 'Google 开发者博客', url: 'https://developers.googleblog.com/feeds/posts/default' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Gemini 订阅价格页', url: 'https://gemini.google/subscriptions/' },
    { id: 'ai-plans', sub: 'pricing', type: 'page', name: 'Google AI 套餐（Google One）', url: 'https://one.google.com/about/google-ai-plans/' },
    { id: 'students', sub: 'pricing', type: 'page', name: 'Gemini 学生免费计划', url: 'https://gemini.google/students/' },
    { id: 'api-pricing', sub: 'pricing', type: 'render', name: 'Gemini API 价格（JS 渲染）', url: 'https://ai.google.dev/gemini-api/docs/pricing', keyword: '$,free,Free' },
    { id: 'forum', sub: 'forum', type: 'discourse', name: 'Gemini API 开发者论坛', url: 'https://discuss.ai.google.dev' },
    { id: 'jio', sub: 'pricing', type: 'page', name: '运营商官方：Jio × Google AI Pro 活动页（印度）', url: 'https://www.jio.com/google-gemini-offer/', interval: 360 },
    { id: 'telkomsel', sub: 'news', type: 'page', name: '运营商官方：Telkomsel 新闻（印尼）', url: 'https://www.telkomsel.com/en/about-us/news', keyword: 'Gemini,Google,ChatGPT,Perplexity,AI', interval: 360 },
    { id: 'xlsmart', sub: 'news', type: 'page', name: '运营商官方：XLSMART 新闻（印尼）', url: 'https://www.xlsmart.co.id/en/about-xlsmart/news', keyword: 'Gemini,Google,ChatGPT,Perplexity,AI', interval: 360 },
    { id: 'airtel', sub: 'news', type: 'page', name: '运营商官方：Airtel 新闻稿（印度）', url: 'https://www.airtel.in/press-release', keyword: 'Gemini,Google,ChatGPT,Perplexity,Adobe,AI', interval: 360 },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/GeminiAI', opts: { sub: 'GeminiAI' }, flaky: true },
    { id: 'youtube', sub: 'youtube', ...yt('UCP7jMXSY2xbc3KCAE0MHQ-A'), name: 'Google DeepMind YouTube' },
    { id: 'gemini-cli', sub: 'github', type: 'github', name: 'GitHub：Gemini CLI 发布', opts: { repo: 'google-gemini/gemini-cli', what: 'releases' }, on: false },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Google Gemini', opts: { appId: '6477489729' } },
    { id: 'android', sub: 'app', type: 'gplay', name: 'Google Play：Gemini', opts: { pkg: 'com.google.android.apps.bard' } },
  ],
  'ms-copilot': [
    { id: 'm365-blog', sub: 'blog', type: 'rss', name: 'Microsoft 365 博客', url: 'https://www.microsoft.com/en-us/microsoft-365/blog/feed/' },
    { id: 'ms-blog-copilot', sub: 'blog', type: 'rss', name: 'Microsoft 博客 · Copilot', url: 'https://blogs.microsoft.com/blog/tag/microsoft-copilot/feed/' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Microsoft 365 Copilot 价格页', url: 'https://www.microsoft.com/en-us/microsoft-365/copilot/pricing', keyword: PRICE_KW },
    { id: 'youtube', sub: 'youtube', ...yt('UCFtEEv80fQVKkD4h1PF-Xqw'), name: 'Microsoft YouTube' },
  ],
  xai: [
    { id: 'news', sub: 'blog', type: 'render', name: 'x.ai 新闻（JS 渲染）', url: 'https://x.ai/news' },
    { id: 'api', sub: 'pricing', type: 'render', name: 'x.ai API 页（JS 渲染）', url: 'https://x.ai/api', keyword: PRICE_KW },
    { id: 'models', sub: 'pricing', type: 'page', name: 'API 模型与价格（文档）', url: 'https://docs.x.ai/docs/models', keyword: '$' },
    { id: 'status', sub: 'status', type: 'rss', name: '服务状态', url: 'https://status.x.ai/feed.xml', maxItems: 15 },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/grok', opts: { sub: 'grok' }, flaky: true },
    { id: 'sdk', sub: 'github', type: 'github', name: 'GitHub：xai-sdk-python 发布', opts: { repo: 'xai-org/xai-sdk-python', what: 'releases' }, on: false },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Grok', opts: { appId: '6670324846' } },
    { id: 'android', sub: 'app', type: 'gplay', name: 'Google Play：Grok', opts: { pkg: 'ai.x.grok' } },
  ],
  meta: [
    { id: 'newsroom', sub: 'blog', type: 'rss', name: 'Meta 官方新闻', url: 'https://about.fb.com/news/feed/' },
    { id: 'ai-blog', sub: 'blog', type: 'render', name: 'Meta AI 博客（JS 渲染）', url: 'https://ai.meta.com/blog/' },
    { id: 'llama-api', sub: 'pricing', type: 'page', name: 'Meta Llama API / 模型页', url: 'https://dev.meta.ai/', keyword: PRICE_KW },
    { id: 'llama-stack', sub: 'github', type: 'github', name: 'GitHub：Llama Stack 发布', opts: { repo: 'meta-llama/llama-stack', what: 'releases' }, on: false },
    { id: 'android', sub: 'app', type: 'gplay', name: 'Google Play：Meta AI', opts: { pkg: 'com.facebook.stella' } },
  ],
  mistral: [
    { id: 'news', sub: 'blog', type: 'sitemap', name: '新闻新页面（sitemap）', url: 'https://mistral.ai/sitemap.xml', opts: { filter: '/news/' } },
    { id: 'news-rss', sub: 'blog', type: 'rss', name: 'Mistral 官方新闻 RSS', url: 'https://mistral.ai/news/rss' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Mistral 价格页', url: 'https://mistral.ai/pricing' },
    { id: 'changelog', sub: 'changelog', type: 'page', name: '文档更新日志', url: 'https://docs.mistral.ai/getting-started/changelog/' },
    { id: 'sdk', sub: 'github', type: 'github', name: 'GitHub：client-python 发布', opts: { repo: 'mistralai/client-python', what: 'releases' }, on: false },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/MistralAI', opts: { sub: 'MistralAI' }, flaky: true },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Le Chat', opts: { appId: '6740410176' } },
    { id: 'android', sub: 'app', type: 'gplay', name: 'Google Play：Le Chat', opts: { pkg: 'ai.mistral.chat' } },
  ],
  perplexity: [
    { id: 'hub', sub: 'blog', type: 'render', name: 'Perplexity 博客 Hub（JS 渲染）', url: 'https://www.perplexity.ai/hub' },
    { id: 'pro', sub: 'pricing', type: 'render', name: 'Perplexity Pro 价格页（JS 渲染）', url: 'https://www.perplexity.ai/pro', keyword: PRICE_KW },
    { id: 'api-pricing', sub: 'pricing', type: 'page', name: 'API 价格（文档）', url: 'https://docs.perplexity.ai/getting-started/pricing', keyword: '$' },
    { id: 'changelog', sub: 'changelog', type: 'page', name: 'API 更新日志', url: 'https://docs.perplexity.ai/changelog/changelog' },
    { id: 'status', sub: 'status', type: 'rss', name: '服务状态', url: 'https://status.perplexity.com/history.rss', maxItems: 15 },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/perplexity_ai', opts: { sub: 'perplexity_ai' }, flaky: true },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Perplexity', opts: { appId: '1668000334' } },
    { id: 'android', sub: 'app', type: 'gplay', name: 'Google Play：Perplexity', opts: { pkg: 'ai.perplexity.app.android' } },
  ],
  cursor: [
    { id: 'changelog', sub: 'changelog', type: 'rss', name: '更新日志', url: 'https://cursor.com/changelog/rss.xml' },
    { id: 'blog', sub: 'blog', type: 'sitemap', name: '博客新文章（sitemap）', url: 'https://cursor.com/sitemap.xml', opts: { filter: '/blog/' } },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Cursor 价格页', url: 'https://cursor.com/pricing' },
    { id: 'students', sub: 'pricing', type: 'page', name: '学生优惠页', url: 'https://www.cursor.com/students' },
    { id: 'forum', sub: 'forum', type: 'discourse', name: '官方论坛（Discourse）', url: 'https://forum.cursor.com' },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/cursor', opts: { sub: 'cursor' }, flaky: true },
    { id: 'status', sub: 'status', type: 'rss', name: '服务状态', url: 'https://status.cursor.com/history.rss', maxItems: 15, on: false },
  ],
  'github-copilot': [
    { id: 'changelog', sub: 'changelog', type: 'rss', name: 'Copilot 更新日志', url: 'https://github.blog/changelog/label/copilot/feed/' },
    { id: 'blog', sub: 'blog', type: 'rss', name: 'GitHub 博客 · Copilot', url: 'https://github.blog/ai-and-ml/github-copilot/feed/' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Copilot 套餐价格页', url: 'https://github.com/features/copilot/plans', keyword: PRICE_KW },
    { id: 'plans-docs', sub: 'pricing', type: 'page', name: 'Copilot 套餐说明（文档）', url: 'https://docs.github.com/en/copilot/get-started/plans' },
    { id: 'vscode', sub: 'changelog', type: 'rss', name: 'VS Code 发布说明', url: 'https://code.visualstudio.com/feed.xml', on: false },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/GithubCopilot', opts: { sub: 'GithubCopilot' }, flaky: true },
    { id: 'bluesky', sub: 'social', type: 'bluesky', name: 'Bluesky：@github.com', opts: { handle: 'github.com' } },
    { id: 'youtube', sub: 'youtube', ...yt('UC7c3Kb6jYCRj4JOHHZTxKsQ'), name: 'GitHub YouTube' },
    { id: 'status', sub: 'status', type: 'rss', name: 'GitHub 服务状态', url: 'https://www.githubstatus.com/history.rss', maxItems: 15, on: false },
  ],
  midjourney: [
    { id: 'updates', sub: 'changelog', type: 'render', name: '官方更新页（JS 渲染）', url: 'https://www.midjourney.com/updates' },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/midjourney', opts: { sub: 'midjourney' }, flaky: true },
  ],
  notion: [
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Notion 价格页', url: 'https://www.notion.com/pricing' },
    { id: 'releases', sub: 'changelog', type: 'page', name: '版本发布页', url: 'https://www.notion.com/releases' },
    { id: 'bluesky', sub: 'social', type: 'bluesky', name: 'Bluesky：@notion.com', opts: { handle: 'notion.com' } },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/Notion', opts: { sub: 'Notion' }, flaky: true },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Notion', opts: { appId: '1232780281' } },
  ],
  adobe: [
    { id: 'firefly', sub: 'pricing', type: 'render', name: 'Firefly 套餐页', url: 'https://www.adobe.com/products/firefly/plans.html' },
    { id: 'cc', sub: 'pricing', type: 'render', name: 'Creative Cloud 套餐页', url: 'https://www.adobe.com/creativecloud/plans.html' },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/Adobe', opts: { sub: 'Adobe' }, flaky: true },
  ],
  canva: [
    { id: 'pricing', sub: 'pricing', type: 'render', name: 'Canva 价格页（JS 渲染）', url: 'https://www.canva.com/pricing/', keyword: PRICE_KW },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Canva', opts: { appId: '897446215' } },
    { id: 'android', sub: 'app', type: 'gplay', name: 'Google Play：Canva', opts: { pkg: 'com.canva.editor' } },
  ],
  figma: [
    { id: 'blog', sub: 'blog', type: 'rss', name: 'Figma 博客', url: 'https://www.figma.com/blog/feed/atom.xml', maxItems: 60 },
    { id: 'release-notes', sub: 'changelog', type: 'page', name: '发布说明', url: 'https://www.figma.com/release-notes/' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Figma 价格页', url: 'https://www.figma.com/pricing/', keyword: PRICE_KW },
    { id: 'education', sub: 'pricing', type: 'page', name: 'Figma 教育版', url: 'https://www.figma.com/education/' },
  ],
  elevenlabs: [
    { id: 'blog', sub: 'blog', type: 'rss', name: 'ElevenLabs 博客', url: 'https://elevenlabs.io/blog/rss.xml' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'ElevenLabs 价格页', url: 'https://elevenlabs.io/pricing', keyword: PRICE_KW },
    { id: 'changelog', sub: 'changelog', type: 'page', name: '更新日志', url: 'https://elevenlabs.io/docs/changelog' },
    { id: 'bluesky', sub: 'social', type: 'bluesky', name: 'Bluesky：@elevenlabs.io', opts: { handle: 'elevenlabs.io' } },
    { id: 'sdk', sub: 'github', type: 'github', name: 'GitHub：elevenlabs-python 发布', opts: { repo: 'elevenlabs/elevenlabs-python', what: 'releases' }, on: false },
  ],
  runway: [
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Runway 价格页', url: 'https://runwayml.com/pricing' },
    { id: 'news', sub: 'blog', type: 'render', name: 'Runway 新闻（JS 渲染）', url: 'https://runway.com/news' },
    { id: 'sitemap', sub: 'blog', type: 'sitemap', name: 'Runway 新文章（sitemap）', url: 'https://runway.com/sitemap.xml', opts: { filter: '/news/' } },
    { id: 'educators', sub: 'pricing', type: 'page', name: 'Runway 教育/学生优惠页', url: 'https://runway.com/educators', interval: 240 },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Runway', opts: { appId: '1665024375' } },
  ],
  suno: [
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Suno 价格页', url: 'https://suno.com/pricing' },
    { id: 'blog', sub: 'blog', type: 'page', name: 'Suno 博客', url: 'https://suno.com/blog' },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Suno', opts: { appId: '6480136315' } },
    { id: 'android', sub: 'app', type: 'gplay', name: 'Google Play：Suno', opts: { pkg: 'com.suno.android' } },
  ],
  aws: [
    { id: 'blog', sub: 'blog', type: 'rss', name: 'AWS 官方博客', url: 'https://aws.amazon.com/blogs/aws/feed/' },
    { id: 'whats-new', sub: 'changelog', type: 'rss', name: "AWS What's New", url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/', maxItems: 60 },
    { id: 'ml-blog', sub: 'blog', type: 'rss', name: 'AWS 机器学习博客', url: 'https://aws.amazon.com/blogs/machine-learning/feed/' },
    { id: 'free', sub: 'pricing', type: 'page', name: 'AWS 免费套餐页', url: 'https://aws.amazon.com/free/' },
    { id: 'bedrock', sub: 'pricing', type: 'page', name: 'Amazon Bedrock 价格', url: 'https://aws.amazon.com/bedrock/pricing/', keyword: 'free,discount,promo,credit,%' },
  ],
  gcp: [
    { id: 'blog', sub: 'blog', type: 'rss', name: 'Google Cloud 博客', url: 'https://cloudblog.withgoogle.com/rss/' },
    { id: 'release-notes', sub: 'changelog', type: 'rss', name: 'Google Cloud 发布说明', url: 'https://cloud.google.com/feeds/gcp-release-notes.xml' },
    { id: 'vertex-pricing', sub: 'pricing', type: 'page', name: 'Vertex AI 生成式 AI 价格', url: 'https://cloud.google.com/vertex-ai/generative-ai/pricing', keyword: 'free,discount,promo,credit,%' },
    { id: 'free', sub: 'pricing', type: 'page', name: 'Google Cloud 免费计划', url: 'https://cloud.google.com/free', keyword: 'free,credit,$' },
    { id: 'startup', sub: 'pricing', type: 'page', name: 'Google for Startups 云计划', url: 'https://cloud.google.com/startup', keyword: 'credit,$,free' },
    { id: 'status', sub: 'status', type: 'rss', name: '服务状态', url: 'https://status.cloud.google.com/en/feed.atom', on: false },
  ],
  azure: [
    { id: 'blog', sub: 'blog', type: 'rss', name: 'Azure 博客', url: 'https://azure.microsoft.com/en-us/blog/feed/' },
    { id: 'updates', sub: 'changelog', type: 'rss', name: 'Azure 更新', url: 'https://www.microsoft.com/releasecommunications/api/v2/azure/rss', maxItems: 60 },
    { id: 'foundry-blog', sub: 'blog', type: 'rss', name: 'Microsoft Foundry 官方博客', url: 'https://devblogs.microsoft.com/foundry/feed/' },
    { id: 'openai-pricing', sub: 'pricing', type: 'page', name: 'Azure OpenAI 价格', url: 'https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/', keyword: 'free,discount,promo,credit,%' },
    { id: 'free', sub: 'pricing', type: 'page', name: 'Azure 免费服务', url: 'https://azure.microsoft.com/en-us/pricing/free-services' },
    { id: 'students', sub: 'pricing', type: 'page', name: 'Azure for Students', url: 'https://azure.microsoft.com/en-us/free/students', keyword: 'free,credit,$' },
  ],
  cloudflare: [
    { id: 'blog', sub: 'blog', type: 'rss', name: 'Cloudflare 博客', url: 'https://blog.cloudflare.com/rss/' },
    { id: 'changelog', sub: 'changelog', type: 'rss', name: '开发者更新日志', url: 'https://developers.cloudflare.com/changelog/rss/index.xml', maxItems: 60, opts: { maxBytes: 32*1024*1024 } },
    { id: 'workers-ai', sub: 'pricing', type: 'page', name: 'Workers AI 价格', url: 'https://developers.cloudflare.com/workers-ai/platform/pricing/' },
    { id: 'plans', sub: 'pricing', type: 'page', name: 'Cloudflare 套餐页', url: 'https://www.cloudflare.com/plans/', keyword: PRICE_KW },
    { id: 'bluesky', sub: 'social', type: 'bluesky', name: 'Bluesky：@cloudflare.social', opts: { handle: 'cloudflare.social' } },
    { id: 'status', sub: 'status', type: 'rss', name: '服务状态', url: 'https://www.cloudflarestatus.com/history.rss', on: false },
  ],
  deepseek: [
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'API 价格页', url: 'https://api-docs.deepseek.com/quick_start/pricing' },
    { id: 'pricing-zh', sub: 'pricing', type: 'page', name: 'API 价格页（中文）', url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing' },
    { id: 'updates', sub: 'changelog', type: 'page', name: 'API 更新日志', url: 'https://api-docs.deepseek.com/updates' },
    { id: 'news', sub: 'blog', type: 'sitemap', name: '官方公告（sitemap）', url: 'https://api-docs.deepseek.com/sitemap.xml', opts: { filter: '/news/' } },
    { id: 'status', sub: 'status', type: 'rss', name: '服务状态', url: 'https://status.deepseek.com/history.rss', maxItems: 15 },
    { id: 'reddit', sub: 'reddit', type: 'reddit', name: 'r/DeepSeek', opts: { sub: 'DeepSeek' }, flaky: true },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：DeepSeek', opts: { appId: '6737597349' } },
    { id: 'android', sub: 'app', type: 'gplay', name: 'Google Play：DeepSeek', opts: { pkg: 'com.deepseek.chat' } },
  ],
  kimi: [
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Kimi API 价格页', url: 'https://platform.moonshot.cn/docs/pricing/chat' },
    { id: 'pricing-intl', sub: 'pricing', type: 'page', name: 'Kimi API 价格页（国际）', url: 'https://platform.moonshot.ai/docs/pricing/chat' },
    { id: 'status', sub: 'status', type: 'page', name: '服务状态页（history.rss 已 404，改为网页监控）', url: 'https://status.moonshot.cn/' },
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Kimi', opts: { appId: '6474233312' } },
  ],
  zhipu: [
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Z.ai API 价格', url: 'https://docs.z.ai/guides/overview/pricing' },
    { id: 'releases', sub: 'changelog', type: 'page', name: '智谱开放平台 新品发布', url: 'https://docs.bigmodel.cn/cn/update/new-releases' },
    { id: 'autoclaw-blog', sub: 'blog', type: 'page', name: 'AutoClaw 官方博客（活动公告）', url: 'https://autoclaw.z.ai/blog' },
  ],
  qwen: [
    { id: 'models', sub: 'pricing', type: 'page', name: '百炼 模型调用价格', url: 'https://help.aliyun.com/zh/model-studio/model-pricing' },
    { id: 'free-quota', sub: 'pricing', type: 'page', name: '百炼 新人免费额度', url: 'https://help.aliyun.com/zh/model-studio/new-free-quota' },
    { id: 'new-models', sub: 'changelog', type: 'page', name: '百炼 新发布模型', url: 'https://help.aliyun.com/zh/model-studio/newly-released-models', keyword: ZH_KW },
    { id: 'bailian', sub: 'pricing', type: 'page', name: '阿里云百炼 产品页', url: 'https://www.aliyun.com/product/bailian' },
    { id: 'coding-plan', sub: 'pricing', type: 'page', name: '百炼 Coding Plan 套餐与优惠', url: 'https://help.aliyun.com/zh/model-studio/coding-plan', keyword: ZH_KW },
  ],
  doubao: [
    { id: 'pricing', sub: 'pricing', type: 'render', on: false, name: '火山方舟 模型价格（2026-10 实测 403，默认关闭）', url: 'https://www.volcengine.com/docs/82379/1544106', keyword: '元,免费,折,token' },
    { id: 'activity', sub: 'pricing', type: 'page', name: '火山方舟 优惠活动页', url: 'https://www.volcengine.com/activity/ark' },
    { id: 'product', sub: 'pricing', type: 'render', name: '火山方舟 产品页（JS 渲染）', url: 'https://www.volcengine.com/product/ark', keyword: ZH_KW },
    { id: 'releases', sub: 'changelog', type: 'render', name: '火山方舟 产品动态', url: 'https://www.volcengine.com/docs/82379/1159176' },
  ],
  ernie: [
    { id: 'qianfan', sub: 'pricing', type: 'page', name: '百度千帆 产品页', url: 'https://cloud.baidu.com/product/wenxinworkshop' },
    { id: 'cloud-news', sub: 'news', type: 'page', name: '百度智能云 官方动态', url: 'https://cloud.baidu.com/news/index.html', keyword: '千帆,文心,ERNIE,免费,限免,降价', interval: 120 },
    { id: 'docs', sub: 'changelog', type: 'page', name: '千帆 开发者文档', url: 'https://cloud.baidu.com/doc/qianfan-docs/s/Mm8r1mejk' },
  ],
  hunyuan: [
    { id: 'pricing', sub: 'pricing', type: 'page', name: '腾讯混元 计费说明', url: 'https://cloud.tencent.com/document/product/1729/97731' },
    { id: 'releases', sub: 'changelog', type: 'page', name: '腾讯混元 产品动态', url: 'https://cloud.tencent.com/document/product/1729/104753' },
    { id: 'github', sub: 'github', type: 'github', name: 'GitHub：HunyuanVideo', opts: { repo: 'Tencent-Hunyuan/HunyuanVideo', what: 'commits' }, on: false },
  ],
  spark: [
    { id: 'api', sub: 'pricing', type: 'render', name: '星火 API 页（JS 渲染）', url: 'https://xinghuo.xfyun.cn/sparkapi' },
    { id: 'docs', sub: 'changelog', type: 'page', name: '星火 Web API 文档', url: 'https://www.xfyun.cn/doc/spark/Web.html' },
  ],
  devin: [
    { id: 'blog', sub: 'blog', type: 'rss', name: '官方博客 RSS', url: 'https://devin.ai/rss.xml' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Devin 价格页', url: 'https://devin.ai/pricing', keyword: PRICE_KW },
    { id: 'sitemap', sub: 'blog', type: 'sitemap', name: '官网新页面（sitemap）', url: 'https://devin.ai/sitemap.xml' },
    { id: 'youtube', sub: 'youtube', ...yt('UCk_Il3HoK3qTz1tvzyphozg'), name: 'YouTube 官方频道' },
  ],
  manus: [
    { id: 'blog', sub: 'blog', type: 'page', name: 'Manus 博客', url: 'https://manus.im/blog' },
    { id: 'updates', sub: 'changelog', type: 'page', name: 'Manus 更新', url: 'https://manus.im/updates' },
    { id: 'help-sitemap', sub: 'changelog', type: 'sitemap', name: '帮助中心新文章（sitemap，含活动/补偿说明）', url: 'https://help.manus.im/sitemap.xml', opts: { filter: '/en/articles/' }, interval: 240 },
    { id: 'pricing', sub: 'pricing', type: 'render', name: 'Manus 价格页（JS 渲染）', url: 'https://manus.im/pricing', keyword: PRICE_KW },
    { id: 'sitemap', sub: 'blog', type: 'sitemap', name: '官网新页面（sitemap）', url: 'https://manus.im/sitemap.xml' },
    { id: 'youtube', sub: 'youtube', ...yt('UCQgFQdqiFQ_LfFBGP6z9dqQ'), name: 'YouTube 官方频道' },
  ],
  coze: [
    { id: 'docs-sitemap', sub: 'changelog', type: 'sitemap', name: '扣子文档新页面（sitemap，含套餐活动调整）', url: 'https://docs.coze.cn/sitemap.xml', interval: 240 },
    { id: 'pricing', sub: 'pricing', type: 'page', name: '扣子 订阅套餐', url: 'https://docs.coze.cn/guides_edition', keyword: ZH_KW },
    { id: 'github', sub: 'github', type: 'github', name: 'GitHub：Coze Studio 发布', opts: { repo: 'coze-dev/coze-studio', what: 'releases' } },
  ],
  dify: [
    { id: 'blog', sub: 'blog', type: 'page', name: 'Dify 博客', url: 'https://dify.ai/blog' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'Dify 价格页', url: 'https://dify.ai/pricing', keyword: PRICE_KW },
    { id: 'education', sub: 'pricing', type: 'page', name: 'Dify 教育计划', url: 'https://dify.ai/education' },
    { id: 'github', sub: 'github', type: 'github', name: 'GitHub：Dify 发布', opts: { repo: 'langgenius/dify', what: 'releases' } },
    { id: 'youtube', sub: 'youtube', ...yt('UC2JZCsZSOudXA08cMMRCL9g'), name: 'YouTube 官方频道' },
  ],
  langchain: [
    { id: 'blog', sub: 'blog', type: 'rss', name: '官方博客 RSS', url: 'https://www.langchain.com/blog/rss.xml' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'LangSmith 价格页', url: 'https://www.langchain.com/pricing', keyword: PRICE_KW },
    { id: 'startups', sub: 'pricing', type: 'page', name: '创业公司计划', url: 'https://www.langchain.com/startups' },
    { id: 'status', sub: 'status', type: 'rss', name: 'LangSmith 服务状态', url: 'https://status.smith.langchain.com/history.rss', maxItems: 15 },
    { id: 'github', sub: 'github', type: 'github', name: 'GitHub：LangChain 发布', opts: { repo: 'langchain-ai/langchain', what: 'releases' }, on: false },
    { id: 'youtube', sub: 'youtube', ...yt('UCC-lyoTfSrcJzA1ab3APAgw'), name: 'YouTube 官方频道' },
  ],
  n8n: [
    { id: 'blog', sub: 'blog', type: 'rss', name: '官方博客 RSS', url: 'https://n8n.io/blog/feed' },
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'n8n 价格页', url: 'https://n8n.io/pricing', keyword: PRICE_KW },
    { id: 'changelog', sub: 'changelog', type: 'page', name: 'n8n 更新日志', url: 'https://docs.n8n.io/changelog' },
    { id: 'community', sub: 'forum', type: 'discourse', name: '社区论坛（Discourse）', url: 'https://community.n8n.io', on: false },
    { id: 'github', sub: 'github', type: 'github', name: 'GitHub：n8n 发布', opts: { repo: 'n8n-io/n8n', what: 'releases' } },
  ],
  genspark: [
    { id: 'ios', sub: 'app', type: 'appstore', name: 'App Store：Genspark', opts: { appId: '6739554054', country: 'us' } },
  ],
  minimax: [
    { id: 'pricing', sub: 'pricing', type: 'page', name: 'MiniMax API 价格（国际）', url: 'https://platform.minimax.io/docs/guides/pricing' },
    { id: 'news', sub: 'blog', type: 'page', name: 'MiniMax 新闻（国际）', url: 'https://www.minimax.io/news' },
    { id: 'news-cn', sub: 'blog', type: 'page', name: 'MiniMax 新闻（中国）', url: 'https://www.minimaxi.com/news' },
  ],
};
// 每个厂商自动追加：Google 新闻优惠搜索 + Hacker News（国际厂商）
const CN_GLOBAL = new Set(['deepseek', 'kimi', 'zhipu', 'qwen', 'minimax']); // 有海外产品，英文新闻也开启
const CN_VENDORS = new Set(['coze', 'deepseek', 'kimi', 'zhipu', 'qwen', 'doubao', 'ernie', 'hunyuan', 'spark', 'minimax']);
const HN_QUERY = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', xai: 'xAI', meta: 'Llama', mistral: 'Mistral', perplexity: 'Perplexity', cursor: 'Cursor', 'github-copilot': 'Copilot', 'ms-copilot': 'Microsoft Copilot', deepseek: 'DeepSeek', midjourney: 'Midjourney', devin: 'Devin', manus: 'Manus', dify: 'Dify', langchain: 'LangChain', n8n: 'n8n', genspark: 'Genspark' };
for (const list of Object.values(VENDOR_CHANNELS)) for (const c of list) if (c.type === 'reddit' && !c.interval) c.interval = 60;
for (const b of AI_BRANDS) {
  const list = VENDOR_CHANNELS[b.id] = VENDOR_CHANNELS[b.id] || [];
  if (CN_VENDORS.has(b.id)) list.push({ id: 'news-zh', sub: 'news', type: 'search', name: '中文新闻 · 优惠搜索', keyword: `${b.q} ${PROMO_ZH}`, region: 'cn' });
  list.push({ id: 'news-en', sub: 'news', type: 'search', name: '英文新闻 · 优惠搜索', keyword: `${b.q} ${PROMO_EN}`, on: !CN_VENDORS.has(b.id) || CN_GLOBAL.has(b.id) });
  if (HN_QUERY[b.id]) list.push({ id: 'hn', sub: 'forum', type: 'hn', name: 'Hacker News 讨论', opts: { query: HN_QUERY[b.id], minPoints: 20 } });
}
const CHANNEL_SUBS = { blog: '官方博客', changelog: '更新日志', pricing: '价格页', status: '状态公告', app: '应用商店', social: '官方社交', youtube: 'YouTube', github: 'GitHub', forum: '社区论坛', reddit: 'Reddit', news: '新闻搜索', other: '其它' };

const KNOWN_UNAVAILABLE = [
  { name: 'X / Twitter 官方账号', reason: '需要登录；nitter/xcancel 等镜像均已失效。可在设置中填写自建 RSSHub 实例后用「RSSHub 路由」协议添加（如 /twitter/user/OpenAI）' },
  { name: '微博 / 微信公众号 / B 站', reason: '需要登录或公共 RSSHub 403；支持填写自建 RSSHub 实例后添加（/weibo/user/…、/bilibili/user/video/…）' },
  { name: 'Discord 服务器', reason: '需要登录，无公开接口（已用官方 Discourse 论坛 / Reddit 代替）' },
  { name: 'Telegram 厂商官方频道', reason: '主流 AI 厂商没有官方 Telegram 频道；协议已支持 t.me/s 公开频道，可自行添加' },
  { name: '多数厂商的官方 Bluesky / Mastodon', reason: 'OpenAI、Anthropic（无内容）、Perplexity、Mistral、Adobe、Canva、AWS、Meta 无可用官方账号或长期不更新；已预置 GitHub、Notion、ElevenLabs、Cloudflare 官方 Bluesky' },
  { name: 'Reddit', reason: '可用，但匿名访问频繁会 429 限流（已标记为「不稳定」，自动退避重试）；JSON API 403，改用 RSS' },
  { name: 'GitHub Releases', reason: '可用，github.com 偶发 502/504（自动重试）；GitHub REST API 匿名 60 次/小时，预置渠道使用 Atom 订阅，API 模式供填 Token 后使用' },
  { name: 'bigmodel.cn 价格页、文心一言 yiyan.baidu.com、腾讯混元产品页', reason: '即使 JS 渲染也无可提取的价格文本（需登录），改用 Z.ai 文档 / 千帆 / 腾讯云文档' },
  { name: 'Microsoft Copilot 消费者版价格页 / Copilot App（App Store/Google Play）', reason: '404 或应用 ID 区域不可查' },
  { name: '机器之心', reason: '无 RSS，首页需要 JS 且列表结构为动态加载' },
  { name: '36氪 主站 RSS', reason: '连接超时；已改用 36氪快讯 RSS' },
  { name: 'Adobe / Notion / Canva 博客 RSS、Canva 新闻页', reason: '官方未提供 RSS（404）或 403；价格页已改用网页监控 / JS 渲染' },
  { name: 'Linux.do / NodeSeek 等小众社区、Telegram 优惠频道', reason: '按要求不预置小众来源（Linux.do 也启用了 Cloudflare 403）' },
  { name: 'Dealmoon、什么值得买 优惠 RSS、Amazon Best Sellers RSS', reason: '403 反爬 / 已下线' },
];

// v2.2 品牌分组；AI 大模型 / 智能体 / 创作工具默认全部启用
const BRAND_GROUPS = [
  { id: 'llm', name: '大模型', ai: true },
  { id: 'agent', name: 'AI 智能体 / 编程助手', ai: true },
  { id: 'creative', name: 'AI 创作工具', ai: true },
  { id: 'software', name: '通用软件', ai: false },
  { id: 'cloud', name: '云与算力', ai: false },
  { id: 'custom', name: '自定义', ai: false },
  { id: 'goods', name: '实物商品', ai: false },
];
const AI_GROUPS = BRAND_GROUPS.filter((g) => g.ai).map((g) => g.id);
// 合并：每个品牌/数据源带 category（ai / goods）。实物优惠默认关闭
const PRESET_BRANDS = [
  ...AI_BRANDS.map((b) => ({ ...b, category: 'ai' })),
  ...GOODS_BRANDS.map((b) => ({ ...b, category: 'goods', group: 'goods', on: false })),
];
const DEFAULT_ENABLED = AI_BRANDS.filter((b) => b.on).map((b) => b.name);
const PRESET_SOURCES = [
  ...AI_SOURCES.map((s) => ({ ...s, category: 'ai', defaultOn: true })),
  ...GOODS_SOURCES.map((s) => ({ ...s, category: 'goods', defaultOn: false })),
];

const DEFAULT_SETTINGS = {
  lang: 'auto', // 界面语言：auto（跟随系统）/ zh-CN / en

  intervalMinutes: 15,
  notify: true,
  notifyMax: 5,
  theme: 'dark',
  view: 'cards',
  closeToTray: true,
  proxyMode: 'system', // system | direct | custom
  proxyUrl: '',
  maxDeals: 3000,
  maxAgeDays: 30,
  startMinimized: false,
  autoStart: false,
  trayHintShown: false,
  onboarded: false,
  goodsEnabled: false, // 实物商品优惠（可选）
  // v2.0 专业设置
  concurrency: 8, // 同时抓取的站点数（v2.2：默认启用的 AI 厂商更多，6 → 8）
  hostGap: 1500, // 同一站点请求间隔（毫秒）
  backoff: true, // 连续失败的渠道自动退避
  httpCache: true, // ETag / If-Modified-Since 条件请求
  renderEnabled: true, // 允许 JS 渲染渠道（隐藏浏览器）
  rsshubBase: '', // 自建 RSSHub 实例地址
  dedupe: true, // 跨渠道去重合并
  sort: 'pub',
  rules: null, // 提醒规则（null = 使用默认规则）
  // v2.3 产品优化
  notifyMinConf: 50, // 只为可信度 ≥ 该值的优惠弹通知（0 = 全部）
  quietHours: false, quietStart: '23:00', quietEnd: '08:00', // 免打扰：期间的通知合并到结束时一次性提醒
  dailyDigest: true, digestTime: '09:00', lastDigestDay: '', // 每日要点摘要通知
  aiTranslate: true, // 配置了 AI 时：英文优惠标题自动翻译成中文并生成一句话要点（结果缓存）
  noiseWords: [], noiseSources: {}, // 「不是优惠」反馈学到的屏蔽词 / 来源计数
  hideIgnored: true, // 列表默认隐藏「已忽略」
  // v2.5
  hideResellers: false, // 隐藏第三方中转 / 账号转售类「优惠」
  aiClassify: true, // 配置了 AI 时：批量把可疑条目分类为优惠 / 噪声（结果缓存）
  enrichLimit: 40, // 每轮最多 AI 翻译条数（需配置 Key）
  dealsSchema: 0, // 已有优惠数据的迁移版本
  // v2.6
  profile: { region: 'any', student: false, userType: 'any', pay: [] }, // 「适用于我」画像：region any/cn/overseas；userType any/new/existing；pay unionpay/alipay/wechat/card
  hideExpired: true, // 列表默认隐藏已过期优惠
  notifyMineOnly: false, // 只通知适用于我的优惠
  channels: [], views: [], weeklyDigest: false, weeklyDay: 1, // v2.8：推送渠道 / 保存的视图 / 每周周报（默认周一）
  adaptivePolling: true, // v2.7：按变化频率自适应轮询
  adaptiveMaxMin: 360, // 自适应间隔上限（分钟）
  learnEnabled: true, // v2.7：根据你的反馈学习偏好
  priceAlertPct: 0, // v2.7：价格变化超过该百分比才提醒（0 = 任何变化）
  filterMine: false, // v2.6.1：列表「只看适用于我」勾选状态（重启后保留）
  listFilters: { type: '', valid: '', sort: 'pub', region: '', platform: '', news: false }, // v2.14：列表筛选（不含搜索词）
  lastSeenVersion: '', // v2.14：已看过更新说明的版本
  recheckHours: 12, // 落地页复查间隔（小时）
};

// 默认提醒规则（规则引擎）：厂商 + 优惠类型 + 关键词 → 通知 / 声音 / 高亮
const DEFAULT_RULES = [
  { id: 'r-all', name: '所有新优惠', enabled: true, vendors: [], types: [], keywords: [], exclude: [], minScore: 0, notify: true, sound: false, highlight: '' },
  { id: 'r-big', name: '免费 / 赠送额度 / 学生（重点）', enabled: true, vendors: [], types: ['free', 'credits', 'student'], keywords: [], exclude: [], minScore: 0, notify: true, sound: true, highlight: '#16a34a' },
  { id: 'r-price', name: '官方价格页变动', enabled: true, vendors: [], types: ['pricing'], keywords: [], exclude: [], minScore: 0, notify: true, sound: true, highlight: '#db2777' },
  { id: 'r-example', name: '示例：OpenAI / Claude 降价（默认停用）', enabled: false, vendors: ['openai', 'anthropic'], types: ['discount'], keywords: [], exclude: [], minScore: 0, notify: true, sound: false, highlight: '#f59e0b' },
];

module.exports = { BRAND_GROUPS, AI_GROUPS, DEFAULT_RULES, AI_SOURCES, VENDOR_CHANNELS, CHANNEL_SUBS, PRESET_BRANDS, DEFAULT_ENABLED, GOODS_DEFAULT_ENABLED, PRESET_SOURCES, KNOWN_UNAVAILABLE, DEFAULT_SETTINGS };
