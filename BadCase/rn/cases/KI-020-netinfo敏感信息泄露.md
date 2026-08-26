# KI-020 react-native-netinfo：打印 MAC 地址和 IP 地址

- **元数据**: `rule: R-16` · `verified: diff` · `source: community-issue` · `severity: high` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-netinfo/pull/31（merged，1 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-netinfo-31.md](../pr-info/rntpc_react-native-netinfo-31.md)

## 现象

@react-native-ohos/netinfo 三方库打印敏感信息——RN 侧调用 NetInfoTurboModule 里面 getCurrentState 会打印 MAC 地址和 IP 地址，安全测试不过。

## 根因

日志中直接 JSON.stringify 打印了网络连接事件数据（netConnection 回调数据），其中包含 MAC 地址、IP 地址等敏感信息，安全扫描检测到敏感信息泄露。

## 错误代码（修复前）

```typescript
// NetInfoTurboModule.ts — 多处打印敏感数据
configure(config: Details): void {
    Logger.info('configure,' + JSON.stringify(config));  // ← 打印配置信息
}

getCurrentState(requestedInterface?: string): Promise<NetInfoState> {
    // ...
    Logger.info('events,' + JSON.stringify(events));  // ← 打印网络状态含 MAC/IP
}

this.netConnection.register((data) => {
    Logger.info('netConnection,' + JSON.stringify(data));  // ← 打印连接数据
});

this.netConnection.on('netAvailable', (data) => {
    Logger.info('netAvailable,' + JSON.stringify(data));  // ← 打印网络可用事件
});
```

## 正确代码（修复后）

```typescript
// NetInfoTurboModule.ts — ① 删除所有敏感日志
configure(config: Details): void {
    // ② 不再打印 config
}

getCurrentState(requestedInterface?: string): Promise<NetInfoState> {
    // ③ 不再打印 events
}

this.netConnection.register((data) => {
    // ④ 不再打印 netConnection 数据
});

this.netConnection.on('netAvailable', (data) => {
    // ⑤ 不再打印 netAvailable 数据
});
```

## 修复方式

删除所有打印网络连接原始数据的日志语句（Logger.info），包括 configure、getCurrentState、netConnection.register、netAvailable 等回调中的 JSON.stringify 日志。