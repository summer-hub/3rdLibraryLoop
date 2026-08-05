#!/bin/bash
# @tool validate-analysis-output
# @description 校验 TaskAnalysisSkill 输出的 JSON 是否符合规范（字段完整、类型正确、验收标准合规）
# @param resultFile: string - 分析结果 JSON 文件路径

ARGS_JSON="$1"
resultFile=$(python3 -c "import sys,json; print(json.loads(sys.argv[1]).get('resultFile',''))" "$ARGS_JSON" 2>/dev/null || echo "")

if [ -z "$resultFile" ]; then
    resultFile="$1"
fi

if [ -z "$resultFile" ]; then
    echo "Usage: validate-analysis-output.sh <resultFile>"
    echo "Error: resultFile parameter is required"
    exit 1
fi

if [ ! -f "$resultFile" ]; then
    echo "Error: File does not exist: $resultFile"
    exit 1
fi

python3 - "$resultFile" << 'PYEOF'
import sys
import json
import os

resultFile = sys.argv[1]
PASS = 0
FAIL = 0
WARN = 0

def ok(msg):
    global PASS
    print(f"  ✅ {msg}")
    PASS += 1

def fail(msg):
    global FAIL
    print(f"  ❌ {msg}")
    FAIL += 1

def warn(msg):
    global WARN
    print(f"  ⚠️  {msg}")
    WARN += 1

print("=== TaskAnalysis 输出校验 ===")
print(f"文件: {resultFile}")
print()

# ─── 1. 读取与解析 ───
print("--- 1. 文件格式检查 ---")
try:
    with open(resultFile, 'r', encoding='utf-8') as f:
        raw = f.read()
except Exception as e:
    fail(f"文件读取失败: {e}")
    sys.exit(1)

# 尝试直接解析
data = None
try:
    data = json.loads(raw)
    ok("JSON 解析成功（纯 JSON 格式）")
except json.JSONDecodeError:
    # 尝试从容错提取（{ ... }）
    start = raw.find('{')
    end = raw.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            data = json.loads(raw[start:end+1])
            warn("JSON 被 markdown 代码块包裹（容错提取成功，但应输出纯 JSON）")
        except json.JSONDecodeError as e2:
            fail(f"JSON 解析失败（含容错提取）: {e2}")
            sys.exit(1)
    else:
        fail("JSON 解析失败，且未找到 { } 边界")
        sys.exit(1)

if not isinstance(data, dict):
    fail("顶层结构不是 JSON 对象")
    sys.exit(1)

# ─── 2. 核心字段检查 ───
print()
print("--- 2. 核心字段检查 ---")

# intent
intent = data.get('intent', '')
if intent and isinstance(intent, str):
    ok(f"intent 存在且非空: {intent[:50]}...")
else:
    fail("intent 缺失或为空")

# domain
domain = data.get('domain', '')
if domain and isinstance(domain, str):
    ok(f"domain 存在: {domain}")
else:
    warn("domain 缺失（将兜底为 'general'）")

# keywords
keywords = data.get('keywords', [])
if isinstance(keywords, list) and len(keywords) > 0:
    ok(f"keywords 存在且非空 ({len(keywords)} 个)")
else:
    warn("keywords 缺失或为空数组（将兜底为 []）")

# constraints
constraints = data.get('constraints', [])
if isinstance(constraints, list):
    ok(f"constraints 存在 ({len(constraints)} 条)")
else:
    warn("constraints 不是数组（将兜底为 []）")

# techStack
techStack = data.get('techStack', [])
if isinstance(techStack, list) and len(techStack) > 0:
    ok(f"techStack 存在且非空 ({len(techStack)} 个)")
else:
    warn("techStack 缺失或为空数组")

# complexity
complexity = data.get('complexity', 'medium')
if complexity in ('low', 'medium', 'high'):
    ok(f"complexity 合规: {complexity}")
else:
    fail(f"complexity 不合规: '{complexity}'，应为 low/medium/high")

# estimatedSteps
estimatedSteps = data.get('estimatedSteps', 3)
if isinstance(estimatedSteps, (int, float)) and estimatedSteps >= 1:
    ok(f"estimatedSteps 合规: {estimatedSteps}")
else:
    warn(f"estimatedSteps 不合规: {estimatedSteps}（将兜底为 3）")

# ─── 3. 验收标准检查 ───
print()
print("--- 3. 验收标准检查 ---")

ac = data.get('acceptanceCriteria', [])
if not isinstance(ac, list):
    fail("acceptanceCriteria 不是数组")
    ac = []

ac_count = len(ac)
if ac_count == 0:
    fail("acceptanceCriteria 为空数组")
elif ac_count < 3:
    warn(f"验收标准过少 ({ac_count} 条，推荐 3-8 条)")
elif ac_count > 8:
    warn(f"验收标准过多 ({ac_count} 条，推荐 3-8 条)")
else:
    ok(f"验收标准数量合理 ({ac_count} 条)")

valid_types = {'output', 'quality', 'performance', 'compliance'}
for idx, item in enumerate(ac):
    if not isinstance(item, dict):
        fail(f"ac[{idx}] 不是对象")
        continue

    item_id = item.get('id', f'ac{idx+1}')
    issues = []

    # id
    if not item.get('id'):
        issues.append("id 缺失")

    # criterion
    criterion = item.get('criterion', '')
    if not criterion:
        issues.append("criterion 为空")
    elif len(criterion) < 5:
        issues.append(f"criterion 过短: '{criterion}'")

    # type
    item_type = item.get('type', '')
    if item_type not in valid_types:
        issues.append(f"type 不合规: '{item_type}'，应为 {valid_types}")

    # verification
    verification = item.get('verification', '')
    if not verification:
        issues.append("verification 为空")
    elif len(verification) < 5:
        issues.append(f"verification 过短: '{verification}'")

    # 模糊性检查
    if criterion:
        vague_words = ['完成', '好', '可以', '正常', '没问题']
        for vw in vague_words:
            if criterion.strip().endswith(vw) and len(criterion) < 10:
                issues.append(f"criterion 可能过于模糊: '{criterion}'")
                break

    if issues:
        fail(f"[{item_id}] {'; '.join(issues)}")
    else:
        ok(f"[{item_id}] 字段完整 (type={item_type})")

# id 唯一性
ids = [item.get('id') for item in ac if isinstance(item, dict) and item.get('id')]
if len(ids) != len(set(ids)):
    fail(f"验收标准 id 不唯一: {ids}")
elif ids:
    ok(f"验收标准 id 唯一 ({len(ids)} 个)")

# id 格式检查（ac1, ac2, ...）
import re
id_pattern = re.compile(r'^ac\d+$')
bad_ids = [i for i in ids if not id_pattern.match(str(i))]
if bad_ids:
    warn(f"部分 id 不符合 ac{{N}} 格式: {bad_ids}")

# ─── 4. 重规划字段检查（如果存在重规划信号） ───
print()
print("--- 4. 重规划字段检查 ---")

has_replan = bool(data.get('failureAnalysis') or data.get('adjustmentStrategy'))
if has_replan:
    fa = data.get('failureAnalysis', '')
    if fa and isinstance(fa, str):
        ok(f"failureAnalysis 存在且非空 ({len(fa)} 字符)")
    else:
        fail("failureAnalysis 缺失或为空（重规划场景必填）")

    astrat = data.get('adjustmentStrategy', '')
    if astrat and isinstance(astrat, str):
        ok(f"adjustmentStrategy 存在且非空 ({len(astrat)} 字符)")
    else:
        fail("adjustmentStrategy 缺失或为空（重规划场景必填）")
else:
    print("  ℹ️  非重规划场景，跳过 failureAnalysis/adjustmentStrategy 检查")

# ─── 5. 纯 JSON 检查 ───
print()
print("--- 5. 输出格式检查 ---")
stripped = raw.strip()
if stripped.startswith('{') and stripped.endswith('}'):
    ok("输出为纯 JSON（无 markdown 包裹）")
else:
    warn("输出非纯 JSON（被 markdown 包裹或含额外内容，下游可容错但建议纯 JSON）")

# ─── 总结 ───
print()
print("=" * 50)
print(f"结果: {PASS} 通过, {WARN} 警告, {FAIL} 失败")
if FAIL > 0:
    print("❌ 校验未通过")
    sys.exit(1)
else:
    print("✅ 校验通过")
    sys.exit(0)
PYEOF
