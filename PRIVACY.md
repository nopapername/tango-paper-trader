# Tango Paper Trader — 隐私政策 / Privacy Policy

更新日期 / Last updated: 2026-10-16

适用产品 / Product: Tango Paper Trader Chrome extension, version 0.3.44 and later unless replaced by a newer policy.

维护者与联系 / Maintainer and contact: Tango Paper Trader project maintainers. https://github.com/nopapername/tango-paper-trader/issues

[中文](#中文) · [English](#english)

## 中文

### 1. 用途与读取的数据

Tango 是独立于 GMGN 的免费模拟交易练习工具，不连接钱包、不请求助记词或私钥、不签名或广播真实交易。

在 gmgn.ai 页面中，插件读取公开代币名称、链、合约地址、价格、市值、供应量、图表刻度及与行情有关的页面响应。读取相关页面地址是为了绑定当前链和代币，不采集全浏览器历史。插件的页面脚本会被动检查相关 fetch/XHR 行情响应，并只向插件传递提取的行情字段，不上传整份响应或网站账户资料。

用户输入的模拟本金、预设、费用、语言等设置，以及模拟余额、仓位、成交、盈亏日统计、校准记录保存在当前浏览器的 chrome.storage.local。会话免确认状态使用 chrome.storage.session。复盘使用单独的、有容量限制的本地行情缓存。没有 Tango 云账户或账户同步服务器，不使用广告追踪或统计 SDK。

### 2. 对外请求与第三方

- GMGN（gmgn.ai）：原网页继续请求自己的行情和图表资源。Tango 被动复用数据；仅在原生图表的已识别空白 iframe 中，可能重新载入 GMGN 原有图表文档，不获取新的图表代码来源。GMGN 的网站行为适用其自身政策。
- CoinGecko（api.coingecko.com）：查询原生币/USD 参考价格，请求包含公开币种标识。
- DEX Screener（api.dexscreener.com）：在受支持的链缺少可用行情时查询备用报价，请求包含公开链标识和代币合约地址。
- 网络服务提供方通常能看到请求 IP、时间及必要的网络元数据；Tango 不控制第三方日志保留。插件不会在这些行情请求中附带模拟余额、仓位、成交历史、设置、钱包凭据或个人联系方式。
- 买入/卖出音效从 GMGN 请求 Handgun.mp3 / Kaching.mp3；服务方可见请求 IP、时间及必要的连接信息，不发送模拟账户数据。音频加载失败时使用本地合成提示音。

第三方政策可查看 https://www.coingecko.com/en/privacy 、https://dexscreener.com/privacy-policy ，以及 GMGN 网站提供的政策。使用外部网站适用该网站的条款。教程入口由用户点击后打开外部文章链接（t.co 跳转至文章网站），不附带模拟账户数据；外部网站适用其自身政策。

### 3. 可选推广链接

“打开 GMGN”按钮使用邀请码 X9cuc5jd。点击后浏览器访问 https://gmgn.ai/r/X9cuc5jd?chain=bsc ，GMGN 可按其规则建立推荐关系。

本插件不承诺用户手续费折扣。推广关系不改变模拟交易费用、不产生模拟返现，也不是使用免费模拟功能的条件。插件不在后台给用户正在浏览的页面追加或替换推荐码，不读取推广结算数据。

### 4. 本地存储、导出与删除

数据保留在当前浏览器配置文件中，直到用户重置、导入覆盖、清除扩展存储或卸载。历史明细和行情缓存存在容量上限，旧明细可能被裁剪；部分日统计会持续保留。JSON 备份包含全部六链模拟账户及设置，不包括复盘行情缓存。

CSV、JSON 和 PNG 仅在用户操作时保存到下载位置或复制到剪贴板，不会自动上传或发布。下载文件和剪贴板副本不受插件卸载影响，请自行保管或删除。不要在公开 Issues 中上传私人备份、钱包信息或浏览器配置文件。

数据面板的重置会清除相应模拟交易数据；清除全部设置和缓存可通过浏览器扩展存储管理或卸载实现。不同浏览器、配置文件或扩展身份的数据相互独立。

### 5. Limited Use 与数据承诺

Tango 对用户数据的使用遵循 Chrome Web Store User Data Policy，包括 Limited Use 要求。数据仅用于已披露的模拟交易、行情估值、复盘和用户请求的导出功能。不出售用户数据，不用于个性化广告、信用评估或放贷，不向数据经纪商传输。维护者不能从服务器查看本地账户数据；仅当用户主动提供诊断资料时，才可能接收用户选择分享的内容。

### 6. 政策变更与联系

数据处理方式发生实质变化时，我们会更新本政策，并在需要时提供产品内说明或取得同意。问题请通过 GitHub Issues 联系维护者；公开反馈只提供必要信息。

## English

### 1. Purpose and information accessed

Tango is a free paper-trading practice tool independent of GMGN. It does not connect wallets, request seed phrases/private keys, sign transactions or broadcast real trades.

On gmgn.ai, it reads public token names, chains, contract addresses, prices, market caps, supply, chart coordinates and relevant market-data responses. The current page URL identifies the chain/token; Tango does not collect browser-wide history. Page scripts passively inspect relevant fetch/XHR market responses and relay extracted market fields locally, not full response bodies or site-account details to a server.

Paper principal, presets, fees, language/settings, balances, positions, fills, daily PnL and calibration records use chrome.storage.local in the current browser profile. Session-level confirmation suppression uses chrome.storage.session. A separate bounded local market cache supports replay. There is no Tango cloud account/sync server, advertising tracker or analytics SDK.

### 2. External requests and providers

- GMGN (gmgn.ai): the original site continues loading its own market/chart resources. Tango reuses observations and may reload GMGN's existing chart document only inside an identified, persistently empty native chart iframe; it does not obtain a new source of chart code. GMGN operates its site under its own policies.
- CoinGecko (api.coingecko.com): native-asset/USD reference requests include public coin identifiers.
- DEX Screener (api.dexscreener.com): fallback quotes on supported chains include public chain identifiers and token contract addresses.
- Network providers normally receive the request IP, time and necessary connection metadata. Tango does not control third-party log retention. Market requests do not include paper balances, positions, fills, settings, wallet credentials or personal contact details.
- Buy/sell cues request Handgun.mp3 / Kaching.mp3 from GMGN. The provider receives the request IP, time and necessary connection information, without paper-account data. A locally synthesized cue is used if audio playback fails.

Provider policies: https://www.coingecko.com/en/privacy and https://dexscreener.com/privacy-policy ; consult GMGN's site for its policies. External websites have their own terms. The tutorial opens an external article link via t.co only when clicked and does not attach paper-account data. External websites have their own policies.

### 3. Optional referral links

The “Open GMGN” buttons use code X9cuc5jd. Clicking opens https://gmgn.ai/r/X9cuc5jd?chain=bsc . GMGN may bind the referral under its rules.

No user fee discount is promised. Referral attribution does not change paper-trading fees, generate paper cashback or condition access to free simulation. Tango does not append/replace referral codes on pages in the background or read referral-settlement data.

### 4. Retention, exports and deletion

Data stays in the current browser profile until reset, import replacement, extension-storage clearing or uninstall. Trade details and market cache have retention/capacity limits; old details may be pruned while some daily aggregates persist. JSON covers six-chain paper accounts/settings, not replay market cache.

CSV, JSON and PNG files are downloaded or copied to the clipboard only on user action; Tango does not automatically upload/publish them. Exported files and clipboard copies survive uninstall and are the user's responsibility to protect/delete. Do not post private backups, wallet information or browser profiles in public Issues.

Dashboard resets clear the relevant paper-account data. Use browser extension-storage controls or uninstall to remove remaining settings/cache. Browsers, profiles and extension identities have independent storage.

### 5. Limited Use

Tango's use of user data adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only for disclosed simulation, market valuation, replay and user-requested exports. It is not sold, used for personalized advertising, creditworthiness or lending, or transferred to data brokers. Maintainers cannot inspect local accounts through a server; they may receive only diagnostic information a user chooses to provide.

### 6. Changes and contact

Material changes will be reflected in this policy, with in-product disclosure/consent when required. Contact project maintainers through GitHub Issues, sharing only necessary information: https://github.com/nopapername/tango-paper-trader/issues