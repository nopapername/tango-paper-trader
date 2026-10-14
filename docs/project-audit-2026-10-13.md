# Tango Paper Trader 项目全面审计报告

> 审计日期：2026-10-13（Asia/Shanghai）
> 项目目录：`D:\web3\code_project\tango-paper-trade`
> 审计分支：`main`
> 审计基准：`aad772c9469d3b2f8b3ca623a36b2585a4fdb4a6`
> 项目版本：`0.3.0`
> 审计方式：源码审查、文档与提交交叉核对、全量自动测试、构建及 SHA-256 比对、独立边界复现、临时本地 Headless Chrome 验证。

## 目录

- [1. 结论](#1-结论)
- [2. 范围、基准与验证结果](#2-范围基准与验证结果)
- [3. 架构与数据流](#3-架构与数据流)
- [4. 已实现功能](#4-已实现功能)
- [5. 未实现、未合并与未验证事项](#5-未实现未合并与未验证事项)
- [6. 确认问题总表](#6-确认问题总表)
- [7. 重要问题详解](#7-重要问题详解)
- [8. 安全、可靠性与维护风险](#8-安全可靠性与维护风险)
- [9. 设计与计划文档核对](#9-设计与计划文档核对)
- [10. 测试质量与缺口](#10-测试质量与缺口)
- [11. 修复与验收建议](#11-修复与验收建议)
- [12. 证据与复现方式](#12-证据与复现方式)

## 1. 结论

这是一个已经具备完整核心链路的 **Chrome Manifest V3、GMGN 六链模拟交易扩展**。六链账户隔离、模拟买卖、成本和盈亏计算、本地状态迁移、串行写入、首次引导、快捷买入、图表标记、Dashboard、数据备份与恢复等都有实际实现，不能按“仅有计划的原型”评价。

本次现有自动测试 **935 项全部通过**，扩展结构检查和构建通过，源码与构建包 **32 个文件全部一致**。但这些结果不能证明项目没有缺陷：独立复现发现了多个模块交叉处的盲点。本报告整理出 **24 项已确认问题或实现差距**，其中 **2 项 P1、14 项 P2、8 项 P3**。部分只在 API/导入或极端数值边界触发，已明确标注，不能与日常 UI 故障等量看待。

最需要先处理的是：

1. **历史达到 10,000 笔时，开放的兜底估值仓位可能使后续交易持续失败。** 逻辑条数裁剪先于依赖保护，删除了严格校验所需的原始买单。
2. **“无损导入”实际会静默截断超过 10,000 条的成交与校准记录。** 即使文件未超过 8 MiB，仍显示导入成功；被截尾部甚至不参与严格校验。
3. **OFF 后的短暂竞态窗仍可能确认卖出或全部平仓。** 买入有开关保护，卖出和清仓提交遗漏，后台事务也没有最终开关检查。
4. **合成的 $3,200 市值可能成为图表事实坐标。** 后来的真实价格比率不能证明这个历史兜底市值曾真实存在。
5. **历史压缩后，日历每日盈亏与月总盈亏可以互相矛盾。** 日聚合保留全历史，月总额却从剩余成交重算。

最新的 **Locked Giant 完整槽位填满**及后续图表兜底过滤修复已存在于本地 `codex/gmgn-locked-giant-full-fill` 分支，**尚未进入当前 `main`**。本次只读比较，没有合并或切换分支，也没有将该分支视为已经修复当前发布代码。

项目现阶段适合继续开发和受控模拟体验。若以“完整六链、长期记录可靠、在线集成已验收”的标准发布，应先修复数据完整性问题，并补齐已加载扩展的真实 GMGN 验收。

## 2. 范围、基准与验证结果

### 2.1 检查范围

检查了当前目录的全部生产模块、manifest、HTML、CSS、构建与验证脚本、22 个测试文件、README/PRIVACY/SECURITY，以及原始 `docs` 中的 **18 份设计、25 份计划、1 份六链手工验收文档**。

包含两份本地未跟踪计划：

- `2026-07-18-gmgn-multichain-paper-trading.md`
- `2026-07-22-gmgn-paper-ui-quote-onboarding-resilience.md`

`.backups/`、`.worktrees/` 与其他分支属于旧快照或独立开发上下文，不作为当前运行时代码混算。另一个分支只做了针对性的差异和提交核对，没有对该分支整体作可合并性审计。

本次没有修改生产源码、测试、原计划、用户已有备份或 Git 分支。新增审计报告和证据；执行构建后，受跟踪的 `dist` 没有差异。

### 2.2 规模

以下是文本行数统计，包含空行，不等于有效代码行数。

| 范围 | 文件数 | 行数 | 字节数 |
| --- | ---: | ---: | ---: |
| `src` 全部 | 26 | 12,260 | 632,976 |
| 生产 JavaScript | 22 | 11,657 | 595,883 |
| CSS | 4 | 603 | 37,093 |
| 测试 | 22 | 26,970 | 1,181,489 |
| 设计文档 | 18 | 2,775 | 191,093 |
| 计划文档 | 25 | 16,014 | 701,639 |

最大模块为 `content.js`（2,766 行）、`gmgn.js`（2,311 行）、`engine.js`（1,312 行）、`chart-main.js`（907 行）。测试规模较大，但集成复杂度仍主要集中在少数闭包模块内。

### 2.3 实际执行结果

环境：Windows、Node `v22.18.0`、npm `10.9.3`。

| 验证 | 结果 | 说明 |
| --- | --- | --- |
| `npm.cmd test` | 通过 | 935 tests、918 顶层测试；fail/skipped/todo 均 0；测试报告时长约 3.75 秒 |
| `npm.cmd run check` | 通过 | Manifest `0.3.0`；22 个引用文件存在；语法、顺序、版本及静态规则检查通过 |
| `npm.cmd run build` | 通过 | 生成 `dist/tango-paper-trader` |
| 构建前 SHA-256 比对 | 32/32 一致 | 当前包本来就与当前源码一致 |
| 构建后 SHA-256 比对 | 32/32 一致 | 26 个源码文件及 6 个 HTML/manifest/发布文档资源 |
| `git diff --exit-code -- dist` | 通过 | 重建没有受跟踪产物差异 |
| `git diff --check` | 通过 | 无补丁空白错误 |
| 核心边界复现 | 10 个案例通过 | “通过”指断言确认问题存在，不是缺陷已修复 |
| Popup/Dashboard 复现 | 6 个案例通过 | 使用实际运行时及内存测试环境 |
| 日历压缩一致性复现 | 通过 | 真实 Engine 生成买卖，再调用真实压缩器 |
| GMGN 集成复现 | 完成 | 包含实际 Engine/Coordinator、事件夹具、本地 Headless Chrome 几何和 MutationObserver |

现有测试中包含真实本地 Headless Chrome 几何检查，不能全称为 mock。它们仍没有加载扩展到在线 GMGN 页面：Headless 几何用本地 HTML，跨世界事件用模型夹具。

原手工验收文档明确：因浏览器策略不能打开 `chrome://extensions` 加载扩展，五链交易/面板/图表验证为 **Blocked**；X Layer 当时未发现可用详情链接。不能把“页面可访问”“标题正确”当作扩展端到端通过。

## 3. 架构与数据流

### 3.1 模块职责

| 层 | 模块 | 职责 |
| --- | --- | --- |
| 扩展入口 | `manifest.json`、`background.js` | MV3 注册、Service Worker、消息分发、价格服务、开页面、安装引导与快捷键 |
| 身份与供给 | `core/chains.js`、`core/supply.js` | 六链注册、地址规范化、URL、供给来源与 launchpad 规则 |
| 状态模型 | `core/state.js` | v2 schema、默认设置、v1 迁移、严格导入校验、重置 |
| 交易引擎 | `core/engine.js` | 报价验证、模拟买卖、成本/PnL、占位校准、组合摘要 |
| 写入中心 | `core/state-coordinator.js`、`core/storage.js` | 串行意图、版本控制、容量策略、原子状态写入、UI 存储客户端 |
| GMGN 适配 | `adapters/gmgn.js`、`gmgn-quotes.js` | DOM 身份、报价抽取、快捷买入绑定、卡片复用与恢复 |
| 页面数据桥 | `content/page-main.js` | MAIN world 旁路复用网站已请求的 JSON 报价 |
| 原生买入隔离 | `native-quick-buy-guard.js`、`quick-buy-safety.css` | document-start 阻断 native quick-buy，可信操作回调注册 |
| 页面产品 UI | `content/content.js`、`content.css` | Shadow DOM 面板、余额/PnL Bar、持仓抽屉、确认、交易与调度 |
| 图表 | `markers.js`、`chart-main.js` | 经济坐标构建、iframe 握手、Canvas 轴观察、可见范围投影 |
| 扩展 UI | `popup/*`、`dashboard/*` | 账户浏览、设置、历史、日历、备份、导出与引导 |
| 通用显示 | `shared/i18n.js`、`format.js`、`constants.js` | 双语、数字格式、配置常量 |

### 3.2 交易写入链路

```text
可信 Tango 点击/确认
  → 当前链、地址、路由与绑定检查
  → 同步选取可用报价；不足时明确标记临时估值
  → Tango.Store 发送交易意图
  → background 的唯一 StateCoordinator
  → 读取最新账户与设置，串行执行 Engine
  → 严格状态检查与存储容量策略
  → chrome.storage.local 单次写入
  → UI 更新、图表重放、成交提示
```

该结构避免多个页面各自保存旧整份状态，整体方向合理。当前问题主要来自政策不统一：引擎提前截历史，而协调器稍后才保护依赖；报价允许未来偏移，而刷新持仓的持久时间校验又禁止；UI 检查 OFF，而后台执行入口缺最终限制。

### 3.3 账户和数据口径

状态为 schema v2，但沿用带 `V1` 后缀的存储 key，这是兼容旧数据的命名遗留，不代表运行状态仍为 v1。

- 六链分别有 `initialBalanceNative/cashBalanceNative/realizedPnlNative`。
- 持仓 key 为 `chain:normalizedAddress`；相同 EVM 地址在不同链独立。
- 成交新记录插入数组头部；成交、校准各有 10,000 条上限。
- `dailyRealizedByChain` 与账户累计盈亏保留聚合值，历史可能被裁剪。
- `stateRevision` 用于拒绝旧整份状态覆盖；当前 UI 主路径采用 PATCH 和交易意图。
- 同一公共本金数值分别配给六链原生币，不按 USD 平均分配或转换。

## 4. 已实现功能

### 4.1 六链与行情

| 链 | 原生币 | CoinGecko ID | DEX Screener 显式映射 | 核心账户/交易 |
| --- | --- | --- | --- | --- |
| Solana | SOL | solana | solana | 已实现 |
| Ethereum | ETH | ethereum | ethereum | 已实现 |
| BNB Chain | BNB | binancecoin | bsc | 已实现 |
| Base | ETH | ethereum | base | 已实现 |
| Robinhood Chain | ETH | ethereum | 无 | 已实现；外部 token fallback 受限 |
| X Layer | OKB | okb | xlayer | 已实现；在线详情集成缺验收 |

链注册均声明 detail/trench/chart 能力，表示代码支持的目标，并非在线六链全部验收证明。SOL 有 Wrapped SOL 的外部原生币价格回退；其他链没有同等 wrapped-native 回退。ETH、Base、Robinhood 共享 ETH 原生价格请求和缓存，但账户完全独立。

行情来源包括：局部且绑定身份的 GMGN DOM、网站已请求 JSON、点击时详情快照、原生币 CoinGecko、已映射链的 DEX Screener。报价维度分别记录时间和来源，避免把总供应量误读为市值、跨代币/跨链借报价或用旧响应覆盖新值。

### 4.2 模拟交易和账务

- 原生币金额买入、买入预设、百分比卖出、指定数量卖出、当前链全部平仓、保本卖出计算。
- 加仓维护加权成本；卖出按比例分摊成本；100% 卖出取精确剩余数量。
- 买入正向滑点、卖出负向滑点、平台费和每链网络费。
- 原生币已实现/未实现/总盈亏；执行时 USD 已实现盈亏；当前 USD 资产汇总。
- 供给可来自精确字段、可信价格/市值同观察比率或已验证 launchpad 规则。
- 无可靠市场数据时使用明确的临时估值策略；未知供给为 1B、初始市值 $3,200。
- Pump mayhem 2B、普通 Pump/Fourmeme/Flap/Zora/DYOR/Bow 等 1B、Bankr/Clanker 100B 等规则有实现。
- 后来的供给或临时原生币估值纠正可中性变换剩余数量，保留成本、现金与历史成交。普通事实价格更新产生正常盈亏，不会把历史 fill 改写为真实价格。

这些是模拟规则：没有流动性深度、真实路由、MEV、成交排队、链上执行成功率等实盘撮合模型。固定费用和滑点不意味着真实可成交性；这是能力范围，而非本项目遗漏钱包能力。

### 4.3 GMGN 页面体验

- 详情交易面板、当前链余额和 PnL Bar、持仓抽屉、拖动/折叠、跨页面访问持仓。
- 快捷买入只进入兼容 trench card 的确认槽位；不随意插入收藏、监控或详情标题。
- 实时读取对应列金额输入；卡片新增、虚拟滚动、React 原生控件重插、身份晚到、slot 重建有处理。
- 绑定到 chain/address/card/slot/href/generation；重复激活及 in-flight 有去重。
- 原生 quick-buy 在 document-start 保护；可信主键点击通过 isolated WeakMap 回调；页面合成事件/公开 nonce 不能自行授权。
- Shadow DOM 内操作有可信事件检查；可选确认、会话内不再确认、快速模式、音效和填单通知。
- 总开关及 `Alt+Shift+P`；正常刷新后隐藏 Tango UI、清图表、恢复仍匹配的 native 控件。
- 固定 Giant 按钮 36px、金额 14px/Paper 10px、两行、16%/24% 半透明背景；不会再跟随 GMGN 四档样式。
- 图表有 PRICE/MCAP 维度、至少三个事实轴锚点、线性/对数拟合、几何和 token/frame 世代校验；范围外隐藏，延迟 iframe READY 时重放。

### 4.4 Popup、Dashboard 和本地数据

| 功能 | 完成情况与边界 |
| --- | --- |
| 首次引导 | 安装时打开一次；选语言/公共本金，六链重置并 read-back 验证；成功打开 GMGN 后关闭引导；失败重试有保护 |
| Popup | 开关、链选择、余额/权益/PnL/持仓列表、六链 USD 摘要、语言、公共本金、全链重置、入口 |
| Dashboard 总览 | 当前链指标、六链账户卡、只读 USD 合计与缺价提示 |
| 持仓 | 当前链成本、市值、ROI、入场/当前市值和持有时间；没有直接交易按钮 |
| 历史 | 当前链 symbol/CA、日期、买卖、胜负过滤；当前最多展示 500 笔 |
| 日历 | 月切换、每日盈亏、日期跳转历史、月统计；压缩后统计缺陷见 B-06 |
| 设置 | 全局语言/币种/主题/卖出预设/费用/确认/声音/布局等；买入预设和网络费按链 |
| CSV | 当前链导出；BOM、引号和换行转义、公式注入防护已实现；列漏失见 B-09 |
| JSON | 六链完整备份和替换恢复；v1→v2 迁移；过字节预算时拒绝并提示 MiB；条数无损缺陷见 B-02 |
| PNG | 单笔 SELL 结果卡下载/复制，复制失败回退下载；长文本排版缺陷见 B-18 |
| 重置 | 当前链、全部链、公共本金变更三种范围有明确语义与确认；公共本金变更保留其他设置 |
| 本地化 | 英文、简体中文和浏览器语言解析已实现；部分硬编码标签未翻译 |

胜率和“closedTrades”按 **SELL 成交笔数**，不是完整持仓往返次数；部分卖出也增加统计。利润因子、交易数基于保留的历史。全链 USD PnL 用当前原生币价格重估本金，现金原生币自身涨跌不单独计作纸面策略收益。这些口径应在 UI/文档明确。

## 5. 未实现、未合并与未验证事项

| 事项 | 当前状态 | 分类 |
| --- | --- | --- |
| 全部 slot/wrapper/action/button/paint 同一 36px 矩形 | 当前上游仍可 48px，paper 为 36px 居中 | 已批准需求，当前 main 未实现 |
| 显式合成市值的 marker 过滤 | 当前 main 未做充分过滤 | 已确认缺陷；独立分支有修复 |
| Headless full-fill 强矩形断言 | 当前测试接受上游 `>=36px` | 待进入 main 的新验收契约 |
| 已加载扩展的六链在线验收 | 现有文档为 Blocked/Unavailable | 未验证，不能宣称已通过 |
| Worker/Offscreen-only 图表轴坐标 | 无可信数值锚点时隐藏 | 明确兼容性限制，符合 fail-closed 设计 |
| Dashboard 历史分页/更多记录浏览 | 只显示 500 笔，无数量提示 | 产品能力缺口；未见已批准分页任务 |
| Native/USD 定期刷新与 stale 状态 | 页面初开抓取，没有 UI 时效策略 | 可靠性缺口 |
| 全局浅色/自动主题完整应用 | Dashboard 部分配色；Popup/页面仍暗色 | 实现不完整 |
| 任意 GMGN DOM/任意交易网站适配 | 依赖已验证 sentry/card/slot 结构 | 目标范围外，不承诺通用适配 |
| 钱包、真实交易、云同步、自动策略/通用回测 | 未实现 | 非当前批准目标，不应计作未完成 TODO |

`codex/gmgn-locked-giant-full-fill` 当前只读观察到 HEAD `c0a95d4`：包含 `0bec8a9`（full-fill）、`41b827d`（槽位最小宽度）、`41f71ff`（打包）及后续 marker 过滤修复 `e8cb645/9b284dd/8fb9a84`。该分支还包含 08-13 marker 设计/计划；它们不在当前目录的 18/25 份文档统计内。本报告不授权、不执行合并。

## 6. 确认问题总表

优先级：P1＝数据完整性或持续阻断核心操作；P2＝重要功能正确性、可靠性或批准需求差距；P3＝低影响体验、健壮性或兼容 API 边界。不是资金安全漏洞分级。本次没有确认可以执行真实交易的代码能力。

| ID | 优先级 | 问题 | 触发范围 | 证据 |
| --- | --- | --- | --- | --- |
| B-01 | P1 | 10k 历史裁剪删除开放 fallback origin，后续交易失败 | 长期/多链累计历史 | core 复现 2 |
| B-02 | P1 | 无损导入静默截断历史，尾部不校验 | >10k、仍低于 8MiB 的备份 | core 复现 3/4 |
| B-03 | P2 | OFF 后竞态窗仍可确认卖出/清仓 | 旧确认窗尚未移除 | GMGN offActions/coordinatorOffSell |
| B-04 | P2 | 合成市值产生图表伪事实坐标，挤占名额 | 兜底成交后遇真实报价 | GMGN fallbackPayload/fallbackRendered |
| B-05 | P2 | 合法未来偏移报价 UPDATE 持久化失败 | 时钟偏移 1ms 即可 | core 复现 1 |
| B-06 | P2 | 历史压缩后日历每日与月总额矛盾 | 10k/字节压缩后的月份 | calendar 复现 |
| B-07 | P2 | 属性维护自激 MutationObserver 循环 | 静止 trench 页面 | GMGN mutationFeedback |
| B-08 | P2 | 完整 Giant 槽位填满未进入 main | 高于 36px 的保留容器 | GMGN giantLayout；最新设计 |
| B-09 | P2 | 最终 CSV 丢九个来源/供给字段 | 所有 CSV 下载 | UI-2 |
| B-10 | P2 | Popup 跟随活跃链时 GMGN 按钮无响应 | 活跃链≠持久已选链 | UI-1 |
| B-11 | P2 | USD 原生报价只初开请求，无过期判定 | 长期开着 Dashboard | UI-3 |
| B-12 | P2 | 一个价格请求挂起拖住六链刷新 | 任一请求不 settle | UI-4 |
| B-13 | P2 | 浅色文字落在硬编码暗背景，主题未完整应用 | light/auto 主题 | CSS 静态确认 |
| B-14 | P2 | 部分卖出删除有成本 dust，账务少计损失 | 极端但合法数值 | core 复现 7 |
| B-15 | P2 | 严格导入接受未来 openedAt，仓位无法卖出 | 损坏/手工备份 | core 复现 10 |
| B-16 | P2 | 配置允许 10000bps，执行仅允许 9999 | 导入/API/绕过 HTML 限制 | core 复现 5 |
| B-17 | P3 | 空数值保存为 0，输入限制与错误反馈不一致 | 设置编辑 | UI-5 |
| B-18 | P3 | PNG 长 symbol 无宽度限制而裁切 | 长字符串/大数 | UI-6；未做完整像素 QA |
| B-19 | P3 | 非数组/空元素页面报价消息抛 TypeError | 不合法同窗消息 | GMGN malformedMessages |
| B-20 | P3 | 部分硬编码英文与过时流程提示 | 中文界面 | UI/i18n 源码 |
| B-21 | P3 | 历史 500 笔上限无分页/数量提示 | 大量保留历史 | dashboard.js:320 |
| B-22 | P3 | INITIALIZE 自定义本金未同步 settings | 保留兼容 API；当前引导不调用 | core 复现 6 |
| B-23 | P3 | CLOSE_ALL 携 quantity 时只部分关闭且无失败 | Store/Core API；当前 UI 不填 quantity | core 复现 8 |
| B-24 | P3 | 只读 USD 汇总接受 Infinity 仍 complete | 纯函数错误输入；后台入口已防护 | core 复现 9 |

CSV 不跟随当前筛选是现有范围选择，不单列 bug：文档只要求当前链 CSV。建议按钮说明“导出本链全部”或提供筛选选项。其他未验证风险不计入以上 24 项。

## 7. 重要问题详解

### B-01：历史条数上限先于依赖保护，阻断开放兜底仓位

**位置：** [engine.js:907](D:/web3/code_project/tango-paper-trade/src/core/engine.js:907)、[engine.js:1103](D:/web3/code_project/tango-paper-trade/src/core/engine.js:1103)、[state.js:731](D:/web3/code_project/tango-paper-trade/src/core/state.js:731)、[state-coordinator.js:83](D:/web3/code_project/tango-paper-trade/src/core/state-coordinator.js:83)。

`UNKNOWN_FALLBACK` 开放仓位的合法性依赖 canonical origin 买单。协调器的字节压缩器会保护这类历史单元，但 Engine 追加新成交时先 `.slice(0, MAX_TRADES)`，State 归一化也先 slice；保护开始时记录已丢失。

**复现结果：** 有效初始状态 10,000 笔，大小 **4,402,268 bytes**，仍明显低于 8MiB；原始兜底买单在尾部。新 BUY 删除 origin，coordinator 报 `invalidPosition`；对该仓位 100% SELL 报 `invalidTrade`；两次均 `writes=0`。

原数据没有被失败事务损坏，但正常后续交易受阻，普通报错没有说明历史依赖问题。六链共享全局历史数组，因此其他链交易也可能把必要记录挤出。

**建议：** 数量与字节限额共用依赖感知策略，在任何裁剪前建立开放仓位与历史依赖；移除完整可删除单元。补“满历史＋开放兜底＋origin 尾部＋真实协调器提交”回归，而非只测字节预算。

### B-02：无损导入实际静默丢数据

**位置：** [state.js:698](D:/web3/code_project/tango-paper-trade/src/core/state.js:698)、[state.js:731](D:/web3/code_project/tango-paper-trade/src/core/state.js:731)、[state.js:747](D:/web3/code_project/tango-paper-trade/src/core/state.js:747)、[state-coordinator.js:536](D:/web3/code_project/tango-paper-trade/src/core/state-coordinator.js:536)。

严格导入先截到 10,000 条再 normalize/map，容量测量发生在截断之后。复现输入 **10,001 trades＋10,001 calibrations，7,409,269 bytes < 8,388,608**，导入成功并写一次，输出却各只有 10,000。末尾 `history-10000/calibration-10000` 消失。

另一个案例在第 10,001 条放非法 chain/负 quantity，仍导入成功，因为它在严格校验前已被截掉。未发现该尾部成为执行代码；这里的问题是校验和无损承诺不成立。

**建议：** 导入完整校验，并在条数超限时显式拒绝且保持原数据；或定义可完整保留的备份策略。不能显示成功又丢历史。v1 迁移也应明确截断语义。

### B-03：关闭开关与卖出提交之间存在竞态

**位置：** [content.js:32](D:/web3/code_project/tango-paper-trade/src/content/content.js:32)、[content.js:1757](D:/web3/code_project/tango-paper-trade/src/content/content.js:1757)、[content.js:1823](D:/web3/code_project/tango-paper-trade/src/content/content.js:1823)、[content.js:1863](D:/web3/code_project/tango-paper-trade/src/content/content.js:1863)、[state-coordinator.js:603](D:/web3/code_project/tango-paper-trade/src/core/state-coordinator.js:603)。

`paperExecutionDisabled()` 包含设置刷新中和已通知 OFF 的标记，commitBuy 使用它，sell/commitSell/commitCloseAll 未使用。

**复现：** 已显示确认，随后收到 `enabled=false` storage 通知，pending/disabled 均 true。完整 reload/render 尚未清旧 UI 时，使用绑定确认按钮的可信事件，仍分别产生一次 SELL/closeAll 调用。实际 Coordinator 在存储 `enabled=false` 时也可 SELL：数量 **2000→1000**，生成 SELL，写入一次。

这是一个刷新前的短窗口，不是 OFF 后永久可见操作，也没有证明合成事件可绕过可信 gate；影响的是模拟账户。

**建议：** 所有入口和 commit 共用开关判定；交易事务读取最新 settings 后再次拒绝 OFF。增加“消息在途时 OFF”“旧 SELL/closeAll 确认”“立即设置通知”回归。

### B-04：$3,200 合成市值进入事实图表

**位置：** [markers.js:43](D:/web3/code_project/tango-paper-trade/src/content/markers.js:43)、[markers.js:64](D:/web3/code_project/tango-paper-trade/src/content/markers.js:64)、[markers.js:71](D:/web3/code_project/tango-paper-trade/src/content/markers.js:71)。

price 维度已经过滤多个 synthetic 标记，但市值只要求 `>0`。真实 Engine 的 fallback trade 带 `TANGO_FALLBACK/SYNTHETIC_PRICE/UNKNOWN_FALLBACK`，仍被当作入场市值。

随后真实 price `$0.002`、MCAP `$200,000,000` 到达，旧 `$3,200` 被乘当前比例转换成 **`3.2e-8`**。在 Canvas 测试夹具中执行生产 chart-main，相应三锚点范围里绘出一条 300px 的线，诊断 `RENDERED`。数值几何合法不等于历史经济来源真实。

当 fallback 记录排在候选数组前方时，BUY 会先占 firstBuy，SELL 会占最多四个卖标记名额，从而挤走数组后方的事实记录。生产成交按新记录在前排序，较新的 fallback 也可能掩盖较老事实；本次不声称旧 fallback 必然掩盖后来新成交。现有 `markers.test.js` 中部分测试反而允许合成投影，说明测试契约也需修订。

**建议：** 价格与市值分别判定可信性；被拒绝维度不能通过后来的 ratio/supply 转换复活；先过滤可用候选再选名额。其他本地分支有修复可供审阅，但需核对真实市值＋临时供给、旧记录兼容与历史 signature。

### B-05：报价校验与持久时间规则矛盾

**位置：** [engine.js:474](D:/web3/code_project/tango-paper-trade/src/core/engine.js:474)、[engine.js:1232](D:/web3/code_project/tango-paper-trade/src/core/engine.js:1232)、[state.js:565](D:/web3/code_project/tango-paper-trade/src/core/state.js:565)。

报价允许最多 5 秒未来偏移，BUY/SELL 持久化已有安全时间处理；UPDATE/部分校准直接保存 quote.observedAt。

**复现：** now=2000、quote=2001，validateQuote 成功；刷新后 quoteObservedAt=2001、updatedAt=2000，严格 State 报 `invalidPosition`，协调器未写入。只需 1ms 偏移，不必极端未来时间。

**建议：** 同一政策覆盖 BUY/SELL/UPDATE/校准。保留原始时间另存，持久观察时间用安全边界，或入口统一拒绝；不能一层接受、一层拒绝。

### B-06：压缩后日历月总额与每日盈亏冲突

**位置：** [dashboard/model.js:79](D:/web3/code_project/tango-paper-trade/src/dashboard/model.js:79)、[dashboard/model.js:86](D:/web3/code_project/tango-paper-trade/src/dashboard/model.js:86)、[dashboard.js:353](D:/web3/code_project/tango-paper-trade/src/dashboard/dashboard.js:353)。

日格用持久 `dailyRealizedByChain`，月总额/胜率用剩余 SELL。容量清理保留日聚合和账户，但删除交易。

**真实链路复现：** Engine 买入 1 ETH，价格翻倍后全卖，月与日均 +1 ETH。调用实际压缩器删除两笔历史后，账户和每日仍 **+1 ETH**，月总额却 **0 ETH**，胜率 0。复现使用注入小预算逼出同一生产压缩路径；正常 8MiB 或条数裁剪会遇到同类语义差异。

**建议：** 月盈亏合计来自日聚合。胜率/最佳最差若仅保留窗口可算，应明确标签；若要全历史，持久保存交易计数、胜负和极值聚合。账户、日、月应有一致性断言。

### B-07：扩展自己的样式维护触发持续扫描

**位置：** [gmgn.js:1555](D:/web3/code_project/tango-paper-trade/src/adapters/gmgn.js:1555)、[gmgn.js:2157](D:/web3/code_project/tango-paper-trade/src/adapters/gmgn.js:2157)、[content.js:2673](D:/web3/code_project/tango-paper-trade/src/content/content.js:2673)、[content.js:2724](D:/web3/code_project/tango-paper-trade/src/content/content.js:2724)。

同一 binding reconcile 时无条件加 slot class，先删 structural class 再加回；真实浏览器 classList 同值写入也可能产生 MutationRecord。observer 把这些祖先 class 变更归回卡片，160ms 后再次 reconcile。

**本地真实 Chrome 复现：** 加载生产 adapter 和从 content 提取的 root 判定，复制当前 160ms 调度；初始化后无外部 DOM 更新，1 秒仍 **7 个 observer batches、6 次 rediscoveries、28 条相关 class records**。测试环境手动断开 observer 才结束。未测在线 GMGN CPU 百分比，不宣称重复成交。

**建议：** class/attribute 幂等写入，structural hosts 做集合差异更新；observer 对自发同值变更作合理过滤，保留外部 native 重插安全处理。增加原生 MutationObserver 静止后收敛测试。

### B-08：最新 full-fill 计划当前仅文档进入 main

**位置：** [content.css:19](D:/web3/code_project/tango-paper-trade/src/content/content.css:19)、[content.css:35](D:/web3/code_project/tango-paper-trade/src/content/content.css:35)、[gmgn-adapter.test.js:630](D:/web3/code_project/tango-paper-trade/tests/gmgn-adapter.test.js:630)。

当前 paper 高 36px，上游仅 min-height36。Headless 三种拓扑在请求 48px 时，slot/host/overflow48，paper/paint36，只占中间条带。现有测试要求 `>=36`，所以通过。

08-11 设计允许高 host 内居中，08-12 明确替代为整链同矩形。它是新批准需求差距，不应把旧实现说成从来没有 Giant。

**建议：** 评审独立分支实现，统一 slot→wrapper→action→paper→paint 的高度、宽度和 box-model。测试检查边界矩形，而不只可见高度；覆盖 24/28/32/36/48/113px 及 hostile padding/margin/transform。

### B-09 至 B-13：导出、导航、报价与主题

| ID | 位置 | 实际/期望与建议 |
| --- | --- | --- |
| B-09 | [dashboard.js:529](D:/web3/code_project/tango-paper-trade/src/dashboard/dashboard.js:529)、[model.js:65](D:/web3/code_project/tango-paper-trade/src/dashboard/model.js:65) | 模型输出29列，最终CSV只20列；漏quoteSource/paperFallback/provisional/syntheticTokenPrice/syntheticNativePrice/totalSupply/supplySource/launchpad/launchMode。统一导出schema，在最终Blob上验证；公式注入防护保留。 |
| B-10 | [popup.js:113](D:/web3/code_project/tango-paper-trade/src/popup/popup.js:113)、[popup.js:252](D:/web3/code_project/tango-paper-trade/src/popup/popup.js:252) | 持久eth、活跃robinhood，Popup显示robinhood但selectedModel要求等于持久eth，点击GMGN发送0条导航消息。通用导航不应依赖交易选链写入。 |
| B-11 | [dashboard.js:60](D:/web3/code_project/tango-paper-trade/src/dashboard/dashboard.js:60)、[popup.js:141](D:/web3/code_project/tango-paper-trade/src/popup/popup.js:141) | 只初开抓native价；reload不刷新；observedAt=1仍接受123。添加TTL、定期/手动刷新、截至时间与过期状态；内容页自身行情刷新不能代替Dashboard刷新。 |
| B-12 | [dashboard.js:74](D:/web3/code_project/tango-paper-trade/src/dashboard/dashboard.js:74)、[background.js:173](D:/web3/code_project/tango-paper-trade/src/background.js:173) | Sol请求永不结束，其余456已到但整批Promise.all不落UI，仍旧123。后台加timeout/abort，UI逐链应用，及时报告不完整。首屏先render，并未被网络堵住。 |
| B-13 | [dashboard.css:8](D:/web3/code_project/tango-paper-trade/src/dashboard/dashboard.css:8)、[dashboard.css:42](D:/web3/code_project/tango-paper-trade/src/dashboard/dashboard.css:42) | light设深色文字，card/sidebar/input/calendar仍硬编码暗背景；Popup/内容页固定dark，auto当dark。用语义颜色变量、主题全表面检查，明确auto行为。 |

### B-14 至 B-16：数值和严格导入边界

| ID | 位置 | 已确认复现与范围 |
| --- | --- | --- |
| B-14 | [engine.js:977](D:/web3/code_project/tango-paper-trade/src/core/engine.js:977)、[engine.js:1073](D:/web3/code_project/tango-paper-trade/src/core/engine.js:1073) | 真实买入：native=$2000/token=$1e15，买1ETH得到2e-12 token；卖一半，剩1e-12/cost0.5被删除。现金9.5、realized0/unrealized0，但total=-0.5。价格极端，常规meme不易触发；应保留正成本dust或显式完整处置成本。 |
| B-15 | [state.js:555](D:/web3/code_project/tango-paper-trade/src/core/state.js:555)、[engine.js:1006](D:/web3/code_project/tango-paper-trade/src/core/engine.js:1006) | openedAt=MAX_SAFE_INTEGER、updatedAt=1000严格导入成功，随后卖出因负heldMs报invalidArithmetic。需损坏/手工备份；严格校验必须检查时间关系，卖出不应因显示时长永久受阻。 |
| B-16 | [state.js:181](D:/web3/code_project/tango-paper-trade/src/core/state.js:181)、[engine.js:525](D:/web3/code_project/tango-paper-trade/src/core/engine.js:525) | PATCH slippage10000成功，BUY invalidSettings；platform fee同类。UI标max5000但handler未用checkValidity。共享上限和逐字段反馈，先拒绝无法执行的设置。 |

### B-17 至 B-24：较低优先级问题

| ID | 位置 | 结论与建议 |
| --- | --- | --- |
| B-17 | [dashboard.js:443](D:/web3/code_project/tango-paper-trade/src/dashboard/dashboard.js:443) | 空滑点/网络费经Number('')为0保存；预设过滤/本金min/HTML与core限制不一致。明确空值语义，统一解析、有限性、范围与本地提示。 |
| B-18 | [dashboard.js:573](D:/web3/code_project/tango-paper-trade/src/dashboard/dashboard.js:573) | 1200px画布、72px固定symbol，无maxWidth/测量。200字符合法symbol绘制超宽；context/toBlob失败无明确处理。加自适应排版及PNG产物检查。本次确认调用缺限制，未做完整PNG像素审计。 |
| B-19 | [content.js:314](D:/web3/code_project/tango-paper-trade/src/content/content.js:314)、[content.js:331](D:/web3/code_project/tango-paper-trade/src/content/content.js:331) | quotes:{}、prices:{}、prices:[null]抛TypeError。验证shape/数组/元素/批量上限。只证明单回调异常，不是整个扩展永久崩溃。 |
| B-20 | [dashboard.js:334](D:/web3/code_project/tango-paper-trade/src/dashboard/dashboard.js:334)、[i18n.js:138](D:/web3/code_project/tango-paper-trade/src/shared/i18n.js:138) | 中文仍有ALL PnL/WIN/LOSS/Theme/Best-Worst等；closeAll提示仍说先刷新行情，与同步下单不同。统一可见文案与现流程。 |
| B-21 | [dashboard.js:320](D:/web3/code_project/tango-paper-trade/src/dashboard/dashboard.js:320) | 非compact历史只500笔，无更多/分页/总数；用户无法浏览全部保留历史。添加数量提示和分页，说明CSV导出范围。 |
| B-22 | [state-coordinator.js:473](D:/web3/code_project/tango-paper-trade/src/core/state-coordinator.js:473) | INITIALIZE30→state30/settings10→RESET_ALL10；当前引导用正确RESET_ALL_WITH_BALANCE，旧API无当前UI调用。同步本金或明确弃用兼容API。 |
| B-23 | [engine.js:1128](D:/web3/code_project/tango-paper-trade/src/core/engine.js:1128) | closeAll order quantity100覆盖percent100，1000仓只卖100/剩900/failures0；当前ChainView不传quantity。强制清除数量覆盖或最新全仓数量。 |
| B-24 | [engine.js:1202](D:/web3/code_project/tango-paper-trade/src/core/engine.js:1202) | native=Infinity时complete=true/assets Infinity/pnl NaN；后台行情已检查有限值，纯函数防御缺口。聚合入口/输出检查有限性。 |

## 8. 安全、可靠性与维护风险

本节为边界或风险，不自动算作确认漏洞。

### 8.1 已有安全措施

- Manifest 只申请 `storage`，host permissions 限 GMGN、CoinGecko、DEX Screener；没有钱包/签名/广播实现。
- isolated Guard 的授权存于闭包 WeakMap；公开 DOM 标识仅相关性检查，不能自行授权。
- 页面合成事件被 shell 和快捷买入入口拒绝；重插 native 控件有恢复和去重边界。
- 页面消息报价不自动触发持久校准，扩展 background 的持久输入分开处理。
- DOM文案有转义；严格状态校验覆盖多链地址、数值、来源与旧格式迁移。
- CSV 公式注入已在实际下载路径修复，不能重复报旧漏洞。
- 配额失败使用单次写入/typed error，失败后串行队列能继续。

### 8.2 信任边界需要准确表述

MAIN-world source 字符串和同窗 `postMessage` 不是密码学数据认证。网页可制造合法形状的临时报价，当前设计允许可信用户点击消费这些决策输入；`isTrusted` 证明输入事件来自浏览器用户操作，不能证明报价真实。

open Shadow DOM 允许网页读取或视觉修改 UI。闭包/WeakMap保护执行授权，但不承诺显示内容无法被页面篡改。native sentinel 保护只覆盖声明的 quick-buy/slot，并非封锁整站所有真实买卖/钱包入口。

DOM 报价时间通常是读取时间，不证明页面数据最后更新时刻；网络桥时间为请求开始而非服务端行情时刻。离线、网站缓存和停止重绘场景仍需实测。静态正则验证器只能发现定义过的违规形式，不能独立证明全部事件/网络路径安全。

### 8.3 可靠性、性能与数据口径

- `background` fetch 无明确 timeout，in-flight Promise 仅 finally 清理；网络长期挂起会拖住同key请求，worker重启可能恢复。
- quote cache/抽取遍历有数量限制，但响应 `clone().json()`、页面消息原始批次未完全按字节限流；大型合法响应可能增加内存开销。
- body observer 外还有 route150ms、quote3s、marker1s、health750ms、chart render400ms。部分用于恢复/SPA兼容；应以在线 profiler 决定优化，不能仅因有轮询就断言性能差。
- fast24-slot限制不代表所有维护扫描均常量成本；B-07已确认自激循环，应先消除可避免成本。
- strict import 不从全成交重算现金、累计PnL和日聚合；裁剪后本来也不能从保留窗口重建全账本。应明确聚合真值与保留历史统计的关系。
- 非扩展开发预览的 localStorage fallback逐key写，不具备Chrome一次set相同原子语义；正常扩展主路径走Worker coordinator。
- `SAVE_SETTINGS/REPLACE_STATE/INITIALIZE` 兼容API保留，当前UI主要走PATCH/交易意图；全量settings API不宜多个页面并发使用。

### 8.4 工程和发布

- 生产代码无第三方依赖、无需外部打包器，供应链表面较小；没有TypeScript/专用lint。结构检查＋Node测试是主要门槛。
- 测试需要本地Chrome或 `CHROME_PATH`，README未明确Node/Chrome最低版本与该要求，新环境可在启动几何门槛时失败。
- 当前未见 `.github/workflows`、统一release流水线或锁定工具版本；测试/检查/构建/hash门槛依赖人工顺序。
- `scripts/build.js` 会清整个 `dist`，未来其他产物也可能被删除；必要入口不存在会跳过。建议仅重建目标目录、缺必需文件立即失败，并把check/test串入release命令。
- `dist`虽在gitignore中，仍有32个受跟踪文件；本次重建一致，但没有默认自动parity门槛。
- 本地main显示相对origin/main ahead134；不表示远端已包含当前代码。本次没fetch/push，以本地ref为证据。
- 同为0.3.0的多个开发提交/分支不能仅靠版本识别，交付要附HEAD与包hash。
- SECURITY私密报告说明没有具体链接；README/PRIVACY未明确固定GMGN referral导航。建议补透明说明，未据此确认私密数据上传。

## 9. 设计与计划文档核对

### 9.1 判定方法与主要文档冲突

状态以当前源码、测试和提交共同判断。未勾选框不等于未实现；已批准不等于已完成；历史要求被后续设计替代也不应重新执行。

当前重要替代关系：

1. 07-20 guaranteed等待报价 → 同日instant同步临时估值。
2. 早期名义token价 → 07-22 `$3,200` 市值与1B未知供给策略。
3. route持久选链 → 07-24 tab局部view-only链。
4. 四档GMGN样式/颜色跟随 → 08-11 Tango固定Giant与可信isolated授权。
5. 旧38%/50%表面透明度 → 当前16%/24%。
6. 08-11上游最小36/高host居中 → 08-12完整链exact36矩形。
7. 07-17无frame不构建payload → 后续为迟到iframe先缓存最新payload并重放。

六链smoke正文仍要求Tango外几何匹配相邻GMGN四档按钮，与固定Giant冲突；日期仍07-19但正文追加后续需求。应保留历史验收，新增当前HEAD验收，而非改历史Blocked为Pass。

### 9.2 18 份设计逐项状态

“主体实现”仅表示代码和自动测试存在；在线验收未由此推定。

| 设计文件 | 当前状态 | 说明 |
| --- | --- | --- |
| 2026-07-17-conservative-structure-performance-design.md | 主体实现；部分替代 | Marker/模型拆分、summary复用、并发去重和validator已有；无frame提前退出改为缓存重放 |
| 2026-07-18-gmgn-multichain-paper-trading-design.md | 主体实现；验收未完成 | 六链schema/engine/UI/导出；主题/CSV有差距；在线交易Blocked |
| 2026-07-20-guaranteed-paper-fill-design.md | 部分实现；等待策略替代 | 身份resolver/cache/deep link保留；不再等行情成交 |
| 2026-07-20-instant-paper-fill-performance-design.md | 主体实现；估值升级 | 同步报价/规则/校准；100ms在线体验没有当前证据 |
| 2026-07-21-gmgn-route-supply-detail-resilience-design.md | 主体实现；选链策略替代 | route placeholder/失效/supply；当前tab-local |
| 2026-07-21-paper-quantity-enable-button-resilience-design.md | 主体实现；样式替代 | 精确100%平仓、重新启用、quantity；四档变Giant |
| 2026-07-22-gmgn-paper-ui-quote-onboarding-resilience-design.md | 主体实现 | 3200/1B、无chart、事件重放、公共本金引导；普通price与中性维度校准须区分 |
| 2026-07-23-gmgn-ui-safety-shortcut-marker-design.md | 主体实现；后续强化 | inert shell/referral/read-back/快捷键/axis；08-11加固 |
| 2026-07-24-gmgn-tab-chain-bankr-button-consistency-design.md | 主体实现 | tab-local、Bankr100B、供给与native校准、leafless绑定 |
| 2026-08-01-gmgn-always-clickable-paper-quick-buy-design.md | 主体实现；授权/样式替代 | 绑定、原子回调、in-flight；2s身份等待后缩300ms，MAIN relay被淘汰 |
| 2026-08-02-gmgn-accurate-first-frame-quick-buy-design.md | 主体实现 | new-root首次地址/300ms/nonce/href；旧四档样式已替代 |
| 2026-08-04-gmgn-click-time-detail-quote-design.md | 已实现 | gmgn.js:687、content.js:1689及对应commit回归 |
| 2026-08-04-gmgn-quick-buy-live-size-sync-design.md | 已被替代 | 历史完成；当前明确禁止跟随native size |
| 2026-08-04-gmgn-quick-buy-maximum-safe-typography-design.md | Giant内容保留；多档替代 | 当前14/10px、0.9行高、2px padding |
| 2026-08-04-gmgn-quick-buy-translucent-background-design.md | 已实现；比例替代 | 半透明保留，当前16/24而非旧38/50 |
| 2026-08-04-gmgn-quick-buy-two-line-typography-design.md | 已实现；字体升级 | 两行、inner pointer-inert；Giant统一字体 |
| 2026-08-11-gmgn-paper-trade-hardening-and-locked-ui-design.md | 主体实现；有新发现 | Guard/isTrusted/ephemeral/轴上下文/CSV安全/8MiB；本次发现跨边界问题 |
| 2026-08-12-gmgn-locked-giant-full-fill-design.md | main未实现；别分支开发 | 最新exact36整slot要求；不取消旧安全/交易规则 |

### 9.3 25 份计划逐项状态

勾选数为文本结构统计，部分计划只对Task使用checkbox，因此不能当开发完成率。

| 计划文件 | 已勾/未勾 | 当前实施判定 |
| --- | ---: | --- |
| 2026-07-17-conservative-structure-performance.md | 0/22 | 提取/summary/请求去重/validator主体完成；无frame条款被重放替代 |
| 2026-07-18-gmgn-multichain-paper-trading.md | 0/86 | 本地未跟踪；九模块任务有实现；在线六链验收未完成 |
| 2026-07-20-guaranteed-paper-fill.md | 无checkbox | resolver/cache/deep link实现；等待策略已废弃 |
| 2026-07-20-instant-paper-fill-performance.md | 0/67 | 八任务主体实现；名义价已替代，在线性能目标待测 |
| 2026-07-21-gmgn-route-supply-detail-resilience.md | 无checkbox | 七任务主体实现；持久route选链被tab-local替代 |
| 2026-07-21-paper-quantity-enable-button-resilience.md | 0/35 | quantity/精确清仓/re-enable实现；四档同步已替代 |
| 2026-07-22-gmgn-paper-ui-quote-onboarding-resilience.md | 0/49 | 本地未跟踪；七任务主体实现；手工验收缺证据 |
| 2026-07-23-gmgn-ui-safety-shortcut-marker.md | 0/25 | shell/referral/onboarding/shortcut/axis/checker实现；后续规则升级 |
| 2026-07-23-robinhood-market-cap-marker-recovery.md | 0/16 | 不把supply当MC、fallback、迟到frame重放实现；伪事实marker仍需修 |
| 2026-07-24-gmgn-tab-chain-bankr-button-consistency.md | 0/32 | tab-local/Bankr100B/中性维度纠正实现 |
| 2026-08-01-gmgn-always-clickable-paper-quick-buy.md | 5/50 | Guard/原子绑定/ready/in-flight/supply等主体；旧MAIN relay/2s/四档被替代 |
| 2026-08-01-gmgn-quick-buy-integrity-regressions.md | 18/0 | 全勾与no-chart算术、load重放、供给坐标代码对应 |
| 2026-08-02-gmgn-accurate-first-frame-quick-buy.md | 7/38 | 300ms/new-root/snapshot实现，状态未同步；四档替代 |
| 2026-08-04-gmgn-chart-marker-stability.md | 0/14 | 主要signature/current-axis保护实现；fallback后续修复未合并 |
| 2026-08-04-gmgn-click-time-detail-quote.md | 0/21 | verified snapshot/final quote优先/回归有实现 |
| 2026-08-04-gmgn-quick-buy-live-size-sync.md | 0/23 | 历史实现；当前已替代，不能重新跟随GMGN |
| 2026-08-04-gmgn-quick-buy-maximum-safe-typography.md | 0/9 | 14/10px等内容实现；四profile目标已替代 |
| 2026-08-04-gmgn-quick-buy-translucent-background.md | 0/11 | 半透明实现，比例按后续16/24 |
| 2026-08-04-gmgn-quick-buy-two-line-typography.md | 0/9 | 两行与pointer-inert实现，字体后续升级 |
| 2026-08-11-dashboard-csv-export-safety.md | 0/6 | encodeCsvCell与真实Blob测试完成；列漏失是另一问题 |
| 2026-08-11-gmgn-chart-axis-marker-correctness.md | 0/38 | framecontext/geometry/probe/currentplot主体完成；worker无坐标时隐藏 |
| 2026-08-11-gmgn-paper-trade-integration-verification.md | 0/22 | 四子系统已整合，本次复验test/check/build/parity；不推定历史每个RED/review/手工步骤已做 |
| 2026-08-11-gmgn-trusted-quick-buy-and-locked-giant.md | 0/36 | isolated/isTrusted/ephemeral/fixedGiant实现；新full-fill是下一计划 |
| 2026-08-11-storage-byte-budget.md | 0/38 | 8MiB/依赖压缩/原子写/typed/MiB提示主体实现；无损条数和依赖先slice缺陷见B-01/B-02 |
| 2026-08-12-gmgn-locked-giant-full-fill.md | 0/19 | 当前mainTask1增强未实现；独立分支有开发；Task3在线验收未完成 |

关键提交参考：多链与可靠性主体 `e00ef79`；isolated/可信事件 `6073042/f78e1d6`；页面报价不落盘 `7d84b27`；图表上下文/投影 `fba05b3/2bdb7d2/49f98b7/7ba291f`；CSV安全 `0d6e108`；容量策略 `e435864/67173c7/4897c67/7188c4f`；历史保护后续 `c7c65b4`。这些提交有实施证据，但不能覆盖本次新增的交叉边界复现。

建议新增 `docs/implementation-status.md`，对每个计划维护 implemented/superseded/unmerged/manual-pending、实施commit和当前验收HEAD；两份重要未跟踪计划应纳入版本管理。过时 `awaiting review`、旧测试数量和未更新框应保留历史但明确状态，不能计算一个虚假的完成百分比。

## 10. 测试质量与缺口

### 10.1 已有覆盖的价值

交易/状态测试覆盖六链矩阵、地址规范化、精确百分比清仓、供给来源/launchpad、临时与事实价格、时效、校准、极端算术、迁移、导入类型、跨页面串行和配额失败。内容/适配器测试覆盖SPA、卡片复用、native重插、in-flight、身份晚到、可信事件与跨world调用。图表测试覆盖axis hint、frame generation、清轴、变换、可见范围、Worker fail-closed等。

测试不是空壳；935项全过说明既有回归门槛有效。本次问题集中在 **不同模块各自正确、组合政策却不一致**，以及 mock 的浏览器语义差异。

### 10.2 优先补充的回归

| 测试组合 | 当前盲点 | 应断言 |
| --- | --- | --- |
| 10k＋开放UNKNOWN_FALLBACK＋origin尾部＋Coordinator | 单测字节保护没有覆盖先slice | 可提交；依赖保留；无状态损坏 |
| 低于8MiB＋超10k＋非法尾部导入 | 只测字节超额 | 完整校验、显式拒绝、原状态不写 |
| future1ms＋UPDATE/校准＋strict commit | BUY/SELL已有未来时间保护 | 接受/拒绝政策一致 |
| SELL/closeAll旧确认＋OFF通知＋后台已OFF | 买入覆盖强，卖出遗漏 | 无交易意图或最终拒绝；writes0 |
| fallback市值＋真实current ratio＋实际chart | 几何正确掩盖经济来源错误 | 非事实维度不输出、不占名额 |
| 原生MutationObserver＋相同binding维护 | mock classList为Set，无真实记录 | 无外部更新时收敛 |
| 字节/条数压缩＋日/月/账户 | 聚合与保留窗口混算 | 月总=sum日值；统计范围显式 |
| CSV模型→下载Blob | 模型29列测试，最终20列 | schema相同、所有来源列保留 |
| active-tab view-only链＋通用Popup入口 | 只验证显示链 | 点击必然导航或明确报错 |
| 多provider部分成功/挂起/过期 | Promise.all只成功路径 | 成功链及时显示；过期覆盖不虚报完整 |
| light/auto＋真实CSS＋PNG大文本 | DOM形状测试缺视觉产物 | 主题可读、文本不裁切 |
| positive cost dust＋账务恒等式 | 数量阈值与成本不组合 | total≈realized+unrealized |

### 10.3 仍需在线人工验收

加载当前指定HEAD的unpacked扩展，记录Chrome版本、包hash、时间与各链结果；只操作标有Tango/Paper的模拟控件。至少覆盖首次安装/更新、非默认本金、trench新增/虚拟滚动/native重插、pointer/keyboard、25/50/100%卖出、OFF竞态、跨链账户隔离、不同轴/迟到frame/Worker、导入/容量、语言/主题/PNG。

本报告不把同窗模型里的 `isTrusted=true` 当作真实浏览器手动授权证据，也没有点击GMGN真实交易入口。独立复现用于证明代码路径问题；发布验收还要真实扩展环境。

## 11. 修复与验收建议

### 第一批：数据完整性与提交边界

1. B-01/B-02：统一条数和字节裁剪；先保护依赖；导入完整校验及无损拒绝。
2. B-03/B-05/B-15：所有交易OFF保护、后台最终检查、持久时间关系统一。
3. B-06/B-14：明确全历史聚合与保留窗口；修复日/月一致性和正成本dust。

验收：每项用真实StateCoordinator与内存持久化回归；检查失败writes0、成功单次写、历史依赖和账务恒等式。

### 第二批：页面经济准确性与浏览器行为

1. B-04：独立价格/市值可信过滤，审核另一分支修复。
2. B-07/B-08：幂等结构维护、原生observer收敛、完整36px槽位矩形。
3. B-19：页面quote形状与批次验证。

验收：实际Headless Chrome＋可信事件模型＋在线GMGN；不要用暂停observer替代稳定性修复，也不要以图表数字合法代替来源可信。

### 第三批：可读性、导出与持续体验

1. B-09/B-10/B-11/B-12：CSV共享schema、导航、逐链价格时效/超时。
2. B-13/B-17/B-18/B-20/B-21：主题、表单、PNG、双语与历史浏览。
3. B-16/B-22/B-23/B-24：统一Core API约束与兼容路径。

### 发布门槛与文档收尾

- 自动串联test/check/build/32资产parity；注明Node/Chrome/HEAD/hash。
- 重新验证新增修复，现有935回归全绿；测试数以新报告实际值为准。
- 当前smoke要求改为固定Giant；新验收记录真实Pass/Fail/Unavailable/Blocked。
- 显示临时报价、数据截至时间、历史窗口与统计口径，避免误解模拟精度。
- 更新计划状态索引，不重新执行已被替代的四档样式/MAIN relay策略。

本次任务是检查和报告，因此以上是修复建议，**没有声称缺陷已修复，也没有自动采用未合并分支代码**。

## 12. 证据与复现方式

### 12.1 附件

- [核心详细证据](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/core-audit.md)
- [GMGN集成与浏览器详细证据](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/gmgn-audit.md)
- [UI、计划与发布详细证据](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/docs-ui-audit.md)
- [全量测试日志](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/npm-test.log)
- [结构检查日志](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/npm-check.log)
- [构建日志](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/npm-build.log)
- [构建前清单/hash](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/inventory-before-build.json)
- [构建后清单/hash](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/inventory-after-build.json)
- [核心复现结果](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/core-reproductions.log)
- [UI复现结果](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/docs-ui-repro.log)
- [日历复现结果](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/calendar-repro.log)
- [GMGN复现JSON](D:/web3/code_project/tango-paper-trade/docs/audit-evidence/gmgn-reproduction.json)

### 12.2 复现命令

在项目目录用PowerShell运行：

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
node docs/audit-evidence/inventory.cjs
node docs/audit-evidence/core-reproductions.cjs
node docs/audit-evidence/docs-ui-repro.cjs
node docs/audit-evidence/calendar-repro.cjs
node docs/audit-evidence/reproduce-gmgn.cjs
```

审计脚本使用内存状态/测试夹具；GMGN浏览器复现使用独立临时profile、本地HTML并限制外网，结束清理自身临时目录。它们不访问用户Chrome模拟账户或钱包。`npm run build` 使用现有构建脚本，会清理整个项目dist目录，后续应按本报告建议缩小清理范围。

复现脚本依赖当前测试夹具和源码结构，后续重构时需更新。核心/UI/日历脚本带相关断言；GMGN脚本主要输出JSON，需结合结果字段判断，成功退出只表示运行结束。它们不能直接作为“修复已通过”测试。审计结论适用于本报告指定HEAD；独立分支和后续提交需重新验证受影响部分。
