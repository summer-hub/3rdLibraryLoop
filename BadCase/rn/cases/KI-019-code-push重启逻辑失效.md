# KI-019 react-native-code-push：restartApp 在 ON_NEXT_RESTART 模式下失效

- **元数据**: `rule: R-15` · `verified: diff` · `source: community-issue` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-code-push/pull/17（merged，76 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-code-push-17.md](../pr-info/rntpc_react-native-code-push-17.md)

## 现象

更新流程是先使用 ON_NEXT_RESTART 的 installMode 调用 CodePush.sync 方法，然后再视情况调用 CodePush.allowRestart()、CodePush.restartApp() 来重启 RN。但上面流程在 iOS 和安卓是正常的，在鸿蒙上无法工作，因为 this.installMode 是个属性，在调用 restartApp 的时候还是 -1。

## 根因

installMode 状态标志位在 restartApp 调用时未及时复位——ON_NEXT_RESTART(1) 模式下 restartApp 完成后 installMode 仍为 1，后续 restartApp 条件判断 `installMode === 0 || installMode === -1` 不满足，导致重启失效。同时 allow() 未设置 _allowed 标志，disallow 后 allow 无法恢复。

## 错误代码（修复前）

```typescript
// CodePushNativeModule.ts — ① restartApp 条件判断遗漏 ON_NEXT_RESTART
if (this.installMode === 0 || this.installMode === -1) {
    this.ctx.devToolsController.eventEmitter.emit("RELOAD", { reason: 'HotReload2' })
}
// ← ON_NEXT_RESTART(1) 分支未处理，installMode 未复位

// ② allow() 未设置 _allowed 标志
async allow() {
    return new Promise((resolve) => {
        Logger.info(TAG, "Re-allowing restarts");
        // ← 未设置 this._allowed = true
    })
}

// ③ restartAppInternal 无防重入保护
restartAppInternal(onlyIfUpdateIsPending: boolean) {
    this.loadBundle();  // ← 无 _restartInProgress 检查
}
```

## 正确代码（修复后）

```typescript
// ① ON_NEXT_RESTART 分支复位 installMode
if (this.installMode === 1) {
    this.installMode = -1;  // ② 复位为 -1
}

// ③ allow() 设置 _allowed 标志并处理排队
async allow() {
    this._allowed = true;
    if (this._restartQueue.length > 0) {
        let buf = this._restartQueue[0];
        this._restartQueue.splice(0, 1);
        this.restartAppInternal(buf);
    }
}

// ④ restartAppInternal 防重入 + 排队机制
restartAppInternal(onlyIfUpdateIsPending: boolean) {
    if (this._restartInProgress) {  // ⑤ 防重入
        this._restartQueue.push(onlyIfUpdateIsPending);
        return;
    } else if (!this._allowed) {  // ⑥ 允许检查
        this._restartQueue.push(onlyIfUpdateIsPending);
        return;
    }
    this._restartInProgress = true;
    // ...执行重启...
    this._restartInProgress = false;
    // ⑦ 处理排队请求
    if (this._restartQueue.length > 0) {
        let buf = this._restartQueue[0];
        this._restartQueue.splice(0, 1);
        this.restartAppInternal(buf);
    }
}
```

## 修复方式

1. ON_NEXT_RESTART 模式完成后复位 installMode 为 -1；2. allow() 设置 _allowed = true 并处理排队请求；3. restartAppInternal 增加防重入保护（_restartInProgress）和排队机制（_restartQueue）；4. disallow() 设置 _allowed = false。