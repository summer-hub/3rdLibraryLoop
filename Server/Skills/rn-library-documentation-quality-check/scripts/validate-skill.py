#!/usr/bin/env python3
# @tool validate-skill
# @description 校验SKILL目录是否符合Agent Skills规范，检查frontmatter、结构、渐进式披露
# @param skillDir: string - SKILL目录绝对路径

import sys
import json
import os
import re


def main():
    # 解析参数：支持 JSON 字符串（MCP Gateway 调用）或直接命令行参数
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        if arg.startswith('{'):
            skill_dir = json.loads(arg).get('skillDir', '')
        else:
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

    passed = 0
    failed = 0
    warnings = 0

    def check_pass(msg):
        nonlocal passed
        print(f"  PASS  {msg}")
        passed += 1

    def check_fail(msg):
        nonlocal failed
        print(f"  FAIL  {msg}")
        failed += 1

    def check_warn(msg):
        nonlocal warnings
        print(f"  WARN  {msg}")
        warnings += 1

    print("=== SKILL spec validation ===")
    print(f"Directory: {skill_dir}")
    print()

    # --- 1. SKILL.md existence ---
    print("--- 1. File structure ---")
    skill_file = os.path.join(skill_dir, "SKILL.md")
    if os.path.isfile(skill_file):
        check_pass("SKILL.md exists")
    else:
        check_fail("SKILL.md does not exist")
        print("Cannot continue validation, SKILL.md is required")
        sys.exit(1)

    with open(skill_file, 'r', encoding='utf-8') as f:
        content = f.read()
    lines = content.splitlines()

    # --- 2. Frontmatter ---
    print()
    print("--- 2. Frontmatter ---")

    if lines and lines[0].strip() == '---':
        check_pass("YAML frontmatter exists")
    else:
        check_fail("Missing YAML frontmatter (file should start with ---)")

    # Extract name
    name_match = re.search(r'^name:\s*(.+)$', content, re.MULTILINE)
    name_field = name_match.group(1).strip() if name_match else ''

    if name_field:
        check_pass(f"name field exists: {name_field}")

        if re.match(r'^[a-z0-9]+(-[a-z0-9]+)*$', name_field):
            check_pass("name charset valid (lowercase letters/digits/hyphens only)")
        else:
            check_fail("name charset invalid: should only contain a-z/0-9/-, no leading/trailing or consecutive hyphens")

        name_len = len(name_field)
        if 1 <= name_len <= 64:
            check_pass(f"name length valid ({name_len} chars)")
        else:
            check_fail(f"name length invalid: should be 1-64 chars (current {name_len})")

        dir_name = os.path.basename(skill_dir.rstrip(os.sep))
        if name_field == dir_name:
            check_pass(f"name matches parent directory ({dir_name})")
        else:
            check_warn(f"name does not exactly match parent directory: name='{name_field}' vs dir='{dir_name}' (PascalCase dir convention exempted)")
    else:
        check_fail("name field is missing")

    # Extract description
    desc_match = re.search(r'^description:\s*(.+?)(?=\n[a-z]|\n---|\Z)', content, re.MULTILINE | re.DOTALL)
    desc_field = desc_match.group(1).strip() if desc_match else ''

    if desc_field:
        desc_len = len(desc_field)
        if desc_len <= 1024:
            check_pass(f"description length valid ({desc_len} chars)")
        else:
            check_fail(f"description too long: should be <=1024 chars (current {desc_len})")
    else:
        check_fail("description field is missing or empty")

    # Check license
    if re.search(r'^license:', content, re.MULTILINE):
        check_pass("license field exists")
    else:
        check_warn("license field missing (recommended)")
        warnings += 1

    # Check metadata
    if re.search(r'^metadata:', content, re.MULTILINE):
        check_pass("metadata field exists")
    else:
        check_warn("metadata field missing (recommended author/version)")
        warnings += 1

    # --- 3. Body ---
    print()
    print("--- 3. Body content ---")

    # Count body lines (after frontmatter)
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
    body_lines = lines[end_idx:]
    body_count = len(body_lines)

    if body_count <= 500:
        check_pass(f"body line count valid ({body_count} lines, <=500)")
    else:
        check_warn(f"body line count high ({body_count} lines, recommended <500, consider splitting to references/)")
        warnings += 1

    # Check task parameters table
    if re.search(r'(task param|param|\| .*param)', content, re.IGNORECASE) or 'param' in content.lower():
        check_pass("contains task parameters table")
    else:
        check_warn("no task parameters table found (recommended)")
        warnings += 1

    # Check workflow
    if re.search(r'(workflow|Phase)', content):
        check_pass("contains workflow overview")
    else:
        check_warn("no workflow overview found (recommended)")
        warnings += 1

    # --- 4. Progressive disclosure ---
    print()
    print("--- 4. Progressive disclosure ---")

    # Check references directory
    refs_dir = os.path.join(skill_dir, "references")
    if os.path.isdir(refs_dir):
        ref_files = [f for f in os.listdir(refs_dir) if f.endswith('.md') and os.path.isfile(os.path.join(refs_dir, f))]
        check_pass(f"references/ directory exists ({len(ref_files)} docs)")

        # Check nesting depth (one level)
        nested = False
        for root, dirs, files in os.walk(refs_dir):
            if root != refs_dir and dirs:
                nested = True
                break
        if not nested:
            check_pass("references maintain one-level depth")
        else:
            check_fail("references contains nested subdirectories, should maintain one-level depth")
    else:
        check_warn("no references/ directory (consider splitting detailed content here)")
        warnings += 1

    # Check assets directory
    assets_dir = os.path.join(skill_dir, "assets")
    if os.path.isdir(assets_dir):
        asset_files = [f for f in os.listdir(assets_dir) if os.path.isfile(os.path.join(assets_dir, f))]
        check_pass(f"assets/ directory exists ({len(asset_files)} files)")
    else:
        check_warn("no assets/ directory (add if templates/resources needed)")
        warnings += 1

    # Check scripts directory
    scripts_dir = os.path.join(skill_dir, "scripts")
    if os.path.isdir(scripts_dir):
        script_files = [f for f in os.listdir(scripts_dir) if os.path.isfile(os.path.join(scripts_dir, f))]
        check_pass(f"scripts/ directory exists ({len(script_files)} scripts)")
    else:
        check_warn("no scripts/ directory (add if executable scripts needed)")
        warnings += 1

    # Check relative paths (no absolute path references like ](/...)
    abs_refs = re.findall(r'\]\(/[^)]+\)', content)
    if len(abs_refs) == 0:
        check_pass("file references use relative paths")
    else:
        check_fail(f"found {len(abs_refs)} absolute path references, should use relative paths")

    # --- 5. Referenced file existence ---
    print()
    print("--- 5. Referenced file existence ---")

    ref_paths = set(re.findall(r'\]\((references/[^)]+)\)', content))
    asset_paths = set(re.findall(r'\]\((assets/[^)]+)\)', content))

    for ref in sorted(ref_paths):
        fullpath = os.path.join(skill_dir, ref)
        if os.path.isfile(fullpath):
            check_pass(f"referenced file exists: {ref}")
        else:
            check_fail(f"referenced file does not exist: {ref}")

    for asset in sorted(asset_paths):
        fullpath = os.path.join(skill_dir, asset)
        if os.path.isfile(fullpath):
            check_pass(f"referenced file exists: {asset}")
        else:
            check_fail(f"referenced file does not exist: {asset}")

    # --- 6. Summary ---
    print()
    print("=== Validation summary ===")
    print(f"  PASS: {passed}")
    print(f"  FAIL: {failed}")
    print(f"  WARN: {warnings}")
    print()

    if failed == 0:
        print("ALL CHECKS PASSED")
        sys.exit(0)
    else:
        print(f"VALIDATION FAILED: {failed} issue(s) must be fixed")
        sys.exit(1)


if __name__ == '__main__':
    main()
