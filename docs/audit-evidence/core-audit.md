# 核心交易、状态、存储与后台审计证据

审计日期：2026-10-13（Asia/Shanghai）。范围：`src/core/*.js`、`src/background.js`、`src/shared/constants.js` 及对应单元测试。运行时代码未修改。所有复现均使用内存存储，不访问真实 Chrome 账户/存储或真实网络。

复现文件：[core-reproductions.cjs](./core-reproductions.cjs)。运行日志：[core-reproductions.log](./core-reproductions.log)。命令：

```powershell
node docs/audit-evidence/core-reproductions.cjs | Tee-Object -FilePath docs/audit-evidence/core-reproductions.log
```

该命令运行成功，退出码 0。全量既有测试由主代理运行；此子审计不重复全量测试。

## 已实现核心能力

| 能力 | 实现与边界 |
| --- | --- |
| 六链身份注册 | `src/core/chains.js:4-20` 注册 Solana、Ethereum、BNB Chain、Base、Robinhood Chain、X Layer。链账号和同地址仓位按链隔离；Solana 保留大小写，EVM 地址统一小写；Solana 校验 Base58 解码后恰为 32 字节，EVM 校验 20 字节 hex。 |
| 六链账户模型 | `src/core/state.js:367-381` 创建六个独立账户，默认每链 10 个原生币。每链持仓/成交/日已实现盈亏/校准事件；schema v1 Solana 数据可迁移到 v2。 |
| 买入 | `src/core/engine.js:740-915` 扣除平台费/网络费后换算数量；买入滑点增价；追加买入更新数量、原生币成本与加权入场价；保存真实/占位报价来源及观察时间。 |
| 卖出/清仓 | `src/core/engine.js:917-1136` 支持百分比或数量卖出；100% 百分比使用持久化精确数量；平台费/网络费；成本按卖出比例分摊；更新原生币/执行时 USD 已实现盈亏与日聚合；批量清仓逐单报告失败。 |
| 估值与统计 | `src/core/engine.js:1139-1208` 链内资产/浮盈/总盈亏、SELL 笔数口径的胜率和利润因子、跨链 USD 汇总、当前原生币价格覆盖旧标记价格、保本卖出百分比。 |
| supply 与占位校准 | `src/core/supply.js:12-67` 明确 launchpad 规则，可信 price/market-cap 同观察推导 supply；未知 supply 使用内部 1B/3200 USD 占位；`engine.js:571-708` 将更强 supply 或占位原生币价格纠正转成剩余数量的中性变换，保持现金、执行历史和成本不变。纯 token price 更新产生正常盈亏。 |
| 唯一写入协调器 | `src/background.js:12-15` 建立 service worker coordinator；`src/core/state-coordinator.js:402-407` Promise 队列串行处理不同页面的意图；旧全量 state 写入使用 stateRevision 防止覆盖新状态；失败后队列可恢复。 |
| 严格导入、原子写入 | `state-coordinator.js:526-550` 验证 product/时间、settings/state，单次写 state+settings；`state.js:167-270,531-602,704-761` 校验类型、链账号结构、经济数据有限性、地址与 key、报价/供应量 provenance。 |
| 存储容量策略 | `state-coordinator.js:8-184` 计量 JSON UTF-8 字节，8 MiB budget，按时间/事件类型/id/index确定性清理历史，保留当前 mutation与 fallback origin 依赖单元；native quota错误转为含 measuredBytes/budgetBytes 的 typed error。 |
| 远端行情与缓存 | `background.js:158-235` CoinGecko 原生币查询，SOL 可用 Wrapped SOL/DexScreener 回退；ETH/Base/Robinhood 共享 ETH native cache与并发请求；token quote按链/address去重、15秒缓存、选择最液态匹配baseToken；provider非有限价格拒绝。 |

## 已确认问题

### C-01（P1，高）历史达到 10,000 笔时，仍持有 fallback 仓位会阻断后续交易持久化

- 位置：`D:/web3/code_project/tango-paper-trade/src/core/engine.js:907`、`:1103`；`src/core/state.js:730-733`；`src/core/state-coordinator.js:80`、`:83-85`、`:177`；校验拒绝发生在 `src/core/state.js:585-587` / `:511-516`。
- 触发：开放的 `UNKNOWN_FALLBACK` 仓位，其 canonical origin 买单仍在 10,000 条历史最后；其他链/其他币的新买卖将 origin 推到第 10,001 条。
- 根因：Engine 和 normalizeState 先 `.slice(0,MAX_TRADES)`，压缩器到达时 origin 已消失。压缩器虽写了开放 fallback 历史单元保护，但无法恢复被 slice 掉的 origin。
- 复现：`history_cap_discards_open_fallback_origin`。严格有效初始状态 10,000 笔、4,402,268 字节（远低于 8 MiB）；新 BUY 后 originRetained=false；coordinator新 BUY报`invalidPosition`，全卖 fallback报`invalidTrade`，writes=0。原状态虽然未损坏，但该历史状态难以正常继续交易；只有重置或导出修改历史等途径解除。
- 预期：先按依赖关系挑选要移除的完整历史单元，再满足 10,000 条/8 MiB 限制；保留开放仓位所需 canonical origin。至少不能以普通`invalidPosition/invalidTrade`永久阻断用户。
- 测试盲点：既有 near-budget/open fallback tests测试字节压缩；full history tests测试duplicate ID保护，但未组合“仍开放 UNKNOWN_FALLBACK + origin位于数组尾部 +达到逻辑条数上限”。

### C-02（P1，高）所谓 lossless import 对超过 10,000 条的历史静默截断，且未验证被截尾部

- 位置：`D:/web3/code_project/tango-paper-trade/src/core/state.js:698`（v1 trades）、`:730-731`（v2 trades）、`:746-747`（calibrations）；`src/core/state-coordinator.js:536-545`在此截断后才测字节。
- 触发：备份总字节仍小于 8 MiB，但 trades或calibrations超过10,000条。外部生成的旧备份、迁移备份、手工整理备份均可满足。
- 复现：`lossless_import_discards_over_cap_tail`：10,001笔trade+10,001笔calibration输入7,409,269字节(<8,388,608)，IMPORT成功writes=1，但保存各10,000，丢`history-10000`、`calibration-10000`，没有错误或提示。`strict_import_skips_validation_of_over_cap_tail`：末尾非法 chain/负 quantity也完全未校验，IMPORT成功。
- 预期：lossless IMPORT 对超逻辑上限显式拒绝，完整校验输入，或确保全量保留；不能显示成功却静默丢数据。
- 文档冲突：`docs/superpowers/plans/2026-08-11-storage-byte-budget.md:19`规定“IMPORT is lossless”，当前实现仍先slice。
- 测试盲点：已有oversized IMPORT只覆盖字节超限，没有“小于字节budget但条目超限”、尾部不合法的组合。

### C-03（P2，中）允许的未来时钟偏移报价，刷新持仓时却无法持久化

- 位置：`D:/web3/code_project/tango-paper-trade/src/core/engine.js:13`允许5秒、`:474-478`报价校验；`:662-663`校准与`:1232`刷新直接写quoteObservedAt=quote.observedAt；`src/core/state.js:565-566`严格要求quoteObservedAt <= updatedAt。
- 复现：`future_quote_refresh_persistence`：coordinator now=2000，quote.observedAt/nativePriceObservedAt=2001。validateQuote `{ok:true}`；update结果quoteObservedAt=2001、updatedAt=2000；strict normalize/coordinator UPDATE均`invalidPosition`，writes=0。
- 实际影响：provider/browser容许偏移内的quote通过交易报价校验，却导致后台刷新与某些校准操作丢失；正常BUY/SELL已用safeDurableObservedAt处理未来时间，UPDATE路径遗漏。
- 预期：统一未来偏移政策：执行接受可用quote，但持久化使用安全观察时间、或拒绝该quote；所有路径一致。
- 测试盲点：BUY/SELL未来原始时间的测试很丰富，UPDATE_POSITION_QUOTE/校准未来时间未覆盖。

### C-04（P2，中）部分卖出将正成本 dust 仓位删除，账务出现未记录的亏损

- 位置：`D:/web3/code_project/tango-paper-trade/src/core/engine.js:977-995`按真实卖出量分摊cost；`:1073`remainingQuantity<=1e-12直接删除。
- 复现：`sell_drops_positive_dust_cost_without_realizing_it`全部通过真实Engine买入生成，无手工改仓位。原生币价2000、token价格1e15，买1 ETH生成quantity=2e-12/cost=1；卖quantity=1e-12得到0.5 ETH、realizedPnl=0；remaining正数量1e-12/cost0.5被删除。剩现金9.5 ETH、无仓位，总PnL=-0.5，但realized+unrealized=0，差-0.5。
- 影响/限制：这是极端数值边界，常规meme token单价远低于1e15，故触发概率低；然而严格导入和买入均允许此有效数值，账務恒等式失效是确定事实。
- 预期：正remaining数量/成本不可静默丢弃；保留dust，或明确执行一次全仓处置并将全部成本纳入已实现PnL。
- 测试盲点：已有overflow/underflow和“partial正成本不归零”测试，但没有“剩余数量被删除阈值吞掉、正剩余成本仍存在”的组合。

### C-05（P2，中）严格导入接收未来 openedAt，成功导入后仓位无法卖出

- 位置：`D:/web3/code_project/tango-paper-trade/src/core/state.js:555-556`仅校验时间是非负safe integer，无openedAt<=updatedAt/backup.exportedAt关系；`src/core/engine.js:1006`将now-openedAt以nonnegative校验。
- 复现：`strict_import_accepts_future_position_opening_time`：一个正常买入仓位的openedAt改为Number.MAX_SAFE_INTEGER，updatedAt仍1000；IMPORT成功writes=1；now=2000进行100% SELL报`invalidArithmetic`。
- 预期：strict IMPORT拒绝不可能时间关系，尤其openedAt > updatedAt，或者执行持有时长妥善降级不阻止仓位关闭。
- 实际用户边界：需损坏/手工备份或未来时间戳输入；项目宣称严格校验，这是确定缺口。

### C-06（P2，API边界）设置校验允许100%滑点/手续费，但执行拒绝

- 位置：`D:/web3/code_project/tango-paper-trade/src/core/state.js:181-182`允许bps<=10000；`src/core/engine.js:525-526`限制bps<=9999。
- 复现：`settings_accept_unexecutable_full_fee_slippage` PATCH_SETTINGS `{slippageBps:10000}`成功writes=1，随后正常BUY报`invalidSettings`。platformFeeBps同一上界差异。
- 实际用户边界：dashboard的input声明max=5000，但handler的存储校验仍允许10000；可通过备份/Store API保存该值。报告应标明API/导入边界，而非宣称正常表单必然产生。
- 预期：配置与执行共用安全上限，保存阶段先给明确错误。

## 已确认低优先级API/契约问题

### C-07（P3）INITIALIZE自定义本金未同步settings

- 位置：`src/core/state-coordinator.js:473-485`设置只写language，初始balance仅进入state；`src/core/state.js:776-784`RESET_ALL依settings本金。
- 复现：`initialize_principal_is_not_persisted_into_settings`：INITIALIZE传30，state本金30、settings本金10；RESET_ALL变回10。
- 当前产品流程使用 `RESET_ALL_WITH_BALANCE`，该新API正确同步本金；旧 `Store.initialize(balance)`保留但runtime未调用，属兼容API缺口。

### C-08（P3）EXECUTE_CLOSE_ALL保留order.quantity，可能只部分关闭却不报告失败

- 位置：`src/core/engine.js:1128`只覆盖percent:100；`:925-943`quantity存在时优先于percent。
- 复现：`close_all_quantity_override_prevents_full_close`：已有1000 tokens，closeAll order携quantity100；结果sell100，剩900，failures=0。
- 当前UI的ChainView.closeOrders不填quantity，普通UI不受影响；需调用公开Core/Store API。预期清仓函数清除数量覆盖或强制取最新全仓数量。

### C-09（P3）只读USD汇总接受Infinity并声明complete

- 位置：`src/core/engine.js:1188-1189`、`:1202-1203`仅检查price>0，未Number.isFinite；`markPosition:1140-1148`缺安全聚合。
- 复现：`nonfinite_readonly_summary_is_accepted`：所有chain native=Infinity，globalSummary.complete=true、assets=Infinity、pnl=NaN。
- 后台行情入口已拒绝Infinity，常规provider路径受保护；主要是公开纯函数与损坏状态防御不足，可与标记计算overflow测试补充。

## 风险/局限（未当作确定生产bug）

- 行情请求缺少明确fetch timeout/AbortController：`background.js:169-190,214-235`。永久pending provider会让同key请求复用同一pending Promise；worker终止可恢复。未用真实网络制造永久pending，属可靠性风险。
- 仅SOL提供wrappedNativeAddress及DEX原生币回退，ETH/BNB/OKB CoinGecko失败时不能同等回退。Robinhood无verified DexScreener映射，token远端quote入口返回null(`background.js:199`)；核心六链能力不等于六链外部数据可用性。
- global native USD summary 以当前native价格重估本金，故持有现金原生币本身的涨跌不进入paper pnl；这是设计/测试定义(`engine.test.js:2434`)，非bug。
- 胜率/利润因子按每笔SELL统计，而不是完整持仓round trip(`engine.js:1172-1182`)；多次部分卖出会增加closedTrades。报告应说明口径，避免把它当完成清仓次数。
- `SAVE_SETTINGS`和`REPLACE_STATE`仍是兼容API；前者non-strict归一化、全量覆盖设置并不适合多个页面并发提交，当前runtime已经改用PATCH_SETTINGS。后者revision防丢更新，但输入先non-strict归一化，语义更接近兼容修复API。
- localStorage fallback的多key写入逐项setItem(`storage.js:17`)，并非Chrome storage.local单次set的原子行为；项目真实扩展运行使用Chrome coordinator。未制造浏览器localStorage配额中途失败。
- strict导入多处检查结构/值/来源关系，但不做完整现金+成本+累计PnL账本重算，也不验证日聚合与交易合计；由于10k历史裁剪，本就无法仅从retained history重算全部账户。应建立明确“日/账户聚合是全历史真值、trade统计是保留窗口”的契约。

## 核心测试覆盖与建议

既有Core测试已覆盖六链买/25%/50%/100%交易矩阵、真实/占位quote时效、quote身份绑定、观察来源、supply规则、经济overflow/underflow、旧schema迁移、strict导入类型/别名/来源、防伪fallback、跨页面并发/失败队列恢复、配额原子性与重复id保护。核心测试规模明显强于普通原型。

本次发现主要是多个已测试模块的交叉边界，建议按 C-01→C-02→C-03→C-05/C-04 的顺序补回归；settings/API边界随后。所有回归需通过真实StateCoordinator持久化链路，不能只断言Engine返回形状。C-04还应断言 `totalPnlNative == realizedPnlNative + unrealizedPnlNative` 在数值容差内成立。
