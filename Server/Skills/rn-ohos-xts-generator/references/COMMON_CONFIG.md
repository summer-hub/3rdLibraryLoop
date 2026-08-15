# RN 三方库 XTS 测试通用配置

> **适用范围**: 所有 @react-native-ohos/* 三方库
> **版本**: 2.0.0
> **更新日期**: 2026-03-31
> **测试框架**: Jest

---

## 一、配置架构

### 1.1 配置层级

```
通用配置 (_common.md)
├─ 强制规范（不可覆盖）
├─ 默认规范（可覆盖）
└─ 扩展接口（三方库扩展）

三方库配置 ({library-name}_CONFIG.md）
├─ 基础信息（必须）
├─ 三方库差异化配置（仅覆盖不同部分）
└─ 特殊规则（仅三方库特有）
```

### 1.2 配置优先级

```
用户自定义配置 > 三方库配置 > 通用配置
```

---

## 二、核心强制规范（不可覆盖）

### 2.1 测试框架

- **必须使用 Jest 框架**
- 测试文件扩展名：`.test.ts` 或 `.test.tsx`
- 使用 `jest.mock()` 模拟原生模块
- 使用 `jest.clearAllMocks()` 在 `beforeEach` 中清理

### 2.2 测试用例编号格式

```
格式: SUB_RNOH_[库名简写]_[API]_[类型]_[序号]

类型标识：
- PARAM    参数测试
- ERROR    错误码测试
- RETURN   返回值测试
- BOUNDARY 边界值测试
- EVENT    事件测试
- PERM     权限测试

示例：
SUB_RNOH_AUDIO_PREPARE_PARAM_0001
SUB_RNOH_AUDIO_PREPARE_ERROR_401_0001
SUB_RNOH_AUDIO_PROGRESS_EVENT_0001
SUB_RNOH_AUDIO_MIC_PERM_0001
```

### 2.3 命名强制规范

#### it() 函数第一个参数（用例名称）
- ✅ **必须使用 should...when... 格式**
- 示例：`should prepare recording with valid path and options`

#### @tc 注释块规范（强制）
- `@tc.name`：必须与 `it()` 第一个参数完全一致
- `@tc.number`：格式为 `SUB_RNOH_[库名]_[API]_[类型]_[序号]`，序号从 0001 开始
- `@tc.desc`：格式为 `测试 [对象] 的 [方法] - [场景].`，必须以 `. ` 结尾
- `@tc.type`：FUNCTION 或 EVENT
- `@tc.size`：SMALLTEST / MEDIUMTEST / LARGETEST
- `@tc.level`：LEVEL0 / LEVEL1 / LEVEL2 / LEVEL3 / LEVEL4

### 2.4 平台兼容性（强制）

- ✅ 只测试 `Platform.OS === 'harmony'` 分支中定义的 API
- ❌ 禁止测试仅在 iOS/Android 分支中存在的 API
- ✅ 路径常量使用 HarmonyOS 版本

### 2.5 断言方法（强制）

- ✅ 只能使用 Jest 断言方法：`toBe`, `toEqual`, `toBeTruthy`, `toBeFalsy`, `toBeDefined`, `toHaveBeenCalledWith`, `toHaveBeenCalledTimes`, `rejects.toThrow` 等
- ❌ 不要使用 Hypium 断言方法（`assertEqual`, `assertTrue` 等）

### 2.6 Mock 规范（强制）

- 所有原生模块必须通过 `jest.mock()` 模拟
- `jest.mock()` 必须在 `import` 之前
- Mock 必须覆盖所有导出的方法和常量
- 异步方法使用 `mockResolvedValue` / `mockRejectedValue`
- 同步方法使用 `mockReturnValue`

---

## 三、默认规范（可覆盖）

### 3.1 测试文件输出路径

```
{RN_TEST_PROJECT}/__tests__/
├── [库名简写]Test.test.ts
├── [库名简写]EventTest.test.ts
├── [库名简写]PermTest.test.ts
└── [库名简写]UtilsTest.test.ts
```

### 3.2 Mock 文件输出路径

```
{RN_TEST_PROJECT}/__mocks__/
└── @react-native-ohos/
    └── [库名]/
        └── index.ts
```

### 3.3 测试设计文档命名

```
[库名].test.design.md
```

### 3.4 测试级别默认分配

| API 类型 | 默认级别 |
|---------|---------|
| 核心流程 | LEVEL0 |
| 正常参数 | LEVEL1 |
| 返回值 | LEVEL1 |
| 权限 | LEVEL1 |
| 边界值 | LEVEL2 |
| 事件 | LEVEL2 |
| 错误码 | LEVEL3 |
| 常量 | LEVEL3 |

---

## 四、三方库配置模板

为特定三方库创建配置文件时，使用以下模板：

```markdown
# [库名] XTS 测试配置

## 基础信息

- 库名：@react-native-ohos/[库名]
- 库名简写：[简写]
- 版本：[版本号]
- 源码路径：[oh_modules 路径]

## API 分类

### TurboModule 方法

| 方法名 | 参数 | 返回值 | 类型 | Mock 策略 |
|--------|------|--------|------|----------|
| ... | ... | ... | 同步/异步 | mockReturnValue/mockResolvedValue |

### 事件列表

| 事件名 | 回调参数 | Mock 策略 |
|--------|---------|----------|
| ... | ... | jest.fn() |

### 常量列表

| 常量名 | 类型 | HarmonyOS 可用 |
|--------|------|---------------|
| ... | ... | ✅/❌ |

## 特殊规则

- [规则1]
- [规则2]

## 已知问题

- [问题1]
- [问题2]

## 权限需求

| 权限名 | 涉及 API |
|--------|---------|
| ... | ... |
```
