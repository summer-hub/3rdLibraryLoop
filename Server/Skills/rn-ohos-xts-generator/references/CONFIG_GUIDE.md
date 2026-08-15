# 配置扩展机制详解

> **rn-ohos-xts-generator** - 配置系统使用指南
> **版本**: 1.0.0
> **更新日期**: 2026-03-31

## 目录

- [一、配置系统概述](#一配置系统概述)
- [二、配置文件结构](#二配置文件结构)
- [三、配置优先级](#三配置优先级)
- [四、创建新三方库配置](#四创建新三方库配置)
- [五、配置最佳实践](#五配置最佳实践)

---

## 一、配置系统概述

rn-ohos-xts-generator 采用**分层配置系统**，支持从通用到特化的多级配置继承。

### 1.1 设计理念

- **通用配置**：所有 RN 三方库共享的基础规范
- **三方库配置**：特定三方库的专有规则和 API 信息
- **用户配置**：使用时指定的临时配置

### 1.2 配置继承关系

```
┌─────────────────────────────────────────┐
│         通用配置 (_common.md)           │
│    - 编号规范、命名规范、断言规则        │
└─────────────────┬───────────────────────┘
                  │ 继承
┌─────────────────▼───────────────────────┐
│    三方库配置 ({library}/_common.md)     │
│    - API 列表、特殊规则、已知问题        │
└─────────────────────────────────────────┘
```

---

## 二、配置文件结构

### 2.1 目录结构

```
references/
├── COMMON_CONFIG.md                    # 通用配置（所有三方库共享）
└── {library-name}_CONFIG.md            # 特定三方库的配置
```

### 2.2 通用配置文件

位置：`references/COMMON_CONFIG.md`

包含所有三方库共享的规范，详见该文件内容。

---

## 三、配置优先级

```
用户自定义配置 > 三方库配置 > 通用配置
```

**特殊规则**：通用配置中的核心强制规范不可被任何层级覆盖。

---

## 四、创建新三方库配置

### 4.1 创建步骤

1. 在 `references/` 下创建以 `{library-name}_CONFIG.md` 命名的配置文件
2. 按照模板填写配置信息

### 4.2 配置模板

```markdown
# [库名] XTS 测试配置

## 基础信息

- 库名：@react-native-ohos/[库名]
- 库名简写：[简写]
- 版本：[版本号]
- 源码路径：[oh_modules 路径]

## API 分类

### TurboModule 方法

| 方法名 | 参数 | 返回值 | 类型 | 实现状态 |
|--------|------|--------|------|---------|
| ... | ... | ... | 同步/异步 | ✅/❌ |

### 事件列表

| 事件名 | 回调参数 | 实现状态 |
|--------|---------|---------|
| ... | ... | ✅/⚠️ |

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

### 4.3 配置示例

```markdown
# react-native-audio XTS 测试配置

## 基础信息

- 库名：@react-native-ohos/react-native-audio
- 库名简写：AUDIO
- 版本：1.0.0
- 源码路径：oh_modules/@react-native-ohos/react-native-audio

## API 分类

### TurboModule 方法

| 方法名 | 参数 | 返回值 | 类型 | 实现状态 |
|--------|------|--------|------|---------|
| prepareRecordingAtPath | path: string, options: RecordingOptions | boolean | 同步 | ✅ |
| startRecording | 无 | void | 同步 | ✅ |
| stopRecording | 无 | void | 同步 | ✅ |
| pauseRecording | 无 | void | 同步 | ✅ |
| resumeRecording | 无 | void | 同步 | ✅ |
| isRecording | 无 | boolean | 同步 | ✅ |
| requestAuthorization | 无 | Promise<boolean> | 异步 | ✅ |
| checkAuthorizationStatus | 无 | Promise<boolean> | 异步 | ❌ |

### 事件列表

| 事件名 | 回调参数 | 实现状态 |
|--------|---------|---------|
| onProgress | { currentTime: number, currentMetering: number } | ⚠️ 可能不稳定 |
| onFinishRecording | { status: string, audioFileURL: string } | ⚠️ 可能不稳定 |

### 常量列表

| 常量名 | 类型 | HarmonyOS 可用 |
|--------|------|---------------|
| FilesDirectoryPath | string | ✅ |
| CachesDirectoryPath | string | ✅ |
| TempsDirectoryPath | string | ✅ |
| MainBundlePath | string | ❌ |
| DocumentDirectoryPath | string | ❌ |
| LibraryDirectoryPath | string | ❌ |

## 特殊规则

- onProgress 事件可能不稳定，测试需设置 10 秒超时
- 使用 FilesDirectoryPath 而非 DocumentDirectoryPath

## 已知问题

- checkAuthorizationStatus 在 HarmonyOS 端未实现
- emitDeviceEvent 可能不触发

## 权限需求

| 权限名 | 涉及 API |
|--------|---------|
| ohos.permission.MICROPHONE | startRecording |
```

---

## 五、配置最佳实践

### 5.1 何时创建三方库配置

- 当三方库有特殊的测试规则时
- 当三方库有已知的 API 限制时
- 当三方库需要特殊的权限配置时

### 5.2 配置维护

- 三方库版本更新时，同步更新配置
- 发现新的已知问题时，及时补充
- API 实现状态变化时，及时更新
