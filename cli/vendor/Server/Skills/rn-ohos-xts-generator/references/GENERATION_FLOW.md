# RN 三方库测试用例生成流程

---

## 一、概述

本文档定义了从 RN 三方库源码到生成 XTS 测试用例的完整流程。

---

## 二、完整生成流程

```
步骤1：源码探查
   ├─ 1.1 定位三方库源码（oh_modules / node_modules）
   ├─ 1.2 解析 JS/TS 入口文件
   │   ├─ 提取导出的 API
   │   ├─ 识别 Platform.OS === 'harmony' 分支
   │   └─ 提取 NativeEventEmitter 事件名称
   ├─ 1.3 解析 TurboModule Spec
   │   ├─ 方法签名、参数类型、返回值类型
   │   ├─ 同步方法 vs 异步方法（Promise）
   │   └─ 类型定义
   ├─ 1.4 探查 HarmonyOS ArkTS 实现
   │   ├─ 确认实际实现的方法
   │   ├─ 排除 throw new Error('not implemented')
   │   └─ 确认 emitDeviceEvent 的事件名称
   └─ 1.5 探查 NativeComponent（如有）
       ├─ Index.ets 中的 export struct
       └─ 组件属性和事件
   ↓
步骤2：平台兼容性分析
   ├─ 对比各平台 API 差异
   ├─ 标记 HarmonyOS 可用/不可用 API
   └─ 识别需要特殊处理的 API
   ↓
步骤3：覆盖率分析（如有现有测试）
   ├─ 扫描现有 XTS 测试文件
   ├─ 识别已覆盖的 API
   └─ 输出覆盖率报告
   ↓
步骤4：测试用例规划
   ├─ 按 API 类型分类（TurboModule/Event/Component/Constant）
   ├─ 按测试类型分类（PARAM/ERROR/RETURN/EVENT/PERM）
   ├─ 按优先级排序（P0-P3）
   └─ 估算测试用例数量
   ↓
步骤5：测试用例生成
   ├─ 5.1 TurboModule 方法测试
   │   ├─ 正常参数测试（PARAM）
   │   ├─ 错误码测试（ERROR）
   │   ├─ 返回值测试（RETURN）
   │   └─ 边界值测试（BOUNDARY）
   ├─ 5.2 事件回调测试（EVENT）
   │   ├─ 事件触发验证
   │   └─ 事件参数验证
   ├─ 5.3 NativeComponent 测试（如有）
   │   ├─ 属性测试
   │   └─ 事件测试
   ├─ 5.4 常量/枚举测试
   └─ 5.5 权限测试（PERM）
   ↓
步骤6：测试设计文档生成
   └─ 同步生成 {测试文件名}.design.md
   ↓
步骤7：格式化和验证
   ├─ @tc 注释块完整性
   ├─ jest.mock() 导入语句正确性
   ├─ 测试用例命名规范（should...when...）
   ├─ 断言方法正确性（Jest 断言）
   └─ describe/it 结构正确性
   ↓
步骤8：输出文件
   ├─ 测试文件：{输出目录}/__tests__/
   ├─ Mock 文件：{输出目录}/__mocks__/
   ├─ 配置文件：{输出目录}/jest.config.js, jest.setup.js
   └─ 设计文档：{输出目录}/[库名].test.design.md
```

---

## 三、详细步骤说明

### 步骤1：源码探查

详见 [源码解析器](SOURCE_PARSER.md) 和 [HarmonyOS 实现探查器](HARMONY_SCANNER.md)

### 步骤2：平台兼容性分析

详见 [平台兼容性分析器](PLATFORM_COMPAT.md)

### 步骤3：覆盖率分析

详见 [覆盖率分析器](COVERAGE_ANALYZER.md)

### 步骤4：测试用例规划

根据源码探查和兼容性分析结果，规划测试用例：

1. **过滤不可用 API**：移除 HarmonyOS 不支持的 API
2. **过滤未实现 API**：移除 `throw new Error('not implemented')` 的方法
3. **按类型分类**：TurboModule 方法、事件、组件、常量
4. **按优先级排序**：核心功能 > 辅助功能 > 边界情况
5. **估算数量**：根据 API 复杂度估算测试用例数

### 步骤5：测试用例生成

根据 [测试生成策略](GENERATION_STRATEGY.md) 中的策略和 [测试文件模板](../assets/TEST_FILE_TEMPLATES.md) 中的模板生成测试用例。

**生成顺序**：
1. TurboModule 核心方法测试（P0）
2. TurboModule 正常参数测试（P1）
3. 权限测试（P1）
4. 事件回调测试（P2）
5. TurboModule 边界值测试（P2）
6. TurboModule 错误码测试（P3）
7. 常量/枚举测试（P3）

### 步骤6：测试设计文档生成

详见 [设计文档指南](DESIGN_DOC_GUIDE.md)

### 步骤7：格式化和验证

**必须检查的项目**：

| 检查项 | 规范 | 错误示例 |
|--------|------|---------|
| @tc.name | should...when... 格式，与 it() 一致 | `@tc.name Test_Method_001` |
| @tc.number | `SUB_RNOH_[库名]_[API]_[类型]_[序号]` | `SUB_UTILS_...` |
| @tc.desc | 以 `. ` 结尾 | `测试方法` |
| it() 命名 | should...when... 格式 | `testMethod001` |
| 导入合并 | 同包名合并 | 分散导入 |
| 断言方法 | 从 Jest 断言列表中选择 | `assertNotNull` |
| Mock 位置 | jest.mock() 在 import 之前 | import 在 mock 之前 |
| Mock 清理 | beforeEach 中 jest.clearAllMocks() | 无清理 |

---

## 四、输出文件规范

### 4.1 文件命名

```
[库名简写][功能模块].test.ts
```

### 4.2 文件组织

```
{输出目录}/
├── __tests__/
│   ├── [库名简写]Test.test.ts       # 主测试文件（TurboModule 方法）
│   ├── [库名简写]EventTest.test.ts  # 事件测试文件
│   ├── [库名简写]PermTest.test.ts   # 权限测试文件
│   └── [库名简写]UtilsTest.test.ts  # 工具类/常量测试文件
├── __mocks__/
│   └── @react-native-ohos/
│       └── [库名]/
│           └── index.ts             # Mock 模块文件
├── jest.config.js                   # Jest 配置
├── jest.setup.js                    # Jest setup 文件
├── package.json                     # npm 配置
└── [库名].test.design.md            # 测试设计文档
```
