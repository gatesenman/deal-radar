# Changelog

## 2.21.0 — Accessible modal navigation and reproducible release validation

- Add labelled modal semantics, keyboard focus trapping/return, search labels, live toast roles, visible focus and reduced-motion support. Add a network-blocked Electron smoke runner for zh/en, upgrade fixtures, settings and backup IPC. Package tracked files only, scan text contents and remove random temporary directory prefixes from source archives.


## 2.20.0 — Persistent push delivery reservations

- Reserve per-channel offer/digest/trial keys on disk before external POSTs; deduplicate overlapping saved views and process restarts. Separate daily/weekly scopes. Bound request timeout and stop blindly retrying ambiguous POST outcomes; mask legacy push error bodies.


## 2.19.0 — Rate-limit-aware source recovery

- Honour seconds and HTTP-date Retry-After (max 24h), persist cooldowns through collector status and do not bypass server cooldown on manual refresh. Keep last successful check across outages; reset streaks on recovery. Authenticated HTTP responses no longer populate the public URL cache.


## 2.18.0 — Conservative expiry and currency interpretation

- Reject impossible calendar dates and ambiguous numeric dates; honour explicit zoned ISO deadline instants. Parse grouped/European price amounts and explicit JPY/regional currency. Start fresh price history on currency switches; soft-404 requires confirmation.


## 2.17.0 — Validated rollback-safe backup restore

- Validate backup shape and dangerous keys before mutation; stage config/deals/prices and roll back on replacement failure. Preserve device push/AI endpoints and credentials; merge price books; preserve trial lifecycle fields; strip nested auth fields and all portable push URLs.


## 2.16.0 — Public source network boundary

- Block private source URLs, URL credentials and mixed public/private DNS answers. Revalidate redirects, strip cross-origin auth/cookie headers; hidden renderer guards HTTP/file subrequests. Mask push endpoint URLs and raw settings channels before IPC.


## 2.15.0（2026-11-24）— 打包、升级与发布

- 源码包脚本 `npm run pack:source`：排除 node_modules、构建产物、用户数据和疑似密钥文件，并生成 SHA256。
- 安装 / 升级不会清空已有优惠、筛选和推送配置；从 2.9 风格的配置升级会补上新设置的默认值。
- 仓库增加 GitHub Actions 离线单测。Windows 安装包随本版 GitHub Release 发布（未签名，需手动下载安装）。


## 2.14.0（2026-11-24）— 筛选记忆、本版更新与更跟手的刷新

- **列表筛选重启后保留**：优惠类型、有效期、排序、地区、来源平台、是否显示资讯。搜索词和「未读」不保存，避免每次打开都停在旧搜索。
- **本版更新**：升级后首次打开会列出上次之后的变化；看过就不再弹出。引导完成的新安装不会再看到历史说明。
- **跟随系统外观**：主题增加「跟随系统」，系统切换深浅色时窗口同步。
- **刷新更跟手**：一轮刷新中如果还没有新优惠，不再反复装饰整张优惠表，只更新运行状态。
- **团队采购 / 博主全量** 快速预设；网页缓存占用显示在设置里；标题栏可查看键盘快捷键。
- 发现渠道时「在官网找到…」的说明可按界面语言翻译。


## 2.13.0（2026-11-24）— 检查更新与推送重试

- **检查更新**：设置里可查询 GitHub Releases 的最新版本；启动后每天最多自动查一次。有新版本会桌面通知，并提供「打开下载页」。应用没有代码签名，**不会自动安装**。
- **推送重试**：企业微信 / 飞书 / 钉钉 / Telegram 等推送遇到超时、5xx、429 或网络错误时，自动再试两次（约 0.4s、1.2s 间隔），其它错误不重试。


## 2.12.0（2026-11-24）— 更细的反馈、证据链、完整备份

- **反馈原因**：不是优惠 / 已失效 / 不适用于我 / 重复 / 力度太小。「不是优惠」仍可学习屏蔽词；已失效会记成用户确认过期；其它原因只对你隐藏，不把条目降成资讯噪音。
- **证据链**：详情显示「官方确认」和「已被 N 个来源证实」。
- **完整备份**：设置里可导出/导入优惠（收藏、已领取、反馈）、视图、价格历史和配置。推送渠道密钥和 AI Key 不会写入文件，换电脑后需重填。升级与合并不会丢掉本机已领取/收藏。


## 2.11.0（2026-11-24）— 落地页过期判断、截止日期与价格解析

- **落地页复查**：HTTP 200 但标题或短页面写着 Page not found / 页面不存在，视为软 404（长文里偶然提到 404 不会误判）；补充「活动已结束 / has concluded / no longer offered / 报名通道已关闭」等结束用语。
- **截止日期**：支持「截止日期：2026年12月31日」「有效期至 2027-01-15」、until 11/30/2026 或 31/12/2026，以及「ends in 3 days / 还有 2 周」。
- **价格抽取**：识别 `USD 20 / month`、`9 pounds a month` 等前缀币种和英文货币单位。


## 2.10.0（2026-11-24）— 官方源补齐与网址协议识别

- **粘贴网址即可识别协议**：添加渠道时，把 GitHub / YouTube / Reddit / App Store / RSS / sitemap / 价格页 / 更新日志等官方地址贴进去，会立刻选好协议和字段，不必先点「识别」。点「识别」仍会抓取页面并发现 `<link rel="alternate">` 订阅源。
- **补官方渠道（均为已验证的主流官方源）**：Mistral 官方新闻 RSS（`mistral.ai/news/rss`）、Microsoft 博客 Copilot 标签 RSS、Meta Llama API 页面监控；Microsoft Copilot 补上 Hacker News 检索。升级时只新增缺失的预设渠道，用户自己加的渠道和开关都保留。
- 仍不加小众源，也不把被登录墙或 403 挡住的页面硬塞进预设。


## 2.9.0（2026-10-22）— 基于调研的优化（实测数据见 E2E_v29.md）

- **去重更准**：MinHash 近重复检测正式接入（阈值 0.6，只用于 ≥24 字的标题），并加入版本号 / 年份 / 榜单数字冲突保护；同一来源（如 Google 新闻聚合的多家媒体报道）48 小时内也会合并。160 对人工标注：准确率 0.871→0.942，召回 0.678→0.722。
- **网页变化少误报**：正文抽取去掉 Cookie 横幅、对话框、导航 / 页眉 / 页脚；「Updated: 3 hours ago」「5 分钟前」等相对时间、计数、版权年份不算变化；页面在见过的版本之间来回切换（灰度测试 / CDN 节点）不重复提醒。
- **价格页结构化比较**：价格页只有金额、套餐或优惠字样变化才提醒，标题直接显示「价格 $20 → $25」；页面暂时没有任何价格（跳转到别的页）不提醒；纯文字调整只记录。
- **多源佐证**：同一优惠被几个独立站点报道时提高可信度（Knowledge-Based Trust 思路）；同一网站的转帖不算独立来源，Google 新闻按媒体名区分。
- **省流量**：ETag / Last-Modified 条件请求缓存保存到磁盘（gzip），重启后第一次检查也能拿到 304。
- **轮询抖动**：自适应间隔和失败退避加入确定性随机抖动，避免大量渠道在同一轮集中请求。
- 升级说明：网页监控抽取方式变化，升级后第一次检查静默重建基线，不会产生「有变化」提醒。

## 2.8.0（2026-10-21）— 触达用户

参考 Apprise（一个地址一个渠道）、Huginn DigestAgent（摘要）、changedetection.io 通知等（见 RESEARCH.md）：

- **推送渠道**（左侧「推送渠道」）：企业微信 / 飞书 / 钉钉群机器人（支持加签）、Telegram Bot、Server酱（微信）、ntfy（手机推送）、通用 Webhook（JSON）。每个渠道可选：新优惠即时推送 / 每日·每周摘要 / 试用到期提醒、最低重要度、只推送某个视图；一键「发送测试」；显示上次推送成功 / 失败及原因（机器人 HTTP 200 但返回错误码也会判失败）。推送由本机直接发出，密钥只存本机且不回传界面。
- **每周周报**：可选星期几，与每日要点同一时间；摘要同时推送到渠道；可「立即发送一次」。
- **保存的视图**：列表工具栏「保存为视图」保存当前筛选；侧栏「我的视图」一键切换；铃铛开启后，有符合视图的新优惠会系统通知，并可让推送渠道只推送这个视图（视图即提醒规则）。
- **分享**：详情「分享」复制 Markdown（标题、厂商、优惠、截止、优惠码、链接）；「分享图片」生成卡片 PNG 复制到剪贴板，或保存为 PNG。
- **上手预设**：首次向导和设置里新增「学生党 / 开发者 API / 国内用户 / 只要大额折扣」，一键补充画像、启用相关厂商分组并新增提醒规则（不删除现有设置）。
- **试用到期提醒**：已领取的免费 / 学生 / 额度类优惠可设置到期日（或 7 / 14 / 30 天），到期前 2 天和当天系统通知 + 推送，首页显示「试用到期」。
- 修复：每日要点用 UTC 日期判断「今天已发过」，东八区把时间设在 8 点前会一天发两次 → 改用本地日期；价格表与容器 class 冲突导致表格变窄（2.7.0）。
- 新图标：发送、分享、图片、沙漏、书签、删除、编辑、魔杖。邮件推送暂未提供（需要保存 SMTP 密码），可用 Server酱 / ntfy / Webhook 代替。

## 2.7.0（2026-10-21）— 更聪明的引擎

依据 RESEARCH.md 中的论文 / 开源项目（Cho & Garcia-Molina 变化频率估计、Miniflux / changedetection.io、Paul Graham 朴素贝叶斯 + 主动学习、Knowledge-Based Trust 等）：

- **自适应轮询**：按每个渠道历史「有变化 / 检查次数」估计变化率（Cho & Garcia-Molina 2003 估计量），变化少的渠道自动拉长检查间隔（基础间隔 ~ 上限，默认 360 分钟），从不变化的渠道 ×4；手动「立即刷新」和自定义间隔的渠道不受影响。覆盖透明度页「智能引擎」列出被放慢的渠道。
- **价格页语义比对 + 价格历史**：从官方价格页文字自动识别「套餐 + 金额 + 计费周期」（含划线原价、跳过「Save $36/year」类文案），保存每个套餐最近 60 个价格点；价格变化生成「降价 / 涨价」条目（可设变化幅度阈值）。新增「价格」页：按厂商 / 周期筛选、约合人民币（frankfurter.dev 欧洲央行汇率，失败时 open.er-api.com，再失败用估算汇率，12 小时缓存，可手动更新）、走势小图。
- **来源可靠度**：综合你的反馈（收藏 / 已领取 vs 忽略 / 不是优惠，Beta 先验）、最近抓取成功率和是否官方渠道打分；反馈足够且低于 30 分的来源不再弹通知。详情面板显示来源可靠度。
- **偏好学习**：本机朴素贝叶斯，从收藏 / 已领取 / 忽略 / 不是优惠以及首页「帮我判断」的 👍👎 学习；至少 12 条且两类都有才开始预测，条目上显示「你可能感兴趣 xx%」，预测很低（<10%）的不再弹通知。「帮我判断」优先给出模型最拿不准的条目（不确定性采样）。可在设置关闭。
- 新增 MinHash / LSH 近重复检测库（含测试，当前条目量下聚类仍用原有算法）。
- 修复：从 2.6.1 之前遗留的「CSS 类名变化」页面变化条目自动降级为噪音；「帮我判断」不再重复出现已标注 / 同标题条目；价格识别对中文页面（\b 在中文后失效）、「Free of charge $0.15」等按量单价的误识别。
- 新图标：上 / 下箭头、图表、赞 / 踩、芯片；中英文、深浅色主题均已适配。

## 2.6.1（2026-10-21）

端到端测试（Windows 安装包 + wine 实机走查）发现并修复：

- **落地页复查误判已过期**：一次偶发的 HTTP 404（CDN / 反爬）就会把仍有效的优惠永久标为「已过期」并隐藏，且之后不再复查。现在 404/410 需连续两次复查确认（第二次在 1 小时后优先复查）；页面文字明确写「活动已结束」仍立即判定。从 2.6.0 升级时，已被单次 404 误判为过期的优惠会自动恢复并优先重新复查。
- **「进行中」过于乐观**：新闻 / 第三方页面能打开不代表优惠仍有效，现在只有官方页面复查正常才标「进行中」，其余为「状态未知」。
- **「只看适用于我」重启后丢失**：该勾选现在保存到设置，重启后保留；「清除筛选」也会同时重置有效期 / 含已过期 / 只看适用于我。
- **价格页变化提醒里出现 CSS 乱码**：JS 渲染页面混入的样式类名（如 `[&>[data-slot=icon]]:shrink-0`）不再算作内容变化，也不再触发通知。
- **清空搜索框会跳回优惠列表**：在其他页面清空搜索框不再强制切换页面。

## 2.6.0 — 2026-10-21
- 优惠有效期：每条优惠显示「进行中 / 即将截止 / 已过期 / 状态未知」，依据截止日期 + 落地页定期复查（默认每 12 小时复查近 60 天的优惠；404/410 或出现「活动已结束 / offer has ended」等字样即判为已过期）。列表默认隐藏已过期，可勾选「含已过期」或按有效期筛选；已过期的不再推送通知。覆盖透明度页可一键复查。
- 适用于我：设置里新增个人画像（地区、学生、新 / 老用户、银联 / 支付宝 / 微信支付 / Visa·Mastercard），列表「只看适用于我」、卡片 / 表格 / 详情显示「适用于我 / 可能不适用」及原因，可设为只通知适用的优惠。
- 厂商快速查询：搜索框输入厂商名、别名或中文名（如 claude、ChatGPT、亚马逊云科技），列表上方显示厂商卡片：当前未过期优惠、官方价格页直达、最近一次检查 / 成功时间、渠道健康。搜索也会匹配厂商别名。
- 领取指南：详情面板新增「如何领取」，按领取方式给出步骤、官方直达领取链接（新闻链接会改为官方页面）、优惠码一键复制、注意事项（可能需绑卡 / 自动续费 / 海外账号 / 第三方中转）。
- 覆盖透明度：新页面按厂商汇总渠道数、正常 / 失败 / 未检查、上次成功检查时间、失败的源，并列出免登录监控覆盖不到的已知盲区（X、LinkedIn、Discord、公众号、App 内活动及各厂商特有盲区）。
- 数据源：合并 sources-coverage 分支（全局源 27→53 个，含 10 个地区版 Google 新闻与 16 个地区媒体、多处搜索词修复，覆盖率实测 62.5%→82.5%，见 SOURCE_COVERAGE.md）；新增 Microsoft Foundry 官方博客 RSS，AWS What's New / Azure 博客 / Azure 更新 RSS 实测可采集。
- 新增图标：时钟、问号、盾牌、礼物、用户、隐藏；所有新增徽标使用统一间距的标签组。

## 2.5.2 — 2026-10-21
- 修复：表格视图「类型」列里重要度 ★、优惠类型、「N 个来源」等标签紧贴没有间隔（模板拼接标签之间没有空白，表格单元格也不是 flex 容器）。新增通用 `.tags` 弹性容器（gap 4–5px、垂直居中、可换行），用于表格的类型 / 厂商 / 折扣热度 / 平台列、详情面板「优惠类型」、渠道测试预览、设置里的噪声词列表。卡片、时间线、首页、详情事实表本来就有 gap，已核对。

## 2.5.1 — 2026-10-21
- 修复：「立即刷新」按钮刷新时变成一个旋转的小圆点（按钮的 `spin` 状态类与全局加载圈 `.spin` 样式冲突，整个按钮被压成 11px 圆圈）。改用 `busy` 状态。
- 图标：全部界面图标改为内置统一线性 SVG 图标集（src/renderer/icons.js，跟随 currentColor 适配深/浅色），去掉 ✨ ★ ☆ ✓ ✕ ▶ ⚠️ 🌐 等依赖系统 emoji / 字体的符号。
- 主题按钮按当前主题显示太阳/月亮；图标按钮补充悬停提示。
- 厂商 logo：替换 ASUS、Anker 两个不正确的通用图标。

## 2.5.0 — 2026-10-19
- 精度：行业价格战评论 / 播客访谈 / 非 AI 购物 / 试用教程 / 「哪里最便宜」比价软文等新规则；可选 AI 优惠分类器（有 Key 时批量标记噪声并缓存）。
- 跨语言故事合并：中英文同一优惠合并为一张卡（锚点：厂商 / 金额 / 时长 / 产品名 + 标题指纹）；误合保守。
- 翻译：改进 zh↔en 提示词；每轮可翻译更多（设置可调 20–80）；卡片显示语言角标。
- UX：首页空状态说明、隐藏中转转售开关、截止日期强调（今天/3 天内）、AI 分类开关。
- 数据迁移 dealsSchema 5（按新规则重判历史优惠）。

## 2.4.0 — 2026-10-14
- 厂商 logo：58 个预置厂商官方图标打包（离线、HiDPI）；自定义 / AI 添加的厂商自动抓取并缓存 favicon；加载失败回退首字母头像。显示于侧边栏、卡片、表格、时间线、今日要点、厂商页、详情。
- 多语言：简体中文 / English，首次按系统语言；设置与欢迎页可切换，即时生效无需重启；托盘、通知、摘要同步。
- 文案外置到 src/locales（zh-CN、en），可扩展更多语言；提取 / 检查脚本 + 单测防止硬编码残留。
- 每个预置厂商新增中英文简介；日期、数字按语言格式化；力度文案本地化（如「8 折」→ 20% OFF）。
- 优惠标题 / AI 要点按所选语言显示与缓存（英文界面下中文优惠由 AI 译成英文）。
- 数据迁移 dealsSchema 4（旧中文译文迁入按语言缓存）。

## 2.3.0 — 2026-10-14
- 新增「今日要点」首页（默认视图）与每日摘要通知。
- 结构化字段：力度、适用对象、地区/资格、截止、领取方式、可信度。
- 处理状态（未处理/已领取/已忽略）+ 状态筛选；「不是优惠」反馈（关键词/来源，追溯生效）。
- 提醒：最低可信度、免打扰时段、摘要时间。
- AI 中文翻译 + 要点（可选）。
- 精度规则 refineOffer；第三方中转标记并降可信度；召回补强（cuts prices by N%、N 年订阅免费、限时低价 API）。
- 紧凑卡片、工具栏精简；数据迁移 dealsSchema 3。

## 2.2.0 — 2026-10-13
- AI / 智能体 / 创作类厂商分类并默认全开；v5 迁移；扫描调度提速。

## 2.1.0 — 2026-10-12
- AI 辅助添加厂商与渠道。
