# DealRadar 数据源覆盖率分析（2026-10-21）

## 结论
- **基线覆盖率：25/40 = 62.5%** → **优化后：33/40 = 82.5%**（同一套真实优惠样本、同一测量脚本）
- **没有达到 99%。** 按「只用主流、免登录来源」的约束，实测上限约在 85% 左右；剩余缺口主要只在 X/LinkedIn/官方帮助中心（需要登录或反爬）或地区运营商官网上首发。下文列出原因。
- 「覆盖全世界所有来源」无法直接测量，所以本报告用「近 90 天真实优惠样本的捕获率」做可验证的指标。

## 方法
1. **真实优惠样本**（`coverage/ground-truth.json`）：通过网页搜索核实的 40 条优惠，时间为 2026-07 下旬至 10-21。覆盖 26 个预置厂商，地区包括美国、全球、中国、日本、韩国、印度、东南亚、拉美、非洲和欧盟。类型有免费、学生、额度、降价/调价和运营商合作，每条都附带官方或媒体证据链接。部分发布日期是估计值，已在文件里写明。
2. **判定规则**（`coverage/measure.js`，规则比较保守）：
   - A 价格页或活动页监控：渠道 URL 就是证据页 → 算捕获
   - B Sitemap：证据 URL 出现在渠道 sitemap 中 → 算捕获
   - C 列表型（RSS 等）：当前抓取结果里有证据链接；Discourse 论坛同站新帖也算
   - D Google 新闻：用渠道**真实关键词**加上 `after:/before:` 回放「发布日前 2 天到后 14 天」，标题命中该优惠的专属正则才算。Bing 无法按日期回放，不计入
   - 全局媒体 RSS 只按当前抓取结果计算，偏保守
3. 基线用的是改动前的 `defaults.js`（`coverage/.defaults-base.js`），终值用改动后的版本；测量脚本和样本完全相同。
4. 正则调过一次，去掉了误报，比如把「Hands-Free」误判成 free、「cut off」误判成降价。

## 现状盘点（改动前 → 改动后）
- AI 厂商 38 个，默认启用 30 个。
- 厂商渠道 264 → 266 个，默认开启 237 → 244 个。按协议分：page 77、search 48、rss 35、hn 17、github 14、reddit 13、render 13、appstore 13、gplay 10、youtube 9、sitemap 7、discourse 4、bluesky 4。内容语言约为英文 210、中文 54。
- 全局 AI 源 27 → 53 个。改动前只有中文和英文；改动后增加日、韩、繁中、印度、印尼、巴西、拉美西语、德、法、阿语。
- 健康度（纯 Node 实测 264 个渠道）：失败 18 个，其中 13 个是 JS 渲染渠道，只能在桌面应用里运行，Node 环境无法测试，不算故障。真正故障有 5 个：
  - kimi-status：history.rss 404，**已改为网页监控**，实测可用
  - doubao-pricing、doubao-releases：页面需要 JS，**已改为 render 渲染**，需要在桌面端验证
  - anthropic-reddit、cursor-reddit：Reddit 匿名 429 限流，属于偶发，保留「不稳定」标记
  - 任务里提到的「23 个失败」在本次 Node 实测中没有复现；差额应来自应用内的渲染、退避或限流状态。

## 本次改动（分支 `sources-coverage`）
- 新增 10 个 Google 新闻地区版厂商搜索，各用当地语言的优惠关键词，每 2 小时一次：ja、ko、zh-TW、en-IN、id、pt-BR、es-419、de、fr、ar
- 新增 16 个地区主流媒体和社区，均已实测可抓取：GeekNews（韩国）、ITmedia AI+、GIGAZINE、Zenn、Qiita、Tech in Asia、Inc42、YourStory、Xataka、Genbeta、TecMundo、Tecnoblog、heise、01net、AITNews（中东）、iThome 台湾。e27 返回 403，已剔除。
- 修复搜索词 bug：xAI、Kimi、智谱、MiniMax 原来的写法是隐式 AND（例如 `Kimi 月之暗面`），漏报很多，已改成 OR。
- 扩大搜索词：千问/Qwen、文心/ERNIE、讯飞 Spark、Meta Muse Spark、Runway、智谱 AutoClaw
- 中国厂商里有海外产品的（DeepSeek、Kimi、智谱、千问、MiniMax）开启英文新闻搜索
- 新增官方渠道：百炼 Coding Plan 页、AutoClaw 官方博客
- x.ai sitemap 用 curl 可以访问，但 Node fetch 返回 403，因此没有加入

## 剩余缺口（7 条）及原因
| 样本 | 原因 | 能否用主流免登录来源解决 |
|---|---|---|
| ChatGPT 美国学生 4 个月免费 | 活动页是 /students/2026（年份路径），旧页面会跳到 /use-cases/students；help.openai.com 和 chatgpt.com 的 sitemap 都返回 403 | 部分可以：每年手动更新活动页，或者用桌面 JS 渲染监控 help 中心 |
| ChatGPT 推荐活动（印尼、墨西哥、印度） | 只在 OpenAI 帮助中心发布（403），媒体报道少 | 很难 |
| 印尼 Indosat Gemini | 只在运营商官网和印尼本地小媒体上发布 | 需要逐个监控运营商官网，不符合「不加小众源」的要求 |
| Runway 学生 75 折 | 只在 LinkedIn 和 X 上发布（需要登录） | 需要 RSSHub 或登录 |
| 讯飞 Spark X2.5 限免、文心 4.0 限免 | 只在官方公众号、微博或活动页发布，主流新闻标题里没有「限免」 | 需要微信或微博（RSSHub 加登录） |
| Grok 企业版免费两周 | 只在 x.ai/news 发布（JS 页面、反爬），搜索结果里没有对应标题 | 桌面端已有 x.ai/news 渲染监控，Node 测量算不进去 |

**上限说明：** 社交和私域渠道包括 X、LinkedIn、微信公众号、微博、Discord、官方帮助中心。它们需要登录或者有强反爬，所以按「主流、免登录」的要求，99% 达不到。如果用户自建 RSSHub 并配置 X/微博/公众号路由（应用已支持 `rsshub` 协议），预计还能覆盖 3～4 条，大约到 90～92%。

## 复现
```
node coverage/inventory.js
DR_DEFAULTS=$PWD/coverage/.defaults-base.js node coverage/measure.js coverage/baseline.json   # 基线
node coverage/measure.js coverage/final.json                                                   # 终值
node coverage/test-new-sources.js <源 id...>                                                   # 新源抓取测试
```

---

## 第二轮（2026-10-21，UTC+8）

### 方法
- 真值集扩充到 94 条（近约 120 天）：dev 66 条（gt01–gt66），holdout 28 条（h01–h28）。holdout 在加源结束、源冻结之后才收集，没有据它调整任何源。
- 判定规则与第一轮相同（A/A2/B/C/D），D 为 Google News 回放查询；Bing 不计入。测量在 Electron（xvfb）下进行，含 JS 渲染。
- 对照基线 `coverage/.defaults-r2base.js` 为第二轮开始时的源配置。

### 结果
| 集合 | 第二轮基线 | 第二轮最终 |
|---|---|---|
| dev（66） | 54/66 = 81.8% | 59/66 = 89.4% |
| holdout（28） | 21/28 = 75.0% | 21/28 = 75.0% |
| 合计（94） | 75/94 = 79.8% | 80/94 = 85.1% |

**结论：dev 的提升没有在 holdout 上复现**，holdout 前后没有变化。新增的源基本只覆盖到 dev 里已知的那几条，说明这一轮的收益对未知优惠的泛化很有限。按“有意义的提升才发布”的标准，本轮**不发布 v2.6.0**。

### 请求量
约 1339 次/小时（0.37 次/秒），低于第二轮开始时的 1822 次/小时。请求最多的站点：news.google.com 283/h，hn.algolia.com 188/h。

### 剩余未覆盖项及所需条件
dev（7 条）：
- gt11 Indosat：新闻列表是 JS 渲染且没有文章 slug，需要运营商提供 RSS。
- gt33、gt34 讯飞/文心限免：只在控制台或活动页出现，没有公开 feed，主流新闻也未报道。
- gt41 Notion 额度：帮助中心 sitemap 没有收录这篇文章。
- gt49 德国电信：只在 telekom.de 的产品页出现，没有新闻稿。
- gt54 扣子企业版 3.6 折：火山引擎活动页需要登录。
- gt55 ChatGPT Business 首月免费：help.openai.com 的 sitemap 返回 403，相关文章也不在已渲染的 collection 里。

holdout（7 条）：
- h04 Runway 定价改动：只能通过定价页 diff 看到，需要对定价页做内容差异监控。
- h05、h06 Rappi / Claro 的 ChatGPT 合作：需要拉美伙伴或运营商的官方页，主流新闻检索未命中。
- h10 讯飞 MaaS：理由同 gt33。
- h19 Bedrock 降价、h28 Azure/Foundry 降价：云厂商降价写在定价页或开发者博客里。可加 AWS What's New RSS 和 Foundry devblog RSS，属主流官方源，但为了保持 holdout 的盲测性，本轮没有加。
- h22 Devin 内 Gemini 4 Argon 折扣：只出现在应用内或聚合站。

### 上限
主流、免登录来源下，可实现的覆盖率估计在 **约 85–90%**。剩下约 10–15% 是只在登录后控制台、App 内、定价页静默改动或运营商零散页面出现的优惠。99% 在当前约束（不登录、不绕过封锁、只用主流源）下**做不到**。
