# 文档、Popup、Dashboard 与发布脚本审计证据

审计日期：2026-10-13（Asia/Shanghai）。审计目标为当前工作目录 `D:/web3/code_project/tango-paper-trade`，当前分支 `main`，HEAD `aad772c`。本文是主报告的证据附件；未修改运行时代码。

## 1. 范围与计数

- 当前目录有 **18 份 spec、25 份 plan、1 份手动 smoke 文档**，合计 44 份原始 `docs` Markdown；不是 26 份 plan。`git ls-files docs/superpowers/plans` 只有 23 份。
- 本地未跟踪的 `2026-07-18-gmgn-multichain-paper-trading.md` 和 `2026-07-22-gmgn-paper-ui-quote-onboarding-resilience.md` 已计入并检查。保留 `.backups/`。
- 检查了 README、PRIVACY、SECURITY、popup/dashboard HTML、模型、运行时、CSS、build/validate 脚本与对应测试。
- 文档勾选框只作为维护状态信息。实际功能按当前代码、测试以及当前分支提交交叉判断；未勾选不等于未实现。
- 另一个本地分支 `codex/gmgn-locked-giant-full-fill` HEAD `c0a95d4` 有 full-fill 和 marker 修复，其内容未合并到本次 `main`。不能把该分支能力计入当前发布目录。

## 2. 已实现的产品表面

| 表面 | 当前能力 | 代码证据 |
| --- | --- | --- |
| Popup | 总开关、首次设置入口、当前链选择、原生币现金/权益/PnL/持仓数、当前链持仓列表、独立全链 USD 摘要、语言、统一本金、确认后全部账户重置、Dashboard/GMGN 入口 | `src/popup/popup.js:161-255`；`src/popup/model.js:4-19` |
| Dashboard 总览 | 当前链权益、总/已实现/未实现 PnL、现金、持仓数、交易数、胜率、profit factor，六链账户卡及全链 USD 汇总 | `src/dashboard/dashboard.js:281-305`；`src/dashboard/model.js:31-53` |
| Dashboard 持仓 | 当前链代币、成本、市值、盈亏/ROI、入场/当前市值、持仓时长 | `src/dashboard/dashboard.js:308-316` |
| 历史 | 当前链搜索（symbol/CA）、日期/买卖/胜负筛选；最近 500 笔上限；市值派生成交隐藏合成单价；卖出 PNG 分享与复制 | `src/dashboard/dashboard.js:319-335,380-405` |
| 日历 | 月切换、每日 PnL、点击日期进入历史、月度统计 | `src/dashboard/dashboard.js:338-355`；`src/dashboard/model.js:76-101` |
| 设置 | 全局语言、显示币种、主题、卖出预设、滑点、平台费、PnL Bar 位置、fast/confirmation/sound/list quick buy；每链买入预设与网络费；统一本金变动确认并原子重置全部链 | `src/dashboard/dashboard.js:358-377,431-500` |
| 数据 | 当前链 CSV；六链 JSON 备份/恢复；区分当前链和全部链重置；过大导入显示实际/预算 MiB；PNG 下载与 Clipboard API 复制，复制失败自动下载 | `src/dashboard/dashboard.js:412-429,503-617` |
| 首次引导 | 公共数值默认 10，六链各自原生单位；先 reset、read-back 校验、持久 `onboardingInitialized`、打开 GMGN、再关闭引导；重复点击/打开失败重试保护 | `src/dashboard/dashboard.js:158-270`；`tests/dashboard-runtime.test.js:583-784` |
| 国际化 | `en`/`zh-CN`/跟随浏览器，字典 fallback、变量替换；核心交易/错误/引导文案双语 | `src/shared/i18n.js:143-159` |
| 发布 | 无第三方依赖、Node 内置测试；结构检查验证版本、manifest 引用、依赖顺序、worker 相对 imports、语法和 paper-only 静态规则；复制 unpacked 构建 | `package.json:6-10`；`scripts/validate-extension.js:212-270`；`scripts/build.js:1-21` |

**动作范围澄清**：Dashboard 持仓只有展示，没有直接买入、卖出或平仓按钮；Popup 也没有交易/平仓。已实现的买卖、breakeven 与 close-all 位于 GMGN 的 Tango 内容 UI。这符合现有独立链/GMGN 入口设计，不应把“Dashboard 不能下单”直接标成遗漏需求。

## 3. 已确认问题及复现

运行 `node docs/audit-evidence/docs-ui-repro.cjs` 可复现 UI-1 至 UI-6。脚本直接加载真实 Popup/Dashboard source，复用项目既有 VM harness，所有改动只在内存。执行结果为 exit 0，六项断言通过。

### UI-1 / P2：Popup 跟随活跃 GMGN 链时，GMGN 入口可能无反应

- `src/popup/popup.js:50-54,270` 有意采用当前活跃 GMGN tab 链作为 view-only 选择，不写全局设置。
- `selectedModel` 在 `src/popup/popup.js:113-118` 要求 visible chain 与持久 `settings.selectedChain` 相同；GMGN 入口在 `:252-255` 必须通过该检查。
- 复现：持久 `eth`，打开 `robinhood` GMGN tab；Popup 正确显示 Robinhood，但点击 GMGN 没有 `TANGO_OPEN_GMGN` 消息，按钮没有反馈。已有测试 `tests/popup-runtime.test.js:399-419` 验证 view-only 切链，却没有覆盖此入口。
- 建议：通用 GMGN 链接没有链限定交易含义，应直接发通用导航消息；或只等待显式 selector 写入，不要求 view-only chain 必须匹配持久 chain。

### UI-2 / P2：最终 CSV 文件漏掉模型已经提供的九个行情/供给溯源字段

- `src/dashboard/model.js:58-65` 返回 29 列，含 `quoteSource/paperFallback/provisional/syntheticTokenPrice/syntheticNativePrice/totalSupply/supplySource/launchpad/launchMode`。
- 最终下载 `src/dashboard/dashboard.js:529-534` 自己维护 20 列 header，上述九列全部丢失。用户无法仅凭 CSV 复原 fallback、合成报价和 1B/2B/100B 供给语义。
- `tests/dashboard-model.test.js:146-157` 名为“CSV exports paper quote and supply provenance”的测试只测模型；最终 Blob 测试没有做 model-to-file schema 对照，因此全量测试仍通过。
- 建议：模型共享单一 CSV schema，并在真正下载文件上断言完整列；保留已有注入防护。

### UI-3 / P2：USD 报价只在页面初开请求，时间戳未参与 UI 过期判断

- Dashboard `src/dashboard/dashboard.js:56-60` 用 `nativePricesRequested` 只请求一次；storage reload、切链或其他状态更新不再次抓取。Popup `src/popup/popup.js:78,259-267` 初次抓取，后续 storage 变化只 reload/render。
- Dashboard `:71-86` / Popup `:141-150` 接受 `ok && Number(price)>0`；保存 observedAt 但 `model()`/模型未读取这些时间戳，没有显示“截至时间”或 stale 状态。`observedAt=1` 的 price 123 仍被采用；长期开着的 Dashboard 可无限期显示首次 native/USD 汇总。
- 首屏不会被网络阻塞：两个页面在 refresh 前已 render，refresh 被 fire-and-forget 调用。应避免误报“原生币价格请求令整个页面无法 load”。
- 建议：添加定期/手动刷新、最大年龄与过期显示；native quote 更新及时独立 render。

### UI-4 / P2：单条挂起价格消息阻止全部六链 USD 刷新

- Dashboard `src/dashboard/dashboard.js:71-84` 和 Popup `src/popup/popup.js:141-149` 用 `Promise.all` 等所有链响应，才整体赋值。没有单链超时。
- Background `src/background.js:173-175,215-217` 的 fetch 没有 AbortSignal/超时，in-flight cache 在 promise finally 才清理 (`:164-166`)；一个永不结束请求会长期挂住共享资产请求。
- 复现：Solana message 永不 settle，其余链立即返回 price 456；Dashboard `refreshNativePrices` 未完成，ETH 仍显示此前 123，尽管 456 已到达。首屏以及 native 账户仍可用。
- 建议：Background 请求 timeout/abort；UI 每个链单独应用结果并标示 unavailable/stale，避免成功链受失败链拖累。

### UI-5 / P3：设置数值输入未实现完整一致校验

- `src/dashboard/dashboard.js:440,443-444` 对空字符串执行 Number，结果 0；`:451-454` 只显式验证统一本金。空滑点、网络费可静默保存为 0，影响后续模拟成本。
- `parsePresets` (`:407-410`) 仅 `>0`，忽略无效项、截取 12 项，没有本地有限值、卖出<=100 等反馈；后端 strict validation 会拒绝 Infinity、负网络费/越界 sell，但 UI 只显示泛化 `settingsSaveFailed`。HTML input max5000，而核心 `src/core/state.js:181-182` 接受至10000；click handler 不调用 checkValidity，所以5001可写入。
- 本金 HTML min0.01 (`dashboard.js:180,366`、`popup.js:200`) 与 JS `>Number.EPSILON` (`dashboard.js:203-205`、`popup.js:23-24`) 不一致。Popup 无效本金仅静默 return (`:229`)。
- 建议：保存前一次性完整解析与逐字段错误，明确空值语义，统一 HTML/UI/core 约束；不将后端拦截后的泛化错误等同于已做完整表单验证。

### UI-6 / P3：PNG 对长 symbol 不做排版限制且缺少产物测试

- `src/dashboard/dashboard.js:573` 使用 72px 固定字体 `fillText(trade.symbol,70,190)`，没有 maxWidth、measureText、缩放或截断。200字符 symbol（导入/页面允许）会远超1200px画布而被裁切；PnL过长亦类似。
- `:568,581-585` 对 context null/toBlob null 无错误反馈；Clipboard 失败回退下载已实现，但用户点“复制”实际变成下载时没有明确状态。
- 当前 runtime harness `tests/dashboard-runtime.test.js:250-256` 的 createElement 对 canvas 没有真实实现，项目没有 shareTrade 的产物/像素验证。复现已确认长 symbol 的 fillText 只有三个参数、没有测量步骤。
- 建议：约束文本宽度、根据测量自适应排版；增加正常/超长 symbol、盈亏大数和复制失败的 PNG 产物 smoke。

### UI-7 / P2：浅色主题只有变量切换，大量容器仍保持深色

- Dashboard `src/dashboard/dashboard.js:135` 设置 data-theme，`src/dashboard/dashboard.css:8` 将 text 改深色/背景变量改浅色。
- `.sidebar` (`dashboard.css:14`)、`.card` (`:42`)、`.input/.select` (`:60`)、`.calendar-day` (`:66`) 写死深色背景，没有 light override。浅色模式下深色字落在深色 card/field 上，文本对比度严重降低。
- Popup `src/popup/popup.css:1` 只有暗色变量，Popup runtime 未设 theme；内容 shell `content.css:10` 也是固定 dark。主题设置保存正常，但“全局主题”的可见行为不完整。`theme:auto` 在 Dashboard `dashboard.js:135` 被直接归为 dark，没有读取 prefers-color-scheme；设置 UI `:364` 也没有 auto 选项。
- 建议：所有颜色依赖语义变量，补主题/auto跨页面检查；明确当前主题是否仅 Dashboard 应用。

### UI-8 / P3：中文界面仍有硬编码英文与过时提示

- `src/dashboard/dashboard.js:316` Chain；`:334` ALL/ALL PnL/WIN/LOSS；`:353` Best/Worst；`:363-364` Native/Theme/Dark/Light；`:371` PnL Bar/Bottom/Top；`:377` Data；PNG标题`:572` TANGO PAPER TRADE。
- 核心中文交易文案已有，但“English and Simplified Chinese”的完整程度不足；不能称没有 i18n。
- `src/shared/i18n.js:138` closeAllHint 仍说“先刷新模拟行情”，现在 click-path tests 明确不能等待行情 (`tests/content-structure.test.js:124`)。旧 quoteQueued 等遗留键存在本身是维护项，未证明可达。
- 建议：集中所有可见标签，检查两种语言与旧流程描述；无需删除兼容字典键来伪造实现完成。

### UI-9 / P3：历史截断没有分页/数量提示，CSV不跟随筛选

- `src/dashboard/dashboard.js:320` 非 compact 历史只渲染500笔，无分页/load-more/“共n条”提示；即使storage预算允许更多记录，用户无法逐页查看。
- `:528` CSV用全当前链 rows，不带 runtime.filters；搜索/日期/胜负筛选后下载仍是整链历史。该行为是当前实现，不必当作违反已批准设计（07-18计划要求selected-chain CSV而未承诺filtered CSV），建议在按钮注明“导出本链全部”或提供筛选导出选项。

## 4. 已解决与不能重复报告的问题

- **CSV formula injection 已修复**：`src/dashboard/dashboard.js:535-546` 对每个 string cell 的首个非空白/control字符为 `=+-@` 加单引号；保留数字负数、BOM、quote/newline escaping和原始JSON/state。`tests/dashboard-runtime.test.js:863-906` 测真正下载 Blob。提交 `0d6e108`。不能把当前CSV标为公式注入漏洞。
- **重置语义已区分**：选链 reset / all reset / common capital reset 三条路径。选链 reset 等待写入且确认后再次核对 chain (`dashboard.js:503-520`)，全部 reset / common balance有明确范围确认与失败回滚。`tests/dashboard-runtime.test.js:527-580,786-846`；`tests/popup-runtime.test.js:438-485`。JSON restore会替换全六链数据是备份恢复语义；当前导入没有额外confirm，应文档化而非推断成安全漏洞。
- **onboarding重试不会再次清空已验证账户**：持久 onboardingInitialized 以及 completion gate；测试覆盖 intervening trades、重复点击、close失败。不能以常见UI模式推断重复reset bug。
- **全链USD与单链操作分离已实现**：模型和runtime仅选链持仓/历史/重置。合计是只读，缺价提示存在；缺价不是跨链交易。
- **07-17 no-frame零payload性能要求已被后续replay明确改变**：`content.js:2454-2457` 即使没frame也先保存最新payload；`tests/content-structure.test.js:22-27`明确要求新行为。应更新旧文档状态，不能当成无意性能回归。

## 5. 未实现、被替代与未验证范围

1. **当前 main 尚未实现 08-12 full-fill**：完整slot->wrapper->action host->paper->painted geometry完全相同36px矩形。当前 `content.css:19-46` 上游只有min-height36，无height/max-height/native box-model中和。现有 `tests/gmgn-adapter.test.js:630-640` 允许slot/host>=36。outer button36px已实现，整slot full-fill尚未实现。
2. **另分支有 full-fill修复但未合并**：`git branch -av`示`codex/gmgn-locked-giant-full-fill c0a95d4`，含 `0bec8a9`, `41b827d`, `41f71ff`。只可记“独立分支已开发”，不能记“当前项目已部署”。后续 marker fallback修复同理。
3. **真正在线GMGN扩展流程未验收**：smoke文档报告browser policy阻止chrome://extensions加载；XLayer没有可见detail link。项目有真实本地headless Chrome几何/可信事件夹具，不能把所有测试统称纯mock，也不能据此声明已完成在线六链full flow。
4. Worker/offscreen-only axes没有事实numeric mapping时marker保持隐藏，这是08-11 spec明文的fail-closed限制。不要列为“应显示任意线”缺失。
5. 实盘钱包/签名/approval/swap、云账户/同步、跨链交易/混合持仓、真实执行API、任意站点支持、通用回测/自动策略均非已批准目标。它们不是项目未完成todo。

## 6. 18份 spec 逐项映射

状态“已实现”表示当前源与测试存在，不代表在线手动全部通过。“已替代”表示必须依据后续设计解释，不能恢复旧策略。

| spec文件 | 实施状态与证据/差距 |
| --- | --- |
| `2026-07-17-conservative-structure-performance-design.md` | 核心拆分/summary复用/request coalescing/static validator已实现：`markers.js`、`content.js:2265,2487`、`background.js:158-166,203-207`；`tests/content-structure:22,30`。no-frame先return条款后被07-22即时缓存/replay替代。旧基线38测试/0.2.17仅历史快照。 |
| `2026-07-18-gmgn-multichain-paper-trading-design.md` | 六链registry/schema-v2/选链UI/CSV/JSON/PNG已实现（UI模型、engine/state、chain suites；提交73ea2bb/4497fe8/498fa02/ebdebaa）。实际live验收未完成；reset principal后由07-22统一本金政策收敛；主题与CSV产物差距见UI-2/UI-7。 |
| `2026-07-20-guaranteed-paper-fill-design.md` | exact identity caches/入口resolver/当前链history deep link已实现（提交2466ea1）。quote等待/pending意图策略已被同日instant spec:5取代，当前不应再实现等待行情。 |
| `2026-07-20-instant-paper-fill-performance-design.md` | 同步snapshot/immediate fills/launchpad supply/neutral calibration实现（f1034ff/f6aaf21/29b43aa）；`tests/content-structure:124`禁止网络等待。nominal$1 token被07-22$3200/1B替代；约100ms在线体验没有报告证据。 |
| `2026-07-21-gmgn-route-supply-detail-resilience-design.md` | route placeholder/链切换失效与supply更正实现（ed476b1/a118077；adapter/runtime tests）。原“route写global selectedChain”被07-24 tab-scoped view-only替代。 |
| `2026-07-21-paper-quantity-enable-button-resilience-design.md` | 精确100%平仓、re-enable与launchpad quantities实现（ddd5109/58a2735/3b907ca）。四档geometry被08-11固定Giant替代；full-fill是后续未合并增强。 |
| `2026-07-22-gmgn-paper-ui-quote-onboarding-resilience-design.md` | deterministic$3200/1B、route无chart控件、event-driven marker、common-capital onboarding已实现（3c507c0/5257872/988ee87/ca9500b）。原“later quote永不改remaining quantity”对ordinary price适用；07-24 supply/native dimension correction允许改剩余quantity但保留历史/cost。 |
| `2026-07-23-gmgn-ui-safety-shortcut-marker-design.md` | inert shell/shared referral/onboarding read-back/Alt+Shift+P/current scale实现（9f36cad；background265/273、dashboard583等测试）。旧live-size与scale安全细节被08-11强化。 |
| `2026-07-24-gmgn-tab-chain-bankr-button-consistency-design.md` | tab-scoped链、Bankr100B与dimension calibration、稳定native-leafless插入实现（e00ef79；popup399、gmgn-adapter4473、engine571-708）。透明/size presentation被08-04与08-11替代；Popup导航新增bugUI-1。 |
| `2026-08-01-gmgn-always-clickable-paper-quick-buy-design.md` | Guard、action identity、atomic publication、in-flight去重及no-chart数量实现（e00ef79，adapter3956-4168/4396等）。2秒addressless auto-claim被08-02 300ms取代；MAIN relay及四档样式被08-11 isolated opaque authority/Giant取代。 |
| `2026-08-02-gmgn-accurate-first-frame-quick-buy-design.md` | new-root首个address、300ms意图窗口、chain/nonce/href校验已实现（e00ef79；adapter4038,4146,4168,5239）；status仍写awaiting review属过时。四档geometry已替代。 |
| `2026-08-04-gmgn-click-time-detail-quote-design.md` | 已实现：`gmgn.js:687-720` verified DOM snapshot，`content.js:1689-1711` final-submit选择；adapter4574-4626/内容6070等测试；e00ef79。 |
| `2026-08-04-gmgn-quick-buy-live-size-sync-design.md` | 历史已实现（e00ef79），但当前明确不再follow GMGN大小：`gmgn.js:1163-1167,1543-1549`固定Giant。旧status仍awaiting review，应标superseded by08-11。 |
| `2026-08-04-gmgn-quick-buy-maximum-safe-typography-design.md` | two-row字体放大已实现/保留：content.css:50-51的14/10px、95/120/138的.9 line-height、101的0 2px padding。四档目标现由Giant统一取代，不是待实现四套字体。 |
| `2026-08-04-gmgn-quick-buy-translucent-background-design.md` | 半透明背景已实现；38/50%旧目标被08-11 16/24%替代（content.css:85/106）。不能按旧百分比记bug。 |
| `2026-08-04-gmgn-quick-buy-two-line-typography-design.md` | 中文PAPER label+amount两行实现（content.css:83-104,112-147），小字体profiles被maximum-safe/lockedGiant取代。 |
| `2026-08-11-gmgn-paper-trade-hardening-and-locked-ui-design.md` | 四分支功能已整合到main：opaque Guard/isTrusted shell/ephemeral pages/lockedGiant，chart axis事实mapping，CSV安全，8MiB budget及typed失败（6073042/f78e1d6/7d84b27/7ba291f/0d6e108/e435864等）。上游>=36不是08-12exact full-fill；live-online未验。 |
| `2026-08-12-gmgn-locked-giant-full-fill-design.md` | 当前main仅spec+plan提交f281957/aad772c，无增强实现；另分支c0a95d4已开发未合并。该spec:90-98明确只取代上游min-height/tall-host居中几何，不取代既有安全交易。 |

## 7. 25份 plan 逐项映射

| plan文件 | checkbox x/空 | 当前源/测试/提交交叉结果 |
| --- | ---: | --- |
| `2026-07-17-conservative-structure-performance.md` | 0/22 | Marker helper、summary reuse、并发去重、validator四tasks已落实；c9fdf79/9dc3690及background tests；部分no-frame契约被后续replay取代。 |
| `2026-07-18-gmgn-multichain-paper-trading.md` | 0/86 | **未跟踪本地文档已读**；九tasks主体（registry/state/engine/background/adapters/content/popup/dashboard/release docs）均有代码与测试；live六链验收blocked，UI-2/UI-7仍需修正。 |
| `2026-07-20-guaranteed-paper-fill.md` | 无checkbox | resolver/cache/deep link已实现；等待行情条款已废弃，同日instant继承统一resolver改为同步fallback。 |
| `2026-07-20-instant-paper-fill-performance.md` | 0/67 | 八tasks主体已实现（supply/observation/calibration/native/background/coordinator/content/performance/release）；100ms在线目标未测；nominal token quote被后续替代。 |
| `2026-07-21-gmgn-route-supply-detail-resilience.md` | 无checkbox | 七tasks的placeholder/cross-route失效/supply校准已实现；route持久selectedChain策略后被07-24改为tab-local。 |
| `2026-07-21-paper-quantity-enable-button-resilience.md` | 0/35 | quantity/exact full close/re-enable已实现，native four-size同步已被lockedGiant替代，线上验收不足。 |
| `2026-07-22-gmgn-paper-ui-quote-onboarding-resilience.md` | 0/49 | **未跟踪本地文档已读**；七tasks主体有代码/测试/历史，firstinstall与verified reset已实现；全部空框不足以证明未做；full live acceptance依旧缺证据。 |
| `2026-07-23-gmgn-ui-safety-shortcut-marker.md` | 0/25 | inert shell/referral/onboarding/shortcut/axis fit/release checker已实现；后续size/axis升级覆盖旧细节；live未验证。 |
| `2026-07-23-robinhood-market-cap-marker-recovery.md` | 0/16 | supply不能当MC、quote-less$3200及delayedframe replay实现；adapter4473/4776-4917、marker/runtime tests；e00ef79。 |
| `2026-07-24-gmgn-tab-chain-bankr-button-consistency.md` | 0/32 | tab-local chain、Bankr100B/neutral dimension correction实现；e00ef79。旧透明/size政策已替代。 |
| `2026-08-01-gmgn-always-clickable-paper-quick-buy.md` | 5/50 | 七tasks的guard/atomic callback/ready-resolving状态/supply/headless/lifecycle主体实现；addressless2秒与MAIN relay/四size先后被取代；不能以50空框认定50未实现。 |
| `2026-08-01-gmgn-quick-buy-integrity-regressions.md` | 18/0 | 全勾选，与no-chartBankr算术、iframe-load replay、supply-price mapping代码/测试一致；e00ef79。后续fail-closedmapping收紧仍保留主体。 |
| `2026-08-02-gmgn-accurate-first-frame-quick-buy.md` | 7/38 | 300ms/new-root首地址及snapshot已实现；adapter真Chromegeometry测试存在；四size表现已被固定Giant取代。 |
| `2026-08-04-gmgn-chart-marker-stability.md` | 0/14 | entry average signature/current axis generation实现（e00ef79及后续7ba291f/49f98b7）；某些fallback signature边缘修复在另分支尚未合并，应以marker审计具体finding为准。 |
| `2026-08-04-gmgn-click-time-detail-quote.md` | 0/21 | 3tasks主体实现：verified snapshot、content commit时quote优先与回归/build；e00ef79；未更新框。 |
| `2026-08-04-gmgn-quick-buy-live-size-sync.md` | 0/23 | 历史实现但已superseded；currentGiant不再native-size sync，重启旧实施会违背08-11新批准要求。 |
| `2026-08-04-gmgn-quick-buy-maximum-safe-typography.md` | 0/9 |14/10px/.9/2px已在CSS；四profiles旧目标被Giant统一取代。 |
| `2026-08-04-gmgn-quick-buy-translucent-background.md` | 0/11 | 半透明CSS已实现，normal/hover从38/50改到当前16/24有后续spec依据。 |
| `2026-08-04-gmgn-quick-buy-two-line-typography.md` | 0/9 | column两行/inner pointer-inert已实现，字体profile后被升级。 |
| `2026-08-11-dashboard-csv-export-safety.md` | 0/6 | encodeCsvCell+真实Blob断言已实现；提交0d6e108；UI-2列漏失是另问题，不推翻公式安全修复。 |
| `2026-08-11-gmgn-chart-axis-marker-correctness.md` | 0/38 | framecontext/generation/canvas probe/currentplot/failclosed主体落实（fba05b3/2bdb7d2/49f98b7/7ba291f），worker-onlyunsupported是明文限制；另分支markerfallback后续尚未并入。 |
| `2026-08-11-gmgn-paper-trade-integration-verification.md` | 0/22 | 四子系统已在main整合，项目test/check/build/parity可由本次主报告复验；步骤包括req-code-review历史无结构化收尾台账，不凭空宣称已做每个RED/review/manual步骤。 |
| `2026-08-11-gmgn-trusted-quick-buy-and-locked-giant.md` | 0/36 | opaque isolatedcallback/isTrusted/ephemeral pagequotes/Giant实现，6073042/f78e1d6/31fe7be/7d84b27；上游最低36px改为完整slot固定36px是08-12新task，而不是本plan未做fixedbutton。 |
| `2026-08-11-storage-byte-budget.md` | 0/38 | 8MiB UTF8 dependency-compaction/coordinator atomic writes/lossless large import/typed errors跨contexts/dashboardMiB已实现（e435864/67173c7/4897c67/7188c4f/37c9312/c7c65b4）；core审计另有统计/数据风险。 |
| `2026-08-12-gmgn-locked-giant-full-fill.md` | 0/19 | Task1exactCSS和强geometrygate在当前main尚未实施；另worktree branch有实现。Task2本次audit能验证当前mainbuild，不等于newfeature完成；Task3live验证仍未见currentmain证据。 |

## 8. 文档与发布维护问题

1. README描述总体能力准确，但没有明确“固定36pxGiant，用户GMGN按钮size不影响Tango”；旧smoke `docs/multichain-smoke-test.md:15-27` 仍要求“每个size外几何匹配GMGN邻居”，这与08-11固定Giant直接冲突。应修订为所有native size都同一TangoGiant，full-fill按合并后新的矩形验收。
2. smoke日期仍2026-07-19，正文已追加多次后续需求；全六链结果表仍blocked，不能用于今天version0.3.0完整上线验收。建议保留历史记录，另建带HEAD/hash/browser/build/time的当前验收。
3. 大量plan空checkbox与stale awaiting-review状态、历史基线不一致。建议维护索引，明确 implemented/superseded/unmerged/manual-pending与commit范围；旧计划应仅引用不再“重新执行”。两份untracked重要计划在新clone缺失，需决定纳入版本控制。
4. `scripts/build.js:7` 删除整个repo `dist`，不只删除`dist/tango-paper-trader`；当前repo包路径没问题，但会清除dist中未来其他artifact。没有先check/test，直接build可生成坏包，`:13`missing entry还会silently skip。建议只重建输出目标并failfast必需资源；CI把test/check/build/parity编为一个release命令。
5. `scripts/validate-extension.js` 是有效结构/语法/有限pattern检查，不是完整security证明。releaseContract (`:170-186`) 等为source regex，无法推导端到端事件/网络完整性；真实Guard tests要保留。validator没有build资产hash parity，主报告已单独复验；默认check只验source，没有自动对dist运行。
6. package version、manifest、constants版本三方一致已在validator检查，但main相比origin/main ahead134，未推出远端；另分支fullfill未合并，version也仍0.3.0。发布应明确HEAD/资产hash，不只version号。
7. README开发步骤没有最小Node/Chrome版本、浏览器安装/权限边界、首次install与update怎样区分、如何检查构建hash；`SECURITY.md:5`仅说repositoryprivate security reporting channel，没有可点击报告地址/联系人；未证明该GitHub渠道启用。
8. PRIVACY准确说public价格请求包含chain/token，无paper数据上传；通用GMGN入口包含固定referral (`src/shared/constants.js:10`)，README/PRIVACY未明示邀请导航行为，建议透明描述。没有发现云同步/钱包请求；无需制造不存在的隐私漏洞。

## 9. 验证边界

本文复现不触发真实交易、不加载GMGN页面、不写Chrome账户存储。PNG长字符串结论基于真实绘图调用和固定canvas边界，未声称已经对PNG像素作完整视觉QA。主代理负责全量 test/check/build/assetparity；本文不重复执行所有测试。在线六链、真实extension permissions与remoteGMGN页面生命周期仍需要单独验收记录。
