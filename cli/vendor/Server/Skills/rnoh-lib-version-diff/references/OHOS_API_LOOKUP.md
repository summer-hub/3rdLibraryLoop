# 鸿蒙 API 核查（devecocli docs search）

版本差异分析中发现上游变更涉及原生能力时，**禁止仅凭 Android/iOS 实现或训练记忆推断 OHOS API**。凡涉及原生能力（相机、扫码、蓝牙、定位、文件、权限等），**必须**使用 `devecocli docs search` 完成核查后再写入报告。

## devecocli docs search 命令

### 命令格式

```
devecocli docs search <keywords...> --catalog <name> --format <fmt> --limit <n>
```

### 参数

| 参数 | 必选 | 说明 |
|------|------|------|
| `keywords...` | ✅ | 搜索关键词，多个关键词用空格隔开。将搜索版本说明、指南、API参考、最佳实践、FAQ、变更预告等中的内容 |
| `--catalog` | ❌ | 文档类别，默认 `all`（所有分类） |
| `--format` | ❌ | 输出格式：`default`（默认）、`json` |
| `--limit` | ❌ | 返回条数，默认 10。输出结果包括文档ID、标题、文档的概括内容 |

### `--catalog` 取值

| 取值 | 文档类别 |
|------|----------|
| `harmonyos-releases` | 版本说明 |
| `harmonyos-guides` | 指南 |
| `harmonyos-references` | API参考 |
| `best-practices` | 最佳实践 |
| `harmonyos-faqs` | FAQ |
| `harmonyos-roadmap` | 变更预告 |
| `all` | 所有分类（默认） |

### 输出内容

每条搜索结果包含：
- **文档ID** — 唯一标识
- **标题** — 文档标题
- **概括内容** — 文档摘要

使用 `--format json` 可获取结构化输出，便于程序化处理。

---

## 何时必须做 API 核查

满足**任一**条件即触发（纯 JS 库无 `harmony/` 原生逻辑时可跳过，报告标注「不适用 API 核查」）：

| 触发条件 | 示例 |
|----------|------|
| 上游新增/修改 Android/iOS 原生能力 | MLKit 人脸、CameraX 条码过滤 |
| 新增 Fabric prop / 事件需 ETS 实现 | `allowedBarcodeTypes`、`onFaceDetected` |
| TurboModule 方法需 OHOS 系统 API | 权限、文件、传感器 |
| 报告「需适配项」含 harmony ETS 动作 | 「ScanService 映射 scanTypes」 |
| 可行性结论为「待评估」 | 需查文档后才能判定可实现/不可实现 |

**不触发**：纯 JS 逻辑、README/CI、仅 build 版本号 bump、上游 iOS-only 且已判定「合理差异」。

---

## 核查流程（每个需适配特性执行一次）

```
上游 Android/iOS 变更
    ↓ 提取能力关键词（动词 + 名词 + Kit 名）
    ↓
① devecocli docs search --catalog harmonyos-references（必做）
    搜 API 参考 → 确认 API 签名、Interface/Enum、权限
    ↓
② devecocli docs search --catalog harmonyos-guides（推荐）
    搜指南 → 确认实现步骤、实时性/性能约束
    ↓
③ devecocli docs search --catalog best-practices（按需）
    搜最佳实践 → 确认性能约束、推荐实现
    ↓
④ 填写报告「鸿蒙 API 核查表」一行
    ↓
⑤ 反哺报告的适配建议与可行性结论
```

### Step ① 搜 API 参考（必做）

从上游变更提取 **Kit / 模块 / API 名**，搜索 API 参考文档：

```bash
# 示例：搜索 Scan Kit 的 scanCore 和 ScanType
devecocli docs search "ScanKit scanCore ScanType" --catalog harmonyos-references --limit 10

# 示例：搜索 Camera Kit 的 MetadataOutput
devecocli docs search "CameraKit MetadataOutput 人脸" --catalog harmonyos-references --limit 10

# 使用 JSON 格式获取结构化输出
devecocli docs search "photoAccessHelper MediaLibraryKit" --catalog harmonyos-references --format json --limit 10
```

记录到报告：
- **模块导入**（如 `import { scanCore } from '@kit.ScanKit'`）
- **关键 API 签名**（方法名、参数类型、返回值）
- **Enum 取值**（若有映射需求）
- **权限 / 系统能力**（文档有明确标注才写）

### Step ② 搜指南（推荐；实时性/权限/步骤不明时必做）

```bash
# 搜指南：扫码开发步骤
devecocli docs search "扫码 ScanKit 开发" --catalog harmonyos-guides --limit 10

# 搜指南：相机开发
devecocli docs search "相机预览 拍照 Camera" --catalog harmonyos-guides --limit 10
```

关注：**是否支持实时/流式**、**性能约束**、**与 Android/iOS 能力差异**、**推荐实现步骤**。

### Step ③ 搜最佳实践（按需）

```bash
# 性能约束不明确时搜最佳实践
devecocli docs search "实时人脸检测 CoreVision 性能" --catalog best-practices --limit 5
```

---

## 可行性判定（写入报告）

| 判定 | 含义 | 报告写法 |
|------|------|----------|
| ✅ **可实现** | 有明确 OHOS API，语义与上游基本一致 | 列出 Kit + API + 映射策略 |
| ⚠️ **部分实现** | 有 API 但能力子集不同（如仅矩形框、无 yaw/pitch） | 说明缺失字段与降级方案 |
| 🔶 **合理差异** | 上游 iOS/Android-only，OHOS 无对等且可 no-op | 文档标注 Support=No |
| ❌ **无法实现** | 文档明确不支持或无任何 Kit 可覆盖 | 说明依据 + 建议遗留项 |

**禁止**在无 API 核查的情况下使用「可实现」「无法实现」等结论。

---

## 上游能力 → 鸿蒙 Kit 速查（搜索时优先匹配）

| 上游领域（Android/iOS） | 优先搜的鸿蒙 Kit / 关键词 | 典型搜索词 |
|-------------------------|-------------------------|------------|
| 相机预览/拍照/闪光灯 | Camera Kit | `CameraKit PhotoSession 闪光灯` |
| 相机元数据/人脸框 | Camera Kit Metadata | `CameraKit MetadataOutput FACE_DETECTION` |
| 条码/二维码扫描 | Scan Kit | `ScanKit scanCore customScan ScanType` |
| 静态图 OCR/人脸 | Core Vision Kit | `CoreVision faceDetector 人脸检测` |
| 相册/媒体库 | Media Library Kit | `MediaLibraryKit photoAccessHelper` |
| 音频播放 | Media Kit / Audio Kit | `AVPlayer AudioKit 音频播放` |
| 权限 | Ability Kit | `abilityAccessCtrl 权限申请` |
| 蓝牙/BLE | Connectivity Kit | `bluetooth BLE 蓝牙` |
| 定位 | Location Kit | `geoLocationManager 定位` |
| 文件读写 | Core File Kit | `CoreFileKit fileIo 文件读写` |
| 网络 HTTP | Network Kit | `@ohos.net.http 网络请求` |

同一特性可能存在**多条 API 路径**（如人脸：Core Vision 静态图 vs Camera Metadata 实时框），须**都搜**后在报告中对比，不得只搜一条就下结论。

---

## 搜索技巧

### 1. 关键词组合策略

- **Kit 名 + 核心类名 + 方法名**：精确搜 API 参考
  ```bash
  devecocli docs search "ScanKit scanCore ScanType" --catalog harmonyos-references
  ```
- **中文能力描述**：搜指南和最佳实践
  ```bash
  devecocli docs search "实时扫码 相机" --catalog harmonyos-guides
  ```
- **英文 + 中文混合**：扩大覆盖面
  ```bash
  devecocli docs search "CameraKit 相机预览" --catalog all
  ```

### 2. 多 catalog 交叉验证

```bash
# 同一关键词搜不同 catalog
devecocli docs search "scanCore" --catalog harmonyos-references --limit 10
devecocli docs search "scanCore" --catalog harmonyos-guides --limit 10
devecocli docs search "scanCore" --catalog best-practices --limit 5
```

### 3. JSON 格式批量处理

```bash
# JSON 输出便于提取文档 ID 和标题
devecocli docs search "CameraKit" --catalog harmonyos-references --format json --limit 20
```

---

## 报告输出：鸿蒙 API 核查表（必填专节）

写入版本分析报告独立章节「**鸿蒙 API 核查**」。每行对应一个**上游原生能力增量**（不是每个 commit 一行，按整合主题一行即可）：

| 列 | 说明 |
|----|------|
| 上游能力 | 如 `allowedBarcodeTypes`、Android MLKit 实时人脸 |
| 上游实现摘要 | Android/iOS 用什么 API |
| 鸿蒙 Kit/API | 核查后的模块 + 关键 API（附搜索关键词） |
| 能力对比 | 与上游一致 / 子集 / 无对等 |
| 约束与风险 | 来自 guides / best-practices 的性能、权限、版本限制 |
| 可行性 | ✅ / ⚠️ / 🔶 / ❌ |
| 建议动作 | 具体 ETS 文件与实现策略 |
| API 核查状态 | 分析中 / 已完成 |

---

## 与 Android/iOS 映射方法

1. **读上游 diff**：确认 Android 类/方法（如 `setAllowedBarcodeTypes`）或 iOS `@objc` prop
2. **抽象能力**：过滤条码类型 / 实时人脸检测 / 延迟启动预览 等
3. **OHOS 关键词搜索**：用能力词搜 Kit，而非直接搜 Android 类名
4. **字段级映射**：在核查表中写清 upstream 字段 → OHOS 字段（例：`CodeFormat 'qr'` → `scanCore.ScanType.QR_CODE`）
5. **事件 payload 映射**：upstream `FaceData.yaw` → OHOS 若无则标 ⚠️ 部分实现

---

## 禁止事项

- **禁止**未执行 `devecocli docs search` 就写「鸿蒙用 XXX API 可实现」
- **禁止**只搜一个关键词就判定「无法实现」（须至少搜 API 参考 + 指南两个 catalog）
- **禁止**把 Core Vision Kit 静态检测与 Camera 实时能力混为一谈而不对比
- **禁止**在「鸿蒙 API 核查表」留空却给出总体「可实现/不可实现」结论
- **禁止**在分析阶段写具体 `.ets` 实现代码（只写 API 依据与策略）
