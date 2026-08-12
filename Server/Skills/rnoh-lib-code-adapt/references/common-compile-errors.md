# 常见编译错误及修复模式

## 错误分类速查

| 错误类型 | 关键词 | 修复优先级 |
|----------|--------|-----------|
| 导入路径错误 | `Cannot find module` | 最高（根因错误，会导致级联） |
| ArkTS 模块解析失败 | `Failed to resolve OhmUrl` | 最高（需注册模块到 build-profile.json5） |
| 类型不匹配 | `Type 'X' is not assignable to type 'Y'` | 高 |
| ArkTS 规则违规 | `arkts-no-*` | 高 |
| 缺少导出 | `has no exported member` | 高 |
| C++ 链接错误 | `undefined reference` | 中 |
| Codegen 产物缺失 | `file not found` (生成的头文件) | 中 |
| ohpm install 缺失 | `not an existing directory` (CMake) | 中（运行 ohpm install 即可） |
| HAR 不在 tgz 中 | `npm pack --dry-run` 无 `.har` 输出 | 中（package.json files 加 harmony/） |
| rnoh-build-har 失败 | HAR 构建报错 | 中（检查 SDK 版本、ohpm 依赖） |
| SDK 版本不匹配 | `SDK component missing` | 中（移除 compileSdkVersion 即可） |
| RNOH 框架内部警告 | `deprecated`、`not supported on all devices` | 低（无需修复，是 WARNING） |
| peer dependency 冲突 | `ERESOLVE` | 低（用 --legacy-peer-deps 绕过） |

---

## 一、导入路径错误

### 症状

```
Cannot find module '../../JsonMapper' or its corresponding type declarations
```

### 原因

嵌套目录中相对路径层级错误。一个 import 路径错误会导致 12+ 下游类型错误。

### 修复

1. 先修复所有 import 路径错误，再处理其他类型错误
2. 使用 `grep_search` 搜索错误模块名，确认实际文件位置
3. 修正相对路径层级

### 验证

修复后重新编译，确认级联错误是否消失。

---

## 二、ArkTS 编译规则错误

### 2.1 对象字面量赋值给 Map

```
arkts-no-untyped-obj-literals
```

**修复**：使用 `new Map()` 或添加类型断言

### 2.2 索引签名

```
arkts-no-indexed-signatures
```

**修复**：移除索引签名，改用 `Map<string, T>` 或命名 interface

### 2.3 循环类型别名

```
arkts-no-circular-type-alias
```

**修复**：用 `object` 替代递归引用

### 2.4 泛型参数推断

```
arkts-no-inferred-generic-params
```

**修复**：显式指定泛型参数 `getMapper<JsonValueType>(...)`

### 2.5 unknown 类型

```
arkts-no-any-unknown
```

**修复**：定义具体类型替代 unknown

### 2.6 any 类型

```
arkts-no-any
```

**修复**：定义显式 class/interface + `as` 类型断言

详见 [references/adapt-checklist.md](adapt-checklist.md) 的 ArkTS 编译规则部分。

---

## 三、类型不匹配

### 症状

```
Type 'string | undefined' is not assignable to type 'string'
```

### 原因

版本升级后接口返回类型变窄/变宽，或可选属性变为必选。

### 修复

1. 检查上游 spec 文件中接口签名的变化
2. 在调用处添加 null/undefined 检查
3. 或使用默认值：`const value = result.field ?? ''`

---

## 四、Codegen 产物相关问题

### 症状

```
fatal error: 'RNOH/RNMyComponentProps.h' file not found
```

### 原因

codegen 未运行，或 codegen 配置路径不正确。

### 修复

```bash
# 1. 确认 codegen 配置
npm run codegen -- --rnoh-module-path ./harmony/entry/oh_modules/@rnoh/react-native-openharmony

# 2. 检查生成的文件是否存在
ls harmony/entry/src/main/cpp/generated/

# 3. 如果不存在，检查 react-native.config.js 中的 codegen 配置
```

### 手写 codegen 产物被覆盖

如果之前手写了部分 codegen 产物：

1. codegen 前备份 `harmony/` 目录
2. codegen 后用 `diff -r backup/ harmony/` 对比
3. 将手写的自定义逻辑合并到新生成的代码中

---

## 五、C++ 链接错误

### 症状

```
undefined reference to `MyNewComponent::setProps(...)`
```

### 原因

新增了 C++ 源文件但未在 `CMakeLists.txt` 中注册。

### 修复

```cmake
# 在 CMakeLists.txt 中添加新源文件
target_sources(rnoh_my_lib PRIVATE
    src/main/cpp/MyNewComponent.cpp
    src/main/cpp/MyNewComponentInstance.cpp
)

# 如果新增了依赖库
target_link_libraries(rnoh_my_lib
    # ... 已有依赖
    my_new_dependency
)
```

---

## 六、peer dependency 冲突

### 症状

```
npm ERR! ERESOLVE unable to resolve dependency tree
npm ERR! peer react@>=18.0.0 from react-native@0.84.1
```

### 原因

三方库声明的 peer dependency 与目标 RN/React 版本不兼容。

### 修复

```bash
# 方案1: 使用 --legacy-peer-deps (推荐)
npm install --legacy-peer-deps

# 方案2: 使用 --force
npm install --force

# 方案3: 在 package.json 中覆盖 peerDependencies
{
  "overrides": {
    "react-native-some-lib": {
      "react": "$react"
    }
  }
}
```

---

## 七、React 19 升级特有错误

### 7.1 findDOMNode 废弃

```
Warning: findDOMNode is deprecated in StrictMode.
```

**修复**：改用 `useRef` + `ref.current`。

### 7.2 字符串 ref 废弃

```jsx
// 错误: <div ref="myRef" />
// 修复: <div ref={myRef} />
```

### 7.3 useRef 需要初始值

```typescript
// React 18: const ref = useRef()
// React 19: const ref = useRef(null)
```

---

## 八、ohpm install 缺失导致 CMake 找不到目录

### 症状

```
CMake Error at CMakeLists.txt:24 (add_subdirectory):
  add_subdirectory given source
  ".../oh_modules/@rnoh/react-native-openharmony/src/main/cpp"
  which is not an existing directory.
```

### 原因

`npm install` 只安装了 JS 依赖到 `node_modules/`，但鸿蒙原生依赖（har 包）需要通过 `ohpm install` 安装到 `oh_modules/`。CMake 编译时从 `oh_modules/` 读取 RNOH 框架的 C++ 源码。

### 修复

```bash
cd example/harmony && ohpm install
```

验证安装成功：
```bash
ls entry/oh_modules/@rnoh/react-native-openharmony/src/main/cpp/
# 应看到 CMakeLists.txt、RNOH/、RNOHAppNapiBridge.cpp 等
```

---

## 九、compileSdkVersion 与本地 SDK 不匹配

### 症状

```
hvigor ERROR: 00303168 Configuration Error
Error Message: SDK component missing.
```

### 原因

`build-profile.json5` 中的 `compileSdkVersion`（如 `5.0.1(17)`）对应的 SDK 未在本地安装。DevEco Studio 内置 SDK 版本可能与目标版本不一致。

### 修复

```json5
// 方案1（推荐）：移除 compileSdkVersion，让 hvigor 自动选择
{
  "app": {
    "products": [{
      "name": 'default',
      "signingConfig": 'default',
      // 删除此行: "compileSdkVersion": '5.0.1(17)',
      "compatibleSdkVersion": '5.0.0(12)',
      "runtimeOS": 'HarmonyOS'
    }]
  }
}

// 方案2：改为本地已安装的 SDK 版本
// 通过 DevEco Studio > SDK Manager 查看已安装版本
```

**注意**：`build-profile.json5` 和 `build-profile.template.json5` 都需要同步修改。

---

## 十、RNOH 框架内部编译警告

### 症状

编译输出大量来自 `@rnoh/react-native-openharmony` 的警告：

```
WARN: ArkTS:WARN 'vp2px' has been deprecated.
WARN: ArkTS:WARN The 'on' API is supported since SDK version 15.
WARN: ArkTS:WARN The system capacity of this api 'reason' is not supported on all devices
```

### 原因

RNOH 框架内部代码使用了部分 deprecated API 或高版本 API。这是**框架自身的兼容性问题，不影响编译结果**。

### 修复

**无需修复**。这些是 WARNING 而非 ERROR，编译仍会 `BUILD SUCCESSFUL`。只需关注自己库的代码（`harmony/<lib>/src/` 下）是否有错误。

---

## 编译验证流程

### 完整验证步骤（HAR → TGZ → 依赖 tgz 编译）

```bash
# ── 前提：代码适配已完成 ──

# 1. 单文件语法检查
devecocli check lint harmony/src/main/ets/
devecocli check lint harmony/src/main/cpp/

# 2. 打 HAR 包（使用 rnoh-build-har 工具）
cd /path/to/react-native-xxx
rnoh-build-har 17 0.84.2 .
# 产出: harmony/xxx.har

# 3. 打 TGZ 包
npm pack
# 产出: react-native-ohos-react-native-xxx-<version>.tgz

# 4. RN 工程依赖本地 tgz 包
cd example
# 编辑 package.json: "file:../react-native-ohos-react-native-xxx-<version>.tgz"
rm -rf node_modules/@react-native-ohos/react-native-xxx
npm install --legacy-peer-deps

# 5. Codegen + JS Bundle
npm run codegen
npm run dev

# 6. 安装鸿蒙原生依赖（关键！不可跳过）
cd harmony && ohpm install

# 7. 原生构建（依赖 tgz 包）
devecocli build --product default --build-mode debug
```

> ⚠️ **最终验证必须依赖 tgz 包**，不能依赖源码 `file:` 目录引用。详见 [har-tgz-build.md](har-tgz-build.md)。

### 渐进式验证

如果一次性修复太多错误难以定位，可以分步验证：

1. `devecocli check lint` 通过 — 确认无语法错误
2. `rnoh-build-har` 通过 — 确认 HAR 包构建成功
3. `npm pack --dry-run` 通过 — 确认 tgz 包含 HAR 文件
4. `npm install` 通过 — 确认 tgz 包正确安装
5. `npm run codegen` 通过 — 确认 codegen 产物正确
6. `npm run dev` 通过 — 确认 JS Bundle 构建成功
7. `ohpm install` 通过 — 确认 har 包安装到 oh_modules
8. `devecocli build` 通过 — 确认原生编译成功

---

## 十一、源码 `file:` 依赖的 ArkTS 模块解析失败

### 症状（两阶段错误）

**编译期错误**：
```
ERROR: Failed to resolve OhmUrl. 
Failed to get a resolved OhmUrl for "xxx/index.ets" 
imported by "xxx/RNPackagesFactory.ets"

ERROR: Cannot import files outside of the current module 
using relative paths. Import statement: './ts'
```

**运行时错误**（编译通过但运行时崩溃）：
```
ReferenceError: cannot find record 'com.harmony.wechat.lib.demo/entry@harmony/ets/NetInfoPackage'
```

### 原因

鸿蒙化三方库通过 `file:` 源码依赖引入 example 工程时，ohpm 在 `entry/oh_modules/@react-native-ohos/xxx` 创建**符号链接**指向源码目录。hvigor/devecocli 无法将符号链接路径作为模块 `srcPath` 识别，导致 ArkTS 模块未注册。

同时，`RNPackagesFactory.ets` 如果使用深层路径导入（如 `@react-native-ohos/xxx/src/main/ets/XxxPackage`），ArkTS 运行时模块解析器找不到对应的 record。

### 修复（三步配合）

**① 在 `build-profile.json5` 中注册库为独立模块**：

```json5
// example/harmony/build-profile.json5
modules: [
  {
    name: 'xxx',
    srcPath: '../../harmony/xxx',  // 直接指向源码目录，不用符号链接
    targets: [{ name: 'default', applyToProducts: ['default'] }],
  },
  {
    name: 'entry',
    srcPath: './entry',
    targets: [{ name: 'default', applyToProducts: ['default'] }],
  },
]
```

> **路径计算**：从 `example/harmony/` 出发到 `harmony/xxx` = `../../harmony/xxx`。
> 库自身需有 `build-profile.json5`（stageMode + target default）+ `hvigorfile.ts`（harTasks）。

**② `RNPackagesFactory.ets` 使用包根路径导入**：

```typescript
// ❌ 深层路径 — 运行时找不到 record
import { XxxPackage } from '@react-native-ohos/xxx/src/main/ets/XxxPackage';
// ✅ 包根路径 — 通过 oh-package.json5 的 main: index.ets 入口解析
import { XxxPackage } from '@react-native-ohos/xxx';
```

**③ 保持库的 `index.ets` + `ts.ets` 原始结构**：

不要尝试以下错误操作：
- ❌ 将 `ts.ets` 改名为 `ts.ts` — TS 文件不能导入 ArkTS(.ets) 文件（`Importing ArkTS files in JS and TS files is forbidden`）
- ❌ 删除 `ts.ets` 并在 `index.ets` 中直接 export — 会导致 `Failed to resolve OhmUrl for index.ets`
- ❌ 在 `build-profile.json5` 中用符号链接路径 `./entry/oh_modules/@react-native-ohos/xxx` 作为 srcPath — hvigor 报 `Path not found`

---

## 十二、HAR / TGZ 打包相关错误

### 12.1 rnoh-build-har 构建失败

#### SDK 版本不匹配

```
hvigor ERROR: SDK component missing.
```

**修复**：通过 `api-version` 参数指定正确的 API 版本，或移除库 `build-profile.json5` 中的 `compileSdkVersion`：
```bash
# 指定 API 版本
rnoh-build-har 17 0.84.2 .

# 或移除 compileSdkVersion 后重新构建
rnoh-build-har .
```

#### ohpm 依赖未安装

```
CMake Error: not an existing directory
.../oh_modules/@rnoh/react-native-openharmony/src/main/cpp
```

**修复**：使用 `rnoh-version` 参数让工具自动从 ohpm 拉取 RNOH，或确保本地 `node_modules` 中有 RNOH HAR：
```bash
# 方式1：指定 RNOH ohpm 版本
rnoh-build-har 0.84.2 .

# 方式2：先 npm install 再构建
npm install --legacy-peer-deps
rnoh-build-har .
```

### 12.2 TGZ 包不含 HAR 文件

#### 症状

```bash
$ npm pack --dry-run | grep '\.har'
# 无输出 — HAR 文件未包含在 tgz 中
```

#### 原因

`package.json` 的 `files` 字段未包含 `harmony/` 目录。

#### 修复

```json
{
  "files": [
    "src",
    "harmony",
    "README.md"
  ]
}
```

### 12.3 tgz 依赖安装后找不到 HAR

#### 症状

example 工程编译时找不到库的 HAR 文件：
```
ohpm ERROR: File not found: .../node_modules/@react-native-ohos/xxx/harmony/xxx.har
```

#### 原因

tgz 包中确实不含 HAR（见 12.2），或 oh-package.json5 中 HAR 引用路径错误。

#### 修复

1. 确认 tgz 包含 HAR：`npm pack --dry-run | grep '\.har'`
2. 确认 `oh-package.json5` 中引用路径正确：
   ```json5
   // 从 tgz 安装后，HAR 在 node_modules/@react-native-ohos/xxx/harmony/xxx.har
   "@react-native-ohos/xxx": "file:./xxx.har"
   ```
3. 重新打 tgz 包并安装

### 12.4 源码 file: 依赖迁移到 tgz 依赖后路径变更

#### 症状

从源码 `file:../rntpc_xxx` 改为 tgz `file:../xxx.tgz` 后，oh-package.json5 中的 HAR 路径失效。

#### 原因

源码依赖时 HAR 在 `../rntpc_xxx/harmony/xxx.har`，tgz 依赖后 HAR 在 `node_modules/@react-native-ohos/xxx/harmony/xxx.har`。

#### 修复

更新 `oh-package.json5` 中的 HAR 引用路径：
```json5
// 旧（源码依赖）
"@react-native-ohos/xxx": "file:../../rntpc_xxx/harmony/xxx.har"

// 新（tgz 依赖）
"@react-native-ohos/xxx": "file:../../node_modules/@react-native-ohos/xxx/harmony/xxx.har"
```
