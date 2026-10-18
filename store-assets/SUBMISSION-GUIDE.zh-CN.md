# Tango Paper Trader 谷歌商店后台填写教程

适用安装包：0.3.57。资料日期：2026-10-18。以下是准备好的填写内容，不表示已获 Google 审核批准。后台字段可能随账号、地区和界面版本变化；身份、地址、邮箱及经营身份必须填写发布者自己的真实信息。

## 1 注册与账号设置

入口：https://chrome.google.com/webstore/devconsole

登录长期使用的 Google 账号，按页面支付一次性注册费、阅读并接受协议，开启 Google 两步验证。

| 字段 | 填写方式 |
| --- | --- |
| Publisher name 发布者名称 | 你的真实公开发布者名称；可以使用 Tango 项目的品牌名称，但不要冒充 GMGN 或 Google |
| Contact email 联系邮箱 | 你长期接收审核和支持邮件的真实邮箱，完成邮件验证；GitHub Issues 不能代替账号必填邮箱 |
| Trader / Non-Trader | 按你的实际经营身份选择，免费不自动等于 Non-Trader |
| 法定姓名、地址、电话、身份材料 | 仅在 Google 正式后台按实际要求填写，不粘贴项目资料中的占位信息 |
| 网站所有权验证 | 有自己的网站再验证；没有时不要声称已验证 GMGN 或 github.com 的所有权 |

## 2 上传软件包

点击 Add new item，上传同目录 tango-paper-trader-0.3.57.zip。打开 Package，确认名称 Tango Paper Trader、版本0.3.57、Manifest V3。

ZIP 根目录直接是 manifest.json、src、assets 等安装文件。不要上传整个 GitHub 仓库 ZIP，不要把 store-assets、用户 JSON 备份和测试日志一起上传。

## 3 商品详情 Store listing

| 字段 | 具体填写 |
| --- | --- |
| Name | 简体中文：Tango Paper Trader — Meme模拟交易练习；英文：Tango Paper Trader；从本地化 manifest 读取 |
| Summary / Short description | 简体中文：在 GMGN 练习六链 Meme 模拟交易，查看仓位、盈亏、买卖复盘与日报。无需连接钱包。英文见 LISTING.en.md；从本地化 manifest 读取 |
| Detailed description | 默认简体中文页复制 LISTING.zh-CN.md 的详细说明正文；英文语言页复制 LISTING.en.md 的 Detailed description 正文；不复制标题、版本或编辑备注 |
| Category | 从实际选项选择最符合交易练习和分析工具的类别；若有 Tools 可优先考虑，不要随意归为真实金融交易服务 |
| Language | 默认语言选择简体中文（zh_CN），保留 English（en）语言页，各填对应语言文案 |
| Homepage / Website | https://tango-paper-lab.quirkylily.chatgpt.site/ |
| Support URL | https://github.com/nopapername/tango-paper-trader/issues |
| Official URL / Verified publisher | 没有验证自己域名时留空；不要把 GitHub 仓库链接冒充已验证域名 |
| Promotional video | 没有视频时留空，不填写无关视频 |

安装包包含 _locales/zh_CN 和 _locales/en，并设置 default_locale 为 zh_CN。上传新版后核对后台简体中文默认语言与英文语言页；名称和简短说明由 manifest 本地化消息提供，长描述分别粘贴。浏览器显示名称会跟随其语言选择。插件内语言偏好仍由原有设置控制，不会重置。

## 4 图像上传

| 字段 | 选择文件 |
| --- | --- |
| Store icon 128×128 | 安装目录 assets/icons/icon-128.png |
| Small promotional tile 440×280 | store-assets/promo-440x280.png |
| Screenshot 1 | screenshot-05-trenches-sol.jpg |
| Screenshot 2 | screenshot-04-trenches-bsc.jpg |
| Screenshot 3 | screenshot-01-trading.jpg |
| Screenshot 4 | screenshot-02-replay.jpg |
| Screenshot 5 | screenshot-03-chart-refresh.jpg |
| Marquee 1400×560 | 未制作，非必需项可留空 |

五张截图均为1280×800 JPEG，来自实际0.3.38页面；0.3.57保留这些功能，但精修了字号、间距和颜色。上传后检查裁切、排序和清晰度。推广图和截图都不上传到 Package 页。

## 5 隐私规范 Privacy practices

### 单一用途 Single purpose

可直接复制英文：

Provide local Meme-token paper-trading practice and review on supported GMGN pages, including simulated positions, profit/loss and recorded trade replay. The extension does not connect wallets, sign transactions or broadcast real trades.

### 权限用途 Permissions justification

storage：

Store paper accounts, preferences, retained simulated fills, daily PnL aggregates and bounded replay data in the current browser. Session storage records the user's temporary confirmation preference. No Tango account synchronization server is used.

https://gmgn.ai/*：

Read public chain/token market observations from the active GMGN page, bind the current token, display labeled paper-trading controls and valuation badges, and render compatible chart markers. The site-context observer extracts relevant market and chart-axis fields; it does not provide arbitrary extension API access to the website.

https://api.coingecko.com/*：

Request public native-asset/USD reference prices used to value simulated accounts and display USD summaries. Paper-account balances, fills and preferences are not included in these requests.

https://api.dexscreener.com/*：

Request fallback public token quotes on supported chains when an eligible GMGN observation is unavailable. Requests identify the public chain and token contract, not a user's wallet or paper account.

不额外申请 tabs、history、debugger、userScripts 或全部网站权限。若后台出现与实际 manifest 不符的权限，先确认上传包，不要随意编造用途。

### 远程代码 Remote code

当前有网站图表 iframe 恢复逻辑，建议明确选择有相关远程执行情形并提交下面的技术解释，交由审核判断隔离上下文例外；不要只因扩展自身脚本本地打包就不披露图表恢复。

All extension application logic is packaged locally. For a persistently empty identified GMGN native chart iframe, the website MAIN-world helper reuses the site's original chart HTML after checking the same-origin GMGN TradingView base and script paths. It does not execute that document in extension-origin popup or dashboard pages and does not give the site's code access to extension APIs. This behavior is disclosed for assessment under the MV3 exception for contexts isolated from extension APIs; no approval of that exception is presumed. Quote endpoints return data. GMGN Handgun/Kaching audio is media, not remotely loaded application JavaScript. See src/content/page-main.js and the privacy policy.

### 数据类型 Data usage

本地处理也必须披露。下面是根据0.3.57行为的填写建议，按后台具体定义核对：

| 数据类别 | 当前填写建议及范围 |
| --- | --- |
| Website content 网站内容 | 勾选：读取GMGN公开代币、价格、市值、供应量、图表和相关响应字段 |
| Web history 浏览活动 | 按涉及页面URL的定义披露：仅当前GMGN链/代币路由，用于绑定交易对象；无全浏览器历史采集 |
| User activity 用户活动 | 勾选：插件内用户主动模拟下单、设置、成交复盘记录和主动填写的代币笔记；非全站点击或键盘追踪 |
| Financial/payment information | 不处理真实银行卡、支付凭证、钱包密钥或真实资产账户；模拟本金、仓位和成交需在说明中明确。若后台类别定义同时包含模拟财务记录，则按该定义勾选并注明模拟范围 |
| Personally identifiable information | 不收集姓名、邮箱、电话等用户身份信息 |
| Authentication information | 不读取密码、私钥、助记词或认证Cookie |
| Personal communications | 不采集私信或邮件；不把旁边社媒面板显示的内容作为插件采集数据 |
| Health information | 不采集 |
| Location | 不主动定位或进行IP地理位置推断；行情/音频提供方能收到连接IP等普通网络信息，隐私政策已说明 |

可复制补充说明：

GMGN page observations and the current token route are used only for the visible paper-trading features. Simulated account settings, orders, positions and fills are processed/stored in the current browser, not uploaded to a Tango server. Public quote/audio requests expose ordinary connection metadata to the providers but do not include paper-account balances or history. No browser-wide browsing history, authentication credentials, real payment details or wallet secrets are collected.

Limited Use 三项声明：仅在核对与实际行为一致后勾选“不出售数据”“不用于无关用途”“不用于信用评估或放贷”。不要将处理数据一栏全部选无。

### 隐私政策 URL

https://github.com/nopapername/tango-paper-trader/blob/main/PRIVACY.md

0.3.57隐私政策与本轮上架资料随此版本一并发布。提交前请在未登录GitHub的窗口验证该链接公开可访问。

## 6 测试说明 Test instructions

可直接复制：

1. Install the submitted extension in standard desktop Chrome. No Tango login, wallet or real funds are required.
2. Complete initial simulated-capital setup. Click Open GMGN to save setup and open GMGN.
3. Open https://gmgn.ai/?chain=sol or https://gmgn.ai/?chain=bsc and locate controls labeled Tango/Paper. Do not use GMGN real-trading controls.
4. Paper-buy a small amount, wait for settlement, then sell 25% and the remainder. Check the ledger, account balance and PnL. Simulated fees/slippage can create an immediate loss.
5. Open token trade replay, inspect points and fill details. Dashed fill-to-fill lines are not historical market candles. Compatible native charts show paper-entry/exit lines.
6. Open the extension dashboard in standard Chrome. Check Overview, Positions, History, Calendar and CSV/JSON/PNG export. Do not reset or overwrite another user's data.
7. Verify sound toggle, master switch, GMGN navigation and privacy link. No credentials are supplied or required by Tango. GMGN website availability is controlled by that service.
8. Embedded Codex/Owl can block extension-created internal pages; use standard Chrome for the dashboard test.

## 7 分发 Distribution

价格选 Free。可见性：准备公开上架选 Public；只让持链接者访问可选 Unlisted；限定测试人员可选 Private，并配置实际测试账号。按目标地区及后台验证要求选择分发地区。不要假设免费就免除身份验证。

若出现广告、推广或商业模式的问题，按实际功能如实回答；不要为了通过审核填写与代码行为不符的答案。发布者本人完成协议、付款和身份验证。

## 8 最后检查与提交

确认版本0.3.57、安装ZIP含43文件、图标及5张截图、长描述、支持入口、公开隐私政策、权限理由、数据声明与测试说明都已填写。0.3.57完整回归1,378项通过；本轮在线检查BSC、SOL及组合页、复盘和历史显示，没有新增成交。弹窗/内部数据面板与实际扬声器音效未在本轮重新在线验收。本轮未新增交易，提交前再核对后台预览。

建议选择审核通过后手动发布，避免未经最终检查自动上线。保存所有资料；具体字段和提示以你账号的实际后台为准。本文不代替实际审核结果。

## 官方操作文档

- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements

## 既有界面调整

GMGN入口统一为“打开 GMGN / Open GMGN”，无邀请入口及仅保存设置按钮已移除。首次点击会保存设置并打开原有GMGN地址。盈亏日历保留“当前链交易记录”，底部改为新人扫链教程；扩展弹窗也有教程入口，详情交易面板不显示教程。教程链接：https://t.co/H2RSVQV4sX 。

## 已保留的本地化

简体中文为默认扩展元数据，同时保留英文；插件内语言偏好不变。英文隐私政策使用当前按钮名称“Open GMGN”。



## 0.3.57 本次变更与审核补充

代币复盘：在详情交易面板的买入余额上方点击带笔记图标的“代币复盘”，用一个输入框记录买前想法、认错提醒或交易总结。每条链、每个合约、浏览器本地日期各保存一份；未交易和已清仓代币也可记录。盈亏日历中的“每日复盘”按日期及链回看和编辑。笔记只在当前浏览器本地保存，不自动上传；每份最多4,000字符，独立空间1 MiB。JSON备份包含笔记；导入不含笔记的旧备份会保留现有笔记。

详情页内嵌战壕同样支持模拟快买。战壕模拟买入后可跟随已读取的GMGN“买后代币详情”设置：新标签打开、当前页跳转或不打开；单链及组合页首次使用时请打开一次GMGN自定义弹窗同步该选择，未读取时保留不打开行为。

隐私政策已说明本地代币笔记及JSON备份。补测单输入框保存/编辑、未保存提示、每日列表日期/链筛选；不要用审核测试覆盖用户笔记或导入账户。权限、邀请码及原有交易流程未为此发布而修改。
