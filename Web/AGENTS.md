# Web —— 前端系统（核心工作台 + 二级目录扩展）

本目录是 3rdLibraryLoop 的前端资产源码。**推荐用 CLI 启动**：

```bash
node cli/bin/3rdloop.mjs web            # 本地全功能：核心前端 + Web/ext/ 全部扩展（tag/issue/prcheck）
3rdloop web                             # 发布态：npm 包内置核心前端（扩展需 install-ext 启用）
3rdloop web --no-ext                    # 纯后端操作模式：仅核心工作台，强制禁用全部扩展
```

## 目录结构

```
Web/
├── AGENTS.md            # 本文档
├── server.js            # 纯静态托管 + /api 反代（简易部署用；无扩展挂载能力）
├── public/              # 核心前端（进 npm 包，由 cli prepack 复制为 cli/web）
│   ├── index.html       # 工作台单页（PR 检视 / 仓库检视 / loop / knowledge）
│   ├── css/ js/         # 面板样式与脚本（每面板一个 js，懒加载初始化）
│   ├── knowledge.html / loop.html   # 兼容入口（服务端 302 到 hash 路由）
└── ext/                 # 二级目录扩展（不进 npm 包，按需启用）
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
| 仓库开发态（全功能） | `node cli/bin/3rdloop.mjs web` 自动全量挂载 `Web/ext/` |
| npm 发布态（按需启用） | `3rdloop web install-ext <仓库>/Web/ext/tag`（可多个）→ `3rdloop web` |
| **纯后端操作模式** | `3rdloop web --no-ext` 强制禁用全部扩展（仅核心工作台，不受已安装扩展影响） |
| 白名单模式 | `3rdloop web --ext tag,issue` 仅挂载指定扩展（可重复指定，未发现的名字打警告） |
| 自定义扩展 | 放入 `~/.3lib/3rdloop/web-ext/<name>/`，或 `--ext-root <dir>` 追加 |
| 临时实验 | `3rdloop web --web-root <自定义前端目录>` 整目录替换核心前端 |

扩展开关优先级：`--no-ext` > `--ext <白名单>` > 默认全量（发现多少挂载多少）。
扩展为 0 时前端导航"扩展功能"分区自动隐藏，`/<mount>` 路径返回 404。

前端导航：`public/index.html` 的 `#nav-ext-section` 由 `navigation.js` `ExtNav` 经
`/api/ext-registry` 动态渲染（无扩展或端点缺失时静默隐藏）。

## 新增扩展步骤

1. 复制最简范本 `ext/tag/` 为 `ext/<name>/`，改 manifest（name/mount/title/order）。
2. router.cjs 用 shim 支持的 API 写路由（勿用 `router.use`/中间件/第三方包）。
3. 页面写 `public/index.html`，API 调用用根绝对路径 `fetch('/<mount>/xxx')`。
4. 验收：`3rdloop web list-ext` 可见 → 启动后 `curl /<mount>` 与 `curl /<mount>/<api>` 通。
5. 敏感凭据一律走环境变量（.env 链），**不得**内置 token/密码到扩展源码。

## 已知差异（相对 AIWeb 原版）

- Issue 扩展的 GitCode Token 仅读 `GITCODE_TOKEN` 环境变量（原版内置兜底值已剥离）。
- 扩展数据目录改为注入式（`<数据目录>/web-ext/<name>`），不再写死仓库相对路径。
- Issue AI 分类的 CLIController 经 `serverRoot` 注入（vendor/Server 或仓库 Server）。
