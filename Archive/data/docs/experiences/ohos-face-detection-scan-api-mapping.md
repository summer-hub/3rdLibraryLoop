## 鸿蒙人脸检测/取帧/码制过滤 API 对等性核查结论（RN camera-kit 适配锚点）

### 问题现象
RN react-native-camera-kit 18.x 新增人脸检测能力（onFaceDetected / onFaceDetectionInstallStatus 事件、faceDetectionEnabled 等 props）、码制过滤（allowedBarcodeTypes），需核查鸿蒙侧 Kit 对等性后才能下「可否适配」结论。

### 解决方案
新原生能力先查 Kit 对等性再下结论。本次核查锚点（devecocli docs search / 官方文档验证）：

- **人脸检测** → `@kit.CoreVisionKit` `faceDetector`（API 12+）：`detect(VisionInfo) → Face[]{pose{yaw,pitch,roll}, rect, points}`。约束：**仅接受 RGBA_8888 PixelMap、面向图片而非视频流、需限流**
- **取帧** → `image.ImageReceiver`（readLatestImage）+ 相机预览流 surface
- **码制过滤** → `scanCore.ScanType` 枚举（14 种，覆盖绝大部分 CodeFormat）。例外：`code-39-mod-43`（iOS-only）无对等；`interleaved-2of5` 近似映射 ITF14_CODE 需实测
- **通路冲突风险识别**：鸿蒙现有扫码走 `customScan(ViewControl)`（ScanKit 独占 surface），人脸检测需独立 ImageReceiver 支路 ——「扫码 + 人脸检测同时开启」的通路并存策略是适配阶段的重点验证项，分析报告应显式提示

### 结果
Kit 对等性核查支持「人脸检测可适配但有限制」的结论：需 RGBA_8888 像素格式转换 + 调用限流 + 独立取帧通路设计；码制过滤基本可覆盖（2 个例外项需降级或实测）。