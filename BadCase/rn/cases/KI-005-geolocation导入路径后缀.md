# KI-005 react-native-geolocation：3.1.1 接入报错（IDE 爆红）

- **元数据**: `rule: R-05` · `verified: diff` · `source: community-issue` · `severity: low`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-geolocation/pull/24（merged，55 文件，核心修复 2 文件 4 行）
- **diff 材料**: [../pr-info/rntpc_react-native-geolocation-24.md](../pr-info/rntpc_react-native-geolocation-24.md)

## 现象

用户报告"3.1.1 版本的文件不对，按官方文档接入后直接报错"（用户以为是版本/产物问题）。

## 根因

实际 patch 证实是 index.ets/ts.ets 导入路径带 .ets 后缀导致 IDE 爆红，非版本/产物不一致问题——用户描述与实际根因偏差大，凸显必须看实际 diff。

## 错误代码（修复前，index.ets / ts.ets）

```typescript
import { GeoLocationPackage } from './src/main/ets/GeoLocationPackage.ets';  // ← 带 .ets 后缀
export * from './ts.ets';
```

## 正确代码（修复后）

```typescript
import { GeoLocationPackage } from './src/main/ets/GeoLocationPackage';     // ← 无后缀
export * from './ts';
```

## 修复方式

去除 index.ets/ts.ets 中导入路径的 .ets 后缀（核心修复 2 文件 4 行）；同 PR 附带补齐 example 工程、README、OAT.xml 等配套。
