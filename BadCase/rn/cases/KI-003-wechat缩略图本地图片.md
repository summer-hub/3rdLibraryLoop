# KI-003 react-native-wechat-lib：shareWebpage 缩略图不支持本地图片

- **元数据**: `rule: R-02, R-03` · `verified: diff` · `source: community-issue` · `severity: high`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-wechat-lib/pull/15（merged，核心 3 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-wechat-lib-15.md](../pr-info/rntpc_react-native-wechat-lib-15.md)

> **复合问题**：本案例同时命中 R-02（URI 形态缺失）与 R-03（附属操作失败阻断主流程），是同一处代码的两个缺陷面。

## 现象

分享网页时 thumbImageUrl 传本地图片报错，无法跳转微信（用户原报告聚焦"下载报错"，实际 patch 证实根因是本地 URI 形态缺失）。

## 根因

缩略图加载只实现了 http 下载一种形态，data:/asset://rawfile 等本地 URI 形态直接走下载逻辑必然失败；且下载失败直接 callback 错误阻断分享主流程。

## 错误代码（修复前，仅 http 下载一种形态）

```typescript
let thumbImageUrl = (message.thumbImageUrl ? message.thumbImageUrl : null);
if (thumbImageUrl != null && !(thumbImageUrl === "")) {
  await new Promise<void>((resolve) => {
    this.downloadImageWithUrl(thumbImageUrl!, async (imageData: ArrayBuffer) => {
      if (!imageData) {
        callback("shareWebpage Failed to retrieve imageData", null);  // ← 本地 URI 走下载必然失败，且阻断主流程
        return;
      }
      // ... 压缩后 resolve
    }, callback);
  })
}
```

## 正确代码（修复后，按前缀分支覆盖多形态）

```typescript
async loadThumbImage(thumbImageUrl: string, mediaMessage: wxopensdk.WXMediaMessage): Promise<void> {
  const getBytes = (): Promise<ArrayBuffer> => {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      if (thumbImageUrl.startsWith('http://') || thumbImageUrl.startsWith('https://')) {
        this.downloadImageWithUrl(thumbImageUrl, resolve, reject);          // ① 远程：下载
      } else if (thumbImageUrl.startsWith('data:')) {
        const decoded = new util.Base64Helper().decodeSync(/* base64 部分 */);
        resolve(decoded.buffer);                                            // ② data: base64 解码
      } else {
        let rawFilePath = thumbImageUrl;                                    // ③ asset:// / RAWFILE
        if (rawFilePath.startsWith(ASSET_PREFIX)) { rawFilePath = 'assets/' + rawFilePath.substring(ASSET_PREFIX.length); }
        else if (rawFilePath.startsWith(RAWFILE_PREFIX)) { rawFilePath = rawFilePath.substring(RAWFILE_PREFIX.length); }
        resolve(getContext(this).resourceManager.getRawFileContentSync(rawFilePath).buffer);
      }
    });
  };
  const imageData = await getBytes();
  // ... 压缩 + imageSource.release() / thumbPixel.release() 资源释放
}
```

## 修复方式

抽取统一 loadThumbImage 方法，按前缀分支：http(s) 走下载、data: 走 base64 解码、asset://RAWFILE 走 resourceManager，各形态独立处理后统一压缩；同时补资源释放（imageSource.release/thumbPixel.release）。

> **R-03 视角注**：本 PR 将多形态加载收敛进 loadThumbImage，但远程下载失败仍会 reject（未完全降级）。理想模式应为 try-catch 包裹附属操作、失败置空 thumbData 继续分享——R-03 规则"正确特征"描述的是理想模式。
