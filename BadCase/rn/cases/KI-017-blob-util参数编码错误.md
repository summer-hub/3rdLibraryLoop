# KI-017 react-native-blob-util：字符串参数被错误转为文件流

- **元数据**: `rule: R-13` · `verified: diff` · `source: community-issue` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-blob-util/pull/23（merged，1 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-blob-util-23.md](../pr-info/rntpc_react-native-blob-util-23.md)

## 现象

使用 react-native-blob-util 调用接口传递参数时，默认把 value 为 string 字符数字的参数（如 expectedQuota）转换成文件流形式传递给服务端，导致服务端报错。

## 根因

HTTP 请求体组装时（getABData 方法），当 data 为非 path 路径时使用 `buffer.alloc(data.length, data, 'base64')` 将其转化为二进制数据，字符串参数被错误地以 base64 编码为二进制流，而非以 utf-8 编码为文本。

## 错误代码（修复前）

```typescript
// ReactNativeBlobUtilReq.ts — 非 path 数据错误地 base64 编码
if (fs.类型判断) {
    // path 文件读取...
} else {
    buf = buffer.alloc(data.length, data, 'base64').buffer;  // ← 字符串被 base64 编码为二进制流
}
```

## 正确代码（修复后）

```typescript
// ReactNativeBlobUtilReq.ts — ① 非 path 数据用 utf-8 编码
if (fs.类型判断) {
    // path 文件读取...
} else {
    buf = buffer.from(data, 'utf-8').buffer;  // ② 字符串用 utf-8 编码，与上游保持一致
}
```

## 修复方式

HTTP 请求体组装时，非文件路径的字符串参数从 `buffer.alloc(data.length, data, 'base64')` 改为 `buffer.from(data, 'utf-8')`，与上游一致使用 utf-8 编码，避免字符串参数被误转为二进制文件流。