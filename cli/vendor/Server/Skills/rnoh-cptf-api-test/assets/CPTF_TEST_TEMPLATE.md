# CPTF 测试文件模板

> Phase 5 生成 CPTF 测试文件时复制此模板，替换 `{占位符}` 内容。模板与 Demo 页面模板协同设计，保证 Demo-Test 对齐。

---

## 1. 完整文件骨架

```typescript
/*
 * Copyright {year} {author}
 * SPDX-License-Identifier: MIT
 */

import 'reflect-metadata';
import { Test, Step, FunctionalTest, NavigationStrategyFactory } from '@cptf/framework';
import type { UIElement } from '@cptf/framework';

/**
 * {libName} (RNOH) 自动化功能测试
 *
 * 被测应用: {bundleId} (testerino 单页 Demo)
 * 覆盖能力:
 *   1. {能力分组 1}
 *   2. {能力分组 2}
 *   ...
 *
 * 实现说明:
 *   - Demo 为单页应用，注册自定义 'single-page' 导航策略。
 *   - Demo 按钮已设置 testID，优先用 testID 定位。
 *   - 结果文本使用固定前缀（全角冒号），waitForText 可靠匹配。
 *   - {N} 个 API 位于 ScrollView 中，屏幕外的按钮需智能滚动查找。
 */

// --- 单页应用导航策略 ---
NavigationStrategyFactory.registerStrategy('single-page', () => ({
  id: 'single-page',
  async navigateToTestScene(ctx): Promise<void> {
    ctx.logger.debug('[single-page] 单页应用，等待 testerino 面板就绪');
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

// --- 用例定义 ---
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

  /** 通过 testID 滚动查找并点击按钮（优先使用，Demo 已设置 testID） */
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

  /** 通过文本子串滚动查找并点击按钮（testID 不可用时备用） */
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

  /** 断言屏幕上出现包含 expectedSub 的文本（带轮询重试） */
  private async waitForText(expectedSub: string, timeout = 8000): Promise<UIElement | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const el = await this.ui!.findByText(expectedSub);
      if (el) return el;
      await this.sleep(400);
    }
    return null;
  }

  /** 收集步骤结果并登记失败（供报告呈现） */
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

  // -- 1. TurboModule 同步方法 --

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

  // -- 2. TurboModule 异步方法 --

  @Step('调用 {apiName}({params})', { captureScreenshot: false, stepTimeout: 30000 })
  async test{ApiName}(): Promise<void> {
    await this.scrollAndClickByTestId('{apiName}-btn', '调用 {apiName}');
    const el = await this.waitForText('{apiName}结果', 10000);
    if (!el) {
      throw new Error('点击后未出现{apiName}结果文本');
    }
    const text = this.getChildText(el) || el.text || '';
    this.report(!text.includes('加载中'), `结果: "${text.trim()}"`);
  }

  // -- 3. 事件回调 --

  @Step('监听 {eventName} 事件', { captureScreenshot: false, stepTimeout: 30000 })
  async test{EventName}Event(): Promise<void> {
    await this.scrollAndClickByTestId('start{EventName}-btn', '开始监听 {eventName}');
    const el = await this.waitForText('{eventName}结果', 10000);
    if (!el) {
      throw new Error('未捕获到{eventName}事件');
    }
    const text = this.getChildText(el) || el.text || '';
    this.report(text.includes('{eventName}结果'), `事件结果: "${text.trim()}"`);
    await this.scrollAndClickByTestId('stop{EventName}-btn', '停止监听');
  }

  // -- 4. 组件属性 --

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

  // -- 5. 常量/枚举 --

  @Step('验证常量 {constantName}', { captureScreenshot: false, stepTimeout: 30000 })
  async test{ConstantName}(): Promise<void> {
    const el = await this.waitForText('{constantName}常量');
    if (!el) {
      throw new Error('未出现{constantName}常量文本');
    }
    const text = this.getChildText(el) || el.text || '';
    this.report(text.includes('{expectedValue}'), `常量值: "${text.trim()}"`);
  }

  // -- 6. 权限测试 --

  @Step('调用 {apiName}（需权限）', { captureScreenshot: false, stepTimeout: 30000 })
  async test{ApiName}Permission(): Promise<void> {
    await this.scrollAndClickByTestId('{apiName}-btn', '调用 {apiName}（需权限）');
    const el = await this.waitForText('{apiName}结果', 10000);
    if (!el) {
      throw new Error('点击后未出现{apiName}结果文本');
    }
    const text = this.getChildText(el) || el.text || '';
    const hasResult = text.includes('{apiName}结果');
    const hasPermissionError = text.includes('权限被拒绝');
    this.report(hasResult || hasPermissionError, `结果: "${text.trim()}"`);
  }
}

export const testCaseExecutor = new {LibName}Test();
```

### 1.1 多文件拆分模板

> ⚠️ 一个 `@Test` = 报告一个用例。按 API 分类拆分多文件，每文件复用以下完整骨架：

```typescript
import 'reflect-metadata';
import { Test, Step, FunctionalTest, NavigationStrategyFactory } from '@cptf/framework';
import type { UIElement } from '@cptf/framework';

NavigationStrategyFactory.registerStrategy('single-page', () => ({
  id: 'single-page',
  async navigateToTestScene(ctx): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const panel = await ctx.ui.findByText('TOTAL');
      if (panel) { return; }
      await ctx.ui.sleep(500);
    }
  },
  async returnFromTestScene(_ctx): Promise<void> {},
}));

abstract class BaseTest extends FunctionalTest {
  protected async scrollAndClickByTestId(testId: string, label: string): Promise<void> {
    const btn = await this.ui!.scrollToFindElement({ testID: testId }, { maxScrolls: 12, waitAfterScroll: 300 });
    if (!btn) { throw new Error(`未找到按钮: ${label} (testID: ${testId})`); }
    await this.ui!.clickElement(btn);
    await this.sleep(600);
  }
  protected async waitForText(sub: string, timeout = 8000): Promise<UIElement | null> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const el = await this.ui!.findByText(sub);
      if (el) return el;
      await this.sleep(400);
    }
    return null;
  }
  protected report(passed: boolean, details: string): void {
    this.currentStepResult = { stepName: this.currentStepResult?.stepName || '校验', passed, details };
    if (!passed) { throw new Error(details); }
  }
}

@Test({ id: '{lib}-{category}', name: '{lib} {categoryName}', module: 'functional', platform: 'harmony', category: 'API', description: '...', navigationStrategy: 'single-page', captureScreenshots: true, waitAfterAction: 300 })
class {Category}Test extends BaseTest {
  // @Step 方法...
}

export const testCaseExecutor = new {Category}Test();
```

### 1.2 回调类 API 容错断言模板

> 适用于通过 `(Module as any)` 调用或 Spec 未声明的 API：

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

---

## 2. 编码规则速查

| 规则 | 原因 |
|------|------|
| 文件首行 `import 'reflect-metadata'` | `Reflect.defineMetadata` 运行时依赖 |
| **按 API 分类拆分多文件** | 一个 @Test = 报告一个用例，不拆分只显示 1 个 |
| **tsconfig.json 禁止 `experimentalDecorators`** | 框架用 Stage 3 装饰器，旧版报 `context.addInitializer is not a function` |
| **workspace 必须有独立 tsconfig.json** | 隔离上级 RN 工程 tsconfig，防止 ts-node 拾取错误配置 |
| 每个 @Step 显式 `stepTimeout: 30000` | 默认 10s 不够滚动+点击+等待 |
| 断言文本从 Demo 代码逐字符复制 | 全角/半角冒号差异是头号失败根因 |
| 优先用 `scrollAndClickByTestId` | testID 比 textContains 更稳定 |
| 回调类 API 用容错断言 | API 可能未实现，回调不触发 |
| `captureScreenshot: false`（常规步骤） | 减少耗时；失败步骤框架自动截图 |
| 文件末尾 `export const testCaseExecutor` | CLI 用例发现约定 |
| 步骤名含中文+API 名 | 报告可读性 |
| `scrollAndClick` 后 `sleep(600)` | 等待点击生效+渲染 |
| `waitForText` 轮询 400ms x 20 次（8s） | 渲染时延容错 |
| 异步方法 `waitForText` timeout 10000 | 异步操作需要更长等待 |

---

## 3. Demo-Test 对齐速查

| 对齐维度 | Demo 侧代码 | Test 侧代码 |
|----------|------------|------------|
| 按钮定位 | `testID="{apiName}-btn"` | `scrollAndClickByTestId('{apiName}-btn')` |
| 结果断言 | `<Text>{API名}结果：{值}</Text>` | `waitForText('{API名}结果')` |
| 按钮备用定位 | `title="调用 {apiName}"` | `scrollAndClick('{apiName}')` |
| 事件开始 | `testID="start{EventName}-btn"` | `scrollAndClickByTestId('start{EventName}-btn')` |
| 事件停止 | `testID="stop{EventName}-btn"` | `scrollAndClickByTestId('stop{EventName}-btn')` |
| 常量验证 | `<Text>{constantName}常量：{值}</Text>` | `waitForText('{constantName}常量')` |
| 属性切换 | `testID="toggle{PropName}-btn"` | `scrollAndClickByTestId('toggle{PropName}-btn')` |
| 属性断言 | `<Text>{propName}属性：{值}</Text>` | `waitForText('{propName}属性')` |
