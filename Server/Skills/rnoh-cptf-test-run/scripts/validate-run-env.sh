#!/bin/bash
# @tool validate-run-env
# @description 校验 CPTF 测试运行环境就绪性（设备连接/hap文件/依赖解析/测试文件），输出诊断报告
# @param workspaceDir: string - CPTF 测试工程目录绝对路径

ARGS_JSON="$1"
workspaceDir=$(python3 -c "import sys,json; print(json.loads(sys.argv[1]).get('workspaceDir',''))" "$ARGS_JSON" 2>/dev/null || echo "")

if [ -z "$workspaceDir" ]; then
    echo "Usage: validate-run-env.sh <workspaceDir>"
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

echo "=== CPTF 运行环境校验 ==="
echo "目录: $workspaceDir"
echo ""

# ─── 1. 配置文件 ───
echo "--- 1. 配置文件检查 ---"
configFile="$workspaceDir/cptf.config.json"
if [ -f "$configFile" ]; then
    check_pass "cptf.config.json 存在"
    appPath=$(python3 -c "import json; cfg=json.load(open('$configFile')); print(cfg.get('platforms',{}).get('harmony',{}).get('appPath',''))" 2>/dev/null)
    bundleId=$(python3 -c "import json; cfg=json.load(open('$configFile')); print(cfg.get('bundleId',''))" 2>/dev/null)
    if [ -n "$appPath" ]; then
        check_pass "appPath 配置: $appPath"
    else
        check_fail "cptf.config.json 缺少 platforms.harmony.appPath"
    fi
    if [ -n "$bundleId" ]; then
        check_pass "bundleId 配置: $bundleId"
    else
        check_fail "cptf.config.json 缺少 bundleId"
    fi
else
    check_fail "cptf.config.json 不存在（请先运行 rnoh-cptf-demo-test 生成测试工程）"
fi

# ─── 2. hap 文件 ───
echo ""
echo "--- 2. hap 文件检查 ---"
if [ -n "$appPath" ]; then
    if [ -f "$appPath" ]; then
        check_pass "hap 文件存在: $appPath"
    else
        check_fail "hap 文件不存在: $appPath（需先构建 demo）"
    fi
else
    check_fail "无法检查 hap 文件（appPath 未配置）"
fi

# ─── 3. 依赖解析 ───
echo ""
echo "--- 3. 依赖解析检查 ---"
if [ -d "$workspaceDir/node_modules/@cptf/framework" ]; then
    check_pass "node_modules/@cptf/framework 已建立"
else
    check_fail "node_modules/@cptf/framework 不存在（运行 pnpm install）"
fi
if [ -d "$workspaceDir/node_modules/reflect-metadata" ]; then
    check_pass "node_modules/reflect-metadata 已建立"
else
    check_fail "node_modules/reflect-metadata 不存在（装饰器将不生效）"
fi

# ─── 4. 测试文件 ───
echo ""
echo "--- 4. 测试文件检查 ---"
testFiles=$(find "$workspaceDir/tests/cases" -name '*.test.ts' 2>/dev/null)
if [ -n "$testFiles" ]; then
    testCount=$(echo "$testFiles" | wc -l | tr -d ' ')
    check_pass "发现测试文件: $testCount 个"
    for tf in $testFiles; do
        echo "  检查: $(basename "$tf")"
        grep -q "import 'reflect-metadata'" "$tf" && check_pass "  首行 import reflect-metadata" || check_fail "  缺少 import 'reflect-metadata'"
        grep -q 'stepTimeout' "$tf" && check_pass "  已设置 stepTimeout" || check_fail "  存在未设置 stepTimeout 的步骤风险"
        grep -q 'testCaseExecutor' "$tf" && check_pass "  导出 testCaseExecutor" || check_fail "  缺少 testCaseExecutor 导出"
    done
else
    check_fail "tests/cases 下未发现 .test.ts 文件（请先运行 rnoh-cptf-demo-test 生成）"
fi

# ─── 5. 设备连接 ───
echo ""
echo "--- 5. 设备连接检查 ---"
if command -v hdc &>/dev/null; then
    check_pass "hdc 工具可用"
    devices=$(hdc list targets 2>/dev/null | grep -v '^\[Empty\]' | grep -v '^$')
    if [ -n "$devices" ]; then
        check_pass "设备已连接: $devices"
    else
        check_fail "无设备连接（hdc list targets 为空）"
    fi
else
    check_fail "hdc 工具不可用（需配置 HarmonyOS SDK 环境变量）"
fi

echo ""
echo "=== 结果: PASS=$PASS FAIL=$FAIL ==="
[ $FAIL -eq 0 ] && exit 0 || exit 1
