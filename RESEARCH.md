# DealRadar 调研：相关论文与开源项目（v2.7 / v2.8 依据）

> 2026-10-21 调研。每项给出：它做什么 → DealRadar 能学什么。链接都在本次调研中打开或搜索核对过；只写了能从这些来源确认的内容。

## 一、开源项目

| 项目 | 它做什么 | DealRadar 能学什么 |
|---|---|---|
| **changedetection.io** <br>https://github.com/dgtlmoon/changedetection.io/ · 文档 https://dgtlmoon-changedetection-io.mintlify.app/advanced/processors | 网页变化监控。`restock_diff` 处理器按 JSON-LD / OpenGraph / microdata 读取价格、库存、币种（找不到时退回到 HTML 文本），保存价格历史并画图。可以设置价格上下限和「变化超过 x% 才提醒」。 | ① 价格页不能只做文本 diff，应先**抽出结构化价格**（套餐、金额、币种、周期）再比较。② 提醒要有**阈值**，避免小波动刷屏。③ 用**价格历史图**展示走势。→ v2.7 价格表与历史 |
| **Miniflux** <br>https://miniflux.app/docs/configuration.html | RSS 阅读器。`POLLING_SCHEDULER=entry_frequency` 按订阅源过去一周的更新条数算下次抓取间隔，并夹在 MIN/MAX 之间。 | 按每个源的**更新频率**动态决定多久抓一次：省请求、少被限流。→ v2.7 自适应轮询 |
| **FreshRSS** <br>https://freshrss.github.io/FreshRSS/en/users/09_refreshing_feeds.html | 全局刷新间隔不少于 20 分钟，单个订阅不少于 15 分钟。 | 给每个源设**下限**，礼貌抓取，与现有的「同站点间隔 hostGap」互补。 |
| **Huginn** <br>https://github.com/huginn/huginn （WebsiteAgent / DigestAgent / DataOutputAgent） | 用「代理」拼工作流：WebsiteAgent 抓页面（on_change 模式），DigestAgent 把事件攒成定时摘要，DataOutputAgent 把事件输出为 RSS/JSON。 | ① **摘要**是独立的输出通道（每日 / 每周），② 结果可以**输出出去**给别的工具用。→ v2.8 摘要推送、Webhook |
| **Apprise** <br>https://github.com/caronc/apprise · https://appriseit.com/services/serverchan/ | 一个库统一推送到上百种服务，包括企业微信 `wecombot://`、飞书 `feishu://`、钉钉 `dingtalk://`、Telegram `tgram://`、Server酱 `schan://`。 | 通知通道应**统一抽象**：「通道类型 + 地址 / 令牌」，同一条消息格式化成各家的 JSON。→ v2.8 通知通道 |
| **RSSHub** <br>https://github.com/DIYgod/RSSHub | 给没有 RSS 的网站生成订阅（DealRadar 已支持「RSSHub 路由」协议）。 | 继续把需要登录或 JS 渲染的来源交给 RSSHub，不在本地硬抓。 |
| **n8n RSS Feed Trigger** <br>https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.rssfeedreadtrigger | 按计划轮询 RSS 并只发出新条目。 | 「只推新条目 + 去重」是自动化的基本要求；把 DealRadar 的新优惠用 **Webhook** 发给 n8n / Zapier，用户就能自己接后续流程。 |
| **Feedly AI 静音过滤** <br>https://feedly.com/ai/models/mute-filters | 按公司、人物、主题、作者、站点静音，并给内容排优先级、去重。 | 反馈要**细粒度**：除了「不是优惠」，还要能「少看这个来源 / 这个话题」。→ v2.7 反馈学习 |
| **PriceGhost** <br>https://github.com/clucraft/PriceGhost <br>（同类：Discount-Bandit https://github.com/cybrarist/discount-bandit） | 自托管价格追踪：价格历史、目标价 / 降价提醒，支持 Telegram / Discord / ntfy 推送；同类项目还有币种换算。 | **目标价提醒 + 换算成本币**。→ v2.7 价格统一换算成人民币 |
| **newsdiffs** <br>https://github.com/ecprice/newsdiffs | 定时抓新闻快照，展示文章被改动的历史。 | 价格页也要「版本史」，用户能看到「何时从 $20 改成 $17」。 |
| **Mozilla Readability / trafilatura** <br>https://github.com/mozilla/readability · 论文 https://aclanthology.org/2021.acl-demo.15/ | 提取正文，去掉导航、样式、脚本等模板噪声。trafilatura 在论文的基准里明显优于其他开源方案。 | 价格页 diff 前先**去模板噪声**（2.6.1 已过滤 CSS 类名行）。以后可以只比较「主体区块」。 |
| **datasketch MinHash LSH** <br>https://ekzhu.com/datasketch/lsh.html | MinHash 签名 + 分带 LSH，用 S 曲线 P(s)=1−(1−s^r)^b 在阈值附近召回近重复。 | 条目多时用 LSH 生成**候选对**，避免 O(N²) 两两比较；再用精确相似度确认。→ v2.7 MinHash 聚类候选 |
| **Newshound：大规模新闻聚类** <br>https://newshound.co/blog/2020/04/09/clustering-news-stories-scale | 120 维 MinHash、40 band × 3 行；命中多个 band 的才算同一事件。 | 用「命中 band 数」作为相似度门槛，控制误合并。 |

## 二、论文

| 论文 | 要点 | DealRadar 能学什么 |
|---|---|---|
| **Cho & Garcia-Molina, Estimating Frequency of Change**，ACM TOIT 2003 <br>https://dl.acm.org/doi/10.1145/857166.857170 | 把网页变化建模为泊松过程，并给出在「只知道某次检查时是否变过」的不完整历史下估计变化率 λ 的方法；用好的估计，爬虫「新鲜度」可提高 35%。 | 每个源记下「每次检查是否有新内容」，用其改进估计量 λ̂ = −ln((n−X+0.5)/(n+0.5))/Ī 算出变化率，再定检查间隔。→ v2.7 已实现 |
| **Broder 1997 shingling**；**Rodier & Carter, Online Near-Duplicate Detection of News Articles**，LREC 2020 <br>https://aclanthology.org/2020.lrec-1.156.pdf | 在线近重复检测：为每篇新文章找最可能的「原文」，可以在精度和召回之间调节。 | 新条目到达时**在线**找原报道，合并成「N 个来源」（v2.5 已用标题 bigram，v2.7 加 MinHash 候选）。 |
| **Charikar 2002（SimHash）**；**Manku 等, Detecting Near-Duplicates for Web Crawling**，WWW 2007 <br>https://research.google.com/pubs/archive/33026.pdf | 64 位 SimHash 指纹，海明距离 k=3 时精度、召回约 75%。 | 网页整页指纹适合判断「页面是否实质改变」，可以给价格页变化检测做第一层过滤。 |
| **TDT 试点研究（Allan 等 1998）** <br>https://www.cs.cmu.edu/~jgc/publication/Topic_Detection_Tracking_Pilot_DARPA_1998.pdf | 「首发报道检测」：按时间顺序处理，只有第一篇讲新事件的报道才标为新。后续评测说明这项任务很难。 | 通知只推**事件的第一篇**，后续报道只增加「来源数」不再弹窗（DealRadar 已基本如此）。不要对聚类期望过高，保守合并。 |
| **Dong 等, Knowledge-Based Trust**，VLDB 2015 <br>https://www.vldb.org/pvldb/vol8/p938-dong.pdf | 按来源所述事实的**正确率**而不是链接热度来估计可信度。 | 来源可靠度 = 「它推给你的东西被你确认为真优惠的比例」+ 抓取稳定性 + 是否官方。→ v2.7 来源可靠度 |
| **Paul Graham, A Plan for Spam** <br>https://www.paulgraham.com/spam.html | 按用户自己的标注学习词概率，取最「极端」的 15 个词组合判断。 | 用用户的「不是优惠 / 收藏 / 已领取」**在本机训练**朴素贝叶斯，给每条估计「你会感兴趣的概率」。→ v2.7 |
| **在线主动学习垃圾过滤**，CEAS 2007 <br>https://www.ceas.cc/2007/papers/paper-61.pdf；Settles 的主动学习综述（不确定性采样） | 只请用户标注分类器**最拿不准**的样本，标注成本低、效果好。 | 首页「帮我判断」只列概率接近 0.5 的几条，点 👍/👎 即可。→ v2.7 |
| **Chakrabarti 等, Focused Crawling**，WWW 1999 <br>https://www.cse.iitb.ac.in/~soumen/doc/www1999f/pdf/www1999f.pdf | 用相关性分类器加链接打分，只爬与主题相关的页面。 | 「发现新渠道」可以按已确认优惠的来源域名和链接优先扩展（后续版本）。 |
| **Vi-DIFF**（Pehlivan 等 2010）<br>https://link.springer.com/chapter/10.1007/978-3-642-15364-8_1 | 先渲染页面、切成视觉语义块，再按块比较增删改与移动。 | 价格页应**按区块（套餐卡片）比较**，不按整页文本。v2.7 先按「套餐 → 价格」结构化比较，是这个思路的轻量版。 |
| **NEXT-EVAL**（2025）https://arxiv.org/html/2505.17125；**JSONSchemaBench** https://doi.org/10.48550/arxiv.2501.10868 | 评测 LLM 从 HTML 抽取结构化记录，以及按 JSON Schema 约束输出；扁平 JSON 的效果最好（NEXT-EVAL 报告 F1 0.9567）。 | 用户配置了 AI 时，价格抽取可以让 LLM 输出**扁平 JSON**（plan / amount / currency / period），规则抽取作为兜底（后续版本）。 |
| **HN 排序公式** <br>https://news.ycombinator.com/item?id=1781013 · https://github.com/social-protocols/news | score = (票数−1)^0.8 / (年龄小时+2)^1.8，再乘各种惩罚系数。 | 「热度」排序可以用「来源数」当票数，配合时间衰减；低可靠来源乘惩罚系数。→ v2.7 排序加入可靠度 |

## 三、可落地技术排序（用户价值 ÷ 工作量）

| # | 技术 | 用户价值 | 工作量 | 版本 |
|---|---|---|---|---|
| 1 | 价格页结构化抽取 + 历史 + 人民币换算（changedetection.io / PriceGhost） | 高：一眼看到各家套餐价格和变化 | 中 | v2.7 |
| 2 | 多通道推送：Webhook / 企业微信 / 飞书 / 钉钉 / Telegram / Server酱 / ntfy（Apprise 的抽象） | 高：手机上也能收到 | 中 | v2.8 |
| 3 | 每日 / 每周摘要推送（Huginn DigestAgent） | 高 | 低 | v2.8 |
| 4 | 自适应轮询（Cho & Garcia-Molina + Miniflux 上下限） | 中：更省流量、更少被限流 | 低 | v2.7 |
| 5 | 反馈学习 + 不确定性采样（Graham NB + 主动学习） | 中高：越用越准 | 中 | v2.7 |
| 6 | 来源可靠度（KBT 思想的简化版） | 中 | 低 | v2.7 |
| 7 | 保存视图 → 可以直接设为提醒（Feedly 式） | 中 | 低 | v2.8 |
| 8 | 试用到期提醒 | 中 | 低 | v2.8 |
| 9 | 新手预设（学生 / 开发者 / 国内用户） | 中 | 低 | v2.8 |
| 10 | 分享卡片（图片 / Markdown） | 中 | 中 | v2.8 |
| 11 | MinHash LSH 候选生成 | 低（当前条目量用不上） | 低 | v2.7（库函数） |
| 12 | LLM 结构化抽取、Vi-DIFF 区块比较、聚焦爬虫发现渠道 | 中 | 高 | 之后 |

## 四、未做 / 限制
- 邮件推送需要 SMTP 账号和密码。为了不在本地保存邮箱密码，v2.8 用 Server酱 / ntfy / Webhook 覆盖「推到手机」，邮件留到后续版本。
- 汇率来自 frankfurter（欧洲央行参考汇率，免费、无需 Key：https://frankfurter.dev/），备用 open.er-api.com（https://www.exchangerate-api.com/docs/free），都取不到时用内置近似汇率并标注「估算」。
