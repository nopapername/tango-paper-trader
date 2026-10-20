# 换电脑继续开发 / Developer setup

此仓库现在包含完整源码、自动化测试、必要基准夹具、构建和静态验证脚本，不依赖原电脑的临时目录。插件运行基线仍为 **0.3.57**；加入开发资料不改变已发布插件 ZIP。

## 1. 新电脑准备

- Git、Node.js 22 或更新版本、Google Chrome 或 Chromium。
- Codex 使用你自己的账号和工作区，并在新电脑打开本仓库目录。
- 如需推送，单独在新电脑配置 GitHub 登录或新的 SSH 密钥。无需复制旧电脑的凭据、浏览器资料或整个 Codex 配置目录。
- 项目没有外部 npm 依赖，无需 `npm install`，也无需从旧电脑复制 `node_modules`。

## 2. 克隆与自检

```powershell
git clone https://github.com/nopapername/tango-paper-trader.git
cd tango-paper-trader
node --version
npm.cmd test
npm.cmd run check
npm.cmd run build
```

macOS/Linux 可使用 `npm` 替代 `npm.cmd`。当前移交是在 Windows + Node.js 22 + Chrome 上验证；其他系统的 Chrome 路径已提供候选，但未在这些系统实际运行本轮测试。

测试包含隔离的无头浏览器 DOM/CSS 回归，不会操作日常 Chrome 标签、连接钱包或执行真实交易。必须安装 Chrome/Chromium；找不到时用环境变量指定**浏览器可执行文件**：

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm.cmd test
```

```bash
export CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
npm test
```

基线预期：1,378 项测试、0 失败；静态检查通过；构建产生 `dist/tango-paper-trader/`。测试数量会随未来开发增加，不应删除测试来维持此数字。`npm run build` 会替换该固定构建输出目录，请勿把账户备份或个人文件放进去。

## 3. 在 Chrome 验证

打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，加载新电脑的 `dist/tango-paper-trader/`。修改源码并构建后，仅重新加载扩展，再刷新 GMGN 页面。

新电脑浏览器的模拟账户独立于旧电脑，Git 不包含余额、持仓、历史或复盘笔记。需要延续数据时，先在旧电脑对应浏览器导出 Tango JSON，再在新电脑明确选择需要恢复的备份导入。外部 Chrome 和 Codex 内置浏览器也使用独立数据；不要混用备份，不要卸载旧插件来“同步”。

Codex 浏览器控制工具与 Tango 是两个不同部分：若需要在线验收，在新电脑配置可用的浏览器控制连接并打开 GMGN。内置 Owl 浏览器可能阻止扩展内部数据面板，新版功能是否可访问需实际核验；不要因此改坏标准 Chrome 的行为。

## 4. 文件布局

| 路径 | 用途 |
| --- | --- |
| `src/`、HTML、`assets/`、`_locales/` | 扩展运行源码、图标和语言 |
| `tests/*.test.js` | 完整 Node 测试及隔离的 Chrome 回归 |
| `tests/fixtures/` | 必要市场页面片段和历史性能基准；没有账户导出 |
| `scripts/validate-extension.js` | 版本、依赖顺序、权限和安全契约检查 |
| `scripts/build.js` | 按明确清单构建可安装目录 |
| `dist/tango-paper-trader/` | 构建输出，不提交 Git |
| `store-assets/` | 唯一商店插件 ZIP、校验清单、中英文文案和截图 |
| `docs/development/HANDOFF.md` | 当前开发状态、约束和接续提示 |
| `.github/workflows/release.yml` | 版本标签触发的已校验 Release 发布 |

`npm run benchmark` 可运行本地通用性能对比；其他 `scripts/benchmark-*.js` 为开发工具。图表重绘对比脚本需要显式提供历史 `chart-main.js` 路径，不是完整测试或构建的依赖。旧电脑一次性审计脚本、浏览器缓存、视频素材、账户备份和临时日志不属于克隆所需内容。

## 5. 开发与发布约定

先读 `AGENTS.md`，按用户要求修改源码，运行完整测试、静态检查、构建和相应在线验证。只有工具和文档变化时不必增加插件版本；运行功能变化时同步三个版本字段及版本契约测试，通知用户仅重新加载插件。

构建只生成已解压目录，不会自动覆盖 `store-assets` 中已验收的 ZIP。准备新版本时，ZIP 根目录必须直接包含 `manifest.json`，并按构建文件清单生成，排除开发文件；同步 `.sha256`、`PACKAGE-SHA256.json` 和发布说明。发布前逐项比对源码构建与 ZIP 内容。不要把整个仓库压缩后上传谷歌商店。

更新主分支与发布标签是不同步骤。用户要求发布后才推送 `v<version>` 标签，现有工作流会验证 ZIP/清单再发布；仅提交开发文档不会生成新版 Release。谷歌商店仍由发布者自行提交审核。

切换两台电脑时，开始前 `git pull --ff-only`，结束前检查并提交需要保留的改动，避免两边同时编辑相同文件。私有账户 JSON 单独备份，不提交公开仓库。

## 6. 新 Codex 聊天可直接发送

> 这是 Tango Paper Trader 项目。请先读取 AGENTS.md、DEVELOPMENT.md 和 docs/development/HANDOFF.md，核对当前分支与 manifest 版本，运行测试及静态检查后继续。已发布运行基线为0.3.57；保留原有交易、估值、笔记和账户功能，未经明确要求不发布、不重置账户，不把开发文件或私有备份放进商店ZIP。
