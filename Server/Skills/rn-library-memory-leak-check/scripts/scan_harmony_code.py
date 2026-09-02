#!/usr/bin/env python3
"""
 * Copyright (C) 2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
"""
# @tool scan-harmony-code
# @description 扫描 RN 三方库源码，识别鸿蒙化实现代码特征（ArkTS/ETS + C++ NAPI），输出文件列表和特征匹配结果
# @param sourceDir: string - 源码根目录路径（通常为 {outputDir}/source）

"""
Harmony Code Scanner Script
扫描 RN 三方库源码，识别鸿蒙化实现代码特征。
跨平台实现（仅依赖 Python 标准库），支持 Windows/macOS/Linux。
"""

import sys
import os
import re
import json
from pathlib import Path
from typing import List, Set, Dict, Tuple


# ─── 扫描配置 ───

ARKTS_EXTENSIONS = {'.ets', '.ts'}
JS_EXTENSIONS = {'.ts', '.js', '.tsx'}
CPP_EXTENSIONS = {'.cpp', '.c', '.h', '.hpp'}
HARMONY_DIRS = {'harmony', 'ohos', 'harmonyos'}

# 排除目录：上游 npm 包缓存 / 依赖安装目录。
# 不排除时，.upstream-cache 中的上游 JS 文件（仅因含 NativeModules 引用）会被
# 误报为"RN 鸿蒙化特征文件"，夸大鸿蒙化特征统计并污染目录级分析样本。
EXCLUDED_DIRS = {'.upstream-cache', 'node_modules', 'oh_modules'}

# RN JS 三方库特征（检测这些以确认是 RN 鸿蒙化库而非纯 JS 库）
RN_JS_PATTERNS = [
    re.compile(r'TurboModuleRegistry', re.IGNORECASE),
    re.compile(r'NativeModules', re.IGNORECASE),
    re.compile(r'codegenNativeComponent', re.IGNORECASE),
]

# ArkTS/ETS 层特征
OHOS_IMPORT_PATTERN = re.compile(r'@ohos\.')
TURBOMODULE_ARKTS_PATTERN = re.compile(r'extends\s+TurboModule|class\s+\w+TurboModule')
NATIVE_COMPONENT_PATTERN = re.compile(r'@Component|export\s+struct\s+RN')
EVENT_EMITTER_PATTERN = re.compile(r'NativeEventEmitter|DeviceEventEmitter|RCTEventEmitter')

# C++ Native 层特征
NAPI_CPP_PATTERN = re.compile(r'napi_|TurboModule|JSI|HostFunction|CppComponentInstance')
NAPI_REF_PATTERN = re.compile(r'napi_create_reference|napi_wrap|napi_delete_reference|napi_open_handle_scope')

MAX_LIST_FILES = 20


# ─── 工具函数 ───

def parse_args() -> str:
    """解析命令行参数，支持 MCP Gateway JSON 字符串和直接 CLI 两种方式。"""
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        if arg.startswith('{'):
            try:
                data = json.loads(arg)
                return data.get('sourceDir', '')
            except (json.JSONDecodeError, AttributeError):
                pass
        return arg
    return ''


def find_files(root: Path, extensions: Set[str], max_results: int = 0) -> List[Path]:
    """递归查找指定扩展名的文件，跨平台实现（自动排除缓存/依赖目录）。"""
    results = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
        for filename in filenames:
            ext = os.path.splitext(filename)[1].lower()
            if ext in extensions:
                results.append(Path(dirpath) / filename)
                if max_results and len(results) >= max_results:
                    return results
    return results


def find_dirs(root: Path, target_names: Set[str], max_results: int = 5) -> List[Path]:
    """查找指定名称的目录（自动排除缓存/依赖目录）。"""
    results = []
    for dirpath, dirnames, _ in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
        for dirname in dirnames:
            if dirname in target_names:
                results.append(Path(dirpath) / dirname)
                if len(results) >= max_results:
                    return results
    return results


def grep_files(files: List[Path], patterns: List[re.Pattern]) -> List[Path]:
    """在文件列表中搜索正则模式，返回匹配的文件路径。"""
    matched = []
    for filepath in files:
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            for pattern in patterns:
                if pattern.search(content):
                    matched.append(filepath)
                    break
        except (OSError, PermissionError):
            continue
    return matched


def grep_dir(root: Path, extensions: Set[str], patterns: List[re.Pattern], max_results: int = MAX_LIST_FILES) -> List[Path]:
    """在目录中搜索指定扩展名文件中的正则模式，返回匹配的文件路径。"""
    files = find_files(root, extensions)
    matched = grep_files(files, patterns)
    return matched[:max_results] if max_results else matched


def format_paths(paths: List[Path], indent: str = '    ') -> str:
    """格式化路径列表为缩进行。"""
    return '\n'.join(f'{indent}{p}' for p in paths) if paths else ''


# ─── 扫描阶段 ───

def scan_rn_js_features(source_dir: Path) -> Tuple[List[Path], bool]:
    """阶段 1：RN JS 三方库特征检测。"""
    print('--- 1. RN JS 三方库特征检测 ---')
    matched = grep_dir(source_dir, JS_EXTENSIONS, RN_JS_PATTERNS, max_results=5)
    if not matched:
        print('  ⚠️ 未检测到 TurboModuleRegistry/NativeModules/codegenNativeComponent')
        print('  → 可能是 RNJS 三方库，无需鸿蒙化内存泄露检视')
    else:
        print('  ✅ 检测到 RN 鸿蒙化特征文件:')
        print(format_paths(matched))
    print()
    return matched, bool(matched)


def scan_arkts_layer(source_dir: Path) -> Dict[str, int]:
    """阶段 2：ArkTS/ETS 层特征扫描。"""
    print('--- 2. ArkTS/ETS 层特征扫描 ---')

    ets_files = find_files(source_dir, {'.ets'})
    ets_count = len(ets_files)
    print(f'  .ets 文件数: {ets_count}')

    ohos_files = grep_dir(source_dir, ARKTS_EXTENSIONS, [OHOS_IMPORT_PATTERN])
    ohos_count = len(ohos_files)
    print(f'  @ohos 模块导入文件数: {ohos_count}')

    turbomodule_files = grep_dir(source_dir, ARKTS_EXTENSIONS, [TURBOMODULE_ARKTS_PATTERN])
    turbomodule_count = len(turbomodule_files)
    print(f'  TurboModule 鸿蒙实现文件数: {turbomodule_count}')

    native_component_files = grep_dir(source_dir, {'.ets'}, [NATIVE_COMPONENT_PATTERN])
    native_component_count = len(native_component_files)
    print(f'  NativeComponent 鸿蒙实现文件数: {native_component_count}')

    event_emitter_files = grep_dir(source_dir, ARKTS_EXTENSIONS, [EVENT_EMITTER_PATTERN])
    event_emitter_count = len(event_emitter_files)
    print(f'  Bridge 事件机制文件数: {event_emitter_count}')

    print()
    return {
        'ets_count': ets_count,
        'ohos_count': ohos_count,
        'turbomodule_count': turbomodule_count,
        'native_component_count': native_component_count,
        'event_emitter_count': event_emitter_count,
    }


def scan_cpp_layer(source_dir: Path) -> Dict[str, int]:
    """阶段 3：C/C++ NAPI 绑定层特征扫描。"""
    print('--- 3. C/C++ NAPI 绑定层特征扫描 ---')

    cpp_files = find_files(source_dir, CPP_EXTENSIONS)
    cpp_count = len(cpp_files)
    print(f'  C/C++ 文件数: {cpp_count}')

    napi_files = grep_dir(source_dir, CPP_EXTENSIONS, [NAPI_CPP_PATTERN])
    napi_count = len(napi_files)
    print(f'  NAPI/TurboModule/JSI 特征文件数: {napi_count}')

    napi_ref_files = grep_dir(source_dir, CPP_EXTENSIONS, [NAPI_REF_PATTERN])
    napi_ref_count = len(napi_ref_files)
    print(f'  NAPI 引用管理文件数: {napi_ref_count}')

    print()
    return {
        'cpp_count': cpp_count,
        'napi_count': napi_count,
        'napi_ref_count': napi_ref_count,
    }


def scan_harmony_dirs(source_dir: Path) -> List[Path]:
    """阶段 4：鸿蒙化目录检测。"""
    print('--- 4. 鸿蒙化目录检测 ---')
    found_dirs = []
    for dir_name in sorted(HARMONY_DIRS):
        found = find_dirs(source_dir, {dir_name}, max_results=5)
        if found:
            print(f'  ✅ 发现目录: {dir_name}')
            print(format_paths(found))
            found_dirs.extend(found)
    print()
    return found_dirs


def print_summary(
    arkts: Dict[str, int],
    cpp: Dict[str, int],
    rn_js_detected: bool,
) -> None:
    """阶段 5：汇总判定。"""
    print('=== 扫描结果汇总 ===')

    has_harmony = (
        arkts['ets_count'] > 0
        or arkts['ohos_count'] > 0
        or arkts['turbomodule_count'] > 0
        or cpp['napi_count'] > 0
    )

    if has_harmony:
        print('  ✅ 确认鸿蒙化实现，建议进入 Phase 1 内存泄露检视')
        print(f'  ArkTS/ETS 层文件数: {arkts["ets_count"]}')
        print(f'  C/C++ 层文件数: {cpp["cpp_count"]}')
        print('  特征匹配:')
        print(f'    @ohos 导入: {arkts["ohos_count"]}')
        print(f'    TurboModule 实现: {arkts["turbomodule_count"]}')
        print(f'    NativeComponent: {arkts["native_component_count"]}')
        print(f'    Bridge 事件: {arkts["event_emitter_count"]}')
        print(f'    NAPI/JSI: {cpp["napi_count"]}')
        print(f'    NAPI 引用管理: {cpp["napi_ref_count"]}')
    elif not rn_js_detected:
        print('  ⚠️ 未检测到 RN 鸿蒙化特征，可能为 RNJS 三方库')
        print("  → 建议评分 0 分，标注 'RNJS 三方库'")
    else:
        print('  ⚠️ 未发现鸿蒙化代码特征')
        print("  → 建议评分 0 分，标注 '未实现鸿蒙化'")


# ─── 主入口 ───

def main() -> None:
    source_dir_str = parse_args()

    if not source_dir_str:
        print('Usage: scan_harmony_code.py <sourceDir>')
        print('Error: sourceDir parameter is required')
        sys.exit(1)

    source_dir = Path(source_dir_str)
    if not source_dir.is_dir():
        print(f'Error: Directory does not exist: {source_dir_str}')
        sys.exit(1)

    print('=== 鸿蒙化代码特征扫描 ===')
    print(f'源码目录: {source_dir_str}')
    print(f'排除目录: {", ".join(sorted(EXCLUDED_DIRS))}')
    print()

    rn_js_matched, rn_js_detected = scan_rn_js_features(source_dir)
    arkts = scan_arkts_layer(source_dir)
    cpp = scan_cpp_layer(source_dir)
    scan_harmony_dirs(source_dir)
    print_summary(arkts, cpp, rn_js_detected)


if __name__ == '__main__':
    main()
