# 测试覆盖率分析器

---

## 一、模块概述

测试覆盖率分析器用于分析现有 XTS 测试文件，识别已覆盖和未覆盖的 API，为补充测试用例提供依据。

---

## 二、分析目标

### 2.1 测试套件信息

- describe 块名称
- 测试函数（it）列表
- 测试级别分布

### 2.2 API 覆盖信息

- 已测试的方法列表
- 已测试的参数组合
- 已测试的事件
- 已测试的错误码
- 已测试的边界值

### 2.3 测试模式识别

- TurboModule 方法测试
- NativeEventEmitter 事件测试
- NativeComponent 组件测试
- 权限相关测试

---

## 三、分析步骤

### 3.1 定位测试文件

```bash
# RN 三方库 XTS Jest 测试文件通常位于
{RN_TEST_PROJECT}/__tests__/
# 或用户指定的测试目录
```

### 3.2 提取测试用例信息

搜索测试文件中的模式：

```bash
# 搜索所有 describe 块
grep -r "describe(" __tests__/ --include="*.test.ts"

# 搜索所有 it 函数
grep -r "it(" __tests__/ --include="*.test.ts"

# 搜索所有 @tc.number
grep -r "@tc.number" __tests__/ --include="*.test.ts"
```

### 3.3 与 API 清单对比

将提取的测试用例与源码解析阶段输出的 API 清单进行对比：

```
=== 覆盖率分析报告 ===

[总 API 数] 10
[已覆盖] 6 (60%)
[未覆盖] 4 (40%)

[已覆盖 API]
✅ prepareRecordingAtPath - 3 个测试用例
✅ startRecording - 2 个测试用例
✅ stopRecording - 2 个测试用例
✅ isRecording - 1 个测试用例
✅ requestAuthorization - 1 个测试用例
✅ AudioUtils.FilesDirectoryPath - 1 个测试用例

[未覆盖 API]
❌ pauseRecording - 无测试用例
❌ resumeRecording - 无测试用例
❌ onProgress 事件 - 无测试用例
❌ onFinishRecording 事件 - 无测试用例

[测试级别分布]
LEVEL0: 1 个
LEVEL1: 5 个
LEVEL2: 3 个
LEVEL3: 1 个
```

---

## 四、覆盖率驱动模式

### 4.1 触发条件

当用户提供覆盖率报告或要求补充测试时，使用覆盖率驱动模式。

### 4.2 处理流程

```
1. 读取覆盖率报告（或执行覆盖分析）
2. 提取未覆盖的 API 列表
3. 按优先级排序未覆盖项
4. 为每个未覆盖项生成测试用例
5. 输出补充测试文件
```

### 4.3 优先级排序

| 优先级 | 未覆盖项类型 | 说明 |
|--------|------------|------|
| P0 | 核心方法 | 库的主要功能方法 |
| P1 | 状态查询方法 | 返回状态信息的方法 |
| P1 | 权限方法 | 涉及权限的方法 |
| P2 | 事件回调 | NativeEventEmitter 事件 |
| P2 | 辅助方法 | pause/resume 等 |
| P3 | 常量验证 | 路径常量等 |

---

## 五、输出格式

### 5.1 覆盖率报告

```
=== @react-native-ohos/react-native-audio 覆盖率报告 ===

总 API 数: 10
已覆盖: 6 (60%)
未覆盖: 4 (40%)

建议补充的测试用例:
1. [P0] pauseRecording - 正常暂停流程
2. [P0] resumeRecording - 正常恢复流程
3. [P1] onProgress 事件 - 录音进度回调
4. [P1] onFinishRecording 事件 - 录音完成回调
```

### 5.2 补充测试建议

根据覆盖率分析结果，生成具体的补充测试建议，包括：
- 需要补充的测试用例名称
- 建议的测试级别
- 建议的测试类型（PARAM/ERROR/RETURN/EVENT）
