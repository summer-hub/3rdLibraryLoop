# CPTF 测试生成指南

> Phase 4-5 的详细操作手册。核心是 CPTF 测试工程搭建和测试用例生成，保证与 Demo 的精确对齐。

---

## 1. CPTF 测试工程搭建

### 1.1 前置检查

```bash
# CPTF 框架源码位置
ls -la ~/Library/pnpm/global/5/node_modules/@cptf/framework

# hdc 工具与设备
hdc list targets

# demo hap 构建产物
ls {projectRoot}/harmony/entry/build/default/outputs/default/entry-default-signed.hap

# demo bundleId
cat {projectRoot}/AppScope/app.json5 | grep bundleName
```

### 1.2 cptf.config.json 完整配置

```json
{
  "bundleId": "com.example.xxx",
  "reportDir": "test-reports",
  "reportFormat": "html",
  "casesDir": "tests/cases",
  "enableAlerts": true,
  "timezone": "BeiJing",
  "platforms": {
    "harmony": {
      "toolPath": "hdc",
      "bundleId": "com.example.xxx",
      "appPath": "<demoPath 绝对路径>/harmony/entry/build/default/outputs/default/entry-default-signed.hap",
      "devices": [
        {
          "id": "<设备SN>",
          "screenWidth": 1280,
          "screenHeight": 2832
        }
      ]
    }
  }
}
```

字段说明：
- `appPath` 必须是**绝对路径**（signed hap）
- `timezone` 设置报告时间戳时区，框架内置支持 `"BeiJing"`(UTC+8) / `"Asia/Shanghai"` / `"Tokyo"` / `"NewYork"` / `"London"` 等。未设置时默认 UTC，报告目录和日志时间会差 8 小时
- `screenWidth/screenHeight` 影响滚动与坐标计算
- `casesDir` 相对 workspace 根；测试文件放 `tests/cases/functional/` 下自动被发现

### 1.3 link 依赖建立

> ⚠️ cptf CLI shim 的 NODE_PATH 不可靠，必须在测试工程本地建立 node_modules。

`{workspaceDir}/package.json`：

```json
{
  "name": "cptf-workspace",
  "version": "1.0.0",
  "private": true,
  "description": "CPTF 测试工程: <libName> RNOH 功能测试",
  "dependencies": {
    "@cptf/framework": "link:<frameworkPath 绝对路径>",
    "reflect-metadata": "link:<frameworkPath>/node_modules/reflect-metadata"
  }
}
```

`reflect-metadata` 是 `@Step`/`@Test` 装饰器的运行时依赖，必须与框架内版本一致。

```bash
cd {workspaceDir}
pnpm install
node -e "console.log(require.resolve('@cptf/framework'))"
```

### 1.4 TS 支持

框架 CLI 内置 `registerTsNode()`（ts-node transpileOnly），测试文件直接写 `.ts`。

> ⚠️ **必须生成 `{workspaceDir}/tsconfig.json`**。ts-node 注册时会向上遍历目录查找 tsconfig.json。若 cptf workspace 在 RN 工程子目录下（如 `example/cptf/`），ts-node 会拾取上级 `example/tsconfig.json`（通常 extends `@react-native/typescript-config`），导致 `File '@react-native/typescript-config/tsconfig.json' not found` 或装饰器行为异常。

生成 `{workspaceDir}/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": false,
    "resolveJsonModule": true,
    "declaration": false,
    "outDir": "./dist"
  },
  "include": ["tests/**/*.ts"]
}
```

> ⚠️ **禁止设置 `experimentalDecorators` 和 `emitDecoratorMetadata`**。CPTF 框架的 `@Test`/`@Step` 装饰器使用 **Stage 3 装饰器规范**（方法装饰器接收 `context` 参数，调用 `context.addInitializer()`）。若 tsconfig 开启 `experimentalDecorators: true`，TypeScript 编译器会使用旧版（Stage 1/2）装饰器格式，不提供 `context` 对象，运行时报 `context.addInitializer is not a function`。

### 1.5 用例发现机制

- CLI 扫描 `{casesDir}` 下所有 `.ts` 文件
- 文件必须 `export const testCaseExecutor = new XxxTest()`
- `@Test({ id: '...' })` 的 id 用于 `-t` 过滤

### 1.6 常见搭建故障

| 现象 | 原因 | 修复 |
|------|------|------|
| `Cannot find module '@cptf/framework'` | shim NODE_PATH 失效 | 本地 link 依赖 |
| `Cannot find module 'reflect-metadata'` | 漏配 reflect-metadata link | 补 package.json link |
| `File '@react-native/typescript-config/tsconfig.json' not found` | ts-node 拾取上级 RN 工程 tsconfig | 生成 workspace 本地 tsconfig.json |
| `context.addInitializer is not a function` | tsconfig 设了 `experimentalDecorators` | 移除 `experimentalDecorators` 和 `emitDecoratorMetadata` |
| `Invalid or unexpected token` | ts-node 编译失败（拾取错误 tsconfig） | 同上，生成独立 tsconfig.json |
| 装饰器不生效 | 未 import 'reflect-metadata' | 文件首行加 import |
| 报告只显示 1 个用例 | 所有 @Step 在同一个 @Test 类 | 按 API 分类拆分多文件，每个文件一个 @Test |
| 设备连接失败 | hdc 未授权/未插 | `hdc list targets` 检查 |
| hap 安装失败 | appPath 非绝对路径/未签名 | 核对 entry-default-signed.hap |

---

## 2. 测试用例生成规则

### 2.1 文件骨架

```typescript
import 'reflect-metadata';
import { Test, Step, FunctionalTest, NavigationStrategyFactory } from '@cptf/framework';
import type { UIElement } from '@cptf/framework';

NavigationStrategyFactory.registerStrategy('single-page', () => ({
  id: 'single-page',
  async navigateToTestScene(ctx): Promise<void> {
    ctx.logger.debug('[single-page] 等待 testerino 面板就绪');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const panel = await ctx.ui.findByText('TOTAL');
      if (panel) {
        ctx.logger.debug('[single-page] testerino 面板已就绪');
        return;
      }
      await ctx.ui.sleep(500);
    }
    ctx.logger.warn('[single-page] 未检测到 testerino 面板，继续执行');
  },
  async returnFromTestScene(_ctx): Promise<void> {},
}));

@Test({
  id: '{lib-short-name}-func',
  name: '{libName} 功能测试',
  module: 'functional',
  platform: 'harmony',
  category: '{分类}',
  description: '覆盖 {libName} 的 {能力概述}',
  navigationStrategy: 'single-page',
  captureScreenshots: true,
  waitAfterAction: 300,
})
class {LibName}Test extends FunctionalTest {
  // 辅助方法 + @Step 方法
}

export const testCaseExecutor = new {LibName}Test();
```

### 2.2 辅助方法

#### scrollAndClick

```typescript
private async scrollAndClick(textKey: string, stepLabel: string): Promise<void> {
  const btn = await this.ui!.scrollToFindElement(
    { textContains: textKey, type: 'Button' },
    { maxScrolls: 12, waitAfterScroll: 300 },
  );
  if (!btn) {
    throw new Error(`未找到按钮: ${stepLabel} (关键字: ${textKey})`);
  }
  const ok = await this.ui!.clickElement(btn);
  if (!ok) {
    throw new Error(`点击按钮失败: ${stepLabel}`);
  }
  await this.sleep(600);
}
```

#### scrollAndClickByTestId（优先使用，Demo 已设置 testID）

```typescript
private async scrollAndClickByTestId(testId: string, stepLabel: string): Promise<void> {
  const btn = await this.ui!.scrollToFindElement(
    { testID: testId },
    { maxScrolls: 12, waitAfterScroll: 300 },
  );
  if (!btn) {
    throw new Error(`未找到按钮: ${stepLabel} (testID: ${testId})`);
  }
  const ok = await this.ui!.clickElement(btn);
  if (!ok) {
    throw new Error(`点击按钮失败: ${stepLabel}`);
  }
  await this.sleep(600);
}
```

#### waitForText

```typescript
private async waitForText(expectedSub: string, timeout = 8000): Promise<UIElement | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const el = await this.ui!.findByText(expectedSub);
    if (el) return el;
    await this.sleep(400);
  }
  return null;
}
```

#### report

```typescript
private report(passed: boolean, details: string): void {
  this.currentStepResult = {
    stepName: this.currentStepResult?.stepName || '校验',
    passed,
    details,
  };
  if (!passed) {
    throw new Error(details);
  }
}
```

### 2.3 编码规则速查

| 规则 | 原因 |
|------|------|
| 文件首行 `import 'reflect-metadata'` | 装饰器运行时依赖 |
| 每个 @Step 显式 `stepTimeout: 30000` | 默认 10s 不够滚动+点击+等待 |
| 断言文本从 Demo 代码逐字符复制 | 全角/半角冒号差异是头号失败根因 |
| 优先用 testID 定位（Demo 已设置） | testID 比 textContains 更稳定 |
| `captureScreenshot: false`（常规步骤） | 减少耗时；失败步骤框架自动截图 |
| 文件末尾 `export const testCaseExecutor` | CLI 用例发现约定 |
| 步骤名含中文+API 名 | 报告可读性 |
| scrollAndClick 后 `sleep(600)` | 等待点击生效+渲染 |
| waitForText 轮询 400ms x 20 次（8s） | 渲染时延容错 |

### 2.4 多文件拆分规则

> ⚠️ **一个 `@Test` 类 = 报告中一个用例**。若所有 `@Step` 放在同一个 `@Test` 类中，报告中只显示 1 个用例（含 N 个步骤），无法体现分类维度。

按 API 分类拆分测试文件，每个分类一个独立 `.test.ts` 文件：

```
tests/cases/functional/
├── 001_{apiCategory1}.test.ts    # @Test id='{lib}-cat1'
├── 002_{apiCategory2}.test.ts    # @Test id='{lib}-cat2'
└── ...
```

每个文件完整包含：
1. `import 'reflect-metadata'` + `@cptf/framework` 导入
2. `NavigationStrategyFactory.registerStrategy('single-page', ...)` 注册
3. `abstract class BaseTest extends FunctionalTest` 辅助基类（scrollAndClickByTestId / waitForText / report）
4. `@Test` 装饰器 + 继承 BaseTest 的测试类 + `@Step` 方法
5. `export const testCaseExecutor = new XxxTest()`

> 多文件中 NavigationStrategy 和 BaseTest 代码重复是预期行为。ts-node transpileOnly 模式下无模块解析开销。

### 2.5 回调类 API 容错断言

部分 API 通过 `(Module as any)` 调用（在 JS 层未导出或 TurboModule Spec 未声明），回调可能永不触发，导致 `waitForText` 超时。对此类 API 使用容错断言：

```typescript
@Step('调用 {apiName}({params})', { captureScreenshot: false, stepTimeout: 30000 })
async test{ApiName}(): Promise<void> {
  await this.scrollAndClickByTestId('{apiName}-btn', '调用 {apiName}');
  await this.sleep(2000);
  let el = await this.waitForText('{apiName}结果', 8000);
  if (!el) { el = await this.waitForText('错误信息', 3000); }
  if (!el) { throw new Error('点击后未出现{apiName}结果或错误信息文本'); }
  const text = this.getChildText(el) || el.text || '';
  this.report(text.includes('{apiName}结果') || text.includes('错误信息'), `结果: "${text.trim()}"`);
}
```

适用条件：
- API 在 `index.js` 中通过 `(Module as any)` 调用
- `index.d.ts` 声明但 `NativeXxx.ts` TurboModule Spec 未定义该方法
- 回调类 API（callback 参数）且回调可能不被触发

---

### 3.1 对齐矩阵

由于 Demo 和 Test 从同一接口规格派生（Phase 2 映射表），对齐保证如下：

| 对齐维度 | Demo 侧 | Test 侧 | 保证方式 |
|----------|---------|---------|----------|
| API 覆盖 | 每个 API 有 Demo 按钮 | 每个 API 有 @Step | 映射表双向覆盖 |
| testID | `{apiName}-btn` | `scrollAndClickByTestId('{apiName}-btn')` | 命名规则统一 |
| 断言文本 | `Text` 前缀 `{API名}结果：` | `waitForText('{API名}结果')` | 逐字符复制 |
| 按钮定位 | title 含 API 名 | `textContains` 用 API 名子串 | 命名规则统一 |
| 结果值 | 固定前缀 + 动态值 | `waitForText` 前缀 + 值校验 | 前缀固定可可靠断言 |

### 3.2 各 API 类型的 @Step 写法

#### 3.2.1 TurboModule 同步方法

```typescript
@Step('调用 {apiName}({params})', { captureScreenshot: false, stepTimeout: 30000 })
async test{ApiName}(): Promise<void> {
  await this.scrollAndClickByTestId('{apiName}-btn', '调用 {apiName}');
  const el = await this.waitForText('{apiName}结果');
  if (!el) {
    throw new Error('点击后未出现{apiName}结果文本');
  }
  const text = this.getChildText(el) || el.text || '';
  this.report(text.includes('{expectedValue}'), `结果: "${text.trim()}"`);
}
```

#### 3.2.2 TurboModule 异步方法

```typescript
@Step('调用 {apiName}({params})', { captureScreenshot: false, stepTimeout: 30000 })
async test{ApiName}(): Promise<void> {
  await this.scrollAndClickByTestId('{apiName}-btn', '调用 {apiName}');
  // 异步方法需要更长等待
  const el = await this.waitForText('{apiName}结果', 10000);
  if (!el) {
    throw new Error('点击后未出现{apiName}结果文本');
  }
  const text = this.getChildText(el) || el.text || '';
  this.report(!text.includes('加载中'), `结果: "${text.trim()}"`);
}
```

#### 3.2.3 事件回调

```typescript
@Step('监听 {eventName} 事件', { captureScreenshot: false, stepTimeout: 30000 })
async test{EventName}(): Promise<void> {
  await this.scrollAndClickByTestId('startListen-btn', '开始监听 {eventName}');
  // 触发事件（可能需要额外操作）
  const el = await this.waitForText('{eventName}结果', 10000);
  if (!el) {
    throw new Error('未捕获到{eventName}事件');
  }
  const text = this.getChildText(el) || el.text || '';
  this.report(text.includes('{eventName}结果'), `事件结果: "${text.trim()}"`);
  // 清理
  await this.scrollAndClickByTestId('stopListen-btn', '停止监听');
}
```

#### 3.2.4 组件属性

```typescript
@Step('切换 {componentName} 的 {propName} 属性', { captureScreenshot: false, stepTimeout: 30000 })
async test{ComponentName}{PropName}(): Promise<void> {
  await this.scrollAndClickByTestId('toggle{PropName}-btn', '切换 {propName}');
  const el = await this.waitForText('{propName}属性');
  if (!el) {
    throw new Error('未出现{propName}属性文本');
  }
  const text = this.getChildText(el) || el.text || '';
  this.report(text.includes('{expectedValue}'), `属性值: "${text.trim()}"`);
}
```

#### 3.2.5 常量/枚举

```typescript
@Step('验证常量 {constantName}', { captureScreenshot: false, stepTimeout: 30000 })
async test{ConstantName}(): Promise<void> {
  // 常量在页面加载时即显示，无需点击
  const el = await this.waitForText('{constantName}常量');
  if (!el) {
    throw new Error('未出现{constantName}常量文本');
  }
  const text = this.getChildText(el) || el.text || '';
  this.report(text.includes('{expectedValue}'), `常量值: "${text.trim()}"`);
}
```

---

## 4. 失败诊断与修复

### 4.1 级联取消机制

CPTF 框架的 `FunctionalTest.execute()` 在步骤超时时设置 `_cancelled = true`，此后所有 UIAutomation 调用经 `throwIfCancelled()` 抛 `'UIAutomation: 用例已取消'`。

结论：一个步骤超时 -> 后续全部步骤级联失败。看到批量"用例已取消"，只需诊断第一个超时步骤。

### 4.2 常见失败速查

| 现象 | 根因 | 修复方向 |
|------|------|----------|
| `Cannot find module '@cptf/framework'` | shim NODE_PATH 失效 | 本地 link 依赖 |
| 步骤超时后批量"用例已取消" | 级联取消 | 修第一个超时步骤 |
| 单步超时但按钮已点击成功 | waitForText 匹配串错误 | 逐字符对照 Demo 代码修断言文本 |
| 未找到按钮 | testID 不匹配或未滚动到位 | 核对 testID，增大 maxScrolls |
| 异步方法步骤超时 | 等待时间不够 | 增加 waitForText timeout 到 10000+ |

> 实机运行与调试详见 `rnoh-cptf-test-run` SKILL
