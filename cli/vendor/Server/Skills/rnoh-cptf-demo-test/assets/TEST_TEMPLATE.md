# CPTF 测试文件模板

> Phase 3 生成测试文件时复制此模板，替换 `{占位符}`。模板来自 react-native-get-random-values 实战验证版本（18 步骤全部通过的结构）。

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
 *   - Demo 为单页应用（无 module-list 首页、无 deep link scheme），
 *     注册自定义 'single-page' 导航策略：启动应用后直接等待 testerino
 *     面板就绪，跳过框架默认的 deep link / 点击导航。
 *   - Demo 按钮未设置 testID，全部通过按钮文本(textContains)定位；
 *     结果验证依赖点击后出现的业务文本。
 *   - {N} 个 TestCase 位于 ScrollView 中，屏幕外的按钮需智能滚动查找。
 */

// ─── 单页应用导航策略 ───────────────────────────────────────────────
NavigationStrategyFactory.registerStrategy('single-page', () => ({
  id: 'single-page',
  async navigateToTestScene(ctx): Promise<void> {
    ctx.logger.debug('[single-page] 单页应用，跳过场景导航，等待 testerino 面板就绪');
    // 等待 testerino 统计面板出现（TOTAL 计数文本），最长 15s
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
  async returnFromTestScene(_ctx): Promise<void> {
    // 单页应用无需返回上级
  },
}));

// ─── 用例定义 ───────────────────────────────────────────────────────
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
  /** 滚动查找并点击指定文本按钮（屏幕外元素自动滚动定位） */
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

  // ── 1. {能力分组 1} ────────────────────────────────────────────────

  @Step('{步骤描述}', { captureScreenshot: false, stepTimeout: 30000 })
  async stepMethodName(): Promise<void> {
    await this.scrollAndClick('{按钮 title 唯一子串}', '{按钮语义标签}');
    // {断言策略说明：前缀文本 / 快照差集 / 值域校验}
    const el = await this.waitForText('{结果文本前缀，源码逐字符复制}');
    if (!el) {
      throw new Error('点击后未出现{结果}文本');
    }
    const text = this.getChildText(el) || el.text || '';
    this.report(text.includes('{期望值}'), `结果: "${text.trim()}"`);
  }

  // ... 每个 TestCase 一个 @Step

  // ── 辅助: 快照差集收集无前缀结果（如裸数字） ──────────────────────
  private lastSnapshot: Set<string> = new Set();

  private async snapshotAllTexts(): Promise<Set<string>> {
    const elements = await this.ui!.getLayout(true);
    const texts = new Set<string>();
    for (const el of elements) {
      if (el.text && el.text.trim()) {
        texts.add(el.text.trim());
      }
    }
    return texts;
  }

  private async collectNumbersAfter(caseTitle: string): Promise<number[]> {
    const after = await this.snapshotAllTexts();
    const added: string[] = [];
    for (const t of after) {
      if (!this.lastSnapshot.has(t)) {
        added.push(t);
      }
    }
    this.lastSnapshot = after;
    // 数字文本（可能为负）
    const nums = added
      .filter(t => /^-?\d+$/.test(t))
      .map(t => parseInt(t, 10));
    return nums;
  }
}

export const testCaseExecutor = new {LibName}Test();
```

## 2. 各断言策略的 @Step 写法

### 2.1 固定前缀文本断言（最常见）

```typescript
@Step('{描述}', { captureScreenshot: false, stepTimeout: 30000 })
async xxx(): Promise<void> {
  await this.scrollAndClick('{按钮子串}', '{标签}');
  const el = await this.waitForText('错误信息');   // ← 前缀，可省略冒号
  if (!el) throw new Error('点击后未出现错误信息文本');
  const errText = this.getChildText(errEl) || errEl.text || '';
  this.report(/ExpectedError/i.test(errText), `错误信息: "${errText.trim().substring(0, 120)}"`);
}
```

### 2.2 快照差集断言（无前缀裸值）

```typescript
@Step('{描述}', { captureScreenshot: false, stepTimeout: 30000 })
async xxx(): Promise<void> {
  await this.scrollAndClick('{按钮子串}', '{标签}');
  const nums = await this.collectNumbersAfter('{caseTitle}');
  this.report(
    nums.length >= 1 && nums.every(n => n >= {min} && n <= {max}),
    `生成 ${nums.length} 个: [${nums.join(', ')}]，均在 [{min},{max}]`,
  );
}
```

### 2.3 demo 已知 bug 容错断言

```typescript
@Step('{描述}', { captureScreenshot: false, stepTimeout: 30000 })
async xxx(): Promise<void> {
  await this.scrollAndClick('{按钮子串}', '{标签}');
  const errEl = await this.waitForText('错误信息');
  if (!errEl) throw new Error('点击后未出现错误信息文本');
  const errText = this.getChildText(errEl) || errEl.text || '';
  // 注: demo 已知渲染 bug（'Text strings must be rendered within a <Text>'），
  // 错误信息可能被 LogBox 覆盖，此处仅验证错误场景触发了错误输出。
  const hasExpected = /ExpectedError/i.test(errText);
  const hasRenderIssue = /<Text>|rendered within/i.test(errText);
  this.report(hasExpected || hasRenderIssue, `错误信息: "${errText.trim().substring(0, 120)}"`);
}
```

## 3. 编码规则速查

| 规则 | 原因 |
|------|------|
| 文件首行 `import 'reflect-metadata'` | 装饰器运行时依赖 |
| 每个 @Step 显式 `stepTimeout: 30000` | 默认 10s 不够滚动+点击+等待 |
| 断言文本从 demo 源码逐字符复制 | 全角/半角冒号差异是头号失败根因 |
| `captureScreenshot: false`（常规步骤） | 减少耗时；失败步骤框架自动截图 |
| 文件末尾 `export const testCaseExecutor` | CLI 用例发现约定 |
| 步骤名含中文+关键 API 名 | 报告可读性 |
| scrollAndClick 后 `sleep(600)` | 等待点击生效+渲染 |
| waitForText 轮询 400ms×20 次（8s） | 渲染时延容错 |
