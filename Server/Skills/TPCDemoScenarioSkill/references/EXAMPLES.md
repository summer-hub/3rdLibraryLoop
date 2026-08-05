# 示例：测试 Demo 描述文档

本文档展示使用 `ohos-arkts-demo-doc-generator` 技能针对一个虚构的图像处理三方库（`ohos-blur-kit`）生成的测试 Demo 描述文档示例。

> 📌 注意：以下所有接口均为示范用途，实际生成时应严格依据真实规格文档。

---

## 假设的接口规格文档（输入）

```typescript
// Index.ets - 导出接口清单

// 图像模糊处理管理类
export class BlurManager {
  constructor(radius: number)
  blur(pixelMap: PixelMap): Promise<PixelMap>
  blurSync(pixelMap: PixelMap): PixelMap
  setRadius(radius: number): void
  getRadius(): number
  release(): void
}

// 工具函数
export function createBlurConfig(radius: number, mode: BlurMode): BlurConfig
export function isSupported(): boolean

// 枚举
export enum BlurMode {
  GAUSSIAN = 'gaussian',
  STACK = 'stack',
  BOX = 'box'
}

// 接口
export interface BlurConfig {
  radius: number
  mode: BlurMode
  quality?: number
}

// 常量
export const VERSION: string
```

---

## 生成的输出文档示例

以下为技能输出的 `ohos-blur-kit测试demo描述.md` 内容：

---

# ohos-blur-kit 测试 Demo 描述文档

## 概述

本文档基于 `ohos-blur-kit` 库的接口规格说明文档自动生成，提供该库各接口的 ArkTS 测试 Demo 描述，供开发者参考实现功能验证页面。文档按功能相关性对接口进行分组，每组接口对应一个 Demo 页面描述。

## Demo 总览

| Demo 数量 | 覆盖接口数量 | 生成日期 |
|----------|------------|---------|
| 4 个      | 8 个        | 2026-03-11 |

## 测试 Demo 描述列表

| 序号 | 测试 Demo 名称 | 测试 Demo 描述 | 测试 Demo 步骤 | 测试 Demo 预期结果 | 对应函数接口 |
|-----|--------------|--------------|--------------|-----------------|------------|
| 1 | 环境检测与配置创建 Demo | 展示如何在使用 BlurManager 前检测当前设备是否支持模糊能力，以及如何通过 `createBlurConfig()` 创建合法的模糊配置对象。帮助开发者理解使用前置条件检查和配置初始化的标准流程。 | 1. 创建 Demo 页面，包含"检测支持"按钮、BlurMode 选择器（Gaussian/Stack/Box）、radius 输入框和"创建配置"按钮，以及 JSON 展示区域。<br>2. 点击"检测支持"按钮，调用 `isSupported()`，将返回的布尔值显示在页面上（"当前设备支持模糊 ✅" 或 "当前设备不支持 ❌"）。<br>3. 选择 BlurMode 并输入 radius 值，点击"创建配置"按钮，调用 `createBlurConfig(radius, mode)`。<br>4. 在 JSON 展示区域展示返回的 `BlurConfig` 对象，格式化显示 radius、mode、quality 字段。 | 1. 页面加载完成，按钮与选择器可正常操作。<br>2. 调用 `isSupported()` 返回布尔值，页面相应显示支持/不支持状态。<br>3. 调用 `createBlurConfig()` 后成功返回 `BlurConfig` 对象，页面格式化展示该对象的 radius 和 mode 字段，无抛出异常。 | `isSupported(): boolean`<br>`createBlurConfig(radius: number, mode: BlurMode): BlurConfig` |
| 2 | BlurManager 生命周期管理 Demo | 展示 `BlurManager` 的完整生命周期：构造（传入 radius）、设置/获取 radius、最终释放资源。帮助开发者理解 BlurManager 对象的创建方式、radius 属性的读写机制，以及释放资源的时机。 | 1. 创建 Demo 页面，包含 radius 输入框、"创建 BlurManager"按钮、新 radius 输入框、"更新 radius"按钮、"获取 radius"按钮和"释放"按钮，以及状态日志区域。<br>2. 填写 radius 值（如 15），点击"创建 BlurManager"，调用 `new BlurManager(15)`，在日志区域显示"BlurManager 已创建，初始 radius=15"。<br>3. 修改 radius 值（如 25），点击"更新 radius"，调用 `setRadius(25)`，日志显示"radius 已更新为 25"。<br>4. 点击"获取 radius"，调用 `getRadius()`，日志显示"当前 radius=25"，验证与上一步设置一致。<br>5. 点击"释放"，调用 `release()`，日志显示"BlurManager 已释放"，此后操作按钮禁用。 | 1. `new BlurManager(radius)` 成功创建实例，无异常。<br>2. `setRadius(newValue)` 调用后，再次 `getRadius()` 返回与设置值一致，验证读写一致性。<br>3. `release()` 调用后页面日志提示释放成功，后续调用不再可用（按钮变灰）。<br>4. 整个生命周期无内存泄漏提示，无崩溃。 | `new BlurManager(radius: number)`<br>`setRadius(radius: number): void`<br>`getRadius(): number`<br>`release(): void` |
| 3 | 同步图像模糊处理 Demo | 展示使用 `blurSync()` 对 PixelMap 进行同步模糊处理的完整流程，帮助开发者理解同步调用方式、传参规范及处理后图像的获取与展示。 | 1. 创建 Demo 页面，包含"选择图片"按钮（调用图库选择器）、原图展示区域、radius 滑动条、"执行同步模糊"按钮和模糊后图片展示区域。<br>2. 点击"选择图片"，从图库选取一张图片，在原图展示区域预览。<br>3. 拖动 radius 滑动条调整模糊半径（范围 1-50）。<br>4. 点击"执行同步模糊"，创建 `BlurManager(radius)`，调用 `blurSync(pixelMap)`，传入原图 PixelMap。<br>5. 将返回的 PixelMap 在模糊后图片展示区域显示，并在图片下方标注"模糊半径: {radius}"。 | 1. 选图后原图在页面正常预览。<br>2. `blurSync()` 同步返回处理后的 PixelMap，页面立即更新展示模糊后图片。<br>3. 模糊后图片的尺寸（宽高像素数）与原图一致，仅视觉效果有模糊。<br>4. 调整不同 radius 值后重复操作，模糊程度随 radius 增大而加深。<br>5. 无异常抛出，UI 线程无卡顿超过 3 秒的提示。 | `new BlurManager(radius: number)`<br>`blurSync(pixelMap: PixelMap): PixelMap` |
| 4 | 异步图像模糊处理 Demo | 展示使用 `blur()` 对 PixelMap 进行异步模糊处理的完整流程，以及与同步方式的对比体验。帮助开发者理解 Promise 异步调用方式、await 使用规范，以及如何在 ArkTS 中处理异步返回结果。 | 1. 创建 Demo 页面，包含"选择图片"按钮、原图展示区域、radius 输入框、"执行异步模糊"按钮、Loading 指示器和模糊后图片展示区域。<br>2. 选取一张图片，在原图区域预览。<br>3. 输入 radius 值，点击"执行异步模糊"，按钮变为禁用状态，显示 Loading 指示器。<br>4. 调用 `await blurManager.blur(pixelMap)`，等待 Promise resolve。<br>5. Promise 完成后，隐藏 Loading、启用按钮，将返回的 PixelMap 在结果区域显示，下方标注"异步模糊完成，耗时: {ms}ms"。 | 1. 点击"执行异步模糊"后，按钮立即变为禁用，Loading 指示器显示，表明异步任务已开始。<br>2. `blur()` 返回的 Promise 正常 resolve，Loading 消失，模糊后图片显示在结果区域。<br>3. 模糊后图片尺寸与原图一致，视觉上出现模糊效果。<br>4. UI 线程在等待期间不冻结（可滚动页面或切换其他控件）。<br>5. 页面正确展示异步耗时，无 Promise reject 或未捕获异常。 | `new BlurManager(radius: number)`<br>`blur(pixelMap: PixelMap): Promise<PixelMap>` |

## 接口覆盖矩阵

| 序号 | 接口名称 | 所在 Demo | 覆盖状态 |
|-----|---------|----------|---------|
| 1 | `isSupported(): boolean` | 环境检测与配置创建 Demo | ✅ 已覆盖 |
| 2 | `createBlurConfig(radius, mode): BlurConfig` | 环境检测与配置创建 Demo | ✅ 已覆盖 |
| 3 | `new BlurManager(radius: number)` | BlurManager 生命周期管理 Demo / 同步模糊 Demo / 异步模糊 Demo | ✅ 已覆盖 |
| 4 | `setRadius(radius: number): void` | BlurManager 生命周期管理 Demo | ✅ 已覆盖 |
| 5 | `getRadius(): number` | BlurManager 生命周期管理 Demo | ✅ 已覆盖 |
| 6 | `release(): void` | BlurManager 生命周期管理 Demo | ✅ 已覆盖 |
| 7 | `blurSync(pixelMap: PixelMap): PixelMap` | 同步图像模糊处理 Demo | ✅ 已覆盖 |
| 8 | `blur(pixelMap: PixelMap): Promise<PixelMap>` | 异步图像模糊处理 Demo | ✅ 已覆盖 |

---

## 关键生成规则说明

上述示例展示了以下技能规则的应用：

1. **生命周期合并**：`constructor`、`setRadius`、`getRadius`、`release` 四个接口合并到一个 Demo，因为它们共同描述 `BlurManager` 的完整生命周期管理流程。

2. **前置条件合并**：`isSupported()` 与 `createBlurConfig()` 合并到一个 Demo，因为它们都属于"使用前准备"阶段，且 `createBlurConfig` 的结果可作为构造函数的配置依据。

3. **异步/同步分开**：`blur()` 和 `blurSync()` 虽然功能类似，但因调用方式（异步 vs 同步）差异明显，分别在独立 Demo 中展示，便于开发者对比。

4. **以页面为载体**：每个步骤都明确描述了对应的 UI 组件（按钮、展示区、日志区等）和用户操作，使开发者可直接按步骤实现 Demo 页面。
