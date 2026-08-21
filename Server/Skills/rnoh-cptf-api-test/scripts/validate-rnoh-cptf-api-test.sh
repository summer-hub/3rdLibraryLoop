#!/bin/bash
# @tool validate-rnoh-cptf-api-test
# @description 校验接口规格驱动的 Demo + CPTF 测试工程结构完整性（Demo testID/前缀 + CPTF config/package/测试文件骨架 + Demo-Test 对齐）
# @param workspaceDir: string - CPTF 测试工程目录绝对路径
# @param demoDir: string - Demo 页面目录绝对路径（{exampleDir}/{libName}/）

ARGS_JSON="$1"
workspaceDir=$(python3 -c "import sys,json; print(json.loads(sys.argv[1]).get('workspaceDir',''))" "$ARGS_JSON" 2>/dev/null || echo "")
demoDir=$(python3 -c "import sys,json; print(json.loads(sys.argv[1]).get('demoDir',''))" "$ARGS_JSON" 2>/dev/null || echo "")

if [ -z "$workspaceDir" ]; then
    echo "Usage: validate-rnoh-cptf-api-test.sh '{\"workspaceDir\":\"<路径>\",\"demoDir\":\"<路径>\"}'"
    echo "Error: workspaceDir parameter is required"
    exit 1
fi

if [ ! -d "$workspaceDir" ]; then
    echo "Error: workspaceDir does not exist: $workspaceDir"
    exit 1
fi

PASS=0
FAIL=0
WARN=0

check_pass() { echo "  PASS $1"; PASS=$((PASS + 1)); }
check_fail() { echo "  FAIL $1"; FAIL=$((FAIL + 1)); }
check_warn() { echo "  WARN $1"; WARN=$((WARN + 1)); }

echo "=== RNOH CPTF API Test Validation ==="
echo "workspaceDir: $workspaceDir"
if [ -n "$demoDir" ] && [ -d "$demoDir" ]; then
    echo "demoDir: $demoDir"
else
    echo "demoDir: (not provided or not found, skipping Demo checks)"
fi
echo ""

# --- 1. Demo checks ---
if [ -n "$demoDir" ] && [ -d "$demoDir" ]; then
    echo "--- 1. Demo Code Checks ---"

    # 1.1 index.tsx
    indexFile="$demoDir/index.tsx"
    if [ -f "$indexFile" ]; then
        check_pass "index.tsx exists"
        grep -q 'Tester' "$indexFile" && check_pass "index.tsx has Tester framework" || check_fail "index.tsx missing Tester framework"
        grep -q 'displayName' "$indexFile" && check_pass "index.tsx has metadata export" || check_warn "index.tsx missing metadata export"
    else
        check_fail "index.tsx not found"
    fi

    # 1.2 Demo page files
    demoPages=$(find "$demoDir/demo" -name '*.tsx' 2>/dev/null)
    if [ -n "$demoPages" ]; then
        pageCount=$(echo "$demoPages" | wc -l | tr -d ' ')
        check_pass "Demo page files found: $pageCount"

        for tf in $demoPages; do
            echo "  Checking: $(basename "$tf")"

            # testID check
            testIdCount=$(grep -c 'testID=' "$tf" 2>/dev/null || echo 0)
            if [ "$testIdCount" -gt 0 ]; then
                check_pass "  Has testID ($testIdCount)"
            else
                check_warn "  No testID found (CPTF will use textContains fallback)"
            fi

            # Fixed prefix check
            if grep -qE '(结果|错误信息|状态|常量|属性)' "$tf" 2>/dev/null; then
                check_pass "  Has fixed text prefix"
            else
                check_warn "  No fixed text prefix pattern found"
            fi

            # ScrollView root check
            firstComp=$(head -20 "$tf" | grep -oE '<(View|ScrollView)' | head -1)
            if [ "$firstComp" = "<ScrollView" ]; then
                check_fail "  Root component is ScrollView (should be View)"
            else
                check_pass "  Root component is View"
            fi

            # Slider check
            grep -q 'Slider' "$tf" 2>/dev/null && check_fail "  Uses Slider (not supported on HarmonyOS)" || check_pass "  No Slider"

            # console.error check
            grep -q 'console.error' "$tf" 2>/dev/null && check_fail "  Uses console.error" || check_pass "  No console.error"
        done
    else
        check_fail "No Demo page files found in $demoDir/demo/"
    fi
    echo ""
fi

# --- 2. CPTF config ---
echo "--- 2. CPTF Config Checks ---"
if [ -f "$workspaceDir/cptf.config.json" ]; then
    check_pass "cptf.config.json exists"
    python3 - "$workspaceDir/cptf.config.json" <<'EOF'
import json, sys
with open(sys.argv[1]) as f:
    cfg = json.load(f)
issues = []
if 'bundleId' not in cfg: issues.append('missing bundleId')
if 'casesDir' not in cfg: issues.append('missing casesDir')
h = cfg.get('platforms', {}).get('harmony', {})
if 'appPath' not in h: issues.append('missing platforms.harmony.appPath')
elif not h['appPath'].startswith('/'): issues.append('appPath not absolute path')
if not h.get('devices'): issues.append('missing platforms.harmony.devices')
for i in issues:
    print(f"  FAIL cptf.config.json: {i}")
if not issues:
    print("  PASS cptf.config.json key fields complete")
sys.exit(1 if issues else 0)
EOF
    [ $? -eq 0 ] && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))
else
    check_fail "cptf.config.json not found"
fi

# --- 3. package.json link ---
echo ""
echo "--- 3. Link Dependency Checks ---"
if [ -f "$workspaceDir/package.json" ]; then
    grep -q '"@cptf/framework": "link:' "$workspaceDir/package.json" && check_pass "@cptf/framework link declared" || check_fail "@cptf/framework link not declared"
    grep -q '"reflect-metadata": "link:' "$workspaceDir/package.json" && check_pass "reflect-metadata link declared" || check_fail "reflect-metadata link not declared"
else
    check_fail "package.json not found"
fi

# --- 4. node_modules ---
echo ""
echo "--- 4. Module Resolution Checks ---"
if [ -d "$workspaceDir/node_modules/@cptf/framework" ]; then
    check_pass "node_modules/@cptf/framework established"
else
    check_fail "node_modules/@cptf/framework not found (run pnpm install)"
fi

# --- 5. Test file ---
echo ""
echo "--- 5. Test File Checks ---"
testFiles=$(find "$workspaceDir/tests/cases" -name '*.test.ts' 2>/dev/null)
if [ -n "$testFiles" ]; then
    testCount=$(echo "$testFiles" | wc -l | tr -d ' ')
    check_pass "Test files found: $testCount"

    for tf in $testFiles; do
        echo "  Checking: $(basename "$tf")"
        grep -q "import 'reflect-metadata'" "$tf" && check_pass "  First line import reflect-metadata" || check_fail "  Missing import 'reflect-metadata'"
        grep -q 'stepTimeout' "$tf" && check_pass "  Has stepTimeout" || check_fail "  No stepTimeout found"
        grep -q 'testCaseExecutor' "$tf" && check_pass "  Exports testCaseExecutor" || check_fail "  Missing testCaseExecutor export"
        grep -q 'single-page' "$tf" && check_pass "  Has single-page navigation strategy" || check_warn "  No single-page navigation strategy"

        # testID usage in test
        grep -q 'scrollAndClickByTestId' "$tf" && check_pass "  Uses testID-based locating" || check_warn "  Not using testID locating (textContains only)"

        # Halfwidth colon risk scan
        halfwidth=$(grep -o "waitForText('[^']*:[^']*')" "$tf" 2>/dev/null | head -5)
        if [ -n "$halfwidth" ]; then
            check_warn "  waitForText with halfwidth colon (verify Demo uses same):"
            echo "$halfwidth" | sed 's/^/      /'
        fi
    done
else
    check_fail "No .test.ts files found in tests/cases/"
fi

# --- 6. Summary ---
echo ""
echo "=== Summary ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  WARN: $WARN"
echo ""

if [ "$FAIL" -eq 0 ]; then
    echo "ALL CHECKS PASSED"
    exit 0
else
    echo "VALIDATION FAILED: $FAIL issue(s) must be fixed"
    exit 1
fi
