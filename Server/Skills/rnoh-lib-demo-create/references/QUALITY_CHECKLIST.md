# 质量检查清单

> Demo 代码生成完成后，逐项校验以下清单。所有必须项（✅）通过后才能交付。

---

## 1. 接口探查完整性

| # | 检查项 | 类型 | 通过标准 |
|---|--------|------|----------|
| 1.1 | JS 层导出接口已探查 | ✅ 必须 | 函数/类/组件/Hooks/常量已列出 |
| 1.2 | 平台兼容性 API 已探查 | ✅ 必须 | harmony 分支可用/不可用属性已列出；无平台分支库标记为全部可用 |
| 1.3 | TurboModule Spec 已探查 | ✅ 必须 | 方法签名、Promise/同步、事件名已确认 |
| 1.4 | 类型定义已探查 | ⚠️ 推荐 | 参数类型、Props 接口已确认 |
| 1.5 | 事件名称已确认 | ✅ 必须 | DeviceEventEmitter 事件名来自源码，非猜测 |
| 1.6 | 废弃接口已探查 | ✅ 必须 | 废弃接口名、别名关系、替代接口已记录（如涉及） |
| 1.7 | upstream-cache 源码已追溯 | ⚠️ 推荐 | 鸿蒙化库 re-export 上游源码时已追溯实际实现 |

---

## 2. 代码规范

| # | 检查项 | 类型 | 通过标准 |
|---|--------|------|----------|
| 2.1 | Demo 页面根组件用 View | ✅ 必须 | 无 ScrollView 作为根组件 |
| 2.2 | 未使用 SafeAreaView/StatusBar | ✅ 必须 | Tester 框架不需要 |
| 2.3 | 未使用 Slider | ✅ 必须 | 已用按钮组替代 |
| 2.4 | 未使用 console.error() | ✅ 必须 | 已替换为 console.warn() |
| 2.5 | 未使用 fetch API 文件操作 | ✅ 必须 | 使用库自身 API |
| 2.6 | 代码中无注释 | ✅ 必须 | 无 `//` 或 `/* */` |
| 2.7 | 使用 async/await + try/catch | ✅ 必须 | 无 .then()/.catch() 链 |
| 2.8 | 样式用 StyleSheet.create | ✅ 必须 | 完整 UI 元素样式 |
| 2.9 | TAG 常量命名规范 | ⚠️ 推荐 | `库名_页面名` 格式 |
| 2.10 | Hook 在组件顶层调用 | ✅ 必须 | 不在事件回调/条件分支/循环中调用 Hook |
| 2.11 | 依赖 Context 的 Hook 在 Provider 子组件中 | ✅ 必须 | 拆分 InnerComponent，Hook 在 Provider 内部调用 |
| 2.12 | type 导入使用 inline 语法 | ⚠️ 推荐 | `import { type EdgeInsets }` 而非 `import type { EdgeInsets }` |

---

## 3. 平台兼容性

| # | 检查项 | 类型 | 通过标准 |
|---|--------|------|----------|
| 3.1 | 未使用 iOS/Android 专属属性 | ✅ 必须 | 基于 harmony 分支探查结果；无平台分支库全部可用 |
| 3.2 | 路径常量使用 HarmonyOS 版本 | ✅ 必须 | FilesDirectoryPath 而非 DocumentDirectoryPath |
| 3.3 | 事件名称与源码一致 | ✅ 必须 | 来自探查结果，非猜测 |
| 3.4 | 方法调用方式正确 | ✅ 必须 | Promise 方法用 await，同步方法直接调用 |
| 3.5 | 废弃接口验证使用引用比较 | ⚠️ 推荐 | 使用 `===` 验证别名关系（如涉及废弃接口） |

---

## 4. 权限与兜底

| # | 检查项 | 类型 | 通过标准 |
|---|--------|------|----------|
| 4.1 | 敏感权限操作前请求权限 | ✅ 必须 | 麦克风/相机/定位/存储操作前有 requestAuthorization |
| 4.2 | 实时数据有 JS 计时器兜底 | ✅ 必须 | 原生事件不可靠时 setInterval 兜底 |
| 4.3 | 停止操作时保留最终值 | ✅ 必须 | 只 clearInterval，不重置状态值 |
| 4.4 | 组件卸载时清除计时器 | ✅ 必须 | useEffect return 中 clearInterval |

---

## 5. Tester 集成

| # | 检查项 | 类型 | 通过标准 |
|---|--------|------|----------|
| 5.1 | index.tsx 包含 Tester 框架集成 | ✅ 必须 | Tester + TestSuite + TestCase |
| 5.2 | index.tsx 包含元数据导出 | ✅ 必须 | displayName/framework/category/title/description/examples |
| 5.3 | 注册入口已更新 | ✅ 必须 | registerFile 已追加新 Demo 注册，路径正确 |
| 5.4 | 注册路径为相对路径 | ✅ 必须 | 从 registerFile 到 indexFile 的相对路径，不硬编码 |
| 5.5 | 文件命名规范 | ⚠️ 推荐 | 00X_kebab-case描述Page.tsx |
| 5.6 | 注册模式与现有模式一致 | ✅ 必须 | 模式 A/B/C 与 registerFile 现有注册模式匹配，未破坏已有结构 |
| 5.7 | 注册模式已识别记录 | ✅ 必须 | 已读取 registerFile 内容，识别并记录注册模式（A/B/C） |

---

## 6. 工程结构探查

| # | 检查项 | 类型 | 通过标准 |
|---|--------|------|----------|
| 6.1 | example/demo 目录已探查 | ✅ 必须 | exampleDir 已确定 |
| 6.2 | 注册入口文件已探查 | ✅ 必须 | registerFile 已确定 |
| 6.3 | 依赖已存在于 package.json | ✅ 必须 | 生成前已验证 |

---

## 7. 自动化校验

运行校验脚本进行 SKILL 规范检查：

```bash
bash {skillDir}/scripts/validate-skill.sh {skillDir}
```

脚本输出 `ALL CHECKS PASSED` 表示 SKILL 结构合规。
