## RN 库版本差距双口径记录与风险评级规则

### 问题现象
版本差距报告只记录单一口径（至任务指定版本或至 npm latest 之一）会误导升级决策；同时 major 版本号跨度容易被直接当作 breaking change 信号，导致风险高估或低估。

### 解决方案
1. **双口径记录**：同时给出「至任务指定版本」与「至 npm latest」两档差距，并在升级建议中提示可顺带对齐 latest patch。实测：camera-kit npm dist-tags.latest 为 18.0.1，任务指定对比 18.0.0，18.0.1 仅含 iOS 修复。
2. **major ≠ breaking change**：major 版本号不等于 breaking change，须逐条核对 CHANGELOG 的 breaking 项是否触及 JS 层接口契约：
   - camera-kit 18.0.0 官方明确声明「No known breaking changes were done」，major 仅为预防性标记（新增人脸检测）
   - 17.0.0 的 breaking（移除 `iOsSleepBeforeStarting`）是原生侧 only 属性，16.1.3 的 JS Spec 中本就不存在，对 JS 接口契约无影响，可降级处理

### 结果
风险评级基于「breaking 项是否触及 JS 层契约」逐条核对而非版本号跨度，评级更准确；双口径让升级决策同时看到至指定版本与至最新版的差距。