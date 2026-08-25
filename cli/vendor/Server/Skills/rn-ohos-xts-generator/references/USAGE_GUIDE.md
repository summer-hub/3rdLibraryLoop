# 使用方式详解

> **rn-ohos-xts-generator** - RN 鸿蒙化三方库 XTS 测试用例生成器

## 快速导航

- [使用方式对比](#使用方式对比)
- [方式1：完整生成](#方式1完整生成推荐)
- [方式2：文档驱动生成](#方式2文档驱动生成)
- [方式3：覆盖率驱动](#方式3覆盖率驱动)
- [方式4：单 API 测试](#方式4单-api-测试)
- [常见使用场景](#常见使用场景)
- [常见问题](#常见问题)

---

## 使用方式对比

| 使用方式 | 适用场景 | 输入 | 输出 |
|---------|---------|------|------|
| **方式1：完整生成** | 新库首次生成 | 库名 | 完整测试套件 + 设计文档 |
| **方式2：文档驱动生成** | 无源码环境 | 接口规格说明文档 | 完整测试套件 + 设计文档 |
| **方式3：覆盖率驱动** | 补充缺失测试 | 覆盖率报告 | 补充测试用例 |
| **方式4：单 API 测试** | 针对性测试 | 库名 + API 名 | 指定 API 的测试用例 |

### 选择建议

- **新库首次测试** → 方式1（完整生成）
- **无源码环境** → 方式2（文档驱动生成）
- **已有测试需补充** → 方式3（覆盖率驱动）
- **修复特定问题** → 方式4（单 API 测试）

---

## 方式1：完整生成（推荐）

### 适用场景

- ✅ 新库首次生成 XTS 测试
- ✅ 需要完整的测试覆盖
- ✅ 需要测试设计文档

### 使用格式

```markdown
请使用 rn-ohos-xts-generator 为 @react-native-ohos/[库名] 生成 XTS 测试用例
```

### 使用示例

**示例1：为 react-native-audio 生成测试**

```markdown
请使用 rn-ohos-xts-generator 为 @react-native-ohos/react-native-audio 生成 XTS 测试用例
```

### 执行流程

1. 源码探查（JS 入口、TurboModule Spec、ArkTS 实现）
2. 平台兼容性分析
3. 覆盖率分析（如有现有测试）
4. 测试用例生成
5. 测试设计文档生成
6. 格式化和验证

### 输出

```
{RN_TEST_PROJECT}/
├── __tests__/
│   ├── [库名简写]Test.test.ts
│   ├── [库名简写]EventTest.test.ts
│   ├── [库名简写]PermTest.test.ts
│   └── [库名简写]UtilsTest.test.ts
├── __mocks__/
│   └── @react-native-ohos/
│       └── [库名]/
│           └── index.ts
├── jest.config.js
├── jest.setup.js
├── package.json
└── [库名].test.design.md
```

---

## 方式2：文档驱动生成

### 适用场景

- ✅ 无源码环境（无 `oh_modules`/`node_modules`）
- ✅ 有接口规格说明文档
- ✅ 需要完整的测试覆盖

### 使用格式

```markdown
请使用 rn-ohos-xts-generator 基于接口规格说明文档为 @react-native-ohos/[库名] 生成 XTS 测试用例

接口规格说明文档路径：[文档路径或直接粘贴文档内容]
```

### 使用示例

```markdown
请使用 rn-ohos-xts-generator 基于接口规格说明文档为 @react-native-ohos/react-native-audio 生成 XTS 测试用例

接口规格说明文档路径：/path/to/react-native-audio-api-spec.md
```

### 执行流程

1. 文档解析（提取 API 列表、方法签名、事件定义）
2. Mock 模块生成
3. 测试用例生成
4. 测试设计文档生成
5. 格式化和验证

### 输出

```
{用户指定目录}/[库名]-xts/
├── __tests__/
│   ├── [库名简写]Test.test.ts
│   ├── [库名简写]EventTest.test.ts
│   └── [库名简写]UtilsTest.test.ts
├── __mocks__/
│   └── @react-native-ohos/
│       └── [库名]/
│           └── index.ts
├── jest.config.js
├── jest.setup.js
├── package.json
└── [库名].test.design.md
```

---

## 方式3：覆盖率驱动

### 适用场景

- ✅ 已有部分测试用例
- ✅ 需要补充缺失的测试
- ✅ 基于覆盖率报告定向生成

### 使用格式

```markdown
请使用 rn-ohos-xts-generator 基于覆盖率报告为 @react-native-ohos/[库名] 补充测试用例

覆盖率报告：
[粘贴覆盖率报告或描述缺失的 API]
```

### 使用示例

```markdown
请使用 rn-ohos-xts-generator 基于覆盖率报告为 @react-native-ohos/react-native-audio 补充测试用例

覆盖率报告：
- pauseRecording: 无测试用例
- resumeRecording: 无测试用例
- onProgress 事件: 无测试用例
- onFinishRecording 事件: 无测试用例
```

---

## 方式4：单 API 测试

### 适用场景

- ✅ 为特定 API 生成测试
- ✅ 修复特定问题后补充测试
- ✅ 快速验证

### 使用格式

```markdown
请使用 rn-ohos-xts-generator 为 @react-native-ohos/[库名] 的 [API名] 生成测试用例
```

### 使用示例

```markdown
请使用 rn-ohos-xts-generator 为 @react-native-ohos/react-native-audio 的 pauseRecording 生成测试用例
```

---

## 常见使用场景

### 场景1：新三方库首次 XTS 测试

```markdown
请使用 rn-ohos-xts-generator 为 @react-native-ohos/react-native-webview 生成 XTS 测试用例
```

### 场景2：无源码环境，基于文档生成

```markdown
请使用 rn-ohos-xts-generator 基于接口规格说明文档为 @react-native-ohos/react-native-linear-gradient 生成 XTS 测试用例

接口规格说明文档路径：/path/to/react-native-linear-gradient-api-spec.md
```

### 场景3：补充缺失测试

```markdown
请使用 rn-ohos-xts-generator 为 @react-native-ohos/react-native-audio 补充以下 API 的测试：
- pauseRecording
- resumeRecording
- onProgress 事件
```

### 场景4：分析测试覆盖率

```markdown
请使用 rn-ohos-xts-generator 分析 @react-native-ohos/react-native-audio 的 XTS 测试覆盖率
```

---

## 常见问题

### Q1: 生成的测试用例调用了不存在的 API

**原因**：使用了 iOS/Android 分支的 API

**解决**：确保 `.oh-xts-config.json` 中配置了 `RN_TEST_PROJECT` 路径，技能会自动探查 HarmonyOS 可用的 API。

### Q2: 事件测试超时

**原因**：HarmonyOS 端 `emitDeviceEvent` 可能不稳定

**解决**：在 Jest 测试中使用 `jest.fn()` 直接模拟事件回调，避免依赖原生事件触发。

### Q3: 权限相关测试失败

**原因**：未请求运行时权限

**解决**：技能会自动为涉及权限的 API 生成权限请求测试，使用 `mockResolvedValue` 模拟权限结果。

### Q4: 如何为新三方库添加配置

在 `references/` 下创建以 `{library-name}_CONFIG.md` 命名的配置文件。参考 `COMMON_CONFIG.md` 中的模板。

### Q5: 无源码环境如何生成测试

使用文档驱动模式（方式2），提供接口规格说明文档即可生成测试用例，无需配置 `RN_TEST_PROJECT`。
