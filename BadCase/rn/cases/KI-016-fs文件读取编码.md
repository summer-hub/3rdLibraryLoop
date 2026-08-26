# KI-016 react-native-fs：read 接口无法读取非文本文件

- **元数据**: `rule: R-13` · `verified: diff` · `source: community-issue` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-fs/pull/38（merged，24 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-fs-38.md](../pr-info/rntpc_react-native-fs-38.md)

## 现象

react-native-fs 的 read 接口以前只能读取文本文件，无法读取其他格式文件。

## 根因

read 接口底层使用了 readText API，而 readText 仅支持文本编码，二进制文件（图片/音频等）读取时解码失败；且文件关闭逻辑不在 finally 块中，异常时 fd 泄漏。

## 错误代码（修复前）

```typescript
// FsTurboModule.ts — read 使用 readText
read(path: string, length: number, position: number): Promise<string> {
    return new Promise((resolve, reject) => {
        let readTextOption: ReadTextOptions = { offset: position, length, encoding: this.UTF_8 };
        fs.readText(path, readTextOption, (err: BusinessError, str: string) => {  // ← 仅支持文本
            // ...
        });
    });
}

// readFile 中文件关闭不在 finally 块
let file = fs.openSync(path);
// ...读取循环...
fs.closeSync(file);  // ← 异常时跳过，fd 泄漏
```

## 正确代码（修复后）

```typescript
// FsTurboModule.ts — ① read 改用 readSync（通用二进制读取）
read(path: string, length: number, position: number): Promise<string> {
    return new Promise((resolve, reject) => {
        let file: fs.File | null = null;
        try {
            file = fs.openSync(path);
            // ② 用 readSync 循环读取二进制内容
            // ...
        } catch (e) {
            reject(e);
        } finally {  // ③ 文件关闭转移到 finally 块
            if (file) {
                try { fs.closeSync(file); } catch (closeErr) { /* log */ }
            }
        }
    });
}
```

## 修复方式

1. read 接口底层从 readText 改为 readSync（通用二进制读取）；2. 文件关闭逻辑从 try 块转移到 finally 块，确保异常时也关闭 fd。