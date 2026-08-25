# MCP 工具使用指南

本文档说明本 SKILL 可复用的 MCP 脚本工具，用于接口覆盖率分析和测试文件扫描，避免重复造轮子。

---

## 可用 MCP 脚本工具

### 1. `script_arkts_analyze_demo_coverage` — Demo 接口覆盖率分析

**脚本路径**: `MCP/scripts/analyze-demo-coverage.cjs`

**功能**：无需手工提取接口规格，直接一步完成接口提取、Demo 覆盖率匹配和 Markdown 报告生成。

**适用场景**：本 SKILL Phase 2 的公开接口覆盖率评估中，用于计算 DEMO 目录的接口覆盖率。

**调用方式**：

```bash
node "{{workspaceRoot}}/MCP/scripts/analyze-demo-coverage.cjs" \
  --libroot "{{libroot}}" \
  --output "{{outputDir}}/demo-coverage-report.md"
```

**参数说明**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `--libroot` | ✅ | 库源码根目录绝对路径（含 `library/` 和 `entry/src/main/ets/`） |
| `--spec` | ❌ | 已有的 `interface-spec.json` 路径（由 `extract-interfaces.cjs` 生成） |
| `--output` | ❌ | 输出 Markdown 报告路径，默认 `02-{库名}-Demo覆盖率报告.md` |
| `--mode` | ❌ | 匹配模式：`auto`(默认) \| `ast` \| `regex` |
| `--lib` | ❌ | 库名覆盖 |

**自动完成**：
1. 获取接口规格（从 `--spec` JSON 读取，或从 `libroot` 源码自动提取）
2. 递归扫描 `entry/src/main/ets/` 下的 `.ets` 文件
3. AST/正则双层匹配接口调用
4. 直接生成最终 Markdown 覆盖率报告

### 2. `script_arkts_analyze_xts_coverage` — XTS 覆盖率分析

**脚本路径**: `MCP/scripts/analyze-xts-coverage.cjs`

**功能**：分析 XTS 测试用例对接口的覆盖情况，一步完成接口提取、XTS 覆盖率匹配和报告生成。

**适用场景**：本 SKILL Phase 2 的公开接口覆盖率评估中，用于计算 test 目录的接口覆盖率。

**调用方式**：

```bash
node "{{workspaceRoot}}/MCP/scripts/analyze-xts-coverage.cjs" \
  --libroot "{{libroot}}" \
  --output "{{outputDir}}/xts-coverage-report.md"
```

**参数说明**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `--libroot` | ✅* | 库源码根目录路径（含 `library/` 和 `entry/src/ohosTest/`） |
| `--spec` | ✅* | 已有的 `interface-spec.json` 路径（与 `libroot` 二选一） |
| `--output` | ❌ | 输出 Markdown 报告路径，默认 `03-{库名}-XTS覆盖率报告.md` |
| `--mode` | ❌ | 匹配模式：`auto`(默认) \| `ast` \| `regex` |

> `libroot` 与 `spec` 至少提供一个。提供 `spec` 时跳过接口提取步骤。

**扫描范围**：`entry/src/ohosTest/` 下所有 `.ets` 和 `.ts` 测试文件。

### 3. `script_extract_interfaces` — 接口规格提取

**脚本路径**: `MCP/scripts/extract-interfaces.cjs`

**功能**：从库源码提取公开接口规格，生成 JSON 格式的接口规格文件。

**适用场景**：当需要手动补充接口规格时使用。本 SKILL 通常直接使用 `--spec` 参数传入已有 JSON。

---

## 在本 SKILL 中的使用方式

### 覆盖率计算流程

```
Phase 1: 扫描测试文件和鸿蒙代码
    ↓
Phase 2: 调用 MCP 脚本计算覆盖率
    ├── DEMO 覆盖率 → analyze-demo-coverage.cjs
    │   （扫描 entry/src/main/ets/ 下的接口调用）
    └── test 覆盖率 → analyze-xts-coverage.cjs
        （扫描 entry/src/ohosTest/ 下的接口调用）
    ↓
Phase 3: 综合评分（结合 MCP 报告 + 手动检视项）
    ↓
Phase 4: 生成最终报告
```

### 脚本身份验证

执行脚本后，检查退出码和输出文件：

- 退出码 `0` → 成功，继续流程
- 退出码非 `0` → 失败，回退到手工扫描流程

### 脚本与手工结合的检视项

MCP 脚本自动完成**接口覆盖率计算**（维度 1 的基础数据），但以下检视项仍需人工分析：

| 维度 | 脚本自动 | 人工分析 |
|------|----------|----------|
| 公开接口覆盖率 | 覆盖率百分比（TC-01~TC-05 基础数据） | 边界场景、参数组合覆盖判定 |
| 测试质量 | — | 断言质量、Mock 过度、负面测试等 |
| 鸿蒙化特性测试 | — | 鸿蒙 API 调用测试、权限场景等 |
| 测试分类覆盖 | — | 单元/集成/E2E 分类判断 |
| 测试基础设施 | — | 框架配置、CI 集成等 |