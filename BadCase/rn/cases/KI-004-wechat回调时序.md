# KI-004 react-native-wechat-lib：shareWebpage 回调时序问题

- **元数据**: `rule: R-04` · `verified: diff` · `source: community-issue` · `severity: high`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-wechat-lib/pull/15（merged，与 KI-003 同 PR 复合问题）
- **diff 材料**: [../pr-info/rntpc_react-native-wechat-lib-15.md](../pr-info/rntpc_react-native-wechat-lib-15.md)

## 现象

shareWebpage 调用偶发无响应/结果异常（用户报告为下载报错无法跳转，实际 patch 证实含回调时序缺陷）。

## 根因

src/index.ts 中先调 nativeShareWebpage(data) 后注册 emitter.once 监听，原生响应可能先于监听到达而丢失；固定 transaction="webpage" 标识在重入场景混淆响应。

## 错误代码（修复前，先调用后注册 + 固定标识）

```typescript
return new Promise((resolve, reject) => {
  nativeShareWebpage?.(data);                    // ← 先调 native，响应可能先于监听到达
  emitter.once("SendMessageToWX.Resp", (resp) => {
    if (resp.errCode === 0) { resolve(resp); }
    else { reject(new WechatError(resp)); }
  });
});
// ArkTS 侧：req.transaction = "webpage";        // ← 固定字符串，重入场景混淆响应
```

## 正确代码（修复后，先注册后调用 + 唯一标识 + 无效响应过滤）

```typescript
return new Promise((resolve, reject) => {
  WechatLib.unregisterCallback("SendMessageToWX.Resp");   // ① 清理旧监听
  WechatLib.registerCallback("SendMessageToWX.Resp", (result) => {
    if (!result) { return; }                               // ② 过滤空响应
    const resp = result as WechatResponse & { code?: string; returnKey?: string };
    if (resp.code !== undefined || resp.returnKey !== undefined) { return; }  // 过滤错误码响应
    WechatLib.unregisterCallback("SendMessageToWX.Resp");
    if (resp.errCode === 0) { resolve(resp); } else { reject(new WechatError(resp)); }
  });
  nativeShareWebpage?.(data);                             // ③ 最后才调 native
});
// ArkTS 侧：req.transaction = util.generateRandomUUID().toString();  // 唯一标识
```

## 修复方式

调整为先 unregisterCallback 清旧 → registerCallback 注册（含空结果/错误码过滤）→ 最后调 native；transaction 改为 generateRandomUUID。
