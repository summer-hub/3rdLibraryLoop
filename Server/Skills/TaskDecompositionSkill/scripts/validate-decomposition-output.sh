#!/bin/bash
# @tool validate-decomposition-output
# @description 校验 TaskDecompositionSkill 输出的 JSON 是否符合规范（字段完整、类型正确、依赖图有效、验收标准合规）
# @param resultFile: string - 拆解结果 JSON 文件路径

ARGS_JSON="$1"
resultFile=$(python3 -c "import sys,json; print(json.loads(sys.argv[1]).get('resultFile',''))" "$ARGS_JSON" 2>/dev/null || echo "")

if [ -z "$resultFile" ]; then
    resultFile="$1"
fi

if [ -z "$resultFile" ]; then
    echo "Usage: validate-decomposition-output.sh <resultFile>"
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
import re

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

print("=== TaskDecomposition 输出校验 ===")
print(f"文件: {resultFile}")
print()

# 读取文件
with open(resultFile, 'r', encoding='utf-8') as f:
    raw = f.read()

# 尝试提取纯 JSON（容错：容忍 markdown 包裹）
json_start = raw.find('{')
json_end = raw.rfind('}')
if json_start == -1 or json_end == -1:
    fail("文件中未找到 JSON 内容（缺少 { 或 }）")
    print(f"\n=== 校验结果: {PASS} passed, {FAIL} failed, {WARN} warnings ===")
    sys.exit(1)

json_str = raw[json_start:json_end + 1]

try:
    data = json.loads(json_str)
    ok("JSON 格式合法可解析")
except json.JSONDecodeError as e:
    fail(f"JSON 解析失败: {e}")
    print(f"\n=== 校验结果: {PASS} passed, {FAIL} failed, {WARN} warnings ===")
    sys.exit(1)

# 检查是否有 markdown 包裹
if raw.strip() != json_str.strip():
    warn("输出包含非 JSON 内容（markdown 包裹或其他文字），建议输出纯 JSON")

print()
print("--- 1. 顶层结构检查 ---")

if not isinstance(data, dict):
    fail(f"顶层应为 object，实际为 {type(data).__name__}")
    sys.exit(1)

if 'steps' not in data:
    fail("缺少 'steps' 字段")
    sys.exit(1)

steps = data['steps']
if not isinstance(steps, list):
    fail(f"'steps' 应为 array，实际为 {type(steps).__name__}")
    sys.exit(1)

if len(steps) == 0:
    fail("'steps' 数组为空")
    sys.exit(1)

ok(f"steps 数组存在且非空 ({len(steps)} 个步骤)")

print()
print("--- 2. 步骤字段检查 ---")

step_ids = set()
entry_steps = []
exit_steps = []

for i, step in enumerate(steps):
    step_num = i + 1
    errors = []

    # stepId
    if 'stepId' not in step:
        errors.append(f"步骤{step_num}: 缺少 stepId")
    elif not isinstance(step['stepId'], (int, float)):
        errors.append(f"步骤{step_num}: stepId 应为 number，实际为 {type(step['stepId']).__name__}")
    else:
        sid = step['stepId']
        if sid in step_ids:
            errors.append(f"步骤{step_num}: stepId={sid} 重复")
        step_ids.add(sid)

        if sid < 1:
            errors.append(f"步骤{step_num}: stepId={sid} 应 ≥ 1")

    # taskDescription
    if 'taskDescription' not in step:
        errors.append(f"步骤{step_num}: 缺少 taskDescription")
    elif not isinstance(step['taskDescription'], str) or not step['taskDescription'].strip():
        errors.append(f"步骤{step_num}: taskDescription 为空或非 string")

    # dependId
    if 'dependId' not in step:
        errors.append(f"步骤{step_num}: 缺少 dependId")
    elif not isinstance(step['dependId'], (int, float)):
        errors.append(f"步骤{step_num}: dependId 应为 number")

    # nextStepId
    if 'nextStepId' not in step:
        errors.append(f"步骤{step_num}: 缺少 nextStepId")
    elif not isinstance(step['nextStepId'], (int, float)):
        errors.append(f"步骤{step_num}: nextStepId 应为 number")

    # failStepId
    if 'failStepId' not in step:
        errors.append(f"步骤{step_num}: 缺少 failStepId")
    elif not isinstance(step['failStepId'], (int, float)):
        errors.append(f"步骤{step_num}: failStepId 应为 number")

    # maxRetries
    if 'maxRetries' not in step:
        warn(f"步骤{step_num}: 缺少 maxRetries（将使用兜底值 3）")
    elif not isinstance(step['maxRetries'], (int, float)) or step['maxRetries'] < 1:
        errors.append(f"步骤{step_num}: maxRetries 应为 ≥ 1 的 number")

    # acceptanceCriteria
    if 'acceptanceCriteria' not in step:
        warn(f"步骤{step_num}: 缺少 acceptanceCriteria")
    elif not isinstance(step['acceptanceCriteria'], list):
        errors.append(f"步骤{step_num}: acceptanceCriteria 应为 array")
    elif len(step['acceptanceCriteria']) == 0:
        warn(f"步骤{step_num}: acceptanceCriteria 为空数组")
    else:
        # 检查每条 AC
        for j, ac in enumerate(step['acceptanceCriteria']):
            ac_num = j + 1
            ac_errors = []

            if not isinstance(ac, dict):
                ac_errors.append(f"AC{ac_num}: 应为 object")
            else:
                if 'id' not in ac or not ac['id']:
                    ac_errors.append(f"AC{ac_num}: 缺少 id")
                elif not re.match(r'^ac\d+_\d+$', str(ac['id'])):
                    ac_errors.append(f"AC{ac_num}: id 格式应为 ac{{stepId}}_{{序号}}，实际为 '{ac['id']}'")

                if 'criterion' not in ac or not str(ac['criterion']).strip():
                    ac_errors.append(f"AC{ac_num}: 缺少 criterion 或为空")

                if 'type' not in ac:
                    ac_errors.append(f"AC{ac_num}: 缺少 type")
                elif ac['type'] not in ('output', 'quality', 'performance', 'compliance'):
                    ac_errors.append(f"AC{ac_num}: type 应为 output/quality/performance/compliance，实际为 '{ac['type']}'")

                if 'verification' not in ac or not str(ac['verification']).strip():
                    ac_errors.append(f"AC{ac_num}: 缺少 verification 或为空")

                if 'taskACIds' not in ac:
                    ac_errors.append(f"AC{ac_num}: 缺少 taskACIds")
                elif not isinstance(ac['taskACIds'], list):
                    ac_errors.append(f"AC{ac_num}: taskACIds 应为 array")

            for e in ac_errors:
                errors.append(f"步骤{step_num} {e}")

    if errors:
        for e in errors:
            fail(e)
    else:
        ok(f"步骤{step_num} (stepId={step.get('stepId')}): 字段完整")

    # 记录入口和终止步骤
    if step.get('dependId') == 0:
        entry_steps.append(step.get('stepId'))
    if step.get('nextStepId') == 0:
        exit_steps.append(step.get('stepId'))

print()
print("--- 3. 依赖图检查 ---")

# 入口步骤
if len(entry_steps) == 0:
    fail("无入口步骤（至少需要一个 dependId=0 的步骤）")
else:
    ok(f"入口步骤存在: {entry_steps}")

# 终止步骤
if len(exit_steps) == 0:
    fail("无终止步骤（至少需要一个 nextStepId=0 的步骤）")
else:
    ok(f"终止步骤存在: {exit_steps}")

# 引用有效性
ref_errors = []
for step in steps:
    sid = step.get('stepId')
    for field in ['dependId', 'nextStepId', 'failStepId']:
        ref = step.get(field)
        if ref != 0 and ref not in step_ids:
            ref_errors.append(f"stepId={sid}: {field}={ref} 引用了不存在的步骤")

if ref_errors:
    for e in ref_errors:
        fail(e)
else:
    ok("所有 dependId/nextStepId/failStepId 引用有效")

# 简单循环检测（failStepId 链）
def check_fail_loop(steps_dict):
    """检测 failStepId 链是否可能形成无限循环"""
    warnings = []
    for sid, step in steps_dict.items():
        visited = set()
        current = sid
        chain = []
        while current and current != 0:
            if current in visited:
                chain_str = " → ".join(str(s) for s in chain + [current])
                warnings.append(f"步骤{sid} 的 failStepId 链可能循环: {chain_str}")
                break
            visited.add(current)
            chain.append(current)
            current_step = steps_dict.get(current)
            if not current_step:
                break
            # 沿 failStepId 追踪
            current = current_step.get('failStepId', 0)
            if current == 0:
                break
            # 如果 failStepId 指向自己
            if current == sid:
                # 检查是否是自身回退（这是允许的，配合 maxRetries）
                break
    return warnings

steps_dict = {s.get('stepId'): s for s in steps}
loop_warnings = check_fail_loop(steps_dict)
if loop_warnings:
    for w in loop_warnings:
        warn(w)
else:
    ok("failStepId 链无明显无限循环")

print()
print("--- 4. stepId 连续性检查 ---")

sorted_ids = sorted(step_ids)
expected_ids = list(range(1, len(step_ids) + 1))
if sorted_ids == expected_ids:
    ok(f"stepId 从 1 连续递增到 {len(step_ids)}")
else:
    warn(f"stepId 非连续递增: {sorted_ids}（建议从 1 开始连续编号）")

print()
print("--- 5. 验收标准覆盖检查 ---")

all_task_ac_ids = set()
for step in steps:
    for ac in step.get('acceptanceCriteria', []):
        if isinstance(ac, dict) and isinstance(ac.get('taskACIds'), list):
            for tid in ac['taskACIds']:
                all_task_ac_ids.add(tid)

if all_task_ac_ids:
    ok(f"步骤级 AC 共引用了 {len(all_task_ac_ids)} 个任务级 AC ID: {sorted(all_task_ac_ids)}")
else:
    warn("步骤级 AC 未引用任何任务级 AC ID（taskACIds 均为空）")

print()
print(f"=== 校验结果: {PASS} passed, {FAIL} failed, {WARN} warnings ===")

if FAIL > 0:
    sys.exit(1)
else:
    print("ALL CHECKS PASSED" if WARN == 0 else "ALL CHECKS PASSED (with warnings)")
    sys.exit(0)
PYEOF
