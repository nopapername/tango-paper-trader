# GMGN 集成、隔离安全与图表审计证据

审计日期：2026-10-13（Asia/Shanghai）。工作区：`D:\web3\code_project\tango-paper-trade`。当前主分支代码为审计对象；未切换分支、未改运行时代码、未操作真实/模拟账户。

本报告使用静态阅读、项目现有测试夹具、实际生产 Engine/StateCoordinator、临时本地 headless Chrome 页面。测试夹具的 `node:test` 注册在复现脚本中停用，仅调用夹具及实际代码。结果不能替代已加载扩展的 GMGN 在线端到端验证。主代理已执行全量测试 935 通过及扩展 check 通过。

复现命令：

```powershell
node docs/audit-evidence/reproduce-gmgn.cjs
```

原始证据：[gmgn-reproduction.json](./gmgn-reproduction.json)。脚本：[reproduce-gmgn.cjs](./reproduce-gmgn.cjs)。脚本的 Chrome 使用独立临时 profile，`--disable-extensions`、禁用背景联网、主机解析拒绝外网；只测本地 HTML 和项目代码，结束后删除该脚本新建的临时目录。

## 已实现能力

| 能力 | 实现与边界 | 代码证据 |
| --- | --- | --- |
| 六链 token/detail/trench 识别 | 地址格式与规范化、链路由、GMGN 与 Solana Pump.fun 链接兼容；trench 仅限注册的根/推荐路由 | `src/adapters/gmgn.js:65,141,724,732,899` |
| 当前详情身份验证 | 在局部 TokenHeader/BaseInfoBar 内验证 CA，防止 SPA 新 URL 配旧 header；48ms 两次 metadata fingerprint 一致；不明确链绑定时只允许受限恢复 | `src/adapters/gmgn.js:307,365,635` |
| 网络报价截取 | MAIN-world fetch Proxy 和 XHR load 旁路，只处理 GMGN JSON 及相关 API 路径；保存请求发起链与时间，阻止乱序结果覆盖更新字段 | `src/content/page-main.js:13,22,76,86,109` |
| 报价维度与 provenance | 明确 USD 价格、市场值/流动性/总供应量分开时间戳与 source；冲突地址、矛盾三元组、非事实报价、过期/未来时间被拒绝；队列访问有上限 | `src/adapters/gmgn-quotes.js:3,47,59,67,104,132,209,326` |
| 快捷模拟买入 | 只替换 native action leaf，保留 GMGN slot 局部 wrapper；实时按列金额输入同步；对链、地址、href、slot、card、generation、nonce、state 再核验；未知市场资料时有明确 provisional fallback | `src/adapters/gmgn.js:1191,1396,1580,1622,2004` |
| 首帧/缺身份兜底 | resolving-identity → ready → in-flight 状态；首次出生的卡片可记录 300ms 用户 intent，身份出现时 promote；复用/链接不连续/金额变化/移除使旧 intent 失效 | `src/adapters/gmgn.js:973,1325,1332,1416,1692,1732` |
| paper-only 激活隔离 | document-start isolated Guard 的 WeakMap 持有 callback；只接受浏览器可信主键 click；synthetic Event、公开 dataset/actionId/nonce 不能授权；阻断 native sentinel capture/bubble 事件 | `src/content/native-quick-buy-guard.js:5,36,127,174,216` |
| Shell 可信操作 | open Shadow DOM shell 的 capture gate 和 handler 内 `isTrusted` 检查；确认抑制 checkbox 另有 WeakSet 来源记录 | `src/content/content.js:52,65,2496,2555,2571` |
| 页面报价不自动持久化 | MAIN page TOKEN_QUOTES/NATIVE_PRICES 只更新 runtime 显示/决策 cache；持久报价来自扩展 background，`persistenceOnly` 阻止随后定时校准洗白页面报价。可信用户下单可使用当次决策报价 | `src/content/content.js:208,259,902,958,1219,734`; `tests/content-runtime.test.js:6375,6408` |
| 点击/确认时详情报价 | commit 阶段同步重新取完全绑定的 current detail snapshot，DOM/chart/route 不满足时立即用原可靠兜底报价，无需阻塞 fetch | `src/adapters/gmgn.js:687`; `src/content/content.js:1689`; `tests/content-runtime.test.js:5774,5792,5804,5822,5862` |
| Locked Giant 与两行视觉 | native leaf class/style 被清，全部标记 Giant；按钮高36px，金额14px、Paper10px、行高0.9、16% normal/24% hover Tango 色 | `src/adapters/gmgn.js:1163,1543`; `src/content/content.css:48,83,105,112,126` |
| 真实图表投影与生命周期 | 在 MAIN iframe 观察 Canvas text/transform，至少3可信右轴锚点拟合线性/对数；price/MCAP hint、frame generation/probe、token独立身份、source canvas/backing/viewport geometry、clear/worker 状态限制；范围外隐藏，避免钳在边缘 | `src/content/chart-main.js:110,155,364,548,729,848`; `src/content/content.js:2281,2292,2302,2361,2408` |
| Quick-buy 生命周期与去重 | in-flight operation、900ms/1000ms 去重、React native 重插替换、disconnect清理、仅仍精确匹配原生恢复；首次/维护发现分层与24 slot fast budget | `src/adapters/gmgn.js:1622,1825,1852,1952,2004,2241`; `src/content/content.js:632,1625,2656` |

### 未实现、被取代与明确限制

1. **2026-08-12 exact full-fill 当前 main 未实现/未合并。** 当前 CSS 只让 paper leaf 固定36px，上游 slot/wrapper/host最小36px，可保持更高的 GMGN 高度。详见 GMGN-03。
2. 仓库存在 `codex/gmgn-locked-giant-full-fill` 分支（本次只读比较时 `c0a95d4`），它含 full-fill 和 fallback marker provenance 修正；这是**未合并实现**，不能报告为当前主分支已生效。本次审计不评价整个分支是否可直接合并。
3. 08-04 live-size typography 等历史工作不能按“仍有 unchecked box”称为未实现。两行、14/10px maximum-safe Giant、透明背景、同步金额和 click-time quote均有运行时代码。四种 native 尺寸映射已由08-11 locked Giant策略取代。
4. 原生 worker/OffscreenCanvas 轴文字观察没有实现。当前检测 transferControlToOffscreen 后 `WORKER_ONLY` fail-closed；不伪造坐标，这是明确兼容性限制。
5. token DOM 依赖 GMGN sentry 标记、`group/a`、`BuyButton-continer`（拼写也需精确一致）、列标题和小型身份容器。未知结构/重绘中保持空壳/禁止激活；没有通用、可配置、自适应任意 GMGN DOM 的适配层。
6. native quick-buy 保护涵盖声明 sentinel及被替换slot，**并非对整页所有钱包/真买卖入口全面封锁**。GMGN 改 DOM 后需重新验证 sentinel；不应承诺能阻止网站其它交易方式。
7. 缺真实报价时 $1 native、初始 market cap/供应量兜底可模拟成交，此为显式 provisional 策略；模拟成交数量/盈亏不可一概视为真实市场回放。
8. MAIN-world `postMessage` source 字符串可被 GMGN 同窗脚本伪造。当前设计主动允许其作为 ephemeral display/decision输入，可信用户click才可下单、自动校准不使用它。图表 MAIN bridge也不属于密码学可信API。不能把source字符串白名单称为防伪认证。
9. `content.js` 仍2765行、`gmgn.js`2310行的 closure 主体。Marker/ChainView及 popup/dashboard model有所拆分；没有通用 PriceObserver/scheduling/service模块。07-17保守计划明文不改变 observer/timer、其最小模块提取有实现，不能把候选架构重构列为已承诺未完。
10. 当前 `syncChartMarkers` 在无frame时仍先缓存最新payload（`content.js:2454-2457`），相对于07-17“无iframe跳过构建”优化是有意的后续恢复行为：现测试 `content-structure.test.js:22`、`content-runtime.test.js:1594`锁住该行为；可列重复扫描性能权衡，不列确定回归。

## 确定问题

### GMGN-01 — P2：合成 fallback 市值进入事实 BUY/SELL 坐标并占用标记名额

**证据路径/行号：**

- `D:\web3\code_project\tango-paper-trade\src\content\markers.js:43` 把任何正 marketCap作为可用坐标，未检查市值是 `TANGO_FALLBACK` / UNKNOWN_INITIAL_MARKET_CAP。
- 同文件`:46-47` fallback订单可抢firstBuy和最多四个SELL位。
- 同文件`:64-67` 对该合成市值乘当前真实 price/MCAP ratio 或除可信供应量，得到非事实历史价。
- 同文件`:71,88,94,99` 把这些值输出到BUY/SELL marker。
- `tests\markers.test.js:829-875` 现有测试实际承认上述合成3200市值投影，测试全过仍覆盖不到正确事实要求。

**触发：** Base未知token缺报价时以fallback $3,200/1B模拟买入；随后出现真实 price=$0.002、MCAP=$200,000,000（100B供应量）；用户把价格图缩放至3.2e-8附近。

**实际生产代码复现：** Engine产出的trade明确 `quoteSource=TANGO_FALLBACK`、`syntheticTokenPrice=true`、`priceProvenance=SYNTHETIC_PRICE`、`marketCapUsd=3200`。Marker仍产生 `{marketCap:3200,price:3.2e-8}`；在Canvas测试夹具中执行生产chart-main，经三锚点300px位置绘出1条线，诊断 `RENDERED`。这些坐标无真实历史来源。

**附带复现：** 无真实ratio时，候选数组 `[fallback BUY, factual BUY]`（后者MCAP8000、price8e-6）只输出fallback3200价0，数组后方事实入场被掩盖。按生产新记录在前顺序，较新的fallback可掩盖较老事实；复现不证明旧fallback必然遮挡后来新成交。候选数组中两笔fallback SELL排在5笔真实SELL前时，结果只留下两个fallback和头两笔真实SELL，其余真实SELL被挤出4条上限。

**期望：** 维度独立判定市值和价格来源。纯initial synthetic市值不应因后续ratio获得历史真实性，不进入marker/名额。可信卡片实际观察市值+暂定供应量可保留市值坐标，但价格不应随之被冒充。对legacy无来源记录保留明确兼容规则。相关未合并分支已有修正可供后续审阅，不能以此视为main已修复。

### GMGN-02 — P2：总开关 OFF 竞态窗仍可确认 SELL/全部平仓

**证据路径/行号：**

- `D:\web3\code_project\tango-paper-trade\src\content\content.js:32-38` 收到settings.storage事件立即标记pending与disabled。
- 同文件`:73-77` `paperExecutionDisabled`封装该事实；`:1757` commitBuy使用它。
- 同文件`:1777-1780,1823-1825,1863-1865` SELL入口、commitSell与commitCloseAll只检查route/tradePending，不检查OFF状态。
- 同文件`:2555-2563` 已渲染的确认按钮，可信click直接调用runtime.modal.action。
- `src\core\state-coordinator.js:603-607` EXECUTE_SELL把当前settings交给Engine，未拒绝enabled=false。

**触发：** 已经显示SELL或全部平仓confirm，在Popup/快捷键/其它页面关闭总开关；当前tab收到storage通知但完整settings刷新/下一次render尚未移除旧UI；此窗口点击旧确认。

**实际复现：** 使用实际content bindEvents的 `confirm-modal`可信click（测试fake event设置`isTrusted=true`），OFF notification后runtime pending=true、disabled=true仍分别调用一次Store.executeSell/executeCloseAll。再在全新隔离Tango上下文加载实际State/Engine/StateCoordinator，storage settings.enabled=false，执行SELL成功：数量2000→1000、生成SELL、持久化1次。

**期望：** 所有模拟交易入口/commit都统一检查OFF/pending，包括sell、breakeven、closeAll；协调器原子事务读到enabled=false可再次拒绝，覆盖消息在途的竞态。

**范围声明：** 这是storage通知至刷新/清UI前的**竞态窗**，不是OFF后永久存在的可点击按钮；未证明synthetic点击绕过可信gate。复现账户在内存中，没有真实交易或用户持久化。

### GMGN-03 — P2：Locked Giant 上游仍可高于36px，paint/hit只占中间条带

**证据路径/行号：**

- `D:\web3\code_project\tango-paper-trade\src\content\content.css:19-46` slot/action/structural只有`min-height:36px`，无`height/max-height:36px`及padding/margin/border/transform全面中和。
- 同文件`:53,62-66` leaf居中、flex auto、固定36px。
- `tests\gmgn-adapter.test.js:630-640` gate只要求slot/host/overflow≥36，不校验五层同rect。
- 对应批准需求：`docs\superpowers\specs\2026-08-12-gmgn-locked-giant-full-fill-design.md`。

**实际headless Chrome复现：** 直接调用当前仓库`headlessLockedGiantQuickBuyLayoutReport`。原生请求高度48px的direct/nested/real-wrapper三种拓扑均slot48、host48、overflow48（存在时），paper36、paint36、居中偏移0。空白上下共12px只占父slot，不是完整Tango surface。现测试对这种错误仍通过。

**期望：** 完整已验证slot链统一36px及宽100%，边/上/下rect在0.5px内一致、paint与click同rect。强化现gate至24/28/32/36/48/113及hostile box-model。这是最新plan待主分支完成；旧08-11允许tall host居中的行为已被取代。

### GMGN-04 — P2：Quick-buy 维护修改自触发 MutationObserver，页面静止仍160ms反复扫描

**证据路径/行号：**

- `D:\web3\code_project\tango-paper-trade\src\adapters\gmgn.js:1536-1539,1555-1558` 每次presentation先清host structural class再加；同文件`:2157,2176` 相同binding维护也无条件add slot class及重跑presentation。
- `D:\web3\code_project\tango-paper-trade\src\content\content.js:574-601` host/slot属性变化解析回card/TokenItem root；`:2673-2681` 把class/style事件入pending；`:2724-2729`160ms后再次discover；`:2738-2741`监听全body子树class/style。

**机制：** 原生Chrome相同classList.add也会发attribute MutationRecord；remove/add structural class更是实际变化。Paper leaf被过滤，但祖先slot和host不是paper leaf，因此闭环一直成立。

**实际headless复现：** 临时页面加载当前实际adapter，使用当前content.js提取的`quickBuyMutationRoots`和同样160ms维护循环。只初始化一次，之后无鼠标/GMGN外部DOM更新；1秒收集7次observer batch、6次维护discover、28条relevant class记录。例子包括slot oldValue与最终className完全相等、host由移除/恢复structural标记产生记录。脚本1秒主动断开observer结束，不是runtime自行稳定。

**期望：** 属性写入幂等（不存在再add）、structural host集合diff而非每次清加，必要时observer识别本扩展预期的同值变更。保持外部DOM更新/新增native leaf即时防护，不能简单停observer。

**影响边界：** 确定持续重复扫描和样式属性写入，卡片/持仓/交易越多成本越高；没有证明重复成交，也没有提供生产GMGN CPU百分比。许多mock classList是Set且不发送真实MutationRecord，现模型测试不能证伪该问题。

### GMGN-05 — P3：同窗 malformed quote 消息会抛未处理 TypeError

**证据路径/行号：** `D:\web3\code_project\tango-paper-trade\src\content\content.js:314-318` 把prices当iterable且读price.symbol；同文件`:331`把quotes当有forEach的数组。

**实际复现：** `{type:TOKEN_QUOTES,quotes:{}}`抛forEach不存在；`{type:NATIVE_PRICES,prices:{}}`抛不可迭代；`prices:[null]`抛symbol空访问。消息带公开source字符串、来自同一个window即可抵达此分支。

**期望：** 入口验证data对象、数组、元素对象、批次大小，逐元素跳过非法数据。chart bridge对payload已做类似形状校验，quote桥应采用同等标准。

**影响边界：** 当前一次message回调异常/console噪声和丢弃该批；**没有证据表明整个扩展永久停止或可以自动交易**。高频发消息的网页本就可占用页面CPU，因此不将其包装成独立高危DoS。

## 风险、性能与兼容性备注（不计为确定Bug）

- Guard与CSS保持enabled前默认fail-closed，global capture listener注册于document_start；顺序/浏览器世界隔离应通过真实加载扩展验证。线上GMGN页面、其它插件、Shadow DOM内部事件顺序与自制fixture不完全相同。
- 当前同窗报价白名单是来源描述而非数据认证，GMGN脚本可伪造合法shape改变临时显示/decision quote。设计允许可信用户action消费它，但实盘报价精确性和防污染强度应明确描述。
- readCurrentToken对DOM quote的时间是读取时刻，无法证明DOM最后真实更新时刻；网络桥时间是请求开始，不是服务端行情时刻。回退/历史维度已标记，但离线/卡死GMGN画面仍需用户验证。
- page-main quoteCache最多2000、runtime报价2000、trench snapshot200；quotes extract访问8000对象、单array500/对象child300。响应clone().json读取及postMessage数组长度没有完整字节/批次budget，合法大型GMGN JSON可能带来内存/序列化成本。
- 全body MutationObserver外还有route150ms、quote3s、marker1s、quickbuy health750ms、iframe render400ms。route polling为兼容SPA；在扩展开关关闭时仍保留polling/tap便于恢复。GMGN-04是确定可避免开销，其它应在实际生产页面profiler后定量。
- 24-slot budget仅限fast reconcile/health局部身份probe，维护循环仍遍历所有tracked slot和全页selector。因此不能说所有DOM访问均固定常数成本。
- `chart-main.js:4-7` frameElement/容器识别和manifest match_origin_as_fallback适用于GMGN origin/blob/about路径；未知跨域TradingView/worker renderer可能无overlay。当前 fail-closed机制避免乱画，但平台更换renderer需新适配。
- chart `priceAtMarketCap`里的历史derived价依赖当前真实ratio：供应量改变时不是固定历史USD价；应严格显示为市值坐标恢复。GMGN-01在pure fallback数据的错误情况需先修。
- 标记按现trade数组顺序取firstBuy/4SELL，状态新交易在前则通常最新4笔；切换/清markers会清隐藏状态。没有“永久隐藏”“任意交易自选标记”产品实现。
- ShadowRoot为open，页面可读临时UI及改可见文本；可信handler和闭包/WeakMap能阻止synthetic执行授权，但不承诺UI不可被网页视觉篡改。

## 建议顺序

1. 先统一OFF交易commit边界并补SELL/全部平仓竞态回归；协调器最终settings再次拒绝。
2. 修复fallback市值真实性及marker可用列表选择；核对未合并分支相关实现，单独审阅再采用。
3. 使adapter structural class更新幂等并加原生MutationObserver稳定性测试。
4. 完成最新full-fill主分支合入/实现及exact rect headless gate。
5. 补quote message形状/批次校验。
6. 用户重载实际unpacked extension后，六链trench/card复用/native reinsertion/可信键盘与鼠标激活/元数据报价来源/图表price-MCAP-worker/full-fill做线上非破坏验证；当前`docs/multichain-smoke-test.md`明确插件未加载、线上交互Blocked，不能把935自动测试通过等同上线验收完成。
