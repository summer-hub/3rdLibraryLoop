# 检视报告输出模板

> 本模板定义最终检视报告的结构和格式。替换 `{占位符}` 内容为实际检视结果。

---

## 报告结构

```markdown
# 用例覆盖度检视报告

## 📊 用例覆盖度检视评分

**综合评分：{score}/100**

> ⚠️ 一票否决判定：测试覆盖率 {xtsRate}%，Demo 覆盖率 {demoRate}%。
> {vetoStatus}

| 维度 | 满分 | 得分 | 扣分详情 | 扣分项数 |
|------|------|------|----------|----------|
| 测试结构完整性 | 15 | {score1} | {deduction1} | {count1} 项 |
| 公开接口覆盖率 | 40 | {score2} | 覆盖率 {xtsRate}%，扣 {deduction2} 分 | {count2} 项 |
| 测试场景覆盖 | 25 | {score3} | {deduction3} | {count3} 项 |
| 测试代码质量 | 20 | {score4} | {deduction4} | {count4} 项 |
| **总计** | **100** | **{totalScore}** | **累计扣分 {totalDeduction} 分** | **{totalCount} 项** |

---

## 🔍 公开接口覆盖核对表

> 数据来源：`flutter-extract-interfaces.cjs` + `flutter-analyze-xts-coverage.cjs` + `flutter-analyze-demo-coverage.cjs`

| 类名 | 公开接口总数 | 测试覆盖 | 测试覆盖率 | Demo覆盖 | Demo覆盖率 | 未覆盖接口 | 综合覆盖率 |
|------|--------------|----------|------------|----------|------------|------------|------------|
| {ClassName1} | {total1} | {xtsCov1} | {xtsRate1}% | {demoCov1} | {demoRate1}% | {uncovered1} | {combinedRate1}% |
| {ClassName2} | {total2} | {xtsCov2} | {xtsRate2}% | {demoCov2} | {demoRate2}% | {uncovered2} | {combinedRate2}% |
| ... | ... | ... | ... | ... | ... | ... | ... |
| **合计** | **{grandTotal}** | **{grandXts}** | **{grandXtsRate}%** | **{grandDemo}** | **{grandDemoRate}%** | **{grandUncovered}** | **{grandCombinedRate}%** |

---

## ❌ 未覆盖接口清单

### 致命缺失（核心功能无测试且无 Demo）
- `{ClassName}.{methodName}()` - {功能描述}

### 严重缺失（重要功能无测试，Demo 有部分覆盖）
- `{ClassName}.{methodName}()` - {功能描述}（Demo 有调用）

### 中等缺失（边缘功能未覆盖）
- `{ClassName}.{methodName}()` - {功能描述}

---

## 📋 脚本生成的覆盖率报告

### XTS 测试覆盖率报告摘要
- 报告文件：`03-XTS覆盖率报告.md`
- 方法级覆盖率：{xtsRate}%
- 类/接口总数：{classCount}
- 方法/属性总数：{methodCount}
- 已覆盖：{coveredCount}
- 未覆盖：{uncoveredCount}

### Demo 覆盖率报告摘要
- 报告文件：`02-Demo覆盖率报告.md`
- 方法级覆盖率：{demoRate}%
- Demo 源文件数：{demoFileCount}
- 已覆盖：{demoCoveredCount}
- 未覆盖：{demoUncoveredCount}

---

## 📋 详细检视结果

### 1. 测试结构分析

#### 1.1 测试目录结构
{测试目录结构分析结果}

#### 1.2 测试框架配置
{pubspec.yaml 中的测试框架配置分析}

#### 1.3 example 目录检查
{example 目录分析结果}

### 2. 公开接口覆盖率检查

#### 2.1 覆盖率数据
{从脚本报告提取的覆盖率数据}

#### 2.2 一票否决判定
{一票否决判定过程和结果}

#### 2.3 未覆盖接口分析
{未覆盖接口的原因分析}

#### 2.4 Demo 补充覆盖
{Demo 对测试未覆盖接口的补充覆盖情况}

### 3. 测试场景覆盖检查

#### 3.1 正常场景
{正常场景测试分析}

#### 3.2 异常场景
{异常场景测试分析}

#### 3.3 边界场景
{边界场景测试分析}

#### 3.4 并发场景
{并发场景测试分析}

### 4. 测试代码质量检查

#### 4.1 测试命名规范
{测试命名分析}

#### 4.2 测试独立性
{测试独立性分析}

#### 4.3 测试可重复性
{测试可重复性分析}

---

## 📎 附录

### 接口规格文件
- 文件路径：`{outputDir}/interface-spec.json`
- 接口总数：{interfaceCount}

### XTS 覆盖率报告
- 文件路径：`{outputDir}/03-XTS覆盖率报告.md`

### Demo 覆盖率报告
- 文件路径：`{outputDir}/02-Demo覆盖率报告.md`
```

---

## 关键格式要求

1. **评分格式必须为**：`**综合评分：XX/100**`（确保 `_parseFlutterLibraryScore` 函数能正确解析）
2. **必须包含公开接口覆盖核对表**（数据从脚本报告提取）
3. **必须列出未覆盖接口清单**（明确哪些接口未被测试/demo 覆盖）
4. **评分必须是 0-100 的整数**
5. **扣分必须有具体项目和数值**（不允许模糊扣分）
6. **使用中文撰写内容**
