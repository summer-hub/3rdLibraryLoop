## RNOH 鸿蒙适配包版本字段双层语义（re-export 架构）

### 问题现象
验收/核验 RNOH 三方库升级时，按字面直读 `packages/{lib}/package.json` 的 `version` 字段会误判核验失败。典型案例：react-native-mmkv 升级到上游 4.3.2 后，`@react-native-ohos/react-native-mmkv` 包的 `version` 仍为 4.0.0，且与交付物 tgz 文件名 `react-native-ohos-react-native-mmkv-4.0.0.tgz` 一致——这并非升级不到位。

### 解决方案
鸿蒙适配包采用 re-export 架构（JS 层仅 re-export 上游 npm 包）时，版本字段具有双层语义：
- `version` 字段 = 鸿蒙适配包**自身**的版本号（历史沿袭，可能与上游版本完全不同步），与交付物 tgz 文件名对应；
- `dependencies` 中的上游源库条目（如 `"react-native-mmkv": "4.3.2"`）= 实际生效的上游版本，上游升级即依赖升级。

核验步骤：
1. 先读版本差异分析报告，确认包架构（re-export / 源内复制 / fork）——不同架构下"上游版本"所在字段不同；
2. re-export 架构 → 检查 `dependencies` 中上游源库条目；源内复制 → 检查 `version` 或源码内版本标注；
3. 与交付物 tgz 文件名交叉确认适配包自身版本；
4. 在核验记录中显式写明该语义说明，避免后续循环再次踩坑。

### 结果
react-native-mmkv（上游 4.3.1→4.3.2）核验实测：`version: 4.0.0` 为适配包自身版本（升级全程未变），`dependencies.react-native-mmkv: 4.3.2` 为上游版本，判定核验通过。可复用结论：RNOH 三方库（@react-native-ohos/*）核验版本时，永远同时看 `version`（适配包自身）与 `dependencies`（上游源库）两个字段，并与 tgz 文件名交叉确认。