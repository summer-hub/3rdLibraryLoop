# KI-021 react-native-video：播放本地视频异常

- **元数据**: `rule: R-17` · `verified: diff` · `source: community-issue` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-video/pull/66（merged，12 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-video-66.md](../pr-info/rntpc_react-native-video-66.md)

## 现象

播放本地视频异常——本地 rawfile 视频无法正常播放。

## 根因

1. 本地视频（asset://）通过 getRawFd 获取 AVFileDescriptor 直接设置 fdSrc，但 rawfile 在 HAP 包内 offset 不为 0，AVPlayer 对 offset!=0 的 fd 在某些版本有 bug（报 5400106 错误）；2. switchVideo 中重复调用 bindState() 注册事件监听器，导致 onStateChange 多次触发，非 IDLE 状态重复设置 url/fdSrc 引发 5400102 错误；3. 文件资源（rawfile fd）未在切换源时及时关闭导致泄漏。

## 错误代码（修复前）

```typescript
// ① asset:// 直接用 getRawFd 的 fd（offset!=0）
if (this.srcParam.startsWith('asset')) {
    let fileDescriptor = await getContext(this).resourceManager.getRawFd(`assets/${fileUrl}`);
    src = fileDescriptor;  // ← offset!=0 导致 AVPlayer bug
}

// ② switchVideo 中重复绑定事件
switchVideo(newUrl) {
    this.bindState();  // ← 每次切换都重复注册事件监听器
    // ...
}

// ③ 文件关闭无 pendingClose 机制
closeFsRawFd() {
    if (typeof this.previousSrc === "string") {
        getContext(this).resourceManager.closeRawFd(this.previousSrc, callback);  // ← 异步关闭，可能时序不对
    }
}
```

## 正确代码（修复后）

```typescript
// ① asset:// 拷贝到沙箱临时目录后用 file:// 播放
if (this.srcParam.startsWith('asset')) {
    const destPath = `${cacheDir}/${cacheFileName}`;
    // ② 检查缓存避免重复拷贝
    if (needCopy) {
        const rawFdInfo = await context.resourceManager.getRawFd(rawFilePath);
        const rawFile = fs.openSync(rawFilePath);
        fs.copyFileSync(rawFile.fd, destPath);
        fs.closeSync(rawFile);
        context.resourceManager.closeRawFdSync(rawFilePath);
    }
    src = `file://${destPath}`;  // ③ 用 file:// URI 播放
}

// ④ switchVideo 不再重复绑定事件
switchVideo(newUrl) {
    // 注意：不要在这里调用 bindState() ← 移除重复绑定
    // ...
}

// ⑤ pendingClose 机制：旧 fd 在新源 INITIALIZED 后关闭
if (this.playerThis && typeof this.playerThis.closeOldFd === 'function') {
    this.playerThis.closeOldFd();  // ⑥ 新源加载成功后关闭旧 fd
}

// ⑦ aboutToDisappear 有 try-catch 保护
aboutToDisappear() {
    try {
        this.playVideoModel.release()
    } catch (err) {
        Logger.error(TAG, `release error: ${JSON.stringify(err)}`);
    }
    this.closeFsRawFd()
}
```

## 修复方式

1. asset:// 视频源拷贝到沙箱临时目录后用 file:// URI 播放（避免 rawfile offset 问题）；2. switchVideo 移除重复 bindState() 调用；3. 引入 pendingCloseSrc 机制，旧 fd 在新源 INITIALIZED 后安全关闭；4. url 参数增加有效性校验（空字符串不设置源）；5. aboutToDisappear 中 release/close 操作有 try-catch 保护。