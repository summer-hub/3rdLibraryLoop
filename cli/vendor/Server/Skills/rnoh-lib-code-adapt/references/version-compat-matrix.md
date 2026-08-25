# RN/RNOH 版本兼容矩阵

## 核心依赖版本对照

| 依赖项 | 0.72 | 0.77 | 0.82 | 0.84 |
|--------|------|------|------|------|
| `react` | 18.2.0 | 18.3.1 | 19.1.1 | 19.2.3 |
| `react-native` | 0.72.x | 0.77.1 | 0.82.1 | 0.84.1 |
| `@react-native-oh/react-native-harmony` | 0.72.x | 0.77.18-1 | 0.82.30 | 0.84.2 |
| `@react-native-oh/react-native-harmony-cli` | 0.72.x | 0.77.18-1 | 0.82.30 | 0.84.2 |
| `@react-native-community/cli` | 11.x | 15.0.1 | 20.0.0 | 20.1.0 |
| `@react-native/babel-preset` | 0.72.x | 0.77.1 | 0.82.1 | 0.84.1 |
| `@react-native/eslint-config` | 0.72.x | 0.77.1 | 0.82.1 | 0.84.1 |
| `@react-native/metro-config` | 0.72.x | 0.77.1 | 0.82.1 | 0.84.1 |
| `@react-native/typescript-config` | 0.72.x | 0.77.1 | 0.82.1 | 0.84.1 |

## React 大版本变化注意

### 18.2.0 → 18.3.1（0.72 → 0.77）

- 小版本升级，基本兼容
- 无重大 breaking change

### 18.3.1 → 19.1.1（0.77 → 0.82）

- **大版本升级**，React 19 引入多项不兼容变更
- 需要检查三方库是否声明支持 React 19
- peer dependency 冲突高发
- 常见问题：`findDOMNode` 废弃、`useRef` 需要初始值、字符串 ref 废弃

### 19.1.1 → 19.2.3（0.82 → 0.84）

- 小版本升级，基本兼容
- 无重大 breaking change

## 包名迁移注意

### 0.82 → 0.84：不兼容变更

| 变更项 | 0.82 | 0.84 | 影响文件 |
|--------|------|------|--------|
| Babel preset | `metro-react-native-babel-preset` | `@react-native/babel-preset` | babel.config.js |
| `@types/react-native` | 存在 | **已移除**（RN 0.84 内置） | package.json devDependencies |
| CLI codegen 参数 | 无 `--generate-type` | `--generate-type all`（必选） | package.json codegen-lib 脚本 |

### 库特定情况：旧版库使用本地 tgz 安装 RNOH 框架

⚠️ 这不是 0.82→0.84 的通用变更，而是部分旧版库的历史遗留问题。如果遇到则需要处理，否则可忽略。

部分旧版鸿蒙化库（如 rntpc_picker 0.82 分支）通过本地 tgz 文件安装 RNOH 框架，而非从 npm registry 直装。tgz 内部包名为 `react-native-harmony`，导致 `node_modules` 中目录名为 `react-native-harmony/`。升级时需要改为 npm 直装，并同步修改引用路径。

**判断方法**：检查 `example/package.json` 中 RNOH 依赖是否使用 `file:` 引用 tgz 文件：
```json
// 旧方式（需要迁移）
"react-native-harmony": "file:../packages/rnoh-react-native-harmony-0.77.10.tgz"

// 新方式（无需迁移）
"@react-native-oh/react-native-harmony": "npm:@react-native-oh/react-native-harmony@0.84.2"
```

**如果需要迁移，以下路径都要同步修改**：

| 文件 | 旧写法（本地 tgz） | 新写法（npm 直装） |
|------|----------|----------|
| `example/package.json` 依赖声明 | `"react-native-harmony": "file:../packages/...tgz"` | `"@react-native-oh/react-native-harmony": "npm:...@0.84.2"` |
| `metro.config.js` 导入路径 | `require('react-native-harmony/metro.config')` | `require('@react-native-oh/react-native-harmony/metro.config')` |
| `metro.config.js` 包名参数 | `reactNativeHarmonyPackageName: 'react-native-harmony'` | `reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony'` |
| `oh-package.json5`（根） overrides | `file:./../node_modules/react-native-harmony/harmony/react_native_openharmony.har` | `file:./../node_modules/@react-native-oh/react-native-harmony/react_native_openharmony.har` |
| `oh-package.json5`（entry） dependencies | `file:../../node_modules/react-native-harmony/harmony/react_native_openharmony.har` | `file:../../node_modules/@react-native-oh/react-native-harmony/react_native_openharmony.har` |

**har 路径差异**：旧方式在 `harmony/` 子目录下（`react-native-harmony/harmony/react_native_openharmony.har`），新方式直接在包根目录下（`@react-native-oh/react-native-harmony/react_native_openharmony.har`）。

**背景说明**：RNOH 框架在 npm registry 上始终叫 `@react-native-oh/react-native-harmony`（从 0.72 到 0.84 所有版本均在此包名下发布）。npm 上 `react-native-harmony`（非 scoped）只有一个 `0.0.1` 占位包，不是 RNOH 框架。所谓"包名变更"实质是个别库从本地 tgz 分发切换到 npm registry 分发，不是框架改名。

## CLI 版本变化注意

### 11.x → 15.0.1（0.72 → 0.77）

- CLI 重大重构
- `react-native init` 废弃，改用 `@react-native-community/cli init`

### 15.0.1 → 20.0.0（0.77 → 0.82）

- CLI 主版本升级
- 部分命令参数变更

### 20.0.0 → 20.1.0（0.82 → 0.84）

- 小版本升级，基本兼容

## 鸿蒙化分支命名规则

| RNOH 版本 | 鸿蒙化分支名 | 示例仓库 |
|-----------|-------------|---------|
| 0.72 | `br_rnoh0.72` | gitcode.com/CPF-RN/rntpc_xxx |
| 0.77 | `br_rnoh0.77` | gitcode.com/CPF-RN/rntpc_xxx |
| 0.82 | `br_rnoh0.82` | gitcode.com/CPF-RN/rntpc_xxx |
| 0.84 | `br_rnoh0.84` | gitcode.com/CPF-RN/rntpc_xxx |

## 鸿蒙 Compile SDK 要求

| RNOH 版本 | Compile SDK (API Level) | 说明 |
|-----------|------------------------|------|
| 0.72 | API 12+ | |
| 0.77 | API 12+ | |
| 0.82 | API 12+ | |
| 0.84 | API 12+ | 如果本地未安装 API 12 SDK，可移除 `compileSdkVersion` 字段让 hvigor 自动选择 DevEco 内置 SDK |

## 升级路径建议

### 推荐的渐进升级路径

```
0.72 → 0.77 → 0.82 → 0.84
```

每一步都单独验证编译和功能，不要跳过中间版本。

### 不推荐的跳跃升级

```
0.72 → 0.84  (❌ 跨度太大，问题难以定位)
0.77 → 0.84  (⚠️ 可行但风险较高，需额外注意 React 18→19 变更)
```

## 跨版本不兼容变更参考

详细的上游不兼容变更记录：
- https://gitcode.com/CPF-RN/ohos_react_native/blob/main/docs/zh-cn/05-运维/上游社区不兼容变更.md

RN 版本升级时开发者需自行适配的工作项：
- https://gitcode.com/CPF-RN/ohos_react_native/blob/main/docs/zh-cn/05-运维/RN升级需要开发者适配整理.md
