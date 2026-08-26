# R-02 资源 URI 形态分支覆盖类

- **状态**: active
- **严重级别**: high（特定 URI 形态下核心功能不可用）
- **适用范围**: 加载图片/音频/字体/bundle 等资源的库（ArkTS 层或 C++ 层）
  - 预筛特征: 代码中存在 URI 前缀判断逻辑（startsWith/rfind "asset://"/"http"/"file://"）或资源加载 API 调用（ImageKnife/getRawFile/http 下载）
- **问题本质**: 资源加载代码按前缀分支处理不同 URI 形态，但分支只覆盖了部分形态——同一前缀下混叠了多种实际来源（如 asset:// 既可能是 rawfile 资源也可能是沙箱文件路径），或遗漏 data:、热更新沙箱路径等鸿蒙运行环境实际会产生的形态
- **检查点**:
  1. 定位所有资源 URI 解析/加载入口，枚举其处理的前缀分支（http/https、asset://、resource://RAWFILE/、data:、file://、沙箱绝对路径）
  2. 对每个分支检查其加载方式是否与该形态的实际来源匹配（rawfile 资源走 resourceManager、沙箱文件走文件路径、data: 走 base64 解码）
  3. 检查同一前缀下是否存在多种实际来源混叠而未二次区分（重点：asset:// 前缀的 rawfile 与沙箱路径混叠）
  4. 比对上游原库 JS 层文档/类型定义中声明的 source 类型，确认鸿蒙侧分支覆盖了所有声明的形态
- **错误特征**: 前缀判断后单一加载方式（如 asset:// 一律 SetResource）；或只处理 http 下载，本地 URI 直接走下载逻辑必然失败
- **正确特征**: 每种 URI 形态有独立分支且加载方式匹配来源；形态判断基于完整前缀链（先判 rawfile 前缀再判 asset 前缀）；未识别形态有明确错误提示而非静默失败

## 来源案例

| 编号 | 库 | 现象 | 案例文件 |
|------|-----|------|----------|
| KI-002 | react-native-fast-image | 热更新图片加载失败 | [KI-002-fastImage热更新图片失败.md](../cases/KI-002-fastImage热更新图片失败.md) |
| KI-003 | react-native-wechat-lib | 缩略图不支持本地图片 | [KI-003-wechat缩略图本地图片.md](../cases/KI-003-wechat缩略图本地图片.md) |
