# Routes —— HTTP 接口层

对外暴露 REST API，供 Web 前端（同机反向代理）调用。采用分层架构，实现高内聚低耦合。

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  入口层  server.js                                            │
│  创建 HTTP 服务、组装共享依赖、委派请求给 Router              │
├──────────────────────────────────────────────────────────────┤
│  路由层                                                      │
│  ┌─────────────────────┐    ┌──────────────────────────────┐ │
│  │ router/Router.js    │    │ routes/index.js              │ │
│  │ 路由匹配/参数提取   │    │ 路由注册表（Controller 挂载） │ │
│  │ 中间件链/统一响应   │    │ 新增模块只需在此追加         │ │
│  └─────────────────────┘    └──────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  控制器层  controllers/                                       │
│  HealthController.js   - 健康检查                            │
│  (TaskController.js)   - 任务管理（未来）                    │
│  (StreamController.js) - SSE 实时推送（未来）                │
├──────────────────────────────────────────────────────────────┤
│  依赖注入                                                    │
│  共享单例（CLIController / TaskStepStore / SseHub）           │
│  由 server.js 组装，通过 dependencies 注入各 Controller       │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
Server/Routes/
├── AGENTS.md                      # 本文档
├── server.js                      # 入口：HTTP 服务 + 依赖组装 + 优雅关闭
├── router/
│   └── Router.js                  # 路由器内核（匹配/分发/中间件/响应封装）
├── routes/
│   ├── index.js                   # 路由组装器（集中管理各域挂载）
│   ├── health.js                  # 健康检查域路由
│   └── stream.js                  # SSE 实时推送域路由
├── controllers/
│   ├── HealthController.js        # 健康检查控制器
│   └── StreamController.js        # SSE 订阅控制器
├── sse/
│   └── SseHub.js                  # SSE 推送中心（连接管理/心跳/限流/清理）
└── library/
    └── logger.js                  # 轻量日志工具
```

## 分层职责

### server.js — 入口层
- 创建 `http.Server`，仅绑定 `127.0.0.1`（同机回环，不对外暴露）
- 组装共享依赖（CLIController 等单例），通过 `dependencies` 对象注入
- 将所有请求委派给 `Router.handle()`
- **不包含任何业务逻辑**

### router/Router.js — 路由器内核
- 路径模板编译：支持 `:param` 参数提取、`*` 通配符
- HTTP 方法匹配：GET / POST / PUT / DELETE
- 子路由挂载：`router.use(prefix, subRouter)` 按模块聚合
- 中间件链：支持 per-route 中间件（鉴权、日志等）
- 统一响应封装：`ResponseContext.json()` / `.error()` / `.stream()`
- 自动 JSON body 解析
- **与业务完全解耦，可独立测试**

### routes/ — 路由注册表
- `index.js` — 组装器，将各域路由挂载到主路由器，只做 `router.use()` 拼装
- `health.js` — 健康检查域：实例化 Controller + 定义路径映射
- 新增业务模块时：
  1. 在 `controllers/` 下创建 `XxxController.js`（业务逻辑）
  2. 在 `routes/` 下创建 `xxx.js`，导出 `createXxxRouter(dependencies)`
  3. 在 `routes/index.js` 追加 import + `router.use()`

### controllers/ — 控制器层
- 每个 Controller 封装一类业务逻辑
- 通过构造函数接收依赖（CLIController 等），不自行 new
- handler 方法只接收 `RequestContext` / `ResponseContext`，不直接操作原生 req/res

## 新增接口示例

以「任务管理」为例：

```js
// 1. controllers/TaskController.js — 业务逻辑
class TaskController {
    constructor(cli, taskStepStore) { ... }
    async list(req, res) { ... }
    async create(req, res) { ... }
    async get(req, res) { ... }
}

// 2. routes/task.js — 路由注册
import { Router } from '../router/Router.js';
import TaskController from '../controllers/TaskController.js';
export function createTaskRouter(dependencies) {
    const { cli, taskStepStore } = dependencies;
    const c = new TaskController(cli, taskStepStore);
    const router = new Router();
    router.get('',            c.list.bind(c));
    router.post('',           c.create.bind(c));
    router.get('/:taskId',    c.get.bind(c));
    return router;
}

// 3. routes/index.js — 组装器中追加
import { createTaskRouter } from './task.js';
router.use('/api/tasks', createTaskRouter(dependencies));
```

## 依赖注入

共享单例由 `server.js` 统一组装：

```js
const dependencies = {
    cli: cliInstance,
    // taskStepStore: createStorage().taskStepStore(),  // 未来
    // sseHub: new SseHub(),                            // 未来
};
registerRoutes(router, dependencies);
```

Controller 通过构造函数接收依赖，便于测试时 mock。

## 运行

```bash
# 启动后端服务
node Server/Routes/server.js --port 3000 --type opencode

# 接口列表
#   GET  /api/health        - 大模型健康检查
#   GET  /api/health/ping   - 后端探活
#   GET  /api/health/check  - 健康检查（别名）
```
