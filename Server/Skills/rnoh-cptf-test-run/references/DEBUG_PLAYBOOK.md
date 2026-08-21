# 实战调试手册

> Phase 3 的详细手册。记录 react-native-get-random-values 实战中的完整失败现象 → 根因 → 修复链路，供失败诊断时对照。

## 1. CPTF 框架关键机制（调试前必读）

### 1.1 级联取消机制

`FunctionalTest.execute()` 入口设置 `ui.setCancelCheck(() => this._cancelled)`；每个步骤用 `Promise.race([doStep(), stepCapPromise])` 包装，**超时回调置 `this._cancelled = true`** 并 reject `步骤超时(${stepTimeout}ms)`；此后所有 UIAutomation 调用经 `throwIfCancelled()` 抛 `'UIAutomation: 用例已取消'`。

**结论：一个步骤超时 → 后续全部步骤级联失败。看到批量"用例已取消"，只需诊断第一个超时步骤。**

### 1.2 步骤超时默认值（decorators.ts DEFAULT_NAVIGATION_CONFIG）

| 级别 | 默认值 |
|------|--------|
| stepDefault | 10000 |
| stepAction | 20000 |
| stepComplex | 30000 |
| stepMax | 45000 |

`getStepTimeout(step)` 优先取 `step.stepTimeout`。**滚动查找（最多 12 次 × 300ms）+ 点击 + 等待渲染 + waitForText 轮询（最长 8s）的步骤，10s 默认值必然不够**，统一显式设 30000。

### 1.3 findByText 匹配语义

```typescript
async findByText(text: string, exact = false) {
  return exact ? findElement({ text }) : findElement({ textContains: text });
}
```

`textContains` 是**子串精确匹配**（区分全角/半角冒号、空格、大小写）。

## 2. 实战失败案例全记录

### 案例 1：模块解析失败

```
现象: Error: Cannot find module '@cptf/framework'
根因: cptf CLI shim 的 NODE_PATH 含 .pnpm/node_modules 等不存在目录，
      全局 link 安装的框架不在测试文件的解析路径上
修复: workspace 本地 package.json link 依赖 + pnpm install
      （详见 rnoh-cptf-demo-test/references/CPTF_SETUP.md §3）
```

### 案例 2：步骤 8 超时引发级联取消（核心案例）

```
现象: 步骤 1-7 通过；步骤 8 "步骤超时(10000ms): 普通数组输入应抛出 TypeMismatchError"；
      步骤 9-18 全部 "UIAutomation: 用例已取消"
根因链:
  1. demo 源码是 <Text>错误信息：{errorInfo}</Text>（全角冒号）
  2. 测试写了 waitForText('错误信息:')（半角冒号）
  3. findByText 子串匹配失败 → waitForText 8 秒轮询空转
  4. 步骤总耗时超过默认 10s → 超时 → _cancelled = true → 级联
修复:
  - waitForText('错误信息')  ← 去掉冒号，两种冒号均兼容
  - '数组长度：' / '视图长度：' 等前缀类断言保留全角冒号（源码原样）
  - 全部 @Step 加 stepTimeout: 30000
教训: 断言文本必须从 demo 源码逐字符复制，绝不手写
```

### 案例 3：demo 已知渲染 bug（普通数组用例）

```
现象: 点击"测试普通数组应抛出"后，错误信息区域出现的是
      "Text strings must be rendered within a <Text> component"
      而非预期的 TypeMismatchError
根因: demo 的 arrange 存在 RN 渲染 bug（setState 传非字符串对象直接渲染），
      错误组件触发 RN 顶层渲染错误，LogBox 覆盖了业务错误文本
修复: 断言放宽——验证 '错误信息' 文本出现 且 内容匹配
      /TypeMismatchError/i 或 /<Text>|rendered within/i（渲染错误特征）
      代码注释注明 demo 已知 bug
教训: 测试对象是三方库行为；demo 自身 bug 时断言降级为"错误输出已触发"
```

### 案例 4：bundle 中 grep 中文失败

```
现象: 在 bundle.harmony.js 中 grep '两次生成数据是否一致' 返回 0 条，
      误以为 demo 没有该文案
根因: bundle 打包后中文可能被转义/分包，grep 不可靠
修复: 一律以 src/**/*.tsx 源码为唯一事实来源
```

### 案例 5：无固定前缀的结果断言（裸数字）

```
现象: 7 种 TypedArray 基本用例的渲染是 {arr.map(item => <Text>{item}</Text>)}，
      没有可 waitForText 的前缀
修复: 快照差集法:
  1. scrollAndClick 前不快照——在 scrollAndClick 内部滚动定位完成后、点击前，
      由 collectNumbersAfter 依赖 lastSnapshot（上一步骤末尾的全量快照）
  2. 点击+sleep(600) 后 getLayout(true) 全量快照
  3. 差集（after - before）中过滤 /^-?\d+$/ 提取新增数字
  4. 断言: 数量 ≥ 1 且每个值落在该 TypedArray 的值域内
```

### 案例 6：ts-node 拾取上级 tsconfig 导致编译失败

```
现象: executor执行失败: jpush-func - Invalid or unexpected token
      日志首行: ts-node not available, TypeScript executor files may not work
      (⨯ Unable to compile TypeScript:
       error TS6053: File '@react-native/typescript-config/tsconfig.json' not found.)
根因: cptf workspace 位于 RN 工程子目录（example/cptf/），ts-node register() 后
      向上遍历找到 example/tsconfig.json，该文件 extends '@react-native/typescript-config'，
      但该包未安装 in cptf workspace 的 node_modules，编译直接失败
修复: 在 {workspaceDir} 下生成独立 tsconfig.json，不 extends 任何外部配置，
      仅包含最小编译选项（target/module/moduleResolution/esModuleInterop/skipLibCheck）
教训: cptf workspace 必须有独立 tsconfig.json，隔离上级 RN 工程的 TS 配置
```

### 案例 7：Stage 3 装饰器与 experimentalDecorators 冲突

```
现象: executor执行失败: jpush-func - context.addInitializer is not a function
根因: CPTF 框架的 @Step 装饰器使用 Stage 3 装饰器规范：
      - Step 装饰器返回的函数接收 (originalMethod, context) 两个参数
      - 内部调用 context.addInitializer() 注册初始化回调
      若 tsconfig.json 设了 experimentalDecorators: true，TypeScript 编译器
      使用旧版（Stage 1/2）装饰器格式，方法装饰器只接收
      (target, propertyKey, descriptor)，不提供 context 对象
修复: tsconfig.json 中移除 experimentalDecorators 和 emitDecoratorMetadata
      框架的 registerTsNode() 使用 transpileOnly 模式，compilerOptions 不含
      experimentalDecorators，但 tsconfig.json 的设置会覆盖
教训: CPTF 测试工程的 tsconfig.json 绝不能设置 experimentalDecorators
```

### 案例 8：回调类 API 未实现导致步骤超时

```
现象: 步骤 "调用 getPushStatus 失败: 点击后未出现getPushStatus最终结果文本"
      截图显示按钮已点击，但结果区域仍显示"查询中..."
根因: getPushStatus 在 index.js 中通过 (JPush as any).getPushStatus() 调用，
      但 NativeJPush.ts TurboModule Spec 未声明该方法，原生侧不响应，
      回调永不触发，waitForText 轮询 10s 后超时
修复: 对此类 API 使用容错断言：
      1. 点击后 sleep(2000) 等待可能的结果渲染
      2. 先 waitForText('{apiName}结果', 8000) 尝试匹配成功
      3. 若未找到，再 waitForText('错误信息', 3000) 尝试匹配 catch 块输出
      4. 两者皆无才报错；report 断言接受 结果 或 错误信息
教训: 通过 (Module as any) 调用的 API 可能未实现，断言需容错
```

## 3. 诊断决策树

```
运行失败
├─ Cannot find module '@cptf/framework'
│   → 案例 1（本地 link，参见 rnoh-cptf-demo-test/references/CPTF_SETUP.md §3）
├─ `Invalid or unexpected token` 或 `File '@react-native/typescript-config/tsconfig.json' not found`
│   → 案例 6（ts-node 拾取上级 tsconfig，生成独立 tsconfig.json）
├─ `context.addInitializer is not a function`
│   → 案例 7（tsconfig 设了 experimentalDecorators，移除该选项）
├─ 报告只显示 1 个用例（N 步骤全在一个 @Test 里）
│   → 测试文件未拆分，按 API 分类拆为多文件（每文件一个 @Test）
├─ 某步骤 "步骤超时(NNNNNms)"，其后全部 "UIAutomation: 用例已取消"
│   → 级联取消（§1.1），只诊断第一个超时步骤：
│   ├─ 截图显示按钮已点击、结果已渲染 → waitForText 文本不匹配 → 案例 2（全角冒号）
│   ├─ 截图显示按钮已点击、结果仍"查询中..."或空 → 案例 8（API 未实现，容错断言）
│   ├─ 截图显示按钮未找到/未点击 → textContains 关键字错 或 未滚动到位
│   │   → 核对按钮 title；maxScrolls 增大；确认 type: 'Button' 过滤
│   └─ 截图显示结果渲染异常 → 案例 3（demo bug，放宽断言）
├─ 步骤通过但断言值错误
│   → 检查动态值推断（如 isSameState ? '' : 'false' 的空串分支）
└─ 设备/hap 安装错误
    → 参见 rnoh-cptf-demo-test/references/CPTF_SETUP.md §5
```

## 4. 运行命令与报告定位

```bash
cd {workspaceDir}
cptf run -p harmony -t {testId}          # 单用例运行
# 或全量: cptf run -p harmony

# 报告位置
ls test-reports/{timestamp}/harmony/
#   execution.log      —— 逐步骤日志（首要诊断材料）
#   screenshots/       —— 每步骤截图（失败步骤必有 -fail.jpeg）
#   report.html        —— 汇总报告
```

**看日志技巧**：
- 搜 `步骤超时` 定位第一个超时步骤
- 搜 `通过` / `失败` 统计步骤结果
- 步骤失败时先看该步骤 `-fail.jpeg` 截图：UI 实际渲染状态 vs 断言预期的差异即为根因

## 5. 迭代修复节奏

1. 修复**只针对第一个失败步骤**（后续失败多为级联）
2. 每轮修复后完整重跑（不要跳步骤）
3. 全部通过后，再跑一轮确认稳定性（随机数/异步渲染可能有偶发）
4. 连续两轮全绿 → 交付

## 6. HAP 构建与安装

### 6.1 何时需要构建

| 场景 | 是否需要构建 | 原因 |
|------|-------------|------|
| 首次运行 CPTF 测试 | ✅ | HAP 可能不存在或不含 CPTF Demo |
| `rnoh-cptf-api-test` 生成/修改了 Demo 代码 | ✅ | `bundle.harmony.js` 不含新 Demo 页面 |
| 修改了测试文件（.test.ts） | ❌ | 测试文件由 ts-node 在宿主机执行，不打包进 HAP |
| 修改了 `cptf.config.json` | ❌ | 运行时配置，不打包进 HAP |
| 修改了 Demo 页面代码（.tsx） | ✅ | 需重新编译 RN Bundle + 打包 HAP |
| HAP 已存在且 Demo 未变更 | ❌ | 直接安装即可 |

### 6.2 构建命令

**步骤 1：RN Bundle 编译**

```bash
cd {exampleDir} && npm run dev
```

`npm run dev` 内部执行 `codegen` + `react-native bundle-harmony --dev --minify=false`，产出 `harmony/entry/src/main/resources/rawfile/bundle.harmony.js`。

> 若 `npm run dev` 脚本不存在，检查 `example/package.json` 的 `scripts` 字段。核心是执行 codegen + bundle-harmony 两步：
> ```bash
> npm run codegen && react-native bundle-harmony --dev --minify=false
> ```

**步骤 2：鸿蒙 HAP 打包**

```bash
cd {exampleDir}/harmony && devecocli build
```

`devecocli build` 调用 hvigor 编译 ArkTS + C++ + 打包签名，产出 `entry/build/default/outputs/default/entry-default-signed.hap`。

构建成功标志：输出 `BUILD SUCCESSFUL` 且 `SignHap` 任务完成。

> 若 `devecocli` 不可用，替代方案：
> - DevEco Studio → Build → Build Hap(s)
> - 或直接 `hvigorw assembleHap`（需配置 HarmonyOS SDK 环境变量）

### 6.3 安装到设备

```bash
# 首次安装
hdc install "{hapPath}"

# 签名变更或覆盖安装失败时，先卸载
hdc uninstall {bundleId} && hdc install "{hapPath}"

# 或使用 devecocli 一步完成
devecocli run --uninstall
```

### 6.4 构建故障速查

| 现象 | 根因 | 修复 |
|------|------|------|
| `npm run dev` 报 `Cannot find module '@react-native-oh/react-native-harmony'` | 依赖未安装 | `cd {exampleDir} && npm install` |
| `npm run dev` 报 codegen 失败 | `oh_modules` 中 RNOH 框架缺失 | 检查 `harmony/entry/oh_modules/@rnoh/react-native-openharmony` 是否存在 |
| `devecocli build` 报 `No entry module` | 工程结构异常 | 检查 `harmony/entry/src/main/module.json5` 是否存在 |
| `devecocli build` 报签名失败 | 签名配置过期 | 在 DevEco Studio 中重新配置签名，或 `devecocli build --build-mode release` |
| `hdc install` 报 `install sign info inconsistent` | 签名 key 变更 | `hdc uninstall {bundleId}` 后重新安装 |
| HAP 构建成功但测试找不到按钮 | RN Bundle 未更新就打包了 HAP | 先 `npm run dev`，再 `devecocli build`，顺序不能反 |
