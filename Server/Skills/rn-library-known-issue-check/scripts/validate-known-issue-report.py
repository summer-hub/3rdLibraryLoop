#!/usr/bin/env python3
# @tool validate-known-issue-report
# @description 校验已知问题检视报告是否完整，检查报告结构、评分公式、证据完整性（跨平台：Windows/macOS/Linux）
# @param reportDir: string - 检视报告所在目录绝对路径

import json
import os
import re
import sys


def parse_args():
    """解析命令行参数：支持 JSON 字符串（MCP Gateway 约定）或直接传目录路径"""
    if len(sys.argv) > 1:
        raw = sys.argv[1]
        # 尝试解析为 JSON（MCP Gateway 传参方式）
        try:
            return json.loads(raw).get("reportDir", "")
        except json.JSONDecodeError:
            # 非 JSON，视为直接传入的目录路径
            return raw.strip()
    return ""


def main():
    report_dir = parse_args()

    if not report_dir:
        print("Usage: validate-known-issue-report.py <reportDir>")
        print("Error: reportDir parameter is required")
        return 1

    if not os.path.isdir(report_dir):
        print(f"Error: Directory does not exist: {report_dir}")
        return 1

    report_file = os.path.join(report_dir, "已知问题检视报告.md")
    if not os.path.isfile(report_file):
        print(f"Error: Report file not found: {report_file}")
        return 1

    # 读取报告内容（UTF-8，兼容中文）
    with open(report_file, "r", encoding="utf-8") as f:
        content = f.read()

    passed = 0
    failed = 0
    warnings = 0

    def check_pass(msg):
        nonlocal passed
        print(f"  ✅ {msg}")
        passed += 1

    def check_fail(msg):
        nonlocal failed
        print(f"  ❌ {msg}")
        failed += 1

    def check_warn(msg):
        nonlocal warnings
        print(f"  ⚠️  {msg}")
        warnings += 1

    print("=== 已知问题检视报告校验 ===")
    print(f"目录: {report_dir}")
    print("")

    # ─── 1. 报告结构检查 ───
    print("--- 1. 报告结构检查 ---")
    for section in ["检视概览", "规则命中清单", "命中问题详情", "检视结论"]:
        if section in content:
            check_pass(f"包含「{section}」章节")
        else:
            check_fail(f"缺少「{section}」章节")

    # ─── 2. 评分检查 ───
    print("")
    print("--- 2. 评分检查 ---")

    # 提取评分（兼容 **评分** | {score}/100 或 **评分**：{score}/100 等格式）
    score_match = re.search(r"\*\*评分\*\*[^\d]*(\d+)\s*/\s*100", content)
    if score_match:
        score = int(score_match.group(1))
        if 0 <= score <= 100:
            check_pass(f"评分在有效范围 (0-100): {score}")
        else:
            check_fail(f"评分超出有效范围: {score}")
    else:
        check_fail("未找到评分字段")

    # 检查评分公式
    if re.search(r"100\s*[−\-]\s*30", content):
        check_pass("评分公式正确 (100 - 30×命中数)")
    else:
        check_warn("未找到评分公式说明")

    # ─── 3. 命中规则检查 ───
    print("")
    print("--- 3. 命中规则检查 ---")

    hit_rules = len(re.findall(r"\*\*命中\*\*", content))
    if hit_rules > 0:
        check_pass(f"包含 {hit_rules} 条命中规则")
        # 检查是否有案例引用
        if re.search(r"KI-\d+", content):
            check_pass("命中规则引用了案例 (KI-XXX)")
        else:
            check_warn("命中规则未引用案例")
        # 检查是否有修复指引
        if re.search(r"修复指引|修复方案|正确特征", content):
            check_pass("命中规则包含修复指引")
        else:
            check_warn("命中规则缺少修复指引")
    else:
        check_warn("无命中规则")

    # ─── 4. 不适用规则清单 ───
    print("")
    print("--- 4. 不适用规则检查 ---")

    if re.search(r"不适用规则清单|不适用规则", content):
        check_pass("包含不适用规则清单")
        # 检查是否有跳过原因
        if re.search(r"不适用原因|预筛未命中", content):
            check_pass("不适用规则记录了跳过原因")
        else:
            check_warn("不适用规则缺少跳过原因")
    else:
        check_warn("无不适用规则清单")

    # ─── 5. 证据完整性 ───
    print("")
    print("--- 5. 证据完整性检查 ---")

    if re.search(r"```(cpp|typescript|arkts|ts|java)", content):
        check_pass("命中规则包含代码片段证据")
    else:
        check_warn("命中规则缺少代码片段证据")

    # 检查文件路径引用
    if re.search(r"\.(cpp|h|ets|ts|java):\d+", content):
        check_pass("证据包含文件路径+行号")
    else:
        check_warn("证据未包含文件路径+行号")

    # ─── 总结 ───
    print("")
    print("=== 校验总结 ===")
    print(f"  ✅ 通过: {passed}")
    print(f"  ❌ 失败: {failed}")
    print(f"  ⚠️  警告: {warnings}")
    print("")

    if failed == 0:
        print("ALL CHECKS PASSED")
        return 0
    else:
        print(f"VALIDATION FAILED: {failed} 个必须修复的问题")
        return 1


if __name__ == "__main__":
    sys.exit(main())
