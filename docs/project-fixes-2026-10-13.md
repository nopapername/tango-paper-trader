# Tango Paper Trader 修复与验证报告

日期：2026-10-13（Asia/Shanghai）
项目：`D:\web3\code_project\tango-paper-trade`
基准：`main` / `aad772c9469d3b2f8b3ca623a36b2585a4fdb4a6` / `0.3.0`
交付状态：源码及构建产物已保存；未提交 Git，未发布或安装扩展。

## 1. 结论与证据边界

本次在完整代码审计基础上，修复了交易历史保留、导入完整性、关闭开关竞态、图表兜底坐标、DOM 持续扫描、快捷买入布局、行情刷新、收益统计、导出、主题、表单、历史分页以及数值边界问题。原始审计的 24 项问题均有对应代码修复；涉及当前 GMGN 页面、加载扩展后的六链流程和完整视觉验收的结论仍需现场验证。

**没有完成当前线上 GMGN 页面检查。** 重启前后通过浏览器工具访问 `https://gmgn.ai/?chain=bsc`，均因自动审核服务返回 HTTP 404 而未执行。错误为 `codex-auto-review` 模型不存在，请求地址为 `https://api.b.ai/v1/responses`。浏览器初始化还报告 Chrome 连接缺少 Codex auth token。用户打开 GMGN 页面这一事实不能证明工具已读到其 DOM，也不能证明扩展已经安装或适配成功。

因此，本次使用已有项目源码、历史 DOM 结构、经选择核对的本地开发分支实现和隔离的 Chrome 测试进行修复。未猜测新的线上选择器，未通过替代浏览器、外部抓取或原始 CDP 绕过失败的审核。**“本地回归通过”与“当前 GMGN 实测通过”是不同状态。**

原始 [完整审计报告](project-audit-2026-10-13.md) 和 [历史证据目录](audit-evidence/) 保留。本文记录后续变更，不把历史发现改写成从未发生。

## 2. 修复范围与当前功能

项目仍为无运行时第三方依赖的 Chrome Manifest V3 模拟交易扩展。注册链为 Solana、Ethereum、BNB Chain、Base、Robinhood Chain、X Layer；各链持有独立原生币账户。主要可用代码包括：

- GMGN 代币详情模拟买卖、战壕快捷买入、跨页持仓抽屉、原生币盈亏栏和图表标记。
- 六链独立本金、现金、仓位、成交、日收益；统一数值本金的首次引导与原子重置。
- 默认 $3,200 / 暂定 1B 供给的确定性兜底、事实行情升级与中性校准；成交历史保留来源。
- Popup 和 Dashboard 的活动链展示、全链只读 USD 汇总、每链网络费及买入预设、全局卖出和费用设置。
- 完整 JSON 备份与严格恢复、29 列当前链 CSV、分页历史、月度收益日历及 PNG 成果卡。
- 英文与简体中文、深色/浅色/系统主题、确认弹窗、快捷键、声音和填单提示。

这些功能在源码和自动化测试中存在。线上 GMGN DOM、API 响应和图表可能继续变化，不能据此承诺所有当前页面均能工作。钱包连接、真实签名/交易、云同步、自动策略和通用回测没有实现，也没有在本次添加。

## 3. 原审计问题逐项处理

“已修复”表示对应缺陷已改且通过所列本地验证，不代表在线验收。

| ID | 原优先级 | 本次处理 | 验证与限制 |
| --- | --- | --- | --- |
| B-01 | P1 | Engine/State 不再提前截断交易；Coordinator 统一处理条数和字节限制，保留开放 fallback origin、依赖记录及本次交易 | 有效 fallback 仓位来源位于 10,000 条尾部时，新交易仍可严格持久化；无可安全移除记录时显式失败 |
| B-02 | P1 | v1/v2 导入完整校验；交易或校准各超过 10,000 条，明确 `importTooManyRecords` 拒绝 | 10,001 条、非法尾部和 v1 测试；失败不写入现有账户，8MiB 限制继续生效 |
| B-03 | P2 | 所有卖出、回本、抽屉、清仓及旧确认提交检查 OFF/设置待刷新；Coordinator 读最新设置再次检查 | pending true 与实际 OFF、旧弹窗直接调用及可信点击均不成交；服务端事务层拒绝 `paperTradingDisabled` |
| B-04 | P2 | 按价格/市值分别检查事实来源；合成初始市值不参与标记；过滤后才选择买入/卖出名额 | 实际 Coordinator→Engine→strict 持久化→markers 集成；事实卡片市值仍可作市值坐标，事实价格不被合成市值连带过滤 |
| B-05 | P2 | 报价刷新与校准使用安全持久观察时间，避免允许的轻微未来时钟偏移违反 `updatedAt` 规则 | 未来偏移报价更新/校准可持久化；不因此把原始事实观察时间伪造成更早来源 |
| B-06 | P2 | 月总收益使用持久日汇总；胜率、交易数、最佳/最差标明为保留卖出记录口径 | 删除历史后每日/月合计保持一致；没有虚构已压缩历史的胜率 |
| B-07 | P2 | 结构宿主集合差分；class、style 和布局属性按差异写入；observer 忽略同值属性记录 | 真正 Chrome MutationObserver 静态阶段 0 次回调/0 次重发现；React 重插和 class 漂移修复后停止扫描；href 变化继续完整处理 |
| B-08 | P2 | 锁定 Giant 的槽位、结构包装、action host、button、paint 共用 36px 高矩形，消除原生尺寸/边距/边框/transform 干扰 | 3 种结构×6 种原生高度共 18 组几何测试；保留 14px 金额、10px Paper、焦点及交互；未现场验证新 DOM |
| B-09 | P2 | CSV 下载与模型共用冻结的 29 列定义，包含原先缺失的 9 个来源/供给字段 | 最终 Blob 字节、BOM、行数/列数、当前链范围、公式防护验证 |
| B-10 | P2 | Popup 打开 GMGN 不再要求活动链等于持久选链 | 活动 robinhood、持久 eth 仍可导航；失败显示反馈 |
| B-11 | P2 | 原生币价格根据观察时间过期；30 秒轮询、手动刷新；Dashboard 显示报价时间 | UI 60 秒展示 TTL，后台 15 秒缓存；过期/缺失链使 USD 汇总不完整 |
| B-12 | P2 | UI 每链独立应用、8 秒等待上限；后台 fetch 和 JSON body 均受 6 秒超时及 abort 保护 | 一个链挂起不阻塞其他链；请求锁超时释放；迟到 body 不污染缓存；SOL 两阶段兜底最长约 12 秒 |
| B-13 | P2 | 主题解析共享，Popup/Dashboard/Shadow overlay 支持 light/dark/auto；修复固定背景与浅色低对比文字 | 原生 Chrome Popup/Dashboard 样本对比度及主题变化保留草稿/焦点/选区；overlay 的系统主题和 CSS 另行验证；无完整线上像素验收 |
| B-14 | P2 | 保留正数量/有成本 dust；剩余数量舍入到零时拒绝，避免静默丢成本 | 真实极小仓位部分卖出仍保留数量和成本；全卖继续关闭 |
| B-15 | P2 | strict import 检查 `openedAt<=updatedAt` 及不晚于备份导出时间；旧已存异常时间仅在非严格读取规范化 | 全卖、部分卖、报价更新、别币买入均可恢复；数量、成本、来源不因时间恢复变化 |
| B-16 | P2 | strict 设置、导入和表单统一最高 9,999bps | PATCH/SAVE_SETTINGS/导入均拒绝 10,000bps；表单有字段级提示 |
| B-17 | P3 | 设置数值/预设完整解析，拒绝空值、非有限值、错误范围和非法列表 | 失败 0 写入，编辑值保留；本金合法范围与核心一致 |
| B-18 | P3 | PNG 文字测量、自适应字体及最大宽度；处理 context/blob 失败、复制失败下载与文件名字符 | 长 symbol、大数及 null blob 回归；尚未做全语言/长文本完整 PNG 像素验收 |
| B-19 | P3 | 页面消息先验证数组、单项平坦 scalar 结构；限制原生价 16 项、token quote 500 项 | 空项、非数组、不可数值转换的 structured-clone 对象均忽略；同批后续合法行情可处理，不持久化页面观察 |
| B-20 | P3 | 统一主要 Dashboard 英中标签；新增错误/刷新/分页文案；更新清仓提示为当前本地行情/临时估值流程 | 双语键与占位变量匹配；代币名、链名、协议标识等仍使用原名称 |
| B-21 | P3 | 历史页每页 100 条，上一页/下一页、匹配条数、范围提示，筛选或换链回首页 | 601 条完整浏览；Overview 保留简洁摘要；CSV 明确导出本链全部保留交易 |
| B-22 | P3 | INITIALIZE 自定义本金同步六链 settings | 初始化 30 后重置仍为 30；合法性严格检查 |
| B-23 | P3 | CLOSE_ALL 强制清除 `quantity` 覆盖并卖出 100% 当前剩余仓位 | 携带部分数量的 API 调用仍全仓关闭；正常 ChainView 流程保持一致 |
| B-24 | P3 | USD 汇总检查有限输入、乘法、持仓累加和全局加总；失败链列为缺失；Dashboard 与 overlay 显示层隔离换算失败 | `Infinity`、有限 1e308 导致的乘法/汇总溢出均不再返回 `complete=true`；保留其他链有限合计，不使整个账户页面停止渲染 |

## 4. 关键实现与行为说明

### 4.1 历史保留与严格恢复

交易纯函数现在可能短暂返回超过 10,000 条的历史。**持久化上限由唯一 Coordinator 统一执行**，而不是纯函数先删除再让 Coordinator 尝试保护依赖。不能把 Engine 的中间结果绕过 Coordinator 直接写入存储。

数量压缩和 8MiB 字节压缩共用依赖规则，保护开放兜底仓位所需来源。本次交易、校准及日收益的完整性继续由严格规范化检查。允许安全压缩的旧历史可能被删除，因此历史统计是“保留窗口”，持久日收益则继续覆盖原始累计收益。

恢复备份不会为了满足数量上限而自动删记录。支持范围内完整导入；超限备份必须在外部明确分割或处理后再导入，不能把拒绝伪装成成功。错误提示会说明现有数据未改变。

旧存储未来开仓时间的兼容恢复只修正时间关系，不修正交易经济字段；strict 外部导入仍拒绝同类损坏数据。新增真实部分卖出/报价更新/另币买入测试，避免只覆盖“全卖删除坏仓位”而漏掉仍有旧仓位时的写入阻塞。

### 4.2 GMGN DOM 与图表

本次没有扩大卡片识别范围或虚构新选择器。适配仍依赖已存在的 TokenItem/TrenchColumn/`group/a`/`.BuyButton-continer` 等结构，以及现有代币地址、链和 chart iframe 验证。

Giant 精确填充选择了本地分支中与既有设计吻合的相关实现，逐项对照本项目执行/持久化来源字段后移植。没有整分支合并。结构 class 差分更新会清除旧宿主、维护新宿主，不因每次重发现都先全部移除再添加而自激扫描。

不对 href 变更执行简单的“最终值相同就忽略”，因为同批地址删除后恢复仍影响卡片身份代际。现有 fail-closed、可信用户激活、绑定 nonce/generation、原生控件隔离和最新原生代际恢复继续由测试保护。

图表只展示有事实依据的维度：事实价格可保留，合成市值需拒绝；卡片独立观测到的市值可保留，即便 token price 是按暂定供给推导。无坐标的兜底成交不会占用标记名额，也不会借当前市值/价格比例制造历史价格。某些老记录缺少完整来源，兼容识别仍有边界，不能追溯证明历史数值的事实来源。

### 4.3 行情与 UI

后台提供商请求的 6 秒边界包含连接和 JSON body。UI 的 8 秒上限独立于后台，用来避免整个视图等待；SOL 若先等待 CoinGecko 超时再查 Wrapped SOL，后台可能超过 UI 本轮等待上限，后续周期可读取成功缓存。没有因展示价格过期而改写历史成交。

原生币 60 秒是 **USD 展示** TTL，成交报价规则仍采用项目原本的更严格观察新鲜度和确定性兜底路径。首屏在网络之前渲染，网络失败只降低 USD 汇总覆盖度，不应阻止显示本地账户和仓位。

定期刷新及系统主题变化保留正在编辑的草稿、焦点、展开状态和可用选区。静态历史和日收益不能凭压缩后残留成交重建完整胜率，因此界面明确标注统计口径。

### 4.4 构建安全

`scripts/build.js` 在清理旧包前验证必需文件、manifest JSON 与本地引用资源；只替换 `dist/tango-paper-trader`，不清理 `dist` 其他文件。`dist` junction/symlink 重定向会被拒绝。已有 `SECURITY.md` 一并打包。

缺资源或损坏 manifest 会在删除旧产物之前失败。独立临时 fixture 验证了缺文件、损坏 JSON、无关 dist 文件保留、可选安全文档和真实 Windows junction 目标保护。

## 5. 代码与文档清单

| 范围 | 主要文件 | 作用 |
| --- | --- | --- |
| 交易与数据 | `src/core/engine.js`、`state.js`、`state-coordinator.js` | 历史依赖、导入、时间、dust、费用、OFF、汇总 |
| 网络 | `src/background.js` | 有界提供商请求、abort、重试锁释放 |
| GMGN | `src/adapters/gmgn.js`、`src/content/content.js`、`content.css`、`markers.js` | 幂等 DOM、精确填充、消息和交易门禁、主题、事实坐标 |
| 界面 | `src/popup/popup.js/css`、`src/dashboard/dashboard.js/css`、`model.js` | 导航、过期/逐链刷新、CSV、分页、日历、表单、PNG |
| 双语 | `src/shared/i18n.js` | 双语键、错误、说明、系统主题解析 |
| 构建 | `scripts/build.js`、`tests/build.test.js` | 输入预检与受限产物替换 |
| 回归 | 对应 `tests/*.test.js`、`tests/ui-theme-browser.test.js` | 真实引擎、Coordinator、运行时和本地 Chrome 门禁 |
| 说明 | `README.md`、`docs/multichain-smoke-test.md`、本文 | 当前行为、依赖、历史结果与现场待办 |
| 产物 | `dist/tango-paper-trader` | 经项目构建脚本生成的未打包扩展 |

没有改变 manifest 权限、主世界 Guard 权限或新增真实金融动作。未修改用户原有 `.backups/` 和两个未跟踪的 7 月计划文档。

## 6. 计划文档的本次状态

原始审计已逐项核对 18 份设计和 25 份计划。本文补充本次变更，不批量勾选历史任务或把文档复选框当成实现证据。

| 计划/方向 | 更新后的判断 |
| --- | --- |
| `2026-08-12-gmgn-locked-giant-full-fill` | 精确矩形 CSS 与原生几何回归已进入当前工作区；线上重载后验收仍未完成 |
| `2026-08-11-gmgn-trusted-quick-buy-and-locked-giant` | 延续可信激活、独立 Guard、锁定 Giant；未回退为随 GMGN 原生尺寸变化 |
| 7 月多链、行情复用、引导韧性计划 | 在已有实现上修复历史、时间、OFF、导出与刷新；原未跟踪计划文件保留 |
| 备份、字节压缩和严格来源设计 | 修复早截断与静默恢复；依赖和数量限制在 Coordinator 统一执行 |
| 六链烟测/图表现场验证 | 历史结果仍为 2026-07-19；本次没有新增在线 Pass，必须恢复浏览器后重新检查 |
| 未批准扩展方向 | 真实钱包、自动交易、云账户等没有添加，也没有把它们算作本次修复完成 |

旧 Giant 计划中的工作树步骤针对该单项历史执行，不代表本次所有审计修复必须整分支合并。本次沿用共享当前工作区，保留未跟踪用户文件并选择移植相关实现。

## 7. 验证结果

验证环境：Windows、Node `v22.18.0`、npm `10.9.3`；本地安装的 Chrome 用于隔离 HTML fixture。测试不使用真实钱包、资金或当前 GMGN 账户。

最终全量测试、结构检查、构建与源包 SHA-256 一致性数据见本节末的最终验证摘要。

关键证据：

- [修复后的全量测试日志](audit-evidence/npm-test-fixed.log)。原始基线为 935 项通过；新增回归包括修复前失败的对应用例。
- [核心最终回归](audit-evidence/core-final-fix-tests.log)：220/220；覆盖有限数值溢出和旧存储时间兼容。
- [GMGN 适配测试](audit-evidence/gmgn-adapter-fixed-test.log)：188/188；含真实 Chrome observer 和精确几何。
- [DOM 稳定性基线失败](audit-evidence/gmgn-mutation-baseline-gate.log) 与 [修复后遥测](audit-evidence/gmgn-mutation-fixed.json)：基线 4 批回调、24 条相关属性记录、3 次延迟扫描；修复后静态 0/0/0。
- [content/background 聚焦回归](audit-evidence/content-background-fix-focused.log)：269/269；追加异常 scalar 项验证后再执行全量测试。
- [构建保护回归](audit-evidence/build-fix-focused.log)：5/5。
- [主题验证日志](audit-evidence/ui-theme-fixed-test.log)：原生 Chrome computed style、主题变化与双语测试；Popup/Dashboard 最低样本对比度 5.117:1；真实 Shadow DOM 浅色/深色各 38 个样本，最低分别为 4.539:1 与 5.117:1。悬停使用等权重 CSS 状态检查。不是截图或完整像素审计。

GMGN observer 漂移修复最多两次延迟重发现后停止；整 wrapper 和单 native leaf 重插均快速处理、一次延迟确认后收敛。OFF 只恢复最新原生控件，原始/前一代不复活，测试过程中原生下单调用数为 0。

没有把旧 `core-reproductions.cjs`/`docs-ui-repro.cjs` 的修复后失败当成新回归：这些脚本多处断言的是原来的错误行为。历史文件和日志保留，修复证据以新增正式测试为准。

原始 B-01 的“卖出 invalidTrade”复现还受到该样例 fallback 来源/报价签名不完整影响，不能单凭这一输出断言全卖仅被 origin 裁剪阻断。确定的原缺陷是新 BUY 删除开放 origin 后 `invalidPosition`；本次新增使用合法来源的持久化和实际卖出测试验证修复。

### 最终验证摘要

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm.cmd test` | **1009/1009 通过**；984 个顶层用例；失败/跳过/待办均为 0 | `audit-evidence/npm-test-fixed.log` |
| `npm.cmd run check` | 版本 0.3.0；manifest 有效，22 个引用文件存在 | `audit-evidence/npm-check-fixed.log` |
| `npm.cmd run build` | 未打包扩展构建成功 | `audit-evidence/npm-build-fixed.log` |
| 源码与产物一致性 | **33/33 文件 SHA-256 相同**，含 SECURITY.md；无额外文件 | `audit-evidence/fixed-build-parity.json` |
| manifest 权限 | 与基准提交相同 | 同上 |
| `git diff --check` | 无空白错误；仅现有换行格式提示 | 本地命令验证 |
| 当前 GMGN 线上 DOM/已加载扩展 | **未验证**：审核服务 HTTP 404 | 本文第 1、8 节 |

相较基准 935 项，新增/扩展后共多 74 项测试。结构和本地浏览器测试覆盖所修问题；不能用测试数量代替现场适配结果。

## 8. 剩余限制与下一步验收

1. **当前线上 GMGN 适配待核对。** 恢复 Codex 审核路由和浏览器授权后，应先读当前 BSC 战壕/详情 DOM，再按事实修改选择器与 API 解析。只运行本地历史 fixture 不足以宣布适配完成。
2. **加载扩展后的六链流程待烟测。** 通过 `chrome://extensions` 重载 `dist/tango-paper-trader` 后，验证卡片虚拟滚动、快捷买入唯一性、部分/全部卖出、OFF 旧确认窗、路线切换、图表重播和原生还原。历史未加载扩展的网页结果不是验收证据。
3. **视觉范围有限。** 已有几何、焦点和代表样本 computed-style 验证；仍需当前页面截图/完整交互以及 PNG 长文本、多语言和大数的像素验收。并未生成可发布的视觉认证。
4. **没有扩大产品范围。** 当前外部行情仍依赖 GMGN、CoinGecko、DEX Screener；注册链缺少站点组件或行情时，继续降级/显示不完整而不是伪造结果。
5. **严格备份兼容性变更。** 10,000bps、数量超限和未来开仓时间的损坏备份将被拒绝；此行为是修复，不再静默改写导入内容。已有存储异常时间有兼容恢复，但不保证任意手改损坏状态能恢复。

待浏览器恢复时，按 [更新后的烟测清单](multichain-smoke-test.md) 检查。若仍出现 `api.b.ai` / `codex-auto-review` 404，应修复应用或代理实际路由；本地提供商配置与错误地址不一致说明可能有外部覆盖，仅改项目源码无法修复该审核服务问题。

## 9. 使用本次产物

开发验证命令：

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
```

Chrome 选择“加载已解压的扩展程序”或重载已有扩展，目录为 `D:\web3\code_project\tango-paper-trade\dist\tango-paper-trader`。实际操作只点击 Tango/Paper 模拟控件，不操作 GMGN 真实交易、钱包或签名控件。

安装、发布、提交和线上验收均未在本次自动执行。源码改动、测试、日志和文档可供用户检查后继续使用。
