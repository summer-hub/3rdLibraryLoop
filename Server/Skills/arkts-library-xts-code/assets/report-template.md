# XTS 代码生成报告模板

> Phase 8 输出时使用此模板生成最终报告文件 `{{outputDir}}/arktscoverage-xts-code-report.md`。

---

```markdown
## XTS 代码生成完成

### 生成测试文件
| 文件路径 | 说明 |
|---------|------|
| entry/src/ohosTest/ets/test/{LibraryName}XtsTest.test.ets | N 个测试用例 |

### 测试套件注册
已在 `entry/src/ohosTest/ets/test/List.test.ets` 中注册新测试套件。

### 用例统计
- 总用例数：N
- 可测试接口数：M
- 降级/跳过接口数：D（需标注原因）

### 分批模式说明
{分批模式：Subagent 分批（N 批） / 直接生成模式}
- Subagent 分批模式下：批次总数 N、每批用例数、dispatch 并行度
- 各批次 subagent 自检结果：{批次 1: ✓；批次 2: ✓；批次 3: ✗ → Orchestrator 回退补写；...}
- 回退情况：{无 / 批次 X 回退，原因：...}

### Code Linter 检查
{结果：通过（0 Error）/ 有 Error（已修复）/ 环境不可用跳过}
- 引用 `{{sourcePath}}/code-linter-report.json`
- 关键 Warning 需人工确认：{如 @hw-stylistic/file-naming-convention 等，不阻塞编译}

### 编译验证
{编译结果：通过 / 失败（X 轮修复后）}
- （若跳过编译验证必须注明）跳过原因：{宿主机无 devecocli/ohpm/hvigor 编译环境 / 其他原因}
- 编译修复轮数：{第 X 轮通过；失败则标注最终剩余错误数与原因}
- 编译输出引用：`{{sourcePath}}/build.log`（如保留）

（若已执行 ohpm 线上版本替换，需附加：）
- 源库本地原生编译失败：{原因简述}
- 已切换 ohpm 线上版本：`{库包名}@{版本号}`
- 依赖改动记录：{entry/oh-package.json5 的依赖变更、build-profile.json5 modules[] 移除的模块，可直接引用 `{{sourcePath}}/ohpm-switch-report.json`
- **版本降级 API 兼容核验**：{线上版本对照 library/index.ets 导出链的结果，所有 import 类型是否仍存在；缺失类型的降级处理}

### 接口覆盖
| 接口 | 用例编号 | 类型 | 备注 |
|------|---------|------|------|
| interfaceA | 001 | 正向功能 | — |
| ... | ... | ... | ... |

### 验证步骤（已执行动作核对清单）
> 🔴 以下逐项必须真实勾选，防止"跳过编译仍报成功"。
- [ ] 工程迁移执行：`migrate.cjs` → {结果：成功 / 跳过 + 原因}
- [ ] Code Linter 执行：`code-linter.cjs` → {0 Error / 已修复 / 环境不可用跳过}
- [ ] 编译验证执行：`build.ps1` → {通过 / 失败（X 轮修复后）/ 无法执行 + 原因}
- [ ] 测试套件已在 `List.test.ets` 注册
- [ ] 运行验证：{已在 DevEco Studio 构建运行 / 未运行 + 原因}
- 若勾选"未运行"或任一项跳过，必须在对应字段说明原因，否则视为跳过关键步骤，报告结论不可标记为"成功"。
```
