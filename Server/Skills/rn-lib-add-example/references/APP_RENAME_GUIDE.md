# App 名称修改指南

> `scripts/create-example.cjs` 已自动完成以下全部修改点；本指南用于人工核对与脚本不可用时的手动修改。

## 名称派生规则

以库 `@react-native-ohos/react-native-sqlite-storage` 为例：

| 名称项 | 派生规则 | 示例值 |
|--------|----------|--------|
| 应用显示名（appName） | 去 scope、去 `react-native-` 前缀后 PascalCase + `Example` | `SqliteStorageExample` |
| RN 注册名（app.json name） | 短名中非字母数字字符转 `_` + `_example` | `sqlite_storage_example` |
| 鸿蒙包名（bundleName） | `com.rnoh.` + 短名小写（非 `[a-z0-9]` 转 `_`） | `com.rnoh.sqlite_storage` |
| npm 包名（package.json name） | 去 scope 包名 + `-example` | `react-native-sqlite-storage-example` |

用户显式指定 `--app-name` / `--bundle-name` 时以用户为准。

## 必改点位

| # | 文件 | 修改内容 |
|---|------|----------|
| 1 | `example/app.json` | `name` → RN 注册名（AppRegistry 用，必须是合法标识符，禁止连字符）；`displayName` → 应用显示名 |
| 2 | `example/package.json` | `name` → npm 包名（替换模板的 `react-native-harmony-tester`） |
| 3 | `example/harmony/AppScope/app.json5` | `bundleName` → 鸿蒙包名（替换模板残留的 `com.harmony.wechat.lib.demo`） |
| 4 | `example/harmony/AppScope/resources/base/element/string.json` | `app_name` 的 `value` → 应用显示名（桌面图标标签，`app.json5` 的 `label` 引用它） |
| 5 | `example/harmony/entry/src/main/resources/base/element/string.json` | `EntryAbility_label` 的 `value` → 应用显示名 |
| 6 | `example/harmony/entry/src/main/module.json5` | 移除模板残留的 `querySchemes: ["weixin"]` 整段（库确实需要 scheme 时再按需添加） |

## 完成后校验

1. `grep -rn "wechat\|weixin" example/` → 应无匹配（模板残留清零）
2. `grep -rn "harmony-tester\|RN Tester" example/ --include="*.json*"` → 应无匹配（改名完整）
3. `example/app.json` 的 `name` 与 `example/index.js` 中 `AppRegistry.registerComponent(appName, ...)` 读取的来源一致（index.js 自动读取 app.json，无需改动）
4. `bundleName` 全局唯一，不与其他已装应用冲突

## 安全清理（必做）

- 删除 `example/.npmrc`（若存在）：模板可能内嵌私有 registry 的明文 `_authToken`，任何含凭据的文件严禁带入交付物
- 删除 `example/.DS_Store` 等 macOS 元数据文件
- RNOH 0.77/0.82/0.84 全部依赖可从公共 registry（npmmirror）解析，无需私有源
