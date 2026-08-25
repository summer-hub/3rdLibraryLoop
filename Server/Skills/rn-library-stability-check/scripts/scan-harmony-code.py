#!/usr/bin/env python3
# @tool scan-harmony-code
# @description 扫描 RN 三方库源码目录，智能识别鸿蒙化代码文件，输出分类统计结果
# @param sourceDir: string - 源码目录绝对路径

import sys
import json
import os
import re

def parse_args():
    if len(sys.argv) > 1:
        args = json.loads(sys.argv[1]) if sys.argv[1].startswith('{') else {}
    else:
        args = {}
    source_dir = args.get('sourceDir', '')
    if not source_dir:
        print("Error: sourceDir parameter is required")
        sys.exit(1)
    if not os.path.isdir(source_dir):
        print(f"Error: Source directory does not exist: {source_dir}")
        sys.exit(1)
    return source_dir

def find_files(root, extensions=None, name_patterns=None):
    results = []
    for dirpath, dirnames, filenames in os.walk(root):
        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            matched = False
            if name_patterns:
                for pattern in name_patterns:
                    if pattern in filename:
                        matched = True
                        break
            elif extensions:
                for ext in extensions:
                    if filename.endswith(ext):
                        matched = True
                        break
            if matched:
                results.append(filepath)
    return results

def grep_files(files, pattern):
    regex = re.compile(pattern)
    matched = []
    for filepath in files:
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                if regex.search(f.read()):
                    matched.append(filepath)
        except (IOError, OSError):
            pass
    return matched

def find_dirs(root, keywords):
    results = []
    for dirpath, dirnames, _ in os.walk(root):
        for dirname in dirnames:
            for kw in keywords:
                if kw in dirname.lower():
                    results.append(os.path.join(dirpath, dirname))
                    break
    return results

def main():
    source_dir = parse_args()

    print("=== 鸿蒙化代码扫描结果 ===")
    print(f"扫描目录: {source_dir}")
    print()

    # 1. ArkTS/ETS 文件
    print("--- 1. ArkTS/ETS 文件 ---")
    ets_files = find_files(source_dir, extensions=['.ets'])
    if ets_files:
        print(f"发现 {len(ets_files)} 个 .ets 文件:")
        for f in ets_files:
            print(f"  {f}")
    else:
        print("未发现 .ets 文件")
    print()

    # 2. 鸿蒙配置文件
    print("--- 2. 鸿蒙配置文件 ---")
    config_files = find_files(source_dir, name_patterns=['module.json5', 'oh-package.json5'])
    if config_files:
        print(f"发现 {len(config_files)} 个鸿蒙配置文件:")
        for f in config_files:
            print(f"  {f}")
    else:
        print("未发现鸿蒙配置文件")
    print()

    # 3. @ohos API 导入
    print("--- 3. @ohos API 导入 ---")
    ts_ets_files = find_files(source_dir, extensions=['.ets', '.ts'])
    ohos_files = grep_files(ts_ets_files, r'import.*@ohos')
    if ohos_files:
        print(f"发现 {len(ohos_files)} 个文件含 @ohos API 导入:")
        for f in ohos_files:
            print(f"  {f}")
    else:
        print("未发现 @ohos API 导入")
    print()

    # 4. NAPI C++ 文件
    print("--- 4. NAPI C++ 文件 ---")
    cpp_files = find_files(source_dir, extensions=['.cpp', '.h'])
    napi_files = grep_files(cpp_files, r'napi_')
    if napi_files:
        print(f"发现 {len(napi_files)} 个 NAPI 相关 C++ 文件:")
        for f in napi_files:
            print(f"  {f}")
    else:
        print("未发现 NAPI C++ 文件")
    print()

    # 5. TurboModule/NativeModule 注册
    print("--- 5. TurboModule/NativeModule 注册 ---")
    all_src = ts_ets_files + cpp_files
    turbo_files = grep_files(all_src, r'TurboModule|NativeModule|registerModule')
    if turbo_files:
        print(f"发现 {len(turbo_files)} 个 TurboModule/NativeModule 注册文件:")
        for f in turbo_files:
            print(f"  {f}")
    else:
        print("未发现 TurboModule/NativeModule 注册代码")
    print()

    # 6. 目录标识
    print("--- 6. 目录标识 ---")
    ohos_dirs = find_dirs(source_dir, ['ohos', 'harmony', 'openharmony'])
    if ohos_dirs:
        print(f"发现 {len(ohos_dirs)} 个鸿蒙相关目录:")
        for d in ohos_dirs:
            print(f"  {d}")
    else:
        print("未发现鸿蒙相关目录名")
    print()

    # 总结
    ets_count = len(ets_files)
    config_count = len(config_files)
    napi_count = len(napi_files)
    turbo_count = len(turbo_files)
    ohos_dir_count = len(ohos_dirs)

    print("=== 扫描总结 ===")
    print(f"  .ets 文件:           {ets_count}")
    print(f"  鸿蒙配置文件:        {config_count}")
    print(f"  @ohos API 导入文件:  {len(ohos_files)}")
    print(f"  NAPI C++ 文件:       {napi_count}")
    print(f"  TurboModule 注册:    {turbo_count}")
    print(f"  鸿蒙相关目录:        {ohos_dir_count}")
    print()

    total = ets_count + config_count + napi_count + turbo_count
    if total > 0:
        print(f"判定: ✅ 存在鸿蒙化代码 ({total} 个核心文件)")
    elif ohos_dir_count > 0:
        print("判定: ⚠️ 疑似鸿蒙化（有目录标识但无代码文件）")
    else:
        print("判定: ❌ 未发现鸿蒙化代码")

if __name__ == '__main__':
    main()
