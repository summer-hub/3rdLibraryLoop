# KI-022 react-native-audio-recorder-player：AAC 格式无法录制

- **元数据**: `rule: R-18` · `verified: diff` · `source: dtse` · `severity: medium` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-audio-recorder-player/pull/22（merged，15 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-audio-recorder-player-22.md](../pr-info/rntpc_react-native-audio-recorder-player-22.md)

## 现象

react-native-audio-recorder-player 音频格式不支持 AAC——用户设置 AudioMimeHarmony: 'audio/mp4a-latm'、AudioFileFormatHarmony: 'm4a' 等 AAC 参数后无法录制。

## 根因

鸿蒙侧 index.ts 的 AudioFormatHarmonyType 枚举中遗漏了 AAC 格式的枚举值，导致用户按上游文档配置 AAC 格式时无法匹配到正确的录制参数。

## 错误代码（修复前）

```typescript
// index.ts — AudioFormatHarmonyType 枚举中无 AAC
export const AudioFormatHarmonyType = {
    // ...其他格式...
    // ← 缺少 AAC 格式枚举值
};
```

## 正确代码（修复后）

```typescript
// index.ts — ① 补充 AAC 格式枚举
export const AudioFormatHarmonyType = {
    // ...其他格式...
    AAC: 'audio/mp4a-latm',  // ② 新增 AAC 格式
    // ③ 同时补充对应的录制参数映射
};
```

## 修复方式

在 AudioFormatHarmonyType 枚举中补充 AAC 格式的枚举值（audio/mp4a-latm），并添加对应的鸿蒙系统 API 音频编码参数映射，使枚举与上游社区支持的格式对齐。