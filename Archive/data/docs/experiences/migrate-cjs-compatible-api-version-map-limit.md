## migrate.cjs --compatible-api 版本上限陷阱与正确取值方法

### 问题现象

执行 `node migrate.cjs --compatible-api 26` 报 `未知 compatible-api 版本` 错误。根因：migrate.cjs 的 API_VERSION_MAP 存在版本上限（当前最高 24），设备 API 版本（26）超出映射表范围时直接传入即报错。而 SKILL 流程原指示"探测设备 API 版本作为 --compatible-api 传入"，未考虑此上限。

### 解决方案

correct 取值流程：
1. `hdc shell param get const.ohos.apiversion` 获取设备 API 版本
2. 若设备 API 超出脚本 API_VERSION_MAP 上限，读取 `DevEco-Studio.app/Contents/sdk/default/sdk-pkg.json` 的 `apiVersion` 字段获取已安装 SDK API 版本
3. 取 **min(设备 API, 已安装 SDK API)** 作为 `--compatible-api`（编译面向已安装 SDK，实际以已安装 SDK API 为准）
4. 重跑后校验：脚本输出含 `迁移完成`，且产物 `compatibleSdkVersion ≤ 设备 API`

### 结果

以已安装 SDK API(24) 作为 compatible-api 重跑迁移成功，编译验证通过。设备 API 高于 SDK API 时必须以 SDK API 为准，不可直接传设备 API。