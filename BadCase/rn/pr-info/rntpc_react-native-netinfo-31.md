# PR #31: fix:删除高敏感日志打印

- **状态**: merged
- **作者**: chenbaodi123
- **创建时间**: 2026-06-01T18:25:36+08:00
- **分支**: 77_bugfix → br_rnoh0.77
- **变更文件数**: 1

## PR 描述

原因：日志打印输出mac地址等信息
方案：删除高敏感日志打印

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `harmony/netinfo/src/main/ets/NetInfoTurboModule.ts` | ? | +0 | -4 |

## Diff

### `harmony/netinfo/src/main/ets/NetInfoTurboModule.ts`

```diff
@@ -64,7 +64,6 @@ export class NetInfoTurboModule extends TurboModule {
   }
 
   configure(config: Details): void {
-    Logger.info('configure,' + JSON.stringify(config));
   }
 
   getCurrentState(requestedInterface?: string): Promise<NetInfoState> {
@@ -73,7 +72,6 @@ export class NetInfoTurboModule extends TurboModule {
     return new Promise(async (resolve, reject) => {
       try {
         const events = await this.createConnectionEvent()
-        Logger.info('events,' + JSON.stringify(events));
         resolve(events)
       } catch (e) {
         reject(e)
@@ -96,11 +94,9 @@ export class NetInfoTurboModule extends TurboModule {
     this.netConnection = connection.createNetConnection()
     // 先使用register接口注册订阅事件
     this.netConnection.register((data) => {
-      Logger.info('netConnection,' + JSON.stringify(data));
     })
     // 订阅网络可用事件
     this.netConnection.on('netAvailable', (data) => {
-      Logger.info('netAvailable,' + JSON.stringify(data));
       this.listenerGetCurrentState()
     })
     // 订阅网络阻塞状态事件

```
