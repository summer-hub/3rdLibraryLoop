---
name: rnoh-lib-test-align
description: >-
  用于 RN 鸿蒙三方库升级适配：测试对齐与补全。
  当用户已经完成代码适配和编译验证（rnoh-lib-code-adapt），
  需要将上游社区的测试用例移植到本地工程、
  修复移植后的编译问题、进行测试覆盖率扫描、补充缺失的测试用例时使用。
  典型场景：用户说"帮我把上游的测试 demo 搬过来"、
  "测试用例编译不过帮我修"、"覆盖率不够需要补测试"、
  "上游新增了哪些 API 但我们没有测试覆盖"。
  也适用于：单独从某个 RN 三方库仓库提取测试 demo、分析测试覆盖率缺口、
  生成补充测试用例代码。本 skill 的输入通常来自 rnoh-lib-code-adapt。
compatibility: 需要 git、node、npm、python3、rsync，以及网络访问能力
allowed-tools: Bash Read Grep Glob Edit Write
metadata:
  author: rnoh-team
  version: "1.3"
  phase: "3-of-4"
---

# RN 鸿蒙三方库测试对齐与补全

三方库升级适配流程的第三阶段。将上游社区测试用例移植到本地鸿蒙化工程，修复编译问题，扫描测试覆盖率缺口，补充缺失的测试用例。

## 最小必要输入

- **必要**：上游仓库 URL + 版本标签（用于克隆仓库提取测试用例）
- **必要**：本地鸿蒙化工程目录路径（移植目标）
- **有帮助**：diff patch 文件（用于判断上游新增了哪些 API 需要测试覆盖）

## 工作流

### 第 1 步：移植上游测试用例

使用 `scripts/port-test-demo.sh` 从上游仓库提取测试 demo 到本地工程。

详细用法参考 [references/port-test-demo-guide.md](references/port-test-demo-guide.md)。

```bash
./scripts/port-test-demo.sh \
  --git-url https://github.com/react-native-picker/picker \
  --branch v2.11.4 \
  --template-dir /path/to/RN3rdTemplate/0.84
```

脚本自动完成：git clone → 检测 demo 目录 → 安装依赖 → 拷贝文件 → 合并入口。

**注意**：`workspace:` 协议依赖会自动转换为 `file:` 本地依赖。

### 第 2 步：修复移植后的编译问题

运行 `npm run dev` 收集所有编译错误，按类型分类后逐个修复。

| 问题 | 修复方法 |
|------|---------|
| 依赖缺失 | `npm install <包名>` |
| 导入路径错误（相对路径 → 包名） | 上游 demo 用 `'../src'`、`'../../src'` 引用库源码，移植后路径会解析到错误目录。需改为包名（如 `'@react-native-ohos/netinfo'`），用 `grep -rl "'../src'" example/src/` 批量定位 |
| 平台不兼容 | 添加 `'harmony'` 分支或条件渲染跳过 |
| API 不存在 | 检查是否需要适配（回到 rnoh-lib-code-adapt） |
| 类型错误 | 添加类型断言或调整类型定义 |
| 资源文件缺失 | 手动 `rsync -av` 拷贝 |

平台不兼容代码用条件渲染跳过：

```typescript
{Platform.OS !== 'harmony' ? <IOSOnlyComponent /> : null}
```

### 第 3 步：测试覆盖率扫描

识别未覆盖的 API/组件/props。

#### 覆盖率分析方法

1. **提取所有公开 API**：从 TurboModule spec 文件（`*Native*.ts`）中提取导出方法和属性
2. **提取所有组件 Props**：从 Fabric 组件 spec（`*NativeComponent.js`）中提取所有 props 定义
3. **提取所有 NativeCommands**：从 spec 中的 `codegenNativeCommands` 提取命令列表
4. **扫描测试用例**：在 `src/index.tsx` 和测试文件中搜索每个 API/Props/Command 的使用
5. **生成覆盖率报告**，格式参考下方模板

> ⚠️ **TurboModule 库（非 Fabric 组件库）的覆盖率维度**：对于 NetInfo 等 TurboModule 库，步骤 2-3（组件 Props、NativeCommands）不适用。覆盖率维度改为：
> - **API 覆盖**：从 TurboModule spec（`*Native*.ts`）提取方法列表，从 `src/index.ts` 提取公开导出的函数/hook
> - **状态类型覆盖**：如网络状态 `cellular`、`wifi`、`none`、`unknown` 等各类型
> - **配置选项覆盖**：如 `useNetInfoInstance` 的 `configuration` 参数各选项（`reachabilityShouldRun`、`reachabilityRequestTimeout` 等）

#### 覆盖率判断标准

- **已覆盖**：API/Prop/Event 在测试代码中有实际调用和使用
- **缺失**：在 spec 中定义但测试代码中未使用
- **不适用**：鸿蒙平台不支持、依赖原生运行时（如 `global.nativeFabricUIManager`）、或已标注为其他平台专属

#### 覆盖率报告模板

```markdown
## 测试覆盖率报告

### 组件 Props 覆盖率
| Prop | 是否测试 | 测试位置 | 状态 |
|------|---------|---------|------|
| source | ✅ | src/index.tsx:30 | 已覆盖 |
| resizeMode | ❌ | — | 缺失 |

覆盖率: 1/2 (50%)

### 事件覆盖率
| 事件 | 是否测试 | 状态 |
|------|---------|------|
| onChange | ✅ | 已覆盖 |
| onLoad | ❌ | 缺失 |

覆盖率: 1/2 (50%)

### NativeCommands 覆盖率
| Command | 是否测试 | 状态 |
|---------|---------|------|
| setNativeSelectedIndex | ❌ | 不适用（依赖 Fabric 原生环境） |
```

### 第 4 步：补充缺失的测试用例

根据覆盖率报告，为缺失项生成补充测试。包括两部分：

#### 4a. 补充 Demo 用例（功能演示）

参考上游 demo 实现，为缺失的 props/events 创建演示组件：

```typescript
// 新增 Prop 测试 Demo
function NewPropExample() {
  return (
    <MyComponent
      newProp={newValue}
      onNewEvent={(e) => console.log(e.nativeEvent)}
    />
  );
}
```

#### 4b. 补充单元测试（逻辑验证）

为组件核心逻辑编写 jest 单元测试。**React 19 + RN 0.84 环境下有特定的 mock 和配置要求**，详见：

- [references/unit-test-template.md](references/unit-test-template.md) — 测试模板和设计原则
- [references/jest-troubleshooting.md](references/jest-troubleshooting.md) — 常见问题排错（React 多副本、异步渲染、原生模块崩溃等）

**关键注意事项（React 19 + RN 0.84）**：

1. **React 多副本问题**：库根目录和 example 目录可能各有一份 `node_modules/react`，导致 hooks 失效。必须在 `jest.config.js` 的 `moduleNameMapper` 中强制统一 React 路径。
2. **React 19 异步渲染**：`react-test-renderer` 在 React 19 中已弃用且默认异步渲染。必须设置 `globalThis.IS_REACT_ACT_ENVIRONMENT = true` 并用 `act()` 包裹 `TestRenderer.create()`。
3. **Fabric 原生组件 mock**：`*NativeComponent.js` 深度导入 react-native 内部模块，必须为每个 Fabric 组件创建独立 mock。
4. **react-native mock**：测试环境中 react-native 原生桥不可用，必须创建 `__mocks__/react-native.js` 提供最小化导出。

> ⚠️ **TurboModule 库与 Fabric 组件库的测试策略差异**：
> - **Fabric 组件库**：需要 mock `codegenNativeComponent` 生成的 Fabric 原生组件（如上文第 3 点），覆盖率维度以 Props/Events/Commands 为主
> - **TurboModule 库（如 NetInfo）**：**不需要** mock `codegenNativeComponent`，但需要 mock `NativeEventEmitter` 和 `NativeModules`（从 `react-native` 导入）。**关键**：`NativeEventEmitter.addListener` 必须返回 `{ remove: () => void }` 对象（模拟 RN 的 `NativeEventSubscription`），否则 `State.tearDown()` 中的 `this._nativeEventSubscription.remove()` 会报 `TypeError: ...remove is not a function`。详见 [references/jest-troubleshooting.md](references/jest-troubleshooting.md) 问题 8。

### 第 5 步：编译与测试验证

```bash
# 1. JS Bundle 构建（生成 harmony/entry/src/main/resources/rawfile/bundle.harmony.js）
npm run dev

# 2. 单元测试（如有）
npx jest --config jest.config.js --verbose

# 3. 确认无编译错误、测试全部通过
```

### 第 6 步：设备运行时验证

编译通过 ≠ 运行时正常。必须在真实鸿蒙设备上验证应用能否启动和渲染。

#### 6a. 部署到设备

通过 DevEco Studio Build → Run 部署 HAP 到设备，或使用 hdc 命令推送 bundle。

#### 6b. 常见运行时崩溃

| 崩溃信息 | 根因 | 修复 |
|---------|------|------|
| `Element type is invalid: got: object` | `index.tsx` 缺少 `export default` | 在 `AppRegistry.registerComponent` 前添加 `export default ExampleApp;` |
| `Cannot read property 'useState' of null` | Metro 产生两个 React 实例 | 修复 `metro.config.js`，包装 RNOH 的 resolveRequest |
| 白屏无渲染 | 设备加载了旧的 rawfile bundle | 重新 `npm run dev` 并重新构建 HAP |

**详细排查步骤和修复代码参考** [references/runtime-troubleshooting.md](references/runtime-troubleshooting.md)。

#### 6c. Metro Dev Server 验证

启动 Metro 并设置端口转发，让设备实时加载最新 bundle：

```bash
hdc fport tcp:8081 tcp:8081
npm run start
```

在设备上重新打开应用，观察 Metro 控制台是否有 bundle 请求日志。

## 常见边界情况

### 上游没有独立的 demo 目录

使用 `--demo-dirs` 参数手动指定目录，或直接拷贝相关测试文件到 `src/` 下。

### 上游 demo 使用 monorepo 结构

`port-test-demo.sh` 会自动检测 `packages/*/example` 结构。如自动检测失败，手动指定 `--demo-dirs packages/core/example`。

### 测试用例依赖了未鸿蒙化的三方库

- 纯 JS 库可以直接安装使用
- 依赖原生代码且无鸿蒙化版本：在测试中 mock 或条件渲染跳过

### 资源文件（动画、图片）缺失

`port-test-demo.sh` 会自动拷贝 assets 目录。如遗漏，手动 `rsync -av` 拷贝。

### Metro 产生重复 React 实例导致 hooks 崩溃

库通过 `"file:.."` symlink 安装时，库根目录和 example 目录各有一份 `node_modules/react`。Metro 会为两个路径分别创建模块实例，导致 `ReactSharedInternals.H` 为 null，调用 `useState()` 时崩溃。

**关键约束**：不能在 `metro.config.js` 中直接设置 `resolveRequest` 覆盖 RNOH 的 harmony 解析器——这会导致 `.harmony.js` 平台文件解析全部失效。必须**包装** RNOH 的 `resolveRequest`，只拦截裸 `react` 导入。详见 [references/runtime-troubleshooting.md](references/runtime-troubleshooting.md)。

### 设备加载旧 bundle 导致修复不生效

鸿蒙应用启动时按优先级尝试多个 bundle 来源（Metro → 设备文件 → rawfile 资源）。如果 Metro 未运行且 HAP 未重新构建，设备会加载编译进 HAP 的旧 `rawfile/bundle.harmony.js`。必须重新执行 `npm run dev` 并在 DevEco Studio 中重新 Build → Run。

## 输出物清单

1. **移植后的测试用例代码** — 在 `src/index.tsx` 和 `src/` 目录下
2. **测试覆盖率报告** — 记录 API/Props/Events/Commands 的覆盖情况
3. **补充的测试用例** — Demo 用例 + jest 单元测试
4. **编译和测试验证结果** — `npm run dev` 通过、jest 测试通过
5. **设备运行时验证结果** — 应用在设备上正常启动渲染，无运行时崩溃

这些输出物是 rnoh-lib-func-test skill 的输入。
