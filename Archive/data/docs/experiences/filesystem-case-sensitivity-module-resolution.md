# 大小写不敏感文件系统导致模块解析静默失败

### 问题现象

在 macOS/Windows（大小写不敏感文件系统）上运行基于 TypeScript Compiler API 的分析工具时出现静默失真：

1. 库入口候选路径写死为 `library/Index.ets`（大写 I），而库实际文件是小写 `index.ets`
2. `fs.existsSync('library/Index.ets')` 在大小写不敏感文件系统上返回 `true`，函数返回**错误大小写**的路径
3. 但内容缓存（`fileContents`）的键来自 `fs.readdirSync` 的**真实小写**路径
4. 虚拟路径 `.../library/Index.ts` 在缓存中查不到 → `resolveModuleNames` 模块解析失败 → `checker` 类型推断全面失效 → 实例变量追踪返回空 → 所有"声明变量后调用实例方法"的匹配全部丢失

**最危险之处**：脚本不报错、不降级，静默输出严重偏低的覆盖率（mp3agic 案例漏报约 84 个接口）。该问题在 Linux（大小写敏感）CI 上不复现——`existsSync` 返回 false 走深度搜索分支，路径行为不同，属于典型的"本机能跑、CI 表现不同"类缺陷。

**典型特征信号**：类级覆盖率表中仅静态/工具类有覆盖、所有实例方法类为 0。

### 解决方案

路径匹配做大小写归一，两选一：

```js
// 方案 A（防御式）：精确查找失败后，构建小写键映射表二次查找
const lowerMap = new Map(Object.keys(fileContents).map(k => [k.toLowerCase(), k]));
const v = toPosix(candidate.replace(/\.ets$/, '.ts')).toLowerCase();
if (lowerMap.has(v)) resolvedPath = lowerMap.get(v);
```

方案 B（根治）：入口文件定位函数返回前，用 `fs.readdirSync` 的真实文件名做大小写归一，保证虚拟路径键与缓存键严格一致。

### 结果

mp3agic 案例应用方案 A 后，`@ohos/mp3agic` 模块解析恢复，类型推断生效，实例方法类（EncodedText、ID3v22/23/24Tag 等）覆盖率从 0 恢复正常。大小写归一补丁对大小写敏感平台（Linux）无副作用，可直接合入。该修复已合入 `analyze-xts-coverage.cjs`（arkts-library-xts-coverage SKILL v1.1.0）。