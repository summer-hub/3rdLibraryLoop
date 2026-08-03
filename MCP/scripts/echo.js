#!/usr/bin/env node
/**
 * @tool echo
 * @description 回显工具，原样返回传入的消息（用于测试 Gateway 脚本执行链路）
 * @param message: string - 要回显的消息内容
 */

// 第一个参数是 JSON 字符串
const argsJson = process.argv[2] || '{}';
const args = JSON.parse(argsJson);
const message = args.message || '(empty)';

console.log(`Echo: ${message}`);
