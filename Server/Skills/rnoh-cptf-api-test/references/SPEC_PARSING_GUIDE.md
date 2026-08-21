# 接口规格解析指南

> Phase 1 的详细操作手册。目标是解析接口规格说明书，提取结构化 API 清单，并探查工程目录结构。

---

## 1. 规格文档格式

### 1.1 Markdown 格式（来自 script_rn_render_spec_doc）

典型结构：

```markdown
# {库名} 接口规格说明书

## 模块信息
- 包名: @react-native-ohos/react-native-xxx
- 版本: x.y.z
- 平台: HarmonyOS

## API 清单

### TurboModule 方法

#### methodA(param1: string, param2?: number): Promise<Result>
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| param1 | string | 是 | ... |
| param2 | number | 否 | ... |

- 返回值: Promise<Result>
- 平台: harmony
- 权限: ohos.permission.xxx

### 组件

#### ComponentA
| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| prop1 | string | - | ... |

### 事件

#### onEventA
| 参数 | 类型 | 说明 |
|------|------|------|
| data | { value: number } | ... |

### 常量

#### CONSTANT_A: string
- 值: "fixed_value"
- 平台: harmony
```

### 1.2 JSON 格式（来自 script_rn_extract_interfaces）

典型结构：

```json
{
  "moduleName": "react-native-xxx",
  "version": "x.y.z",
  "exports": {
    "methods": [
      {
        "name": "methodA",
        "params": [
          { "name": "param1", "type": "string", "required": true },
          { "name": "param2", "type": "number", "required": false }
        ],
        "returnType": "Promise<Result>",
        "isAsync": true
      }
    ],
    "components": [
      {
        "name": "ComponentA",
        "props": [
          { "name": "prop1", "type": "string", "default": null }
        ]
      }
    ],
    "constants": [
      { "name": "CONSTANT_A", "type": "string", "value": "fixed_value" }
    ],
    "events": [
      { "name": "onEventA", "payload": { "value": "number" } }
    ]
  }
}
```

---

## 2. API 清单提取方法

### 2.1 Markdown 解析

按标题层级提取：

| 标题级别 | 提取内容 |
|----------|----------|
| `##` | API 分类（TurboModule 方法/组件/事件/常量） |
| `###` | API 名称 |
| `####` | 方法签名（参数、返回值） |
| 表格 | 参数详情、属性详情 |
| 列表项 | 平台、权限、返回值说明 |

提取步骤：

1. 识别 `## API 清单` 下的所有 `###` 标题 → API 分类
2. 对每个分类下的 `####` 标题 → 提取方法签名
3. 解析签名中的参数列表（`param: type` 格式，`?` 表示可选）
4. 解析返回值（`Promise<X>` → 异步，`X` → 同步）
5. 提取表格中的参数详情
6. 提取列表项中的平台和权限信息

### 2.2 JSON 解析

直接遍历 `exports` 对象的各字段：

| JSON 字段 | 对应 API 类型 |
|-----------|--------------|
| `exports.methods` | TurboModule 方法 |
| `exports.components` | 组件 |
| `exports.events` | 事件回调 |
| `exports.constants` | 常量/枚举 |
| `exports.hooks` | React Hooks |
| `exports.types` | 类型定义（不生成 Demo/Test） |

### 2.3 MCP 工具辅助

若规格文档不存在或不完整，调用 MCP 工具从源码提取：

**提取接口规格**：
调用 `script_rn_extract_interfaces`，传入：
- `libroot`：RN 三方库的鸿蒙化仓库根目录
- `output`：输出 JSON 路径（如 `interface-spec.json`）
- `version`：上游 npm 版本号（可选，自动推断）

**渲染为 Markdown**：
调用 `script_rn_render_spec_doc`，传入：
- `spec`：已有的 interface-spec.json 路径
- `output`：输出 Markdown 路径

**交叉验证导出接口**：
调用 `script_rn_scan_exports`，传入：
- `dir`：源码目录路径
- `compare`：false（单目录扫描模式）

---

## 3. 工程目录探查

### 3.1 探查 example/demo 目录

```bash
# 按优先级搜索
for dir in \
  "{projectRoot}/rn-tester/examples" \
  "{projectRoot}/example/src" \
  "{projectRoot}/examples/src" \
  "{projectRoot}/example" \
  "{projectRoot}/demo/src" \
  "{projectRoot}/demo"; do
  if [ -d "$dir" ]; then
    echo "FOUND: $dir"
    break
  fi
done
```

探查到的目录赋值给 `exampleDir`。Demo 页面文件和 CPTF 测试工程统一生成在 `{exampleDir}/cptf/` 下。

### 3.2 探查 Demo 注册入口

```bash
# 按优先级搜索注册文件
find {projectRoot} -name "RNTesterList.*" -o -name "TesterList.*" | head -5
# 备选
find {projectRoot} -name "App.tsx" -path "*/example/*" | head -5
```

读取 `registerFile` 内容，分析现有注册模式：

| 模式 | 识别特征 | 追加方式 |
|------|----------|----------|
| 模式 A | `require(...)` + 数组对象含 `module` 字段 | 追加 `{ key, category, module: require(...) }` |
| 模式 B | `import ... from ...` + 导航/路由配置 | 添加 import + 路由配置 |
| 模式 C | `demos`/`items` 数组 + `Component` 字段 | 添加 import + 追加数组项 |

### 3.3 提取构建信息

```bash
# bundleId
cat {exampleDir}/harmony/AppScope/app.json5 | grep bundleName

# hap 路径
ls {exampleDir}/harmony/entry/build/default/outputs/default/entry-default-signed.hap

# 依赖检查
cat {exampleDir}/package.json | grep "{harmonyPkgName}"
```

### 3.4 缺失处理

| 探查项 | 缺失处理 |
|--------|----------|
| `package.json` | 停止，提示非 RN 工程 |
| example/demo 目录 | 停止，提示用户指定 Demo 目录 |
| 注册入口文件 | 停止，提示用户指定注册文件 |
| `harmonyPkgName` 依赖 | 停止，提示先安装依赖 |
| hap 构建产物 | 警告，继续生成代码（Phase 6 交付后需构建，参见 `rnoh-cptf-test-run` Phase 1.2） |
| AppScope/app.json5 | 警告，bundleId 用占位符 |

---

## 4. API 清单产出物

Phase 1 结束时必须产出以下结构化清单（Phase 2-5 的输入）：

```markdown
## API 清单

### TurboModule 方法
| # | 方法名 | 签名 | 异步 | 参数 | 返回值 | 平台 | 权限 |
|---|--------|------|------|------|--------|------|------|
| 1 | methodA | methodA(p1: string, p2?: number) | 是 | p1(string,必填), p2(number,可选) | Promise<Result> | harmony | - |
| 2 | methodB | methodB(): string | 否 | 无 | string | harmony | - |

### 组件
| # | 组件名 | Props | 平台 |
|---|--------|-------|------|
| 1 | ComponentA | prop1(string), prop2(boolean) | harmony |

### 事件
| # | 事件名 | Payload | 平台 |
|---|--------|---------|------|
| 1 | onEventA | { value: number } | harmony |

### 常量
| # | 常量名 | 类型 | 值 | 平台 |
|---|--------|------|-----|------|
| 1 | CONSTANT_A | string | "fixed_value" | harmony |

## 工程信息
- exampleDir: {探查到的路径}
- workspaceDir: {exampleDir}/cptf/
- indexFile: {exampleDir}/cptf/index.tsx
- demoDir: {exampleDir}/cptf/demo/
- bundleId: {从 app.json5 提取}
- hapPath: {exampleDir}/harmony/entry/build/default/outputs/default/entry-default-signed.hap
- dependencies: {已确认依赖存在}
```

---

## 5. 知识库查询

当涉及鸿蒙平台特定约束时，调用 `kb_search` 查询：

| 场景 | 检索词 |
|------|--------|
| 权限要求 | `HarmonyOS 权限 {功能}` |
| ArkTS 限制 | `ArkTS 限制 {主题}` |
| TurboModule 适配 | `RNOH TurboModule 适配` |
| 事件机制 | `RNOH 事件 NativeEventEmitter` |

调用要点：
- 一次查询一个关键词
- 对返回结果提取：知识点、注意事项、代码示例
- 若返回不相关，调整关键词重试（最多3轮）
- 不照搬全文，提取核心要点精简引用
