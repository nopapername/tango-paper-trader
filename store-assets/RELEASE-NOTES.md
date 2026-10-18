# Tango Paper Trader 0.3.57

[官网 / Website](https://tango-paper-lab.quirkylily.chatgpt.site/) · [详细教程 / Guide](https://tango-paper-lab.quirkylily.chatgpt.site/tutorial/) · [Chrome 商店 / Store](https://chromewebstore.google.com/detail/geajcgajdpbiaenjjneccjddbbmipdae)

## 中文

- 新增本地“代币复盘”：单输入框、明确保存、未保存保护与多标签冲突提示；按链、合约、本地日期隔离，每个代币每天一份。
- 盈亏日历新增“每日复盘”，按日期和链回看、编辑；笔记随JSON备份导出，不含笔记的旧备份导入会保留已有笔记。
- 复盘入口采用绿色紧凑图标按钮，位于买入余额上方，支持明暗主题、折叠面板和窄屏。
- 合并0.3.51–0.3.54的详情内嵌战壕快买、买后详情导航同步，以及卖出失败主动刷新报价、官网链接误判修复；不自动重试卖出。
- 笔记仅本地保存，不自动上传；每份最多4,000字符、独立总空间1 MiB。权限与邀请码保持现有行为。

下载 **tango-paper-trader-0.3.57.zip**，解压并加载直接包含manifest.json的目录。已有用户请原目录替换文件、仅重新加载扩展并刷新GMGN，不要卸载重装；建议先导出JSON备份。官网ZIP入口指向最新Release。

1,378项完整回归与Manifest校验通过。45个运行文件与本地安装目录、主分支及ZIP逐项核对。本轮在线检查BSC/SOL及组合战壕、持仓与历史买卖点、日报和复盘交互，未新增交易；内部数据面板与实际音效未在本轮重测。旧截图仍标注真实拍摄版本0.3.38。资料包含中英文上架文案、填写教程、隐私政策与现有截图；此次不自动提交Chrome商店。

## English

- Add a local one-field Token review journal with explicit Save, unsaved-draft protection and conflict detection. Notes are isolated by chain, contract and local date.
- Add date/chain-filtered Daily review in the PnL calendar. JSON backups include notes; older backups without notes preserve existing notes on import.
- Place the compact green note-icon entry above the buy balance, with light/dark, narrow-layout and collapsed-panel support.
- Include embedded-trench paper buys, observed after-buy navigation, active quote refresh after failed sells and token-website identity fixes from 0.3.51–0.3.54. Failed sells are not automatically retried.
- Notes remain local, with no automatic upload: 4,000 characters each within a separate 1 MiB budget. Existing permissions and invitation behavior are retained.

Download **tango-paper-trader-0.3.57.zip**, not GitHub's generated source archive. Extract and load the directory containing manifest.json. Existing users should replace files in place, reload Tango and refresh GMGN; do not uninstall. Back up data first.

Validation: 1,378 full tests plus manifest checks passed; 45 runtime files match the local installation, main branch and ZIP. This round covered BSC/SOL/combined UI, held-token replay, daily reports and journal interactions without new fills. Internal dashboard and speaker-level audio were not retested in this round. Existing screenshots remain labeled as actual 0.3.38 captures. Store materials include bilingual copy, submission instructions, privacy policies and existing screenshots; no Chrome Web Store submission is performed.

## Downloads / 下载

- Plugin / 插件: `tango-paper-trader-0.3.57.zip`
- [中英文文案、隐私政策和截图 / Store materials](https://github.com/nopapername/tango-paper-trader/tree/main/store-assets)：普通文件保留，不再提供第二个ZIP。
- Checksums / 校验: `tango-paper-trader-0.3.57.zip.sha256` and `PACKAGE-SHA256.json`.

**谷歌商店：直接上传 `tango-paper-trader-0.3.57.zip`，无需解压。本地“加载已解压扩展”才需要解压。**

**Chrome Web Store: upload `tango-paper-trader-0.3.57.zip` directly. Extract only when loading the extension unpacked locally.**

Plugin SHA-256: `d42f55d0ceeea95d96eaffe81b6a901248cef03edc3196e6d7a46d0579b3f63f`
