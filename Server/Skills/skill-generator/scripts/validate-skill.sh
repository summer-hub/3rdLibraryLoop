#!/bin/bash
# @tool validate-skill
# @description 校验SKILL目录是否符合Agent Skills规范，检查frontmatter、结构、渐进式披露
# @param skillDir: string - SKILL目录绝对路径

ARGS_JSON="$1"
skillDir=$(python3 -c "import sys,json; print(json.loads(sys.argv[1]).get('skillDir',''))" "$ARGS_JSON" 2>/dev/null || echo "")

if [ -z "$skillDir" ]; then
    echo "Usage: validate-skill.sh <skillDir>"
    echo "Error: skillDir parameter is required"
    exit 1
fi

if [ ! -d "$skillDir" ]; then
    echo "Error: Directory does not exist: $skillDir"
    exit 1
fi

PASS=0
FAIL=0
WARNINGS=0

check_pass() {
    echo "  ✅ $1"
    PASS=$((PASS + 1))
}

check_fail() {
    echo "  ❌ $1"
    FAIL=$((FAIL + 1))
}

check_warn() {
    echo "  ⚠️  $1"
    WARNINGS=$((WARNINGS + 1))
}

echo "=== SKILL 规范校验 ==="
echo "目录: $skillDir"
echo ""

# ─── 1. SKILL.md 存在性 ───
echo "--- 1. 文件结构检查 ---"
skillFile="$skillDir/SKILL.md"
if [ -f "$skillFile" ]; then
    check_pass "SKILL.md 存在"
else
    check_fail "SKILL.md 不存在"
    echo "无法继续校验，SKILL.md 是必需文件"
    exit 1
fi

# ─── 2. Frontmatter 检查 ───
echo ""
echo "--- 2. Frontmatter 检查 ---"

# 检查 frontmatter 存在
head -1 "$skillFile" | grep -q '^---$' 2>/dev/null
if [ $? -eq 0 ]; then
    check_pass "YAML frontmatter 存在"
else
    check_fail "缺少 YAML frontmatter（文件应以 --- 开头）"
fi

# 提取 name 字段
nameField=$(python3 -c "
import re
with open('$skillFile', 'r') as f:
    content = f.read()
match = re.search(r'^name:\s*(.+)$', content, re.MULTILINE)
print(match.group(1).strip() if match else '')
" 2>/dev/null)

if [ -n "$nameField" ]; then
    check_pass "name 字段存在: $nameField"

    # name 字符集校验（POSIX 兼容，不使用 grep -P）
    if echo "$nameField" | grep -qE '^[a-z0-9]+(-[a-z0-9]+)*$' 2>/dev/null; then
        check_pass "name 字符集合规（仅小写字母/数字/连字符）"
    else
        check_fail "name 字符集不合规：应仅含 a-z/0-9/-，不能首尾连字符或连续连字符"
    fi

    # name 长度校验
    nameLen=${#nameField}
    if [ "$nameLen" -ge 1 ] && [ "$nameLen" -le 64 ]; then
        check_pass "name 长度合规 ($nameLen 字符)"
    else
        check_fail "name 长度不合规：应在 1-64 字符之间（当前 $nameLen）"
    fi

    # name 匹配目录名
    dirName=$(basename "$skillDir")
    if [ "$nameField" = "$dirName" ]; then
        check_pass "name 匹配父目录名 ($dirName)"
    else
        check_fail "name 不匹配父目录名：name='$nameField' vs 目录='$dirName'"
    fi
else
    check_fail "name 字段缺失"
fi

# 提取 description 字段
descField=$(python3 -c "
import re
with open('$skillFile', 'r') as f:
    content = f.read()
match = re.search(r'^description:\s*(.+?)(?=\n[a-z]|\n---|\Z)', content, re.MULTILINE | re.DOTALL)
print(match.group(1).strip() if match else '')
" 2>/dev/null)

if [ -n "$descField" ]; then
    descLen=${#descField}
    if [ "$descLen" -le 1024 ]; then
        check_pass "description 长度合规 ($descLen 字符)"
    else
        check_fail "description 过长：应 ≤1024 字符（当前 $descLen）"
    fi
else
    check_fail "description 字段缺失或为空"
fi

# 检查 license
if grep -q '^license:' "$skillFile" 2>/dev/null; then
    check_pass "license 字段存在"
else
    echo "  ⚠️  license 字段缺失（推荐添加）"
    WARNINGS=$((WARNINGS + 1))
fi

# 检查 metadata
if grep -q '^metadata:' "$skillFile" 2>/dev/null; then
    check_pass "metadata 字段存在"
else
    echo "  ⚠️  metadata 字段缺失（推荐添加 author/version）"
    WARNINGS=$((WARNINGS + 1))
fi

# ─── 3. Body 检查 ───
echo ""
echo "--- 3. Body 内容检查 ---"

# 统计 body 行数（frontmatter 之后的行）
bodyLines=$(python3 -c "
with open('$skillFile', 'r') as f:
    lines = f.readlines()
# 跳过 frontmatter
start = 0
end_idx = 0
for i, line in enumerate(lines):
    if line.strip() == '---':
        if start == 0:
            start = i + 1
        else:
            end_idx = i + 1
            break
if end_idx == 0:
    end_idx = start
body = lines[end_idx:]
print(len(body))
" 2>/dev/null)

if [ "$bodyLines" -le 500 ]; then
    check_pass "body 行数合规 ($bodyLines 行, ≤500)"
else
    echo "  ⚠️  body 行数较多 ($bodyLines 行，推荐 < 500，考虑拆分到 references/)"
    WARNINGS=$((WARNINGS + 1))
fi

# 检查任务参数表
if grep -q '任务参数\|## .*参数\|| 参数' "$skillFile" 2>/dev/null; then
    check_pass "包含任务参数说明"
else
    echo "  ⚠️  未找到任务参数表（推荐添加）"
    WARNINGS=$((WARNINGS + 1))
fi

# 检查工作流程
if grep -q '工作流程\|Phase\|## Phase' "$skillFile" 2>/dev/null; then
    check_pass "包含工作流程概览"
else
    echo "  ⚠️  未找到工作流程概览（推荐添加）"
    WARNINGS=$((WARNINGS + 1))
fi

# ─── 4. 渐进式披露检查 ───
echo ""
echo "--- 4. 渐进式披露检查 ---"

# 检查 references 目录
if [ -d "$skillDir/references" ]; then
    refCount=$(find "$skillDir/references" -maxdepth 1 -type f -name "*.md" | wc -l | tr -d ' ')
    check_pass "references/ 目录存在 ($refCount 个文档)"

    # 检查引用深度（一层）
    nestedDirs=$(find "$skillDir/references" -mindepth 2 -type d 2>/dev/null | wc -l | tr -d ' ')
    if [ "$nestedDirs" -eq 0 ]; then
        check_pass "references 保持一层深度"
    else
        check_fail "references 存在嵌套子目录 ($nestedDirs 个)，应保持一层深度"
    fi
else
    echo "  ⚠️  无 references/ 目录（详细内容建议拆分到此目录）"
    WARNINGS=$((WARNINGS + 1))
fi

# 检查 assets 目录
if [ -d "$skillDir/assets" ]; then
    check_pass "assets/ 目录存在"
else
    echo "  ⚠️  无 assets/ 目录（如需模板/资源可添加）"
    WARNINGS=$((WARNINGS + 1))
fi

# 检查 scripts 目录
if [ -d "$skillDir/scripts" ]; then
    check_pass "scripts/ 目录存在"
else
    echo "  ⚠️  无 scripts/ 目录（如需可执行脚本可添加）"
    WARNINGS=$((WARNINGS + 1))
fi

# 检查文件引用使用相对路径（POSIX 兼容，不使用 grep -P）
absRefs=$(grep -oE '\]\(/[^)]+\)' "$skillFile" 2>/dev/null | wc -l | tr -d ' ')
if [ "$absRefs" -eq 0 ]; then
    check_pass "文件引用使用相对路径"
else
    check_fail "发现 $absRefs 个绝对路径引用，应使用相对路径"
fi

# ─── 5. 总结 ───
echo ""
echo "=== 校验总结 ==="
echo "  ✅ 通过: $PASS"
echo "  ❌ 失败: $FAIL"
echo "  ⚠️  警告: $WARNINGS"
echo ""

if [ "$FAIL" -eq 0 ]; then
    echo "ALL CHECKS PASSED"
    exit 0
else
    echo "VALIDATION FAILED: $FAIL 个必须修复的问题"
    exit 1
fi
