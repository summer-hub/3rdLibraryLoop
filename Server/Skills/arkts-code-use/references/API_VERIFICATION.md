# API 查证指南

> 编写 ArkTS 代码前，所有系统 API 的 import 路径、方法签名、权限、API Level 必须通过官方文档查证。本文档说明查证工具的使用方法与领域关键词速查。

---

## 一、查证工具

### 1.1 首选：MCP Gateway `script_deveco_docs`

MCP Gateway 运行时，`script_deveco_docs` 工具封装了 `devecocli docs`，可直接检索与精读 HarmonyOS 官方 API 文档。

**按关键词检索（action=search）**：

```json
{
  "action": "search",
  "keywords": "http createHttp request",
  "catalog": "harmonyos-references",
  "limit": 5
}
```

| 参数 | 说明 |
|------|------|
| `action` | `search`（检索）或 `read`（读全文） |
| `keywords` | 空格分隔的关键词，建议 2-4 个（API 名 + 模块名 + 功能词） |
| `catalog` | 默认 `harmonyos-references`（API 参考）；指南类用 `harmonyos-guides` |
| `limit` | 返回条数，默认 10 |

返回字段：`title`（文档标题）、`documentId`（用于 read）、`sectionTitle`（命中小节）、`snippet`（摘要）。

**按 documentId 精读（action=read）**：

```json
{
  "action": "read",
  "documentId": "API参考/网络/Network_Kit_网络服务/ArkTS_API/ohos_net_http_数据请求_/js-apis-http",
  "section": "HttpRequest"
}
```

`section` 可选，指定后只返回该小节（推荐，节省 token）。文档正文包含：方法签名、参数表、返回值、`权限`、`系统能力`（SystemCapability）、`起始版本`（since）、`废弃`（deprecated）标注、错误码。

### 1.2 备选：`devecocli docs`（终端）

MCP 不可用时直接使用 CLI：

```bash
# 检索（匹配任一关键词）
devecocli docs search "http createHttp" --limit 5

# 按文档 ID 精读
devecocli docs read "API参考/网络/Network_Kit_网络服务/ArkTS_API/ohos_net_http_数据请求_/js-apis-http"

# 查看可用文档目录
devecocli docs catalog
```

### 1.3 补充：知识库（最佳实践/平台陷阱）

MCP Gateway 的 `kb_search`（内置）或 `kb-server_search_knowledge`（下游）可检索鸿蒙知识库中的最佳实践与实战经验（如平台陷阱、性能优化），适合在方案设计阶段补充查询，不适合替代官方 API 参考。

---

## 二、三步查询法

对每个涉及的系统 API 依次执行：

```
Step 1 宽泛定位：用功能关键词检索，确认可用的模块/类
        例：keywords = "video player"
Step 2 精确签名：read 文档定位到具体类/方法小节，记录完整签名
        例：documentId = "...js-apis-media", section = "createAVPlayer"
Step 3 权限与版本：确认该 API 的「权限」「起始版本」「废弃」标注
        - 权限 → 记入 module.json5 声明清单
        - since > 目标 API Level → 加 canIUse()/sdkApiVersion 守卫或换旧接口
        - deprecated → 检索替代接口（keywords 加 "alternative" 或直接搜新接口名）
```

---

## 三、领域关键词速查

| 领域 | 功能 | 检索关键词 |
|------|------|-----------|
| 网络 | HTTP 请求 | `http createHttp request` |
| 网络 | WebSocket | `webSocket connect` |
| 网络 | 网络状态 | `network connection` |
| 存储 | KV 偏好 | `preferences data` |
| 存储 | 关系型数据库 | `relationalStore` |
| 存储 | 文件读写 | `file fs openSync readSync` |
| 存储 | 用户文件选择 | `file picker` |
| UI | 页面路由 | `Navigation NavDestination router` |
| UI | 列表懒加载 | `LazyForEach IDataSource` |
| UI | 动画 | `animateTo animation` |
| UI | 弹窗 | `CustomDialog AlertDialog` |
| 多媒体 | 视频播放 | `AVPlayer media` |
| 多媒体 | 音频播放/录制 | `AudioRenderer AudioCapturer` |
| 多媒体 | 图片处理 | `ImageSource PixelMap` |
| 设备 | 定位 | `geoLocationManager` |
| 设备 | 蓝牙 BLE | `bluetooth ble` |
| 设备 | 传感器 | `sensor accelerometer` |
| 设备 | 振动 | `vibrator` |
| 安全 | 对称加密 | `cryptoFramework AES Cipher` |
| 安全 | 摘要/HMAC | `cryptoFramework hash hmac` |
| 安全 | 密钥管理 | `huks` |
| 并发 | 任务池 | `taskpool execute Concurrent` |
| 并发 | Worker | `worker ThreadWorker` |
| 事件 | 事件总线 | `emitter on emit off` |
| 权限 | 运行时申请 | `requestPermissionsFromUser abilityAccessCtrl` |
| 应用 | 应用上下文 | `common UIAbilityContext` |
| 应用 | 弹框申请 | `requestPermissionsFromUser` |

---

## 四、API Level 对照

| API Level | 系统版本 | 说明 |
|-----------|---------|------|
| 9 | HarmonyOS 3.2 | 基础 API |
| 10 | HarmonyOS 4.0 | — |
| 11 | HarmonyOS 4.1 | Stage 模型完善 |
| 12 | HarmonyOS 5.0 (NEXT) | NEXT 正式版本 |
| 13+ | 5.x 后续 | 持续演进 |

**规则**：
- 工程模式：目标 API Level 以目标工程 `build-profile.json5` 的 `compatibleSdkVersion` 为准（先读取再写代码）
- 独立模式：默认按 API 12+ 编写；`since` > 12 的接口必须加版本守卫
- 优先使用非废弃接口；文档明确标注 `废弃` 的禁止使用

---

## 五、查证结论记录格式

每个功能点查证后立即记录，作为 Phase 3 编码依据：

| 功能点 | import 路径 | 关键 API 与签名 | 权限 | since | 结论 |
|--------|------------|----------------|------|-------|------|
| 发起 GET 请求 | `@kit.NetworkKit` (`http`) | `http.createHttp(): HttpRequest`、`request(url, options): Promise<HttpResponse>` | `ohos.permission.INTERNET` | 8 | ✅ |
| 后台计算校验和 | `@ohos.taskpool` | `@Concurrent` 函数 + `taskpool.execute(task)` | 无 | 9 | ✅ |
| 蓝牙扫描 | `@ohos.bluetooth.ble` | `startScan(filters)` | `ohos.permission.ACCESS_BLUETOOTH` | 10 | ⚠️ 需 canIUse 守卫 |

> 未出现在该表中的系统 API 不允许出现在最终代码里。
