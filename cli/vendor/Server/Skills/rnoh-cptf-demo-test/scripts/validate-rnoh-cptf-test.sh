#!/bin/bash
# @tool validate-rnoh-cptf-test
# @description 校验 CPTF 测试工程结构完整性（config/package.json/测试文件骨架），并输出快速诊断
# @param workspaceDir: string - CPTF 测试工程目录绝对路径

ARGS_JSON="$1"
workspaceDir=$(python3 -c "import sys,json; print(json.loads(sys.argv[1]).get('workspaceDir',''))" "$ARGS_JSON" 2>/dev/null || echo "")

if [ -z "$workspaceDir" ]; then
    echo "Usage: validate-rnoh-cptf-test.sh <workspaceDir>"
    echo "Error: workspaceDir parameter is required"
    exit 1
fi

if [ ! -d "$workspaceDir" ]; then
    echo "Error: Directory does not exist: $workspaceDir"
    exit 1
fi

PASS=0
FAIL=0

check_pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
check_fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

echo "=== CPTF 测试工程校验 ==="
echo "目录: $workspaceDir"
echo ""

# ─── 1. 配置文件 ───
echo "--- 1. 配置文件检查 ---"
if [ -f "$workspaceDir/cptf.config.json" ]; then
    check_pass "cptf.config.json 存在"
    # 检查关键字段
    python3 - "$workspaceDir/cptf.config.json" <<'EOF'
import json, sys
with open(sys.argv[1]) as f:
    cfg = json.load(f)
issues = []
if 'bundleId' not in cfg: issues.append('缺少 bundleId')
if 'casesDir' not in cfg: issues.append('缺少 casesDir')
h = cfg.get('platforms', {}).get('harmony', {})
if 'appPath' not in h: issues.append('缺少 platforms.harmony.appPath')
elif not h['appPath'].startswith('/'): issues.append('appPath 非绝对路径')
if not h.get('devices'): issues.append('缺少 platforms.harmony.devices')
for i in issues:
    print(f"  ❌ cptf.config.json: {i}")
if not issues:
    print("  ✅ cptf.config.json 关键字段完整")
sys.exit(1 if issues else 0)
EOF
    [ $? -eq 0 ] && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))
else
    check_fail "cptf.config.json 不存在"
fi

# ─── 2. package.json link 依赖 ───
echo ""
echo "--- 2. link 依赖检查 ---"
if [ -f "$workspaceDir/package.json" ]; then
    if grep -q '"@cptf/framework": "link:' "$workspaceDir/package.json"; then
        check_pass "package.json 声明 @cptf/framework link 依赖"
    else
        check_fail "package.json 未声明 @cptf/framework link 依赖（将触发 Cannot find module）"
    fi
    if grep -q '"reflect-metadata": "link:' "$workspaceDir/package.json"; then
        check_pass "package.json 声明 reflect-metadata link 依赖"
    else
        check_fail "package.json 未声明 reflect-metadata link 依赖（装饰器将不生效）"
    fi
else
    check_fail "package.json 不存在"
fi

# ─── 3. node_modules 解析验证 ───
echo ""
echo "--- 3. 模块解析检查 ---"
if [ -d "$workspaceDir/node_modules/@cptf/framework" ]; then
    check_pass "node_modules/@cptf/framework 已建立"
else
    check_fail "node_modules/@cptf/framework 不存在（运行 pnpm install）"
fi

# ─── 4. 测试文件骨架 ───
echo ""
echo "--- 4. 测试文件检查 ---"
testFiles=$(find "$workspaceDir/tests/cases" -name '*.test.ts' 2>/dev/null)
if [ -n "$testFiles" ]; then
    check_pass "发现测试文件: $(echo "$testFiles" | wc -l | tr -d ' ') 个"
    for tf in $testFiles; do
        echo "  检查: $(basename "$tf")"
        grep -q "import 'reflect-metadata'" "$tf" && check_pass "  首行 import reflect-metadata" || check_fail "  缺少 import 'reflect-metadata'"
        grep -q 'stepTimeout' "$tf" && check_pass "  已设置 stepTimeout" || check_fail "  存在未设置 stepTimeout 的步骤风险（全文件无 stepTimeout）"
        grep -q 'testCaseExecutor' "$tf" && check_pass "  导出 testCaseExecutor" || check_fail "  缺少 testCaseExecutor 导出（CLI 无法发现用例）"
        # 全角冒号风险扫描：waitForText 参数含半角冒号且同文件有全角文本
        halfwidth=$(grep -o "waitForText('[^']*:[^']*')" "$tf" | head -5)
        if [ -n "$halfwidth" ]; then
            echo "  ⚠️  以下 waitForText 含半角冒号，请核对 demo 源码是否为全角："
            echo "$halfwidth" | sed 's/^/      /'
        fi
    done
else
    check_fail "tests/cases 下未发现 .test.ts 文件"
fi

echo ""
echo "=== 结果: PASS=$PASS FAIL=$FAIL ==="
[ $FAIL -eq 0 ] && exit 0 || exit 1
