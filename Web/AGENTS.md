# Web —— 前端系统（核心工作台 + 二级目录扩展）

本目录是 3rdLibraryLoop 的前端资产源码。**推荐用 CLI 启动**：

```bash
node cli/bin/3rdloop.mjs serve          # 本地全功能：核心前端 + Web/ext/ 全部扩展（tag/issue/prcheck）
3rdloop serve                             # 发布态：核心包 @summer-hub/3rdloop_core 内置核心前端 + Web/ext（扩展自动发现）
3rdloop serve --no-ext                    # 纯后端操作模式：仅核心工作台，强制禁用全部扩展
```

## 目录结构

```
Web/
├── AGENTS.md            # 本文档
├── server.js            # **兼容入口**：委托 cli/lib/web.js 的 startWebServer（与 3rdloop serve 同一实现）
├── public/              # 核心前端（随核心包 @summer-hub/3rdloop_core 发布，路径 <核心包根>/Web/public）
│   ├── index.html       # 工作台单页（PR 检视 / 仓库检视 / loop / knowledge）
│   ├── css/ js/         # 面板样式与脚本（每面板一个 js，懒加载初始化）
│   ├── knowledge.html / loop.html   # 兼容入口（服务端 302 到 hash 路由）
└── ext/                 # 二级目录扩展（随核心包发布：<核心包根>/Web/ext，仓库开发态同路径；安装态自动发现）
    ├── tag/             # GitCode 打 TAG 系统（挂载 /tag）
    ├── prcheck/         # PR 检视意见批量解决（挂载 /prcheck）
    └── issue/           # GitCode Issue 查询系统（挂载 /issue）
```

## 扩展机制（tag / issue / prcheck 等）

移植自 AIWeb 的 TAG/Issue/PrCheck 独立子系统，改造为**自包含扩展目录**：
既是开发态源码（仓库内直接挂载），也是安装单元（`install-ext` 复制到用户目录）。

```
Web/ext/<name>/
├── manifest.json        # { name, title, description, mount, order, server, page }
├── router.cjs           # API 路由：module.exports.createExtRouter(deps)
├── *.cjs                # 路由本地依赖（database/gitcodeApi 等，CommonJS）
└── public/index.html    # 前端页面（自包含单文件，fetch 根绝对路径如 /tag/list）
```

- 挂载语义：`GET /<mount>` 出页面；`/<mount>/<sub>` 先匹配 API 路由，未命中回退 `public/` 静态。
- `createExtRouter(deps)` 注入：`express`（轻量 shim，仅 get/post/put/patch/delete + `:param`）、
  `Database`（better-sqlite3）、`dbDir`（数据落 `<数据目录>/web-ext/<name>`）、
  `serverRoot`（核心引擎 Server 根，issue 扩展经此解析 CLIController 做 AI 分类）。
- manifest 校验：name/mount 须匹配 `^[a-z][a-z0-9-]*$`；mount 不得占用 `/api`、`/stream`；
  server/page 路径不得越出扩展目录。

## 启用方式

| 场景 | 方式 |
|------|------|
| 仓库开发态（全功能） | `node cli/bin/3rdloop.mjs serve` 自动全量挂载 `Web/ext/` |
| npm 安装态 | 扩展随核心包发布（`<核心包根>/Web/ext`），serve 自动发现，无需 `install-ext` |
| **纯后端操作模式** | `3rdloop serve --no-ext` 强制禁用全部扩展（仅核心工作台，不受已安装扩展影响） |
| 白名单模式 | `3rdloop serve --ext tag,issue` 仅挂载指定扩展（可重复指定，未发现的名字打警告） |
| 自定义扩展 | 放入 `~/.3lib/3rdloop/web-ext/<name>/`，或 `--ext-root <dir>` 追加 |
| 临时实验 | `3rdloop serve --web-root <自定义前端目录>` 整目录替换核心前端 |

扩展开关优先级：`--no-ext` > `--ext <白名单>` > 默认全量（发现多少挂载多少）。
扩展为 0 时前端导航"扩展功能"分区自动隐藏，`/<mount>` 路径返回 404。

前端导航：`public/index.html` 的 `#nav-ext-section` 由 `navigation.js` `ExtNav` 经
`/api/ext-registry` 动态渲染（无扩展或端点缺失时静默隐藏）。

## 插件管理页（`p-plugins`）

工作台左侧导航的「插件」分区，脚本 `public/js/plugins.js`，走既有懒加载注册。

插件模型是 **DSH 式：一个 profile 一个目录，插件就是该目录的 npm 依赖**（`<profileDir>/node_modules/`），
安装/卸载走包管理器，启用状态单独记在 `profile.json`。页面上的一切都围绕这一点：

- 数据源是 **`GET /api/plugins?profile=<name>`**（由 `cli/lib/web.js` 在 `/api/*` 反代**之前**本地响应），
  背后是内核 `PluginHost.describe()` + `cli/lib/plugin-store.js` 的 `check()`——与
  `3rdloop plugin list/check` **同一份数据、同一套判定**，不存在"界面说能关、命令行说不能"。
  快照字段：`{profile, profileDir, profiles[], overlay{path,exists,dir}, overlayPath, roots, plugins[], seams, conflicts, errors, warnings}`。
- **profile 选择器**（`#plugins-profile-select`）列出 `data.profiles`，切换后带 `?profile=` 重新拉取，
  并用 `history.replaceState` 把 hash 同步成 `#p-plugins`（不引路由库）。当前 profile 与 `profileDir` 显示在信息条。
- 安装：**`POST /api/plugins/install`** `{spec, profile?}`，`spec` 是 npm 能吃的写法
  （包名 / git 地址 / tarball / `file:<本机目录>`）；旧参数 `{dir}` 仍兼容，服务端折成 `file:<绝对路径>`。
  成功后提示「已安装 `<name>`（profile `<p>`，重启 `3rdloop serve` 生效）」。装卸与 CLI 共用 `plugin-store`
  的同一实现（分类 → **engines 预检（不通过则不下载不安装）** → `npm install --install-links` → 复查宿主可见性 → 失败逐字节回滚）。
- 卸载：**`POST /api/plugins/remove`** `{name, profile?}`。「卸载」按钮只出现在 `source === 'profile'` 或 `'user'`
  的行上（内置插件后端同样拒绝），确认框写清「从 profile `<p>` 卸载」并附插件目录与 `package.json` 位置。
- 开关走 **`POST /api/plugins/toggle`** `{name, enabled, force?, profile?}`，成功返回
  `{success:true, data:{...,profile, requiresRestart:true}}`；校验失败回 **HTTP 400**（不是 500），
  `message` 直接展示给用户。未知 profile 同样是 400（`GET` 时 message 带可用名单）。
- 写入目标是 `~/.3lib/3rdloop/profiles/<profile>/profile.json`（目录式 overlay），**不改包内 profile**；
  成功后页面提示「重启 `3rdloop serve` 生效」。
- 表格「来源」列：内置 / profile / 用户 / —；「位置」列显示插件落在哪（`profile` 来源显示「profile 依赖」，
  完整路径进 `title`）。
- `required` 插件开关置灰并给出原因；被启用插件依赖的（`dependents.length > 0`）先
  `confirm()` 再带 `force:true` 提交，取消则不发请求。
- 接缝冲突（同一接缝多个提供方，如 `ai-cli`）在页面上标出提供方与生效者。
- 验收：`test/m16-plugin-web`（79 条断言）覆盖快照 / toggle / install / remove / 400 拒绝 / 坏 body /
  静态资源 / 令牌门禁 / **profile 选择与隔离**（web 里装的插件不出现在 default）/ engines 坏包不落盘。

## 新增扩展步骤

1. 复制最简范本 `ext/tag/` 为 `ext/<name>/`，改 manifest（name/mount/title/order）。
2. router.cjs 用 shim 支持的 API 写路由（勿用 `router.use`/中间件/第三方包）。
3. 页面写 `public/index.html`，API 调用用根绝对路径 `fetch('/<mount>/xxx')`。
4. 验收：`3rdloop serve list-ext` 可见 → 启动后 `curl /<mount>` 与 `curl /<mount>/<api>` 通。
5. 敏感凭据一律走环境变量（.env 链），**不得**内置 token/密码到扩展源码。

## 已知差异（相对 AIWeb 原版）

- Issue 扩展的 GitCode Token 仅读 `GITCODE_TOKEN` 环境变量（原版内置兜底值已剥离）。
- 扩展数据目录改为注入式（`<数据目录>/web-ext/<name>`），不再写死仓库相对路径。
- Issue AI 分类的 CLIController 经 `serverRoot` 注入（vendor/Server 或仓库 Server）。
