# PR #23: fix:解决getABData返回数据乱码问题

- **状态**: merged
- **作者**: chenbaodi123
- **创建时间**: 2026-05-25T16:42:51+08:00
- **分支**: 72bugfix → br_rnoh0.72
- **变更文件数**: 1

## PR 描述

问题：ReactNativeBlobUtilReq.ts的startHttp方法中，组装http请求数据格式时（getABData）当data为非path路径后，会通过buffer.alloc(data.length, data, 'base64').buffer，将其转化为二进制数据，导致后端服务器接收到的数据不正确。
修改方案：跟上流保持一致，使用utf-8的格式返回数据

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `harmony/blobUtil/src/main/ets/ReactNativeBlobUtil/ReactNativeBlobUtilReq.ts` | ? | +1 | -1 |

## Diff

### `harmony/blobUtil/src/main/ets/ReactNativeBlobUtil/ReactNativeBlobUtilReq.ts`

```diff
@@ -314,7 +314,7 @@ export default class ReactNativeBlobUtilReq {
         fs.readSync(file.fd, buf);
         fs.closeSync(file);
       } else {
-        buf = buffer.alloc(data.length, data, 'base64').buffer;
+        buf = buffer.from(data, 'utf-8').buffer;
       }
       return buf;
     } catch(err) {

```
