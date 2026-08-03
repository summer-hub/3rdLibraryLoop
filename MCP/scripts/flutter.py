#!/usr/bin/env python3
# @tool flutter
# @description Flutter 开发辅助工具，支持 doctor/clean/build 信息查询
# @param action: string - 操作类型 (doctor|clean|version)
# @param target: string - 目标平台 (android|ios|web)

import sys
import json
import subprocess


def main():
    args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    action = args.get("action", "doctor")
    target = args.get("target", "")

    commands = {
        "doctor": ["flutter", "doctor"],
        "clean": ["flutter", "clean"],
        "version": ["flutter", "--version"],
    }

    cmd = commands.get(action)
    if not cmd:
        print(f"Unknown action: {action}")
        print("Supported: doctor|clean|version")
        sys.exit(1)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        print(result.stdout.strip())
        if result.returncode != 0 and result.stderr:
            print(f"[STDERR]\n{result.stderr.strip()}")
    except FileNotFoundError:
        print("Error: flutter 命令未找到，请确认 Flutter SDK 已安装")
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("Error: 命令执行超时")
        sys.exit(1)


if __name__ == "__main__":
    main()
