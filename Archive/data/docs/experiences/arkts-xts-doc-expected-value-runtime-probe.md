## ArkTS 三方库 XTS 测试：用例文档预期值不可盲信，生成前用 Node 运行时探针实测锁定

### 问题现象
基于 XTS 用例描述文档直接生成断言代码时，文档中的预期结果大量来自对上游原版库（如 Java 版）行为的语义推断，与 ArkTS 移植版实际运行行为存在系统性偏差。mp3agic 案例实测：47 个用例中至少 8 处预期值错误，按文档值直接生成断言必然运行时失败。典型偏差类型：

- **返回类型偏差**：文档预期 `getTrack()` 返回 string `'5'`，实际返回 number `5`（unpackTag 直接存 charCode，未转 string）
- **越界访问偏差**：文档预期越界流派描述返回 `'Unknown'`，实际返回 `undefined`（数组负索引访问不抛异常，catch 回退分支不可达）
- **空值返回偏差**：文档预期空标签 `getChapters()` 返回空列表，实际返回 `null`（frameSet 为 null 时直接 return null）
- **默认值偏差**：文档预期新标签 `getPadding()` 默认 `true`，实际默认 `false`（字段声明 `protected padding: boolean = false`）
- **异常行为偏差**：文档预期非法编码编号的 `toBytes` 抛 IllegalArgumentException，实际不抛异常返回普通文本字节（`characterSets[9]` 越界取 undefined 而非抛异常）
- **构造参数语义偏差**：`new ID3v2PopmFrameData(false, null, 0)` 的空地址路径与文档描述不符（rating 非 null 时构造函数自动写入默认地址）

### 解决方案
**模式：生成前运行时探针锁定期望值**

```
流程：解析用例文档 → 提取全部断言点 → Node 探针直跑库源码逐条实测
     → 实测值回填生成 prompt → 按实测值生成代码 → 编译验证
```

**适用条件**：库源码为纯 TS/ETS 且平台依赖可桩化（`@ohos.hilog` 可空桩、`@ohos.buffer`/`@ohos.fileio` 可替换）。mp3agic 类库（源码全 `.ts`、平台依赖仅日志/缓冲/文件 IO）完全满足。

**Node 探针环境改造清单**（对库源码副本操作，约 30 分钟）：
1. 桩模块：`@ohos.hilog`（空实现）、`@ohos.buffer`、`@ohos.fileio`。⚠️ fileio flag 语义映射：鸿蒙 `0o102` = O_RDWR|O_CREAT|O_TRUNC，且库传的是数字不是字符串
2. import 路径补 `.ts` 扩展名（Node ESM 解析要求）：`perl -i -pe 's|from "(\./[A-Za-z0-9]+)"|from "./$1.ts"|g'`
3. ArkTS 专有语法降级：`static const` → `static`
4. 仅类型导入修正：接口文件改 `import type`，否则报 "does not provide an export named"
5. ⚠️ 探针特有陷阱：Node class-fields 语义下子类字段声明会覆盖父类构造函数赋值（如 `private path: string` 声明清空 `super(path)` 的赋值），需在探针副本中注释掉该声明。该问题仅存在于探针环境，ArkTS 编译器不产生此语义，勿"修复"真实源码

运行方式：Node 24+ `node --experimental-strip-types probe.mjs`，配合工程内真实样本夹具可覆盖从标签解析、字节序列化到 save 文件回读的全部断言路径。

**补充（真机签名阻断的替代验证）**：真机要求签名 HAP，本机可能无目标包名的调试 Profile（CLI 无法代签）。此时探针可作为替代验证手段完成全部用例期望值的运行时验证（含异常类型/消息、字节布局、保存回读闭环），报告中如实标注"未真机执行 + 原因 + 替代验证手段"。

### 结果
mp3agic 案例中，8 处文档偏差、5 处库源码缺陷全部在写代码前发现，47/47 用例断言值与库实际行为吻合，编译后零运行时断言返工。成本约 30 分钟环境搭建 + 15 分钟探针编写，收益远超成本。**结论：文档预期值不可盲信，必须实测；实测与文档不符时以实测为准并在代码注释标注偏差。**