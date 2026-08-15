# XTS 代码生成报告模板

> Phase 6 输出时使用此模板生成最终报告文件 `{{outputDir}}/arktscoverage-xts-code-report.md`。

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

### Code Linter 检查
{结果：通过（0 Error / N Warning）/ 有 Error（已修复，见编译验证）/ 环境不可用跳过}
- 引用 `{{sourcePath}}/code-linter-report.json`
- 关键 Warning 需人工确认：{如 @hw-stylistic/file-naming-convention 等，不阻塞编译}

### 编译验证
{编译结果：通过 / 失败（X 轮修复后）}

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

### 验证步骤
1. 在 DevEco Studio 中打开工程，构建完成后右键运行entry/src/ohosTest/ets/test
2. 检查测试执行日志
3. 查看测试文件末尾的覆盖率统计注释
```
