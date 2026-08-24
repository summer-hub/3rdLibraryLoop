# SKILL 模板

> 生成新SKILL时可直接复制此模板，替换 `{占位符}` 内容。

---

## 目录结构

```
{skill-name}/
├── SKILL.md
├── references/
│   └── REFERENCE.md
├── assets/
│   └── OUTPUT_TEMPLATE.md
└── scripts/
    └── {helper}.cjs
```

---

## SKILL.md 模板

```markdown
---
name: {skill-name}
description: {做什么的简述}. Use when {触发场景}. {领域关键词}.
license: Apache-2.0
compatibility: {环境要求，如"需要git、网络访问"}
metadata:
  author: {作者}
  version: "1.0.0"
  category: {分类}
---

# {Skill标题}

{一句话定位说明}

> ⚠️ **核心原则：{本SKILL的关键约束}**

---

## 任务参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `{param1}` | string | ✅ | {说明} |
| `{param2}` | string | ❌ | {说明} |
| `outputDir` | string | ✅ | 输出目录绝对路径 |

---

## 输入依赖

- **前置SKILL**: {前置SKILL名称，或"无"}
- **输入文件**: {输入文件，或"无"}

---

## 工作流程概览

\`\`\`
Phase 1: {阶段1} → Phase 2: {阶段2} → Phase 3: {阶段3} → Phase 4: {输出}
\`\`\`

---

## Phase 1：{阶段名}

### 1.1 {步骤名}

{步骤详细说明}

### 1.2 {步骤名}

{步骤详细说明}

> 详细说明参见 [参考文档](references/REFERENCE.md)

---

## Phase 2：{阶段名}

### 2.1 调用MCP工具

调用 MCP 工具 `{serverName}_{toolName}`，传入参数：
- `{param}`: {说明}

### 2.2 处理返回结果

{结果处理说明}

---

## Phase 3：{阶段名}

### 3.1 {步骤名}

{步骤详细说明}

---

## Phase 4：{输出阶段}

### 输出文件

- `{outputDir}/{file1}.md` — {说明}
- `{outputDir}/{file2}.txt` — {说明}

> 输出模板参见 [输出模板](assets/OUTPUT_TEMPLATE.md)
```

---

## references/REFERENCE.md 模板

```markdown
# {领域}参考文档

## 1. {主题1}

### 1.1 {子主题}

{详细内容}

### 检查清单

- [ ] {检查项1}
- [ ] {检查项2}

## 2. {主题2}

{详细内容}
```

---

## scripts/ 脚本模板

> ⚠️ **脚本必须跨平台**（Windows/macOS/Linux 均可运行）：使用 Node.js（`.cjs`）或 Python（`.py`），**禁止 Bash（`.sh`）**。

### Node.js 脚本（首选）

```javascript
#!/usr/bin/env node
/**
 * @tool {工具名}
 * @description {工具描述}
 * @param {param}: string - {参数说明}
 */
'use strict';

// 参数解析：兼容 MCP Gateway JSON 模式与 CLI 模式
function parseArgs(argv) {
  if (argv.length > 0 && typeof argv[0] === 'string' && argv[0].startsWith('{')) {
    try { return JSON.parse(argv[0]); } catch (e) { return {}; }
  }
  return { param: argv[0] || '' };
}

const args = parseArgs(process.argv.slice(2));

// 脚本逻辑
console.log('result');
```

### python 脚本

```python
#!/usr/bin/env python3
# @tool {工具名}
# @description {工具描述}
# @param {param}: string - {参数说明}

import sys, json

args = json.loads(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].startswith('{') else {}
param = args.get("{param}", "")

# 脚本逻辑
print("result")
```
