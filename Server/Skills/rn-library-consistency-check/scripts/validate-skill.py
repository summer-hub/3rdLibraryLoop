#!/usr/bin/env python3
# @tool validate-skill
# @description 校验SKILL目录是否符合Agent Skills规范，检查frontmatter、结构、渐进式披露
# @param skillDir: string - SKILL目录绝对路径

import json
import os
import re
import sys

PASS = 0
FAIL = 0
WARNINGS = 0


def check_pass(msg):
    global PASS
    print(f"  ✅ {msg}")
    PASS += 1


def check_fail(msg):
    global FAIL
    print(f"  ❌ {msg}")
    FAIL += 1


def check_warn(msg):
    global WARNINGS
    print(f"  ⚠️  {msg}")
    WARNINGS += 1


def main():
    global PASS, FAIL, WARNINGS

    # 解析参数：支持 JSON 字符串（MCP Gateway 调用）或直接路径（命令行调用）
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        try:
            skill_dir = json.loads(arg).get("skillDir", "")
        except (json.JSONDecodeError, AttributeError):
            skill_dir = arg
    else:
        print("Usage: validate-skill.py <skillDir>")
        print("Error: skillDir parameter is required")
        sys.exit(1)

    if not skill_dir:
        print("Usage: validate-skill.py <skillDir>")
        print("Error: skillDir parameter is required")
        sys.exit(1)

    if not os.path.isdir(skill_dir):
        print(f"Error: Directory does not exist: {skill_dir}")
        sys.exit(1)

    print("=== SKILL 规范校验 ===")
    print(f"目录: {skill_dir}")
    print()

    # ─── 1. SKILL.md 存在性 ───
    print("--- 1. 文件结构检查 ---")
    skill_file = os.path.join(skill_dir, "SKILL.md")
    if os.path.isfile(skill_file):
        check_pass("SKILL.md 存在")
    else:
        check_fail("SKILL.md 不存在")
        print("无法继续校验，SKILL.md 是必需文件")
        sys.exit(1)

    with open(skill_file, "r", encoding="utf-8") as f:
        content = f.read()
    lines = content.splitlines()

    # ─── 2. Frontmatter 检查 ───
    print()
    print("--- 2. Frontmatter 检查 ---")

    # 检查 frontmatter 存在
    if lines and lines[0].strip() == "---":
        check_pass("YAML frontmatter 存在")
    else:
        check_fail("缺少 YAML frontmatter（文件应以 --- 开头）")

    # 提取 name 字段
    name_match = re.search(r"^name:\s*(.+)$", content, re.MULTILINE)
    name_field = name_match.group(1).strip() if name_match else ""

    if name_field:
        check_pass(f"name 字段存在: {name_field}")

        # name 字符集校验
        if re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", name_field):
            check_pass("name 字符集合规（仅小写字母/数字/连字符）")
        else:
            check_fail("name 字符集不合规：应仅含 a-z/0-9/-，不能首尾连字符或连续连字符")

        # name 长度校验
        name_len = len(name_field)
        if 1 <= name_len <= 64:
            check_pass(f"name 长度合规 ({name_len} 字符)")
        else:
            check_fail(f"name 长度不合规：应在 1-64 字符之间（当前 {name_len}）")

        # name 匹配目录名
        dir_name = os.path.basename(skill_dir.rstrip(os.sep))
        if name_field == dir_name:
            check_pass(f"name 匹配父目录名 ({dir_name})")
        else:
            check_warn(
                f"name 与父目录名不一致：name='{name_field}' vs 目录='{dir_name}'"
                "（项目可能使用PascalCase目录命名约定）"
            )
    else:
        check_fail("name 字段缺失")

    # 提取 description 字段
    desc_match = re.search(
        r"^description:\s*(.+?)(?=\n[a-z]|\n---|\Z)", content, re.MULTILINE | re.DOTALL
    )
    desc_field = desc_match.group(1).strip() if desc_match else ""

    if desc_field:
        desc_len = len(desc_field)
        if desc_len <= 1024:
            check_pass(f"description 长度合规 ({desc_len} 字符)")
        else:
            check_fail(f"description 过长：应 ≤1024 字符（当前 {desc_len}）")
    else:
        check_fail("description 字段缺失或为空")

    # 检查 license
    if re.search(r"^license:", content, re.MULTILINE):
        check_pass("license 字段存在")
    else:
        check_warn("license 字段缺失（推荐添加）")

    # 检查 metadata
    if re.search(r"^metadata:", content, re.MULTILINE):
        check_pass("metadata 字段存在")
    else:
        check_warn("metadata 字段缺失（推荐添加 author/version）")

    # ─── 3. Body 检查 ───
    print()
    print("--- 3. Body 内容检查 ---")

    # 统计 body 行数（frontmatter 之后的行）
    start = 0
    end_idx = 0
    for i, line in enumerate(lines):
        if line.strip() == "---":
            if start == 0:
                start = i + 1
            else:
                end_idx = i + 1
                break
    if end_idx == 0:
        end_idx = start
    body_lines = len(lines) - end_idx

    if body_lines <= 500:
        check_pass(f"body 行数合规 ({body_lines} 行, ≤500)")
    else:
        check_warn(
            f"body 行数较多 ({body_lines} 行，推荐 < 500，考虑拆分到 references/)"
        )

    # 检查任务参数表
    if re.search(r"任务参数|## .*参数\| 参数", content):
        check_pass("包含任务参数说明")
    else:
        check_warn("未找到任务参数表（推荐添加）")

    # 检查工作流程
    if re.search(r"工作流程|Phase|## Phase", content):
        check_pass("包含工作流程概览")
    else:
        check_warn("未找到工作流程概览（推荐添加）")

    # ─── 4. 渐进式披露检查 ───
    print()
    print("--- 4. 渐进式披露检查 ---")

    # 检查 references 目录
    ref_dir = os.path.join(skill_dir, "references")
    if os.path.isdir(ref_dir):
        ref_files = [
            f
            for f in os.listdir(ref_dir)
            if f.endswith(".md") and os.path.isfile(os.path.join(ref_dir, f))
        ]
        check_pass(f"references/ 目录存在 ({len(ref_files)} 个文档)")

        # 检查引用深度（一层）
        nested = False
        for root, dirs, files in os.walk(ref_dir):
            if root != ref_dir and dirs:
                nested = True
                break
        if not nested:
            check_pass("references 保持一层深度")
        else:
            check_fail("references 存在嵌套子目录，应保持一层深度")
    else:
        check_warn("无 references/ 目录（详细内容建议拆分到此目录）")

    # 检查 assets 目录
    if os.path.isdir(os.path.join(skill_dir, "assets")):
        check_pass("assets/ 目录存在")
    else:
        check_warn("无 assets/ 目录（如需模板/资源可添加）")

    # 检查 scripts 目录
    if os.path.isdir(os.path.join(skill_dir, "scripts")):
        check_pass("scripts/ 目录存在")
    else:
        check_warn("无 scripts/ 目录（如需可执行脚本可添加）")

    # 检查文件引用使用相对路径
    abs_refs = len(re.findall(r"\]\(/[^)]+\)", content))
    if abs_refs == 0:
        check_pass("文件引用使用相对路径")
    else:
        check_fail(f"发现 {abs_refs} 个绝对路径引用，应使用相对路径")

    # ─── 5. 总结 ───
    print()
    print("=== 校验总结 ===")
    print(f"  ✅ 通过: {PASS}")
    print(f"  ❌ 失败: {FAIL}")
    print(f"  ⚠️  警告: {WARNINGS}")
    print()

    if FAIL == 0:
        print("ALL CHECKS PASSED")
        sys.exit(0)
    else:
        print(f"VALIDATION FAILED: {FAIL} 个必须修复的问题")
        sys.exit(1)


if __name__ == "__main__":
    main()
