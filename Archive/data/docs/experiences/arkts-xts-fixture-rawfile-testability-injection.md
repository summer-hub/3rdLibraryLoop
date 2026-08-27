## XTS 测试夹具零依赖交付：rawfile 内置 + TestAbility 注入（替代 hdc file send 的首选方案）

### 问题现象
XTS 测试需要 MP3/ID3 样本文件等二进制夹具。传统方案依赖 `hdc file send` 手工推送文件到设备（需连接设备、逐个手工操作、CI 无法自动复跑）或外部网络下载（环境不可控、违反离线约束）。

### 解决方案
**夹具 rawfile 内置 + TestAbility 注入模式**（零网络、零手工设备操作）：

1. 夹具文件放置 `entry/src/ohosTest/resources/rawfile/`（随 ohosTest HAP 自动打包，已验证 unzip HAP 可见 `resources/rawfile/`）
2. 在 TestAbility.onCreate 中、`Hypium.hypiumTest` 调用之前，将 rawfile 夹具释放到应用沙箱目录：

```typescript
private prepareMp3Fixtures(): void {
  const fixtureFiles: string[] = ['notags.mp3', 'v1andv24tags.mp3', /* ... */];
  const filesDir: string = this.context.filesDir;
  GlobalContext.getContext().setValue('path', filesDir);  // 若库通过 GlobalContext 读取工作目录（如 save() 依赖 'path' 键），必须在此设置
  for (const name of fixtureFiles) {
    const content: Uint8Array = this.context.resourceManager.getRawFileContentSync(name);
    const file = fs.openSync(filesDir + '/' + name,
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    fs.writeSync(file.fd, content);
    fs.closeSync(file);
  }
}
```

关键点：
- `getRawFileContentSync` 一次性读入 rawfile 全部字节，配合 `fs.writeSync` 写入沙箱 `filesDir`（持久目录）
- 若库通过 GlobalContext 读取工作目录（如 mp3agic 的 save() 依赖 `path` 键），必须在注入夹具前设置该键
- 结构简单的样本（如极小 ID3 标签）可改用代码构造字节数组生成，完全不依赖资源文件；样本复杂/体积大时用 rawfile 内置

### 结果
mp3agic 47 个 XTS 用例的 MP3/ID3 样本全部随 HAP 打包注入，免设备手工操作、免外部脚本，CI 可直接复跑。**该模式为夹具交付首选方案；`hdc file send` 降为备选**（仅当夹具体积过大不适合随 HAP 打包时）。