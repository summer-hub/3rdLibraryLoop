# 质量检查清单

> Phase 6 的完整校验清单。生成完成后逐项检查。

---

## 1. 接口规格解析检查

| # | 检查项 | 规则 | 通过条件 |
|---|--------|------|----------|
| 1.1 | 规格文档已读取 | specDoc 文件存在且可解析 | ✅ |
| 1.2 | API 清单完整 | 所有 API 类别（方法/组件/事件/常量）已提取 | ✅ |
| 1.3 | API 信息完整 | 每个 API 含名称、类型、参数、返回值、平台 | ✅ |
| 1.4 | 工程目录已探查 | exampleDir 已确定 | ✅ |
| 1.5 | 注册入口已探查 | registerFile 已确定，注册模式已识别 | ✅ |
| 1.6 | 构建信息已提取 | bundleId、hapPath 已提取 | ✅ 或标注缺失 |
| 1.7 | 依赖已确认 | package.json 含 harmonyPkgName | ✅ |

---

## 2. 平台兼容性检查

| # | 检查项 | 规则 | 通过条件 |
|---|--------|------|----------|
| 2.1 | Platform.OS 分支已分析 | 已识别 harmony 可用/不可用 API | ✅ |
| 2.2 | 无平台分支库已识别 | TurboModule 适配库全部可用 | ✅ 或标注不适用 |
| 2.3 | 未实现方法已排除 | `throw new Error('not implemented')` 方法已跳过 | ✅ |
| 2.4 | 权限需求已标注 | 敏感权限 API 已标注 | ✅ |
| 2.5 | 映射表已构建 | 每个 API 有 Demo 步骤和 Test 步骤对应 | ✅ |

---

## 3. Demo 代码检查

| # | 检查项 | 规则 | 通过条件 |
|---|--------|------|----------|
| 3.1 | 目录结构 | `{exampleDir}/{libName}/demo/00X_*.tsx` | ✅ |
| 3.2 | 根组件 | 用 `View`，非 `ScrollView` | ✅ |
| 3.3 | testID 设置 | 每个可交互按钮设 `testID="{apiName}-btn"` | ✅ |
| 3.4 | 固定文本前缀 | 结果 Text 用 `{API名}结果：{值}` 格式 | ✅ |
| 3.5 | 无裸值渲染 | 所有动态值附加固定前缀 | ✅ |
| 3.6 | 全角冒号 | 结果文本冒号统一全角 `：` | ✅ |
| 3.7 | 按钮唯一标识 | title 含 API 名，全局唯一 | ✅ |
| 3.8 | 无 Slider | 未使用 `Slider` 组件 | ✅ |
| 3.9 | 无 console.error | 未使用 `console.error()` | ✅ |
| 3.10 | 无注释 | 代码中无 `//` 或 `/* */` | ✅ |
| 3.11 | 异步处理 | 用 `async/await` + `try/catch` | ✅ |
| 3.12 | 权限请求 | 敏感操作前有权限请求 | ✅ 或标注不适用 |
| 3.13 | 平台兼容性 | 未使用 iOS/Android 专属属性 | ✅ |
| 3.14 | Hook 顶层调用 | Hook 不在事件回调中调用 | ✅ 或标注不适用 |
| 3.15 | 入口文件 | index.tsx 含 Tester 集成 + 元数据导出 | ✅ |
| 3.16 | 注册入口 | registerFile 已追加新 Demo 注册 | ✅ |
| 3.17 | 注册模式 | 追加模式与 registerFile 现有模式一致 | ✅ |

---

## 4. CPTF 测试工程检查

| # | 检查项 | 规则 | 通过条件 |
|---|--------|------|----------|
| 4.1 | cptf.config.json | 存在且含 bundleId / casesDir / timezone / platforms.harmony.appPath / devices | ✅ |
| 4.2 | appPath 绝对路径 | platforms.harmony.appPath 以 `/` 开头 | ✅ |
| 4.3 | tsconfig.json | 存在且**不含** `experimentalDecorators` / `emitDecoratorMetadata` | ✅ |
| 4.4 | package.json link | 声明 `@cptf/framework` link + `reflect-metadata` link | ✅ |
| 4.5 | node_modules | @cptf/framework + reflect-metadata 已建立 | ✅ |

---

## 5. CPTF 测试文件检查

| # | 检查项 | 规则 | 通过条件 |
|---|--------|------|----------|
| 5.1 | 首行 import | `import 'reflect-metadata'` | ✅ |
| 5.2 | stepTimeout | 每个 @Step 显式设置 `stepTimeout: 30000` | ✅ |
| 5.3 | testCaseExecutor | 文件末尾导出 `testCaseExecutor` | ✅ |
| 5.4 | 多文件拆分 | 按 API 分类拆分，每个文件一个 `@Test`（非全部放一个文件） | ✅ |
| 5.5 | 导航策略 | 注册 `single-page` 导航策略 | ✅ |
| 5.6 | @Test 装饰器 | 含 id / name / module / platform / navigationStrategy | ✅ |
| 5.7 | 辅助方法 | 含 scrollAndClick / waitForText / report | ✅ |
| 5.8 | testID 定位 | 优先用 testID 定位（Demo 已设置） | ✅ |
| 5.9 | 回调类 API 容错 | `(Module as any)` 调用的 API 使用容错断言 | ✅ 或标注不适用 |
| 5.10 | 全角冒号风险 | waitForText 参数含半角冒号的行（警告） | ⚠️ 或 ✅ |

---

## 6. Demo-Test 对齐检查

| # | 检查项 | 规则 | 通过条件 |
|---|--------|------|----------|
| 6.1 | API 覆盖一致 | Demo 中的 API 数量 = Test 中的 @Step 数量 | ✅ |
| 6.2 | testID 一致 | Demo 的 testID = Test 的 scrollAndClickByTestId 参数 | ✅ |
| 6.3 | 断言文本前缀匹配 | Demo 的 Text 前缀 = Test 的 waitForText 参数 | ✅ |
| 6.4 | 按钮定位一致 | Demo 的按钮 title = Test 的 textContains 关键字 | ✅ |

---

## 7. 渐进式披露检查

| # | 检查项 | 规则 | 通过条件 |
|---|--------|------|----------|
| 7.1 | SKILL.md body 行数 | < 500 行 | ✅ |
| 7.2 | references 一层深度 | 无嵌套子目录 | ✅ |
| 7.3 | 文件引用相对路径 | 无绝对路径引用 | ✅ |

---

## 8. 自动化校验

运行校验脚本执行上述检查：

```bash
bash {skillDir}/scripts/validate-rnoh-cptf-api-test.sh '{"workspaceDir":"<绝对路径>","demoDir":"<绝对路径>"}'
```

脚本输出 `ALL CHECKS PASSED` 表示全部通过，否则列出失败项。
