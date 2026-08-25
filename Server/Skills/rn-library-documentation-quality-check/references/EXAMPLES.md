# 文档质量检视示例

本文档展示基于一个假设的 RN 鸿蒙化三方库 `@react-native-ohos/community-netinfo` 的文档质量检视过程和输出示例。

> 说明：本示例为虚构场景，仅用于演示检视流程和报告格式。

---

## 一、输入场景

### 1.1 仓库结构

```
@react-native-ohos/community-netinfo/
├── README.md                    # 仅含安装命令，无功能说明
├── src/
│   ├── index.ts                 # 入口文件，export 无注释
│   ├── NetInfo.ts               # 核心实现
│   └── types.ts                 # 类型定义，部分有注释
├── ohos/
│   ├── NetInfoTurboModule.ets   # TurboModule 实现
│   ├── module.json5             # 权限声明
│   └── oh-package.json5
├── turbo/
│   └── NetInfoNativeComponent.d.ts  # 类型声明，无注释
├── example/                     # 示例目录
│   └── App.tsx                  # 示例代码
└── package.json                 # 无 CHANGELOG
```

### 1.2 README.md 内容

```markdown
# @react-native-ohos/community-netinfo

## Installation

```bash
npm install @react-native-ohos/community-netinfo
```

## Usage

```typescript
import NetInfo from '@react-native-ohos/community-netinfo';

NetInfo.fetch().then(state => {
  console.log(state.type);
});
```
```

### 1.3 源码片段

```typescript
// src/index.ts
export { default as NetInfo } from './NetInfo';
export { NetInfoState, NetInfoSubscription } from './types';

// src/NetInfo.ts
export default class NetInfo {
  static fetch(): Promise<NetInfoState> {
    return NetInfoTurboModule.getCurrentState();
  }

  static addEventListener(type: string, listener: (state: NetInfoState) => void): NetInfoSubscription {
    // ...
  }

  static configure(configuration: NetInfoConfiguration): void {
    // ...
  }
}

// src/types.ts
export interface NetInfoState {
  type: string;
  isConnected: boolean;
  isInternetReachable: boolean | null;
  details: NetInfoDetails | null;
}

export type NetInfoSubscription = () => void;
```

```typescript
// turbo/NetInfoNativeComponent.d.ts
export interface Spec extends TurboModule {
  getCurrentState(): Promise<NetInfoState>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}
```

```json5
// ohos/module.json5
{
  "module": {
    "requestPermissions": [
      { "name": "ohos.permission.GET_NETWORK_INFO" }
    ]
  }
}
```

---

## 二、检视结果示例

### 2.1 各维度评分明细

| 检视维度 | 权重 | 扣分 | 维度得分 | Critical数 | Major数 | Minor数 |
|----------|------|------|----------|-----------|---------|---------|
| API 文档完整性 | 20% | -20 | 0 | 1 | 4 | 1 |
| 鸿蒙化适配说明 | 20% | -20 | 0 | 1 | 3 | 0 |
| 代码仓基础信息 | 15% | -12 | 3 | 0 | 3 | 0 |
| 代码示例质量 | 10% | -8 | 2 | 0 | 2 | 0 |
| 变更记录与版本规范 | 10% | -4 | 6 | 0 | 1 | 0 |
| 文档与代码交叉验证 | 15% | -15 | 0 | 1 | 2 | 0 |
| 文档准确性与国际化 | 10% | -1 | 9 | 0 | 0 | 1 |

### 2.2 综合评分

**综合评分：20/100**

评分等级：极差

### 2.3 问题清单（摘要）

| # | 文件 | 行号 | 严重度 | 检视维度 | 编号 | 描述 |
|---|------|------|--------|----------|------|------|
| 1 | `src/NetInfo.ts` | L1 | 🔴 Critical | API 文档完整性 | AD-001 | `NetInfo` 类及所有方法无任何文档注释 |
| 2 | `turbo/NetInfoNativeComponent.d.ts` | L1 | 🟡 Major | API 文档完整性 | DT-001 | `.d.ts` 中 `Spec` 接口无注释 |
| 3 | `turbo/NetInfoNativeComponent.d.ts` | L2 | 🟡 Major | API 文档完整性 | DT-002 | `getCurrentState` 等方法无 TSDoc |
| 4 | `src/NetInfo.ts` | L3 | 🟡 Major | API 文档完整性 | TG-001, TG-002 | `fetch()` 缺少 `@param` 和 `@returns` |
| 5 | `src/NetInfo.ts` | L7 | 🟡 Major | API 文档完整性 | TG-006 | `addEventListener` 缺少 `@example` |
| 6 | `src/types.ts` | L1 | 🔵 Minor | API 文档完整性 | AD-004 | `NetInfoState` 注释中英混杂 |
| 7 | `README.md` | — | 🔴 Critical | 鸿蒙化适配说明 | HA-001 | 无任何鸿蒙化适配说明文档 |
| 8 | `README.md` | — | 🟡 Major | 鸿蒙化适配说明 | HA-006 | 缺少下载安装章节 |
| 9 | `ohos/module.json5` | L3 | 🟡 Major | 鸿蒙化适配说明 | HA-021 | `GET_NETWORK_INFO` 权限未在文档中说明 |
| 10 | — | — | 🟡 Major | 鸿蒙化适配说明 | HA-025 | TurboModule 库未说明 Codegen 配置 |
| 11 | `package.json` | — | 🟡 Major | 代码仓基础信息 | RM-005 | description 为空或缺失 |
| 12 | `package.json` | — | 🟡 Major | 代码仓基础信息 | RM-010 | homepage 指向上游 GitHub |
| 13 | `package.json` | — | 🟡 Major | 代码仓基础信息 | RM-008 | version 与 oh-package.json5 不一致 |
| 14 | `README.md` | — | 🟡 Major | 代码示例质量 | EX-006 | 示例未覆盖鸿蒙特有用法 |
| 15 | `example/App.tsx` | — | 🟡 Major | 代码示例质量 | EX-010 | 示例 import 路径可能错误 |
| 16 | — | — | 🟡 Major | 变更记录与版本规范 | CL-001 | 缺少 CHANGELOG.md |
| 17 | — | — | 🔵 Minor | 文档准确性与国际化 | AC-003 | 缺少中文文档 |

---

## 三、检视过程详解

### 3.1 Phase 1：文件收集

```bash
find {outputDir}/source/ohos -type f \( -name "*.md" -o -name "*.d.ts" -o -name "*.json5" -o -name "*.txt" \)
```

收集到的文件：
- `README.md`（项目入口文档）
- `turbo/NetInfoNativeComponent.d.ts`（类型声明）
- `ohos/module.json5`（配置文件）
- `ohos/oh-package.json5`（包配置）
- 无 `CHANGELOG.md` → 记录 CL-001 Major 问题

### 3.2 Phase 2：逐维度检视

#### 维度 1：API 文档完整性

扫描 `src/` 下所有 `.ts` 文件的 `export` 语句：

| 文件 | 导出项 | 有无注释 | 问题编号 | 严重度 |
|------|--------|---------|----------|--------|
| `src/index.ts` | `NetInfo` (default) | ❌ | AD-001 | Critical |
| `src/index.ts` | `NetInfoState` | ❌ | AD-001 | Critical |
| `src/index.ts` | `NetInfoSubscription` | ❌ | AD-001 | Critical |
| `src/NetInfo.ts` | `NetInfo.fetch()` | ❌ | TG-001, TG-002 | Major |
| `src/NetInfo.ts` | `NetInfo.addEventListener()` | ❌ | TG-001, TG-006 | Major |
| `src/NetInfo.ts` | `NetInfo.configure()` | ❌ | TG-001, TG-002 | Major |
| `turbo/...d.ts` | `Spec` 接口 | ❌ | DT-001 | Major |
| `turbo/...d.ts` | `getCurrentState()` | ❌ | DT-002 | Major |

维度扣分计算：
- Critical: AD-001 出现 3 次 → -8 × 3 = -24
- Major: 4 项 × -4 = -16
- Minor: 1 项 × -1 = -1
- 合计 = -24 + (-16) + (-1) = -41
- 扣分上限 = -20
- 维度实际扣分 = min(-20, -41) = **-20**
- 维度得分 = 20 + (-20) = **0**

> 注：3 个 Critical 合并为 1 条记录（AD-001），但扣分按实际发现次数计算（此处演示合并记录但扣分不合并的场景）。实际执行中，同文件多个同类 Critical 可合并为一条，扣分取该严重度的上限。

#### 维度 2：鸿蒙化适配说明

| 检查项 | 发现 | 问题编号 | 严重度 |
|--------|------|----------|--------|
| 鸿蒙化适配说明/迁移指南 | README 无任何鸿蒙化内容 | HA-001 | Critical |
| 下载安装章节 | 无 ohpm 集成步骤 | HA-006 | Major |
| 权限要求说明 | `GET_NETWORK_INFO` 未文档化 | HA-021 | Major |
| TurboModule 配置说明 | 未说明 Codegen 配置 | HA-025 | Major |

维度扣分：
- Critical: 1 × -8 = -8
- Major: 3 × -4 = -12
- 合计 = -20
- 扣分上限 = -20
- 维度实际扣分 = **-20**
- 维度得分 = 20 - 20 = **0**

#### 维度 3-6（同理计算，此处略）

### 3.3 Phase 3：评分计算

```
归零检查：
- 文档非完全空白（有 README，有少量示例）→ 不触发归零
- 核心 TurboModule 接口（Spec）无文档 → 触发归零？

判定：Spec 接口虽无注释，但 README 有基本使用示例，且接口较为简单。
不触发"核心接口无任何文档说明"归零规则（因 README 有用法说明）。

各维度扣分汇总：
- API 文档完整性: -25
- 鸿蒙化适配说明: -20
- 代码仓基础信息: -12
- 代码示例质量: -8
- 变更记录与版本规范: -4
- 文档准确性与国际化: -1

最终分 = max(0, 100 - 25 - 20 - 12 - 8 - 4 - 1) = max(0, 30) = 30
```

### 3.4 Phase 4：报告生成

生成 `文档质量检视报告.md`，格式参考 [REPORT_TEMPLATE.md](../assets/REPORT_TEMPLATE.md)。

---

## 四、常见检视场景

### 4.1 场景：文档完全空白

```
仓库状态：
- 无 README.md
- 无 CHANGELOG.md
- 源码无任何注释
- 无示例代码

→ 触发归零规则：文档完全空白
→ 最终分 = 0
```

### 4.2 场景：核心 TurboModule 无文档

```
仓库状态：
- 有 README.md（含安装说明）
- 有 CHANGELOG.md
- 源码有部分注释
- 但核心 TurboModule Spec 接口完全无注释，README 也未描述

→ 触发归零规则：核心 TurboModule/NAPI 接口无任何文档说明
→ 最终分 = 0
```

### 4.3 场景：文档质量优秀

```
仓库状态：
- README.md 结构完整（功能简介、安装、使用、API 参考、许可证）
- CHANGELOG.md 使用 Keep a Changelog 格式，记录了鸿蒙化变更
- 所有 export API 有完整 TSDoc 注释（@param/@returns/@example）
- .d.ts 文件注释完整
- 有 example/ 目录，示例代码可运行
- 有鸿蒙化适配说明章节
- 双语文档（中英文同步）

检视发现：
- Minor: 2 个方法缺少 @since 标注 → -1 × 2 = -2
- Minor: CHANGELOG 格式略有偏差 → -1

最终分 = max(0, 100 - 2 - 1) = 97
评分等级：优秀
```

### 4.4 场景：示例代码使用已废弃 API

```
仓库状态：
- README 示例代码调用 NetInfo.getConnectionInfo()
- 但源码中该方法已标记 @deprecated，替代方法为 NetInfo.fetch()

→ 检查项 EX-002 (Critical): 示例代码使用已废弃 API
→ 扣分 -8
→ 修复建议：更新示例代码使用 NetInfo.fetch()
```

### 4.5 场景：跳转文档模式（极简 README + 外部 usage-docs）

```
仓库：rntpc_react-native-network-info
文档模式：跳转文档

仓库本地文件：
- README.md：仅含包名 + "文档"章节（链接指向 usage-docs）+ 许可证，约 20 行
- README_zh.md：不存在（中英文在同一 README 中以链接形式提供）
- CHANGELOG.md：不存在
- NetworkInfo.d.ts：类型声明文件
- harmony/：鸿蒙化实现代码
- src/：JS/TS 层代码

外部文档（usage-docs）：
- 中文：https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/zh-cn/react-native-network-info.md
- 英文：https://gitcode.com/OpenHarmony-RN/usage-docs/blob/master/en/react-native-network-info.md
- 外部文档包含：安装与使用、Link、约束与限制、静态方法 API 表格、遗留问题

检视过程：

Phase 1 识别：
- README 中包含 `OpenHarmony-RN/usage-docs` 链接 → 跳转模式
- 收集本地文件 + 获取外部文档

Phase 2 检视要点：
- README.md 极简**不是问题**，这是跳转模式的设计选择，不记录 RM-002/RM-004
- 主要检视对象转为外部 usage-docs 内容
- 检查外部文档是否包含标准章节：安装、链接、约束与限制、接口说明
- 检查外部文档的 API 支持矩阵与本地代码实现的一致性
- CHANGELOG 缺失仍需记录（CL-001 Major），因为 CHANGELOG 是本地文件
- 源码注释检查仍需进行（AD/DT/NP/NC/CE/TG 系列检查项仍适用）

检视发现：
| # | 文件 | 严重度 | 编号 | 描述 |
|---|------|--------|------|------|
| 1 | README.md | Minor | RM-003 | 缺少独立中文 README（README_zh.md） |
| 2 | — | Major | CL-001 | 缺少 CHANGELOG.md |
| 3 | NetworkInfo.d.ts | Major | DT-001 | TurboModule Spec 接口缺少注释 |
| 4 | external-docs | Major | HA-019 | 外部文档约束与限制中缺少编译运行 API 版本要求 |
| 5 | external-docs | Minor | HA-023 | 外部文档遗留问题章节为空 |

评分影响分析：
- 跳转模式下的外部文档提供了完整的安装、链接、接口说明 → README 维度不扣大分
- 但外部文档的约束与限制不够完整 → 鸿蒙化适配说明维度扣分
- 源码注释和 CHANGELOG 问题仍需独立计算

注意：
- ❌ 错误做法：因 README 极简直接记录 RM-002/RM-004 Major 扣分
- ✅ 正确做法：识别为跳转模式后，转而检视外部文档的完整性
```

### 4.6 场景：内嵌文档模式（完整 README_zh.md）

```
仓库：rntpc_react-native-svg
文档模式：内嵌文档

仓库本地文件：
- README.md：英文版完整文档（7+ 章节：简介、安装、链接、约束、示例、接口说明、开源协议）
- README_zh.md：中文版完整文档，内容与英文版对应
- CHANGELOG.md：存在
- harmony/：鸿蒙化实现代码（含 C++）

检视过程：

Phase 1 识别：
- README.md 长度超过 200 行，含完整章节和代码示例 → 内嵌模式
- 不需要获取外部文档

Phase 2 检视要点：
- README.md 和 README_zh.md 是主要检视对象
- 检查中英文版本内容是否同步
- 检查"接口说明"中的 API 支持矩阵与源码实现是否一致
- 检查"约束与限制"中的兼容性和 API 版本要求
- 检查"链接"章节中的 CMakeLists/PackageProvider 配置步骤

典型发现：
- README 中接口表格可能标记 `Yes` 但源码实际未实现 → AD-013
- 中英文版本不同步（英文版缺少某些新增内容）→ AC-003/AC-003
- CMakeLists 配置步骤描述与实际文件不匹配 → AC-001
```

---

## 五、检视技巧

### 5.1 快速识别文档覆盖率

```bash
# 统计 export 数量
grep -rn "export " src/ ohos/ --include="*.ts" --include="*.ets" | wc -l

# 统计有注释的 export 数量（注释通常在 export 前一行或前几行）
# 手动检查：逐个 export 项检查上方是否有 /** */ 注释
```

### 5.2 高效检视顺序

1. **先看 README** → 建立整体认知，快速判断文档完善程度
2. **再看 .d.ts** → 理解 API 表面，检查类型声明注释
3. **然后看源码注释** → 深入实现细节，检查 TSDoc 标签
4. **最后看 CHANGELOG 和 example** → 验证变更记录和示例质量

### 5.3 识别常见问题模式

| 问题模式 | 特征 | 快速检测方法 |
|----------|------|-------------|
| 注释占位符 | `/** TODO */` `/** xxx */` | grep 搜索 TODO/xxx/FIXME |
| 废弃 API 未标注 | 源码注释含 "deprecated" 但无 `@deprecated` 标签 | grep "deprecated" 对比 `@deprecated` |
| 版本号不一致 | README 版本 ≠ package.json 版本 | 对比两处版本号 |
| 示例无 await | 异步方法示例直接使用返回值 | 检查 Promise 返回的方法示例是否含 await |
| 权限未说明 | module.json5 有权限但 README 未提及 | 对比 module.json5 权限列表与 README 说明 |
| 跳转模式误判 | 极简 README 被错误扣分为"文档缺失" | 先检查 README 是否含 usage-docs 链接 |
| 外部文档滞后 | usage-docs 版本落后于代码仓库 | 对比外部文档版本号与 package.json 版本 |
| 接口矩阵不准确 | API 支持矩阵标记 `Yes` 但源码未实现 | 抽查外部文档中的 Yes/No 标记与源码实现 |

### 5.4 跳转文档模式快速判定流程

```
1. 读取 README.md
2. 搜索 "usage-docs" 或 "OpenHarmony-RN"
   ├─ 找到 → 跳转模式
   │   ├─ 提取中英文链接
   │   ├─ 获取外部文档内容（保存到 external-docs/）
   │   ├─ 以外部文档为主要检视对象
   │   └─ README 极简不算缺陷
   └─ 未找到 → 内嵌模式
       ├─ 以本地 README.md/README_zh.md 为主要检视对象
       └─ 按 CHECK_CHECKLIST 常规流程检视
```

---

## 六、Phase 2.5 交叉验证场景示例

> 以下场景均以 `接口规格说明.md` 为权威基准，与用户文档（README/外部 usage-docs）进行双向比对。

### 6.1 场景：文档描述的方法在接口规格中不存在

```
仓库：@react-native-ohos/community-netinfo
文档模式：跳转文档

外部 usage-docs 描述：
- 静态方法表格列出 `getConnectionInfo()` → 返回 `NetInfoState`
- 静态方法表格列出 `fetch()` → 返回 `Promise<NetInfoState>`

接口规格说明文档（第3章 JS/TS 导出）：
- fetch(): Promise<NetInfoState> ✅
- addEventListener(): NetInfoSubscription ✅
- 无 `getConnectionInfo()` ❌

交叉验证结果：
| # | API 名称 | 差异类型 | 接口规格 | 文档描述 | 编号 | 严重度 |
|---|----------|----------|----------|----------|------|--------|
| 1 | `getConnectionInfo()` | 文档→规格：API 不存在 | 无定义 | 有描述 | XC-003 | Critical |

→ 修复建议：从外部文档删除 `getConnectionInfo()` 描述，或在代码中补充实现
```

### 6.2 场景：返回类型不一致（同步 vs 异步）

```
仓库：@react-native-ohos/react-native-svg
文档模式：内嵌文档

README 接口表格描述：
- `getSvgData(): SvgData` → 标注为同步返回

接口规格说明文档（第3章）：
- `getSvgData(): Promise<SvgData>` → 定义为异步方法

交叉验证结果：
| # | API 名称 | 差异类型 | 接口规格 | 文档描述 | 编号 | 严重度 |
|---|----------|----------|----------|----------|------|--------|
| 1 | `getSvgData()` | 返回类型不一致 | Promise\<SvgData\> | SvgData | XC-006 | Critical |

→ 这是最常见的准确性问题：文档遗漏了 async/Promise 标注，用户按同步方式调用会导致运行时错误
→ 修复建议：文档更新为 `getSvgData(): Promise<SvgData>`，示例代码添加 await
```

### 6.3 场景：权限声明与文档不一致

```
仓库：@react-native-ohos/react-native-network-info
文档模式：跳转文档

module.json5 实际声明：
- ohos.permission.GET_NETWORK_INFO
- ohos.permission.GET_WIFI_INFO

外部 usage-docs"约束与限制"章节：
- 仅说明"需要网络权限"
- 未说明需要 WiFi 信息权限

交叉验证结果：
| # | 差异类型 | 文档描述 | module.json5 实际 | 编号 | 严重度 |
|---|----------|----------|-------------------|------|--------|
| 1 | 权限未说明 | 文档仅提及网络权限 | 还声明了 GET_WIFI_INFO | HA-021 | Major |

→ 修复建议：在文档"约束与限制"中补充说明需要 WiFi 信息权限
```

### 6.4 场景：接口规格中的 API 在用户文档中无描述

```
仓库：@react-native-ohos/react-native-device-info
文档模式：跳转文档

接口规格说明文档定义的 API（第3章 JS/TS 导出）：
- getDeviceId() → 文档有描述 ✅
- getSystemName() → 文档有描述 ✅
- getBuildId() → 文档无描述 ❌
- isTablet() → 文档无描述 ❌
- getInstallerPackageName() → 文档无描述 ❌

外部 usage-docs API 表格：
- 仅列出 getDeviceId() 和 getSystemName()

交叉验证结果：
| # | API 名称 | 差异类型 | 编号 | 严重度 |
|---|----------|----------|------|--------|
| 1 | `getBuildId()` | 规格→文档：无描述 | XC-002 | Major |
| 2 | `isTablet()` | 规格→文档：无描述 | XC-002 | Major |
| 3 | `getInstallerPackageName()` | 规格→文档：无描述 | XC-002 | Major |

→ 修复建议：在外部文档 API 表格中补充这三个方法的描述和支持状态
```

### 6.5 场景：鸿蒙化差异与文档不一致

```
仓库：@react-native-ohos/community-netinfo
文档模式：跳转文档

接口规格说明文档第5章鸿蒙化差异：
- 第5.1节缺失接口：useNetInfo() ❌、getDefaultInterface() ❌
- 第5.2节新增接口：isDefaultNetwork() 🆕
- 签名变更：fetch(type?: string) → 鸿蒙版 fetch()（缺少 type 参数）

外部 usage-docs API 表格：
- fetch() → 描述为无参数 ✅（与鸿蒙化签名一致）
- useNetInfo() → 仍标记为支持 ❌（接口规格标记为缺失）
- getDefaultInterface() → 仍标记为支持 ❌（接口规格标记为缺失）
- isDefaultNetwork() → 无描述 ❌（接口规格标记为新增）

交叉验证结果：
| # | API 名称 | 差异类型 | 接口规格 | 文档描述 | 编号 | 严重度 |
|---|----------|----------|----------|----------|------|--------|
| 1 | `useNetInfo()` | 鸿蒙化差异不一致 | 第5.1节标记缺失 | 标记为支持 | XC-008 | Critical |
| 2 | `getDefaultInterface()` | 鸿蒙化差异不一致 | 第5.1节标记缺失 | 标记为支持 | XC-008 | Critical |
| 3 | `isDefaultNetwork()` | 新增接口未描述 | 第5.2节标记新增 | 无描述 | XC-009 | Major |

→ 修复建议：更新外部文档，useNetInfo/getDefaultInterface 标记为不支持，补充 isDefaultNetwork 描述
```

### 6.6 场景：外部文档接口支持矩阵与接口规格不一致

```
仓库：@react-native-ohos/react-native-svg
文档模式：跳转文档

外部 usage-docs API 支持矩阵（部分）：
| 属性 | HarmonyOS Support |
|------|-------------------|
| Circle | Yes |
| Ellipse | Yes |
| TextPath | Yes |
| Marker | No |
| ForeignObject | No |

接口规格说明文档第5.1节缺失接口：
- TextPath ❌（文档标记 Yes 但接口规格标记缺失）

接口规格说明文档第3章导出：
- ForeignObject → 有定义（文档标记 No 但接口规格有导出）

交叉验证结果：
| # | API 名称 | 差异类型 | 接口规格 | 文档标记 | 编号 | 严重度 |
|---|----------|----------|----------|----------|------|--------|
| 1 | TextPath | 支持矩阵不一致 | 第5.1节标记缺失 | Yes | XC-008 | Critical |
| 2 | ForeignObject | 支持矩阵不一致 | 第3章有导出 | No | AD-013 | Major |

→ 修复建议：更新外部文档支持矩阵，TextPath 改为 No，ForeignObject 改为 Yes
```
